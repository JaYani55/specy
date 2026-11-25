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

export type WebhookEventType = 'object.created' | 'object.updated' | 'object.archived';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookSubscription {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryJob {
  id: string;
  subscription_id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'object.created',
  'object.updated',
  'object.archived',
];

const EVENT_LABELS: Record<WebhookEventType, string> = {
  'object.created': 'Objekt erstellt',
  'object.updated': 'Objekt aktualisiert',
  'object.archived': 'Objekt archiviert',
};

export const webhookEventLabel = (event: string): string =>
  EVENT_LABELS[event as WebhookEventType] ?? event;

export const fetchWebhookSubscriptions = async (): Promise<WebhookSubscription[]> => {
  const res = await fetch(`${API_URL}/api/webhooks`, { headers: await createAuthenticatedHeaders() });
  if (!res.ok) throw new Error('Fehler beim Laden der Webhook-Abonnements');
  const payload = await res.json();
  return payload.subscriptions ?? [];
};

export interface CreateWebhookInput {
  name: string;
  url: string;
  events: WebhookEventType[];
  tenant_id: string;
}

export interface CreateWebhookResult extends WebhookSubscription {
  /** Returned exactly once by the API — same contract as PATs. */
  signing_secret: string;
}

export const createWebhookSubscription = async (input: CreateWebhookInput): Promise<CreateWebhookResult> => {
  const res = await fetch(`${API_URL}/api/webhooks`, {
    method: 'POST',
    headers: {
      ...(await createAuthenticatedHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? 'Fehler beim Erstellen des Webhook-Abonnements');
  }
  return res.json();
};

export const updateWebhookSubscription = async (
  id: string,
  patch: { active?: boolean; events?: WebhookEventType[] },
): Promise<WebhookSubscription> => {
  const res = await fetch(`${API_URL}/api/webhooks/${id}`, {
    method: 'PATCH',
    headers: {
      ...(await createAuthenticatedHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? 'Fehler beim Aktualisieren des Webhook-Abonnements');
  }
  return res.json();
};

export const deleteWebhookSubscription = async (id: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/webhooks/${id}`, {
    method: 'DELETE',
    headers: await createAuthenticatedHeaders(),
  });
  if (!res.ok) throw new Error('Fehler beim Löschen des Webhook-Abonnements');
};

export const fetchWebhookJobs = async (limit = 100): Promise<WebhookDeliveryJob[]> => {
  const url = new URL(`${API_URL}/api/webhooks/jobs`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: await createAuthenticatedHeaders() });
  if (!res.ok) throw new Error('Fehler beim Laden des Webhook-Verlaufs');
  const payload = await res.json();
  return payload.jobs ?? [];
};
