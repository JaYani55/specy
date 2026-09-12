# Plugin Claims — Custom JWT Claims via Core Claim Management

How build-time plugins contribute **custom JWT claims** without ever touching
core code. Design source: [`../plans/CLAIM_MANAGEMENT.md`](../plans/CLAIM_MANAGEMENT.md)
(validated, `CONFIRMED` in simulation experiments E-001/E-002). This document
is the implemented contract.

**Design principle: core owns the mechanism; plugins own the semantics.**
The access-token hook is written once, generic, and never changes again —
plugins contribute claim resolvers declaratively (manifest + migration +
plugin-schema function), mirroring the established `wrangler_bindings` and
plugin-migrations patterns.

---

## 1. Data flow (four layers)

```
Layer 1 — Declaration   (build time)   plugin.json → claims_declarations[]
Layer 2 — Registration  (install time) plugin migration → public.plugin_claims + plugin-schema resolver fn
Layer 3 — Merge         (mint time)    custom_access_token_hook → generic loop over the registry
Layer 4 — Dispatch      (runtime)      claims.<plugin_id> surfaces in JWT → all planes read it
```

### 1.1 Namespacing

Every plugin gets **one top-level JWT key**: its plugin id. All of a plugin's
claim values live in that object:

```json
{
  "claims": {
    "user_roles": ["user", "admin"],
    "is_agent": false,
    "tenant_id": "…",
    "pluradash": { "entitlements": { "tier": "pro" } }
  }
}
```

The plugin id is globally unique, so collisions are impossible. Reserved core
keys (`user_roles`, `is_agent`, `tenant_id`, standard JWT registered claims)
are rejected at build time.

### 1.2 Layer 1 — Declaration (build time)

`plugin.json`:

```json
"claims_declarations": [
  {
    "key": "entitlements",
    "type": "json",
    "resolver": "claims_entitlements",
    "budget_bytes": 512,
    "description": "Per-user addon entitlement flags for the tenant."
  }
]
```

The generated-registry step (`scripts/lib/plugin-workspace.mjs` →
`collectPluginClaims`, runs on every `predev`/`prebuild`):

1. Namespaces by plugin id (`claims.<plugin_id>`)
2. Enforces **single-source** (duplicate key within a plugin → build error)
3. Rejects **reserved core keys**
4. Enforces the **global claim budget** (Σ `budget_bytes` ≤
   `GLOBAL_CLAIM_BUDGET_BYTES`, currently 2048)
5. Regenerates `api/plugin-claims.ts` — the descriptive registry for review,
   agent discovery and runtime dispatch

Type definitions: `PluginClaimDeclaration`, `PluginClaimValueType` in
`src/types/plugin.ts`.

### 1.3 Layer 2 — Registration (install time, inside the plugin)

The plugin's **migration** registers the claim and creates the resolver
function — entirely inside the plugin schema (the `INSERT` into the core
registry table is DML, which plugin migrations are allowed to perform;
DDL stays schema-bound per the migration validator):

```sql
-- Resolver: pure/stable function of (uid, tenant), SECURITY INVOKER,
-- reads only plugin-schema data, returns NULL for "claim absent".
CREATE OR REPLACE FUNCTION pluradash.claims_entitlements(p_uid uuid, p_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT coalesce(jsonb_object_agg(s.key, s.value), NULL)
  FROM pluradash.tenant_entitlements s
  WHERE s.user_id = p_uid AND (p_tenant IS NULL OR s.tenant_id = p_tenant);
$$;

INSERT INTO public.plugin_claims
  (claim_key, plugin_id, value_type, resolver_schema, resolver_function, budget_bytes, description)
VALUES
  ('pluradash', 'pluradash', 'json', 'pluradash', 'claims_entitlements', 512, 'addon entitlements')
ON CONFLICT (claim_key) DO UPDATE
  SET value_type = EXCLUDED.value_type,
      resolver_schema = EXCLUDED.resolver_schema,
      resolver_function = EXCLUDED.resolver_function,
      budget_bytes = EXCLUDED.budget_bytes,
      description = EXCLUDED.description,
      updated_at = now();
```

**Resolver contract** (obligations — review + install-time signature check):

- pure/stable function of `(p_uid uuid, p_tenant uuid)`; no writes; no external calls (mint latency budget)
- returns `NULL` for "claim absent" → omitted from the token
- **fail-closed semantics**: absence must mean "not entitled", never "allow"
- `SECURITY INVOKER`; readable data confined to the plugin schema
- **the matching downmigration deletes the `plugin_claims` row** — claim registration is a revertible effect; uninstall removes the claim from all future tokens

