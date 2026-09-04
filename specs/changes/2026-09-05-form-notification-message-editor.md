# 2026-09-05 — Form Notification Message Editor (Tiptap)

## Summary

Both form e-mails can now be customized per form with a rich text editor:

- **Benachrichtigungstext** — the owner/staff notification e-mail.
- **Bestätigungstext** — the confirmation copy sent to the form submitter (relevant when the confirmation copy is enabled).

The editor (`NotificationMessageEditor`) opens in a modal from the *Formular-Editor → Benachrichtigungen bei Einreichungen* card and offers:

- Bold/italic, headings 1–3, bullet/ordered lists, links (URL normalization like the page-builder editor)
- Image insertion through the existing `ImageUploader` media picker
- **Template token chips** — inline atom nodes (custom Tiptap extension `TemplateToken`) inserted via a "Blöcke" dropdown or dragged into the text, serialized as `<span data-token="…">`:
  - System tokens: `$submissions` (answer table incl. PluraDash download links), `$metadata` (metadata block), `$form_name`, `$recipient_name`, `$answer_id`, `$submitted_via`, `$source_slug`
  - Field tokens: one chip per fillable form block (`field:<name>` internally, displayed as `$<name>`)
- "Standard wiederherstellen" restores the built-in default; applying an untouched default saves `NULL` again

Per-form storage lives in two new columns; `NULL` falls back to the unchanged hardcoded default templates, so existing forms behave exactly as before.

## Files Added

- `migrations/202609050003_form_notification_message.sql` — adds `notification_message_html` / `confirmation_message_html` (text, nullable) to `public.form_notification_settings`.
- `api/lib/formMessageTemplate.ts` — strict-allowlist sanitizer (tags, attributes, safe href/src protocols), token resolution, inline-style injection for e-mail clients, plain-text derivation.
- `src/components/forms/TemplateToken.ts` — Tiptap inline atom node for token chips.
- `src/components/forms/NotificationMessageEditor.tsx` — modal editor with toolbar, chips dropdown (draggable items), media-picker image insertion, link popover, default-restore logic.
- `src/utils/formNotificationTemplates.ts` — default templates expressed with tokens + system token descriptors.
- `specs/changes/2026-09-05-form-notification-message-editor.md` (this document)

## Files Changed

- `scripts/setup.mjs` — registered `202609050003_form_notification_message.sql` in `MIGRATION_ORDER`.
- `package.json` — added `@tiptap/extension-image` (pinned `3.9.1` to match the installed `@tiptap/core`).
- `src/types/forms.ts` — `FormNotificationSettings` extended with `notification_message_html` / `confirmation_message_html`.
- `src/services/formService.ts` — reads/writes the new columns via the existing settings flow.
- `src/pages/FormEditor.tsx` — two message rows in the notification card (custom-state display, reset, editor modal trigger), editor state + save payload.
- `src/index.css` — `.template-token` chip styles + `img` styles inside ProseMirror.
- `api/routes/forms.ts` — extracted reusable `buildFileLinksBlock` / `buildMetadataBlock`; new `buildTemplateTokens`; staff notification and confirmation copy render a custom template through the sanitizer/renderer when present, otherwise use the unchanged default builders; settings select includes the new columns.
- `specs/features/forms.md` — new section "Custom Message Templates (Tiptap Editor)".

## Impact Analysis

### Database

- Additive migration (two nullable text columns), idempotent, registered in `scripts/setup.mjs`. No data migration needed — `NULL` means "use default".

### Runtime

- E-mail rendering path: custom template → sanitize → token replacement → inline styles → HTML + text payload; default path unchanged (`buildNotificationContent` / `buildConfirmationContent` output byte-identical, metadata block now uses `span`-based markup inside the shared `buildMetadataBlock` so token HTML stays block-element-safe).
- Unknown tokens render as `-`; malformed/dangerous markup (scripts, event handlers, `javascript:` URLs) is dropped by the sanitizer.

### API Surface

- `form_notification_settings` carries the two new fields (read/write via the existing form save flow). Mail job payload contract unchanged.

## Deployment Notes

- Worker deploy (`npm run deploy`) for `api/routes/forms.ts`; DB migration `202609050003`; the `send_email` Edge Function is unaffected (payload contract unchanged).
