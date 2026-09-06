# User Profile & Username Rules

`public.user_profile` stores the public-facing profile of every auth user. The
**Account Settings** section of the dashboard settings page (`/settings`,
`src/pages/Settings.tsx` → `src/components/settings/AccountSettings.tsx`) lets
each user manage their own profile; admins manage other accounts under
*Verwaltung → Konten*.

## Fields

| Column | Purpose | Managed in |
|---|---|---|
| `Username` | Public display name, **UNIQUE** across all users | Account Settings (own), profile page / account administration (admins) |
| `pfp_url` | Profile picture URL, picked via the media picker | Account Settings (own), profile page (admins) |
| `selected_animal_icon` | Fallback avatar icon | Profile page |

Row Level Security: any authenticated user may read all profiles and update
**their own** row (`self_update_user_profile` policy); only super-admins may
update/create/delete any profile. Both Account Settings writes rely on the
self-update policy — no API route is involved.

## Username Rules (contract)

The rules live in `src/utils/usernameUtils.ts` and are the single source of
truth — every username edit must go through `validateUsername`:

- **Length**: 2–50 characters (`USERNAME_MIN_LENGTH` / `USERNAME_MAX_LENGTH`).
- **Characters**: letters, numbers, spaces, hyphens and underscores only
  (`/^[a-zA-Z0-9_\s-]+$/`).
- **Uniqueness**: enforced by the `user_profile_username_key` UNIQUE
  constraint; `isUsernameTakenError` detects the resulting `23505` /
  duplicate-key errors and surfaces a localized "already taken" message.

**Why these rules exist** — workflows that depend on `Username`:

- `AuthContext` derives the UI first/last name by splitting the username on
  spaces; the character rules keep this meaningful.
- The username is used as a display label in staff lists, event coaching/
  mentor selection, notification recipient labels and account administration.
  No workflow slugifies the username or uses it as an identifier — the user ID
  is always the key — but the display value must stay readable, which the
  character restriction guarantees.

After a self-service username change the page reloads so all cached views
(auth context, user lists) show the new name immediately.

## Profile Picture

`pfp_url` is set exclusively through the shared media picker
(`ImageUploader` with the `avatar` preview variant, see
`specs/features/tiptap-rich-text.md` for the picker's storage behavior). The
URL must resolve for the avatar display paths; images are picked from the
tenant's media library. Removing the picture sets the column to `NULL`.
