/**
 * action-log.mjs — /data workspace + critical action logging for setup tooling.
 *
 * The /data directory is a local, gitignored workspace that is created
 * dynamically the first time a tooling flow needs it:
 *
 *   data/
 *     snapshots/   — database snapshots written by scripts/snapshots.mjs
 *     logs/        — one log file per critical action run
 *                    (migrations, snapshot create, snapshot restore)
 *
 * Critical flows (migrations via scripts/migrate.mjs, snapshot create/restore
 * via scripts/snapshots.mjs) call createActionLog() at the start of a run.
 * The log file is written incrementally (append-only), so even a hard crash
 * leaves a partial trail. Log files never contain secrets (PATs, keys).
 *
 * Contract: specs/platform/db-snapshots.md
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.mjs';

/**
 * Ensure the /data workspace exists (dynamically created on first use).
 * @param {string} [root] repo root (overridable for tests)
 * @returns {{ dataDir: string, snapshotsDir: string, logsDir: string }}
 */
export function ensureDataDirs(root = ROOT) {
  const dataDir = join(root, 'data');
  const snapshotsDir = join(dataDir, 'snapshots');
  const logsDir = join(dataDir, 'logs');
  for (const dir of [dataDir, snapshotsDir, logsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return { dataDir, snapshotsDir, logsDir };
}

/**
 * Windows-safe local timestamp for file names (no colons):
 * "2026-09-11_18-42-05".
 */
export function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Start a critical action log in /data/logs.
 *
 * @param {string} action short action name, used in the file name
 *        (e.g. 'migrations', 'snapshot-create', 'snapshot-restore')
 * @param {{ root?: string, meta?: Record<string, string|null> }} [options]
 * @returns {{
 *   file: string,
 *   entry(message: string): void,
 *   finish(status: string, message?: string): void,
 * }}
 */
export function createActionLog(action, { root = ROOT, meta = {} } = {}) {
  const { logsDir } = ensureDataDirs(root);
  const startedAt = new Date();
  const file = join(logsDir, `${timestampSlug(startedAt)}_${action}.log`);

  const header = [
    `action:   ${action}`,
    `started:  ${startedAt.toISOString()}`,
    ...Object.entries(meta).map(([k, v]) => `${k.padEnd(9)} ${v ?? '—'}`),
    '─'.repeat(64),
    '',
  ].join('\n');
  writeFileSync(file, header, 'utf8');

  return {
    file,
    /** Append a timestamped line to the log. */
    entry(message) {
      appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    },
    /** Close the log with a final status block. */
    finish(status, message) {
      appendFileSync(
        file,
        ['─'.repeat(64), `finished: ${new Date().toISOString()}`, `status:   ${status}${message ? ` — ${message}` : ''}`, ''].join('\n'),
        'utf8',
      );
    },
  };
}