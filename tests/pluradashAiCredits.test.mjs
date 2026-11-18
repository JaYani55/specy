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
 * KI-Credits contract.
 *
 * The wallet (`pluradash.ai_credit_wallets`) is the live authority: one row
 * per user with a signed balance, lifetime credited and lifetime spent.
 * Balances are post-paid and may go negative. The dashboard payload carries
 * credits only — no dollar/cost fields.
 */

test('internal conversion: 1000 credits = $10', () => {
  assert.equal(CREDITS_PER_DOLLAR, 100);
  assert.equal(SUPPORT_DEFAULT_CREDITS, 1000);
  assert.equal(costToCredits(10), 1000);
  assert.equal(costToCredits(0.01), 1);
  assert.equal(costToCredits(0), 0);
  assert.equal(creditsToCost(1000), 10);
  assert.equal(creditsToCost(1), 0.01);
  assert.equal(creditsToCost(costToCredits(0.12)), 0.12);
});

test('costToCredits rounds fractional credits deterministically', () => {
  assert.equal(costToCredits(0.005), 1);
  assert.equal(costToCredits(0.004), 0);
});

test('summary reads wallets and keeps negative balances', () => {
  const summary = buildAiCreditSummary(
    [
      { user_id: 'u-1', username: 'support.dash' },
      { user_id: 'u-2', username: 'tenant.user' },
    ],
    [
      { user_id: 'u-1', balance: 1000, lifetime_credited: 1000, lifetime_spent: 0 },
      { user_id: 'u-2', balance: -250, lifetime_credited: 0, lifetime_spent: 250 },
    ],
  );

  assert.equal(summary.users.length, 2);

  const support = summary.users.find((u) => u.userId === 'u-1');
  assert.equal(support.creditsBalance, 1000);
  assert.equal(support.creditsCredited, 1000);
  assert.equal(support.creditsSpent, 0);
  assert.equal(support.username, 'support.dash');

  const consumer = summary.users.find((u) => u.userId === 'u-2');
  assert.equal(consumer.creditsBalance, -250); // overdrawn, not clamped
  assert.equal(consumer.creditsCredited, 0);
  assert.equal(consumer.creditsSpent, 250);
});

test('summary sorts by consumption (highest first)', () => {
  const summary = buildAiCreditSummary(
    [
      { user_id: 'u-1', username: 'a' },
      { user_id: 'u-2', username: 'b' },
      { user_id: 'u-3', username: 'c' },
    ],
    [
      { user_id: 'u-1', balance: 900, lifetime_credited: 1000, lifetime_spent: 100 },
      { user_id: 'u-2', balance: -900, lifetime_credited: 0, lifetime_spent: 900 },
      { user_id: 'u-3', balance: 500, lifetime_credited: 1000, lifetime_spent: 500 },
    ],
  );

  assert.deepEqual(
    summary.users.map((u) => u.userId),
    ['u-2', 'u-3', 'u-1'],
  );
});

test('summary payload is credits-only (no dollar or cost fields)', () => {
  const summary = buildAiCreditSummary([], []);
  assert.deepEqual(summary.users, []);
  assert.equal('creditsPerDollar' in summary, false);
  assert.equal('supportDefaultCredits' in summary, false);
  assert.equal('unattributedCost' in summary, false);

  const [user] = buildAiCreditSummary(
    [{ user_id: 'u-1', username: 'a' }],
    [{ user_id: 'u-1', balance: 10, lifetime_credited: 10, lifetime_spent: 0 }],
  ).users;
  assert.equal('costIncurred' in user, false);
  assert.equal('creditsTotal' in user, false);
  assert.equal('creditsRemaining' in user, false);
});
