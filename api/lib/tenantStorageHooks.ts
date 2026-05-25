import type { VerifiedAuthSession } from './auth';

export type TenantStorageScope = 'media' | 'files';

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