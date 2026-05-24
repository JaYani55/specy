# Multi-Tenancy Refactor Specification

## Purpose

This document describes the multi-tenancy refactor introduced for ServiceCMS as it transitions from a trusted internal backend into an open-source self-service console.

The goal of this change set is to move the platform toward a secure user-owned and tenant-aware data model where:

- content is no longer globally visible to authenticated users by default
- tenant boundaries are explicit and enforceable at the database layer
- delegated administration is limited to user content and tenant membership
- platform-critical configuration and secret management remain restricted to `super-admin`
- API and MCP route behavior aligns with database RLS instead of bypassing it through privileged service clients
- tenant assignment is visible and editable from the main content editors
- the console shows workspace ownership on the main content lists and schema detail views
- `super-admin` has an explicit tenant management interface for workspace creation and membership administration

This specification is deployment-oriented. It documents what was changed, why it was changed, how the authorization model now works, and what must be reviewed before running these migrations against production.

---

## Summary Of The New Model

### High-Level Authorization Model

The refactor uses two overlapping concepts:

1. Global roles

- Existing roles remain in `roles` and `user_roles`
- JWT custom claims continue to expose `user_roles`
- `super-admin` remains the global platform operator role
- `admin` is treated as a content administrator, not a platform operator

2. Tenant membership

- A new `tenants` table defines explicit workspaces/tenants
- A new `tenant_users` table maps users to tenants
- `tenant_users.is_tenant_admin` grants delegated administration within one tenant
- Tenant membership is separate from global roles and is used to determine which users and rows a tenant admin may manage

### Ownership Model

The target ownership model is hybrid in storage but user-centric in enforcement:

- `owner_user_id` identifies the primary row owner for mutable user content
- `tenant_id` identifies the tenant/workspace that row belongs to
- `admin` and tenant admins may manage rows owned by users they are allowed to administer
- `super-admin` retains global visibility and platform control

### Platform-Critical Surfaces

The following surfaces are explicitly treated as platform-level and remain `super-admin` only:

- `managed_secrets`
- `system_config`
- plugin registry writes and deletes
- revalidation secret backfill and platform-side schema registration secret operations
- media mount secret storage and other runtime connections configuration

---

## Why This Refactor Was Needed

Before this refactor, much of the system still reflected a low-trust internal business-backend model:

- several core tables had no RLS at all
- several protected tables allowed `authenticated` users to read all rows
- many policies depended only on global roles, not row ownership or tenant membership
- certain API routes used the Supabase admin client for content operations, bypassing RLS entirely
- configuration and secret storage relied too heavily on route-level role checks

That model is not acceptable for a self-service multi-tenant CMS where unrelated users must not see one another’s content.

---

## Migration Files Introduced

The following multi-tenancy migrations were added:

1. `migrations/202605240001_multi_tenant_foundation.sql`
2. `migrations/202605240002_multi_tenant_backfill_and_ownership.sql`
3. `migrations/202605240003_multi_tenant_rls_hardening.sql`
4. `migrations/202605240004_tenant_assignment_rls_fix.sql`
5. `migrations/202605240005_console_visibility_hardening.sql`

Manifest status:

- `scripts/lib/core-update.mjs` contains `001` through `005`
- `scripts/setup.mjs` now also contains `001` through `005`

This distinction matters operationally:

- update runs now apply the two follow-up fixes automatically
- fresh setup now applies the same tenancy follow-up fixes as updater-driven environments
- update and fresh setup are back in sync for the current tenancy migration set

---

## Migration 1: Tenant Foundation

File: `migrations/202605240001_multi_tenant_foundation.sql`

### New Tables

#### `public.tenants`

Introduces a first-class tenant/workspace record.

Fields:

- `id`
- `slug`
- `name`
- `created_by`
- `created_at`
- `updated_at`

Notes:

- `created_by` defaults to `public.current_user_id()`
- each tenant has a `set_current_timestamp_updated_at()` trigger
- tenant selection is restricted by RLS to members and `super-admin`

#### `public.tenant_users`

Maps users to tenants.

Fields:

- `tenant_id`
- `user_id`
- `is_tenant_admin`
- `status`
- `invited_by`
- `created_at`
- `updated_at`

