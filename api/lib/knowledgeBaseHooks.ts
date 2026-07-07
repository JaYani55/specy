import type { PluginHookContribution } from '../../src/types/plugin';
import type { VerifiedAuthSession } from './auth';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';

export interface KnowledgeBaseSyncSourceDescriptor {
  key: string;
  entityType: string;
  description?: string;
  pathPattern: string;
}

export interface KnowledgeBasePromptSection {
  key: string;
  title: string;
  content: string;
}

export interface KnowledgeBaseSettingsSection {
  key: string;
  title: string;
  description?: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'boolean' | 'text' | 'number';
    defaultValue: unknown;
  }>;
}

export interface KnowledgeBaseSyncSourcesHookContext {
  auth: VerifiedAuthSession;
  tenantId: string;
  sources: KnowledgeBaseSyncSourceDescriptor[];
}

export interface KnowledgeBasePromptContextHookContext {
  auth: VerifiedAuthSession;
  tenantId: string;
  sections: KnowledgeBasePromptSection[];
}

export interface KnowledgeBaseSettingsHookContext {
  auth: VerifiedAuthSession;
  tenantId: string;
  sections: KnowledgeBaseSettingsSection[];
  defaults: Record<string, unknown>;
}

export interface KnowledgeBaseVisibilityHookContext {
  auth: VerifiedAuthSession;
  tenantId: string;
  visible: boolean;
}

export interface KnowledgeBaseSyncInvokeHookContext {
  auth: VerifiedAuthSession;
  sourceTable: string;
  sourceRecordId: string;
  tenantId?: string | null;
  handled: boolean;
  result?: any;
  error?: string | null;
}

export interface KnowledgeBaseEntityAction {
  key: string;
  label: string;
  icon?: string;
  onInvoke: () => Promise<void>;
}

export interface KnowledgeBaseEntityActionsHookContext {
  entityType: 'page' | 'form' | 'object' | 'event';
  entityId: string;
  tenantId?: string | null;
  userRoles: string[];
  actions: KnowledgeBaseEntityAction[];
}

export interface KnowledgeBaseAfterCreateHookContext {
  entityType: 'page' | 'form' | 'object' | 'event';
  entityId: string;
  tenantId?: string | null;
}

export const KNOWLEDGE_BASE_SYNC_SOURCES_HOOK = 'knowledgeBase.sync.sources';
export const KNOWLEDGE_BASE_PROMPT_CONTEXT_HOOK = 'knowledgeBase.prompt.context';
export const KNOWLEDGE_BASE_SETTINGS_HOOK = 'knowledgeBase.settings.sections';
export const KNOWLEDGE_BASE_VISIBILITY_HOOK = 'knowledgeBase.settings.visibility';
export const KNOWLEDGE_BASE_SYNC_INVOKE_HOOK = 'knowledgeBase.sync.invoke';
export const KNOWLEDGE_BASE_ENTITY_ACTIONS_HOOK = 'knowledgeBase.entity.actions';
export const KNOWLEDGE_BASE_AFTER_CREATE_HOOK = 'knowledgeBase.entity.afterCreate';

const DEFAULT_HOOK_ORDER = 100;

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

function getApiPluginHooks(target: string): PluginHookContribution[] {
  return getRegisteredApiPluginHooks().filter((hook) => hook.target === target);
}

export async function collectKnowledgeBaseSyncSources(
  context: KnowledgeBaseSyncSourcesHookContext,
): Promise<KnowledgeBaseSyncSourceDescriptor[]> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(KNOWLEDGE_BASE_SYNC_SOURCES_HOOK))) {
    nextContext = await hook.handler(nextContext) as KnowledgeBaseSyncSourcesHookContext;
  }

  return nextContext.sources;
}

export async function collectKnowledgeBasePromptSections(
  context: KnowledgeBasePromptContextHookContext,
): Promise<KnowledgeBasePromptSection[]> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(KNOWLEDGE_BASE_PROMPT_CONTEXT_HOOK))) {
    nextContext = await hook.handler(nextContext) as KnowledgeBasePromptContextHookContext;
  }

  return nextContext.sections;
}

export async function collectKnowledgeBaseSettings(
  context: KnowledgeBaseSettingsHookContext,
): Promise<KnowledgeBaseSettingsHookContext> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(KNOWLEDGE_BASE_SETTINGS_HOOK))) {
    nextContext = await hook.handler(nextContext) as KnowledgeBaseSettingsHookContext;
  }

  return nextContext;
}

export async function checkKnowledgeBaseVisibility(
  context: KnowledgeBaseVisibilityHookContext,
): Promise<boolean> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(KNOWLEDGE_BASE_VISIBILITY_HOOK))) {
    nextContext = await hook.handler(nextContext) as KnowledgeBaseVisibilityHookContext;
  }

  return nextContext.visible;
}