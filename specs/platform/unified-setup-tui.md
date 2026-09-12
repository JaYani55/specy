# Unified Setup TUI & Installation-State Tracking

Implemented contract (2026-09-10) for a single maintenance entry point and a
coherent installation/deployment state model. This document is both the
**analysis** of the deployment & plugin-installation pathing and the
**implemented design** that compresses it.

---

## 1. Problem — fragmented pathing

Before this change, the operator tooling was spread across twelve entry points
with overlapping responsibilities and duplicated helpers:

| Command | Script | Owns |
|---|---|---|
| `npm run setup` | `scripts/setup.mjs` | first-time wizard only (Cloudflare login, secrets, migrations, edge fn, build, deploy) |
| `npm run update` | `scripts/update.mjs` | orchestrator: core → plugins → build/deploy |
| `npm run update:core` | `scripts/cf-update.mjs` | git pull + core migrations + edge fns + lint + build + deploy |
| `npm run update:plugins` | `scripts/update-plugins.mjs` | plugin git pull + plugin migrations + status |
| `npm run plugin:install` | `scripts/install-plugins.mjs` | plugin download/deps/migrations/bindings |
| `npm run plugin:remove` | `scripts/uninstall-plugin.mjs` | plugin removal + downmigrations + teardown |
| `npm run deploy` | `scripts/deploy.mjs` | **build (always, unless `--skip-build`)** → consistency audit → drift → wrangler deploy |
| `npm run migrations` | `scripts/migrate.mjs` | core migrations (workspace → Supabase, no git gate) |
| `npm run snapshots` | `scripts/snapshots.mjs` | database snapshots: dump all DB content to `/data/snapshots` / fully restore a local snapshot |
| `npm run bindings:provision` / `:check` | `scripts/provision-bindings.mjs` | cloud resource provisioning / drift |
| `npm run auth:check` | `scripts/auth-diagnostics.mjs` | auth-hook diagnostics |
| `predev`/`prebuild` | `scripts/ensure-registry.mjs` | registry rebuild + plugin npm deps |

An operator had to know which of these to run, in which order, after which
failure. The first-time wizard was the *only* thing `npm run setup` did, so a
configured deployment had no "home".

**Duplication found and removed:**

- `loadDotEnv()` — 4 copies (`env.mjs`, installer, uninstaller, provisioner).
- `runSqlQuery()` / `extractProjectRef()` — 5 copies (setup, core-update,
  remote-sql, installer, uninstaller).
