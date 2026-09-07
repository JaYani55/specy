import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  MAX_MAIL_DELIVERY_ATTEMPTS,
  computeMailRetryDecision,
  parseRetryAfterHeader,
  isRateLimitStatus,
} = await import('../functions/send_email/retryPolicy.ts');

describe('computeMailRetryDecision', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  test('attempt 1 of 3 → requeued with 60s backoff', () => {
    const decision = computeMailRetryDecision(1, 3, null, now);
    assert.equal(decision.status, 'pending');
    assert.equal(decision.retryable, true);
    assert.equal(decision.backoffSeconds, 60);
    assert.equal(decision.nextAttemptAt, '2026-09-07T12:01:00.000Z');
  });

  test('attempt 2 of 3 → requeued with 120s backoff (exponential)', () => {
    const decision = computeMailRetryDecision(2, 3, null, now);
    assert.equal(decision.status, 'pending');
    assert.equal(decision.backoffSeconds, 120);
    assert.equal(decision.nextAttemptAt, '2026-09-07T12:02:00.000Z');
  });

  test('attempt 3 of 3 → terminal failed, job kept (never deleted)', () => {
    const decision = computeMailRetryDecision(3, 3, null, now);
    assert.equal(decision.status, 'failed');
    assert.equal(decision.retryable, false);
    assert.equal(decision.backoffSeconds, null);
    assert.equal(decision.nextAttemptAt, null);
  });

  test('attempt beyond max → terminal failed', () => {
    const decision = computeMailRetryDecision(5, 3, null, now);
    assert.equal(decision.status, 'failed');
    assert.equal(decision.retryable, false);
  });

  test('provider Retry-After hint overrides exponential backoff', () => {
    const decision = computeMailRetryDecision(1, 3, 45, now);
    assert.equal(decision.retryable, true);
    assert.equal(decision.backoffSeconds, 45);
    assert.equal(decision.nextAttemptAt, '2026-09-07T12:00:45.000Z');
  });

  test('provider Retry-After hint is capped at the maximum backoff', () => {
    const decision = computeMailRetryDecision(1, 3, 86400, now);
    assert.equal(decision.retryable, true);
    assert.equal(decision.backoffSeconds, 900);
  });

  test('exponential backoff is capped at 900s for high attempt counts', () => {
    const decision = computeMailRetryDecision(1, 10, null, now);
    assert.equal(decision.retryable, true);
    assert.equal(decision.backoffSeconds <= 900, true);
  });

  test('invalid/zero max_attempts falls back to the default of 3', () => {
    assert.equal(computeMailRetryDecision(3, 0, null, now).status, 'failed');
    assert.equal(computeMailRetryDecision(1, Number.NaN, null, now).retryable, true);
  });

  test('an email can never fail terminally before max attempts (hard requirement)', () => {
    for (let attempt = 1; attempt < MAX_MAIL_DELIVERY_ATTEMPTS; attempt++) {
      const decision = computeMailRetryDecision(attempt, MAX_MAIL_DELIVERY_ATTEMPTS, null, now);
      assert.equal(decision.retryable, true, `attempt ${attempt} must be retryable`);
      assert.equal(decision.status, 'pending');
    }
  });
});

describe('parseRetryAfterHeader', () => {
  test('delay-seconds format', () => {
    assert.equal(parseRetryAfterHeader('30'), 30);
  });

  test('HTTP-date format converts to relative seconds', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const seconds = parseRetryAfterHeader('Mon, 07 Sep 2026 12:01:00 GMT', now);
    assert.equal(seconds, 60);
  });

  test('null/empty/garbage → null', () => {
    assert.equal(parseRetryAfterHeader(null), null);
    assert.equal(parseRetryAfterHeader(''), null);
    assert.equal(parseRetryAfterHeader('soon'), null);
  });

  test('past HTTP-date → null (falls back to exponential backoff)', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const seconds = parseRetryAfterHeader('Mon, 07 Sep 2026 11:00:00 GMT', now);
    assert.equal(seconds, null);
  });
});

describe('isRateLimitStatus', () => {
  test('429 is rate limited', () => {
    assert.equal(isRateLimitStatus(429), true);
  });

  test('other statuses are not', () => {
    assert.equal(isRateLimitStatus(200), false);
    assert.equal(isRateLimitStatus(500), false);
    assert.equal(isRateLimitStatus(null), false);
  });
});
