-- 202609030001_tenant_storage_shared_apps_scope.sql
--
-- Reverts the dedicated 'apps' allocation type introduced in
-- 202608300001_tenant_storage_allocation_types.sql and replaces it with the
-- intended model:
--
--   - Storage quota is SHARED across all file types. There is exactly one
--     allocation per (tenant_id, user_id) — allocation_type is dropped and
--     the primary key narrows back to (tenant_id, user_id).
--   - Workspace app files (PluraDash sync engine) are distinguished only by
--     the new 'apps' value in tenant_storage_objects.scope. They draw from
--     the same quota as 'media' and 'files' objects.
--
-- The usage-sync trigger is restored to the original single-bucket semantics
-- (update-only, no auto-provisioning of zero-quota rows) so catalog rows can
-- never silently create a quota-less allocation again — provisioning is the
-- exclusive job of ensureTenantStorageSummary().
--
-- Existing data is reconciled:
--   - catalog rows with a .../files/apps/... object key are back-filled to
--     scope = 'apps',
--   - usage counters are recomputed from the catalog (fixes drift, e.g.
--     rows created by the old trigger after usage already existed),
--   - 'apps' allocation rows are removed (their quota was never a
--     requirement; the 'files' row carries the shared quota).
--
-- Idempotent: safe to run multiple times.

-- ── 1. Restore single-bucket usage accounting ───────────────────────────────
-- Must run BEFORE the scope back-fill so the UPDATE below is usage-neutral.
CREATE OR REPLACE FUNCTION public.sync_tenant_storage_allocation_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenant_storage_allocations
    SET used_bytes_cached = used_bytes_cached + NEW.size_bytes,
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND user_id = NEW.user_id;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.tenant_storage_allocations
    SET used_bytes_cached = GREATEST(used_bytes_cached - OLD.size_bytes, 0),
        updated_at = now()
    WHERE tenant_id = OLD.tenant_id
      AND user_id = OLD.user_id;

    RETURN OLD;
  END IF;

  UPDATE public.tenant_storage_allocations
  SET used_bytes_cached = GREATEST(used_bytes_cached - OLD.size_bytes, 0),
      updated_at = now()
  WHERE tenant_id = OLD.tenant_id
    AND user_id = OLD.user_id;

  UPDATE public.tenant_storage_allocations
  SET used_bytes_cached = used_bytes_cached + NEW.size_bytes,
      updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

-- ── 2. New scope value 'apps' on tenant_storage_objects ─────────────────────
-- Rebuild the constraint unconditionally (idempotent by result).
ALTER TABLE public.tenant_storage_objects DROP CONSTRAINT IF EXISTS tenant_storage_objects_scope_check;
ALTER TABLE public.tenant_storage_objects
  ADD CONSTRAINT tenant_storage_objects_scope_check CHECK (scope IN ('media', 'files', 'apps'));

-- Back-fill: workspace app files carry the 'apps' scope. Runs after the
-- trigger replacement, so re-routing the rows does not change usage counters.
UPDATE public.tenant_storage_objects
SET scope = 'apps'
WHERE scope = 'files'
  AND object_key LIKE '%/files/apps/%';

-- ── 3. Consolidate allocations back to one shared row per (tenant, user) ────

-- 3a. Preserve quota settings of tenants that only ever had an 'apps' row
--     (trigger-created rows carry quota 0; ensureTenantStorageSummary
--     reconciles zero-quota rows with the policy hook on next use).
INSERT INTO public.tenant_storage_allocations
  (tenant_id, user_id, allocation_type, quota_bytes, used_bytes_cached, status, provisioned_by)
SELECT a.tenant_id, a.user_id, 'files', a.quota_bytes, 0, a.status, a.provisioned_by
FROM public.tenant_storage_allocations a
WHERE a.allocation_type = 'apps'
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_storage_allocations f
    WHERE f.tenant_id = a.tenant_id
      AND f.user_id = a.user_id
      AND f.allocation_type = 'files'
  )
ON CONFLICT (tenant_id, user_id, allocation_type) DO NOTHING;

-- 3b. Recompute usage from the catalog for all remaining rows (shared bucket
--     counts every scope). Fixes historical drift in used_bytes_cached.
UPDATE public.tenant_storage_allocations a
SET used_bytes_cached = COALESCE(agg.total, 0),
    updated_at = now()
FROM (
  SELECT tenant_id, user_id, SUM(size_bytes) AS total
  FROM public.tenant_storage_objects
  GROUP BY tenant_id, user_id
) agg
WHERE a.allocation_type = 'files'
  AND a.tenant_id = agg.tenant_id
  AND a.user_id = agg.user_id;

-- 3c. Drop the 'apps' rows now that their carry-over is ensured.
DELETE FROM public.tenant_storage_allocations
WHERE allocation_type = 'apps';

-- 3d. Narrow the primary key back to (tenant_id, user_id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a1 ON a1.attrelid = i.indrelid AND a1.attnum = i.indkey[0]
    JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = i.indkey[1]
    JOIN pg_attribute a3 ON a3.attrelid = i.indrelid AND a3.attnum = i.indkey[2]
    WHERE i.indrelid = 'public.tenant_storage_allocations'::regclass
      AND i.indisprimary
      AND a1.attname = 'tenant_id'
      AND a2.attname = 'user_id'
      AND a3.attname = 'allocation_type'
  ) THEN
    ALTER TABLE public.tenant_storage_allocations
      DROP CONSTRAINT tenant_storage_allocations_pkey;
    ALTER TABLE public.tenant_storage_allocations
      ADD CONSTRAINT tenant_storage_allocations_pkey
      PRIMARY KEY (tenant_id, user_id);
  END IF;
END $$;

-- 3e. Drop the column and its check constraint.
ALTER TABLE public.tenant_storage_allocations
  DROP CONSTRAINT IF EXISTS tenant_storage_allocations_type_check;
ALTER TABLE public.tenant_storage_allocations
  DROP COLUMN IF EXISTS allocation_type;
