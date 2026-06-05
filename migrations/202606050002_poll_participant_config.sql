-- migration/202606050002_poll_participant_config.sql

ALTER TABLE public.forms 
  ADD COLUMN IF NOT EXISTS allow_anonymous boolean NOT NULL DEFAULT false;
