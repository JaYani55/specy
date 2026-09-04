-- Removes the per-form from e-mail override (custom_from_email) again:
-- mail providers such as Resend reject sender addresses whose domain is not
-- verified in the account (HTTP 403). The sender override is therefore
-- name-only (custom_from_name); the from e-mail always stays the global,
-- provider-verified standard from system_config (namespace `mail`).
--
-- Dropping the column also drops its check constraint
-- form_notification_settings_custom_from_email_format_check.

alter table public.form_notification_settings
  drop column if exists custom_from_email;