- `promptSecret()` (masked PAT prompt) — 4 copies.
- `resolvePat()` / `createPatDb()` / `patQuery()` — 3 copies.
- Plugin migration validator (`validateMigrationSchemaUsage`, `collectSqlFiles`,
  …) — 2 copies (installer-side lib vs. uninstaller's inline copy).
- Generated-registry rebuilders (`rebuildRegistry`, `rebuildPluginRoutes`,
  `rebuildHookRegistry`, `rebuildPluginMetadata`) — **dead code** duplicated in
  both the installer and uninstaller, superseded by
  `rebuildWorkspacePluginArtifacts()` in `scripts/lib/plugin-workspace.mjs`.

---

## 2. Unified entry point

`npm run setup` is now a **phase-aware dispatcher**:

```
npm run setup
  ├─ phase = fresh       (no wrangler.jsonc, or placeholders present)
  │     → runFirstTimeSetup()  (scripts/lib/first-time-setup.mjs — the old wizard)
  └─ phase = configured  (generated, non-placeholder wrangler.jsonc)
        → maintenance TUI (state summary → integrity check → action menu)
```

The maintenance TUI is a **launcher + integrity gate + state tracker**, not a
reimplementation of the engines. Every menu action delegates to the existing
script (one implementation per operation):

| Menu action | Delegates to |
|---|---|
| Integrity check | inline: `rebuildWorkspacePluginArtifacts()` + `auditBindingConsistency()` + tooling unit-test gate (`runIntegrityTests()` — runs the 14 suites in `tests/` that guard registries, bindings, claims, state, migrations, and wrangler config; condensed failure report, full output via `npm test`) |
| Update core + plugins | `scripts/update.mjs` |
| Update core only | `scripts/cf-update.mjs` |
| Update plugins only | `scripts/update-plugins.mjs --all` |
| Install / remove plugin | `scripts/install-plugins.mjs` / `uninstall-plugin.mjs` (TUI asks for plugin + mode: unregister-keep-files or full delete) |
| Provision / drift | `scripts/provision-bindings.mjs` |
| Apply core migrations | `scripts/migrate.mjs` |
| DB Snapshots (create / restore) | `scripts/snapshots.mjs` (TUI opens the snapshot submenu: Create Snapshot / Restore Snapshot / List — reads local snapshots from `/data/snapshots`) |
| Deploy | `scripts/deploy.mjs` |
| Auth diagnostics | `scripts/auth-diagnostics.mjs` |
| Reconfigure | `runFirstTimeSetup()` |

### New modules

| File | Purpose |
|---|---|
| `scripts/lib/prompts.mjs` | shared `promptLine` / `promptSecret` (masked, paste-safe) |
| `scripts/lib/state.mjs` | phase detection + local installation-state summary |
| `scripts/lib/first-time-setup.mjs` | the former `setup.mjs` wizard, now a callable flow |
| `scripts/setup.mjs` | the unified dispatcher + maintenance TUI |
| `scripts/snapshots.mjs` | DB snapshot engine (create / restore / list) + interactive snapshot submenu |
| `scripts/lib/db-snapshot.mjs` | pure snapshot logic: schema filtering, SQL literal rendering, insert/delete/sequence SQL, FK-topological restore ordering |
| `scripts/lib/action-log.mjs` | dynamic `/data` workspace (`snapshots/`, `logs/`) + critical action log writer |

Every critical action run (migrations, snapshot create, snapshot restore)
writes an action log to `/data/logs` — see
[`db-snapshots.md`](db-snapshots.md).

---

## 3. Installation state — how it is tracked

Specy spans **three planes** with different sync semantics:

| Plane | Contents | Truth semantics |
|---|---|---|
| **Git** | code, migrations, plugin manifests, `wrangler.default.jsonc` | *what should be* |
| **Local gitignored sidecars** | `wrangler.jsonc`, `.env`, `plugins.json`, `plugin-deps.json`, `.bindings-ledger.json` | resolved, environment-specific — does **not** travel |
| **Supabase** | `public.system_config` (`core_update` namespace), `public.plugins` | shared, queryable runtime truth (reachable by operator + dashboard) |
| **Cloudflare** | Worker deploy, Secrets Store, queues/KV | runtime resources (API-only) |

### Core deployment state (`public.system_config`, namespace `core_update`)

| Key | Meaning | Written by |
|---|---|---|
| `migration:<file>` | checksum of each applied core migration | setup / cf-update / migrate |
| `function:<name>` | checksum of each deployed edge function | setup / cf-update |
| `deployment:core_commit` | git commit whose migrations were applied | cf-update |
| `deployment:functions` | list of deployed edge functions | cf-update |
| `deployment:worker` ⭐ | **git commit running on the live Worker** + `deployedAt` | *new* — setup / cf-update after `wrangler deploy` |

The last row closes the previous gap: migration and edge-function state was
tracked, but **whether the Worker itself was deployed (and at which commit) was
not**. `deployment:worker` is written only *after* `wrangler deploy` reports
success — the external system confirms before state is persisted.

### Plugin state

- `public.plugins` — authoritative status (`registered` / `installed` / `error`),
  version, `installed_at`, `config`, `config_schema`.
- `plugins.json` / `plugin-deps.json` / `.bindings-ledger.json` — local,
  gitignored **projections** of that state (and of cloud resources), regenerated
  by `ensure-registry` / `bindings:provision`. They are caches, not the source of
  truth.

---

## 4. Recommendation — one state registry, write-after-confirm

The optimal path for communicating repo state across the microservices is to
make **`public.system_config` the single deployment-state registry** (it already
is for migration checksums):

1. **Extend the `core_update` namespace** (done) with `deployment:worker`. Next:
   a canonical `deployment` manifest record
   `{ worker_name, worker_commit, core_commit, supabase_project_ref, deployed_at,
      plugins: { <slug>: { version, commit, status } } }`, upserted by every
   mutating flow.
2. **Mirror the bindings ledger into `system_config`** (a `bindings` namespace) so
   cloud-resource state travels between machines/CI — this is the documented OPEN
   item #3 in [`binding-management.md`](binding-management.md).
3. **Keep local sidecars as projections** — regenerated from the DB state, never
   authoritative. The TUI already treats them this way (it reads local state, then
   diffs against the DB state to surface pending work).
4. **Write-after-confirm protocol** — every mutating flow persists its result to
   `system_config` *only after* the external system (Cloudflare / Supabase)
   confirms success, using the shared PAT facade (`scripts/lib/remote-sql.mjs`).
   The TUI reads state and diffs local (git head + manifests) against recorded
   state to compute "pending work" — no more "did it deploy?" ambiguity.

This gives all three microservices one queryable source of truth without
introducing a new service: Supabase is already reachable from the Worker
(via the API), the dashboard (RLS), and the operator tooling (Management API).

### Open items

> Resolved by the **deployment-state registry** documented in §5 below
> (implemented 2026-09-10, spec: [`plans/DEPLOYMENT-STATE-TRACKING.md`](../plans/DEPLOYMENT-STATE-TRACKING.md)).

1. Full `deployment` manifest record — resolved by `public.deployment_state`.
2. Bindings ledger → DB mirror — resolved by `bindings` component rows.
3. `public.plugins` as the *only* plugin-state writer — partially resolved
   (state rows now live in `deployment_state`; `plugins.json` remains a local
   projection, by design).

---

## 5. Deployment-state registry (`public.deployment_state`)

Implemented 2026-09-10. Replaces the `core_update` **namespace** of
`public.system_config` for *state* (deployment/installation facts) with a typed,
queryable relational table carrying an ownership discriminator and a real FK
from plugin state → `public.plugins(id)` (`ON DELETE CASCADE`).
`schema` source: `migrations/202609100001_deployment_state.sql` (+ the
`plugin_claims` FK backstop in `202609100002_plugin_claims_ownership.sql`).

### 5.1 Why

`core_update` was an EAV key/value namespace — no typed, queryable store that
could answer *"what is deployed, by whom (core or which plugin), at which
version/commit, and is it still valid?"*. `plugin_claims.plugin_id` was a bare
text column with no FK, so claims could outlive a plugin. Deployment state now
has one registry with write-after-confirm semantics.

### 5.2 Schema

```sql
create table public.deployment_state (
  id          uuid primary key default gen_random_uuid(),
  owner_kind  text not null check (owner_kind in ('core','plugin')),
  plugin_id   uuid null references public.plugins(id) on delete cascade,
  component   text not null,
  key         text not null,
  value       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

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
```

`value` shape (uniform across core and plugin):

```json
{
  "status":      "applied | provisioned | deployed | skipped | error | unrecorded | installed",
  "version":     "string | null",
  "commit":      "string | null",
  "checksum":    "string | null",
  "provider":    "supabase | cloudflare | local | null",
  "deployed_at": "timestamp | null",
  "meta":        {}
}
```

RLS mirrors the `plugin_claims` pattern: admin/super-admin read via a SELECT
policy; writes are platform-only (Management API / table owner / service role
bypass RLS — no user-facing write policies).

### 5.3 Component taxonomy

| `owner_kind` | `component` | `key` examples | written by |
|---|---|---|---|
| `core` | `worker` | `worker`, `core_commit` | deploy / cf-update after `wrangler deploy` |
| `core` | `migrations` | `objects.sql`, `202609100001_deployment_state.sql` | setup / cf-update / migrate |
| `core` | `edge_functions` | `send_email`, `deployed` | setup / cf-update |
| `core` | `auth_hook` | `custom_access_token_hook` | migrate / cf-update (`registerAuthHook`) |
| `plugin` | `code` | *(single row)* `code` | install / update |
| `plugin` | `migrations` | `001_create_extensions.sql` | install / update / `state:recheck --sync` |
| `plugin` | `bindings` | `sms-notifications` (purpose) | provision / install |
| `plugin` | `claims` | `<plugin id>` (top-level JWT key) | install (claims registry) |
| `plugin` | `config` | *(reserved — `config` stays inline on `public.plugins`)* | — |

Legacy core_update keys map onto this taxonomy as:
`migration:<file>` → `migrations/<file>` · `function:<name>` →
`edge_functions/<name>` · `deployment:worker` → `worker/worker` ·
`deployment:core_commit` → `worker/core_commit` · `deployment:functions` →
`edge_functions/deployed`.

### 5.4 Writer helpers

`scripts/lib/deployment-state.mjs` exposes:

- `normalizeOwner` / `toStateRow` — derive `owner_kind`/`plugin_id` from one
  `owner` string (`'core'` or `'plugin:<slug>'`), so writers cannot mis-tag rows.
- `coreKeyToComponent` / `coreRecordsToStateRows` — legacy-key mapping.
- `writeDeploymentState` / `readDeploymentState` /
  `deletePluginDeploymentState` — idempotent upsert (`ON CONFLICT DO UPDATE`),
  read, and per-plugin delete over the shared PAT facade.
- `reconcileRecords` / `resolvedIntentsToBindingStateRows` — pure reconciliation
  and binding-row projection (unit-tested).

### 5.5 Clean uninstall & re-check

- Uninstall deletes a plugin's `deployment_state` rows and `plugin_claims` rows
  explicitly (downmigration still owns schema objects); the `plugins(id)` FK
  cascade is the backstop.
- `npm run state:recheck` (also in the TUI as **Re-check deployment states**)
  reconciles local manifests + git head + workspace plugins + binding ledger
  against `deployment_state` (with a legacy `core_update` fallback) and reports
  **unrecorded / drifted / stale / converged**; `--sync` repairs idempotently.
  Drift is judged on the row's anchor field only (`checksum` > `version` >
  `commit`) — a moved git head alone does not make content-anchored migration/
  edge-function rows drift, and the report names the differing field(s).
  See `specs/changes/2026-09-11-state-recheck-drift-semantics.md`.
