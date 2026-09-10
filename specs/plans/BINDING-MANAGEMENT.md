# Binding & Deployment-Configuration Management for Build-Time Plugins

General design for a **devops-configuration system** of which Cloudflare Worker bindings are the first resource type: build-time plugins *declare* their cloud-environment needs as **intents**, and a per-deployment system **resolves, provisions, and injects** concrete instances — so a plugin never re-uses a hardcoded binding pointing at another environment's production instance.

> **Status: implemented 2026-09-09** — see [`platform/binding-management.md`](../platform/binding-management.md) for the implemented contract. Implementation deviations from this plan: shared instances are namespaced `{pluginId}--{purpose}` (not bare `purpose`) to stay collision-free across plugins; KV namespace ids resolve from a git-ignored ledger sidecar (`.bindings-ledger.json`) instead of live lookups; Secrets Store link values are verified, not created, by the provisioner (store values stay an operator action); consumer registration stays in wrangler config (registered at deploy time against the same resolved instance); legacy `wrangler_bindings` remains supported verbatim alongside `wrangler_intents` for incremental plugin migration; intent validation runs at install time (fail-early) in addition to build time. The queues case (the incident) is fully implemented; kv + Secrets Store linking implemented; d1/dns/core-as-plugin-zero remain rollout steps §7.

**Triggering incident (user report, 2026-09-09)**: the `isibot-sms-notifications` queue binding was injected into the dev environment; adding dev as a **producer** succeeded, but the step after failed because the **production environment was already declared consumer** of the same account-global queue. The correct procedure: the plugin should have **automatically created a new instance** for the dev environment.

Companion to `→ CLAIM-MANAGEMENT.md` (same architectural pattern, applied to infrastructure). Validated in simulation: **E-003 `CONFIRMED` (11/11)** — `→ 06_Tests/experiments/003-binding-intents-environments/RESULT.md`.

---

## 1. Current state (verified)

How binding management works today (`→ SPECY-REPO/specy/scripts/lib/plugin-workspace.mjs`, `ensure-registry.mjs`):

1. Plugins declare **concrete instances** in `plugin.json` → `wrangler_bindings`: `ai`, `kv_namespaces` (with real `namespace_id`), `durable_objects`, `queues` (producers/consumers with real queue names), `vars`, `secrets_store_secrets` (real `store_id`). Example — PluraDash: `{"queues": {"producers": [{"queue": "isibot-sms-notifications", "binding": "ISIBOT_SMS_QUEUE"}], "consumers": [{"queue": "isibot-sms-notifications", "max_batch_size": 5, ...}]}}`. `→ RAW/pluradash/plugin.json`
2. `collectPluginWranglerBindings()` collects entries with **name-based conflict detection** (binding/var/secret name claimed by two plugins → `process.exit(1)`); queue producer conflicts keyed on `(queue, binding)`, consumer conflicts on `queue`.
3. `rebuildWranglerPluginBindings()` regenerates the auto-generated `PLUGIN BINDINGS` section of `wrangler.jsonc` with the entries **verbatim**.
4. Core-owned types (`r2_buckets`, plus `vars`/`secrets_store_secrets` via special-cased merging) are handled separately; `r2_buckets` from plugins are rejected with a warning.
5. **Environments are separate Workers**, not wrangler `env` blocks: the committed template says *"Run a second instance (e.g. dev) by choosing a different name during setup"* — each deployment has its own generated, git-ignored `wrangler.jsonc` with its own `name` and `CF_ACCOUNT_ID`. `→ SPECY-REPO/specy/wrangler.default.jsonc`

## 2. Root-cause analysis of the failure

| # | Root cause | Consequence |
|---|---|---|
| 1 | Plugins declare **instances**, not **requirements** (`queue: "isibot-sms-notifications"` is a concrete account-global name) | The plugin's binding *is* the production resource — in every deployment |
| 2 | Queue names / KV ids / Secrets Store ids are **account-global**; two deployments share one account | The dev Worker's "create-or-get" of the same name finds **prod's** queue |
| 3 | No **resolution layer** between declaration and injection | Nothing maps plugin intent → per-environment instance |
| 4 | No **provisioning step** | Injection assumes the resource exists; a second environment either collides (consumer already registered by prod) or silently shares state |
| 5 | No **ownership/ledger** record of which deployment created which instance | Collisions are discovered at deploy time as cryptic errors; teardown is impossible |

The failure is structural: the current model cannot express *"this plugin needs *a* queue for SMS notifications"* — only *"this plugin needs **that** queue"*. Verified reproduction: E-003 Scenario A.

## 3. Best-practice research

