# Plugin Installation Guide

This document covers the complete lifecycle of a plugin: registering, installing, configuring, updating, and removing it.

For plugin **development** (writing code, manifest fields, API routes, etc.) see [Plugin_Development.md](Plugin_Development.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1 — Register the plugin in the UI](#2-step-1--register-the-plugin-in-the-ui)
3. [Step 2 — Run the install script](#3-step-2--run-the-install-script)
4. [Step 3 — Apply database migrations](#4-step-3--apply-database-migrations)
5. [Step 4 — Mount API routes](#5-step-4--mount-api-routes)
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

---

## 2. Step 1 — Register the plugin in the UI

Before installing locally, add the plugin record to the database so the CMS tracks it.

1. Navigate to `/plugins` as a SUPERADMIN
2. Click **Plugin registrieren**
3. Fill in the GitHub repository URL, slug (`id` from `plugin.json`), display name, and any other metadata
4. Click **Registrieren** — this writes a row to the `plugins` table

> This step can be skipped if the plugin is only used locally and never needs to appear in the admin UI. The install script works without it.

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
3. Extracts it to `src/plugins/{slug}/`
4. **ID reconciliation** — if `plugin.json` declares an `id` that differs from the GitHub-derived slug (e.g. `yatda` vs `jayani55-yatda`), the directory is automatically renamed and `plugins.json` is updated to use the canonical id
5. **npm dependencies** — if `plugin.json` declares `required_npm_dependencies`, runs `npm install` for those packages automatically
6. Rebuilds `src/plugins/registry.ts` so the new plugin is wired into the build
7. Prints any SQL migration files that need to be applied
8. Prints any `config_schema` keys that need to be set

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

**Via Supabase Dashboard:**
1. Open the Supabase Dashboard → SQL Editor
2. Open each migration file from `src/plugins/{slug}/migrations/` in order
3. Run them sequentially

**Files are printed in the terminal output**, for example:
```
> src/plugins/yatda/migrations/001_create_extensions.sql
> src/plugins/yatda/migrations/002_create_connectors.sql
...
```

> Apply migrations in numeric order. Never modify an already-applied migration — create a new numbered file instead.

---

## 5. Step 4 — Mount API routes

Plugin API routes are **not** mounted automatically. This is intentional: it requires an explicit code-review step before new endpoints are exposed.

If the plugin's `plugin.json` declares an `api_entrypoint`, add one import and one route line to [api/index.ts](../api/index.ts):

```typescript
// api/index.ts
import myPluginRoute from '../src/plugins/my-plugin/api/index';

app.route('/api/plugins/my-plugin', myPluginRoute);
```

Replace `my-plugin` with the plugin's actual `id`. The plugin's own route handlers will then be reachable under `/api/plugins/{id}/`.

> If the plugin has no `api_entrypoint` field, skip this step.

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

Once all previous steps are complete, rebuild the application and deploy:

```bash
npm run build
npx wrangler deploy
```

A full rebuild is required because the plugin system is **build-time** — the registry is a static TypeScript import, not a runtime loader.

---

## 8. Updating a plugin

Re-running `--add` re-downloads the repository from its registered ref (default: `HEAD`):

```bash
node scripts/install-plugins.mjs --add https://github.com/owner/my-plugin
```

The script will:
- Re-download and overwrite `src/plugins/{slug}/`
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

```bash
# macOS / Linux — interactive (prompts for confirmation)
node scripts/uninstall-plugin.mjs yatda

# Windows
scripts\uninstall-plugin.bat yatda

# Also uninstall npm packages that are not shared with other plugins
node scripts/uninstall-plugin.mjs yatda --prune-deps

# Skip confirmation prompt (for CI / scripting)
node scripts/uninstall-plugin.mjs yatda --yes --prune-deps

# npm script shorthand
npm run plugin:remove -- yatda
```

### What the script does

1. Reads `plugin.json` from the plugin directory to collect its API entrypoint, migrations, and npm packages
2. Prompts for confirmation (skipped with `--yes`)
3. Deletes `src/plugins/{id}/`
4. Removes the entry from `plugins.json`
5. Rebuilds `src/plugins/registry.ts`
6. (`--prune-deps`) Runs `npm uninstall` for packages not shared with other installed plugins
7. Prints the remaining **manual steps** required

### Manual steps after the script

The script prints these explicitly, but the things that require manual action are:

**API route** — if the plugin had an `api_entrypoint`, remove its import and `app.route(...)` line from [api/index.ts](../api/index.ts).

**Database tables** — the script prints the plugin's migration files as a reminder. Drop the tables manually in Supabase if you no longer need the data.

**Plugins UI** — go to `/plugins` as a SUPERADMIN and click **Entfernen** to remove the database record.

After completing manual cleanup, rebuild and deploy:

```bash
npm run build
npx wrangler deploy
```

> Database tables created by the plugin's migrations are **not** dropped automatically. Drop them manually in Supabase if they are no longer needed.

---

## 11. Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Required for DB mode | Supabase project URL (also used by the frontend). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Required for DB mode | Supabase anon/publishable key. This is **not** a secret — it is already embedded in the frontend bundle. |
| `GITHUB_TOKEN` | Recommended | GitHub personal access token. Avoids unauthenticated rate limits (60 req/hr). Required for private repositories. |

> **No service role key is needed.** The installer uses the anon key and authenticates as a regular user. Access to the `plugins` table is enforced by Supabase RLS + the project's custom JWT hook — only accounts with the `admin` or `super-admin` role can read and update plugin records.

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

### Plugin routes return 404 after deploy

Check that:
1. The plugin's `id` in `src/index.tsx` matches the directory name under `src/plugins/`
2. All route paths start with `/plugins/{plugin-id}/`
3. The API entrypoint (if any) was mounted in `api/index.ts`
4. The build completed successfully after the registry was rebuilt
