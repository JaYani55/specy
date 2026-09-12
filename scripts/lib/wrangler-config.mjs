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

/**
 * Parse wrangler JSONC text into an object — comment-safe: `//` and `/* *\/`
 * comments are stripped ONLY outside string literals (URLs like
 * "https://…" contain `//` inside strings and must survive).
 * Tolerates trailing commas.
 *
 * @param {string} text Full wrangler.jsonc content.
 * @returns {object|null} Parsed config, or null on failure.
 */
export function parseJsoncConfig(text) {
  if (typeof text !== 'string') return null;
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += char;
  }
  // Strip trailing commas (common in hand-edited JSONC).
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}
