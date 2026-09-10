import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffBindings,
  normalizeRemoteBinding,
  normalizeLocalBindings,
} from '../scripts/lib/binding-provisioner.mjs';
import { parseJsoncConfig } from '../scripts/lib/wrangler-config.mjs';

// ─── JSONC parsing (URL-safe comment stripping) ──────────────────────────────

test('parseJsoncConfig: strips comments but preserves // inside string values (URLs)', () => {
  const raw = `{
    // top comment
    "name": "specy-dev", /* block comment */
    "vars": {
      "SUPABASE_URL": "https://example.supabase.co" // trailing comment
    },
  }`;
  const cfg = parseJsoncConfig(raw);
  assert.ok(cfg);
  assert.equal(cfg.name, 'specy-dev');
  assert.equal(cfg.vars.SUPABASE_URL, 'https://example.supabase.co');
});

test('parseJsoncConfig: tolerates trailing commas and returns null on garbage', () => {
  assert.deepEqual(parseJsoncConfig('{ "a": 1, }'), { a: 1 });
  assert.equal(parseJsoncConfig('nope {'), null);
  assert.equal(parseJsoncConfig(null), null);
});

// ─── Remote binding normalization (defensive API shapes) ─────────────────────

test('normalizeRemoteBinding: maps the common Cloudflare settings binding types', () => {
  assert.deepEqual(
    normalizeRemoteBinding({ type: 'r2_bucket', name: 'MEDIA_BUCKET', bucket_name: 'other-bucket' }),
    { kind: 'r2_bucket', binding: 'MEDIA_BUCKET', target: 'other-bucket' },
  );
  assert.deepEqual(
    normalizeRemoteBinding({ type: 'kv_namespace', name: 'KV', namespace_id: 'abc123' }),
    { kind: 'kv_namespace', binding: 'KV', target: 'abc123' },
  );
  assert.deepEqual(
    normalizeRemoteBinding({ type: 'queue', name: 'Q', queue_name: 'my-queue' }),
    { kind: 'queue_producer', binding: 'Q', target: 'my-queue' },
  );
  assert.deepEqual(
    normalizeRemoteBinding({ type: 'secrets_store_secret', name: 'SS_X', store_id: 'store1', secret_name: 'X' }),
    { kind: 'secrets_store_secret', binding: 'SS_X', target: '?/X'.replace('?', 'store1') },
  );
  assert.deepEqual(
    normalizeRemoteBinding({ type: 'ai', name: 'AI' }),
    { kind: 'ai', binding: 'AI', target: 'workers-ai' },
  );
  assert.equal(normalizeRemoteBinding({ type: 'plain_text', name: 'SOME_VAR' }), null);
  assert.equal(normalizeRemoteBinding(null), null);
});

// ─── Local binding normalization ─────────────────────────────────────────────

test('normalizeLocalBindings: extracts all managed kinds from the generated config', () => {
  const local = normalizeLocalBindings({
    ai: { binding: 'AI' },
    r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: 'pluraconr2' }],
    kv_namespaces: [{ binding: 'CACHE', namespace_id: 'ns123' }],
    queues: {
      producers: [{ queue: 'specy-dev--pluradash--sms-notifications', binding: 'ISIBOT_SMS_QUEUE' }],
      consumers: [{ queue: 'specy-dev--pluradash--sms-notifications', max_batch_size: 5 }],
    },
    secrets_store_secrets: [{ binding: 'SS_X', store_id: 'store1', secret_name: 'X' }],
    vars: { LOG_LEVEL: 'info' },
  });
  const byBinding = Object.fromEntries(local.map((b) => [b.binding, b]));
  assert.equal(byBinding.AI.target, 'workers-ai');
  assert.equal(byBinding.MEDIA_BUCKET.target, 'pluraconr2');
  assert.equal(byBinding.CACHE.target, 'ns123');
  assert.equal(byBinding.ISIBOT_SMS_QUEUE.target, 'specy-dev--pluradash--sms-notifications');
  assert.equal(byBinding.SS_X.target, 'store1/X');
  // vars and consumers are not part of the binding diff
  assert.equal(byBinding.LOG_LEVEL, undefined);
});

// ─── Diff semantics ──────────────────────────────────────────────────────────

test('diffBindings: classifies added / removed / changed / same', () => {
  const local = [
    { kind: 'r2_bucket', binding: 'MEDIA_BUCKET', target: 'pluraconr2' },
    { kind: 'queue_producer', binding: 'ISIBOT_SMS_QUEUE', target: 'specy-dev--pluradash--sms-notifications' },
    { kind: 'kv_namespace', binding: 'CACHE', target: 'newns' },
    { kind: 'ai', binding: 'AI', target: 'workers-ai' },
  ];
  const remote = [
    { kind: 'r2_bucket', binding: 'MEDIA_BUCKET', target: 'some-other-bucket' }, // changed target
    { kind: 'queue_producer', binding: 'OLD_QUEUE', target: 'isibot-sms-notifications' }, // removed
    { kind: 'ai', binding: 'AI', target: 'workers-ai' }, // same
  ];
  const { added, removed, changed, same } = diffBindings(local, remote);

  assert.deepEqual(added.map((b) => b.binding), ['CACHE', 'ISIBOT_SMS_QUEUE']);
  assert.deepEqual(removed.map((b) => b.binding), ['OLD_QUEUE']);
  assert.deepEqual(changed, [{ binding: 'MEDIA_BUCKET', kind: 'r2_bucket', localTarget: 'pluraconr2', remoteTarget: 'some-other-bucket' }]);
  assert.deepEqual(same.map((b) => b.binding), ['AI']);
});

test('diffBindings: empty remote (never deployed) — everything is an addition, nothing removed', () => {
  const local = [{ kind: 'ai', binding: 'AI', target: 'workers-ai' }];
  const { added, removed } = diffBindings(local, []);
  assert.equal(added.length, 1);
  assert.equal(removed.length, 0);
});

test('diffBindings: converged state — empty diff', () => {
  const both = [{ kind: 'ai', binding: 'AI', target: 'workers-ai' }];
  const { added, removed, changed } = diffBindings(both, both);
  assert.equal(added.length + removed.length + changed.length, 0);
});
