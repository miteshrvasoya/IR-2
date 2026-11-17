// Secrets: password hashing, session tokens, and encryption-at-rest for user LLM credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

let master: Buffer | null = null;
/** 32-byte master key: IR_MASTER_KEY if provided, else a 0600 key file generated on first run. */
function masterKey(): Buffer {
  if (master) return master;
  if (process.env.IR_MASTER_KEY) return (master = crypto.createHash('sha256').update(process.env.IR_MASTER_KEY).digest());
  const file = path.join(config.runtimeDir, 'secrets', 'master.key');
  try { master = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); }
  catch {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    master = crypto.randomBytes(32);
    fs.writeFileSync(file, master.toString('hex'), { mode: 0o600 });
  }
  return master!;
}

export interface Box { iv: string; tag: string; ct: string }
export function encrypt(plain: string): Box {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
export function decrypt(box: Box): string {
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8');
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

/** Redact anything that looks like a credential before it reaches a log line. */
export const redact = (s: string) => String(s).replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…').replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1…');
