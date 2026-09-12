import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppRole } from '@/types/auth';

// ─── Manifest ────────────────────────────────────────────────────────────────
// The plugin.json file that every plugin repo must provide at its root.
// The install script reads and validates this file.
export interface PluginManifest {
  /** Unique lowercase identifier, e.g. "my-plugin". Used as directory name. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semantic version, e.g. "1.2.0". */
  version: string;
  /** Short description shown in the Plugins page. */
  description: string;
  /** Author display name. */
  author: string;
  /** Author website or GitHub profile URL. */
  author_url?: string;
  /** SPDX license identifier, e.g. "MIT", "Apache-2.0". */
  license: string;
  /** Full GitHub URL, e.g. "https://github.com/owner/repo". */
  repository: string;
  /**
   * Path (relative to plugin root) to the TypeScript/JS entrypoint that
   * exports a default PluginDefinition.
   * Default: "src/index.tsx"
   */
  entrypoint?: string;
  /**
   * Path (relative to plugin root) to the Hono route file for API additions.
   * Optional — only needed if the plugin adds API routes.
   * Default: "api/index.ts"
   */
  api_entrypoint?: string;
  /**
   * Path (relative to plugin root) to backend hook contributions consumed by core services.
   * Optional — only needed if the plugin contributes API/service hooks.
   * Default: none
   */
  api_hooks_entrypoint?: string;
  /**
   * List of SQL migration files (relative to plugin root) that must be
   * applied to the database before the plugin can run.
   * E.g. ["migrations/001_create_my_table.sql"]
   */
  migrations?: string[];
  /**
   * Minimum CMS version required for this plugin.
   * Uses semver range syntax, e.g. ">=1.0.0".
   */
  min_cms_version?: string;

  /**
   * Declarative config fields shown in the CMS plugin settings UI.
   * Secret values are stored in Cloudflare Secrets Store, non-secret values
   * are stored in public.plugins.config.
   */
  config_schema?: PluginConfigFieldDefinition[];

  /**
   * Optional metadata describing the core hooks this plugin attaches to.
   * This is descriptive only; executable handlers stay build-time integrated.
   */
  hook_metadata?: PluginHookDescriptor[];

  /**
   * Custom JWT claims this plugin contributes (Claim Management,
   * specs/plans/CLAIM_MANAGEMENT.md). Declared at build time, resolved at
   * token-mint time by a plugin-schema function, namespaced under
   * `claims.<plugin_id>`. The registry step enforces single-source,
   * reserved-key rejection and the per-claim byte budget.
   */
  claims_declarations?: PluginClaimDeclaration[];

  /**
   * Optional metadata describing the plugin's API surface for discovery.
   */
  api_metadata?: PluginApiMetadata;

  /**
   * Optional high-level capability summary for admin and discovery tooling.
   */
  capabilities?: PluginCapabilityDescriptor[];

  /**
   * Declarative Cloudflare Worker bindings that the plugin requires at deploy time.
   * The build system merges these into wrangler.jsonc inside the auto-generated
   * PLUGIN BINDINGS section. Each binding type is optional; the merge script
   * deduplicates by binding name across all installed plugins.
   *
   * @deprecated Legacy form — declares CONCRETE instances (account-global names),
   * which break per-environment deployments. Declare `wrangler_intents` instead
   * (Binding Management, specs/platform/binding-management.md). Both forms are
   * accepted during migration; `wrangler_intents` wins when both are present.
   */
  wrangler_bindings?: PluginWranglerBindings;

  /**
   * Binding intents (Binding Intent & Provisioning System — BIPS).
   * The plugin declares *requirements* (`binding` + `purpose` + `scope`), never
   * concrete instances; a deterministic resolver maps every intent to a
   * per-environment instance name (`{worker-name}--{plugin-id}--{purpose}`) and
   * the provisioner create-or-gets it before deploy.
   *
   * Wins over the deprecated `wrangler_bindings` when both are present.
   */
  wrangler_intents?: PluginBindingIntents;

  /**
   * The vendor cloud system the plugin's bindings are declared against.
   * Binding management is part of a plugin: developers must declare their cloud
   * system bindings based on the deployment path. Cloudflare is the current
   * default and only deployment path; unknown paths are rejected at build time.
   */
  deployment_path?: PluginDeploymentPath;
}

export type PluginConfigFieldType = 'text' | 'textarea' | 'url' | 'secret';

