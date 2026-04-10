# Secrets Management Audit

Date: 2026-04-10

## Scope

This audit reviews the current secrets management system across:

- Cloudflare Worker configuration in `wrangler.default.jsonc` and `wrangler.jsonc`
- Setup automation in `scripts/setup.mjs`
- Secrets CRUD proxy in `api/routes/secrets.ts`
- Runtime secret consumption in `api/lib/supabase.ts` and `api/routes/media.ts`
- Admin UI and client services in `src/pages/VerwaltungConnections.tsx`, `src/pages/Plugins.tsx`, `src/services/connectionsService.ts`, and `src/services/pluginService.ts`
- Adjacent secret-like flows for frontend registration in `api/routes/mcp.ts`, `api/routes/schemas.ts`, and `migrations/page_schemas.sql`
- Supporting documentation in `specs/Architecture.md`, `specs/Supabase_Cloudflare-Setup.md`, `specs/Plugin_Development.md`, and `specs/Plugin_Installation.md`

The intended system goal is clear: enable extensible plugin and agent integrations while using Cloudflare as the current safe storage boundary for sensitive values.

Future direction also matters for this audit:

- a future iteration will support an optional Docker-based install path
- secrets will eventually need to live behind a self-hostable system that has not yet been selected

That means the long-term design target should not be a Cloudflare-only secret model. It should be a provider abstraction with Cloudflare as the current implementation.

## Executive Summary

The current system is strong at one thing: protecting a small set of platform secrets from accidental disclosure. Secret values are never returned by the UI, `/api/secrets` is gated to `super-admin`, and the most sensitive credential, `SUPABASE_SECRET_KEY`, is consumed only from a Cloudflare Secrets Store binding.

The system is not yet coherent enough to support its broader goal of plugin and agent extensibility.

The main issue is architectural drift between three layers:

1. What the UI claims can be managed in Cloudflare
2. What the Worker is actually bound to at runtime
3. What plugins and agents can actually consume safely

As a result, the current implementation only partially fulfills the design intent. It works as a secure storage boundary for one critical server-side credential, but it does not yet provide a consistent, end-to-end secrets platform for plugins, agents, operational rotation, or future non-Cloudflare deployments.

## Overall Assessment

Assessment: Partially aligned with intent

- Platform secret protection: Good
- Secret write protection and non-disclosure: Good
- Runtime consistency between storage and consumption: Weak
- Plugin extensibility model: Weak
- Agent extensibility model: Weak
- Auditability and governance: Weak
- Portability to self-hosted deployments: Weak

## Findings

### 1. High: Most secrets managed in the UI are not actually wired into runtime consumption

The most serious issue is the mismatch between the Connections UI, the documented binding model, and the Worker's runtime behavior.

Evidence:

- `src/services/connectionsService.ts` presents several values as Cloudflare Secrets Store-backed items with bindings such as `SS_SUPABASE_URL`, `SS_SUPABASE_PUBLISHABLE_KEY`, `SS_STORAGE_PROVIDER`, `SS_STORAGE_BUCKET`, and `SS_R2_PUBLIC_URL`
- `src/pages/VerwaltungConnections.tsx` tells operators that secrets are injected through `secrets_store_secrets` bindings and that new bindings require redeploy
- `wrangler.default.jsonc` defines only one actual Secrets Store binding: `SS_SUPABASE_SECRET_KEY`
- `scripts/setup.mjs` stores `SUPABASE_PUBLISHABLE_KEY` as a Worker secret and stores `SUPABASE_URL` and storage settings as plain `vars`, not Secrets Store bindings
- `api/lib/supabase.ts` consumes `env.SUPABASE_URL` and `env.SUPABASE_PUBLISHABLE_KEY` directly
- `api/routes/media.ts` consumes `env.STORAGE_PROVIDER`, `env.STORAGE_BUCKET`, and `env.R2_PUBLIC_URL` directly
- `resolveSecret()` exists in `api/lib/supabase.ts` but is not used by the audited runtime paths

Impact:

