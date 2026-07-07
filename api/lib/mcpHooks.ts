import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PluginHookContribution } from '../../src/types/plugin';
import type { VerifiedAuthSession } from './auth';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';
import type { Env } from './supabase';

export const MCP_TOOLS_HOOK = 'mcp.tools';

export interface McpToolsHookContext {
  env: Env;
  server: McpServer;
  baseUrl: string;
  auth: VerifiedAuthSession | null;
  includeClosed: boolean;
  registeredToolNames: Set<string>;
}

const DEFAULT_HOOK_ORDER = 100;

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

function getApiPluginHooks(target: string): PluginHookContribution[] {
  return getRegisteredApiPluginHooks().filter((hook) => hook.target === target);
}

export async function registerPluginMcpTools(context: McpToolsHookContext): Promise<McpToolsHookContext> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(MCP_TOOLS_HOOK))) {
    nextContext = await hook.handler(nextContext) as McpToolsHookContext;
  }

  return nextContext;
}