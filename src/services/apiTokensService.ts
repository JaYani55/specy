import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

interface ErrorResponse {
  error?: string;
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedApiToken {
  /** Raw token — shown to the user exactly once, never retrievable again. */
  token: string;
  token_record: ApiTokenRecord;
}

async function parseError(res: Response): Promise<Error> {
  const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
  return new Error(err.error ?? `HTTP ${res.status}`);
}

export async function listApiTokens(): Promise<ApiTokenRecord[]> {
  const res = await fetch(`${API_URL}/api/tokens`, {
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });
  if (!res.ok) throw await parseError(res);
  const data = await res.json() as { tokens: ApiTokenRecord[] };
  return data.tokens ?? [];
}

export async function createApiToken(input: { name: string; expires_at?: string | null }): Promise<CreatedApiToken> {
  const res = await fetch(`${API_URL}/api/tokens`, {
    method: 'POST',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({ name: input.name, ...(input.expires_at ? { expires_at: input.expires_at } : {}) }),
  });
  if (!res.ok) throw await parseError(res);
  return await res.json() as CreatedApiToken;
}

export async function revokeApiToken(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });
  if (!res.ok) throw await parseError(res);
}

/**
 * Attach the current Supabase session to an outgoing request, mirroring the
 * pattern used by the other services (see connectionsService).
 */
async function createAuthenticatedHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}
