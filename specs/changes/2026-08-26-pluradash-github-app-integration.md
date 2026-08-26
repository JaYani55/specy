# PluraDash GitHub App & Workspace Repository Management

Date: 2026-08-26

## Summary

Implements the PluraDash GitHub App integration for managing GitHub organization
repository assignments across tenant workspaces. All changes are contained
within the pluradash plugin workspace preserving EUPL software boundaries.

Core CMS authentication engines remain untouched; authorization delegates
directly to Supabase RLS and JWT user claims (`is_super_admin`).

## Files Added

- `plugins/pluradash/api/githubAuthService.ts` — Octokit-based token minting
  and org repository listing service
- `plugins/pluradash/migrations/020_create_workspace_repos.sql` — workspace
  repository mapping table with RLS
- `plugins/pluradash/migrations/down/020_create_workspace_repos.sql` — down-
  migration
- `plugins/pluradash/src/pages/AppsPage.tsx` — tenant workspace apps/repository
  grid view
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx` — super-admin
  management panel
- `plugins/pluradash/src/services/githubAppService.ts` — frontend service layer
  for GitHub App API calls

## Files Changed

- `plugins/pluradash/plugin.json` — added migration, npm deps, wrangler vars,
  secrets_store_secrets, api_metadata routes, capabilities
- `plugins/pluradash/api/index.ts` — added 5 new API endpoints (apps, admin/github)
- `plugins/pluradash/src/index.tsx` — registered routes, sidebar items, capabilities
- `plugins/pluradash/src/components/PluradashViewSelect.tsx` — added "Apps" view
- `wrangler.default.jsonc` — added GITHUB_APP_ID, GITHUB_CLIENT_ID,
  GITHUB_INSTALLATION_ID vars and SS_GITHUB_PRIVATE_KEY secrets_store_secret
- `plugin-deps.json` — added @octokit/auth-app and @octokit/rest
- `scripts/lib/plugin-workspace.mjs` — fixed comma handling in injected plugin vars

## Dependencies Added

- @octokit/auth-app: RSA key signing and installation access token requests
- @octokit/rest: Typed GitHub REST API client

## Database Impact

New table `pluradash.workspace_repos` maps GitHub repositories to tenant
workspaces with columns:

- `workspace_id` → references `public.tenants(id)` with cascade delete
- `github_repo_id` (bigint) — GitHub repository ID
- `github_repo_name`, `github_repo_url`, `default_branch`
- `created_at`, `updated_at`
- Unique constraint on `(workspace_id, github_repo_id)`

RLS policies:

- Tenant members can SELECT repos assigned to their workspace
- Super-admins have full ALL access
- Backward-compatible view `pluradash.pluradash_workspace_repos`

## API Surface

All endpoints mounted under `/api/plugin/pluradash/`:

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | /apps | authenticated | List repos assigned to workspace |
| POST | /apps/launch | authenticated | Initiate workspace session |
| GET | /admin/github/repos | super-admin | List org repos + assignments |
| POST | /admin/github/assign | super-admin | Assign/unassign repo to workspace |
| POST | /admin/github/token | super-admin | Mint GitHub installation token |

## Frontend Routes

| Path | Role | Component |
|------|------|-----------|
| `/plugins/pluradash/apps` | user | AppsPage (grid view) |
| `/dashboard/apps` | user | AppsPage (alternative) |
| `/admin/github-apps` | super-admin | GitHubAppsAdminPage |
| `/plugins/pluradash/admin/github-apps` | super-admin | GitHubAppsAdminPage |

## Configuration

- `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_INSTALLATION_ID` — plain vars
  in wrangler (injected by pluradash plugin.json)
- `SS_GITHUB_PRIVATE_KEY` — Cloudflare Secrets Store binding (RSA private key
  never exposed to browser)
- Master RSA keys remain inside service-cms secrets store

## Security Considerations

- Ephemeral installation tokens expire after 60 minutes
- GitHub Private Key resolved from Secrets Store binding (SS_GITHUB_PRIVATE_KEY)
- All tenant-facing queries route through RLS (tenant membership check)
- Super-admin endpoints gated by `requireAnyJwtRole(c, ['super-admin'])`
- No GitHub credentials exposed to client browsers