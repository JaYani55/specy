# Plugin Installation Guide

This document covers the complete lifecycle of a plugin: registering, installing, configuring, updating, and removing it.

For plugin **development** (writing code, manifest fields, API routes, etc.) see [Plugin_Development.md](development.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1 — Register the plugin in the UI](#2-step-1--register-the-plugin-in-the-ui)
3. [Step 2 — Run the install script](#3-step-2--run-the-install-script)
4. [Step 3 — Apply database migrations](#4-step-3--apply-database-migrations)
5. [Step 4 — Generated API mounting and wrangler bindings](#5-step-4--generated-api-mounting-and-wrangler-bindings)
6. [Step 5 — Configure the plugin](#6-step-5--configure-the-plugin)
7. [Step 6 — Build and deploy](#7-step-6--build-and-deploy)
8. [Updating a plugin](#8-updating-a-plugin)
9. [Pinning a version](#9-pinning-a-version)
10. [Removing a plugin](#10-removing-a-plugin)
11. [Environment variables](#11-environment-variables)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

- Node.js ≥ 18 installed locally
- SUPERADMIN access to the CMS instance
- (Recommended) A `GITHUB_TOKEN` environment variable set to a GitHub personal access token — avoids API rate limits and is required for private repositories

### Multi-Tenancy Note

Plugin and webapp tenancy is only partially implemented today, but the intended operating model is already defined:

- `webapp` entries should ultimately be tenant-associated integrations
- registered webapps should be stored per tenant rather than as one globally shared registration
- build-time plugins remain installed globally into the repo and deployed build
- access to paid addon plugins is intended to be granted through active plugin-specific `user_roles` exposed by the auth hook, not merely by package installation

Installation is therefore still a platform action, while authorization is expected to become tenant-aware and user-aware.

---

## 2. Step 1 — Register the plugin in the UI

Before installing locally, add the plugin record to the database so the CMS tracks it.

1. Navigate to `/plugins` as a SUPERADMIN
2. Click **Plugin registrieren**
3. Fill in the GitHub repository URL, slug (`id` from `plugin.json`), display name, and any other metadata
4. Click **Registrieren** — this writes a row to the `plugins` table

> This step can be skipped if the plugin is only used locally and never needs to appear in the admin UI. The install script works without it.

> For future tenant-aware webapps, registration should be interpreted as tenant-scoped onboarding rather than a single global shared record. That behavior is documented now but not fully implemented yet.

---

## 3. Step 2 — Run the install script

The install script handles everything in one command: downloading the repository, extracting it, reconciling the plugin ID, installing npm dependencies, rebuilding the registry, and reporting migrations and config keys.

### Adding a new plugin

```bash
# macOS / Linux
node scripts/install-plugins.mjs --add https://github.com/owner/my-plugin

# Windows
scripts\install-plugins.bat --add https://github.com/owner/my-plugin
```

### What the script does

1. Appends an entry to `plugins.json`
2. Downloads the repository as a ZIP from GitHub
3. Extracts it to `plugins/{slug}/`
4. **ID reconciliation** — if `plugin.json` declares an `id` that differs from the GitHub-derived slug (e.g. `yatda` vs `jayani55-yatda`), the directory is automatically renamed and `plugins.json` is updated to use the canonical id
5. **npm dependencies** — if `plugin.json` declares `required_npm_dependencies`, runs `npm install` for those packages automatically
6. **Binding intent validation** — if `plugin.json` declares `wrangler_intents` (or the legacy `wrangler_bindings`), validates them immediately; invalid intents fail the install with actionable errors before anything else runs
7. Rebuilds the generated plugin registries, API mount files, and wrangler binding section from the `plugins/` folder — intent-declared bindings are resolved to per-environment instance names (`{worker-name}--{plugin-id}--{purpose}`)
8. **Runs the binding pipeline with step detection** — classifies every intent's completion state for the current environment (provisioned via ledger / pending / secret link to verify), provisions only what is missing when `CF_API_TOKEN` is available (env or `.env`), and lists every pending step with its exact command in the manual-steps summary (non-fatal without a token)
9. Prints any SQL migration files that need to be applied
10. Prints any `config_schema` keys that need to be set
11. **Exposes the plugin schema** (plugins with migrations): adds it to the in-DB PostgREST config (`pgrst.db_schemas`) via the Management API when a PAT is available and reloads the PostgREST config — manual dashboard step only as fallback (see §10)

### Registering workspace plugins

Plugins that already exist locally under `plugins/{slug}/` do not need the remote installer. Rebuild the generated registries directly:

```bash
node scripts/register-plugins.mjs
```

This regenerates `src/plugins/registry.ts`, `src/plugins/hooks-registry.ts`, `api/plugin-routes.ts`, `api/plugin-hooks.ts`, and `api/plugin-metadata.ts` from the contents of `plugins/`. It also injects any plugin-declared wrangler bindings (AI Gateway, KV namespaces, Durable Objects) into the auto-generated section of `wrangler.jsonc`.

### Automatic rebuild on build and dev

The `npm run build` and `npm run dev` commands automatically run `node scripts/ensure-registry.mjs` via the `prebuild` and `predev` npm scripts. This means:

- **Plugin registries** are always up to date when you build or start the dev server
- **Wrangler bindings** are injected into `wrangler.jsonc` before every build and dev session
- No manual script invocation is needed after adding a plugin to `plugins/`

If you add a new plugin to `plugins/{slug}/` manually, simply run `npm run build` or `npm run dev` — the registry and wrangler bindings are rebuilt automatically.

### Installing all registered plugins

```bash
node scripts/install-plugins.mjs
```

### Listing registered plugins

```bash
node scripts/install-plugins.mjs --list
```

---

## 4. Step 3 — Apply database migrations

If the install script printed SQL migration files, apply them to your Supabase project before the next build.

Plugin authors are required to ship matching downmigrations for every forward migration under `migrations/down/NNN_name.sql`. Plugin-owned tables, views, functions, types, policies, triggers, and sequences must live in a dedicated plugin schema such as `yatda` or `my_plugin`; the `public` schema is reserved for CMS core objects.

**Via Supabase Dashboard:**
1. Open the Supabase Dashboard → SQL Editor
2. Open each migration file from `plugins/{slug}/migrations/` in order
3. Run them sequentially

**Files are printed in the terminal output**, for example:
```
> plugins/yatda/migrations/001_create_extensions.sql
> plugins/yatda/migrations/002_create_connectors.sql
...
```

> Apply migrations in numeric order. Never modify an already-applied migration — create a new numbered file instead.

> The installer validates these requirements before a plugin is accepted: explicit downmigrations under `migrations/down/` and plugin-owned DDL scoped to the plugin's own schema rather than `public`.

---

## 5. Step 4 — Generated API mounting and wrangler bindings

Plugin API routes are now mounted through the generated [api/plugin-routes.ts](../../api/plugin-routes.ts) file. If a plugin's `plugin.json` declares an `api_entrypoint`, `node scripts/register-plugins.mjs` or the normal prebuild/predev flow will regenerate the mount table automatically.

Plugin API endpoints are reachable under `/api/plugin/{id}/`.

If the plugin also declares `api_hooks_entrypoint`, its backend hook contributions are regenerated into [api/plugin-hooks.ts](../../api/plugin-hooks.ts) the same way.

### Wrangler binding injection

Plugins declare their cloud-system bindings **based on the deployment path** (`deployment_path` in `plugin.json` — Cloudflare is the current default and only deployment path). Binding management is part of a plugin: bindings are declared in `plugin.json`, never in core config.

- **`wrangler_intents` (preferred):** the plugin declares *requirements* (binding + purpose + scope), core resolves a deterministic per-environment instance name (`specy-dev--pluradash--sms-notifications`) and provisions it (`npm run bindings:provision`). Contract: [platform/binding-management.md](../platform/binding-management.md).
- **`wrangler_bindings` (deprecated legacy):** concrete instance entries injected verbatim. Still supported during migration; emits a deprecation warning on every build.

The injection happens inside a dedicated auto-generated section marked by:

```
// ── PLUGIN BINDINGS (AUTO-GENERATED by scripts/ensure-registry.mjs) ──────
// ── END PLUGIN BINDINGS ──────────────────────────────────────────────────
```

Supported binding types:
- `ai` — Workers AI binding (singleton object)
- `kv_namespaces` — KV namespace bindings
- `durable_objects` — Durable Object bindings
- `queues` — Queue producers/consumers (merged into the core queues config)
- `vars` — plain-text vars merged into the core `vars` object (per-key conflict detection)
- `secrets_store_secrets` — Secrets Store bindings merged into the core `secrets_store_secrets` array (per-binding conflict detection)

`r2_buckets` is owned by the CMS core and cannot be declared by plugins — plugins consume the shared `MEDIA_BUCKET` binding instead. The build system validates binding name uniqueness across all plugins and errors on conflicts (duplicate var keys, secret bindings, or queue producers/consumers abort the build).

After the bindings are injected, the `wrangler.jsonc` output is valid JSONC and can be deployed directly with `wrangler deploy` — no manual edits needed.

---

## 6. Step 5 — Configure the plugin

If the install script printed configuration keys (from the plugin's `config_schema`), set them before deploying.

1. Navigate to `/plugins` as an admin
2. Find the plugin in the list and open its settings
3. Fill in the required and optional configuration values

### Secret vs. plain config

| Field type | Where to store |
|---|---|
| `"string"` | Plugin config UI at `/plugins` — stored as plain JSONB |
| `"secret"` | CMS secrets management at `/verwaltung/connections` — stored encrypted |

> Never enter secret values (API keys, tokens, passwords) into the plain config fields. Use the secrets management for anything sensitive.

### Future addon entitlement model

For paid addon plugins, configuration alone is not intended to be the final access-control layer.

Target behavior:

- plugin packages may be installed globally by a platform operator
- a tenant may provision addon access for multiple users inside that tenant
- actual plugin access should be enforced through active plugin-specific `user_roles` surfaced by the auth hook

This is not fully implemented yet, so installation and authorization should currently be treated as separate concerns in rollout planning.

### Reading config in plugin code

```typescript
import { supabase } from '@/lib/supabase';

async function getPluginConfig(pluginId: string): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('plugins')
    .select('config')
    .eq('slug', pluginId)
    .single();
  return (data?.config as Record<string, string>) ?? {};
}

const config = await getPluginConfig('my-plugin');
const clientId = config['google_client_id'] ?? '';
```

---

## 7. Step 6 — Build and deploy

Once all previous steps are complete, rebuild and deploy:

```bash
npm run deploy
```

This is the **canonical deploy path** — a wrapper that runs, in order:

1. **Consistency audit** (all binding moving parts) — aborts with fix commands when not converged; deploying a divergent config becomes impossible. Re-running it re-checks everything (the installer's step detection means pending steps from the install summary are usually already resolved by the audit's own commands).
2. **Remote drift check** — the same diff the wrangler config prompt shows, reported first and attributed (`plugin-resolved` vs `core-owned`).
3. `wrangler deploy` — if the config-diff prompt appears, it matches the drift report above; answer **yes** to converge (the local generated config is the source of truth) and **no** to "update the local config file with the remote values" (that would hand-edit generated configuration).

Raw `npx wrangler deploy` still works (`npm run deploy:raw`) but bypasses the checks — prefer `npm run deploy` to keep the flow self-verifying.

A full rebuild is required because the plugin system is **build-time** — the registry is a static TypeScript import, not a runtime loader.

---

## 8. Updating a plugin

Re-running `--add` re-downloads the repository from its registered ref (default: `HEAD`):

```bash
node scripts/install-plugins.mjs --add https://github.com/owner/my-plugin
```

The script will:
- Re-download and overwrite `plugins/{slug}/`
- Re-run npm dep installation if `required_npm_dependencies` changed
- Rebuild the registry
- Print any new migration files

Apply new migrations, then rebuild and deploy.

---

## 9. Pinning a version

To lock a plugin to a specific Git tag or commit, edit `plugins.json` directly:

```json
{
  "version": "1",
  "plugins": [
    {
      "id": "yatda",
      "repo_url": "https://github.com/JaYani55/YATDA",
      "ref": "v1.2.0"
    }
  ]
}
```

Then run the install script without `--add` to reinstall at that ref:

```bash
node scripts/install-plugins.mjs
```

Valid values for `ref`: any Git tag, branch name, or full commit SHA.

---

## 10. Removing a plugin

Use the uninstall script — it handles directory deletion, `plugins.json` cleanup, and registry rebuild in one step.

Before you run it, locate or copy the plugin's matching `migrations/down/*.sql` files. You will need them for the required manual database rollback after the filesystem cleanup, and the plugin directory will be removed by the script.

```bash
# macOS / Linux — interactive (prompts for confirmation)
node scripts/uninstall-plugin.mjs yatda

# Windows
scripts\uninstall-plugin.bat yatda

# Also uninstall npm packages that are not shared with other plugins
node scripts/uninstall-plugin.mjs yatda --prune-deps

# Skip confirmation prompt (for CI / scripting)
node scripts/uninstall-plugin.mjs yatda --yes --prune-deps

# Unregister only — keep plugins/yatda/ (moved to plugins/.uninstalled/yatda/)
node scripts/uninstall-plugin.mjs yatda --keep-files

# npm script shorthand
npm run plugin:remove -- yatda
```

### What the script does

1. Reads `plugin.json` from the plugin directory to collect its API entrypoint, migrations, npm packages, and wrangler bindings
2. Prompts for confirmation (skipped with `--yes`)
3. Deletes `plugins/{id}/` — **or**, with `--keep-files`, moves it to `plugins/.uninstalled/{id}/` instead (gitignored): the plugin is cleanly unregistered (registry rebuild, `plugins.json`, `plugin-deps.json`, deployment-state rows, claims) but the code survives. Re-install by moving the directory back into `plugins/` and running `npm run build` — the generated registries pick it up automatically; the install flow re-writes `plugins.json`, state/claims/bindings rows, and idempotent migrations re-run cleanly. `--prune-deps` is ignored (with a notice) in this mode so the packages stay installed
4. Removes the entry from `plugins.json`
5. Rebuilds the generated plugin registry artifacts — this automatically removes the plugin's wrangler bindings from `wrangler.jsonc` (the auto-generated PLUGIN BINDINGS section is regenerated from scratch)
6. Reports the plugin's recorded cloud resource instances from the binding ledger and prints the teardown command (`npm run bindings:provision -- --teardown <id>`) — environment-scoped instances (the plugin's own queues/KV namespaces) should be deleted; shared-scoped instances are never deleted
7. (`--prune-deps`) Runs `npm uninstall` for packages not shared with other installed plugins
8. Prints the remaining **manual steps** required

### Manual steps after the script

The script prints these explicitly, but the things that require manual action are:

**API route** — if the plugin had an `api_entrypoint`, remove its import and `app.route(...)` line from [api/index.ts](../../api/index.ts).

**Wrangler bindings** — handled automatically. The registry rebuild removes the plugin's bindings from the PLUGIN BINDINGS section of `wrangler.jsonc`.

**Database rollback** — run the plugin's matching files from `migrations/down/` manually in reverse order using the copy you saved before uninstall, or from the plugin repository at the exact installed ref. This is required unless you are intentionally retaining the plugin's schema and data. Do not treat uninstall as complete while forward migrations remain applied unintentionally.

**Database tables and data** — if you intentionally skip downmigrations because data must be retained, document that operational exception. Otherwise the expected uninstall path is to reverse the schema changes via the provided downmigrations, not to leave plugin-owned tables behind.

**Plugins UI** — go to `/plugins` as a SUPERADMIN and click **Entfernen** to remove the database record.

**Supabase API → Exposed schemas** — handled **automatically** since the
`--keep-files`/unregister flow: `scripts/uninstall-plugin.mjs` removes the
plugin schema from the in-DB PostgREST config (`pgrst.db_schemas`, the same
GUC the dashboard toggles write) via the Management API and sends
`NOTIFY pgrst, 'reload config'`. If no PAT was available or the update
failed, the script prints a manual fallback: uncheck the plugin schema under
Project Settings → API → Exposed schemas. Do not leave a dropped/revoked
schema exposed — PostgREST's schema-cache reload then fails (`PGRST002` —
every REST query 503s) until it is removed and the cache reloads.

After completing manual cleanup, rebuild and deploy:

```bash
npm run build
npx wrangler deploy
```

> Database tables created by the plugin's migrations are **not** dropped automatically. Drop them manually in Supabase if they are no longer needed.

> Every plugin migration set is expected to include matching downmigrations. Operators should run those downmigrations in reverse order during uninstall, rollback, or failed deployment recovery.

---

## 11. Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Required for DB mode | Supabase project URL (also used by the frontend). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Required for DB mode | Supabase publishable key. Legacy JWT-based anon keys still work during migration, but the target state is the modern publishable key. This is **not** a secret — it is already embedded in the frontend bundle. |
| `GITHUB_TOKEN` | Recommended | GitHub personal access token. Avoids unauthenticated rate limits (60 req/hr). Required for private repositories. |

> **No secret key is needed.** The installer uses the publishable key and authenticates as a regular user. Access to the `plugins` table is enforced by Supabase RLS + the project's custom JWT hook — only accounts with the `admin` or `super-admin` role can read and update plugin records.

> **JWT signing-key compatibility:** the installer and API surfaces in this repo do not verify access tokens against the legacy shared JWT secret. They rely on Supabase-managed token validation plus the `user_roles` claim injected by the custom access token hook, which is compatible with asymmetric signing keys.

### Supabase credentials

Both variables are typically already present in your `.env` (they are needed by the frontend). If you are running the script on a fresh checkout, copy `.env.example` to `.env` and fill them in:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxx
```

### Interactive login

When you run `npm run plugin:install` the script will prompt for your Supabase account credentials:

```
Plugin installer — Supabase login required
Only users with the admin or super-admin role can install plugins.

Email:    you@example.com
Password: ****************
✓ Logged in as you@example.com  [roles: super-admin]
```

The session exists only in memory for the duration of the script. It is signed out automatically when the operation finishes (or if it is interrupted). Nothing is persisted to disk.

### GITHUB_TOKEN

Set it in your shell before running the script:

```bash
# macOS / Linux
export GITHUB_TOKEN=ghp_...

# Windows (PowerShell)
$env:GITHUB_TOKEN = "ghp_..."
```

---

## 12. Troubleshooting

### `HTTP 403` or `HTTP 429` when downloading

GitHub rate-limited the request. Set `GITHUB_TOKEN` and retry.

### ID mismatch warning after install

If you see `src/plugins/{manifest-id}/ already exists — keeping slug "{derived-slug}"`, a directory with the canonical id already exists (possibly from a previous install). Remove the conflicting directory and re-run.

### npm install fails after script

The script prints the exact command to run manually:

```
! Install manually: npm install package@^1.0.0 ...
```

Run that command from the repository root, then rebuild.

### Registry not updated / plugin not appearing

The registry file `src/plugins/registry.ts` is only updated when the install script runs. If you manually moved files, re-run:

```bash
node scripts/install-plugins.mjs
```

### Queue deploy fails with a duplicate-consumer / already-registered-consumer error

The plugin declared a **concrete queue name** (legacy `wrangler_bindings`) that another
environment's deployment already registered as consumer of. Fix: migrate the plugin to
`wrangler_intents` (see [development.md §3.2](development.md#32-binding-intents-preferred)),
then run `npm run bindings:provision` — the provisioner creates the environment's own queue
(`{worker-name}--{plugin-id}--{purpose}`) so deployments never share instances.

### Wrangler deploy prompts "configuration differs from the remote configuration"

This is wrangler's safety check: your **local generated config** differs from the
live Worker (e.g. someone changed config in the Cloudflare dashboard). Instead of
adjudicating the prompt blind, get the classified diff first:

```bash
npm run bindings:check
```

It shows every added / removed / changed binding, attributed as
`plugin-resolved` or `core-owned`. The local generated config is the source of
truth — answer the prompt with **yes** only when every removal/change is
intended, and answer **no** to "update the local config file with the remote
values" (that would hand-edit the generated configuration). After one converged
deploy the prompt disappears until the config changes again.

### KV namespace id missing in the generated wrangler.jsonc

A `wrangler_intents.kv_namespaces` entry is declared but not yet provisioned for this
deployment. Run `npm run bindings:provision` (create-or-get + ledger) and rebuild —
wrangler deploy would fail until the namespace id is recorded in the binding ledger.

A `wrangler_intents.kv_namespaces` entry is declared but not yet provisioned for this
deployment. Run `npm run bindings:provision` (create-or-get + ledger) and rebuild —
wrangler deploy would fail until the namespace id is recorded in the binding ledger.

### Plugin routes return 404 after deploy

Check that:
1. The plugin's `id` in `src/index.tsx` matches the directory name under `src/plugins/`
2. All route paths start with `/plugins/{plugin-id}/`
3. The API entrypoint (if any) was mounted in `api/index.ts`
4. The build completed successfully after the registry was rebuilt
