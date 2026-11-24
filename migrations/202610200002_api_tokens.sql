-- 202610200002_api_tokens.sql
-- Self-service API tokens (PATs) — revocable aliases for existing accounts.
-- A PAT never carries authority itself: the exchange endpoint mints a real
-- Supabase session for the linked user_id, so claims (user_roles, tenant_id)
-- and RLS behave identically to a human login. Raw tokens are stored only as
-- SHA-256 hashes. Super-admin accounts must never hold PATs (enforced in the
-- create route; RLS keeps owners isolated).
-- Contract: specs/auth/api-tokens.md

create table if not exists public.api_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid null references public.tenants(id) on delete set null,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint api_tokens_pkey primary key (id)
);

create index if not exists idx_api_tokens_user_created_at
  on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;

drop policy if exists "owner_select_api_tokens" on public.api_tokens;
create policy "owner_select_api_tokens"
  on public.api_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "owner_insert_api_tokens" on public.api_tokens;
create policy "owner_insert_api_tokens"
  on public.api_tokens
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "owner_update_api_tokens" on public.api_tokens;
create policy "owner_update_api_tokens"
  on public.api_tokens
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "owner_delete_api_tokens" on public.api_tokens;
create policy "owner_delete_api_tokens"
  on public.api_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "super_admin_select_api_tokens" on public.api_tokens;
create policy "super_admin_select_api_tokens"
  on public.api_tokens
  for select
  to authenticated
  using (public.is_super_admin());

drop policy if exists "super_admin_delete_api_tokens" on public.api_tokens;
create policy "super_admin_delete_api_tokens"
  on public.api_tokens
  for delete
  to authenticated
  using (public.is_super_admin());

comment on table public.api_tokens is
  'Self-service API tokens (PATs). Hashed aliases for Supabase accounts; exchange mints a real session for the linked user_id. Super-admin accounts are excluded.';
