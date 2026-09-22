# PluraDash GitHub App & Workspace Repository Management

Feature-level documentation for the PluraDash GitHub App integration. This feature
lets super-admins map GitHub organization repositories to tenant workspaces and lets
tenant users launch those repositories from the PluraDash dashboard.

> **Scope note:** this is a **plugin feature** implemented entirely inside the
> `pluradash` plugin workspace (`plugins/pluradash/`). Core CMS authentication and
> authorization engines are untouched; authorization delegates to Supabase RLS and
> JWT user claims (`is_super_admin`).

## Overview

The integration has two surfaces:

1. **Super-admin management panel** (`/admin/github-apps`) — lists live GitHub
   organization repositories, shows current workspace assignments, and lets a
   super-admin assign/unassign repositories to tenant workspaces.
2. **Tenant apps grid** (`/plugins/pluradash/apps`) — lists the repositories assigned
   to the active workspace and launches a workspace session for a selected repository.

GitHub access is performed through a **GitHub App** using short-lived installation
access tokens minted server-side. No GitHub credentials ever reach the browser.

## Architecture

```
GitHubAppsAdminPage ──► githubAppService ──► /api/plugin/pluradash/admin/github/*
        │                                          │
        │                                          ▼
        │                              githubAuthService (Octokit)
        │                                          │
        │                          createAppAuth + installation token
        │                                          │
        │                                          ▼
        │                              GitHub REST API (org repos)
        │
AppsPage ────────────► githubAppService ──► /api/plugin/pluradash/apps
                                                  │
                                                  ▼
                                        pluradash.workspace_repos (RLS)
```

### Backend service

`plugins/pluradash/api/githubAuthService.ts`:

- `resolveGitHubPrivateKey(env)` — resolves the GitHub App RSA private key from the
  Cloudflare Secrets Store binding (`SS_GITHUB_PRIVATE_KEY`), the Worker env var
  (`GITHUB_PRIVATE_KEY`), or `process.env`, in that order.
- `normalizePrivateKey(rawKey)` — unescapes literal `\n` sequences, trims surrounding
  quotes, and converts legacy PKCS#1 keys to PKCS#8 (see [Private key format](#private-key-format)).