- Rotating `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `STORAGE_PROVIDER`, `STORAGE_BUCKET`, or `R2_PUBLIC_URL` through `/verwaltung/connections` does not reliably change what the Worker uses at runtime
- Operators can believe they have updated a live credential while the Worker continues to use the older value from a Worker secret or `wrangler.jsonc` var
- The system appears more Cloudflare-Secrets-Store-centric than it really is

Why this matters for extensibility:

- Plugins and agents need a predictable rule: if a value is stored through the central secret system, runtime code must consume that value through the same system
- Right now that rule is not true for most known keys

Recommendation:

- Decide on one of two models and enforce it consistently:

Model A: Cloudflare-first
- Bind every managed secret through `secrets_store_secrets`
- Use helper functions that prefer Secrets Store bindings everywhere runtime values are consumed
- Update setup and docs to provision those bindings automatically

Model B: Split config from secrets explicitly
- Keep non-sensitive operational settings like `SUPABASE_URL`, `STORAGE_PROVIDER`, `STORAGE_BUCKET`, and `R2_PUBLIC_URL` out of the Cloudflare secret UI entirely
- Restrict `/verwaltung/connections` to values that are both sensitive and actually runtime-bound
- Present plain config and secrets as separate systems in both UI and docs

Without this correction, secret rotation through the UI remains partially misleading.

### 2. High: Plugin secret storage exists, but there is no complete runtime retrieval model for plugins or agents

The codebase supports storing plugin secret values in Cloudflare, but it does not define a corresponding server-side consumption model.

Evidence:

- Plugin config supports `type: 'secret'` in `src/types/plugin.ts`
- Plugin secrets are named deterministically via `buildPluginSecretName()` in `src/services/pluginService.ts`, producing names like `PLUGIN_{slug}_{field}`
- `src/pages/Plugins.tsx` saves and deletes these secrets through `/api/secrets`
- `specs/Plugin_Development.md` and `specs/Plugin_Installation.md` instruct plugin authors to use the CMS secret system for sensitive values
- The documented plugin runtime example in `specs/Plugin_Installation.md` only shows reading plain JSON config from `plugins.config`
- No audited backend helper or route was found that resolves plugin secrets by plugin slug and field key at execution time
- No audited agent-scoped secret access abstraction was found

Impact:

- Plugin authors are encouraged to store sensitive values in Cloudflare, but they are not given a supported server-side retrieval contract
- In practice, plugin authors may fall back to plain database config, ad hoc `.env` usage, or custom one-off secret fetch logic
- There is no least-privilege or namespace-aware access layer for plugins or agents

Why this matters for extensibility:

- Extensibility requires more than secure storage at rest
- It also requires a safe consumption path with namespace isolation, naming rules, and backend-only retrieval semantics

Recommendation:

- Introduce a server-only secret resolution layer for plugins and agents, for example:
  - `getPluginSecret(env, pluginSlug, fieldKey)`
  - `getAgentSecret(env, agentNamespace, key)`
- Introduce these helpers behind a provider interface rather than binding them directly to Cloudflare-specific APIs
- Enforce naming conventions and namespace isolation inside that layer
- Keep raw store listing and raw secret names out of plugin runtime code where possible
- Add docs that show how a plugin route or agent task retrieves a secret without exposing it to the frontend or storing it in database config

Until this exists, the system does not yet function as a real secret platform for plugins or agents.

### 3. High: Revalidation secrets for frontend registration are stored in the database, outside the Cloudflare secret boundary

There is a separate secret path for page schema registration and ISR/revalidation that bypasses Cloudflare entirely.

Evidence:

- `api/routes/mcp.ts` accepts `revalidation_secret` when registering a frontend
- `api/routes/schemas.ts` accepts `revalidation_secret` on `POST /api/schemas/:slug/register`
- `api/routes/schemas.ts` persists `revalidation_secret` into `page_schemas`
- `migrations/page_schemas.sql` defines `revalidation_secret text null`
- `api/routes/schemas.ts` later reads the stored value and appends it to outbound revalidation URLs

Impact:

- A value explicitly named `secret` is persisted in database plaintext rather than in Cloudflare secret infrastructure
- Database readers, exports, backups, and admin tooling can access it
- This directly violates the intended architectural message that Cloudflare is the safe storage boundary for secrets

Recommendation:

- Move `revalidation_secret` to the central secret system
- Store only a reference, name, or namespace key in `page_schemas`
- Avoid sending secrets in query parameters when possible; prefer headers for outbound revalidation authentication

This is the clearest example of the current system not enforcing a single secret boundary.

### 4. Medium: Secret mutations are intentionally not logged, but there is no replacement audit trail

The system correctly avoids logging secret values, but it currently drops almost all operational observability for secret changes.

Evidence:

- `api/middleware/agentLogger.ts` skips `/api/secrets` entirely to prevent token and secret leakage
- No audited replacement mechanism records metadata-only events such as actor, action, target secret name, result, and timestamp

Impact:

- There is no built-in answer to basic governance questions such as who created, rotated, or deleted a secret
- Incident response and operations become harder
- This is especially limiting if secrets are meant to support third-party plugins and agent integrations over time

Recommendation:

- Add a dedicated metadata-only audit log for secret operations
- Log at least: authenticated user id, role set, action, secret name, namespace, success/failure, Cloudflare response status, and timestamp
- Never log secret values or raw request bodies

The current design protects confidentiality, but not accountability.

### 5. Medium: Server-side validation of secret names and namespaces is too permissive

Secret naming safeguards are mostly implemented in the UI, not on the server.

Evidence:

- `src/pages/VerwaltungConnections.tsx` normalizes custom names to uppercase alphanumeric plus underscore
- `src/services/pluginService.ts` normalizes plugin secret names via `buildPluginSecretName()`
- `api/routes/secrets.ts` accepts `POST /api/secrets/:name` and `DELETE /api/secrets/:name` without enforcing a server-side naming policy beyond requiring a value

Impact:

- Direct API clients can submit malformed names or collide with reserved system names
- A `super-admin` can intentionally or accidentally overwrite platform-level keys and plugin namespaced keys using the same route
- Namespace policy is implicit rather than enforced

Recommendation:

- Add server-side validation for allowed name format
- Reserve core system prefixes explicitly, for example `SUPABASE_`, `STORAGE_`, `CF_`, `PLUGIN_`, and future `AGENT_`
- Consider separate endpoints or namespace-aware policies for system secrets versus plugin or agent secrets

This is not a confidentiality failure today, but it is a governance and maintainability weakness.

### 6. Medium: Sensitive secret endpoints inherit permissive global CORS settings

All API routes currently share the same permissive CORS configuration.

Evidence:

- `api/index.ts` sets `origin: '*'` with `Authorization` allowed for all routes, including `/api/secrets`

Impact:

- Authentication still protects the routes, so this is not an immediate access control bypass
- However, it widens exposure unnecessarily for high-value administrative surfaces
- Future frontend changes, token handling changes, or integration errors are more likely to become security problems when the boundary is already broad

Recommendation:

- Narrow allowed origins for admin and secret-management routes to trusted frontend origins only
- Consider route-specific CORS policies rather than one wildcard policy for the entire API

This is a defense-in-depth issue rather than a direct exploit in the audited code.

## Positive Findings

The current system has several good security properties that should be preserved.

### 1. Secret values are write-only from the admin UI

- `api/routes/secrets.ts` lists metadata only and never returns stored secret values
- `src/pages/VerwaltungConnections.tsx` correctly presents secrets as set/delete-only data

This is the right default for admin secret management.

### 2. The most sensitive platform credential is handled correctly

- `api/lib/supabase.ts` requires `SS_SUPABASE_SECRET_KEY` for the admin client
- There is intentionally no plain var fallback for `SUPABASE_SECRET_KEY`

This is the strongest part of the current design and a good template for other highly sensitive values.

### 3. Administrative access is gated server-side

- `api/routes/secrets.ts` requires `super-admin` through `requireAppRole()` in `api/lib/auth.ts`
- The frontend permission checks in `src/pages/VerwaltungConnections.tsx` are supplementary rather than the primary control

The critical decision is enforced on the backend, which is correct.

### 4. Logging avoids obvious secret leakage

- `api/middleware/agentLogger.ts` explicitly skips `/api/secrets`
- The logger also contains sensitive-key filtering for other routes

The approach needs a metadata audit replacement, but the confidentiality instinct is correct.

### 5. Cloudflare API usage for secret create/update is now aligned with Wrangler

The current `api/routes/secrets.ts` implementation now matches the effective Cloudflare API contract used by Wrangler:

- create uses `POST` with an array body
- update uses `PATCH` with a single object body

This removes a correctness bug that previously blocked secret creation.

## Architectural Conclusion

The current design is best described as a secure platform-secret subsystem, not yet as a general secret platform for specy extensibility.

That distinction matters.

Today, the system is good enough to protect a privileged backend credential and to provide an admin UI for Cloudflare secret mutation. It is not yet good enough to serve as the canonical, end-to-end secret system for plugins and agents because:

- storage and runtime consumption are inconsistent
- some secret-like values bypass Cloudflare entirely
- plugin and agent retrieval patterns are not fully implemented
- mutation events are not auditable

## Recommended Target State

### Architectural direction: provider abstraction first

Because a future Docker install path is planned and secrets must eventually live on a self-hostable system, the core architectural decision should be:

- application code depends on a secret provider interface
- deployment targets supply the provider implementation

Suggested abstraction:

- `SecretProvider.get(name)`
- `SecretProvider.set(name, value, metadata)`
- `SecretProvider.delete(name)`
- `SecretProvider.listMetadata(namespace)`

Suggested implementations over time:

- `CloudflareSecretProvider` for the current hosted Worker path
- `SelfHostedSecretProvider` for a future Docker or self-managed installation

This keeps plugin and agent code stable while the storage backend changes.

### Phase 1: Make runtime behavior truthful

- Either bind and consume all UI-managed secrets from Cloudflare, or remove non-runtime-backed items from the secret UI
- Update `wrangler.default.jsonc`, `scripts/setup.mjs`, and UI descriptions together
- Use one helper pattern for runtime resolution instead of direct `env.X` access spread across routes
- Make that helper/provider boundary the only place where Cloudflare-specific behavior exists

### Phase 2: Add namespaced secret resolution for extensibility

- Introduce explicit server-only helpers for plugin and agent secret access
- Standardize namespaces such as `PLUGIN_{slug}_{field}` and `AGENT_{namespace}_{key}`
- Document the retrieval contract with backend-only examples
- Ensure plugin and agent retrieval goes through the provider abstraction so the same code can run in hosted and self-hosted installs

### Phase 3: Close governance gaps

- Move `revalidation_secret` out of database plaintext storage
- Add metadata-only audit logging for secret operations
- Add server-side validation and reserved-prefix protection
- Restrict CORS on secret-management routes

### Phase 4: Prepare the Docker and self-hosted path

- Define a deployment-neutral secret contract before implementing Docker install flows
- Keep secret references, namespaces, and metadata portable across providers
- Avoid storing provider-specific identifiers deep in plugin or agent code
- Document which secrets are required at bootstrap time versus which can be created after first start
- Plan a migration path from Cloudflare-managed names to self-hosted secret records or mounts

## Final Verdict

If the immediate goal is to use Cloudflare as the safe storage system for secrets while enabling plugin and agent extensibility, the current implementation is a solid starting point but not yet a complete solution.

If the longer-term goal includes Docker installs and a self-hostable secret backend, then the next step should not be more Cloudflare coupling. It should be a provider abstraction that lets Cloudflare remain the current backend without becoming the permanent architecture.

The system already demonstrates the right instincts around write-only secret handling, privileged secret isolation, and backend authorization. The next step is to make the runtime wiring, extensibility model, and provider abstraction match those instincts consistently.