export interface PluginConfigFieldDefinition {
  /** Unique config key inside the plugin namespace. */
  key: string;
  /** Human-readable label shown in the admin UI. */
  label: string;
  /** Optional help text shown below the field. */
  description?: string;
  /** Input/storage behavior. 'secret' is stored in the Cloudflare secrets store. */
  type: PluginConfigFieldType;
  /** Whether the field must be set before the plugin can operate. */
  required?: boolean;
  /** Optional placeholder/example text. */
  placeholder?: string;
  /** Whether the value may be exposed to frontend plugin code. */
  expose_to_frontend?: boolean;
}

export type PluginHookScope = 'ui' | 'page' | 'service' | 'api';

/**
 * Core feature flag that gates a plugin route/sidebar item.
 * Mirrors FeatureFlagId in @/contexts/FeatureFlagsContext (string literal
 * here so plugins never need to import core React contexts).
 * - "betaFeatures" — only visible when the user enabled beta features.
 * - "devMode"      — only visible when the user enabled developer mode.
 */
export type PluginFeatureFlag = 'betaFeatures' | 'devMode';

export type PluginHookKind = 'observer' | 'validator' | 'transform';

export interface PluginHookDescriptor {
  /** Unique stable hook key inside the plugin namespace. */
  key: string;
  /** Core target identifier, e.g. "app.routes" or "forms.beforeCreate". */
  target: string;
  /** Broad execution surface for grouping and discovery. */
  scope: PluginHookScope;
  /** Behavioral contract for the hook. */
  kind: PluginHookKind;
  /** Lower numbers run earlier; defaults to 100. */
  order?: number;
  /** Human-readable description for discovery/admin tooling. */
  description?: string;
}

/** JWT value shape a plugin claim resolver is allowed to return. */
export type PluginClaimValueType = 'bool' | 'string' | 'uuid' | 'string[]' | 'json';

export interface PluginClaimDeclaration {
  /**
   * Claim key inside the plugin's namespaced claim object. The top-level JWT
   * key is always the plugin id (`claims.<plugin_id>`).
   */
  key: string;
  /** Value shape the resolver returns (validated at mint time against the registry). */
  type: PluginClaimValueType;
  /**
   * Name of the resolver function in the plugin schema (signature:
   * `(p_uid uuid, p_tenant uuid) RETURNS jsonb`). Registered by the plugin's
   * migration into public.plugin_claims.
   */
  resolver: string;
  /** Max serialized size in bytes; over-budget output is omitted at mint time. */
  budget_bytes?: number;
  /** Human-readable description for review/agent discovery. */
  description?: string;
}

export interface PluginHookContribution<TContext = unknown, TResult = unknown>
  extends PluginHookDescriptor {
  handler: (context: TContext) => TResult | Promise<TResult>;
}

export interface PluginApiRouteMetadata {
  /** Stable endpoint identifier inside the plugin namespace. */
  id: string;
  /** HTTP method, e.g. GET or POST. */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Plugin-local path starting with '/'. */
  path: string;
  /** Optional human-readable summary. */
  summary?: string;
  /** Optional long-form description for admin API tooling. */
  description?: string;
  /** Auth model for the endpoint. */
  auth?: 'public' | 'bearer-optional' | 'bearer-required' | 'worker-secret';
  /** Logging model for the endpoint. */
  logging?: 'agentLogger' | 'internal' | 'none';
  /** Optional parameter descriptors. */
  parameters?: Array<{
    name: string;
    in: 'path' | 'query' | 'header' | 'body';
    required: boolean;
    type: string;
    description: string;
  }>;
  /** Optional request-body example. */
  requestExample?: string;
  /** Optional response examples. */
  responseExamples?: Array<{
    status: number;
    description: string;
    example?: string;
  }>;
  /** Optional side-effect notes. */
  sideEffects?: string[];
  /** Optional backing stores/tables. */
  tables?: string[];
  /** Optional operator notes. */
  notes?: string[];
}

export interface PluginApiMetadata {
  /** Optional base path override for discovery. Defaults to /api/plugin/{slug}. */
  basePath?: string;
  /** Optional grouping tag used by admin tooling. Defaults to 'Plugins'. */
  tag?: string;
  /** Optional list of plugin API routes for discovery. */
  routes?: PluginApiRouteMetadata[];
}

export type PluginCapabilityKind = 'interface' | 'hook' | 'api';

export interface PluginCapabilityDescriptor {
  /** Stable machine-readable capability key. */
  key: string;
  /** High-level capability category. */
  kind: PluginCapabilityKind;
  /** Optional list of affected targets, such as route groups or hook targets. */
  targets?: string[];
  /** Human-readable description for discovery/admin tooling. */
  description?: string;
}

