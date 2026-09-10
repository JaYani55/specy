/**
 * scripts/lib/binding-intents.mjs
 *
 * Pure logic for the Binding Intent & Provisioning System (BIPS).
 * Design: specs/plans/BINDING-MANAGEMENT.md → implemented contract:
 * specs/platform/binding-management.md
 *
 * Layered shape (all functions pure — no process.exit, no API calls):
 *   A. collectManifestIntents()  — validate + normalize one manifest's
 *                                  `wrangler_intents` (or legacy `wrangler_bindings`)
 *   B. resolvePluginIntents()    — map normalized intents to concrete per-environment
 *                                  instance names (deterministic resolution)
 *   C. collectPluginIntents()    — aggregate across plugins with conflict detection
 *   D. intentsToCollectedBindings() — translate resolved intents into the collected
 *                                  Map shape consumed by the wrangler.jsonc injector
 *
 * Binding management is part of a plugin: developers declare their cloud-system
 * bindings based on the deployment path (`deployment_path` in plugin.json).
 * Cloudflare is the current default and only deployment path; future deployment
 * paths (other vendors) extend SUPPORTED_DEPLOYMENT_PATHS and the per-path
 * provisioners in scripts/lib/binding-provisioner.mjs.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Deployment paths (vendor extensibility) ─────────────────────────────────

export const DEFAULT_DEPLOYMENT_PATH = 'cloudflare';
export const SUPPORTED_DEPLOYMENT_PATHS = ['cloudflare'];

// ─── Intent kinds ─────────────────────────────────────────────────────────────

/**
 * Kinds a plugin may declare in `wrangler_intents`. Mirrors the plugin-owned
 * wrangler binding types — `r2_buckets` is core-owned and rejected.
 */
export const INTENT_KINDS = [
  'ai',
  'kv_namespaces',
  'durable_objects',
  'queues',
  'vars',
  'secrets_store_secrets',
];

/** Kinds owned by the CMS core — plugins must consume the core bindings instead. */
export const CORE_OWNED_INTENT_KINDS = ['r2_buckets'];

// ─── Scopes ───────────────────────────────────────────────────────────────────

export const INTENT_SCOPES = ['environment', 'shared'];
export const DEFAULT_SCOPE = 'environment';

/** Purpose slug: lowercase, digits, hyphens; must start with a letter. */
export const PURPOSE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Binding name: the JS identifier on `env` — the plugin's capability handle. */
export const BINDING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Instance name separators — deterministic, parseable, collision-free by construction. */
export const INSTANCE_SEPARATOR = '--';

// ─── Ledger (resource state record, git-ignored sidecar per deployment) ───────

export const LEDGER_FILE = '.bindings-ledger.json';

/**
 * Kinds whose wrangler config needs a *provisioned ID* (not a plain name):
 * KV namespace entries need the 32-hex namespace id from create-or-get.
 */
export const PROVISIONABLE_KINDS = ['queues', 'kv_namespaces'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function err(pluginId, message) {
  return `Plugin "${pluginId}": ${message}`;
}

/**
 * Resolve the concrete instance name for an intent (Layer 2 — deterministic).
 *
 * - `environment` scope (default): `{workerName}--{pluginId}--{purpose}` — every
 *   deployment gets its own instance; two deployments can never collide.
 * - `shared` scope (explicit opt-in): `{pluginId}--{purpose}` — one account-global
 *   instance, still namespaced by plugin id so two plugins can never collide.
 *   (Implementation deviation from the plan snippet, which used bare `purpose`:
 *   bare purposes from two plugins could collide; namespacing follows the
 *   claim-management lesson.)
 *
 * @returns {string} Concrete instance name.
 */
export function resolveInstanceName(pluginId, purpose, scope, workerName) {
  if (scope === 'shared') {
    return `${pluginId}${INSTANCE_SEPARATOR}${purpose}`;
  }
  return `${workerName}${INSTANCE_SEPARATOR}${pluginId}${INSTANCE_SEPARATOR}${purpose}`;
}

/**
 * Read the deployment's worker name from the generated wrangler.jsonc
 * (one Worker per environment — the environment IS the worker name).
 * Returns 'specy' (default) when no generated config exists.
 *
 * @param {string} wranglerJsoncPath Path to wrangler.jsonc.
 * @returns {string}
 */
export function readWorkerName(wranglerJsoncPath) {
  if (!existsSync(wranglerJsoncPath)) return 'specy';
  try {
    const raw = readFileSync(wranglerJsoncPath, 'utf8');
    const match = /"name"\s*:\s*"([^"]+)"/.exec(raw);
    return match?.[1] ?? 'specy';
  } catch {
    return 'specy';
  }
}

