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

export interface Env {
  // ── Fallback vars for local `wrangler dev` (set in .dev.vars) ──────────────
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
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
  // Set via vars in wrangler.jsonc (non-sensitive)
  CF_ACCOUNT_ID?: string;
  SECRETS_STORE_ID?: string;
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

export async function createSupabaseClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create an admin/service Supabase client using the secret key.
 * Bypasses RLS — only use server-side for privileged operations.
 * Requires SS_SUPABASE_SECRET_KEY to be bound from the Secrets Store.
 * Never falls back to a plain var to prevent accidental exposure.
 */
export async function createSupabaseAdminClient(env: Env) {
  if (!env.SS_SUPABASE_SECRET_KEY) {
    throw new Error('SS_SUPABASE_SECRET_KEY is not bound. Add SUPABASE_SECRET_KEY to your Secrets Store and bind it in wrangler.jsonc.');
  }
  const key = await env.SS_SUPABASE_SECRET_KEY.get();
  return createClient(env.SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
