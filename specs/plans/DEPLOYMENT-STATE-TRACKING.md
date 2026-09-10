# Deployment State Tracking — Plan

Status: **IMPLEMENTED (2026-09-10)**. The inhabited contract lives in
[`platform/unified-setup-tui.md`](../platform/unified-setup-tui.md) §5.
See also [`changes/2026-09-10-deployment-state-tracking.md`](../changes/2026-09-10-deployment-state-tracking.md)
for the implementation record and deliberate deviations. Supersedes the open
items in [`platform/unified-setup-tui.md`](../platform/unified-setup-tui.md).

---

## 1. Problem & current reality

Specy keeps deployment/installation state in **three places**, none of which
agree on ownership or referential integrity:

| Store | What lives there today | Ownership | Referential integrity |
|---|---|---|---|
| `public.system_config` (`namespace = 'core_update'`) | core migration checksums (`migration:*`), edge-function checksums (`function:*`), `deployment:core_commit`, `deployment:functions`, `deployment:worker` | implicit (everything is core) | none — it is an EAV key/value store (`id, namespace, key, value text, …`) |
| `public.plugins` | plugin registry row + inline status (`status`, `version`, `installed_at`, `error_message`, `config`, `config_schema`) | the plugin itself | self-contained; no child state |
| `public.plugin_claims` | `plugin_id text` reference | plugin | **text, no FK** to `plugins` |
| gitignored sidecars (`plugins.json`, `plugin-deps.json`, `.bindings-ledger.json`) | resolved local state | plugin | none; does not travel |

Consequences:

- `core_update` is a **namespace**, not a table. There is no single, typed,
  queryable store that can answer *"what is deployed, by whom (core or which
  plugin), at which version/commit, and is it still valid?"*.
- Plugin state has no FK: nothing stops plugin state rows from outliving the
  plugin's registry row (and `plugin_claims` is orphan-prone on removal).
- A **prod environment that was deployed before a component started recording
  state has no way to catch up** — there is no backfill or re-check path, so the
  registry silently diverges from reality.
- Uninstalling a plugin removes the directory and the registry entry but leaves
  no transactional guarantee that DB state, claims, bindings metadata and sidecars
  are all removed together.

---

## 2. Goals

1. **One state registry** in the DB with a clear **ownership discriminator**
   (`core` vs `plugin`) and a **foreign key** from plugin state → `public.plugins`.
2. **Every mutating flow writes state** (write-after-confirm), tagged with owner
   and component, so "what is deployed?" is always answerable by a query.
3. **Clean uninstall**: removing a plugin removes *all* of its DB state via FK
   cascade + explicit teardown.
4. **Prod catch-up / re-check**: a one-time backfill plus a repeatable
   `state:recheck` flow that reconciles recorded state against local manifests,
   the live Worker and Supabase — so pre-existing deployments converge without
   a wipe.
5. **An AGENTS.md rule** making state publication a first-class requirement for
   new plugins and major components (draft in §8).

---

## 3. Schema design

### 3.1 Recommendation — a relational `public.deployment_state` table

Replace the `core_update` **namespace** with a typed relational table. Keeps the
EAV `system_config` for genuine configuration (mail URLs, feature flags) and
moves *state* into a table that can carry FKs and cascade.

> Proposed DDL (illustrative — do not implement in this step):

```sql
create table public.deployment_state (
  id          uuid primary key default gen_random_uuid(),
  owner_kind  text not null check (owner_kind in ('core','plugin')),
  plugin_id   uuid null references public.plugins(id) on delete cascade,
  component   text not null,          -- 'worker' | 'migrations' | 'edge_functions'
                                      -- | 'bindings' | 'claims' | 'code' | 'config'
  key         text not null,          -- e.g. 'objects.sql', 'deployment:worker', 'sms-notifications'
  value       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Ownership must be self-consistent: core rows have no plugin id, plugin rows do.
  constraint deployment_state_owner_check check (
    (owner_kind = 'core'   and plugin_id is null) or
    (owner_kind = 'plugin' and plugin_id is not null)
  )
);

-- core rows: unique per (component, key)
create unique index deployment_state_core_uniq
  on public.deployment_state (component, key) where plugin_id is null;

-- plugin rows: unique per plugin per (component, key)
create unique index deployment_state_plugin_uniq
  on public.deployment_state (plugin_id, component, key) where plugin_id is not null;

create index deployment_state_owner_idx
  on public.deployment_state (owner_kind, plugin_id);
```

