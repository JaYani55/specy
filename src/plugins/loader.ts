/**
 * Plugin Loader
 *
 * Provides helpers for consuming registeredPlugins inside the app.
 * The router and sidebar import from here — they never touch registry.ts directly.
 */

import registeredPlugins from './registry';
import type { PluginDefinition, PluginRoute, PluginSidebarItem } from '@/types/plugin';

/**
 * Returns all page routes contributed by installed+registered plugins.
 * Used in App.tsx to render dynamic <Route> elements.
 */
export function getPluginRoutes(): PluginRoute[] {
  return registeredPlugins.flatMap((plugin) => plugin.routes);
}

/**
 * Returns all sidebar items contributed by plugins, optionally filtered by group.
 * @param group  If provided, only returns items from that group.
 */
export function getPluginSidebarItems(group?: 'main' | 'admin'): PluginSidebarItem[] {
  const items = registeredPlugins.flatMap((plugin) => plugin.sidebarItems);
  if (group) return items.filter((item) => item.group === group);
  return items;
}

/**
 * Returns all registered plugin definitions.
 * Useful for listing installed plugins in the Plugins admin page.
 */
export function getPlugins(): PluginDefinition[] {
  return registeredPlugins;
}
