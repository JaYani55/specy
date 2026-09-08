# 2026-09-08 — Worker Name Prompt in Setup Wizard

## Summary

The first-time setup wizard now prompts for the **Worker name** (the wrangler project name used by `wrangler deploy`) before any Cloudflare interaction. The default is `specy`; users running a second, parallel instance (e.g. a dev instance alongside production) can enter a different name. The prompted value is written into the `"name"` field of the generated `wrangler.jsonc` (never into the committed template `wrangler.default.jsonc`, which keeps `specy` as the documented default).

Motivation: previously the Worker name was fixed by the template (`service-cms`), so running a dev instance and a production instance from separate checkouts deployed under whatever name the template carried, with no way to choose it per-instance during setup.

## Files Added

- `scripts/lib/worker-name.mjs` — pure validation helper: `DEFAULT_WORKER_NAME` (`'specy'`) and `validateWorkerName()` (lowercase letters/digits/hyphens/underscores, must start with a letter, max 58 characters). Extracted from the wizard so it can be unit-tested.
- `tests/workerName.test.mjs` — 10 tests covering accept/reject paths, boundary length (58/59), trimming, and the default value passing its own validation.

## Files Changed

- `wrangler.default.jsonc` — template `"name"` changed from `service-cms` to `specy`, with a comment explaining the wizard sets it and that a second instance is run by choosing a different name.
- `scripts/setup.mjs`
  - New `promptWorkerName()` (@clack `text` prompt, default `specy`) run as Step 0 in `main()`, before Cloudflare login.
  - `patchWranglerJsonc(accountId, storeId, workerName)` — replaces the first `"name": "..."` occurrence in the generated `wrangler.jsonc` with the prompted name. The template contains exactly one `"name"` key, so the targeted replace is safe.
  - Intro "Steps" note and header docblock updated; summary note after patching now lists the Worker name.
  - Validation delegated to `scripts/lib/worker-name.mjs` (imported).
- `specs/platform/supabase-cloudflare-setup.md` — new "Worker name" subsection under the wrangler template chapter; wizard step diagram gains Step 0; Step 4 description mentions the worker name; notes that the `"name"` field is not a placeholder and is independent of the Secrets Store name.

## Impact Analysis

### Database

None — no migrations added or changed.

### Runtime

None — no `api/` or frontend changes. `wrangler.default.jsonc` only affects freshly generated `wrangler.jsonc` files; existing generated configs are untouched.

### API Surface

None.

### Scripts / tooling behavior

- `npm run setup` now asks one additional question ("Worker name (wrangler project name, used in `wrangler deploy`):") with default `specy` — pressing Enter accepts the default, so existing setup flows are unchanged for default users.
- The Secrets Store name remains hardcoded as `specy` in Step 3; a renamed Worker can reuse an existing Secrets Store.

## Verification

- `node --check` on `scripts/setup.mjs` and `scripts/lib/worker-name.mjs` — clean.
- `node --test tests/workerName.test.mjs` — 10/10 pass.
- `npm run build` (includes typecheck + prebuild registry regeneration) — succeeds.
- `npm test` — 91/91 pass (all suites, including the new one).
- Simulated `patchWranglerJsonc` replacement verified: `"name"` correctly rewritten (e.g. `specy-dev`), single `"name"` key in template confirmed via grep.
