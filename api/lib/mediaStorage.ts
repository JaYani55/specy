import { createSupabaseAdminClient, type Env } from './supabase';
import { getDefaultMediaSourceMount, getMediaSourceMounts, type MediaSourceMount } from './systemConfig';

export type ResolvedMediaSourceMount = {
  id: string;
  label: string;
  type: 'supabase' | 'r2' | 's3' | 'unconfigured';
  provider: 'supabase' | 'r2' | 's3' | 'unconfigured';
  bucket: string | null;
  isDefault: boolean;
  configured: boolean;
  bindingConfigured: boolean;
  bindingName: 'MEDIA_BUCKET' | null;
  publicUrlConfigured: boolean;
  assetBaseUrl: string | null;
  r2PublicUrl: string | null;
  endpoint: string | null;
  region: string | null;
  accessKeyId: string | null;
};

export type PrimaryMediaConfig = ResolvedMediaSourceMount;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isInvalidR2PublicUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.pathname.includes('/storage/v1/object/public/')
      || parsed.pathname.includes('/storage/v1/render/image/public/');
  } catch {
    return false;
  }
}

function toBase64Url(value: Uint8Array | ArrayBuffer): string {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function importMediaSigningKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function buildMediaSignaturePayload(path: string): string {
  return `media:${path}`;
}

export function buildWorkerMediaFileUrl(requestUrl: string, path: string, sourceId?: string | null): string {
  const url = new URL('/api/media/file', requestUrl);
  if (path) {
    url.searchParams.set('path', path);
  }
  if (sourceId) {
    url.searchParams.set('source', sourceId);
  }
  return url.toString();
}

export async function buildSignedWorkerMediaFileUrl(
  env: Env,
  requestUrl: string,
  path: string,
  sourceId?: string | null,
): Promise<string> {
  const url = new URL(buildWorkerMediaFileUrl(requestUrl, path, sourceId));
  if (!env.SECRETS_ENCRYPTION_KEY) {
    return url.toString();
  }

  const key = await importMediaSigningKey(env.SECRETS_ENCRYPTION_KEY);
  const payload = new TextEncoder().encode(buildMediaSignaturePayload(path));
  const signature = await crypto.subtle.sign('HMAC', key, payload);
  url.searchParams.set('sig', toBase64Url(signature));
  return url.toString();
}

export async function verifySignedWorkerMediaFileUrl(
  env: Env,
  path: string,
  signature: string | null | undefined,
): Promise<boolean> {
  if (!env.SECRETS_ENCRYPTION_KEY || !signature) {
    return false;
  }

  try {
    const key = await importMediaSigningKey(env.SECRETS_ENCRYPTION_KEY);
    const payload = new TextEncoder().encode(buildMediaSignaturePayload(path));
    return await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), payload);
  } catch {
    return false;
  }
}

export function buildMediaMountUrl(config: ResolvedMediaSourceMount, requestUrl: string, path: string): string {
  if (config.type === 'r2') {
    if (config.r2PublicUrl && !isInvalidR2PublicUrl(config.r2PublicUrl)) {
      return `${trimTrailingSlash(config.r2PublicUrl)}/${path}`;
    }

    return buildWorkerMediaFileUrl(requestUrl, path, config.id);
  }

  if (config.type === 's3' && config.assetBaseUrl) {
    return `${trimTrailingSlash(config.assetBaseUrl)}/${path}`;
  }

  if (config.type !== 'supabase') {
    return '';
  }

  return '';
}

export function buildPrimaryMediaUrl(config: PrimaryMediaConfig, requestUrl: string, path: string): string {
  return buildMediaMountUrl(config, requestUrl, path);
}

function buildUnmountedMediaSourceMount(): ResolvedMediaSourceMount {
  return {
    id: 'unconfigured',
    label: 'Unconfigured',
    type: 'unconfigured',
    provider: 'unconfigured',
    bucket: null,
    isDefault: true,
    configured: false,
    bindingConfigured: false,
    bindingName: null,
    publicUrlConfigured: false,
    assetBaseUrl: null,
    r2PublicUrl: null,
    endpoint: null,
    region: null,
    accessKeyId: null,
  };
}

