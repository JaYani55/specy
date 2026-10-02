import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

export interface ServiceProductPage {
  id: string;
  schema_id: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  content: Record<string, unknown>;
  updated_at: string;
}

export interface ServiceProduct {
  id: string;
  tenant_id: string;
  name: string;
  page_id: string;
  schema_id?: string;
  slug?: string;
  status?: 'draft' | 'published' | 'archived';
  content?: Record<string, unknown>;
  page?: ServiceProductPage | null;
  retired_at: string | null;
  team_enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

async function authenticatedHeaders(): Promise<Headers> {
  const headers = new Headers({ Accept: 'application/json' });
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error('API URL is not configured.');
  const headers = await authenticatedHeaders();
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}/api/products${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(payload.error || `Product request failed (${response.status}).`);
  return payload as T;
}

export async function listServiceProducts(tenantId: string): Promise<ServiceProduct[]> {
  if (!tenantId) return [];
  const result = await request<{ products: ServiceProduct[] }>(`?tenant_id=${encodeURIComponent(tenantId)}`);
  return result.products;
}

export async function getServiceProductByPage(pageId: string, tenantId: string): Promise<ServiceProduct> {
  const result = await request<{ product: ServiceProduct }>(`/by-page/${encodeURIComponent(pageId)}?tenant_id=${encodeURIComponent(tenantId)}`);
  return result.product;
}

export async function createServiceProduct(input: {
  tenant_id: string;
  schema_id: string;
  expected_definition_revision: number;
  name: string;
  content?: Record<string, unknown>;
  slug?: string;
}): Promise<ServiceProduct> {
  const idempotencyKey = crypto.randomUUID();
  const result = await request<{ product: ServiceProduct }>('', {
    method: 'POST',
    body: JSON.stringify({ ...input, content: input.content ?? {}, idempotency_key: idempotencyKey }),
  });
  return result.product;
}

export async function updateServiceProduct(input: {
  id: string;
  tenant_id: string;
  expected_version: number;
  expected_definition_revision: number;
  name: string;
  slug: string;
  content: Record<string, unknown>;
}): Promise<ServiceProduct> {
  const { id, ...body } = input;
  const result = await request<{ product: ServiceProduct }>(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return result.product;
}

export async function setServiceProductPublication(input: {
  id: string;
  tenant_id: string;
  expected_version: number;
  expected_definition_revision: number;
  status: 'draft' | 'published';
}): Promise<ServiceProduct> {
  const { id, ...body } = input;
  const result = await request<{ product: ServiceProduct }>(`/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.product;
}

export async function archiveServiceProduct(input: {
  id: string;
  tenant_id: string;
  expected_version: number;
}): Promise<ServiceProduct> {
  const { id, ...body } = input;
  const result = await request<{ product: ServiceProduct }>(`/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.product;
}