### 1.4 Layer 3 — Merge (mint time, core, written once)

`Auth/Access_hook_plugin_claims.sql` extends `custom_access_token_hook` with
one generic block (the **final** per-feature extension of the hook):

- `FOR r IN SELECT * FROM public.plugin_claims` → `EXECUTE format('SELECT %I.%I($1, $2)', …)`
- per-resolver isolation: `EXCEPTION WHEN OTHERS → RAISE WARNING`, claim omitted, mint continues
- over-budget output (`octet_length > budget_bytes`) → omitted + warning
- `NULL` → omitted
- path-form `jsonb_set(event, ARRAY['claims', r.claim_key], …)` — safe even when `claims` is absent
- registry table missing (fresh-install edge) → plugin claims skipped, core claims unaffected
- **availability-first hardening (2026-09-09, after a live login-500 incident)**: every
  uncaught path inside the hook now degrades instead of raising — `default_tenant_for_user`
  failures → tenant claim omitted; an unreadable registry (any error, not only
  `undefined_table`) → plugin claims skipped; and the former outer
  `RAISE EXCEPTION` became **pass-through** (`RAISE WARNING` + return event without
  injected claims). Rationale: the hook is the mint-time chokepoint — raising there
  turned any hook defect (grant drift, tenant-lookup failure, cast error) into a 500
  on **every** login. Claims are metadata, never enforcement: RLS fails closed on a
  missing claim, so a degraded mint is safe (deny, not crash). Diagnose hook problems
  with `npm run auth:check` (calls the hook server-side and reports the exact Postgres
  error).

### 1.5 Layer 4 — Dispatch (runtime)

| Plane | Mechanism | Core change needed |
|---|---|---|
| Backend (Worker) | `VerifiedAuthSession.claims` carries the full payload → plugin helper `getPluginClaim(auth, 'entitlements')` | none |
| Frontend | `User.claims` (decoded JWT, `src/contexts/AuthContext.tsx`); `access.claims` predicates evaluated by `isPluginAccessible` (`src/plugins/claimMatching.ts`) | done |
| Hook filtering | plugin-level gating via `getPluginHooks(target, userRoles, tokenClaims)` | done (fail-closed: hooks of a claim-gated plugin stay hidden unless claims are passed) |
| Database (RLS) | plugin-owned policies read `(current_setting('request.jwt.claims', true))::jsonb -> 'pluradash'` | none |
| MCP / hooks (API) | `VerifiedAuthSession` already flows into hook contexts | none |
| Agent discovery | `api/plugin-claims.ts` → `getRegisteredPluginClaims()` (expose via `/api/plugins` when needed) | generated file |

`access.claims` predicates (frontend gating):

```typescript
access: {
  claims: { entitlements: { tier: 'pro' } }   // matches claims.<plugin_id>.entitlements.tier === 'pro'
}
```

Evaluation is a deep-subset match (`claimValueMatches`) — objects compare
recursively, arrays exactly, primitives by value.

---

## 2. Security properties

- **Fail-closed everywhere:** omitted/failed/over-budget claim = not entitled. RLS remains the enforcement plane; claims are *metadata for tooling decisions, not an RLS bypass*.
- **Client visibility:** claims are readable by the token holder — **no secrets in claims, ever** (review obligation).
- **Budget:** per-claim `budget_bytes` (default 512) enforced at mint time; global Σ (2048) enforced at build time. Supabase's own hook payload limit (≈4 KB, `ASSUMPTION` — verify against live Supabase) is the outer bound.
- **Privilege containment:** `plugin_claims` is platform-write-only (RLS: read for admin/super-admin, no user-facing write path — installer writes via Management API as table owner). Resolvers are `SECURITY INVOKER` in plugin schemas.
- **Revocation latency:** claims refresh at sign-in/token-refresh (~1 h access tokens); request-time RLS checks are unaffected.
- **Uninstall safety:** downmigration deletes the registry row → claim vanishes from new tokens; existing tokens keep it until expiry.

---

## 3. Frontend consumption

`User.claims` (full decoded payload, `src/types/auth.ts`) →
`isPluginAccessible(plugin, userRoles, tokenClaims)` evaluates
`access.anyRole` **and** `access.claims`. Call sites that do not pass token
claims fail closed against `access.claims`-gated plugins.

Related: [`authentication-authorization.md`](authentication-authorization.md)
(role model, RLS doctrine) · [`oauth-mcp-authentication.md`](oauth-mcp-authentication.md)
(token lifecycle for programmatic clients) · [`../plans/CLAIM_MANAGEMENT.md`](../plans/CLAIM_MANAGEMENT.md)
(design rationale and rejected alternatives).
