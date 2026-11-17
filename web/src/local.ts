// Everything a visitor creates lives in their own browser as JSON documents (localStorage), and can be
// exported to / imported from .json files. There is no server: nothing here leaves the device except
// requests an agent makes to the user's own model provider with the user's own key.
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { AgentProfile, AgentStats } from '../../shared/types';
import type { SessionDoc } from '../../core/sim';
import type { SpectatorRecord } from '../../core/referee';

const K = { profile: 'ir.profile', agents: 'ir.agents', keys: 'ir.keys', sessions: 'ir.sessions', session: (id: string) => `ir.session.${id}`, preds: (id: string) => `ir.preds.${id}` };
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
/** Re-render when local data changes (in this tab or another). */
export function useLocal<T>(read: () => T): T {
  const [v, setV] = useState(read);
  useEffect(() => { const f = () => setV(read()); listeners.add(f); window.addEventListener('storage', f); return () => { listeners.delete(f); window.removeEventListener('storage', f); }; }, []);
  return v;
}
function get<T>(key: string, fallback: T): T { try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } }
function set(key: string, value: unknown) {
  const s = JSON.stringify(value);
  try { localStorage.setItem(key, s); }
  catch {   // quota: drop the oldest finished proceeding and try once more
    const old = listSessions().filter((x) => x.status === 'finished').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!old) throw new Error('Browser storage is full. Export and delete some proceedings.');
    deleteSession(old.id); localStorage.setItem(key, s);
  }
  changed();
}
const rid = (p: string) => `${p}_${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

// ---------- profile ----------
export interface Profile extends SpectatorRecord { id: string; handle: string; createdAt: string }
export function profile(): Profile {
  let p = get<Profile | null>(K.profile, null);
  if (!p) { p = { id: rid('u'), handle: 'detective-' + Math.floor(Math.random() * 9000 + 1000), points: 1000, streak: 0, bestStreak: 0, correct: 0, total: 0, achievements: [], createdAt: new Date().toISOString() }; set(K.profile, p); }
  return p;
}
export function updateProfile(fn: (p: Profile) => void) { const p = profile(); fn(p); set(K.profile, p); }

// ---------- agents ----------
const trait = z.number().min(0).max(1), hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000b-\u001f]/g, ''));
export const AgentInput = z.object({
  name: z.string().trim().min(2, 'Name: at least 2 characters').max(40), tagline: text(120).default(''),
  preferredRoles: z.array(z.enum(['detective', 'forensic', 'prosecutor', 'defense', 'judge', 'suspect', 'witness', 'juror'])).min(1, 'Pick at least one role').max(8),
  personality: text(600).refine((s) => s.length >= 4, 'Describe the personality'), background: text(600).default(''), style: text(40).default('measured'),
  traits: z.object({ rigor: trait, aggression: trait, skepticism: trait, drama: trait, empathy: trait, humor: trait }),
  instructions: text(1500).default(''),
  model: z.object({ provider: z.enum(['house', 'anthropic', 'openai-compatible']), model: z.string().trim().max(80).optional(), baseUrl: z.string().trim().max(200).optional(), credentialId: z.string().max(40).optional() }),
  look: z.object({ skin: hex, hair: hex, hairStyle: z.string().max(20), accent: hex, build: z.number().min(0.8).max(1.2).optional() }),
});
export const myAgents = () => get<AgentProfile[]>(K.agents, []);
export function saveAgent(input: unknown, id?: string, stats?: AgentStats): AgentProfile {
  const a = AgentInput.parse(input);
  if (a.model.provider !== 'house' && !listKeys().some((k) => k.id === a.model.credentialId)) throw new Error('Pick one of your saved API keys for this provider.');
  if (a.model.provider === 'house') a.model = { provider: 'house' };
  const list = myAgents(), cur = id ? list.find((x) => x.id === id) : null;
  if (!cur && list.length >= 24) throw new Error('Agent limit reached (24).');
  const empty: AgentStats = { cases: 0, xp: 0, rating: 1200, wins: 0, losses: 0, byRole: {}, dims: {}, objectionsWon: 0, contradictions: 0, evidenceFound: 0, achievements: [], history: [] };
  const agent = { ...a, id: cur?.id || rid('ag'), ownerId: profile().id, house: false, listed: false, createdAt: cur?.createdAt || new Date().toISOString(), stats: stats || cur?.stats || empty } as AgentProfile;
  set(K.agents, cur ? list.map((x) => (x.id === cur.id ? agent : x)) : [...list, agent]);
  return agent;
}
export const deleteAgent = (id: string) => set(K.agents, myAgents().filter((a) => a.id !== id));
export function updateAgentStats(id: string, fn: (s: AgentStats) => void) { set(K.agents, myAgents().map((a) => (a.id === id ? (fn(a.stats), a) : a))); }

// ---------- API keys (this browser only; never exported) ----------
interface KeyRec { id: string; provider: 'anthropic' | 'openai-compatible'; label: string; secret: string; last4: string; createdAt: string; rotatedAt?: string }
export const listKeys = () => get<KeyRec[]>(K.keys, []).map(({ secret, ...k }) => k);
export const keySecret = (id?: string) => get<KeyRec[]>(K.keys, []).find((k) => k.id === id)?.secret || null;
export function saveKey(provider: KeyRec['provider'], label: string, secret: string, rotateId?: string) {
  secret = secret.trim(); if (secret.length < 8) throw new Error('That does not look like an API key.');
  const all = get<KeyRec[]>(K.keys, []), cur = rotateId ? all.find((k) => k.id === rotateId) : null;
  const rec: KeyRec = { id: cur?.id || rid('key'), provider: cur?.provider || provider, label: label || cur?.label || provider, secret, last4: secret.slice(-4), createdAt: cur?.createdAt || new Date().toISOString(), rotatedAt: cur ? new Date().toISOString() : undefined };
  set(K.keys, cur ? all.map((k) => (k.id === cur.id ? rec : k)) : [...all, rec]);
  return rec.id;
}
export function deleteKey(id: string) {
  set(K.keys, get<KeyRec[]>(K.keys, []).filter((k) => k.id !== id));
  set(K.agents, myAgents().map((a) => (a.model.credentialId === id ? { ...a, model: { provider: 'house' } } : a)));
}

// ---------- proceedings run in this browser ----------
export interface SessionSummary { id: string; caseId: string; title: string; status: string; phase: string; createdAt: string; outcome: any }
export const listSessions = () => get<SessionSummary[]>(K.sessions, []);
export const loadSession = (id: string) => get<SessionDoc | null>(K.session(id), null);
export function saveSession(doc: SessionDoc) {
  const st = doc.state, sum: SessionSummary = { id: st.id, caseId: st.caseId, title: st.title, status: st.status, phase: st.phase, createdAt: st.createdAt, outcome: st.outcome };
  set(K.session(st.id), doc);
  set(K.sessions, [sum, ...listSessions().filter((x) => x.id !== st.id)]);
}
export function deleteSession(id: string) { localStorage.removeItem(K.session(id)); localStorage.removeItem(K.preds(id)); set(K.sessions, listSessions().filter((x) => x.id !== id)); }

// ---------- predictions (per recording or proceeding) ----------
export interface PredState { picks: { marketId: string; choice: string; phase: string; early: boolean; at: string }[]; sus: number[]; settled: { right: number; gain: number } | null }
export const loadPreds = (id: string) => get<PredState>(K.preds(id), { picks: [], sus: [], settled: null });
export const savePreds = (id: string, p: PredState) => set(K.preds(id), p);

// ---------- backup ----------
export function exportAll() {
  return { format: 'interrogation-room/backup@1', exportedAt: new Date().toISOString(), profile: profile(), agents: myAgents().map((a) => ({ ...a, model: a.model.provider === 'house' ? a.model : { ...a.model, credentialId: undefined } })), sessions: listSessions().map((s) => loadSession(s.id)).filter(Boolean) };
}
export function importFile(json: any): string {
  if (json?.format === 'interrogation-room/session@1') { saveSession(json); return `Imported proceeding "${json.state.title}".`; }
  if (json?.format === 'interrogation-room/backup@1') {
    let n = 0;
    for (const a of json.agents || []) { try { saveAgent({ ...a, model: { provider: 'house' } }, myAgents().some((x) => x.id === a.id) ? a.id : undefined, a.stats); n++; } catch { /* skip invalid */ } }
    for (const s of json.sessions || []) if (s?.format === 'interrogation-room/session@1') saveSession(s);
    return `Imported ${n} agent(s) and ${(json.sessions || []).length} proceeding(s). API keys are never part of a backup — add them again on this device.`;
  }
  throw new Error('That file is not an Interrogation Room session or backup.');
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function resetAll() { for (const k of Object.keys(localStorage)) if (k.startsWith('ir.')) localStorage.removeItem(k); changed(); }
