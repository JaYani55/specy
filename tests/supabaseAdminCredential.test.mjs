import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSupabaseAdminCredential } from '../api/lib/supabase.ts';

test('Supabase admin credential detection accepts either the Secrets Store binding or local fallback', () => {
  assert.equal(hasSupabaseAdminCredential({}), false);
  assert.equal(hasSupabaseAdminCredential({ SUPABASE_SECRET_KEY: 'local-dev-key' }), true);
  assert.equal(hasSupabaseAdminCredential({ SS_SUPABASE_SECRET_KEY: { get: async () => 'store-key' } }), true);
});
