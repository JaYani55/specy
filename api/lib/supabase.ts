import { createClient } from '@supabase/supabase-js';

/**
 * Cloudflare Secrets Store binding — the value is fetched asynchronously.
 * See: https://developers.cloudflare.com/secrets-store/
 */
export interface SecretsStoreBinding {
  get(): Promise<string>;
}

/**
 * Minimal subset of the Cloudflare R2Bucket Workers binding.
 * Avoids a hard dependency on @cloudflare/workers-types for projects that
 * don't install them.  Extend as needed.
 */
export interface R2Bucket {
  list(options?: { prefix?: string; delimiter?: string; limit?: number }): Promise<R2Objects>;
  put(key: string, value: ArrayBuffer | ReadableStream | ArrayBufferView | string | null | Blob, options?: { httpMetadata?: { contentType?: string } }): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
}
export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  delimitedPrefixes: string[];
}
export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}
export interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

/**
 * Minimal Cloudflare Workers KV binding interface.
 * Avoids a hard dependency on @cloudflare/workers-types for projects that
 * don't install them. Extend as needed.
 *
 * Provisioned by the setup wizard and bound to the generated wrangler.jsonc
 * (NEVER wrangler.default.jsonc). The Isibot Flow Builder (PluraDash plugin)
 * is the only consumer in v1.
 */
export interface KVNamespace {
  /**
   * Read a value. The return type narrows based on the `type` option:
   *   - type: 'text'    → string | null
   *   - type: 'json'    → unknown | null
   *   - type: 'arrayBuffer' → ArrayBuffer | null
   *   - type: 'stream'  → ReadableStream | null
   *   - omitted         → string | null  (default in CF Workers is text)
   */
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream | ArrayBufferView | null, options?: { expirationTtl?: number; metadata?: Record<string, unknown> | null }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string; metadata?: Record<string, unknown> | null }>; list_complete: boolean; cursor?: string }>;
}

export interface Fetcher {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Minimal Cloudflare Workers Queue binding interface.
 * See: https://developers.cloudflare.com/queues/platform/javascript-apis/
 */
export interface Queue<Body = unknown> {
  send(body: Body, options?: { contentType?: 'text' | 'bytes' | 'json' | 'v8'; delaySeconds?: number }): Promise<void>;
  sendBatch(messages: Iterable<{ body: Body; contentType?: 'text' | 'bytes' | 'json' | 'v8'; delaySeconds?: number }>): Promise<void>;
}

export interface Env {
  // ── SPA Assets binding ─────────────────────────────────────────────────────
  ASSETS?: Fetcher;

  // ── App URLs ───────────────────────────────────────────────────────────────
  APP_URL?: string;

  // ── Fallback vars for local `wrangler dev` (set in .dev.vars) ──────────────
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  STORAGE_PROVIDER?: string;
  STORAGE_BUCKET?: string;
  R2_PUBLIC_URL?: string;
  // NOTE: SUPABASE_SECRET_KEY is intentionally NOT a plain var fallback.
  // It must only be bound from the Secrets Store (SS_SUPABASE_SECRET_KEY)
  // to prevent it ever being set unencrypted in wrangler.jsonc.
  ENVIRONMENT: string;

  // ── Secrets Store bindings (production) ────────────────────────────────────
  // These override the plain vars when present (bound via wrangler.jsonc secrets_store_secrets)
  SS_SUPABASE_URL?: SecretsStoreBinding;
  SS_SUPABASE_PUBLISHABLE_KEY?: SecretsStoreBinding;
  SS_SUPABASE_SECRET_KEY?: SecretsStoreBinding;
  // Media storage
  SS_STORAGE_PROVIDER?: SecretsStoreBinding; // 'supabase' | 'r2'
  SS_STORAGE_BUCKET?: SecretsStoreBinding;   // bucket / container name
  SS_R2_PUBLIC_URL?: SecretsStoreBinding;    // R2 public CDN URL prefix

  // ── Cloudflare R2 bucket binding (optional, only when STORAGE_PROVIDER=r2) ──
  // Bound via r2_buckets in wrangler.jsonc
  MEDIA_BUCKET?: R2Bucket;

  // ── Cloudflare management credentials ──────────────────────────────────────
  // Used by the /api/secrets routes to call the CF REST API.
  // Set via: npx wrangler secret put CF_API_TOKEN
  CF_API_TOKEN?: string;
  // Used by the managed secret provider to encrypt dynamic secrets stored in the database.
  SECRETS_ENCRYPTION_KEY?: string;
  // Set via vars in wrangler.jsonc (non-sensitive)
  CF_ACCOUNT_ID?: string;
  SECRETS_STORE_ID?: string;

  // ── Local Dev Fallbacks ──────────────────────────────────────────────────
  // These allow using plain vars in .dev.vars when Secrets Store is not used
  SUPABASE_SECRET_KEY?: string;
}

/**
 * Resolve a secret: prefer Secrets Store binding (production), fall back to plain string var (local dev).
 */
export async function resolveSecret(binding: SecretsStoreBinding | undefined, fallback: string): Promise<string> {
  if (binding) {
    try {
      return await binding.get();
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Create a user-scoped Supabase client.
 * Pass the caller's Bearer token as the second argument to activate RLS (auth.uid() etc.).
 * Omit the token only for intentionally unauthenticated operations (e.g. public reads, logging).
 */
export async function createSupabaseClient(env: Env, token?: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

/**
 * Create an admin/service Supabase client using the secret key.
 * Bypasses RLS — only use server-side for privileged operations.
 * Requires SS_SUPABASE_SECRET_KEY to be bound from the Secrets Store.
 * Never falls back to a plain var to prevent accidental exposure.
 */
export async function createSupabaseAdminClient(env: Env) {
  // 1. Prefer Secrets Store binding (standard for this project in production)
  if (env.SS_SUPABASE_SECRET_KEY) {
    const key = await env.SS_SUPABASE_SECRET_KEY.get();
    return createClient(env.SUPABASE_URL, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  // 2. Fall back to plain env var (common for local `wrangler dev` with .dev.vars)
  if (env.SUPABASE_SECRET_KEY) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  throw new Error('SS_SUPABASE_SECRET_KEY is not bound and SUPABASE_SECRET_KEY fallback is missing.');
}
