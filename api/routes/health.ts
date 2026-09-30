import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { validateOutboundHttpUrl } from '../lib/urlSafety';

const health = new Hono<{ Bindings: Env }>();

// GET /api/schemas/:slug/health — Server-side domain health check
health.get('/:slug/health', async (c) => {
  const slug = c.req.param('slug');
  const supabase = await createSupabaseClient(c.env);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('frontend_url, registration_status')
    .eq('api_slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.registration_status !== 'registered' || !schema.frontend_url) {
    return c.json({
      status: 'offline' as const,
      latency_ms: 0,
      reason: 'No frontend registered',
    });
  }

  const start = Date.now();
  const validatedUrl = validateOutboundHttpUrl(schema.frontend_url);

  if (!validatedUrl.ok) {
    return c.json({
      status: 'offline' as const,
      latency_ms: 0,
      reason: validatedUrl.error,
    }, 400);
  }

  try {
    const response = await fetch(validatedUrl.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });

    const latency = Date.now() - start;

    return c.json({
      status: response.ok ? ('online' as const) : ('offline' as const),
      latency_ms: latency,
      http_status: response.status,
    });
  } catch {
    const latency = Date.now() - start;

    return c.json({
      status: 'offline' as const,
      latency_ms: latency,
      reason: 'Connection failed or timed out',
    });
  }
});

// POST /api/schemas/health/domain — Direct domain health check by URL
// Body: { url: string }
health.post('/health/domain', async (c) => {
  const body = await c.req.json<{ url?: string }>();
  const url = body.url;

  if (!url) {
    return c.json({ error: 'url is required' }, 400);
  }

  const validatedUrl = validateOutboundHttpUrl(url);
  if (!validatedUrl.ok) {
    return c.json({ error: validatedUrl.error }, 400);
  }

  const start = Date.now();

  try {
    const response = await fetch(validatedUrl.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });

    const latency = Date.now() - start;

    return c.json({
      status: response.ok ? ('online' as const) : ('offline' as const),
      latency_ms: latency,
      http_status: response.status,
      url: validatedUrl.url.toString(),
    });
  } catch {
    const latency = Date.now() - start;

    return c.json({
      status: 'offline' as const,
      latency_ms: latency,
      reason: 'Connection failed or timed out',
      url: validatedUrl.url.toString(),
    });
  }
});

export default health;
