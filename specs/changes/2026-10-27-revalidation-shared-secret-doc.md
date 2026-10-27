# 2026-10-27 — Docs: Revalidation Secrets for Multiple Schemas on One Domain

## Summary

Operator question after an events-schema revalidation 401: the revalidation
secret is **per schema**, not per domain. Documented the two supported options
for frontends serving multiple schemas on one TLD (accept every schema's
secret, or register all schemas with one shared secret value) in
`specs/features/frontend-targets.md` ("Multiple schemas on one domain").

## Files Changed

- `specs/features/frontend-targets.md` — new subsection under the draft
  delivery / ISR push documentation

## Impact Analysis

- Database / Runtime / API Surface: none — documentation only. No code change;
  the shared-secret pattern already works because `register_frontend` accepts
  a caller-supplied `revalidation_secret`.