Notes:

- membership states are `active`, `invited`, `suspended`
- tenant membership is what allows delegated tenant-level administration

### New Helper Functions

The foundation migration introduces reusable SQL helpers used by later policies:

- `public.current_user_id()`
- `public.current_user_roles()`
- `public.is_super_admin()`
- `public.is_content_admin()`
- `public.is_tenant_member(target_tenant_id, target_user_id)`
- `public.is_tenant_admin(target_tenant_id, target_user_id)`
- `public.can_administer_user_in_tenant(target_tenant_id, target_user_id)`

### Bootstrap Trigger

The trigger `create_default_tenant_membership_trigger` ensures that when a tenant is created with `created_by`, that user automatically becomes an active tenant admin in `tenant_users`.

### RLS Added

RLS is enabled on:

- `tenants`
- `tenant_users`

Policy behavior:

- tenant members may read their tenant
- authenticated users may create a tenant for themselves
- tenant admins may update tenant metadata
- only `super-admin` may delete tenants
- tenant membership rows are visible to the member, a tenant admin, or `super-admin`

---

## Migration 2: Backfill And Ownership

File: `migrations/202605240002_multi_tenant_backfill_and_ownership.sql`

### Purpose

This migration establishes ownership and tenant linkage across existing content and backfills a default tenant/workspace for existing users.

### New Helper Functions

- `public.default_tenant_for_user(target_user_id)`
- `public.current_tenant_id()`
- `public.ensure_default_tenant_for_user(target_user_id, target_username)`
- `public.create_default_tenant_for_profile()`

### Default Workspace Seeding

For every existing `user_profile` row, the migration ensures the existence of a default tenant using a deterministic slug:

- `workspace-<uuid_without_hyphens>`

That tenant is marked with:

- `created_by = user_id`
- `default_for_user_id = user_id`

New users inserted into `user_profile` automatically get a default tenant through the new profile trigger.

### New Ownership / Tenant Columns

The migration adds ownership metadata to the following tables:

#### Existing high-risk or legacy tables

- `companies.owner_user_id`
- `companies.tenant_id`
- `employers.owner_user_id`
- `employers.tenant_id`
- `mentor_groups.owner_user_id`
- `mentor_groups.tenant_id`
- `mentorbooking_events.owner_user_id`
- `mentorbooking_events.tenant_id`
- `mentorbooking_notifications.tenant_id`
- `mentorbooking_products.owner_user_id`
- `mentorbooking_products.tenant_id`
- `page_schema_templates.owner_user_id`
- `page_schema_templates.tenant_id`
- `page_schema_templates.visibility`

#### Additional core CMS tables added in the second pass

- `forms.tenant_id`
- `objects.owner_user_id`
- `objects.tenant_id`
- `pages.owner_user_id`
- `pages.tenant_id`
- `page_schemas.owner_user_id`
- `page_schemas.tenant_id`
- `llm_specs.tenant_id`
- `page_schema_specs.tenant_id`
- `staff.tenant_id`
- `staff_traits.tenant_id`
- `staff_trait_assignments.tenant_id`
- `managed_secrets.created_by`

### Constraints And Indexes Added

The migration adds foreign keys and indexes for the new ownership columns wherever appropriate.

Important examples:

- `owner_user_id` references `user_profile(user_id)`
- `tenant_id` references `tenants(id)`
- `default_for_user_id` references `user_profile(user_id)`
- a unique partial index on `tenants.default_for_user_id`

### Defaults Added

Defaults now resolve ownership and tenant automatically on insert for many tables, for example:

- `owner_user_id default public.current_user_id()`
- `tenant_id default public.current_tenant_id()`

### Backfill Rules

The migration uses conservative backfill logic:

#### Companies

Ownership is resolved from:

1. `companies.owner_user_id`
2. `companies.created_by`
3. `companies.custom_data.legacy_user_id` when that JSON value is a valid UUID

Tenant is derived from the resolved owner.

#### Employers

Ownership is resolved from:

1. `owner_user_id`
2. `user_id`
3. `created_by`

#### Mentor Groups

Ownership is resolved from:

1. `owner_user_id`
2. `created_by`

