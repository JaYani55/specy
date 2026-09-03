import type { VerifiedAuthSession } from './auth';

export type TenantStorageScope = 'media' | 'files' | 'apps';

/**
 * Scopes accepted by client-facing storage endpoints (upload, list, delete).
 * 'apps' is engine-managed (PluraDash sync engine) and deliberately NOT
 * client-writable — it only exists so workspace app files can be categorized
 * in the catalog while sharing the same quota bucket.
 */
export const TENANT_STORAGE_SCOPES: readonly TenantStorageScope[] = ['media', 'files'];

export function isTenantStorageScope(value: unknown): value is TenantStorageScope {
  return typeof value === 'string' && (TENANT_STORAGE_SCOPES as readonly string[]).includes(value);
}

/**
 * Parses a client-supplied scope value (form field or query param).
 * Returns `fallback` when absent/empty, `null` when present but invalid — callers
 * should reject invalid values with HTTP 400 instead of silently coercing.
 */
export function parseTenantStorageScope(
  value: string | FormDataEntryValue | null | undefined,
  fallback: TenantStorageScope = 'media',
): TenantStorageScope | null {
  if (value === null || value === undefined || value === '') return fallback;
  return isTenantStorageScope(value) ? value : null;
}

export interface TenantStorageTenant {
  id: string;
  name: string;
  slug: string;
}

export interface TenantStorageSummary {
  tenantId: string;
  tenantName: string;
  userId: string;
  entitled: boolean;
  isUnlimited: boolean;
  quotaBytes: number | null;
  usedBytes: number;
  remainingBytes: number | null;
}

export interface TenantStoragePolicyContext {
  auth: VerifiedAuthSession;
  tenant: TenantStorageTenant;
  scope: TenantStorageScope;
  summary: TenantStorageSummary;
}

export interface TenantStorageSourceInfo {
  id: string;
  label: string;
  type: 'supabase' | 'r2' | 's3';
  configured: boolean;
  isDefault: boolean;
}

export interface TenantStorageSourcesContext {
  auth: VerifiedAuthSession | null;
  sources: TenantStorageSourceInfo[];
}

export const TENANT_STORAGE_POLICY_HOOK = 'storage.tenant.policy';
export const TENANT_STORAGE_SOURCES_HOOK = 'storage.tenant.sources';
