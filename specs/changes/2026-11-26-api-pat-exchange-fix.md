# 2026-11-26 — API-wide PAT Exchange Fix (forms, schemas, mail, media, objects, logger)

## Summary

The n8n connector's *Form → Get Answers* flow failed against a valid PAT
(`spc_…`): `GET /api/forms/:identifier/answers` answered `401`, and any
request that *did* carry an `spc_`-shaped bearer crashed the Worker with
Cloudflare error `1101` (verified live against the deployed Worker).

Root cause: several routes built their Supabase clients from the **raw parsed
bearer value** — exactly the pitfall documented in
[`../auth/api-tokens.md`](../auth/api-tokens.md) §4 ("Implementation
pitfall — do not reintroduce"). The raw `spc_…` string is not a JWT;
PostgREST rejects it with `PGRST301: Expected 3 parts in JWT; got 1`, and any
unhandled Supabase error crashes the route before the PAT exchange ever runs.

A full audit of every `createSupabaseClient` call site in `api/` found the
pitfall in **forms, schemas, mail, media (Supabase Storage branch) and the
agent logger**. All of them now resolve the Bearer value through
`verifyAuthSession` first (PAT → exchanged session JWT, per §4 "transparent
exchange"). Sites that only *check* token presence (public share lookups)
had their dead raw-token clients removed.

## Files Changed

- `api/routes/forms.ts`:
  - `GET /:identifier/answers` — exchanges the PAT **before** the form
    lookup; 401 (`Bearer authentication required.` / `Invalid or expired
    session.`) semantics unchanged.
  - `GET /:identifier` — same exchange-before-lookup; `requires_auth` check
    now tests the verified session instead of raw token presence (also fixes
    `requires_auth` forms previously answering 404 for valid PAT holders
    because the anon/RLS lookup could not see the form).
  - `POST /:identifier/answers`, `POST /:identifier/upload` — PATs resolved
    up front; `submitFormAnswers` / `handleFormUploadRequest` receive the
    exchanged session.
  - `submitFormAnswers` — signature changed from `token` to a pre-verified
    `auth: VerifiedAuthSession | null`; its internal `verifyAuthSession`
    call moved to the callers (avoids double verification, enforces the
    exchange before *every* client build).
  - `retrieveFormAnswers` — signature changed from `token` to
    `auth: VerifiedAuthSession | null` (already received the exchanged JWT
    internally; now the verified session is passed in).
  - `GET /` (forms list), `GET|POST /share/:tenantName/:shareSlug*`,
    `GET|POST /s/:tenantName/:shareSlug*`,
    `POST /:tenantName/:formSlug/answers` — same exchange-before-query
    pattern; unused raw-token clients removed from routes that never query
    with them.
- `api/routes/schemas.ts`:
  - `GET /api/schemas` (discovery), `GET /:slug/spec(.txt)` (agent-readable
    specs), `POST /:slug/revalidate` — exchange via `getOptionalAuthSession`
    (anonymous access preserved); spec-bundle and frontend-target helpers now
    receive the exchanged JWT.
  - `readSchemaSecretStatusWithUserToken` — parameter renamed to
    `sessionToken` (callers always pass `auth.token`).
- `api/routes/mail.ts` — `GET /jobs`, `getVisibleJob`, `DELETE /jobs`: the
  routes already ran `requireAppRole` (which exchanges PATs) but then rebuilt
  a client from the raw header — now they use `auth.token` throughout.
- `api/routes/media.ts` — `GET /list` (Supabase Storage branch) and the
  Supabase-Storage branches of upload/delete now use the exchanged session
  (`sessionToken = auth.token`); the aliased `createStorageClient` is covered
  by the regression test.
- `api/routes/objects.ts` — removed two unused raw-token clients from the
  `/share/…` and `/o/…` share routes (admin-based lookup, presence-check
  only).
- `api/middleware/agentLogger.ts` — the MCP log-attribution schema lookup
  built its client from the raw bearer even though the verified session was
  computed right above; now uses `session.token` (previously PAT traffic
  silently lost schema attribution).
- `tests/formPatExchange.test.mjs` → superseded by `tests/apiPatExchange.test.mjs`
  (added) — source-level regression guard: every `createSupabaseClient`/
  aliased call site in `api/routes/*.ts` and `api/middleware/agentLogger.ts`
  must receive the exchanged session (`auth.token` / `auth?.token`) or
  nothing (anonymous access). Provenance exceptions are documented inline
  (`authToken` in mcp.ts is always `authSession.token`; the `sessionToken`
  parameters in schemas.ts/mail.ts are always the exchanged JWT).
- `plugins/n8n-nodes-specy/nodes/Specy/GenericFunctions.ts` (connector repo —
  document there): the 401 status hint no longer claims the token is
  necessarily unknown/revoked/expired; a missing `Authorization` header
  (credential not selected / empty on the node) produces the same status.

## Diagnosis Notes (for future incidents)

- Cloudflare Workers Logs `requestHeaderNames` must not be read as proof that
  `Authorization` was absent — verify client-side (n8n execution data) before
  concluding the header was not sent.
- The connector maps every 401 to the "token unknown/revoked/expired" hint,
  which masked the two other 401 causes on these routes (`Bearer
  authentication required.` when no parseable Bearer value arrives).

## Known Follow-ups (none — audit complete)

The sweep covered every `createSupabaseClient` call site in `api/` (routes,
middleware, lib). Library-level token parameters were traced to their
callers: `schemaCreation.createPendingSchema`,
`schemaRegistration.completeSchemaRegistration` /
`replaceSchemaFrontendTargets` and `specRegistry.getSchemaSpecBundle` /
`bootstrapSchemaMainSpec` only ever receive exchanged JWTs (MCP
`authSession.token`, REST `auth.token`) or are admin-based. The regression
test locks the invariant for all route files going forward.

## Impact Analysis

- **Database:** none — no migration; RLS behavior unchanged (exchanged
  sessions carry identical claims to a human login by design).
- **Runtime:** one additional `verifyAuthSession` round-trip per
  bearer-carrying form request (previously the lookup ran unauthenticated
  with the raw value and crashed for PATs). PAT exchanges remain cached
  per-isolate until shortly before `exp`.
- **API surface:** status codes preserved (401/403/404 semantics unchanged);
  previously-crashing PAT requests (Worker `1101`/500) now either succeed
  (valid PAT) or answer a clean 401.
- **Test gates:** `npm test` 621/621 pass (incl. new
  `tests/apiPatExchange.test.mjs`); `npm run typecheck:api` clean for the
  touched files (remaining errors are pre-existing plugin-workspace issues);
  `npm run build` succeeds; connector vitest suite 26/26.
