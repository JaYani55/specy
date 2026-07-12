/**
 * Admin Connection Hooks
 *
 * Provides hook targets and collectors for plugins to contribute settings
 * sections to the /admin/connections page.
 *
 * Hook target: admin.connections.sections
 *   - scope: api
 *   - kind: transform
 *   - context: AdminConnectionsSectionContext
 *
 * EUPL note: the core provides only the hook mechanism. Plugin sections
 * are rendered by the frontend via PluginDefinition.adminSections.
 * The backend hook is used for runtime metadata and access control.
 */

import { getRegisteredApiPluginHooks } from '../plugin-hooks';
import type { PluginHookContribution } from '../../../src/types/plugin';

// ─── Hook Target ─────────────────────────────────────────────────────────────

/** Hook target for plugins to declare admin connection sections. */
export const ADMIN_CONNECTIONS_SECTIONS_HOOK = 'admin.connections.sections';

// ─── Context ─────────────────────────────────────────────────────────────────

export interface AdminConnectionsSectionDescriptor {
  /** Plugin ID that owns this section. */
  pluginId: string;
  /** Section identifier (matches PluginAdminConnectionSection.id). */
  sectionId: string;
  /** Whether the section should be visible. */
  visible: boolean;
  /** Display order (lower = earlier). */
  order: number;
}

export interface AdminConnectionsSectionContext {
  /** Accumulated section descriptors. */
  sections: AdminConnectionsSectionDescriptor[];
}

// ─── Collector ───────────────────────────────────────────────────────────────

/**
 * Collect admin connection section descriptors from all registered hooks.
 *
 * Iterates sorted hooks targeting `admin.connections.sections`, passing
 * the context through each handler. The final accumulated sections array
 * is returned.
 *
 * @param context - Initial context with sections array
 * @returns Updated context after all hooks have run
 */
export async function collectAdminConnectionSections(
  context: AdminConnectionsSectionContext,
): Promise<AdminConnectionsSectionContext> {
  const hooks = getRegisteredApiPluginHooks()
    .filter((h) => h.target === ADMIN_CONNECTIONS_SECTIONS_HOOK)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  let current = context;
  for (const hook of hooks) {
    try {
      current = await hook.handler(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[adminConnectionHooks] Hook "${hook.key}" failed: ${message}`);
    }
  }

  return current;
}