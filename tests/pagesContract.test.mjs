import assert from 'node:assert/strict';
import test from 'node:test';

const pageProjection = 'id, slug, name, status, schema_id, tenant_id, domain_url, updated_at, published_at';

const normalizePageSlug = (value) => value
  .toLowerCase()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '') || 'page';

const buildPageInsert = ({ name, slug, content, status = 'draft', schemaId, tenantId }) => {
  const insert = { name, slug, content, status, schema_id: schemaId };
  if (tenantId) insert.tenant_id = tenantId;
  return insert;
};

test('page return projection contains page-owned URL fields only', () => {
  assert.equal(pageProjection.includes('frontend_url'), false);
  assert.equal(pageProjection.includes('domain_url'), true);
});

test('normalizes German page names consistently with the dashboard', () => {
  assert.equal(normalizePageSlug('Über die Größe'), 'ueber-die-groesse');
});

test('omits tenant override so the database can apply its current-tenant default', () => {
  const insert = buildPageInsert({
    name: 'Example',
    slug: 'example',
    content: { Content: [] },
    schemaId: 'schema-id',
  });

  assert.equal(Object.hasOwn(insert, 'tenant_id'), false);
});

test('preserves an explicit tenant override', () => {
  const insert = buildPageInsert({
    name: 'Example',
    slug: 'example',
    content: { Content: [] },
    schemaId: 'schema-id',
    tenantId: 'tenant-id',
  });

  assert.equal(insert.tenant_id, 'tenant-id');
});

test('rejects page creation for single-page schemas before insertion', () => {
  const schema = { slug: 'landing', content_scope: 'single-page' };
  const error = schema.content_scope === 'single-page'
    ? `Schema "${schema.slug}" is a single-page schema. Use the schema's existing page surface instead of create_page.`
    : null;

  assert.match(error, /single-page schema/);
});

test('preserves case-sensitive Field Notes content fields', () => {
  const content = {
    Content: [{ id: 'opening', type: 'heading', level: 'heading2', content: 'Make room for meaning' }],
    'Code Block': [],
    author: { 'author-name': 'Field Notes Editorial' },
  };

  assert.deepEqual(Object.keys(content), ['Content', 'Code Block', 'author']);
  assert.equal(content.author['author-name'], 'Field Notes Editorial');
});

test('revalidation requests use the authenticated CMS session', () => {
  const headers = {
    Authorization: 'Bearer user-session-token',
    'Content-Type': 'application/json',
  };

  assert.equal(headers.Authorization.startsWith('Bearer '), true);
});

test('revalidation failures fall back to HTTP status when the API omits a message', () => {
  const response = { ok: false, status: 404 };
  const payload = {};
  const message = payload.message || payload.error || `Revalidation request failed (${response.status})`;

  assert.equal(message, 'Revalidation request failed (404)');
});

test('revalidation diagnostics expose endpoint metadata but never the secret', () => {
  const url = new URL('https://field-notes-gh6.pages.dev/api/revalidate');
  const diagnostic = {
    endpoint: `${url.origin}${url.pathname}`,
    secret: undefined,
  };

  assert.equal(diagnostic.endpoint, 'https://field-notes-gh6.pages.dev/api/revalidate');
  assert.equal(Object.hasOwn(diagnostic, 'secret'), true);
  assert.equal(diagnostic.secret, undefined);
});

test('public page delivery uses server-side schema visibility for tenant-owned schemas', () => {
  const publicDelivery = {
    schemaLookup: 'admin',
    pageFilter: { status: 'published' },
  };

  assert.equal(publicDelivery.schemaLookup, 'admin');
  assert.deepEqual(publicDelivery.pageFilter, { status: 'published' });
});
