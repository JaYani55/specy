import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  extractMcpRequestMetadata,
  extractMcpToolOutcome,
} from '../api/lib/mcpObservability.ts';

test('identifies MCP tool calls by logical name and extracts their schema identifier', () => {
  const metadata = extractMcpRequestMetadata({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'specy_pages_schemas_update_system_data',
      arguments: { schema_slug: 'blog', frontend_url: 'https://example.com' },
    },
  });

  assert.deepEqual(metadata, {
    operationName: 'tools/call:specy_pages_schemas_update_system_data',
    toolName: 'specy_pages_schemas_update_system_data',
    schemaIdentifier: 'blog',
  });
});

test('uses the inner tool status when an MCP tool fails inside HTTP 200', () => {
  const outcome = extractMcpToolOutcome({
    jsonrpc: '2.0',
    result: {
      isError: true,
      structuredContent: { error: 'Schema not found', http_status: 404 },
      content: [{ type: 'text', text: '{"error":"Schema not found","http_status":404}' }],
    },
  });

  assert.deepEqual(outcome, { failed: true, statusCode: 404, error: 'Schema not found' });
});

test('recognizes legacy MCP tools that returned an error payload without isError', () => {
  const outcome = extractMcpToolOutcome({
    result: { content: [{ type: 'text', text: '{"error":"RLS denied","http_status":403}' }] },
  });

  assert.deepEqual(outcome, { failed: true, statusCode: 403, error: 'RLS denied' });
});

test('keeps successful MCP tool responses successful', () => {
  const outcome = extractMcpToolOutcome({
    result: { content: [{ type: 'text', text: '{"success":true}' }] },
  });
  assert.deepEqual(outcome, { failed: false, statusCode: null, error: null });
});

test('MCP page management requires OAuth while published page delivery remains intentionally public', () => {
  const mcpSource = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');
  const schemaSource = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
  assert.match(mcpSource, /if \(!authSession && c\.req\.method === 'POST'\)/);
  assert.match(mcpSource, /if \(isAuthenticated\) \{/);
  assert.match(schemaSource, /schemas\.get\('\/:slug\/pages', async \(c\) =>/);
  assert.match(schemaSource, /\.eq\('status', 'published'\)/);
  assert.match(schemaSource, /schemas\.patch\('\/:slug\/system-data'/);
});