/**
 * Read the core Secrets Store UUID from the vars block of wrangler.jsonc.
 * Intent-declared `secrets_store_secrets` may omit `store_id` — it resolves to
 * the core store (the Secrets Store itself is core-deploy configuration; the
 * plugin never names an instance).
 *
 * @param {string} wranglerJsoncPath Path to wrangler.jsonc.
 * @returns {string | null}
 */
export function readCoreSecretsStoreId(wranglerJsoncPath) {
  if (!existsSync(wranglerJsoncPath)) return null;
  try {
    const raw = readFileSync(wranglerJsoncPath, 'utf8');
    const match = /"SECRETS_STORE_ID"\s*:\s*"([^"]+)"/.exec(raw);
    // Placeholders from the committed template are not a resolved store.
    const value = match?.[1] ?? null;
    return value && !value.startsWith('REPLACE_') ? value : null;
  } catch {
    return null;
  }
}

// ─── Layer A — collect + validate one manifest ────────────────────────────────

/**
 * Collect normalized binding intents from one plugin manifest.
 *
 * Mode:
 *   - `wrangler_intents` present → full intent pipeline (`mode: 'intents'`).
 *   - only legacy `wrangler_bindings` → verbatim concrete mode (`mode: 'legacy'`,
 *     `legacy: manifest.wrangler_bindings`) with a deprecation warning — concrete
 *     entries point at one account-global instance and break per-environment
 *     deployments (the queue duplicate-consumer incident).
 *   - both → `wrangler_intents` wins with a warning.
 *   - neither → `mode: 'none'`.
 *
 * @param {object} manifest Parsed plugin.json (or null).
 * @param {string} pluginId Canonical plugin id.
 * @returns {{ mode: 'intents'|'legacy'|'none', intents: object[], errors: string[], warnings: string[], legacy?: object, deploymentPath: string, intentCount: number }}
 */