export function resolveMediaSourceMountConfig(mount: MediaSourceMount, env: Env, requestUrl?: string): ResolvedMediaSourceMount {
  if (mount.type === 'r2') {
    const rawPublicUrl = mount.publicUrl?.trim() || '';
    const publicUrl = isInvalidR2PublicUrl(rawPublicUrl) ? '' : rawPublicUrl;
    const bindingConfigured = Boolean(env.MEDIA_BUCKET);
    return {
      id: mount.id,
      label: mount.label,
      type: 'r2',
      provider: 'r2',
      bucket: mount.bucket,
      isDefault: mount.isDefault === true,
      configured: bindingConfigured,
      bindingConfigured,
      bindingName: 'MEDIA_BUCKET',
      publicUrlConfigured: Boolean(publicUrl),
      assetBaseUrl: bindingConfigured && requestUrl
        ? (publicUrl ? trimTrailingSlash(publicUrl) : buildWorkerMediaFileUrl(requestUrl, '', mount.id))
        : null,
      r2PublicUrl: publicUrl || null,
      endpoint: null,
      region: null,
      accessKeyId: null,
    };
  }

  if (mount.type === 's3') {
    const publicUrl = mount.publicUrl?.trim() || '';
    const endpoint = mount.endpoint?.trim() || '';
    const accessKeyId = mount.accessKeyId?.trim() || '';
    return {
      id: mount.id,
      label: mount.label,
      type: 's3',
      provider: 's3',
      bucket: mount.bucket,
      isDefault: mount.isDefault === true,
      configured: Boolean(endpoint && mount.bucket && accessKeyId),
      bindingConfigured: false,
      bindingName: null,
      publicUrlConfigured: Boolean(publicUrl),
      assetBaseUrl: publicUrl || null,
      r2PublicUrl: null,
      endpoint: endpoint || null,
      region: mount.region?.trim() || null,
      accessKeyId: accessKeyId || null,
    };
  }

  return {
    id: mount.id,
    label: mount.label,
    type: 'supabase',
    provider: 'supabase',
    bucket: mount.bucket,
    isDefault: mount.isDefault === true,
    configured: true,
    bindingConfigured: false,
    bindingName: null,
    publicUrlConfigured: false,
    assetBaseUrl: null,
    r2PublicUrl: null,
    endpoint: null,
    region: null,
    accessKeyId: null,
  };
}

export async function resolveAllMediaSourceMounts(env: Env, requestUrl?: string): Promise<ResolvedMediaSourceMount[]> {
  const mounts = await getMediaSourceMounts(env);
  if (mounts.length === 0) {
    return [buildUnmountedMediaSourceMount()];
  }

  return mounts.map((mount) => resolveMediaSourceMountConfig(mount, env, requestUrl));
}

export async function resolvePrimaryMediaConfig(env: Env, requestUrl?: string): Promise<PrimaryMediaConfig> {
  const mount = await getDefaultMediaSourceMount(env);
  if (!mount) {
    return buildUnmountedMediaSourceMount();
  }

  return resolveMediaSourceMountConfig(mount, env, requestUrl);
}

export async function ensureSupabaseStorageBucket(env: Env, bucketName: string): Promise<void> {
  if (!env.SS_SUPABASE_SECRET_KEY) {
    return;
  }

  try {
    const admin = await createSupabaseAdminClient(env);
    const { data: buckets, error: listError } = await admin.storage.listBuckets();
    if (listError || buckets?.find((bucket) => bucket.name === bucketName)) {
      return;
    }

    const { error: createError } = await admin.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 52428800,
    });

    if (createError) {
      console.error(`[Media] Failed to create bucket ${bucketName}: ${createError.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Secret "SUPABASE_SECRET_KEY" not found')) {
      console.error('[Media] Bucket auto-create failed:', message);
    }
  }
}