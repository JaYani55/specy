/**
 * connectionsService.ts
 *
 * Client-side service for the /api/secrets proxy routes.
 * These routes live on the Hono Worker and proxied to CF Secrets Store.
 */

import { API_URL } from '@/lib/apiUrl';

export interface CfSecret {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  comment?: string;
}

export interface CfStore {
  id: string;
  name: string;
  created_at?: string;
}

// ── Known secrets manifest ──────────────────────────────────────────────────
// Defines every secret the application knows about, grouped by category.

export type SecretCategory = 'Database' | 'Storage' | 'Worker' | 'Custom';

export interface SecretDefinition {
  name: string;
  category: SecretCategory;
  description: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** Whether this secret is required for the app to work */
  required: boolean;
  /** Example / placeholder to show in the form */
  placeholder?: string;
  /** The wrangler.jsonc binding name for this secret */
  binding?: string;
}

export const SECRETS_MANIFEST: SecretDefinition[] = [
  {
    name: 'SUPABASE_URL',
    category: 'Database',
    label: 'Supabase URL',
    description: 'Your Supabase project URL. Found in your Supabase dashboard under Settings → API.',
    required: true,
    placeholder: 'https://<project-ref>.supabase.co',
    binding: 'SS_SUPABASE_URL',
  },
  {
    name: 'SUPABASE_PUBLISHABLE_KEY',
    category: 'Database',
    label: 'Supabase Publishable Key',
    description: 'Your Supabase publishable key. Row-level security enforces access control — safe to expose to the Worker.',
    required: true,
    placeholder: 'sb_publishable_...',
    binding: 'SS_SUPABASE_PUBLISHABLE_KEY',
  },
  {
    name: 'SUPABASE_SECRET_KEY',
    category: 'Database',
    label: 'Supabase Secret Key',
    description: 'Your Supabase secret key. Bypasses RLS — used server-side only for privileged operations.',
    required: true,
    placeholder: 'sb_secret_...',
    binding: 'SS_SUPABASE_SECRET_KEY',
  },
  // ── Storage ───────────────────────────────────────────────────────────────
  {
    name: 'STORAGE_PROVIDER',
    category: 'Storage',
    label: 'Storage Provider',
    description: 'Which object-storage backend to use for the media library. "supabase" uses Supabase Storage; "r2" uses a Cloudflare R2 bucket (must also be configured in wrangler.jsonc).',
    required: true,
    placeholder: 'supabase',
    binding: 'SS_STORAGE_PROVIDER',
  },
  {
    name: 'STORAGE_BUCKET',
    category: 'Storage',
    label: 'Storage Bucket',
    description: 'Bucket / container name for media uploads. For Supabase Storage this is the bucket created in your Supabase dashboard. For R2 this must match the R2 bucket name in wrangler.jsonc.',
    required: true,
    placeholder: 'booking_media',
    binding: 'SS_STORAGE_BUCKET',
  },
  {
    name: 'R2_PUBLIC_URL',
    category: 'Storage',
    label: 'R2 Public URL',
    description: 'Public CDN URL prefix for your R2 bucket (e.g. https://pub-xxx.r2.dev). Only required when STORAGE_PROVIDER is "r2".',
    required: false,
    placeholder: 'https://pub-<hash>.r2.dev',
    binding: 'SS_R2_PUBLIC_URL',
  },
];

// ── API calls ────────────────────────────────────────────────────────────────

export interface EnvStatusEntry {
  name: string;
  hasValue: boolean;
  source: 'secrets-store' | 'env-var' | 'unset';
}

interface ErrorResponse {
  error?: string;
}

export async function listSecrets(): Promise<CfSecret[]> {
  const res = await fetch(`${API_URL}/api/secrets`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { secrets: CfSecret[] };
  return data.secrets;
}

export async function getEnvStatus(): Promise<EnvStatusEntry[]> {
  const res = await fetch(`${API_URL}/api/secrets/env-status`);
  if (!res.ok) return [];
  const data = await res.json() as { status: EnvStatusEntry[] };
  return data.status ?? [];
}

export async function listStores(): Promise<CfStore[]> {
  const res = await fetch(`${API_URL}/api/secrets/stores`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { stores: CfStore[] };
  return data.stores;
}

export async function upsertSecret(name: string, value: string, comment?: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/secrets/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json' 
    },
    body: JSON.stringify({ value, comment: comment || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

// ── Media config ─────────────────────────────────────────────────────────────

export interface MediaConfig {
  provider: 'supabase' | 'r2' | 'unconfigured';
  bucket: string | null;
  configured: boolean;
  publicUrlConfigured?: boolean;
}

export async function getMediaConfig(): Promise<MediaConfig> {
  const res = await fetch(`${API_URL}/api/media/config`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<MediaConfig>;
}

export async function testMediaConnection(): Promise<{ ok: boolean; itemCount?: number; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/media/list?path=`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      return { ok: false, error: err.error ?? `HTTP ${res.status}` };
    }
    const data = await res.json() as { items: unknown[] };
    return { ok: true, itemCount: data.items?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function deleteSecret(name: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/secrets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}
