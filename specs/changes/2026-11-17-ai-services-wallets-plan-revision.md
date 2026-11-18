# AI Services & Credit Wallets — plan revision (assumption audit)

Date: 2026-11-17

## Summary

Rewrote [`specs/plans/ai-services-wallets.md`](../plans/ai-services-wallets.md) after
auditing the first draft against the implemented schema (`public`, `pluradash`,
`plurapi`). The revision removes factual errors and ownership violations, and turns the
document into an implementable plan.

Key corrections:

1. **Tenant resolution** — `public.user_profile` has no `tenant_id`; the plan now uses
   `coalesce(log.tenant_id, public.default_tenant_for_user(user_id))` (core tenancy:
   `tenants` + `tenant_users`).
2. **`plurapi` ownership** — no DDL in the `plurapi` schema from core/plugin migrations.
   The Pluracon shell mapping stays in `plurapi.pluracon_models`; a companion PluraPi
   migration `0014` adds `service_id`/`fallback_model`/`metadata` and a billable-log
   index. The plugin only reads `plurapi.ai_query_logs` / `plurapi.pluracon_models`.
3. **Billing state location** — deduction/billing state moved into `pluradash`
   (`ai_credit_charges`, `ai_credit_wallets`, `ai_credit_provisions` ledger) instead of
   writing `deducted_at` back to `plurapi.ai_query_logs`.
4. **`032` trigger safety** — the existing `ON CONFLICT (user_id)` trigger functions are
   replaced **before** the unique index is dropped, so signup/role-grant cannot break.
5. **RLS** — every new table enables RLS with least-privilege policies; `003` grants
   `authenticated` full DML, so this is mandatory.
6. **Auth** — role checks use `requireAnyJwtRole` / the `user_roles` JWT claim
   (`api/lib/auth.ts`); the draft's `user_role` / `app_metadata.role` extraction never
   matched this system.
7. **Deployment shape** — plugin server logic is Hono routes under
   `plugins/pluradash/api/`; deduction is `pluradash.run_credit_deduction()` scheduled by
   `pg_cron`. No `supabase/functions/*` edge functions.
8. **Shell naming** — one convention, `pluracon/architekt` (slash), matching upstream
   `0011` and `ai_query_logs.pluracon_model`.
9. **Migration hygiene** — plugin migration renumbered to `033`, with `down/033`,
   `plugin.json` registration, `drop trigger if exists`, and an idempotency checklist.
10. **Financial invariants** — wallet is the live authority; `ai_allocations` remains the
    tenant cost audit; `ai_credit_charges` is the per-user spend ledger with a
    concurrency-safe `(reference_type, reference_id)` idempotency claim; historical spend
    is seeded into `lifetime_spent`.

## Second review (counter-revisions)

A follow-up review raised security, historical-billing and PL/pgSQL issues. The plan was
updated to incorporate the sensible items:

- **Accepted:** `REVOKE EXECUTE` on all `SECURITY DEFINER` RPCs; remove `support` from
  cross-user RLS reads; `billing_cutoff_at` watermark; cap backfilled `lifetime_spent`;
  `GET DIAGNOSTICS` integer fix; `p_user_id`/`p_reference_id` guards; token-pricing
  fallback; preserving `manual`/`plugin_store` overrides; isibot owner resolution (using
  the real `default_for_user_id`/`created_by` columns, not `owner_id`); widen the
  `ai_credit_provisions_source_check`; PluraPi `0014` prerequisite guard.
- **Rejected:** `NULLS NOT DISTINCT` on `(reference_type, reference_id)` — it would
  collapse every null-reference charge. Instead `record_ai_cost` now requires a non-null
  `reference_id`.
- **Not reproduced:** the reported “corrupted operators” in §5.3/§5.4/§9.4/§14. The raw
  Markdown already contains the `*` and `-` operands; a rendered preview likely stripped
  them. No source change was needed.

## Third review (interface & negative balances)

A third review changed the user-facing contract:

- `/pluradash/ai` (`AiPage`) shows **credits only**. Removed the dollar/cost overview,
  the `creditsPerDollar`/`costIncurred` rendering, and the “10 $ = 1.000 Credits”
  conversion copy. Currency stays in admin/operator views.
