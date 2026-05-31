import type { PluginHookContribution } from '../../src/types/plugin';
import type { VerifiedAuthSession } from './auth';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';
import { buildSignedWorkerMediaFileUrl } from './mediaStorage';
import {
  TENANT_STORAGE_POLICY_HOOK,
  TENANT_STORAGE_SOURCES_HOOK,
  type TenantStoragePolicyContext,
  type TenantStorageScope,
  type TenantStorageSourceInfo,
  type TenantStorageSourcesContext,
  type TenantStorageSummary,
  type TenantStorageTenant,
} from './tenantStorageHooks';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from './supabase';

interface TenantRow extends TenantStorageTenant {
  default_for_user_id: string | null;
}

interface StorageAllocationRow {
  tenant_id: string;
  user_id: string;
  quota_bytes: number;
  used_bytes_cached: number;
  status: 'active' | 'suspended';
}

export interface TenantStorageObjectRow {
  id: string;
  tenant_id: string;
  user_id: string;
  source_mount_id: string;
  scope: TenantStorageScope;
  folder_path: string;
  object_key: string;
  filename: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
}

export interface TenantStorageItem {
  id?: string;
  name: string;
  path: string;
  url: string;
  isFolder: boolean;
  size?: number;
  createdAt?: string;
}

const DEFAULT_HOOK_ORDER = 100;

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

function getApiPluginHooks(target: string): PluginHookContribution[] {
  return getRegisteredApiPluginHooks().filter((hook) => hook.target === target);
}

async function runTenantStoragePolicyHooks(context: TenantStoragePolicyContext): Promise<TenantStoragePolicyContext> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(TENANT_STORAGE_POLICY_HOOK))) {
    nextContext = await hook.handler(nextContext) as TenantStoragePolicyContext;
  }

  return nextContext;
}

export async function filterTenantStorageSources(
  auth: VerifiedAuthSession | null,
  sources: TenantStorageSourceInfo[],
): Promise<TenantStorageSourceInfo[]> {
  let context: TenantStorageSourcesContext = { auth, sources };

  for (const hook of sortHooks(getApiPluginHooks(TENANT_STORAGE_SOURCES_HOOK))) {
    context = await hook.handler(context) as TenantStorageSourcesContext;
  }

  return context.sources;
}

export function normalizeTenantStorageFolderPath(path: string | null | undefined): string {
  if (!path) {
    return '';
  }

  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join('/');
}

function sanitizeFilename(filename: string): string {
  return sanitizePathSegment(filename) || 'file';
}

async function resolveTenant(env: Env, auth: VerifiedAuthSession, requestedTenantId?: string | null): Promise<TenantRow> {
  if (!auth.userId) {
    throw new Error('Authenticated user id is required.');
  }

  const supabase = await createSupabaseClient(env, auth.token);
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug, default_for_user_id')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const tenants = (data ?? []) as TenantRow[];
  if (tenants.length === 0) {
    throw new Error('No visible tenant found for the current user.');
  }

  if (requestedTenantId) {
    const requestedTenant = tenants.find((tenant) => tenant.id === requestedTenantId);
    if (requestedTenant) {
      return requestedTenant;
    }
  }

  const defaultTenant = tenants.find((tenant) => tenant.default_for_user_id === auth.userId);
  return defaultTenant ?? tenants[0];
}

async function readTenantStorageUsageBytes(env: Env, tenantId: string, userId: string): Promise<number> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('tenant_storage_objects')
    .select('size_bytes')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce((total, row) => total + Number((row as { size_bytes?: number }).size_bytes ?? 0), 0);
}

