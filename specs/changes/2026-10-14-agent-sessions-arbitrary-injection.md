# 2026-10-14 — Agent-Sessions: arbitrary injection (manual prompt) + docs

## Summary

Adds an **arbitrary prompt injection** to the PluraPi Agent-Sessions bridge:

1. **New plugin route** `POST /api/plugin/pluradash/admin/github/agent-sessions/inject`
   (super-admin): pushes a manually typed prompt into an agent session via
   `POST $BASE/v1/builds`. Because the PluraPi-Sessions DO currently only
   knows the `build_feedback` injection type, the prompt rides that channel:
   shaped as a synthetic failed build (`state: 'failed'`, `branch: 'manual'`)
   with the full prompt verbatim as `detail` (which the DO passes into the
   agent prompt) and the prompt's first line (≤ 120 chars) as UI-safe
   `summary`. `sessionId` pins the target session; without it the DO attaches
   the injection to the user's most recent non-ended session. The operation is
   sync-logged as `arbitrary.inject`.
2. **Dashboard UI**: the session detail dialog (Agent-Sessions tab) gets a
   "Manuelle Injektion" card — textarea + send button, sonner toasts on
   success/failure, invalidates the live chatlog query after delivery.
3. **Docs**: `specs/agents/plurapi-agent-bridge.md` gains §2.4 (endpoint
   contract, payload mapping, caveats: at-most-once, engine poller required,
   build_feedback channel), and §4.3's verification flow now uses the inject
   endpoint instead of a hand-crafted curl to `POST /v1/builds`.

Motivation: triage of the 2026-10-14 incident ("injection enqueued but agent
never reacts") required a way to reproduce the enqueue→drain→turn chain
without pushing a real build and waiting for Cloudflare.

## Files Added

- `specs/changes/2026-10-14-agent-sessions-arbitrary-injection.md` (this file)

## Files Changed

- `plugins/pluradash/api/sync/plurapiSessionsLogic.ts` — pure
  `buildArbitraryInjectionPayload()` + `ARBITRARY_INJECTION_MAX_PROMPT`
  (8000), unit-locked.
- `plugins/pluradash/api/sync/logger.ts` — `SyncOperation` union: new
  `'arbitrary.inject'`.
- `plugins/pluradash/api/index.ts` — the inject route (validation, config
  resolution, push via `pushBuildResultToPlurapi`, sync-log, error mapping).
- `plugins/pluradash/src/services/githubAppService.ts` —
  `injectAgentSessionPrompt()`.
- `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx` — "Manuelle
  Injektion" card in `SessionDetailDialog` (react-query mutation, toasts,
  chatlog invalidation).
- `tests/plurapiSessionsBridge.test.mjs` — 4 tests for the payload builder
  (channel shape, first-line summary, truncation, whitespace fallback).
- `specs/agents/plurapi-agent-bridge.md` — §2.4, §4.3, implementation map.

## Impact analysis

- **Database:** none (no migration). `sync_logs.operation` is a TEXT column —
  the new operation string needs no schema change; the CHECK constraint only
  guards `status`.
- **Runtime:** one outbound `POST $BASE/v1/builds` per manual injection;
  at-most-once delivery semantics inherited from the DO. No polling overhead.
- **API surface:** one new super-admin plugin route. Response shape:
  `{ delivered, injectionCreated }` or `{ error }` (400/500/502/503).
- **Docs:** bridge doc §2.4 is the contract reference; UI stays free of
  technical meta documentation (description text kept user-facing).

## Verification

- `npm test` — 489 + 4 new payload-builder tests pass.
- `npm run typecheck` / `npm run build` — clean.
- Manual: Agent-Sessions tab → session → "Manuelle Injektion" → send →
  engine `[injectionPoller]` line within ≤ 15 s → `[injection · build_feedback]`
  in the chatlog tail.
