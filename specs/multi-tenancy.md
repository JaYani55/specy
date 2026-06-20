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

3. Tenant-scoped managed storage

- managed file/media storage is tracked in core tenant-scoped tables rather than inferred from bucket listing
- storage entitlement is resolved separately from package presence through backend hook targets
- plugins may contribute storage policy rules without taking ownership of the core storage schema

### Current File Architecture

The current file architecture is intentionally split between core tenancy tracking and provider-specific delivery:

- file metadata is tracked in `tenant_storage_allocations` and `tenant_storage_objects`
- managed R2-backed tenant storage uses `tenant_storage_objects` as the source of truth for archive visibility, usage counters, and scoped deletes
- PluraDash currently provides the proprietary tenant file archive UI, archive downloads, and managed support storage workflow on top of the core tables
- form file uploads may target different storage mounts, but only the managed R2 / PluraDash paths are currently modeled as tenant-scoped archive objects in core
- self-hosted operators may still register their own storage mounts, including Supabase, R2, or S3-compatible mounts, through the Connections/runtime configuration surfaces

Current practical behavior:

- support-oriented managed storage is implemented through PluraDash plugin hooks and Cloudflare R2
- file archive listing, usage summaries, and file type stats are derived from tracked tenant objects rather than raw bucket enumeration
- core storage tables remain open to hook-based policy contributions so proprietary and self-hosted storage models can coexist without changing the schema contract

### Planned File Architecture

The storage model is planned to tighten into a harder tenant boundary with a clearer product split between core and proprietary managed storage:

1. Hard multi-tenancy

- tenants are organizations that may contain one or more users
- tenant boundaries are expected to become hard isolation boundaries across storage, content, and admin surfaces
- `super-admin` is planned to lose cross-tenant content visibility and should no longer be able to browse other tenants' files by default

2. Managed storage product split

- the `support` role is planned to receive managed R2 storage only
- that managed storage is planned to be exposed only through PluraDash as a proprietary Pluracon plugin
- users without the `support` role are planned to receive no managed file storage out of the gate
- non-support tenants may still register and operate their own storage mounts if they have an `admin` user able to configure runtime connections

3. Core deployment posture

