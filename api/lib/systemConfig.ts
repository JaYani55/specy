import { createSupabaseAdminClient, type Env } from './supabase';

const CORE_NAMESPACE = 'core';

type CoreConfigKey = 'storage.provider' | 'storage.bucket' | 'storage.r2_public_url';

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

async function getConfigValue(env: Env, key: CoreConfigKey): Promise<string> {
  try {
    const admin = await createSupabaseAdminClient(env);
    const { data, error } = await admin
      .from('system_config')
      .select('value')
      .eq('namespace', CORE_NAMESPACE)
      .eq('key', key)
      .single();

    if (!error && data?.value) {
      return data.value as string;
    }
  } catch {
    // Local development or bootstrap path can fall back to env vars.
  }

  const fallbackKey = ENV_FALLBACKS[key];
  return fallbackKey ? String(env[fallbackKey] ?? '') : '';
}

export async function getStorageConfig(env: Env): Promise<StorageConfigValues> {
  const [provider, bucket, r2PublicUrl] = await Promise.all([
    getConfigValue(env, 'storage.provider'),
    getConfigValue(env, 'storage.bucket'),
    getConfigValue(env, 'storage.r2_public_url'),
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