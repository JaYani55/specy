/**
 * Pure retry/backoff decision logic for the webhook delivery queue.
 *
 * Same contract as the mail queue (functions/send_email/retryPolicy.ts):
 * imported by the deliver_webhooks edge function (Deno) and unit-tested from
 * the Node test suite (tests/webhookRetryPolicy.test.mjs) — must stay
 * dependency-free.
 */

/** Maximum delivery attempts before a job is parked as terminal `failed`. */
export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 3;

/** Base backoff for the first retry, in seconds. */
export const WEBHOOK_RETRY_BASE_BACKOFF_SECONDS = 60;

/** Upper bound for a single backoff interval, in seconds (15 minutes). */
export const WEBHOOK_RETRY_MAX_BACKOFF_SECONDS = 900;

export type WebhookRetryStatus = 'pending' | 'failed';

export interface WebhookRetryDecision {
  /** `pending` = will be retried, `failed` = terminal (kept in DB, never deleted). */
  status: WebhookRetryStatus;
  /** True when the job will be attempted again. */
  retryable: boolean;
  /** Backoff interval applied for this retry, in seconds (null when terminal). */
  backoffSeconds: number | null;
}

/**
 * Backoff schedule (base 60s, exponential ×2, hard cap 900s):
 *   attempt 1 failed → retry after 60s
 *   attempt 2 failed → retry after 120s
 *   attempt 3 failed → terminal `failed` (job kept in the delivery log)
 *
 * `retryAfterSeconds` (provider Retry-After) takes precedence when provided.
 */
export function computeWebhookRetryDecision(
  failedAttempt: number,
  retryAfterSeconds?: number | null,
): WebhookRetryDecision {
  if (failedAttempt >= MAX_WEBHOOK_DELIVERY_ATTEMPTS) {
    return { status: 'failed', retryable: false, backoffSeconds: null };
  }

  let backoff = WEBHOOK_RETRY_BASE_BACKOFF_SECONDS * Math.pow(2, failedAttempt - 1);
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    backoff = Math.min(Math.ceil(retryAfterSeconds), WEBHOOK_RETRY_MAX_BACKOFF_SECONDS);
  }
  backoff = Math.min(backoff, WEBHOOK_RETRY_MAX_BACKOFF_SECONDS);

  return { status: 'pending', retryable: true, backoffSeconds: backoff };
}