// ─── Wrangler Bindings ────────────────────────────────────────────────────────
/**
 * Declarative Cloudflare Worker bindings contributed by plugins.
 * Each entry in every array is injected into wrangler.jsonc at build time.
 * The merge script deduplicates by `binding` name across all plugins.
 *
 * @see https://developers.cloudflare.com/workers/wrangler/configuration/#bindings
 */
export interface PluginWranglerBindings {
  /** R2 bucket bindings. Merged into wrangler.jsonc r2_buckets[]. */
  r2_buckets?: PluginWranglerR2Binding[];
  /** AI binding for Workers AI (singleton — merged into wrangler.jsonc ai). */
  ai?: PluginWranglerAiBinding;
  /** KV namespace bindings. Merged into wrangler.jsonc kv_namespaces[]. */
  kv_namespaces?: PluginWranglerKvBinding[];
  /** Durable Object bindings. Merged into wrangler.jsonc durable_objects.bindings[]. */
  durable_objects?: PluginWranglerDurableObjectBinding[];
  /** Queue bindings. Merged into wrangler.jsonc queues. */
  queues?: PluginWranglerQueuesBinding;
  /** Plain environment vars (non-secret). Merged into wrangler.jsonc vars. */
  vars?: Record<string, string>;
  /** Secrets Store secret bindings. Merged into wrangler.jsonc secrets_store_secrets[]. */
  secrets_store_secrets?: PluginWranglerSecretsStoreBinding[];
}

export interface PluginWranglerR2Binding {
  /** JS variable name in the Worker, e.g. "MY_R2". */
  binding: string;
  /** Cloudflare R2 bucket name. */
  bucket_name: string;
}

/** AI binding for Workers AI (singleton — not an array). */
export interface PluginWranglerAiBinding {
  /** JS variable name for the AI binding, typically "AI". */
  binding: string;
}

export interface PluginWranglerKvBinding {
  /** JS variable name in the Worker, e.g. "MY_KV". */
  binding: string;
  /** KV namespace ID (32-char hex string). */
  namespace_id: string;
}

export interface PluginWranglerDurableObjectBinding {
  /** JS variable name in the Worker, e.g. "MY_DO". */
  name: string;
  /** Durable Object class name exported by the Worker. */
  class_name: string;
}

export interface PluginWranglerSecretsStoreBinding {
  /** JS variable name in the Worker, e.g. "SS_MY_SECRET". */
  binding: string;
  /** Secrets Store UUID. */
  store_id: string;
  /** Secret name inside the store. */
  secret_name: string;
}

export interface PluginWranglerQueuesBinding {
  /** Producer bindings. Each entry declares a queue name and JS binding name. */
  producers?: PluginWranglerQueueProducerBinding[];
  /** Consumer bindings. Each entry declares a queue name and consumer settings. */
  consumers?: PluginWranglerQueueConsumerBinding[];
}

export interface PluginWranglerQueueProducerBinding {
  /** Cloudflare Queue name. */
  queue: string;
  /** JS variable name in the Worker, e.g. "MY_QUEUE". */
  binding: string;
}

export interface PluginWranglerQueueConsumerBinding {
  /** Cloudflare Queue name. */
  queue: string;
  /** Maximum messages per batch (default: 10). */
  max_batch_size?: number;
  /** Maximum seconds to wait before delivering a partial batch (default: 5). */
  max_batch_timeout?: number;
}

// ─── Binding Intents (BIPS) ─────────────────────────────────

/** Vendor cloud system bindings are declared against. Cloudflare is the current default and only deployment path. */
export type PluginDeploymentPath = 'cloudflare';

/**
 * Instance scope of a binding intent:
 * - `environment` (default) — the deployment gets its OWN instance, resolved as
 *   `{worker-name}--{plugin-id}--{purpose}` (isolation by default).
 * - `shared` — explicit opt-in to one account-global instance, resolved as
 *   `{plugin-id}--{purpose}` (single-source across plugins).
 */
export type PluginBindingScope = 'environment' | 'shared';

/** Base shape of a binding intent — requirements, never concrete instances. */
export interface PluginBindingIntentBase {
  /** JS variable name on `env` — the plugin's capability handle in plugin code. */
  binding: string;
  /** Semantic slug; combined with plugin id and worker name into the instance name. */
  purpose: string;
  /** Instance scope (default: `environment`). */
  scope?: PluginBindingScope;
}

export interface PluginQueueBindingIntent extends PluginBindingIntentBase {
  /** Consumer settings — registered against the SAME resolved instance as the producer. */
  consumer?: Omit<PluginWranglerQueueConsumerBinding, 'queue'>;
}

