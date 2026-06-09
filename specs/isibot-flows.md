# Isibot Flows (PluraDash)

The Isibot Flow Builder is a PluraDash feature that constructs the per-tenant
flow document consumed by the **isibot-fon** Cloudflare Worker. The worker
is a separate codebase that runs the Twilio TwiML state machine; this spec
documents the **PluraDash side**: how the document is authored, persisted,
and mirrored to Cloudflare KV.

---

## 1. Source of truth

`pluradash.isibot_flows` is the authoritative store. Each row holds one
flow for one tenant. Columns:

| Column            | Type           | Notes                                                            |
| ----------------- | -------------- | ---------------------------------------------------------------- |
| `id`              | `UUID` PK      | Server-generated.                                                |
| `tenant_id`       | `UUID` FK      | References `public.tenants(id)`; `ON DELETE CASCADE`.            |
| `slug`            | `TEXT`         | Defaults to `default`; unique per `(tenant_id, slug)`.           |
| `name`            | `TEXT`         | Operator-facing display name.                                    |
| `business_name`   | `TEXT`         | TTS-friendly name spoken in greetings.                            |
| `config`          | `JSONB`        | `language`, `voice`, `timezone`, `max_concurrent_calls`.         |
| `business_hours`  | `JSONB`        | 7-day map; each day is `{ open, close }` or `null` (closed).     |
| `flow`            | `JSONB`        | Map of `nodeId → IsibotFlowNode`.                                |
| `entry_node_id`   | `TEXT`         | Key into `flow`; first node rendered on incoming calls.          |
| `status`          | `TEXT`         | `published` or `archived` (CHECK constraint).                    |
| `api_enabled`     | `BOOLEAN`      | Reserved for future agent-read access; defaults to `true`.       |
| `created_by`      | `UUID` FK      | `user_profile.user_id`; `ON DELETE SET NULL`.                    |
| `created_at`      | `TIMESTAMPTZ`  |                                                                  |
| `updated_at`      | `TIMESTAMPTZ`  | Maintained by `public.set_current_timestamp_updated_at()`.       |

RLS:

- `SELECT` — `is_super_admin()` OR `is_tenant_member(tenant_id, current_user_id())`
- `INSERT/UPDATE/DELETE` — `is_super_admin()` OR `is_tenant_admin(tenant_id, current_user_id())`

The `migrations/004_create_isibot_flows.sql` file is the canonical definition.
It is idempotent: every `CREATE` / `DROP POLICY` is guarded with `IF NOT
EXISTS` / `IF EXISTS`, so re-running the migration is safe.

---

## 2. KV mirror

The document serialized to the row is also written to a Cloudflare KV
namespace. **The KV is best-effort**: every mutating API call writes the
Supabase row first, then attempts the KV put. A KV failure does not fail
the request; the API returns `kv_sync: { ok: false, error }` so the
operator can see the mirror is stale and trigger a re-sync.

### Layout

| KV namespace    | Bound as           | Owner                 |
| --------------- | ------------------ | --------------------- |
| `isibot-flows`  | `ISIBOT_FLOWS_KV`  | PluraDash worker      |

Key layout — one key per tenant, holding the full document as JSON:

```text
isibot/{tenantId}
```

Value — JSON-serialized `IsibotFlowDocument` (same shape the worker reads
in `specs/isibot-fon.md`):

```json
{
  "tenant_id": "cust_pluracon_0815",
  "business_name": "Tierarztpraxis Dr. Bäumer",
  "config": {
    "language": "de-DE",
    "voice": "Polly.Marlene",
    "timezone": "Europe/Berlin",
    "max_concurrent_calls": 3
  },
  "business_hours": {
    "monday":    { "open": "08:00", "close": "18:00" },
    "tuesday":   { "open": "08:00", "close": "18:00" },
    "wednesday": { "open": "08:00", "close": "13:00" },
    "thursday":  { "open": "08:00", "close": "18:00" },
    "friday":    { "open": "08:00", "close": "16:00" },
    "saturday":  null,
    "sunday":    null
  },
  "flow": {
    "welcome_open":    { "type": "pluradash.isibot.dial",   "...": "..." },
    "welcome_closed":  { "type": "pluradash.isibot.gather", "...": "..." },
    "record_anliegen": { "type": "pluradash.isibot.record", "...": "..." },
    "final_goodbye":   { "type": "pluradash.isibot.hangup", "...": "..." }
  },
  "entry_node_id": "welcome_open"
}
```

Metadata stored alongside the value:

```text
{ "syncedAt": "<ISO-8601 timestamp>", "schemaVersion": "v1" }
```

### Read-after-write caveat