export async function ensureTenantStorageSummary(
  env: Env,
  auth: VerifiedAuthSession,
  input: { requestedTenantId?: string | null; scope: TenantStorageScope },
): Promise<TenantStorageSummary> {
  if (!auth.userId) {
    throw new Error('Authenticated user id is required.');
  }

  const tenant = await resolveTenant(env, auth, input.requestedTenantId);
  const baseSummary: TenantStorageSummary = {
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: auth.userId,
    entitled: false,
    isUnlimited: false,
    quotaBytes: 0,
    usedBytes: 0,
    remainingBytes: 0,
  };

  const hookContext = await runTenantStoragePolicyHooks({
    auth,
    tenant,
    scope: input.scope,
    summary: baseSummary,
  });

  const configuredSummary = hookContext.summary;

  if (configuredSummary.isUnlimited) {
    const usedBytes = await readTenantStorageUsageBytes(env, tenant.id, auth.userId);
    return {
      ...configuredSummary,
      tenantId: tenant.id,
      tenantName: tenant.name,
      userId: auth.userId,
      entitled: true,
      isUnlimited: true,
      quotaBytes: null,
      usedBytes,
      remainingBytes: null,
    };
  }

  if (!configuredSummary.entitled) {
    return {
      ...baseSummary,
      ...configuredSummary,
      tenantId: tenant.id,
      tenantName: tenant.name,
      userId: auth.userId,
      quotaBytes: configuredSummary.quotaBytes ?? 0,
      usedBytes: 0,
      remainingBytes: configuredSummary.remainingBytes ?? 0,
    };
  }

  const admin = await createSupabaseAdminClient(env);
  const { data: existing, error: existingError } = await admin
    .from('tenant_storage_allocations')
    .select('tenant_id, user_id, quota_bytes, used_bytes_cached, status')
    .eq('tenant_id', tenant.id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const configuredQuotaBytes = Number(configuredSummary.quotaBytes ?? 0);
  let allocation = existing as StorageAllocationRow | null;

  if (!allocation) {
    const { data: inserted, error: insertError } = await admin
      .from('tenant_storage_allocations')
      .insert({
        tenant_id: tenant.id,
        user_id: auth.userId,
        quota_bytes: configuredQuotaBytes,
        used_bytes_cached: 0,
        status: 'active',
        provisioned_by: auth.userId,
      })
      .select('tenant_id, user_id, quota_bytes, used_bytes_cached, status')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    allocation = inserted as StorageAllocationRow;
  }

  const usedBytes = Number(allocation.used_bytes_cached ?? 0);
  const quotaBytes = Number(allocation.quota_bytes ?? configuredQuotaBytes);

  return {
    ...configuredSummary,
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: auth.userId,
    entitled: allocation.status === 'active',
    isUnlimited: false,
    quotaBytes,
    usedBytes,
    remainingBytes: Math.max(quotaBytes - usedBytes, 0),
  };
}

export function buildTenantStorageObjectKey(input: {
  tenantId: string;
  userId: string;
  scope: TenantStorageScope;
  folderPath?: string;
  filename: string;
}): { objectKey: string; folderPath: string; filename: string } {
  const folderPath = normalizeTenantStorageFolderPath(input.folderPath);
  const safeFilename = sanitizeFilename(input.filename);
  const prefix = `tenant/${input.tenantId}/user/${input.userId}/${input.scope}`;
  const uniqueFilename = `${crypto.randomUUID()}-${safeFilename}`;
  const objectKey = folderPath
    ? `${prefix}/${folderPath}/${uniqueFilename}`
    : `${prefix}/${uniqueFilename}`;

  return {
    objectKey,
    folderPath,
    filename: safeFilename,
  };
}

export async function registerTenantStorageObject(
  env: Env,
  auth: VerifiedAuthSession,
  input: {
    tenantId: string;
    scope: TenantStorageScope;
    sourceMountId: string;
    folderPath: string;
    objectKey: string;
    filename: string;
    contentType: string | null;
    sizeBytes: number;
  },
): Promise<TenantStorageObjectRow> {
  if (!auth.userId) {
    throw new Error('Authenticated user id is required.');
  }

  const client = await createSupabaseClient(env, auth.token);
  const { data, error } = await client
    .from('tenant_storage_objects')
    .insert({
      tenant_id: input.tenantId,
      user_id: auth.userId,
      scope: input.scope,
      source_mount_id: input.sourceMountId,
      folder_path: input.folderPath,
      object_key: input.objectKey,
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      created_by: auth.userId,
    })
    .select('id, tenant_id, user_id, source_mount_id, scope, folder_path, object_key, filename, content_type, size_bytes, created_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as TenantStorageObjectRow;
}

export async function listTenantStorageItems(
  env: Env,
  auth: VerifiedAuthSession,
  input: {
    tenantId?: string | null;
    scope: TenantStorageScope;
    folderPath?: string | null;
    requestUrl: string;
  },
): Promise<{ summary: TenantStorageSummary; items: TenantStorageItem[] }> {
  const summary = await ensureTenantStorageSummary(env, auth, {
    requestedTenantId: input.tenantId,
    scope: input.scope,
  });
  const targetFolderPath = normalizeTenantStorageFolderPath(input.folderPath);

  if (!summary.entitled && !summary.isUnlimited) {
    return { summary, items: [] };
  }

  const client = await createSupabaseClient(env, auth.token);
  const { data, error } = await client
    .from('tenant_storage_objects')
    .select('id, tenant_id, user_id, source_mount_id, scope, folder_path, object_key, filename, content_type, size_bytes, created_at')
    .eq('tenant_id', summary.tenantId)
    .eq('user_id', summary.userId)
    .eq('scope', input.scope)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TenantStorageObjectRow[];
  const folders = new Map<string, TenantStorageItem>();
  const files: TenantStorageItem[] = [];

  for (const row of rows) {
    const rowFolderPath = normalizeTenantStorageFolderPath(row.folder_path);
    if (rowFolderPath === targetFolderPath) {
      if (row.filename === '.placeholder') {
        continue;
      }

      files.push({
        id: row.id,
        name: row.filename,
        path: row.object_key,
        url: await buildSignedWorkerMediaFileUrl(env, input.requestUrl, row.object_key),
        isFolder: false,
        size: row.size_bytes,
        createdAt: row.created_at,
      });
      continue;
    }

    const prefix = targetFolderPath ? `${targetFolderPath}/` : '';
    if (!rowFolderPath.startsWith(prefix)) {
      continue;
    }

    const remainder = rowFolderPath.slice(prefix.length);
    const nextFolder = remainder.split('/')[0];
    if (!nextFolder) {
      continue;
    }

    if (!folders.has(nextFolder)) {
      const folderPath = prefix ? `${prefix}${nextFolder}` : nextFolder;
      folders.set(nextFolder, {
        name: nextFolder,
        path: folderPath,
        url: '',
        isFolder: true,
      });
    }
  }

  const items = [
    ...Array.from(folders.values()).sort((left, right) => left.name.localeCompare(right.name)),
    ...files.sort((left, right) => left.name.localeCompare(right.name)),
  ];

  return { summary, items };
}

export async function getTenantStorageObjectByKey(
  env: Env,
  auth: VerifiedAuthSession,
  objectKey: string,
  scope?: TenantStorageScope,
): Promise<TenantStorageObjectRow | null> {
  const client = await createSupabaseClient(env, auth.token);
  let query = client
    .from('tenant_storage_objects')
    .select('id, tenant_id, user_id, source_mount_id, scope, folder_path, object_key, filename, content_type, size_bytes, created_at')
    .eq('object_key', objectKey)
    .limit(1);

  if (scope) {
    query = query.eq('scope', scope);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? [])[0] as TenantStorageObjectRow | undefined) ?? null;
}

export async function getManagedTenantStorageObjectByKey(
  env: Env,
  objectKey: string,
  scope?: TenantStorageScope,
): Promise<TenantStorageObjectRow | null> {
  const admin = await createSupabaseAdminClient(env);
  let query = admin
    .from('tenant_storage_objects')
    .select('id, tenant_id, user_id, source_mount_id, scope, folder_path, object_key, filename, content_type, size_bytes, created_at')
    .eq('object_key', objectKey)
    .limit(1);

  if (scope) {
    query = query.eq('scope', scope);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? [])[0] as TenantStorageObjectRow | undefined) ?? null;
}