#### Events

Ownership and tenant are derived from the related company whenever possible.

#### Notifications

Tenant is derived from `user_id`.

#### Templates

Templates get a new `visibility` field:

- `private`
- `tenant`
- `system`

Rows with no owner and a `source_schema_id` are backfilled to `system`.

#### Forms

Tenant is derived from `forms.owner_user_id`.

#### LLM Specs

Tenant is derived from `llm_specs.created_by`.

#### Page Schema Spec Attachments

Tenant is derived from linked `page_schemas` and `llm_specs`.

#### Staff Tables

Tenant is derived from associated account users or creator fields where available.

### Important Safety Property

This backfill intentionally does not invent ownership when no credible source exists.

That means:

- some legacy rows may remain without a clear owner
- those rows will not silently be assigned to an unrelated user
- these rows should be reviewed after deployment if they are still operationally needed

This is safer than guessing ownership in a single production database.

---

## Migration 3: RLS Hardening

File: `migrations/202605240003_multi_tenant_rls_hardening.sql`

### Purpose

This migration replaces broad or missing policies with ownership-aware and tenant-aware policies.

### New Helper Function

- `public.can_access_owned_row(row_tenant_id, row_owner_user_id)`

This helper centralizes the common rule:

- `super-admin` and global content admins can administer content when allowed
- row owners can access their own content
- tenant admins can access content owned by members of their tenant

### Tables Hardened In The First Pass

- `companies`
- `employers`
- `mentor_groups`
- `mentorbooking_events`
- `mentorbooking_notifications`
- `mentorbooking_products`
- `page_schema_templates`
- `managed_secrets`
- plugin write/delete policies

### Tables Hardened In The Second Pass

- `forms`
- `forms_answers`
- `form_notification_settings`
- `form_notification_recipients`
- `objects`
- `pages`
- `page_schemas`
- `page_schema_specs`
- `llm_specs`
- `staff`
- `staff_traits`
- `staff_trait_assignments`
- `system_config`

### Public Read Behavior Preserved Where Necessary

The hardening pass does not remove all public behavior. Instead, it restricts public access to the intended published surfaces:

- published pages remain readable to `anon`
- published forms may remain reachable for public share/API use under the original conditions
- public objects remain readable when `status = published`, `api_enabled = true`, and `requires_auth = false`
- public schemas remain readable to `anon` only when they are system-owned and either default or registered
- public specs remain readable when published and `is_public = true`

### Platform-Only Tables

The following are locked to `super-admin` at the database layer:

- `managed_secrets`
- `system_config`
- plugin registry writes, updates, and deletes

This is a deliberate separation from tenant or content administration.

---

## Migration 4: Tenant Assignment RLS Fix

File: `migrations/202605240004_tenant_assignment_rls_fix.sql`

### Purpose

The original hardening pass still made tenant selection ineffective in some authenticated create flows because insert policies implicitly forced `current_tenant_id()`.

This follow-up migration fixes that mismatch so the tenant selected in the UI can actually be persisted when the user is a valid member of that tenant.

### Key Changes

- refines `public.can_administer_user_in_tenant(...)`
- adds `public.can_insert_owned_row(target_tenant_id, target_owner_user_id)`
- replaces insert policies that previously over-relied on `current_tenant_id()`

### Tables Updated

- `companies`
- `forms`
- `objects`
- `pages`
- `page_schemas`
- `llm_specs`
- `employers`
- `mentor_groups`
- `mentorbooking_events`
- `mentorbooking_notifications`
- `mentorbooking_products`
- `page_schema_templates`

### Operational Effect

- editor-side workspace selectors for forms, objects, pages, schemas, and MCP specs are now meaningful
- tenant members can create owned rows in another tenant they belong to without switching some hidden global tenant context first

---

## Migration 5: Console Visibility Hardening

File: `migrations/202605240005_console_visibility_hardening.sql`

### Purpose

The first RLS hardening pass still left several authenticated select policies too broad for console use, especially for published content that should remain public only through dedicated routes.

This migration narrows authenticated console reads so users no longer see other tenants' published content simply because they are logged in.

### Tables Updated

