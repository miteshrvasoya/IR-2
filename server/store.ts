// JSON persistence layer: the ONLY place that touches the filesystem for application state.
//  - atomic writes (tmp file + fsync + rename) so a crash never leaves a half-written file
//  - per-file async mutex so concurrent agent actions serialize instead of clobbering each other
//  - append-only event log split into fixed-size JSON segments
//  - recovery: stray *.tmp files are discarded, unreadable files fall back to their .bak copy
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';

const locks = new Map<string, Promise<unknown>>();

/** Run fn while holding an exclusive lock on `key` (usually an absolute file path). */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}

function safe(base: string, ...parts: string[]): string {
  for (const p of parts) if (!/^[A-Za-z0-9_.-]+$/.test(p) || p.includes('..')) throw new Error(`unsafe path segment: ${p}`);
  const full = path.join(base, ...parts);
  if (!full.startsWith(base)) throw new Error('path escapes data dir');
  return full;
}
/** Resolve a path inside the runtime data dir; rejects anything that is not a plain segment. */
export const rt = (...parts: string[]) => safe(config.runtimeDir, ...parts);

export async function readJson<T>(file: string, fallback?: T): Promise<T> {
  for (const f of [file, file + '.bak']) {
    try { return JSON.parse(await fsp.readFile(f, 'utf8')) as T; }
    catch (e: any) { if (e.code !== 'ENOENT' && f === file) console.warn(`[store] ${path.basename(file)} unreadable (${e.message}); trying backup`); }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`missing or corrupt JSON: ${file}`);
}
export function readJsonSync<T>(file: string, fallback?: T): T {
  for (const f of [file, file + '.bak']) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch {} }
  if (fallback !== undefined) return fallback;
  throw new Error(`missing or corrupt JSON: ${file}`);
}

async function atomicWrite(file: string, data: unknown, backup: boolean) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(JSON.stringify(data, null, 1)); await fh.sync(); } finally { await fh.close(); }
  if (backup) { try { await fsp.copyFile(file, file + '.bak'); } catch {} }
  await fsp.rename(tmp, file);
}

/** Atomically replace a JSON file. `backup` keeps the previous good version alongside. */
export const writeJson = (file: string, data: unknown, backup = false) => withLock(file, () => atomicWrite(file, data, backup));

/** Read-modify-write under the file lock. */
export function updateJson<T>(file: string, fallback: T, fn: (cur: T) => T | void | Promise<T | void>, backup = false): Promise<T> {
  return withLock(file, async () => {
    const cur = await readJson<T>(file, fallback);
    const next = ((await fn(cur)) ?? cur) as T;
    await atomicWrite(file, next, backup);
    return next;
  });
}

export async function listDir(dir: string): Promise<string[]> { try { return await fsp.readdir(dir); } catch { return []; } }

/** Delete one JSON file (and its backup) under the file lock. */
export async function removeFile(file: string) {
  await withLock(file, async () => { await fsp.unlink(file).catch(() => {}); await fsp.unlink(file + '.bak').catch(() => {}); });
}

/** Remove leftovers of interrupted writes. Called once at boot. */
export async function sweepTmp(dir = config.runtimeDir): Promise<number> {
  let n = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += await sweepTmp(p);
    else if (e.name.endsWith('.tmp')) { await fsp.unlink(p).catch(() => {}); n++; }
  }
  return n;
}

// ---------- Append-only event log (events/000001.json, 000002.json, ...) ----------
const segName = (i: number) => String(i).padStart(6, '0') + '.json';
const segOf = (seq: number) => Math.floor((seq - 1) / config.eventSegment) + 1;

export async function appendEvents<E extends { seq: number }>(dir: string, events: E[]) {
  if (!events.length) return;
  await withLock(dir, async () => {
    const bySeg = new Map<number, E[]>();
    for (const e of events) { const s = segOf(e.seq); if (!bySeg.has(s)) bySeg.set(s, []); bySeg.get(s)!.push(e); }
    for (const [s, list] of bySeg) {
      const file = path.join(dir, segName(s));
      const cur = await readJson<E[]>(file, []);
      const last = cur.length ? cur[cur.length - 1].seq : -Infinity;
      await atomicWrite(file, cur.concat(list.filter((e) => e.seq > last)), false);   // idempotent on replays
    }
  });
}

export async function readEvents<E extends { seq: number }>(dir: string, afterSeq = 0): Promise<E[]> {
  const files = (await listDir(dir)).filter((f) => /^\d{6}\.json$/.test(f)).sort();
  const out: E[] = [];
  for (const f of files) {
    if (Number(f.slice(0, 6)) < segOf(afterSeq + 1)) continue;
    const seg = await readJson<E[]>(path.join(dir, f), []);
    for (const e of seg) if (e.seq > afterSeq) out.push(e);
  }
  return out;
}
