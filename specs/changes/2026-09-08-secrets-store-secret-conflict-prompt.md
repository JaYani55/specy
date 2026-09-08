# 2026-09-08 — Secrets Store Secret Conflict Prompt in Setup Wizard

## Summary

When the setup wizard tried to create `SUPABASE_SECRET_KEY` in the Secrets Store and a secret with that name already existed, the Cloudflare API rejected the create with `secret_name_already_exists` (code 1003) and the wizard only printed a warning, leaving the secret unverified.

The wizard now detects the conflict and asks how to proceed:

1. **Worker secret (default)** — stores the value via `wrangler secret put <NAME>` on this Worker only, and removes the corresponding `SS_<NAME>` entry from the generated `wrangler.jsonc` `secrets_store_secrets` array (the runtime prefers the Secrets Store binding over the plain Worker secret, so the binding must go for the Worker secret to take effect). A note explains that `/verwaltung/connections` tracks `SUPABASE_SECRET_KEY` only via the Secrets Store, so it will show as unset.
2. **Overwrite** — looks up the existing secret's ID via `wrangler secrets-store secret list <store-id> --remote` and updates the value via `wrangler secrets-store secret update <store-id> --secret-id <id> --value <value> --scopes workers --remote`.
3. **Keep** — leaves the existing Secrets Store value untouched and continues.

The Worker-secret default fits a dev-instance workflow where the dev Worker points at a different Supabase project than production: overwriting the shared store value would break the production Worker.

## Does the storage location matter functionally?

Both paths work at runtime: `createSupabaseAdminClient` (api/lib/supabase.ts) prefers the `SS_SUPABASE_SECRET_KEY` Secrets Store binding and falls back to the plain `env.SUPABASE_SECRET_KEY`. Differences:

- **Secrets Store**: shared across Workers (one store binds into every Worker), manageable/rotatable via `/verwaltung/connections`, project convention.
- **Worker secret**: per-Worker (each Worker needs its own copy), invisible to the `/verwaltung/connections` secret status (which lists `SUPABASE_SECRET_KEY` only via `SS_SUPABASE_SECRET_KEY`).

## Files Added

- `scripts/lib/wrangler-config.mjs` — `removeSecretsStoreBinding(jsonc, bindingName)`: removes a `secrets_store_secrets` entry plus one adjacent comma from wrangler JSONC text so the array stays valid.
- `tests/wranglerConfig.test.mjs` — 4 tests: removal with a remaining sibling entry, removal leaving an empty array, absent binding no-op, and references to the name outside the binding (vars/comments) staying intact.
- `tests/secretsStoreSecretId.test.mjs` — 4 tests for `findSecretIdInTable` (real wrangler 4.126.0 table output): lookup case-insensitivity, unknown name, header-row exclusion, empty input.

## Files Changed

- `scripts/lib/secrets-stores.mjs` — added `findSecretIdInTable(raw, name)` (parses the `secret list` table into Name → 32-hex ID).
- `scripts/setup.mjs`
  - `putSecretsStoreSecret()` now detects `secret_name_already_exists` / code 1003 and delegates to the new `resolveSecretsStoreConflict()` prompt instead of failing with a plain warning.
  - New `findSecretsStoreSecretId()` + `updateSecretsStoreSecret()` (wrangler `secret list`/`secret update` based overwrite path).
  - New `resolveSecretsStoreConflict()` — @clack `select` with Worker secret as default option; the Worker-secret path removes the `SS_<NAME>` binding from `wrangler.jsonc` via `removeSecretsStoreBinding`.
- `specs/platform/supabase-cloudflare-setup.md` — Step 6 diagram note documents the conflict prompt.

## Impact Analysis

### Database

None.

### Runtime

None — setup tooling only.

### API Surface

None.

## Verification

- `npm test` — 106/106 pass (11 new tests across `tests/wranglerConfig.test.mjs` and `tests/secretsStoreSecretId.test.mjs`).
- `node --check scripts/setup.mjs` — clean.
- Real wrangler 4.126.0 `secret list` output used as test fixture (captured read-only).
- Not verified live: the interactive prompt itself and an actual `secret update` call (mutating) — logic paths covered by unit tests on the parsing helpers.
