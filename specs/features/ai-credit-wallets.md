# AI Credit Wallets (PluraDash)

Technical documentation for the PluraDash AI credit system: a post-paid, per-user
credit wallet that bills AI service usage (PluraPi gateway queries, Isibot voice
transcription, knowledge-base embeddings) atomically and idempotently.

> **Scope:** plugin feature, implemented in `plugins/pluradash/` (EUPL isolation).
> Plugin migration `033_ai_services_wallets.sql` is the single source of the schema
> described here; the dashboard reads are credits-only by design.
> For the PluraPi-side contract see [`migrations/plurapi/HANDOFF.md`](../../migrations/plurapi/HANDOFF.md)
> (repo root; canonical copy: `plurapi-engine/migrations/PLURADASH-CREDIT-BILLING.md`
> in the PluraPi repository — `0014` is canonical there) and
> [`../platform/plurapi-query-log-migration.md`](../platform/plurapi-query-log-migration.md).
> For a business-level, audit-oriented view see
> [`../audits/AI-CREDIT-WALLETS-AUDIT.md`](../audits/AI-CREDIT-WALLETS-AUDIT.md).

## 1. Model in one paragraph

Every user account has exactly one **wallet** row (`pluradash.ai_credit_wallets`)
with a signed `balance`, plus `lifetime_credited` and `lifetime_spent` counters.
Credits are **granted** through an append-only ledger
(`pluradash.ai_credit_provisions`, one insert per grant with an idempotency key)
and **spent** through a per-operation charge ledger
(`pluradash.ai_credit_charges`, unique per `(reference_type, reference_id)`).
The wallet is the live authority and may go **negative** — the model is post-paid;
nothing is blocked automatically in this release. Tenant-level cost reporting
stays in `pluradash.ai_allocations`, which every debit also writes, so tenant
audit and per-user billing never drift.

## 2. Data model

| Table | Purpose | Key columns / rules |
|---|---|---|
| `ai_credit_wallets` | Live balance per user (PK `user_id` → `public.user_profile`) | `balance` (signed, may be negative), `lifetime_credited ≥ 0`, `lifetime_spent ≥ 0` |
| `ai_credit_provisions` | Append-only **grant ledger** | `credits_total`, `source` (`auto-default`, `auto-support`, `backfill`, `manual`, `stripe`, `topup`, `refund`, `adjustment`), `idempotency_key` (unique), `metadata`, `granted_by` |
| `ai_credit_charges` | Per-operation **spend ledger** | `reference_type` + `reference_id` (unique pair = idempotency gate), `credits_charged ≥ 0`, `cost_usd`, `allocation_id`, `skip_reason` (dead-letter) |
| `user_service_provisions` | Runtime entitlement per `(user_id, service_id)` | `is_enabled`, `source` (`package`, `plugin_store`, `manual`), `disabled_reason` (`insufficient_credits`, `role_required`, `package_revoked`, `manual`) |
| `user_packages` | Package assignments per user | `status` (`active`, `revoked`), PK `(user_id, package_id)` |
| `packages` / `package_services` | Catalog: package → services | `required_role`, `is_default_for_role`, `is_active` |
| `credit_settings` | Single-row billing configuration | `credits_per_usd` (default 100), `markup_multiplier` (≥ 1), `low_balance_threshold` (default 10), `billing_cutoff_at` |
| `ai_services` / `ai_models` | Service catalog + per-model pricing | gained `required_role`, `is_active`, per-token pricing, `metadata` |
| `ai_allocations` | Tenant cost audit (pre-existing, 012) | gained `credits_charged` |

Services seeded: `coding`, `planning`, `transcription`, `embeddings`.
Packages seeded: `core` (default for the `support` role: coding, planning,
embeddings) and `isibot` (add-on: transcription).

### Ledger invariants

1. `balance = lifetime_credited − lifetime_spent` — holds by construction; the
   backfill does **not** cap `lifetime_spent`, so historical overage seeds a
   negative opening balance (post-paid from day one).
2. `lifetime_credited = Σ ai_credit_provisions.credits_total` per user — grants
   only ever append to the ledger; the wallet counter is updated in the same
   transaction.
3. One charge per `(reference_type, reference_id)` — the unique pair is the
   concurrency gate; replays return the original charge instead of
   double-charging.

## 3. Atomic RPCs (SECURITY DEFINER)

