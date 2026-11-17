// Node-side helpers for reading and writing the static JSON data under web/public/data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, CASE_FILES, type CaseBundle } from '../core/caselib.ts';
import type { AgentProfile } from '../shared/types.ts';

export const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'data');
export const readJson = <T>(...p: string[]): T => JSON.parse(fs.readFileSync(path.join(DATA, ...p), 'utf8'));
export function writeJson(rel: string, data: unknown) {
  const file = path.join(DATA, rel), tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data) + '\n'); fs.renameSync(tmp, file);           // atomic replace
}
export const caseIds = () => fs.readdirSync(path.join(DATA, 'cases'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
export function loadCase(id: string): CaseBundle {
  const raw: any = {}; for (const f of CASE_FILES) raw[f] = readJson('cases', id, f);
  return buildBundle(raw);
}
export const loadRoster = () => readJson<AgentProfile[]>('agents.json');
