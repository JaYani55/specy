# 2026-09-06 — Form Confirmation Copy Reply-To: Form Owner

## Summary

The confirmation copy to the form submitter (`form_answer_confirmation`) had no `reply_to` in its mail job payload, so the `send_email` Edge Function fell back to the **global** `reply_to_email` from `system_config` (namespace `mail`). Submitters replying to the confirmation copy reached the global standard reply-to address (e.g. the configured system reply-to) instead of the form owner.

The confirmation copy now sets `reply_to` to the **form owner's e-mail address** (`forms.owner_user_id` → `auth.users.email`, resolved via the existing `resolveOwnerRecipient` helper). A submitter replying to the copy now reaches the form owner by default. The global system reply-to is no longer used for the confirmation copy.

This is intentionally asymmetric with the owner/staff notification, whose `Reply-To` is the submitter's address (from the `reply_to`-flagged e-mail field) so the owner can reply directly to the submitter. Each e-mail now replies to the *other* party.

If the form has no owner or the owner has no valid e-mail address, no `reply_to` payload key is written and the `send_email` fallback applies (global `reply_to_email`; if unset, no `Reply-To` header and replies go to `from_email`).

## Files Added

- `specs/changes/2026-09-06-form-confirmation-reply-to-owner.md` (this document)

## Files Changed

- `api/routes/forms.ts` — `enqueueFormConfirmationCopy` now resolves the form owner via `resolveOwnerRecipient` and writes `payload.reply_to` with the owner's e-mail when available.
- `specs/features/forms.md` — *Confirmation Copy to the Submitter* section documents the confirmation copy's own Reply-To resolution (form owner, no global fallback).

## Impact Analysis

### Database

- None. No migration required.

### Runtime

- `form_answer_confirmation` job payloads may now contain a `reply_to` key. `functions/send_email/index.ts` already reads `payload.reply_to` per job (preferred over the global `reply_to_email`), so no Edge Function change was needed. Existing queued jobs without the key behave unchanged.

### API Surface

- Consumers of the mail delivery API see an additional optional `reply_to` payload key on `form_answer_confirmation` jobs. No endpoints added or removed.
