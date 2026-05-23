import { createSupabaseAdminClient, type Env } from './supabase';

const CORE_NAMESPACE = 'core';
const MAIL_NAMESPACE = 'mail';
const LOGGING_NAMESPACE = 'logging';

type CoreConfigKey = 'storage.provider' | 'storage.bucket' | 'storage.r2_public_url' | 'media.extra_sources' | 'media.source_mounts';
type MailConfigKey =
  | 'provider'
  | 'from_name'
  | 'from_email'
  | 'reply_to_email'
  | 'smtp_host'
  | 'smtp_port'
  | 'smtp_secure'
  | 'smtp_username';
type LoggingConfigKey = 'mode' | 'enabled_endpoints';

const ENV_FALLBACKS: Partial<Record<CoreConfigKey, keyof Env>> = {
  'storage.provider': 'STORAGE_PROVIDER',
  'storage.bucket': 'STORAGE_BUCKET',
  'storage.r2_public_url': 'R2_PUBLIC_URL',
};

export interface StorageConfigValues {
  provider: 'supabase' | 'r2' | '';
  bucket: string;
  r2PublicUrl: string;
}

export type MediaSourceType = 'supabase' | 'r2' | 's3';

export interface MediaSourceMount {
  id: string;
  label: string;
  type: MediaSourceType;
  bucket: string;
  isDefault?: boolean;
  endpoint?: string;
  region?: string;
  publicUrl?: string;
  accessKeyId?: string;
}

/**
 * An additional S3-compatible media source configured by the operator.
 * Credentials (secret access key) are stored separately in managed_secrets.
 */
export interface ExtraMediaSource {
  /** URL-safe slug identifier, e.g. "aws-photos" */
  id: string;
  /** Display name shown in the media picker */
  label: string;
  type: 's3';
  /** S3 endpoint URL, e.g. "https://s3.amazonaws.com" or custom */
  endpoint: string;
  bucket: string;
  region: string;
  /** Base public URL for generating file links */
  publicUrl: string;
  /** Access Key ID (non-sensitive) */
  accessKeyId: string;
}

function trimString(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMount(value: unknown): MediaSourceMount | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const mount = value as Partial<MediaSourceMount>;
  if (typeof mount.id !== 'string' || typeof mount.label !== 'string' || typeof mount.bucket !== 'string') {
    return null;
  }

  if (mount.type !== 'supabase' && mount.type !== 'r2' && mount.type !== 's3') {
    return null;
  }

  const normalized: MediaSourceMount = {
    id: mount.id,
    label: mount.label,
    type: mount.type,
    bucket: mount.bucket,
  };

  if (typeof mount.isDefault === 'boolean') {
    normalized.isDefault = mount.isDefault;
  }

  if (mount.type === 'r2' || mount.type === 's3') {
    normalized.publicUrl = trimString(mount.publicUrl);
  }

  if (mount.type === 's3') {
    normalized.endpoint = trimString(mount.endpoint);
    normalized.region = trimString(mount.region);
    normalized.accessKeyId = trimString(mount.accessKeyId);
  }

  return normalized;
}

function normalizeMounts(mounts: MediaSourceMount[]): MediaSourceMount[] {
  const deduped = Array.from(
    new Map(
      mounts
        .map((mount) => normalizeMount(mount))
        .filter((mount): mount is MediaSourceMount => Boolean(mount))
        .map((mount) => [mount.id, mount]),
    ).values(),
  );

  if (deduped.length === 0) {
    return [];
  }

  const defaultMountId = deduped.find((mount) => mount.isDefault)?.id ?? deduped[0].id;
  return deduped.map((mount) => ({
    ...mount,
    isDefault: mount.id === defaultMountId,
  }));
}

function toMountFromLegacyStorage(storage: StorageConfigValues): MediaSourceMount[] {
  if (!storage.provider || !storage.bucket.trim()) {
    return [];
  }

  return [
    {
      id: 'primary',
      label: storage.provider === 'r2' ? 'Cloudflare R2' : 'Supabase Storage',
      type: storage.provider,
      bucket: storage.bucket.trim(),
      isDefault: true,
      publicUrl: storage.provider === 'r2' ? trimString(storage.r2PublicUrl) : '',
    },
  ];
}

function toMountFromLegacyExtra(source: ExtraMediaSource): MediaSourceMount {
  return {
    id: source.id,
    label: source.label,
    type: 's3',
    bucket: source.bucket,
    endpoint: source.endpoint,
    region: source.region,
    publicUrl: source.publicUrl,
    accessKeyId: source.accessKeyId,
  };
}

function toExtraFromMount(mount: MediaSourceMount): ExtraMediaSource {
  return {
    id: mount.id,
    label: mount.label,
    type: 's3',
    endpoint: mount.endpoint ?? '',
    bucket: mount.bucket,
    region: mount.region ?? '',
    publicUrl: mount.publicUrl ?? '',
    accessKeyId: mount.accessKeyId ?? '',
  };
}

export interface MailConfigValues {
  provider: 'smtp' | 'resend' | '';
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
}

export interface LoggingConfigValues {
  mode: 'all' | 'custom';
  enabledEndpointKeys: string[];
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

async function getConfigValue(
  env: Env,
  namespace: string,
  key: string,
  fallbackKey?: keyof Env,
): Promise<string> {
  try {
    const admin = await createSupabaseAdminClient(env);
    const { data, error } = await admin
      .from('system_config')
      .select('value')
      .eq('namespace', namespace)
      .eq('key', key)
      .single();

    if (!error && data?.value) {
      return data.value as string;
    }
  } catch {
    // Local development or bootstrap path can fall back to env vars.
  }

  return fallbackKey ? String(env[fallbackKey] ?? '') : '';
}

export async function getStorageConfig(env: Env): Promise<StorageConfigValues> {
  const [provider, bucket, r2PublicUrl] = await Promise.all([
    getConfigValue(env, CORE_NAMESPACE, 'storage.provider', ENV_FALLBACKS['storage.provider']),
    getConfigValue(env, CORE_NAMESPACE, 'storage.bucket', ENV_FALLBACKS['storage.bucket']),
    getConfigValue(env, CORE_NAMESPACE, 'storage.r2_public_url', ENV_FALLBACKS['storage.r2_public_url']),
  ]);

  return {
    provider: provider === 'supabase' || provider === 'r2' ? provider : '',
    bucket,
    r2PublicUrl,
  };
}

export async function upsertStorageConfig(env: Env, input: StorageConfigValues): Promise<void> {
  const admin = await createSupabaseAdminClient(env);
  const rows = [
    { namespace: CORE_NAMESPACE, key: 'storage.provider', value: input.provider },
    { namespace: CORE_NAMESPACE, key: 'storage.bucket', value: input.bucket },
    { namespace: CORE_NAMESPACE, key: 'storage.r2_public_url', value: input.r2PublicUrl },
  ];

  const { error } = await admin.from('system_config').upsert(rows, { onConflict: 'namespace,key' });
  if (error) {
    throw new Error(error.message);
  }
}

export async function getMailConfig(env: Env): Promise<MailConfigValues> {
  const [provider, fromName, fromEmail, replyToEmail, smtpHost, smtpPort, smtpSecure, smtpUsername] = await Promise.all([
    getConfigValue(env, MAIL_NAMESPACE, 'provider'),
    getConfigValue(env, MAIL_NAMESPACE, 'from_name'),
    getConfigValue(env, MAIL_NAMESPACE, 'from_email'),
    getConfigValue(env, MAIL_NAMESPACE, 'reply_to_email'),
    getConfigValue(env, MAIL_NAMESPACE, 'smtp_host'),
    getConfigValue(env, MAIL_NAMESPACE, 'smtp_port'),
    getConfigValue(env, MAIL_NAMESPACE, 'smtp_secure'),
    getConfigValue(env, MAIL_NAMESPACE, 'smtp_username'),
  ]);

  return {
    provider: provider === 'smtp' || provider === 'resend' ? provider : '',
    fromName,
    fromEmail,
    replyToEmail,
    smtpHost,
    smtpPort: Number.parseInt(smtpPort || '587', 10),
    smtpSecure: smtpSecure === 'true',
    smtpUsername,
  };
}

export async function upsertMailConfig(env: Env, input: MailConfigValues): Promise<void> {
  const admin = await createSupabaseAdminClient(env);
  const rows: Array<{ namespace: string; key: MailConfigKey; value: string }> = [
    { namespace: MAIL_NAMESPACE, key: 'provider', value: input.provider },
    { namespace: MAIL_NAMESPACE, key: 'from_name', value: input.fromName },
    { namespace: MAIL_NAMESPACE, key: 'from_email', value: input.fromEmail },
    { namespace: MAIL_NAMESPACE, key: 'reply_to_email', value: input.replyToEmail },
    { namespace: MAIL_NAMESPACE, key: 'smtp_host', value: input.smtpHost },
    { namespace: MAIL_NAMESPACE, key: 'smtp_port', value: String(input.smtpPort) },
    { namespace: MAIL_NAMESPACE, key: 'smtp_secure', value: String(input.smtpSecure) },
    { namespace: MAIL_NAMESPACE, key: 'smtp_username', value: input.smtpUsername },
  ];

  const { error } = await admin.from('system_config').upsert(rows, { onConflict: 'namespace,key' });
  if (error) {
    throw new Error(error.message);
  }
}

export async function getLoggingConfig(env: Env): Promise<LoggingConfigValues> {
  const [mode, enabledEndpointKeys] = await Promise.all([
    getConfigValue(env, LOGGING_NAMESPACE, 'mode'),
    getConfigValue(env, LOGGING_NAMESPACE, 'enabled_endpoints'),
  ]);

  return {
    mode: mode === 'custom' ? 'custom' : 'all',
    enabledEndpointKeys: parseStringArray(enabledEndpointKeys),
  };
}

export async function upsertLoggingConfig(env: Env, input: LoggingConfigValues): Promise<void> {
  const admin = await createSupabaseAdminClient(env);
  const rows: Array<{ namespace: string; key: LoggingConfigKey; value: string }> = [
    { namespace: LOGGING_NAMESPACE, key: 'mode', value: input.mode },
    { namespace: LOGGING_NAMESPACE, key: 'enabled_endpoints', value: JSON.stringify(input.enabledEndpointKeys) },
  ];

  const { error } = await admin.from('system_config').upsert(rows, { onConflict: 'namespace,key' });
  if (error) {
    throw new Error(error.message);
  }
}

export function getMailConfigNamespace(): string {
  return MAIL_NAMESPACE;
}

function parseExtraMediaSources(value: string): ExtraMediaSource[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ExtraMediaSource =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as ExtraMediaSource).id === 'string' &&
        typeof (s as ExtraMediaSource).label === 'string' &&
        (s as ExtraMediaSource).type === 's3' &&
        typeof (s as ExtraMediaSource).bucket === 'string',
    );
  } catch {
    return [];
  }
}

function parseMediaSourceMounts(value: string): MediaSourceMount[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeMounts(
      parsed
        .map((entry) => normalizeMount(entry))
        .filter((entry): entry is MediaSourceMount => entry !== null),
    );
  } catch {
    return [];
  }
}

export async function getExtraMediaSources(env: Env): Promise<ExtraMediaSource[]> {
  const mounts = await getMediaSourceMounts(env);
  return mounts.filter((mount) => mount.type === 's3').map(toExtraFromMount);
}

export async function upsertExtraMediaSources(env: Env, sources: ExtraMediaSource[]): Promise<void> {
  const existingMounts = await getMediaSourceMounts(env);
  const nativeMounts = existingMounts.filter((mount) => mount.type !== 's3');
  const nextMounts = normalizeMounts([
    ...nativeMounts,
    ...sources.map(toMountFromLegacyExtra),
  ]);

  const admin = await createSupabaseAdminClient(env);
  const { error } = await admin.from('system_config').upsert(
    [
      { namespace: CORE_NAMESPACE, key: 'media.extra_sources', value: JSON.stringify(sources) },
      { namespace: CORE_NAMESPACE, key: 'media.source_mounts', value: JSON.stringify(nextMounts) },
    ],
    { onConflict: 'namespace,key' },
  );
  if (error) {
    throw new Error(error.message);
  }
}

export async function getMediaSourceMounts(env: Env): Promise<MediaSourceMount[]> {
  const raw = await getConfigValue(env, CORE_NAMESPACE, 'media.source_mounts');
  const direct = parseMediaSourceMounts(raw);
  if (direct.length > 0) {
    return direct;
  }

  const [legacyStorage, legacyExtraRaw] = await Promise.all([
    getStorageConfig(env),
    getConfigValue(env, CORE_NAMESPACE, 'media.extra_sources'),
  ]);

  return normalizeMounts([
    ...toMountFromLegacyStorage(legacyStorage),
    ...parseExtraMediaSources(legacyExtraRaw).map(toMountFromLegacyExtra),
  ]);
}

export async function upsertMediaSourceMounts(env: Env, mounts: MediaSourceMount[]): Promise<MediaSourceMount[]> {
  const normalized = normalizeMounts(mounts);
  const admin = await createSupabaseAdminClient(env);
  const defaultNativeMount = normalized.find((mount) => mount.isDefault && (mount.type === 'supabase' || mount.type === 'r2'))
    ?? normalized.find((mount) => mount.type === 'supabase' || mount.type === 'r2');

  const legacyStorage: StorageConfigValues = defaultNativeMount
    ? {
        provider: defaultNativeMount.type,
        bucket: defaultNativeMount.bucket,
        r2PublicUrl: defaultNativeMount.type === 'r2' ? trimString(defaultNativeMount.publicUrl) : '',
      }
    : { provider: '', bucket: '', r2PublicUrl: '' };

  const extraSources = normalized.filter((mount) => mount.type === 's3').map(toExtraFromMount);

  const rows = [
    { namespace: CORE_NAMESPACE, key: 'media.source_mounts', value: JSON.stringify(normalized) },
    { namespace: CORE_NAMESPACE, key: 'media.extra_sources', value: JSON.stringify(extraSources) },
    { namespace: CORE_NAMESPACE, key: 'storage.provider', value: legacyStorage.provider },
    { namespace: CORE_NAMESPACE, key: 'storage.bucket', value: legacyStorage.bucket },
    { namespace: CORE_NAMESPACE, key: 'storage.r2_public_url', value: legacyStorage.r2PublicUrl },
  ];

  const { error } = await admin.from('system_config').upsert(rows, { onConflict: 'namespace,key' });
  if (error) {
    throw new Error(error.message);
  }

  return normalized;
}

export async function getDefaultMediaSourceMount(env: Env): Promise<MediaSourceMount | null> {
  const mounts = await getMediaSourceMounts(env);
  return mounts.find((mount) => mount.isDefault) ?? mounts[0] ?? null;
}