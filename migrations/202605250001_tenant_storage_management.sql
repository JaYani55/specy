CREATE TABLE IF NOT EXISTS public.tenant_storage_allocations (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  quota_bytes BIGINT NOT NULL DEFAULT 0,
  used_bytes_cached BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  provisioned_by UUID REFERENCES public.user_profile(user_id) ON DELETE SET NULL,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT tenant_storage_allocations_quota_check CHECK (quota_bytes >= 0),
  CONSTRAINT tenant_storage_allocations_used_check CHECK (used_bytes_cached >= 0),
  CONSTRAINT tenant_storage_allocations_status_check CHECK (status IN ('active', 'suspended'))
);

CREATE TABLE IF NOT EXISTS public.tenant_storage_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  source_mount_id TEXT NOT NULL,
  folder_path TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profile(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_storage_objects_scope_check CHECK (scope IN ('media', 'files')),
  CONSTRAINT tenant_storage_objects_size_check CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tenant_storage_allocations_user_id
  ON public.tenant_storage_allocations (user_id);

CREATE INDEX IF NOT EXISTS idx_tenant_storage_objects_tenant_user_scope
  ON public.tenant_storage_objects (tenant_id, user_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_storage_objects_object_key
  ON public.tenant_storage_objects (object_key);

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

DROP TRIGGER IF EXISTS trg_tenant_storage_allocations_updated_at ON public.tenant_storage_allocations;
CREATE TRIGGER trg_tenant_storage_allocations_updated_at
  BEFORE UPDATE ON public.tenant_storage_allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_storage_objects_updated_at ON public.tenant_storage_objects;
CREATE TRIGGER trg_tenant_storage_objects_updated_at
  BEFORE UPDATE ON public.tenant_storage_objects
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_storage_objects_usage_sync ON public.tenant_storage_objects;
CREATE TRIGGER trg_tenant_storage_objects_usage_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_storage_objects
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_storage_allocation_usage();

ALTER TABLE public.tenant_storage_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_storage_objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant users can read own allocation" ON public.tenant_storage_allocations;
CREATE POLICY "tenant users can read own allocation"
  ON public.tenant_storage_allocations
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant admins can manage allocations" ON public.tenant_storage_allocations;
CREATE POLICY "tenant admins can manage allocations"
  ON public.tenant_storage_allocations
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant users can read own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can read own storage objects"
  ON public.tenant_storage_objects
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant users can insert own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can insert own storage objects"
  ON public.tenant_storage_objects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant users can delete own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can delete own storage objects"
  ON public.tenant_storage_objects
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant admins can update storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant admins can update storage objects"
  ON public.tenant_storage_objects
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );