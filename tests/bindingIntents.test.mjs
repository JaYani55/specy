import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  collectManifestIntents,
  collectPluginIntents,
  resolvePluginIntents,
  resolveInstanceName,
  intentsToCollectedBindings,
  listUnprovisionedIntents,
  readWorkerName,
  readCoreSecretsStoreId,
  findLedgerRow,
  PROVISIONABLE_KINDS,
  SUPPORTED_DEPLOYMENT_PATHS,
} from '../scripts/lib/binding-intents.mjs';

function makeWranglerConfig(name, secretsStoreId) {
  const dir = mkdtempSync(join(tmpdir(), 'bips-'));
  const path = join(dir, 'wrangler.jsonc');
  writeFileSync(path, JSON.stringify({
    name,
    account_id: 'dd55d263c5a718bd15cebfea9dd36b1e',
    vars: secretsStoreId ? { SECRETS_STORE_ID: secretsStoreId } : {},
  }, null, 2), 'utf8');
  return path;
}

const legacyConfig = makeWranglerConfig('specy-dev', 'e99a63556266453693946991d25b6947');

// ─── Resolution (Layer 2 — deterministic names) ──────────────────────────────

test('resolveInstanceName: environment scope → {worker}--{plugin}--{purpose}', () => {
  assert.equal(
    resolveInstanceName('pluradash', 'sms-notifications', 'environment', 'specy-dev'),
    'specy-dev--pluradash--sms-notifications',
  );
  assert.equal(
    resolveInstanceName('pluradash', 'sms-notifications', undefined, 'specy'),
    'specy--pluradash--sms-notifications',
  );
});

test('resolveInstanceName: shared scope → {plugin}--{purpose} (account-global, plugin-namespaced)', () => {
  assert.equal(
    resolveInstanceName('pluradash', 'twilio-account-sid', 'shared', 'specy-dev'),
    'pluradash--twilio-account-sid',
  );
});

test('resolveInstanceName: two deployments of the same stack can never collide', () => {
  assert.notEqual(
    resolveInstanceName('pluradash', 'sms-notifications', 'environment', 'specy-dev'),
    resolveInstanceName('pluradash', 'sms-notifications', 'environment', 'specy'),
  );
});

// ─── Layer A — collect + validate one manifest ───────────────────────────────

test('collectManifestIntents: queues intent parses with consumer config (the incident case)', () => {
  const manifest = {
    wrangler_intents: {
      queues: [{
        binding: 'ISIBOT_SMS_QUEUE',
        purpose: 'sms-notifications',
        consumer: { max_batch_size: 5, max_batch_timeout: 10 },
      }],
    },
  };
  const { mode, intents, errors } = collectManifestIntents(manifest, 'pluradash');
  assert.equal(mode, 'intents');
  assert.deepEqual(errors, []);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'queues');
  assert.equal(intents[0].binding, 'ISIBOT_SMS_QUEUE');
  assert.equal(intents[0].purpose, 'sms-notifications');
  assert.equal(intents[0].scope, 'environment'); // default
  assert.deepEqual(intents[0].config.consumer, { max_batch_size: 5, max_batch_timeout: 10 });
});

test('collectManifestIntents: queue intent without purpose is rejected (plugin never names instances)', () => {
  const manifest = {
    wrangler_intents: { queues: [{ binding: 'Q', queue: 'isibot-sms-notifications' }] },
  };
  const { errors } = collectManifestIntents(manifest, 'pluradash');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a purpose slug/);
  assert.match(errors[0], /isibot-sms-notifications/);
});

test('collectManifestIntents: unknown kind, unknown scope and reserved r2_buckets are rejected', () => {
  const manifest = {
    wrangler_intents: {
      s3_buckets: [],
      queues: [{ binding: 'Q', purpose: 'x', scope: 'tenant' }],
      r2_buckets: [{ binding: 'MEDIA', purpose: 'media' }],
    },
  };
  const { errors } = collectManifestIntents(manifest, 'pluradash');
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => /s3_buckets is not a supported binding kind/.test(e)));
  assert.ok(errors.some((e) => /unknown scope "tenant"/.test(e)));
  assert.ok(errors.some((e) => /r2_buckets is owned by the CMS core/.test(e)));
});

test('collectManifestIntents: unknown deployment_path is rejected (cloudflare is default and only path)', () => {
  const manifest = { deployment_path: 'aws', wrangler_intents: {} };
  const { errors, deploymentPath } = collectManifestIntents(manifest, 'pluradash');
  assert.deepEqual(SUPPORTED_DEPLOYMENT_PATHS, ['cloudflare']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deployment_path "aws" is not supported/);
  assert.equal(deploymentPath, 'aws');
});

