import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREDITS_PER_DOLLAR,
  SUPPORT_DEFAULT_CREDITS,
  buildAiCreditSummary,
  costToCredits,
  creditsToCost,
} from '../plugins/pluradash/api/aiCreditMath.ts';

/**
 * KI-Credits contract: 1000 credits = $10 (1 credit = $0.01).
 * Consumption is derived live from incurred cost; the provisioned maximum
 * comes from pluradash.ai_credit_provisions (support role → 1000, others → 0).
 */

test('credit conversion: 1000 credits = $10', () => {
  assert.equal(CREDITS_PER_DOLLAR, 100);
  assert.equal(SUPPORT_DEFAULT_CREDITS, 1000);
  assert.equal(costToCredits(10), 1000);
  assert.equal(costToCredits(0.01), 1);
  assert.equal(costToCredits(0), 0);
  assert.equal(creditsToCost(1000), 10);
  assert.equal(creditsToCost(1), 0.01);
  // Round-trip
  assert.equal(creditsToCost(costToCredits(0.12)), 0.12);
});

test('costToCredits rounds fractional credits deterministically', () => {
  // $0.005 → 0.5 credits → rounds to 1 (half-up at the credit boundary)
  assert.equal(costToCredits(0.005), 1);
  assert.equal(costToCredits(0.004), 0);
});

test('summary lists users with consumption even without a provision (0 = no allocated value)', () => {
  const summary = buildAiCreditSummary(
    [{ user_id: 'u-1', username: 'support.dash' }, { user_id: 'u-2', username: 'tenant.user' }],
    [{ user_id: 'u-1', credits_total: 1000, source: 'auto-support' }],
    [{ user_id: 'u-2', cost: 0.25 }],
  );

  assert.equal(summary.users.length, 2);

  const support = summary.users.find((u) => u.userId === 'u-1');
  assert.equal(support.creditsTotal, 1000);
  assert.equal(support.creditsUsed, 0);
  assert.equal(support.creditsRemaining, 1000);
  assert.equal(support.source, 'auto-support');

  const consumer = summary.users.find((u) => u.userId === 'u-2');
  assert.equal(consumer.creditsTotal, 0); // no provision → no allocated value
  assert.equal(consumer.creditsUsed, 25); // $0.25 → 25 credits
  assert.equal(consumer.creditsRemaining, -25); // overdrawn
  assert.equal(consumer.source, 'none');
});

test('summary sorts by consumption (highest first)', () => {
  const summary = buildAiCreditSummary(
    [
      { user_id: 'u-1', username: 'a' },
      { user_id: 'u-2', username: 'b' },
      { user_id: 'u-3', username: 'c' },
    ],
    [
      { user_id: 'u-1', credits_total: 1000, source: 'auto-support' },
      { user_id: 'u-2', credits_total: 0, source: 'backfill' },
    ],
    [
      { user_id: 'u-1', cost: 0.1 },
      { user_id: 'u-2', cost: 1.0 },
      { user_id: 'u-3', cost: 0.5 },
    ],
  );

  assert.deepEqual(
    summary.users.map((u) => u.userId),
    ['u-2', 'u-3', 'u-1'],
  );
  // Consumed credits per user
  assert.equal(summary.users[0].creditsUsed, 100);
  assert.equal(summary.users[1].creditsUsed, 50);
  assert.equal(summary.users[2].creditsUsed, 10);
});

test('summary constants travel with the payload for the dashboard', () => {
  const summary = buildAiCreditSummary([], [], []);
  assert.equal(summary.creditsPerDollar, 100);
  assert.equal(summary.supportDefaultCredits, 1000);
  assert.equal(summary.unattributedCost, 0);
  assert.deepEqual(summary.users, []);
});
