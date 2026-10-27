# 2026-10-26 — PluraDash App Deploy-State Info & `/apps/info` Endpoint

## Summary

Plugin-scope change (EUPL: all logic lives in the pluradash plugin workspace —
`plugins/pluradash/`; no core files touched):

The PluraDash Apps overview now surfaces a **deploy-state info banner** per
app card when changes are waiting to be deployed (condition: the preview/dev
build succeeded AND dev is ahead of the production branch), and the deploy
button is disabled when there is nothing to deploy. The production branch is
resolved **dynamically** from the GitHub API at request time.

A new bearer-authenticated endpoint `GET /api/plugin/pluradash/apps/info`
returns the per-app deploy state (`deployState`, `canDeploy`,
`changesToDeploy`, ahead/behind counts, branch heads), the dynamically
resolved production branch and the preview/build URLs of the latest dev
build. It is registered in the plugin `api_metadata` and therefore documented
in the core `/admin/api` endpoint catalog as `pluradash-apps-info`.

Deploy state is derived from two signals: a live GitHub compare of
`{production}...dev` (only `ahead_by > 0` counts as "changes to deploy" —
after a merge the compare folds back to 0 even though the branch SHAs
differ) and the latest dev-branch check_run build from
`pluradash.repo_deployments`, cross-checked against the current dev head —
mirroring the server-side deploy gate (`deployGate.ts`).

States: `up-to-date` | `changes-available` | `build-running` |
`build-failed` | `no-build` | `stale-build` | `unknown` (fail-closed).

## Files Added

- `plugins/pluradash/api/sync/appDeployInfo.ts` — pure state machine + compare parsing (unit-tested)
- `plugins/pluradash/specs/app-deploy-state.md` — feature documentation
- `plugins/pluradash/specs/changes/2026-10-26-app-deploy-state-info.md` — plugin change record
- `tests/pluradashAppDeployState.test.mjs` — state-machine contract tests

## Files Changed

- `plugins/pluradash/api/index.ts` — new `GET /apps/info` route
- `plugins/pluradash/plugin.json` — `api_metadata` entry `pluradash-apps-info`
- `plugins/pluradash/src/services/githubAppService.ts` — `AppDeployState`, `WorkspaceAppInfo`, `fetchWorkspaceAppInfos()`
- `plugins/pluradash/src/pages/AppsPage.tsx` — info banner, deploy gating on `canDeploy`, polling
- `plugins/pluradash/README.md` — integration scope bullet
- `specs/features/pluradash-github-app-integration.md` — API table + apps card description

## Impact Analysis

### Database

- None. No migration; all state derived live (GitHub API + existing
  `pluradash.repo_deployments` rows).

### Runtime

- Only plugin Worker code (`plugins/pluradash/**`). The endpoint performs
  `repos.get` + branch/compare calls per assigned repo via the GitHub App
  installation token; the dashboard polls only while a dev build runs.
- Read-only; no `sync_logs` writes (polling would flood the log).

### API Surface

- New plugin endpoint: `GET /api/plugin/pluradash/apps/info` — bearer
  (Supabase JWT / OAuth 2.1), roles `user|staff|admin|support|super-admin|agent`,
  RLS-filtered to workspaces the caller can see. Documented in `/admin/api`
  via `plugin.json` `api_metadata` (`pluradash-apps-info`).
- No core API changes; existing endpoints unchanged.
