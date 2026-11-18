# Core: plugin admin sections on `/admin/accounts`

Date: 2026-11-17

## Summary

Generalises the plugin admin-section mechanism so plugins can contribute a Card/tab to
`/admin/accounts`, not just `/admin/connections`. This is the core extension point needed
by the PluraDash "KI-Dienste je Konto" super-admin surface (see
[`../plans/ai-services-wallets.md`](../plans/ai-services-wallets.md) §8.1).

Changes:

- `PluginAdminConnectionSection` is generalised to **`PluginAdminSection`**, gaining
  `page?: 'connections' | 'accounts'` (default `'connections'`) and
  `requiredRole?: string`. The old name remains a deprecated type alias.
- `getPluginAdminSections(page, userRoles)` is added to the loader; the old
  `getPluginAdminConnectionSections` is a compatibility wrapper for `'connections'`.
- `/admin/connections` now calls `getPluginAdminSections('connections', ...)`.
- `/admin/accounts` renders `page: 'accounts'` sections as a **super-admin-only** tab.

## Files Added

- `specs/changes/2026-11-17-admin-account-plugin-sections.md` (this record)

## Files Changed

- `src/types/plugin.ts` — `PluginAdminSection`, `PluginAdminSectionPage`, alias; `adminSections?: PluginAdminSection[]`
- `src/plugins/loader.ts` — `getPluginAdminSections(page, userRoles)`; `getPluginAdminConnectionSections` wrapper
- `src/pages/VerwaltungConnections.tsx` — use `getPluginAdminSections('connections', ...)`
- `src/pages/VerwaltungAccounts.tsx` — render `page: 'accounts'` sections in a super-admin-only "KI-Dienste" tab
- `specs/agents/plugin-hooks.md` — documented `admin.accounts.sections` (manifest-driven) and noted the `admin.connections.sections` UI dispatch

## Impact Analysis

### Database

None.

### Runtime

- `/admin/accounts` gains an optional super-admin tab when a plugin registers a section
  with `page: 'accounts'` and `requiredRole: 'super-admin'`. Non-super-admins never see it.
- Existing `/admin/connections` plugin sections are unchanged (default page `'connections'`).

### API surface

None (frontend-only dispatch; the plugin's own `/api/plugin/pluradash/admin/ai/accounts*`
routes are documented separately in the plugin repository).

## Compliance

- Core change documented here; the plugin-side work is documented in the PluraDash plugin
  repository (`plugins/pluradash/specs/changes/`).
- New hook/extension target documented in `specs/agents/plugin-hooks.md` per `AGENTS.md` §3.
