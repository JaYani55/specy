/**
 * scripts/lib/binding-provisioner.mjs
 *
 * Deploy-time provisioning for plugin binding intents (BIPS Layer 3):
 * create-or-get per resolved instance via the Cloudflare API, recorded in the
 * resource ledger. Used by scripts/provision-bindings.mjs (CLI) and by the
 * plugin installer.
 *
 * Per-deployment-path extensibility: every provisioner is keyed by
 * `deployment_path` — today only `cloudflare` exists. A future vendor system
 * (e.g. AWS) adds its own provision functions here and extends
 * SUPPORTED_DEPLOYMENT_PATHS in scripts/lib/binding-intents.mjs.
 *
 * Token doctrine: CF_API_TOKEN is a deploy-operator credential (Worker secret /
 * .env) with resource-create scopes; it never reaches plugin code — the plugin
 * only declares intents (the binding is the permission+API, not a key).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { emptyLedger, LEDGER_FILE } from './binding-intents.mjs';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ─── Cloudflare API facade ────────────────────────────────────────────────────

/**
 * Thin Cloudflare API v4 caller. Returns `{ ok, status, body }` — never throws
 * for HTTP errors (create-or-get needs to inspect "already exists" responses).
 */
export async function cfApi(token, accountId, path, { method = 'GET', body = undefined } = {}) {
  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let bodyJson = null;
  try { bodyJson = await res.json(); } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, body: bodyJson };
}

function cfErrorText(body) {
  const errors = body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ');
  }
  return body?.message ?? 'non-JSON response';
}

// ─── Provisioners (create-or-get, idempotent) ────────────────────────────────

/**
 * Create-or-get a queue by its resolved name.
 * Duplicate-name responses are tolerated: any non-2xx is followed by a list
 * lookup — if the queue exists, create-or-get succeeded.
 */
export async function provisionQueue(token, accountId, queueName) {
  const created = await cfApi(token, accountId, '/queues', { method: 'POST', body: { queue_name: queueName } });
  if (created.ok) {
    return { created: true, queueId: created.body?.result?.queue_id ?? created.body?.result?.id ?? null, queueName };
  }
  // create-or-get: tolerate "already exists" — verify via list.
  const list = await cfApi(token, accountId, '/queues');
  if (list.ok) {
    const queues = Array.isArray(list.body?.result) ? list.body.result : [];
    const found = queues.find((q) => q.queue_name === queueName || q.name === queueName);
    if (found) {
      return { created: false, queueId: found.queue_id ?? found.id ?? null, queueName };
    }
  }
  throw new Error(`Queue "${queueName}" could not be created or found: ${cfErrorText(created.body)}`);
}

/**
 * Create-or-get a KV namespace by its resolved title.
 */
export async function provisionKvNamespace(token, accountId, namespaceTitle) {
  const created = await cfApi(token, accountId, '/storage/kv/namespaces', { method: 'POST', body: { title: namespaceTitle } });
  if (created.ok) {
    return { created: true, namespaceId: created.body?.result?.id ?? null, namespaceTitle };
  }
  const list = await cfApi(token, accountId, '/storage/kv/namespaces');
  if (list.ok) {
    const namespaces = Array.isArray(list.body?.result) ? list.body.result : [];
    const found = namespaces.find((ns) => ns.title === namespaceTitle);
    if (found) {
      return { created: false, namespaceId: found.id ?? null, namespaceTitle };
    }
  }
  throw new Error(`KV namespace "${namespaceTitle}" could not be created or found: ${cfErrorText(created.body)}`);
}

/**
 * Verify that a Secrets Store secret exists (link target for
 * secrets_store_secrets intents). Secrets Store values are operator-provisioned
 * per deployment; the provisioner only verifies the link and reports missing
 * secrets (creation is a deliberate operator action — see
 * specs/platform/binding-management.md §5).
 */
