import { getPluginHooks } from '@/plugins/loader';
import { fetchPlugins } from '@/services/pluginService';
import type { PluginHookContribution } from '@/types/plugin';

export interface FormFileUploadBuilderContext {
  tenantId: string | null;
  userRoles: string[];
  language: 'en' | 'de';
  enabledPluginSlugs: string[];
  available: boolean;
  providerLabel: string | null;
  warning: string | null;
  uploadProvider: string | null;
  uploadFolderTemplate: string;
}

export const FORM_FILE_UPLOAD_BUILDER_HOOK = 'forms.fileUpload.builder';

const DEFAULT_HOOK_ORDER = 100;
const DEFAULT_UPLOAD_FOLDER_TEMPLATE = 'forms/{form_slug}/{field_name}/{submission_id}';

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

async function getEnabledPluginSlugs(tenantId: string | null): Promise<string[]> {
  const plugins = await fetchPlugins();

  return plugins
    .filter((plugin) => plugin.status === 'enabled')
    .filter((plugin) => plugin.tenant_id === null || plugin.tenant_id === tenantId)
    .map((plugin) => plugin.slug);
}

export async function resolveFormFileUploadBuilderContext(input: {
  tenantId: string | null;
  userRoles: string[];
  language: 'en' | 'de';
}): Promise<FormFileUploadBuilderContext> {
  const enabledPluginSlugs = await getEnabledPluginSlugs(input.tenantId);
  let context: FormFileUploadBuilderContext = {
    tenantId: input.tenantId,
    userRoles: input.userRoles,
    language: input.language,
    enabledPluginSlugs,
    available: false,
    providerLabel: null,
    warning: null,
    uploadProvider: null,
    uploadFolderTemplate: DEFAULT_UPLOAD_FOLDER_TEMPLATE,
  };

  const hooks = sortHooks(
    getPluginHooks(FORM_FILE_UPLOAD_BUILDER_HOOK, input.userRoles) as Array<Pick<PluginHookContribution<FormFileUploadBuilderContext>, 'order' | 'handler'>>,
  );

  for (const hook of hooks) {
    context = await hook.handler(context) as FormFileUploadBuilderContext;
  }

  return context;
}