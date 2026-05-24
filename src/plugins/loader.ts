/**
 * Plugin Loader
 *
 * Provides helpers for consuming registeredPlugins inside the app.
 * The router and sidebar import from here — they never touch registry.ts directly.
 */

import registeredPlugins from './registry';
import registeredHooks from './hooks-registry';
import type {
  PluginCapabilityDescriptor,
  PluginDefinition,
  PluginHookContribution,
  PluginRoute,
  PluginSidebarItem,
} from '@/types/plugin';

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

/**
 * Returns all build-time hook contributions, optionally filtered by target.
 */
export function getPluginHooks(target?: string): PluginHookContribution[] {
  if (!target) return registeredHooks;
  return registeredHooks.filter((hook) => hook.target === target);
}

/**
 * Returns all hooks for a given execution scope, optionally filtered by target.
 */
export function getPluginHooksByScope(
  scope: PluginHookContribution['scope'],
  target?: string,
): PluginHookContribution[] {
  return registeredHooks.filter((hook) => hook.scope === scope && (!target || hook.target === target));
}

/**
 * Returns all declared plugin capabilities for discovery and admin tooling.
 */
export function getPluginCapabilities(): Array<PluginCapabilityDescriptor & { pluginId: string }> {
  return registeredPlugins.flatMap((plugin) =>
    (plugin.capabilities ?? []).map((capability) => ({
      ...capability,
      pluginId: plugin.id,
    }))
  );
}
