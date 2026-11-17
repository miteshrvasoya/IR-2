// Information barriers. Every agent decision is made from an AgentView built here, and every byte sent
// to a browser passes through a public projection defined here. The sealed truth (truth.json, undiscovered
// evidence, other characters' secrets, numeric weights) never enters either.
import type { Sim } from './sim.ts';
import type { ActionOption, EvidenceView, Inference, Phase, RoleKind, SimEvent, Turn } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';

const STRENGTH = ['weak', 'weak', 'moderate', 'strong'] as const;
const label = (p: Inference) => ({ suspect: p.suspect, element: p.element, note: p.note, exculpatory: p.exculpatory, strength: STRENGTH[p.strength] });
export const phaseAtLeast = (p: Phase, min: Phase) => PHASES.indexOf(p) >= PHASES.indexOf(min);

export function evidenceView(sim: Sim, id: string): EvidenceView {
  const d = sim.b.evidence[id], s = sim.ev[id];
  const done = d.analyses.filter((a) => s.analyses[a.id]?.status === 'done');
  return {
    id, title: d.title, type: d.type, description: d.description, source: d.source, collection: d.collection + (s.warrantless ? ' NOTE: seized from a private space WITHOUT a warrant.' : ''),
    location: d.location, discoveredAt: s.discoveredAt, status: s.status, warrantless: s.warrantless, custody: s.custody,
    relevantTo: d.relevantTo, relatedTo: d.relatedTo.filter((r) => sim.ev[r]?.discovered), topics: d.topics,
    points: [...d.points, ...done.flatMap((a) => a.addsPoints || [])].map(label),
    limitations: [...d.limitations, ...done.flatMap((a) => a.addsLimitations || [])].map((l) => ({ id: l.id, ground: l.ground, text: l.text })),
    analyses: d.analyses.map((a) => ({ id: a.id, label: a.label, kind: a.kind, hours: a.hours, status: s.analyses[a.id]?.status === 'done' ? 'done' : s.analyses[a.id] ? 'pending' : 'available', report: s.analyses[a.id]?.status === 'done' ? a.findings : undefined })),
    challenges: s.challenges.map((c) => ({ by: c.by, ground: c.ground, phase: c.phase })),
    disclosedToDefense: s.disclosedToDefense, visual: d.visual,
  };
}

/** Which evidence ids may this seat look at right now? */
export function evidenceFor(sim: Sim, seat: string): string[] {
  const role = sim.role(seat), all = sim.discovered();
  if (role === 'detective' || role === 'forensic' || role === 'prosecutor') return all;
  if (role === 'defense') return all.filter((e) => sim.ev[e].disclosedToDefense);
  if (role === 'judge') return all.filter((e) => ['offered', 'admitted', 'excluded', 'suppressed'].includes(sim.ev[e].status) || sim.st.sub?.motion?.evidenceId === e || sim.st.sub?.warrantBasis?.includes(e));
  if (role === 'juror') return sim.admitted();
  const ch = sim.seatDef(seat).characterId!;
  return all.filter((e) => sim.st.chars[ch].shown.includes(e) || (sim.st.defendant === ch && sim.ev[e].status === 'admitted'));
}

/** May `seat` have witnessed event `e`? Mirrors who was physically or procedurally present. */
export function canSee(sim: Sim, seat: string, e: SimEvent): boolean {
  if (e.vis !== 'public') return e.aud.includes(seat);
  if (e.aud.includes('all') || e.aud.includes(seat)) return true;
  const role = sim.role(seat), ch = sim.seatDef(seat).characterId;
  const isDefendant = !!ch && ch === sim.st.defendant;
  for (const g of e.aud) {
    if (g === 'inv' && (role === 'detective' || role === 'forensic' || role === 'prosecutor' || (role === 'defense' && !!sim.st.defendant))) return true;
    if (g === 'court' && (role === 'judge' || role === 'prosecutor' || role === 'defense' || isDefendant)) return true;
    if (g === 'trial' && (role === 'judge' || role === 'prosecutor' || role === 'defense' || role === 'juror' || isDefendant)) return true;
    if (g === 'jury' && role === 'juror') return true;
  }
  return false;
}

function factView(sim: Sim, id: string) {
  const f = sim.b.facts[id];
  return { id, topic: f.topic, text: f.text, points: (f.points || []).map(label) };
}

