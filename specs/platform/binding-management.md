# Binding Management — the Binding Intent & Provisioning System (BIPS)

Implemented contract (2026-09-09) for **per-environment plugin binding instances**.
Design and rationale: [`plans/BINDING-MANAGEMENT.md`](../plans/BINDING-MANAGEMENT.md).
Companion to the claim system ([`plans/CLAIM_MANAGEMENT.md`](../plans/CLAIM_MANAGEMENT.md)) —
claims give runtime plugins their per-request context; binding intents give
build-time plugins their per-deployment context.

**Triggering incident:** a plugin's queue binding was declared as a concrete,
account-global name (`isibot-sms-notifications`). Deploying the dev worker
injected that name, and the deploy failed because the production environment was
already registered consumer of the same queue. With BIPS the plugin declares only
*what* it needs; every deployment gets its own instance and the collision is
structurally impossible.

---

## 1. Doctrine: binding management is part of a plugin

- **Plugins declare their cloud-system bindings themselves** — in `plugin.json`,
  never by editing core `wrangler.jsonc` sections (EUPL boundary: core provides
  the mechanism, plugins the semantics).
- **Declarations are made per *deployment path*.** The manifest field
  `deployment_path` names the vendor cloud system the bindings target:
  **`cloudflare` is the current default and only deployment path.** A plugin
  based on a different vendor's cloud system would declare a different
  deployment path with its own binding shapes; today unknown paths are rejected
  at build/install time with a clear error.
- **The plugin never names an instance.** It declares a *capability handle*
  (`binding` — the JS identifier on `env`) and a *semantic purpose*; core
  resolves the concrete instance deterministically per deployment. Plugin code
  only ever reads `env.<BINDING>` — the instance behind it is invisible.

## 2. Declaration (Layer 1 — in `plugin.json`)

```json
{
  "deployment_path": "cloudflare",
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
      { "binding": "SS_TWILIO_ACCOUNT_SID", "purpose": "twilio-account-sid",
        "scope": "shared", "secret_name": "TWILIO_ACCOUNT_SID" }
    ],
    "vars": { "PLURADASH_SYNC_LOG_LEVEL": "" }
  }
}
```

Semantics:

| Field | Meaning |
|---|---|
| `binding` | JS identifier on `env` — the plugin's capability handle. Unique across plugins per kind; conflicts abort the build. |
| `purpose` | Semantic slug (`[a-z][a-z0-9-]*`). Combined with plugin id and worker name into the instance name. Single-source per plugin. |
| `scope` | **`environment`** (default): the deployment gets its **own instance** — isolation by default. **`shared`**: explicit opt-in to one account-global instance (e.g. Secrets Store values that are genuinely account-level). Shared instances are still namespaced (`{pluginId}--{purpose}`) and must be single-source across plugins. |
| `consumer` (queues) | Consumer settings — registered against the **same resolved instance** as the producer (atomic wiring). A `queue` key inside `consumer` never overrides the resolution. |

Supported kinds: `queues`, `kv_namespaces`, `secrets_store_secrets`, `vars`,
`ai`, `durable_objects`. `r2_buckets` is core-owned (plugins consume the shared
`MEDIA_BUCKET` binding) and rejected.

**Intents never name instances:** `namespace_id` on a kv intent triggers a
deprecation warning; queue intents without `purpose` are rejected (a concrete
`queue` name in the manifest is exactly the bug class this system removes).

### Legacy form

`wrangler_bindings` (concrete instance entries) is **deprecated but still
supported verbatim** so plugins can migrate one at a time. Mixed workspaces are
supported; cross-plugin binding conflicts between an intent-declaring and a
legacy plugin abort the build. `wrangler_intents` wins when both are present.
Deprecation warnings point here on every build.

## 3. Resolution (Layer 2 — deterministic)

