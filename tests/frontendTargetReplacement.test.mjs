import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mcpRoute = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');
const schemasRoute = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
const registrationLib = readFileSync(new URL('../api/lib/schemaRegistration.ts', import.meta.url), 'utf8');

describe('frontend-target replacement contract', () => {
  it('MCP tool must not self-fetch its own public URL for target replacement', () => {
    // Worker-to-self HTTP subrequests through the Cloudflare proxy can fail
    // with 522 while the API itself is healthy; target replacement must run
    // in-process against Supabase.
    assert.doesNotMatch(mcpRoute, /fetch\(`\$\{baseUrl\}\/api\/schemas\/.*frontend-targets`/);
  });

  it('REST route and MCP tool share one replacement implementation', () => {
    assert.match(registrationLib, /export async function replaceSchemaFrontendTargets/);
    assert.match(registrationLib, /replace_schema_frontend_targets/);
    assert.match(schemasRoute, /replaceSchemaFrontendTargets\(c\.env, slug, body\.targets, auth\.token\)/);
    assert.match(mcpRoute, /replaceSchemaFrontendTargets\(env, schema_slug, targets, authToken!\)/);
  });

  it('replacement validates inputs and enforces exactly one primary target', () => {
    assert.match(registrationLib, /Targets must define exactly one enabled primary target/);
    // The single-detail-target rule was relaxed: a public detail route and a
    // separate non-public preview route (supports_preview: true) coexist, with
    // unique host_path per schema enforced instead.
    assert.match(registrationLib, /duplicate enabled detail-page host_path/);
    assert.doesNotMatch(registrationLib, /at most one enabled detail-page target/);
  });
});