export interface PluginKvBindingIntent extends PluginBindingIntentBase {
  /** @deprecated Intents never name instances — the namespace id resolves per environment from provisioning. */
  namespace_id?: string;
}

export interface PluginSecretsStoreBindingIntent extends PluginBindingIntentBase {
  /** Secret name inside the store (the link target). Defaults to the UPPER_SNAKE form of `purpose`. */
  secret_name?: string;
  /** Secrets Store UUID. Omit to resolve the core deployment's Secrets Store (`SECRETS_STORE_ID`). */
  store_id?: string;
  /** Provision behavior (default: `link` — verify the link, values stay in the Secrets Store). */
  provision?: 'link';
}

/**
 * Binding intents declared under `wrangler_intents` in plugin.json. The plugin
 * declares *requirements*; core owns the mechanism (resolver, provisioner,
 * ledger, injection) and plugins declare semantics — same split as claims.
 *
 * @see specs/platform/binding-management.md
 */
export interface PluginBindingIntents {
  /** Workers AI binding (singleton object, no instance provisioning). */
  ai?: PluginWranglerAiBinding;
  /** KV namespace intents — provisioned per environment; ids come from the ledger. */
  kv_namespaces?: PluginKvBindingIntent[];
  /** Durable Object class bindings (namespace = worker, no instance provisioning). */
  durable_objects?: PluginWranglerDurableObjectBinding[];
  /** Queue intents — the incident case: per-environment instances by default. */
  queues?: PluginQueueBindingIntent[];
  /** Plain environment vars (non-secret). Merged into wrangler.jsonc vars. */
  vars?: Record<string, string>;
  /** Secrets Store link intents — verified against the deployment's store. */
  secrets_store_secrets?: PluginSecretsStoreBindingIntent[];
}

/**
 * Descriptive descriptor of a resolved binding intent, as written to the
 * generated api/plugin-bindings.ts registry (review / discovery artifact).
 */
export interface PluginBindingIntentDescriptor {
  pluginId: string;
  kind: string;
  /** JS variable name on `env` (capability handle). */
  binding: string;
  /** Semantic purpose slug. */
  purpose: string;
  scope: PluginBindingScope;
  /** Vendor cloud system the intent is declared against. */
  deploymentPath: string;
  /** Resolved per-environment instance name, or null for instance-less kinds. */
  resolvedName: string | null;
}

export interface PluginAccessRule {
  /**
   * User must have at least one of these JWT claim roles to access the plugin.
   * Example: ['support', 'super-admin']
   */
  anyRole?: string[];
  /**
   * Plugin claim predicates — ALL entries must match the namespaced JWT claim
   * (`claims.<plugin_id>`) for access to be granted. See
   * specs/plans/CLAIM_MANAGEMENT.md (fail-closed: an omitted claim never matches).
   * Example: { entitlements: { tier: 'pro' } }
   */
  claims?: Record<string, Record<string, unknown>>;
}

export type PluginRegistrationKind = 'plugin' | 'webapp';

// ─── Route ───────────────────────────────────────────────────────────────────
/** A page route contributed by a plugin. */
export interface PluginRoute {
  /**
   * URL path for the route, e.g. "/plugins/my-plugin/dashboard".
   * Must start with "/" and should be namespaced under "/plugins/{pluginId}/".
   */
  path: string;
  /** The React page component to render at this path. */
  component: ComponentType;
  /**
   * Optional role gate. Mirrors ProtectedRoute's requiredRole prop.
    * "user" | "admin" | "super-admin" | undefined (any authenticated user)
   */
    requiredRole?: AppRole;
  /**
   * Optional core feature flag gating this route. When set, the route is
   * only registered if the flag is enabled in the user's browser
   * (see @/contexts/FeatureFlagsContext).
   */
  featureFlag?: PluginFeatureFlag;
}

