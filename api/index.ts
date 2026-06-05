import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env, ScheduledEvent, ExecutionContext } from './lib/supabase';
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
import objectsRoute from './routes/objects';
import specsRoute from './routes/specs';
import { mountPluginRoutes } from './plugin-routes';
import { agentLogger } from './middleware/agentLogger';

import { formsWithMeta, handleFormReminders } from './routes/forms';
import { objectsWithMeta } from './routes/objects';
import { injectMetaTags, MetaTags } from './lib/htmlTemplate';

const app = new Hono<{ Bindings: Env }>();

// SPA Asset Interceptor
app.get('*', async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Skip API, MCP and well-known paths
  if (path.startsWith('/api/') || path.startsWith('/mcp') || path.startsWith('/.well-known/')) {
    return next();
  }

  // Intercept share pages for Forms and Objects (including short versions)
  const formShareMatch = path.match(/^\/(?:forms\/share|s)\/([^/]+)\/([^/]+)$/);
  const objectShareMatch = path.match(/^\/(?:objects\/share|o)\/([^/]+)\/([^/]+)$/);

  if (formShareMatch || objectShareMatch) {
    const assets = c.env.ASSETS;
    if (!assets) return next();

    try {
      // For share pages, we ALWAYS want to serve index.html with injected metadata
      // because SPA assets binding in wrangler might return a 200 index.html 
      // without metadata or a 404/not-found.
      const indexResponse = await assets.fetch(new Request(new URL('/index.html', url).toString()));
      if (!indexResponse.ok) return next();
      
      const html = await indexResponse.text();
      let meta: MetaTags = { 
        title: 'Pluracon Service', 
        description: 'Pluracon Platform',
        origin: url.origin
      };

      if (formShareMatch) {
        const [_, tenantName, shareSlug] = formShareMatch;
        const data = await formsWithMeta(c.env, tenantName, shareSlug);
        if (data) {
          meta = { 
            ...meta,
            title: data.name, 
            description: data.description || 'Teilnahme an der Umfrage/Formular',
            image: data.image,
            type: 'article'
          };
        }
      } else if (objectShareMatch) {
        const [_, tenantName, shareSlug] = objectShareMatch;
        const data = await objectsWithMeta(c.env, tenantName, shareSlug);
        if (data) {
          meta = { 
            ...meta,
            title: data.name, 
            description: data.description || 'Detaillierte Informationen ansehen',
            image: data.image,
            type: 'article'
          };
        }
      }

      return c.html(injectMetaTags(html, meta));
    } catch (e) {
      console.error('SPA Metadata Injection Error:', e);
    }
  }

  return next();
});

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
      objects: `${baseUrl}/api/objects`,
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
      'list_objects',
      'get_object',
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
app.route('/api/objects', objectsRoute);
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

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const { handleFormReminders } = await import('./routes/forms');
    ctx.waitUntil(handleFormReminders(env));
  },
};

export { handleFormReminders };
