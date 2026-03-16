import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

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
}

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
   * "admin" | "staff" | undefined (any authenticated user)
   */
  requiredRole?: 'admin' | 'staff';
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
  /**
   * Optional extra role requirement beyond the group's own gating.
   * "admin" — only SUPERADMIN sees this item.
   * "staff" — staff and above see this item (default for "admin" group items).
   */
  requiredRole?: 'admin' | 'staff';
}

// ─── Plugin Definition ────────────────────────────────────────────────────────
/**
 * The runtime descriptor that every plugin's src/index.tsx MUST export
 * as its default export.
 *
 * @example
 * ```ts
 * // src/plugins/my-plugin/src/index.tsx
 * import { PluginDefinition } from '@/types/plugin';
 * import Dashboard from './pages/Dashboard';
 * import { LayoutDashboard } from 'lucide-react';
 *
 * const plugin: PluginDefinition = {
 *   id: 'my-plugin',
 *   name: 'My Plugin',
 *   version: '1.0.0',
 *   routes: [
 *     { path: '/plugins/my-plugin/dashboard', component: Dashboard, requiredRole: 'staff' },
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
}

// ─── Database Record ─────────────────────────────────────────────────────────
/** Mirrors the public.plugins DB table. */
export interface PluginRegistration {
  id: string;
  slug: string;
  name: string;
  version: string;
  description: string | null;
  author_name: string | null;
  author_url: string | null;
  license: string | null;
  repo_url: string;
  download_url: string | null;
  status: 'registered' | 'installed' | 'enabled' | 'disabled' | 'error';
  config: Record<string, string>;
  error_message: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Input type for registering a new plugin (INSERT). */
export type PluginRegistrationInsert = Omit<
  PluginRegistration,
  'id' | 'created_at' | 'updated_at' | 'installed_at' | 'status' | 'config' | 'error_message'
> & {
  status?: PluginRegistration['status'];
};
