# 2026-10-27 — PluraDash /apps: Preview/Build Link for Every Branch

## Summary

`GET /api/plugin/pluradash/apps` collapsed the per-branch build feedback to a
single row per repository: `listRepoDeployments` returned a flat
`Map<number, RepoDeploymentRow>` keyed only by `github_repo_id`, so the `Map`
constructor kept just the **last** row per repo. The apps overview therefore
showed only one branch's build link (in practice the production branch),
dropping the dev preview link and any other tracked branch.

The fix restores the intended per-branch contract (established by migration
`026_repo_deployments_per_branch.sql` / change record
`2026-10-12-pluradash-per-branch-build-status.md`): **every tracked branch
carries its own most recent preview/build link.**

## Files Changed (plugin scope — `plugins/pluradash/`)

- `api/sync/webhookLogic.ts` — new pure helper `groupRepoDeploymentRows<T>`
  (groups all rows under their repo id, generic over the row shape)
- `api/sync/webhookService.ts` — `listRepoDeployments` now returns
  `Map<number, RepoDeploymentRow[]>` (all per-branch rows) via the grouping
  helper
- `api/index.ts` — `GET /apps` and `GET /apps/info` consume the grouped map
  directly (redundant re-grouping loop removed); the `/apps/info` dev-build
  lookup now reliably finds the `dev` row
- `plugins/pluradash/specs/changes/2026-10-27-apps-all-branch-deployment-links.md`
  — plugin change record

## Files Changed (core repo)

- `tests/checkRunWebhook.test.mjs` — regression tests for
  `groupRepoDeploymentRows` (multi-branch grouping, never-collapse regression,
  empty input)

## Impact Analysis

### Database

- None. All rows already existed in `pluradash.repo_deployments` (one per
  repo + branch since the 2026-10-12 change) — only the reading layer
  collapsed them.

### Runtime

- Plugin Worker code only. `GET /apps` now returns the full `deployments[]`
  per repo (dev, main/master, feature branches) — the dashboard
  `BuildStatusTile` grid already renders one tile per deployment with
  `previewUrl ?? buildUrl`, so every branch shows its recent preview link
  (capped at 3 tiles per card, running first).
- `GET /apps/info` deploy-state derivation becomes deterministic: the dev-row
  lookup can no longer miss when the prod row was returned last.

### API Surface

- Extended (bugfix): `GET /apps` `deployments[]` now contains one entry per
  tracked branch instead of one arbitrary entry per repo. No breaking change —
  consumers already handle arrays.