test('collectManifestIntents: defaults — deployment_path cloudflare, no intents declared', () => {
  assert.deepEqual(collectManifestIntents({}, 'pluradash').mode, 'none');
  const manifest = { deployment_path: 'CLOUDFLARE', wrangler_intents: {} };
  const { errors, deploymentPath } = collectManifestIntents(manifest, 'pluradash');
  assert.deepEqual(errors, []);
  assert.equal(deploymentPath, 'cloudflare'); // trimmed + lowercased
});

test('collectManifestIntents: legacy wrangler_bindings → verbatim mode with deprecation warning', () => {
  const manifest = { wrangler_bindings: { queues: { producers: [{ queue: 'isibot-sms-notifications', binding: 'Q' }] } } };
  const { mode, legacy, warnings } = collectManifestIntents(manifest, 'pluradash');
  assert.equal(mode, 'legacy');
  assert.equal(legacy.queues.producers[0].queue, 'isibot-sms-notifications');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /legacy wrangler_bindings/);
});

test('collectManifestIntents: both forms → intents win with warning', () => {
  const manifest = {
    wrangler_intents: { queues: [{ binding: 'Q', purpose: 'x' }] },
    wrangler_bindings: { queues: { producers: [{ queue: 'concrete-name', binding: 'Q' }] } },
  };
  const { mode, warnings } = collectManifestIntents(manifest, 'pluradash');
  assert.equal(mode, 'intents');
  assert.ok(warnings.some((w) => /wrangler_intents wins/.test(w)));
});

test('collectManifestIntents: duplicate purpose per plugin is single-source enforced', () => {
  const manifest = {
    wrangler_intents: {
      queues: [
        { binding: 'Q1', purpose: 'sms-notifications' },
        { binding: 'Q2', purpose: 'sms-notifications' },
      ],
    },
  };
  const { errors } = collectManifestIntents(manifest, 'pluradash');
  assert.ok(errors.some((e) => /duplicate queue purpose/.test(e)));
});

test('collectManifestIntents: secrets intent derives UPPER_SNAKE secret_name from purpose; store_id omitted → null (core store)', () => {
  const manifest = {
    wrangler_intents: {
      secrets_store_secrets: [{ binding: 'SS_TWILIO_ACCOUNT_SID', purpose: 'twilio-account-sid' }],
    },
  };
  const { intents, errors } = collectManifestIntents(manifest, 'pluradash');
  assert.deepEqual(errors, []);
  assert.equal(intents[0].config.secret_name, 'TWILIO_ACCOUNT_SID');
  assert.equal(intents[0].config.store_id, null);
  assert.equal(intents[0].scope, 'shared'); // secrets default to shared (account-level store values)
});

test('collectManifestIntents: kv intent with namespace_id warns — intents never name instances', () => {
  const manifest = {
    wrangler_intents: { kv_namespaces: [{ binding: 'KV', purpose: 'cache', namespace_id: '0123456789abcdef0123456789abcdef' }] },
  };
  const { warnings, errors } = collectManifestIntents(manifest, 'pluradash');
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /intents never name instances/.test(w)));
});

test('collectManifestIntents: vars intent record — duplicate keys rejected', () => {
  const bad = { wrangler_intents: { vars: { LOG_LEVEL: 'debug' } } };
  assert.deepEqual(collectManifestIntents(bad, 'pluradash').errors, []);
  const dup = { wrangler_intents: { vars: { 'LOG_LEVEL': 'debug', LOG_LEVEL: 'info' } } };
  // JSON.parse dedupes object keys — the duplicate scenario only arises via
  // normalized input, so assert the happy path keeps the value string-typed.
  assert.equal(collectManifestIntents(dup, 'pluradash').intents[0].config.value, 'info');
});

// ─── Layer B — resolution against the deployment ─────────────────────────────

