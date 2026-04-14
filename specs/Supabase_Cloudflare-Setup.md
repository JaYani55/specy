# Supabase + Cloudflare Workers — Setup Guide

Complete reference for deploying service-cms on Cloudflare Workers with Supabase as the database and auth backend. The interactive wizard (`npm run setup` / `setup.bat`) automates every step described here.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Start](#2-quick-start)
3. [What the Wizard Does — Step by Step](#3-what-the-wizard-does--step-by-step)
4. [Credential & Secret Storage Strategy](#4-credential--secret-storage-strategy)
5. [wrangler.jsonc Template System](#5-wranlerjsonc-template-system)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Database Migrations](#7-database-migrations)
8. [Supabase Auth Hook](#8-supabase-auth-hook)
9. [First Super-Admin User](#9-first-super-admin-user)
10. [Manual Setup (without wizard)](#10-manual-setup-without-wizard)
11. [Re-running Setup](#11-re-running-setup)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
| :--- | :--- |
| Node.js ≥ 20 (LTS) | [nodejs.org](https://nodejs.org) |
| npm ≥ 9 | Bundled with Node.js |
| Cloudflare account | [dash.cloudflare.com](https://dash.cloudflare.com) |
| Cloudflare Workers plan | Free plan is sufficient for development |
| Cloudflare Secrets Store | Created automatically by the wizard if absent |
| Supabase project | [supabase.com](https://supabase.com) |
| Supabase personal access token (PAT) | Required for migrations only — never stored |

> **Tip:** The batch launcher (`setup.bat` on Windows, `setup.sh` on Unix) checks for Node.js / npm and installs dependencies before starting the wizard.

---

## 2. Quick Start

```bash
# Windows
setup.bat

# Unix / macOS
./setup.sh

# Or directly
npm run setup
```

The wizard leaves the terminal window open after completion so you can review the full log.

---

## 3. What the Wizard Does — Step by Step

```
Step 1  Cloudflare authentication    wrangler login (skipped if already authenticated)
Step 2  Account ID                   Select from wrangler whoami memberships, or enter manually
Step 3  Secrets Store                List / create / select a Cloudflare Secrets Store
Step 4  Patch wrangler.jsonc         Copies wrangler.default.jsonc → wrangler.jsonc,
                                     substitutes CF_ACCOUNT_ID + SECRETS_STORE_ID
Step 5  CF_API_TOKEN                 wrangler secret put CF_API_TOKEN (Worker secret)
Step 6  Supabase credentials         Collects URL, publishable key, secret key, storage config
        ↳ Store SUPABASE_PUBLISHABLE_KEY  wrangler secret put (Worker secret)
        ↳ Store SUPABASE_SECRET_KEY       Cloudflare Secrets Store
        ↳ Write .env                      VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
        ↳ Patch wrangler.jsonc vars       SUPABASE_URL, STORAGE_PROVIDER, STORAGE_BUCKET
Step 7  Database migrations          Supabase Management API — ordered SQL files, plus
                                     storage RLS policies (Supabase provider only, generated
                                     from storage.default.sql with your bucket name)
        ↳ Register Auth hook              PATCH /v1/projects/{ref}/config/auth
Step 8  Edge Function sync + deploy  Syncs Supabase function secrets, stages the top-level
                                     function sources into a temporary Supabase CLI layout,
                                     and deploys send_email
Step 9  First super-admin user       Creates auth user, role, profile, and role assignment
Step 10 Build                        npm run build (Vite reads .env, bakes VITE_ vars in)
Step 11 Deploy                       wrangler deploy
```

### Why `.env` is written before build

`VITE_` variables are **build-time substitutions** — Vite inlines them into the JavaScript bundle at compile time. Cloudflare Worker `vars` and secrets are **runtime** values accessible only in server-side Worker code (`api/`), never in the browser bundle. The `.env` file bridges this gap: it is written by the wizard just before `npm run build` runs, and is never committed (git-ignored).

---

## 4. Credential & Secret Storage Strategy

Specy uses three different storage mechanisms depending on the sensitivity and access pattern of each value:

| Value | Storage | Where accessed | Why |
| :--- | :--- | :--- | :--- |
| `CF_API_TOKEN` | Worker secret (`wrangler secret put`) | Worker runtime (`api/`) | Used by the deployed Worker for the `/verwaltung/connections` UI — never in source |
| `SUPABASE_PUBLISHABLE_KEY` | Worker secret (`wrangler secret put`) | Worker runtime + Vite bundle | Safe for client use but must not be committed |
| `SUPABASE_SECRET_KEY` | Cloudflare Secrets Store | Worker runtime only (`api/`) | Bypasses RLS — must be strictly server-side; Secrets Store provides hardware-level isolation |
| `SUPABASE_URL` | `wrangler.jsonc` `vars` + `.env` | Worker runtime + Vite bundle | Non-sensitive; committed template uses placeholder |
| `STORAGE_PROVIDER` | `wrangler.jsonc` `vars` | Worker runtime (`api/routes/media.ts`) | Configuration value — `supabase` or `r2` |
| `STORAGE_BUCKET` | `wrangler.jsonc` `vars` | Worker runtime | Bucket/folder name |
| `R2_PUBLIC_URL` | `wrangler.jsonc` `vars` | Worker runtime | Only populated when `STORAGE_PROVIDER=r2` |

### Cloudflare Secrets Store vs Worker secrets

| | Secrets Store | Worker secrets (`wrangler secret put`) |
| :--- | :--- | :--- |
| Encryption | Hardware-level (HSM) | Encrypted at rest |
| Visibility | Never in plaintext after creation | Never in plaintext after creation |
| Access in Worker | Via binding (`env.SS_SUPABASE_SECRET_KEY`) | Via env directly (`env.SUPABASE_PUBLISHABLE_KEY`) |
| UI management | `/verwaltung/connections` in this app | Cloudflare dashboard or wrangler CLI |
| Use case | Highest-sensitivity keys (bypasses RLS) | API keys safe to use client-side |

---

## 5. wrangler.jsonc Template System

`wrangler.default.jsonc` is the **committed template** — it contains human-readable placeholder strings and is safe to push to git. `wrangler.jsonc` is the **generated runtime config** — it is git-ignored and must never be committed.

### Placeholders in `wrangler.default.jsonc`

| Placeholder | Replaced with |
| :--- | :--- |
| `REPLACE_WITH_YOUR_CF_ACCOUNT_ID` | Cloudflare Account ID (Step 2) |
| `REPLACE_WITH_YOUR_SECRETS_STORE_ID` | Secrets Store UUID (Step 3, appears twice) |
| `REPLACE_WITH_SUPABASE_URL` | `https://xxxx.supabase.co` (Step 6) |
| `REPLACE_WITH_STORAGE_PROVIDER` | `supabase` or `r2` (Step 6) |
| `REPLACE_WITH_STORAGE_BUCKET` | Bucket/folder name (Step 6) |

The wizard calls `patchWranglerJsonc()` after Step 3 for the CF values, then `patchWranglerVars()` after Step 6 for the Supabase/storage values. The file is updated in two passes so each function can be called independently.

### `secrets_store_secrets` binding

Only one secret uses the Secrets Store — `SUPABASE_SECRET_KEY`, bound as `SS_SUPABASE_SECRET_KEY`:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SS_SUPABASE_SECRET_KEY",
    "store_id": "<YOUR_SECRETS_STORE_ID>",
    "secret_name": "SUPABASE_SECRET_KEY"
  }
]
```

---

## 6. Environment Variables Reference

### Worker environment (`api/` — server-side only)

| Variable | Source | Description |
| :--- | :--- | :--- |
| `SUPABASE_URL` | `wrangler.jsonc` vars | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Worker secret | Supabase publishable key (former anon key) |
| `SS_SUPABASE_SECRET_KEY` | Secrets Store binding | Supabase secret key (former service role key) |
| `STORAGE_PROVIDER` | `wrangler.jsonc` vars | `supabase` \| `r2` |
| `STORAGE_BUCKET` | `wrangler.jsonc` vars | Storage bucket or folder name |
| `R2_PUBLIC_URL` | `wrangler.jsonc` vars | R2 public URL (R2 only) |
| `CF_API_TOKEN` | Worker secret | Cloudflare API token for Secrets Store management UI |
| `CF_ACCOUNT_ID` | `wrangler.jsonc` vars | Cloudflare Account ID |
| `SECRETS_STORE_ID` | `wrangler.jsonc` vars | Secrets Store UUID |

### Vite / browser bundle (`.env` — build-time)

| Variable | Source | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | `.env` (generated) | Supabase project URL — baked into JS bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` (generated) | Supabase publishable key — baked into JS bundle |

The `.env` file is written by the wizard in Step 6 and consumed by `npm run build` in Step 9. See `.env.example` for the expected format.

For Supabase Edge Functions introduced by the mail delivery feature, the setup flow syncs `APP_SUPABASE_SECRET_KEY` and `SECRETS_ENCRYPTION_KEY`. The function uses Supabase's built-in `SUPABASE_URL` runtime variable and a custom non-reserved key name for the privileged credential because hosted Edge Functions reject user-defined `SUPABASE_*` secret names. The source stays under the repository's top-level `functions/` directory; the wizard stages that directory into a temporary `supabase/functions/...` layout before calling the Supabase CLI.

---

## 7. Database Migrations

Migrations are applied via the **Supabase Management API** using a personal access token (PAT). The PAT is entered interactively during setup and is never stored.

### Required: Supabase Personal Access Token

Create a PAT at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

> ⚠️ Use a **PAT** — not your publishable key or secret key.  
> PATs start with `sbp_` or `sb_pat_`.

### Migration order

Applied in strict dependency order by `stepMigrations()`:

```
 1  preamble.sql
 2  user_profile.sql
 3  roles.sql
 4  employers.sql
 5  user_roles.sql
 6  mentor_groups.sql
 7  companies.sql
 8  staff_registry.sql
 9  products.sql
10  page_schemas.sql
11  page_schema_templates.sql
12  managed_secrets.sql
13  system_config.sql
14  forms.sql
15  forms_answers.sql
16  forms_notifications.sql
17  forms_notification_recipient_rls_fix.sql
18  mail_delivery.sql
19  forms_published_default.sql
20  plugins.sql
21  plugins_config_schema.sql
22  mentorbooking_products.sql
23  llm_specs.sql
24  page_schema_specs.sql
25  llm_specs_default_specy_schema_docs.sql
26  pages.sql
27  mentorbooking_events.sql
28  mentorbooking_events_archive.sql
29  mentorbooking_notifications.sql
30  agent_logs.sql
31  agent_logs_hardening.sql
32  Auth/Access_hook.sql
33  storage.sql (Supabase only)      — generated from storage.default.sql with your bucket name; skipped when STORAGE_PROVIDER=r2
```

All migrations are idempotent — safe to re-run. The wizard checks whether the `pages` table exists before asking to run migrations, and offers to skip if the schema is already present.

### Failure handling

If any migration fails, the full error is shown and the wizard asks:

```
Migration roles.sql failed. Continue with remaining migrations? (y/N)
```

The default is **No** — this stops immediately so you can diagnose the problem without risking partial state.

### API endpoint used

```
POST https://api.supabase.com/v1/projects/{ref}/database/query
Authorization: Bearer <PAT>
Content-Type: application/json

{ "query": "<SQL>" }
```

---

## 8. Supabase Auth Hook

The `custom_access_token_hook` function (defined in `migrations/Auth/Access_hook.sql`) injects custom JWT claims into every access token issued by Supabase Auth. This allows role-based access control to work without a separate API call on every request.

### What the hook does

On every JWT issuance, Supabase calls the hook with the event payload. The hook:
1. Reads the user's UUID from the event
2. Queries `public.user_roles JOIN public.roles` to get all role names
3. Injects them as `claims.user_roles` in the JWT

The frontend reads `user_roles` from the decoded JWT — no extra Supabase query is needed to check permissions.

### Permissions required

The migration file (`Auth/Access_hook.sql`) includes these statements after the function body:

```sql
-- Allow Supabase Auth internals to call the hook
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- Prevent regular roles from invoking the hook directly
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
```

### Automatic registration via the wizard

After all migrations succeed, the wizard calls the Supabase config API to enable the hook automatically:

```
PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
{
  "hook_custom_access_token_enabled": true,
  "hook_custom_access_token_uri": "pg-functions://postgres/public/custom_access_token_hook"
}
```

This is equivalent to clicking **Authentication → Auth Hooks → Add hook** in the dashboard with:
- Hook type: **Postgres function**
- Schema: **public**
- Function: **custom_access_token_hook**

### Manual registration (if the wizard API call fails)

1. Open your Supabase project dashboard
2. Navigate to **Authentication → Auth Hooks**
3. Click **Add hook → Customize Access Token (JWT) Claims hook**
4. Select **Postgres** as hook type
5. Schema: `public`, Function: `custom_access_token_hook`
6. Click **Update hook**

---

## 9. First Super-Admin User

After migrations succeed, the wizard optionally creates the first super-admin account. This step can be skipped and done manually later.

### What the wizard does

1. **Creates auth user** — `POST {supabaseUrl}/auth/v1/admin/users` with `email_confirm: true` so the account is immediately active (no verification email)
2. **Upserts `super-admin` role** — inserts into `public.roles` with `name='super-admin'`, `app=['mentorbooking']`; reads back the `id` if already exists
3. **Creates `user_profile` row** — inserts `user_id` + `Username` (email prefix)
4. **Assigns role** — inserts into `public.user_roles` linking `user_id` and `role_id`

All four sub-steps use the **Supabase secret key** directly (Admin API + REST API). No PAT is required. Each sub-step is independently non-fatal — a partial failure prints a warning and continues.

### Role structure created

```json
{
  "name": "super-admin",
  "description": "Full system access",
  "app": ["mentorbooking"]
}
```

The `app` field uses the `app_enum` type defined in `preamble.sql`.

### Manual creation (if wizard step is skipped)

```sql
-- 1. Create role (idempotent)
INSERT INTO public.roles (name, description, app)
VALUES ('super-admin', 'Full system access', ARRAY['mentorbooking']::app_enum[])
ON CONFLICT (name) DO NOTHING;

-- 2. Create user_profile (run after creating the auth user in the dashboard)
INSERT INTO public.user_profile (user_id, "Username")
VALUES ('<USER_UUID>', '<username>');

-- 3. Assign role
INSERT INTO public.user_roles (user_id, role_id)
SELECT '<USER_UUID>', id FROM public.roles WHERE name = 'super-admin';
```

---

## 10. Manual Setup (without wizard)

If you prefer to configure everything manually, follow these steps in order.

### 10.1 Cloudflare

```bash
npx wrangler login
npx wrangler whoami  # note your Account ID

# Create Secrets Store
npx wrangler secrets-store store create specy --remote
# Note the returned store UUID
```

### 10.2 Generate wrangler.jsonc

Copy `wrangler.default.jsonc` to `wrangler.jsonc` and replace every placeholder:

```bash
cp wrangler.default.jsonc wrangler.jsonc
# Edit wrangler.jsonc: replace REPLACE_WITH_YOUR_CF_ACCOUNT_ID,
# REPLACE_WITH_YOUR_SECRETS_STORE_ID (twice), REPLACE_WITH_SUPABASE_URL,
# REPLACE_WITH_STORAGE_PROVIDER, REPLACE_WITH_STORAGE_BUCKET
```

### 10.3 Worker secrets

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SECRETS_ENCRYPTION_KEY
```

If this is the first time the Worker has ever been deployed and Wrangler rejects the secret write because the Worker does not exist yet, complete the first `wrangler deploy`, then run the failed `wrangler secret put ...` commands again and redeploy once more. The setup wizard now retries this automatically after the first deploy.

### 10.4 Secrets Store secret

```bash
npx wrangler secrets-store secret create <STORE_ID> \
  --name SUPABASE_SECRET_KEY \
  --value <your-secret-key> \
  --scopes workers \
  --remote
```

### 10.5 .env file

```bash
# Create .env (git-ignored)
echo "VITE_SUPABASE_URL=https://xxxx.supabase.co" > .env
echo "VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_..." >> .env
```

### 10.6 Apply migrations

Get a PAT from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens), then apply each file from `migrations/` in the order listed in [section 7](#7-database-migrations) via `psql`, the Supabase SQL editor, or the Management API.

**Supabase Storage RLS policies (Supabase provider only):** After `Auth/Access_hook.sql`, copy `migrations/storage.default.sql`, replace every occurrence of `REPLACE_WITH_STORAGE_BUCKET` with your bucket name, and apply the result. Skip this step if using Cloudflare R2.

### 10.7 Register Auth hook

See [section 8 — Manual registration](#manual-registration-if-the-wizard-api-call-fails).

### 10.8 Deploy the send_email edge function

The mail delivery function is stored in the repository under `functions/send_email`, but the Supabase CLI expects a `supabase/functions/<name>` project layout when bundling for deploy. Stage a temporary workdir and deploy from there:

```powershell
$deployRoot = Join-Path $PWD ".supabase-deploy"
Remove-Item $deployRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $deployRoot "supabase/functions/send_email") -Force | Out-Null
Copy-Item ".\functions\config.toml" (Join-Path $deployRoot "supabase\config.toml") -Force
Copy-Item ".\functions\send_email\*" (Join-Path $deployRoot "supabase\functions\send_email") -Recurse -Force
npx -y supabase secrets set APP_SUPABASE_SECRET_KEY=<your-supabase-secret-key> SECRETS_ENCRYPTION_KEY=<your-secrets-encryption-key> --project-ref <project-ref> --workdir $deployRoot
npx -y supabase functions deploy send_email --use-api --project-ref <project-ref> --workdir $deployRoot
Remove-Item $deployRoot -Recurse -Force -ErrorAction SilentlyContinue
```

The function reads `SUPABASE_URL` from the hosted Supabase Edge runtime and expects `APP_SUPABASE_SECRET_KEY` plus `SECRETS_ENCRYPTION_KEY` to be synced before deploy. `functions/config.toml` ships with `verify_jwt = false` because the Worker invokes the function server-to-server with the Supabase secret key rather than an end-user JWT.

### 10.9 Build and deploy

```bash
npm run build
npx wrangler deploy
```

---

## 11. Re-running Setup

`npm run setup` can be re-run at any time:

- **Already authenticated?** The wizard detects `wrangler whoami` and asks whether to reuse the existing account.
- **Secrets Store already exists?** The wizard lists it and lets you select it.
- **Database already migrated?** The wizard detects the `pages` table and offers to skip or re-run.
- **First-admin step?** Can be skipped — existing users are unaffected. Re-running will attempt to insert with `ON CONFLICT DO NOTHING` semantics (`resolution=merge-duplicates`).
- **`.env` and `wrangler.jsonc`** are overwritten with fresh values on every run.

---

## 12. Troubleshooting

### "Missing Supabase environment variables" in the browser

The `VITE_` variables were not present when `npm run build` ran. Fix:
1. Re-run `npm run setup` — the wizard writes `.env` before the build step.
2. Or manually create `.env` using `.env.example` as a template, then `npm run build` again.

### Migration fails with `type "app_enum[]" does not exist`

`preamble.sql` did not run first. Check that the migration order is correct and re-run from `preamble.sql`.

### Migration fails with `relation "..." does not exist`

A dependency was applied out of order. Stop at the failing step (answer **No** to "Continue?"), verify that all preceding migrations succeeded, and re-run.

### Auth hook registration fails (HTTP 401 / 403)

The PAT does not have sufficient permissions or has expired. Create a new PAT at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and register the hook manually (see [section 8](#manual-registration-if-the-wizard-api-call-fails)).

### `wrangler secret put` fails

On a brand-new installation, Wrangler may reject a secret write until the first Worker deploy exists. The setup wizard now retries these writes automatically after the initial deploy and performs a follow-up deploy when the retry succeeds. If it still fails, run the reported `wrangler secret put ...` command manually and deploy again.

### Supabase Edge Function deploy fails with `Could not find npm package 'nodemailer'`

The deployed function source is pinned to a version that the Supabase bundler cannot resolve. Pull the current code before deploying; the function now uses a function-local dependency config under `functions/send_email/deno.json` with a valid Nodemailer version.

### `Could not store … — set it manually via /verwaltung/connections UI`

The Secrets Store write failed (usually a permissions issue on the CF_API_TOKEN). After your first deploy, open `/verwaltung/connections` in the app to set secrets through the UI instead.

### Supabase Admin API returns 422 on user creation

The email already exists. Either delete the existing user in the Supabase dashboard (**Authentication → Users**) or skip the first-admin step and assign the role manually.
