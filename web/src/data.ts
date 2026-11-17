// Reads the static JSON data shipped with the site (web/public/data). Nothing here writes anywhere.
import { buildBundle, CASE_FILES, type CaseBundle } from '../../core/caselib';
import type { AgentProfile, AgentStats } from '../../shared/types';
import type { SessionDoc } from '../../core/sim';

const BASE = (import.meta.env.BASE_URL || '/') + 'data/';
const cache = new Map<string, Promise<any>>();
export function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, fetch(BASE + path).then((r) => { if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`); return r.json(); }).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path)!;
}

export interface CaseSummary { id: string; title: string; tagline: string; type: string; difficulty: number; setting: string; briefing: string; victim: any; seats: any[]; characters: any[]; estimatedMinutes: number; standard: string; evidenceCount: number; charges: { id: string; label: string }[]; crimeScene: { kind: string; label: string } }
export interface RunSummary { id: string; caseId: string; title: string; blurb: string; featured: boolean; outcome: any; defendant: string | null; events: number; durationMs: number; cast: { role: string; name: string; agentId: string }[] }
export type RunFile = SessionDoc & { meta: { id: string; caseId: string; blurb: string; featured: boolean; recordedAt: string } };

export const loadCases = () => getJson<{ cases: CaseSummary[] }>('cases/index.json').then((x) => x.cases);
export const loadRuns = () => getJson<{ generatedAt: string; runs: RunSummary[]; agentStats: Record<string, AgentStats> }>('runs/index.json');
export const loadRun = (id: string) => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Bad recording id'); return getJson<RunFile>(`runs/${id}.json`); };
export const loadRoster = () => getJson<Omit<AgentProfile, 'stats'>[]>('agents.json');

const bundles = new Map<string, Promise<CaseBundle>>();
export function loadBundle(caseId: string): Promise<CaseBundle> {
  if (!/^[a-z0-9_-]+$/.test(caseId)) return Promise.reject(new Error('Bad case id'));
  if (!bundles.has(caseId)) bundles.set(caseId, Promise.all(CASE_FILES.map((f) => getJson(`cases/${caseId}/${f}`))).then((files) => buildBundle(Object.fromEntries(CASE_FILES.map((f, i) => [f, files[i]])) as any)));
  return bundles.get(caseId)!;
}

/** House agents with the career stats earned in the recorded sample runs. */
export async function houseAgents(): Promise<AgentProfile[]> {
  const [roster, runs] = await Promise.all([loadRoster(), loadRuns().catch(() => ({ agentStats: {} as Record<string, AgentStats> }))]);
  const { emptyStats } = await import('../../core/referee');
  return roster.map((a) => ({ ...a, stats: runs.agentStats[a.id] || emptyStats() }) as AgentProfile);
}