export async function isManagedTenantStorageObject(env: Env, objectKey: string): Promise<boolean> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('tenant_storage_objects')
    .select('id')
    .eq('object_key', objectKey)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.length);
}

export async function isManagedTenantStorageObjectInScope(
  env: Env,
  objectKey: string,
  scope: TenantStorageScope,
): Promise<boolean> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('tenant_storage_objects')
    .select('id')
    .eq('object_key', objectKey)
    .eq('scope', scope)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.length);
}

export async function deleteTenantStorageObject(env: Env, auth: VerifiedAuthSession, objectKey: string): Promise<void> {
  const row = await getTenantStorageObjectByKey(env, auth, objectKey);
  if (!row) {
    throw new Error('Storage object not found.');
  }

  await env.MEDIA_BUCKET?.delete(row.object_key);

  const client = await createSupabaseClient(env, auth.token);
  const { error } = await client
    .from('tenant_storage_objects')
    .delete()
    .eq('id', row.id);

  if (error) {
    throw new Error(error.message);
  }
}

export function assertTenantStorageAccess(summary: TenantStorageSummary): void {
  if (summary.entitled || summary.isUnlimited) {
    return;
  }

  throw new Error('Managed tenant storage is not available for this account.');
}

export function assertTenantStorageQuota(summary: TenantStorageSummary, bytesToAdd: number): void {
  assertTenantStorageAccess(summary);

  if (summary.isUnlimited) {
    return;
  }

  const remainingBytes = summary.remainingBytes ?? 0;
  if (bytesToAdd > remainingBytes) {
    throw new Error('Storage quota exceeded.');
  }
}