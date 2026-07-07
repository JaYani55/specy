import { Hono } from 'hono';
import { requireAuthSession } from '../lib/auth';
import type { Env } from '../lib/supabase';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';

const knowledgeBase = new Hono<{ Bindings: Env }>();

knowledgeBase.post('/sync', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json().catch(() => null) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { sourceTable, sourceRecordId, tenantId } = body as {
    sourceTable?: string;
    sourceRecordId?: string;
    tenantId?: string;
  };

  if (!sourceTable || !sourceRecordId) {
    return c.json({ error: 'sourceTable and sourceRecordId are required.' }, 400);
  }

  // Trigger KB sync invoke hooks
  const hooks = getRegisteredApiPluginHooks().filter((hook) => hook.target === 'knowledgeBase.sync.invoke');
  const sorted = [...hooks].sort((left, right) => (left.order ?? 100) - (right.order ?? 100));

  const hookContext = {
    env: c.env,
    auth,
    sourceTable,
    sourceRecordId,
    tenantId: tenantId ?? null,
    handled: false,
    result: null as any,
    error: null as string | null,
  };

  for (const hook of sorted) {
    try {
      const res = await hook.handler(hookContext) as typeof hookContext;
      if (res && res.handled) {
        if (res.error) {
          return c.json({ error: res.error }, 400);
        }
        return c.json({ success: true, result: res.result });
      }
    } catch (err) {
      console.error(`Knowledge base sync hook error for key ${hook.key}:`, err);
      return c.json({ error: err instanceof Error ? err.message : 'Sync hook error.' }, 500);
    }
  }

  return c.json({ error: 'Knowledge base sync is not active or pluradash plugin is disabled.' }, 501);
});

export default knowledgeBase;
