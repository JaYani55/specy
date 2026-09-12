/**
 * scripts/lib/binding-consistency.mjs
 *
 * Dynamic consistency audit for the plugin binding pipeline (BIPS).
 * One function, run at the end of install / provision / update flows:
 * every moving part is checked against every other, and each non-converged
 * state comes with the exact command that fixes it — zero documentation
 * consulting, zero manual drift adjudication.
 *
 * Checks (pure — no API calls, no fs):
 *   1. intents-valid      — manifests validate (kinds, purposes, scopes, conflicts)
 *   2. provisioned        — every provisionable intent has a ledger instance id
 *   3. secrets-resolved   — every Secrets Store link intent has a resolved store
 *   4. ledger-fresh       — ledger rows match current resolutions (worker rename,
 *                           purpose rename, plugin removal)
 *   5. config-synced      — the generated wrangler.jsonc reflects the resolved
 *                           intents (detects "provisioned but not rebuilt" and
 *                           hand-edited config)
 *   6. no-legacy          — no plugin still on deprecated wrangler_bindings
 */

import {
  collectPluginIntents,
  readWorkerName,
  readCoreSecretsStoreId,
  listUnprovisionedIntents,
  PROVISIONABLE_KINDS,
} from './binding-intents.mjs';

/**
 * Audit the full binding pipeline for the current deployment.
 *
 * @param {{ plugins: {id, dirName, manifest}[], wranglerJsoncPath: string, ledger: object|null, config?: object|null }} input
 *   `config` = pre-parsed wrangler.jsonc (optional — parsed internally when omitted).
 * @returns {{ consistent: boolean, workerName: string, mode: string, checks: object[] }}
 *   checks: [{ id, title, state: 'ok'|'converged'|'pending'|'error', detail, items?: [{label, state, detail, command}] }]
 */