- The TUI state footer ("Installation & deployment state") reads
  `public.deployment_state` as its primary source (via `readDeploymentState` +
  `summarizeDeploymentRows`) — core migrations/edge functions, worker/core
  commit, and per-plugin `code`/`migrations`/`bindings`/`claims` rows — and
  falls back to the legacy `core_update` shim (core-only, no plugin lines)
  when the table does not exist yet. See
  `specs/changes/2026-09-11-setup-tui-state-summary.md`.
  The footer's git line shows branch, HEAD and upstream sync status
  (`dev @ afbea61 · ↑1 ahead ↓3 behind vs origin/dev`, `up to date with …`,
  `no upstream branch`) — pure helpers (`parseAheadBehind`,
  `parseUncommittedPaths`, `filterMigrationSqlChanges`, `formatGitStatusLine`)
  in `scripts/lib/state.mjs`, tested in `tests/state.test.mjs`.
- The **Apply core migrations** TUI action guards against uncommitted
  migration SQL before delegating to `migrate.mjs`: uncommitted (new/modified/
  staged) `migrations/*.sql` files are listed with a confirmation prompt
  (default: abort) — applying a file that exists only on disk would record its
  state in the DB while the file itself is lost on checkout. See
  `specs/changes/2026-09-11-setup-tui-state-summary.md`.

