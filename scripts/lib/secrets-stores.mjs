/**
 * scripts/lib/secrets-stores.mjs
 *
 * Parsing helpers for `wrangler secrets-store store list` output.
 * Shared by scripts/setup.mjs and tests/secretsStores.test.mjs.
 *
 * Background: the open-beta command used to support `--json` (older wrangler
 * versions emit a JSON array). Newer wrangler versions (>= 4.x, e.g. 4.126.0)
 * reject `--json` with "Unknown argument: json" and only emit a
 * human-readable table. The parser accepts both.
 */

const HEX32 = '[0-9a-fA-F]{32}';

/**
 * Parse Secrets Store list output into an array of { name, id }.
 *
 * @param {string} raw Combined stdout of `wrangler secrets-store store list`
 *   (either legacy JSON or the box-drawing table; banners/warnings allowed).
 * @returns {{ name: string, id: string }[]}
 */
export function parseSecretsStoreList(raw) {
  if (!raw) return [];

  const text = String(raw).trim();

  // Legacy path: pure JSON output (array, or an object wrapping the array).
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.stores)
          ? parsed.stores
          : Array.isArray(parsed?.result)
            ? parsed.result
            : null;
      if (list) {
        return list
          .filter((st) => st && typeof st.id === 'string')
          .map((st) => ({ name: st.name ?? '', id: st.id }));
      }
    } catch {
      /* fall through to table parsing */
    }
  }

  // Table path: rows like
  // │ default_secrets_store │ e99a63556266453693946991d25b6947 │ … │
  // Only rows containing a 32-hex ID in the second column are matched, so
  // header/footer rows are ignored.
  const stores = [];
  const rowRe = new RegExp(
    `\\u2502\\s*([^\\u2502]*?)\\s*\\u2502\\s*(${HEX32})\\s*\\u2502`,
    'g',
  );
  let match;
  while ((match = rowRe.exec(text)) !== null) {
    stores.push({ name: match[1], id: match[2].toLowerCase() });
  }
  return stores;
}