// ─── Sidebar Item ─────────────────────────────────────────────────────────────
/** A sidebar navigation entry contributed by a plugin. */
export interface PluginSidebarItem {
  /** Unique key for React rendering. Should be "{pluginId}-{name}". */
  key: string;
  /** URL this item navigates to. Must match a PluginRoute path. */
  path: string;
  /** English display label (the sidebar uses English labels). */
  label: string;
  /** Lucide icon component. */
  icon: LucideIcon;
  /**
   * Which section of the sidebar this item appears in.
   * "main"  — appears alongside Events/Calendar/List
   * "admin" — appears in the conditional admin section (requires staff access)
   */
  group: 'main' | 'admin';
  /** Optional parent item key for dropdown-style navigation in core nav surfaces. */
  parentKey?: string;
  /**
   * Optional extra role requirement beyond the group's own gating.
    * "super-admin" — only super-admin sees this item.
    * "admin" — admin and super-admin see this item.
    * "user" — any authenticated app user sees this item.
   */
    requiredRole?: AppRole;
  /**
   * Optional core feature flag gating this sidebar item. When set, the
   * item is only shown if the flag is enabled in the user's browser
   * (see @/contexts/FeatureFlagsContext).
   */
  featureFlag?: PluginFeatureFlag;
}

// ─── Plugin Definition ────────────────────────────────────────────────────────
/**
 * The runtime descriptor that every plugin's src/index.tsx MUST export
 * as its default export.
 *
 * @example
 * ```ts
 * // plugins/my-plugin/src/index.tsx
 * import { PluginDefinition } from '@/types/plugin';
 * import Dashboard from './pages/Dashboard';
 * import { LayoutDashboard } from 'lucide-react';
 *
 * const plugin: PluginDefinition = {
 *   id: 'my-plugin',
 *   name: 'My Plugin',
 *   version: '1.0.0',
 *   routes: [
 *     { path: '/plugins/my-plugin/dashboard', component: Dashboard, requiredRole: 'user' },
 *   ],
 *   sidebarItems: [
 *     { key: 'my-plugin-dashboard', path: '/plugins/my-plugin/dashboard', label: 'My Plugin', icon: LayoutDashboard, group: 'admin' },
 *   ],
 * };
 *
 * export default plugin;
 * ```
 */
export interface PluginDefinition {
  /** Must match plugin.json "id". */
  id: string;
  /** Must match plugin.json "name". */
  name: string;
  /** Must match plugin.json "version". */
  version: string;
  /** Page routes registered by this plugin. */
  routes: PluginRoute[];
  /**
   * Optional public routes rendered OUTSIDE the authenticated layout and
   * without any auth gate (e.g. invitation acceptance, share pages).
   * Use sparingly — every route here is reachable by anonymous visitors.
   */
  publicRoutes?: PluginRoute[];
  /** Sidebar entries registered by this plugin. */
  sidebarItems: PluginSidebarItem[];
  /** Optional access contract evaluated against JWT user_roles claims. */
  access?: PluginAccessRule;
  /** Optional build-time hook handlers contributed by this plugin. */
  hooks?: PluginHookContribution[];
  /** Optional runtime-discovery API metadata. */
  apiMetadata?: PluginApiMetadata;
  /** Optional runtime-discovery capability metadata. */
  capabilities?: PluginCapabilityDescriptor[];
  /**
   * Optional admin connection settings sections contributed by this plugin.
   * Each section renders as a Card inside /admin/connections.
   */
  adminSections?: PluginAdminConnectionSection[];
}

// ─── Admin Connection Section ─────────────────────────────────────────────────
/**
 * A settings section contributed by a plugin that renders inside the
 * /admin/connections page. Plugins use this to add configuration UIs
 * for services like AI models, providers, etc.
 */
export interface PluginAdminConnectionSection {
  /** Unique section identifier inside the plugin namespace. */
  id: string;
  /** Human-readable section title shown as the Card header. */
  title: string;
  /** Optional description shown below the title. */
  description?: string;
  /** The React component to render inside the Card. */
  component: ComponentType;
  /** Lower numbers render first; defaults to 100. */
  order?: number;
}

// ─── Database Record ─────────────────────────────────────────────────────────
/** Mirrors the public.plugins DB table. */
export interface PluginRegistration {
  id: string;
  kind: PluginRegistrationKind;
  tenant_id: string | null;
  slug: string;
  name: string;
  version: string;
  description: string | null;
  author_name: string | null;
  author_url: string | null;
  license: string | null;
  repo_url: string | null;
  download_url: string | null;
  external_url: string | null;
  icon_url: string | null;
  status: 'registered' | 'installed' | 'enabled' | 'disabled' | 'error';
  config: Record<string, string>;
  config_schema: PluginConfigFieldDefinition[];
  error_message: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Input type for registering a new plugin (INSERT). */
export type PluginRegistrationInsert = Omit<
  PluginRegistration,
  'id' | 'created_at' | 'updated_at' | 'installed_at' | 'status' | 'config' | 'config_schema' | 'error_message'
> & {
  status?: PluginRegistration['status'];
  config_schema?: PluginConfigFieldDefinition[];
};
