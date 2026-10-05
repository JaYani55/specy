import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const objectRoute = readFileSync(new URL('../api/routes/objects.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/components/layout/AppSidebar.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/objectService.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/ObjectDatastreams.tsx', import.meta.url), 'utf8');

describe('Object datastream inventory', () => {
  it('returns every RLS-visible Object, including generated Product mirrors and archived status', () => {
    assert.match(objectRoute, /objects\.get\('\/datastreams'/);
    assert.match(objectRoute, /select\('id, name, slug, description, object_type, status, requires_auth, api_enabled, share_enabled, tenant_id, updated_at'\)/);
    assert.match(objectRoute, /source_product_id/);
    assert.match(objectRoute, /kind: 'product'/);
    assert.match(objectRoute, /kind: 'object'/);
    assert.doesNotMatch(objectRoute.slice(objectRoute.indexOf("objects.get('/datastreams'"), objectRoute.indexOf('// HEAD /api/objects')), /\.neq\('status', 'archived'\)/);
  });

  it('provides an anonymous HEAD availability probe using the same public Object gates', () => {
    assert.match(objectRoute, /objects\.on\('HEAD', '\/:idOrSlug'/);
    assert.match(objectRoute, /\.eq\('status', 'published'\)\.eq\('api_enabled', true\)\.eq\('requires_auth', false\)/);
    assert.match(service, /Deliberately omit the CMS bearer token[\s\S]*method: 'HEAD'/);
  });

  it('registers an Objects submenu and protected Datastreams dashboard route', () => {
    assert.match(sidebar, /Datastreams/);
    assert.match(sidebar, /\/objects\/datastreams/);
    assert.match(app, /path="\/objects\/datastreams"/);
    assert.match(page, /Generated Product streams|Generierte Produkt-Datastreams/);
    assert.match(page, /HTTP 404 — unerwartet/);
  });
});
