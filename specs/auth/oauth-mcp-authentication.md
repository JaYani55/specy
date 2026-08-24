# OAuth 2.1 MCP Authentication

This document describes the OAuth 2.1 authentication model for programmatic MCP access to Specy, introduced on August 1, 2026. OAuth is client-managed for standards-compliant MCP clients: the client handles PKCE, browser launch, callback capture, token exchange, storage, refresh, and reconnection. The Worker does not expose manual authorization-code tools on the normal MCP surface. It supersedes the password-grant `login` MCP tool described in [`Specs_MCP_Exposition.md`](../agents/mcp-exposition.md) §6.

It covers:

- the Authorization Server / Resource Server / Consent UI split
- the JWT claim contract for agent tokens
- the discovery endpoints and challenge behavior
- the operator runbook (dashboard toggles, agent role assignment)

Related documents:

- [`Auth-docs.md`](authentication-authorization.md) — overall auth & authorization model
- [`Specs_MCP_Exposition.md`](../agents/mcp-exposition.md) — MCP registry and exposure model
- [`multi-tenancy.md`](../platform/multi-tenancy.md) — tenant/workspace model behind `tenant_id`

---

## 1. Component Responsibilities

| Component | Role | Deliverable |
|---|---|---|
| **Supabase Auth** | Authorization Server (identity & token minting) | OAuth 2.1 server + Dynamic Client Registration (RFC 7591), `custom_access_token_hook` |
| **Specy Dashboard (React)** | Consent UI | `/oauth/consent` page using `supabase.auth.oauth.*` |
| **Cloudflare Worker** | Resource Server & discovery | RFC 9728 protected-resource metadata, progressive MCP auth, `WWW-Authenticate` challenges |

The dashboard frontend (email/password sign-in) is **not** affected by this change. OAuth 2.1 is exclusively for programmatic MCP clients (Cursor, Claude Desktop, autonomous agents).

---

## 2. Supabase Authorization Server Setup

OAuth server configuration is done manually per environment in the Supabase Dashboard (automation via the Management API is a v2 candidate):

1. **Authentication → OAuth Server**: enable the OAuth 2.1 server.
2. Enable **Dynamic Client Registration** (RFC 7591) so external MCP clients can self-register without a pre-shared `client_id`. The authorization-server metadata must then include a `registration_endpoint`; without it, clients may prompt for a manually configured client ID.
3. Set the **consent/authorization path** to `https://<your-app-domain>/oauth/consent`.
4. Ensure the **Custom Access Token Hook** remains registered (`custom_access_token_hook`) — it now injects the agent claims described below.

Relevant endpoints once enabled (all under `<SUPABASE_URL>/auth/v1`):

- `/.well-known/oauth-authorization-server/auth/v1` — AS metadata (authorize/token/register/JWKS URLs; this is the Supabase cloud discovery path)
- `/authorize` — Authorization Code + PKCE entry point
- `/token` — token exchange and refresh
- `/register` — dynamic client registration

---

## 3. JWT Claim Contract

`migrations/Auth/Access_hook_oauth_claims.sql` replaces `custom_access_token_hook` via `CREATE OR REPLACE` (the original file is untouched, per the shipped-migration rule). The hook runs at token mint time for **all** Supabase-issued tokens, including OAuth access tokens.

| Claim | Type | Source | Meaning |
|---|---|---|---|
| `user_roles` | `string[]` | `user_roles ⋈ roles` | Unchanged. Consumed by `verifyAuthSession`, RLS helpers, and the frontend. |
| `is_agent` | `boolean` | `'agent' = any(user_roles)` | Marks machine/agent accounts. |
| `tenant_id` | `uuid` (string) | `public.default_tenant_for_user(user_id)` | Workspace binding — the consenting user's default tenant. Omitted when the user has no active tenant membership. |

The `agent` role is seeded idempotently by the same migration. It is **not** part of the hierarchical `AppRole` ladder (`user < admin < super-admin`); it is an exact-match JWT role like plugin-introduced roles (e.g. `support`). Assign it to dedicated agent accounts in addition to whatever content roles the agent needs — RLS continues to enforce row-level visibility; the claims are metadata for tooling decisions, not an RLS bypass.

**Deferred to v2:** sub-tenant binding (`sub_tenant_id`) and dedicated agent profile tables. Also deferred: RFC 8707 resource-indicator / `aud` enforcement — v1 accepts any valid Supabase-issued token.

---

## 4. Resource Server Behavior (Worker)

### 4.1 Discovery

- `GET /.well-known/oauth-protected-resource` — RFC 9728 Protected Resource Metadata. Returns the exact MCP resource identifier, normally `<worker-origin>/mcp`, and `authorization_servers: ["<SUPABASE_URL>/auth/v1"]`. The public origin is configurable by the super-admin in `/admin/connections`; when unset, the request's Worker origin is used.
- `GET /.well-known/mcp.json` — unchanged MCP server descriptor.

### 4.2 Progressive authentication