- **Cloudflare bindings** (`→ RAW/cf-bindings-docs.md`): a binding is *"a permission and an API in one piece"* — the capability is embedded in the platform, no secrets in code. Local dev connects to **locally simulated resources by default**; **remote bindings** connect to real resources. Implication: the *binding name* is the plugin's capability handle; the *instance* behind it is a deployment concern that belongs to configuration, not to plugin code.
- **Environment strategy**: wrangler supports `env` blocks in one config, but Specy's chosen model — one Worker per environment with its own generated `wrangler.jsonc` — is the stronger isolation pattern (fully independent config, routing, and secrets) and is what the resolution layer must serve. Keep it.
- **Infrastructure-as-desired-state** (Terraform/Pulumi/CDK pattern): declare *what should exist*; a reconciler compares with reality and creates/updates/deletes. Idempotent `create-or-get` is the core operation. Specy should adopt the *pattern* without the toolchain: intents in manifests = desired state; a provisioner step = reconcile; a ledger = state record. (Full IaC remains an alternative for the platform operator; the plugin boundary still needs intent declaration either way.)
- **Naming discipline**: deterministic, parseable instance names `{worker-name}--{plugin-id}--{purpose}` give collision-freedom by construction (the claim-management namespacing lesson) and make cost/ownership audits possible in the Cloudflare dashboard.
- **12-factor config**: everything environment-specific lives in the deploy configuration, never in the artifact — plugin code addresses `env.ISIBOT_SMS_QUEUE` and must not know which instance it got.
- **Paper tie-in** (`→ COMPOSABILITY-PARADIGM.md`): binding = **coeffect key**; the instance behind it = **realm-scoped provision**; the deployment environment = **isolation realm** (§3.2.3 names multi-tenancy and testing environments as the canonical realm applications); the ledger + reconcile loop = the **declarative loader with configuration reconciliation** (§5.2.1) whose soundness rests on **confluence** (§4.4.5): the generated config must be a function of the final declared state alone.

## 4. The design: Binding Intent & Provisioning System (BIPS)

Same four-layer shape as the claim system. **Core owns the mechanism (resolver, provisioner, ledger, injection); plugins declare intents.**

### Layer 1 — Declaration (build time, inside the plugin)

`wrangler_bindings` entries are upgraded from concrete entries to **intents** (breaking change → version the manifest field as `wrangler_intents`):

```json
"wrangler_intents": {
  "queues": [
    {
      "binding": "ISIBOT_SMS_QUEUE",
      "purpose": "sms-notifications",
      "scope": "environment",
      "consumer": { "max_batch_size": 5, "max_batch_timeout": 10 }
    }
  ],
  "kv_namespaces": [
    { "binding": "PLURADASH_CACHE", "purpose": "cache", "scope": "environment" }
  ],
  "secrets_store_secrets": [
    { "binding": "SS_TWILIO_ACCOUNT_SID", "purpose": "twilio-account-sid", "scope": "shared",
      "provision": "link" }
  ],
  "vars": { "PLURADASH_SYNC_LOG_LEVEL": "" }
}
```

Semantics:
- `binding` — the JS identifier on `env` (the capability handle in plugin code); unique per worker, conflict-detected as today.
- `purpose` — semantic slug; combined with plugin id and worker name into the instance name.
- `scope` — **`environment`** (default): the deployment gets its **own instance**. **`shared`**: explicit opt-in to one account-global instance (e.g. a Secrets Store secret that is genuinely account-level, an AI Gateway). Shared requires the provisioner step to still be create-or-get, and the *config* (not the instance) is what varies per environment.
- The plugin **never names an instance**. Plugin code only ever uses `env.<BINDING>` (12-factor; verified requirement from cf-bindings-docs: bindings are the API).

Build-time (`ensure-registry` extension): validate intents (kind whitelist, purpose slug format, binding-name uniqueness per worker, single-source per `(plugin, purpose)`), and generate the intermediate `api/plugin-bindings.ts` descriptor (discovery/review artifact, like `plugin-claims.ts`).

### Layer 2 — Resolution (deploy time, in core)

For each environment (worker name) the resolver deterministically maps every intent to a concrete instance:

```
instance_name = scope == "environment"
    ? f"{worker_name}--{plugin_id}--{purpose}"      # specy-dev--pluradash--sms-notifications
    : purpose                                        # explicit shared instance
```

Deterministic naming ⇒ two deployments of the same stack can never collide; two *different* plugins can never collide (plugin id in the name); redeploys are idempotent (same name). The resolver also resolves *cross-references*: e.g. a plugin needing the **core's** R2 bucket receives the core-resolved name (core intents go through the same pipeline — core is "plugin zero" for its own `MEDIA_BUCKET`, `SS_SUPABASE_SECRET_KEY`, etc.).

### Layer 3 — Provisioning (deploy time, in core)

A reconcile step before `wrangler deploy`, using the existing `CF_API_TOKEN` (already a Worker secret used by the connections surface):

1. Read intents from the generated descriptor; compute resolved names (Layer 2).
2. For each: **create-or-get** via Cloudflare API / wrangler (`wrangler queues create`, KV namespace create, R2 bucket create, Secrets Store secret create/link) — idempotent.
3. Record in a **resource ledger** — a JSON sidecar next to the generated `wrangler.jsonc` (git-ignored, per deployment) and/or a core DB table: `{resolved_name, kind, plugin_id, environment, created_at, wiring}`. The ledger is the state record that makes the process declarative: it is what enables teardown (uninstall → offer `delete` for environment-scoped instances the plugin owns — the downmigration analog) and orphan detection (ledger rows with no matching intent).
4. Wire kind-specific attachments (queue consumer registration with `max_batch_size`, DO migrations) **atomically per intent** — producer + consumer against the *same resolved instance* (the exact step that failed in the incident).

