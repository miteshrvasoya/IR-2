// Records sample proceedings with the platform's default (house) agents and writes them as static JSON:
//   web/public/data/cases/index.json     manifest of case files
//   web/public/data/runs/<id>.json       one complete recorded proceeding (replayable event log + final state)
//   web/public/data/runs/index.json      manifest of recordings + house agent career stats
// Usage: npm run record                       (the default line-ups below)
//        npm run record -- --dry --runs 20    (just print the outcome distribution; writes nothing)
import fs from 'node:fs';
import path from 'node:path';
import { DATA, caseIds, loadCase, loadRoster, writeJson } from './disk.ts';
import { createSession, seat, fillHouse, begin, run } from '../core/runner.ts';
import { applyCareer, emptyStats } from '../core/referee.ts';
import { publicCase } from '../core/caselib.ts';
import type { AgentStats } from '../shared/types.ts';

const args = process.argv.slice(2), flag = (n: string) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true'; };
const roster = loadRoster(), byId = Object.fromEntries(roster.map((a) => [a.id, a]));

// Each sample pairs a case with a line-up of house professionals; cast seats are filled by the house actors.
const LINEUPS: { caseId: string; seed: number; featured?: boolean; seats: Record<string, string>; blurb: string }[] = [
  { caseId: 'meridian', seed: 101, featured: true, blurb: 'The methodical inspector against the theatrical prosecutor and the precise public defender.', seats: { detective: 'house_reyes', forensic: 'house_okonkwo', prosecutor: 'house_brandt', defense: 'house_achebe', judge: 'house_okafor' } },
  { caseId: 'meridian', seed: 202, blurb: 'A detective who trusts her gut, a prosecutor who trusts the file, and a defense lawyer who objects to everything.', seats: { detective: 'house_marlowe', forensic: 'house_lindqvist', prosecutor: 'house_calloway', defense: 'house_finch', judge: 'house_brannigan' } },
  { caseId: 'meridian', seed: 303, blurb: 'The by-the-book bench: rigorous detective, rigorous prosecutor, and a combative defense.', seats: { detective: 'house_reyes', forensic: 'house_lindqvist', prosecutor: 'house_calloway', defense: 'house_finch', judge: 'house_okafor' } },
  { caseId: 'nightingale', seed: 404, featured: true, blurb: 'Who switched the bird? The inspector follows the records while the defense hunts for doubt.', seats: { detective: 'house_reyes', forensic: 'house_okonkwo', prosecutor: 'house_calloway', defense: 'house_achebe', judge: 'house_okafor' } },
  { caseId: 'nightingale', seed: 505, blurb: 'Instinct versus evidence: an aggressive detective and a showman prosecutor take on the vault.', seats: { detective: 'house_marlowe', forensic: 'house_lindqvist', prosecutor: 'house_brandt', defense: 'house_finch', judge: 'house_brannigan' } },
  { caseId: 'nightingale', seed: 606, blurb: 'A careful prosecution meets the objection machine.', seats: { detective: 'house_marlowe', forensic: 'house_okonkwo', prosecutor: 'house_calloway', defense: 'house_finch', judge: 'house_okafor' } },
];

function mulberry(seed: number) { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

async function record(caseId: string, seed: number, seats: Record<string, string>, id: string) {
  const b = loadCase(caseId), rand = mulberry(seed);
  const sim = createSession(b, { id, seed, speed: 1 });
  for (const [s, a] of Object.entries(seats)) seat(sim, s, byId[a], null);
  fillHouse(sim, roster, rand);
  begin(sim);
  await run(sim);                                   // no pacing: playback timing lives in each event's `ms`
  if (sim.st.status !== 'finished') throw new Error(`${id} did not finish: ${sim.st.error || sim.st.status}`);
  return sim;
}

if (flag('dry')) {
  const n = Number(flag('runs') || 10), tally: Record<string, number> = {};
  for (const c of caseIds()) for (let i = 0; i < n; i++) {
    const lineups = LINEUPS.filter((l) => l.caseId === c), L = lineups[i % lineups.length];
    const sim = await record(c, 1000 + i, L.seats, `dry-${c}-${i}`), o = sim.st.outcome!;
    const k = `${c}: ${o.kind} ${o.defendant || '-'} ${o.correct ? '(just)' : '(unjust)'}`; tally[k] = (tally[k] || 0) + 1;
  }
  console.log(tally); process.exit(0);
}

writeJson('cases/index.json', { cases: caseIds().map((id) => publicCase(loadCase(id))) });
fs.rmSync(path.join(DATA, 'runs'), { recursive: true, force: true });
const stats: Record<string, AgentStats> = {}, index: any[] = [], counters: Record<string, number> = {};
for (const L of LINEUPS) {
  const n = (counters[L.caseId] = (counters[L.caseId] || 0) + 1), id = `${L.caseId}-${String(n).padStart(2, '0')}`;
  const sim = await record(L.caseId, L.seed, L.seats, id);
  const doc = sim.toDoc(), st = sim.st;
  // Private working memory is not needed to replay a case; everything else is kept.
  writeJson(`runs/${id}.json`, { ...doc, memory: {}, meta: { id, caseId: L.caseId, blurb: L.blurb, featured: !!L.featured, recordedAt: new Date().toISOString() } });
  for (const s of Object.keys(st.seats)) { const a = st.seats[s].agentId!; applyCareer(sim, s, (stats[a] ||= emptyStats()), st.finishedAt); }
  index.push({
    id, caseId: L.caseId, title: st.title, blurb: L.blurb, featured: !!L.featured, outcome: st.outcome, defendant: st.defendant, events: sim.events.length,
    durationMs: sim.events.reduce((t, e) => t + (e.ms || 0), 0), cast: ['detective', 'prosecutor', 'defense', 'judge'].map((s) => ({ role: s, name: sim.agents[s].name, agentId: sim.agents[s].id })),
  });
  console.log(`${id}: ${st.outcome!.text} [${st.outcome!.correct ? 'justice' : 'miscarriage'}] — ${sim.events.length} events`);
}
writeJson('runs/index.json', { generatedAt: new Date().toISOString(), runs: index, agentStats: stats });
console.log(`wrote ${index.length} recordings to ${path.relative(process.cwd(), path.join(DATA, 'runs'))}`);
