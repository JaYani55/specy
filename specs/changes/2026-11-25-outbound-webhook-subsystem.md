# 2026-11-25 — Outbound Webhook Subsystem

## Summary

Tenant-scoped outbound webhooks: tenants can register subscriptions (HTTPS URL + event
types + per-subscription HMAC signing secret) and receive signed HTTP POSTs when subscribed
events occur. Initial event surface is object-scoped (`object.created`, `object.updated`,
`object.archived`) because objects are the tenant-carrying content entity. Delivery reuses
the proven mail-queue pattern: DB-backed `webhook_delivery_jobs` processed every minute by
the new `deliver_webhooks` edge function via pg_cron, with the same retry contract
(60 s → 120 s backoff, terminal `failed` after 3 attempts, rows never deleted).

## Files Added

- `migrations/202611250001_webhook_subscriptions.sql` — subscriptions + delivery jobs tables, RLS, cron schedule (idempotent)
- `api/lib/webhookEvents.ts` — pure event types, subscription matching, payload envelope (unit-tested)
- `api/lib/webhookEmission.ts` — Worker-side fire-and-forget emission
- `api/routes/webhooks.ts` — `/api/webhooks` CRUD + delivery log
- `functions/deliver_webhooks/{index.ts,retryPolicy.ts,deno.json}` — delivery edge function (HMAC-SHA256 signing, managed-secret decryption)
- `tests/webhookRetryPolicy.test.mjs`, `tests/webhookEvents.test.mjs`
- `specs/platform/webhooks.md` — authoritative contract
- `src/services/webhookService.ts` — dashboard service layer (REST client)
- `src/pages/VerwaltungWebhooks.tsx` — admin dashboard page (`/admin/webhooks`)
- `src/hooks/usePermissions.tsx` — `canManageWebhooks` permission (support/super-admin)

## Files Changed

- `api/index.ts` — mounted `/api/webhooks`
- `api/routes/webhooks.ts` — write operations (POST/PATCH/DELETE) restricted to
  `support`/`super-admin` via `requireAnyJwtRole`; cross-tenant administration for
  support agents; viewing remains RLS-scoped per workspace (multi-tenancy)
- `src/App.tsx`, `src/components/layout/AppSidebar.tsx` — `/admin/webhooks` route + sidebar entry
- `migrations/202611250001_webhook_subscriptions.sql` — RLS switched to the canonical
  `is_super_admin()`/`is_support()`/`is_tenant_member()` helper pattern (support has
  cross-tenant visibility)
- `api/routes/objects.ts` — event emission after create/update/archive; list endpoint gains optional `updated_since`, `limit`+`offset` (with `total` when paginated; legacy shape unchanged otherwise)
- `scripts/lib/migration-order.mjs` — registered new migration (last position)
- `scripts/lib/core-update.mjs` — `deliver_webhooks` added to `CORE_EDGE_FUNCTIONS`
- `scripts/lib/first-time-setup.mjs` — webhook cron config (`system_config` `webhooks.edge_function_url`)
- `specs/platform/README.md`, `specs/plans/n8n-nodes-specy-connector-plan.md` — registered/delivered markers

## Follow-up Fixes (same day)

- **Migration FK duplicates:** the initial migration declared the tenant/subscription
  foreign keys twice (inline auto-named + explicit named constraint) — every run failed
  with `42710 constraint already exists`. Removed all inline `references` clauses; the
  named constraints are the sole FK definitions (idempotent, verified by re-run).
- **Fresh-install function deploy:** first-time-setup now deploys `deliver_webhooks`
  (own staged workdir) right after `send_email` — previously the function was only
  deployed by the update flow, leaving fresh installs with a cron but no function.
- **Non-interactive deploys:** all three `supabase functions deploy` call sites
  (`core-update.mjs`, first-time-setup ×2) pass `--yes` — the CLI v3 requires
  confirmation when stdout is not a terminal.
- **Lint integrity gate:** `plugins/n8n-nodes-specy` (satellite repo incl. its compiled
  `dist/`) excluded from the core ESLint config — the connector is a separate work and
  is not governed by core lint rules.
- **Objects list filters** (same change set): `updated_since` + `limit`/`offset` with
  `total` — see `api/routes/objects.ts`.

## Impact Analysis

- **Database:** two new tables (tenant FKs, RLS member + super-admin policies), one pg_cron
  schedule gated on extension availability. Idempotent; no changes to existing tables.
- **Runtime:** object create/update/archive now perform one extra read + conditional insert
  (fire-and-forget; emission failures never fail the request). Edge function batch size 10–50.
- **API surface:** new `/api/webhooks` endpoints (authenticated; writes RBAC-restricted to support/super-admin); `GET /api/objects` gains
  optional query params — fully backwards compatible (absent params = previous behavior).
- **Security:** subscriber URLs validated via `validateOutboundHttpUrl`; signing secrets
  AES-GCM-encrypted in `managed_secrets`, returned exactly once; deliveries signed
  `X-Specy-Signature: sha256=…` with event/delivery idempotency headers.
