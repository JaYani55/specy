/**
 * scripts/lib/prompts.mjs
 *
 * Shared interactive prompt helpers for the maintenance tooling.
 * Deduplicates the masked-secret and plain-line prompts previously copied into
 * install-plugins.mjs, uninstall-plugin.mjs, remote-sql.mjs and
 * provision-bindings.mjs.
 */

import { createInterface } from 'readline';

/**
 * Regular line prompt — paste-friendly (no raw mode). Used for non-secret
 * input and y/N questions.
 *
 * @param {string} question
 * @returns {Promise<string>} trimmed answer.
 */
export function promptLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Masked prompt for secrets (PATs, API tokens) — raw mode with '*' feedback,
 * paste-safe: multi-character input chunks (clipboard paste) are iterated
 * character by character so pasted tokens are masked too.
 *
 * @param {string} question
 * @returns {Promise<string>} the entered secret (no trimming beyond whitespace removal).
 */
export function promptSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let secret = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(wasRaw);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(secret);
          return;
        }
        if (ch === '\u0003') { // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') { // backspace
          if (secret.length > 0) {
            secret = secret.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          secret += ch;
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}
