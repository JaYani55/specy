// Supabase Edge Function: deliver_webhooks
//
// Processes pending webhook_delivery_jobs rows: signs the payload with the
// subscription's HMAC secret and POSTs it to the subscriber URL. Mirrors the
// mail queue architecture (specs/platform/email-delivery-queue.md):
//   - pg_cron invokes this function every minute with mode "process-pending"
//   - failures are requeued with exponential backoff (retryPolicy.ts)
//   - after max attempts a job parks as terminal `failed`, never deleted
//
// Required function secrets (set during setup, same as send_email):
//   SUPABASE_URL, APP_SUPABASE_SECRET_KEY, SECRETS_ENCRYPTION_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { computeWebhookRetryDecision } from './retryPolicy.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_SUPABASE_SECRET_KEY = Deno.env.get('APP_SUPABASE_SECRET_KEY') ?? '';
const SECRETS_ENCRYPTION_KEY = Deno.env.get('SECRETS_ENCRYPTION_KEY') ?? '';

if (!SUPABASE_URL || !APP_SUPABASE_SECRET_KEY || !SECRETS_ENCRYPTION_KEY) {
  throw new Error('Missing required function secrets: SUPABASE_URL, APP_SUPABASE_SECRET_KEY, or SECRETS_ENCRYPTION_KEY.');
}

const supabase = createClient(SUPABASE_URL, APP_SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Managed-secret decryption (AES-GCM, mirrors api/lib/managedSecrets.ts) ──

async function deriveKeyMaterial(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SECRETS_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptManagedSecret(encryptedValue: string): Promise<string> {
  const raw = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const key = await deriveKeyMaterial();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

// ── HMAC signing ─────────────────────────────────────────────────────────────

async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Delivery ─────────────────────────────────────────────────────────────────

interface DeliveryJobRow {
  id: string;
  subscription_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
}

interface SubscriptionRow {
  id: string;
  url: string;
  active: boolean;
}

async function deliverJob(job: DeliveryJobRow, subscription: SubscriptionRow): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const secretName = `WEBHOOK_SIGNING_SECRET_${job.subscription_id.replace(/-/g, '').toUpperCase()}`;

  try {
    const { data: secretRow } = await supabase
      .from('managed_secrets')
      .select('encrypted_value')
      .eq('name', secretName)
      .single();
    if (!secretRow) return { ok: false, status: null, error: 'signing secret missing' };

    const secret = await decryptManagedSecret(secretRow.encrypted_value);
    const body = JSON.stringify(job.payload);
    const signature = await signPayload(secret, body);

    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Specy-Event': job.event,
        'X-Specy-Delivery': job.id,
        'X-Specy-Signature': `sha256=${signature}`,
      },
      body,
    });

    // 2xx = delivered. Everything else (including 3xx/4xx/5xx) is a failure
    // eligible for retry. Retry-After is honored like the mail queue.
    if (response.ok) {
      return { ok: true, status: response.status, error: null };
    }
    const retryAfter = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : null;
    return { ok: false, status: response.status, error: retryAfterSeconds != null ? `retry-after:${retryAfterSeconds}` : `http-${response.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function processPendingJobs(limit: number): Promise<Record<string, number>> {
  const { data: jobs, error: jobError } = await supabase
    .from('webhook_delivery_jobs')
    .select('id, subscription_id, event, payload, attempts, max_attempts, next_attempt_at')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);

  if (jobError) throw new Error(jobError.message);
  if (!jobs?.length) return { due: 0, delivered: 0, requeued: 0, failed: 0 };

  const summary = { due: jobs.length, delivered: 0, requeued: 0, failed: 0 };

  for (const job of jobs as DeliveryJobRow[]) {
    const { data: subscription } = await supabase
      .from('webhook_subscriptions')
      .select('id, url, active')
      .eq('id', job.subscription_id)
      .single();

    if (!subscription || !subscription.active) {
      // Subscription deleted or disabled → job becomes terminal (kept for audit).
      await supabase.from('webhook_delivery_jobs').update({ status: 'failed', last_error: 'subscription missing or inactive' }).eq('id', job.id);
      summary.failed++;
      continue;
    }

    const result = await deliverJob(job, subscription as SubscriptionRow);
    const attempt = (job.attempts ?? 0) + 1;

    if (result.ok) {
      await supabase.from('webhook_delivery_jobs').update({
        status: 'delivered',
        attempts: attempt,
        last_response_status: result.status,
        delivered_at: new Date().toISOString(),
      }).eq('id', job.id);
      summary.delivered++;
      continue;
    }

    let retryAfterSeconds: number | null = null;
    if (result.error?.startsWith('retry-after:')) {
      retryAfterSeconds = Number.parseInt(result.error.slice('retry-after:'.length), 10);
    }
    const decision = computeWebhookRetryDecision(attempt, retryAfterSeconds);

    if (decision.status === 'pending') {
      const next = new Date(Date.now() + (decision.backoffSeconds ?? 60) * 1000).toISOString();
      await supabase.from('webhook_delivery_jobs').update({
        status: 'pending',
        attempts: attempt,
        next_attempt_at: next,
        last_response_status: result.status,
        last_error: result.error,
      }).eq('id', job.id);
      summary.requeued++;
    } else {
      await supabase.from('webhook_delivery_jobs').update({
        status: 'failed',
        attempts: attempt,
        last_response_status: result.status,
        last_error: result.error,
      }).eq('id', job.id);
      summary.failed++;
    }
  }

  return summary;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const mode = typeof body.mode === 'string' ? body.mode : 'process-pending';

  if (mode === 'process-pending') {
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const summary = await processPendingJobs(limit);
    return json({ ok: true, summary });
  }

  return json({ error: `Unsupported mode: ${mode}` }, 400);
});