- `forms`
- `objects`
- `pages`
- `page_schemas`
- `llm_specs`
- `page_schema_specs`

### Operational Effect

- console visibility now follows tenant and ownership rules more strictly
- public/share/API access remains available through purpose-built public endpoints instead of through broad authenticated select policies

---

## Route-Level Changes

Database hardening alone is not sufficient when route handlers use a service client that bypasses RLS. The following route changes were therefore included.

### Objects API

File: `api/routes/objects.ts`

Changes:

- content CRUD now uses `createSupabaseClient(env, auth.token)` instead of `createSupabaseAdminClient`
- authenticated object listing now relies on RLS for visibility
- public object reads still use a non-authenticated client but are limited to public objects only
- object archive/delete behavior now respects RLS instead of forcing `super-admin` through the route layer alone

Effect:

- object reads and writes now honor tenant and owner boundaries

### Schemas API

File: `api/routes/schemas.ts`

Changes:

- schema template list/read/create/import now use user-scoped clients instead of the admin client
- schema read endpoints (`/api/schemas`, `/spec`, `/spec.txt`, `/pages`) now accept an optional bearer token and use it when present
- spec bundle resolution now passes the optional token through to `getSchemaSpecBundle`

Effect:

- authenticated callers can read tenant-scoped schemas and attachments
- anonymous callers remain limited to public/system schema surfaces
- template access is now controlled by RLS rather than the route ignoring policy decisions

### MCP Route

File: `api/routes/mcp.ts`

Changes:

- MCP schema and object discovery now uses an auth-aware user-scoped client
- `list_schemas`, `get_schema_spec`, `list_objects`, and `get_object` now honor the caller’s authenticated visibility
- public MCP callers remain limited to public objects and public schemas

Effect:

- MCP content discovery is now aligned with tenant-aware RLS

### Specs API

File: `api/routes/specs.ts`

Changes:

- MCP spec CRUD remains user-scoped through `createSupabaseClient(env, auth.token)`
- spec create and update now accept `tenant_id`
- authenticated spec reads and writes therefore align with the same tenant-aware ownership model as pages, objects, and forms

Effect:

- MCP specs can now be explicitly assigned to a workspace from the editor
- schema attachments and MCP discovery remain consistent with tenant-aware RLS

### Remaining Admin-Client Uses

After this refactor, remaining `createSupabaseAdminClient` uses in `schemas.ts` and `mcp.ts` are intentionally limited to platform or registration operations such as:

- completing schema registration
- migrating legacy revalidation secrets
- deleting or backfilling revalidation secrets
- worker-side secret storage operations

Those uses are expected and should remain privileged.

---

## Feature Impact By Area

### Events And Calendar

Affected tables:

- `mentorbooking_events`
- `mentorbooking_notifications`
- `mentorbooking_products`
- `mentor_groups`
- related staff tables

Impact:

- event data is no longer globally visible
- notifications are scoped by user and tenant
- products and groups are no longer globally shared across authenticated users

### Pages And Page Schemas

Affected tables:

- `pages`
- `page_schemas`
- `page_schema_templates`
- `page_schema_specs`
- `llm_specs`

Impact:

- page content is now ownable and tenant-scoped
- schema templates support explicit visibility
- public schema discovery remains possible for system/registered schemas
- schema/spec attachments now inherit tenant boundaries
- schema-driven page saves inherit the schema tenant automatically
- the pages dashboard and schema detail views now show workspace badges in the console

### Forms

Affected tables:

- `forms`
- `forms_answers`
- `form_notification_settings`
- `form_notification_recipients`

Impact:

- form definitions and answers are no longer globally readable to authenticated users
- public answer submission behavior remains available for forms configured for public use
- answer visibility is now limited to the submitter and authorized owners/admins
- the form editor now exposes tenant assignment
- the forms list now surfaces workspace ownership in the UI

### Objects

Affected tables:

- `objects`

Impact:

- object CRUD is now tenant-aware
- route-layer service-client bypass was removed
- public object access remains available only for explicitly public objects
- object routes in the frontend are accessible to `user`, not only `admin`
- the objects list now surfaces workspace ownership in the UI

### MCP Specs And Tool Exposure

Affected tables:

