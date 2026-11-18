# AI Services, Packages & Credit Wallets — Revised Plan

Status: **plan (not implemented)** · Owner: PluraDash plugin + manual PluraPi SQL
Supersedes: the first draft of this document (2026-11-17)

---

## 0. Why this plan was rewritten

The first draft contained assumptions that do not match the implemented schema and the
core/plugin boundary. The most important corrections:

| Original assumption | Reality | Revised decision |
|---|---|---|
| `public.user_profile` has `tenant_id` | It does **not** (`migrations/user_profile.sql`). Tenancy is `tenants` + `tenant_users`; the active tenant is derived by `public.default_tenant_for_user(user_id)` (`202605240002_...`) | Resolve `coalesce(log.tenant_id, public.default_tenant_for_user(user_id))`; never read a user `tenant_id` column |
| `plurapi.ai_query_logs.user_id/tenant_id` are `uuid` | `0011` created them as `text`; `0013` converts to `uuid` and adds FKs | Declare PluraPi `0011` + `0013` as hard prerequisites; assert the type before use |
| Upstream `plurapi.pluracon_models` can be dropped and replaced by a view | It is a PluraPi-owned table written by the engine (`specs/platform/plurapi-query-log-migration.md`, `specs/platform/plurapi.md` §2.4/§2.5) | **No automated `plurapi` DDL.** The mapping stays PluraPi-owned; a manual SQL script in `migrations/plurapi/` adds `service_id` |
| Deduction state can live on `plurapi.ai_query_logs` | A plugin migration must target its own schema (`AGENTS.md` §5) | Deduction/billing state lives in `pluradash`; the plugin only **reads** `plurapi` |
| Drop `ai_credit_provisions_user_id_key` | `032`'s triggers use `ON CONFLICT (user_id)`; dropping the index makes signup/role-grant fail | Replace the trigger functions **before** dropping the index |
| New tables inherit RLS | `003_grant_schema_access.sql` grants `authenticated` full DML; tables without RLS are writable by any browser session | Enable RLS + least-privilege policies on every new table |
| Roles are in `user_role` / `role_claim` / `app_metadata.role` | Roles are `public.user_roles` and the JWT claim `user_roles` (array), read by `api/lib/auth.ts` | Use `requireAnyJwtRole` / `claims.user_roles`; never trust metadata |
| Edge functions in `supabase/functions/*` | Repo layout is `functions/` (only `send_email`); plugin server logic is Hono in `plugins/pluradash/api` | Server logic = plugin Hono routes; the cron = a `pg_cron`-scheduled SQL function |
| Shells are `pluracon-architekt` | Upstream uses `pluracon/architekt` and `ai_query_logs.pluracon_model` stores that form | One convention: **slash** (`pluracon/architekt`) everywhere |
| One credit model | Existing model (`032`) is "provisioned maximum minus **derived** usage"; the draft mixed derived and stored balances | Stored wallet is the live authority; `ai_allocations` remains the tenant cost audit; a new `ai_credit_charges` table is the per-user spend ledger |

### 0.1 Counter-review outcomes

A second review of this revision raised the items below. Outcomes:

| Review item | Outcome |
|---|---|
| `REVOKE EXECUTE` on the `SECURITY DEFINER` RPCs | **Accepted** — see §5.6 |
| Remove `support` from cross-user RLS reads | **Accepted** — see §11 (also tightens the existing `ai_allocations` / `ai_credit_provisions` policies) |
| `billing_cutoff_at` to stop retro-billing historical logs | **Accepted** — see §4.1, §5.3, §5.4 |
| Cap backfilled `lifetime_spent` at `lifetime_credited` | **Accepted** — see §10 |
| `GET DIAGNOSTICS ... = ROW_COUNT` into a boolean | **Accepted** — see §5.2 |
| Guard `p_user_id IS NULL` in `record_ai_cost` | **Accepted** — see §5.2 |
| `NULLS NOT DISTINCT` on `(reference_type, reference_id)` | **Rejected** — it would collapse every null-reference charge into one. Instead `record_ai_cost` requires a non-null `reference_id`; nulls-distinct is the intended behaviour for ad-hoc rows |
| Token-pricing fallback when `cost_usd` is null | **Accepted** — see §5.3 |
| Preserve `manual` / `plugin_store` overrides during provisioning | **Accepted** — see §7.1 |
| isibot owner resolution + settings instead of hardcoded rates | **Accepted, with corrected columns** — `tenants.owner_id` does not exist; use `default_for_user_id` / `created_by` (§9.2) |
| Widen `ai_credit_provisions_source_check` | **Accepted** — see §4.2 |
| “Corrupted operators” in §5.3/§5.4/§9.4/§14 | **Not reproduced** — the raw Markdown contains `*` and `-`; a renderer likely stripped them. Verify against the file, not a rendered preview |

### 0.2 Interface revision

Third review, UI-only:

| Item | Decision |
|---|---|
| `/pluradash/ai` shows a dollar/cost overview | **Removed.** The AI page shows credits only. No `$`/`€`, no `costIncurred`, no `creditsPerDollar`, no “10 $ = 1.000 Credits” copy. Currency stays in admin/operator views only (§8) |
| Balance could not go negative | **Changed.** The wallet is post-paid and may go negative; the negative number is rendered as-is. No automatic disable, revoke, block or top-up is triggered (§3 invariant 11, §5.2, §5.5) |
| `POST /ai/provision` gated enabling on balance | **Changed.** Provisioning enables by entitlement only; a negative balance never revokes or refuses a service (§7.1) |

### 0.3 Super-admin accounts interface

A fourth addition: a **super-admin-only** surface on `/admin/accounts` to inspect and edit
the provisioned services, packages and credit balance of each account. It needs a small
**core change** (a plugin slot on the accounts page, §8.1/§13.1), plugin API routes
(§7.4) and a plugin section component (§8.3); see §16 decision 9.

The rest of this document is the corrected plan.

---

## 1. Scope

In scope:

1. Product packages and service entitlements (`packages`, `package_services`,
   `user_packages`, `user_service_provisions`).
2. A live, per-user credit wallet (`ai_credit_wallets`) fed by an append-only grant ledger
   (`ai_credit_provisions` converted) and drained by `ai_credit_charges`.
3. Atomic SQL RPCs for grant / charge / pre-flight checks.
4. A `pg_cron` deduction job that bills `plurapi.ai_query_logs`.
5. Super-admin model switching (`set_model`) built on the existing `pluradash.ai_models`
   catalog, plus a manual PluraPi SQL script (`migrations/plurapi/`) for the shell mapping.
6. Dashboard + API surface for balances, ledger, packages and model management.

Out of scope:

- Any DDL in the `plurapi` schema from this repository.
- Billing for non-AI services.
- Multi-currency.

---

## 2. Prerequisites and ownership

### 2.1 Hard prerequisites

- Core tenancy: `public.tenants`, `public.tenant_users`, `public.default_tenant_for_user()`,
  `public.current_user_id()`, `public.is_super_admin()`,
  `public.set_current_timestamp_updated_at()` (`202605240001`, `202605240002`).
- PluraPi migrations **0011** (`ai_query_logs`, `pluracon_models`) and **0013**
  (`tenant_id`/`user_id` → `uuid`, FKs `ON DELETE SET NULL`).
  See [`../platform/plurapi-query-log-migration.md`](../platform/plurapi-query-log-migration.md)
  and [`../platform/plurapi.md`](../platform/plurapi.md) §2.4.
- PluraDash migrations **012** (`ai_services`, `ai_models`, `ai_allocations`), **013**
  (embeddings/transcription), **014** (`ai_service_logs`), **032**
  (`ai_credit_provisions` + provisioning triggers).

### 2.2 Ownership rules applied

- `plurapi` schema: logically owned by the **PluraPi repository**. This plan reads
  `plurapi.ai_query_logs` and `plurapi.pluracon_models` but never runs `plurapi` DDL from
  the automated flow. The one additive change is a **manual SQL script** in the new
  `migrations/plurapi/` folder (`0014_pluracon_model_services.sql`), intentionally
  **outside** `scripts/lib/migration-order.mjs` and never applied by
  `scripts/setup.mjs` / `scripts/update.mjs`; it mirrors the existing manual
  `migrations/Auth/` folder.
- `pluradash` schema: owned by the **PluraDash plugin**. Migration `033` (+ `down/033`)
  touches only `pluradash`.
- Core tables (`public.*`) are read or referenced by FK only; the single precedent for a
  plugin trigger on a core table is kept (`public.user_profile`, `public.user_roles`) and
  documented in the change record.
- No new core migration is required.

### 2.3 Chosen control-plane boundary

The three Pluracon shells stay in **`plurapi.pluracon_models`**, because:

- the PluraPi engine already reads and writes that table;
- moving it into a plugin schema would force PluraPi to depend on the PluraDash plugin;
- the `plurapi` schema has its own migration ledger and down-migrations.

The only extension is a manual PluraPi script
(`migrations/plurapi/0014_pluracon_model_services.sql`) adding `service_id`,
`fallback_model` and `metadata`. `pluradash` reads the mapping to attribute service
costs; the admin model switch writes it through the existing service-role contract
(documented in §7.2).

---

## 3. Design invariants

1. **Wallet is the live credit position.** `ai_credit_wallets.balance` is the user’s
   current credit balance. It is user-scoped (not tenant-scoped), matching the existing
   `ai_credit_provisions` contract. It **may be negative**: billing is post-paid and the
   balance is informational in 033 (invariant 11).
2. **Grant ledger is append-only.** `ai_credit_provisions` is a ledger of grants/top-ups
   with an `idempotency_key`. One row per grant, not one row per user.
   `lifetime_credited = SUM(ai_credit_provisions.credits_total)`.
3. **Spend ledger is append-only.** `ai_credit_charges` records every wallet debit with a
   `(reference_type, reference_id)` idempotency key. It is the per-user audit and the
   deduction job's processed marker. `lifetime_spent` is its running total.
