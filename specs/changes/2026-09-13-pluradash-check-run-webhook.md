# PluraDash check_run Webhook Feedback (Preview-Build Status)

Date: 2026-09-13

## Summary

Adds a `check_run` webhook feedback loop to the PluraDash apps sync feature.
Pushes of the sync engine to a repository's `dev` branch trigger the
Cloudflare "Workers Builds" GitHub Action as a check_run on the pushed
commit. The PluraDash plugin now receives these events via an HMAC-verified
public webhook, upserts the latest build status and the real preview URL per
repository (`pluradash.repo_deployments`), logs each event to
`pluradash.sync_logs`, shows the provisioning status in the GitHub Apps admin
panel, and displays build status + preview link on the tenant app card.

Repository webhooks (`events: ['check_run']`) are provisioned
programmatically via the GitHub App installation — the only manual step is
the one-time app permissions change (Webhooks: write, Checks: read-only).
Scope is dev-branch only; the production pipeline will follow later.

## Files Added

- `plugins/pluradash/api/webhooks.ts`
- `plugins/pluradash/api/sync/webhookLogic.ts`
- `plugins/pluradash/api/sync/webhookService.ts`
- `plugins/pluradash/migrations/025_create_repo_deployments.sql`
- `plugins/pluradash/migrations/down/025_create_repo_deployments.sql`
- `plugins/pluradash/specs/check-run-webhook.md`
- `plugins/pluradash/specs/changes/2026-09-13-check-run-webhook.md`
- `specs/changes/2026-09-13-pluradash-check-run-webhook.md`
- `tests/checkRunWebhook.test.mjs`

## Files Changed

- `plugins/pluradash/api/index.ts` — webhook mount, `GET /apps` deployment enrichment, super-admin webhook status/sync endpoints
- `plugins/pluradash/api/sync/logger.ts` — `SyncOperation` += `check_run`, `webhook.sync`
- `plugins/pluradash/src/services/githubAppService.ts` — deployment type + admin webhook clients
- `plugins/pluradash/src/pages/AppsPage.tsx` — Preview status tile on the app card
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx` — "Webhooks sync" button, log filter entries
- `plugins/pluradash/plugin.json` — migration 025, api_metadata routes, `SS_GITHUB_WEBHOOK_SECRET` Secrets Store intent, capability entry
- `specs/features/pluradash-github-app-integration.md` — API/config/webhook documentation
- `specs/features/pluradash-r2-sync-engine.md` — push preview URL feedback note
- `plugins/pluradash/specs/app-sync-mcp-tools.md` — push tool note

## Core Impact

### Database

- **No core (public schema) changes.** New plugin table
  `pluradash.repo_deployments` (migration 025 + downmigration, idempotent):
  unique `github_repo_id`, CHECK-constrained `build_status`
  (`running|succeeded|failed`), preview URLs, Cloudflare build/version IDs.
  RLS: writes service-role only; SELECT for super-admins or members of a
  workspace connected to the repo.

### Runtime

- New public (no-JWT) route `POST /api/plugin/pluradash/webhooks/check-run`
  mounted by the generated plugin route table; secured by
  `X-Hub-Signature-256` HMAC verification only (fail closed).
- New super-admin routes `GET /admin/github/webhooks` (provisioning status)
  and `POST /admin/github/webhooks/sync` (idempotent create/repair).
- `GET /apps` gains an optional `deployment` object per repo.
- `wrangler.jsonc` regenerated: `SS_GITHUB_WEBHOOK_SECRET` Secrets Store
  binding (secret name `GITHUB_WEBHOOK_SECRET`).

### API surface

All new routes are plugin-scoped under `/api/plugin/pluradash/` and
documented in `plugin.json` `api_metadata` (`pluradash-webhook-check-run`,
`pluradash-admin-github-webhooks`, `pluradash-admin-github-webhooks-sync`).
The core public API surface is unchanged.

## Operator notes

See `plugins/pluradash/specs/check-run-webhook.md` (setup checklist: secret →
deploy → permissions → "Webhooks sync" → verify via a dev push).

## Related

- `specs/features/pluradash-github-app-integration.md`
- `specs/features/pluradash-r2-sync-engine.md`
- `plugins/pluradash/specs/check-run-webhook.md`
