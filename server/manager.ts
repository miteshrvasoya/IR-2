// Session lifecycle: lobbies, seats, readiness, the run loop that drives a live case, pacing, recovery
// after restart, and the fan-out of public events to spectators.
import { Sim } from './sim.ts';
import { rt, listDir, writeJson } from './store.ts';
import { getCase } from './caselib.ts';
import { nextTurn, describe, apply, startCase, safeDefault, RuleError } from './engine.ts';
import { buildView, publicEvent } from './views.ts';
import { decide, heuristicDecide } from './brains/index.ts';
import { commitResults } from './referee.ts';
import { getAgent, listAgents, credentialSecret, suits } from './accounts.ts';
import { newId } from './crypto.ts';
import { config } from './config.ts';
import type { AgentDecision, AgentProfile, PublicUser, SessionState, SimEvent, Turn } from '../shared/types.ts';

const sims = new Map<string, Sim>();
const running = new Set<string>();
const subs = new Map<string, Set<(evs: SimEvent[]) => void>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

function attach(sim: Sim) {
  sims.set(sim.id, sim);
  sim.onEvents = (evs) => {
    const finished = sim.st.status === 'finished';
    const pub = evs.map((e) => publicEvent(e, finished)).filter(Boolean) as SimEvent[];
    if (pub.length) for (const fn of subs.get(sim.id) || []) { try { fn(pub); } catch {} }
  };
}
export function subscribe(id: string, fn: (evs: SimEvent[]) => void) {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(fn);
  return () => subs.get(id)?.delete(fn);
}
export const watchers = (id: string) => subs.get(id)?.size || 0;

async function loadAgents(sim: Sim) {
  for (const [seat, s] of Object.entries(sim.st.seats)) if (s.agentId) { const a = await getAgent(s.agentId); if (a) sim.agents[seat] = a; }
}
export async function getSim(id: string): Promise<Sim> {
  if (sims.has(id)) return sims.get(id)!;
  if (!/^s_[a-f0-9]+$/.test(id)) throw err(404, 'No such case.');
  let sim: Sim;
  try { sim = await Sim.load(id); } catch { throw err(404, 'No such case.'); }
  await loadAgents(sim); attach(sim);
  return sim;
}
export async function allSims(): Promise<Sim[]> {
  for (const d of await listDir(rt('sessions'))) if (/^s_[a-f0-9]+$/.test(d) && !sims.has(d)) await getSim(d).catch(() => {});
  return [...sims.values()].sort((a, b) => b.st.createdAt.localeCompare(a.st.createdAt));
}

export async function createSession(caseId: string, host: PublicUser | null, opts: { scheduledFor?: string; speed?: number } = {}): Promise<Sim> {
  const b = getCase(caseId), id = newId('s');
  const sim = new Sim(id, caseId), seed = (Math.random() * 2 ** 31) | 0;
  sim.st = {
    id, caseId, title: b.def.title, status: 'lobby', phase: 'lobby', scene: 'office', seed, rng: seed, seq: 0, turn: 0,
    hostId: host?.id || null, createdAt: new Date().toISOString(), scheduledFor: opts.scheduledFor,
    seats: Object.fromEntries(b.def.seats.map((s) => [s.id, { seatId: s.id, agentId: null, ownerId: null, ready: false, house: false, connected: true, failures: 0 }])),
    queue: [], hoursLeft: b.def.procedure.investigationHours, phaseTurns: 0, passes: 0, leadsDone: [], warrants: {}, jobs: [], investigatorFacts: [],
    chars: Object.fromEntries(Object.keys(b.characters).map((c) => [c, { revealed: [], denied: [], caught: [], pressure: 0, credibility: 100, interviews: 0, shown: [] }])),
    sub: {}, defendant: null, charge: null, plea: null, report: null,
    trial: { witnessesCalled: {}, motions: 0, rested: {}, openingDone: [], closingDone: [], round: 0, votes: {}, voteHistory: [], argued: {}, testimony: [], confer: 0 },
    outcome: null, speed: opts.speed ?? config.speed,
  } as SessionState;
  for (const e of Object.keys(b.evidence)) sim.ev[e] = { id: e, discovered: false, custody: [], analyses: {}, disclosedToDefense: false, status: 'undiscovered', challenges: [] };
  sim.emit('created', { text: `Case opened: ${b.def.title}`, ms: 0 });
  attach(sim); await sim.save();
  return sim;
}

const isHost = (sim: Sim, u: PublicUser) => u.admin || sim.st.hostId === u.id;

