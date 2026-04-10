import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import type { Env } from '../lib/supabase';
import { getStorageConfig, upsertStorageConfig } from '../lib/systemConfig';

const config = new Hono<{ Bindings: Env }>();

config.get('/storage', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const storage = await getStorageConfig(c.env);
  return c.json({ storage });
});

config.put('/storage', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: { provider: 'supabase' | 'r2' | ''; bucket: string; r2PublicUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.provider || !body.bucket?.trim()) {
    return c.json({ error: 'Missing required fields: provider, bucket' }, 400);
  }

  if (body.provider !== 'supabase' && body.provider !== 'r2') {
    return c.json({ error: 'Provider must be "supabase" or "r2"' }, 400);
  }

  await upsertStorageConfig(c.env, {
    provider: body.provider,
    bucket: body.bucket.trim(),
    r2PublicUrl: body.r2PublicUrl?.trim() ?? '',
  });

  return c.json({ success: true });
});

export default config;