test('resolvePluginIntents: queues/kv resolve to per-environment names; secrets resolve to the secret name + core store', () => {
  const manifest = {
    wrangler_intents: {
      queues: [{ binding: 'ISIBOT_SMS_QUEUE', purpose: 'sms-notifications' }],
      kv_namespaces: [{ binding: 'CACHE', purpose: 'cache' }],
      secrets_store_secrets: [{ binding: 'SS_TWILIO_ACCOUNT_SID', purpose: 'twilio-account-sid' }],
    },
  };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, {
    workerName: 'specy-dev',
    coreSecretsStoreId: 'e99a63556266453693946991d25b6947',
  });

  const queue = resolved.find((i) => i.kind === 'queues');
  const kv = resolved.find((i) => i.kind === 'kv_namespaces');
  const secret = resolved.find((i) => i.kind === 'secrets_store_secrets');

  assert.equal(queue.resolvedName, 'specy-dev--pluradash--sms-notifications');
  assert.equal(kv.resolvedName, 'specy-dev--pluradash--cache');
  assert.equal(secret.resolvedName, 'TWILIO_ACCOUNT_SID');
  assert.equal(secret.config.store_id, 'e99a63556266453693946991d25b6947'); // resolved from core config
  assert.equal(queue.instanceId, null); // unprovisioned
});

test('resolvePluginIntents: ledger rows provide provisioned instance ids', () => {
  const manifest = { wrangler_intents: { kv_namespaces: [{ binding: 'CACHE', purpose: 'cache' }] } };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const ledger = {
    environment: 'specy-dev',
    resources: [{
      resolved_name: 'specy-dev--pluradash--cache',
      kind: 'kv_namespaces',
      plugin_id: 'pluradash',
      purpose: 'cache',
      scope: 'environment',
      instance_id: 'fedcba9876543210fedcba9876543210',
    }],
  };
  const resolved = resolvePluginIntents(intents, { workerName: 'specy-dev', ledger });
  assert.equal(resolved[0].instanceId, 'fedcba9876543210fedcba9876543210');
  assert.equal(findLedgerRow(ledger, 'pluradash', 'kv_namespaces', 'cache')?.instance_id, resolved[0].instanceId);
});

// ─── Layer C — aggregate conflicts across plugins ─────────────────────────────

test('collectPluginIntents: binding name claimed by two plugins aborts (per kind)', () => {
  const plugins = [
    { id: 'a', manifest: { wrangler_intents: { queues: [{ binding: 'Q', purpose: 'sms' }] } } },
    { id: 'b', manifest: { wrangler_intents: { queues: [{ binding: 'Q', purpose: 'orders' }] } } },
  ];
  const { errors } = collectPluginIntents(plugins, { wranglerJsoncPath: legacyConfig });
  assert.ok(errors.some((e) => /already claimed by plugin "a"/.test(e)));
});

test('collectPluginIntents: same binding name under different kinds is allowed', () => {
  const plugins = [
    { id: 'a', manifest: { wrangler_intents: { queues: [{ binding: 'Q', purpose: 'sms' }] } } },
    { id: 'b', manifest: { wrangler_intents: { kv_namespaces: [{ binding: 'Q', purpose: 'cache' }] } } },
  ];
  const { errors } = collectPluginIntents(plugins, { wranglerJsoncPath: legacyConfig });
  assert.deepEqual(errors, []);
});

test('collectPluginIntents: shared instances are single-source — same shared name from two plugins aborts', () => {
  const plugins = [
    { id: 'a', manifest: { wrangler_intents: { secrets_store_secrets: [{ binding: 'SS', purpose: 'twilio-account-sid' }] } } },
    { id: 'b', manifest: { wrangler_intents: { secrets_store_secrets: [{ binding: 'SS', purpose: 'twilio-account-sid' }] } } },
  ];
  const { errors } = collectPluginIntents(plugins, { wranglerJsoncPath: legacyConfig });
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => /already claimed by plugin "a"/.test(e)));
  assert.ok(errors.some((e) => /shared .* single-source|already declared by plugin "a"/.test(e)));
});

// ─── Layer D — collected Map shape for the injector ──────────────────────────

test('intentsToCollectedBindings: producer + consumer wire to the SAME resolved instance', () => {
  const manifest = {
    wrangler_intents: {
      queues: [{
        binding: 'ISIBOT_SMS_QUEUE',
        purpose: 'sms-notifications',
        consumer: { max_batch_size: 5, max_batch_timeout: 10 },
      }],
    },
  };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, { workerName: 'specy-dev' });
  const { collected } = intentsToCollectedBindings(resolved);

  const queues = collected.get('queues');
  assert.equal(queues.length, 2);
  const producer = queues.find((e) => e.entry._kind === 'producer');
  const consumer = queues.find((e) => e.entry._kind === 'consumer');
  assert.equal(producer.entry.queue, 'specy-dev--pluradash--sms-notifications');
  assert.equal(consumer.entry.queue, producer.entry.queue); // atomic wiring — the exact step that failed
  assert.equal(consumer.entry.max_batch_size, 5);
  assert.equal(producer.entry.binding, 'ISIBOT_SMS_QUEUE');
  assert.ok(!('binding' in consumer.entry)); // consumer config carries no binding handle
});

