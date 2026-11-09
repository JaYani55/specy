# 2026-10-27 — Plan: Merge Conflict Handling for Concurrent PluraPi App Sessions

## Summary

Added the forward-looking plan
[`../plans/apps-merge-conflict-handling.md`](../plans/apps-merge-conflict-handling.md)
for multi-user PluraPi usage: several people can join one workspace session and
push to the `dev` branch of the same app.

The plan separates the three conflict classes present in the current sync
engine and fixes them in layers instead of introducing a lock:

- **C1 — staging collision** (R2 staging is keyed per user, not per session;
  manifest read-modify-write has no CAS and a clobbered manifest turns into a
  mass-deletion push via `engine.ts` `baseTree` vs `manifest.files` diff) →
  session-scoped staging keys + manifest ETag/CAS (P0/P3).
- **C2 — concurrent push race** (`push` requires `liveHead === baseCommitSha`,
  so any divergence is a `409` whose only documented recovery is a destructive
  pull; `updateRef` `422` surfaces as `500`) → retried three-way merge against
  the live head, `updateRef(force:false)` as the CAS primitive, structured
  `409 CONFLICT` (P1/P2).
- **C3 — true same-path divergence** → auto-merge everything non-overlapping
  (the existing `createTree(base_tree=headTree)` already preserves remote
  changes to untouched paths), fail closed only on `edit-edit` /
  `edit-delete` / `delete-edit`, with per-path `resolutions` and a
  non-destructive `pull?rebase` (P1/P2).

Also planned (P4/P5): save-time stale detection via a cached head tree, and
deploy-side divergence modelling (`diverged`, `mergeState`,
`conflictingPaths`, `deployState: 'merge-conflict'`, `409 MERGE_CONFLICT`,
optional PR fallback) because `repos.merge` is a real merge whenever the
production branch has human commits.

**Status: proposed — not implemented.** No production code was changed.

## Files Added

- `specs/plans/apps-merge-conflict-handling.md` — full plan: verified current
  behavior with file/line references, conflict taxonomy and handling matrix,
  target design (session staging, merge planner, conflict contract,
  non-destructive rebase, head-tree cache, deploy divergence, attribution),
  API/compat table, data-model notes, rollout phases P0–P6 with exit criteria,
  test plan, risks, documentation follow-ups, open questions
- `specs/changes/2026-10-27-apps-merge-conflict-handling-plan.md` — this record

## Files Changed

- `specs/plans/README.md` — registered the new plan in the index table

## Impact Analysis

- **Database:** none. The plan proposes at most one optional plugin migration
  (`pluradash` schema, with a `down/` counterpart) for workspace-session TTL
  bookkeeping — not applied.
- **Runtime:** none — documentation only. No Worker code, bindings or generated
  files touched.
- **API surface:** none today. The plan defines additive future changes to
  `/sync/push`, `/sync/pull`, `/sync/save`, new `/sync/status` and
  `/sync/changes`, `GET /apps/info` fields, deploy `409` shapes and MCP tool
  descriptions, plus one breaking key-layout change that degrades to a one-time
  re-pull.
- **Consumers to notify on implementation:** PluraPi (file-sync + agent
  workflows) and dashboard/agent clients reading `deployState`.
