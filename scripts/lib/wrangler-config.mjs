/**
 * scripts/lib/wrangler-config.mjs
 *
 * Pure transformations on wrangler JSONC config text.
 * Shared by scripts/setup.mjs and tests/wranglerConfig.test.mjs.
 */

/**
 * Remove a `secrets_store_secrets` binding entry (identified by its binding
 * name, e.g. `SS_SUPABASE_SECRET_KEY`) from wrangler JSONC text. Removes the
 * enclosing `{ … }` object plus one adjacent comma so the array stays valid.
 * Entries of this shape contain no nested braces.
 *
 * @param {string} jsonc Full wrangler.jsonc content.
 * @param {string} bindingName Binding name, e.g. "SS_SUPABASE_SECRET_KEY".
 * @returns {{ text: string, removed: boolean }}
 */
export function removeSecretsStoreBinding(jsonc, bindingName) {
  const escaped = String(bindingName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"binding"\\s*:\\s*"${escaped}"`).exec(jsonc);
  if (!match) return { text: jsonc, removed: false };

  const start = jsonc.lastIndexOf('{', match.index);
  let end = jsonc.indexOf('}', match.index);
  if (start === -1 || end === -1) return { text: jsonc, removed: false };
  end += 1;

  // Remove one adjacent comma (trailing if present, otherwise leading)
  // so the remaining array entries stay comma-separated correctly.
  const after = jsonc.slice(end);
  const trailing = after.match(/^\s*,/);
  if (trailing) {
    end += trailing[0].length;
  } else {
    const leading = jsonc.slice(0, start).match(/,\s*$/);
    if (leading) start -= leading[0].length;
  }

  return { text: jsonc.slice(0, start) + jsonc.slice(end), removed: true };
}
