import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';

const logs = new Hono<{ Bindings: Env }>();

interface IpAddressRow {
  ip_address: string | null;
}

// GET /api/schemas/logs — List log entries (paginated, filterable)
logs.get('/', async (c) => {
  const supabase = await createSupabaseClient(c.env);

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const schemaSlug = c.req.query('schema_slug') || null;
  const method = c.req.query('method') || null;
  const minStatus = c.req.query('min_status') ? parseInt(c.req.query('min_status')!, 10) : null;
  const from = c.req.query('from') || null; // ISO date
  const to = c.req.query('to') || null;

  let query = supabase
    .from('agent_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (schemaSlug) query = query.eq('schema_slug', schemaSlug);
  if (method) query = query.eq('method', method.toUpperCase());
  if (minStatus) query = query.gte('status_code', minStatus);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query;

  if (error) {
    return c.json({ error: 'Failed to fetch logs', detail: error.message }, 500);
  }

  return c.json({
    logs: data ?? [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limit),
    },
  });
});

// GET /api/schemas/logs/stats — Aggregate stats for dashboard
logs.get('/stats', async (c) => {
  const supabase = await createSupabaseClient(c.env);

  // Total logs
  const { count: total } = await supabase
    .from('agent_logs')
    .select('*', { count: 'exact', head: true });

  // Logs in last 24h
  const since24h = new Date(Date.now() - 86400_000).toISOString();
  const { count: last24h } = await supabase
    .from('agent_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since24h);

  // Errors (status >= 400)
  const { count: errors } = await supabase
    .from('agent_logs')
    .select('*', { count: 'exact', head: true })
    .gte('status_code', 400);

  // Unique IPs
  const { data: ipData } = await supabase
    .from('agent_logs')
    .select('ip_address')
    .not('ip_address', 'is', null);

  const uniqueIps = new Set(
    ((ipData ?? []) as IpAddressRow[])
      .map((row) => row.ip_address)
      .filter((ip): ip is string => Boolean(ip))
  ).size;

  return c.json({
    total: total ?? 0,
    last_24h: last24h ?? 0,
    errors: errors ?? 0,
    unique_agents: uniqueIps,
  });
});

// GET /api/schemas/logs/download — Download logs as JSON file
logs.get('/download', async (c) => {
  const supabase = await createSupabaseClient(c.env);
  const schemaSlug = c.req.query('schema_slug') || null;
  const from = c.req.query('from') || null;
  const to = c.req.query('to') || null;

  let query = supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (schemaSlug) query = query.eq('schema_slug', schemaSlug);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;

  if (error) {
    return c.json({ error: 'Failed to export logs' }, 500);
  }

  const filename = `agent-logs-${new Date().toISOString().split('T')[0]}.json`;

  return new Response(JSON.stringify(data ?? [], null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// DELETE /api/schemas/logs — Clear all logs (or by filter)
logs.delete('/', async (c) => {
  const supabase = await createSupabaseClient(c.env);
  const schemaSlug = c.req.query('schema_slug') || null;
  const before = c.req.query('before') || null; // ISO date — delete logs older than this

  let query = supabase.from('agent_logs').delete();

  if (schemaSlug) {
    query = query.eq('schema_slug', schemaSlug);
  } else if (before) {
    query = query.lte('created_at', before);
  } else {
    // Delete all — require explicit confirmation via query param
    const confirm = c.req.query('confirm');
    if (confirm !== 'true') {
      return c.json({ error: 'Add ?confirm=true to delete all logs' }, 400);
    }
    query = query.neq('id', '00000000-0000-0000-0000-000000000000'); // match all
  }

  const { error } = await query;

  if (error) {
    return c.json({ error: 'Failed to delete logs', detail: error.message }, 500);
  }

  return c.json({ success: true, message: 'Logs deleted' });
});

// DELETE /api/schemas/logs/:id — Delete a single log entry
logs.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = await createSupabaseClient(c.env);

  const { error } = await supabase
    .from('agent_logs')
    .delete()
    .eq('id', id);

  if (error) {
    return c.json({ error: 'Failed to delete log entry' }, 500);
  }

  return c.json({ success: true });
});

export default logs;
