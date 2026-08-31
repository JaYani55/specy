# PluraDash GitHub App — PKCS#1 → PKCS#8 Private Key Fix

Date: 2026-08-27

## Summary

Fixes the GitHub App integration failing to mint installation tokens and list
organization repositories. The root cause was a private-key format mismatch:
`@octokit/auth-app` (via `universal-github-app-jwt`) only accepts **PKCS#8**
keys (`-----BEGIN PRIVATE KEY-----`), but the key stored in the Cloudflare
Secrets Store was in legacy **PKCS#1** format (`-----BEGIN RSA PRIVATE KEY-----`).

The error surfaced when clicking "Token prüfen" in the super-admin panel:

```
[universal-github-app-jwt] Private Key is in PKCS#1 format, but only PKCS#8 is supported.
```

The fix makes `normalizePrivateKey()` auto-convert PKCS#1 keys to PKCS#8 at
runtime, so either key format can be stored and the integration still works.

## Files Changed

- `plugins/pluradash/api/githubAuthService.ts` — added pure-JS PKCS#1 → PKCS#8
  conversion (`convertPkcs1ToPkcs8`, `encodeDerLength`, `pemToDer`, `derToPem`)
  and wired it into `normalizePrivateKey()`.

## Impact Analysis

### Runtime

- `normalizePrivateKey()` now detects `BEGIN RSA PRIVATE KEY` and converts it to
  a PKCS#8 `PrivateKeyInfo` structure before handing the key to `createAppAuth`.
- PKCS#8 keys are unaffected and pass through unchanged.
- The conversion is pure JavaScript (DER length encoding + `atob`/`btoa`), so it
  runs in Cloudflare Workers without Node `crypto`.

### API surface

- No endpoint signatures or response shapes changed. The existing
  `POST /admin/github/token` and `GET /admin/github/repos` endpoints now succeed
  when a PKCS#1 key is configured.

### Database

- No database changes.

### Security

- No change to key storage or exposure. The private key is still resolved only
  from the Secrets Store binding or Worker secrets and never sent to the browser.

## Verification

- Validated the conversion against a real 2048-bit RSA key: the output is a valid
  PKCS#8 key whose public key matches the original PKCS#1 key exactly.
- Type-checked the changed file against `tsconfig.node.json` with no errors.

## Related

- Feature doc: [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md)
- Original integration: [`2026-08-26-pluradash-github-app-integration.md`](2026-08-26-pluradash-github-app-integration.md)