/** The trial record as it exists for a given role. Jurors get only what was admitted and not struck. */
export function recordView(sim: Sim, role: RoleKind) {
  const t = sim.st.trial;
  const exhibits = Object.values(sim.ev).filter((e) => role === 'juror' ? e.status === 'admitted' : ['offered', 'admitted', 'excluded', 'suppressed'].includes(e.status)).map((e) => evidenceView(sim, e.id));
  if (role === 'juror') for (const x of exhibits) { x.challenges = sim.ev[x.id].challenges.filter((c) => phaseAtLeast(c.phase, 'opening')).map((c) => ({ by: c.by, ground: c.ground, phase: c.phase })); x.limitations = x.limitations.filter((l) => sim.ev[x.id].challenges.some((c) => c.limitationId === l.id && phaseAtLeast(c.phase, 'opening'))); }
  return {
    charge: sim.b.def.charges.find((c) => c.id === sim.st.charge)?.label || null,
    defendant: sim.st.defendant, defendantName: sim.charName(sim.st.defendant), plea: sim.st.plea,
    exhibits,
    testimony: t.testimony.filter((x) => !x.struck).map((x) => ({ ...factView(sim, x.fact), witness: sim.charName(x.witness), witnessId: x.witness, witnessImpeached: sim.st.chars[x.witness]?.caught.length > 0 && role !== 'juror' ? true : (sim.st.chars[x.witness]?.sworn && sim.st.chars[x.witness]?.caught.length > 0) })),
    witnessesCalled: t.witnessesCalled, rested: t.rested,
    argued: role === 'juror' || role === 'judge' ? t.argued : t.argued,
    votes: role === 'juror' ? t.votes : undefined, round: t.round,
    standard: sim.b.def.procedure.standard,
  };
}

export interface AgentView {
  sessionId: string; caseTitle: string; phase: Phase; scene: string; turn: number;
  me: { seat: string; role: RoleKind; name: string; title: string; agentName: string; personality: string; background: string; style: string; traits: any; instructions: string };
  character?: { id: string; name: string; occupation: string; persona: string; goals: string; isDefendant: boolean; pressure: number; sworn: boolean; knowledge: { factId: string; topic: string; text: string; stance: string; cover?: string; say?: string; firmness: number; yieldsTo: string[]; caught: boolean; revealed: boolean; denied: boolean; testified: boolean }[] };
  purpose: string; instruction: string; context: any; options: ActionOption[];
  briefing: string; victim: any; standard: string;
  cast: { seat: string; name: string; role: RoleKind }[];
  suspects: { id: string; name: string; occupation: string; profile: string }[];
  people: { id: string; name: string; occupation: string; kind: string; profile: string; seat: string }[];
  evidence: EvidenceView[];
  facts: ReturnType<typeof factView>[];
  investigation?: { hoursLeft: number; leadsDone: string[]; pendingLab: string[]; interviews: Record<string, { count: number; denied: string[]; caught: string[]; revealed: string[] }>; warrants: Record<string, string>; report: any };
  record?: ReturnType<typeof recordView>;
  transcript: { seq: number; who: string; role?: string; kind?: string; text: string }[];
  memory: { notes: string[]; theory: any };
  topicLabels: Record<string, string>; told?: Record<string, string[]>;
}