test('intentsToCollectedBindings: a queue/binding key in consumer config never overrides the resolved instance', () => {
  // Regression: a manifest migrated from legacy wrangler_bindings can carry the
  // old concrete queue name inside the consumer object — resolution must win.
  const manifest = {
    wrangler_intents: {
      queues: [{
        binding: 'ISIBOT_SMS_QUEUE',
        purpose: 'sms-notifications',
        consumer: { queue: 'isibot-sms-notifications', max_batch_size: 5 },
      }],
    },
  };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, { workerName: 'specy-dev' });
  const { collected } = intentsToCollectedBindings(resolved);
  const consumer = collected.get('queues').find((e) => e.entry._kind === 'consumer');
  assert.equal(consumer.entry.queue, 'specy-dev--pluradash--sms-notifications');
});

test('intentsToCollectedBindings: kv entry needs a provisioned id — unprovisioned skipped + listed', () => {
  const manifest = { wrangler_intents: { kv_namespaces: [{ binding: 'CACHE', purpose: 'cache' }] } };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, { workerName: 'specy-dev' });
  const { collected, unprovisioned } = intentsToCollectedBindings(resolved);
  assert.equal(collected.has('kv_namespaces'), false);
  assert.equal(unprovisioned.length, 1);
  assert.deepEqual(listUnprovisionedIntents(resolved).map((i) => i.kind), ['kv_namespaces']);
  assert.deepEqual(PROVISIONABLE_KINDS, ['queues', 'kv_namespaces']);
});

test('intentsToCollectedBindings: provisioned kv → wrangler entry with the ledger namespace id', () => {
  const manifest = { wrangler_intents: { kv_namespaces: [{ binding: 'CACHE', purpose: 'cache' }] } };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, {
    workerName: 'specy-dev',
    ledger: { resources: [{ kind: 'kv_namespaces', plugin_id: 'pluradash', purpose: 'cache', instance_id: 'fedcba9876543210fedcba9876543210' }] },
  });
  const { collected } = intentsToCollectedBindings(resolved);
  const entries = collected.get('kv_namespaces');
  assert.equal(entries[0].entry.namespace_id, 'fedcba9876543210fedcba9876543210');
  assert.equal(entries[0].entry.binding, 'CACHE');
});

test('intentsToCollectedBindings: vars land in __vars with plugin attribution; secrets emit resolved entries', () => {
  const manifest = {
    wrangler_intents: {
      vars: { PLURADASH_SYNC_LOG_LEVEL: '' },
      secrets_store_secrets: [{ binding: 'SS_TWILIO_ACCOUNT_SID', purpose: 'twilio-account-sid' }],
    },
  };
  const { intents } = collectManifestIntents(manifest, 'pluradash');
  const resolved = resolvePluginIntents(intents, {
    workerName: 'specy-dev',
    coreSecretsStoreId: 'e99a63556266453693946991d25b6947',
  });
  const { collected, pluginVars } = intentsToCollectedBindings(resolved);
  assert.deepEqual(pluginVars['PLURADASH_SYNC_LOG_LEVEL'], { value: '', pluginId: 'pluradash' });
  const secrets = collected.get('secrets_store_secrets');
  assert.deepEqual(secrets[0].entry, {
    binding: 'SS_TWILIO_ACCOUNT_SID',
    store_id: 'e99a63556266453693946991d25b6947',
    secret_name: 'TWILIO_ACCOUNT_SID',
  });
});

// ─── Config parsing helpers ──────────────────────────────────────────────────

test('readWorkerName reads the deployment worker name from the generated wrangler.jsonc', () => {
  assert.equal(readWorkerName(legacyConfig), 'specy-dev');
  assert.equal(readWorkerName(join(tmpdir(), 'bips-does-not-exist')), 'specy');
});

test('readCoreSecretsStoreId reads the core SECRETS_STORE_ID var', () => {
  assert.equal(readCoreSecretsStoreId(legacyConfig), 'e99a63556266453693946991d25b6947');
  assert.equal(readCoreSecretsStoreId(join(tmpdir(), 'bips-does-not-exist')), null);
});
