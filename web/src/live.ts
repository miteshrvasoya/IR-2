// Runs proceedings inside the browser with the shared engine, persisting each one as a JSON document
// in local storage after every step, and resuming it after a reload.
import { Sim } from '../../core/sim';
import { createSession, seat, fillHouse, begin, run, type TargetResolver } from '../../core/runner';
import { applyCareer, applyPredictions } from '../../core/referee';
import { PHASES, type AgentProfile, type SimEvent } from '../../shared/types';
import { loadBundle, houseAgents } from './data';
import * as local from './local';

const running = new Map<string, LiveCase>();

/** Users' own agents may think with their own model; the key goes straight from this browser to the provider. */
const resolve: TargetResolver = (_sim, _seat, a: AgentProfile) => {
  if (a.model.provider === 'house') return null;
  const key = local.keySecret(a.model.credentialId);
  return key ? { provider: a.model.provider as any, model: a.model.model || (a.model.provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-4o'), apiKey: key, baseUrl: a.model.baseUrl } : null;
};

export class LiveCase {
  private subs = new Set<(evs: SimEvent[]) => void>();
  private lastWrite = 0; private stop = false; private loop: Promise<void> | null = null;
  private constructor(public sim: Sim) {
    sim.onSave = (s, fresh) => {
      if (fresh.length) for (const f of this.subs) f(fresh);
      const now = Date.now();
      if (now - this.lastWrite > 1500 || s.st.status !== 'live') { this.lastWrite = now; this.persist(); }
      if (s.st.status === 'finished') this.commit();
    };
  }
  persist() { local.saveSession(this.sim.toDoc()); }

  static async create(caseId: string, picks: Record<string, string>): Promise<LiveCase> {
    const b = await loadBundle(caseId), house = await houseAgents(), mine = local.myAgents(), me = local.profile();
    const sim = createSession(b, { hostId: me.id });
    for (const [s, agentId] of Object.entries(picks)) {
      const a = mine.find((x) => x.id === agentId) || house.find((x) => x.id === agentId);
      if (a) seat(sim, s, a, a.house ? null : me.id);
    }
    fillHouse(sim, house);
    const lc = new LiveCase(sim); lc.persist(); running.set(sim.id, lc);
    return lc;
  }
  /** Get the running case, or resume a saved one (e.g. after a page reload). */
  static async open(id: string): Promise<LiveCase | null> {
    if (running.has(id)) return running.get(id)!;
    const doc = local.loadSession(id); if (!doc) return null;
    const lc = new LiveCase(Sim.fromDoc(doc, await loadBundle(doc.state.caseId)));
    running.set(id, lc);
    if (lc.sim.st.status === 'live') { lc.sim.emit('system', { text: 'The proceeding resumes after an interruption.', ms: 0 }); lc.start(); }
    return lc;
  }
  start() {
    if (this.sim.st.status === 'lobby') begin(this.sim);
    if (this.loop) return;
    this.stop = false;
    this.loop = run(this.sim, { resolve, pace: true, shouldStop: () => this.stop }).finally(() => { this.loop = null; this.persist(); });
  }
  pause() { if (this.sim.st.status === 'live') { this.sim.st.status = 'paused'; this.sim.emit('system', { text: 'The proceeding is paused.', ms: 0 }); this.stop = true; this.sim.save(); } }
  resume() { if (this.sim.st.status === 'paused') { this.sim.st.status = 'live'; this.sim.st.error = undefined; this.sim.emit('system', { text: 'The proceeding resumes.', ms: 0 }); this.start(); } }
  setSpeed(v: number) { this.sim.st.speed = Math.max(0, Math.min(3, v)); }
  reconnect(seatId: string) { this.sim.st.seats[seatId].failures = 0; }
  subscribe(f: (evs: SimEvent[]) => void) { this.subs.add(f); return () => this.subs.delete(f); }

  /** Fold the finished case into the user's own agents' careers, exactly once. */
  private commit() {
    const st = this.sim.st as any; if (st.committed) return;
    st.committed = true;
    const me = local.profile().id;
    for (const s of Object.keys(st.seats)) if (st.seats[s].ownerId === me) local.updateAgentStats(st.seats[s].agentId, (stats) => applyCareer(this.sim, s, stats));
    this.persist();
  }
}

/** Settle a viewer's predictions for a recording or proceeding once its reveal has been watched. */
export function settlePredictions(id: string, markets: any[], answers: Record<string, string>) {
  const p = local.loadPreds(id); if (p.settled) return p.settled;
  if (!p.picks.length) { local.savePreds(id, { ...p, settled: { right: 0, gain: 0 } }); return null; }   // seen the ending: betting is over
  let result = { right: 0, gain: 0 };
  local.updateProfile((u) => { result = applyPredictions(u, p.picks, markets, answers); });
  local.savePreds(id, { ...p, settled: result });
  return result;
}
export const earlyPhase = (phase: string) => PHASES.indexOf(phase as any) <= PHASES.indexOf('investigation');
