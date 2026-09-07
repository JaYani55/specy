import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

async function createAuthenticatedHeaders(): Promise<Headers> {
  const headers = new Headers();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

export type MailJobStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface MailDeliveryEvent {
  id: number;
  event_type: string;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MailDeliveryJob {
  id: string;
  event_type: string;
  provider: string | null;
  status: MailJobStatus;
  form_id: string | null;
  answer_id: string | null;
  recipient_email: string;
  subject: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  mail_delivery_events: MailDeliveryEvent[];
}

export interface FetchMailJobsParams {
  status?: MailJobStatus;
  form_id?: string;
  limit?: number;
}

export const fetchMailJobs = async (params: FetchMailJobsParams = {}): Promise<MailDeliveryJob[]> => {
  const url = new URL(`${API_URL}/api/mail/jobs`);
  if (params.status) url.searchParams.set('status', params.status);
  if (params.form_id) url.searchParams.set('form_id', params.form_id);
  if (params.limit) url.searchParams.set('limit', String(params.limit));

  const res = await fetch(url.toString(), { headers: await createAuthenticatedHeaders() });
  if (!res.ok) throw new Error('Fehler beim Laden des E-Mail-Verlaufs');
  const payload = await res.json();
  return payload.jobs as MailDeliveryJob[];
};

export interface RetryMailJobResult {
  success: boolean;
  sent?: boolean;
  requeued?: boolean;
  terminalFailed?: boolean;
  instantDelivery?: boolean;
  rateLimited?: boolean;
  nextAttemptAt?: string | null;
  message?: string;
}

export const retryMailJob = async (jobId: string): Promise<RetryMailJobResult> => {
  const res = await fetch(`${API_URL}/api/mail/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    headers: await createAuthenticatedHeaders(),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? 'Erneuter Versand fehlgeschlagen');
  }

  return res.json();
};

export const deleteMailJob = async (jobId: string): Promise<{ success: boolean; deleted: number }> => {
  const res = await fetch(`${API_URL}/api/mail/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: await createAuthenticatedHeaders(),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? 'Eintrag konnte nicht gelöscht werden');
  }

  return res.json();
};

export const clearMailJobs = async (status?: MailJobStatus): Promise<{ success: boolean; deleted: number }> => {
  const url = new URL(`${API_URL}/api/mail/jobs`);
  if (status) url.searchParams.set('status', status);

  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: await createAuthenticatedHeaders(),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? 'Einträge konnten nicht gelöscht werden');
  }

  return res.json();
};
