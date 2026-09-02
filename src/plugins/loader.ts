/**
 * Plugin Loader
 *
 * Provides helpers for consuming registeredPlugins inside the app.
 * The router and sidebar import from here — they never touch registry.ts directly.
 */

import registeredPlugins from './registry';
import type {
  PluginAdminConnectionSection,
  PluginApiMetadata,
  PluginApiRouteMetadata,
  PluginCapabilityDescriptor,
  PluginDefinition,
  PluginFeatureFlag,
  PluginHookContribution,
  PluginRoute,
  PluginSidebarItem,
} from '@/types/plugin';

export interface PluginSidebarTreeItem extends PluginSidebarItem {
  children: PluginSidebarTreeItem[];
}

/**
 * Per-browser feature flag values (see @/contexts/FeatureFlagsContext).
 * Only flags referenced by plugin route/sidebar `featureFlag` declarations
 * are consumed here. When `featureFlags` is omitted entirely, all flags are
 * treated as enabled (fail-open) so non-flag-aware callers are unaffected.
 */
export type PluginFeatureFlagState = Partial<Record<PluginFeatureFlag, boolean>>;

function isFlagEnabled(
  flag: PluginFeatureFlag | undefined,
  featureFlags?: PluginFeatureFlagState,
): boolean {
  if (!flag) return true;
  if (!featureFlags) return true;
  return featureFlags[flag] === true;
}

export function isPluginAccessible(plugin: PluginDefinition, userRoles?: string[]): boolean {
  const requiredRoles = plugin.access?.anyRole;

  if (!requiredRoles?.length) {
    return true;
  }

  if (!userRoles?.length) {
    return false;
  }

  return requiredRoles.some((role) => userRoles.includes(role));
}

/**
 * Returns all page routes contributed by installed+registered plugins.
 * Used in App.tsx to render dynamic <Route> elements.
 */
export function getPluginRoutes(userRoles?: string[], featureFlags?: PluginFeatureFlagState): PluginRoute[] {
  return registeredPlugins
    .filter((plugin) => isPluginAccessible(plugin, userRoles))
    .flatMap((plugin) => plugin.routes)
    .filter((route) => isFlagEnabled(route.featureFlag, featureFlags));
}

/**
 * Returns public (unauthenticated) page routes contributed by plugins.
 * These are rendered by App.tsx outside the authenticated layout.
 */
export function getPluginPublicRoutes(): PluginRoute[] {
  return registeredPlugins.flatMap((plugin) => plugin.publicRoutes ?? []);
}

/**
 * Returns all sidebar items contributed by plugins, optionally filtered by group.
 * @param group  If provided, only returns items from that group.
 */
export function getPluginSidebarItems(group?: 'main' | 'admin', userRoles?: string[], featureFlags?: PluginFeatureFlagState): PluginSidebarItem[] {
  const items = registeredPlugins
    .filter((plugin) => isPluginAccessible(plugin, userRoles))
    .flatMap((plugin) => plugin.sidebarItems)
    .filter((item) => isFlagEnabled(item.featureFlag, featureFlags));

  if (group) return items.filter((item) => item.group === group);
  return items;
}

export function getPluginSidebarTree(group?: 'main' | 'admin', userRoles?: string[], featureFlags?: PluginFeatureFlagState): PluginSidebarTreeItem[] {
  const items = getPluginSidebarItems(group, userRoles, featureFlags);
  const itemMap = new Map<string, PluginSidebarTreeItem>();
  const roots: PluginSidebarTreeItem[] = [];

  for (const item of items) {
    itemMap.set(item.key, {
      ...item,
      children: [],
    });
  }

  for (const item of items) {
    const node = itemMap.get(item.key);
    if (!node) {
      continue;
    }

    if (item.parentKey) {
      const parent = itemMap.get(item.parentKey);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

/**
 * Returns all registered plugin definitions.
 * Useful for listing installed plugins in the Plugins admin page.
 */
export function getPlugins(userRoles?: string[]): PluginDefinition[] {
  return registeredPlugins.filter((plugin) => isPluginAccessible(plugin, userRoles));
}

/**
 * Returns all build-time hook contributions, optionally filtered by target.
 */
export function getPluginHooks(target?: string, userRoles?: string[]): PluginHookContribution[] {
  const hooks = getPlugins(userRoles).flatMap((plugin) => plugin.hooks ?? []);
  if (!target) return hooks;
  return hooks.filter((hook) => hook.target === target);
}

/**
 * Returns all hooks for a given execution scope, optionally filtered by target.
 */
export function getPluginHooksByScope(
  scope: PluginHookContribution['scope'],
  target?: string,
  userRoles?: string[],
): PluginHookContribution[] {
  return getPluginHooks(target, userRoles).filter((hook) => hook.scope === scope);
}

/**
 * Returns all declared plugin capabilities for discovery and admin tooling.
 */
export function getPluginCapabilities(userRoles?: string[]): Array<PluginCapabilityDescriptor & { pluginId: string }> {
  return getPlugins(userRoles).flatMap((plugin) =>
    (plugin.capabilities ?? []).map((capability) => ({
      ...capability,
      pluginId: plugin.id,
    }))
  );
}

export function getPluginApiMetadata(userRoles?: string[]): Array<PluginApiMetadata & { pluginId: string; pluginName: string }> {
  return getPlugins(userRoles)
    .filter((plugin) => Boolean(plugin.apiMetadata))
    .map((plugin) => ({
      ...(plugin.apiMetadata as PluginApiMetadata),
      pluginId: plugin.id,
      pluginName: plugin.name,
    }));
}

export function getPluginApiRoutes(userRoles?: string[]): Array<PluginApiRouteMetadata & { pluginId: string; pluginName: string; basePath: string; tag: string }> {
  return getPluginApiMetadata(userRoles).flatMap((metadata) =>
    (metadata.routes ?? []).map((route) => ({
      ...route,
      pluginId: metadata.pluginId,
      pluginName: metadata.pluginName,
      basePath: metadata.basePath ?? `/api/plugin/${metadata.pluginId}`,
      tag: metadata.tag ?? 'Plugins',
    }))
  );
}

/**
 * Returns all admin connection settings sections contributed by plugins,
 * filtered by user roles and sorted by order.
 */
export function getPluginAdminConnectionSections(userRoles?: string[]): PluginAdminConnectionSection[] {
  return registeredPlugins
    .filter((plugin) => isPluginAccessible(plugin, userRoles))
    .flatMap((plugin) => plugin.adminSections ?? [])
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
