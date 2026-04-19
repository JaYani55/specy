import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './lib/supabase';
import schemas from './routes/schemas';
import health from './routes/health';
import logs from './routes/logs';
import mcpRoute from './routes/mcp';
import secretsRoute from './routes/secrets';
import configRoute from './routes/config';
import mediaRoute from './routes/media';
import accountsRoute from './routes/accounts';
import pluginsRoute from './routes/plugins';
import formsRoute from './routes/forms';
import specsRoute from './routes/specs';
import { mountPluginRoutes } from './plugin-routes';
import { agentLogger } from './middleware/agentLogger';

const app = new Hono<{ Bindings: Env }>();

// CORS — allow CMS and any frontend to call the API
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Root — single entry point for agents, links to discovery + MCP
app.get('/', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    service: 'specy-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: {
      schemas: `${baseUrl}/api/schemas`,
      specs: `${baseUrl}/api/specs`,
      plugins: `${baseUrl}/api/plugins`,
      mcp: `${baseUrl}/mcp`,
      mcp_discovery: `${baseUrl}/.well-known/mcp.json`,
    },
    description: 'Start at /api/specs for unified agent-readable tool discovery, /api/schemas for schema-centric discovery, or connect via /mcp for MCP tool integration.',
  });
});

app.get('/.well-known/mcp.json', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    name: 'specy',
    description: 'Specy MCP server exposed over Streamable HTTP for schema discovery, spec discovery, and frontend registration workflows.',
    version: '1.0.0',
    documentation_url: `${baseUrl}/specs/Specs_MCP_Exposition.md`,
    server: {
      url: `${baseUrl}/mcp`,
      transport: 'streamable-http',
      protocol: 'mcp',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false,
      },
    },
    discovery: {
      root_url: `${baseUrl}/`,
      specs_url: `${baseUrl}/api/specs`,
      schemas_url: `${baseUrl}/api/schemas`,
    },
    tools: [
      'list_available_tools',
      'get_spec_definition',
      'list_schemas',
      'get_schema_spec',
      'register_frontend',
      'check_health',
    ],
  });
});

// Logging middleware — logs ALL API and MCP requests (skips /api/schemas/logs internally)
app.use('/api/*', agentLogger);
app.use('/mcp', agentLogger);
app.use('/mcp/*', agentLogger);

// Mount routes (logs first — more specific path before wildcard schemas)
app.route('/api/schemas/logs', logs);
app.route('/api/schemas', schemas);
app.route('/api/schemas', health);
app.route('/api/secrets', secretsRoute);
app.route('/api/config', configRoute);
app.route('/api/media', mediaRoute);
app.route('/api/accounts', accountsRoute);
app.route('/api/plugins', pluginsRoute);
app.route('/api/forms', formsRoute);
app.route('/api/specs', specsRoute);
app.route('/mcp', mcpRoute);

// Plugin API routes (auto-wired from api/plugin-routes.ts)
mountPluginRoutes(app);

// 404 fallback
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
