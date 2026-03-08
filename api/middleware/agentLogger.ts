import type { MiddlewareHandler } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * Hono middleware that logs every request/response to the agent_logs table.
 * Captures method, path, status, duration, request/response bodies, IP, and user-agent.
 */
export const agentLogger: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;

  // Skip logging for the logs management endpoints themselves (avoid recursion)
  if (url.pathname.startsWith('/api/schemas/logs')) {
    return next();
  }

  const start = Date.now();
  const method = c.req.method;

  // Extract IP and user-agent
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const userAgent = c.req.header('user-agent') || null;

  // Capture request body for POST/PUT/PATCH (JSON only — skip multipart/binary uploads
  // to avoid interfering with the body stream in Cloudflare Workers).
  let requestBody: unknown = null;
  const contentType = c.req.header('content-type') || '';
  if (['POST', 'PUT', 'PATCH'].includes(method) && !contentType.includes('multipart/form-data')) {
    try {
      requestBody = await c.req.raw.clone().json();
    } catch {
      // Not JSON or empty body — that's fine
    }
  }

  // Extract schema slug from path if present  (e.g. /api/schemas/:slug/...)
  let schemaSlug: string | null = null;
  const slugMatch = path.match(/^\/api\/schemas\/([^/]+)/);
  if (slugMatch && slugMatch[1] !== '' && !['logs'].includes(slugMatch[1])) {
    schemaSlug = slugMatch[1];
  }

  // Run the actual handler
  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  // Capture response body (clone to avoid consuming)
  let responseBody: unknown = null;
  try {
    const ct = c.res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      responseBody = await c.res.clone().json();
    }
  } catch {
    // Skip non-JSON responses
  }

  // Resolve schema_id from slug if we have one
  let schemaId: string | null = null;

  // Fire-and-forget: write the log entry
  try {
    const supabase = await createSupabaseClient(c.env);

    if (schemaSlug) {
      const { data } = await supabase
        .from('page_schemas')
        .select('id')
        .eq('slug', schemaSlug)
        .single();
      if (data) schemaId = data.id;
    }

    await supabase.from('agent_logs').insert({
      schema_id: schemaId,
      schema_slug: schemaSlug,
      method,
      path,
      status_code: status,
      request_body: requestBody as any,
      response_body: responseBody as any,
      duration_ms: duration,
      ip_address: ip,
      user_agent: userAgent,
      error: status >= 400 ? (typeof responseBody === 'object' && responseBody && 'error' in responseBody ? (responseBody as any).error : null) : null,
    });
  } catch (err) {
    // Never let logging break a real request
    console.error('[agent-logger] Failed to write log:', err);
  }
};
