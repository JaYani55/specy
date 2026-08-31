-- 202608300001_tenant_storage_allocation_types.sql
--
-- Adds an `allocation_type` to the tenant storage provisioning so workspace
-- apps (PluraDash R2 sync engine workspaces) can be provisioned with their
-- own disk quota, separate from generic file storage.
--
-- Types:
--   'files' — default; generic managed file/media storage (existing behavior).
--   'apps'  — dedicated quota bucket for workspace app files stored under
--             tenant/{tenantId}/user/{userId}/files/apps/... by the sync engine.
--
-- The usage-sync trigger is extended so catalog changes are routed to the
-- matching allocation row based on the object key path.
--
-- Idempotent: safe to run multiple times.

-- ── 1. New column ───────────────────────────────────────────────────────────
ALTER TABLE public.tenant_storage_allocations
  ADD COLUMN IF NOT EXISTS allocation_type TEXT NOT NULL DEFAULT 'files';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_storage_allocations_type_check'
  ) THEN
    ALTER TABLE public.tenant_storage_allocations
      ADD CONSTRAINT tenant_storage_allocations_type_check
      CHECK (allocation_type IN ('files', 'apps'));
  END IF;
END $$;

-- ── 2. Widen the primary key to include the allocation type ─────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_storage_allocations_pkey'
  ) THEN
    -- Ensure the PK really covers (tenant_id, user_id) only before widening.
    IF EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_attribute a1 ON a1.attrelid = i.indrelid AND a1.attnum = i.indkey[0]
      JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = i.indkey[1]
      WHERE i.indrelid = 'public.tenant_storage_allocations'::regclass
        AND i.indisprimary
        AND a1.attname = 'tenant_id'
        AND a2.attname = 'user_id'
        AND i.indnkeyatts = 2
    ) THEN
      ALTER TABLE public.tenant_storage_allocations
        DROP CONSTRAINT tenant_storage_allocations_pkey;
      ALTER TABLE public.tenant_storage_allocations
        ADD CONSTRAINT tenant_storage_allocations_pkey
        PRIMARY KEY (tenant_id, user_id, allocation_type);
    END IF;
  ELSE
    ALTER TABLE public.tenant_storage_allocations
      ADD CONSTRAINT tenant_storage_allocations_pkey
      PRIMARY KEY (tenant_id, user_id, allocation_type);
  END IF;
END $$;

-- ── 3. Route usage accounting by allocation type ────────────────────────────
-- Apps objects are identified by their deterministic object key layout:
--   tenant/{tenantId}/user/{userId}/files/apps/...
-- Everything else (media + generic files) continues to count toward the
-- 'files' allocation, preserving the previous single-bucket behavior.
CREATE OR REPLACE FUNCTION public.sync_tenant_storage_allocation_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_allocation_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    row_allocation_type := CASE
      WHEN NEW.object_key LIKE 'tenant/' || NEW.tenant_id::text || '/user/' || NEW.user_id::text || '/files/apps/%'
        THEN 'apps'
      ELSE 'files'
    END;

    INSERT INTO public.tenant_storage_allocations (tenant_id, user_id, allocation_type, used_bytes_cached, quota_bytes, status)
    VALUES (NEW.tenant_id, NEW.user_id, row_allocation_type, 0, 0, 'active')
    ON CONFLICT (tenant_id, user_id, allocation_type) DO NOTHING;

    UPDATE public.tenant_storage_allocations
    SET used_bytes_cached = used_bytes_cached + NEW.size_bytes,
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND user_id = NEW.user_id
      AND allocation_type = row_allocation_type;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    row_allocation_type := CASE
      WHEN OLD.object_key LIKE 'tenant/' || OLD.tenant_id::text || '/user/' || OLD.user_id::text || '/files/apps/%'
        THEN 'apps'
      ELSE 'files'
    END;

    UPDATE public.tenant_storage_allocations
    SET used_bytes_cached = GREATEST(used_bytes_cached - OLD.size_bytes, 0),
        updated_at = now()
    WHERE tenant_id = OLD.tenant_id
      AND user_id = OLD.user_id
      AND allocation_type = row_allocation_type;

    RETURN OLD;
  END IF;

  -- UPDATE: re-classify both sides so a moved key switches buckets correctly.
  row_allocation_type := CASE
    WHEN OLD.object_key LIKE 'tenant/' || OLD.tenant_id::text || '/user/' || OLD.user_id::text || '/files/apps/%'
      THEN 'apps'
    ELSE 'files'
  END;

  UPDATE public.tenant_storage_allocations
  SET used_bytes_cached = GREATEST(used_bytes_cached - OLD.size_bytes, 0),
      updated_at = now()
  WHERE tenant_id = OLD.tenant_id
    AND user_id = OLD.user_id
    AND allocation_type = row_allocation_type;

  row_allocation_type := CASE
    WHEN NEW.object_key LIKE 'tenant/' || NEW.tenant_id::text || '/user/' || NEW.user_id::text || '/files/apps/%'
      THEN 'apps'
    ELSE 'files'
  END;

  INSERT INTO public.tenant_storage_allocations (tenant_id, user_id, allocation_type, used_bytes_cached, quota_bytes, status)
  VALUES (NEW.tenant_id, NEW.user_id, row_allocation_type, 0, 0, 'active')
  ON CONFLICT (tenant_id, user_id, allocation_type) DO NOTHING;

  UPDATE public.tenant_storage_allocations
  SET used_bytes_cached = used_bytes_cached + NEW.size_bytes,
      updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND user_id = NEW.user_id
    AND allocation_type = row_allocation_type;

  RETURN NEW;
END;
$$;

-- ── 4. Index for allocation lookups by user ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tenant_storage_allocations_user_id
  ON public.tenant_storage_allocations (user_id);

-- ── 5. RLS policies cover the new rows automatically (no per-type policies).
-- The existing policies on tenant_storage_allocations apply to all rows.
