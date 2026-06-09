/**
 * React-side mirror of `api/lib/isibotFlowTypes.ts`.
 *
 * Walks the build-time-registered plugin hooks for the
 * `isibot.flow.types` target and returns the aggregated descriptor array.
 *
 * Kept as a thin service so the React tree never imports from `api/`.
 */

import type { PluginHookContribution } from '@/types/plugin';

export const ISIBOT_FLOW_TYPES_HOOK = 'isibot.flow.types';

export interface IsibotFlowTypeDescriptor {
  type: string;
  label: string;
  iconName: string;
  color: string;
  description: string;
  defaultFields: Record<string, unknown>;
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

interface IsibotFlowTypesHookContext {
  descriptors: IsibotFlowTypeDescriptor[];
}

export async function loadIsibotFlowTypeDescriptors(
  userRoles?: string[],
): Promise<IsibotFlowTypeDescriptor[]> {
  // Dynamic import matches the pattern used by other hook-loader
  // consumers (`mediaUrl.ts`, `defaultLandingService.ts`) so Vite can
  // keep `@/plugins/loader` in a separate code-split chunk.
  const { getPluginHooks } = await import('@/plugins/loader');
  const hooks = getPluginHooks(ISIBOT_FLOW_TYPES_HOOK, userRoles) as Array<
    Pick<PluginHookContribution<IsibotFlowTypesHookContext>, 'order' | 'handler'>
  >;
  const sorted = sortDescriptors(hooks);

  const descriptors: IsibotFlowTypeDescriptor[] = [];
  for (const hook of sorted) {
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