### 5.3 Hardening (2026-09-12) — bootstrap guard, wizard state recording, drift confirmation

Implemented in `specs/changes/2026-09-12-setup-migration-state-hardening.md`:

- **Checksums are EOL-normalized** (`normalizeSqlEol` in
  `scripts/lib/core-update.mjs`, applied in `buildMigrationManifest`,
  `buildFunctionManifest` and the plugin-migration hashes of
  `state-recheck.mjs`). A Windows checkout (`core.autocrlf`) and a
  Linux/CI checkout produce identical checksums for identical content —
  recorded state no longer depends on the checking-out platform.
- **`migrate.mjs` bootstrap verifies before baselining**: an empty
  remote-state no longer blindly records the whole manifest as applied.
  The live schema is probed (`information_schema`); migrations whose
  created tables are entirely missing stay pending and are applied
  (`planBaseline()` in `core-update.mjs`). On a genuinely empty schema all
  migrations are applied and state is recorded only after each successful
  apply.
- **First-time setup records state per applied migration**
  (`stepMigrations` → buffered `upsertCoreUpdateRecords` flush after the
  loop). Skipped migrations are not recorded and reported with a concrete
  `npm run migrations -- --replay <file>` follow-up.
- **`state:recheck --sync` confirms core drift per row** before re-recording
  local values as truth (non-interactive: core drift is left as-is with a
  warning). Plugin drift continues to re-record automatically. The follow-up
  hint for drifted core migrations references `--replay <file>` (the
  previous `--force <file>` hint was wrong).
