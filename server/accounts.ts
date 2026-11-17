// Users, login sessions, the agent library, and encrypted LLM credentials. All persisted as JSON files.
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.ts';
import { rt, readJson, writeJson, updateJson, listDir, removeFile, readJsonSync } from './store.ts';
import { encrypt, decrypt, hashPassword, verifyPassword, newToken, sha256, newId, type Box } from './crypto.ts';
import type { AgentProfile, AgentStats, PublicUser, RoleKind } from '../shared/types.ts';

// ---------- users ----------
interface UserRec extends PublicUser { pwHash: string | null; guest: boolean; createdAt: string }
const userFile = (id: string) => rt('users', `${id}.json`);
const indexFile = () => rt('users', '_handles.json');
const authFile = () => rt('auth', 'sessions.json');

const pub = (u: UserRec): PublicUser & { guest: boolean } => ({ id: u.id, handle: u.handle, admin: u.admin, points: u.points, streak: u.streak, bestStreak: u.bestStreak, correct: u.correct, total: u.total, achievements: u.achievements, guest: u.guest });

export async function getUser(id: string) { try { return await readJson<UserRec>(userFile(id)); } catch { return null; } }
export async function publicUser(id: string) { const u = await getUser(id); return u ? pub(u) : null; }
export const updateUser = (id: string, fn: (u: UserRec) => void) => updateJson<UserRec>(userFile(id), null as any, (u) => { if (u) fn(u); return u; });

async function createUser(handle: string, pw: string | null, guest: boolean): Promise<UserRec> {
  const key = handle.toLowerCase();
  let created!: UserRec;
  await updateJson<Record<string, string>>(indexFile(), {}, async (idx) => {
    if (idx[key]) throw Object.assign(new Error('That handle is taken.'), { status: 409 });
    const first = Object.keys(idx).filter((k) => !k.startsWith('guest-')).length === 0;
    created = { id: newId('u'), handle, pwHash: pw ? hashPassword(pw) : null, guest, admin: !guest && (first || process.env.IR_ADMIN_HANDLE?.toLowerCase() === key), points: 1000, streak: 0, bestStreak: 0, correct: 0, total: 0, achievements: [], createdAt: new Date().toISOString() };
    await writeJson(userFile(created.id), created);
    idx[key] = created.id;
  });
  return created;
}
export const Credentials = z.object({ handle: z.string().trim().regex(/^[A-Za-z0-9_-]{3,20}$/, 'Handle: 3-20 letters, digits, _ or -'), password: z.string().min(6, 'Password: at least 6 characters').max(200) });

export async function register(handle: string, password: string) { return pub(await createUser(handle, password, false)); }
export async function guest() { return pub(await createUser('guest-' + newId('').slice(1, 7), null, true)); }
export async function login(handle: string, password: string) {
  const idx = await readJson<Record<string, string>>(indexFile(), {});
  const u = idx[handle.toLowerCase()] ? await getUser(idx[handle.toLowerCase()]) : null;
  if (!u || !u.pwHash || !verifyPassword(password, u.pwHash)) throw Object.assign(new Error('Wrong handle or password.'), { status: 401 });
  return pub(u);
}
export async function openSession(userId: string): Promise<string> {
  const token = newToken();
  await updateJson<Record<string, { userId: string; exp: number }>>(authFile(), {}, (s) => {
    const now = Date.now();
    for (const k of Object.keys(s)) if (s[k].exp < now) delete s[k];
    s[sha256(token)] = { userId, exp: now + 30 * 864e5 };
  });
  return token;
}
export async function userFromToken(token: string | undefined) {
  if (!token) return null;
  const s = (await readJson<Record<string, { userId: string; exp: number }>>(authFile(), {}))[sha256(token)];
  return s && s.exp > Date.now() ? publicUser(s.userId) : null;
}
export const closeSession = (token: string) => updateJson<Record<string, any>>(authFile(), {}, (s) => { delete s[sha256(token)]; });
export async function allUsers() {
  const out: (PublicUser & { guest: boolean })[] = [];
  for (const f of await listDir(rt('users'))) if (f.startsWith('u_') && f.endsWith('.json')) { const u = await getUser(f.slice(0, -5)); if (u) out.push(pub(u)); }
  return out;
}

// ---------- credentials (encrypted at rest; plaintext never leaves this module except to the LLM client) ----------
interface CredRec { id: string; ownerId: string; provider: string; label: string; last4: string; box: Box; createdAt: string; rotatedAt?: string }
const credFile = () => rt('secrets', 'credentials.json');
const credPub = (c: CredRec) => ({ id: c.id, provider: c.provider, label: c.label, last4: c.last4, createdAt: c.createdAt, rotatedAt: c.rotatedAt });

