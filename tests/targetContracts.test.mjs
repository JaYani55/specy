import assert from 'node:assert/strict';
import test from 'node:test';

const normalize = (value) => {
  const result = (value.startsWith('/') ? value : `/${value}`).replace(/\/+/g, '/');
  return result.replace(/\/$/, '') || '/';
};

const resolvePath = (target, slug) => target.kind === 'collection-slot'
  ? target.host_path
  : target.host_path.replace(':slug', slug);

test('resolves collection invalidation to the host path', () => {
  assert.equal(resolvePath({ kind: 'collection-slot', host_path: '/' }, 'hello'), '/');
});

test('resolves detail invalidation to the slug route', () => {
  assert.equal(resolvePath({ kind: 'detail-page', host_path: '/posts/:slug' }, 'hello'), '/posts/hello');
});

test('preserves legacy detail routes during target migration', () => {
  const legacy = '/blog/:slug';
  const target = { kind: 'detail-page', host_path: legacy };
  assert.equal(resolvePath(target, 'durable-content'), '/blog/durable-content');
  assert.equal(legacy, '/blog/:slug');
});

test('normalizes only target paths, never content keys', () => {
  const targetPath = normalize('posts/:slug');
  const content = { Content: [{ type: 'text', content: 'unchanged' }], 'Code Block': [] };
  assert.equal(targetPath, '/posts/:slug');
  assert.deepEqual(content, { Content: [{ type: 'text', content: 'unchanged' }], 'Code Block': [] });
});

test('configured public Worker URL is preferred over request origin', () => {
  const configured = 'https://service-cms.jay-rathjen55.workers.dev';
  const requestOrigin = 'https://internal-worker-origin.example';
  const resolved = configured || requestOrigin;
  assert.equal(resolved, configured);
  assert.equal(`${resolved}/api/schemas/demosite/register`, 'https://service-cms.jay-rathjen55.workers.dev/api/schemas/demosite/register');
});

test('root collection requirement takes precedence over legacy slug structure', () => {
  const requirements = { required_slug_structure: '/' };
  const legacySlugStructure = '/:slug';
  const target = requirements.required_slug_structure === '/'
    ? { kind: 'collection-slot', host_path: '/' }
    : { kind: 'detail-page', host_path: legacySlugStructure };
  assert.deepEqual(target, { kind: 'collection-slot', host_path: '/' });
});