All RPCs are `SECURITY DEFINER` with `search_path = pluradash, public`.
`EXECUTE` is revoked from `public`, `anon`, `authenticated` and granted to
`service_role` only — the browser can never call them; all writes go through
the Worker.

| RPC | Behaviour |
|---|---|
| `grant_credits(user, credits, source, idempotency_key, metadata, granted_by)` | Appends a ledger row (idempotent via key) and credits the wallet. Returns `(balance, credits_added, idempotent)`. Rejects negative amounts. |
| `record_ai_cost(user, tenant, service, model, ref_type, ref_id, units, cost_usd, credits)` | Claims the charge slot via the unique reference pair, then in one transaction: charge row, `ai_allocations` row (tenant audit) and wallet debit. Post-paid — the balance may go negative. Duplicate reference → returns the original charge unchanged. |
| `process_query_log_deduction(log_id)` | Reads one `plurapi.ai_query_logs` row (only `status_code = 200`, `error is null`, `created_at ≥ billing_cutoff_at`), attributes the service via `pluracon_models.service_id` → `ai_models.service_id` → `'coding'`, computes credits `ceil(cost_usd × credits_per_usd × markup_multiplier)` and delegates to `record_ai_cost`. Unattributable logs (`user_id` null) get a zero-credit charge with `skip_reason = 'no_user'`. |
| `run_credit_deduction(batch_size)` | Loops over the oldest unbilled billable logs, catches per-log errors and dead-letters them (`skip_reason = 'error: …'`) instead of blocking the queue. Returns `(processed, skipped)`. |
| `can_use_service(user, service)` | Boolean entitlement: `false` **only** for an explicit `is_enabled = false` row; an enabled row or **no row at all** returns `true` (grandfathered — a missing seed row must not lock users out). Balance is never consulted. |

## 4. Scheduled deduction

`pg_cron` job `pluradash-credit-deduction` runs `run_credit_deduction(200)`
every minute (`* * * * *`), created in a guarded `DO` block (absent `pg_cron`
skips the job without failing the migration). A backlog larger than one batch
drains over subsequent ticks; per-log idempotency makes the job safe to
re-run.

## 5. Migration & backfill behaviour

- Prerequisite guard: aborts when `plurapi.pluracon_models.service_id` is
  missing (manual PluraPi script `migrations/plurapi/0014` must be applied first).
- `032` provisioning triggers are replaced **before** the one-row-per-user
  unique index on `ai_credit_provisions` is dropped; new triggers append to the
  ledger and ensure a wallet exists (`auto-default:<user>` / `auto-support:<user>`).
- §8b seeding: the default-for-role package (`core`) and its services are
  provisioned for existing role holders; transcription is grandfathered for all
  accounts (the Isibot connector already bills the tenant owner in production).
- Wallet backfill: one legacy grant per provision row (`<source>:<user>`
  idempotency key), then wallets seeded `balance = credited − historical spend`
  with **no cap** — overage becomes a visible negative opening balance.
- Down-migration `down/033` collapses the ledger back to one row per user and
  drops the new tables (destructive, documented in the file header).

## 6. Row Level Security

Every new table enables RLS with least-privilege policies:

- Reference data (`packages`, `package_services`, `credit_settings`,
  `ai_services`, `ai_models`): read for `authenticated`, write for super-admin.
- User-scoped (`user_packages`, `user_service_provisions`, `ai_credit_wallets`):
  owner (`user_id = current_user_id()`) or super-admin. `support` gets **no**
  cross-user reads.
- `ai_credit_charges`: owner, super-admin, or tenant admin scoped to the
  charge's `tenant_id`.
- `ai_credit_provisions` cross-user reads tightened from the 032
  `support`-wide policy to owner/super-admin.

## 7. API & UI surface