- `getGitHubAppConfig(env)` — reads `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, and
  `GITHUB_INSTALLATION_ID` with sensible defaults.
- `getGitHubInstallationToken(env, installationId?)` — mints a 60-minute installation
  access token via `@octokit/auth-app`.
- `getGitHubOctokit(env, installationId?)` — returns an authenticated Octokit client.
- `listOrganizationRepositories(env)` — paginates
  `apps.listReposAccessibleToInstallation` and normalizes the result.

### API surface

All endpoints are mounted under `/api/plugin/pluradash/`:

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/apps` | authenticated | List repos assigned to the active/requested workspace (RLS-filtered); includes per-app `fileCount` and `totalBytes` from the R2 apps prefix |
| POST | `/apps/launch` | authenticated | Initiate a workspace session for an assigned repository |
| GET | `/admin/github/repos` | super-admin | List live org repos + workspace assignments + workspaces |
| POST | `/admin/github/assign` | super-admin | Assign/unassign a repository to a workspace. **Assign automatically provisions the data** (see [Provisioning lifecycle](#provisioning-lifecycle-resync)); **unassign automatically removes all provisioned data** (R2 objects + storage catalog rows) |
| POST | `/admin/github/sync` | super-admin | **Re-Sync** — re-provisions the repo data in every connected workspace (or one `workspaceId`): GitHub dev tree → R2, data objects + data-space verification per user. Returns per-workspace/per-user results |
| POST | `/admin/github/token` | super-admin | Mint a short-lived installation access token |
| POST | `/webhooks/check-run` | **public (HMAC)** | check_run webhook receiver — verifies `X-Hub-Signature-256`, upserts build status + preview URL into `pluradash.repo_deployments`, logs to `pluradash.sync_logs` |
| GET | `/admin/github/webhooks` | super-admin | check_run webhook provisioning status per assigned repo (+ `secretConfigured`) |
| POST | `/admin/github/webhooks/sync` | super-admin | Idempotently create/repair the check_run webhook on every assigned repo |
| GET | `/admin/github/logs` | super-admin | Recent sync operation logs + aggregate stats (filters: `operation`, `tenantId`, `status`, `limit`) |
| DELETE | `/admin/github/logs` | super-admin | Bulk cleanup: `?before=<ISO>` or `?confirm=true` |

### Frontend routes

| Path | Role | Component |
|------|------|-----------|
| `/plugins/pluradash/apps` | user | `AppsPage` (grid view) |
| `/dashboard/apps` | user | `AppsPage` (alternative) |
| `/admin/github-apps` | super-admin | `GitHubAppsAdminPage` |
| `/plugins/pluradash/admin/github-apps` | super-admin | `GitHubAppsAdminPage` |

## Provisioning lifecycle (Re-Sync)

Workspace repository data follows an explicit provisioning lifecycle, driven
by the GitHub Apps admin panel and implemented in
`plugins/pluradash/api/sync/provisioning.ts`:

| Event | Behavior |
|-------|----------|
| **Re-Sync** ("Re-Sync" button per repo in the admin panel → `POST /admin/github/sync`) | Re-provisions the repo data in **every** workspace the repo is connected to |
| **Connect** (assign → `POST /admin/github/assign`, action `assign`) | Automatically provisions the data for the newly connected workspace after the access row upsert |
| **Unlink** (unassign → action `unassign`) | Automatically deletes the access row **and** all provisioned data (R2 objects incl. manifests, all users/branches + `tenant_storage_objects` rows; quota freed via the usage-sync trigger) |

Per (workspace, repo) run the provisioning engine:

1. fetches the GitHub `dev` tree **once per repository** (auto-creates a
   missing `dev` branch from the default branch),
2. resolves target users — every user with existing provisioned data (their
   copy is refreshed) plus every active workspace member holding an active
   storage allocation (fresh provisioning),
3. verifies the per-user **data space** (`tenant_storage_allocations`) can
   absorb the net byte delta; users without an active allocation are skipped
   with reason `no-allocation` / `suspended-allocation` / `quota-exceeded`,
4. mirrors the tree into R2, writes the data objects (`tenant_storage_objects`,
   scope `apps`) and rewrites the manifests using the exact key layout of the
   sync engine (see [the sync engine doc](pluradash-r2-sync-engine.md)),
5. logs to `pluradash.sync_logs` (operation `repo.resync`, phases
   `assign-provision` / `unlink-cleanup` / admin resync).

Provisioning on assign is fail-soft — the assignment stays valid; problems
are returned in the response (`provisioning` / `provisioningError`) and
surfaced in the admin panel toasts. The Re-Sync endpoint returns detailed
per-workspace/per-user results.

## Operation logging & user-facing behavior

Every app/sync operation is logged to `pluradash.sync_logs` (see
[the sync engine doc](pluradash-r2-sync-engine.md#operation-logging)) —
including app launches and repo (un-)assignments. Super-admins review them in
the GitHub Apps admin panel (**Sync-Logs** tab), modeled after the Agent
Communication Logs view.

User-facing surfaces deliberately hide all GitHub details. GitHub is an
infrastructure/CI-CD concern of the administrator:

- `/plugins/pluradash/apps` shows the app name, stored size (total bytes),
  file count and the **preview build status** (running/succeeded/failed plus a
  link to the running preview deployment) — no GitHub link, no branch
  information, no repository URL.
- Workspace users can download the app files as a ZIP via the **ZIP** button
  (`GET /sync/archive`) for portability.
- The storage stats in the PluraDash file overview include an **Apps**
  category with file counts and byte totals.

## Database

Table `pluradash.workspace_repos` maps GitHub repositories to tenant workspaces:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `workspace_id` | uuid | references `public.tenants(id)` with cascade delete |
| `github_repo_id` | bigint | GitHub repository ID |
| `github_repo_name` | text | full name, e.g. `owner/repo` |
| `github_repo_url` | text | HTML URL |
| `default_branch` | text | default `'main'` |
| `created_at` / `updated_at` | timestamptz | auto-managed |

- Unique constraint on `(workspace_id, github_repo_id)`.
- Backward-compatible view `pluradash.pluradash_workspace_repos`.

RLS policies:

- `tenant_members_select_workspace_repos` — active tenant members (or super-admins)
  can `SELECT` repos assigned to their workspace.
- `super_admins_all_workspace_repos` — super-admins have full `ALL` access.
- `tenant_admins_manage_workspace_repos` — tenant admins (`is_tenant_admin(workspace_id)`)
  can `INSERT`/`UPDATE`/`DELETE` repos for **their own workspace only** (added by migration
  `021_workspace_repos_tenant_admin_write_rls.sql` to fix assignment failures for the
  workspace's own admin, e.g. the 'jay' workspace owner assigning a repo to their
  workspace).

> **Write authorization model:** writes to `workspace_repos` are gated by
> `is_super_admin() OR is_tenant_admin(workspace_id)`. A tenant admin can therefore
> assign/unassign GitHub repositories for their own workspace without needing the
> super-admin role; the `workspace_id` foreign key + RLS `WITH CHECK` guarantees they
> can never touch another workspace's rows.

## Configuration

| Variable | Kind | Purpose |
|----------|------|---------|
| `GITHUB_APP_ID` | wrangler var | GitHub App ID (also used as client ID fallback) |
| `GITHUB_CLIENT_ID` | wrangler var | GitHub App client ID |
| `GITHUB_INSTALLATION_ID` | wrangler var | Installation ID for org-wide operations |
| `SS_GITHUB_PRIVATE_KEY` | Secrets Store binding | RSA private key (never exposed to browser) |
| `SS_GITHUB_WEBHOOK_SECRET` | Secrets Store binding | Webhook secret for the check_run feedback loop (secret name `GITHUB_WEBHOOK_SECRET`; plain Worker secret fallback supported) |

These are injected into `wrangler.jsonc` by the pluradash `plugin.json` manifest via
`ensure-registry.mjs`.

## Preview-Build feedback (check_run webhook)

Sync-engine pushes to `dev` trigger the Cloudflare "Workers Builds" GitHub
Action, which runs as a check_run on the pushed commit. Repository webhooks
(`events: ['check_run']`) are provisioned programmatically per assigned repo
(the app needs **Webhooks: write** + **Checks: read-only**); the verified
events feed the latest build status and the real preview URL into
`pluradash.repo_deployments` and onto the tenant app card
(`/plugins/pluradash/apps`). Full contract:
`plugins/pluradash/specs/check-run-webhook.md` (plugin workspace).

## Private key format

`@octokit/auth-app` (via `universal-github-app-jwt`) **only accepts PKCS#8** private
keys (`-----BEGIN PRIVATE KEY-----`). GitHub's "Generate a private key" flow can emit
the legacy **PKCS#1** format (`-----BEGIN RSA PRIVATE KEY-----`), which causes the
following error at token-mint time:

```
[universal-github-app-jwt] Private Key is in PKCS#1 format, but only PKCS#8 is supported.
```

To make the integration resilient, `normalizePrivateKey()` **auto-converts** PKCS#1
keys to PKCS#8 at runtime:

- `convertPkcs1ToPkcs8(pem)` wraps the PKCS#1 `RSAPrivateKey` DER inside a PKCS#8
  `PrivateKeyInfo` structure — prepending the `rsaEncryption` OID
  (`1.2.840.113549.1.1.1`) + `NULL` and wrapping the key in an `OCTET STRING`.
- The conversion is pure JavaScript (DER length encoding + `atob`/`btoa`), so it runs
  in Cloudflare Workers without Node `crypto`.
- PKCS#8 keys pass through unchanged.

This means either key format can be stored in the Secrets Store and the integration
will still mint tokens correctly.

## Security considerations

- Installation access tokens are ephemeral (60-minute expiry).
- The RSA private key is resolved only from the Secrets Store binding or Worker
  secrets; it is never sent to the browser.
- Tenant-facing queries route through RLS (tenant membership check).
- Super-admin endpoints are gated by `requireAnyJwtRole(c, ['super-admin'])`.
- No GitHub credentials are exposed to client browsers.

## Related

- Change record: [`../changes/2026-08-26-pluradash-github-app-integration.md`](../changes/2026-08-26-pluradash-github-app-integration.md)
- Key-format fix: [`../changes/2026-08-27-pluradash-github-app-pkcs8-key-fix.md`](../changes/2026-08-27-pluradash-github-app-pkcs8-key-fix.md)
