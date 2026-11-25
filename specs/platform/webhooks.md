# Outbound Webhooks (Event Subscriptions & Delivery Queue)

> **Status:** Implemented (2026-11-25) · **Contract owner:** `api/routes/webhooks.ts`,
> `api/lib/webhookEvents.ts` (pure), `api/lib/webhookEmission.ts` (Worker-side),
> `migrations/202611250001_webhook_subscriptions.sql`, `functions/deliver_webhooks/`
> **Related:** [`../auth/api-tokens.md`](../auth/api-tokens.md) ·
> [`email-delivery-queue.md`](email-delivery-queue.md) ·
> [`../plans/n8n-nodes-specy-connector-plan.md`](../plans/n8n-nodes-specy-connector-plan.md)

## 1. Purpose

Tenant-scoped outbound webhooks let automations (n8n, Zapier, custom consumers) react to
Specy events without polling. A subscription registers an HTTPS URL and the event types it
wants; whenever such an event occurs, the Worker enqueues one delivery job per subscribed
webhook and the `deliver_webhooks` edge function pushes signed HTTP POSTs.

**RBAC:** all write operations (create/toggle/delete) require `support` or `super-admin`
  (mirrored by the API via `requireAnyJwtRole` and the dashboard via `canManageWebhooks`);
  viewing is RLS-scoped per workspace — tenant members see their own, support/super-admin
  see all.

**Event surface (initial):** `object.created`, `object.updated`, `object.archived` —
Objects carry `tenant_id`, which scopes subscriptions and delivery. Form answers and page
publications are future event types (forms currently have no tenant column).

## 2. Delivery architecture (mail-queue pattern)

```
[ objects.ts route handlers ]
    │ emitWebhookEvent() — fire-and-forget, never throws
    ▼
[ webhook_delivery_jobs row (status: pending) ]
    │ every minute: pg_cron → net.http_post → deliver_webhooks edge function
    ▼
[ sign HMAC-SHA256 + POST to subscriber URL ]
    │ 2xx                    │ non-2xx / network error
    ▼                        ▼
[ delivered ]      [ requeued: pending, next_attempt_at = now + backoff ]
                             │ (60s → 120s → terminal failed after 3 attempts)
                             ▼
                     [ failed — kept in DB, never deleted ]
```

- Retry contract is identical to the mail queue: base 60 s, exponential ×2, hard cap
  900 s, terminal `failed` after 3 attempts; provider `Retry-After` honored.
- `deliver_webhooks` reuses the same function secrets as `send_email`
  (`SUPABASE_URL`, `APP_SUPABASE_SECRET_KEY`, `SECRETS_ENCRYPTION_KEY`) and decrypts
  per-subscription signing secrets from `managed_secrets` (namespace `webhooks`,
  name `WEBHOOK_SIGNING_SECRET_<id>`).
- The cron reads `system_config` (`webhooks.edge_function_url`, optional
  `webhooks.edge_function_key`) and self-hosted installs without pg_cron/pg_net keep
  working — jobs are retried on manual dispatch only.
- Dispatched jobs whose subscription was deleted/disabled become terminal `failed`.

## 3. Payload & signature contract

```json
{
  "event": "object.created",
  "tenant_id": "…",
  "occurred_at": "2026-11-25T12:00:00.000Z",
  "data": { "id": "…", "name": "…", "slug": "…", "object_type": "json" }
}
```

Signature headers on every delivery:

| Header | Value |
|---|---|
| `X-Specy-Event` | Event type (e.g. `object.updated`) |
| `X-Specy-Delivery` | Delivery job UUID (idempotency key) |
| `X-Specy-Signature` | `sha256=<hex HMAC-SHA256 of the raw body, keyed by the subscription signing secret>` |

Subscribers verify the signature with their stored secret (shown exactly once at
subscription creation — same contract as PATs).

## 4. REST contract

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /api/webhooks` | `user` role, RLS-scoped | List workspace subscriptions for the caller (tenant members: own workspace; support/super-admin: all). Metadata only — secrets never returned |
| `POST /api/webhooks` | **`support` or `super-admin` only** (cross-tenant: any workspace) | Create subscription: `name`, `url` (validated via `urlSafety.validateOutboundHttpUrl`), `events` (subset of §1), `tenant_id`. Returns `signing_secret` **exactly once** |
| `PATCH /api/webhooks/:id` | **`support` or `super-admin`**, RLS-scoped | Toggle `active`, update `events` |
| `DELETE /api/webhooks/:id` | **`support` or `super-admin`**, RLS-scoped | Delete subscription (delivery jobs cascade; signing secret cleaned up) |
| `GET /api/webhooks/jobs` | `user` role, RLS-scoped | Delivery log (Verlauf), newest first, `limit` 1–200 |

## 5. Setup / release notes

- `first-time-setup` writes `webhooks.edge_function_url` into `system_config` and deploys
  `deliver_webhooks` alongside `send_email` (registered in `CORE_EDGE_FUNCTIONS`).
- Existing deployments: apply the migration, deploy the function, and set
  `system_config.webhooks.edge_function_url = <supabase-url>/functions/v1/deliver_webhooks`.
- **Admin dashboard UI is implemented** (2026-11-25): `/admin/webhooks` (`VerwaltungWebhooks`),
  visible to Verwaltung users; creation/toggle/delete gated by
  `usePermissions.canManageWebhooks` (support or super-admin). Workspace selection for
  support agents is RLS-driven (`getVisibleTenants` — cross-tenant); normal users see only
  their own workspace (read-only). Creation shows the signing secret exactly once.