export async function join(sim: Sim, seatId: string, agentId: string, user: PublicUser) {
  const st = sim.st, seat = st.seats[seatId], agent = await getAgent(agentId);
  if (!seat) throw err(404, 'No such seat.');
  if (!agent || agent.ownerId !== user.id) throw err(403, 'You can only seat your own agents. Adopt a marketplace agent to your library first.');
  if (Object.values(st.seats).some((s) => s.agentId === agentId)) throw err(409, 'That agent already holds a seat in this case.');
  if (Object.values(st.seats).filter((s) => s.ownerId === user.id).length >= 3) throw err(400, 'You can hold at most three seats in one case.');
  if (st.status === 'lobby') { if (seat.agentId) throw err(409, 'That seat is taken.'); }
  else if (st.status === 'live' || st.status === 'paused') {
    // Late joining: only a house-held seat that has not yet acted. The newcomer inherits the seat's
    // (empty) memory and gets the same role-scoped view the house agent would have had — nothing more.
    if (!seat.house) throw err(409, 'That seat is held by another participant.');
    if (sim.events.some((e) => e.actor?.seatId === seatId)) throw err(409, 'That seat has already taken part; it can no longer change hands.');
    sim.emit('system', { text: `${agent.name} takes over the seat of ${sim.seatDef(seatId).title} before its first appearance.`, ms: 2500 });
  } else throw err(409, 'This case is over.');
  Object.assign(seat, { agentId, ownerId: user.id, house: false, ready: st.status !== 'lobby', failures: 0, joinedAt: new Date().toISOString() });
  sim.agents[seatId] = agent;
  sim.emit('joined', { text: `${agent.name} takes the seat: ${sim.seatDef(seatId).title}.`, data: { seatId, agentId }, ms: 0 });
  await sim.save();
}
export async function leave(sim: Sim, seatId: string, user: PublicUser) {
  const seat = sim.st.seats[seatId];
  if (!seat?.agentId || (seat.ownerId !== user.id && !isHost(sim, user))) throw err(403, 'Not your seat.');
  if (sim.st.status !== 'lobby') {
    // Mid-case departure: a house agent steps in so the proceeding is never left without a required role.
    const sub = await pickHouse(sim, seatId);
    Object.assign(seat, { agentId: sub.id, ownerId: null, house: true, ready: true, failures: 0 });
    sim.agents[seatId] = sub;
    sim.emit('system', { text: `${sim.seatDef(seatId).title}: the participant has withdrawn; ${sub.name} (house) continues in the role.`, ms: 2500 });
  } else { Object.assign(seat, { agentId: null, ownerId: null, ready: false, house: false }); delete sim.agents[seatId]; sim.emit('left', { data: { seatId }, ms: 0 }); }
  await sim.save();
}
export async function setReady(sim: Sim, seatId: string, user: PublicUser, ready: boolean) {
  const seat = sim.st.seats[seatId];
  if (!seat?.agentId || seat.ownerId !== user.id) throw err(403, 'Not your seat.');
  if (ready) {   // readiness check: the agent must exist and, if it thinks with an external model, its key must decrypt
    const a = await getAgent(seat.agentId);
    if (!a) throw err(400, 'That agent no longer exists.');
    if (a.model.provider !== 'house' && !(await credentialSecret(a.ownerId, a.model.credentialId))) throw err(400, 'This agent\'s API key is missing. Add a key or switch the agent to the house model.');
    sim.agents[seatId] = a;
  }
  seat.ready = ready;
  sim.emit('ready', { data: { seatId, ready }, ms: 0 });
  await sim.save();
  if (Object.values(sim.st.seats).every((s) => s.agentId && s.ready) && sim.st.status === 'lobby') await start(sim, null);
}
async function pickHouse(sim: Sim, seatId: string): Promise<AgentProfile> {
  const role = sim.role(seatId), used = new Set(Object.values(sim.st.seats).map((s) => s.agentId));
  const pool = (await listAgents()).filter((a) => a.house && !used.has(a.id));
  const fit = pool.filter((a) => suits(a, role));
  const list = fit.length ? fit : pool;
  if (!list.length) throw err(500, 'No house agent available.');
  // Cast seats prefer the actor whose temperament matches the character; otherwise pick at random.
  const ch = sim.seatDef(seatId).characterId, want = ch ? ({ mara: 'controlled', theo: 'nervous', gideon: 'expansive', nell: 'plain', ivo: 'chatty' } as any)[ch] : null;
  return list.find((a) => want && a.style === want) || list[Math.floor(Math.random() * list.length)];
}
export async function fillHouse(sim: Sim, user: PublicUser | null) {
  if (user && !isHost(sim, user)) throw err(403, 'Only the host can seat house agents.');
  if (sim.st.status !== 'lobby') throw err(409, 'The case has already started.');
  for (const [id, seat] of Object.entries(sim.st.seats)) if (!seat.agentId) {
    const a = await pickHouse(sim, id);
    Object.assign(seat, { agentId: a.id, ownerId: null, house: true, ready: true, joinedAt: new Date().toISOString() });
    sim.agents[id] = a;
  }
  sim.emit('ready', { data: { house: true }, ms: 0 });
  await sim.save();
}
export async function start(sim: Sim, user: PublicUser | null) {
  if (user && !isHost(sim, user)) throw err(403, 'Only the host can start the case.');
  if (sim.st.status !== 'lobby') throw err(409, 'Already started.');
  const missing = sim.b.def.seats.filter((d) => d.required && !(sim.st.seats[d.id].agentId && sim.st.seats[d.id].ready));
  if (missing.length) throw err(400, `Cannot start: ${missing.map((m) => m.title).join(', ')} ${missing.length > 1 ? 'are' : 'is'} not seated and ready.`);
  await loadAgents(sim);
  startCase(sim);
  await sim.save();
  run(sim);
}
export async function control(sim: Sim, user: PublicUser, action: string, value?: number) {
  if (!isHost(sim, user)) throw err(403, 'Host or admin only.');
  const st = sim.st;
  if (action === 'pause' && st.status === 'live') { st.status = 'paused'; sim.emit('system', { text: 'The proceeding is paused.', ms: 0 }); }
  else if (action === 'resume' && st.status === 'paused') { st.status = 'live'; sim.emit('system', { text: 'The proceeding resumes.', ms: 0 }); }
  else if (action === 'abort' && st.status !== 'finished') { st.status = 'aborted'; st.finishedAt = new Date().toISOString(); sim.emit('system', { text: 'The case was closed by an administrator.', ms: 0 }); }
  else if (action === 'speed') st.speed = Math.max(0, Math.min(3, Number(value)));
  else throw err(400, 'Nothing to do.');
  await sim.save();
  if (st.status === 'live') run(sim);
}
/** An owner "reconnects" an agent whose provider failed: closes the circuit breaker so its own model resumes. */
export async function reconnect(sim: Sim, seatId: string, user: PublicUser) {
  const seat = sim.st.seats[seatId];
  if (!seat || seat.ownerId !== user.id) throw err(403, 'Not your seat.');
  seat.failures = 0; const a = await getAgent(seat.agentId!); if (a) sim.agents[seatId] = a;
  sim.emit('system', { text: `${sim.agents[seatId].name} is back on its own model.`, ms: 0 });
  await sim.save();
}

