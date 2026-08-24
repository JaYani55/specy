# Database Integration — ORM, Core Schema & Plugin Database Rules

> **Audience:** AI agents and developers building backend integrations for Specy,
> especially **plugin authors** who need their own persistence.
>
> **Related:** [`../platform/multi-tenancy.md`](../platform/multi-tenancy.md)
> (tenant model, RLS helpers, migration history) ·
> [`../plugins/development.md`](../plugins/development.md) (plugin manifest &
> migration registration) · [`../auth/authentication-authorization.md`](../auth/authentication-authorization.md)
> (roles behind the RLS helpers).

---

## 1. Data Access Layer Overview

Specy does **not** use a classic ORM (no Drizzle, Prisma, or TypeORM). The stack is:

| Layer | Technology | Notes |
|---|---|---|
| Database | PostgreSQL (Supabase) | Row Level Security is the primary authorization mechanism |
| Query client | `@supabase/supabase-js` v2 | Typed query builder over PostgREST |
| Schema changes | Raw SQL migration files | Ordered, **idempotent**, registered in `scripts/setup.mjs` → `MIGRATION_ORDER` |

### The two clients — and when to use which

Both factories live in [api/lib/supabase.ts](../../api/lib/supabase.ts):

```ts
// 1. User-scoped client — carries the caller's JWT → RLS enforced.
//    This is the DEFAULT. Use it for anything touching user data.
const client = await createSupabaseClient(env, authToken);

// 2. Admin client — service role, bypasses RLS.
//    Restricted key lives in Cloudflare Secrets Store (never on disk).
//    Use only for trusted infrastructure work (bucket provisioning,
//    system_config upserts, registration flows).
const admin = await createSupabaseAdminClient(env);
```

**Rules:**

1. Default to the **user-scoped client**. If you reach for the admin client, you must be
   able to justify why RLS is insufficient for this operation.
2. Never accept a tenant/user ID from the request body and query with the admin client
   based on it — that recreates the IDOR vulnerability RLS exists to prevent. Resolve
   tenants from the *token's* claims (`tenant_id`, membership tables), as done in
   `resolveTenant()` patterns throughout the API routes.
3. The service key is only available inside the Worker (Secrets Store binding). External
   services cannot and must not obtain it — they authenticate via OAuth tokens (see
   [`oauth-unified-authentication.md`](oauth-unified-authentication.md)).

---

## 2. Core Schema Map (`public`)

All core tables live in the `public` schema. Grouped by concern:

### Identity & roles

| Table | Purpose |
|---|---|
| `public.user_profile` | Application profile per Supabase auth user (PK = `user_id`) |
| `public.roles` | Role definitions; `app` column tags roles with an app module enum |
| `public.user_roles` | User ↔ role assignments — source of the JWT `user_roles` claim |
| `public.staff`, `public.staff_traits`, `public.staff_trait_assignments` | Staff registry domain |

### Tenancy

| Table | Purpose |
|---|---|
| `public.tenants` | Workspace records (`id`, `slug`, `name`, …) |
| `public.tenant_users` | Membership mapping (`is_tenant_admin`, status: active/invited/suspended) |

### Content model

| Table | Purpose |
|---|---|
| `public.objects` | Generic content objects (schema-driven records) |
| `public.page_schemas` | Content schemas defining object shapes |
| `public.page_schema_specs`, `public.page_schema_templates` | Schema specs and templates |
| `public.schema_frontend_targets` | Which frontend receives which schema/content scope |
| `public.pages` | Published pages (status/draft sync via trigger) |
| `public.products` | Product content entities |
| `public.llm_specs` | Global LLM-facing spec documents |

### Platform services

| Table | Purpose |
|---|---|
| `public.system_config` | Namespaced runtime configuration (`core.public_url`, storage mounts, …) |
| `public.managed_secrets` | Secret metadata; values resolved via Cloudflare Secrets Store |
| `public.plugins` | Registered plugin metadata (registry) |
| `public.mail_delivery_jobs`, `public.mail_delivery_events` | Outbound email queue |
| `public.agent_logs` | Structured agent activity logs |
| `public.forms`, `public.forms_answers`, `public.forms_notifications` | Forms subsystem |
| `public.tenant_storage_objects`, `public.tenant_storage_allocations` | File catalog & quotas (see [`r2-file-storage.md`](r2-file-storage.md)) |

Legacy domain tables from earlier product history (e.g. `mentorbooking_*`,
`employers`, `companies`) still exist but are not part of the CMS contract surface —
do not build on them.

### Shared helpers & conventions

Reusable SQL defined once in `public` and referenced everywhere:

- **RLS helpers:** `current_user_id()`, `current_user_roles()`, `is_super_admin()`,
  `is_content_admin()`, `is_tenant_member(tenant_id, user_id)`,
  `is_tenant_admin(tenant_id, user_id)` — call these in your policies; never
  re-implement role logic inline.
- **Trigger:** `set_current_timestamp_updated_at()` — standard `updated_at`
  maintenance; attach it to every table that has an `updated_at` column.
- Every table: UUID PK (`gen_random_uuid()`), `created_at`/`updated_at TIMESTAMPTZ`,
  `tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE` where tenant-scoped,
  RLS enabled with explicit `TO authenticated` policies.
- Migrations are **idempotent**: `CREATE TABLE IF NOT EXISTS`,
  `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`.

---

## 3. Plugin Databases — Mandatory Dedicated-Schema Rule

> **The rule:** every plugin MUST own a dedicated PostgreSQL schema named after the
> plugin slug (e.g. `my_plugin`) and keep **all** of its tables there.
>
> Plugins must **never**: create tables in `public`, ALTER or extend core tables,
> rename/reuse existing schemas, or touch another plugin's schema.

### 3.1 Why

- **Clean uninstallation.** Dropping one schema removes the plugin completely;
  downmigrations stay trivial and reliable.
- **No collision risk.** Two plugins can both have a `settings` table without conflict.
- **Core upgrade safety.** Core migrations can evolve `public` freely without breaking
  plugins that piggy-backed on it.
- **Clear ownership boundary** mirroring the EUPL core/plugin separation (see
  [`../plugins/eupl-compliance.md`](../plugins/eupl-compliance.md)).

### 3.2 Migration requirements

Plugin migrations live in the plugin repo under `migrations/` with zero-padded numeric
order, and every one requires a matching **downmigration** in `migrations/down/` with
the same filename. The install tooling validates this before accepting a plugin.

### 3.3 Reference skeleton (neutral example)

Example plugin **`inventory`** (a hypothetical stock-management plugin):

```sql
-- migrations/001_create_inventory_schema.sql
CREATE SCHEMA IF NOT EXISTS inventory;

CREATE TABLE IF NOT EXISTS inventory.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.user_profile(user_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_tenant
  ON inventory.warehouses (tenant_id);

-- reuse the shared trigger function — do NOT redefine it
DROP TRIGGER IF EXISTS trg_inventory_warehouses_updated_at ON inventory.warehouses;
CREATE TRIGGER trg_inventory_warehouses_updated_at
  BEFORE UPDATE ON inventory.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

ALTER TABLE inventory.warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory members read warehouses" ON inventory.warehouses;
CREATE POLICY "inventory members read warehouses"
  ON inventory.warehouses FOR SELECT TO authenticated
  USING (public.is_super_admin()
         OR public.is_tenant_member(tenant_id, public.current_user_id()));

DROP POLICY IF EXISTS "inventory admins write warehouses" ON inventory.warehouses;
CREATE POLICY "inventory admins write warehouses"
  ON inventory.warehouses FOR ALL TO authenticated
  USING (public.is_super_admin()
         OR public.is_tenant_admin(tenant_id, public.current_user_id()))
  WITH CHECK (public.is_super_admin()
         OR public.is_tenant_admin(tenant_id, public.current_user_id()));

-- grants so both authenticated users and the service role can reach the schema
GRANT USAGE ON SCHEMA inventory TO authenticated;
GRANT USAGE ON SCHEMA inventory TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
```

And its downmigration (`migrations/down/001_create_inventory_schema.sql`):

```sql
DROP SCHEMA IF EXISTS inventory CASCADE;
```

Pattern highlights (all mandatory):

1. **Schema-first:** first migration creates the schema, later ones create tables in it.
2. **FK into `public` is allowed and encouraged** — `tenant_id → public.tenants(id)`,
   `created_by → public.user_profile(user_id)`. This is the sanctioned join point.
3. **Reuse `public` helper functions** in policies and triggers; never copy their logic.
4. **Prefix policy names and indexes** with the plugin slug for grep-ability.
5. **Grant both roles** — `authenticated` for user-scoped queries, `service_role` for
   trusted server-side operations.

### 3.4 How plugin code accesses its schema

Plugin backend code runs as API routes mounted by core at `/api/plugin/{slug}/`
(generated mount table — see
[`../plugins/installation.md`](../plugins/installation.md)). Access rules:

- **User-scoped reads/writes:** `createSupabaseClient(env, auth.token)` then
  `.from('inventory.warehouses')` — fully qualified schema-qualified relation names in
  the query builder work as usual; RLS applies.
- **Trusted operations (webhooks, queue consumers, provisioning):**
  `createSupabaseAdminClient(env)` — acceptable here because the operation has no user
  context; validate inputs explicitly since RLS will not protect you.
- Resolve the tenant from the **verified session** (JWT `tenant_id` claim plus
  membership lookup), never from unvalidated request parameters.
- Cross-plugin data access does not go through SQL. It goes through documented hook
  targets and the plugin's own HTTP routes only.

---

## 4. Checklist for New Plugins

- [ ] All tables in a dedicated `<slug>` schema; nothing added to `public`
- [ ] No ALTERs against core tables; no cross-schema writes to other plugins
- [ ] Migrations ordered, idempotent, registered in the install flow; downmigrations present in `migrations/down/`
- [ ] `tenant_id` FK to `public.tenants(id) ON DELETE CASCADE` on tenant-scoped tables
- [ ] RLS enabled on every table; policies use `public.*` helpers; `TO authenticated`
- [ ] `updated_at` trigger uses `public.set_current_timestamp_updated_at()`
- [ ] USAGE + CRUD grants for `authenticated` and `service_role` (+ default privileges)
- [ ] Backend queries use the user-scoped client by default; admin client only for context-less trusted operations
- [ ] Tenant resolution derived from verified session claims, never raw request input
