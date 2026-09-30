# 2026-09-30 — PEM Key → Worker Secret Import Script

## Summary

New maintenance script `npm run pemkey` (`scripts/pemkeyworkersecret.mjs`): a TUI that stores a local PEM private key file (e.g. a GitHub App `.pem` private key) as a Cloudflare Worker secret via `wrangler secret put`.

Motivation: manually pasting key material into the dashboard/terminal is error-prone — smart quotes, JSON escaping (`\n` embedded inside the base64 payload), re-wrapped lines or truncated padding all produce a value whose base64 body fails Workers' `atob()` at key-parse time (symptom: `atob() called with invalid base64-encoded data` from e.g. the pluradash GitHub App auth service). The script reads the key **directly from the file**, so no clipboard round-trip can corrupt it, and validates it with the same rules the Worker enforces **before** uploading.

Flow:

1. Prompt for the secret name to add or replace (default `GITHUB_PRIVATE_KEY`, validated as a Cloudflare secret identifier).
2. Prompt for a local file path — Windows "Copy as path" surrounding quotes and `~` are normalized; relative paths resolve against the repo root.
3. Strict validation mirroring Workers' `atob()`: PEM armor present + matching BEGIN/END labels, base64 body within the alphabet (`A–Z a–z 0–9 + / =`), length divisible by 4, ≤ 2 terminal `=` signs, DER body decodes. Reports key format (PKCS#1 vs PKCS#8), byte length and a sha256 fingerprint. Upload aborts on any violation — nothing is uploaded on a failed validation.
4. After explicit confirmation (the upload replaces an existing secret value), the exact file bytes are piped into `npx wrangler secret put <name>`.

The key value itself is never printed, logged or stored anywhere.

## Files Added

- `scripts/pemkeyworkersecret.mjs` — the script; exports pure helpers `validateSecretName()`, `normalizeInputPath()`, `analyzePem()` for unit testing.
- `tests/pemkeyWorkerSecret.test.mjs` — unit tests: PKCS#1/PKCS#8 classification, BOM tolerance, CRLF line endings, armor/marker checks, rejection of non-base64 characters (the exact `atob()` failure class this guards against), truncation detection, secret-name validation, path normalization.

## Files Changed

- `package.json` — new npm script `pemkey`.
- `specs/README.md` — no change (no new specs folder; this change record suffices — the script is tooling, documented here).

## Impact Analysis

- **Database**: none.
- **Runtime**: none — offline maintenance tooling; requires wrangler auth (`npx wrangler login` or `CLOUDFLARE_API_TOKEN`).
- **API surface**: none.
- **Security**: the script only transmits the key value to Cloudflare via `wrangler secret put` (encrypted worker secret); it never persists or displays it. PKCS#1 keys are uploaded as-is — the consuming services normalize PKCS#1 → PKCS#8 at runtime.