// ---------- the run loop ----------
async function step(sim: Sim, turn: Turn): Promise<void> {
  const seat = turn.seat, spec = describe(sim, turn);
  const view = buildView(sim, turn, spec.instruction, spec.options, spec.context);
  let { decision, source, error } = await decide(sim, seat, view);
  if (error) sim.emit('system', { text: `${sim.agents[seat].name}'s model did not respond; the house reasoner covers this turn.`, data: { seatId: seat, error }, ms: 0 });
  if (sim.st.seats[seat].failures === 3) sim.emit('system', { text: `${sim.agents[seat].name} has lost its model connection. The house reasoner holds the seat until the owner reconnects.`, data: { seatId: seat, takeover: true }, ms: 2500 });
  const attempts: (() => Promise<AgentDecision | null>)[] = [
    async () => decision,
    async () => (source === 'llm' ? (await decide(sim, seat, view, lastError)).decision : null),   // one corrective retry
    async () => heuristicDecide(view),
    async () => safeDefault(sim, turn),
  ];
  let lastError = '';
  for (const get of attempts) {
    const d = await get(); if (!d) continue;
    const undo = sim.checkpoint();
    try { apply(sim, turn, d); return; }
    catch (e: any) {
      undo();
      if (!(e instanceof RuleError)) throw e;
      lastError = e.message;
    }
  }
  throw new Error(`no valid action for ${seat}/${turn.purpose}: ${lastError}`);
}

export async function run(sim: Sim) {
  if (running.has(sim.id)) return;
  running.add(sim.id);
  try {
    while (sim.st.status === 'live') {
      const turn = nextTurn(sim);
      if (sim.hasFresh()) { const ms = sim.freshMs(); await sim.save(); await pace(sim, ms); }
      if (!turn) { await sim.save(); await commitResults(sim); break; }
      await step(sim, turn);
      const ms = sim.freshMs();
      await sim.save();
      await pace(sim, ms);
    }
  } catch (e: any) {
    console.error(`[run ${sim.id}]`, e);
    sim.st.status = 'paused'; sim.st.error = String(e?.message || e).slice(0, 300);
    sim.emit('system', { text: 'The proceeding hit an internal error and is paused. An administrator can resume it.', ms: 0 });
    await sim.save().catch(() => {});
  } finally { running.delete(sim.id); }
}
async function pace(sim: Sim, ms: number) {
  const wait = Math.min(16000, ms * sim.st.speed);
  if (wait > 0) await sleep(wait);
}

/** Boot-time recovery: every case that was live when the process died picks up from its last snapshot. */
export async function recover() {
  let n = 0;
  for (const sim of await allSims()) {
    if (sim.st.status === 'live') { n++; sim.emit('system', { text: 'The proceeding resumes after an interruption.', ms: 0 }); run(sim); }
    if (sim.st.status === 'finished' && !(sim.st as any).committed) await commitResults(sim);
  }
  return n;
}
/** Start lobbies whose scheduled time has come, seating house agents in any empty chair. */
export function startScheduler() {
  setInterval(async () => {
    for (const sim of sims.values()) if (sim.st.status === 'lobby' && sim.st.scheduledFor && Date.parse(sim.st.scheduledFor) <= Date.now()) {
      try { await fillHouse(sim, null); for (const s of Object.values(sim.st.seats)) s.ready = true; await start(sim, null); } catch (e) { console.error('[scheduler]', e); sim.st.scheduledFor = undefined; }
    }
  }, 5000).unref();
}
export const isRunning = (id: string) => running.has(id);
export { writeJson };