export async function listCredentials(ownerId: string) { return Object.values(await readJson<Record<string, CredRec>>(credFile(), {})).filter((c) => c.ownerId === ownerId).map(credPub); }
export async function saveCredential(ownerId: string, provider: string, label: string, secret: string, rotateId?: string) {
  let out!: CredRec;
  await updateJson<Record<string, CredRec>>(credFile(), {}, (all) => {
    const prev = rotateId ? all[rotateId] : null;
    if (rotateId && (!prev || prev.ownerId !== ownerId)) throw Object.assign(new Error('Credential not found.'), { status: 404 });
    out = { id: prev?.id || newId('cred'), ownerId, provider: prev?.provider || provider, label: label || prev?.label || provider, last4: secret.slice(-4), box: encrypt(secret), createdAt: prev?.createdAt || new Date().toISOString(), rotatedAt: prev ? new Date().toISOString() : undefined };
    all[out.id] = out;
  });
  return credPub(out);
}
export async function deleteCredential(ownerId: string, id: string) {
  await updateJson<Record<string, CredRec>>(credFile(), {}, (all) => { if (all[id]?.ownerId === ownerId) delete all[id]; });
  for (const a of await listAgents()) if (a.ownerId === ownerId && a.model.credentialId === id) await updateAgent(a.id, (x) => { x.model = { provider: 'house' }; });
}
/** Server-internal: resolve a credential to its secret for an agent owned by `ownerId`. */
export async function credentialSecret(ownerId: string | null, id: string | undefined): Promise<string | null> {
  if (!id || !ownerId) return null;
  const c = (await readJson<Record<string, CredRec>>(credFile(), {}))[id];
  if (!c || c.ownerId !== ownerId) return null;
  try { return decrypt(c.box); } catch { return null; }
}

// ---------- agents ----------
const agentFile = (id: string) => rt('agents', `${id}.json`);
export const emptyStats = (): AgentStats => ({ cases: 0, xp: 0, rating: 1200, wins: 0, losses: 0, byRole: {}, dims: {}, objectionsWon: 0, contradictions: 0, evidenceFound: 0, achievements: [], history: [] });

/** House agents are authored in data/house-agents.json; their evolving stats live in the runtime store. */
export async function seedHouseAgents() {
  const roster = readJsonSync<Omit<AgentProfile, 'stats'>[]>(config.houseAgentsFile, []);
  for (const a of roster) {
    const cur = await readJson<AgentProfile | null>(agentFile(a.id), null);
    await writeJson(agentFile(a.id), { ...a, stats: cur?.stats || emptyStats() });
  }
}
export async function getAgent(id: string) { if (!/^[A-Za-z0-9_]+$/.test(id)) return null; return readJson<AgentProfile | null>(agentFile(id), null); }
export async function listAgents(): Promise<AgentProfile[]> {
  const out: AgentProfile[] = [];
  for (const f of await listDir(rt('agents'))) if (f.endsWith('.json')) { const a = await readJson<AgentProfile | null>(path.join(rt('agents'), f), null); if (a) out.push(a); }
  return out;
}
export const updateAgent = (id: string, fn: (a: AgentProfile) => void) => updateJson<AgentProfile>(agentFile(id), null as any, (a) => { if (a) fn(a); return a; });

const trait = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000b-\u001f]/g, ''));
export const AgentInput = z.object({
  name: z.string().trim().min(2).max(40), tagline: text(120).default(''),
  preferredRoles: z.array(z.enum(['detective', 'forensic', 'prosecutor', 'defense', 'judge', 'suspect', 'witness', 'juror'])).min(1).max(8),
  personality: text(600), background: text(600).default(''), style: text(40).default('measured'),
  traits: z.object({ rigor: trait, aggression: trait, skepticism: trait, drama: trait, empathy: trait, humor: trait }),
  instructions: text(1500).default(''),
  model: z.object({ provider: z.enum(['house', 'anthropic', 'openai-compatible']), model: z.string().trim().max(80).optional(), baseUrl: z.string().trim().url().max(200).optional(), credentialId: z.string().max(40).optional() }),
  look: z.object({ skin: hex, hair: hex, hairStyle: z.string().max(20), accent: hex, build: z.number().min(0.8).max(1.2).optional() }),
  listed: z.boolean().default(false),
});

export async function saveAgent(ownerId: string, input: z.infer<typeof AgentInput>, id?: string): Promise<AgentProfile> {
  if (input.model.provider !== 'house') {
    const creds = await listCredentials(ownerId);
    if (!creds.some((c) => c.id === input.model.credentialId)) throw Object.assign(new Error('Pick one of your saved API keys for this provider.'), { status: 400 });
  } else input.model = { provider: 'house' };
  if (id) {
    const cur = await getAgent(id);
    if (!cur || cur.ownerId !== ownerId) throw Object.assign(new Error('Agent not found.'), { status: 404 });
    return updateAgent(id, (a) => Object.assign(a, input));
  }
  const mine = (await listAgents()).filter((a) => a.ownerId === ownerId);
  if (mine.length >= 12) throw Object.assign(new Error('Agent limit reached (12).'), { status: 400 });
  const a: AgentProfile = { ...input, id: newId('ag'), ownerId, house: false, createdAt: new Date().toISOString(), stats: emptyStats() } as AgentProfile;
  await writeJson(agentFile(a.id), a);
  return a;
}
export async function deleteAgent(ownerId: string, id: string, admin = false) {
  const a = await getAgent(id);
  if (!a || a.house || (a.ownerId !== ownerId && !admin)) throw Object.assign(new Error('Agent not found.'), { status: 404 });
  await removeFile(agentFile(id));
}
/** Agent as shown to people who do not own it: no private instructions, no credential reference. */
export function publicAgent(a: AgentProfile, viewerId?: string | null) {
  const own = !!viewerId && a.ownerId === viewerId;
  return { ...a, instructions: own ? a.instructions : '', model: own ? a.model : { provider: a.model.provider, model: a.model.model }, mine: own };
}
export const suits = (a: AgentProfile, role: RoleKind) => a.preferredRoles.includes(role);