- `llm_specs`
- `page_schema_specs`

Impact:

- MCP specs can now be assigned to a tenant/workspace from the editor
- the MCP list shows workspace ownership in the console
- schema detail continues to expose attached MCP entries while respecting tenant-aware visibility

### Administration And Staff

Affected tables:

- `staff`
- `staff_traits`
- `staff_trait_assignments`

Impact:

- staff-related data is now tenant-aware
- tenant admins may manage staff rows within their tenant
- `super-admin` remains global
- super-admin now has an explicit tenant management surface in account administration
- tenant memberships are visible on account cards alongside global roles

### Connections And Platform Configuration

Affected tables:

- `managed_secrets`
- `system_config`
- plugin registry write policies

Impact:

- platform connections remain separate from tenant content administration
- `admin` no longer implies access to global secrets or runtime configuration
- database-level protection now exists in addition to route guards

---

## Key Operational Decisions

### `admin` Versus `super-admin`

The refactor keeps the distinction explicit:

#### `admin`

- may act as a content administrator
- may administer user content through the helper model
- must not automatically gain access to secrets, global runtime configuration, or other platform-critical surfaces

#### `super-admin`

- retains platform-wide control
- may access and mutate secrets and system configuration
- may perform system-level registration and backfill operations

### Templates Visibility Model

`page_schema_templates.visibility` introduces a three-state model:

- `private`: visible to the owner and authorized admins only
- `tenant`: visible to tenant members
- `system`: public/shared system template controlled by `super-admin`

This prevents accidental creation of a globally visible template library.

---

## Files Changed Outside The Migration Folder

### Migration Order Files

- `scripts/lib/core-update.mjs`
- `scripts/setup.mjs`

### Route Files

- `api/routes/objects.ts`
- `api/routes/schemas.ts`
- `api/routes/mcp.ts`
- `api/routes/specs.ts`

### Frontend And Shared Service Files

- `src/services/tenantService.ts`
- `src/pages/FormEditor.tsx`
- `src/pages/ObjectEditor.tsx`
- `src/pages/SchemaEditor.tsx`
- `src/pages/SpecEditor.tsx`
- `src/pages/Forms.tsx`
- `src/pages/Objects.tsx`
- `src/pages/Pages.tsx`
- `src/pages/PagesSchemaDetail.tsx`
- `src/pages/Specs.tsx`
- `src/pages/VerwaltungAccounts.tsx`
- `src/components/pagebuilder/SchemaPageBuilderForm.tsx`
- `src/App.tsx`
- `src/types/forms.ts`
- `src/types/objects.ts`
- `src/types/pagebuilder.ts`
- `src/types/specs.ts`

These changes are functionally part of the multi-tenancy rollout because they ensure the new RLS policies are actually respected at runtime.

---

## Validation Performed During Implementation

The following validation was performed during implementation:

### Static Validation

- focused file diagnostics reported no syntax errors in the modified SQL, JS, or TS files

### Lint Validation

Executed:

- `npm run lint -- api/routes/objects.ts api/routes/schemas.ts scripts/lib/core-update.mjs scripts/setup.mjs`
- `npm run lint -- api/routes/schemas.ts api/routes/mcp.ts`
- `npm run lint -- src/services/tenantService.ts src/types/specs.ts src/pages/SpecEditor.tsx src/pages/Forms.tsx src/pages/Objects.tsx src/pages/Specs.tsx src/pages/Pages.tsx src/pages/PagesSchemaDetail.tsx src/pages/VerwaltungAccounts.tsx api/routes/specs.ts`

Result:

- no errors
- one unrelated pre-existing warning in `src/components/ui/sidebar.tsx`

### What Was Not Validated Here

The migrations were not executed against a live or staging Supabase project from this environment.

That means the following still require careful production review:

- backfill row counts
- unresolved ownership on legacy rows
- policy interaction with existing data distribution
- effects on workflows that historically depended on global authenticated reads

---

## Production Deployment Guidance

Because there is only one production database, deployment should be treated as a controlled release rather than a casual migration run.

### Pre-Deployment Checklist