export function collectManifestIntents(manifest, pluginId) {
  const errors = [];
  const warnings = [];
  const intents = [];

  if (!manifest || typeof manifest !== 'object') {
    return { mode: 'none', intents: [], errors: [], warnings: [], deploymentPath: DEFAULT_DEPLOYMENT_PATH, intentCount: 0 };
  }

  // ── deployment_path: the vendor system bindings are declared against ──
  const declaredPath = manifest.deployment_path ?? DEFAULT_DEPLOYMENT_PATH;
  const deploymentPath = typeof declaredPath === 'string' ? declaredPath.trim().toLowerCase() : declaredPath;
  if (typeof deploymentPath !== 'string' || !SUPPORTED_DEPLOYMENT_PATHS.includes(deploymentPath)) {
    errors.push(err(pluginId,
      `deployment_path "${declaredPath}" is not supported (supported: ${SUPPORTED_DEPLOYMENT_PATHS.join(', ')}; default: ${DEFAULT_DEPLOYMENT_PATH}).`));
  }

  const declared = manifest.wrangler_intents;
  const legacy = manifest.wrangler_bindings;

  if (declared !== undefined && legacy !== undefined) {
    warnings.push(err(pluginId,
      'declares both wrangler_intents and wrangler_bindings — wrangler_intents wins. Remove the legacy wrangler_bindings block.'));
  }
  if (declared === undefined && legacy !== undefined) {
    warnings.push(err(pluginId,
      'uses legacy wrangler_bindings (concrete instances). Migrate to wrangler_intents so bindings management stays per-environment — see specs/platform/binding-management.md.'));
  }
  if (declared === undefined) {
    return {
      mode: legacy !== undefined ? 'legacy' : 'none',
      intents: [], errors, warnings,
      legacy: legacy !== undefined ? legacy : undefined,
      deploymentPath,
      intentCount: 0,
    };
  }
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    errors.push(err(pluginId, 'wrangler_intents must be an object keyed by binding kind.'));
    return { mode: 'intents', intents: [], errors, warnings, deploymentPath, intentCount: 0 };
  }

  // ── Reject core-owned kinds up front ──
  for (const kind of CORE_OWNED_INTENT_KINDS) {
    if (declared[kind] !== undefined) {
      errors.push(err(pluginId,
        `wrangler_intents.${kind} is owned by the CMS core — plugins consume the shared MEDIA_BUCKET binding instead.`));
    }
  }

  const seenInPlugin = new Set(); // `${kind}::${purpose}` single-source check
  let intentCount = 0;

  for (const kind of Object.keys(declared)) {
    if (CORE_OWNED_INTENT_KINDS.includes(kind)) {
      continue; // already rejected above with the core-ownership error
    }
    if (!INTENT_KINDS.includes(kind)) {
      errors.push(err(pluginId, `wrangler_intents.${kind} is not a supported binding kind (supported: ${INTENT_KINDS.join(', ')}).`));
      continue;
    }

    // ── vars: record — merged into the core vars block (no instance) ──
    if (kind === 'vars') {
      const vars = declared.vars;
      if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
        errors.push(err(pluginId, 'wrangler_intents.vars must be a Record<string, string>.'));
        continue;
      }
      for (const [key, value] of Object.entries(vars)) {
        if (typeof value !== 'string') {
          errors.push(err(pluginId, `wrangler_intents.vars.${key} must be a string.`));
          continue;
        }
        const seenKey = `vars::${key}`;
        if (seenInPlugin.has(seenKey)) {
          errors.push(err(pluginId, `duplicate var key "${key}" — vars must be single-source.`));
          continue;
        }
        seenInPlugin.add(seenKey);
        intentCount++;
        intents.push({ pluginId, kind: 'vars', binding: key, purpose: 'var', scope: 'shared', config: { value } });
      }
      continue;
    }

    // ── ai: singleton object (Workers AI binding, no instance provisioning) ──
    if (kind === 'ai') {
      const entry = declared.ai;
      if (!entry || typeof entry !== 'object' || !entry.binding) {
        errors.push(err(pluginId, 'wrangler_intents.ai must be an object with a binding name.'));
        continue;
      }
      intentCount++;
      intents.push({ pluginId, kind: 'ai', binding: entry.binding, purpose: 'ai', scope: 'environment', config: {} });
      continue;
    }

    // ── durable_objects: array — namespace = worker, no instance provisioning ──
    if (kind === 'durable_objects') {
      const entries = declared.durable_objects;
      if (!Array.isArray(entries)) {
        errors.push(err(pluginId, 'wrangler_intents.durable_objects must be an array.'));
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || !entry.name || !entry.class_name) {
          errors.push(err(pluginId, 'wrangler_intents.durable_objects entries need "name" and "class_name".'));
          continue;
        }
        intentCount++;
        intents.push({
          pluginId, kind: 'durable_objects', binding: entry.name,
          purpose: slugify(entry.class_name), scope: 'environment',
          config: { class_name: entry.class_name },
        });
      }
      continue;
    }

    // ── queues: array of producer intents with optional consumer config ──
    if (kind === 'queues') {
      const entries = declared.queues;
      if (!Array.isArray(entries)) {
        errors.push(err(pluginId, 'wrangler_intents.queues must be an array.'));
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          errors.push(err(pluginId, 'malformed wrangler_intents.queues entry.'));
          continue;
        }
        if (!entry.binding || typeof entry.binding !== 'string') {
          errors.push(err(pluginId, 'wrangler_intents.queues entry is missing a binding name.'));
          continue;
        }
        if (!entry.purpose || typeof entry.purpose !== 'string') {
          errors.push(err(pluginId, `queue intent "${entry.binding}"${entry.queue ? ` (declares a concrete queue name "${entry.queue}" — intents never name instances)` : ''} is missing a purpose slug.`));
          continue;
        }
        const scope = entry.scope ?? DEFAULT_SCOPE;
        if (!INTENT_SCOPES.includes(scope)) {
          errors.push(err(pluginId, `queue intent "${entry.binding}" has unknown scope "${scope}" (supported: ${INTENT_SCOPES.join(', ')}).`));
          continue;
        }
        if (entry.consumer !== undefined && (typeof entry.consumer !== 'object' || Array.isArray(entry.consumer))) {
          errors.push(err(pluginId, `queue intent "${entry.binding}": consumer config must be an object.`));
          continue;
        }
        const seenKey = `queues::${entry.purpose}`;
        if (seenInPlugin.has(seenKey)) {
          errors.push(err(pluginId, `duplicate queue purpose "${entry.purpose}" — purposes must be single-source per plugin.`));
          continue;
        }
        seenInPlugin.add(seenKey);
        intentCount++;
        intents.push({
          pluginId, kind: 'queues', binding: entry.binding, purpose: entry.purpose, scope,
          config: { consumer: entry.consumer ?? null },
        });
      }
      continue;
    }

    // ── kv_namespaces: array of {binding, purpose, scope?} ──
    if (kind === 'kv_namespaces') {
      const entries = declared.kv_namespaces;
      if (!Array.isArray(entries)) {
        errors.push(err(pluginId, 'wrangler_intents.kv_namespaces must be an array.'));
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          errors.push(err(pluginId, 'malformed wrangler_intents.kv_namespaces entry.'));
          continue;
        }
        if (!entry.binding || typeof entry.binding !== 'string') {
          errors.push(err(pluginId, 'wrangler_intents.kv_namespaces entry is missing a binding name.'));
          continue;
        }
        if (!entry.purpose || typeof entry.purpose !== 'string') {
          errors.push(err(pluginId, `kv intent "${entry.binding}"${entry.namespace_id ? ` (declares a concrete namespace_id — intents never name instances)` : ''} is missing a purpose slug.`));
          continue;
        }
        if (entry.namespace_id !== undefined) {
          warnings.push(err(pluginId,
            `kv intent "${entry.binding}" declares namespace_id — intents never name instances; the id resolves per environment from provisioning. Remove it.`));
        }
        const scope = entry.scope ?? DEFAULT_SCOPE;
        if (!INTENT_SCOPES.includes(scope)) {
          errors.push(err(pluginId, `kv intent "${entry.binding}" has unknown scope "${scope}" (supported: ${INTENT_SCOPES.join(', ')}).`));
          continue;
        }
        const seenKey = `kv_namespaces::${entry.purpose}`;
        if (seenInPlugin.has(seenKey)) {
          errors.push(err(pluginId, `duplicate kv purpose "${entry.purpose}" — purposes must be single-source per plugin.`));
          continue;
        }
        seenInPlugin.add(seenKey);
        intentCount++;
        intents.push({ pluginId, kind: 'kv_namespaces', binding: entry.binding, purpose: entry.purpose, scope, config: {} });
      }
      continue;
    }

    // ── secrets_store_secrets: array — resolvedName = the secret name (link target) ──
    if (kind === 'secrets_store_secrets') {
      const entries = declared.secrets_store_secrets;
      if (!Array.isArray(entries)) {
        errors.push(err(pluginId, 'wrangler_intents.secrets_store_secrets must be an array.'));
        continue;
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          errors.push(err(pluginId, 'malformed wrangler_intents.secrets_store_secrets entry.'));
          continue;
        }
        if (!entry.binding || typeof entry.binding !== 'string') {
          errors.push(err(pluginId, 'wrangler_intents.secrets_store_secrets entry is missing a binding name.'));
          continue;
        }
        if (!entry.purpose || typeof entry.purpose !== 'string') {
          errors.push(err(pluginId, `secret intent "${entry.binding}" is missing a purpose slug.`));
          continue;
        }
        if (entry.secret_name !== undefined && typeof entry.secret_name !== 'string') {
          errors.push(err(pluginId, `secret intent "${entry.binding}": secret_name must be a string.`));
          continue;
        }
        if (entry.store_id !== undefined && typeof entry.store_id !== 'string') {
          errors.push(err(pluginId, `secret intent "${entry.binding}": store_id must be a string (omit to resolve the core deployment's Secrets Store).`));
          continue;
        }
        const scope = entry.scope ?? 'shared';
        if (!INTENT_SCOPES.includes(scope)) {
          errors.push(err(pluginId, `secret intent "${entry.binding}" has unknown scope "${scope}" (supported: ${INTENT_SCOPES.join(', ')}).`));
          continue;
        }
        const seenKey = `secrets_store_secrets::${entry.purpose}`;
        if (seenInPlugin.has(seenKey)) {
          errors.push(err(pluginId, `duplicate secret purpose "${entry.purpose}" — purposes must be single-source per plugin.`));
          continue;
        }
        seenInPlugin.add(seenKey);
        intentCount++;
        intents.push({
          pluginId, kind: 'secrets_store_secrets', binding: entry.binding, purpose: entry.purpose, scope,
          config: {
            // The secret NAME inside the store is the link target — it is the
            // "instance" for this kind. Defaults to the UPPER_SNAKE form of the
            // purpose so the plugin can express the operator-facing name.
            secret_name: entry.secret_name ?? slugify(entry.purpose).replace(/-/g, '_').toUpperCase(),
            store_id: entry.store_id ?? null, // null → resolves to core SECRETS_STORE_ID
            provision: entry.provision ?? 'link',
          },
        });
      }
      continue;
    }
  }

  return { mode: 'intents', intents, errors, warnings, deploymentPath, intentCount };
}

