// Sim: the in-memory working copy of one proceeding, always mirrored to its JSON files.
// Nothing here decides anything; it holds state, emits events, and persists.
import { rt, readJson, writeJson, appendEvents, readEvents } from './store.ts';
import { getCase, type CaseBundle } from './caselib.ts';
import type { AgentProfile, EvidenceState, Market, Phase, PredictionEntry, SceneId, ScoreEntry, SessionState, SimEvent, RoleKind, SeatDef } from '../shared/types.ts';

export interface Memory { notes: string[]; theory: { suspect: string | null; confidence: number; summary: string } | null; theoryHistory: { seq: number; suspect: string | null; confidence: number }[]; lastEvidenceCount: number }
export interface Predictions { markets: Market[]; entries: PredictionEntry[]; sus: Record<string, string[]>; settled: boolean }

export class Sim {
  b: CaseBundle;
  st!: SessionState;
  ev: Record<string, EvidenceState> = {};
  scores: ScoreEntry[] = [];
  mem: Record<string, Memory> = {};
  preds: Predictions = { markets: [], entries: [], sus: {}, settled: false };
  events: SimEvent[] = [];
  agents: Record<string, AgentProfile> = {};
  private fresh: SimEvent[] = [];
  onEvents: (evs: SimEvent[]) => void = () => {};

  constructor(public id: string, caseId: string) { this.b = getCase(caseId); }

  dir(...p: string[]) { return rt('sessions', this.id, ...p); }

  static async load(id: string): Promise<Sim> {
    const st = await readJson<SessionState>(rt('sessions', id, 'state.json'));
    const s = new Sim(id, st.caseId);
    s.st = st;
    s.ev = await readJson(s.dir('evidence.json'), {});
    s.scores = await readJson(s.dir('scores.json'), []);
    s.mem = await readJson(s.dir('memory.json'), {});
    s.preds = await readJson(s.dir('predictions.json'), s.preds);
    s.events = await readEvents<SimEvent>(s.dir('events'));
    // Crash recovery: the event log is written before the snapshot. If the snapshot is behind, the
    // interrupted step is simply re-run; events it already logged are dropped so the log stays consistent.
    const last = s.events.length ? s.events[s.events.length - 1].seq : 0;
    if (last > st.seq) { s.events = s.events.filter((e) => e.seq <= st.seq); await s.rewriteEvents(); }
    return s;
  }
  private async rewriteEvents() {
    const { listDir, removeFile } = await import('./store.ts');
    for (const f of await listDir(this.dir('events'))) await removeFile(this.dir('events', f));
    await appendEvents(this.dir('events'), this.events);
  }

  /** Persist everything that changed during a step. Events first (append-only), snapshot last. */
  async save() {
    const fresh = this.fresh; this.fresh = [];
    await appendEvents(this.dir('events'), fresh);
    await Promise.all([
      writeJson(this.dir('evidence.json'), this.ev), writeJson(this.dir('scores.json'), this.scores),
      writeJson(this.dir('memory.json'), this.mem), writeJson(this.dir('predictions.json'), this.preds),
    ]);
    await writeJson(this.dir('state.json'), this.st, true);
    if (fresh.length) this.onEvents(fresh);
  }
  /** Snapshot the working copy so a rejected action can be rolled back without a trace. */
  checkpoint(): () => void {
    const st = structuredClone(this.st), ev = structuredClone(this.ev), mem = structuredClone(this.mem), preds = structuredClone(this.preds);
    const nScores = this.scores.length, nEvents = this.events.length, nFresh = this.fresh.length;
    return () => { this.st = st; this.ev = ev; this.mem = mem; this.preds = preds; this.scores.length = nScores; this.events.length = nEvents; this.fresh.length = nFresh; };
  }
  hasFresh() { return this.fresh.length > 0; }
  freshMs() { return this.fresh.reduce((n, e) => n + (e.ms || 0), 0); }
  savePreds() { return writeJson(this.dir('predictions.json'), this.preds); }

