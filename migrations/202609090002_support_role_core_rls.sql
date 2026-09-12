-- ─────────────────────────────────────────────────────────────────────────────
-- 202609090002_support_role_core_rls.sql
--
-- Support-role visibility on CORE tables + the is_support() helper.
--
-- Origin: these statements were previously contributed by the PluraDash
-- plugin (migrations 009_secondbrain_rls_support_override.sql). They touch
-- core tables, so per the core/plugin boundary (AGENTS.md §4) they belong to
-- core — plugin migrations must only DDL their own schema. The plugin
-- migration now keeps only the pluradash.* policies; the statements below
-- were moved here 1:1 (same policy names, same USING/WITH CHECK expressions
-- — no semantic change).
--
-- The 'support' role itself remains data-driven: plugin migrations insert it
-- into public.roles and it flows into JWT user_roles via
-- custom_access_token_hook. We seed it here so is_support() is meaningful on
-- fresh installs (same insert pattern as roles.sql).
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP/CREATE POLICY, ON CONFLICT
-- insert — safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Support role seed (data-driven role flow, see roles.sql) ─────────────
insert into public.roles (name, description)
values
  ('support', 'Support agents: cross-tenant read/write visibility alongside super-admin')
on conflict (name) do update
set description = excluded.description;

-- ─── 2. is_support() helper (moved 1:1 from PluraDash 009) ───────────────────
CREATE OR REPLACE FUNCTION public.is_support()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce('support' = any(public.current_user_roles()), false)
$$;

-- ─── 3. public.tenants — support visibility (moved 1:1 from PluraDash 009 §6) ─
DROP POLICY IF EXISTS "tenant_members_can_select_tenants" ON public.tenants;
CREATE POLICY "tenant_members_can_select_tenants"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR public.is_tenant_member(id)
  );

-- ─── 4. public.tenant_storage_objects (moved 1:1 from PluraDash 009 §7) ──────
DROP POLICY IF EXISTS "tenant users can read own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can read own storage objects"
  ON public.tenant_storage_objects
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant users can insert own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can insert own storage objects"
  ON public.tenant_storage_objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_support()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant users can delete own storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant users can delete own storage objects"
  ON public.tenant_storage_objects
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant admins can update storage objects" ON public.tenant_storage_objects;
CREATE POLICY "tenant admins can update storage objects"
  ON public.tenant_storage_objects
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_support()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

-- ─── 5. public.tenant_storage_allocations (moved 1:1 from PluraDash 009 §8) ──
DROP POLICY IF EXISTS "tenant users can read own allocation" ON public.tenant_storage_allocations;
CREATE POLICY "tenant users can read own allocation"
  ON public.tenant_storage_allocations
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );

DROP POLICY IF EXISTS "tenant admins can manage allocations" ON public.tenant_storage_allocations;
CREATE POLICY "tenant admins can manage allocations"
  ON public.tenant_storage_allocations
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_support()
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );
