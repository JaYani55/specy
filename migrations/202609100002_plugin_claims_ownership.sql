-- ─────────────────────────────────────────────────────────────────────────────
-- 202609100002_plugin_claims_ownership.sql
--
-- Give public.plugin_claims a real FK to public.plugins(id) with ON DELETE
-- CASCADE so claims can never outlive the plugin's registry row
-- (DEPLOYMENT-STATE-TRACKING.md §4 hygiene fix).
--
-- Deviation from the plan's literal "change plugin_id from text to uuid":
-- plugin migrations insert `plugin_id` as the *slug* text (the documented
-- Layer-2 contract in specs/auth/plugin-claims.md, and the same value as
-- `claim_key`). Converting the column type would break every existing plugin
-- migration. Instead a companion `plugins_id uuid` carries the FK and a BEFORE
-- trigger resolves it from the slug on every write — same referential integrity
-- (ON DELETE CASCADE), no change to the plugin migration contract.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraint, DROP/CREATE
-- TRIGGER, CREATE OR REPLACE FUNCTION — safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

-- Companion uuid column carrying the real FK (nullable: a claim may be inserted
-- before its plugin is registered; the cascade backstop then simply does not
-- fire until the trigger resolves it on a later update).
ALTER TABLE public.plugin_claims
  ADD COLUMN IF NOT EXISTS plugins_id uuid;

-- Backfill existing rows by resolving slug → plugins.id.
UPDATE public.plugin_claims pc
SET plugins_id = p.id
FROM public.plugins p
WHERE p.slug = pc.plugin_id
  AND pc.plugins_id IS NULL;

-- Resolve the FK on every write so plugin migrations keep inserting the slug.
CREATE OR REPLACE FUNCTION public.plugin_claims_resolve_plugin_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plugins_id IS NULL AND NEW.plugin_id IS NOT NULL THEN
    SELECT p.id INTO NEW.plugins_id
    FROM public.plugins p
    WHERE p.slug = NEW.plugin_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plugin_claims_resolve_plugin ON public.plugin_claims;
CREATE TRIGGER trg_plugin_claims_resolve_plugin
  BEFORE INSERT OR UPDATE OF plugin_id ON public.plugin_claims
  FOR EACH ROW EXECUTE FUNCTION public.plugin_claims_resolve_plugin_id();

-- The FK itself (guarded — ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plugin_claims_plugins_id_fkey'
      AND conrelid = 'public.plugin_claims'::regclass
  ) THEN
    ALTER TABLE public.plugin_claims
      ADD CONSTRAINT plugin_claims_plugins_id_fkey
      FOREIGN KEY (plugins_id) REFERENCES public.plugins(id) ON DELETE CASCADE;
  END IF;
END $$;