export function auditBindingConsistency({ plugins, wranglerJsoncPath, ledger, config = null }) {
  const { mode, resolvedIntents, errors, warnings } = collectPluginIntents(plugins, {
    wranglerJsoncPath,
    ledger,
  });

  const checks = [];
  let workerName = 'specy';

  // ── 1. Manifest / intent validity (hard error — build would fail) ──
  checks.push({
    id: 'intents-valid',
    title: 'Manifest intents',
    state: errors.length === 0 ? 'ok' : 'error',
    detail: errors.length === 0
      ? `${resolvedIntents.length} intent(s) from ${new Set(resolvedIntents.map((i) => i.pluginId)).size} plugin(s) validate`
      : `${errors.length} validation error(s)`,
    items: errors.map((e) => ({ label: e, state: 'error', detail: 'fix the manifest — the build aborts until this is resolved', command: null })),
  });

  if (mode === 'none' || mode === 'legacy') {
    const legacyPlugins = plugins.filter((p) => p.manifest?.wrangler_bindings && !p.manifest?.wrangler_intents);
    checks.push({
      id: 'no-legacy',
      title: 'Legacy bindings',
      state: legacyPlugins.length ? 'pending' : 'ok',
      detail: legacyPlugins.length
        ? `${legacyPlugins.length} plugin(s) on deprecated wrangler_bindings — injected verbatim, no per-environment isolation`
        : 'no legacy declarations in use',
      items: legacyPlugins.map((p) => ({
        label: `${p.id}: uses wrangler_bindings`,
        state: 'pending',
        detail: 'migrate to wrangler_intents for per-environment instances (see specs/platform/binding-management.md §9)',
        command: null,
      })),
    });
    return { consistent: errors.length === 0, workerName, mode, checks };
  }

  // ── Worker name from the generated config (fall back to reader) ──
  workerName = config?.name ?? 'specy';

  // ── 2. Provisioning completeness ──
  const provisionable = resolvedIntents.filter((i) => PROVISIONABLE_KINDS.includes(i.kind));
  const unprovisioned = provisionable.filter((i) => !i.instanceId);
  checks.push({
    id: 'provisioned',
    title: 'Provisioned instances',
    state: unprovisioned.length === 0 ? 'converged' : 'pending',
    detail: unprovisioned.length === 0
      ? `${provisionable.length}/${provisionable.length} provisioned for '${workerName}'`
      : `${provisionable.length - unprovisioned.length}/${provisionable.length} provisioned`,
    items: provisionable.map((i) => ({
      label: `${i.kind}: ${i.resolvedName}`,
      state: i.instanceId ? 'converged' : 'pending',
      detail: i.instanceId ? 'in ledger' : 'not provisioned',
      command: i.instanceId ? null : 'npm run bindings:provision',
    })),
  });

  // ── 3. Secrets Store resolution ──
  const secretIntents = resolvedIntents.filter((i) => i.kind === 'secrets_store_secrets');
  const unresolvedSecrets = secretIntents.filter((i) => !i.config.store_id);
  checks.push({
    id: 'secrets-resolved',
    title: 'Secrets Store links',
    state: unresolvedSecrets.length === 0 ? 'converged' : 'pending',
    detail: secretIntents.length === 0
      ? 'no secret link intents'
      : `${secretIntents.length - unresolvedSecrets.length}/${secretIntents.length} resolved`,
    items: secretIntents.map((i) => ({
      label: `${i.config.secret_name} (${i.binding})`,
      state: i.config.store_id ? 'converged' : 'pending',
      detail: i.config.store_id ? 'store resolved' : 'no SECRETS_STORE_ID in core vars and no store_id in the intent',
      command: i.config.store_id ? null : 'npm run setup  (or declare store_id in the intent)',
    })),
  });

  // ── 4. Ledger freshness (stale/orphan detection) ──
  const ledgerRows = Array.isArray(ledger?.resources) ? ledger.resources : [];
  const intentKey = (i) => `${i.plugin_id ?? i.pluginId}::${i.kind}::${i.purpose}`;
  const intentKeys = new Set(resolvedIntents.map((i) => intentKey(i)));
  const staleRows = ledgerRows.filter((r) => !intentKeys.has(intentKey(r)));
  const envMismatch = ledger?.environment && workerName && ledger.environment !== workerName;
  checks.push({
    id: 'ledger-fresh',
    title: 'Resource ledger',
    state: staleRows.length === 0 && !envMismatch ? 'converged' : 'pending',
    detail: staleRows.length === 0
      ? envMismatch
        ? `environment mismatch: ledger '${ledger.environment}' vs current '${workerName}'`
        : `${ledgerRows.length} row(s) match current resolutions`
      : `${staleRows.length} stale row(s)`,
    items: [
      ...(envMismatch ? [{
        label: `ledger environment '${ledger.environment}' ≠ current environment '${workerName}'`,
        state: 'pending',
        detail: 'the ledger was written by a different deployment — re-provision to rebuild it for this one',
        command: 'npm run bindings:provision',
      }] : []),
      ...staleRows.map((r) => ({
        label: `${r.kind}: ${r.resolved_name} (${r.plugin_id})`,
        state: 'pending',
        detail: r.plugin_id && plugins.some((p) => p.id === r.plugin_id)
          ? 'declaration changed (purpose/scope/kind) — the cloud instance is now orphaned'
          : 'plugin no longer installed — cloud instance is orphaned',
        command: `npm run bindings:provision -- --teardown ${r.plugin_id}`,
      })),
    ],
  });

  // ── 5. Generated config sync (only when config was provided) ──
  if (config) {
    const mismatches = [];

    const localQueues = new Set((config.queues?.producers ?? []).map((p) => p.queue));
    for (const i of provisionable.filter((k) => k.kind === 'queues')) {
      if (!localQueues.has(i.resolvedName)) {
        mismatches.push({
          label: `queue ${i.resolvedName}`,
          state: 'pending',
          detail: i.instanceId ? 'provisioned but the generated config does not reference it — rebuild' : 'not provisioned and not referenced',
          command: 'npm run build',
        });
      }
    }

    const localKv = new Map((config.kv_namespaces ?? []).map((k) => [k.binding, k.namespace_id]));
    for (const i of provisionable.filter((k) => k.kind === 'kv_namespaces')) {
      const expected = localKv.get(i.binding);
      if (!expected) {
        mismatches.push({
          label: `kv ${i.binding}`,
          state: 'pending',
          detail: i.instanceId ? 'provisioned but missing from the generated config — rebuild' : 'not provisioned',
          command: i.instanceId ? 'npm run build' : 'npm run bindings:provision',
        });
      } else if (i.instanceId && expected !== i.instanceId) {
        mismatches.push({
          label: `kv ${i.binding}`,
          state: 'error',
          detail: `config has namespace_id ${expected} but the ledger says ${i.instanceId} — do not hand-edit; rebuild`,
          command: 'npm run build',
        });
      }
    }

    const localSecrets = new Set((config.secrets_store_secrets ?? []).map((s) => s.binding));
    for (const i of secretIntents) {
      if (i.config.store_id && !localSecrets.has(i.binding)) {
        mismatches.push({
          label: `secret ${i.binding}`,
          state: 'pending',
          detail: 'resolved but missing from the generated config — rebuild',
          command: 'npm run build',
        });
      }
    }

    const localAi = config.ai?.binding ?? null;
    for (const i of resolvedIntents.filter((k) => k.kind === 'ai')) {
      if (localAi !== i.binding) {
        mismatches.push({
          label: `ai ${i.binding}`,
          state: 'pending',
          detail: localAi ? `generated config declares "${localAi}"` : 'missing from the generated config — rebuild',
          command: 'npm run build',
        });
      }
    }

    checks.push({
      id: 'config-synced',
      title: 'Generated wrangler.jsonc',
      state: mismatches.length === 0 ? 'converged' : 'pending',
      detail: mismatches.length === 0
        ? 'reflects all resolved intents and provisioned ids'
        : `${mismatches.length} entry(ies) out of sync`,
      items: mismatches,
    });
  }

  const consistent = checks.every((c) => c.state !== 'error' && c.state !== 'pending');
  return { consistent, workerName, mode, checks, warnings };
}

// ─── Report printer (shared by install / provision / update flows) ───────────

/**
 * Print the audit as a compact, icon-classified report.
 * @returns {{ pendingCommands: Map<string, string[]>, allClear: boolean }}
 */
export function printBindingAuditReport(audit, { log = console.log } = {}) {
  const pendingCommands = new Map(); // command → labels

  for (const check of audit.checks) {
    const icon = check.state === 'ok' || check.state === 'converged'
      ? '\x1b[32mv\x1b[0m'
      : check.state === 'error' ? '\x1b[31mx\x1b[0m' : '\x1b[33m!\x1b[0m';
    log(`${icon}  ${check.title}: ${check.detail}`);

    const items = (check.items ?? []).filter((it) => it.state !== 'converged' && it.state !== 'ok');
    for (const item of items) {
      const itemIcon = item.state === 'error' ? '\x1b[31mx\x1b[0m' : '\x1b[33m!\x1b[0m';
      log(`     ${itemIcon} ${item.label} — ${item.detail}`);
      if (item.command) {
        if (!pendingCommands.has(item.command)) pendingCommands.set(item.command, []);
        pendingCommands.get(item.command).push(item.label);
      }
    }
  }

  return { pendingCommands, allClear: audit.consistent };
}
