# PluraDash check_run Feedback: Builds on All Branches (main/master & others)

Date: 2026-10-12

## Summary

The PluraDash check_run webhook feedback loop previously stored only the
latest `dev`-branch build per repository; check_run events for `main`,
`master` or any other branch were logged but dropped. The loop now tracks one
status row per **repository and branch** and additionally captures the link
to the build as given by the check_run (`details_url`, fallback `html_url`).
The tenant apps section (`/plugins/pluradash/apps`) shows one build tile per
branch — branch name, build state (running/succeeded/failed) and a link
(version preview URL when the CI output provided one, otherwise the check_run
build link).

## Files Added

- `plugins/pluradash/migrations/026_repo_deployments_per_branch.sql` (+ downmigration)
- `plugins/pluradash/specs/changes/2026-10-12-per-branch-build-status.md`
- `specs/changes/2026-10-12-pluradash-per-branch-build-status.md` (this file)

## Files Changed

- `plugins/pluradash/plugin.json` — migration 026 registered; webhook api_metadata wording
- `plugins/pluradash/api/sync/webhookLogic.ts` — `ParsedCheckRun.buildUrl` from `check_run.details_url`/`html_url`
- `plugins/pluradash/api/sync/webhookService.ts` — dev-branch filter removed; upsert per `(github_repo_id, branch)`; `build_url` persisted; `pickPrimaryDeployment`/`compareDeployments` helpers
- `plugins/pluradash/api/index.ts` — `GET /apps` returns `deployments[]` per repo (running-first, then newest) plus primary `deployment`
- `plugins/pluradash/src/services/githubAppService.ts` — `buildUrl` on `RepoDeploymentStatus`; `deployments[]` on `WorkspaceRepo`
- `plugins/pluradash/src/pages/AppsPage.tsx` — per-branch build tiles with branch chip, status badge and preview/build link
- `plugins/pluradash/specs/check-run-webhook.md` — per-branch contract
- `tests/checkRunWebhook.test.mjs` — regression tests (build link extraction; main/master/feature-branch tracking)
- `specs/features/pluradash-github-app-integration.md` — webhook/apps card description updated

## Core Impact

### Database

- No core (public schema) changes. Plugin migration 026 (idempotent, with
  downmigration): `build_url TEXT` column, `NULL`-branch backfill to `dev`,
  unique constraint widened to `(github_repo_id, branch)`, lookup index.

### Runtime

- check_run events for non-dev branches are now persisted instead of dropped.
- `GET /apps` gains `deployments` per repo; the existing `deployment` field is
  preserved (dev branch preferred, else most recent).

### API surface

- Plugin-scoped only (`/api/plugin/pluradash/…`); core public API unchanged.

## Operator notes

- No re-provisioning needed: repository webhooks already deliver check_run
  events for all branches; main/master rows appear with the next delivery.