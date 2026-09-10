/**
 * sqlStr.mjs — shared SQL literal escaping for Management API queries.
 *
 * The Supabase Management API (/database/query) accepts raw SQL strings, so
 * values interpolated into queries must be escaped here. Used by setup.mjs,
 * install-plugins.mjs and other tooling that talks to the Management API.
 */

// Escape a value for safe embedding in a single-quoted SQL literal.
// Standard PostgreSQL escaping: a single quote becomes two single quotes.
export function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
