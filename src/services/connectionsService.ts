/**
 * connectionsService.ts
 *
 * Client-side service for the /api/secrets proxy routes.
 * These routes live on the Hono Worker and proxied to CF Secrets Store.
 */

import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

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

export type SecretCategory = 'Database' | 'Worker' | 'Custom';

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

export interface SystemConfigDefinition {
  key: 'provider' | 'bucket' | 'r2PublicUrl';
  label: string;
  description: string;
  required: boolean;
  placeholder?: string;
}

export const SECRETS_MANIFEST: SecretDefinition[] = [
  {
    name: 'SUPABASE_SECRET_KEY',
    category: 'Database',
    label: 'Supabase Secret Key',
    description: 'Your Supabase secret key. Bypasses RLS — used server-side only for privileged operations.',
    required: true,
    placeholder: 'sb_secret_...',
    binding: 'SS_SUPABASE_SECRET_KEY',
  },
];

export const STORAGE_CONFIG_MANIFEST: SystemConfigDefinition[] = [
  {
    key: 'provider',
    label: 'Storage Provider',
    description: 'Which object-storage backend to use for the media library. "supabase" uses Supabase Storage; "r2" uses a Cloudflare R2 bucket binding.',
    required: true,
    placeholder: 'supabase',
  },
  {
    key: 'bucket',
    label: 'Storage Bucket',
    description: 'Bucket or container name for media uploads. For R2, this must match the Worker bucket binding configuration.',
    required: true,
    placeholder: 'booking_media',
  },
  {
    key: 'r2PublicUrl',
    label: 'R2 Public URL',
    description: 'Public CDN URL prefix for your R2 bucket. Only required when the provider is "r2".',
    required: false,
    placeholder: 'https://pub-<hash>.r2.dev',
  },
];

export interface StorageConfigSettings {
  provider: 'supabase' | 'r2' | '';
  bucket: string;
  r2PublicUrl: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

export interface EnvStatusEntry {
  name: string;
  hasValue: boolean;
  source: 'secrets-store' | 'env-var' | 'unset';
}

interface ErrorResponse {
  error?: string;
}

async function createAuthenticatedHeaders(extraHeaders?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extraHeaders);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

export async function listSecrets(): Promise<CfSecret[]> {
  const res = await fetch(`${API_URL}/api/secrets`, {
    headers: await createAuthenticatedHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { secrets: CfSecret[] };
  return data.secrets;
}

export async function getEnvStatus(): Promise<EnvStatusEntry[]> {
  const res = await fetch(`${API_URL}/api/secrets/env-status`, {
    headers: await createAuthenticatedHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json() as { status: EnvStatusEntry[] };
  return data.status ?? [];
}

export async function getStorageConfigSettings(): Promise<StorageConfigSettings> {
  const res = await fetch(`${API_URL}/api/config/storage`, {
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { storage: StorageConfigSettings };
  return data.storage;
}

export async function updateStorageConfigSettings(input: StorageConfigSettings): Promise<void> {
  const res = await fetch(`${API_URL}/api/config/storage`, {
    method: 'PUT',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

export async function listStores(): Promise<CfStore[]> {
  const res = await fetch(`${API_URL}/api/secrets/stores`, {
    headers: await createAuthenticatedHeaders(),
  });
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
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json' 
    }),
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
    headers: await createAuthenticatedHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}
