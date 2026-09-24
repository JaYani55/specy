import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkForR2Delete,
  collectR2Keys,
  isListIncomplete,
  nextPageCursor,
  R2_DELETE_CHUNK,
} from '../plugins/pluradash/api/sync/r2Ops.ts';
import { buildRepoKey, escapeLikePattern, matchesRepoPrefix } from '../plugins/pluradash/api/sync/keys.ts';

test('escapeLikePattern neutralizes SQL LIKE wildcards in literal prefixes', () => {
  // Underscore in repo keys (e.g. owner/my_repo) must match literally, not
  // any character — otherwise a prefix delete could hit foreign repos.
  assert.equal(escapeLikePattern('tenant/ws/user/u/files/apps/owner__my_repo/'),
    'tenant/ws/user/u/files/apps/owner\\_\\_my\\_repo/');
  assert.equal(escapeLikePattern('a%b'), 'a\\%b');
  assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');
  assert.equal(escapeLikePattern('plain/path/file.txt'), 'plain/path/file.txt');
  // The repo prefix built from a real name escapes cleanly and stays usable:
  const prefix = `tenant/ws-1/user/u-1/files/apps/${buildRepoKey('owner/my_repo')}/`;
  const pattern = `${escapeLikePattern(prefix)}%`;
  assert.ok(pattern.endsWith('\\_repo/%'));
  assert.ok(!pattern.includes('__my')); // every literal underscore got escaped
});

const PREFIX = 'tenant/ws-1/user/u-1/files/apps/owner__repo/dev/HEAD/';

/**
 * In-memory R2 list mock. Implements the REAL Workers R2 list API shape:
 * pages carry `list_complete: false` + an opaque top-level `cursor` (there is
 * no `truncated` field in production) — the exact shape `collectR2Keys` must
 * handle. `legacyShape: true` emulates list results that only carry the
 * legacy `truncated` field (no opaque cursor); there the last object key is
 * used as the continuation.
 */
function createFakeR2List(allKeys, { pageSize = 1000, legacyShape = false } = {}) {
  const seenCursors = [];

  function slicePage(start) {
    const page = allKeys.filter((key) => key.startsWith(PREFIX));
    const end = Math.min(start + pageSize, page.length);
    const objects = page.slice(start, end).map((key) => ({ key }));
    const incomplete = end < page.length;
    return legacyShape
      ? { objects, truncated: incomplete }
      : { objects, list_complete: !incomplete, cursor: String(end) };
  }

  return {
    seenCursors,
    list(options = {}) {
      const { cursor } = options;
      if (!cursor) {
        return slicePage(0);
      }
      seenCursors.push(cursor);
      // Opaque cursors (real shape) encode the resume index; legacy cursors
      // are the last object key of the previous page.
      const start = legacyShape ? allKeys.indexOf(cursor) + 1 : Number(cursor);
      return slicePage(start);
    },
  };
}

test('real R2 shape: incomplete pages carry list_complete=false and an opaque cursor', () => {
  const page = { objects: [{ key: 'a' }], list_complete: false, cursor: 'opaque-xyz' };
  assert.equal(isListIncomplete(page), true);
  assert.equal(nextPageCursor(page), 'opaque-xyz');
});

test('nextPageCursor prefers the opaque cursor and falls back to the last key', () => {
  assert.equal(nextPageCursor({ objects: [{ key: 'a' }], list_complete: false, cursor: 'opaque-1' }), 'opaque-1');
  assert.equal(nextPageCursor({ objects: [{ key: 'last-key' }], truncated: true }), 'last-key');
  assert.equal(nextPageCursor({ objects: [{ key: 'a' }], list_complete: true }), undefined);
  assert.equal(nextPageCursor({ objects: [] }), undefined);
});

test('isListIncomplete treats missing list_complete + truncated=false as complete', () => {
  assert.equal(isListIncomplete({ objects: [], truncated: false }), false);
  assert.equal(isListIncomplete({ objects: [] }), false);
});

test('collectR2Keys paginates with the opaque R2 cursor (real API shape)', async () => {
  const allKeys = Array.from({ length: 2500 }, (_, i) => `${PREFIX}file-${String(i).padStart(4, '0')}.txt`);
  const { list, seenCursors } = createFakeR2List(allKeys, { legacyShape: false });

  const keys = await collectR2Keys(list, PREFIX);

  assert.equal(keys.length, 2500);
  // The opaque cursors handed out by R2 must be passed back verbatim —
  // NOT the last object key of the previous page (R2 rejects invalid cursors).
  assert.deepEqual(seenCursors, ['1000', '2000']);
});

test('collectR2Keys falls back to the last object key for legacy truncated pages', async () => {
  const allKeys = Array.from({ length: 1200 }, (_, i) => `${PREFIX}file-${String(i).padStart(4, '0')}.txt`);
  const { list, seenCursors } = createFakeR2List(allKeys, { legacyShape: true });

  const keys = await collectR2Keys(list, PREFIX);

  assert.equal(keys.length, 1200);
  assert.deepEqual(seenCursors, [`${PREFIX}file-0999.txt`]);
});

test('collectR2Keys returns every key when everything fits on one page', async () => {
  const allKeys = Array.from({ length: 42 }, (_, i) => `${PREFIX}file-${i}.txt`);
  const { list, seenCursors } = createFakeR2List(allKeys, { legacyShape: false });

  const keys = await collectR2Keys(list, PREFIX);

  assert.equal(keys.length, 42);
  assert.deepEqual(seenCursors, []);
});

test('chunkForR2Delete splits at the 1000-key R2 delete limit', () => {
  const keys = Array.from({ length: 2300 }, (_, i) => `k-${i}`);
  const batches = chunkForR2Delete(keys);

  assert.equal(R2_DELETE_CHUNK, 1000);
  assert.deepEqual(batches.map((batch) => batch.length), [1000, 1000, 300]);
  assert.equal(batches.flat().length, keys.length);
  assert.deepEqual(chunkForR2Delete([]), []);
});

test('matchesRepoPrefix rejects foreign workspaces/users and LIKE-wildcard collisions', () => {
  const repo = 'owner/my_repo';
  const repoKey = buildRepoKey(repo); // contains '_' — a SQL LIKE wildcard

  assert.equal(matchesRepoPrefix(`tenant/ws-1/user/u-1/files/apps/${repoKey}/dev/HEAD/index.html`, 'ws-1', repo), true);
  assert.equal(matchesRepoPrefix(`tenant/ws-1/user/u-1/files/apps/${repoKey}/dev/manifest.json`, 'ws-1', repo), true);
  assert.equal(matchesRepoPrefix('tenant/ws-2/user/u-1/files/apps/owner__myXrepo/dev/a.txt', 'ws-1', repo), false);
  assert.equal(matchesRepoPrefix('tenant/ws-1/user/u-2/files/apps/other__repo/dev/a.txt', 'ws-1', repo), false);
  // The exact key of a similarly-named repo must NOT match (LIKE over-match guard).
  assert.equal(matchesRepoPrefix('tenant/ws-1/user/u-1/files/apps/owner__myXrepo/dev/a.txt', 'ws-1', repo), false);
  assert.equal(matchesRepoPrefix(null, 'ws-1', repo), false);
  assert.equal(matchesRepoPrefix(undefined, 'ws-1', repo), false);
});