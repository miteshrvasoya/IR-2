// Validates every case folder and the agent roster. Exits non-zero on the first broken file.
import { caseIds, loadCase, loadRoster } from './disk.ts';
for (const id of caseIds()) { const b = loadCase(id); console.log(`case ${id}: ok (${Object.keys(b.evidence).length} exhibits, ${Object.keys(b.leads).length} leads, ${Object.keys(b.facts).length} facts)`); }
const r = loadRoster(); const ids = new Set(r.map((a) => a.id));
if (ids.size !== r.length) throw new Error('duplicate agent id in agents.json');
console.log(`agents: ok (${r.length} house agents)`);
