# OAuth Unified Authentication — Integrating Another Microservice

> **Audience:** AI agents and developers implementing OAuth-based authentication in a
> **different microservice** that must share identity with Specy (single sign-on across
> services, calling Specy APIs on behalf of users, or accepting Specy-issued identities).
>
> **Related:** [`../auth/oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md)
> (deep-dive: MCP-specific behavior, consent UI, operator runbook) ·
> [`../auth/authentication-authorization.md`](../auth/authentication-authorization.md)
> (roles & authorization model) · [`r2-file-storage.md`](r2-file-storage.md) §2 (using
> tokens against the storage API).

---

## 1. Architecture Overview

Specy uses **Supabase Auth as the central OAuth 2.1 Authorization Server**. There is
exactly one identity provider and one token format for every service in the ecosystem:

```
                    ┌─────────────────────────────┐
                    │   Supabase Auth             │
                    │   Authorization Server      │
                    │   /authorize  /token        │
                    │   /register   /.well-known  │
                    └──────────┬──────────────────┘
                               │ issues JWT access tokens
              ┌────────────────┼───────────────────┐
              ▼                ▼                   ▼
     ┌────────────────┐ ┌─────────────┐ ┌──────────────────────┐
     │ Specy Worker    │ │ Your        │ │ Any other microservice│
     │ Resource Server │ │ microservice│ │ validating the same   │
     │ (/mcp, /api/*)  │ │ (client and │ │ JWKS-signed tokens    │
     │                 │ │  or RS)     │ │                       │
     └────────────────┘ └─────────────┘ └───────────────────────┘
```

Key consequences for your implementation:

1. **One login, many services.** A user (or agent account) authenticates once with
   Supabase; every participating service accepts the same signed JWT.
2. **No shared secrets between services.** Tokens are asymmetrically signed and
   validated locally against the authorization server's JWKS. Services never need each
   other's credentials.
3. **Authorization is claim-based.** Roles and tenant binding travel *inside* the token,
   so downstream services can make authorization decisions without extra lookups.
4. **OAuth 2.1 only.** Authorization Code + PKCE with `refresh_token` renewal.
   The password grant (ROPC) is disabled — do not build on it.

### Pick your role(s)

| Your microservice needs to… | Role | Read |
|---|---|---|
| Call Specy APIs (`/api/media`, `/api/schemas`, `/mcp`) as a user or agent | **OAuth client** | §3 |
| Accept/log-in users with the same identity inside its own API | **Resource server** (token validation) | §4 |
| Both | Both roles — they compose cleanly | §3 + §4 |

---

## 2. Discovery Chain (memorize this)

Everything is discoverable from a single base URL — your deployment's public Worker URL
(configurable by super-admins in `/admin/connections`; falls back to the request origin):

```
1. GET <worker>/​.well-known/oauth-protected-resource      (RFC 9728)
     → { resource, authorization_servers: ["<SUPABASE_URL>/auth/v1"],
         authorization_server_metadata, bearer_methods_supported: ["header"] }

2. GET <SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1
     → { authorization_endpoint, token_endpoint, registration_endpoint, jwks_uri, … }
```

Hardcode nothing except the Worker base URL. Endpoints move when operators switch
environments or custom domains; discovery keeps clients working unchanged.

---

## 3. Implementing an OAuth Client

Use this path when your service acts **on behalf of a user or agent account** to call
Specy (or any service that accepts these tokens).

### 3.1 Obtain client credentials

Two options:

- **Dynamic Client Registration (RFC 7591)** — `POST <registration_endpoint>` from AS
  metadata. No pre-shared secret needed; this is what MCP clients use automatically.
- **Manual registration** — the operator registers your redirect URI in the Supabase
  dashboard and hands you a `client_id`.

### 3.2 The flow (Authorization Code + PKCE)

```
your service                     browser                      supabase
     │  generate code_verifier +     │                             │
     │  S256 code_challenge          │                             │
     ├─ open authorization_endpoint ─┼─► user signs in ────────────┤
     │                               │    consent screen           │
     │ ◄── redirect with ?code=… ────┼──────────────────────────────┤
     ├─ POST token_endpoint          │                             │
     │    grant_type=authorization_code                           │
     │    code_verifier=…                                          │
     │ ◄─ { access_token (JWT), refresh_token, expires_in } ───────┤
```

Implementation requirements (OAuth 2.1 mandates all of these):

1. **PKCE with S256** is mandatory, even for confidential clients.
2. Use `state` and validate it on callback (CSRF protection).
3. Validate the redirect URI exactly matches the registered one.
4. Store tokens server-side (encrypted at rest); never expose them to browsers beyond
   the initial redirect, never log them, never copy them into chat transcripts.
5. Renew silently with the `refresh_token` grant before `exp`. Access tokens expire
   after ~1 hour (Supabase default).

### 3.3 Calling Specy APIs with the token

Attach the token to every request:

```
Authorization: Bearer <access_token>
```

The token grants exactly the rights of the underlying account:

- `user_roles` → hierarchical content roles (`user < admin < super-admin`) plus
  exact-match roles such as `agent`.
- `tenant_id` → workspace binding used by Specy's RLS policies. All data reads/writes
  are tenant-scoped automatically — your service does not need to pass tenant IDs.
- `is_agent: true` → marks machine accounts; some endpoints treat agents specially
  (e.g., MCP tool gating).

Anonymous requests still work for genuinely public surfaces (published public specs,
public metadata). A `401` response always carries
`WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` —
treat that as the signal to (re)start discovery/authorization rather than retrying blindly.

---

## 4. Implementing Token Validation (Resource Server)

This is the heart of **unified authentication**: your microservice accepts the same JWTs
Specy accepts, so users get single sign-on across both services.

### 4.1 Validation algorithm

Implement exactly these steps — no shortcuts, no signature-parsing libraries of dubious
origin:

1. Extract `Authorization: Bearer <token>` (header method only; cookies are not part of
   the contract).
2. Fetch the AS metadata once and cache it:
   `<SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1` → note `jwks_uri`.
3. Verify the JWT **signature** against the JWKS keys (RS256/ES256 as advertised),
   the **`exp`** claim, and the **`iss`** claim equals the Supabase Auth URL.
4. Reject expired, malformed, or wrongly-signed tokens with
   `401` + `WWW-Authenticate: Bearer resource_metadata="<worker>/.well-known/oauth-protected-resource"`
   (mirroring Specy keeps standards-compliant clients working).
5. Trust the claims below only *after* signature verification succeeded.

Reference implementation: `verifyAuthSession()` in [api/lib/auth.ts](../../api/lib/auth.ts)
uses `supabase.auth.getClaims(token)`, which performs local asymmetric verification.

> **Known v1 limitation:** resource-indicator/`aud` enforcement is deferred (see
> [`../auth/oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md) §3). v1
> accepts any valid Supabase-issued token. If your service requires audience scoping,
> enforce it locally and coordinate with operators before relying on it.

### 4.2 The unified claim contract

Injected at mint time by the custom access token hook
(`migrations/Auth/Access_hook_oauth_claims.sql`) into **every** Supabase-issued token —
dashboard sessions, agent tokens, and your microservice's tokens alike:

| Claim | Type | Meaning |
|---|---|---|
| `sub` | string | User ID (UUID) — stable primary identity across all services |
| `email` | string | Account email (when present) |
| `user_roles` | string[] | Role names: hierarchical ladder `user`, `admin`, `super-admin` plus exact-match roles (`agent`, plugin roles) |
| `is_agent` | boolean | `true` for machine/agent accounts (exact-match `agent` role) |
| `tenant_id` | uuid \| absent | Default tenant/workspace binding; absent if the user has no active membership |

Interpretation guidance:

- Treat `sub` as the join key to your own user tables — **do not create parallel
  identity systems**; map external records onto `sub`.
- Role checks: implement the hierarchy locally if you need it
  (`super-admin ⊃ admin ⊃ user`; exact-match roles like `agent` are *not* part of the
  ladder).
- `tenant_id` absence means "no workspace" — decide explicitly whether such callers get
  personal-scope or no access in your service.
- These claims are metadata, not an authorization bypass. If your service has its own
  database, mirror Specy's approach: derive coarse decisions from claims, enforce
  row-level access in your datastore.

### 4.3 What NOT to build

- ❌ Password grant / storing user passwords — ROPC is forbidden in OAuth 2.1 and
  disabled server-side.
- ❌ Accepting tokens via query parameters or cookies.
- ❌ Local user databases duplicating Supabase identities.
- ❌ Sharing database service keys between microservices as an "auth" mechanism —
  use the token, keep services decoupled.

---

## 5. Provisioning Accounts for Your Service

For machine-to-machine integrations (your microservice acting autonomously):

1. Operator creates a dedicated Supabase user for the integration (email confirmed).
2. Operator assigns the `agent` role plus whatever content roles are needed
   (`public.user_roles`).
3. Tenant membership of that account determines the workspace the integration can see;
   adjust it before first consent/approval.
4. Run the client flow of §3 once interactively; persist the `refresh_token` encrypted;
   renew silently forever after.

Revocation = remove role assignments or delete the authorization in Supabase; outstanding
access tokens die naturally at `exp` (≤ 1 hour).

---

## 6. Implementation Checklist

- [ ] Discover AS metadata from `/.well-known/oauth-protected-resource` → AS metadata (no hardcoded endpoints)
- [ ] DCR or manual client registration completed; redirect URI registered
- [ ] PKCE S256 + `state` implemented and validated
- [ ] Tokens stored encrypted server-side; refresh handled transparently
- [ ] JWT signature/exp/iss verified against JWKS on every request (cached keys, refreshed on unknown `kid`)
- [ ] `401` responses carry the RFC 9728 `WWW-Authenticate` challenge
- [ ] Authorization derived from `sub`, `user_roles`, `is_agent`, `tenant_id`
- [ ] No password storage, no token logging, no token-in-chat
