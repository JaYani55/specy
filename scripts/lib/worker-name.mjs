/**
 * scripts/lib/worker-name.mjs
 *
 * Worker name (wrangler project name) validation + default.
 * Shared by scripts/setup.mjs and tests/workerName.test.mjs.
 */

export const DEFAULT_WORKER_NAME = 'specy';

/**
 * Validate a Cloudflare Worker name.
 * Rules: lowercase letters, digits, hyphens or underscores;
 * must start with a letter; maximum 58 characters.
 *
 * @param {string} value Raw user input.
 * @returns {string | undefined} Error message, or undefined when valid.
 */
export function validateWorkerName(value) {
  const name = (value ?? '').trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return 'Use lowercase letters, digits, hyphens or underscores — must start with a letter.';
  }
  if (name.length > 58) {
    return 'Maximum 58 characters.';
  }
  return undefined;
}
