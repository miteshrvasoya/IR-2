import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export async function api<T = any>(path: string, body?: any, method?: string): Promise<T> {
  const r = await fetch('/api' + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export interface Me { id: string; handle: string; admin: boolean; guest: boolean; points: number; streak: number; bestStreak: number; correct: number; total: number; achievements: { id: string; label: string }[] }
const Ctx = createContext<{ me: Me | null; loaded: boolean; refresh: () => Promise<void>; setMe: (m: Me | null) => void; ensureGuest: () => Promise<Me> }>(null as any);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null), [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => { setMe((await api('/me')).user); setLoaded(true); }, []);
  useEffect(() => { refresh().catch(() => setLoaded(true)); }, [refresh]);
  const ensureGuest = useCallback(async () => { if (me) return me; const u = await api<Me>('/auth/guest', {}); setMe(u); return u; }, [me]);
  return <Ctx.Provider value={{ me, loaded, refresh, setMe, ensureGuest }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

/** Fetch + refetch helper. */
export function useData<T>(path: string | null, every = 0): [T | null, () => void, string] {
  const [data, setData] = useState<T | null>(null), [err, setErr] = useState(''), [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return; let live = true;
    const load = () => api<T>(path).then((d) => live && (setData(d), setErr(''))).catch((e) => live && setErr(e.message));
    load(); const t = every ? setInterval(load, every) : 0;
    return () => { live = false; if (t) clearInterval(t); };
  }, [path, every, n]);
  return [data, () => setN((x) => x + 1), err];
}
