// Loads and validates authored case definitions (static JSON under data/cases/<id>/).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { readJsonSync } from './store.ts';
import type { CaseDef, CharacterDef, EvidenceDef, FactDef, LeadDef, TruthDef, AnalysisDef } from '../shared/types.ts';

export interface CaseBundle {
  def: CaseDef; characters: Record<string, CharacterDef>; facts: Record<string, FactDef>;
  evidence: Record<string, EvidenceDef>; leads: Record<string, LeadDef>; truth: TruthDef;
  analyses: Record<string, AnalysisDef & { evidenceId: string }>;
}

const cache = new Map<string, CaseBundle>();
const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>;

function load(id: string): CaseBundle {
  const dir = path.join(config.casesDir, id);
  const r = <T>(f: string) => readJsonSync<T>(path.join(dir, f));
  const b: CaseBundle = {
    def: r<CaseDef>('case.json'), characters: byId(r<CharacterDef[]>('characters.json')), facts: byId(r<FactDef[]>('facts.json')),
    evidence: byId(r<EvidenceDef[]>('evidence.json')), leads: byId(r<LeadDef[]>('leads.json')), truth: r<TruthDef>('truth.json'), analyses: {},
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

export function getCase(id: string): CaseBundle {
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('bad case id');
  if (!cache.has(id)) cache.set(id, load(id));
  return cache.get(id)!;
}
export function listCases(): CaseBundle[] {
  return fs.readdirSync(config.casesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => getCase(d.name));
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
