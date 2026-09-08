import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSecretsStoreList } from '../scripts/lib/secrets-stores.mjs';

describe('parseSecretsStoreList', () => {
  it('parses legacy pure-JSON array output', () => {
    const raw = JSON.stringify([
      { name: 'specy', id: 'e99a63556266453693946991d25b6947' },
      { name: 'other', id: 'AAAABBBBCCCCDDDDEEEEFFFF00001111' },
    ]);
    const stores = parseSecretsStoreList(raw);
    assert.equal(stores.length, 2);
    assert.deepEqual(stores[0], { name: 'specy', id: 'e99a63556266453693946991d25b6947' });
    // table-style ids are lowercased; JSON path preserves as-is
    assert.equal(stores[1].id, 'AAAABBBBCCCCDDDDEEEEFFFF00001111');
  });

  it('parses JSON objects wrapping the list (stores / result keys)', () => {
    const wrapped = JSON.stringify({ stores: [{ name: 'specy', id: 'e99a63556266453693946991d25b6947' }] });
    assert.equal(parseSecretsStoreList(wrapped)[0].id, 'e99a63556266453693946991d25b6947');
    const result = JSON.stringify({ result: [{ name: 'specy', id: 'e99a63556266453693946991d25b6947' }] });
    assert.equal(parseSecretsStoreList(result)[0].id, 'e99a63556266453693946991d25b6947');
  });

  it('parses the human-readable table emitted by wrangler >= 4.126.0', () => {
    // Real output captured from `wrangler secrets-store store list --remote`
    // (wrangler 4.126.0, which no longer supports --json):
    const raw = [
      '',
      ' ⛅️ wrangler 4.126.0',
      '─────────────────',
      '\u001b[33m▲\u001b[43;33m[\u001b[30mWARNING\u001b[43;33m]\u001b[0m \u001b[1m🚧 `wrangler secrets-store store list` is an open beta command.\u001b[0m',
      '',
      '',
      '🔐 Listing stores...',
      '┌───────────────────────┬──────────────────────────────────┬──────────────────────────────────┬─────────────────────┬─────────────────────┐',
      '│ Name                  │ ID                               │ AccountID                        │ Created             │ Modified            │',
      '├───────────────────────┼──────────────────────────────────┼──────────────────────────────────┼─────────────────────┼─────────────────────┤',
      '│ default_secrets_store │ e99a63556266453693946991d25b6947 │ dd55d263c5a718bd15cebfea9dd36b1e │ 12.1.2026, 16:10:31 │ 12.1.2026, 16:10:31 │',
      '└───────────────────────┴──────────────────────────────────┴──────────────────────────────────┴─────────────────────┴─────────────────────┘',
    ].join('\n');
    const stores = parseSecretsStoreList(raw);
    assert.equal(stores.length, 1);
    assert.deepEqual(stores[0], { name: 'default_secrets_store', id: 'e99a63556266453693946991d25b6947' });
  });

  it('parses multiple table rows', () => {
    const raw = [
      '┌──────┬──────────────────────────────────┬──┐',
      '│ Name │ ID                               │ X│',
      '├──────┼──────────────────────────────────┼──┤',
      '│ one  │ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa │ x│',
      '│ two  │ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb │ y│',
      '└──────┴──────────────────────────────────┴──┘',
    ].join('\n');
    const stores = parseSecretsStoreList(raw);
    assert.deepEqual(
      stores.map((s) => s.name),
      ['one', 'two'],
    );
  });

  it('ignores header/footer rows (non-hex second column)', () => {
    const raw = [
      '│ Name                  │ ID                               │',
      '│ default_secrets_store │ e99a63556266453693946991d25b6947 │',
      '└───────────────────────┴──────────────────────────────────┘',
    ].join('\n');
    const stores = parseSecretsStoreList(raw);
    assert.equal(stores.length, 1);
  });

  it('returns [] for the --json rejection error output of newer wrangler', () => {
    // `wrangler secrets-store store list --remote --json` on wrangler 4.126.0
    // prints this to stderr and exits 0 — no stores can be extracted.
    const raw = 'X [ERROR] Unknown argument: json\n\nwrangler secrets-store store list\n\nList stores within an account [open beta]';
    assert.deepEqual(parseSecretsStoreList(raw), []);
  });

  it('returns [] for empty/null input', () => {
    assert.deepEqual(parseSecretsStoreList(''), []);
    assert.deepEqual(parseSecretsStoreList(null), []);
    assert.deepEqual(parseSecretsStoreList(undefined), []);
  });
});
