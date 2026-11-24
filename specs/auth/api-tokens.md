# API Tokens (PATs) — Self-Service Machine Credentials

> **Status:** Implemented (core) · **Contract owner:** `api/routes/tokens.ts`,
> `api/lib/apiTokens.ts`, `api/lib/apiTokenCrypto.ts`
> **Related:** [`authentication-authorization.md`](authentication-authorization.md) ·
> [`oauth-mcp-authentication.md`](oauth-mcp-authentication.md) ·
> [`../agents/oauth-unified-authentication.md`](../agents/oauth-unified-authentication.md)

## 1. Purpose

API tokens (PATs) let any authenticated account create **revocable machine
credentials** for integrations such as n8n, CI pipelines, or cron jobs — without
sharing passwords, without browser-based OAuth inside the integration runtime,
and without operator intervention.

The OAuth 2.1 flow (Supabase Auth as authorization server) remains the
**bootstrap step**: a user or agent authenticates once interactively, then
self-provisions PATs via the dashboard (`/admin/api`) or the MCP tools
(`agent_tokens_create/list/revoke`).

## 2. Core invariant: a PAT never carries authority

A PAT is an **alias for an existing account**, never a new authority:

- The exchange mints a **genuine Supabase session** for the linked `user_id`
  (admin `generateLink` magic-link → server-side GoTrue `/verify`).
- Because the session is real, the custom access-token hook injects
  `user_roles` / `tenant_id` / `is_agent`, and **RLS behaves identically to a
  human login**. A PAT can never exceed the rights of the account that created it.
- Tokens are stored **only as SHA-256 hashes**; the raw value is returned
  exactly once at creation.

## 3. Token format

```
spc_<43-char base64url>     (32 random bytes)
```

- Display prefix for lists/UI: `spc_` + first 8 body chars (e.g. `spc_9f2Kab12`).
- Constant-time comparison is not required (hash lookup by unique index), but
  tokens are hashed with SHA-256 before storage/lookup.

## 4. Authentication flow

Two equivalent consumption paths:

1. **Transparent exchange (recommended):** send
   `Authorization: Bearer spc_…` to *any* Bearer-authenticated route.
   `verifyAuthSession` detects the `spc_` prefix, exchanges the token
   server-side (minted sessions are cached per isolate until shortly before
   `exp`), and the request proceeds as a normal session. The derived session is
   marked `viaApiToken`.
2. **Explicit exchange:** `POST /api/tokens/session` with the PAT as Bearer →
   `{ token_type: "Bearer", access_token, expires_at }`. Useful for REST clients
   that want a token up front.

**The refresh token never leaves the Worker.** Callers receive only the
short-lived access token (~1 h) and re-exchange per run — one cached lookup on
the happy path.

## 5. REST contract

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/tokens` | any authenticated session | Create PAT. Body: `name` (1–100 chars, required), `expires_at` (ISO 8601, optional — absent means never expires). Returns raw token **once**. 403 for super-admin accounts and for PAT-authenticated sessions (no token chaining). 400 when the per-account cap of **10 active tokens** is reached. |
| `GET /api/tokens` | any authenticated session | List own tokens — metadata only (`name`, `prefix`, `expires_at`, `last_used_at`, `revoked_at`, `created_at`). Raw values are never retrievable. |
| `DELETE /api/tokens/:id` | any authenticated session | Soft-revoke own token (`revoked_at` set; row retained for audit). Immediate effect: subsequent exchanges fail. |
| `POST /api/tokens/session` | PAT bearer | Explicit exchange (see §4). 401 for unknown/revoked/expired tokens. |

## 6. MCP tools

| Tool | Scope | Behavior |
|---|---|---|
| `agent_tokens_create` | authenticated, non-super-admin | Same rules as `POST /api/tokens`. Returns raw token exactly once with a store-it-now warning. |
| `agent_tokens_list` | authenticated, non-super-admin | Metadata list (mirrors `GET /api/tokens`). |
| `agent_tokens_revoke` | authenticated, non-super-admin | Soft-revoke by `id`. |

These tools are only registered for authenticated MCP connections and are
absent from `tools/list` for anonymous sessions (caller-dependent tool list,
see [`../agents/mcp-exposition.md`](../agents/mcp-exposition.md)).

## 7. Storage & RLS

Table `public.api_tokens` (migration `202610200002`):

```
id uuid PK · user_id → auth.users (cascade) · tenant_id → tenants (set null)
name text · token_hash text UNIQUE · prefix text
expires_at timestamptz NULL · last_used_at timestamptz NULL
revoked_at timestamptz NULL · created_at timestamptz
```

RLS: owners (`user_id = auth.uid()`) may select/insert/update/delete; super-admins
may select/delete any row (revocation support). Tenant attribution is recorded
at creation time (`tenant_id` of the creator's active membership) for future
tenant-scoped administration; tenancy for log attribution and token management
UI is a documented follow-up.

## 8. Guardrails & known limitations

- **Super-admin exclusion:** super-admin accounts cannot create or hold PATs
  (route-level check; RLS does not prevent inserts, so this is enforced in
  `POST /api/tokens` and the MCP tool).
- **No token chaining (best effort):** sessions derived via transparent
  exchange are marked `viaApiToken` and rejected at create endpoints. Known
  gap: if a client obtains a Supabase `refresh_token` through some other
  channel, Specy cannot distinguish that session from a dashboard login — the
  mitigation is the active-token cap, default-free expiry policy, and audit
  trail (`last_used_at`, agentLogger).
- **Never logged:** `/api/tokens` is hard-skipped by the agentLogger middleware
  (raw tokens must never appear in log bodies).
- **Expiry is optional by design** — operators prefer long-lived machine
  credentials; revocation + caps are the primary controls.

## 9. n8n / automation recipe

```
1. One-time: authenticate via OAuth (browser) or use the dashboard
   (/admin/api → API-Token-Verwaltung → Token erstellen).
2. Store the raw spc_ token in an n8n credential (header auth).
3. Per workflow run: send `Authorization: Bearer spc_…` directly to any
   endpoint (transparent exchange) — no refresh logic required.
```