// ─── Layer B — deterministic resolution (Layer 2 of BIPS) ─────────────────────

/**
 * Map normalized intents to concrete instances for the current deployment.
 * Adds `resolvedName` (and, for provisioned kinds, `instanceId` from the ledger).
 *
 * @param {object[]} intents Normalized intents (Layer A output).
 * @param {{ workerName: string, ledger?: object|null, coreSecretsStoreId?: string|null }} opts
 * @returns {object[]} Resolved intents (new objects; input untouched).
 */
export function resolvePluginIntents(intents, { workerName, ledger = null, coreSecretsStoreId = null } = {}) {
  return intents.map((intent) => {
    const resolved = { ...intent, config: { ...intent.config } };

    if (intent.kind === 'queues' || intent.kind === 'kv_namespaces') {
      resolved.resolvedName = resolveInstanceName(intent.pluginId, intent.purpose, intent.scope, workerName);
      const row = findLedgerRow(ledger, intent.pluginId, intent.kind, intent.purpose);
      resolved.instanceId = row?.instance_id ?? null;
    } else if (intent.kind === 'secrets_store_secrets') {
      resolved.resolvedName = resolved.config.secret_name;
      resolved.instanceId = null;
    } else {
      resolved.resolvedName = null; // vars / ai / durable_objects: no instance
      resolved.instanceId = null;
    }

    if (intent.kind === 'secrets_store_secrets' && !resolved.config.store_id && coreSecretsStoreId) {
      resolved.config.store_id = coreSecretsStoreId;
    }

    return resolved;
  });
}

