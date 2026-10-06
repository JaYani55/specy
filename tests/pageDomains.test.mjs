import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MIGRATION_ORDER_CORE } from '../scripts/lib/migration-order.mjs';

const migration = await readFile('migrations/202610110001_page_domains.sql', 'utf8');
const registration = await readFile('api/lib/schemaRegistration.ts', 'utf8');
const routes = await readFile('api/routes/schemas.ts', 'utf8');
const pageService = await readFile('src/services/pageService.ts', 'utf8');
const pages = await readFile('src/pages/Pages.tsx', 'utf8');
const apiCatalog = await readFile('src/lib/apiCatalog.ts', 'utf8');
const featuresReadme = await readFile('specs/features/README.md', 'utf8');

test('Page domains is an ordered migration creating the registry, RLS and the guarded reassignment RPC', () => {
  assert.ok(MIGRATION_ORDER_CORE.indexOf('202610110001_page_domains.sql') > MIGRATION_ORDER_CORE.indexOf('202610060002_separate_preview_slug_structure.sql'));
  // Registry table: unique domain, owning tenant, arbitrary display name
  assert.match(migration, /create table if not exists public\.page_domains/);
  assert.match(migration, /domain_url text not null unique/);
  assert.match(migration, /display_name text null/);
  assert.match(migration, /page_domains_display_name_length check \(char_length\(display_name\) <= 120\)/);

  // RLS: tenant-member read, super-admin-only writes
  assert.match(migration, /alter table public\.page_domains enable row level security/);
  assert.match(migration, /create policy "authenticated_select_page_domains"[\s\S]*?public\.is_super_admin\(\)[\s\S]*?public\.is_tenant_member\(tenant_id\)/);
  assert.match(migration, /create policy "super_admin_update_page_domains"[\s\S]*?with check \(public\.is_super_admin\(\)\)/);

  // SECURITY DEFINER RPC with in-function super-admin guard and atomic cascade
  assert.match(migration, /reassign_page_domains_tenant\([\s\S]*?security definer/);
  assert.match(migration, /drop function if exists public\.reassign_page_domain_tenant\(uuid, uuid\)/);
  assert.match(migration, /if not public\.is_super_admin\(\) then[\s\S]*?Only super-admins may reassign page domains/);
  assert.match(migration, /update public\.page_schemas[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /update public\.schema_frontend_targets[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /update public\.page_content_templates[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /update public\.pages[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /update public\.mentorbooking_products[\s\S]*?where id = any\(v_product_ids\)/);
  assert.match(migration, /update public\.mentorbooking_events[\s\S]*?page_id = any\(v_page_ids\)[\s\S]*?page_id is null/);
  assert.match(migration, /update public\.companies[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /is also referenced by events on other domains/);
  assert.match(migration, /Product "%" is linked to a page on another domain/);
  assert.match(migration, /update public\.page_domains[\s\S]*?set tenant_id = p_target_tenant_id/);
  assert.match(migration, /grant execute on function public\.reassign_page_domains_tenant\(uuid\[\], uuid\) to authenticated/);

  // Ordering-paradox handling: constraint trigger disabled and re-enabled inside the transaction
  assert.match(migration, /disable trigger enforce_event_page_link/);
  assert.match(migration, /enable trigger enforce_event_page_link/);
  // The disable must be scoped to the trigger's existence (robust against renames)
  assert.match(migration, /tgname = 'enforce_event_page_link'/);

  // Unassignment is rejected; backfill is idempotent; aggregate guard
  // escape-hatch settings are enabled for the duration of the move
  assert.match(migration, /page domains cannot be unassigned/);
  assert.match(migration, /on conflict \(domain_url\) do nothing/);
  assert.match(migration, /set_config\('specy\.event_page_write', 'on', true\)/);
  assert.match(migration, /set_config\('specy\.product_schema_reassignment', 'on', true\)/);
});

test('Registration records the page domain without stealing an already-managed TLD', () => {
  assert.match(registration, /ensurePageDomainRow\(admin, validatedFrontendUrl\.url\.origin, schema\.tenant_id \?\? null\)/);
  assert.match(registration, /\.eq\('domain_url', domainUrl\)[\s\S]*?maybeSingle\(\)/);
  assert.match(registration, /error\.code !== '23505'/);
});

test('Admin endpoints are super-admin-only and map to the registry surfaces', () => {
  const domainsRoute = routes.slice(routes.indexOf("schemas.get('/admin/domains'"));
  assert.match(domainsRoute, /requireAppRole\(c, 'super-admin'\)/);
  assert.match(domainsRoute, /ownership_consistent/);
  // Migration-scope preview powering the dashboard move dialog
  assert.match(domainsRoute, /page_count:/);
  assert.match(domainsRoute, /event_count:/);
  assert.match(domainsRoute, /product_count:/);
  assert.match(domainsRoute, /company_count:/);
  assert.match(domainsRoute, /blocking_company_names:/);
  assert.match(domainsRoute, /blocking_product_names:/);
  assert.match(domainsRoute, /suggested_move_domain_urls:/);
  const patchRoute = routes.slice(routes.indexOf("schemas.patch('/admin/domains/:id'"));
  assert.match(patchRoute, /requireAppRole\(c, 'super-admin'\)/);
  // The RPC must be invoked with the user's bearer token so is_super_admin()
  // sees the custom claim inside the database session (not the service client).
  assert.match(patchRoute, /createSupabaseClient\(c\.env, auth\.token\)[\s\S]*?\.rpc\('reassign_page_domains_tenant'/);
  // Shared entities spanning domains move together: the PATCH accepts
  // additional domain ids that are folded into one array RPC call.
  assert.match(patchRoute, /additional_domain_ids must be an array of page-domain UUIDs/);
  assert.match(patchRoute, /p_domain_ids: domainIds/);
  assert.match(patchRoute, /page domains cannot be unassigned/);
  assert.match(patchRoute, /display_name must be 120 characters or fewer/);
  assert.ok(routes.indexOf("schemas.get('/admin/domains'") < routes.indexOf("schemas.patch('/admin/domains/:id'"));
});

test('The dashboard exposes super-admin TLD management on the /pages cards', () => {
  assert.match(pageService, /export const getAdminPageDomains/);
  assert.match(pageService, /export const updateAdminPageDomain/);
  assert.match(pageService, /groupSchemasByTLD = \(\s*schemas: PageSchema\[\],\s*registryByDomain\?: Map<string, TLDRegistryEntry>/);
  assert.match(pages, /const \{ canViewAdminData \} = usePermissions\(\)/);
  assert.match(pages, /getAdminPageDomains\(\), getVisibleTenants\(\)/);
  assert.match(pages, /onValueChange=\{handleOwnerChange\}/);
  assert.match(pages, /onUpdateDomain\(registry\.id, \{\s*tenant_id: moveTarget\.id,[\s\S]*?additional_domain_ids: \[\.\.\.moveInclude\]/);
  assert.match(pages, /onUpdateDomain\(registry\.id, \{ display_name: renameValue\.trim\(\) \|\| null \}\)/);
  // The owner move uses a migration-scope dialog (no browser confirm), which
  // stays open on failure so the blocking aggregates can be addressed first.
  assert.match(pages, /handleConfirmMove/);
  assert.match(pages, /Migration scope/);
  assert.match(pages, /blocking_company_names/);
  assert.match(pages, /blocking_product_names/);
  assert.match(pages, /suggested_move_domain_urls/);
  assert.match(pages, /moveInclude\.size > 0 \? \{ additional_domain_ids: \[\.\.\.moveInclude\] \} : \{\}/);
  assert.doesNotMatch(pages.slice(pages.indexOf('handleOwnerChange'), pages.indexOf('handleConfirmMove')), /window\.confirm/);
  // Display name wins, the raw domain stays visible as description
  assert.match(pages, /registry\?\.display_name\s*\|\|/);
  // Mixed-ownership drift badge
  assert.match(pages, /Gemischte Zuordnung/);
});

test('Both admin endpoints are registered in the API catalog and feature docs', () => {
  assert.match(apiCatalog, /id: 'page-domains-admin-list'/);
  assert.match(apiCatalog, /id: 'page-domains-admin-update'/);
  assert.match(apiCatalog, /path: '\/api\/schemas\/admin\/domains'/);
  assert.match(apiCatalog, /path: '\/api\/schemas\/admin\/domains\/:id'/);
  assert.match(featuresReadme, /\[`page-domains\.md`\]\(page-domains\.md\)/);
});