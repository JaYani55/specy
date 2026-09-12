import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPluginRegistrationSql } from '../scripts/lib/deployment-state.mjs';

test('buildPluginRegistrationSql registers with repository URL and idempotent conflict clause', () => {
  const sql = buildPluginRegistrationSql('pluradash', 'PluraDash', '0.1.0', 'https://github.com/local-dev/pluradash');
  assert.match(sql, /insert into public\.plugins/);
  assert.match(sql, /'pluradash'/);
  assert.match(sql, /'registered'/);
  // plugins_kind_url_consistency: kind='plugin' requires repo_url NOT NULL
  assert.match(sql, /'https:\/\/github\.com\/local-dev\/pluradash'/);
  // Re-runs (e.g. repeated state:recheck --sync) must not fail on existing rows
  assert.match(sql, /on conflict \(slug\) do nothing/);
});

test('buildPluginRegistrationSql falls back to 0.0.0 when version is missing', () => {
  const sql = buildPluginRegistrationSql('acme', 'Acme', null, 'https://example.com/acme');
  assert.match(sql, /'0\.0\.0'/);
});

test('buildPluginRegistrationSql rejects plugins without a repository URL', () => {
  // Without repo_url the insert would violate plugins_kind_url_consistency —
  // the failure must surface here, not as a cryptic DB constraint error later.
  assert.throws(() => buildPluginRegistrationSql('acme', 'Acme', '1.0.0', null), /repository URL/);
  assert.throws(() => buildPluginRegistrationSql('acme', 'Acme', '1.0.0', undefined), /repository URL/);
});
