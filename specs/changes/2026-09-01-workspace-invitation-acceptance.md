# Workspace Invitation Acceptance & Member Administration

Date: 2026-09-01

## Summary

Completes the workspace invitation chain that was intentionally deferred in the
[organization foundation](2026-08-05-pluradash-organization-foundation.md). Invitations now
carry a single-use acceptance token with a 7-day expiry, the e-mail contains a working
acceptance link, and a public acceptance page handles both personas: existing Specy users
(accept after login) and brand-new users (register directly through the link). Tenant admins
can now also manage their workspace members (admin rights, suspend/reactivate, remove) and
delete the organization record.

To mount the public acceptance page, core adds a **public route slot** to the plugin system:
`PluginDefinition.publicRoutes`, rendered by `App.tsx` outside the authenticated layout
without any role gate. The slot is documented in `specs/plugins/development.md` §5.

## Invitation Flow (end to end)

1. Tenant admin invites via `POST /api/plugin/pluradash/organization/invitations`.
   The Worker generates a 32-byte token, stores only its SHA-256 hash plus
   `expires_at = now + 7 days`, rejects e-mails that are already active members,
   expires stale invitations, queues the e-mail with the acceptance link, and
   returns `registrationUrl` for display in the dashboard.
2. The invitee opens `/invitation/accept?token=...` (public plugin route).
   The page calls the public `GET /organization/invitations/lookup` endpoint to
   render organization name, recipient e-mail, admin flag, expiry, and whether an
   account already exists.
3. Acceptance via `POST /organization/invitations/accept`:
   - **Existing account + logged in**: bearer token must resolve to the invitation
     recipient's e-mail; membership is linked.
   - **Existing account + logged out**: the page offers login with a `returnTo`
     handoff back to the acceptance page.
   - **New user**: registration form (username + password); the Worker creates the
     auth user (e-mail pre-confirmed), the `user_profile` row (trigger bootstraps
     the default workspace), the base `user` role, and the membership.
   - Membership is written with `status = 'active'` and
     `is_tenant_admin = requested_tenant_admin`; the invitation transitions to
     `accepted`.
4. Expiry is enforced lazily on lookup, accept, and the authenticated listing
   (status transitions to `expired`). The partial unique index on open invitations
   prevents duplicate invites while allowing re-invites after
   expiry/cancellation/acceptance.

## Files Added

- `plugins/pluradash/src/pages/AcceptInvitationPage.tsx` — public acceptance page
  (lookup → login handoff / direct accept / registration form / success states)
- `plugins/pluradash/migrations/024_organization_delete_rls.sql` — delete policy +
  grant for `pluradash.organizations` (tenant admins and super-admin)
- `plugins/pluradash/migrations/down/024_organization_delete_rls.sql`
- `specs/changes/2026-09-01-workspace-invitation-acceptance.md` (this file)

## Files Changed

### Core

- `src/types/plugin.ts` — adds optional `publicRoutes?: PluginRoute[]` to `PluginDefinition`
- `src/plugins/loader.ts` — adds `getPluginPublicRoutes()`
- `src/App.tsx` — renders public plugin routes outside the auth gate (next to the
  share routes)
- `specs/plugins/development.md` — documents the `publicRoutes` slot (§5)
- `specs/platform/multi-tenancy.md` — new section "Workspace Invitations And
  Membership Acceptance"

### PluraDash plugin

- `plugins/pluradash/api/index.ts` — token generation/hashing, expiry sweep helper,
  bounded auth-user e-mail lookup, invitation link in e-mail + response, public
  `GET /organization/invitations/lookup`, public `POST /organization/invitations/accept`,
  `PATCH`/`DELETE /organization/members/:userId`, `DELETE /organization`
- `plugins/pluradash/src/index.tsx` — registers `publicRoutes: ['/invitation/accept']`
- `plugins/pluradash/src/services/organizationService.ts` — `lookupInvitation`,
  `acceptInvitation`, `updateOrganizationMember`, `removeOrganizationMember`,
  `deleteOrganization`
- `plugins/pluradash/src/pages/OrganizationPage.tsx` — invite link display + copy,
  member admin actions (admin toggle, suspend/reactivate, remove with last-admin
  guard), invitation expiry display, organization delete with confirm
- `plugins/pluradash/plugin.json` — migration manifest completed (022–024)

## Database Impact

- No core schema change. `acceptance_token_hash` and `expires_at` on
  `pluradash.organization_invitations` (introduced in migration 019) are now
  populated and consumed.
- New plugin migration `024_organization_delete_rls.sql` adds a delete RLS policy
  and `grant delete` on `pluradash.organizations`; idempotent, with matching
  downmigration.

## Runtime and API Impact

New API surface under `/api/plugin/pluradash`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/organization/invitations/lookup?token=` | public | Resolve token to display data |
| POST | `/organization/invitations/accept` | public, optional bearer | Accept invitation (login or signup path) |
| PATCH | `/organization/members/:userId` | bearer, tenant admin | Toggle admin / set status |
| DELETE | `/organization/members/:userId?tenantId=` | bearer, tenant admin | Remove member (last-admin guarded) |
| DELETE | `/organization?tenantId=` | bearer, tenant admin | Delete organization record |

Changed: `POST /organization/invitations` now sets `acceptance_token_hash` +
`expires_at`, performs a bounded membership pre-check, includes the acceptance
URL in the queued e-mail, and returns the real `registrationUrl`.

`GET /organization/invitations` now lazily expires stale rows before listing.

## Security Notes

- Only the SHA-256 hash of the acceptance token is stored; raw tokens exist only
  in the e-mail link and the lookup/accept request.
- Tokens expire after 7 days; expired/cancelled/accepted invitations reject
  acceptance (HTTP 410).
- A logged-in user can only accept invitations issued for their own e-mail.
- Membership writes on acceptance use the admin client server-side after token
  validation (a new member cannot pass `tenant_admin_insert_tenant_users` RLS);
  all dashboard-driven member administration goes through the user-scoped client
  so `tenant_users` RLS stays the enforcement layer.
- Self-modification of membership is refused; the last active tenant admin cannot
  be removed or demoted (removal guarded in the API; the `organizations` delete
  policy is tenant-admin gated at the database layer).

## Validation

- `npx tsc --noEmit` — clean
- `npx eslint` on all changed files — clean
- `npm run build` — succeeds (prebuild registry regeneration ran)
- Migrations not executed against a live database; run
  `024_organization_delete_rls.sql` (and downmigration when uninstalling) via the
  standard plugin migration flow.
