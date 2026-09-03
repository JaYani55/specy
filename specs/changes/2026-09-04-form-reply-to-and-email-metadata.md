# 2026-09-04 — Form Reply-To Override & Notification E-Mail Metadata Layout

## Summary

- Renamed the global mail setting `Reply-To` in *Verwaltung → Verbindungen* to **Standard Reply-To E-Mail** and clarified its scope via helper text.
- Added a per-form reply-to override:
  - The `email` form field (E-Mail block in the form builder) now supports a `reply_to: true` flag, labeled *E-Mail-Antworten an diese Adresse richten*. The flag is **unique per form** — enabling it on one email block disables it on all others (enforced in the builder UI and during schema normalization on the API).
  - The *Formular-Editor → Benachrichtigungen bei Einreichungen* card exposes the same flag as the option **Antworten an den Absender des Formulares**. Both entry points edit the same schema property (no new database column).
- When the flagged email block contains a valid address in a submission, notification e-mails for that form use it as `Reply-To`, overriding the global standard reply-to. Otherwise the global `reply_to_email` from `system_config` (namespace `mail`) applies, as before.
- Re-structured the form answer notification e-mail: the technical details (`Antwort-ID`, `Formular-Slug`, `Eingangskanal`, `Quelle`) moved from the top to the end of the e-mail, rendered under a small `Metadaten` heading in a reduced, unobtrusive font (HTML) / trailing block (text).

## Files Added

- `specs/changes/2026-09-04-form-reply-to-and-email-metadata.md` (this document)

## Files Changed

- `src/types/forms.ts` — added `reply_to?: boolean` to `FormFieldDefinition`.
- `src/utils/forms.ts` — `parseFieldEntry` preserves `reply_to` (boolean, email fields only); `formFieldsToSchema` serializes the flag.
- `src/components/forms/FormSchemaBuilder.tsx` — E-Mail block: *E-Mail-Antworten an diese Adresse richten* switch with per-form uniqueness handling; `Reply-To` badge on flagged blocks.
- `src/pages/FormEditor.tsx` — notification settings card: *Antworten an den Absender des Formulares* switch backed by the schema flag, with hints and badge.
- `src/pages/VerwaltungConnections.tsx` — renamed label to *Standard Reply-To E-Mail* and added scope helper text.
- `api/routes/forms.ts` — `normalizeSchema` persists `reply_to` for email fields; new `resolveNotificationReplyTo` resolves the override from the submission; `reply_to` stored in `mail_delivery_jobs.payload`; `buildNotificationContent` renders metadata at the end under `Metadaten`.
- `functions/send_email/index.ts` — `SendRequest.replyTo`; job payload `reply_to` takes precedence over the global `reply_to_email` for both Resend (`reply_to`) and SMTP (`replyTo`).
- `specs/features/forms.md` — documented the `reply_to` field property, the resolution precedence, and the notification e-mail layout.

## Impact Analysis

### Database

- No schema changes. The flag lives in the existing JSONB `forms.schema` column; the per-job reply-to lives in the existing `mail_delivery_jobs.payload` JSONB.

### Runtime

- `functions/send_email` resolves `reply_to` per job: `payload.reply_to || system_config(mail).reply_to_email || undefined`. Existing queued jobs without `reply_to` behave unchanged.

### API Surface

- Form schema normalization (`POST/PUT /api/forms`) accepts and persists `reply_to: true` on `email` fields (silently dropped for other field types).
- Form answer notification jobs may now include `payload.reply_to`; agents/consumers of the mail delivery API see the additional payload key.
