# 2026-09-08 — Secrets Store List: Wrangler `--json` Compatibility Fix

## Summary

The setup wizard reported "No Secrets Stores found" even when a store existed. Root cause: `wrangler secrets-store store list` is an **open-beta command whose `--json` flag was removed in newer wrangler versions** (confirmed broken on wrangler 4.126.0 — the command prints `Unknown argument: json` to stderr and still exits 0). The wizard swallowed the error, `JSON.parse` failed silently, and `stores` ended up as an empty array.

The wizard now tries `--json` first (older wrangler versions) and, when the result doesn't look like JSON, re-runs the command without the flag and parses the human-readable table output instead.

## Files Added

- `scripts/lib/secrets-stores.mjs` — `parseSecretsStoreList(raw)`: parses both legacy JSON output (array, or objects wrapping the list under `stores`/`result`) and the box-drawing table emitted by newer wrangler. Table rows are matched by requiring a 32-hex-character ID in the second column, so header/footer rows and warning banners are ignored.
- `tests/secretsStores.test.mjs` — 7 tests: legacy JSON array, `{stores: [...]}`/`{result: [...]}` wrappers, real table output captured from wrangler 4.126.0 (including ANSI warning banner), multiple rows, header/footer exclusion, the `--json` rejection error output, and empty/null input.

## Files Changed

- `scripts/setup.mjs` — `stepSecretsStore()` no longer parses the `--json` output in isolation:
  1. Runs `wrangler secrets-store store list --remote --json`.
  2. If the output is empty or doesn't start with `[`/`{` (flag rejected — the command exits 0 while printing the error to stderr, which `wranglerSilent` discards), re-runs `wrangler secrets-store store list --remote`.
  3. Parses the combined result via `parseSecretsStoreList()`.

## Impact Analysis

### Database

None.

### Runtime

None — setup tooling only.

### API Surface

None.

### Notes / known limitations

- The table parser relies on the current column layout (name in column 1, ID in column 2). If Cloudflare changes the open-beta output format again, the fallback must be adjusted — the unit tests contain a captured real-output sample to guard against regressions.
- `createStore()` still extracts the new store ID by scanning for a 32-hex string in `wrangler secrets-store store create` output; this was not affected by the observed breakage but follows the same fragile pattern.

## Verification

- `node --test tests/secretsStores.test.mjs` — 7/7 pass.
- End-to-end against the real wrangler 4.126.0 on the dev machine: the wizard's fetch flow now resolves the existing store (`default_secrets_store`, `e99a63556266453693946991d25b6947`) correctly.
- `npm test` — full suite green (98 tests).
- `node --check scripts/setup.mjs` — clean.
