// MCP SDK integrity tests — protocol-level regression guard for the
// @modelcontextprotocol/sdk 1.27.1 → 1.32.2 security update.
//
// The repo's MCP surface (api/routes/mcp.ts) uses exactly this API shape:
//   new McpServer({ name, version })
//   server.tool(name, description, zodRawShape, handler)   // 31 tools
//   server.connect(new StreamableHTTPTransport())           // @hono/mcp
//   transport.handleRequest(c)                              // Hono context
//
// Important seam: the SDK declares zod "^3.25 || ^4.0" and resolves to the
// ROOT zod (4.6.7) — the repo passes its own zod-4 schemas into server.tool().
// These tests exercise that combination over real protocol round-trips.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { parseMcpSseResponse } from '../api/lib/mcpObservability.ts';

/** Register tools exactly like createMcpServerWithTools does. */
function registerRepoStyleTools(server) {
  // 4-arg overload with a zod raw shape (dominant form in api/routes/mcp.ts)
  server.tool(
    'specy_products_list',
    '[specy-products] List active service-product aggregates.',
    { tenant_id: z.string().uuid() },
    async ({ tenant_id }) => ({
      content: [{ type: 'text', text: JSON.stringify({ tenant_id, products: [] }) }],
    }),
  );
  // 4-arg overload with an empty shape (e.g. 'start_here')
  server.tool(
    'start_here',
    'Explain Specy.',
    {},
    async () => ({ content: [{ type: 'text', text: 'specy' }] }),
  );
  // Multi-field shape with enums/optionals, mirroring the richer repo tools
  server.tool(
    'specy_pages_schemas_update_page',
    '[specy-pages] Update page content.',
    {
      schema_slug: z.string().min(1),
      page_slug: z.string().min(1),
      visibility: z.enum(['public', 'closed']).optional(),
      expected_content_revision: z.number().int().positive(),
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }),
  );
}

describe('MCP SDK 1.32.x — InMemory protocol round-trip (repo API shape)', () => {
  it('negotiates, lists tools with generated schemas, and calls a tool with zod-4 input validation', async () => {
    const server = new McpServer({ name: 'specy-test', version: '0.0.0' });
    registerRepoStyleTools(server);
    const client = new Client({ name: 'integrity-client', version: '0.0.0' });

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // tools/list — the repo's agent-facing surface must stay intact
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['specy_pages_schemas_update_page', 'specy_products_list', 'start_here']);

    // zod-4 schemas must be converted into valid JSON Schema for clients
    const products = tools.tools.find((t) => t.name === 'specy_products_list');
    assert.equal(products.inputSchema.type, 'object');
    assert.ok(products.inputSchema.properties.tenant_id, 'uuid field must appear in inputSchema');

    // tools/call with valid arguments — handler receives PARSED args
    const result = await client.callTool({
      name: 'specy_products_list',
      arguments: { tenant_id: '123e4567-e89b-12d3-a456-426614174000' },
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.tenant_id, '123e4567-e89b-12d3-a456-426614174000');

    // empty-shape tool
    const here = await client.callTool({ name: 'start_here', arguments: {} });
    assert.equal(here.content[0].text, 'specy');
  });

  it('rejects invalid zod-4 input as an isError tool result (SDK 1.32 contract)', async () => {
    const server = new McpServer({ name: 'specy-test', version: '0.0.0' });
    registerRepoStyleTools(server);
    const client = new Client({ name: 'integrity-client', version: '0.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // SDK >= 1.31 reports input-validation failures as an isError CallToolResult
    // (not a JSON-RPC error). api/lib/mcpObservability.ts handles this path.
    const bad = await client.callTool({
      name: 'specy_products_list',
      arguments: { tenant_id: 'not-a-uuid' },
    });
    assert.equal(bad.isError, true);
    assert.ok(bad.content[0].text.includes('-32602') && bad.content[0].text.includes('tenant_id'));

    // missing required field in the multi-field tool
    const missing = await client.callTool({
      name: 'specy_pages_schemas_update_page',
      arguments: { schema_slug: 'blog' },
    });
    assert.equal(missing.isError, true);
    assert.ok(missing.content[0].text.includes('expected_content_revision'));
  });

  it('reports tool errors as isError results (repo mcpToolFailure contract)', async () => {
    const server = new McpServer({ name: 'specy-test', version: '0.0.0' });
    server.tool('failing_tool', 'Always fails.', {}, async () => {
      throw new Error('Schema not found');
    });
    const client = new Client({ name: 'integrity-client', version: '0.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'failing_tool', arguments: {} });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Schema not found'));
  });
});

describe('MCP SDK 1.32.x — @hono/mcp StreamableHTTPTransport (production wiring)', () => {
  it('serves initialize → tools/list → tools/call over Streamable HTTP like api/routes/mcp.ts', async () => {
    const app = new Hono();
    app.all('/mcp', async (c) => {
      // Mirrors api/routes/mcp.ts: fresh server + transport per connection
      const transport = new StreamableHTTPTransport();
      const server = new McpServer({ name: 'specy', version: '0.0.0' });
      registerRepoStyleTools(server);
      await server.connect(transport);
      return transport.handleRequest(c);
    });

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };

    // 1. initialize
    const initRes = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'integrity-client', version: '0.0.0' },
        },
      }),
    });
    assert.equal(initRes.status, 200);
    // @hono/mcp 0.2.x runs stateless: the session header is optional.
    const sessionId = initRes.headers.get('mcp-session-id');
    const initMsg = parseMcpSseResponse(await initRes.text());
    assert.equal(initMsg.result.serverInfo.name, 'specy');
    assert.equal(initMsg.result.protocolVersion, '2025-06-18');

    const sessionHeaders = sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers;

    // 2. notifications/initialized + tools/list
    await app.request('/mcp', {
      method: 'POST', headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    const listRes = await app.request('/mcp', {
      method: 'POST', headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(listRes.status, 200);
    const listMsg = parseMcpSseResponse(await listRes.text());
    const toolNames = listMsg.result.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ['specy_pages_schemas_update_page', 'specy_products_list', 'start_here']);

    // 3. tools/call round-trip with zod-4-validated input
    const callRes = await app.request('/mcp', {
      method: 'POST', headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'specy_products_list',
          arguments: { tenant_id: '123e4567-e89b-12d3-a456-426614174000' },
        },
      }),
    });
    assert.equal(callRes.status, 200);
    const callMsg = parseMcpSseResponse(await callRes.text());
    assert.equal(callMsg.result.isError, undefined);
    assert.equal(JSON.parse(callMsg.result.content[0].text).tenant_id, '123e4567-e89b-12d3-a456-426614174000');

    // 4. invalid input → isError result inside HTTP 200 (SDK 1.32 contract)
    const badRes = await app.request('/mcp', {
      method: 'POST', headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'specy_products_list', arguments: { tenant_id: 'nope' } },
      }),
    });
    assert.equal(badRes.status, 200);
    const badMsg = parseMcpSseResponse(await badRes.text());
    assert.equal(badMsg.result?.isError, true, 'invalid input must surface as isError result');
    assert.ok(badMsg.result?.content?.[0]?.text?.includes('tenant_id'));

    // 5. GET discovery without session must not hang or 500 (repo exposes a GET description)
    const getRes = await app.request('/mcp', { method: 'GET', headers: { accept: 'text/event-stream' } });
    assert.ok([200, 400, 404, 405, 406].includes(getRes.status), `GET /mcp returned ${getRes.status}`);
  });
});
