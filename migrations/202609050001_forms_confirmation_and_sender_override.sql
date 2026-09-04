-- Per-form notification extensions:
--  1. send_confirmation_to_submitter — sends a confirmation copy of the submission
--     to the address stored in the reply_to-flagged e-mail field.
--  2. custom_from_name / custom_from_email — optional per-form sender override for
--     notification e-mails (falls back to the global standard from system_config).

alter table public.form_notification_settings
  add column if not exists send_confirmation_to_submitter boolean not null default false;

alter table public.form_notification_settings
  add column if not exists custom_from_name text null;

alter table public.form_notification_settings
  add column if not exists custom_from_email text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'form_notification_settings_custom_from_email_format_check'
  ) then
    alter table public.form_notification_settings
      add constraint form_notification_settings_custom_from_email_format_check
      check (custom_from_email is null or custom_from_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');
  end if;
end $$;
