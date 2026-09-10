import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  auditBindingConsistency,
  printBindingAuditReport,
} from '../scripts/lib/binding-consistency.mjs';

// Temp generated-config fixture (audit reads worker name + SECRETS_STORE_ID
// from it — same as the real generated wrangler.jsonc).
function makeConfig(name, secretsStoreId = null) {
  const dir = mkdtempSync(join(tmpdir(), 'bips-audit-'));
  const path = join(dir, 'wrangler.jsonc');
  writeFileSync(path, JSON.stringify({
    name,
    vars: secretsStoreId ? { SECRETS_STORE_ID: secretsStoreId } : {},
  }, null, 2), 'utf8');
  return path;
}

const CONFIG_WITH_STORE = makeConfig('specy', 'store1');
const CONFIG_NO_STORE = makeConfig('specy');

const INTENTS = {
  wrangler_intents: {
    queues: [{ binding: 'Q', purpose: 'sms', consumer: { max_batch_size: 5 } }],
    kv_namespaces: [{ binding: 'KV', purpose: 'cache' }],
    secrets_store_secrets: [{ binding: 'SS_X', purpose: 'x-secret' }],
    ai: { binding: 'AI' },
    vars: { LOG: 'debug' },
  },
};

function ledgerRow(overrides = {}) {
  return {
    resolved_name: 'specy--pluradash--sms',
    kind: 'queues',
    plugin_id: 'pluradash',
    purpose: 'sms',
    scope: 'environment',
    instance_id: 'q1',
    wiring: {},
    ...overrides,
  };
}

test('audit: fully converged state — intents, provisioned, secrets, ledger, config', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'pluradash', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy', resources: [
      ledgerRow(),
      { kind: 'kv_namespaces', plugin_id: 'pluradash', purpose: 'cache', scope: 'environment', instance_id: 'ns1', resolved_name: 'specy--pluradash--cache' },
      { kind: 'secrets_store_secrets', plugin_id: 'pluradash', purpose: 'x-secret', scope: 'shared', instance_id: null, resolved_name: 'X_SECRET', wiring: { store_id: 'store1' } },
    ] },
  });

  assert.equal(audit.consistent, true);
  const byId = Object.fromEntries(audit.checks.map((c) => [c.id, c]));
  assert.equal(byId['intents-valid'].state, 'ok');
  assert.equal(byId['provisioned'].state, 'converged');
  assert.equal(byId['secrets-resolved'].state, 'converged');
  assert.equal(byId['ledger-fresh'].state, 'converged');
  assert.match(byId['secrets-resolved'].detail, /1\/1 resolved/);
});

test('audit: unprovisioned queue → pending with the provision command', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'pluradash', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy', resources: [] },
  });
  assert.equal(audit.consistent, false);
  const provisioned = audit.checks.find((c) => c.id === 'provisioned');
  assert.equal(provisioned.state, 'pending');
  const items = provisioned.items.filter((i) => i.state === 'pending');
  assert.ok(items.every((i) => i.command === 'npm run bindings:provision'));
});

test('audit: stale ledger rows (renamed purpose / removed plugin) detected with teardown command', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'pluradash', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy', resources: [
      ledgerRow(),
      ledgerRow({ purpose: 'renamed-away', resolved_name: 'specy--pluradash--renamed-away', instance_id: 'q_old' }),
      ledgerRow({ plugin_id: 'ghost-plugin', purpose: 'gone', instance_id: 'q2' }),
    ] },
  });
  assert.equal(audit.consistent, false);
  const ledger = audit.checks.find((c) => c.id === 'ledger-fresh');
  assert.equal(ledger.state, 'pending');
  assert.equal(ledger.items.length, 2);
  assert.ok(ledger.items.every((i) => i.command?.startsWith('npm run bindings:provision -- --teardown')));
  // Detail distinguishes declaration-changed vs plugin-gone
  assert.match(ledger.items[0].detail, /declaration changed/);
  assert.match(ledger.items[1].detail, /no longer installed/);
});

test('audit: environment mismatch (ledger written by another deployment) → re-provision', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'pluradash', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy-prod', resources: [ledgerRow({ resolved_name: 'specy-prod--pluradash--sms' })] },
  });
  const ledger = audit.checks.find((c) => c.id === 'ledger-fresh');
  assert.equal(ledger.state, 'pending');
  assert.match(ledger.detail, /environment mismatch/);
  assert.match(ledger.items[0].label, /specy-prod.*specy|≠/);
  assert.equal(ledger.items[0].command, 'npm run bindings:provision');
});

test('audit: invalid intents → hard error state (build would fail)', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'bad', dirName: 'b', manifest: { wrangler_intents: { queues: [{ binding: 'Q' }] } } }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: null,
  });
  assert.equal(audit.consistent, false);
  const intents = audit.checks.find((c) => c.id === 'intents-valid');
  assert.equal(intents.state, 'error');
});

test('audit: legacy-only plugins → no provisioning checks, deprecation flagged as pending', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'legacy', dirName: 'legacy', manifest: { wrangler_bindings: { ai: { binding: 'AI' } } } }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: null,
  });
  const legacy = audit.checks.find((c) => c.id === 'no-legacy');
  assert.equal(legacy.state, 'pending');
  assert.match(legacy.items[0].label, /legacy/);
});

test('audit: secrets without a resolvable store → pending with setup command', () => {
  // Config fixture WITHOUT SECRETS_STORE_ID → the link cannot resolve.
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'p', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_NO_STORE,
    ledger: { environment: 'specy', resources: [ledgerRow(), { kind: 'kv_namespaces', plugin_id: 'pluradash', purpose: 'cache', scope: 'environment', instance_id: 'ns1', resolved_name: 'specy--pluradash--cache' }] },
  });
  const secrets = audit.checks.find((c) => c.id === 'secrets-resolved');
  assert.equal(secrets.state, 'pending');
  assert.match(secrets.items[0].detail, /no SECRETS_STORE_ID/);
  assert.match(secrets.items[0].command ?? '', /setup/);
});

test('printBindingAuditReport: groups pending commands and reports allClear', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'p', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy', resources: [] },
  });
  const lines = [];
  const { pendingCommands, allClear } = printBindingAuditReport(audit, { log: (m) => lines.push(m) });
  assert.equal(allClear, false);
  assert.ok(lines.some((l) => /Provisioned instances/.test(l)));
  assert.ok(pendingCommands.has('npm run bindings:provision'));
});

test('printBindingAuditReport: converged audit → no pending commands', () => {
  const audit = auditBindingConsistency({
    plugins: [{ id: 'pluradash', dirName: 'p', manifest: INTENTS }],
    wranglerJsoncPath: CONFIG_WITH_STORE,
    ledger: { environment: 'specy', resources: [
      ledgerRow(),
      { kind: 'kv_namespaces', plugin_id: 'pluradash', purpose: 'cache', scope: 'environment', instance_id: 'ns1', resolved_name: 'specy--pluradash--cache' },
      { kind: 'secrets_store_secrets', plugin_id: 'pluradash', purpose: 'x-secret', scope: 'shared', instance_id: null, resolved_name: 'X_SECRET', wiring: { store_id: 'store1' } },
    ] },
  });
  const { allClear, pendingCommands } = printBindingAuditReport(audit, { log: () => {} });
  assert.equal(allClear, true);
  assert.equal(pendingCommands.size, 0);
});
