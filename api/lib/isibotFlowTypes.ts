/**
 * Core hook target for Isibot flow node-type descriptors.
 *
 * This module is intentionally small. It carries zero Isibot-specific domain
 * logic — the Isibot node union (gather/record/dial/hangup) lives in the
 * PluraDash plugin and is contributed through the registered API hooks.
 *
 * The hook returns an array of `IsibotFlowTypeDescriptor` entries. Plugins
 * (e.g. PluraDash) append their node-type definitions, and the API/UI layers
 * consume the union to render the flow builder.
 *
 * EUPL note: the core only knows about the abstract descriptor shape. The
 * concrete node types belong to plugins. This keeps the core "Original Work"
 * free of plugin-specific copyleft surface.
 */

import type { PluginHookContribution } from '../../src/types/plugin';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';

export const ISIBOT_FLOW_TYPES_HOOK = 'isibot.flow.types';

/**
 * Stable, machine-readable node-type identifier.
 * Plugin-local values are namespaced (e.g. `pluradash.isibot.gather`).
 */
export type IsibotFlowTypeId = string;

/**
 * Context object passed to each plugin hook handler. Plugins receive
 * the descriptors aggregated so far and return either the augmented
 * `IsibotFlowTypesHookContext` or a plain array of descriptors.
 */
export interface IsibotFlowTypesHookContext {
  descriptors: IsibotFlowTypeDescriptor[];
}

/**
 * Shape of the node-type contribution that flows from plugins into core.
 *
 * Plugins describe each node type they support; the builder UI then renders
 * the appropriate inline editor. The schema is open on purpose so plugins
 * can attach plugin-specific metadata (e.g. TwiML hints, audio URL templates)
 * without requiring a core schema bump.
 */
export interface IsibotFlowTypeDescriptor {
  /** Unique stable type id, namespaced by plugin. */
  type: IsibotFlowTypeId;
  /** Human-readable German label (sidebar/builder UI is in German). */
  label: string;
  /** Lucide icon name (resolved by the UI layer). */
  iconName: string;
  /** Color token used for the type badge in the builder. */
  color: string;
  /** Short description shown in tooltips. */
  description: string;
  /**
   * Default field values used when the user adds a new node of this type.
   * The shape is type-specific and consumed by the plugin's editor.
   */
  defaultFields: Record<string, unknown>;
  /**
   * Lightweight schema summary (field name → field type) so the API layer
   * can sanity-check payloads without depending on the full Zod schemas
   * that live in the plugin.
   */
  schemaSummary: Array<{
    name: string;
    kind: 'string' | 'number' | 'boolean' | 'enum' | 'string-map' | 'string-list' | 'phone' | 'url';
    required?: boolean;
  }>;
}

const DEFAULT_HOOK_ORDER = 100;

function sortDescriptors(
  hooks: Array<Pick<PluginHookContribution, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

function getIsibotFlowTypeHooks(): PluginHookContribution[] {
  return getRegisteredApiPluginHooks().filter((hook) => hook.target === ISIBOT_FLOW_TYPES_HOOK);
}

/**
 * Aggregate the Isibot flow node-type descriptors contributed by all
 * registered plugins. Returns an empty array when no plugin contributes.
 *
 * Each hook handler is expected to return an `IsibotFlowTypeDescriptor[]`.
 * Hooks are invoked in ascending `order` (lower numbers first); the union
 * is the concatenation in that order.
 */
export async function getIsibotFlowTypeDescriptors(): Promise<IsibotFlowTypeDescriptor[]> {
  const descriptors: IsibotFlowTypeDescriptor[] = [];

  for (const hook of sortDescriptors(getIsibotFlowTypeHooks())) {
    const result = await hook.handler({ descriptors });
    if (Array.isArray(result)) {
      descriptors.push(...(result as IsibotFlowTypeDescriptor[]));
      continue;
    }

    if (result && typeof result === 'object') {
      const maybe = (result as { descriptors?: IsibotFlowTypeDescriptor[] }).descriptors;
      if (Array.isArray(maybe)) {
        descriptors.push(...maybe);
      }
    }
  }

  return descriptors;
}
