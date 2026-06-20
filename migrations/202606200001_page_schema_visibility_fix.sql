-- Migration: Restore visibility of system-owned page_schemas to authenticated users
-- Run AFTER 202605240005_console_visibility_hardening.sql
--
-- Problem: 202605240005 hardened `authenticated_select_page_schemas` so that rows
-- with `owner_user_id IS NULL` (system-seeded defaults like `service-product`,
-- `blog`, etc.) only became visible when `public.is_super_admin()` returned true.
-- Regular authenticated users therefore saw zero rows in the Pages console, even
-- though the docs in Architecture.md describe those schemas as global resources.
--
-- The Pages.tsx onboarding empty-state handler interprets "no schemas returned"
-- as "no frontends connected yet" and shows the tutorial introduction instead of
-- the populated dashboard — masking the real issue.
--
-- Fix: re-introduce visibility for `owner_user_id IS NULL` rows to all
-- authenticated users. Mutating policies in 202605240004 still restrict inserts
-- for system-owned schemas to super-admin (the `tenant_assignment_rls_fix`
-- policy), so this change only re-opens the SELECT path. Visibility through
-- `page_schema_specs` is restored symmetrically so spec endpoints keep working
-- for non-super-admin viewers.

drop policy if exists "authenticated_select_page_schemas" on public.page_schemas;
create policy "authenticated_select_page_schemas"
  on public.page_schemas
  for select
  to authenticated
  using (
    owner_user_id is null
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

drop policy if exists "authenticated_select_page_schema_specs" on public.page_schema_specs;
create policy "authenticated_select_page_schema_specs"
  on public.page_schema_specs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and (
          ps.owner_user_id is null
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id)
        )
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and public.can_access_owned_row(ls.tenant_id, ls.created_by)
    )
  );