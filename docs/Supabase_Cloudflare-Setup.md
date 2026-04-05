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
Step 7  Database migrations          Supabase Management API — 15 SQL files in order, plus
                                     storage RLS policies (Supabase provider only, generated
                                     from storage.default.sql with your bucket name)
        ↳ Register Auth hook              PATCH /v1/projects/{ref}/config/auth
Step 8  First super-admin user       Creates auth user, role, profile, and role assignment
Step 9  Build                        npm run build (Vite reads .env, bakes VITE_ vars in)
Step 10 Deploy                       wrangler deploy
```

### Why `.env` is written before build

`VITE_` variables are **build-time substitutions** — Vite inlines them into the JavaScript bundle at compile time. Cloudflare Worker `vars` and secrets are **runtime** values accessible only in server-side Worker code (`api/`), never in the browser bundle. The `.env` file bridges this gap: it is written by the wizard just before `npm run build` runs, and is never committed (git-ignored).

---

## 4. Credential & Secret Storage Strategy

Service-cms uses three different storage mechanisms depending on the sensitivity and access pattern of each value:

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
 1  preamble.sql                     — app_enum type + all trigger functions (must be first)
 2  user_profile.sql                 — no deps
 3  roles.sql                        — needs app_enum (preamble)
 4  employers.sql                    — needs user_profile
 5  user_roles.sql                   — needs roles + user_profile
 6  mentor_groups.sql                — standalone
 7  products.sql                     — needs trigger functions (preamble)
 8  page_schemas.sql                 — needs trigger functions (preamble)
 9  mentorbooking_products.sql       — needs products (FK)
10  pages.sql                        — renames products→pages; renames FK on mentorbooking_products
11  mentorbooking_events.sql         — needs employers + mentorbooking_products + event trigger fns
12  mentorbooking_events_archive.sql — needs employers + mentorbooking_products
13  mentorbooking_notifications.sql  — needs user_profile
14  agent_logs.sql                   — needs page_schemas
15  Auth/Access_hook.sql             — JWT claims hook fn + GRANT/REVOKE (must be last)
16  storage.sql (Supabase only)      — generated from storage.default.sql with your bucket name;
                                       skipped when STORAGE_PROVIDER=r2
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
npx wrangler secrets-store store create service-cms --remote
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
```

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

### 10.8 Build and deploy

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

The Worker must exist before secrets can be stored. Run a `wrangler deploy` (with placeholder values if necessary) to create the Worker, then re-run `npm run setup`.

### `Could not store … — set it manually via /verwaltung/connections UI`

The Secrets Store write failed (usually a permissions issue on the CF_API_TOKEN). After your first deploy, open `/verwaltung/connections` in the app to set secrets through the UI instead.

### Supabase Admin API returns 422 on user creation

The email already exists. Either delete the existing user in the Supabase dashboard (**Authentication → Users**) or skip the first-admin step and assign the role manually.
