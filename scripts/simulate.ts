// Headless run of a complete case with house agents, as fast as the engine allows.
//   npm run simulate -- [caseId] [--runs N] [--verbose] [--detective house_marlowe] [--prosecutor house_brandt]
// Uses a throwaway data dir unless IR_DATA_DIR is set, so it never touches the real store.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.IR_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ir-sim-'));
process.env.IR_SPEED = '0';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] ?? 'true' : undefined; };
const caseId = args[0] && !args[0].startsWith('--') ? args[0] : 'meridian';

const { seedHouseAgents, getAgent } = await import('../server/accounts.ts');
const mgr = await import('../server/manager.ts');
await seedHouseAgents();

const runs = Number(flag('runs') || 1), verbose = !!flag('verbose');
const tally: Record<string, number> = {};
for (let i = 0; i < runs; i++) {
  const sim = await mgr.createSession(caseId, null, { speed: 0 });
  for (const seat of ['detective', 'prosecutor', 'defense', 'judge', 'forensic']) {
    const id = flag(seat); if (!id) continue;
    const a = await getAgent(id); if (!a) throw new Error(`unknown agent ${id}`);
    Object.assign(sim.st.seats[seat], { agentId: a.id, house: true, ready: true }); sim.agents[seat] = a;
  }
  await mgr.fillHouse(sim, null);
  await mgr.start(sim, null);
  while (mgr.isRunning(sim.id)) await new Promise((r) => setTimeout(r, 20));
  const st = sim.st as any;
  if (verbose) for (const e of sim.events) if (e.text && e.type !== 'thought' && e.type !== 'score') console.log(`[${e.phase}/${e.scene}] ${e.type}${e.kind ? ':' + e.kind : ''} ${e.actor ? e.actor.name + ' — ' : ''}${e.text}`);
  const key = `${st.status}: ${st.outcome?.kind} ${st.defendant || '-'} (rec ${st.report?.recommended || '-'}) just=${st.outcome?.correct}`;
  tally[key] = (tally[key] || 0) + 1;
  console.log(`#${i + 1} ${sim.id} ${key} | det=${sim.agents.detective.name} pros=${sim.agents.prosecutor.name} def=${sim.agents.defense.name} | events=${sim.events.length} turns=${st.turn} evidence=${sim.discovered().length} hoursLeft=${st.hoursLeft} votes=${JSON.stringify(st.trial.votes)}${st.error ? ' ERROR ' + st.error : ''}`);
  if (flag('scores')) console.log(Object.entries(st.result?.totals || {}).map(([k, v]: any) => `${k}:${v.total}`).join(' '), '\n', st.result?.awards.map((a: any) => `${a.label}: ${a.name || ''} ${a.reason}`).join('\n '));
}
console.log(tally, '\ndata dir:', process.env.IR_DATA_DIR);
process.exit(0);