```
instance_name = scope == "environment"
    ? f"{worker-name}--{plugin-id}--{purpose}"     # specy-dev--pluradash--sms-notifications
    : f"{plugin-id}--{purpose}"                    # shared: pluradash--twilio-account-sid
```

Environments are **separate Workers** (one generated, git-ignored
`wrangler.jsonc` per deployment; the worker name IS the environment). Therefore:

- two deployments of the same stack can never collide;
- two different plugins can never collide (plugin id in the name);
- redeploys are idempotent (same name → `create-or-get`).

Implementation deviation from the plan: shared instances are
`{pluginId}--{purpose}`, not bare `purpose` — bare purposes from two plugins
could collide; namespacing follows the claim-management lesson.

Secrets Store intents resolve their *link target*: `secret_name` (defaults to
the UPPER_SNAKE form of `purpose`). `store_id` may be omitted — it resolves to
the core deployment's `SECRETS_STORE_ID` var (the Secrets Store itself is
core-deploy configuration).

## 4. Provisioning (Layer 3 — deploy time)

`npm run bindings:provision` (`scripts/provision-bindings.mjs`):

1. Collect + resolve all workspace intents (build-style validation first —
   errors abort with actionable messages).
2. **Create-or-get** each provisionable instance via the Cloudflare API using
   `CF_API_TOKEN` (env / `.env`, or prompted interactively; account id and
   worker name from `wrangler.jsonc`):
   - `queues` → `POST /accounts/{account}/queues` with the resolved name; an
     "already exists" response falls back to a list lookup (idempotent).
   - `kv_namespaces` → `POST /accounts/{account}/storage/kv/namespaces` with the
     resolved title; records the 32-hex namespace id.
   - `secrets_store_secrets` → **verify the link** (list the store, report
     missing secret names). Values stay in the Secrets Store; creation of store
     values remains an explicit operator action
     (`wrangler secrets-store secret create …`).
3. Record every instance in the **resource ledger** `.bindings-ledger.json`
   (git-ignored sidecar next to `wrangler.jsonc`): `{resolved_name, kind,
   plugin_id, purpose, scope, instance_id, wiring, created_at, updated_at}`.
   Rows are keyed by `(plugin_id, kind, purpose)` — re-provisioning updates in
   place (declarative reconcile).
4. **Teardown** (`--teardown <plugin-id> [--dry-run]`): deletes environment-scoped
   instances the plugin owns from the cloud and the ledger — the downmigration
   analog for bindings. Shared-scoped instances are never deleted.

Queue **consumer registration is intentionally not done here**: consumers are
declared in the generated `wrangler.jsonc` and registered by wrangler at deploy
time, against the same resolved instance the producer uses.

Provisioning failures are **config-level errors that abort before
`wrangler deploy`** — never cryptic post-deploy binding errors.

### Deploy drift detection (`npm run bindings:check`)

`wrangler deploy` interactively prompts when the local generated config differs
from the remote Worker — a per-deploy adjudication that is not reproducible.
`npm run bindings:check` produces the **same diff as a one-command report before
deploying**: it fetches the live Worker's bindings via the Cloudflare API
(`GET /workers/scripts/{name}/settings`), diffs them against the generated
`wrangler.jsonc`, and classifies every difference as **added / removed / changed
/ converged** plus attribution (`plugin-resolved` vs `core-owned`):

- `+` **added** — deploy will add (expected after provisioning new instances).
- `-` **removed** — deploy will remove; review: dashboard-side change or stale
  binding? This is the only class that needs a human decision.
- `~` **changed** — same binding, different target (e.g. an R2 bucket renamed in
  the dashboard).

Doctrine: the **local generated config is the source of truth** (confluence —
it is a function of manifests + ledger alone). Deploy converges remote → local.
Non-interactive/CI deploys skip the wrangler prompt and apply exactly this diff.
After the first converged deploy, the prompt disappears until config changes.

## 4. Injection (Layer 4 — build time)

