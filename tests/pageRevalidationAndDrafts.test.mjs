import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pageRevalidationEventName, triggerPageRevalidation } from '../api/lib/schemaRevalidation.ts';
import { getDetailPageTarget, getExplicitPreviewSlugStructure, isPreviewConfigured } from '../src/utils/schemaRouting.ts';

describe('page revalidation event names', () => {
  it('maps status transitions to explicit event names', () => {
    assert.equal(pageRevalidationEventName('draft', 'published'), 'published');
    assert.equal(pageRevalidationEventName(undefined, 'published'), 'published');
    assert.equal(pageRevalidationEventName('published', 'draft'), 'unpublished');
    assert.equal(pageRevalidationEventName('published', 'archived'), 'unpublished');
    assert.equal(pageRevalidationEventName('draft', 'draft'), 'updated');
    assert.equal(pageRevalidationEventName('draft', 'archived'), 'archived');
  });
});

describe('backend ISR push (triggerPageRevalidation)', () => {
  const env = { SUPABASE_URL: 'https://supabase.test', SUPABASE_SECRET_KEY: 'service-role' };
  const schema = {
    id: 'schema-1',
    api_slug: 'events',
    frontend_url: 'https://front.example',
    revalidation_endpoint: '/api/revalidate',
    revalidation_secret: 'secret-123',
    revalidation_secret_name: null,
    registration_status: 'registered',
    slug_structure: '/veranstaltungen/:slug',
  };
  const dualTargets = [
    { target_key: 'event-detail', kind: 'detail-page', host_path: '/veranstaltungen/:slug', supports_preview: false },
    { target_key: 'event-preview', kind: 'detail-page', host_path: '/preview/:slug', supports_preview: true },
  ];

  let captured;
  let originalFetch;

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      captured.push({ url, init });
      if (url.includes('/rest/v1/schema_frontend_targets')) {
        return new Response(JSON.stringify(dualTargets), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts a signed push per target (public + preview) with the payload contract', async () => {
    const outcome = await triggerPageRevalidation(env, schema, {
      page_id: 'p-1',
      page_slug: 'testprodukt3',
      status: 'draft',
      event: 'updated',
      content: { title: 'Test' },
    });
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.success, true);

    const revalPosts = captured.filter((entry) => entry.url.startsWith('https://front.example/'));
    assert.equal(revalPosts.length, 2);
    const paths = revalPosts.map((entry) => new URL(entry.url).searchParams.get('path')).sort();
    assert.deepEqual(paths, ['/preview/testprodukt3', '/veranstaltungen/testprodukt3']);
    for (const entry of revalPosts) {
      assert.equal(entry.init.method, 'POST');
      assert.equal(entry.init.headers.Authorization, 'Bearer secret-123');
      const body = JSON.parse(entry.init.body);
      assert.equal(body.schema_slug, 'events');
      assert.equal(body.page_id, 'p-1');
      assert.equal(body.slug, 'testprodukt3');
      assert.equal(body.status, 'draft');
      assert.equal(body.event, 'updated');
      assert.deepEqual(body.content, { title: 'Test' });
    }
    const previewBody = JSON.parse(revalPosts.find((entry) => new URL(entry.url).searchParams.get('path').startsWith('/preview/')).init.body);
    assert.equal(previewBody.preview_path, '/preview/testprodukt3');
  });

  it('never attempts a push for unregistered or unconfigured schemas', async () => {
    const skipped = await triggerPageRevalidation(env, { ...schema, registration_status: 'waiting' }, {
      page_id: 'p-1', page_slug: 'x', status: 'draft', event: 'updated',
    });
    assert.equal(skipped.attempted, false);
    assert.equal(skipped.skipped_reason, 'not_registered');

    const unconfigured = await triggerPageRevalidation(env, { ...schema, frontend_url: null }, {
      page_id: 'p-1', page_slug: 'x', status: 'draft', event: 'updated',
    });
    assert.equal(unconfigured.attempted, false);
    assert.equal(unconfigured.skipped_reason, 'frontend_not_configured');

    const noSecret = await triggerPageRevalidation(env, { ...schema, revalidation_secret: null }, {
      page_id: 'p-1', page_slug: 'x', status: 'draft', event: 'updated',
    });
    assert.equal(noSecret.attempted, false);
    assert.equal(noSecret.skipped_reason, 'secret_missing');
    assert.equal(captured.filter((entry) => entry.url.startsWith('https://front.example/')).length, 0);
  });

  it('retries legacy frontends with the secret as a query parameter on 401', async () => {
    let revalCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/rest/v1/schema_frontend_targets')) {
        return new Response(JSON.stringify([{ target_key: 'default', kind: 'detail-page', host_path: '/:slug', supports_preview: false }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      revalCalls += 1;
      if (revalCalls === 1) return new Response('unauthorized', { status: 401 });
      captured.push({ url, init });
      return new Response('ok', { status: 200 });
    };

    const outcome = await triggerPageRevalidation(env, schema, {
      page_id: 'p-1', page_slug: 'legacy', status: 'draft', event: 'updated',
    });
    assert.equal(outcome.success, true);
    assert.equal(revalCalls, 2);
    assert.match(captured[0].url, /secret=secret-123/);
  });
});

describe('stateless draft delivery (Variante B)', () => {
  const schemasRoute = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
  const revalLib = readFileSync(new URL('../api/lib/schemaRevalidation.ts', import.meta.url), 'utf8');

  it('the pages list and detail endpoints serve drafts to the revalidation secret bearer', () => {
    assert.match(schemasRoute, /const draftsAuthorized = \(c\.req\.query\('include_drafts'\) === 'true' \|\| c\.req\.query\('preview'\) === '1'\)/);
    assert.match(schemasRoute, /hasDraftDeliveryAccess/);
    assert.match(schemasRoute, /\.in\('status', \['published', 'draft'\]\)/);
    assert.match(schemasRoute, /drafts_included: draftsAuthorized/);
  });

  it('draft access requires the schema revalidation secret as Bearer token', () => {
    assert.match(revalLib, /isRevalidationSecretValid/);
    assert.match(revalLib, /secretValue === token/);
  });

  it('the frontend integration manifest documents draft delivery and the push payload', () => {
    const manifest = readFileSync(new URL('../api/lib/frontendManifest.ts', import.meta.url), 'utf8');
    assert.match(manifest, /draft_delivery/);
    assert.match(manifest, /bearer-revalidation-secret/);
    assert.match(manifest, /push_payload/);
    assert.match(manifest, /preview_path/);
  });
});

describe('MCP page tools fire backend revalidation pushes', () => {
  const mcpRoute = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');

  it('update_page and create_page push revalidation with status-aware events', () => {
    assert.match(mcpRoute, /pushMcpPageRevalidation/);
    assert.match(mcpRoute, /event: pageRevalidationEventName\(previousStatus, nextStatus\)/);
    assert.match(mcpRoute, /event: pageRevalidationEventName\(eventPageBefore\?\.status/);
  });

  it('the preview tool resolves the public route for published pages and the preview route for drafts only', () => {
    assert.match(mcpRoute, /const isPublished = page\.status === 'published';/);
    assert.match(mcpRoute, /url_kind: 'public'/);
    assert.match(mcpRoute, /url_kind: 'preview'/);
    assert.match(mcpRoute, /public_route_not_configured/);
  });
});

describe('public vs preview URL resolution (dashboard)', () => {
  const dualSchema = {
    slug_structure: null,
    integration_requirements: {
      required_slug_structure: '/veranstaltungen/:slug',
      preview_slug_structure: '/preview/:slug',
    },
    frontend_targets: [
      { enabled: true, kind: 'detail-page', host_path: '/veranstaltungen/:slug', supports_preview: false },
      { enabled: true, kind: 'detail-page', host_path: '/preview/:slug', supports_preview: true },
    ],
    frontend_url: 'https://front.example',
  };

  it('published entries resolve the non-preview detail target', () => {
    const target = getDetailPageTarget(dualSchema);
    assert.equal(target?.host_path, '/veranstaltungen/:slug');
    assert.notEqual(target?.host_path, getExplicitPreviewSlugStructure(dualSchema));
  });

  it('preview slugs stay exclusive to the dedicated preview target', () => {
    assert.equal(getExplicitPreviewSlugStructure(dualSchema), '/preview/:slug');
    assert.equal(isPreviewConfigured(dualSchema), true);
  });

  it('published pages never resolve the preview route as their detail target', () => {
    const preview = getExplicitPreviewSlugStructure(dualSchema);
    const detail = getDetailPageTarget(dualSchema);
    assert.ok(detail && preview && detail.host_path !== preview);
  });
});
