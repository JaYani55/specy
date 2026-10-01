import type { MiddlewareHandler } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { getLoggingConfig, type LoggingConfigValues } from '../lib/systemConfig';
import { parseBearerToken, verifyAuthSession } from '../lib/auth';
import { extractMcpRequestMetadata, extractMcpToolOutcome, parseMcpSseResponse } from '../lib/mcpObservability';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return null;
  }

  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token)/i;
const MAX_LOG_STRING_LENGTH = 512;
const MAX_LOG_ARRAY_ITEMS = 50;
const MAX_LOG_DEPTH = 4;
const LOGGING_CONFIG_TTL_MS = 30_000;

let loggingConfigCache:
  | {
      expiresAt: number;
      value: LoggingConfigValues;
    }
  | null = null;

export function invalidateLoggingConfigCache(): void {
  loggingConfigCache = null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathPatternToRegex(pathPattern: string): RegExp {
  const escaped = escapeRegex(pathPattern).replace(/\\:[^/]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

async function getCachedLoggingConfig(env: Env): Promise<LoggingConfigValues> {
  const now = Date.now();
  if (loggingConfigCache && loggingConfigCache.expiresAt > now) {
    return loggingConfigCache.value;
  }

  const value = await getLoggingConfig(env);
  loggingConfigCache = {
    value,
    expiresAt: now + LOGGING_CONFIG_TTL_MS,
  };
  return value;
}

async function shouldLogRequest(env: Env, method: string, pathname: string): Promise<boolean> {
  const loggingConfig = await getCachedLoggingConfig(env);
  if (loggingConfig.mode !== 'custom') {
    return true;
  }

  return loggingConfig.enabledEndpointKeys.some((entry) => {
    const separatorIndex = entry.indexOf(' ');
    if (separatorIndex <= 0) {
      return false;
    }

    const entryMethod = entry.slice(0, separatorIndex).toUpperCase();
    const pathPattern = entry.slice(separatorIndex + 1);
    return entryMethod === method.toUpperCase() && pathPatternToRegex(pathPattern).test(pathname);
  });
}

function shouldSkipBodyLogging(pathname: string): boolean {
  return /^\/api\/forms\/(share\/[^/]+\/[^/]+\/answers|[^/]+\/answers)$/.test(pathname)
    || pathname === '/api/media/upload';
}

async function readMcpSseResponse(response: Response): Promise<JsonValue | null> {
  const reader = response.clone().body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffered = '';
  const timeout = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 2000);
  try {
    while (buffered.length < 128_000) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const message = parseMcpSseResponse(buffered);
      if (message !== null) return sanitizeLogValue(message);
    }
  } catch {
    // Observability must never interrupt the actual MCP response.
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return null;
}

function sanitizeLogValue(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_LOG_STRING_LENGTH
      ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`
      : value;
  }

  if (depth >= MAX_LOG_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_LOG_ARRAY_ITEMS).map((entry) => sanitizeLogValue(entry, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return String(value);
  }

  const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return [key, '[redacted]'] as const;
    }

    return [key, sanitizeLogValue(entryValue, depth + 1)] as const;
  });

  return Object.fromEntries(sanitizedEntries);
}

/**
 * Hono middleware that logs every request/response to the agent_logs table.
 * Captures method, path, status, duration, request/response bodies, IP, and user-agent.
 */
export const agentLogger: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  const path = pathname + url.search;

  // Skip logging for the logs management endpoints themselves (avoid recursion)
  // and for sensitive secrets/connections management to prevent token leaks.
  if (pathname.startsWith('/api/schemas/logs') || pathname.startsWith('/api/secrets')) {
    return next();
  }

  if (!(await shouldLogRequest(c.env, c.req.method, pathname))) {
    return next();
  }

  const start = Date.now();
  const method = c.req.method;
  const skipBodyLogging = shouldSkipBodyLogging(pathname);

  // Extract IP and user-agent
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const userAgent = c.req.header('user-agent') || null;

  // Capture request body for POST/PUT/PATCH (JSON only — skip multipart/binary uploads
  // to avoid interfering with the body stream in Cloudflare Workers).
  let requestBody: unknown = null;
  const contentType = c.req.header('content-type') || '';
  if (!skipBodyLogging && ['POST', 'PUT', 'PATCH'].includes(method) && !contentType.includes('multipart/form-data')) {
    try {
      requestBody = sanitizeLogValue(await c.req.raw.clone().json());
    } catch {
      // Not JSON or empty body — that's fine
    }
  }

  // MCP JSON-RPC shares one transport route; capture the logical tool/method
  // separately so operational logs distinguish individual calls.
  const isMcpRequest = pathname === '/mcp' || pathname.startsWith('/mcp/');
  const mcpMetadata = isMcpRequest ? extractMcpRequestMetadata(requestBody) : null;

  // Extract schema identifier from a schema REST path or MCP tool arguments.
  let schemaSlug: string | null = mcpMetadata?.schemaIdentifier ?? null;
  if (!schemaSlug) {
    const slugMatch = pathname.match(/^\/api\/schemas\/([^/]+)/);
    if (slugMatch && slugMatch[1] !== '' && !['logs'].includes(slugMatch[1])) {
      schemaSlug = slugMatch[1];
    }
  }

  // Run the actual handler.
  await next();

  const duration = Date.now() - start;
  const transportStatus = c.res.status;

  // Capture response body (clone to avoid consuming)
  let responseBody: unknown = null;
  try {
    const ct = c.res.headers.get('content-type') || '';
    if (!skipBodyLogging && ct.includes('application/json')) {
      responseBody = sanitizeLogValue(await c.res.clone().json());
    } else if (isMcpRequest && method === 'POST' && ct.includes('text/event-stream')) {
      responseBody = await readMcpSseResponse(c.res);
    }
  } catch {
    // Skip non-JSON responses
  }

  // MCP tools can fail inside a successful HTTP/JSON-RPC exchange. Preserve
  // both statuses while making status_code reflect the operation outcome.
  const mcpOutcome = mcpMetadata?.toolName ? extractMcpToolOutcome(responseBody) : null;
  const status = mcpOutcome?.failed ? (mcpOutcome.statusCode ?? 500) : transportStatus;
  const logError = mcpOutcome?.failed
    ? mcpOutcome.error
    : status >= 400 ? extractErrorMessage(responseBody) : null;

  // Resolve the authenticated caller from a verified Supabase session. Do not
  // trust an unverified JWT payload for operational attribution.
  let userId: string | null = null;
  let userEmail: string | null = null;
  const bearerToken = isMcpRequest ? parseBearerToken(c.req.header('Authorization')) : undefined;
  if (bearerToken) {
    try {
      const session = await verifyAuthSession(c.env, bearerToken);
      if (session) {
        userId = session.userId;
        const email = session.claims.email;
        userEmail = typeof email === 'string' ? email : null;
      }
    } catch {
      // Logging must not affect request handling; anonymous/unverified is null.
    }
  }

  // Resolve schema_id with the verified caller's RLS context when available.
  let schemaId: string | null = null;

  // Fire-and-forget: write the log entry.
  try {
    const supabase = await createSupabaseClient(c.env);
    const lookupClient = bearerToken && userId
      ? await createSupabaseClient(c.env, bearerToken)
      : supabase;

    if (schemaSlug) {
      const { data: apiMatch } = await lookupClient
        .from('page_schemas')
        .select('id')
        .eq('api_slug', schemaSlug)
        .maybeSingle();
      if (apiMatch) {
        schemaId = apiMatch.id;
      } else {
        const { data: localMatches } = await lookupClient
          .from('page_schemas')
          .select('id')
          .eq('slug', schemaSlug)
          .limit(2);
        if (localMatches?.length === 1) schemaId = localMatches[0].id;
      }
    }

    await supabase.from('agent_logs').insert({
      schema_id: schemaId,
      schema_slug: schemaSlug,
      operation_name: mcpMetadata?.operationName ?? null,
      user_id: userId,
      user_email: userEmail,
      method,
      path,
      status_code: status,
      transport_status_code: transportStatus,
      request_body: requestBody as JsonValue,
      response_body: responseBody as JsonValue,
      duration_ms: duration,
      ip_address: ip,
      user_agent: userAgent,
      error: logError,
    });
  } catch (err) {
    // Never let logging break a real request
    console.error('[agent-logger] Failed to write log:', err);
  }
};
