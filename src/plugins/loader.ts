/**
 * Plugin Loader
 *
 * Provides helpers for consuming registeredPlugins inside the app.
 * The router and sidebar import from here — they never touch registry.ts directly.
 */

import registeredPlugins from './registry';
import type {
  PluginCapabilityDescriptor,
  PluginDefinition,
  PluginHookContribution,
  PluginRoute,
  PluginSidebarItem,
} from '@/types/plugin';

export interface PluginSidebarTreeItem extends PluginSidebarItem {
  children: PluginSidebarTreeItem[];
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
export function getPluginRoutes(userRoles?: string[]): PluginRoute[] {
  return registeredPlugins
    .filter((plugin) => isPluginAccessible(plugin, userRoles))
    .flatMap((plugin) => plugin.routes);
}

/**
 * Returns all sidebar items contributed by plugins, optionally filtered by group.
 * @param group  If provided, only returns items from that group.
 */
export function getPluginSidebarItems(group?: 'main' | 'admin', userRoles?: string[]): PluginSidebarItem[] {
  const items = registeredPlugins
    .filter((plugin) => isPluginAccessible(plugin, userRoles))
    .flatMap((plugin) => plugin.sidebarItems);

  if (group) return items.filter((item) => item.group === group);
  return items;
}

export function getPluginSidebarTree(group?: 'main' | 'admin', userRoles?: string[]): PluginSidebarTreeItem[] {
  const items = getPluginSidebarItems(group, userRoles);
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