### 3.2 `value` shape (uniform across core and plugin)

```json
{
  "status":      "applied | provisioned | deployed | skipped | error",
  "version":     "string | null",     // plugin version, where relevant
  "commit":      "string | null",     // git SHA
  "checksum":    "string | null",     // content hash for drift detection
  "provider":    "supabase | cloudflare | local | null",
  "deployed_at": "timestamp | null",
  "meta":        {}
}
```

`checksum` enables the existing drift-detection semantics
(`migration:`/`function:` compare + re-apply) to be lifted into one column
instead of ad-hoc JSON per key.

### 3.3 Component taxonomy

| `owner_kind` | `component` | `key` examples | written by |
|---|---|---|---|
| `core` | `worker` | `deployment:worker` | deploy / cf-update / setup after `wrangler deploy` |
| `core` | `migrations` | `objects.sql`, `Auth/Access_hook.sql` | setup / cf-update / migrate |
| `core` | `edge_functions` | `send_email` | setup / cf-update |
| `core` | `auth_hook` | `custom_access_token_hook` | migrate / auth:check |
| `plugin` | `code` | *(single row)* | install / update |
| `plugin` | `migrations` | `001_create_extensions.sql` | install / update |
| `plugin` | `bindings` | `sms-notifications` (purpose) | provision / install |
| `plugin` | `claims` | `<claim_key>` | install (claims registry) |
| `plugin` | `config` | *(single row, `{config}` snapshot?)* | (optional) |

---

## 4. Ownership tracking (core vs plugin)

- `owner_kind` carries the **semantic ownership** (who a row belongs to);
  `plugin_id` carries the **referential ownership** (nullable FK).
- Core tooling writes `owner_kind='core', plugin_id=null`. Plugin tooling writes
  `owner_kind='plugin', plugin_id=<registry id>`.
- A single helper (`state.mjs` → `writeDeploymentState(db, {owner, component, key, value})`)
  derives `owner_kind`/`plugin_id` from one `owner` string (`'core'` or `'plugin:<slug>'`),
  so writers cannot accidentally mis-tag a row. The check constraint enforces the pair.

This also fixes the existing hygiene gap: **`public.plugin_claims.plugin_id`
(text) should become a real FK to `public.plugins(id)`** with `on delete cascade`,
so claims never outlive the plugin.

---

## 5. Migration path from `core_update` (backfill)

A new idempotent migration (`NNN_deployment_state.sql`) does:

1. Create `deployment_state` + indexes + FK + RLS (owner/service-role writes,
   admin/super-admin reads, mirrored on the `plugin_claims` policy pattern).
2. **Backfill core rows** from `system_config WHERE namespace = 'core_update'`:
   map by key prefix (see table in §3.3), parse the existing JSON `value`, extract
   `checksum`/`commit`, set `owner_kind='core'`. Idempotent
   (`insert … on conflict do nothing`).
3. **Backfill plugin rows** from `public.plugins WHERE kind='plugin' AND status='installed'`:
   `component='code'` (`value.status='installed'`, version, `installed_at`) and
   `component='claims'` from `public.plugin_claims`. Plugin *migration/binding*
   rows cannot be reconstructed from today's data → mark them
   `status='unrecorded'` for the re-check flow to resolve.
4. Keep `core_update` rows in `system_config` during a **shim window** (readers
   fall back to legacy rows), then drop them in a later cleanup migration once
   `state:recheck` has converged prod.

---

## 6. Clean uninstall (plugin removal)

Target order, each step idempotent and reversible until the registry row is removed:

1. **Collect** the plugin's state keys (migrations, claims, bindings) *before*
   deleting the directory.
2. **Down-migrate DB objects** — run `migrations/down/*` in reverse (drops the
   plugin schema's tables/functions/triggers, deletes `public.plugin_claims` rows,
   drops resolvers).
3. **Teardown bindings** — `bindings:provision -- --teardown <slug>` (deletes
   environment-scoped cloud instances + ledger rows; shared instances kept).
4. **Delete state rows** — `delete from deployment_state where plugin_id = <id>`
   (or rely on the `on delete cascade` if the registry row is hard-deleted).
5. **Registry row** — keep today's soft-delete semantics
   (`status='registered', installed_at=null`) *or* hard `DELETE`; the FK cascade
   is the safety net either way. Decision point below.
6. **Local sidecars** — remove `plugins/{slug}/`, `plugins.json` entry,
   `plugin-deps.json` entry (and `--prune-deps`), then rebuild generated
   registries.

Acceptance test: uninstall a plugin that has migrations + claims + bindings rows;
assert `deployment_state`, `plugin_claims`, and (if hard-delete) `plugins` are all
empty for that id, and that no `core` rows were touched.

---

## 7. Prod catch-up & re-check path

New command (planned): **`npm run state:recheck`** (`scripts/state-recheck.mjs`),
also reachable from the unified `npm run setup` TUI. Default `--dry-run`.

It reconciles four sources:

| Source | Provides | Owner |
|---|---|---|
| local manifests (`buildMigrationManifest`, `scanWorkspacePlugins`, `readBindingLedger`, generated `wrangler.jsonc`) | *what should be* | core + plugin |
| `public.deployment_state` (+ legacy `core_update` fallback) | *what is recorded* | core + plugin |
| live Worker bindings (Cloudflare API, reuse `binding-consistency-remote.mjs`) | *what actually runs* | core + plugin |
| `public.plugins` + `public.plugin_claims` | registry truth | plugin |

Output classes (each attributed `core-owned` / `plugin-owned`):

- **unrecorded** — local says a migration/binding/version exists but no row → `--sync` backfills (and bumps the migration state → applied/checksum).
- **drifted** — recorded `checksum`/`commit` differs from local → report + optional re-apply/re-record (same semantics as today's drift detection).
- **stale/orphaned** — recorded rows whose component no longer exists locally (e.g. removed plugin, renamed purpose) → report + optional delete (teardown analog).
- **converged** — recorded == local == live.

Implementation note: `--sync` is idempotent (all writes via `on conflict do update`),
so prod catch-up is safe to run repeatedly and in CI. The one-time backfill
migration (§5) + one `state:recheck --sync` is the documented **prod catch-up
path** for deployments that predate this feature.

---

## 8. AGENTS.md instruction (draft — add at implementation time)

To be inserted as a new subsection under AGENTS.md §5 (or §4 for plugins). Draft:

> ### Deployment state publication
>
> - Every **major component** (core Worker deploy, core migrations, core edge
>   functions, auth hook) and every **plugin** must record its deployment/install
>   state in `public.deployment_state` **after the external system confirms
>   success** (write-after-confirm). State is tagged with `owner_kind`
>   (`core`/`plugin`) and `component`; plugin rows must carry `plugin_id`
>   (FK → `public.plugins`).
> - **New plugins** must have their install flow write `code`, `migrations`,
>   `claims` and `bindings` rows; their uninstall flow must remove them (cascade).
> - **New migration/state keys** must be added to the component taxonomy in
>   `specs/platform/unified-setup-tui.md` (or its successor) and covered by a test.
> - State is **never** written before confirmation, **never** carries secrets, and
>   is **always** idempotent (`ON CONFLICT DO UPDATE`).

---

## 9. Implementation phases (future)

| Phase | Deliverable | Notes |
|---|---|---|
| P0 | `202609100001_deployment_state.sql` (table + FK + RLS + backfill) + `scripts/lib/deployment-state.mjs` write/read helpers + `tests/deploymentState.test.mjs` | ✅ done |
| P1 | Switch core writers (`core-update.mjs`, `cf-update.mjs`, `migrate.mjs`) to `deployment_state` (shim read fallback to `core_update`) | ✅ dual-write via `upsertCoreUpdateRecords` + `registerAuthHook` |
| P2 | Plugin writers (`install-plugins.mjs`, `uninstall-plugin.mjs`, `provision-bindings.mjs`) + `plugin_claims` FK + cascade + clean-uninstall ordering | ✅ `202609100002_plugin_claims_ownership.sql` (companion uuid FK, see deviations) |
| P3 | `scripts/state-recheck.mjs` + TUI "Re-check deployment states" action + `--sync` repair | ✅ done |
| P4 | AGENTS.md instruction (§8) + drop `core_update` legacy rows after prod convergence | ✅ AGENTS.md rule added; legacy rows kept as read-only shim (open question 3) |

## 10. Open questions

1. **Soft vs hard plugin delete** — keep `status='registered'` (today) or hard
   delete + cascade? Recommendation: soft delete for the registry row, explicit
   state-row deletion, cascade as backstop.
2. Should `config` be a `deployment_state` row or stay inline on `public.plugins`?
   Recommendation: stay inline (it is *data*, not *state*).
3. Whether `system_config` `core_update` is frozen (read-only shim) or dual-written
   during the transition — recommend read-only shim to avoid two writers.