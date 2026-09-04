-- Per-form notification message templates (Tiptap editor output):
--  notification_message_html — custom body for staff/owner notification e-mails.
--  confirmation_message_html — custom body for the confirmation copy sent to the
--  submitter. NULL always falls back to the built-in default template.

alter table public.form_notification_settings
  add column if not exists notification_message_html text null;

alter table public.form_notification_settings
  add column if not exists confirmation_message_html text null;
