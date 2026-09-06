# 2026-09-06 — Account Settings Section (Username & Profile Picture)

## Summary

Added an **Account Settings** section as the first card on the dashboard
settings page (`/settings`). Every signed-in user can now manage their own
public profile without admin help:

- **Username** (`public.user_profile.Username`): inline change with the same
  validation rules the profile page has always enforced — 2–50 characters,
  only letters, numbers, spaces, hyphens and underscores, and unique across
  all users. A successful change reloads the page so all cached displays
  (auth context, user lists) show the new name immediately.
- **Profile picture** (`public.user_profile.pfp_url`): picked via the shared
  media picker (`ImageUploader`, `avatar` preview variant) and removable
  (sets the column to `NULL`).

Both writes go through the existing `self_update_user_profile` RLS policy on
`user_profile` (users may update their own row) — no new API surface.

The username rules were extracted into `src/utils/usernameUtils.ts` as the
single source of truth; the existing `EditableUsername` component on the
profile page now uses the same validator, keeping behavior identical.

## Files Added

- `src/components/settings/AccountSettings.tsx` — Account Settings section (username inline edit + media-picker profile picture).
- `src/utils/usernameUtils.ts` — shared username rules (`validateUsername`, length/charset constants, `isUsernameTakenError`).
- `specs/features/user-profile.md` — user profile documentation incl. the username rules contract.
- `specs/changes/2026-09-06-account-settings-section.md` (this document)

## Files Changed

- `src/pages/Settings.tsx` — new first card "Account Settings" / "Kontoeinstellungen" hosting the new section.
- `src/components/profile/EditableUsername.tsx` — refactored to validate via `src/utils/usernameUtils.ts` (identical rules/messages; duplicate detection now checks the concrete unique-constraint error).
- `specs/features/README.md` — registered `user-profile.md`.

## Impact Analysis

### Database

- None. `user_profile.Username` and `user_profile.pfp_url` already exist; no migration. The existing `user_profile_username_key` UNIQUE constraint enforces username uniqueness.

### Runtime

- Self-service writes rely on the existing `self_update_user_profile` RLS policy. A username change triggers a client-side page reload (session persists via Supabase local storage). No API routes added or changed.

### API Surface

- None. Frontend-only change plus documentation.