- The wallet is **post-paid**: `ai_credit_wallets.balance` may be negative, the
  `balance = lifetime_credited - lifetime_spent` invariant still holds, and a negative
  number is shown as-is in the UI.
- **No automatic action on a negative/low balance** in 033: no disable, no re-enable, no
  auto top-up. `can_use_service` checks entitlement only; `POST /ai/provision` enables by
  role/package, never by balance; the low-balance threshold is a passive UI hint.

## Fourth addition (super-admin accounts interface)

Added a super-admin-only surface on `/admin/accounts` to inspect and edit the provisioned
services, packages and credits of each account:

- **Core change (separate record required):** a plugin section slot on `/admin/accounts`.
  `PluginAdminConnectionSection` is generalised to `PluginAdminSection` with
  `page: 'connections' | 'accounts'` and `requiredRole`; `src/plugins/loader.ts` gains
  `getPluginAdminSections(page, userRoles)`; `VerwaltungAccounts.tsx` renders the
  `accounts` sections for super-admins. Documented in `specs/agents/plugin-hooks.md`.
- **Plugin API (§7.4):** super-admin routes under
  `/api/plugin/pluradash/admin/ai/accounts*` to list accounts, read one account, edit
  `user_service_provisions`, grant/revoke `user_packages`, and grant credits via
  `grant_credits`.
- **Plugin UI (§8.3):** `AiAccountProvisionsSection`, registered with
  `page: 'accounts'`, `requiredRole: 'super-admin'`; credits only, negative balances
  shown as-is, all writes through the §7.4 routes.

This is the first point at which the plan touches core implementation files; it is called
out explicitly in §13.1 and needs its own `specs/changes/` entry (`admin-account-plugin-sections`).

## Fifth addition (manual PluraPi SQL location)

The PluraPi companion migration no longer references an external repository path. The SQL
now lives in this repo under a new **manual, unregistered** folder:

- `migrations/plurapi/0014_pluracon_model_services.sql`
- `migrations/plurapi/down/0014_pluracon_model_services.sql`
- `migrations/plurapi/README.md`

The folder is intentionally excluded from `scripts/lib/migration-order.mjs`,
`MIGRATION_ORDER_CORE`, `scripts/setup.mjs` and `scripts/update.mjs`; it is applied by
hand (Supabase SQL Editor) before PluraDash `033`. This mirrors the existing manual
`migrations/Auth/` folder. `tests/coreMigrations.test.mjs` is unaffected (it reads only the
ordered list) and passes unchanged.

## Files Added

- `specs/changes/2026-11-17-ai-services-wallets-plan-revision.md` (this record)
- `migrations/plurapi/0014_pluracon_model_services.sql`
- `migrations/plurapi/down/0014_pluracon_model_services.sql`
- `migrations/plurapi/README.md`

## Files Changed

- `specs/plans/ai-services-wallets.md` — full rewrite (corrected assumptions, data model,
  RPCs, RLS, migration/down, rollout, tests, open questions)
- `specs/plans/README.md` — added the plan to the index

## Impact Analysis

### Database

No migrations are applied by this change; it is documentation only. The revised plan
specifies:

- `pluradash` migration `033` (+ `down/033`) — new tables, ledger conversion, wallet
  backfill, atomic RPCs, `pg_cron` job.
- PluraPi migration `0014` (+ `down/`) in the separate PluraPi repository — shell
  `service_id`/fallback/metadata and a billable-log index.

### Runtime

No runtime change. The plan removes the draft's Deno edge functions and HTTP cron in favour
of plugin Hono routes plus a SQL cron function.

### API surface

No API change today. The plan proposes plugin-scoped routes
`POST /ai/provision`, `POST /ai/models`, and an updated `GET /ai/credits`.

## Compliance

- Core/plugin boundary preserved: `033` touches only `pluradash`; the PluraPi companion
  migration is owned by the PluraPi repository; no core files (`src/`, `api/`,
  `migrations/`) are modified by the planned work.
- The plan remains forward-looking; implementation must add its own date-prefixed change
  record and register `033` in `plugins/pluradash/plugin.json` and the plugin's migration
  validation.