- **No `Authorization` header on MCP POST/initialization** → `401` with `WWW-Authenticate: Bearer resource_metadata="<public-worker-url>/.well-known/oauth-protected-resource"`. This intentionally starts the standard MCP OAuth flow instead of creating an anonymous MCP session.
- **Anonymous GET/discovery** → public discovery metadata may be read without authentication.
- **Valid Bearer token** → `verifyAuthSession` validates via `auth.getClaims()` (compatible with Supabase asymmetric signing keys), derives `isAgent`/`tenantId` from claims, and the per-request `McpServer` factory registers closed specs and gated built-ins (`new_schema`). Tool lists differ per caller — clients must re-run `tools/list` after obtaining a token.
- **Invalid/expired Bearer token** → `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`. The same challenge now accompanies every 401 emitted by `requireAuthSession`, `requireAppRole`, `requireAnyJwtRole`, and `getOptionalAuthSession` ([api/lib/auth.ts](../api/lib/auth.ts)).

### 4.3 Manual OAuth tools are not part of the normal MCP surface

The password grant was removed (OAuth 2.1 forbids ROPC). The normal MCP tool list does not expose `login`, `authorize`, or `exchange_token`. The MCP client must use the HTTP challenge and standard OAuth discovery. This prevents authorization codes and access tokens from being copied into agent chat and ensures the token is attached to the MCP transport that initiated OAuth.

### 4.4 CORS

`Mcp-Session-Id` was added to `allowHeaders`; `Mcp-Session-Id` and `WWW-Authenticate` to `exposeHeaders` so browser-based MCP clients can complete the handshake.

### 4.5 Public URL configuration

The canonical public Worker URL is stored in `system_config` as `core.public_url` and can be edited by a `super-admin` in `/admin/connections` under **Public Worker URL**.

Resolution order:

1. Persisted `core.public_url` override
2. Current Worker request origin (`*.workers.dev` by default)

This keeps the open-source core portable across custom domains and deployments. OAuth resource metadata, MCP links, and generated absolute API URLs use the resolved value.

### 4.6 Plugin hook context

`VerifiedAuthSession` gained two additive fields — `isAgent: boolean` and `tenantId: string | null` (derived from claims, with a role-list fallback for legacy tokens). Plugin `mcp.tools` hook handlers receive these fields in their existing `auth` context; no signature changes. The same fields are available to any other backend hook that consumes a verified session.

---

## 5. Consent Screen

Route: `/oauth/consent` (public route outside `Layout`, [src/App.tsx](../src/App.tsx)).

Flow:

1. The MCP client receives the Worker `401` challenge and discovers the Supabase authorization server.
2. The MCP client generates PKCE state and opens the authorization URL in the user's browser.
3. The Supabase authorization server redirects the user's browser to `/oauth/consent?authorization_id=<id>`.
4. The page requires an authenticated dashboard session. Unauthenticated visitors are sent to `/login` with a `returnTo` preserving `authorization_id`.
5. The page loads the request via `supabase.auth.oauth.getAuthorizationDetails(authorizationId)` and renders the client name/URI, redirect URI, requested scopes, and workspace binding.
6. **Approve** → `supabase.auth.oauth.approveAuthorization(authorizationId)` → browser redirect to the MCP client's callback.
7. **Deny** → `supabase.auth.oauth.denyAuthorization(authorizationId)`.
8. The MCP client captures the callback, exchanges the code, stores the token, and reconnects to `/mcp`. No code or JWT is copied into chat.

Implementation: [src/pages/OAuthConsent.tsx](../src/pages/OAuthConsent.tsx) + [src/services/oauthConsentService.ts](../src/services/oauthConsentService.ts) (thin SDK wrapper per the page→service convention). UI copy follows the German/English `useTheme()` language pattern.

---

## 6. Operator Runbook

### Provisioning an agent account

1. Create a dedicated Supabase user for the agent (Authentication → Users), with email confirmed.
2. Assign the `agent` role (plus any content roles the agent needs) in `public.user_roles` — the account administration UI supports role assignment.
3. Configure the canonical public Worker URL in `/admin/connections` if a custom domain is used. Otherwise the deployed `*.workers.dev` origin is used automatically.
4. Share the deployed app's base URL with the agent operator. The MCP client discovers everything else:
   - `/.well-known/oauth-protected-resource` → authorization server
   - AS metadata → `/register` (DCR) → `/authorize` → consent → `/token`
5. On first authorization, the consent screen shows the workspace binding. To bind the agent to a different workspace, change the agent account's tenant membership before approving.

### Token lifecycle for autonomous agents

- Access tokens expire (Supabase default: 1 hour). MCP clients must use the OAuth `refresh_token` grant to renew without user interaction — no code changes are needed in Specy for this.
- Revoking access: remove the agent's role assignments or delete the authorization in Supabase; issued tokens remain valid until expiry.

### Verification checklist (E2E)

1. Anonymous `POST /mcp` initialization → `401` + `WWW-Authenticate` header.
2. Request with garbage Bearer token → `401` + `WWW-Authenticate` header.
3. MCP client automatically runs DCR/registered-client Authorization Code + PKCE → browser opens → consent screen renders → approve. No code is pasted into chat.
4. Authenticated `tools/list` → mutation tools and closed specs are visible.
5. `create_schema` → `start_schema_registration` → `register_frontend` → `create_page` completes the autonomous content workflow.

---

## 7. Summary

- Password-grant login for MCP is gone; OAuth 2.1 Authorization Code + PKCE via Supabase is the only programmatic auth path.
- Supabase is the Authorization Server; the Worker is a metadata-advertising Resource Server; the dashboard hosts consent.
- Claims (`user_roles`, `is_agent`, `tenant_id`) are injected at mint time by the extended access-token hook; validation stays local via `auth.getClaims()`.
- Progressive anonymous access is preserved for published public MCP entries.
