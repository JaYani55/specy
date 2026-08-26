# Unified Secrets Storage — Cloudflare Secrets Store & Managed Secrets

> **Audience:** AI agents and developers who need to store or retrieve credentials
> (API keys, SMTP passwords, signing keys) inside Specy or from a plugin.
>
> **Related:** [`../platform/core-extension-audio-queues-secrets.md`](../platform/core-extension-audio-queues-secrets.md)
> §3 (plugin binding injection machinery) · [`../plugins/development.md`](../plugins/development.md)
> (manifest reference) · [`r2-file-storage.md`](r2-file-storage.md) (the HMAC key used
> for signed URLs is itself a Worker secret).

---

## 1. The Three Tiers

Specy separates secrets by *who owns them* and *how often they change*. All three tiers
keep plaintext values out of the repository and out of the dashboard:

| Tier | Stored where | Rotated via | Typical contents |
|---|---|---|---|
| 1. **Secrets Store bindings** | Cloudflare Secrets Store (per-account store) | Cloudflare dashboard / API | Platform credentials needed as Worker bindings |
| 2. **Worker secrets** | Cloudflare Workers runtime (`wrangler secret put`) | Wrangler CLI | Encryption keys, publishable keys, deploy tokens |
| 3. **Managed secrets** | `public.managed_secrets` table (AES-GCM encrypted) | Dashboard / API at runtime | Operator-configured third-party credentials (SMTP, S3, revalidation) |

Decision rule: if a value must be available as a **binding at deploy time**, tier 1;
if it is a **build/deploy-time platform key**, tier 2; if an **operator configures it
through the product while running**, tier 3.

---

## 2. Tier 1 — Cloudflare Secrets Store Bindings

### What it is

A Cloudflare account-level store whose secrets are exposed to the Worker as typed
bindings. The value lives only in Cloudflare's infrastructure — it never touches the
filesystem, the database, or git.

### Declaring and consuming a binding

Bindings are declared in `wrangler.jsonc` under `secrets_store_secrets`:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SS_SUPABASE_SECRET_KEY",   // Worker-side variable name (SS_ prefix by convention)
    "store_id": "<your-secrets-store-uuid>",
    "secret_name": "SUPABASE_SECRET_KEY"   // name inside the Secrets Store
  }
]
```

Retrieval inside Worker code is asynchronous and trivially simple:

```ts
const supabaseServiceKey = await env.SS_SUPABASE_SECRET_KEY.get();
```

That single `.get()` call is the whole retrieval story — no decryption, no network hop
to your own infrastructure, no caching layer required. The core uses exactly this to
construct the service-role Supabase client:

```ts
// api/lib/supabase.ts (pattern)
export async function createSupabaseAdminClient(env: Env) {
  const key = await env.SS_SUPABASE_SECRET_KEY.get();
  return createClient(env.SUPABASE_URL, key, { /* … */ });
}
```

### Retrieving existing secrets via Cloudflare

Secret values are write-only — after creation they can never be read back. What you
*can* retrieve is the inventory (names, versions, status) via the Cloudflare API:

```bash
# List secrets in a store (names + metadata, NOT values)
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/secrets_store/stores/{store_id}/secrets" \
  -H "Authorization: Bearer <CF_API_TOKEN>"
