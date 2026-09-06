-- Per-form notification/confirmation e-mail subjects:
--  notification_subject — custom subject for staff/owner notification e-mails.
--  confirmation_subject — custom subject for the confirmation copy sent to the
--  submitter. NULL always falls back to the built-in default subject. Stored
--  as plain text with template tokens ($token / $field:<name>), resolved
--  server-side at send time (see api/lib/formMessageTemplate.ts).

alter table public.form_notification_settings
  add column if not exists notification_subject text null;

alter table public.form_notification_settings
  add column if not exists confirmation_subject text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'form_notification_settings_subject_length'
      and conrelid = 'public.form_notification_settings'::regclass
  ) then
    alter table public.form_notification_settings
      add constraint form_notification_settings_subject_length
      check (
        (notification_subject is null or char_length(notification_subject) <= 500)
        and (confirmation_subject is null or char_length(confirmation_subject) <= 500)
      );
  end if;
end $$;
