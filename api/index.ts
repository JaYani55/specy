import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './lib/supabase';
import schemas from './routes/schemas';
import health from './routes/health';
import logs from './routes/logs';
import mcpRoute from './routes/mcp';
import secretsRoute from './routes/secrets';
import mediaRoute from './routes/media';
import pluginsRoute from './routes/plugins';
import formsRoute from './routes/forms';
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
      plugins: `${baseUrl}/api/plugins`,
      mcp: `${baseUrl}/mcp`,
    },
    description: 'Start at /api/schemas to discover available page schemas, or connect via /mcp for MCP tool integration.',
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
app.route('/api/media', mediaRoute);
app.route('/api/plugins', pluginsRoute);
app.route('/api/forms', formsRoute);
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
