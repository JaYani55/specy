import type { MiddlewareHandler } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { createLogBuffer, getWaitUntil } from '../lib/logBuffer';
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
// Long-lived cache: this lookup sits on the request hot path and each miss
// costs a Supabase REST round-trip (which itself lands in the edge logs).
// Staleness is bounded by cache invalidation on every settings write
// (see upsertLoggingConfig callers in routes/config.ts).
const LOGGING_CONFIG_TTL_MS = 300_000;

let loggingConfigCache:
  | {
      expiresAt: number;
      value: LoggingConfigValues;
    }
  | null = null;

export function invalidateLoggingConfigCache(): void {
  loggingConfigCache = null;
}

// Liveness/monitoring probes are high-frequency by definition and carry zero
// diagnostic value — logging them would be pure edge-log noise.
const MONITORING_PATH_PATTERN = /^\/api\/(health|healthz|ping|ready|live)(\/|$)/;

export function isMonitoringPath(pathname: string): boolean {
  return MONITORING_PATH_PATTERN.test(pathname);
}

// ─── Schema slug → id cache ─────────────────────────────────────────────────────

const SCHEMA_ID_CACHE_TTL_MS = 300_000;

let schemaIdCache: { expiresAt: number; byKey: Map<string, string | null> } | null = null;

export function invalidateSchemaIdCache(): void {
  schemaIdCache = null;
}

/**
 * Resolves a schema slug (api_slug or slug) to its id, cached per isolate for
 * 5 minutes. Without the cache every logged request cost one or two extra
 * Supabase REST lookups — and therefore extra edge-log entries — just for log
 * attribution. Staleness is bounded by the TTL (attribution is best-effort
 * anyway); the cache is scoped by caller kind because the lookup honours RLS.
 */
async function resolveSchemaId(
  env: Env,
  schemaSlug: string,
  lookupClient: Awaited<ReturnType<typeof createSupabaseClient>>,
  callerScope: 'user' | 'anon',
): Promise<string | null> {
  const now = Date.now();
  if (!schemaIdCache || schemaIdCache.expiresAt <= now) {
    schemaIdCache = { expiresAt: now + SCHEMA_ID_CACHE_TTL_MS, byKey: new Map() };
  }
  const cacheKey = `${callerScope}:${schemaSlug}`;
  if (schemaIdCache.byKey.has(cacheKey)) {
    return schemaIdCache.byKey.get(cacheKey) ?? null;
  }

  let schemaId: string | null = null;
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

  schemaIdCache.byKey.set(cacheKey, schemaId);
  return schemaId;
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

// ─── Buffered batch writes ─────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseClient>>;

interface AgentLogInsertRow {
  schema_id: string | null;
  schema_slug: string | null;
  operation_name: string | null;
  user_id: string | null;
  user_email: string | null;
  method: string;
  path: string;
  status_code: number;
  transport_status_code: number;
  request_body: JsonValue;
  response_body: JsonValue;
  duration_ms: number;
  ip_address: string;
  user_agent: string | null;
  error: string | null;
}

/**
 * agent_logs write buffer: rows from up to 10 requests share one batched
 * INSERT (flushed immediately at the threshold, otherwise ~1 s after the
 * first buffered row). Cuts the per-request REST insert — the biggest
 * self-generated edge-log source — to a fraction.
 */
const agentLogBuffer = createLogBuffer<AgentLogInsertRow, Env>({
  batchSize: 10,
  flushDelayMs: 1_000,
  insert: async (rows, env) => {
    const supabase = await createSupabaseClient(env);
    const { error } = await supabase.from('agent_logs').insert(rows);
    if (error) throw new Error(error.message);
  },
  onError: (error, rowCount) => {
    console.error(`[agent-logger] Failed to write log batch (${rowCount} rows):`, error);
  },
});

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

  // Skip logging for the logs management endpoints themselves (avoid recursion),
  // for sensitive secrets/connections management to prevent token leaks, and
  // for high-frequency liveness/monitoring probes (zero diagnostic value).
  if (pathname.startsWith('/api/schemas/logs') || pathname.startsWith('/api/secrets') || isMonitoringPath(pathname)) {
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

  // Resolve schema_id via the in-isolate cache (one REST lookup per uncached
  // slug instead of per request), using the verified caller's RLS context for
  // MCP traffic when available.
  let schemaId: string | null = null;
  if (schemaSlug) {
    try {
      const lookupClient: SupabaseClient = bearerToken && userId
        ? await createSupabaseClient(c.env, bearerToken)
        : await createSupabaseClient(c.env);
      schemaId = await resolveSchemaId(c.env, schemaSlug, lookupClient, userId ? 'user' : 'anon');
    } catch {
      // Attribution is best-effort — never let it break the log row or the request.
    }
  }

  // Buffer the row; the buffer flushes it as part of a batched insert.
  try {
    agentLogBuffer.push(
      {
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
      },
      c.env,
      getWaitUntil(c),
    );
  } catch (err) {
    // Never let logging break a real request
    console.error('[agent-logger] Failed to buffer log:', err);
  }
};
