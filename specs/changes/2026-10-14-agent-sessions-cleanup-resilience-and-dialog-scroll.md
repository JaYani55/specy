# 2026-10-14 — Agent-Sessions: cleanup resilience + detail-dialog scroll/reactivity

## Summary

Two fixes in the PluraPi Agent-Sessions bridge area:

1. **Agent-Sessions disappeared after a sync-log cleanup.** The
   `Log-Bereinigung` operation (`logs.cleanup`, `DELETE /admin/github/logs` with
   `before: "all"`) wipes `pluradash.sync_logs` — but the agent-sessions
   overview discovers its `(tenant, user)` pairs *exclusively* from
   `sync_logs` (agent operation set, 30-day lookback). After the cleanup the
   pair list was empty and the tab showed no sessions, although the
   PluraPi-Sessions DO data was intact. Pair discovery now falls back to
   `pluradash.build_targets` (not touched by the log cleanup) whenever
   `sync_logs` yield fewer pairs than the 30-pair cap.
2. **Session detail dialog was not reliably scrollable.** The dialog fought the
   shadcn `DialogContent` base (`grid gap-4 p-6`). It is now a flex column:
   sticky header, `min-h-0 flex-1 overflow-y-auto overscroll-contain` body
   (single scroll region). Reactivity: the chatlog tail polling moved from a
   manual `setInterval`/`useState` loop to react-query (`refetchInterval`),
   the chat auto-scrolls to the newest message on poll updates (unless the
   user scrolled away), and the spinner shown in the *Build-Verlauf* header
   (wrongly bound to `messagesLoading`) now tracks `buildsLoading`.

Note: no data was lost — the sessions live in the PluraPi-Sessions DO; only
the local discovery index (`sync_logs`) was cleared. Sessions reappear with
the agent's next sync operation even without this fix.

## Files Added

- `specs/changes/2026-10-14-agent-sessions-cleanup-resilience-and-dialog-scroll.md` (this file)

## Files Changed

- `plugins/pluradash/api/index.ts` — `GET /admin/github/agent-sessions`: after
  building pairs from `sync_logs`, if fewer than `AGENT_SESSION_MAX_PAIRS` (30),
  query `pluradash.build_targets` (`session_tenant_id, workspace_id, user_id`,
  newest first, limit 500) and merge unseen pairs (dedupe key
  `"<tenantId>:<userId>"`; DO tenant resolution per the push contract:
  `session_tenant_id` → `workspace_id` fallback; `personal` excluded).
- `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx` — dialog layout
  restructure (flex column, scrollable body, `chatScrollRef` auto-scroll),
  chatlog polling via react-query with `select` tail (`MESSAGE_TAIL`), spinner
  fix in *Build-Verlauf* header.
- `specs/agents/plurapi-agent-bridge.md` — pair-discovery section: documented
  the sync_logs prunability and the `build_targets` fallback.

## Impact analysis

- **Database:** none. `build_targets` already exists (plugin migrations 028–030)
  and is only read. No migration added.
- **Runtime:** one extra service-role query per agent-sessions poll (~10 s) *only*
  when `sync_logs` produce fewer than 30 pairs (i.e. right after a cleanup or
  during low activity). Bounded by `limit(500)` on `build_targets`.
- **API surface:** response shape unchanged. Behavior change: pair list is now
  the union of sync-activity pairs and recent build-target identities, so the
  overview survives a full sync-log cleanup.
- **Docs:** bridge doc pair-discovery note added (canonical entry point
  `specs/agents/plurapi-agent-bridge.md`).

## Verification

- `npm run typecheck` — clean.
- `npm run typecheck:api` — no new errors in the touched plugin API region
  (pre-existing plugin-workspace errors elsewhere are out of scope).
- `npm test` — 489/489 pass.
- `npm run build` — succeeds end to end.
