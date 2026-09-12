import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  collectPluginIntents,
  intentsToCollectedBindings,
  readBindingLedger,
} from './binding-intents.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '..', '..');
export const WORKSPACE_PLUGINS_DIR = join(ROOT, 'plugins');
export const GENERATED_PLUGINS_DIR = join(ROOT, 'src', 'plugins');
export const REGISTRY_FILE = join(GENERATED_PLUGINS_DIR, 'registry.ts');
export const HOOKS_REGISTRY_FILE = join(GENERATED_PLUGINS_DIR, 'hooks-registry.ts');
export const PLUGIN_ROUTES_FILE = join(ROOT, 'api', 'plugin-routes.ts');
export const PLUGIN_METADATA_FILE = join(ROOT, 'api', 'plugin-metadata.ts');
export const PLUGIN_HOOKS_FILE = join(ROOT, 'api', 'plugin-hooks.ts');
export const PLUGIN_CLAIMS_FILE = join(ROOT, 'api', 'plugin-claims.ts');
export const PLUGIN_BINDINGS_FILE = join(ROOT, 'api', 'plugin-bindings.ts');
export const WRANGLER_CONFIG_FILE = join(ROOT, 'wrangler.jsonc');

const PLUGIN_BINDINGS_START = '// ── PLUGIN BINDINGS (AUTO-GENERATED';
const PLUGIN_BINDINGS_END   = '// ── END PLUGIN BINDINGS ──';

const WRANGLER_BINDING_TYPES = [
  'r2_buckets',
  'ai_gateway',
  'kv_namespaces',
  'durable_objects',
  'vars',
  'secrets_store_secrets',
];

function stripExtension(filePath) {
  return filePath.replace(/\.[^.]+$/, '');
}

function toImportVariable(dirName, suffix = 'Plugin') {
  const normalized = dirName
    .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
    .replace(/^[^a-zA-Z]+/, '');

  return `${normalized || 'plugin'}${suffix}`;
}