- core functionality is meant to stay viable for single-tenant self-hosting
- self-hosted tenants should be able to operate without PluraDash by wiring their own storage mounts
- managed multi-tenant file operations should remain hook-driven so the open-source core does not hardcode proprietary storage behavior

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
6. `migrations/202605250001_tenant_storage_management.sql`
7. `migrations/202606200001_page_schema_visibility_fix.sql` _(follow-up to `005` — restores visibility of system-owned `page_schemas` rows to all authenticated users, see [Migration 7](#migration-7-page-schema-visibility-fix))_

Manifest status:

- `scripts/lib/core-update.mjs` contains `001` through `005` plus `202605250001_tenant_storage_management.sql` and `202606200001_page_schema_visibility_fix.sql`
- `scripts/setup.mjs` now also contains `001` through `005` plus `202605250001_tenant_storage_management.sql` and `202606200001_page_schema_visibility_fix.sql`

This distinction matters operationally:

- update runs now apply the two follow-up fixes automatically
- fresh setup now applies the same tenancy follow-up fixes as updater-driven environments
- update and fresh setup are back in sync for the current tenancy migration set, including managed storage

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

## Migration 6: Tenant Storage Management

File: `migrations/202605250001_tenant_storage_management.sql`

### Purpose

This migration introduces an authoritative tenant-scoped storage ledger for managed files and media.

The key design decision is:

- bucket contents are not the source of truth for quota, access, or visibility
- the database is the source of truth
- object delivery and quota enforcement must therefore align with tenant-aware RLS and user ownership

### New Tables

#### `public.tenant_storage_allocations`

Tracks provisioned storage allocations per tenant and per user.

Fields:

- `tenant_id`
- `user_id`
- `quota_bytes`
- `used_bytes_cached`
- `status`
- `provisioned_by`
- `provisioned_at`
- `created_at`
- `updated_at`

Operational meaning:

- one row represents the storage allocation for one user inside one tenant
- `quota_bytes` is the effective managed quota unless hook logic declares the user unlimited
- `used_bytes_cached` is maintained automatically from object inserts, updates, and deletes

#### `public.tenant_storage_objects`

Tracks every managed object stored under tenant-scoped storage.

Fields:

- `id`
- `tenant_id`
- `user_id`
- `scope`
- `source_mount_id`
- `folder_path`
- `object_key`
- `filename`
- `content_type`
- `size_bytes`
- `metadata`
- `created_by`
- `created_at`
- `updated_at`

Important semantics:

- `scope` is currently constrained to `media` and `files`
- `object_key` is globally unique and is the storage-key reference into the underlying bucket
- `source_mount_id` allows the object ledger to remain independent of one hardcoded storage provider label
- when Cloudflare R2 is used without `R2_PUBLIC_URL`, ServiceCMS may issue signed Worker URLs only for objects tracked with `scope = 'media'`
- signed media delivery is object-specific and does not make the underlying tenant bucket or non-media scopes publicly readable

### Usage-Sync Function And Triggers

The migration adds:

- `public.sync_tenant_storage_allocation_usage()`
- updated-at triggers for allocations and objects
- an insert/update/delete trigger on `tenant_storage_objects` that keeps `tenant_storage_allocations.used_bytes_cached` synchronized

This is the mechanism that makes cached quota enforcement viable without trusting raw bucket scans.

### RLS Added

RLS is enabled on:

- `tenant_storage_allocations`
- `tenant_storage_objects`

Policy behavior:

- a user may read their own allocation when they are also a member of that tenant
- tenant admins may manage allocations inside their tenant
- users may insert and delete their own objects inside their tenant
- tenant admins may update storage objects for members of their tenant
- `super-admin` retains global visibility and control

### Media Delivery Boundary

Managed tenant storage is not equivalent to a public CDN bucket.

- `scope = 'media'` objects may be exposed through signed Worker URLs so CMS pages and previews can render R2-backed images without a browser bearer token.
- those signed URLs are generated per object key and validated by the Worker before reading the R2 object.
- `scope = 'files'` and any other non-media tenant content remain private and are not made public by the media delivery path.
- configuring `R2_PUBLIC_URL` bypasses the Worker signer and should only be used when the underlying asset domain is intentionally public.

### Architectural Boundary

This migration is intentionally core, not plugin-owned.

That means:

- managed storage tables are part of the platform tenancy model
- plugins may add entitlement and source-filtering logic through backend hooks
- plugins should not own the base storage ledger schema just because one plugin consumes it first

---

## Migration 7: Page Schema Visibility Fix

File: `migrations/202606200001_page_schema_visibility_fix.sql`

### Purpose

This migration is a targeted follow-up to Migration 5. It restores visibility of system-owned `page_schemas` rows to all authenticated users after a regression introduced by hardening.

### Problem

Migration 5 replaced `authenticated_select_page_schemas` with:

```sql
using (
  (owner_user_id is null and public.is_super_admin())
  or public.can_access_owned_row(tenant_id, owner_user_id)
);
```

The intent was to tighten access. The side effect was that the system-seeded default schemas (`service-product`, `blog`, etc. with `owner_user_id IS NULL`) only became visible when `public.is_super_admin()` returned true.

This combined with the auth-gated route rendering change in `App.tsx` (documented in [`Architecture.md`](Architecture.md) and `specs/changes/2026-06-20-page-schema-visibility-fix.md`) to produce a console regression:

- non-super-admin users resolve zero rows from `getSchemas()`
- the empty-state handler in `src/pages/Pages.tsx` interprets that as "no frontends connected yet" and renders the tutorial introduction
- the underlying data is fine, so the issue is invisible until somebody opens Supabase directly

### Key Changes

- `authenticated_select_page_schemas` is rewritten so that rows with `owner_user_id IS NULL` are visible to every authenticated user, restoring the pre-Migration-5 behavior for system-owned schemas
- `authenticated_select_page_schema_specs` is updated symmetrically so the spec endpoint chain remains reachable for non-super-admin viewers when the linked schema is system-owned
- mutating policies introduced in Migration 4 remain unchanged — inserting a row with `owner_user_id IS NULL` still requires `super-admin`

### Operational Effect

- the Pages console once again shows the populated dashboard for authenticated users
- super-admin visibility is preserved
- tenant-owned schema visibility is preserved
- the only effective change is that system-owned schemas are now visible to all authenticated users, matching the original "default schemas are global resources" model

### Why Not Edit Migration 5 In Place

Existing migration files must not be edited once shipped — re-running a migration must produce the same final schema state on every deployment. The fix is therefore delivered as a new migration that drops and re-creates the affected policies.

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

### Media API And Tenant Storage

Files: `api/routes/media.ts`, `api/lib/tenantStorageMgt.ts`, `api/lib/tenantStorageHooks.ts`

Changes:

- R2-backed managed uploads now go through `tenantStorageMgt` instead of raw bucket traversal
- object visibility is resolved from `tenant_storage_objects`, not from global bucket listing
- quota is enforced against `tenant_storage_allocations`
- anonymous reads of managed objects are blocked even if the raw key is known
- the core service exposes backend hook targets so plugin-specific storage policy stays outside core business logic

Current hook targets:

- `storage.tenant.policy`
- `storage.tenant.sources`

Effect:

- tenant storage now follows the same ownership and membership model as other content surfaces
- managed R2 objects are no longer implicitly public because a bucket key exists
- core storage remains plugin-neutral while entitlement remains extensible

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

### Managed Storage And Media

Affected tables and surfaces:

- `tenant_storage_allocations`
- `tenant_storage_objects`
- `api/routes/media.ts`
- `api/lib/tenantStorageMgt.ts`
- `api/lib/tenantStorageHooks.ts`

Impact:

- managed storage is now tenant-aware and user-scoped at the database layer
- media visibility no longer depends on raw object listing from the bound R2 bucket
- quota is tracked from the database ledger instead of inferred from provider-side listing
- support-style or paid addon storage entitlements can be layered in through plugin hooks instead of hardcoding plugin business logic into core
- scoped object keys follow the tenant/user ownership model rather than arbitrary caller-provided paths

### Plugins And Webapps

Affected tables and surfaces:

- `plugins`
- plugin registry UI
- plugin install/update scripts
- external webapps stored as `kind = 'webapp'`
- build-time addons stored as `kind = 'plugin'`

Current status:

- plugin registry writes are still platform-level
- plugin and webapp tenancy is documented here as the target model, but is not fully implemented yet
- plugin-specific storage entitlements now use backend hook targets so package presence and storage entitlement remain separate concerns

Target model:

- simple webapp links should use normal tenant association
- registered webapps should be stored and managed per tenant instead of as one globally shared registration
- build-time plugins remain globally present in the deployed repo once installed, so installation is still a platform action
- authorization for paid addon plugins should ultimately be enforced through active plugin-specific `user_roles` surfaced by the auth hook, not merely by package installation
- one tenant may provision the same addon package for multiple end users inside that tenant

Important boundary:

- plugin package presence in the repo is not the same thing as plugin entitlement
- a plugin may be installed globally while only some tenant users are authorized to use it
- a plugin may also contribute storage entitlement logic without owning the underlying storage tables or bypassing tenant-aware RLS

### Storage Hook Decision

The managed storage model now explicitly separates:

1. Core storage management

- tenant/user storage tables
- quota cache synchronization
- media route enforcement
- scoped key generation and tracked object lifecycle

2. Plugin-specific entitlement logic

- storage quotas for specific addon packages
- source filtering rules for specific user roles
- plugin-owned dashboard/reporting surfaces

This keeps tenancy infrastructure generic while still allowing addon-specific commercial or support logic.

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
- continues to control plugin package installation until plugin entitlements are separated cleanly from package deployment

### Plugin Tenancy Decision

The plugin surface is split conceptually into two categories:

1. Webapps

- `kind = 'webapp'` records that point to external URLs should behave like tenant-owned integrations
- plain external webapp links should support normal tenant association
- registered webapps should be tenant-scoped registrations rather than one global shared record

2. Build-time plugins

- `kind = 'plugin'` records remain repo-installed packages and therefore remain operationally global at deploy time
- authorization for these plugins should not rely only on package presence in the repo
- the target enforcement model is plugin-specific active `user_roles` emitted by the auth hook so paid addons can be enabled for some users and not for others
- this allows one tenant to provision the same addon package for multiple users without making the plugin globally available to every authenticated user

This is documented now so future plugin and auth-hook work extends the tenancy model instead of reopening global access through the plugin surface.

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
- `api/routes/media.ts`

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
- `api/lib/tenantStorageMgt.ts`
- `api/lib/tenantStorageHooks.ts`
- `plugins/pluradash/api/storageHooks.ts`
- `plugins/pluradash/api/index.ts`
- `plugins/pluradash/src/pages/WelcomePage.tsx`
- `plugins/pluradash/src/services/pluradashService.ts`

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
3. Review `202605250001_tenant_storage_management.sql` in full before rollout.
4. Confirm update environments will apply `004`, `005`, `202605250001_tenant_storage_management.sql`, and `202606200001_page_schema_visibility_fix.sql` through `scripts/lib/core-update.mjs`.
5. Confirm both `scripts/lib/core-update.mjs` and `scripts/setup.mjs` still include `004`, `005`, `202605250001_tenant_storage_management.sql`, and `202606200001_page_schema_visibility_fix.sql` before release.
6. Review the ownership backfill rules for legacy content.
7. Identify which tables may contain rows with no trustworthy owner signal.
8. Confirm operational owners for:
   - existing page schemas
   - existing pages
   - existing objects
   - existing MCP specs and schema attachments
   - existing templates
   - existing products and events
9. Confirm that platform secrets and runtime config should remain `super-admin` only.
10. Confirm that no external automation depends on the old globally readable authenticated behavior.
11. Verify the new tenant-management UI with a real `super-admin` account before handing the system to tenant operators.
12. Verify that managed storage should be enabled only through explicit entitlement logic and not by raw bucket access.

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
- managed media uploads and deletes
- managed file downloads
- quota and allocation behavior
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

### 5. Managed Storage Entitlement Logic Is Hook-Driven

Core storage is now generic, but actual entitlement may depend on plugin-supplied backend hooks.

That means deployment review must consider both:

- whether the core storage migration and routes are correct
- whether the installed plugin hooks grant storage only to the intended users

### 6. Pages Console Required System-Owned Schema Visibility

**Status: resolved by `migrations/202606200001_page_schema_visibility_fix.sql`.**

The `authenticated_select_page_schemas` policy introduced in Migration 5 had the side effect of hiding system-owned `page_schemas` rows (`owner_user_id IS NULL`, e.g. the seeded `service-product` and `blog` defaults) from regular authenticated users, because the visibility clause required `public.is_super_admin()` for that branch.

Combined with the auth-gated route rendering change in `App.tsx` (see [`specs/Architecture.md`](Architecture.md) and `specs/changes/2026-06-20-page-schema-visibility-fix.md`), the Pages console then resolved zero schemas for non-super-admin users. The empty-state handler in `src/pages/Pages.tsx` rendered the onboarding tutorial instead of the populated dashboard, masking the regression as a "no frontends connected yet" message.

The follow-up migration re-opens the SELECT path for system-owned schemas to all authenticated users while leaving the mutating restrictions in Migration 4 untouched. Mutating system-owned schemas still requires `super-admin`, so this is a visibility-only relaxation.

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
7. Add integration tests that verify managed storage visibility, quota enforcement, and unauthenticated object access for tracked objects.
8. Audit other console surfaces (`Forms`, `Objects`, `Specs`) for the same class of regression that the auth-gated route rendering change exposed in `Pages` — the underlying tightening of `authenticated_select_*` policies may have hidden UX failures that depend on global reads for system-owned rows.

---

## Quick Reference

### New Core Tables

- `tenants`
- `tenant_users`
- `tenant_storage_allocations`
- `tenant_storage_objects`

### New Core Migration Files

- `202605240001_multi_tenant_foundation.sql`
- `202605240002_multi_tenant_backfill_and_ownership.sql`
- `202605240003_multi_tenant_rls_hardening.sql`
- `202605240004_tenant_assignment_rls_fix.sql`
- `202605240005_console_visibility_hardening.sql`
- `202605250001_tenant_storage_management.sql`
- `202606200001_page_schema_visibility_fix.sql`

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