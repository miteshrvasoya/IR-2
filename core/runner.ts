// Runs a proceeding: creates a session document, seats agents, and drives the turn loop.
// Isomorphic: the browser runs live cases with it; scripts/record.ts uses it to record sample runs.
import { Sim } from './sim.ts';
import type { CaseBundle } from './caselib.ts';
import { nextTurn, describe, apply, startCase, safeDefault, RuleError } from './engine.ts';
import { buildView } from './views.ts';
import { heuristicDecide } from './brains/heuristic.ts';
import { llmDecide, type LlmTarget } from './brains/llm.ts';
import { config } from './config.ts';
import type { AgentDecision, AgentProfile, SessionState, Turn } from '../shared/types.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => 's_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');

export function createSession(b: CaseBundle, opts: { id?: string; speed?: number; seed?: number; hostId?: string | null } = {}): Sim {
  const id = opts.id || rid(), seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
  const sim = new Sim(id, b);
  sim.st = {
    id, caseId: b.def.id, title: b.def.title, status: 'lobby', phase: 'lobby', scene: 'office', seed, rng: seed, seq: 0, turn: 0,
    hostId: opts.hostId ?? null, createdAt: new Date().toISOString(),
    seats: Object.fromEntries(b.def.seats.map((s) => [s.id, { seatId: s.id, agentId: null, ownerId: null, ready: false, house: false, connected: true, failures: 0 }])),
    queue: [], hoursLeft: b.def.procedure.investigationHours, phaseTurns: 0, passes: 0, leadsDone: [], warrants: {}, jobs: [], investigatorFacts: [],
    chars: Object.fromEntries(Object.keys(b.characters).map((c) => [c, { revealed: [], denied: [], caught: [], pressure: 0, credibility: 100, interviews: 0, shown: [] }])),
    sub: {}, defendant: null, charge: null, plea: null, report: null,
    trial: { witnessesCalled: {}, motions: 0, rested: {}, openingDone: [], closingDone: [], round: 0, votes: {}, voteHistory: [], argued: {}, testimony: [], confer: 0 },
    outcome: null, speed: opts.speed ?? 1,
  } as SessionState;
  for (const e of Object.keys(b.evidence)) sim.ev[e] = { id: e, discovered: false, custody: [], analyses: {}, disclosedToDefense: false, status: 'undiscovered', challenges: [] };
  sim.emit('created', { text: `Case opened: ${b.def.title}`, ms: 0 });
  return sim;
}

/** Put a specific agent in a seat (lobby only). */
export function seat(sim: Sim, seatId: string, agent: AgentProfile, ownerId: string | null) {
  const s = sim.st.seats[seatId];
  if (!s) throw new Error('No such seat.');
  if (sim.st.status !== 'lobby') throw new Error('The case has already started.');
  if (Object.entries(sim.st.seats).some(([k, x]) => k !== seatId && x.agentId === agent.id)) throw new Error(`${agent.name} already holds another seat.`);
  Object.assign(s, { agentId: agent.id, ownerId, house: agent.house, ready: true, failures: 0, joinedAt: new Date().toISOString() });
  sim.agents[seatId] = agent;
}
export function unseat(sim: Sim, seatId: string) {
  Object.assign(sim.st.seats[seatId], { agentId: null, ownerId: null, ready: false, house: false }); delete sim.agents[seatId];
}

/** Choose a house agent for a seat: cast seats prefer the actor whose temperament fits the character. */
export function pickHouse(sim: Sim, seatId: string, roster: AgentProfile[], rand = Math.random): AgentProfile {
  const role = sim.role(seatId), used = new Set(Object.values(sim.st.seats).map((s) => s.agentId));
  const pool = roster.filter((a) => a.house && !used.has(a.id));
  const fit = pool.filter((a) => a.preferredRoles.includes(role)), list = fit.length ? fit : pool;
  if (!list.length) throw new Error('No house agent available for ' + seatId);
  const ch = sim.seatDef(seatId).characterId, want = ch ? sim.b.characters[ch].actorStyle : null;
  return list.find((a) => want && a.style === want) || list[Math.floor(rand() * list.length)];
}
export function fillHouse(sim: Sim, roster: AgentProfile[], rand = Math.random) {
  for (const id of Object.keys(sim.st.seats)) if (!sim.st.seats[id].agentId) seat(sim, id, pickHouse(sim, id, roster, rand), null);
}

