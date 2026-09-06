# 2026-09-06 — Customizable Form Notification Subjects

## Summary

The subjects of both form e-mails — the **owner/staff notification** (`Neue Formularantwort: <Formularname>`) and the **confirmation copy to the submitter** (`Ihre Anfrage an <Workspace-Name>`) — were hardcoded. They are now customizable per form with dynamic blocks, alongside the existing customizable message bodies.

- New columns on `public.form_notification_settings`: `notification_subject` and `confirmation_subject` (text, NULL = built-in default, max 500 chars).
- Subjects are stored as **plain text with template tokens** in `$token` notation (e.g. `Neue Anfrage via $form_name`, `Ihre Anfrage an $workspace_name`, `$field:first_name`). Block-level tokens (`$submissions`, `$metadata`) are not applicable to subject lines and are not offered there.
- The message editor modal (Formular-Editor → Benachrichtigungen bei Einreichungen → Benachrichtigungstext/Bestätigungstext → Anpassen) now contains a **Betreff** input above the toolbar with its own token dropdown that inserts tokens at the cursor. *Standard wiederherstellen* resets subject and body together; a subject equal to the default (or empty) is saved as `NULL`.
- Server-side rendering: `renderTemplateSubject` in `api/lib/formMessageTemplate.ts` resolves tokens to their text values (unknown → `-`), collapses whitespace and caps at 500 chars. The rendered subject replaces the hardcoded default on the queued mail job.
- New system token **`$workspace_name`** (workspace name, or the PluraDash organization name of the tenant when registered) — needed because the default confirmation subject references the workspace, not the form. Resolved via `resolveFormDisplayName` in both mail paths.

## Files Added

- `migrations/202609060001_form_notification_subject.sql` — adds `notification_subject` / `confirmation_subject` (text null) plus an idempotent 500-char length check constraint on `public.form_notification_settings`.
- `specs/changes/2026-09-06-form-notification-subjects.md` (this document)

## Files Changed

- `scripts/setup.mjs` — registered `202609060001_form_notification_subject.sql` in `MIGRATION_ORDER` (after `202609050003_form_notification_message.sql`).
- `api/lib/formMessageTemplate.ts` — new `renderTemplateSubject` (token resolution for plain-text subjects) and `hasUsableSubject`.
- `api/routes/forms.ts` — settings read includes the new columns; `buildTemplateTokens` accepts an optional `workspaceName` and emits the `workspace_name` token; `enqueueFormAnswerNotifications` resolves the workspace display name and renders `notification_subject` per recipient; `enqueueFormConfirmationCopy` accepts `customSubject` and renders `confirmation_subject`.
- `src/types/forms.ts` — `FormNotificationSettings` extended with `notification_subject` / `confirmation_subject`.
- `src/services/formService.ts` — reads/writes the new columns (`getFormNotificationSettings`, `syncFormNotificationSettings`, `SaveFormInput`).
- `src/utils/formNotificationTemplates.ts` — default subject templates (`DEFAULT_NOTIFICATION_SUBJECT` = `Neue Formularantwort: $form_name`, `DEFAULT_CONFIRMATION_SUBJECT` = `Ihre Anfrage an $workspace_name`) and the `workspace_name` token descriptor.
- `src/components/forms/NotificationMessageEditor.tsx` — subject input with cursor-position token insertion; `onSave` now receives `{ html, subject }`; restore-default resets both; subject equal to the default is saved as `null`.
- `src/pages/FormEditor.tsx` — subject state, load/save wiring, card row hints reflect custom subject or message, reset clears both.
- `specs/features/forms.md` — documents the subject customization and the new token.

## Impact Analysis

### Database

- `202609060001_…` is additive on `public.form_notification_settings` (two nullable columns + one named check constraint, added idempotently). Safe to run on any installation state. Registered in `scripts/setup.mjs`.

### Runtime

- Job subjects for `form_answer_notification` and `form_answer_confirmation` are now per-form templates when configured; existing rows with `NULL` subjects keep the previous hardcoded subjects. The `resolveFormDisplayName` lookup (graceful when the `pluradash` schema is absent) adds up to two queries per submission in the notification path.

### API Surface

- `mail_delivery_jobs.subject` values may now come from the per-form template. Mail delivery job payloads are unchanged (the subject lives in the job column, not the payload).
- Form notification settings carry the two new fields (read + write via the existing form save flow in `src/services/formService.ts`; RLS unchanged).
