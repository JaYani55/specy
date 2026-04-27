import { createSupabaseAdminClient, type Env } from './supabase';

const CORE_NAMESPACE = 'core';
const MAIL_NAMESPACE = 'mail';
const LOGGING_NAMESPACE = 'logging';

type CoreConfigKey = 'storage.provider' | 'storage.bucket' | 'storage.r2_public_url';
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