`ensure-registry.mjs` (predev/prebuild) resolves intents and writes the
**resolved** entries into the auto-generated `PLUGIN BINDINGS` section of
`wrangler.jsonc` — unchanged format, now environment-correct:

```jsonc
"queues": {
  "producers":  [ { "queue": "specy-dev--pluradash--sms-notifications", "binding": "ISIBOT_SMS_QUEUE" } ],
  "consumers":  [ { "queue": "specy-dev--pluradash--sms-notifications", "max_batch_size": 5, "max_batch_timeout": 10 } ]
}
```

- KV namespace ids come from the ledger (wrangler needs the 32-hex id, not the
  title). Un-provisioned kv intents are skipped with a loud warning — run
  `npm run bindings:provision` (deploy would fail until provisioning ran).
- Secret intents resolve `store_id` from the core config; entries merge into the
  core `secrets_store_secrets` array as before.
- Vars merge into the core `vars` block (core value wins on collision).

The descriptive registry `api/plugin-bindings.ts` is regenerated alongside
(`getRegisteredPluginBindingIntents()`) — review/discovery artifact listing
plugin, kind, binding, purpose, scope, deployment path, and resolved instance
name. `r2_buckets`-style core bindings stay untouched.

## 5. Install & uninstall integration

- **Install** (`scripts/install-plugins.mjs`): validates the plugin's binding
  intents right after migration validation — invalid intents fail the install
  with plugin-referenced errors *before* any build (config-level, never
  deploy-level). Legacy manifests install with a deprecation warning. After the
  registry rebuild, the installer runs the **binding pipeline with step
  detection** (provisions only what the ledger says is missing, re-verifies
  secret links, re-resolves `wrangler.jsonc`), then a **full consistency audit**
  over all moving parts (see below) and a dynamic manual-steps summary. The
  summary states **„All moving parts consistent — ready to deploy"** when
  converged, or lists each pending step with its exact fix command.
- **Uninstall** (`scripts/uninstall-plugin.mjs`): reports the plugin's ledger
  rows and points at `npm run bindings:provision -- --teardown <id>` for
  environment-scoped teardown.
- **Update** (`npm run update`): the plugin phase provisions against updated
  manifests and runs the same audit; the build & deploy phase runs the remote
  drift check before the wrangler prompt.

### Consistency audit (dynamic — runs in install, provision and update flows)

`auditBindingConsistency` (`scripts/lib/binding-consistency.mjs`) checks every
moving part against every other — pure, no API calls:

| Check | Detects | Fix (reported inline) |
|---|---|---|
| Manifest intents | invalid kinds/purposes/scopes, cross-plugin conflicts | fix the manifest (build aborts) |
| Provisioned instances | provisionable intent without a ledger row | `npm run bindings:provision` |
| Secrets Store links | intent without a resolvable store | `npm run setup` or declare `store_id` |
| Resource ledger | stale rows (renamed purpose, removed plugin), environment mismatch | `bindings:provision -- --teardown` / re-provision |
| Generated wrangler.jsonc | provisioned but not rebuilt, hand-edited entries | `npm run build` |
| (update flow) Remote drift | dashboard-side config changes vs generated config | review, then deploy converges |

The operator never needs to consult documentation: every non-converged state
prints the exact command that resolves it, and re-running any flow re-audits
automatically.

## 6. Cloud-token doctrine

- `CF_API_TOKEN` is a **deploy-operator credential** (env/`.env` locally, Worker
  secret in production) needing Queues/KV/Secrets Store edit scopes for the
  target account. It never reaches plugin code — the plugin declares intents;
  the binding is the permission+API.
- Least privilege per deployment; provisioning failures are pre-deploy config
  errors, not runtime incidents.

## 7. Deployment paths & vendor extensibility

