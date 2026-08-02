# 2026-08-01 — OAuth 2.1 MCP Authentication

## Summary

Replaced the password-grant `login` MCP tool with OAuth 2.1 Authorization Code + PKCE, using Supabase Auth as the Authorization Server (OAuth 2.1 server + RFC 7591 Dynamic Client Registration), the Specy dashboard as the consent UI (`/oauth/consent`), and the Cloudflare Worker as the Resource Server (RFC 9728 protected-resource metadata + `WWW-Authenticate` challenges). The custom access token hook now injects `is_agent` and `tenant_id` claims into all minted tokens alongside the existing `user_roles`.

Design decisions (confirmed with stakeholder):

- Sub-tenant binding and agent profile tables deferred to v2 — v1 claims: `user_roles`, `is_agent`, `tenant_id`.
- The `login` MCP tool remains as an error shim returning OAuth flow instructions.
- Progressive anonymous tool exposure is preserved; 401 + challenge only for invalid/expired tokens.
- Scope is MCP/agents only; the dashboard keeps email/password sign-in.
- Standard MCP clients own OAuth state, PKCE, browser callbacks, token storage, refresh, and reconnect. Authorization codes and JWTs must not be copied into agent chat.
- MCP POST initialization requires a bearer token; unauthenticated requests receive an RFC 9728 `WWW-Authenticate` challenge.
- The public Worker URL is configurable through `/admin/connections` and defaults to the current Worker origin.

Full model documentation: [`../OAuth_MCP_Authentication.md`](../OAuth_MCP_Authentication.md).

## Files Added

- `migrations/Auth/Access_hook_oauth_claims.sql` — seeds the `agent` role; replaces `custom_access_token_hook` via `CREATE OR REPLACE` to inject `user_roles` (unchanged), `is_agent`, `tenant_id`; re-applies hook grants. Idempotent.
- `src/pages/OAuthConsent.tsx` — standalone consent screen (`/oauth/consent`): loads authorization details via `supabase.auth.oauth.getAuthorizationDetails`, shows client/scopes/workspace binding, approve/deny via the Auth SDK, German/English copy.
- `src/services/oauthConsentService.ts` — thin wrapper around the OAuth authorization-server SDK methods plus consent-workspace resolution (mirrors `default_tenant_for_user` ordering).
- `specs/OAuth_MCP_Authentication.md` — full specification (component split, claim contract, discovery, consent flow, operator runbook).

## Files Changed

- `scripts/lib/core-update.mjs` — registered `Auth/Access_hook_oauth_claims.sql` after `Auth/Access_hook.sql` in `MIGRATION_ORDER`.
- `scripts/setup.mjs` — same registration for fresh installs.
- `api/index.ts` — added `GET /.well-known/oauth-protected-resource` (RFC 9728); CORS now allows `Mcp-Session-Id` and exposes `Mcp-Session-Id` + `WWW-Authenticate`.
- `api/lib/auth.ts` — `VerifiedAuthSession` gained additive `isAgent`/`tenantId` fields (claim-derived, role-list fallback for legacy tokens); new `unauthorizedWithChallenge()` helper; all 401 responses from `requireAuthSession`, `requireAppRole`, `requireAnyJwtRole`, and `getOptionalAuthSession` now carry `WWW-Authenticate: Bearer resource_metadata="..."`.
- `api/routes/mcp.ts` — `login` tool no longer performs a password grant; returns a structured OAuth instruction payload. `start_here` auth model rewritten for OAuth 2.1 (discovery URLs, token refresh note, re-run `tools/list` guidance). `new_schema` unauthenticated error now references OAuth + resource metadata. GET `/mcp` discovery payload advertises the OAuth flow. Removed now-unused `getRolesFromToken` import.
- `src/App.tsx` — registered the public `/oauth/consent` route outside `Layout`.
- `src/pages/Login.tsx` — supports `location.state.returnTo` so the consent flow can return after sign-in (React Router strips unknown query params on `navigate()`).
- `src/pages/OAuthCallback.tsx` — callback route on the configured console SPA for the compatibility/manual flow; standard MCP clients should capture callbacks themselves.
- `specs/Specs_MCP_Exposition.md` — §6 rewritten: closed MCP entries now require an OAuth 2.1 bearer token; password login removal documented.
- `specs/Auth-docs.md` — decision tree extended with the OAuth/MCP path; claim contract section added.
- `specs/Supabase_Cloudflare-Setup.md` — OAuth server setup section added (dashboard toggles, consent path).
- `api/lib/systemConfig.ts`, `api/routes/config.ts`, `src/services/connectionsService.ts`, `src/pages/VerwaltungConnections.tsx` — persisted `core.public_url` setting and super-admin Public Worker URL configuration.

## Impact Analysis

### Database

- New migration `Auth/Access_hook_oauth_claims.sql` (idempotent; registered in both setup and core-update manifests). Replaces the access-token hook function body and seeds one role. No table or RLS changes.
- Tokens minted after the migration carry two new claims; tokens minted before it remain valid and are handled via the role-list fallback in `verifyAuthSession`.

### Runtime / API surface

- New public endpoint: `GET /.well-known/oauth-protected-resource`.
- New super-admin configuration endpoints: `GET/PUT /api/config/public-url`.
- All API/MCP 401 responses now include a `WWW-Authenticate` header — additive; no consumer in the dashboard depends on bare 401s.
- The `login` MCP tool's response shape changed from a session payload to an error/instruction payload. Breaking for agents that scripted password login — intentional; the shim contains migration instructions.
- CORS exposes two additional headers.

### Auth model

- OAuth access tokens are validated identically to dashboard tokens (`auth.getClaims()`), so closed MCP entries, RLS-scoped queries, and plugin `mcp.tools` hooks work unchanged for OAuth callers.
- Anonymous MCP POST sessions are no longer created. The Worker challenges first, allowing VS Code and other MCP clients to manage OAuth natively and reconnect with the bearer token.
- Authenticated-only MCP tools now include `create_schema`, `start_schema_registration`, `register_frontend`, and `create_page`.
- The new `agent` role is exact-match only (not hierarchical) and does not widen any RLS policy by itself.

### Not done here

- Supabase Dashboard OAuth server + DCR enablement is a manual operator step (documented); Management API automation is a v2 candidate.
- RFC 8707 audience enforcement and sub-tenant binding deferred to v2.
