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
   * EUPL note: declarative binding declarations keep plugin infrastructure
   * requirements in plugin.json, never in core wrangler config files.
   */
  wrangler_bindings?: PluginWranglerBindings;
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
  /** AI Gateway bindings. Merged into wrangler.jsonc ai_gateway[]. */
  ai_gateway?: PluginWranglerAiGatewayBinding[];
  /** KV namespace bindings. Merged into wrangler.jsonc kv_namespaces[]. */
  kv_namespaces?: PluginWranglerKvBinding[];
  /** Durable Object bindings. Merged into wrangler.jsonc durable_objects.bindings[]. */
  durable_objects?: PluginWranglerDurableObjectBinding[];
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

export interface PluginWranglerAiGatewayBinding {
  /** JS variable name in the Worker, e.g. "AI_GATEWAY". */
  binding: string;
  /** Cloudflare AI Gateway ID (UUID). */
  gateway_id: string;
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

export interface PluginAccessRule {
  /**
   * User must have at least one of these JWT claim roles to access the plugin.
   * Example: ['support', 'super-admin']
   */
  anyRole?: string[];
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