Provisioning failures fail the deployment *before* `wrangler deploy` — a config error can no longer surface as a cryptic post-deploy binding error.

### Layer 4 — Injection (build/deploy time, in core)

`rebuildWranglerPluginBindings` writes the **resolved** entries into the generated section — unchanged format, but now environment-correct:

```jsonc
// ── PLUGIN BINDINGS (AUTO-GENERATED by scripts/ensure-registry.mjs) ──────
"queues": {
  "producers": [ { "queue": "specy-dev--pluradash--sms-notifications", "binding": "ISIBOT_SMS_QUEUE" } ],
  "consumers": [ { "queue": "specy-dev--pluradash--sms-notifications", "max_batch_size": 5, "max_batch_timeout": 10 } ]
}
```

Plugin runtime code is untouched — `env.ISIBOT_SMS_QUEUE` (cf-bindings-docs: the binding is the permission+API; the instance is invisible to code).

### The incident, re-run through BIPS (verified E-003 B/D)

Dev deploy of `specy-dev`: intent resolves to `specy-dev--pluradash--sms-notifications` → provisioner creates a **new queue** → producer and consumer both wired to it atomically → generated section references only environment-local names. Prod's `specy--pluradash--sms-notifications` and its consumer registration are untouched. The "prod already declared consumer" collision is structurally impossible.

## 5. Security & operations

- **Provisioning privilege**: `CF_API_TOKEN` needs resource-create scopes (queues, KV, R2, Secrets Store). Least privilege per deployment; the token never reaches plugin code (bindings-docs: the capability is the binding, not a key).
- **Isolation by default**: `environment` scope means a dev plugin instance physically cannot read/write prod data through the binding — the incident's deeper harm (silent cross-environment data flow via the shared queue) is eliminated, not just the error.
- **Shared scope is reviewed**: a shared instance is a deliberate, auditable declaration (one more reason for the generated descriptor + review step).
- **Cost & orphan control**: deterministic names + ledger make ownership visible in the Cloudflare dashboard; uninstall offers teardown of environment-scoped instances; orphans (ledger rows without intents, cloud resources without ledger rows) are reportable.
- **Quota awareness**: create-or-get must handle account limits (queues/KV/R2 per-account caps) with explicit errors — provisioning failures are config-level, pre-deploy.
- **Secrets remain separate**: `secrets_store_secrets` with `scope: "shared"` + `provision: "link"` resolves *links* to existing store secrets per environment; values stay in the Secrets Store, never in manifests (existing doctrine).

## 6. Generalization: the devops-config layer

BIPS is the first instance of a general **deployment-configuration system**. Uniform intent schema — `{kind, binding, purpose, scope, config}` — with per-kind provisioners:

| Resource kind | CF type | Provisioner operation |
|---|---|---|
| `queue` | Queues | create-or-get queue; register consumer |
| `kv` | KV namespace | create-or-get namespace |
| `r2` | R2 bucket | create-or-get bucket (core-owned today; pluggable later) |
| `d1` | D1 database | create-or-get database; run plugin migrations against it |
| `do` | Durable Objects | class binding (no instance provisioning; namespace = worker) |
| `secret` | Secrets Store | link existing secret; create if missing |
| `var` | env vars | direct injection (already works) |
| *(future)* `supabase-schema` | Postgres | plugin-schema creation = already migration-managed (the claim/migration path) |
| *(future)* `dns`/`custom-domain` | CF DNS | route/domain attach |

This is the same conceptual move as the claim system one level down: **claims give runtime plugins their per-request context; binding intents give build-time plugins their per-deployment context.** Both are core-mechanism/plugin-semantics splits backed by a registry, deterministic resolution, and a ledger.

## 7. Test evidence & rollout

- **E-003 `CONFIRMED` (11/11)**: incident reproduced with the legacy model; intent model provisions per-environment instances; isolation/single-source/shared-opt-in verified; generated sections environment-pure. `→ 06_Tests/experiments/003-binding-intents-environments/RESULT.md`
- Rollout order: (1) resolver + ledger + provisioner for `queues` (the incident case), (2) KV + Secrets Store linking, (3) manifest `wrangler_intents` migration for PluraDash, (4) R2/D1 and core-as-plugin-zero, (5) teardown/orphan tooling.
- Open items `OPEN`: exact Cloudflare per-queue consumer limits (assumption from the incident — verify against CF docs); multi-account deployments (resolve per account_id, not just worker name); whether the resource ledger lives in git-ignored sidecar (per-deploy truth) vs core DB (platform truth) or both; remote-bindings integration for local dev parity.
