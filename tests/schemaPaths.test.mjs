import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSchemaApiSlug, getSchemaConsolePath } from '../src/utils/schemaPaths.ts';

test('tenant schemas get tenant-qualified CMS paths while sharing the same local slug', () => {
  const first = { tenant_id: 'tenant-a', tenant_slug: 'acme', slug: 'blog', api_slug: 'api-a' };
  const second = { tenant_id: 'tenant-b', tenant_slug: 'globex', slug: 'blog', api_slug: 'api-b' };

  assert.equal(getSchemaConsolePath(first), '/pages/schema/acme/blog');
  assert.equal(getSchemaConsolePath(second), '/pages/schema/globex/blog');
  assert.equal(getSchemaApiSlug(first), 'api-a');
});

test('legacy and global schema links keep their one-segment API alias', () => {
  assert.equal(
    getSchemaConsolePath({ tenant_id: null, slug: 'blog', api_slug: 'blog' }),
    '/pages/schema/blog',
  );
  assert.equal(getSchemaConsolePath({ slug: 'legacy-schema' }), '/pages/schema/legacy-schema');
});

test('migration preserves existing API slugs and scopes new schema slugs by tenant', () => {
  const migration = readFileSync(new URL('../migrations/202609300001_tenant_local_page_schema_slugs.sql', import.meta.url), 'utf8');
  assert.match(migration, /set api_slug = slug/i);
  assert.match(migration, /page_schemas_tenant_slug_key[\s\S]*on public\.page_schemas \(tenant_id, slug\)/i);
  assert.match(migration, /page_schemas_global_slug_key[\s\S]*where tenant_id is null/i);
  assert.match(migration, /page_schemas_api_slug_key[\s\S]*on public\.page_schemas \(api_slug\)/i);
});

test('tenant and schema path segments are encoded independently', () => {
  assert.equal(
    getSchemaConsolePath({ tenant_id: 'tenant', tenant_slug: 'brand name', slug: 'blog & news' }),
    '/pages/schema/brand%20name/blog%20%26%20news',
  );
});