export function loadPluginManifest(dir) {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

export function scanWorkspacePlugins() {
  if (!existsSync(WORKSPACE_PLUGINS_DIR)) {
    return [];
  }

  return readdirSync(WORKSPACE_PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirName = entry.name;
      const dir = join(WORKSPACE_PLUGINS_DIR, dirName);
      const manifest = loadPluginManifest(dir);
      if (!manifest?.id) {
        return null;
      }

      return {
        id: manifest.id,
        dirName,
        dir,
        manifest,
        entrypoint: manifest.entrypoint ?? 'src/index.tsx',
        apiEntrypoint: manifest.api_entrypoint ?? null,
        apiHooksEntrypoint: manifest.api_hooks_entrypoint ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function ensureGeneratedPluginFiles() {
  mkdirSync(GENERATED_PLUGINS_DIR, { recursive: true });
}

// ─── Plugin Claim Registry (Claim Management, specs/plans/CLAIM_MANAGEMENT.md) ───

// Top-level JWT keys owned by core — plugins may never claim these.
export const RESERVED_CLAIM_KEYS = ['user_roles', 'is_agent', 'tenant_id', 'sub', 'aud', 'exp', 'iat', 'iss', 'email', 'phone', 'role', 'session_id', 'app_metadata', 'user_metadata', 'provider', 'refresh_token'];

// Global cap across all plugins (bytes, serialized). Per-claim budgets are
// additionally enforced at mint time (octet_length check in the hook).
export const GLOBAL_CLAIM_BUDGET_BYTES = 2048;

const CLAIM_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Pure validation/namespace logic for plugin claim declarations.
 *
 * Enforces (CLAIM_MANAGEMENT.md §2 Layer 1):
 *   1. Reserved core keys are rejected.
 *   2. Single-source: a claim key may be declared only once per plugin.
 *   3. Namespacing: every claim is emitted as claims.<pluginId> object.
 *   4. Per-claim budget (default 512) and the global Σ budget.
 *
 * @returns {{ claims: Array, errors: string[] }} namespaced claims + build errors
 */
export function collectPluginClaims(plugins) {
  const claims = [];
  const errors = [];
  const seenTopLevel = new Map();  // claim_key (plugin id) → plugin id
  let totalBudget = 0;

  for (const plugin of plugins) {
    const declarations = plugin.manifest?.claims_declarations;
    if (!Array.isArray(declarations) || declarations.length === 0) continue;

    const seenInPlugin = new Set();
    for (const decl of declarations) {
      if (!decl || typeof decl !== 'object' || typeof decl.key !== 'string') {
        errors.push(`Plugin "${plugin.id}": malformed claims_declarations entry.`);
        continue;
      }
      if (!CLAIM_KEY_PATTERN.test(decl.key)) {
        errors.push(`Plugin "${plugin.id}": claim key "${decl.key}" must match ${CLAIM_KEY_PATTERN}.`);
        continue;
      }
      if (RESERVED_CLAIM_KEYS.includes(decl.key)) {
        errors.push(`Plugin "${plugin.id}": claim key "${decl.key}" is reserved by the core.`);
        continue;
      }
      if (seenInPlugin.has(decl.key)) {
        errors.push(`Plugin "${plugin.id}": duplicate claim key "${decl.key}" — claims must be single-source.`);
        continue;
      }
      if (typeof decl.resolver !== 'string' || !decl.resolver) {
        errors.push(`Plugin "${plugin.id}": claim "${decl.key}" is missing a resolver function name.`);
        continue;
      }
      const budget = Number.isFinite(decl.budget_bytes) && decl.budget_bytes > 0
        ? Math.floor(decl.budget_bytes)
        : 512;
      seenInPlugin.add(decl.key);
      totalBudget += budget;
      claims.push({
        pluginId: plugin.id,
        topLevelKey: plugin.id,   // namespacing: claims.<plugin_id>.
        key: decl.key,
        type: decl.type ?? 'json',
        resolver: decl.resolver,
        budgetBytes: budget,
        description: decl.description ?? null,
      });
    }
  }

  if (totalBudget > GLOBAL_CLAIM_BUDGET_BYTES) {
    errors.push(`Global claim budget exceeded: ${totalBudget} bytes declared (limit ${GLOBAL_CLAIM_BUDGET_BYTES}).`);
  }

  return { claims, errors };
}

/**
 * Regenerates api/plugin-claims.ts — the descriptive claim registry used for
 * review, agent discovery (/api/plugins) and runtime dispatch helpers.
 */
function writePluginClaimsRegistry(plugins) {
  const { claims, errors } = collectPluginClaims(plugins);
  if (errors.length > 0) {
    for (const error of errors) console.error(`x  ${error}`);
    throw new Error(`Plugin claim declarations failed validation:\n- ${errors.join('\n- ')}`);
  }

  writeFileSync(PLUGIN_CLAIMS_FILE, `// AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
// Descriptive registry of plugin-declared custom JWT claims (Claim Management,
// specs/plans/CLAIM_MANAGEMENT.md). Claims are namespaced under claims.<plugin_id>
// and resolved at token-mint time by plugin-schema functions registered in
// public.plugin_claims.
import type { PluginClaimDeclaration, PluginClaimValueType } from '@/types/plugin';

export interface RegisteredPluginClaim extends Omit<PluginClaimDeclaration, 'type' | 'budget_bytes' | 'description'> {
  pluginId: string;
  /** Top-level JWT key — the namespaced claim object claims.<pluginId>. */
  topLevelKey: string;
  type: PluginClaimValueType;
  budgetBytes: number;
  description: string | null;
}

const registeredPluginClaims: RegisteredPluginClaim[] = ${JSON.stringify(claims, null, 2)};

export function getRegisteredPluginClaims(): RegisteredPluginClaim[] {
  return registeredPluginClaims;
}
`, 'utf8');

  return claims;
}

// ─── Plugin Binding Intent Registry (Binding Management, specs/plans/BINDING-MANAGEMENT.md) ───

/**
 * Regenerates api/plugin-bindings.ts — the descriptive registry of plugin-declared
 * binding intents used for review, agent discovery and operator inspection.
 * Intent-declared instances resolve per environment (worker name) at build/provision
 * time; legacy wrangler_bindings entries are injected verbatim and are NOT listed here.
 */
function writePluginBindingsRegistry(plugins) {
  const { mode, resolvedIntents, errors, warnings, deploymentPaths } = collectPluginIntents(plugins, {
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger: readBindingLedger(ROOT),
  });

  if (errors.length > 0) {
    for (const error of errors) console.error(`x  ${error}`);
    throw new Error(`Plugin binding intents failed validation:\n- ${errors.join('\n- ')}`);
  }
  // Warnings are printed by rebuildWranglerPluginBindings (runs in the same
  // rebuild cycle) — printing them twice would be build-log noise.

  const descriptors = resolvedIntents.map((intent) => ({
    pluginId: intent.pluginId,
    kind: intent.kind,
    binding: intent.binding,
    purpose: intent.purpose,
    scope: intent.scope,
    deploymentPath: 'cloudflare', // SUPPORTED_DEPLOYMENT_PATHS — Cloudflare is the current default and only deployment path
    resolvedName: intent.resolvedName,
  }));

  writeFileSync(PLUGIN_BINDINGS_FILE, `// AUTO-GENERATED by scripts/ensure-registry.mjs — do not edit manually.
// Descriptive registry of plugin-declared binding intents (Binding Management,
// specs/platform/binding-management.md). Binding management is part of a plugin:
// developers declare cloud-system bindings based on the deployment path
// (${deploymentPaths.join(', ')} — Cloudflare is the current default and only
// deployment path). Intent-declared instances resolve per environment;
// legacy wrangler_bindings entries are injected verbatim and are not listed here.
import type { PluginBindingIntentDescriptor } from '@/types/plugin';

const registeredPluginBindingIntents: PluginBindingIntentDescriptor[] = ${JSON.stringify(descriptors, null, 2)};

export function getRegisteredPluginBindingIntents(): PluginBindingIntentDescriptor[] {
  return registeredPluginBindingIntents;
}
`, 'utf8');

  return { mode, descriptors };
}

export function rebuildWorkspacePluginArtifacts() {
  ensureGeneratedPluginFiles();

  const plugins = scanWorkspacePlugins();

  // Claim registry — validates declarations (build error on violation) and
  // regenerates api/plugin-claims.ts.
  writePluginClaimsRegistry(plugins);

  // Binding intents registry — validates declarations (build error on violation)
  // and regenerates api/plugin-bindings.ts (Binding Management,
  // specs/platform/binding-management.md).
  writePluginBindingsRegistry(plugins);

  const registryImports = plugins
    .filter((plugin) => existsSync(join(plugin.dir, plugin.entrypoint)))
    .map((plugin, index) => `import plugin${index} from '../../plugins/${plugin.dirName}/${stripExtension(plugin.entrypoint)}';`)
    .join('\n');
  const registryItems = plugins
    .filter((plugin) => existsSync(join(plugin.dir, plugin.entrypoint)))
    .map((_, index) => `  plugin${index},`)
    .join('\n');

  writeFileSync(REGISTRY_FILE, `/**
 * AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
 * Rebuilt from workspace plugins in /plugins.
 */

import type { PluginDefinition } from '@/types/plugin';

${registryImports || '// (no workspace plugins found)'}

const registeredPlugins: PluginDefinition[] = [
${registryItems || '  // (no workspace plugins found)'}
];

export default registeredPlugins;
`, 'utf8');

  const uiHooksImports = plugins
    .filter((plugin) => existsSync(join(plugin.dir, plugin.entrypoint)))
    .map((plugin, index) => `import plugin${index} from '../../plugins/${plugin.dirName}/${stripExtension(plugin.entrypoint)}';`)
    .join('\n');
  const uiHooksItems = plugins
    .filter((plugin) => existsSync(join(plugin.dir, plugin.entrypoint)))
    .map((_, index) => `  ...(plugin${index}.hooks ?? []),`)
    .join('\n');

  writeFileSync(HOOKS_REGISTRY_FILE, `/**
 * AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
 * Rebuilt from workspace plugins in /plugins.
 */

import type { PluginHookContribution } from '@/types/plugin';

${uiHooksImports || '// (no workspace plugins found)'}

const registeredHooks: PluginHookContribution[] = [
${uiHooksItems || '  // (no plugin hooks found)'}
];

export default registeredHooks;
`, 'utf8');

  const routePlugins = plugins.filter((plugin) => plugin.apiEntrypoint && existsSync(join(plugin.dir, plugin.apiEntrypoint)));
  const routeImports = routePlugins
    .map((plugin) => `import ${toImportVariable(plugin.dirName)} from '../plugins/${plugin.dirName}/${stripExtension(plugin.apiEntrypoint)}';`)
    .join('\n');
  const routeMounts = routePlugins
    .map((plugin) => `  app.route('/api/plugin/${plugin.id}', ${toImportVariable(plugin.dirName)});`)
    .join('\n');

  writeFileSync(PLUGIN_ROUTES_FILE, `// AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
import type { Hono } from 'hono';
import type { Env } from './lib/supabase';

${routeImports || '// (no plugin API routes found)'}

export function mountPluginRoutes(app: Hono<{ Bindings: Env }>): void {
${routeMounts || '  // (no plugin API routes found)'}
}
`, 'utf8');

  writeFileSync(PLUGIN_METADATA_FILE, `// AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
import type { PluginApiMetadata, PluginCapabilityDescriptor, PluginHookDescriptor } from '@/types/plugin';

export interface RegisteredPluginMetadata {
  pluginId: string;
  hookMetadata: PluginHookDescriptor[];
  apiMetadata: PluginApiMetadata | null;
  capabilities: PluginCapabilityDescriptor[];
}

const registeredPluginMetadata: RegisteredPluginMetadata[] = ${JSON.stringify(
    plugins.map((plugin) => ({
      pluginId: plugin.id,
      hookMetadata: Array.isArray(plugin.manifest.hook_metadata) ? plugin.manifest.hook_metadata : [],
      apiMetadata: plugin.manifest.api_metadata ?? null,
      capabilities: Array.isArray(plugin.manifest.capabilities) ? plugin.manifest.capabilities : [],
    })),
    null,
    2,
  )};

export function getRegisteredPluginMetadata(): RegisteredPluginMetadata[] {
  return registeredPluginMetadata;
}
`, 'utf8');

  const apiHookPlugins = plugins.filter((plugin) => plugin.apiHooksEntrypoint && existsSync(join(plugin.dir, plugin.apiHooksEntrypoint)));
  const apiHookImports = apiHookPlugins
    .map((plugin) => `import ${toImportVariable(plugin.dirName, 'Hooks')} from '../plugins/${plugin.dirName}/${stripExtension(plugin.apiHooksEntrypoint)}';`)
    .join('\n');
  const apiHookItems = apiHookPlugins
    .map((plugin) => `  ...${toImportVariable(plugin.dirName, 'Hooks')},`)
    .join('\n');

  writeFileSync(PLUGIN_HOOKS_FILE, `// AUTO-GENERATED by scripts/register-plugins.mjs — do not edit manually.
import type { PluginHookContribution } from '../src/types/plugin';

${apiHookImports || '// (no plugin API hooks found)'}

const registeredApiPluginHooks: PluginHookContribution[] = [
${apiHookItems || '  // (no plugin API hooks found)'}
];

export function getRegisteredApiPluginHooks(): PluginHookContribution[] {
  return registeredApiPluginHooks;
}
`, 'utf8');

  rebuildWranglerPluginBindings(plugins);

  return plugins;
}

// ─── Wrangler Plugin Binding Injection ───────────────────────────────────────

/**
 * Plugin-contributed binding types that are injected into the auto-generated
 * section of wrangler.jsonc. These are types NOT owned by core — core already
 * defines r2_buckets, vars, and secrets_store_secrets at the top level.
 *
 * `ai` (singleton object, not array), `kv_namespaces`, and `durable_objects`
 * are plugin-only and injected here. If a plugin needs an R2 bucket or Worker
 * secret, it should use the core section (manual merge) or a future hook mechanism.
 */
const PLUGIN_OWNED_BINDING_TYPES = [
  'ai',
  'kv_namespaces',
  'durable_objects',
  'queues',
];

/**
 * Extract the `binding` name (or `name` for durable_objects) from a binding entry.
 */
function getBindingName(type, entry) {
  if (type === 'durable_objects') {
    return entry.name;
  }
  // For `ai`, use 'ai' as the canonical binding name since it's a singleton
  if (type === 'ai') {
    return entry.binding || 'AI';
  }
  return entry.binding;
}

/**
 * Gather wrangler bindings with Binding Intent support (BIPS):
 *
 * - Plugins declaring `wrangler_intents` go through the intent pipeline: intents
 *   are validated (build error on violation), resolved deterministically per
 *   environment (worker name) and translated into resolved concrete entries.
 *   Queue producer + consumer wire to the SAME resolved instance — the atomic
 *   wiring that failed in the legacy model (duplicate consumer against another
 *   environment's account-global queue).
 * - Plugins still on legacy `wrangler_bindings` (concrete instances) are
 *   collected verbatim as today — mixed workspaces are supported so plugins can
 *   migrate one at a time. Cross-set conflicts (binding name claimed by both an
 *   intent-declaring and a legacy plugin) abort the build.
 *
 * KV namespace ids come from the provisioner ledger (.bindings-ledger.json):
 * wrangler needs the provisioned 32-hex id, not the resolved title.
 * Un-provisioned kv intents are skipped with a loud warning — run
 * `npm run bindings:provision` (wrangler deploy would fail until provisioning ran).
 *
 * Returns a Map<type, { pluginId, entries[] }> identical in shape to the legacy
 * collector, plus `__vars` and `__unprovisioned` side-channel properties.
 */
function collectWranglerBindingsWithIntents(plugins) {
  const ledger = readBindingLedger(ROOT);
  const intentsResult = collectPluginIntents(plugins, {
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger,
  });

  if (intentsResult.errors.length > 0) {
    for (const error of intentsResult.errors) console.error(`x  ${error}`);
    throw new Error(`Plugin binding intents failed validation:\n- ${intentsResult.errors.join('\n- ')}`);
  }
  for (const warning of intentsResult.warnings) console.warn(`!  ${warning}`);

  const collected = new Map();
  const pluginVars = {};

  // ── Intent pipeline (wrangler_intents) ──
  if (intentsResult.mode === 'intents') {
    const { collected: intentCollected, unprovisioned: unprovisionedIntents } = intentsToCollectedBindings(intentsResult.resolvedIntents);

    for (const kind of ['ai', 'kv_namespaces', 'durable_objects', 'queues', 'secrets_store_secrets']) {
      const entries = intentCollected.get(kind);
      if (entries && entries.length > 0) collected.set(kind, entries);
    }
    Object.assign(pluginVars, intentCollected.__vars || {});

    const hasLegacy = plugins.some((p) => p.manifest?.wrangler_bindings && !p.manifest?.wrangler_intents);
    if (hasLegacy) {
      // Mixed workspace: merge verbatim legacy bindings from plugins that have
      // not migrated yet. Cross-set binding conflicts abort the build.
      const legacyPlugins = plugins.filter((p) => p.manifest?.wrangler_bindings && !p.manifest?.wrangler_intents);
      const legacy = collectPluginWranglerBindings(legacyPlugins);
      mergeCollectedWithConflictDetection(collected, legacy, pluginVars);
    }

    const unprovisioned = unprovisionedIntents;
    for (const intent of unprovisioned) {
      if (intent.kind === 'kv_namespaces') {
        console.warn(
          `!  Plugin "${intent.pluginId}": kv intent "${intent.binding}" (purpose "${intent.purpose}") is not provisioned — ` +
          `run npm run bindings:provision, then rebuild (wrangler deploy would fail without the namespace id).`,
        );
      } else if (intent.kind === 'secrets_store_secrets') {
        console.warn(
          `!  Plugin "${intent.pluginId}": secret intent "${intent.binding}" has no Secrets Store resolved — ` +
          `set SECRETS_STORE_ID in wrangler.jsonc vars (core deployment configuration) or declare store_id in the intent.`,
        );
      }
      // Un-provisioned queue intents still inject: the resolved name IS the
      // wrangler config value — queue creation happens at provision/deploy.
    }
  } else {
    // ── Legacy pipeline (wrangler_bindings verbatim) — pre-BIPS behavior ──
    const legacy = collectPluginWranglerBindings(plugins);
    for (const [kind, entries] of legacy) {
      if (typeof kind === 'string') collected.set(kind, entries);
    }
    Object.assign(pluginVars, legacy.__vars || {});
  }

  collected.__vars = pluginVars;
  return collected;
}

/**
 * Merge two collected binding Maps (intent path + legacy path) with conflict
 * detection across sets — a binding name claimed by both an intent-declaring
 * and a legacy plugin must abort the build, same as within one set.
 */
function mergeCollectedWithConflictDetection(collected, legacy, pluginVars) {
  const findConflictingOwner = (kind, name, excludePluginId) => {
    const entries = collected.get(kind) ?? [];
    const owner = entries.find((e) => getBindingName(kind, e.entry) === name && e.pluginId !== excludePluginId);
    return owner?.pluginId ?? null;
  };

  for (const [kind, entries] of legacy) {
    if (typeof kind !== 'string') continue;

    if (kind === 'queues') {
      for (const { pluginId, entry } of entries) {
        // Producer conflicts keyed on (queue, binding), consumer conflicts on queue.
        const conflictKey = entry._kind === 'consumer' ? `consumer::${entry.queue}` : `producer::${entry.queue}::${entry.binding}`;
        const existing = (collected.get('queues') ?? []).find(
          (e) => (e.entry._kind === 'consumer' ? `consumer::${e.entry.queue}` : `producer::${e.entry.queue}::${e.entry.binding}`) === conflictKey,
        );
        if (existing) {
          throw new Error(
            `Queue ${entry._kind} conflict: "${entry.queue}" claimed by both "${existing.pluginId}" and "${pluginId}".`,
          );
        }
        if (!collected.has('queues')) collected.set('queues', []);
        collected.get('queues').push({ pluginId, entry });
      }
      continue;
    }

    if (kind === 'vars' || kind === '__vars') continue;
    if (kind === 'secrets_store_secrets') {
      for (const { pluginId, entry } of entries) {
        const owner = (collected.get('secrets_store_secrets') ?? []).find((e) => e.entry.binding === entry.binding);
        if (owner) {
          throw new Error(`Secrets conflict: "${entry.binding}" claimed by both "${owner.pluginId}" and "${pluginId}".`);
        }
        if (!collected.has('secrets_store_secrets')) collected.set('secrets_store_secrets', []);
        collected.get('secrets_store_secrets').push({ pluginId, entry });
      }
      continue;
    }

    for (const { pluginId, entry } of entries) {
      const name = getBindingName(kind, entry);
      const owner = findConflictingOwner(kind, name, pluginId);
      if (owner) {
        throw new Error(`Binding conflict: "${name}" (${kind}) claimed by both "${owner}" and "${pluginId}".`);
      }
      if (!collected.has(kind)) collected.set(kind, []);
      collected.get(kind).push({ pluginId, entry });
    }
  }

  // Vars merge with per-key conflict detection.
  const legacyVars = legacy.__vars || {};
  for (const [key, { value, pluginId }] of Object.entries(legacyVars)) {
    if (pluginVars[key]) {
      throw new Error(`Var conflict: "${key}" claimed by both "${pluginVars[key].pluginId}" and "${pluginId}".`);
    }
    pluginVars[key] = { value, pluginId };
  }
}

/**
 * Gather and validate wrangler bindings from all installed plugin manifests.
 * Returns a Map<type, { pluginId, entries[] }> with deduplication and conflict detection.
 * Also collects plugin vars separately for injection into the existing vars block.
 */
function collectPluginWranglerBindings(plugins) {
  const collected = new Map();
  const pluginVars = {};  // { key: { value, pluginId } }

  for (const plugin of plugins) {
    const bindings = plugin.manifest?.wrangler_bindings;
    if (!bindings || typeof bindings !== 'object') {
      continue;
    }

    for (const type of PLUGIN_OWNED_BINDING_TYPES) {
      // `ai` is a singleton object, not an array
      if (type === 'ai') {
        const entry = bindings[type];
        if (!entry || typeof entry !== 'object' || !entry.binding) {
          continue;
        }

        if (!collected.has(type)) {
          collected.set(type, []);
        }

        const name = getBindingName(type, entry);
        const existing = collected.get(type).find(
          (e) => getBindingName(type, e.entry) === name,
        );
        if (existing) {
          console.error(
            `x  Binding conflict: "${name}" (${type}) claimed by both "${existing.pluginId}" and "${plugin.id}".`,
          );
          console.error(`   Rename one of the bindings so they don't collide.`);
          process.exit(1);
        }

        collected.get(type).push({ pluginId: plugin.id, entry });
        continue;
      }

      // `queues` is an object with producers[] and consumers[] arrays
      if (type === 'queues') {
        const queuesBinding = bindings[type];
        if (!queuesBinding || typeof queuesBinding !== 'object') {
          continue;
        }

        if (!collected.has(type)) {
          collected.set(type, []);
        }

        // Collect producers
        const producers = queuesBinding.producers;
        if (Array.isArray(producers)) {
          for (const entry of producers) {
            if (!entry.queue || !entry.binding) {
              console.warn(`!  Plugin "${plugin.id}": skipping malformed queues.producers entry (missing queue or binding).`);
              continue;
            }
            const existing = collected.get(type).find(
              (e) => e.entry.queue === entry.queue && e.entry.binding === entry.binding,
            );
            if (existing) {
              console.error(
                `x  Queue producer conflict: "${entry.binding}" → "${entry.queue}" claimed by both "${existing.pluginId}" and "${plugin.id}".`,
              );
              process.exit(1);
            }
            collected.get(type).push({ pluginId: plugin.id, entry: { ...entry, _kind: 'producer' } });
          }
        }

        // Collect consumers
        const consumers = queuesBinding.consumers;
        if (Array.isArray(consumers)) {
          for (const entry of consumers) {
            if (!entry.queue) {
              console.warn(`!  Plugin "${plugin.id}": skipping malformed queues.consumers entry (missing queue).`);
              continue;
            }
            const existing = collected.get(type).find(
              (e) => e.entry.queue === entry.queue && e.entry._kind === 'consumer',
            );
            if (existing) {
              console.error(
                `x  Queue consumer conflict: "${entry.queue}" claimed by both "${existing.pluginId}" and "${plugin.id}".`,
              );
              process.exit(1);
            }
            collected.get(type).push({ pluginId: plugin.id, entry: { ...entry, _kind: 'consumer' } });
          }
        }
        continue;
      }

      // Array-based binding types (kv_namespaces, durable_objects)
      const entries = bindings[type];
      if (!Array.isArray(entries) || entries.length === 0) {
        continue;
      }

      if (!collected.has(type)) {
        collected.set(type, []);
      }

      for (const entry of entries) {
        const name = getBindingName(type, entry);
        if (!name || typeof name !== 'string') {
          console.warn(`!  Plugin "${plugin.id}": skipping malformed ${type} entry (missing binding name).`);
          continue;
        }

        // Check for duplicates across plugins
        const existing = collected.get(type).find(
          (e) => getBindingName(type, e.entry) === name,
        );
        if (existing) {
          console.error(
            `x  Binding conflict: "${name}" (${type}) claimed by both "${existing.pluginId}" and "${plugin.id}".`,
          );
          console.error(`   Rename one of the bindings so they don't collide.`);
          process.exit(1);
        }

        collected.get(type).push({ pluginId: plugin.id, entry });
      }
    }

    // Collect plugin-declared vars for injection into the existing vars block
    if (bindings.vars && typeof bindings.vars === 'object' && !Array.isArray(bindings.vars)) {
      for (const [key, value] of Object.entries(bindings.vars)) {
        if (typeof value !== 'string') continue;
        if (pluginVars[key]) {
          console.error(
            `x  Var conflict: "${key}" claimed by both "${pluginVars[key].pluginId}" and "${plugin.id}".`,
          );
          console.error(`   Rename one of the vars so they don't collide.`);
          process.exit(1);
        }
        pluginVars[key] = { value, pluginId: plugin.id };
      }
    }

    // Collect plugin-declared secrets_store_secrets for injection into the core array
    if (bindings.secrets_store_secrets && Array.isArray(bindings.secrets_store_secrets)) {
      if (!collected.has('secrets_store_secrets')) {
        collected.set('secrets_store_secrets', []);
      }
      for (const entry of bindings.secrets_store_secrets) {
        if (!entry.binding || !entry.store_id || !entry.secret_name) {
          console.warn(`!  Plugin "${plugin.id}": skipping malformed secrets_store_secrets entry (missing binding, store_id, or secret_name).`);
          continue;
        }
        const existing = collected.get('secrets_store_secrets').find(
          (e) => e.entry.binding === entry.binding,
        );
        if (existing) {
          console.error(
            `x  Secrets conflict: "${entry.binding}" claimed by both "${existing.pluginId}" and "${plugin.id}".`,
          );
          process.exit(1);
        }
        collected.get('secrets_store_secrets').push({ pluginId: plugin.id, entry });
      }
    }

    // Validate that plugins don't declare core-owned binding types in wrangler_bindings
    for (const type of ['r2_buckets']) {
      if (bindings[type]) {
        console.warn(
          `!  Plugin "${plugin.id}" declares wrangler_bindings.${type} — ` +
          `${type} is owned by core. Add entries directly to wrangler.jsonc instead.`,
        );
      }
    }
  }

  // Attach vars to collected so they can be used by the caller
  collected.__vars = pluginVars;

  return collected;
}

/**
 * Build the JSONC content block for the plugin bindings section.
 * @param {Map} collected - Collected bindings by type
 * @param {string} indentUnit - The indentation string (e.g. "\t" or "  ")
 * @returns {string} JSONC block content, or empty string if nothing to inject
 */
function generatePluginBindingsBlock(collected, indentUnit = '  ') {
  const I0 = '';                     // block root
  const I1 = indentUnit;             // keys like "queues":
  const I2 = indentUnit + indentUnit; // array brackets / object braces
  const I3 = I2 + indentUnit;        // object keys inside array entries
  const I4 = I3 + indentUnit;        // // pluginId comments

  if (collected.size === 0) {
    return '';
  }

  const blocks = [];

  // Generate ai binding (singleton object)
  const aiEntries = collected.get('ai');
  if (aiEntries && aiEntries.length > 0) {
    const { pluginId, entry } = aiEntries[0];
    blocks.push(`${I1}"ai": {\n${I2}"binding": "${entry.binding}"  // ${pluginId}\n${I1}}`);
  }

  // Generate kv_namespaces entries
  const kvNamespaces = collected.get('kv_namespaces');
  if (kvNamespaces && kvNamespaces.length > 0) {
    const entries = kvNamespaces.map(({ pluginId, entry }) =>
      `${I3}{\n${I4}"binding": "${entry.binding}",\n${I4}"namespace_id": "${entry.namespace_id}"  // ${pluginId}\n${I3}}`);
    blocks.push(`${I1}"kv_namespaces": [\n${entries.join(',\n')}\n${I1}]`);
  }

  // Generate durable_objects entries
  const durableObjects = collected.get('durable_objects');
  if (durableObjects && durableObjects.length > 0) {
    const entries = durableObjects.map(({ pluginId, entry }) =>
      `${I3}{\n${I4}"name": "${entry.name}",\n${I4}"class_name": "${entry.class_name}"  // ${pluginId}\n${I3}}`);
    blocks.push(`${I1}"durable_objects": {\n${I2}"bindings": [\n${entries.join(',\n')}\n${I2}]\n${I1}}`);
  }

  // Generate queues entries
  const queuesEntries = collected.get('queues');
  if (queuesEntries && queuesEntries.length > 0) {
    const producers = queuesEntries.filter((e) => e.entry._kind === 'producer');
    const consumers = queuesEntries.filter((e) => e.entry._kind === 'consumer');
    const queueParts = [];

    if (producers.length > 0) {
      const producerLines = producers.map(({ pluginId, entry }) =>
        `${I4}{\n${I4}${indentUnit}"queue": "${entry.queue}",\n${I4}${indentUnit}"binding": "${entry.binding}"  // ${pluginId}\n${I4}}`);
      queueParts.push(`${I2}"producers": [\n${producerLines.join(',\n')}\n${I2}]`);
    }

    if (consumers.length > 0) {
      const consumerLines = consumers.map(({ pluginId, entry }) => {
        const parts = [`${I4}${indentUnit}"queue": "${entry.queue}"`];
        if (entry.max_batch_size !== undefined) parts.push(`${I4}${indentUnit}"max_batch_size": ${entry.max_batch_size}`);
        if (entry.max_batch_timeout !== undefined) parts.push(`${I4}${indentUnit}"max_batch_timeout": ${entry.max_batch_timeout}`);
        parts.push(`${I4}${indentUnit}// ${pluginId}`);
        return `${I4}{\n${parts.join(',\n')}\n${I4}}`;
      });
      queueParts.push(`${I2}"consumers": [\n${consumerLines.join(',\n')}\n${I2}]`);
    }

    blocks.push(`${I1}"queues": {\n${queueParts.join(',\n')}\n${I1}}`);
  }

  return blocks.length > 0 ? blocks.join(',\n\n') + ',' : '';
}

/**
 * Read wrangler.jsonc and replace the content between the plugin bindings
 * start/end markers with the generated binding block.
 */
function rebuildWranglerPluginBindings(plugins) {
  if (!existsSync(WRANGLER_CONFIG_FILE)) {
    console.warn('!  wrangler.jsonc not found — skipping plugin wrangler binding injection.');
    return;
  }

  const raw = readFileSync(WRANGLER_CONFIG_FILE, 'utf8');
  const lines = raw.split(/\r?\n/);

  // Find the line indices of start and end markers
  let startLineIdx = -1;
  let endLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startLineIdx === -1 && lines[i].includes(PLUGIN_BINDINGS_START)) {
      startLineIdx = i;
    }
    if (startLineIdx !== -1 && lines[i].includes(PLUGIN_BINDINGS_END)) {
      endLineIdx = i;
      break;
    }
  }

  if (startLineIdx === -1 || endLineIdx === -1 || endLineIdx <= startLineIdx) {
    console.warn(
      '!  wrangler.jsonc is missing the PLUGIN BINDINGS marker section. ' +
      `Add these markers:\n  ${PLUGIN_BINDINGS_START}\n  ${PLUGIN_BINDINGS_END}`,
    );
    return;
  }

  const collected = collectWranglerBindingsWithIntents(plugins);

  // Detect the indentation used in the file (tabs vs spaces) before generating
  const indentUnit = lines[startLineIdx].startsWith('\t') ? '\t' : '  ';

  const block = generatePluginBindingsBlock(collected, indentUnit);

  // ── Inject plugin-declared vars into the existing "vars": { } block ──
  const pluginVars = collected.__vars || {};
  const varKeys = Object.keys(pluginVars);

  let modifiedLines = [...lines];

  if (varKeys.length > 0) {
    // ── Step 1: Remove any previously injected plugin vars ──
    // Lines ending with "// <pluginId>" inside the vars block are plugin-injected.
    const pluginIds = new Set(plugins.map((p) => p.id));
    const cleanedLines = [];
    let insideVars = false;
    let varsDepth = 0;
    for (let i = 0; i < modifiedLines.length; i++) {
      const line = modifiedLines[i];
      const stripped = line.replace(/\/\/.*$/g, '').trim();

      if (!insideVars) {
        if (line.includes('"vars"') && line.includes('{')) {
          insideVars = true;
          varsDepth = 1;
        }
        cleanedLines.push(line);
        continue;
      }

      // Track brace depth inside vars
      const openBraces = (stripped.match(/{/g) || []).length;
      const closeBraces = (stripped.match(/}/g) || []).length;
      varsDepth += openBraces - closeBraces;

      // Check if this line is a plugin-injected var (has // <pluginId> comment)
      const commentMatch = line.match(/\/\/\s*([\w-]+)\s*$/);
      const isPluginVar = commentMatch && pluginIds.has(commentMatch[1]);

      if (isPluginVar) {
        // Skip this line — it was injected by a previous run
        continue;
      }

      cleanedLines.push(line);

      if (varsDepth <= 0) {
        insideVars = false;
      }
    }

    // ── Step 1b: Clean up trailing commas left by removed plugin vars ──
    // Scan backward from the vars closing brace to find the last real property
    // and strip its trailing comma if the removed var was the last one.
    modifiedLines = cleanedLines;
    // Re-find the vars closing brace
    let varsCloseBraceIdx = -1;
    let vd2 = 0;
    let inV2 = false;
    for (let i = 0; i < modifiedLines.length; i++) {
      const line = modifiedLines[i];
      if (!inV2 && line.includes('"vars"') && line.includes('{')) {
        inV2 = true;
        vd2 = 1;
        continue;
      }
      if (!inV2) continue;
      const s = line.replace(/\/\/.*$/g, '').trim();
      vd2 += (s.match(/{/g) || []).length;
      vd2 -= (s.match(/}/g) || []).length;
      if (vd2 <= 0) {
        varsCloseBraceIdx = i;
        break;
      }
    }
    // Walk backward from the closing brace to find the last non-blank property line
    if (varsCloseBraceIdx > 0) {
      for (let i = varsCloseBraceIdx - 1; i >= 0; i--) {
        const trimmed = modifiedLines[i].replace(/\/\/.*$/g, '').trim();
        if (!trimmed) continue; // skip blank lines
        // If this line ends with a dangling comma (no next property before }),
        // strip the comma
        if (trimmed.endsWith(',')) {
          modifiedLines[i] = modifiedLines[i].replace(/,\s*(\/\/.*)?$/, '$1');
        }
        break;
      }
    }

    // ── Step 2: Find the vars block closing brace and inject ──
    // Recalculate startLineIdx since we may have removed lines
    startLineIdx = -1;
    endLineIdx = -1;
    for (let i = 0; i < modifiedLines.length; i++) {
      if (startLineIdx === -1 && modifiedLines[i].includes(PLUGIN_BINDINGS_START)) {
        startLineIdx = i;
      }
      if (startLineIdx !== -1 && modifiedLines[i].includes(PLUGIN_BINDINGS_END)) {
        endLineIdx = i;
        break;
      }
    }

    const searchEnd = startLineIdx;
    const varLines = modifiedLines.slice(0, searchEnd);

    // Find the vars key
    let varsKeyIdx = -1;
    for (let i = searchEnd - 1; i >= 0; i--) {
      if (varLines[i].includes('"vars"')) {
        varsKeyIdx = i;
        break;
      }
    }

    if (varsKeyIdx !== -1) {
      // Find the matching closing brace of the vars block
      let braceCount = 0;
      let varsCloseIdx = -1;
      let foundVars = false;
      for (let i = varsKeyIdx; i < searchEnd; i++) {
        const line = varLines[i];
        const stripped = line.replace(/\/\/.*$/g, '');
        const openBraces = (stripped.match(/{/g) || []).length;
        const closeBraces = (stripped.match(/}/g) || []).length;

        if (!foundVars) {
          if (line.includes('{')) foundVars = true;
          braceCount = openBraces - closeBraces;
          continue;
        }

        braceCount += openBraces - closeBraces;
        if (braceCount <= 0) {
          varsCloseIdx = i;
          break;
        }
      }

      if (varsCloseIdx !== -1) {
        // Detect keys already defined in the core vars block. Plugin vars that
        // collide with core-defined keys are skipped (core value wins) instead
        // of producing duplicate JSON keys in wrangler.jsonc.
        const coreVarKeys = new Set();
        for (let i = varsKeyIdx + 1; i < varsCloseIdx; i++) {
          const stripped = modifiedLines[i].replace(/\/\/.*$/g, '').trim();
          const keyMatch = stripped.match(/"([^"]+)"\s*:/);
          if (keyMatch) coreVarKeys.add(keyMatch[1]);
        }

        const injectableKeys = varKeys.filter((key) => {
          if (!coreVarKeys.has(key)) return true;
          console.warn(
            `!  Plugin "${pluginVars[key].pluginId}": var "${key}" is already defined in the core vars block — skipping plugin injection (core value wins).`,
          );
          return false;
        });

        if (injectableKeys.length > 0) {
          // Detect indentation from existing vars properties, not the previous line
          // (which could be blank if the removed plugin var was the last property)
          const varIndent = (modifiedLines[varsKeyIdx].match(/^(\s*)/)?.[1] ?? '  ') + '  ';

          // Ensure the last non-blank line before the closing brace ends with a comma
          let lastPropIdx = varsCloseIdx - 1;
          while (lastPropIdx > varsKeyIdx) {
            const trimmed = modifiedLines[lastPropIdx].replace(/\/\/.*$/g, '').trim();
            if (trimmed && trimmed !== '}') break;
            lastPropIdx--;
          }
          if (lastPropIdx > varsKeyIdx) {
            const lastLine = modifiedLines[lastPropIdx];
            const lastStripped = lastLine.replace(/\/\/.*$/g, '').trim();
            if (lastStripped && !lastStripped.endsWith(',') && !lastStripped.endsWith('{')) {
              if (/\/\/.*$/.test(lastLine)) {
                modifiedLines[lastPropIdx] = lastLine.replace(/(\/\/.*$)/, ',$1');
              } else {
                modifiedLines[lastPropIdx] = lastLine + ',';
              }
            }
          }

          const varEntries = injectableKeys.map((key, idx) => {
            const { value, pluginId } = pluginVars[key];
            const comma = idx < injectableKeys.length - 1 ? ',' : '';
            return `${varIndent}"${key}": "${value}"${comma}  // ${pluginId}`;
          });

          modifiedLines.splice(varsCloseIdx, 0, ...varEntries);
          startLineIdx += varEntries.length;
          endLineIdx += varEntries.length;
        }
      }
    }
  }

  // ── Inject plugin-declared secrets_store_secrets into the core array ──
  // Approach: extract the raw JSONC array text, strip comments, JSON.parse it,
  // merge plugin secrets (deduplicating by binding name), JSON.stringify back
  // with the detected indentation, and splice the replacement in.
  const secretsEntries = collected.get('secrets_store_secrets');
  if (secretsEntries && secretsEntries.length > 0) {
    const coreSection = modifiedLines.slice(0, startLineIdx);
    let secretsKeyLine = -1;   // line with "secrets_store_secrets"
    let secretsOpenLine = -1;  // line with [
    let secretsCloseLine = -1; // line with ]
    let inSecrets = false;
    let bracketDepth = 0;
    for (let i = 0; i < coreSection.length; i++) {
      const line = coreSection[i];
      if (!inSecrets && line.includes('"secrets_store_secrets"')) {
        inSecrets = true;
        secretsKeyLine = i;
        if (line.includes('[')) secretsOpenLine = i;
        // Count brackets on this line even when key and [ are on the same line
        const stripped = line.replace(/\/\/.*$/g, '');
        bracketDepth += (stripped.match(/\[/g) || []).length;
        bracketDepth -= (stripped.match(/\]/g) || []).length;
        if (bracketDepth <= 0) {
          secretsCloseLine = i;
          break;
        }
        continue;
      }
      if (!inSecrets) continue;
      if (secretsOpenLine === -1 && line.includes('[')) secretsOpenLine = i;
      const stripped = line.replace(/\/\/.*$/g, '');
      bracketDepth += (stripped.match(/\[/g) || []).length;
      bracketDepth -= (stripped.match(/\]/g) || []).length;
      if (bracketDepth <= 0) {
        secretsCloseLine = i;
        break;
      }
    }

    if (secretsOpenLine !== -1 && secretsCloseLine !== -1) {
      // Step 1: extract the raw text between `[` and `]`, strip comments, parse as JSON
      const rawLines = modifiedLines.slice(secretsOpenLine, secretsCloseLine + 1);
      const rawText = rawLines.join('\n');
      // Extract just the JSON array: everything from the first `[` to the last `]`
      const firstBracket = rawText.indexOf('[');
      const lastBracket = rawText.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        let jsonText = rawText.slice(firstBracket + 1, lastBracket);
        // Strip // line comments and /* block comments */
        jsonText = jsonText.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Try to parse as a JSON array — it may have trailing commas, try to fix
        let coreSecrets = [];
        try {
          coreSecrets = JSON.parse('[' + jsonText + ']');
        } catch {
          // If parse fails (trailing commas are common), try removing trailing commas before ] or }
          const cleaned = jsonText.replace(/,\s*([}\]])/g, '$1');
          try {
            coreSecrets = JSON.parse('[' + cleaned + ']');
          } catch {
            console.warn('!  Could not parse secrets_store_secrets as JSON — skipping injection.');
          }
        }

        if (Array.isArray(coreSecrets) && coreSecrets.length >= 0) {
          // Step 2: remove any plugin-injected secrets (identified by matching binding names)
          const pluginBindingNames = new Set(secretsEntries.map((s) => s.entry.binding));
          const filteredSecrets = coreSecrets.filter((s) => !pluginBindingNames.has(s.binding));

          // Step 3: merge plugin secrets
          const merged = [...filteredSecrets, ...secretsEntries.map((s) => s.entry)];

          // Step 4: detect indentation and re-serialize
          const coreIndent = (modifiedLines[secretsOpenLine].match(/^(\s*)/)?.[1] ?? '  ');
          const entryIndent = coreIndent + '  ';
          const innerIndent = entryIndent + '  ';
          const serialized = merged.map((entry) => {
            const { binding, store_id, secret_name } = entry;
            const lines = [
              `${entryIndent}{`,
              `${innerIndent}"binding": ${JSON.stringify(binding)},`,
              `${innerIndent}"store_id": ${JSON.stringify(store_id)},`,
              `${innerIndent}"secret_name": ${JSON.stringify(secret_name)}`,
              `${entryIndent}}`,
            ];
            return lines.join('\n');
          });

          const arrayContent = serialized.length > 0
            ? '\n' + serialized.join(',\n') + '\n' + coreIndent
            : '';

          // Step 5: splice the replacement — preserve the "secrets_store_secrets" key line
          // if it's separate from the [ line, otherwise reconstruct it
          const beforeSecrets = modifiedLines.slice(0, secretsOpenLine);
          const afterSecrets = modifiedLines.slice(secretsCloseLine + 1);

          if (secretsKeyLine === secretsOpenLine) {
            // Key and [ are on the same line — reconstruct the full line
            const keyIndent = (modifiedLines[secretsKeyLine].match(/^(\s*)/)?.[1] ?? '  ');
            modifiedLines = [
              ...beforeSecrets,
              `${keyIndent}"secrets_store_secrets": [${arrayContent}],`,
              ...afterSecrets,
            ];
          } else {
            // Key and [ are on separate lines — keep the key line, replace only the array
            modifiedLines = [
              ...beforeSecrets,
              `${coreIndent}[${arrayContent}],`,
              ...afterSecrets,
            ];
          }

          // Recalculate marker positions
          startLineIdx = modifiedLines.findIndex((l) => l.includes(PLUGIN_BINDINGS_START));
          endLineIdx = modifiedLines.findIndex((l, i) => i > startLineIdx && l.includes(PLUGIN_BINDINGS_END));
        }
      }
    }
  }

  // Rebuild: keep everything up to and including the start marker line,
  // insert the binding block (or blank line), then the end marker line onward
  const before = modifiedLines.slice(0, startLineIdx + 1).join('\n');
  const after = modifiedLines.slice(endLineIdx).join('\n');

  const injected = block
    ? `\n\n${block}\n\n`
    : '\n';

  const newRaw = before + injected + after;
  writeFileSync(WRANGLER_CONFIG_FILE, newRaw, 'utf8');

  if (block) {
    console.log(`i  Injected plugin wrangler bindings: ${[...collected.keys()].join(', ')}`);
  }
}