4. **Tenant cost audit stays in `ai_allocations`.** `ai_allocations.tenant_id` is
   `NOT NULL`; an allocation is written whenever a tenant can be resolved. A charge can
   exist without an allocation (e.g. a personal PluraPi session with no workspace), but an
   allocation never exists without a charge after migration 033.
5. **Balance invariant:** `balance = lifetime_credited - lifetime_spent`. The balance may
   be negative; a negative value is a real overdraft and is shown as such. Every mutation
   locks the wallet row `FOR UPDATE`.
6. **No direct application writes to billing tables.** Only the `SECURITY DEFINER` RPCs in
   §5 mutate `ai_credit_wallets`, `ai_credit_provisions`, `ai_credit_charges`; RLS blocks
   browser writes.
7. **Idempotency:**
   - grants: `idempotency_key` (e.g. `auto-support:<user_id>`);
   - charges: `(reference_type, reference_id)` (e.g. `('plurapi_query_log', log_id)`);
   - job: checks `ai_credit_charges` before touching a log.
8. **Rounding:** credits = `CEIL(cost_usd × credits_per_usd × markup_multiplier)`, minimum
   `1` for a non-zero cost, `0` for zero cost. Settings live in `pluradash.credit_settings`
   (not environment variables), so SQL and TypeScript share one source.
9. **Tenant resolution:** `coalesce(log.tenant_id, public.default_tenant_for_user(user_id))`.
   No `user_profile.tenant_id`.
10. **`SECURITY DEFINER` functions always set `search_path = pluradash, public`.**
11. **No automatic credit enforcement in 033.** Service access is gated only by
    `user_service_provisions.is_enabled` (role/package/manual). The wallet balance does
    **not** disable, re-enable or block services automatically; a negative balance is
    surfaced to the user/admin for a manual decision. A hard stop at zero can be added
    later as an explicit policy (one predicate in `can_use_service`).
12. **Credits are the only user-facing unit.** The AI interface (`/pluradash/ai`)
    renders credits and only credits. It never shows currency amounts, cost in USD/EUR, or
    the conversion rate ("10 $ = 1.000 Credits") — those are implementation details and
    belong in admin/operator views. A negative balance is rendered as a negative credit
    number, not as a debt in currency.

---

## 4. Data model

All objects below are in the `pluradash` schema unless stated otherwise.

### 4.1 New tables

```sql
-- Product tiers / add-ons. 'core' is implicit for the support role.
create table if not exists pluradash.packages (
  id                  text primary key,
  name                text not null,
  description         text not null default '',
  required_role       text not null default 'support',
  is_default_for_role boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Package → capability (ai_services) mapping.
create table if not exists pluradash.package_services (
  package_id text not null references pluradash.packages(id) on delete cascade,
  service_id text not null references pluradash.ai_services(id) on delete cascade,
  primary key (package_id, service_id)
);

-- Which packages a user holds.
create table if not exists pluradash.user_packages (
  user_id     uuid not null references public.user_profile(user_id) on delete cascade,
  package_id  text not null references pluradash.packages(id) on delete restrict,
  status      text not null default 'active' check (status in ('active', 'revoked')),
  granted_by  text not null default 'system',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, package_id)
);

-- Live runtime entitlement checked before inference.
create table if not exists pluradash.user_service_provisions (
  user_id         uuid not null references public.user_profile(user_id) on delete cascade,
  service_id      text not null references pluradash.ai_services(id) on delete cascade,
  is_enabled      boolean not null default true,
  source          text not null default 'package'
                    check (source in ('package', 'plugin_store', 'manual')),
  disabled_reason text null
                    check (disabled_reason in
                      ('insufficient_credits', 'role_required', 'package_revoked', 'manual')),
  updated_at      timestamptz not null default now(),
  primary key (user_id, service_id)
);

-- Live credit balance (user-scoped, one row per user).
-- balance may be negative: billing is post-paid and 033 does not auto-block at zero.
create table if not exists pluradash.ai_credit_wallets (
  user_id           uuid primary key references public.user_profile(user_id) on delete cascade,
  balance           integer not null default 0,
  lifetime_credited integer not null default 0 check (lifetime_credited >= 0),
  lifetime_spent    integer not null default 0 check (lifetime_spent >= 0),
  updated_at        timestamptz not null default now()
);

-- Append-only per-user spend ledger + deduction idempotency marker.
create table if not exists pluradash.ai_credit_charges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.user_profile(user_id) on delete set null,
  tenant_id       uuid references public.tenants(id) on delete set null,
  service_id      text references pluradash.ai_services(id) on delete set null,
  model_id        text references pluradash.ai_models(id) on delete set null,
  reference_type  text not null default '',
  reference_id    uuid,
  units_consumed  numeric(18, 4) not null default 0,
  cost_usd        numeric(14, 8) not null default 0,
  credits_charged integer not null default 0 check (credits_charged >= 0),
  allocation_id   uuid references pluradash.ai_allocations(id) on delete set null,
  skip_reason     text null,          -- e.g. 'no_user' or 'error: ...' (dead-letter)
  created_at      timestamptz not null default now()
);

create unique index if not exists idx_ai_credit_charges_reference
  on pluradash.ai_credit_charges (reference_type, reference_id);

create index if not exists idx_ai_credit_charges_user_created
  on pluradash.ai_credit_charges (user_id, created_at desc);

-- Single-row billing configuration (shared by SQL and TypeScript).
-- billing_cutoff_at: only plurapi.ai_query_logs created at/after this watermark are
-- billed by the cron. Defaults to migration time, so pre-033 history is never
-- retro-billed. Operators may move it forward, never backward, without a deliberate
-- backfill run.
create table if not exists pluradash.credit_settings (
  id                 boolean primary key default true check (id),
  credits_per_usd    integer not null default 100 check (credits_per_usd > 0),
  markup_multiplier  numeric(6, 3) not null default 1.000 check (markup_multiplier >= 1),
  -- UI warning only. It does not disable, re-enable or block services.
  low_balance_threshold integer not null default 10 check (low_balance_threshold >= 0),
  billing_cutoff_at  timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

insert into pluradash.credit_settings (id) values (true)
on conflict (id) do nothing;
```

### 4.2 Alter existing `pluradash` objects

```sql
-- 012 table: add entitlement metadata.
alter table pluradash.ai_services
  add column if not exists required_role text not null default 'support',
  add column if not exists is_active boolean not null default true;

-- 012 table: per-token pricing + sync metadata.
alter table pluradash.ai_models
  add column if not exists prompt_cost_per_token     numeric(18, 12),
  add column if not exists completion_cost_per_token numeric(18, 12),
  add column if not exists metadata                  jsonb not null default '{}'::jsonb,
  add column if not exists updated_at                timestamptz not null default now();

-- 012 table: the credits actually charged for the allocation.
alter table pluradash.ai_allocations
  add column if not exists credits_charged integer not null default 0
    check (credits_charged >= 0);

-- 032 table: convert one-row-per-user into an append-only ledger.
alter table pluradash.ai_credit_provisions
  add column if not exists idempotency_key text,
  add column if not exists metadata        jsonb not null default '{}'::jsonb,
  add column if not exists granted_by      uuid null;

-- Widen the 032 source check now so future payment/webhook sources do not need
-- another schema migration. Existing rows only use the original four values.
alter table pluradash.ai_credit_provisions
  drop constraint if exists ai_credit_provisions_source_check;
alter table pluradash.ai_credit_provisions
  add constraint ai_credit_provisions_source_check
  check (source in (
    'auto-default', 'auto-support', 'backfill', 'manual',
    'stripe', 'topup', 'refund', 'adjustment'
  ));

-- Adopt the pre-migration rows as one legacy grant per user. Reuse the source-based
-- key so a later re-fire of the same trigger is a no-op (e.g. an existing auto-support
-- row already occupies 'auto-support:<user>').
update pluradash.ai_credit_provisions p
   set idempotency_key = p.source || ':' || p.user_id::text,
       metadata = coalesce(p.metadata, '{}'::jsonb)
                  || jsonb_build_object('migrated_from', 'ai_credit_provisions')
 where p.idempotency_key is null;
```

> **Ordering is critical:** the `032` trigger functions are dropped in §6 *before* the
> unique index is dropped. Do not reorder.

### 4.3 PluraPi manual migration `migrations/plurapi/0014_pluracon_model_services.sql`

Lives in this repo under the new **manual** folder `migrations/plurapi/`, applied by hand
in the Supabase SQL Editor. It is intentionally **not** registered in
`scripts/lib/migration-order.mjs` and is never run by `scripts/setup.mjs` /
`scripts/update.mjs` (same convention as the existing `migrations/Auth/` folder). The
`plurapi` schema remains logically owned by the PluraPi repository; this script is the
documented, additive companion:

```sql
-- Adds service attribution and fallback to the shell mapping.
alter table plurapi.pluracon_models
  add column if not exists service_id     text not null default 'coding',
  add column if not exists fallback_model text null,
  add column if not exists metadata       jsonb not null default '{}'::jsonb;

update plurapi.pluracon_models set service_id = 'planning'
 where model = 'pluracon/architekt';
update plurapi.pluracon_models set service_id = 'coding'
 where model in ('pluracon/arbeiter', 'pluracon/kreativ');

-- Cheap billable-log scan for the deduction job.
create index if not exists ai_query_logs_billable_idx
  on plurapi.ai_query_logs (created_at asc)
  where status_code = 200 and error is null;

insert into plurapi.schema_migrations (version)
values ('0014_pluracon_model_services')
on conflict (version) do nothing;
```

Companion `migrations/plurapi/down/0014_pluracon_model_services.sql` drops the index and
the three columns, and removes the ledger row.

Both scripts live in `migrations/plurapi/` (mirroring the plugin `migrations/down/`
convention). Add a short `migrations/plurapi/README.md` stating that the folder is manual,
unregistered and not part of setup/update.

No `pluradash` object is created in `plurapi`, and no view replaces the table.

### 4.4 Seed data (033, idempotent)

The existing `transcription` and `embeddings` services come from `012`/`013`. Add the
PluraPi-facing services, packages and mappings:

```sql
insert into pluradash.ai_services (id, name, description, unit_label, required_role)
values
  ('coding',   'Coding',   'Code generation, editing and refactoring', 'tokens', 'support'),
  ('planning', 'Planning', 'Architecture and multi-step reasoning',     'tokens', 'support')
on conflict (id) do nothing;

insert into pluradash.packages
  (id, name, description, required_role, is_default_for_role)
values
  ('core',   'Core AI Suite',    'Included with the support role', 'support', true),
  ('isibot', 'Isibot Voice Agent', 'Add-on for voice transcription',  'support', false)
on conflict (id) do nothing;

insert into pluradash.package_services (package_id, service_id)
values
  ('core', 'coding'), ('core', 'planning'), ('core', 'embeddings'),
  ('isibot', 'transcription')
on conflict do nothing;
```

Seeding `coding`/`planning` **before** creating the RPCs matters: `process_query_log_deduction`
self-heals `ai_models` with `service_id = 'planning' | 'coding'`, and that FK must resolve.

---

## 5. Atomic RPCs

All functions are `SECURITY DEFINER`, `SET search_path = pluradash, public`.

### 5.1 `pluradash.grant_credits`

```sql
create or replace function pluradash.grant_credits(
  p_user_id         uuid,
  p_credits         integer,
  p_source          text,
  p_idempotency_key text  default null,
  p_metadata        jsonb default '{}'::jsonb,
  p_granted_by      uuid  default null
)
returns table (balance integer, credits_added integer, idempotent boolean)
language plpgsql security definer set search_path = pluradash, public
as $$
declare
  v_balance   integer;
  v_inserted  uuid;
begin
  if p_user_id is null or coalesce(p_credits, -1) < 0 then
    raise exception 'grant_credits: p_user_id required and p_credits must be >= 0';
  end if;

  insert into pluradash.ai_credit_wallets (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  insert into pluradash.ai_credit_provisions
    (user_id, credits_total, source, idempotency_key, metadata, granted_by)
  values
    (p_user_id, coalesce(p_credits, 0), p_source, p_idempotency_key,
     coalesce(p_metadata, '{}'::jsonb), p_granted_by)
  on conflict (idempotency_key) do nothing
  returning id into v_inserted;

  -- Duplicate idempotency key: report the current balance, add nothing.
  if p_idempotency_key is not null and v_inserted is null then
    select w.balance into v_balance
      from pluradash.ai_credit_wallets w where w.user_id = p_user_id;
    return query select v_balance, 0, true;
    return;
  end if;

  update pluradash.ai_credit_wallets w
     set balance = w.balance + coalesce(p_credits, 0),
         lifetime_credited = w.lifetime_credited + coalesce(p_credits, 0),
         updated_at = now()
   where w.user_id = p_user_id
  returning w.balance into v_balance;

  -- No automatic service re-enable: a top-up changes the balance only. An admin can
  -- re-enable a manually disabled service explicitly.
  return query select v_balance, coalesce(p_credits, 0), false;
end;
$$;
```

`idempotency_key` uses a plain unique index (NULLs are distinct), so `ON CONFLICT
(idempotency_key)` works for both keyed grants and keyless manual adjustments.

### 5.2 `pluradash.record_ai_cost`

Universal debit path used by the PluraPi job **and** by isibot/transcription.

```sql
create or replace function pluradash.record_ai_cost(
  p_user_id        uuid,
  p_tenant_id      uuid,
  p_service_id     text,
  p_model_id       text,
  p_reference_type text,
  p_reference_id   uuid,
  p_units_consumed numeric,
  p_cost_usd       numeric,
  p_credits        integer
)
returns table (
  charge_id         uuid,
  allocation_id     uuid,
  credits_charged   integer,
  remaining_balance integer
)
language plpgsql security definer set search_path = pluradash, public
as $$
declare
  v_charge_id  uuid;
  v_alloc_id   uuid;
  v_tenant_id  uuid;
  v_balance    integer;
  v_actual     integer;
  v_new        integer;
begin
  if p_user_id is null then
    raise exception 'record_ai_cost: p_user_id is required';
  end if;
  if p_reference_id is null then
    raise exception 'record_ai_cost: p_reference_id is required for idempotent billing';
  end if;
  if p_service_id is null or p_model_id is null then
    raise exception 'record_ai_cost: p_service_id and p_model_id are required';
  end if;

  -- Claim the charge slot BEFORE touching the wallet. The unique
  -- (reference_type, reference_id) index makes this the concurrency-safe
  -- idempotency gate: a second caller blocks on the insert and then gets
  -- no row, so it can never double-charge.
  insert into pluradash.ai_credit_charges
    (user_id, tenant_id, service_id, model_id, reference_type, reference_id,
     units_consumed, cost_usd, credits_charged)
  values
    (p_user_id, p_tenant_id, p_service_id, p_model_id,
     coalesce(p_reference_type, ''), p_reference_id,
     coalesce(p_units_consumed, 0), coalesce(p_cost_usd, 0), 0)
  on conflict (reference_type, reference_id) do nothing
  returning id into v_charge_id;

  if v_charge_id is null then
    -- Already claimed by another transaction: return its result, mutate nothing.
    select c.id, c.allocation_id, c.credits_charged
      into v_charge_id, v_alloc_id, v_actual
      from pluradash.ai_credit_charges c
     where c.reference_type = coalesce(p_reference_type, '')
       and c.reference_id   = p_reference_id
     limit 1;
    select w.balance into v_new
      from pluradash.ai_credit_wallets w where w.user_id = p_user_id;
    return query select v_charge_id, v_alloc_id, v_actual, coalesce(v_new, 0);
    return;
  end if;

  insert into pluradash.ai_credit_wallets (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select w.balance into v_balance
    from pluradash.ai_credit_wallets w
   where w.user_id = p_user_id
   for update;

  -- Post-paid: charge the full amount; the balance is allowed to go negative.
  v_actual := greatest(coalesce(p_credits, 0), 0);
  v_new    := v_balance - v_actual;
  v_tenant_id := coalesce(p_tenant_id, public.default_tenant_for_user(p_user_id));

  if v_tenant_id is not null then
    insert into pluradash.ai_allocations
      (tenant_id, user_id, service_id, model_id,
       reference_type, reference_id, units_consumed, cost_incurred, credits_charged)
    values
      (v_tenant_id, p_user_id, p_service_id, p_model_id,
       coalesce(p_reference_type, ''), p_reference_id,
       coalesce(p_units_consumed, 0), coalesce(p_cost_usd, 0), v_actual)
    returning id into v_alloc_id;
  end if;

  update pluradash.ai_credit_wallets w
     set balance = v_new,
         lifetime_spent = w.lifetime_spent + v_actual,
         updated_at = now()
   where w.user_id = p_user_id;

  update pluradash.ai_credit_charges
     set tenant_id       = v_tenant_id,
         allocation_id   = v_alloc_id,
         credits_charged = v_actual
   where id = v_charge_id;

  -- No automatic service disable: the balance is informational in 033. A negative
  -- balance is returned to the caller and shown in the UI; an admin decides what to do.
  return query select v_charge_id, v_alloc_id, v_actual, v_new;
end;
$$;
```

Note: the claim insert serialises concurrent calls for the same reference; the wallet row
lock serialises concurrent debits for the same user. Different users never block each
other. `reference_id` is **required** precisely so the idempotency gate is meaningful;
the unique index deliberately keeps NULLs distinct, so null-reference rows would never
deduplicate.

### 5.3 `pluradash.process_query_log_deduction`

Reads a PluraPi log, attributes the service from `plurapi.pluracon_models` (slash keys),
self-heals `ai_models`, computes credits, and calls `record_ai_cost`. It **does not write
to `plurapi`**.

```sql
create or replace function pluradash.process_query_log_deduction(p_log_id uuid)
returns table (
  charge_id         uuid,
  allocation_id     uuid,
  credits_charged   integer,
  remaining_balance integer,
  skip_reason       text
)
language plpgsql security definer set search_path = pluradash, public
as $$
declare
  v_log        record;
  v_service_id text;
  v_cpu        integer;
  v_markup     numeric;
  v_credits    integer;
  v_tokens     integer;
  v_cost_usd   numeric;
  v_model      record;
begin
  -- Already billed?
  if exists (
    select 1 from pluradash.ai_credit_charges c
     where c.reference_type = 'plurapi_query_log'
       and c.reference_id   = p_log_id
  ) then
    return;
  end if;

  select l.id, l.user_id, l.tenant_id, l.pluracon_model, l.model,
         l.prompt_tokens, l.completion_tokens, l.total_tokens, l.cost_usd
    into v_log
    from plurapi.ai_query_logs l
   where l.id = p_log_id
     and l.status_code = 200
     and l.error is null
     -- Never retro-bill logs that predate the migration watermark.
     and l.created_at >= (
       select billing_cutoff_at from pluradash.credit_settings where id = true
     );

  if not found then
    return;
  end if;

  v_tokens := coalesce(
    v_log.total_tokens,
    coalesce(v_log.prompt_tokens, 0) + coalesce(v_log.completion_tokens, 0)
  );

  -- Unattributed logs are recorded as a zero-credit audit row, never charged.
  if v_log.user_id is null then
    insert into pluradash.ai_credit_charges
      (user_id, tenant_id, service_id, model_id, reference_type, reference_id,
       units_consumed, cost_usd, credits_charged, skip_reason)
    values
      (null, v_log.tenant_id, null, v_log.model, 'plurapi_query_log', p_log_id,
       v_tokens, coalesce(v_log.cost_usd, 0), 0, 'no_user')
    on conflict (reference_type, reference_id) do nothing;
    skip_reason := 'no_user';
    return next;
    return;
  end if;

  -- Service attribution: shell mapping first, then catalog, then coding.
  select coalesce(
           (select pm.service_id from plurapi.pluracon_models pm
             where pm.model = v_log.pluracon_model),
           (select m.service_id from pluradash.ai_models m
             where m.id = v_log.model),
           'coding'
         )
    into v_service_id;

  -- Self-healing catalog entry so the allocation FK never blocks billing.
  insert into pluradash.ai_models
    (id, service_id, name, provider, cost_per_unit, unit_type)
  values
    (v_log.model, v_service_id, v_log.model, 'openrouter', 0, 'token')
  on conflict (id) do nothing;

  select * into v_model
    from pluradash.ai_models where id = v_log.model;

  -- Prefer OpenRouter's reported cost; fall back to the per-token pricing that
  -- POST /ai/models stores on ai_models when cost_usd is absent (streaming/BYOK).
  v_cost_usd := coalesce(
    v_log.cost_usd,
    coalesce(v_log.prompt_tokens, 0) * coalesce(v_model.prompt_cost_per_token, 0)
      + coalesce(v_log.completion_tokens, 0) * coalesce(v_model.completion_cost_per_token, 0),
    0
  );

  select credits_per_usd, markup_multiplier
    into v_cpu, v_markup
    from pluradash.credit_settings where id = true;

  v_credits := case
    when v_cost_usd > 0
      then greatest(1, ceil(v_cost_usd * v_cpu * v_markup)::integer)
    else 0
  end;

  return query
    select r.charge_id, r.allocation_id, r.credits_charged,
           r.remaining_balance, null::text
      from pluradash.record_ai_cost(
        v_log.user_id, v_log.tenant_id, v_service_id, v_log.model,
        'plurapi_query_log', p_log_id, v_tokens,
        v_cost_usd, v_credits
      ) r;
end;
$$;
```

Pre-cutoff log ids return no row (the explicit operator path is intentionally closed too;
temporarily move `credit_settings.billing_cutoff_at` for a deliberate historical
backfill, then move it back).

### 5.4 `pluradash.run_credit_deduction`

The cron entry point. Replaces the draft's Deno `credit_deduction` edge function.

```sql
create or replace function pluradash.run_credit_deduction(p_batch_size integer default 200)
returns table (processed integer, skipped integer)
language plpgsql security definer set search_path = pluradash, public
as $$
declare
  v_log_id    uuid;
  v_processed integer := 0;
  v_skipped   integer := 0;
  v_result    record;
begin
  for v_log_id in
    select l.id
      from plurapi.ai_query_logs l
      left join pluradash.ai_credit_charges c
        on c.reference_type = 'plurapi_query_log'
       and c.reference_id   = l.id
     where c.id is null
       and l.status_code = 200
       and l.error is null
       -- Only bill logs created at/after the migration watermark. This also stops
       -- the job from rescanning pre-033 history every minute.
       and l.created_at >= (
         select billing_cutoff_at from pluradash.credit_settings where id = true
       )
     order by l.created_at asc
     limit greatest(coalesce(p_batch_size, 0), 0)
  loop
    begin
      select * into v_result
        from pluradash.process_query_log_deduction(v_log_id);

      if not found or v_result.skip_reason is not null then
        v_skipped := v_skipped + 1;
      else
        v_processed := v_processed + 1;
      end if;
    exception when others then
      -- Dead-letter: a zero-credit attempt row marks the log as seen, so a
      -- persistently bad log cannot block the head of the queue forever.
      insert into pluradash.ai_credit_charges
        (reference_type, reference_id, units_consumed, cost_usd,
         credits_charged, skip_reason)
      values
        ('plurapi_query_log', v_log_id, 0, 0, 0, 'error: ' || sqlerrm)
      on conflict (reference_type, reference_id) do nothing;
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return query select v_processed, v_skipped;
end;
$$;
```

Scheduling (guarded, following the existing `202609110001` pattern):

```sql
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'pluradash-credit-deduction',
      '* * * * *',
      $cron$select pluradash.run_credit_deduction(200)$cron$
    );
  else
    raise notice 'pg_cron not available; schedule pluradash.run_credit_deduction manually';
  end if;
end $$;
```

No HTTP, no service-role key in a cron command, no edge-function deployment.

**Schedule and throughput.** The job runs every 60 seconds (`* * * * *`) and processes at
most `p_batch_size` (default 200) logs per tick, oldest first. That is a ceiling of about
200 logs/minute; raise the batch size (or add a second offset schedule) if peak traffic
exceeds it. End-to-end billing lag is normally **under a minute**, plus any backlog. The
only timing gate is `billing_cutoff_at`, which excludes pre-migration logs.

**Transaction shape.** `run_credit_deduction` is one PL/pgSQL function, so a batch is one
transaction. Without the per-log `EXCEPTION` block above, one malformed log would roll
back the whole batch and the next tick would start at the same oldest log — head-of-line
blocking. The block records a zero-credit `skip_reason = 'error: …'` row instead, which the
scan’s `LEFT JOIN ai_credit_charges` then treats as processed.

**Locking.** Wallet rows are locked `FOR UPDATE` for the life of the batch. Dashboard reads
and `can_use_service` use MVCC and do not block; a concurrent top-up waits only for the
batch to commit. Keeping batches small keeps that wait short. If batch-level lock duration
ever becomes a problem, a `PROCEDURE` with a `COMMIT` per log is the next step, but it is
not needed for the expected volume.

### 5.5 `pluradash.can_use_service`

```sql
create or replace function pluradash.can_use_service(
  p_user_id     uuid,
  p_service_id  text
)
returns boolean
language sql stable security definer set search_path = pluradash, public
as $$
  select exists (
    select 1
      from pluradash.user_service_provisions p
     where p.user_id = p_user_id
       and p.service_id = p_service_id
       and p.is_enabled
  );
$$;
```

**No balance gate in 033.** A negative balance does not make this return `false`; access
is decided by the entitlement (`is_enabled`) only. This is deliberate post-paid behaviour:
the UI shows the negative balance and the operator/user decides what to do. A hard stop at
zero is a future policy and can be added by joining `ai_credit_wallets` and comparing
`balance >= 0` here.

### 5.6 Function privileges (required)

Postgres grants `EXECUTE` on new functions to `PUBLIC` by default, and `003` exposes the
`pluradash` schema to PostgREST. Without the following, any authenticated browser session
could call `POST /rest/v1/rpc/grant_credits` and mint credits for itself.

```sql
revoke execute on function pluradash.grant_credits(uuid, integer, text, text, jsonb, uuid)
  from public, anon, authenticated;
revoke execute on function pluradash.record_ai_cost(uuid, uuid, text, text, text, uuid, numeric, numeric, integer)
  from public, anon, authenticated;
revoke execute on function pluradash.process_query_log_deduction(uuid)
  from public, anon, authenticated;
revoke execute on function pluradash.run_credit_deduction(integer)
  from public, anon, authenticated;
revoke execute on function pluradash.can_use_service(uuid, text)
  from public, anon, authenticated;

grant execute on function pluradash.grant_credits(uuid, integer, text, text, jsonb, uuid)
  to service_role;
grant execute on function pluradash.record_ai_cost(uuid, uuid, text, text, text, uuid, numeric, numeric, integer)
  to service_role;
grant execute on function pluradash.process_query_log_deduction(uuid)
  to service_role;
grant execute on function pluradash.run_credit_deduction(integer)
  to service_role;
grant execute on function pluradash.can_use_service(uuid, text)
  to service_role;
```

Operational consequences:

- Plugin routes (`/ai/provision`, `/ai/models`, transcription pre-flight) must use
  `createSupabaseAdminClient` for these RPCs, not the caller-JWT client.
- The `032` trigger functions call `grant_credits` as their **owner** (`SECURITY
  DEFINER`), so the revoke does not break account/role provisioning.
- `pg_cron` runs the job as the role that scheduled it (normally `postgres`, which owns
  the functions in a Supabase migration). If your deployment schedules as another role,
  grant `EXECUTE` on `run_credit_deduction` to that role as well.
- For self-hosted databases that do not define the Supabase roles `anon`,
  `authenticated` or `service_role`, wrap the `REVOKE`/`GRANT` statements in a
  `pg_roles` existence check so the migration does not abort.

> **“Exposed” is not “public”.** `pluradash` must be exposed to PostgREST for the
> plugin’s table access, so the RPC names may appear in the schema’s OpenAPI listing.
> The security boundary is `EXECUTE`: without the grants above, `anon` and
> `authenticated` receive 401/403. `pg_cron` calls `pluradash.run_credit_deduction()`
> directly inside the database, not over HTTP, so it does not need the schema to be
> exposed at all. For stricter isolation, move the cron-only functions
> (`run_credit_deduction`, `process_query_log_deduction`) into a non-exposed
> `pluradash_internal` schema and keep only the API-facing RPCs (`grant_credits`,
> `record_ai_cost`, `can_use_service`) in `pluradash`.

---

## 6. Replace the `032` provisioning triggers

The original `032` functions use `ON CONFLICT (user_id)`, which requires the unique index
this plan drops. They are replaced in the same migration, before the index is dropped:

```sql
drop trigger if exists trg_ai_credits_user_profile on public.user_profile;
drop trigger if exists trg_ai_credits_user_roles   on public.user_roles;

drop function if exists pluradash.fn_provision_ai_credits_default();
drop function if exists pluradash.fn_provision_ai_credits_support();

create or replace function pluradash.fn_provision_ai_credits_default()
returns trigger
language plpgsql security definer set search_path = pluradash, public
as $$
begin
  perform pluradash.grant_credits(
    new.user_id, 0, 'auto-default',
    'auto-default:' || new.user_id::text, '{}'::jsonb, null
  );
  return new;
end;
$$;

create or replace function pluradash.fn_provision_ai_credits_support()
returns trigger
language plpgsql security definer set search_path = pluradash, public
as $$
declare
  v_role text;
begin
  select r.name into v_role from public.roles r where r.id = new.role_id;
  if v_role = 'support' then
    -- Preserve the 032 rule: a manual adjustment is never overwritten by the
    -- automatic support grant.
    if exists (
      select 1 from pluradash.ai_credit_provisions
       where user_id = new.user_id and source = 'manual'
    ) then
      return new;
    end if;
    perform pluradash.grant_credits(
      new.user_id, 1000, 'auto-support',
      'auto-support:' || new.user_id::text,
      jsonb_build_object('trigger', 'user_roles'), null
    );
  end if;
  return new;
end;
$$;

create trigger trg_ai_credits_user_profile
after insert on public.user_profile
for each row execute function pluradash.fn_provision_ai_credits_default();

create trigger trg_ai_credits_user_roles
after insert on public.user_roles
for each row execute function pluradash.fn_provision_ai_credits_support();
```

The trigger functions run as their owner, so the `REVOKE EXECUTE` from `authenticated` in
§5.6 does not affect provisioning.

Then drop the old index and create the ledger index:

```sql
drop index if exists pluradash.ai_credit_provisions_user_id_key;

create unique index if not exists idx_ai_credit_provisions_idempotency
  on pluradash.ai_credit_provisions (idempotency_key);

create index if not exists idx_ai_credit_provisions_user_created
  on pluradash.ai_credit_provisions (user_id, created_at desc);
```

---

## 7. Server surface (plugin Hono routes, not edge functions)

All new handlers live in `plugins/pluradash/api/` and are mounted in
`plugins/pluradash/api/index.ts`. Auth uses `requireAnyJwtRole` from
`../../../api/lib/auth` (roles come from the verified `user_roles` claim).

### 7.1 `POST /api/plugin/pluradash/ai/provision`

Body:

```ts
{
  target_user_id?: string;          // super-admin only
  grant_packages?: string[];        // super-admin only
  topup_credits?: number;           // super-admin only
  topup_source?: 'manual' | 'backfill' | 'stripe' | 'topup';
  idempotency_key?: string;
}
```

Behaviour:

1. Authenticate; resolve the caller from claims.
2. Non-admin callers may only provision themselves and cannot pass top-ups/grants.
3. Resolve the **target role from `public.user_roles`/`public.roles`**, never from
   metadata.
4. If the target is not `support`/`super-admin`, disable provisions with
   `disabled_reason = 'role_required'` and return.
5. Call `pluradash.grant_credits(...)` with `auto-support:<user_id>` (idempotent)
   using `createSupabaseAdminClient` (§5.6).
6. Optional admin top-up uses `grant_credits` with the supplied idempotency key.
7. Upsert default packages (`packages.is_default_for_role = true` **and**
   `packages.required_role = <target role>`) and `grant_packages`.
8. Resolve active `user_packages` → `package_services` → upsert
   `user_service_provisions`. Enabling is decided by **entitlement only** (role/package),
   not by the wallet balance: a negative balance must not revoke or refuse to provision a
   service in 033.
9. Return `{ user_id, role, balance, below_threshold, services }`, where `balance` may be
   negative and `below_threshold` is informational only.

**Preserve overrides.** The `user_service_provisions` upsert MUST NOT overwrite rows with
`source = 'plugin_store'` or `disabled_reason = 'manual'`. Use a conditional
`ON CONFLICT ... DO UPDATE ... WHERE` (or filter the payload):

```sql
insert into pluradash.user_service_provisions as usp
  (user_id, service_id, is_enabled, source, disabled_reason, updated_at)
values
  (p_user_id, p_service_id, p_enabled, 'package', p_disabled_reason, now())
on conflict (user_id, service_id) do update
  set is_enabled      = excluded.is_enabled,
      source          = excluded.source,
      disabled_reason = excluded.disabled_reason,
      updated_at      = now()
  where usp.source <> 'plugin_store'
    and usp.disabled_reason is distinct from 'manual';
```

The dashboard calls this on `AiPage` load for support users (once per session) so runtime
entitlements exist without an extra login hook.

### 7.2 `POST /api/plugin/pluradash/ai/models` (super-admin)

Body: `{ shell?, openrouter_model, service_id?, provider?, fallback_model?, manual_* }`.

1. `requireAnyJwtRole(c, ['super-admin'])`.
2. Fetch live pricing/context from OpenRouter (keep the existing
   `fetchOpenRouterModelInfo` logic, including `:nitro|:floor|:exacto` suffix stripping).
3. Upsert the concrete model into `pluradash.ai_models` (`onConflict: 'id'`) with
   per-token pricing and `metadata`.
4. If `shell` is supplied, update the mapping in `plurapi.pluracon_models` **through the
   documented service-role contract** (`service_id`, `openrouter_model`, `fallback_model`,
   `metadata`, `updated_by`). The table remains PluraPi-owned; the write is the single
   sanctioned cross-schema runtime write and is logged. This requires the `plurapi`
   schema to be in Supabase’s exposed-schemas list (`specs/platform/plurapi.md` §2.3).
5. Without `shell`, only the catalog is written — used for embeddings, transcription and
   future parallel services.

### 7.3 `GET /api/plugin/pluradash/ai/credits`

Now reads:

- `pluradash.ai_credit_wallets` (balance, lifetime counters),
- `pluradash.ai_credit_provisions` (ledger, ordered by `created_at desc`),
- `pluradash.ai_credit_charges` (usage attribution),
- `public.user_profile` (display names).

The response keeps `creditsPerDollar`, `supportDefaultCredits`, `users[]` and
`unattributedCost` for backward compatibility with the existing admin/usage views, adds
per-user `balance`, `lifetimeCredited`, `lifetimeSpent`, and a `ledger[]` array.
`creditsRemaining` becomes the wallet balance and **may be negative**.

> **User-facing contract:** the payload returned to a non-admin caller is credits-only.
> `creditsPerDollar`, `unattributedCost`, and any per-user `costIncurred` are
> **internal/back-compat fields** and must not be rendered by `AiPage` (§8). The dollar
> view stays available to `super-admin` for operator reporting; it is not a user metric.

RLS decides visibility (§11): a caller sees their own wallet/ledger; `super-admin` sees
all; tenant admins may read `ai_credit_charges` scoped to their tenant. `support` is a
paid-customer role and no longer grants cross-user reads.

If non-support tenant admins need access, the route gate must check
`public.is_tenant_admin(tenantId)` in addition to `requireAnyJwtRole(['support',
'super-admin'])`; the RLS policy already supports it.

### 7.4 Admin account provisions API (super-admin)

