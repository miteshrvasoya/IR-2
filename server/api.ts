// HTTP API. Every response is built from public projections; nothing here can reach truth.json,
// private memories, or credential plaintext.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as acc from './accounts.ts';
import * as mgr from './manager.ts';
import { listCases, getCase, publicCase } from './caselib.ts';
import { publicState, publicScores, publicEvent, evidenceView, phaseAtLeast } from './views.ts';
import { assertSafeUrl } from './brains/llm.ts';
import type { Sim } from './sim.ts';
import type { PublicUser, SimEvent } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';

type U = PublicUser & { guest: boolean };
const COOKIE = 'ir_session';
const bad = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// tiny fixed-window rate limiter (per client address)
const hits = new Map<string, { n: number; t: number }>();
function limited(key: string, max: number, windowMs = 10000) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 60000) hits.delete(k); }, 60000).unref();

export function registerApi(app: FastifyInstance) {
  const user = async (req: FastifyRequest): Promise<U | null> => acc.userFromToken((req as any).cookies?.[COOKIE]) as Promise<U | null>;
  const need = async (req: FastifyRequest, member = false): Promise<U> => {
    const u = await user(req);
    if (!u) throw bad(401, 'Sign in first.');
    if (member && u.guest) throw bad(403, 'Create an account to do that.');
    return u;
  };
  const setCookie = (reply: any, token: string) => reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400, secure: process.env.NODE_ENV === 'production' && process.env.IR_INSECURE_COOKIE !== '1' });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const write = req.method !== 'GET';
    if (limited(`${req.ip}:${write ? 'w' : 'r'}`, write ? 40 : 240)) return reply.code(429).send({ error: 'Slow down.' });
  });
  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: e.issues.map((i) => i.message).join(' ') });
    const status = e.status || e.statusCode || 500;
    if (status >= 500) app.log.error(e);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong.' : e.message });
  });

  // ----- auth -----
  app.post('/api/auth/register', async (req, reply) => { const c = acc.Credentials.parse(req.body); const u = await acc.register(c.handle, c.password); setCookie(reply, await acc.openSession(u.id)); return u; });
  app.post('/api/auth/login', async (req, reply) => { if (limited(`login:${req.ip}`, 8, 60000)) throw bad(429, 'Too many attempts. Wait a minute.'); const c = acc.Credentials.parse(req.body); const u = await acc.login(c.handle, c.password); setCookie(reply, await acc.openSession(u.id)); return u; });
  app.post('/api/auth/guest', async (req, reply) => { const cur = await user(req); if (cur) return cur; if (limited(`guest:${req.ip}`, 5, 60000)) throw bad(429, 'Too many guests from here.'); const u = await acc.guest(); setCookie(reply, await acc.openSession(u.id)); return u; });
  app.post('/api/auth/logout', async (req, reply) => { const t = (req as any).cookies?.[COOKIE]; if (t) await acc.closeSession(t); reply.clearCookie(COOKIE, { path: '/' }); return { ok: true }; });
  app.get('/api/me', async (req) => ({ user: await user(req) }));

  // ----- credentials (write-only secrets) -----
  const Cred = z.object({ provider: z.enum(['anthropic', 'openai-compatible']), label: z.string().trim().max(40).default(''), secret: z.string().trim().min(8).max(400) });
  app.get('/api/credentials', async (req) => acc.listCredentials((await need(req, true)).id));
  app.post('/api/credentials', async (req) => { const u = await need(req, true), c = Cred.parse(req.body); if ((await acc.listCredentials(u.id)).length >= 8) throw bad(400, 'Key limit reached (8).'); return acc.saveCredential(u.id, c.provider, c.label, c.secret); });
  app.put('/api/credentials/:id', async (req: any) => { const u = await need(req, true), c = z.object({ secret: z.string().trim().min(8).max(400), label: z.string().trim().max(40).optional() }).parse(req.body); return acc.saveCredential(u.id, '', c.label || '', c.secret, req.params.id); });
  app.delete('/api/credentials/:id', async (req: any) => { await acc.deleteCredential((await need(req, true)).id, req.params.id); return { ok: true }; });

  // ----- agents -----
  app.get('/api/agents', async (req) => { const u = await user(req); return (await acc.listAgents()).filter((a) => a.listed || a.ownerId === u?.id).map((a) => acc.publicAgent(a, u?.id)).sort((a, b) => b.stats.rating - a.stats.rating); });
  app.get('/api/agents/:id', async (req: any) => { const a = await acc.getAgent(req.params.id), u = await user(req); if (!a || (!a.listed && a.ownerId !== u?.id)) throw bad(404, 'Agent not found.'); return acc.publicAgent(a, u?.id); });
  const saveAgent = async (req: any, id?: string) => { const u = await need(req, true), input = acc.AgentInput.parse(req.body); if (input.model.baseUrl) await assertSafeUrl(input.model.baseUrl).catch((e) => { throw bad(400, `Model endpoint rejected: ${e.message}`); }); return acc.publicAgent(await acc.saveAgent(u.id, input, id), u.id); };
  app.post('/api/agents', (req) => saveAgent(req));
  app.put('/api/agents/:id', (req: any) => saveAgent(req, req.params.id));
  app.delete('/api/agents/:id', async (req: any) => { const u = await need(req, true); await acc.deleteAgent(u.id, req.params.id, u.admin); return { ok: true }; });
  // Adopting copies a marketplace agent's public persona into your library; it never copies keys or private instructions.
  app.post('/api/agents/:id/adopt', async (req: any) => {
    const u = await need(req, true), src = await acc.getAgent(req.params.id);
    if (!src || !src.listed) throw bad(404, 'Agent not found.');
    const { name, tagline, preferredRoles, personality, background, style, traits, look } = src;
    return acc.publicAgent(await acc.saveAgent(u.id, { name: `${name}`.slice(0, 40), tagline, preferredRoles, personality, background, style, traits, look, instructions: '', model: { provider: 'house' }, listed: false } as any), u.id);
  });

  // ----- cases & sessions -----
  app.get('/api/cases', async () => listCases().map(publicCase));
  const summary = (sim: Sim) => { const s = publicState(sim); return { id: s.id, caseId: s.caseId, title: s.title, status: s.status, phase: s.phase, createdAt: s.createdAt, scheduledFor: s.scheduledFor, startedAt: s.startedAt, finishedAt: s.finishedAt, outcome: s.outcome, defendant: s.defendant, seatsTotal: s.seats.length, seatsFilled: s.seats.filter((x) => x.agentId).length, openSeats: s.seats.filter((x) => !x.agentId).map((x) => x.title), watchers: mgr.watchers(s.id), tagline: sim.b.def.tagline, type: sim.b.def.type, cast: s.seats.filter((x) => x.agentId && !x.characterId).slice(0, 5).map((x) => ({ role: x.role, name: x.agentName })) }; };
  app.get('/api/sessions', async () => (await mgr.allSims()).filter((s) => s.st.status !== 'aborted').map(summary));
  app.post('/api/sessions', async (req) => {
    const u = await need(req, true), b = z.object({ caseId: z.string(), scheduledFor: z.string().datetime().optional() }).parse(req.body);
    getCase(b.caseId);
    const mine = (await mgr.allSims()).filter((s) => s.st.hostId === u.id && ['lobby', 'live', 'paused'].includes(s.st.status));
    if (mine.length >= 3 && !u.admin) throw bad(400, 'You already host three open cases.');
    return summary(await mgr.createSession(b.caseId, u, { scheduledFor: b.scheduledFor }));
  });

  const detail = async (sim: Sim, u: U | null) => {
    const st = sim.st, finished = st.status === 'finished';
    const mySeats = u ? Object.values(st.seats).filter((s) => s.ownerId === u.id).map((s) => s.seatId) : [];
    return {
      state: publicState(sim), case: publicCase(sim.b), scores: publicScores(sim),
      evidence: sim.discovered().map((e) => evidenceView(sim, e)),
      facts: phaseAtLeast(st.phase, 'investigation') ? st.investigatorFacts.map((f) => ({ id: f, topic: sim.b.facts[f].topic, text: sim.b.facts[f].text })) : [],
      markets: sim.preds.markets.map((m) => ({ ...m, answer: finished ? m.answer : undefined, picks: Object.fromEntries(m.options.map((o) => [o.id, sim.preds.entries.filter((p) => p.marketId === m.id && p.choice === o.id).length])) })),
      myPredictions: u ? sim.preds.entries.filter((p) => p.userId === u.id).map((p) => (finished ? p : { ...p, won: undefined, awarded: undefined })) : [],
      sus: Object.fromEntries(Object.entries(sim.preds.sus).map(([k, v]) => [k, v.length])),
      mySeats, canPredict: !!u && mySeats.length === 0, isHost: !!u && (u.admin || st.hostId === u.id),
      result: finished ? (st as any).result : null, watchers: mgr.watchers(sim.id), error: u?.admin ? st.error : undefined,
    };
  };
  app.get('/api/sessions/:id', async (req: any) => detail(await mgr.getSim(req.params.id), await user(req)));
  app.get('/api/sessions/:id/events', async (req: any) => {
    const sim = await mgr.getSim(req.params.id), after = Number(req.query.after || 0), fin = sim.st.status === 'finished';
    return sim.events.filter((e) => e.seq > after).map((e) => publicEvent(e, fin)).filter(Boolean);
  });
  // Live stream (Server-Sent Events). Reconnecting clients resume from Last-Event-ID, so nothing is missed.
  app.get('/api/sessions/:id/stream', async (req: any, reply) => {
    const sim = await mgr.getSim(req.params.id);
    let last = Number(req.headers['last-event-id'] || req.query.after || 0);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (evs: SimEvent[]) => { for (const e of evs) if (e.seq > last) { last = e.seq; res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`); } };
    send(sim.events.filter((e) => e.seq > last).map((e) => publicEvent(e, sim.st.status === 'finished')).filter(Boolean) as SimEvent[]);
    const off = mgr.subscribe(sim.id, send);
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { off(); clearInterval(beat); });
  });

  const seatBody = z.object({ seatId: z.string().max(40), agentId: z.string().max(40).optional() });
  app.post('/api/sessions/:id/join', async (req: any) => { const u = await need(req, true), b = seatBody.parse(req.body), sim = await mgr.getSim(req.params.id); await mgr.join(sim, b.seatId, b.agentId || '', u); return detail(sim, u); });
  app.post('/api/sessions/:id/leave', async (req: any) => { const u = await need(req, true), sim = await mgr.getSim(req.params.id); await mgr.leave(sim, seatBody.parse(req.body).seatId, u); return detail(sim, u); });
  app.post('/api/sessions/:id/ready', async (req: any) => { const u = await need(req, true), b = z.object({ seatId: z.string(), ready: z.boolean() }).parse(req.body), sim = await mgr.getSim(req.params.id); await mgr.setReady(sim, b.seatId, u, b.ready); return detail(sim, u); });
  app.post('/api/sessions/:id/fill', async (req: any) => { const u = await need(req, true), sim = await mgr.getSim(req.params.id); await mgr.fillHouse(sim, u); return detail(sim, u); });
  app.post('/api/sessions/:id/start', async (req: any) => { const u = await need(req, true), sim = await mgr.getSim(req.params.id); await mgr.start(sim, u); return detail(sim, u); });
  app.post('/api/sessions/:id/control', async (req: any) => { const u = await need(req, true), b = z.object({ action: z.enum(['pause', 'resume', 'abort', 'speed']), value: z.number().optional() }).parse(req.body), sim = await mgr.getSim(req.params.id); await mgr.control(sim, u, b.action, b.value); return detail(sim, u); });
  app.post('/api/sessions/:id/reconnect', async (req: any) => { const u = await need(req, true), sim = await mgr.getSim(req.params.id); await mgr.reconnect(sim, seatBody.parse(req.body).seatId, u); return detail(sim, u); });

  // An owner may read their own agent's private reasoning (and only theirs).
  app.get('/api/sessions/:id/mind/:seat', async (req: any) => {
    const u = await need(req, true), sim = await mgr.getSim(req.params.id), seat = sim.st.seats[req.params.seat];
    if (!seat || seat.ownerId !== u.id) throw bad(403, 'Not your agent.');
    return { memory: sim.memory(seat.seatId), thoughts: sim.events.filter((e) => e.type === 'thought' && e.actor?.seatId === seat.seatId).slice(-40).map((e) => ({ seq: e.seq, phase: e.phase, text: e.text })), failures: seat.failures };
  });

  // ----- audience -----
  app.post('/api/sessions/:id/predict', async (req: any) => {
    const u = await need(req), b = z.object({ marketId: z.string(), choice: z.string() }).parse(req.body), sim = await mgr.getSim(req.params.id);
    if (Object.values(sim.st.seats).some((s) => s.ownerId === u.id)) throw bad(403, 'Participants cannot bet on their own case.');
    const m = sim.preds.markets.find((x) => x.id === b.marketId);
    if (!m || m.status !== 'open' || PHASES.indexOf(sim.st.phase) >= PHASES.indexOf(m.closesAtPhase)) throw bad(409, 'That market is closed.');
    if (!m.options.some((o) => o.id === b.choice)) throw bad(400, 'Unknown option.');
    sim.preds.entries = sim.preds.entries.filter((p) => !(p.userId === u.id && p.marketId === m.id));
    sim.preds.entries.push({ userId: u.id, handle: u.handle, marketId: m.id, choice: b.choice, at: new Date().toISOString(), phase: sim.st.phase });
    sim.emit('prediction', { data: { marketId: m.id }, ms: 0 });
    await sim.save();
    return detail(sim, u);
  });
  app.post('/api/sessions/:id/sus', async (req: any) => {
    const u = await need(req), seq = String(z.object({ seq: z.number().int() }).parse(req.body).seq), sim = await mgr.getSim(req.params.id);
    const e = sim.events.find((x) => String(x.seq) === seq);
    if (!e || e.type !== 'speech' || sim.st.status === 'finished') throw bad(400, 'You can only flag a statement while the case is live.');
    const list = (sim.preds.sus[seq] ||= []);
    if (!list.includes(u.id)) list.push(u.id);
    await sim.savePreds();
    return { seq: Number(seq), count: list.length };
  });

  app.get('/api/leaderboards', async () => {
    const agents = (await acc.listAgents()).filter((a) => a.stats.cases > 0);
    const row = (a: any) => ({ id: a.id, name: a.name, house: a.house, tagline: a.tagline, look: a.look, rating: a.stats.rating, xp: a.stats.xp, cases: a.stats.cases, wins: a.stats.wins, losses: a.stats.losses, byRole: a.stats.byRole, achievements: a.stats.achievements.length, contradictions: a.stats.contradictions, objectionsWon: a.stats.objectionsWon, evidenceFound: a.stats.evidenceFound });
    const users = (await acc.allUsers()).filter((u) => u.total > 0);
    return {
      agents: agents.map(row).sort((a, b) => b.rating - a.rating).slice(0, 50),
      spectators: users.map((u) => ({ handle: u.handle, points: u.points, correct: u.correct, total: u.total, streak: u.streak, bestStreak: u.bestStreak, achievements: u.achievements })).sort((a, b) => b.points - a.points).slice(0, 50),
    };
  });

  // ----- administration -----
  app.get('/api/admin/overview', async (req) => {
    const u = await need(req, true); if (!u.admin) throw bad(403, 'Admins only.');
    const sims = await mgr.allSims();
    return { users: (await acc.allUsers()).length, agents: (await acc.listAgents()).map((a) => ({ id: a.id, name: a.name, house: a.house, ownerId: a.ownerId, listed: a.listed, cases: a.stats.cases })), sessions: sims.map((s) => ({ ...summary(s), error: s.st.error, running: mgr.isRunning(s.id), turn: s.st.turn, events: s.events.length })) };
  });
  app.post('/api/admin/agents/:id/unlist', async (req: any) => { const u = await need(req, true); if (!u.admin) throw bad(403, 'Admins only.'); await acc.updateAgent(req.params.id, (a) => { a.listed = false; }); return { ok: true }; });
}
