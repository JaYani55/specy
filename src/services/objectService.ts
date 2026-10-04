import { supabase } from '@/lib/supabase';
import { API_URL } from '@/lib/apiUrl';
import type { MarkdownObjectData, ObjectRecord, PublicObjectDefinition, ObjectType } from '@/types/objects';

export type ObjectListRecord = Pick<ObjectRecord,
  'id' | 'name' | 'slug' | 'description' | 'agent_description' | 'object_type' | 'status'
  | 'requires_auth' | 'api_enabled' | 'share_enabled' | 'share_slug' | 'tenant_id' | 'created_at' | 'updated_at'
>;

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

export const getObjects = async (tenantId?: string | null): Promise<ObjectListRecord[]> => {
  if (!API_URL) throw new Error('API URL is not configured.');
  const headers = await buildHeaders();
  const search = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const response = await fetch(`${API_URL}/api/objects${search}`, { headers });
  const payload = await response.json().catch(() => ({})) as { error?: string; objects?: ObjectListRecord[] };
  if (!response.ok) throw new Error(payload.error ?? 'Failed to load objects.');
  return payload.objects ?? [];
};

export const getObject = async (id: string): Promise<ObjectRecord> => {
  const { data, error } = await supabase
    .from('objects')
    .select('id, name, slug, description, agent_description, object_type, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, tenant_id, owner_user_id, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as ObjectRecord;
};

export interface CreateObjectInput {
  name: string;
  slug: string;
  description?: string;
  agent_description?: string;
  object_type?: ObjectType;
  schema: Record<string, unknown>;
  data: Record<string, unknown> | unknown[] | MarkdownObjectData;
  status?: 'published' | 'archived';
  requires_auth?: boolean;
  api_enabled?: boolean;
  share_enabled?: boolean;
  share_slug?: string | null;
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

export const getManagedObjectEditorPath = async (id: string): Promise<string | null> => {
  if (!API_URL) throw new Error('API URL is not configured.');
  const headers = await buildHeaders();
  const response = await fetch(`${API_URL}/api/objects/${encodeURIComponent(id)}/source`, { headers });
  const payload = await response.json().catch(() => ({})) as { error?: string; managed?: boolean; editor_path?: string | null };
  if (!response.ok) throw new Error(payload.error ?? 'Could not resolve the object source.');
  return payload.managed && typeof payload.editor_path === 'string' ? payload.editor_path : null;
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

export const getPublicObjectByShareSlug = async (tenantName: string, shareSlug: string): Promise<PublicObjectDefinition> => {
  const headers = await buildHeaders();
  const response = await fetch(`${API_URL}/api/objects/share/${encodeURIComponent(tenantName)}/${encodeURIComponent(shareSlug)}`, {
    headers,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(err.error ?? 'Failed to load shared object.');
  }

  return response.json() as Promise<PublicObjectDefinition>;
};
