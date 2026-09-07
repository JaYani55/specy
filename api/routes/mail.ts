import { Hono, type Context } from 'hono';
import { parseBearerToken, requireAppRole } from '../lib/auth';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from '../lib/supabase';

const mail = new Hono<{ Bindings: Env }>();

const VALID_STATUSES = new Set(['pending', 'processing', 'sent', 'failed']);

interface MailDeliveryJobRow {
  id: string;
  event_type: string;
  provider: string | null;
  status: string;
  form_id: string | null;
  answer_id: string | null;
  recipient_email: string;
  subject: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  mail_delivery_events?: MailDeliveryEventRow[];
}

interface MailDeliveryEventRow {
  id: number;
  event_type: string;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── GET /api/mail/jobs ──────────────────────────────────────────────────────
// Tenant-scoped mail delivery log. RLS on mail_delivery_jobs restricts rows to
// jobs whose owning form is accessible to the caller (can_access_owned_row) or
// to global admin/super-admin roles — the route therefore reads through the
// user's own JWT so every tenant only ever sees its own mail events.

mail.get('/jobs', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, parseBearerToken(c.req.header('Authorization')) ?? undefined);

  const statusParam = c.req.query('status');
  const formIdParam = c.req.query('form_id');
  const limitParam = Number.parseInt(c.req.query('limit') ?? '100', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return c.json({ error: `Invalid status filter "${statusParam}".` }, 400);
  }

  let query = supabase
    .from('mail_delivery_jobs')
    .select('*, mail_delivery_events(*)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (statusParam) {
    query = query.eq('status', statusParam);
  }
  if (formIdParam) {
    query = query.eq('form_id', formIdParam);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const jobs = ((data ?? []) as MailDeliveryJobRow[]).map((job) => ({
    ...job,
    mail_delivery_events: (job.mail_delivery_events ?? [])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  }));

  return c.json({ jobs });
});

async function getVisibleJob(
  c: Context<{ Bindings: Env }>,
  jobId: string,
): Promise<{ id: string; status: string } | null> {
  const scoped = await createSupabaseClient(c.env, parseBearerToken(c.req.header('Authorization')) ?? undefined);
  const { data, error } = await scoped
    .from('mail_delivery_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as { id: string; status: string } | null) ?? null;
}

// ── POST /api/mail/jobs/:id/retry ───────────────────────────────────────────
// Manual re-dispatch of a terminal `failed` job. The route first verifies the
// caller can see the job (RLS-enforced tenant scoping via the user JWT) and
// then resets it for delivery through the privileged admin client. The job is
// never deleted — a failed re-dispatch is requeued by the edge function as
// usual (max 3 attempts, exponential backoff, terminal failed afterwards).

mail.post('/jobs/:id/retry', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const jobId = c.req.param('id');

  // Tenant-scope check: if the caller cannot read the job through RLS, it does
  // not belong to their tenant — respond with 404 to avoid existence leaks.
  const visible = await getVisibleJob(c, jobId);
  if (!visible) {
    return c.json({ error: 'Mail job not found.' }, 404);
  }
  if (visible.status === 'processing') {
    return c.json({ error: 'Job is currently being delivered. Please wait for the attempt to finish.' }, 409);
  }

  const admin = await createSupabaseAdminClient(c.env);

  const { error: resetError } = await admin
    .from('mail_delivery_jobs')
    .update({
      status: 'pending',
      attempt_count: 0,
      last_error: null,
      next_attempt_at: null,
      last_attempt_at: null,
    })
    .eq('id', jobId);

  if (resetError) {
    return c.json({ error: resetError.message }, 500);
  }

  const { error: eventError } = await admin
    .from('mail_delivery_events')
    .insert({
      job_id: jobId,
      event_type: 'requeued',
      message: 'Manuell erneut zum Versand vorgemerkt — Job zurueck in die Warteschlange.',
      metadata: { retriedBy: auth.userId, manual: true },
    });

  if (eventError) {
    return c.json({ error: eventError.message }, 500);
  }

  // Immediate re-delivery attempt; failures fall back to the cron queue.
  const result = await admin.functions.invoke('send_email', {
    body: { mode: 'deliver-job', jobId },
  });

  if (result.error) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    console.error(`Failed to invoke send_email for retry of job ${jobId}: ${detail}`);
    return c.json({
      success: true,
      requeued: true,
      instantDelivery: false,
      message: 'Job wurde erneut in die Warteschlange gestellt. Die Zustellung erfolgt ueber den Warteschlangen-Prozessor.',
    });
  }

  const payload = (result.data ?? {}) as Record<string, unknown>;

  return c.json({
    success: true,
    sent: payload.sent === true,
    requeued: payload.requeued === true,
    terminalFailed: payload.terminalFailed === true,
    instantDelivery: true,
    rateLimited: payload.rateLimited === true,
    nextAttemptAt: typeof payload.nextAttemptAt === 'string' ? payload.nextAttemptAt : null,
    error: typeof payload.error === 'string' ? payload.error : null,
  });
});

// ── DELETE /api/mail/jobs/:id ────────────────────────────────────────────
// Deletes a single mail delivery job (event history cascades). The tenant
// visibility check runs through the caller's JWT (RLS); the actual delete
// uses the privileged admin client. Jobs currently in delivery are rejected.

mail.delete('/jobs/:id', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const jobId = c.req.param('id');

  const visible = await getVisibleJob(c, jobId);
  if (!visible) {
    return c.json({ error: 'Mail job not found.' }, 404);
  }
  if (visible.status === 'processing') {
    return c.json({ error: 'Job is currently being delivered and cannot be deleted right now.' }, 409);
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error: deleteError } = await admin
    .from('mail_delivery_jobs')
    .delete()
    .eq('id', jobId);

  if (deleteError) {
    return c.json({ error: deleteError.message }, 500);
  }

  return c.json({ success: true, deleted: 1 });
});

// ── DELETE /api/mail/jobs ────────────────────────────────────────────────
// Clear-all: deletes every mail delivery job visible to the caller's tenant
// (optionally filtered by status, e.g. ?status=failed). Visibility is
// resolved through the caller's JWT (RLS); the delete runs with the admin
// client. Event history cascades with each job row.

mail.delete('/jobs', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const statusParam = c.req.query('status');
  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return c.json({ error: `Invalid status filter "${statusParam}".` }, 400);
  }

  const scoped = await createSupabaseClient(c.env, parseBearerToken(c.req.header('Authorization')) ?? undefined);

  let visibleQuery = scoped
    .from('mail_delivery_jobs')
    .select('id, status')
    .neq('status', 'processing')
    .limit(1000);

  if (statusParam) {
    visibleQuery = visibleQuery.eq('status', statusParam);
  }

  const { data: visibleJobs, error: visibleError } = await visibleQuery;

  if (visibleError) {
    return c.json({ error: visibleError.message }, 500);
  }

  const ids = ((visibleJobs ?? []) as Array<{ id: string }>).map((job) => job.id);
  if (ids.length === 0) {
    return c.json({ success: true, deleted: 0 });
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error: deleteError, count } = await admin
    .from('mail_delivery_jobs')
    .delete({ count: 'exact' })
    .in('id', ids);

  if (deleteError) {
    return c.json({ error: deleteError.message }, 500);
  }

  return c.json({ success: true, deleted: count ?? ids.length });
});

export default mail;
