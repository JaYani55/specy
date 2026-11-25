import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  computeWebhookRetryDecision,
} = await import('../functions/deliver_webhooks/retryPolicy.ts');

describe('computeWebhookRetryDecision', () => {
  test('attempt 1 of 3 → requeued with 60s backoff', () => {
    const decision = computeWebhookRetryDecision(1);
    assert.equal(decision.status, 'pending');
    assert.equal(decision.retryable, true);
    assert.equal(decision.backoffSeconds, 60);
  });

  test('attempt 2 of 3 → requeued with 120s backoff (exponential ×2)', () => {
    const decision = computeWebhookRetryDecision(2);
    assert.equal(decision.status, 'pending');
    assert.equal(decision.backoffSeconds, 120);
  });

  test('attempt 3 of 3 → terminal failed, job kept (never deleted)', () => {
    const decision = computeWebhookRetryDecision(3);
    assert.equal(decision.status, 'failed');
    assert.equal(decision.retryable, false);
    assert.equal(decision.backoffSeconds, null);
  });

  test('provider Retry-After overrides computed backoff (capped at 900s)', () => {
    assert.equal(computeWebhookRetryDecision(1, 30).backoffSeconds, 30);
    assert.equal(computeWebhookRetryDecision(1, 3600).backoffSeconds, 900);
  });

  test('constant matches the mail queue contract', () => {
    assert.equal(MAX_WEBHOOK_DELIVERY_ATTEMPTS, 3);
  });
});
