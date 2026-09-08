import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findSecretIdInTable } from '../scripts/lib/secrets-stores.mjs';

describe('findSecretIdInTable', () => {
  // Real output shape from `wrangler secrets-store secret list <id> --remote`
  // (wrangler 4.126.0 — open beta, table only, no --json support):
  const raw = [
    '🔐 Listing secrets...',
    '┌────────────────────────────┬──────────────────────────────────┬─────────┬─────────┬─────────┬─────────────────────┬─────────────────────┐',
    '│ Name                       │ ID                               │ Comment │ Scopes  │ Status  │ Created             │ Modified            │',
    '├────────────────────────────┼──────────────────────────────────┼─────────┼─────────┼─────────┼─────────────────────┼─────────────────────┤',
    '│ ISIBOT_SYNC_SECRET         │ 5bf4deda42a24da78f854ee5265955b5 │         │ workers │ active  │ 8.7.2026, 16:13:01  │ 8.7.2026, 16:13:02  │',
    '│ SUPABASE_SECRET_KEY        │ 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d │         │ workers │ active  │ 1.1.2026, 10:00:00  │ 1.1.2026, 10:00:00  │',
    '│ TWILIO_API_SECRET          │ ee29bc0bc087422f9749b2dfceb03e2a │         │ workers │ active  │ 9.7.2026, 13:24:29  │ 9.7.2026, 13:24:30  │',
    '└────────────────────────────┴──────────────────────────────────┴─────────┴─────────┴─────────┴─────────────────────┴─────────────────────┘',
  ].join('\n');

  it('finds a secret by name (case-insensitive)', () => {
    assert.equal(findSecretIdInTable(raw, 'SUPABASE_SECRET_KEY'), '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
    assert.equal(findSecretIdInTable(raw, 'supabase_secret_key'), '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
    assert.equal(findSecretIdInTable(raw, '  Twilio_Api_Secret  '), 'ee29bc0bc087422f9749b2dfceb03e2a');
  });

  it('returns null for unknown names', () => {
    assert.equal(findSecretIdInTable(raw, 'NOPE'), null);
  });

  it('returns null for header rows', () => {
    // "Name" / "ID" header must not match a lookup for name="Name"
    assert.equal(findSecretIdInTable(raw, 'Name'), null);
  });

  it('returns null for empty/null input', () => {
    assert.equal(findSecretIdInTable('', 'SUPABASE_SECRET_KEY'), null);
    assert.equal(findSecretIdInTable(null, 'SUPABASE_SECRET_KEY'), null);
  });
});
