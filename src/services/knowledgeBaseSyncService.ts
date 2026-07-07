import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

async function createAuthenticatedHeaders(): Promise<Headers> {
  const headers = new Headers();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

export interface KnowledgeBaseSyncResponse {
  success: boolean;
  result?: {
    created?: boolean;
    deleted?: boolean;
    unchanged?: boolean;
    docId?: string;
  };
  error?: string;
}

export async function syncEntityToKnowledgeBase(input: {
  sourceTable: string;
  sourceRecordId: string;
  tenantId?: string | null;
}): Promise<KnowledgeBaseSyncResponse> {
  const url = new URL(`${API_URL}/api/knowledge-base/sync`);
  const headers = await createAuthenticatedHeaders();

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceTable: input.sourceTable,
        sourceRecordId: input.sourceRecordId,
        tenantId: input.tenantId ?? null,
      }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: 'Sync failed.' })) as { error?: string };
      return { success: false, error: payload.error ?? 'Sync failed.' };
    }

    return await res.json() as KnowledgeBaseSyncResponse;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error occurred during sync.',
    };
  }
}