```

Or via the Cloudflare dashboard: **Manage Account → Secrets Store → your store**.
The binding ↔ secret mapping for the current deployment is always visible in the
generated `wrangler.jsonc`. Creating/updating store secrets is done in the dashboard
or via the same API's PUT endpoint.

### Plugin contributions

Plugins may need their own Secrets Store entries (e.g. an SMS provider credential).
They declare them in `plugin.json` — note that `secrets_store_secrets` is one of the
binding types plugins **are** allowed to declare:

```json
{
  "wrangler_bindings": {
    "secrets_store_secrets": [
      {
        "binding": "SS_EXAMPLE_SMS_API_KEY",
        "store_id": "<secrets-store-uuid>",
        "secret_name": "EXAMPLE_SMS_API_KEY"
      }
    ]
  }
}
```

`scripts/ensure-registry.mjs` injects these into the auto-generated
`PLUGIN BINDINGS` section of `wrangler.jsonc` on every predev/prebuild, deduplicating
by binding name across all plugins — a conflicting binding name fails the build
(`process.exit(1)`), so prefix bindings with your plugin slug.

Naming conventions:

- Binding: `SS_<LOGICAL_NAME>` (e.g. `SS_MAIL_SMTP_PASSWORD`)
- Secret in store: the bare logical name (e.g. `MAIL_SMTP_PASSWORD`)
- Never edit the generated section manually; edit the source declaration instead.

---

## 3. Tier 2 — Worker Secrets (CLI)

Deploy-time keys that don't fit the Secrets Store model (they're per-Worker, not
per-account) are set via Wrangler:

```bash
npx wrangler secret put SECRETS_ENCRYPTION_KEY
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put CF_API_TOKEN
```

For local development mirror them in `.dev.vars` (gitignored). These appear in code as
plain `env.*` properties — synchronous access, unlike tier 1.

Two of these are security-critical for everything below:

- **`SECRETS_ENCRYPTION_KEY`** — root key for managed-secret encryption (tier 3) *and*
  HMAC signing of media delivery URLs. Losing it means losing every managed secret.
- **`SUPABASE_PUBLISHABLE_KEY`** — public anon key; safe-ish by design, kept as a
  secret so environments stay swappable.

---

## 4. Tier 3 — Managed Secrets (runtime, database-backed)

When an operator enters a credential through the product at runtime (SMTP password,
extra S3 source key, per-schema revalidation secret), it is stored **encrypted in the
`managed_secrets` table** — not in Cloudflare, because it must be creatable without a
deploy.

### Storage format

Implementation: [api/lib/managedSecrets.ts](../../api/lib/managedSecrets.ts)

- Algorithm: **AES-GCM** with a 12-byte random IV.
- Key: SHA-256 hash of `SECRETS_ENCRYPTION_KEY` (tier 2) imported as an AES-GCM
  `CryptoKey`.
- Payload stored in `managed_secrets.encrypted_value` as `base64(iv).base64(ciphertext)`.
- Row shape: `name` (unique), `namespace` (grouping), `encrypted_value`,
  `metadata` JSONB (non-sensitive details, e.g. SMTP host/port).

### Name registry (do not invent new formats ad hoc)

| Namespace | Name builder | Example |
|---|---|---|
| `page-revalidation` | `REVALIDATION_<SCHEMA_ID_UPPERCASED>` | `REVALIDATION_BLOG` |
| `mail` | `MAIL_SMTP_PASSWORD`, `MAIL_RESEND_API_KEY` | fixed names |
| `s3-sources` | `S3_SECRET_KEY_<SOURCE_ID_UPPERCASED>` | `S3_SECRET_KEY_AWS_PHOTOS` |

### Programmatic retrieval

```ts
import { getManagedSecretValue, getManagedSecretMetadata } from '../lib/managedSecrets';

// decrypt + return the secret (null if unknown)
const smtpPassword = await getManagedSecretValue(env, 'MAIL_SMTP_PASSWORD');

// metadata is non-sensitive and safe to display
const meta = await getManagedSecretMetadata(env, 'MAIL_SMTP_PASSWORD');
```

Writing/updating and deletion:

```ts
import { upsertManagedSecret, deleteManagedSecret,
         getMailSecretNamespace } from '../lib/managedSecrets';

await upsertManagedSecret(env, {
  name: 'MAIL_SMTP_PASSWORD',
  namespace: getMailSecretNamespace(),   // always use the namespace helpers
  value: plaintextFromOperatorInput,
  metadata: { host: smtpHost, port: smtpPort },  // non-sensitive fields only!
});

await deleteManagedSecret(env, 'MAIL_SMTP_PASSWORD');
```

Rules for tier 3:

1. Always go through the helper functions — they enforce encryption, upsert semantics,
   and error handling. Never SELECT `encrypted_value` yourself.
2. Keep sensitive values **only** in `value`; put displayable configuration into
   `metadata`.
3. Use the existing namespace/name builders; add a new builder function to
   `managedSecrets.ts` if you introduce a new secret kind.
4. These helpers use the admin client internally — call them only from trusted backend
   contexts (API routes after auth, hooks, queue consumers), never from user-supplied
   data paths without authorization checks.

---

## 5. What NOT to do

- ❌ Commit secrets to git — including "temporary" `.env` files; `.dev.vars` is gitignored, keep it that way.
- ❌ Put secrets in `vars` in `wrangler.jsonc` — that block is for non-sensitive settings only.
- ❌ Log decrypted values or return them from API responses (metadata endpoints expose metadata, never values).
- ❌ Re-implement encryption in plugin code — reuse the tier-3 helpers or declare a tier-1 binding.
- ❌ Hardcode secret names as string literals across files — import the builder functions so renames stay safe.

---

## 6. Quick Reference

| I need… | Do this |
|---|---|
| A platform credential available at boot | Secrets Store entry + `secrets_store_secrets` binding → `await env.SS_X.get()` |
| An encryption/signing key for the Worker | `npx wrangler secret put …` (tier 2) |
| To let an operator save a third-party credential at runtime | `upsertManagedSecret()` (tier 3) |
| To read an operator-managed credential in a route/consumer | `getManagedSecretValue(env, name)` |
| To check what exists in the Secrets Store | Cloudflare API (`/secrets_store/stores/{id}/secrets`) or dashboard — names only, values are write-only |
| To see which bindings the deployment has | Read `wrangler.jsonc` (generated — includes plugin injections) |