| Concern | Today | Future |
|---|---|---|
| Manifest | `deployment_path: "cloudflare"` (default), intents under `wrangler_intents` | A new path (e.g. `aws`) extends `SUPPORTED_DEPLOYMENT_PATHS` in `scripts/lib/binding-intents.mjs` and adds per-path provisioners in `scripts/lib/binding-provisioner.mjs` |
| Provisioner | Cloudflare API v4 (`cfApi`, create-or-get) | One module per vendor system |
| Injection | wrangler.jsonc auto-generated section | Per-path config emitter |

The uniform intent schema (`{kind, binding, purpose, scope, config}`) is
deployment-path-agnostic; only the resolution target and provisioner are
vendor-specific. Future resource kinds per the plan: `d1`, `dns`/custom-domain,
`supabase-schema` (already migration-managed).

## 8. Implementation map

| Piece | File |
|---|---|
| Intent validation / normalization / resolution (pure) | `scripts/lib/binding-intents.mjs` |
| Wrangler.jsonc injection + mixed legacy merge | `scripts/lib/plugin-workspace.mjs` (`collectWranglerBindingsWithIntents`) |
| Cloudflare provisioners + ledger + teardown + remote drift diff (pure) | `scripts/lib/binding-provisioner.mjs` |
| Provision/teardown/drift CLI | `scripts/provision-bindings.mjs` (`npm run bindings:provision`, `npm run bindings:check`) |
| Install-time validation + provisioning with step detection | `scripts/install-plugins.mjs` |
| JSONC parsing (URL-safe comment stripping) | `scripts/lib/wrangler-config.mjs` (`parseJsoncConfig`) |
| Descriptive descriptor registry (generated) | `api/plugin-bindings.ts` |
| Type contract | `src/types/plugin.ts` (`PluginBindingIntents`, `PluginDeploymentPath`, …) |
| Tests | `tests/bindingIntents.test.mjs` (26 cases), `tests/bindingDrift.test.mjs` (7 cases) |

## 9. Migrating a legacy plugin to intents (recipe)

Legacy `wrangler_bindings` declarations keep working verbatim — migrate at your
own pace, but per-deployment instances (and the duplicate-consumer fix) only
apply to intent-declared bindings:

1. Add `"deployment_path": "cloudflare"` to `plugin.json` (optional — cloudflare
   is the default).
2. Convert each concrete entry to an intent — delete the instance name, add a
   `purpose`:
   - queues: `producers[].{queue, binding}` + matching `consumers[]` →
     `{binding, purpose, scope, consumer: {...}}` (drop the `queue` name).
   - kv_namespaces: `{binding, namespace_id}` → `{binding, purpose, scope}`
     (drop `namespace_id`).
   - secrets_store_secrets: `{binding, store_id, secret_name}` →
     `{binding, purpose, scope: "shared", secret_name}` — omit `store_id` to
     resolve the deployment's core store.
   - `vars`, `ai`, `durable_objects`: copy as-is into `wrangler_intents`.
3. Delete `wrangler_bindings`, run `npm run bindings:provision`, then
   `npm run build` — the generated section now references your plugin's
   per-environment instances.

Reference migration: PluraDash (`plugins/pluradash/plugin.json`, 2026-09-09) —
queue intent `sms-notifications`, shared secret link intents
`twilio-account-sid` / `twilio-auth-secret`. **The plugin-side change must be
documented in the plugin's own repository.**

## 10. Open items `OPEN`

1. Consumer registration conflicts across *deployments* (wrangler re-registering
   unchanged consumer settings) — verify exact Cloudflare error semantics;
   the resolved per-environment names make cross-environment collisions
   structurally impossible, but re-deploy idempotency of consumer settings
   should be verified live.
2. Multi-account deployments: resolve per account_id, not only worker name.
3. Ledger in core DB (platform truth) in addition to the git-ignored sidecar.
4. `d1` intents + plugin migrations against the provisioned database;
   `dns`/custom-domain intents.
5. Live round-trip: provision → build → deploy against a real account for kv ids
   and Secrets Store verification (API shapes verified by create-or-get with
   list-fallback, but not yet exercised against production Cloudflare).
