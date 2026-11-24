# 2026-11-17 — API Tokens (PATs), Support Log Access & API-Overview Permission Split

## Summary

1. **Self-service API tokens (PATs):** any authenticated non-super-admin account
   can create, list and revoke API tokens in `/admin/api` and via the new MCP
   tools `agent_tokens_create/list/revoke`. A PAT is a hashed alias for the own
   account: it is exchanged (transparently or via `POST /api/tokens/session`)
   for a real Supabase session, so `user_roles` / `tenant_id` claims and RLS
   behave identically to a human login. Raw tokens are shown exactly once and
   stored only as SHA-256 hashes.
2. **`/admin/api` opened to all authenticated users** (previously super-admin
   only). Verbosity/allowlist controls ("tagging" endpoints for agentLogger)
   require the `support` role or super-admin; everyone else sees the current
   setting read-only plus a paid-tier notice.
3. **Logging off by default:** fresh installs now start with `mode: 'custom'`
   and an empty allowlist (previously `mode: 'all'`). Existing deployments keep
   their stored `system_config` values.
4. **Support access to `agent_logs`:** new RLS policies let the `support` role
   select and delete **their own** log entries (`user_id = auth.uid()`).
   The logs API mirrors this at route level. Cross-tenant views
   (`/stats`, `/download`) remain super-admin-only. Tenancy for logging
   (`tenant_id` column + tenant-scoped policies) is a documented follow-up.

## Files Added

- `migrations/202610200001_agent_logs_support_rls.sql` — support RLS on `agent_logs`
- `migrations/202610200002_api_tokens.sql` — `public.api_tokens` table + RLS
- `api/lib/apiTokenCrypto.ts` — pure token primitives (format, hash, validation)
- `api/lib/apiTokens.ts` — PAT→Supabase-session exchange (generateLink/verify + isolate cache)
- `api/routes/tokens.ts` — create/list/revoke/session endpoints (mounted at `/api/tokens`)
- `src/services/apiTokensService.ts` — frontend service for the token endpoints
- `tests/apiTokenCrypto.test.mjs` — unit tests for the pure crypto/validation logic
- `specs/auth/api-tokens.md` — full PAT contract

## Files Changed

- `api/lib/auth.ts` — transparent `spc_`-prefix exchange inside `verifyAuthSession`; new `viaApiToken` marker on `VerifiedAuthSession`
- `api/routes/config.ts` — `GET /api/config/logging` open to any authenticated user; `PUT` restricted to `support`/`super-admin`
- `api/routes/logs.ts` — list + delete endpoints accept `support` (route-level `user_id` scoping mirroring RLS); `stats`/`download` unchanged (super-admin)
- `api/lib/systemConfig.ts` — logging default flipped to `mode: 'custom'`, empty allowlist (off)
- `api/middleware/agentLogger.ts` — hard skip for `/api/tokens` (raw PATs must never be logged)
- `api/index.ts` — mount `/api/tokens`; add `agent_tokens_*` to `/.well-known/mcp.json`
- `api/routes/mcp.ts` — register `agent_tokens_create/list/revoke` (authenticated, non-super-admin callers only)
- `scripts/lib/migration-order.mjs` — register both new migrations
- `src/types/auth.ts`, `src/hooks/usePermissions.tsx` — `support` role, `canManageLogging` permission
- `src/App.tsx` — `/admin/api` no longer super-admin-gated
- `src/pages/Verwaltung.tsx` — API Administration card visible to all Verwaltung users
- `src/pages/VerwaltungApi.tsx` — PAT management section (secure one-time reveal, masked list, revoke confirm); verbosity card read-only + paid-tier warning for users without `canManageLogging`
- `src/lib/apiCatalog.ts` — API-token endpoints documented in the catalog
- `specs/auth/README.md` — register `api-tokens.md`
- `specs/agents/mcp-exposition.md` — register `agent_tokens_*` tools

## Impact Analysis

- **Database:** two new idempotent migrations. `api_tokens` references
  `auth.users` and `public.tenants`; support RLS on `agent_logs` uses the
  existing `is_support()` helper. Registered in `migration-order.mjs`.
- **Runtime:** `verifyAuthSession` gains one extra code path (PAT exchange,
  cached per isolate); logging default flip changes fresh-install behavior
  (nothing logged until enabled). agentLogger now skips `/api/tokens`.
- **API surface:** new `/api/tokens*` endpoints; `GET/PUT /api/config/logging`
  permission change; `/api/schemas/logs` list/delete now accept `support`
  (scoped to own entries). MCP `tools/list` grows by three authenticated tools.
- **Security:** PATs are super-admin-exclusive by exclusion; no token chaining
  via the `viaApiToken` marker (documented residual gap: sessions minted
  outside the exchange path cannot be distinguished — mitigated by per-account
  cap of 10 active tokens, audit fields, and log exclusion).

## Open follow-ups

- Tenant scoping for `agent_logs` (`tenant_id` column + backfill + policies) so
  support can see tenant-scoped (not merely own) log entries.
- Optional transparent-exchange rate limiting per token hash.
