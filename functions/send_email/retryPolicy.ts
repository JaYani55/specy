/**
 * Pure retry/backoff decision logic for the mail delivery queue.
 *
 * Imported by the send_email edge function (Deno) and unit-tested from the
 * Node test suite (tests/mailRetryPolicy.test.mjs) — must stay dependency-free.
 */

/** Maximum delivery attempts before a job is parked as terminal `failed`. */
export const MAX_MAIL_DELIVERY_ATTEMPTS = 3;

/** Base backoff for the first retry, in seconds. */
export const MAIL_RETRY_BASE_BACKOFF_SECONDS = 60;

/** Upper bound for a single backoff interval, in seconds (15 minutes). */
export const MAIL_RETRY_MAX_BACKOFF_SECONDS = 900;

/**
 * Backoff schedule (with base 60s, cap 900s):
 *   attempt 1 failed → retry after 60s
 *   attempt 2 failed → retry after 120s
 *   attempt 3 failed → terminal `failed` (job kept in the delivery log, never deleted)
 */
export type MailRetryStatus = 'pending' | 'failed';

export interface MailRetryDecision {
  /** `pending` = will be retried, `failed` = terminal (kept in DB, never deleted). */
  status: MailRetryStatus;
  /** True when the job will be attempted again. */
  retryable: boolean;
  /** Backoff interval applied for this retry, in seconds (null when terminal). */
  backoffSeconds: number | null;
  /** ISO timestamp when the job becomes eligible again (null when terminal). */
  nextAttemptAt: string | null;
}

/**
 * Decides what happens to a mail job after a failed delivery attempt.
 *
 * @param attemptCount Number of attempts already made (including the failed one).
 * @param maxAttempts  Configured maximum attempts before the job becomes terminal.
 * @param retryAfterSeconds Optional provider hint (HTTP `Retry-After`), takes
 *                          precedence over the computed exponential backoff.
 * @param now           Reference point for the next-attempt timestamp.
 */
export function computeMailRetryDecision(
  attemptCount: number,
  maxAttempts: number = MAX_MAIL_DELIVERY_ATTEMPTS,
  retryAfterSeconds: number | null = null,
  now: Date = new Date(),
): MailRetryDecision {
  const effectiveMax = Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.floor(maxAttempts)
    : MAX_MAIL_DELIVERY_ATTEMPTS;

  if (attemptCount >= effectiveMax) {
    return {
      status: 'failed',
      retryable: false,
      backoffSeconds: null,
      nextAttemptAt: null,
    };
  }

  const exponential = MAIL_RETRY_BASE_BACKOFF_SECONDS * Math.pow(2, attemptCount - 1);
  let backoff = Math.min(
    Math.max(Math.ceil(exponential), MAIL_RETRY_BASE_BACKOFF_SECONDS),
    MAIL_RETRY_MAX_BACKOFF_SECONDS,
  );

  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    backoff = Math.min(Math.ceil(retryAfterSeconds), MAIL_RETRY_MAX_BACKOFF_SECONDS);
  }

  const nextAttemptAt = new Date(now.getTime() + backoff * 1000);
  return {
    status: 'pending',
    retryable: true,
    backoffSeconds: backoff,
    nextAttemptAt: nextAttemptAt.toISOString(),
  };
}

/**
 * Parses an HTTP `Retry-After` value. Supports delay-seconds and HTTP-date
 * formats; returns null when absent or unparsable.
 */
export function parseRetryAfterHeader(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds >= 0 ? seconds : null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;

  const deltaSeconds = Math.ceil((date.getTime() - now.getTime()) / 1000);
  return deltaSeconds >= 0 ? deltaSeconds : null;
}

/**
 * True when the provider response indicates rate limiting (HTTP 429).
 */
export function isRateLimitStatus(httpStatus: number | null | undefined): boolean {
  return httpStatus === 429;
}
