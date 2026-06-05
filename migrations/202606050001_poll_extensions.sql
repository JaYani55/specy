-- migration/202606050001_poll_extensions.sql

-- 1. Create Enums if they don't exist
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'form_type') THEN
        CREATE TYPE public.form_type AS ENUM ('form', 'poll');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voting_mode') THEN
        CREATE TYPE public.voting_mode AS ENUM ('live', 'deadline');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add columns to public.forms
ALTER TABLE public.forms 
  ADD COLUMN IF NOT EXISTS type public.form_type NOT NULL DEFAULT 'form',
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS voting_mode public.voting_mode NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS reminder_interval text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- 3. Add column to public.forms_answers
ALTER TABLE public.forms_answers 
  ADD COLUMN IF NOT EXISTS submitter_name text;

-- 4. Update RLS policies for public.forms_answers to allow viewing poll results
DROP POLICY IF EXISTS "anon_select_poll_results" ON public.forms_answers;
CREATE POLICY "anon_select_poll_results"
  ON public.forms_answers
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.forms
      WHERE forms.id = forms_answers.form_id
        AND forms.status = 'published'
        AND forms.type = 'poll'
        AND (
          forms.voting_mode = 'live' 
          OR (forms.voting_mode = 'deadline' AND (forms.deadline_at IS NULL OR forms.deadline_at <= now()))
        )
    )
  );

DROP POLICY IF EXISTS "authenticated_select_poll_results" ON public.forms_answers;
CREATE POLICY "authenticated_select_poll_results"
  ON public.forms_answers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.forms
      WHERE forms.id = forms_answers.form_id
        AND forms.type = 'poll'
        AND (
          forms.voting_mode = 'live'
          OR (forms.voting_mode = 'deadline' AND (forms.deadline_at IS NULL OR forms.deadline_at <= now()))
          OR (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['user', 'staff', 'admin', 'super-admin']
        )
    )
  );
