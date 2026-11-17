// Assembles and validates an authored case from its JSON files (web/public/data/cases/<id>/).
// Isomorphic: the browser fetches the files, the Node scripts read them from disk; both call buildBundle.
import type { CaseDef, CharacterDef, EvidenceDef, FactDef, LeadDef, TruthDef, AnalysisDef } from '../shared/types.ts';

export interface CaseBundle {
  def: CaseDef; characters: Record<string, CharacterDef>; facts: Record<string, FactDef>;
  evidence: Record<string, EvidenceDef>; leads: Record<string, LeadDef>; truth: TruthDef;
  analyses: Record<string, AnalysisDef & { evidenceId: string }>;
}

const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>;

export const CASE_FILES = ['case.json', 'characters.json', 'facts.json', 'evidence.json', 'leads.json', 'truth.json'] as const;
export type RawCase = Record<(typeof CASE_FILES)[number], any>;

export function buildBundle(raw: RawCase): CaseBundle {
  const b: CaseBundle = {
    def: raw['case.json'], characters: byId(raw['characters.json']), facts: byId(raw['facts.json']),
    evidence: byId(raw['evidence.json']), leads: byId(raw['leads.json']), truth: raw['truth.json'], analyses: {},
  };
  for (const e of Object.values(b.evidence)) for (const a of e.analyses) b.analyses[a.id] = { ...a, evidenceId: e.id };
  validate(b);
  return b;
}

/** Referential integrity of an authored case. Throws with every problem found. */
function validate(b: CaseBundle) {
  const errs: string[] = [];
  const known = (id: string) => !!(b.evidence[id] || b.facts[id] || b.analyses[id] || b.leads[id]);
  const chk = (ids: string[] | undefined, where: string) => (ids || []).forEach((i) => { if (!known(i)) errs.push(`${where}: unknown id ${i}`); });
  for (const s of b.def.seats) if (s.characterId && (!b.characters[s.characterId] || s.characterId !== s.id)) errs.push(`seat ${s.id}: cast seats must use the character id as seat id`);
  if (!b.characters[b.truth.culprit]) errs.push('truth.culprit is not a character');
  for (const f of Object.values(b.facts)) {
    for (const [c, k] of Object.entries(f.knownBy)) { if (!b.characters[c]) errs.push(`${f.id}: unknown knower ${c}`); chk(k.yieldsTo, f.id); if (k.stance !== 'open' && !k.cover) errs.push(`${f.id}: ${c} needs a cover line`); }
    chk(f.contradictedBy, f.id); chk(f.unlocks, f.id);
    for (const p of f.points || []) if (!b.characters[p.suspect]) errs.push(`${f.id}: unknown suspect ${p.suspect}`);
  }
  for (const e of Object.values(b.evidence)) { chk(e.relatedTo, e.id); for (const a of e.analyses) { chk(a.yieldsFacts, a.id); chk(a.yieldsEvidence, a.id); } }
  for (const l of Object.values(b.leads)) { chk(l.requires?.all, l.id); chk(l.requires?.any, l.id); chk(l.yields.evidence, l.id); chk(l.yields.facts, l.id); chk(l.warrantBasis, l.id); }
  const reachable = new Set(Object.values(b.leads).flatMap((l) => l.yields.evidence || []));
  for (const e of Object.keys(b.evidence)) if (!reachable.has(e)) errs.push(`${e}: no lead yields this evidence`);
  if (errs.length) throw new Error(`case ${b.def.id} invalid:\n  ` + errs.join('\n  '));
}

/** Everything about a case that is safe to show anyone before it starts. */
export function publicCase(b: CaseBundle) {
  const d = b.def;
  return {
    id: d.id, title: d.title, tagline: d.tagline, type: d.type, difficulty: d.difficulty, setting: d.setting, briefing: d.briefing,
    victim: d.victim, seats: d.seats, estimatedMinutes: d.estimatedMinutes, crimeScene: d.crimeScene, standard: d.procedure.standard,
    charges: d.charges.map((c) => ({ id: c.id, label: c.label })),
    characters: Object.values(b.characters).map((c) => ({ id: c.id, name: c.name, age: c.age, occupation: c.occupation, kind: c.kind, publicProfile: c.publicProfile, look: c.look })),
    evidenceCount: Object.keys(b.evidence).length,
  };
}
