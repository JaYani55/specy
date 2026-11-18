# PluraPi handoff + AI credit runtime alignment

Date: 2026-11-17

## Summary

Added the PluraPi-side handoff document for the AI credit billing integration and
aligned the remaining runtime paths with the wallet/ledger model introduced by
PluraDash migration `033`.

1. **New handoff document** — `migrations/plurapi/HANDOFF.md` documents, for the PluraPi
   maintainers: the prerequisites (`0011`/`0013`/manual `0014`), the exact fields the
   deduction job reads from `plurapi.ai_query_logs`, the service-attribution contract on
   `plurapi.pluracon_models`, the `can_use_service` pre-flight semantics, idempotency and
   log-immutability rules, deploy/rollback order, and verification queries.
2. **`migrations/plurapi/README.md`** — registers `HANDOFF.md` in the manual-folder index.
3. **Plan correction (§10)** — the backfill no longer caps `lifetime_spent` /
   `greatest(0, …)`. The implemented `033` seeds negative opening balances so the
   post-paid wallet is visible from day one and `balance = credited − spent` holds
   literally.

The PluraDash plugin-side implementation of the same feature (migration `033`, admin
API/UI, wallet-shaped `aiCredits.ts`/`aiCreditMath.ts`, credits-only `AiPage`,
`record_ai_cost` routing, entitlement pre-flight and §8b seeding) is documented in the
plugin repository:
`plugins/pluradash/specs/changes/2026-11-17-ai-services-wallets.md`.

## Files Added

- `migrations/plurapi/HANDOFF.md`
- `specs/changes/2026-11-17-plurapi-handoff.md` (this record)

## Files Changed

- `migrations/plurapi/README.md` — added `HANDOFF.md` to the file table
- `specs/plans/ai-services-wallets.md` — §10 backfill corrected to allow negative
  opening balances (no `least(credited, raw_spent)` cap)
- `specs/plans/ai-services-wallets.md` — §9.1/§9.2 `can_use_service` semantics: `false`
  only for an explicit `is_enabled = false` row; a missing row is grandfathered and RPC
  errors fail open

## Impact Analysis

### Database

No schema change in this repository. The handoff documents the contract the manual
PluraPi `0014` script and the PluraDash `033` migration depend on, and the corrected §10
matches the SQL that `033` already ships (no cap on `lifetime_spent`).

### Runtime

No runtime code change. The handoff is the operational contract for the `pg_cron`
deduction job that bills `plurapi.ai_query_logs`.

### API surface

No change. Documents `pluradash.can_use_service(uuid, text)` for the PluraPi pre-flight.

## Compliance

- `migrations/plurapi/` remains a manual, unregistered folder (not in
  `scripts/lib/migration-order.mjs`, not applied by setup/update), mirroring
  `migrations/Auth/`.
- No DDL is executed against the `plurapi` schema from this repository; the handoff
  explicitly assigns that ownership to PluraPi.
- Plugin-owned changes are recorded in the plugin repository, not here.