New super-admin-only routes, implemented in `plugins/pluradash/api/aiAdmin.ts` and mounted
in `plugins/pluradash/api/index.ts`. Every handler starts with
`requireAnyJwtRole(c, ['super-admin'])` and uses `createSupabaseAdminClient` for the
writes (the service role bypasses RLS; the browser never writes provisioning tables).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/plugin/pluradash/admin/ai/accounts?search=&page=&limit=` | Account list with role, wallet balance, packages and per-service provisions |
| `GET` | `/api/plugin/pluradash/admin/ai/accounts/:userId` | One account: wallet, grant ledger, charge history, packages, provisions |
| `PUT` | `/api/plugin/pluradash/admin/ai/accounts/:userId/services/:serviceId` | Set `is_enabled`, `disabled_reason`, `source` on `user_service_provisions` |
| `PUT` | `/api/plugin/pluradash/admin/ai/accounts/:userId/packages/:packageId` | Grant/revoke a package (`user_packages.status`) |
| `POST` | `/api/plugin/pluradash/admin/ai/accounts/:userId/credits` | Grant/top-up through `pluradash.grant_credits` (same idempotency rules) |

Rules:

- Editing a provision does **not** touch the wallet; `is_enabled` is authoritative for
  `can_use_service` (§5.5).
- A manual edit sets `source = 'manual'`. `POST /ai/provision` preserves manual
  `disabled_reason` and `plugin_store` sources (§7.1), so an admin override survives the
  user’s next self-provisioning call.
- Granting/revoking a package re-resolves `package_services` into
  `user_service_provisions` with the same conditional upsert as §7.1; it never overwrites a
  manual/plugin-store row.
- A top-up goes through `grant_credits`, so `balance = lifetime_credited - lifetime_spent`
  and the append-only grant ledger stay consistent; the wallet may be negative before the
  top-up and is never clamped.
- Every write updates `updated_at` and is logged through the plugin `agentLogger`
  (actor, target user, service/package, before → after).
- Balances in responses are **credits only** (signed); no currency or conversion fields,
  matching §0.2.

---

## 8. Frontend changes

All user-facing text remains German (`AGENTS.md` §3).

### 8.1 Core extension point: plugin sections on `/admin/accounts` (core change)

There is no plugin slot on `/admin/accounts` today; `PluginDefinition.adminSections`
renders only on `/admin/connections`
(`src/pages/VerwaltungConnections.tsx`, `src/plugins/loader.ts`). Add one:

1. In `src/types/plugin.ts`, generalise the section type: rename
   `PluginAdminConnectionSection` → `PluginAdminSection` (keep the old name as a type
   alias if other plugins import it) and add:
   - `page?: 'connections' | 'accounts'` — default `'connections'` so existing plugin
     manifests keep working;
   - `requiredRole?: string` — e.g. `'super-admin'`.
   Keep `PluginDefinition.adminSections?: PluginAdminSection[]` as the manifest field.
2. In `src/plugins/loader.ts`, expose
   `getPluginAdminSections(page, userRoles): PluginAdminSection[]` (extend the existing
   `getPluginAdminConnectionSections` to filter on `page` and `requiredRole`).
3. In `src/pages/VerwaltungAccounts.tsx`, render the `page: 'accounts'` sections as a
   **super-admin-only tab/card** inside the existing Accounts/Roles/Tenants tab set,
   visible only when `permissions.userRoles.includes('super-admin')`.
4. `src/pages/VerwaltungConnections.tsx` keeps rendering `page: 'connections'` (or the
   default) exactly as today.

Document the new hook target in **`specs/agents/plugin-hooks.md`** (§2 dispatch table)
with target name, scope, kind, dispatch point, context shape and status. The currently
inert `admin.connections.sections` collector (`api/lib/adminConnectionHooks.ts`) may be
wired in the same core change or left as-is; the manifest field remains the rendering
mechanism either way.

> **This is a core change** (core files `src/types/plugin.ts`, `src/plugins/loader.ts`,
> `src/pages/VerwaltungAccounts.tsx`, `src/pages/VerwaltungConnections.tsx`). It needs its
> own `specs/changes/` entry and the `specs/agents/plugin-hooks.md` update, separate from
> the plugin change record.

### 8.2 `AiPage` (user-facing, credits only)

`plugins/pluradash/src/pages/AiPage.tsx`:

- wallet card: **credits only** — `balance`, `lifetime_credited`, `lifetime_spent`;
- **no currency rendering**: no `$`, `€`, `costIncurred`, `creditsPerDollar`, and no
  conversion copy such as “10 $ = 1.000 Credits”. The user sees a credit counter, not a
  billing statement;
- **negative balances are shown as-is**, e.g. `Guthaben: −250 Credits` (German), with a
  neutral informational note. No red-alert styling that implies a block, because 033 does
  not block on a negative balance;
- ledger list (grants/top-ups with source and date), credits only;
- **no automatic action**: no auto-disable, no auto top-up, no forced modal. If the
  balance is below `low_balance_threshold`, show a passive hint only. Any top-up is an
  explicit user or admin action;
- the page never calls `POST /ai/provision` in a way that changes balances; the existing
  once-per-session provisioning call only ensures entitlements exist.

### 8.3 Admin account services section (plugin)

`plugins/pluradash/src/pages/admin/AiAccountProvisionsSection.tsx`, registered in
`plugins/pluradash/src/index.tsx`:

```ts
adminSections: [
  {
    id: 'pluradash-ai-services',
    title: 'KI-Dienste',
    component: AiServicesAdminSection,
    page: 'connections',
    order: 200,
  },
  {
    id: 'pluradash-ai-account-provisions',
    title: 'KI-Dienste je Konto',
    description: 'Provisionierte KI-Dienste, Pakete und Credits je Benutzerkonto verwalten',
    component: AiAccountProvisionsSection,
    page: 'accounts',
    requiredRole: 'super-admin',
    order: 210,
  },
],
```

The component:

- searchable, paginated account list (`GET …/admin/ai/accounts`);
- per account: role, wallet balance in **credits** (negative shown as-is), package
  badges, and one row per service with an enable/disable switch plus a `disabled_reason`
  selector (`insufficient_credits`, `role_required`, `package_revoked`, `manual`);
- package grant/revoke and an explicit credits top-up (super-admin action, via
  `grant_credits`);
- no currency, no conversion copy; credits only (§0.2);
- all writes go through the §7.4 routes; the browser never writes the provisioning
  tables directly.

### 8.4 Admin model/services section

`plugins/pluradash/src/pages/admin/AiServicesAdminSection.tsx` (unchanged scope):

- shell selector (`pluracon/architekt`, `pluracon/arbeiter`, `pluracon/kreativ`), active
  OpenRouter model, fallback;
- parallel-service model registration (embeddings/transcription);
- super-admin only.

### 8.5 Service client

`plugins/pluradash/src/services/pluradashService.ts`:

- `fetchAiCredits()` (updated credits-only shape),
- `provisionAiServices()`,
- `fetchAiModels()`, `setAiModel()`,
- new: `fetchAiAccounts()`, `fetchAiAccount(userId)`, `updateAiAccountService(...)`,
  `updateAiAccountPackage(...)`, `grantAiAccountCredits(...)`.

---

## 9. Runtime integration

### 9.1 PluraPi pre-flight (PluraPi repository)

Before proxying a request, the PluraPi sessions Worker calls:

```json
supabase.schema('pluradash').rpc('can_use_service', {
  p_user_id: "<sub>",
  p_service_id: "coding"
})
```

`false` → HTTP `402 Payment Required` because the service was **explicitly revoked** for
this user (a `user_service_provisions` row with `is_enabled = false`). A missing row is
**not** a revocation: `can_use_service` returns `true` when no row exists, so a deploy
without assigned entitlements cannot lock everyone out. On RPC error, fail open and log —
a transient DB error must not become an outage. A negative credit balance does **not**
return `false` in 033; the UI shows it and the user/admin decides. The Worker already has
the service key; the RPC is `SECURITY DEFINER` and safe to call.

### 9.2 isibot / transcription (plugin)

`plugins/pluradash/api/transcriptionService.ts`:

1. Resolve the billing user: explicit caller `user_id` when present, otherwise the tenant
   owner from `public.tenants.default_for_user_id` (fallback `public.tenants.created_by`),
   otherwise the oldest active `public.tenant_users` row with `is_tenant_admin = true`.
   > There is no `tenants.owner_id` column; only `default_for_user_id` and `created_by`
   > exist (`202605240001`/`202605240002`).
2. Call `pluradash.can_use_service(user, 'transcription')` via
   `createSupabaseAdminClient` (the RPC is service-role only, §5.6). In 033 this checks
   the entitlement only; a negative balance does **not** block transcription. Only an
explicit `is_enabled = false` row returns `false`; a missing row is treated as allowed
   (grandfathered) and an RPC error fails open, so the pre-flight cannot cause an outage.
   The isibot connector passes `{ tenantId, userId: ownerUserId }` as the billing context.
3. Bill through `pluradash.record_ai_cost(...)` with
   `reference_type = 'isibot_recording'`, `reference_id = recording_id`. The debit is
   post-paid and may push the wallet negative.
4. Read `credits_per_usd` / `markup_multiplier` inside the RPC from
   `pluradash.credit_settings`; never hardcode conversion rates in TypeScript.

This is the change that keeps the wallet and `ai_allocations` from drifting.

### 9.3 Deduction job

`pg_cron` calls `pluradash.run_credit_deduction(200)` every minute. The function is
idempotent per log via `ai_credit_charges (reference_type, reference_id)`. A backlog
larger than one batch continues on the next tick.

### 9.4 Reconciliation query (operational)

```sql
-- balance must equal credited - spent
select w.user_id,
       w.balance,
       w.lifetime_credited,
       w.lifetime_spent,
       w.lifetime_credited - w.lifetime_spent as expected_balance
  from pluradash.ai_credit_wallets w
 where w.balance <> w.lifetime_credited - w.lifetime_spent;

-- credited must equal the grant ledger
select p.user_id, sum(p.credits_total) as ledger_credited, w.lifetime_credited
  from pluradash.ai_credit_provisions p
  join pluradash.ai_credit_wallets w on w.user_id = p.user_id
 group by p.user_id, w.lifetime_credited
having sum(p.credits_total) <> w.lifetime_credited;
```

Historical spend (pre-033) is seeded into `lifetime_spent`; `ai_credit_charges` is the
forward audit. Both invariants hold from migration 033 onward.

---

## 10. Backfill (inside migration 033)

```sql
-- One legacy grant per existing provision row (already done in §4.2 via idempotency_key).
-- Seed wallets from the old provisioned maximum minus historical derived spend.
-- No capping: the wallet is post-paid, so historical overage carries over as a
-- NEGATIVE opening balance. `balance = credited - spent` must hold literally.
with hist as (
  select p.user_id,
         sum(p.credits_total)::integer as credited,
         coalesce(round(sum(a.cost_incurred) * 100), 0)::integer as raw_spent
    from pluradash.ai_credit_provisions p
    left join pluradash.ai_allocations a on a.user_id = p.user_id
   group by p.user_id
)
insert into pluradash.ai_credit_wallets
  (user_id, balance, lifetime_credited, lifetime_spent)
select user_id,
       credited - raw_spent,
       credited,
       raw_spent
  from hist