/** Build everything one agent is entitled to know for one decision. */
export function buildView(sim: Sim, turn: Turn, instruction: string, options: ActionOption[], context: any): AgentView {
  const seat = turn.seat, role = sim.role(seat), def = sim.seatDef(seat), ag = sim.agents[seat], st = sim.st;
  const investigator = role === 'detective' || role === 'forensic' || role === 'prosecutor';
  const seesFacts = investigator || (role === 'defense' && !!st.defendant);
  const v: AgentView = {
    sessionId: sim.id, caseTitle: sim.b.def.title, phase: st.phase, scene: st.scene, turn: st.turn,
    me: { seat, role, name: sim.nameOf(seat), title: def.title, agentName: ag.name, personality: ag.personality, background: ag.background, style: ag.style, traits: ag.traits, instructions: ag.instructions },
    purpose: turn.purpose, instruction, context, options,
    briefing: sim.b.def.briefing, victim: sim.b.def.victim, standard: sim.b.def.procedure.standard,
    cast: sim.b.def.seats.map((s) => ({ seat: s.id, name: sim.nameOf(s.id), role: s.role })),
    suspects: Object.values(sim.b.characters).filter((c) => c.kind === 'suspect').map((c) => ({ id: c.id, name: c.name, occupation: c.occupation, profile: c.publicProfile })),
    people: Object.values(sim.b.characters).map((c) => ({ id: c.id, name: c.name, occupation: c.occupation, kind: c.kind, profile: c.publicProfile, seat: c.id })),
    evidence: evidenceFor(sim, seat).map((e) => evidenceView(sim, e)),
    facts: seesFacts ? st.investigatorFacts.map((f) => factView(sim, f)) : [],
    transcript: sim.events.filter((e) => e.text && e.type === 'speech' && canSee(sim, seat, e)).slice(-18).map((e) => ({ seq: e.seq, who: e.actor?.name || 'Court', role: e.actor?.role, kind: e.kind, text: e.text! })),
    memory: { notes: sim.memory(seat).notes.slice(-24), theory: sim.memory(seat).theory },
    topicLabels: {},
  };
  if (seesFacts) v.told = Object.fromEntries(Object.entries(st.chars).map(([id, c]) => [id, c.revealed]));
  if (def.characterId) {
    const c = sim.b.characters[def.characterId], rtc = st.chars[c.id];
    v.character = {
      id: c.id, name: c.name, occupation: c.occupation, persona: c.persona, goals: c.goals, isDefendant: st.defendant === c.id, pressure: Math.round(rtc.pressure * 10) / 10, sworn: !!rtc.sworn,
      knowledge: Object.values(sim.b.facts).filter((f) => f.knownBy[c.id]).map((f) => {
        const k = f.knownBy[c.id];
        return { factId: f.id, topic: f.topic, text: f.text, stance: k.stance, cover: k.cover, say: k.say, firmness: k.firmness ?? 2, yieldsTo: (k.yieldsTo || []).map((y) => sim.b.evidence[y]?.title || sim.b.analyses[y]?.label || 'a witness account'), caught: rtc.caught.includes(f.id), revealed: rtc.revealed.includes(f.id), denied: rtc.denied.includes(f.id), testified: st.trial.testimony.some((x) => x.fact === f.id && x.witness === c.id) };
      }),
    };
  }
  if (investigator || role === 'judge') {
    v.investigation = {
      hoursLeft: st.hoursLeft, leadsDone: st.leadsDone.map((l) => sim.b.leads[l].label), pendingLab: st.jobs.map((j) => sim.b.analyses[j.analysisId].label),
      interviews: investigator ? Object.fromEntries(Object.entries(st.chars).map(([id, c]) => [id, { count: c.interviews, denied: c.denied.map((f) => sim.b.facts[f].topic), caught: c.caught.map((f) => sim.b.facts[f].topic), revealed: c.revealed }])) : {},
      warrants: st.warrants, report: investigator ? st.report : null,
    };
  }
  if (phaseAtLeast(st.phase, 'pretrial') && ['judge', 'prosecutor', 'defense', 'juror'].includes(role)) v.record = recordView(sim, role);
  const topics = new Set([...v.evidence.flatMap((e) => e.topics), ...v.facts.map((f) => f.topic), ...(v.character?.knowledge.map((k) => k.topic) || [])]);
  for (const t of topics) if (sim.b.def.topicLabels?.[t]) v.topicLabels[t] = sim.b.def.topicLabels[t];
  if (role === 'defense' && st.defendant && v.record) (v as any).client = { id: st.defendant, name: sim.charName(st.defendant) };
  return v;
}

// ---------- spectator projections ----------
/** An event as spectators may see it. Sealed events (private thoughts, truth-dependent scores) unlock after the case. */
export function publicEvent(e: SimEvent, finished: boolean): SimEvent | null {
  if (e.vis === 'public') return e;
  return finished ? { ...e, vis: 'public', data: { ...(e.data || {}), wasSealed: true } } : null;
}

export function publicState(sim: Sim) {
  const st = sim.st, finished = st.status === 'finished';
  return {
    id: st.id, caseId: st.caseId, title: st.title, status: st.status, phase: st.phase, scene: st.scene, seq: st.seq,
    hostId: st.hostId, createdAt: st.createdAt, scheduledFor: st.scheduledFor, startedAt: st.startedAt, finishedAt: st.finishedAt,
    hoursLeft: st.hoursLeft, defendant: st.defendant, charge: st.charge, plea: st.plea, speed: st.speed,
    outcome: st.outcome ? (finished ? st.outcome : { ...st.outcome, correct: null }) : null,
    present: st.sub?.present || [],
    seats: sim.b.def.seats.map((d) => {
      const s = st.seats[d.id], a = sim.agents[d.id];
      return { ...d, agentId: s.agentId, ownerId: s.ownerId, ready: s.ready, house: s.house, connected: s.connected,
        name: s.agentId ? sim.nameOf(d.id) : null, agentName: a?.name || null, agentTagline: a?.tagline || null,
        look: d.characterId ? sim.b.characters[d.characterId].look : a?.look || null, llm: a ? a.model.provider !== 'house' : false };
    }),
    chars: Object.fromEntries(Object.entries(st.chars).map(([id, c]) => [id, { credibility: c.credibility, caught: c.caught.length, interviews: c.interviews }])),
    lab: st.jobs.map((j) => ({ evidenceId: j.evidenceId, label: sim.b.analyses[j.analysisId].label })),
  };
}

/** Public scoreboard: sealed (truth-dependent) entries are held back until the case is over. */
export function publicScores(sim: Sim) {
  const finished = sim.st.status === 'finished';
  const out: Record<string, { total: number; dims: Record<string, number>; entries: any[] }> = {};
  for (const e of sim.scores) {
    if (e.sealed && !finished) continue;
    const o = (out[e.seatId] ||= { total: 0, dims: {}, entries: [] });
    o.total += e.delta; o.dims[e.dim] = (o.dims[e.dim] || 0) + e.delta; o.entries.push(e);
  }
  return out;
}
