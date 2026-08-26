# 2026-08-06 — Unified Secrets Storage Guide for Agents

## Summary

Added `specs/agents/unified-secrets-storage.md`, an agent-facing explanation of the
three-tier secrets architecture and how to retrieve existing secrets via Cloudflare.

Contents:

- Decision table: Secrets Store bindings (deploy-time, account-level) vs. Worker
  secrets (`wrangler secret put`) vs. managed secrets (`managed_secrets` table,
  runtime operator input)
- Tier 1: declaring `secrets_store_secrets` bindings in `wrangler.jsonc`, async
  retrieval via `env.SS_*.get()`, inventory retrieval via the Cloudflare API
  (`/secrets_store/stores/{id}/secrets`) or dashboard — noting values are write-only
- Plugin contributions: `wrangler_bindings.secrets_store_secrets` declaration,
  auto-injection by `ensure-registry.mjs`, binding-name dedupe/conflict behavior,
  `SS_` naming convention
- Tier 2: Worker CLI secrets incl. `SECRETS_ENCRYPTION_KEY` (root key for tier 3 and
  media URL HMAC signing)
- Tier 3: AES-GCM encryption scheme of `api/lib/managedSecrets.ts` (SHA-256-derived
  key, `base64(iv).base64(ciphertext)` payload), namespace/name registry
  (`page-revalidation`, `mail`, `s3-sources`), programmatic CRUD via helper functions
- Anti-pattern list (no secrets in git/vars/logs, no re-implemented crypto) and a
  quick-reference "I need X → do Y" table

Derived entirely from existing implementation (`wrangler.default.jsonc`,
`api/lib/managedSecrets.ts`, `specs/platform/core-extension-audio-queues-secrets.md`
§3). No new behavior specified.

## Files Added

- `specs/agents/unified-secrets-storage.md`

## Files Changed

- `specs/agents/README.md` — registered the new document

## Impact Analysis

- **Database:** none.
- **Runtime:** none.
- **API surface:** none.