on conflict (user_id) do nothing;
```

The backfill is idempotent (`on conflict do nothing`) and runs in the same transaction as
the schema changes, before any new grants, so `sum(credits_total)` is exactly the legacy
grant. Historical overage is **not forgiven**: it seeds a negative opening balance so the
post-paid model is visible from day one. `lifetime_spent` is therefore not capped at
`lifetime_credited`; the `balance = lifetime_credited - lifetime_spent` invariant holds
by construction.

Not backfilling `ai_credit_charges` is safe because `billing_cutoff_at` prevents the cron
from billing pre-033 `plurapi.ai_query_logs`.

---

## 11. RLS

```sql
alter table pluradash.packages               enable row level security;
alter table pluradash.package_services       enable row level security;
alter table pluradash.user_packages          enable row level security;
alter table pluradash.user_service_provisions enable row level security;
alter table pluradash.ai_credit_wallets      enable row level security;
alter table pluradash.ai_credit_charges      enable row level security;
alter table pluradash.credit_settings        enable row level security;
```

Policies (each `drop policy if exists` first):

- `packages`, `package_services`, `credit_settings`, `ai_services`, `ai_models`:
  `SELECT` for `authenticated` (`using (true)`); writes for `public.is_super_admin()`.
- `user_packages`, `user_service_provisions`, `ai_credit_wallets`: **owner or
  super-admin only**. `support` is a paid-customer role and must not read another user’s
  balance, package list or entitlements.
  ```sql
  using (user_id = public.current_user_id() or public.is_super_admin())
  ```
- `ai_credit_charges`: owner, super-admin, or tenant admin scoped to `tenant_id` (the
  table carries `tenant_id`, so workspace admins can see their workspace’s spend without
  seeing another tenant’s):
  ```sql
  using (
    user_id = public.current_user_id()
    or public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  )
  ```
- `ai_credit_provisions`: drop `032`’s support cross-user read policy; replace with
  owner + super-admin. Keep the super-admin write policy for manual repair.
  ```sql
  drop policy if exists "support/super-admin can read ai_credit_provisions"
    on pluradash.ai_credit_provisions;
  drop policy if exists "owner can read own ai_credit_provisions"
    on pluradash.ai_credit_provisions;
  create policy "owner/super-admin can read ai_credit_provisions"
    on pluradash.ai_credit_provisions for select to authenticated
    using (user_id = public.current_user_id() or public.is_super_admin());
  ```
- `ai_allocations`: drop the existing `pluradash support can read all ai_allocations`
  policy (same leak) and keep/replace it with tenant-scoped reads:
  ```sql
  drop policy if exists "pluradash support can read all ai_allocations" on pluradash.ai_allocations;

  -- existing tenant-members policy stays; add tenant-admin + super-admin reads
  create policy "pluradash tenant admins can read ai_allocations"
    on pluradash.ai_allocations for select to authenticated
    using (public.is_tenant_admin(tenant_id));

  create policy "super-admin can read ai_allocations"
    on pluradash.ai_allocations for select to authenticated
    using (public.is_super_admin());
  ```

No authenticated `INSERT/UPDATE/DELETE` policies exist on the wallet/ledger tables: only
the `SECURITY DEFINER` RPCs (service-role execution, §5.6) mutate balances.

`003_grant_schema_access.sql` already grants schema `USAGE` and table DML; RLS is what
restricts access. New tables created after `003` inherit the `ALTER DEFAULT PRIVILEGES`
grants, so RLS must be enabled in the same migration.

> **Note:** the existing `ai_allocations` tenant-member policy still lets any member of a
> workspace read the workspace’s allocations. That is a tenant-scoped read and is kept;
> only the cross-tenant `support` read is removed.

---

## 12. Migration files and registration

### 12.1 Plugin migration

- Add `plugins/pluradash/migrations/033_ai_services_wallets.sql`.
- Add `plugins/pluradash/migrations/down/033_ai_services_wallets.sql`.
- Register `migrations/033_ai_services_wallets.sql` in
  `plugins/pluradash/plugin.json` → `migrations` (after `032`).

Idempotency requirements (validated by `install-plugins.mjs`):

- `create table if not exists`, `add column if not exists`, `create index if not exists`;
- `drop trigger if exists` + `create trigger`;
- `create or replace function`;
- guarded `pg_cron` scheduling;
- no `001_` filename (next free number is `033`).

The migration must apply these steps in the order shown:

1. **Top of file — verify the PluraPi prerequisite** (read-only check, no `plurapi`
   DDL):

   ```sql
   do $$
   begin
     if not exists (
       select 1 from information_schema.columns
        where table_schema = 'plurapi'
          and table_name   = 'pluracon_models'
          and column_name  = 'service_id'
     ) then
       raise exception
         'manual PluraPi script migrations/plurapi/0014_pluracon_model_services.sql must be applied before pluradash 033';
     end if;
   end $$;
   ```

2. **Before the RPCs — replace the `032` triggers/functions** (§6) and **widen
   `ai_credit_provisions_source_check`** (§4.2). `billing_cutoff_at` is part of the
   `credit_settings` table definition (§4.1) and defaults to migration time.
3. **Before the RPCs — seed `ai_services` (`coding`, `planning`) and packages** (§4.4),
   because `process_query_log_deduction` uses those ids as FKs.
4. **After all functions are created — `REVOKE`/`GRANT`** (§5.6). Without this the
   migration is a privilege-escalation hole.
5. **End — schedule the cron job** (guarded by `pg_cron` existence).

### 12.2 Down migration

`down/033_ai_services_wallets.sql` must (in this order):

1. Unschedule `pluradash-credit-deduction` when `pg_cron` exists.
2. Drop the new trigger functions and their triggers, then restore the `032` versions
   (one-row-per-user `ON CONFLICT (user_id)`). Do this **before** collapsing the ledger
   so no trigger fires during the rewrite.
3. Collapse the ledger back to one row per user before restoring the `032` contract:
   ```sql
   create table pluradash._provisions_collapsed as
   select user_id, sum(credits_total)::integer as credits_total,
          (array_agg(source order by created_at desc))[1] as source,
          max(created_at) as created_at, now() as updated_at
     from pluradash.ai_credit_provisions
    group by user_id;

   delete from pluradash.ai_credit_provisions;
   insert into pluradash.ai_credit_provisions
     (user_id, credits_total, source, created_at, updated_at)
   select user_id, credits_total, source, created_at, updated_at
     from pluradash._provisions_collapsed;
   drop table pluradash._provisions_collapsed;

   create unique index if not exists ai_credit_provisions_user_id_key
     on pluradash.ai_credit_provisions (user_id);

   -- Map post-033 sources back into the 032 vocabulary before narrowing the check.
   update pluradash.ai_credit_provisions
      set source = 'manual'
    where source not in ('auto-default', 'auto-support', 'backfill', 'manual');

   -- Narrow the source check back to the 032 values.
   alter table pluradash.ai_credit_provisions
     drop constraint if exists ai_credit_provisions_source_check;
   alter table pluradash.ai_credit_provisions
     add constraint ai_credit_provisions_source_check
     check (source in ('auto-default', 'auto-support', 'backfill', 'manual'));
   ```
4. Drop the new functions (`grant_credits`, `record_ai_cost`,
   `process_query_log_deduction`, `run_credit_deduction`, `can_use_service`).
5. Drop the new tables (`ai_credit_charges`, `ai_credit_wallets`, `credit_settings`,
   `user_service_provisions`, `user_packages`, `package_services`, `packages`).
   `credit_settings` carries `billing_cutoff_at`.
6. Drop `idempotency_key`, `metadata`, `granted_by` and the ledger indexes.
7. Drop the added columns on `ai_services`, `ai_models`, `ai_allocations`.
8. Restore the pre-033 RLS policies that were tightened:
   - re-create the `support` cross-user read policy on `ai_credit_provisions` (and the
     owner policy);
   - re-create `pluradash support can read all ai_allocations` and drop the new
     tenant-admin/super-admin policies if they did not exist before.

Document the down migration as **lossy** (per-grant history collapses into one balance,
and historical overage that was forgiven at 033 is not recoverable).

### 12.3 PluraPi manual migration (unregistered)

- Added: `migrations/plurapi/0014_pluracon_model_services.sql`
- Added: `migrations/plurapi/down/0014_pluracon_model_services.sql`
- Added: `migrations/plurapi/README.md`

The new `migrations/plurapi/` folder is **outside the automated migration flow**:

- not listed in `scripts/lib/migration-order.mjs`;
- not read by `tests/coreMigrations.test.mjs` (it reads only the ordered list);
- not applied by `scripts/setup.mjs` / `scripts/update.mjs`.

It is applied manually by the operator (Supabase SQL Editor) and recorded in the change
record. This mirrors the existing manual `migrations/Auth/` folder.

---

## 13. Files added / changed (implementation checklist)

Plugin (separate repository `plugins/pluradash`):

- Added: `migrations/033_ai_services_wallets.sql`
- Added: `migrations/down/033_ai_services_wallets.sql`
- Added: `api/aiAdmin.ts` (set_model, provisioning and admin account handlers)
- Changed: `api/index.ts` (mount `/ai/models`, `/ai/provision`, `/admin/ai/accounts*`;
  update `/ai/credits`)
- Changed: `api/aiCredits.ts` (wallet + ledger reads)
- Changed: `api/aiCreditMath.ts` (wallet math, `ceil` + settings)
- Changed: `api/aiCostTracking.ts` (route through `record_ai_cost`)
- Changed: `api/transcriptionService.ts` (pre-flight `can_use_service`)
- Changed: `plugin.json` (migration, `api_metadata` routes incl. admin account routes,
  capability description, `hook_metadata`)
- Added: `src/pages/admin/AiAccountProvisionsSection.tsx` (super-admin account
  provisions editor)
- Changed: `src/index.tsx` (register the `page: 'accounts'` admin section)
- Changed: `src/services/pluradashService.ts`
- Changed: `src/pages/AiPage.tsx` (credits-only rendering, negative balance display,
  no currency or conversion copy)
- Changed: `src/pages/admin/AiServicesAdminSection.tsx`

### 13.1 Core change (admin accounts extension point)

This plan now contains **one core change** (see §8.1). It must ship with its own
`specs/changes/` entry and the hook-doc update:

- Changed: `src/types/plugin.ts` (`PluginAdminSection`, `page`, `requiredRole`)
- Changed: `src/plugins/loader.ts` (`getPluginAdminSections(page, userRoles)`)
- Changed: `src/pages/VerwaltungAccounts.tsx` (render `page: 'accounts'` sections,
  super-admin only)
- Changed: `src/pages/VerwaltungConnections.tsx` (filter to `page: 'connections'`)
- Changed: `specs/agents/plugin-hooks.md` (new server-side/UI dispatch target)
- Added: `specs/changes/YYYY-MM-DD-admin-account-plugin-sections.md`

Tests (core repo):

- Changed: `tests/pluradashAiCredits.test.mjs`
- Added: pure-logic tests for credit math rounding, shell→service mapping,
  provision eligibility, and admin account API authorization (super-admin vs others).
- Added: loader test that `getPluginAdminSections('accounts', ['super-admin'])` returns
  the account section and hides it from non-super-admins.

Core repo — manual PluraPi SQL (unregistered, applied by hand):

- Added: `migrations/plurapi/0014_pluracon_model_services.sql`
- Added: `migrations/plurapi/down/0014_pluracon_model_services.sql`
- Added: `migrations/plurapi/README.md`

PluraPi repository (engine code only):

- Changed: engine/Worker pre-flight to call `pluradash.can_use_service`.

Core repo documentation:

- Changed: `specs/plans/README.md` (entry for this plan)
- Changed: `specs/agents/plugin-hooks.md` (core extension point, §8.1)
- Added when implemented: `specs/changes/YYYY-MM-DD-pluradash-ai-services-wallets.md`
  (plugin) and `specs/changes/YYYY-MM-DD-admin-account-plugin-sections.md` (core)

The plugin change itself modifies no core implementation files. The separate core change
in §13.1 does, and is documented independently.

---

## 14. Rollout

1. Snapshot the database (`specs/platform/db-snapshots.md`).
2. Apply `migrations/plurapi/0014_pluracon_model_services.sql` manually via the Supabase
   SQL Editor (it is **not** part of the setup/update migration flow). Apply it **before**
   plugin `033`, which asserts the `service_id` column exists.
3. Apply plugin `033` (single transaction), which replaces the `032` triggers before
   dropping the unique index and backfills wallets.
4. Verify:
   ```sql
   select count(*) from pluradash.ai_credit_wallets;
   select * from pluradash.run_credit_deduction(0);   -- no-op
   select billing_cutoff_at from pluradash.credit_settings where id = true;

   -- no pre-cutoff log may gain a charge row
   select count(*) from plurapi.ai_query_logs l
     join pluradash.ai_credit_charges c
       on c.reference_type = 'plurapi_query_log' and c.reference_id = l.id
    where l.created_at < (select billing_cutoff_at from pluradash.credit_settings where id = true);

   -- reconciliation queries from §9.4
   ```
   Also verify the privilege fix from a browser-equivalent JWT:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST "$SUPABASE_URL/rest/v1/rpc/grant_credits" \
     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" \
     -H 'Content-Type: application/json' \
     -d '{"p_user_id":"<user>","p_credits":1000000,"p_source":"manual"}'
   # expected: 401/403, never 200
   ```
   Repeat for `/rest/v1/rpc/run_credit_deduction` and
   `/rest/v1/rpc/process_query_log_deduction`; neither may be callable with a user JWT.
   The cron path is the in-database call, not that endpoint.
