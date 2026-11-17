// LLM plumbing against a local fake OpenAI-compatible provider: prompt -> JSON action -> validation,
// plus failover to the local reasoner when the provider breaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';





let mode: 'ok' | 'garbage' | 'down' = 'ok', calls = 0, sawKey = '';
const prompts: any[] = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    calls++; sawKey = String(req.headers.authorization || '');
    if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
    const j = JSON.parse(body), user = JSON.parse(j.messages[1].content); prompts.push(user);
    const opts = user.your_turn.allowed_actions;
    // A deliberately simple "model": speak if possible, else take the first option with its first choice.
    const o = opts.find((x: any) => x.type === 'speak') || opts[0];
    const action: any = { type: o.type, text: `As ${user.data.case.title} detective I note the facts carefully.` };
    for (const [k, list] of Object.entries(o.choices || {})) action[k] = (list as any[])[0]?.id;
    const content = mode === 'garbage' ? 'certainly! the answer is the butler' : JSON.stringify({ thought: 'reasoning', action });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;

const { loadCase, loadRoster } = await import('../scripts/disk.ts');
const { createSession, seat, fillHouse, begin, run } = await import('../core/runner.ts');
const { emptyStats } = await import('../core/referee.ts');
const { config } = await import('../core/config.ts');
config.llmTimeoutMs = 3000;
const roster = loadRoster().map((a) => ({ ...a, stats: emptyStats() }));
const agent: any = { id: 'ag_remote', ownerId: 'u_test', house: false, name: 'Remote Mind', tagline: '', preferredRoles: ['detective'], personality: 'Careful.', background: '', style: 'measured', traits: { rigor: 0.8, aggression: 0.3, skepticism: 0.7, drama: 0.2, empathy: 0.5, humor: 0.1 }, instructions: '', model: { provider: 'openai-compatible', model: 'fake', baseUrl: `http://127.0.0.1:${port}/v1`, credentialId: 'k1' }, look: { skin: '#d9a37e', hair: '#222222', hairStyle: 'short', accent: '#334455' }, listed: false, stats: emptyStats() };
// The host resolves an agent's key; in the browser this reads the user's local key store.
const resolve = (_s: any, _seat: string, a: any) => (a.model.provider === 'house' ? null : { provider: a.model.provider, model: a.model.model, apiKey: 'sk-fake-key-123456', baseUrl: a.model.baseUrl });

async function play(m: typeof mode) {
  mode = m; calls = 0;
  const sim = createSession(loadCase('meridian'), { speed: 0 });
  seat(sim, 'detective', agent, 'u_test'); fillHouse(sim, roster); begin(sim);
  await run(sim, { resolve });
  return sim;
}

test('an LLM-backed agent receives a role-scoped prompt and its actions drive the case', async () => {
  const sim = await play('ok');
  assert.equal(sim.st.status, 'finished');
  assert.ok(calls > 3, 'provider was called');
  assert.equal(sawKey, 'Bearer sk-fake-key-123456', 'decrypted key sent only to the provider');
  assert.ok(prompts.every((p) => !JSON.stringify(p).includes('pushed Elias Voss over the upper gantry rail')), 'truth never sent to a model');
  assert.ok(sim.events.some((e) => e.actor?.seatId === 'detective' && e.text?.includes('detective I note the facts')), 'model text reached the record');
});

test('garbage output falls back to the local reasoner; a dead provider trips the breaker', async () => {
  const g = await play('garbage');
  assert.equal(g.st.status, 'finished', 'case survives unparseable model output');
  const d = await play('down');
  assert.equal(d.st.status, 'finished', 'case survives a dead provider');
  assert.ok(d.events.some((e) => e.data?.takeover), 'owner was told the house reasoner took over');
  assert.ok(calls < 20, `breaker stopped hammering the provider (calls=${calls})`);
  server.close();
});
