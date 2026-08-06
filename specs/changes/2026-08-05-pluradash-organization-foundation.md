# PluraDash Organization Foundation

Date: 2026-08-05

## Summary

This foundation change starts the organization/workspace redesign while preserving the core owner-based multi-tenancy model.

The existing tenant remains the workspace and keeps its legacy `tenants.slug`. Core now supports an additional mutable `organization_slug` alias. PluraDash adds organization and pending-invitation tables with reversible plugin migrations.

The frontend organization administration, active-workspace provider, invitation API, and mail orchestration are planned for the next implementation phase.

## Files Added

- `migrations/202608050001_tenant_organization_alias.sql`
- `plugins/pluradash/migrations/018_create_organizations.sql`
- `plugins/pluradash/migrations/down/018_create_organizations.sql`
- `plugins/pluradash/migrations/019_create_organization_invitations.sql`
- `plugins/pluradash/migrations/down/019_create_organization_invitations.sql`
- `specs/changes/2026-08-05-pluradash-organization-foundation.md`

## Files Changed

- `scripts/lib/core-update.mjs`
- `scripts/setup.mjs`
- `plugins/pluradash/plugin.json`
- `src/services/tenantService.ts`

## Database Impact

### Core

- Adds nullable `public.tenants.organization_slug`.
- Adds case-insensitive uniqueness and lookup indexes.
- Adds `public.resolve_tenant_public_alias(text)`, which returns a tenant only when the supplied alias resolves uniquely to either the legacy slug or current organization slug.
- Does not add organization or invitation tables to the core schema.
- Does not alter core owner-based RLS authorization.

### PluraDash

- Adds `pluradash.organizations`, enforcing one organization per tenant.
- Synchronizes the organization slug to the corresponding core tenant alias. The legacy tenant name remains unchanged so existing name-based URLs and labels are not silently rewritten.
- Adds `pluradash.organization_invitations` for pending, email-first invitations.
- Adds tenant-admin/member RLS policies within the plugin schema.
- Downmigrations remove only the new plugin tables/triggers.

## Runtime and API Impact

- Core tenant DTOs now expose `organization_slug` for future workspace selection and public URL compatibility.
- Migration manifests apply the core alias migration on updates and fresh installations.
- PluraDash migration registration includes matching forward/downmigration files.
- No organization API or frontend route is enabled yet in this foundation step.

## Security Notes

- Existing `tenant_users` remains the membership source of truth.
- Organization table access is limited to tenant members, with mutations limited to tenant admins or super-admins.
- Invitation acceptance and registration links remain intentionally unimplemented.
- Client-side workspace selection will not replace database RLS or the owner-based access model.