// ─── Layer C — aggregate across plugins with conflict detection ───────────────

/**
 * Collect + resolve binding intents across all workspace plugins.
 *
 * Conflict rules (build errors — callers turn `errors` into a hard failure):
 *   1. Binding names must be unique across plugins per kind (as with legacy
 *      bindings — the binding is the capability handle on the shared `env`).
 *   2. Shared-scoped instances must be single-source: two plugins resolving to
 *      the same account-global instance name is a collision, not sharing.
 *
 * @param {{ id: string, dirName: string, manifest: object }[]} plugins Workspace plugins.
 * @param {{ wranglerJsoncPath: string, ledger?: object|null }} opts
 * @returns {{ mode: 'intents'|'legacy'|'none', intents: object[], resolvedIntents: object[], errors: string[], warnings: string[], deploymentPaths: string[] }}
 */
export function collectPluginIntents(plugins, { wranglerJsoncPath, ledger = null } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const deploymentPaths = new Set();
  let aggregateMode = 'none';
  let hasLegacy = false;

  for (const plugin of plugins) {
    const { mode, intents, errors: pluginErrors, warnings: pluginWarnings, deploymentPath } =
      collectManifestIntents(plugin.manifest, plugin.id);
    normalized.push(...intents);
    errors.push(...pluginErrors);
    warnings.push(...pluginWarnings);
    deploymentPaths.add(deploymentPath);
    if (mode === 'intents') aggregateMode = 'intents';
    if (mode === 'legacy') hasLegacy = true;
  }
  if (aggregateMode === 'none' && hasLegacy) aggregateMode = 'legacy';

  const workerName = readWorkerName(wranglerJsoncPath);
  const coreSecretsStoreId = readCoreSecretsStoreId(wranglerJsoncPath);
  const resolvedIntents = resolvePluginIntents(normalized, { workerName, ledger, coreSecretsStoreId });

  // 1. Binding names unique across plugins per kind.
  const seenBindings = new Map(); // `${kind}::${binding}` → pluginId
  for (const intent of resolvedIntents) {
    const key = `${intent.kind}::${intent.binding}`;
    const owner = seenBindings.get(key);
    if (owner && owner !== intent.pluginId) {
      errors.push(err(intent.pluginId,
        `binding "${intent.binding}" (${intent.kind}) is already claimed by plugin "${owner}" — rename one of the bindings.`));
      continue;
    }
    seenBindings.set(key, intent.pluginId);
  }

  // 2. Shared instances single-source (same kind + same resolvedName from different plugins).
  const seenShared = new Map(); // `${kind}::${resolvedName}` → pluginId
  for (const intent of resolvedIntents) {
    if (intent.scope !== 'shared' || intent.resolvedName === null) continue;
    const key = `${intent.kind}::${intent.resolvedName}`;
    const owner = seenShared.get(key);
    if (owner && owner !== intent.pluginId) {
      errors.push(err(intent.pluginId,
        `shared ${intent.kind} instance "${intent.resolvedName}" is already declared by plugin "${owner}" — shared scope must be single-source.`));
      continue;
    }
    seenShared.set(key, intent.pluginId);
  }

  return {
    mode: aggregateMode,
    intents: normalized,
    resolvedIntents,
    errors,
    warnings,
    deploymentPaths: [...deploymentPaths],
  };
}