export async function verifySecretLink(token, accountId, storeId, secretName) {
  const list = await cfApi(token, accountId, `/secrets_store/stores/${storeId}/secrets`);
  if (!list.ok) {
    throw new Error(`Secrets Store "${storeId}" is not readable: ${cfErrorText(list.body)}`);
  }
  const secrets = Array.isArray(list.body?.result) ? list.body.result : [];
  const found = secrets.find((s) => s.name === secretName);
  return { exists: Boolean(found), secretName, storeId };
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export function readLedgerFromPath(root) {
  const path = join(root, LEDGER_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && Array.isArray(parsed.resources) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Merge provisioned rows into the ledger and write the git-ignored sidecar.
 * Rows are keyed by (plugin_id, kind, purpose) — re-provisioning updates the
 * row in place (declarative reconcile: the ledger reflects the final declared
 * state alone).
 *
 * @param {string} root Repo root.
 * @param {string} workerName Deployment worker name.
 * @param {object[]} rows Rows of { resolved_name, kind, plugin_id, purpose, scope, instance_id?, wiring }.
 * @returns {object} The written ledger.
 */
export function writeLedger(root, workerName, rows) {
  const path = join(root, LEDGER_FILE);
  let ledger = readLedgerFromPath(root);
  if (!ledger) ledger = emptyLedger(workerName);

  const resources = Array.isArray(ledger.resources) ? [...ledger.resources] : [];
  for (const row of rows) {
    const idx = resources.findIndex(
      (r) => r.plugin_id === row.plugin_id && r.kind === row.kind && r.purpose === row.purpose,
    );
    const record = {
      resolved_name: row.resolved_name,
      kind: row.kind,
      plugin_id: row.plugin_id,
      purpose: row.purpose,
      scope: row.scope,
      instance_id: row.instance_id ?? null,
      wiring: row.wiring ?? null,
      created_at: resources[idx]?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) resources[idx] = record;
    else resources.push(record);
  }

  const written = { ...ledger, environment: workerName, resources };
  writeFileSync(path, JSON.stringify(written, null, 2) + '\n', 'utf8');
  return written;
}

/**
 * Remove a plugin's ledger rows (after teardown deletes the cloud instances).
 *
 * @param {string} root Repo root.
 * @param {string} pluginId
 * @returns {{ removed: number }}
 */
export function removePluginLedgerRows(root, pluginId) {
  const ledger = readLedgerFromPath(root);
  if (!ledger) return { removed: 0 };
  const before = ledger.resources.length;
  const remaining = ledger.resources.filter((r) => r.plugin_id !== pluginId);
  if (remaining.length === before) return { removed: 0 };
  writeFileSync(join(root, LEDGER_FILE), JSON.stringify({ ...ledger, resources: remaining }, null, 2) + '\n', 'utf8');
  return { removed: before - remaining.length };
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Provision all provisionable resolved intents for the current deployment.
 * Fails (throws) on the first unrecoverable API error — provisioning failures
 * surface as config-level errors BEFORE `wrangler deploy`, never as cryptic
 * post-deploy binding errors.
 *
 * Queue consumer registration is intentionally NOT done here: consumers are
 * declared in the generated wrangler.jsonc and registered by wrangler at deploy
 * time — against the same resolved instance the producer uses (atomic wiring).
 *
 * @param {object[]} resolvedIntents Layer C output (resolvedIntents).
 * @param {{ token: string, accountId: string, root: string, workerName: string, verifySecrets?: boolean }} opts
 * @returns {{ rows: object[], created: string[], got: string[], verifiedSecrets: string[], missingSecrets: string[] }}
 */
export async function provisionBindingIntents(resolvedIntents, { token, accountId, root, workerName, verifySecrets = true }) {
  const rows = [];
  const created = [];
  const got = [];
  const already = [];   // steps already completed before this run (from the ledger)
  const verifiedSecrets = [];
  const missingSecrets = [];

  for (const intent of resolvedIntents) {
    if (intent.kind === 'queues') {
      // Step detection: a ledger row with an instance id means this step is
      // already complete for this environment — skip the API call entirely.
      if (intent.instanceId) {
        already.push(intent.resolvedName);
        rows.push({
          resolved_name: intent.resolvedName,
          kind: 'queues',
          plugin_id: intent.pluginId,
          purpose: intent.purpose,
          scope: intent.scope,
          instance_id: intent.instanceId,
          wiring: { binding: intent.binding, consumer: intent.config.consumer ?? null },
        });
        continue;
      }
      const result = await provisionQueue(token, accountId, intent.resolvedName);
      (result.created ? created : got).push(intent.resolvedName);
      rows.push({
        resolved_name: intent.resolvedName,
        kind: 'queues',
        plugin_id: intent.pluginId,
        purpose: intent.purpose,
        scope: intent.scope,
        instance_id: result.queueId,
        wiring: { binding: intent.binding, consumer: intent.config.consumer ?? null },
      });
    } else if (intent.kind === 'kv_namespaces') {
      if (intent.instanceId) {
        already.push(intent.resolvedName);
        rows.push({
          resolved_name: intent.resolvedName,
          kind: 'kv_namespaces',
          plugin_id: intent.pluginId,
          purpose: intent.purpose,
          scope: intent.scope,
          instance_id: intent.instanceId,
          wiring: { binding: intent.binding },
        });
        continue;
      }
      const result = await provisionKvNamespace(token, accountId, intent.resolvedName);
      (result.created ? created : got).push(intent.resolvedName);
      rows.push({
        resolved_name: intent.resolvedName,
        kind: 'kv_namespaces',
        plugin_id: intent.pluginId,
        purpose: intent.purpose,
        scope: intent.scope,
        instance_id: result.namespaceId,
        wiring: { binding: intent.binding },
      });
    } else if (intent.kind === 'secrets_store_secrets' && verifySecrets && intent.config.store_id) {
      // Secret links are cheap to re-verify — always checked, never assumed.
      const result = await verifySecretLink(token, accountId, intent.config.store_id, intent.config.secret_name);
      if (result.exists) verifiedSecrets.push(intent.config.secret_name);
      else missingSecrets.push(intent.config.secret_name);
      rows.push({
        resolved_name: intent.config.secret_name,
        kind: 'secrets_store_secrets',
        plugin_id: intent.pluginId,
        purpose: intent.purpose,
        scope: intent.scope,
        instance_id: null,
        wiring: { binding: intent.binding, store_id: intent.config.store_id, provision: intent.config.provision ?? 'link' },
      });
    }
  }

  if (rows.length > 0) {
    writeLedger(root, workerName, rows);
  }

  return { rows, created, got, already, verifiedSecrets, missingSecrets };
}

/**
 * Teardown: delete environment-scoped cloud instances a plugin owns (its
 * per-environment instances from the ledger) — the downmigration analog for
 * bindings. Shared-scoped instances are never deleted (other deployments may
 * link them); they are reported instead.
 *
 * @param {string} pluginId
 * @param {{ token: string, accountId: string, root: string, dryRun?: boolean }} opts
 * @returns {{ deleted: { resolved_name: string, kind: string }[], kept: { resolved_name: string, reason: string }[], missing: string[] }}
 */
export async function teardownPluginBindings(pluginId, { token, accountId, root, dryRun = false }) {
  const ledger = readLedgerFromPath(root);
  const deleted = [];
  const kept = [];
  const missing = [];

  if (!ledger) return { deleted, kept, missing };

  for (const row of ledger.resources) {
    if (row.plugin_id !== pluginId) continue;

    if (row.scope === 'shared') {
      kept.push({ resolved_name: row.resolved_name, reason: 'shared instance — other deployments may link it' });
      continue;
    }

    if (dryRun) {
      deleted.push({ resolved_name: row.resolved_name, kind: row.kind });
      continue;
    }

    if (row.kind === 'queues' && row.instance_id) {
      const del = await cfApi(token, accountId, `/queues/${row.instance_id}`, { method: 'DELETE' });
      if (del.ok || del.status === 404) {
        deleted.push({ resolved_name: row.resolved_name, kind: row.kind });
      } else if (del.status === 404 || del.status === 410) {
        missing.push(row.resolved_name);
      } else {
        throw new Error(`Queue "${row.resolved_name}" could not be deleted: ${cfErrorText(del.body)}`);
      }
    } else if (row.kind === 'kv_namespaces' && row.instance_id) {
      const del = await cfApi(token, accountId, `/storage/kv/namespaces/${row.instance_id}`, { method: 'DELETE' });
      if (del.ok || del.status === 404 || del.status === 410) {
        deleted.push({ resolved_name: row.resolved_name, kind: row.kind });
      } else {
        throw new Error(`KV namespace "${row.resolved_name}" could not be deleted: ${cfErrorText(del.body)}`);
      }
    } else {
      // No instance id recorded (e.g. secret links) — report, don't guess.
      kept.push({ resolved_name: row.resolved_name, reason: `no instance id recorded for kind "${row.kind}"` });
    }
  }

  if (!dryRun && (deleted.length > 0 || kept.length > 0 || missing.length > 0)) {
    removePluginLedgerRows(root, pluginId);
  }

  return { deleted, kept, missing };
}

// ─── Remote drift detection (reproducible deploy diff) ───────────────────────

/**
 * Fetch the live Worker's bindings via the Cloudflare API (the same diff
 * `wrangler deploy` prompts about — but as a machine-readable report, before
 * the prompt).
 *
 * @param {{ token: string, accountId: string, workerName: string }} opts
 * @returns {{ ok: boolean, bindings: object[], raw: object|null, error?: string }}
 */
export async function fetchRemoteBindings({ token, accountId, workerName }) {
  const res = await cfApi(token, accountId, `/workers/scripts/${encodeURIComponent(workerName)}/settings`);
  if (!res.ok) {
    // 404 = script never deployed — nothing to drift against.
    if (res.status === 404) return { ok: true, bindings: [], raw: null };
    return { ok: false, bindings: [], raw: res.body, error: cfErrorText(res.body) };
  }
  const bindings = Array.isArray(res.body?.result?.bindings) ? res.body.result.bindings : [];
  return { ok: true, bindings, raw: res.body?.result ?? null };
}

/**
 * Normalize a remote settings binding entry into the comparable shape.
 * Defensive field mapping — the API shape per type varies between wrangler/API
 * versions, so the mapper reads the common field spellings.
 *
 * @param {object} entry Remote bindings[] entry.
 * @returns {{ kind: string, binding: string, target: string } | null}
 */
export function normalizeRemoteBinding(entry) {
  if (!entry || !entry.type || !entry.name) return null;
  const type = String(entry.type).toLowerCase();
  if (type.includes('r2')) {
    return { kind: 'r2_bucket', binding: entry.name, target: entry.bucket_name ?? '(unknown)' };
  }
  if (type.includes('kv')) {
    return { kind: 'kv_namespace', binding: entry.name, target: entry.namespace_id ?? '(unknown)' };
  }
  if (type.includes('queue')) {
    return { kind: 'queue_producer', binding: entry.name, target: entry.queue_name ?? entry.queue ?? '(unknown)' };
  }
  if (type.includes('secret') && type.includes('store')) {
    return { kind: 'secrets_store_secret', binding: entry.name, target: `${entry.store_id ?? '?'}/${entry.secret_name ?? '?'}` };
  }
  if (type === 'ai') {
    return { kind: 'ai', binding: entry.name, target: 'workers-ai' };
  }
  return null; // vars/secrets/etc. are deployment-local, not binding-managed here
}

/**
 * Normalize the local (generated) wrangler.jsonc config into the same shape.
 *
 * @param {object} config Parsed wrangler.jsonc object.
 * @returns {{ kind: string, binding: string, target: string }[]}
 */
export function normalizeLocalBindings(config) {
  const out = [];
  if (config.ai?.binding) {
    out.push({ kind: 'ai', binding: config.ai.binding, target: 'workers-ai' });
  }
  for (const b of config.r2_buckets ?? []) {
    if (b.binding) out.push({ kind: 'r2_bucket', binding: b.binding, target: b.bucket_name ?? '(unknown)' });
  }
  for (const b of config.kv_namespaces ?? []) {
    if (b.binding) out.push({ kind: 'kv_namespace', binding: b.binding, target: b.namespace_id ?? '(unknown)' });
  }
  for (const p of config.queues?.producers ?? []) {
    if (p.binding) out.push({ kind: 'queue_producer', binding: p.binding, target: p.queue ?? '(unknown)' });
  }
  for (const s of config.secrets_store_secrets ?? []) {
    if (s.binding) out.push({ kind: 'secrets_store_secret', binding: s.binding, target: `${s.store_id}/${s.secret_name}` });
  }
  return out;
}

/**
 * Diff local vs remote bindings — pure, sorted by binding name.
 * `added` = deploy will add, `removed` = deploy will remove (review these!),
 * `changed` = same binding, different target, `same` = converged.
 *
 * @param {{ kind, binding, target }[]} local
 * @param {{ kind, binding, target }[]} remote
 * @returns {{ added: object[], removed: object[], changed: {binding, kind, localTarget, remoteTarget}[], same: object[] }}
 */
export function diffBindings(local, remote) {
  const remoteByBinding = new Map(remote.map((b) => [b.binding, b]));
  const localByBinding = new Map(local.map((b) => [b.binding, b]));

  const added = [];
  const changed = [];
  const same = [];
  for (const b of local) {
    const r = remoteByBinding.get(b.binding);
    if (!r) added.push(b);
    else if (r.target !== b.target || r.kind !== b.kind) changed.push({ binding: b.binding, kind: b.kind, localTarget: b.target, remoteTarget: r.target });
    else same.push(b);
  }
  const removed = remote.filter((b) => !localByBinding.has(b.binding));

  const byName = (a, b) => a.binding.localeCompare(b.binding);
  return {
    added: added.sort(byName),
    removed: removed.sort(byName),
    changed: changed.sort((a, b) => a.binding.localeCompare(b.binding)),
    same: same.sort(byName),
  };
}