5. Deploy the core change from §8.1/§13.1 (the `/admin/accounts` plugin section slot and
   the `PluginAdminSection.page`/`requiredRole` fields) **before** the plugin build that
   declares `page: 'accounts'`. Verify a non-super-admin does not see the new section and
   a super-admin does.
6. Deploy the Worker with the updated plugin routes/UI (including the §7.4 admin account
   routes and the §8.3 section).
7. Enable/schedule `pluradash.run_credit_deduction` (migration already does this when
   `pg_cron` exists).
8. Call `POST /ai/provision` for existing support users (or let the dashboard do it)
   so entitlements exist.
9. Update the PluraPi engine to call `can_use_service` before inference; ship the 402
   handling with the dashboard release.
10. Smoke the super-admin interface: open `/admin/accounts` → KI-Dienste, search an
    account, toggle a service, grant a package, and grant credits; confirm the user-facing
    `AiPage` reflects the credit change and that a manual disable survives the user’s next
    provisioning call.

Rollback:

1. Pause the cron (`cron.unschedule('pluradash-credit-deduction')`).
2. Revert the PluraPi engine pre-flight.
3. Run `down/033` (lossy ledger collapse) and, manually,
   `migrations/plurapi/down/0014_pluracon_model_services.sql`. The `migrations/plurapi/`
   scripts are not part of the automated down flow either.
4. Redeploy the previous Worker.

---

## 15. Tests and quality gates

Before handoff (see `.pi/skills/tests/SKILL.md`):

1. `npm run typecheck` → 0 (plugin frontend files included).
2. `npm test` → green, including updated `tests/pluradashAiCredits.test.mjs`.
3. `npm run build` → succeeds (`prebuild` regenerates plugin registries).
4. Migration idempotency: run `033` twice against a local database.
5. SQL invariants: `balance = lifetime_credited - lifetime_spent`; ledger sum matches
   `lifetime_credited`; duplicate `run_credit_deduction` does not double-charge.
6. API smoke: `POST /ai/provision` (self and admin target), `POST /ai/models`
   (super-admin 200, support 403), `GET /ai/credits` (owner + support).
7. Manual smoke in `npm run dev`: AiPage wallet shows credits only (no `$`/`€`, no
   conversion copy), a negative balance renders as a negative credit number, and the
   admin model switch works; check the browser console for runtime errors.
8. PluraPi: apply `migrations/plurapi/0014_pluracon_model_services.sql` twice
   (idempotent), verify the engine pre-flight 402 path, and a real billed query row in
   `ai_query_logs` → one `ai_credit_charges` row → one `ai_allocations` row.
19. **Manual migration isolation:** `migrations/plurapi/0014_pluracon_model_services.sql`
    is not referenced by `scripts/lib/migration-order.mjs`, `MIGRATION_ORDER_CORE`, or the
    setup/update scripts, and `tests/coreMigrations.test.mjs` still passes unchanged.
9. **Permissions:** `grant_credits`/`record_ai_cost`/`run_credit_deduction`/
   `can_use_service` return 401/403 for an authenticated `anon`/user JWT and succeed for
   `service_role`.
10. **Privacy:** a `support` JWT can read only its own wallet, charges and provisions;
    `super-admin` reads all; a tenant admin reads only `ai_credit_charges` for its
    tenant.
11. **Cutoff:** a synthetic `plurapi.ai_query_logs` row older than `billing_cutoff_at` is
    never selected or charged.
12. **Negative balance:** a charge larger than the remaining balance succeeds and leaves
    `ai_credit_wallets.balance` negative; `balance = lifetime_credited - lifetime_spent`
    still holds; `GET /ai/credits` returns the negative number; and
    `user_service_provisions.is_enabled` is **unchanged** (no automatic disable).
13. **Token fallback:** a log with `cost_usd = null` but populated token counts and
    `ai_models.prompt_cost_per_token`/`completion_cost_per_token` still produces a
    non-zero charge.
14. **Dead-letter:** a deliberately malformed log produces a zero-credit
    `ai_credit_charges` row with `skip_reason` starting `error:`, and the next batch still
    processes newer logs (no head-of-line block).
15. **Credits-only UI:** a render test (or snapshot) for `AiPage` asserts that no currency
    symbol, `costIncurred`, `creditsPerDollar`, or conversion copy is present, and that a
    negative balance renders as a negative credit number.
16. **Admin accounts auth:** `GET/PUT/POST /api/plugin/pluradash/admin/ai/accounts*`
    return 200 for `super-admin` and 403 for `admin`/`support`/`user`; the
    `page: 'accounts'` section is hidden for non-super-admins by the loader filter and the
    `VerwaltungAccounts` tab guard.
17. **Admin accounts edits:** toggling a service writes `is_enabled` + `disabled_reason`
    and a subsequent `POST /ai/provision` by the target user does not re-enable a
    `manual` override; granting a package produces the expected `user_service_provisions`
    rows; a credits grant flows through `grant_credits` and updates the wallet/ledger.
18. **Admin accounts UI:** the new item under `/admin/accounts` shows credits only (no
    currency), renders negative balances as-is, and all writes go through the §7.4 routes.

---

## 16. Decisions locked for 033

1. **Wallet scope:** user-scoped, matching `032`. Workspace-pooled billing, if ever
   needed, gets a separate `tenant_credit_wallets` table; it must not change
   `ai_credit_wallets`'s primary key.
2. **Markup config:** keep the single-row `credit_settings`. Per-package markups are
   deferred until multiple paid tiers exist.
3. **isibot scope:** wire `transcriptionService.ts` through `record_ai_cost` in this
   release so the wallet and `ai_allocations` stay consistent from day one.
4. **PluraPi model writes:** keep the service-role write in `POST /ai/models`, with the
   exposed-schema prerequisite and a tracked PluraPi issue for a dedicated internal
   endpoint.
5. **Historical charges:** do not backfill pre-033 `ai_credit_charges`; the
   `billing_cutoff_at` watermark is the guard. A deliberate historical audit can
   temporarily move the watermark, never add a silent backfill.
6. **Null references:** `record_ai_cost` requires a non-null `reference_id`; the unique
   index stays nulls-distinct. Ad-hoc unmetered calls, if ever needed, get a separate
   function and table without an idempotency claim.
7. **Credits-only user interface:** `/pluradash/ai` renders credits only; no currency,
   no conversion copy, no dollar overview. Dollar fields remain admin/operator-only.
8. **Negative balances are valid:** the wallet is post-paid and may go negative; no
   automatic disable/re-enable/block in 033. The balance is informational and shown
   as-is; enforcement, if wanted later, is an explicit `can_use_service` policy.
9. **Super-admin account administration:** `/admin/accounts` gets a super-admin-only
   plugin section (new core extension point, §8.1) that lists accounts and edits their
   `user_service_provisions`, `user_packages` and credits via super-admin plugin routes
   (§7.4). It is the only place an operator can manually enable/disable a service or grant
   a package/credits; the user-facing `AiPage` stays read-only.
10. **PluraPi SQL lives in `migrations/plurapi/` as manual, unregistered scripts.**
    `0014_pluracon_model_services.sql` (+ `down/`) is committed in this repo for
    discoverability but is never added to `scripts/lib/migration-order.mjs` and never run
    by setup/update; the operator applies it by hand. This mirrors `migrations/Auth/`.

Still genuinely open:

- Whether tenant admins should see member **wallets** (not just tenant-scoped charges);
  today they see charges only.
- Whether `set_model` should call a PluraPi admin endpoint instead of writing the schema
  with the service role (depends on PluraPi’s API roadmap).