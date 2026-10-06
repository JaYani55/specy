import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSchemaPageUrl,
  getExplicitPreviewSlugStructure,
  isPreviewConfigured,
} from '../src/utils/schemaRouting.ts';

const schemaWithTargets = (targets, frontendUrl = 'https://site.example') => ({
  frontend_url: frontendUrl,
  frontend_targets: targets,
});

test('preview slug structure is only defined from an explicit enabled detail-page target', () => {
  assert.equal(
    getExplicitPreviewSlugStructure(schemaWithTargets([
      { target_key: 'blog.detail', kind: 'detail-page', host_path: '/blog/:slug', enabled: true },
    ])),
    '/blog/:slug',
  );
});

test('preview slug structure falls back to nothing without an explicit detail-page target', () => {
  const schema = {
    slug_structure: '/:slug',
    integration_requirements: { required_slug_structure: '/posts/:slug' },
    frontend_url: 'https://site.example',
    frontend_targets: [
      { target_key: 'home.posts', kind: 'collection-slot', host_path: '/', enabled: true },
    ],
  };
  // No implicit fallback to slug_structure or required_slug_structure.
  assert.equal(getExplicitPreviewSlugStructure(schema), null);
  assert.equal(isPreviewConfigured(schema), false);
});

test('disabled detail-page targets do not enable previews', () => {
  const schema = schemaWithTargets([
    { target_key: 'blog.detail', kind: 'detail-page', host_path: '/blog/:slug', enabled: false },
  ]);
  assert.equal(getExplicitPreviewSlugStructure(schema), null);
  assert.equal(isPreviewConfigured(schema), false);
});

test('preview configuration requires a registered frontend URL', () => {
  const schema = schemaWithTargets([
    { target_key: 'blog.detail', kind: 'detail-page', host_path: '/blog/:slug', enabled: true },
  ], null);
  assert.equal(getExplicitPreviewSlugStructure(schema), '/blog/:slug');
  assert.equal(isPreviewConfigured(schema), false);
});

test('preview URLs are built from the explicit preview slug structure', () => {
  assert.equal(
    buildSchemaPageUrl('https://site.example', '/blog/:slug', 'my-post'),
    'https://site.example/blog/my-post',
  );
});
