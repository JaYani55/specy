# Page domains (TLD registry)

## Purpose and ownership

The Pages feature groups page schemas by their registered frontend origin
(`page_schemas.frontend_url`) — a **TLD** (e.g. `https://www.example.com`). A TLD
is created the moment a frontend completes a schema registration: the registration
flow writes the origin into `page_schemas.frontend_url` and ensures a row in the
`public.page_domains` registry.

The registry gives each TLD two things the derived grouping alone could not
express:

1. **Tenant ownership** — `page_domains.tenant_id`. Super-admins (custom claim
   `user_roles`, checked as `public.is_super_admin()`) can move a TLD to a
   different tenant. This mirrors the PluraDash GitHub-Apps assignment model:
   the admin picks a workspace, and everything registered under the domain
   follows atomically.
2. **Arbitrary display name** — `page_domains.display_name`. Super-admins can
   rename a TLD for display purposes. This is **independent of the domain URL
   itself**: the URL is never rewritten and stays the default assigned name
   (an empty or null display name falls back to the domain host).

Tenant users and tenant admins cannot reassign or rename TLDs; they see the
display name and (via per-schema tenant labels) who owns the schemas.

## Registry row lifecycle

| Event | Behavior |
|---|---|
| **Frontend registration** (`POST /api/schemas/:slug/register`) | After the schema is marked `registered`, the API ensures a `page_domains` row for the origin. Ownership is only assigned when the row does not exist yet — re-registration never steals a TLD a super-admin has already assigned or renamed. |
| **Backfill** (`migrations/202610110001_page_domains.sql`) | Pre-existing domains are inserted with the first non-null `tenant_id` of their registered schemas (uuid has no `min()` aggregate); `display_name` stays null. |
| **Unhook** (`POST /api/schemas/:slug/unhook`) | The registry row is deliberately kept so ownership and display name survive a re-registration cycle. Rows with zero registered schemas remain visible to super-admins (`schema_count: 0`). |

## Tenant reassignment (super-admin)

`PATCH /api/schemas/admin/domains/:id` with `{ "tenant_id": "<uuid>" }` invokes
the `public.reassign_page_domain_tenant(p_domain_id, p_target_tenant_id)` RPC.
The RPC is `SECURITY DEFINER` with an in-function super-admin check on the
invoker JWT and performs one atomic transaction:

1. `page_schemas.tenant_id` for every schema whose `frontend_url` equals the
   domain origin.
2. `schema_frontend_targets.tenant_id` and `page_content_templates.tenant_id`
   for those schemas.
3. `pages.tenant_id` for schema-bound pages plus legacy domain-bound pages
   (`schema_id is null and domain_url = origin`).
4. `mentorbooking_products.tenant_id` and `mentorbooking_events.tenant_id` for
   aggregates whose tenant is trigger-locked to the owning page.
5. `companies.tenant_id` for every company assigned to a moved event — this
   must happen **before** the event move because
   `validate_event_company_tenant` requires the company to already sit in the
   target workspace. A company that is **also** referenced by events outside
   the moved set (events on another domain that stays behind, or events
   without a public page) blocks the whole move with an actionable error:
   those events (or their domain) must move first.
6. `page_domains.tenant_id` last.

### Ordering paradox and the event-link constraint trigger

The pages table carries two tenant guards that contradict each other during a
pure tenant move:

- `validate_event_page_link` (BEFORE trigger on `mentorbooking_events`) requires
  the page to already carry the target tenant.
- `enforce_event_page_link` (AFTER constraint trigger on `pages`) requires the
  event aggregate row to exist under the target tenant.

The RPC therefore disables `enforce_event_page_link` for the duration of the
move (with an existence check in `pg_trigger`). `ALTER TABLE … DISABLE TRIGGER`
is transactional in PostgreSQL: any failure rolls the whole move back **and**
re-enables the trigger automatically — no manual repair path exists.

### Failure semantics

The move is all-or-nothing. Trigger-locked aggregates that cannot follow abort
the entire reassignment with a PostgreSQL error, surfaced by the API as
`409 { "error": "Tenant reassignment failed: …" }`. Typical cases: an event
whose company stays in the old workspace, or a company whose events span
domains in both workspaces — the blocking entity must move first. There is no
partial move and no data loss on failure. Unassignment (`tenant_id: null`) is
rejected: a TLD always has exactly one owning tenant.

## Display naming (super-admin)

`PATCH /api/schemas/admin/domains/:id` with `{ "display_name": "…" }` sets the
arbitrary label (≤120 characters, enforced by `page_domains_display_name_length`
and by the API). `null` or an empty string clears the label. The domain URL is
never modified by this operation — it remains the canonical registration target
for health checks, revalidation and public delivery.

## Dashboard surface

On `/pages`, every TLD card shows:

- **Title** — `display_name` when set, otherwise the domain host.
- **Description** — always the raw domain URL (the default assigned name).
- Super-admin controls (visible only with the super-admin custom claim):
  - a **workspace select** on the card header that opens a **move dialog**
    (no browser `confirm`): it previews the migration scope — schemas, pages,
    events, products and the companies assigned to the moved events — and
    warns about companies that would block the move. The dialog stays open on
    failure and shows the database error inline so the operator can address
    the blocking aggregates and retry;
  - a **Rename** button opening a dialog for the display name, explaining that
    the domain URL stays unchanged;
  - a **Mixed ownership** warning badge (`Gemischte Zuordnung`) when the
    registered schemas on the domain do not all belong to the owning tenant —
    this can only occur for pre-backfill drift, not through the RPC.

## API surface

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/schemas/admin/domains` | super-admin | Registry rows with `tenant_id`, `display_name`, `schema_count`, `schema_tenant_ids`, `ownership_consistent`, and the migration-scope preview: `page_count`, `product_count`, `event_count`, `company_count`, `blocking_company_names` |
| PATCH | `/api/schemas/admin/domains/:id` | super-admin | `{ tenant_id? }` (cascading reassignment) and/or `{ display_name? }` |

Both endpoints require the `super-admin` role (custom claim). The reassignment
RPC is invoked with the **user's bearer token** (same pattern as the super-admin
log routes): the JWT claim must reach the database session so the in-function
`is_super_admin()` guard evaluates the caller's roles. Both are documented in
the dashboard API catalog (`src/lib/apiCatalog.ts`).

## RLS

`public.page_domains`:

- **select** — super-admin, or rows with `tenant_id is null`, or rows owned by a
  tenant the user is a member of (`public.is_tenant_member`). Tenant members
  need read access so the dashboard can render display names.
- **insert / update / delete** — super-admin only.

Writes from the registration flow and the admin routes use the service client
and are authorized by their own role checks (the reassignment RPC itself is
invoked with the user's bearer token — see below). Because the catalogue guard
triggers reject direct writes to event pages, the RPC enables the aggregate
escape hatches `specy.event_page_write` and `specy.product_schema_reassignment`
for its transaction (`set_config(…, true)` = local), exactly like the
event/product aggregate services do.

## Related documentation

- [Pages feature / PageBuilder](page-builder.md)
- [Frontend targets](frontend-targets.md)
- [PluraDash GitHub Apps assignment model](pluradash-github-app-integration.md)
- [Multi-tenancy & RLS](../platform/multi-tenancy.md)