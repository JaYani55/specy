/**
 * env.mjs — shared .env/.env.local loader and repo root for update tooling.
 * .env.local wins over .env.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '..', '..');

export function loadDotEnv() {
  const vars = {};
  for (const file of ['.env.local', '.env']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in vars)) vars[key] = val;
    }
  }
  return vars;
}
