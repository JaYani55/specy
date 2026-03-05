-- preamble.sql
-- Must run FIRST — defines shared types and trigger functions used by later migrations.
-- All statements are idempotent (safe to re-run).

-- ─── Enum: app_enum ──────────────────────────────────────────────────────────
-- Identifies which application module a role belongs to.
-- Used in public.roles.app column as app_enum[].
DO $$ BEGIN
  CREATE TYPE public.app_enum AS ENUM (
    'mentorbooking',
    'cms',
    'admin',
    'shared'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Function: set_current_timestamp_updated_at ──────────────────────────────
-- Standard trigger function that sets updated_at = now() on every row update.
-- Used by: products, page_schemas (and any future tables with an updated_at column).
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── Function: sync_is_draft_with_status ─────────────────────────────────────
-- Keeps the boolean is_draft column in sync with the status text column.
-- is_draft = true  when status is NOT 'published'
-- is_draft = false when status = 'published'
-- Used by: products (before rename to pages).
CREATE OR REPLACE FUNCTION public.sync_is_draft_with_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_draft = (NEW.status IS DISTINCT FROM 'published');
  RETURN NEW;
END;
$$;

-- ─── Function: update_event_status ───────────────────────────────────────────
-- Derives event status from mentor request/acceptance counts.
-- Fired on INSERT or UPDATE OF requesting_mentors, accepted_mentors, amount_requiredmentors.
-- Status transitions (does not override 'locked' status):
--   accepted >= required  → successComplete
--   accepted > 0          → successPartly
--   requesting > 0        → firstRequests
--   otherwise             → new
CREATE OR REPLACE FUNCTION public.update_event_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  req_count INT;
  acc_count INT;
BEGIN
  -- Never auto-change a manually locked event
  IF NEW.status = 'locked' THEN
    RETURN NEW;
  END IF;

  req_count := COALESCE(array_length(NEW.requesting_mentors, 1), 0);
  acc_count := COALESCE(array_length(NEW.accepted_mentors,   1), 0);

  IF acc_count >= NEW.amount_requiredmentors THEN
    NEW.status := 'successComplete';
  ELSIF acc_count > 0 THEN
    NEW.status := 'successPartly';
  ELSIF req_count > 0 THEN
    NEW.status := 'firstRequests';
  ELSE
    NEW.status := 'new';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── Function: update_event_status_on_request ────────────────────────────────
-- Same logic as update_event_status; fired on any row UPDATE on mentorbooking_events.
-- Kept as a separate function so behaviour can diverge in the future if needed.
CREATE OR REPLACE FUNCTION public.update_event_status_on_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  req_count INT;
  acc_count INT;
BEGIN
  IF NEW.status = 'locked' THEN
    RETURN NEW;
  END IF;

  req_count := COALESCE(array_length(NEW.requesting_mentors, 1), 0);
  acc_count := COALESCE(array_length(NEW.accepted_mentors,   1), 0);

  IF acc_count >= NEW.amount_requiredmentors THEN
    NEW.status := 'successComplete';
  ELSIF acc_count > 0 THEN
    NEW.status := 'successPartly';
  ELSIF req_count > 0 THEN
    NEW.status := 'firstRequests';
  ELSE
    NEW.status := 'new';
  END IF;

  RETURN NEW;
END;
$$;
