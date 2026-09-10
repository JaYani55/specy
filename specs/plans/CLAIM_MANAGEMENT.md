# Core Claim Management System — Custom Claims for Build-Time Plugins

Design for handling **custom JWT claims declared inside build-time plugins** and dispatched to runtime plugin code through a core claim-management mechanism. Status: design validated in simulation (`CONFIRMED`, E-001/E-002); **implemented 2026-09-09** (core migration + build-time registry + runtime dispatch — see `specs/auth/plugin-claims.md` for the implemented contract and `specs/changes/2026-09-09-plugin-claim-management.md`). Implementation deviations from this plan: `jsonb_set` path-form instead of object-merge (NULL-safety bug in the plan's snippet), explicit `octet_length` budget check at mint time, `updated_at` set by installer upserts (no trigger — no core pattern for one), resolver signature check via review only (install-time `information_schema` check deferred). Open items §6 remain open.

**Problem (user statement, 2026-09-09)**: Some build-time plugins require a custom claim to clearly delineate their auth logic. These claims must be handled *within plugin boundaries* — never by editing core. Main question: how to handle claims as part of a core claim management system, with claims declared inside a build-time plugin and dispatched to runtime plugins via the build-time plugin.

**Grounding (verified)**:
- All Supabase tokens pass through the single core hook `public.custom_access_token_hook(event jsonb)` (`SECURITY DEFINER`, PL/pgSQL) — extended twice by core migrations (`Access_hook.sql` → `Access_hook_oauth_claims.sql` adding `is_agent`, `tenant_id`). `→ SPECY-REPO/specy/migrations/Auth/`
- Plugin-introduced **roles** already flow data-driven (plugin migration inserts into `public.roles`; the hook reads `user_roles` generically). Non-role claims have **no plugin path** — adding one today means editing the core function, violating the boundary rules (`→ RAW/specy-docs/plugins/development.md §12–13`) and the EUPL separate-work doctrine.
- Runtime dispatch already exists generically: `VerifiedAuthSession.claims: JwtPayload` on the Worker (`→ SPECY-REPO/specy/api/lib/auth.ts:15–89`), decoded JWT on the frontend, `access.anyRole` gating on `user_roles` only (`→ SPECY-REPO/specy/src/plugins/loader.ts (isPluginAccessible)`).

---

## 1. Design principle

**Core owns the mechanism; plugins own the semantics.** The hook is written once, generic, and *never changes again*; plugins contribute claim resolvers declaratively. This is the same established Specy pattern as `wrangler_bindings` (declared in manifest, merged at build, conflict-detected), `migrations` (plugin-schema ownership), and the hook-and-provider EUPL doctrine.

Paradigm reading (`→ COMPOSABILITY-PARADIGM.md`): a claim is **context-carried coeffect metadata** (Def. 30 — merged at access, right-biased, no reload needed); the declaration is a **capability request known at load time** (§6.3); single-source enforcement is Def. 43; resolver-failure isolation is per-fiber failure (§4.3.4). Namespacing implements the paper's first remedy against **key collision** (§6.6).

## 2. The four layers

### Layer 1 — Declaration (build time, inside the plugin)

`plugin.json` gains `claims_declarations[]`:

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

The generated-registry step (`register-plugins.mjs` / `ensure-registry.mjs` analog) then:
1. **Namespaces** by plugin id → claim object `claims.pluradash = { … }` (one top-level JWT key per plugin; the plugin id is already globally unique). Flat alternatives (`pluradash/entitlements`) possible; the object form minimizes top-level keys and matches TypeScript module-augmentation style.
2. Enforces **single-source**: duplicate key within a plugin, or two build sources claiming one plugin id → build error (verified E-001 S2).
3. Rejects **reserved core keys** (`user_roles`, `is_agent`, `tenant_id`) (E-001 S2).
4. Enforces the **global claim budget**: Σ `budget_bytes` ≤ global limit (E-001 S4; see §4).
5. Regenerates `api/plugin-claims.ts` — the descriptive registry (plugin → claim keys, types, descriptions) used for review, agent discovery, and runtime dispatch.

### Layer 2 — Registration (install time, inside the plugin)

The plugin's migration upserts into a **core-owned registry table**; the resolver function lives **entirely in the plugin schema**:

```sql
-- plugin migration (pluradash schema owns the function; core owns the table)
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
ON CONFLICT (claim_key) DO UPDATE SET …;
```

Registry table (core-owned, platform-only writes — same policy class as the plugin registry):

```sql
CREATE TABLE IF NOT EXISTS public.plugin_claims (
  claim_key         text PRIMARY KEY,   -- top-level JWT key, i.e. the plugin id
  plugin_id         text NOT NULL,
  value_type        text NOT NULL CHECK (value_type IN ('bool','string','uuid','string[]','json')),
  resolver_schema   text NOT NULL,
  resolver_function text NOT NULL,
  budget_bytes      int  NOT NULL DEFAULT 512,
  description       text
);
```

Resolver contract (documented obligations, enforced by review + install-time signature check via `information_schema`):
- pure/stable function of `(uid, tenant_id)`; no writes; no external calls (mint latency budget);
- returns `NULL` for "claim absent" (omitted from the token);
- **fail-closed semantics**: absence must mean "not entitled", never "allow";
- `SECURITY INVOKER`; readable data confined to the plugin schema (hook's definer rights must not be needed);
- **the matching downmigration deletes the `plugin_claims` row** — claim registration is a revertible effect; uninstall removes the claim from all future tokens (verified E-002 S1).

### Layer 3 — Merge (mint time, in core, written once)

The core hook gains one generic block (final extension of the function; no per-plugin edits ever again):

```sql
FOR r IN SELECT * FROM public.plugin_claims LOOP
  BEGIN
    EXECUTE format('SELECT %I.%I($1::uuid, $2::uuid)', r.resolver_schema, r.resolver_function)
      INTO v_value USING uid, default_tenant;
    IF v_value IS NOT NULL THEN
      event := jsonb_set(event, '{claims}', event['claims'] || jsonb_build_object(r.claim_key, v_value), true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'plugin claim % failed: %', r.claim_key, SQLERRM;  -- isolate: omit, keep minting
  END;
END LOOP;
```

Verified properties (E-001): core claims untouched; failing resolver → claim omitted + warning, **mint never breaks**; over-budget output omitted; absent = omitted. Fail-closed is the safe default: an omitted claim must never grant access.

### Layer 4 — Dispatch (runtime, to runtime plugin code)

The dispatch path largely **exists already** — claims are minted into the JWT and surface generically:

| Plane | Mechanism | Change needed |
|---|---|---|
| Backend (Worker) | `VerifiedAuthSession.claims` carries the full payload → plugin helper `getPluginClaim(auth, 'entitlements')` | none (helper ships with plugin) |
| Frontend | decoded JWT at login; extend `access` rule: `access: { claims: { entitlements: { tier: 'pro' } } }` in `loader.ts` (generalizes `anyRole`) | small core addition to `PluginAccessRule` |
| Hook filtering | `getPluginHooks(target, userRoles)` → also evaluate declared claim predicates | small core addition |
| Database (RLS) | policies read `(current_setting('request.jwt.claims'))::jsonb -> 'pluradash'` | none (plugin-owned policies) |
| MCP / hooks | `VerifiedAuthSession` already passed into hook contexts (`is_agent`, `tenant_id` precedent) | none |
| Agent discovery | `api/plugin-claims.ts` + `/api/plugins` registry → agents see which claims exist, their types and semantics | generated file |

"Dispatched to runtime plugins **via the build-time plugin**": the build-time plugin is the *only* definition point — it declares (manifest), registers (migration), resolves (plugin-schema function), and consumes (its own runtime code). Core only namespaces, merges, and exposes.

## 3. Why this shape (alternatives rejected)

| Alternative | Rejected because |
|---|---|
| Per-plugin edits to `custom_access_token_hook` (CREATE OR REPLACE chains) | core modification → EUPL boundary break, merge hell across plugins, regression risk on every install (the current hook is already re-written twice) |
| Plugin-provided full hook replacement | single hook is a platform chokepoint; one plugin could break/own all auth — violates single-source |
| Claims resolved in the Worker (verify token, then query plugin tables per request) | no longer "claim" (not mint-time, not in-token) → breaks RLS policies, DB plane, and OAuth token parity; per-request DB cost; but note: valid *fallback* for large/dynamic data |
| Dynamic Client Registration-style claim negotiation at runtime | complexity without need; Supabase hook is the mint-time chokepoint by architecture |
| JSON-path flat keys per claim (`pluradash/entitlements`) | viable; object-per-plugin chosen for fewer top-level keys and cleaner budget/review story |

## 4. Security & operational properties

- **Fail-closed**: missing/failed/over-budget claim = omitted = not entitled. RLS remains the enforcement plane; claims are *metadata for tooling decisions, not an RLS bypass* (existing doc doctrine, `→ RAW/specy-docs/auth/oauth-mcp-authentication.md §3`).
- **Client visibility**: claims are readable by the token holder — no secrets, ever (contract check E-002 S4; review obligation).
- **Budget**: claims ride on *every* token incl. refresh; Supabase enforces a payload size limit on the hook result — exact limit not documented in the repo (`ASSUMPTION`, commonly ~4KB; must be verified against live Supabase). The declared-budget + global-budget mechanism makes the system robust regardless: build-time Σ-check, mint-time omit+warn.
- **Privilege containment**: `plugin_claims` writes are platform-only (installer PAT / super-admin), reads for the hook (definer) and admin tooling; revokes mirror `Access_hook.sql`. Resolvers are `SECURITY INVOKER` in plugin schemas — a plugin cannot read other tenants'/plugins' data through the hook.
- **Reactivity granularity**: claims update at sign-in/token-refresh (Supabase default 1h access tokens) — revocation latency = remaining token lifetime (E-002 S3). Request-time checks (RLS) are unaffected. This matches the paper's boundary: mint-time is the commit point; request-time is enforcement.
- **Uninstall safety**: downmigration removes the registry row → claims vanish from new tokens; existing tokens keep the claim until expiry (same as role removal today, `→ RAW/specy-docs/auth/oauth-mcp-authentication.md §6`).

## 5. Test evidence

- **E-001** `CONFIRMED` (14/14): namespacing, conflict/reserved-key rejection, mint error isolation, budget enforcement (build + mint), fail-closed absence, namespaced dispatch. `→ 06_Tests/experiments/001-claim-registry-merge-isolation/RESULT.md`
- **E-002** `CONFIRMED` (10/10): install/uninstall revertibility, interleaved independence (recovery exactness), revocation reactivity at refresh boundary, client-visibility contract. `→ 06_Tests/experiments/002-claim-lifecycle-revertibility/RESULT.md`

Follow-up before implementation (`OPEN`): live-Supabase round-trip (real hook + resolver + refresh timing); Supabase claims size limit verification; frontend `access.claims` UX for expired-claim states.

## 6. Open items `OPEN`

1. Should `access.claims` predicates be declarative (JSON in manifest) or a small predicate DSL? (Declarative keeps load-time review trivial.)
2. Should resolvers be allowed to return per-tenant *sets* (multi-tenant users get several tenant buckets) — affects budget shape?
3. Do core claims (`user_roles`, `is_agent`, `tenant_id`) eventually migrate *onto* the same registry (core as "plugin zero")? Elegant, but churn risk; defer.
4. Interaction with future peer-dependency versioning (paper §6.6): claim type evolution = interface drift; budget for a `version` field per claim declaration.
