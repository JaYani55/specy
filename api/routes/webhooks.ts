import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { requireAnyJwtRole, requireAppRole } from '../lib/auth';
import { validateOutboundHttpUrl } from '../lib/urlSafety';
import {
  WEBHOOK_EVENT_TYPES,
  isWebhookEventType,
} from '../lib/webhookEvents';

/**
 * Outbound webhook subscriptions (specs/platform/webhooks.md).
 *
 * Viewing is RLS-scoped per workspace (multi-tenancy); all write operations
 * are restricted to support agents and super-admins (RBAC, mirrored in the
 * dashboard via usePermissions.canManageWebhooks). Secrets are AES-GCM
 * encrypted in managed_secrets (namespace 'webhooks') and returned exactly
 * once at creation — same contract as PATs.
 */

const SUBSCRIPTION_COLUMNS = 'id, tenant_id, name, url, events, active, created_at, updated_at';

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

function buildSigningSecretName(subscriptionId: string): string {
  return `WEBHOOK_SIGNING_SECRET_${subscriptionId.replace(/-/g, '').toUpperCase()}`;
}

const webhooks = new Hono<{ Bindings: Env }>();

// GET /api/webhooks — list the caller's tenant subscriptions (RLS-scoped)
webhooks.get('/', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    return c.json({ error: 'Failed to load webhook subscriptions.' }, 500);
  }
  return c.json({ subscriptions: data ?? [] });
});

// POST /api/webhooks — create a subscription (secret returned once).
// Creation is restricted to support agents and super-admins (RBAC:
// 'support' has cross-tenant visibility; the dashboard mirrors this).
webhooks.post('/', async (c) => {
  const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { name, url, events, tenant_id, active } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return c.json({ error: 'name is required.' }, 400);
  }
  if (typeof tenant_id !== 'string' || !tenant_id.trim()) {
    return c.json({ error: 'tenant_id is required.' }, 400);
  }
  if (typeof url !== 'string' || !url.trim()) {
    return c.json({ error: 'url is required.' }, 400);
  }
  const urlCheck = validateOutboundHttpUrl(url.trim());
  if (!urlCheck.ok) {
    return c.json({ error: urlCheck.error }, 400);
  }
  if (!Array.isArray(events) || events.length === 0 || !events.every(isWebhookEventType)) {
    return c.json({ error: `events must be a non-empty subset of: ${WEBHOOK_EVENT_TYPES.join(', ')}` }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);

  // Support/super-admin administer webhooks for any workspace (cross-tenant
  // visibility); other roles never reach this endpoint (RBAC above).
  const isCrossTenantAdmin = auth.roles.includes('support') || auth.roles.includes('super-admin');
  if (!isCrossTenantAdmin) {
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('tenant_id', tenant_id.trim())
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      return c.json({ error: 'You are not a member of this workspace.' }, 403);
    }
  }

  const { data: created, error } = await supabase
    .from('webhook_subscriptions')
    .insert({
      tenant_id: tenant_id.trim(),
      name: name.trim(),
      url: urlCheck.url.toString(),
      events,
      active: active === false ? false : true,
    })
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  if (error) {
    return c.json({ error: 'Failed to create webhook subscription.' }, 500);
  }

  // Per-subscription HMAC signing secret — returned exactly once.
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  const { upsertManagedSecret } = await import('../lib/managedSecrets');
  try {
    await upsertManagedSecret(c.env, {
      name: buildSigningSecretName((created as SubscriptionRow).id),
      namespace: 'webhooks',
      value: secret,
    });
  } catch {
    // Roll back the row so no active subscription exists without a secret.
    await supabase.from('webhook_subscriptions').delete().eq('id', (created as SubscriptionRow).id);
    return c.json({ error: 'Failed to store webhook signing secret.' }, 500);
  }

  return c.json({ ...(created as SubscriptionRow), signing_secret: secret }, 201);
});

// PATCH /api/webhooks/:id — toggle active / update events (support/super-admin only)
webhooks.patch('/:id', async (c) => {
  const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0 || !body.events.every(isWebhookEventType)) {
      return c.json({ error: `events must be a non-empty subset of: ${WEBHOOK_EVENT_TYPES.join(', ')}` }, 400);
    }
    patch.events = body.events;
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No valid fields to update.' }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: updated, error } = await supabase
    .from('webhook_subscriptions')
    .update(patch)
    .eq('id', c.req.param('id'))
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  if (error || !updated) {
    return c.json({ error: 'Failed to update webhook subscription.' }, 500);
  }
  return c.json(updated);
});

// DELETE /api/webhooks/:id — remove subscription (support/super-admin only; jobs cascade)
webhooks.delete('/:id', async (c) => {
  const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: deleted, error } = await supabase
    .from('webhook_subscriptions')
    .delete()
    .eq('id', id)
    .select('id')
    .single();

  if (error || !deleted) {
    return c.json({ error: 'Failed to delete webhook subscription.' }, 500);
  }

  // Best-effort secret cleanup.
  try {
    const { deleteManagedSecret } = await import('../lib/managedSecrets');
    await deleteManagedSecret(c.env, buildSigningSecretName(id));
  } catch (e) {
    console.error('webhook-secret-cleanup', e instanceof Error ? e.message : String(e));
  }
  return c.json({ ok: true });
});

// GET /api/webhooks/jobs — delivery log (Verlauf), RLS-scoped
webhooks.get('/jobs', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('webhook_delivery_jobs')
    .select('id, subscription_id, event, status, attempts, max_attempts, next_attempt_at, last_response_status, last_error, delivered_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return c.json({ error: 'Failed to load webhook delivery jobs.' }, 500);
  }
  return c.json({ jobs: data ?? [] });
});

export default webhooks;