  // ----- deterministic, persisted randomness (so a recovered case continues the same stream) -----
  rand(): number {
    let t = (this.st.rng = (this.st.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ----- lookups -----
  seatDef(seatId: string): SeatDef { return this.b.def.seats.find((s) => s.id === seatId)!; }
  role(seatId: string): RoleKind { return this.seatDef(seatId).role; }
  seatsOf(role: RoleKind): string[] { return this.b.def.seats.filter((s) => s.role === role).map((s) => s.id); }
  /** Display name of whoever sits in a seat: the character for cast roles, the agent otherwise. */
  nameOf(seatId: string): string {
    const d = this.seatDef(seatId);
    if (!d) return seatId;
    return d.characterId ? this.b.characters[d.characterId].name : this.agents[seatId]?.name || d.title;
  }
  charName(id: string | null | undefined) { return id ? this.b.characters[id]?.name || id : 'no one'; }
  actor(seatId: string) { return { seatId, name: this.nameOf(seatId), role: this.role(seatId) }; }
  other(seat: string) { return seat === 'prosecutor' ? 'defense' : 'prosecutor'; }

  /** Is this id (evidence / analysis / fact) currently in the investigators' hands? */
  holds(id: string): boolean {
    if (this.b.evidence[id]) return !!this.ev[id]?.discovered;
    if (this.b.analyses[id]) return this.ev[this.b.analyses[id].evidenceId]?.analyses[id]?.status === 'done';
    if (this.b.facts[id]) return this.st.investigatorFacts.includes(id);
    return false;
  }
  discovered() { return Object.values(this.ev).filter((e) => e.discovered).map((e) => e.id); }
  admitted() { return Object.values(this.ev).filter((e) => e.status === 'admitted').map((e) => e.id); }

  // ----- events -----
  emit(type: string, f: Partial<SimEvent> & { seat?: string } = {}): SimEvent {
    const { seat, ...rest } = f;
    const e: SimEvent = {
      seq: ++this.st.seq, t: new Date().toISOString(), type, phase: this.st.phase, scene: this.st.scene,
      aud: ['all'], vis: 'public', ...(seat ? { actor: this.actor(seat) } : {}), ...rest,
    };
    if (e.text && e.ms === undefined) e.ms = Math.round(Math.max(2600, Math.min(11000, 1500 + e.text.length * 48)));
    this.events.push(e); this.fresh.push(e);
    return e;
  }
  /** Change location. `present` lists the seats physically in the room, for the 3D director. */
  scene(scene: SceneId, present: string[], label?: string) {
    if (this.st.scene === scene && JSON.stringify(this.st.sub?.present) === JSON.stringify(present)) return;
    this.st.scene = scene;
    this.st.sub = { ...(this.st.sub || {}), present };
    this.emit('scene', { data: { scene, present, label }, ms: 2200 });
  }
  score(seatId: string, dim: string, delta: number, reason: string, sealed = false) {
    const entry: ScoreEntry = { seq: this.st.seq + 1, seatId, dim, delta, reason, sealed };
    this.scores.push(entry);
    this.emit('score', { seat: seatId, data: { dim, delta, reason }, vis: sealed ? 'sealed' : 'public', aud: [], ms: 0 });
  }
  remember(seatId: string, note: string) {
    const m = this.memory(seatId);
    m.notes.push(note.slice(0, 300));
    if (m.notes.length > 40) m.notes.splice(0, m.notes.length - 40);
  }
  memory(seatId: string): Memory { return (this.mem[seatId] ||= { notes: [], theory: null, theoryHistory: [], lastEvidenceCount: 0 }); }

  setPhase(p: Phase) {
    this.st.phase = p; this.st.phaseTurns = 0; this.st.passes = 0; this.st.queue = [];
    this.emit('phase', { data: { phase: p }, ms: 2600, highlight: undefined });
  }
}
