import assert from 'node:assert/strict';
import test from 'node:test';

const targetKeyPattern = /^[a-z][a-z0-9_.-]{0,99}$/;
const normalizePath = (value) => {
  const withSlash = value.trim().startsWith('/') ? value.trim() : `/${value.trim()}`;
  const collapsed = withSlash.replace(/\/+/g, '/');
  return collapsed.replace(/\/$/, '') || '/';
};

const validateCollectionTarget = ({ host_path, placement_key }) => {
  const normalized = normalizePath(host_path);
  if (normalized.startsWith('//') || normalized.includes(':slug') || /\s|[?#\\]|\.\./.test(normalized)) {
    return { ok: false };
  }
  if (!placement_key || !targetKeyPattern.test(placement_key)) return { ok: false };
  return { ok: true, normalized };
};

test('accepts a root collection slot without inventing a slug route', () => {
  const result = validateCollectionTarget({ host_path: '/', placement_key: 'home.posts' });
  assert.deepEqual(result, { ok: true, normalized: '/' });
});

test('rejects fragments and selectors as collection host paths or placement keys', () => {
  assert.equal(validateCollectionTarget({ host_path: '/#posts', placement_key: 'home.posts' }).ok, false);
  assert.equal(validateCollectionTarget({ host_path: '/', placement_key: '#posts' }).ok, false);
  assert.equal(validateCollectionTarget({ host_path: '/', placement_key: 'document.querySelector' }).ok, false);
});

test('rejects dynamic tokens from collection targets', () => {
  assert.equal(validateCollectionTarget({ host_path: '/posts/:slug', placement_key: 'home.posts' }).ok, false);
});

test('preserves arbitrary blog content keys and nested values', () => {
  const content = {
    Content: [{ id: 'content-1', type: 'heading', content: 'Hello' }],
    'Code Block': [{ id: 'code-1', language: 'typescript', frameworks: ['react'], code: 'export {}' }],
    author: { 'author-name': 'Ada', 'author-picture': 'https://cdn.example/ada.png' },
    cards: [{ items: ['one', 'two'], content: [{ id: 'card-1', type: 'text', content: 'Summary' }] }],
  };

  const roundTripped = JSON.parse(JSON.stringify(content));
  assert.deepEqual(roundTripped, content);
  assert.equal(roundTripped.Content[0].content, 'Hello');
  assert.deepEqual(roundTripped.cards[0].items, ['one', 'two']);
  assert.equal(roundTripped.author['author-name'], 'Ada');
});