export function begin(sim: Sim) {
  const missing = sim.b.def.seats.filter((d) => d.required && !(sim.st.seats[d.id].agentId && sim.st.seats[d.id].ready));
  if (missing.length) throw new Error(`Cannot start: ${missing.map((m) => m.title).join(', ')} not seated.`);
  startCase(sim);
}

// ---------- minds ----------
/** How to reach a model for an agent, or null to use the Local Reasoner. Supplied by the host. */
export type TargetResolver = (sim: Sim, seatId: string, agent: AgentProfile) => LlmTarget | null | Promise<LlmTarget | null>;
export type Source = 'llm' | 'local' | 'failover';

async function decide(sim: Sim, seatId: string, view: ReturnType<typeof buildView>, resolve: TargetResolver | undefined, feedback?: string): Promise<{ decision: AgentDecision; source: Source; error?: string }> {
  const a = sim.agents[seatId], s = sim.st.seats[seatId];
  const t = s.failures >= 3 || !resolve ? null : await resolve(sim, seatId, a);       // breaker open after 3 failures
  if (!t) return { decision: heuristicDecide(view), source: a.model.provider === 'house' ? 'local' : 'failover' };
  let err = '';
  for (let attempt = 0; attempt <= config.llmRetries; attempt++) {
    try {
      const decision = (await Promise.race([llmDecide(t, view, feedback), sleep(config.llmTimeoutMs + 2000).then(() => { throw new Error('timed out'); })])) as AgentDecision;
      s.failures = 0;
      return { decision, source: 'llm' };
    } catch (e: any) {
      err = String(e?.message || e).replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…');
      if (e?.status === 401 || e?.status === 403) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  s.failures++;
  return { decision: heuristicDecide(view), source: 'failover', error: err };
}

async function step(sim: Sim, turn: Turn, resolve?: TargetResolver) {
  const seatId = turn.seat, spec = describe(sim, turn);
  const view = buildView(sim, turn, spec.instruction, spec.options, spec.context);
  const { decision, source, error } = await decide(sim, seatId, view, resolve);
  if (error) sim.emit('system', { text: `${sim.agents[seatId].name}'s model did not respond; the house reasoner covers this turn.`, data: { seatId, error }, ms: 0 });
  if (sim.st.seats[seatId].failures === 3) sim.emit('system', { text: `${sim.agents[seatId].name} has lost its model connection. The house reasoner holds the seat.`, data: { seatId, takeover: true }, ms: 2500 });
  let lastError = '';
  const attempts: (() => Promise<AgentDecision | null>)[] = [
    async () => decision,
    async () => (source === 'llm' ? (await decide(sim, seatId, view, resolve, lastError)).decision : null),
    async () => heuristicDecide(view),
    async () => safeDefault(sim, turn),
  ];
  for (const get of attempts) {
    const d = await get(); if (!d) continue;
    const undo = sim.checkpoint();
    try { apply(sim, turn, d); return; }
    catch (e: any) { undo(); if (!(e instanceof RuleError)) throw e; lastError = e.message; }
  }
  throw new Error(`no valid action for ${seatId}/${turn.purpose}: ${lastError}`);
}

export interface RunOptions { resolve?: TargetResolver; shouldStop?: () => boolean; pace?: boolean }
/** Drive the case until it finishes, is paused, or `shouldStop` says so. Persists via sim.onSave after every step. */
export async function run(sim: Sim, o: RunOptions = {}) {
  try {
    while (sim.st.status === 'live' && !o.shouldStop?.()) {
      const turn = nextTurn(sim);
      if (sim.hasFresh()) { const ms = sim.freshMs(); await sim.save(); if (o.pace) await sleep(Math.min(16000, ms * sim.st.speed)); }
      if (!turn) { await sim.save(); break; }
      await step(sim, turn, o.resolve);
      const ms = sim.freshMs();
      await sim.save();
      if (o.pace) await sleep(Math.min(16000, ms * sim.st.speed));
    }
  } catch (e: any) {
    console.error(`[run ${sim.id}]`, e);
    sim.st.status = 'paused'; sim.st.error = String(e?.message || e).slice(0, 300);
    sim.emit('system', { text: 'The proceeding hit an internal error and is paused.', ms: 0 });
    await sim.save();
  }
}
