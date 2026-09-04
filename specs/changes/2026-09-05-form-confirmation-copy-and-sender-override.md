# 2026-09-05 — Form Confirmation Copy & Per-Form Sender Override

## Summary

- Added a per-form option **Bestätigungskopie an den Absender des Formulares senden** (`send_confirmation_to_submitter`). When enabled, every submission triggers a second, dedicated e-mail to the address stored in the `reply_to`-flagged e-mail field, using its own template:
  - Subject: `Ihre Anfrage an <Workspace-Name>` (tenant name resolved via `forms.tenant_id`, fallback: form name).
  - Body: `Hallo,` / `hier ist eine Zusammenfassung Ihrer Nachricht.` followed by a tabular answer summary (`Ihre Antworten`, display-only blocks excluded) and the technical metadata as small print at the end (`Antwort-ID`, `Formular-Slug`, `Eingangskanal`, `Quelle`).
  - Queued as `mail_delivery_jobs` event type `form_answer_confirmation`; independent of the owner/staff notification switches. Skipped (with a console warning) when no valid submitter address is present.
- Added a per-form option **Absender überschreiben**: the form owner can customize the sender **name** for this form's notification e-mails (and the confirmation copy). The sender **e-mail** always stays the global standard from `system_config` (namespace `mail`, edited under *Verwaltung → Verbindungen*), so the address is guaranteed to be a domain verified with the mail provider (an earlier draft that also allowed overriding the from e-mail was removed again because providers such as Resend reject unverified sender domains with HTTP 403).
  - Stored as `form_notification_settings.custom_from_name` and propagated via `payload.from_name` on each mail job.
  - `send_email` resolves the effective sender per job: the overridden name is combined with the global standard from e-mail.

Both options are exposed in the *Formular-Editor → Benachrichtigungen bei Einreichungen* card, following the same UX pattern as *Antworten an den Absender des Formulares* (switch + contextual hint + badge). The confirmation copy requires an e-mail block marked as the sender address (the `reply_to` flag); the form editor enforces this at save time.

## Files Added

- `migrations/202609050001_forms_confirmation_and_sender_override.sql` — adds `send_confirmation_to_submitter` (boolean), `custom_from_name` (text), `custom_from_email` (text, format-checked) to `public.form_notification_settings`.
- `migrations/202609050002_remove_custom_from_email.sql` — drops `custom_from_email` again (incl. its check constraint): the from e-mail must stay the global, provider-verified standard; the sender override is name-only.
- `specs/changes/2026-09-05-form-confirmation-copy-and-sender-override.md` (this document)

## Files Changed

- `scripts/setup.mjs` — registered the new migrations in `MIGRATION_ORDER` (`202609050001_…` and `202609050002_…` after `forms_notification_recipient_rls_fix.sql`, before `mail_delivery.sql`).
- `src/types/forms.ts` — extended `FormNotificationSettings` with `send_confirmation_to_submitter` and `custom_from_name`.
- `src/services/formService.ts` — reads/writes the new columns in `getFormNotificationSettings` / `syncFormNotificationSettings`; extended `SaveFormInput.notification_settings`.
- `src/pages/FormEditor.tsx` — notification card: confirmation-copy switch (with reply-to-field dependency hints and save-time validation), sender-override switch with a single `Absendername` input, plus status badges.
- `api/routes/forms.ts` — settings read includes the new columns; new helpers `resolveSenderOverridePayload`, `resolveFormTenantName`, `buildConfirmationContent`, `enqueueFormConfirmationCopy`; `enqueueFormAnswerNotifications` now dispatches the confirmation copy (independent of owner/staff flags) and attaches the `from_name` override to every job payload.
- `functions/send_email/index.ts` — `SendRequest.from`; per-job sender resolution from `payload.from_name` combined with the global standard from e-mail; Resend and SMTP adapters use the resolved `from`.

## Follow-up: confirmation subject uses the organization name

The confirmation e-mail subject now resolves `<Name>` from `pluradash.organizations.name` of the form's tenant (resolved via the unique `tenant_id` mapping), falling back to the workspace name (`tenants.name`) when the tenant has no registered organization, and finally to the form name. The lookup (`resolveFormDisplayName` in `api/routes/forms.ts`) fails gracefully when the `pluradash` schema is not installed (plugin absent) — the mail then uses the workspace name. No database or API surface changes.

## Follow-up: from e-mail override removed

The ability to override the from e-mail per form was removed: providers such as Resend reject sender addresses whose domain is not verified in the account (HTTP 403), so an arbitrary per-form from address cannot be delivered reliably. The sender override is now **name-only** (`custom_from_name` → `payload.from_name`), always combined with the global standard from e-mail from `system_config`. `functions/send_email/index.ts` no longer reads `payload.from_email`; migration `202609050002_remove_custom_from_email.sql` drops the column for installations that already ran the earlier revision.

## Follow-up: Sender domain rejection diagnostics

Superseded by the from e-mail override removal (see above) — the `describeResendFailure` hint and the `Absender-E-Mail` input hint were removed again together with the override. The underlying provider constraint is documented in `specs/features/forms.md`.

No database, runtime contract, or API surface changes.

## Impact Analysis

### Database

- `202609050001_…` is additive on `public.form_notification_settings` (three columns + format check constraint); `202609050002_…` drops `custom_from_email` again (the check constraint goes with it). Both idempotent; safe to run in sequence on any installation state. Registered in `scripts/setup.mjs`.

### Runtime

- `enqueueFormAnswerNotifications` no longer returns early before the confirmation check — the confirmation copy is evaluated even when owner/staff notifications are disabled. Job payloads may now contain `from_name`; `send_email` treats it as an optional name override, so existing jobs without this key behave unchanged.
- New `form_answer_confirmation` event type in `mail_delivery_jobs` (purely additive; no consumer assumes a closed set of event types).

### API Surface

- Form notification settings now carry the two new fields (read + write via the existing form save flow in `src/services/formService.ts`, RLS unchanged).
- Mail delivery job payloads gain an optional `from_name` key; consumers of the mail delivery API see the additional payload key. The `from_email` payload key from the earlier revision is no longer written.