// ─── Layer D — collected Map shape for the wrangler.jsonc injector ────────────

/**
 * Translate resolved intents into the `collected` Map consumed by
 * `rebuildWranglerPluginBindings` — identical entry shapes to the legacy
 * `collectPluginWranglerBindings`, so `generatePluginBindingsBlock` and the
 * vars/secrets merge paths work unchanged.
 *
 * KV namespace ids come from the provisioner ledger: wrangler needs the 32-hex
 * id, not the resolved title. Un-provisioned kv intents are returned in
 * `unprovisioned` (caller warns — deploy would fail until provisioning ran).
 *
 * @param {object[]} resolvedIntents Layer C output.
 * @returns {{ collected: Map, pluginVars: Record<string, { value: string, pluginId: string }>, unprovisioned: object[] }}
 */
export function intentsToCollectedBindings(resolvedIntents) {
  const collected = new Map();
  const pluginVars = {};
  const unprovisioned = [];

  const push = (kind, entry) => {
    if (!collected.has(kind)) collected.set(kind, []);
    collected.get(kind).push(entry);
  };

  for (const intent of resolvedIntents) {
    switch (intent.kind) {
      case 'ai':
        push('ai', { pluginId: intent.pluginId, entry: { binding: intent.binding } });
        break;

      case 'durable_objects':
        push('durable_objects', {
          pluginId: intent.pluginId,
          entry: { name: intent.binding, class_name: intent.config.class_name },
        });
        break;

      case 'queues': {
        // Producer + consumer wire to the SAME resolved instance — the atomic
        // wiring that failed in the legacy model.
        push('queues', {
          pluginId: intent.pluginId,
          entry: { queue: intent.resolvedName, binding: intent.binding, _kind: 'producer' },
        });
        if (intent.config.consumer) {
          // Strip any legacy keys — the consumer ALWAYS registers against the
          // same resolved instance as the producer (atomic wiring; a `queue`
          // key in consumer config must never override the resolution).
          const { queue: _queue, binding: _binding, ...consumerSettings } = intent.config.consumer;
          push('queues', {
            pluginId: intent.pluginId,
            entry: { queue: intent.resolvedName, ...consumerSettings, _kind: 'consumer' },
          });
        }
        break;
      }

      case 'kv_namespaces': {
        if (!intent.instanceId) {
          unprovisioned.push(intent);
          break;
        }
        push('kv_namespaces', {
          pluginId: intent.pluginId,
          entry: { binding: intent.binding, namespace_id: intent.instanceId },
        });
        break;
      }

      case 'secrets_store_secrets':
        if (intent.config.store_id) {
          push('secrets_store_secrets', {
            pluginId: intent.pluginId,
            entry: { binding: intent.binding, store_id: intent.config.store_id, secret_name: intent.config.secret_name },
          });
        } else {
          unprovisioned.push(intent); // no core Secrets Store resolved — caller warns
        }
        break;

      case 'vars':
        pluginVars[intent.binding] = { value: intent.config.value, pluginId: intent.pluginId };
        break;
    }
  }

  collected.__vars = pluginVars;
  collected.__unprovisioned = unprovisioned;
  return { collected, pluginVars, unprovisioned };
}

// ─── Ledger I/O ───────────────────────────────────────────────────────────────

export function emptyLedger(workerName) {
  return {
    version: 1,
    environment: workerName,
    resources: [],
  };
}

/**
 * Find a ledger row by (plugin, kind, purpose). Keys derived names, so lookup
 * works even when instance ids (kv) were only known after provisioning.
 */
export function findLedgerRow(ledger, pluginId, kind, purpose) {
  if (!ledger || !Array.isArray(ledger.resources)) return null;
  return ledger.resources.find((r) => r.plugin_id === pluginId && r.kind === kind && r.purpose === purpose) ?? null;
}

/**
 * Read the binding resource ledger (git-ignored sidecar next to wrangler.jsonc).
 * Returns null when absent or unreadable — callers then treat every resource as
 * unprovisioned.
 */
export function readBindingLedger(root) {
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
 * Determine which kinds a plugin still needs provisioned for this deployment
 * (used by the installer and the provision CLI to report actionable steps).
 */
export function listUnprovisionedIntents(resolvedIntents) {
  return resolvedIntents.filter((intent) => {
    if (!PROVISIONABLE_KINDS.includes(intent.kind)) return false;
    return !intent.instanceId;
  });
}