| Surface | Behaviour |
|---|---|
| `GET /api/plugin/pluradash/ai/credits` | Wallet summary from `aiCredits.ts` (reads `ai_credit_wallets` with the caller's JWT → RLS-scoped). Payload is **credits only** — no dollar fields, no conversion constants. |
| `GET /api/plugin/pluradash/admin/ai/accounts` (+ `/:userId`, `PUT …/services/:serviceId`, `PUT …/packages/:packageId`, `POST …/credits`) | Super-admin account administration via `aiAdmin.ts`; entitlement edits upsert `user_service_provisions` (explicit overrides win over package sync), package toggles sync provisions with `ignoreDuplicates`, credit grants go through `grant_credits`. All routes `requireAnyJwtRole(['super-admin'])`. |
| `/pluradash/ai` (`AiPage.tsx`) | Credits-only table (aufgeladen / verbraucht / guthaben, „Überzogen" badge). No `$`, no conversion copy. |
| `/admin/accounts` → „Erweiterungen" tab | Generic core slot (`PluginAdminSection`, `page: 'accounts'`, `requiredRole: 'super-admin'`) rendering `AiAccountProvisionsSection`. Core contains no plugin-specific logic. |

## 8. Runtime integration points

- **Isibot transcription** (`transcriptionService.ts`): optional `billing`
  context `{ tenantId, userId }`. Pre-flight: resolve the billing user
  (explicit `userId` → `tenants.default_for_user_id` → `tenants.created_by` →
  oldest tenant admin), then `canUseService(user, 'transcription')`. An RPC
  error fails **open** (transient DB error must not cause an outage); a
  `false` blocks with `success: false` before any AI spend.
- **Cost capture** (`aiCostTracking.ts`): `trackAiCost` routes through
  `record_ai_cost` when a billing user **and** a reference id exist;
  unattributable operations keep the allocation-only insert so tenant cost
  reporting stays complete. Entitlement state is additionally available as a
  tri-state (`getServiceEntitlement`: `enabled` / `disabled` / `unset`) for
  plugin-internal flows.
- **PluraPi gateway queries**: billed asynchronously by the cron job. The
  gateway-side implementation (verified in the PluraPi repository,
  `plurapi-sessions/src/ai-proxy.ts`):
  - **Pre-flight is implemented and flag-gated** — `PLURADASH_ENTITLEMENT_CHECK`
    (default **off**, so the Worker can deploy before `033`). When enabled, the
    proxy calls `can_use_service` with the service key before forwarding;
    an explicit `false` → HTTP `402` and **no query-log row is written** (a
    blocked request is never billed). A missing config or RPC error fails
    **open** with a logged warning; the balance is never consulted.
  - **Service classification mirrors settlement**: the pre-flight derives the
    service id from the request's Pluracon shell
    (`pluracon/architekt` → `planning`, `arbeiter`/`kreativ` → `coding`,
    otherwise `coding`) — the same fallback chain the deduction job uses.
  - **Usage capture** (`AI-GATEWAY-QUERY-LOGGING.md` in the PluraPi repo): one
    `ai_query_logs` row per query, written fire-and-forget (`ctx.waitUntil`) so
    a logging failure never breaks chat; attribution rides in the proxy path
    prefix (`t/<tenant>/u/<user>/s/<session>/m/<shell>`); `m/none` is stored as
    `null` so service attribution falls through to `ai_models` → `'coding'`;
    streamed responses are logged at stream end (or on client disconnect with
    the usage captured so far). Identity comes from the verified JWT `sub`
    stored at session creation — never from client input.
  - **Price evidence**: `cost_source` records whether the cost came from
    OpenRouter's own accounting (`openrouter-usage`), was computed from public
    per-token pricing (`computed-pricing`), or is unknown (then settlement
    falls back to token counts × `ai_models` pricing).

## 9. Operational reconciliation

```sql
-- Invariant 1: wallet arithmetic
select user_id from pluradash.ai_credit_wallets
 where balance <> lifetime_credited - lifetime_spent;

-- Invariant 2: credited equals the grant ledger
select p.user_id, sum(p.credits_total) as ledger_credited, w.lifetime_credited
  from pluradash.ai_credit_provisions p
  join pluradash.ai_credit_wallets w on w.user_id = p.user_id
 group by p.user_id, w.lifetime_credited
having sum(p.credits_total) <> w.lifetime_credited;

-- Dead-letter scan (should be empty or explainable)
select reference_type, skip_reason, count(*)
  from pluradash.ai_credit_charges
 where skip_reason is not null
 group by 1, 2;
```

## 10. Deliberate non-goals (033)

- **No automatic enforcement**: no disable/re-enable/block/top-up on low or
  negative balances. `can_use_service` checks entitlement only; the low-balance
  threshold is a passive UI hint.
- **No currency in the user-facing dashboard**; conversion stays in
  `credit_settings` and operator views.
- **No writes to `plurapi`** from plugin SQL; the schema remains PluraPi-owned.