Cloudflare KV is **eventually consistent**. A worker that reads the same
key immediately after a `put()` may see stale data for up to ~60 seconds
in distant edge locations. The isibot-fon worker should treat the KV
read as a hint and re-fetch if the document shape looks wrong. If
synchronous read-after-write becomes a hard requirement, migrate to
Workers Durable Objects or D1 in a follow-up.

### API contract

| Method | Path                                              | Notes                                          |
| ------ | ------------------------------------------------- | ---------------------------------------------- |
| `GET`  | `/api/plugin/pluradash/isibot/flows`              | List non-archived flows for the resolved tenant. |
| `GET`  | `/api/plugin/pluradash/isibot/flows/:id`          | One flow row.                                  |
| `POST` | `/api/plugin/pluradash/isibot/flows`              | Upsert by `(tenant_id, slug)`. Returns `kv_sync`. |
| `POST` | `/api/plugin/pluradash/isibot/flows/default`      | Returns a default-empty document for the UI.   |
| `POST` | `/api/plugin/pluradash/isibot/flows/:id/sync`     | Re-mirror the existing row to KV.              |
| `GET`  | `/api/plugin/pluradash/isibot/flows/:id/kv-sync`  | Read-only KV presence flag.                    |
| `DELETE` | `/api/plugin/pluradash/isibot/flows/:id`        | Archive the row and remove the KV key.         |

Auth: support OR super-admin (mirrors the rest of PluraDash).

---

## 3. Node-type system

The isibot flow document stores a `flow` object whose values are a
discriminated union of node types. The four canonical types are owned
by the PluraDash plugin and contributed to the core via the new
`isibot.flow.types` hook target:

| Type id                          | Label                  | Icon          | Color     |
| -------------------------------- | ---------------------- | ------------- | --------- |
| `pluradash.isibot.gather`        | Telefonmenü (Gather)   | `Keyboard`    | `#0ea5e9` |
| `pluradash.isibot.record`        | Sprachaufnahme (Record)| `Mic`         | `#f97316` |
| `pluradash.isibot.dial`          | Durchstellen (Dial)    | `PhoneCall`   | `#22c55e` |
| `pluradash.isibot.hangup`        | Auflegen (Hangup)      | `PhoneOff`    | `#64748b` |

Each descriptor carries `defaultFields`, a `schemaSummary`, and a
`description`. The descriptors live in
`plugins/pluradash/src/types/isibotDescriptors.ts`. Adding a new type
is a plugin-local change — no core modifications required.

The full Zod schemas live in `plugins/pluradash/src/types/isibot.ts` and
are consumed by both the API (validation) and the React UI (form
defaults). The Zod-derived TypeScript types are the authoritative shape
for code that touches the document.

---

## 4. Setup & provisioning

The KV namespace is **not** declared in `wrangler.default.jsonc` (the
committed template is intentionally binding-free). The setup wizard
provisions it on first run:

1. `npm run setup` → "Step 7b — Isibot Flow Builder KV".
2. The wizard runs `npx wrangler kv namespace create ISIBOT_FLOWS --remote`
   and parses the returned namespace id. On conflict, it falls back to
   `wrangler kv namespace list` and lets the user pick.
3. The wizard patches the **generated** `wrangler.jsonc` with:
   ```jsonc
   "kv_namespaces": [
     { "binding": "ISIBOT_FLOWS_KV", "id": "<namespace_id>" }
   ]
   ```
4. The KV step is **skipped entirely** when `plugins/pluradash/` is not
   present (CMS-only installs).

After setup, the binding is active for `wrangler dev` and `wrangler deploy`.

---

## 5. Operational notes

- **Backup**: re-running the wizard is safe — the patch helper no-ops if
  the binding is already present.
- **Migration**: `004_create_isibot_flows.sql` is the canonical schema.
  Re-running is safe (all statements are idempotent).
- **Manual re-sync**: `POST /api/plugin/pluradash/isibot/flows/:id/sync`
  or the "Jetzt synchronisieren" button in the UI replays the row to KV.
- **Rolling back**: `migrations/down/004_create_isibot_flows.sql` drops
  the table and policies.

---

## 6. Future iterations

- Multi-flow per tenant (relax `UNIQUE(tenant_id)` → `UNIQUE(tenant_id, slug)`;
  the migration already includes the slug column, so this is a non-breaking
  change once the worker supports multiple keys per tenant).
- Strongly-typed phone number format (`+E164`) via `libphonenumber-js`.
- Inline TTS preview in the builder (uses the same voice/SSML the
  Twilio call would render).
- Real node-graph view (canvas) for power users; v1 ships the form-based
  builder because it produces the same KV output.
- Encryption-at-rest of PII (phone numbers, greetings) via Workers
  Secrets Store.
