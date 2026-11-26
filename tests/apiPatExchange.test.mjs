import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Regression guard for the PAT-exchange pitfall (specs/auth/api-tokens.md §4):
 * routes that accept `Authorization: Bearer …` must NEVER pass the raw bearer
 * value into createSupabaseClient — PostgREST rejects non-JWT bearers with
 * "PGRST301: Expected 3 parts in JWT; got 1", which surfaced as an unhandled
 * 500/1101 on GET /api/forms/:identifier/answers and broke the n8n
 * form-answers flow. Every client built inside a route/middleware file must
 * receive the exchanged session (`auth.token` / `auth?.token`) or nothing
 * (anonymous access).
 */
const apiDir = fileURLToPath(new URL('../api', import.meta.url));

const scannedFiles = [
  ...readdirSync(join(apiDir, 'routes')).filter((f) => f.endsWith('.ts')).map((f) => join('routes', f)),
  'middleware/agentLogger.ts',
];

// Tokens that are NOT raw bearer values by construction:
// - exchanged session JWTs (`auth.token` / `auth?.token` / `session.token`)
// - `authToken` in mcp.ts — always derived as `authSession?.token` (exchanged)
// - the `sessionToken` parameter of schemas.ts readSchemaSecretStatusWithUserToken
//   and mail.ts getVisibleJob (documented: callers always pass the exchanged JWT)
const SAFE_TOKEN_ARGS = /^(auth\??\.token|verifiedToken|sessionToken|authToken(\s*\?\?\s*undefined)?)$/;

for (const file of scannedFiles) {
  test(`[${file}] never builds a Supabase client from a raw bearer value`, () => {
    let source = readFileSync(join(apiDir, file), 'utf8');
    // Normalize aliased client factories (`const createStorageClient =
    // createSupabaseClient;` in media.ts) so the alias is scanned too.
    for (const alias of source.matchAll(/const\s+(\w+)\s*=\s*createSupabaseClient\s*;/g)) {
      source = source.replaceAll(new RegExp(`\\b${alias[1]}\\(`, 'g'), 'createSupabaseClient(');
    }
    const callSites = [...source.matchAll(/createSupabaseClient\((?:c\.env|env)(?:,\s*([^)]*))?\)/g)];
    for (const [, arg] of callSites) {
      const trimmed = arg?.trim() ?? '';
      if (trimmed === '') continue; // anonymous client — no bearer involved
      assert.match(
        trimmed,
        SAFE_TOKEN_ARGS,
        `createSupabaseClient must receive the exchanged session (auth.token) or nothing, got: "${trimmed}"`,
      );
    }
  });
}
