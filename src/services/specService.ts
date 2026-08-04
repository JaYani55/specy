import { supabase } from '@/lib/supabase';
import { API_URL } from '@/lib/apiUrl';
import type { SaveSpecInput, SchemaSpecBundle, SpecRecord } from '@/types/specs';

const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

const buildHeaders = async (): Promise<HeadersInit> => {
  const token = await getAuthToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    : { 'Content-Type': 'application/json', Accept: 'application/json' };
};

export const getSpecs = async (): Promise<SpecRecord[]> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs`, {
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to load specs' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to load specs');
  }

  const body = await response.json() as { specs?: SpecRecord[] };
  return body.specs ?? [];
};

export const getSpec = async (slug: string): Promise<SpecRecord> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/${encodeURIComponent(slug)}`, {
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to load spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to load spec');
  }

  const body = await response.json() as { spec: SpecRecord };
  return body.spec;
};

export const createSpec = async (input: SaveSpecInput): Promise<SpecRecord> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs`, {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to create spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to create spec');
  }

  const body = await response.json() as { spec: SpecRecord };
  return body.spec;
};

export const updateSpec = async (id: string, input: Partial<SaveSpecInput>): Promise<SpecRecord> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: await buildHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to update spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to update spec');
  }

  const body = await response.json() as { spec: SpecRecord };
  return body.spec;
};

export const deleteSpec = async (id: string): Promise<void> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to delete spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to delete spec');
  }
};

export const deleteGlobalSpec = async (id: string): Promise<void> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/global/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to delete global spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to delete global spec');
  }
};

export const getSchemaSpecBundle = async (schemaSlug: string): Promise<SchemaSpecBundle> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/schema/${encodeURIComponent(schemaSlug)}`, {
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to load schema spec bundle' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to load schema spec bundle');
  }

  return response.json();
};

export const updateSchemaSpecAttachments = async (
  schemaId: string,
  input: { main_spec_id?: string | null; additional_spec_ids?: string[] },
): Promise<SchemaSpecBundle> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/specs/schema/${encodeURIComponent(schemaId)}/attachments`, {
    method: 'PUT',
    headers: await buildHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to update schema specs' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to update schema specs');
  }

  return response.json();
};

export const createGlobalSpec = async (input: SaveSpecInput): Promise<SpecRecord> => {
  const response = await fetch(`${API_URL}/api/specs/global`, {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to create global spec' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to create global spec');
  }
  return (await response.json() as { spec: SpecRecord }).spec;
};