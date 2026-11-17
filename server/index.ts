import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { sweepTmp } from './store.ts';
import { seedHouseAgents } from './accounts.ts';
import { listCases } from './caselib.ts';
import { registerApi } from './api.ts';
import { recover, startScheduler, allSims, createSession } from './manager.ts';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.secret', 'req.body.password'] }, bodyLimit: 64 * 1024, trustProxy: true });
await app.register(cookie);

fs.mkdirSync(config.runtimeDir, { recursive: true });
const swept = await sweepTmp();
await seedHouseAgents();
const cases = listCases();                          // validates every authored case at boot
registerApi(app);

const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  await app.register(fstatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html')));
}

const resumed = await recover();
// Keep one open lobby per case so there is always something to join.
for (const c of cases) if (!(await allSims()).some((s) => s.st.caseId === c.def.id && s.st.status === 'lobby')) await createSession(c.def.id, null);
startScheduler();

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Interrogation Room API on :${config.port} — ${cases.length} case(s), ${resumed} live case(s) resumed, ${swept} stale temp file(s) swept. House agents think with ${config.houseAnthropicKey ? config.houseModel : 'the local reasoner (set ANTHROPIC_API_KEY for LLM house agents)'}.`);
