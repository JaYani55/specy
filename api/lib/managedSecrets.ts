import { createSupabaseAdminClient, type Env } from './supabase';

const REVALIDATION_SECRET_NAMESPACE = 'page-revalidation';

type ManagedSecretMetadata = Record<string, unknown>;

interface ManagedSecretRow {
  id: string;
  name: string;
  namespace: string;
  encrypted_value: string;
  metadata: ManagedSecretMetadata | null;
}

function toBase64(value: Uint8Array | ArrayBuffer): string {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptManagedSecret(secret: string, value: string): Promise<string> {
  const key = await importEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );

  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

async function decryptManagedSecret(secret: string, payload: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = payload.split('.');
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error('Managed secret payload is malformed');
  }

  const key = await importEncryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64) },
    key,
    fromBase64(ciphertextBase64),
  );

  return new TextDecoder().decode(plaintext);
}

function requireEncryptionSecret(env: Env): string {
  if (!env.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY is not configured');
  }
  return env.SECRETS_ENCRYPTION_KEY;
}

export function buildRevalidationSecretName(schemaId: string): string {
  return `REVALIDATION_${schemaId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export async function upsertManagedSecret(env: Env, input: {
  name: string;
  namespace: string;
  value: string;
  metadata?: ManagedSecretMetadata;
}): Promise<void> {
  const admin = await createSupabaseAdminClient(env);
  const encryptedValue = await encryptManagedSecret(requireEncryptionSecret(env), input.value);

  const { error } = await admin
    .from('managed_secrets')
    .upsert({
      name: input.name,
      namespace: input.namespace,
      encrypted_value: encryptedValue,
      metadata: input.metadata ?? {},
    }, { onConflict: 'name' });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getManagedSecretValue(env: Env, name: string): Promise<string | null> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('managed_secrets')
    .select('id, name, namespace, encrypted_value, metadata')
    .eq('name', name)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(error.message);
  }

  const row = data as ManagedSecretRow;
  return decryptManagedSecret(requireEncryptionSecret(env), row.encrypted_value);
}

export async function getManagedSecretMetadata(env: Env, name: string): Promise<ManagedSecretMetadata | null> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('managed_secrets')
    .select('metadata')
    .eq('name', name)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(error.message);
  }

  return (data?.metadata as ManagedSecretMetadata | null) ?? {};
}

export async function deleteManagedSecret(env: Env, name: string): Promise<void> {
  const admin = await createSupabaseAdminClient(env);
  const { error } = await admin.from('managed_secrets').delete().eq('name', name);
  if (error) {
    throw new Error(error.message);
  }
}

export function getRevalidationSecretNamespace(): string {
  return REVALIDATION_SECRET_NAMESPACE;
}