import { supabase } from '@/lib/supabase';
import { API_URL } from '@/lib/apiUrl';
import type { ObjectRecord } from '@/types/objects';

const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

const buildHeaders = async (): Promise<HeadersInit> => {
  const token = await getAuthToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'object';

export { generateSlug as generateObjectSlug };

export const getObjects = async (): Promise<ObjectRecord[]> => {
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ObjectRecord[];
};

export const getObject = async (id: string): Promise<ObjectRecord> => {
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as ObjectRecord;
};

export interface CreateObjectInput {
  name: string;
  slug: string;
  description?: string;
  schema: Record<string, unknown>;
  data: Record<string, unknown> | unknown[];
  status?: 'published' | 'archived';
  requires_auth?: boolean;
  api_enabled?: boolean;
  tenant_id?: string | null;
}

export const createObject = async (input: CreateObjectInput): Promise<ObjectRecord> => {
  const headers = await buildHeaders();
  const response = await fetch(`${API_URL}/api/objects`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? 'Failed to create object.');
  }

  return response.json() as Promise<ObjectRecord>;
};

export const updateObject = async (id: string, input: Partial<CreateObjectInput>): Promise<ObjectRecord> => {
  const headers = await buildHeaders();
  const response = await fetch(`${API_URL}/api/objects/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? 'Failed to update object.');
  }

  return response.json() as Promise<ObjectRecord>;
};

export const deleteObject = async (id: string): Promise<void> => {
  const headers = await buildHeaders();
  const response = await fetch(`${API_URL}/api/objects/${id}`, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? 'Failed to archive object.');
  }
};
