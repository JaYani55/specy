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
the `public.reassign_page_domains_tenant(p_domain_ids uuid[], p_target_tenant_id uuid)`
RPC. The RPC is `SECURITY DEFINER` with an in-function super-admin check on the
invoker JWT and performs one atomic transaction over the **union of the selected
domains** — the PATCH accepts `additional_domain_ids` so shared aggregates
(products, companies, events spanning domains) move together in the same
transaction instead of blocking:

1. `page_schemas.tenant_id` for every schema whose `frontend_url` equals one of
   the selected domain origins.
2. `schema_frontend_targets.tenant_id` and `page_content_templates.tenant_id`
   for those schemas.
3. `pages.tenant_id` for schema-bound pages plus legacy domain-bound pages.
4. `mentorbooking_products.tenant_id` — every product with a canonical page on
   the selected domains **plus every product the moved events reference**, even
   when it has no canonical page (the event trigger
   `validate_event_product_tenant` requires the referenced product to sit in
   the event's workspace).
5. `companies.tenant_id` for every company assigned to a moved event — before
   the event move, because `validate_event_company_tenant` requires the company
   to already sit in the target workspace.
6. `mentorbooking_events.tenant_id` — page-bound events of the selected domains
   **plus legacy pageless events** (no public page) that reference moved
   companies/products: their page-tenant validation returns early for null
   pages, so they follow their aggregates safely.
7. `page_domains.tenant_id` last, for every selected registry row.

Updates filter `tenant_id is distinct from p_target_tenant_id`, so no-op rows
never fire triggers — already-migrated domains can safely be part of the
selection.

### Pre-checks: when the move still blocks

The pre-checks only block on entities that genuinely cannot follow:

- a **company** also referenced by events whose **page** sits on a domain
  outside the selection (include that domain, or move it first);
- a **product** whose canonical page lives outside the selection (its
  `validate_service_product_page_owner` trigger requires page and product to
  share a workspace — include that domain, or move it first);
- a **product** also referenced by events whose page sits outside the
  selection;
- a pageless event referencing a moved company/product whose *other* linked
  entity is not moving.

The dashboard move dialog offers the linked domains as pre-checked checkboxes
(`suggested_move_domain_urls`), so "taking the product along" is one click:
the dialog folds them into `additional_domain_ids` and the union move resolves
the block atomically. Unchecking them leaves the block in place, with the
database error shown inline.

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
`409 { "error": "Tenant reassignment failed: …" }`. Pre-checks catch the
typical cases before anything is written: an event whose company/product
stays behind, a company/product whose events span domains in both workspaces,
a product whose canonical page lives on another domain. The dialog resolves
most of these by offering the linked domain(s) for inclusion. There is no
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
| GET | `/api/schemas/admin/domains` | super-admin | Registry rows with `tenant_id`, `display_name`, `schema_count`, `schema_tenant_ids`, `ownership_consistent`, and the migration-scope preview: `page_count`, `product_count`, `event_count`, `company_count`, `blocking_company_names`, `blocking_product_names`, `suggested_move_domain_urls` |
| PATCH | `/api/schemas/admin/domains/:id` | super-admin | `{ tenant_id?, additional_domain_ids?, display_name? }` — the union of the selected domains moves in one atomic transaction |

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

## Deleting unused schemas (super-admin)

Schemas that ended up connected to no domain (or are otherwise unused) can be
**permanently deleted** through `DELETE /api/schemas/:slug` — super-admin only,
matching the `page_schemas` delete RLS. The schema console
(`/pages/schema/...`) shows a destructive **Schema löschen** action for
super-admins, disabled while pages are attached.

Guards:

- **Default schemas cannot be deleted** — they form the always-available
  onboarding set.
- **Schemas with pages cannot be deleted** — the FK would silently detach the
  pages from their content contract. Delete the pages first (deleting a
  product/event page removes its aggregate with it, see the schema console's
  page-delete flow).

On success the managed revalidation secret is removed; frontend targets,
schema specs and content templates cascade; `page_schema_templates` and
`agent_logs` references are set null. The `page_domains` registry row is
**kept** — consistent with unhook — so a later registration on the same
origin preserves ownership and display name.

This is the escape hatch for the domain-move pre-checks: a product whose
page lives on a domain-less schema is unblocked by deleting that page/product
and then the unused schema, after which the move succeeds.

## Related documentation

- [Pages feature / PageBuilder](page-builder.md)
- [Frontend targets](frontend-targets.md)
- [PluraDash GitHub Apps assignment model](pluradash-github-app-integration.md)
- [Multi-tenancy & RLS](../platform/multi-tenancy.md)