1. Review all five multi-tenancy migrations in full.
2. Confirm update environments will apply `004` and `005` through `scripts/lib/core-update.mjs`.
3. Confirm both `scripts/lib/core-update.mjs` and `scripts/setup.mjs` still include `004` and `005` before release.
4. Review the ownership backfill rules for legacy content.
5. Identify which tables may contain rows with no trustworthy owner signal.
6. Confirm operational owners for:
   - existing page schemas
   - existing pages
   - existing objects
   - existing MCP specs and schema attachments
   - existing templates
   - existing products and events
7. Confirm that platform secrets and runtime config should remain `super-admin` only.
8. Confirm that no external automation depends on the old globally readable authenticated behavior.
9. Verify the new tenant-management UI with a real `super-admin` account before handing the system to tenant operators.

### Recommended Deployment Order

1. Deploy the application code containing the route changes.
2. Apply the migrations in the declared order.
3. Immediately validate critical data access paths with real accounts.
4. Review unresolved or inaccessible legacy rows and repair ownership where necessary.
5. Verify tenant badges and tenant selectors in the console so UI behavior matches the new RLS behavior.

### Recommended Manual Verification Matrix

Test with at least these personas:

1. `super-admin`
2. global `admin`
3. tenant admin
4. regular tenant member
5. user from another tenant
6. anonymous caller

Verify the following surfaces:

- events and calendar
- products
- mentor groups
- forms and answers
- objects API
- page schemas
- page schema templates
- specs and schema attachments
- MCP discovery
- configuration and secrets administration

---

## Known Residual Risks

### 1. Legacy Rows Without A Trustworthy Owner

Rows without a reliable ownership signal may remain effectively inaccessible to normal users after deployment.

This is intentional from a security perspective, but it means some content may need manual repair.

### 2. Existing Frontend Flows That Assumed Global Reads

Some UI paths historically depended on broad authenticated reads. Database security is now tighter than before, which may expose latent assumptions in queries or screens that were not yet rewritten.

### 3. Anonymous Schema Registration Behavior Was Tightened Indirectly

The original system allowed very open `anon` behavior on `page_schemas`. The new model reduces exposure. Registration flows should be reviewed carefully to ensure system-owned public schemas still follow the intended onboarding path.

### 4. Admin-Only Versus Tenant-Admin Boundaries Must Be Verified In Real Data

The helper model is explicit, but real-world data may expose edge cases where tenant membership and ownership do not line up cleanly in legacy rows.

---

## Future Follow-Up Work

This refactor establishes the core multi-tenant security model, but it is not the end of the transition.

Recommended next steps:

1. Add operational SQL or admin UI tooling to report rows missing `owner_user_id` or `tenant_id`.
2. Add integration tests or scripted policy verification for each persona type.
3. Review remaining API routes for any other content-level admin client usage.
4. Keep `scripts/lib/core-update.mjs` and `scripts/setup.mjs` in sync whenever a new tenancy migration is added.
5. Document tenant bootstrap and tenant membership administration in user/operator-facing docs.
6. Consider introducing an explicit migration audit report after production rollout.

---

## Quick Reference

### New Core Tables

- `tenants`
- `tenant_users`

### New Core Migration Files

- `202605240001_multi_tenant_foundation.sql`
- `202605240002_multi_tenant_backfill_and_ownership.sql`
- `202605240003_multi_tenant_rls_hardening.sql`
- `202605240004_tenant_assignment_rls_fix.sql`
- `202605240005_console_visibility_hardening.sql`

### Platform-Only Tables After This Change

- `managed_secrets`
- `system_config`
- plugin write/delete operations

### Content Tables Now Tenant-Aware

- `companies`
- `forms`
- `objects`
- `pages`
- `page_schemas`
- `page_schema_specs`
- `llm_specs`
- `employers`
- `mentor_groups`
- `mentorbooking_events`
- `mentorbooking_notifications`
- `mentorbooking_products`
- `page_schema_templates`
- `staff`
- `staff_traits`
- `staff_trait_assignments`

---

## Final Note

This change set is intentionally conservative where ownership is ambiguous and intentionally strict where secrets or system configuration are concerned.

For a single production database, that is the correct bias: it is better to require targeted ownership repair after deployment than to silently leak data across tenants.