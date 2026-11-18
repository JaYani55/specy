# AI credit system documentation (knowledge base + audit)

Date: 2026-11-17

## Summary

The AI credit system (PluraDash migration `033` and its runtime integration) is
applied and working. This change documents it in the knowledge base and adds a
dedicated audit document. The PluraPi repository was reviewed (read-only) to
verify the gateway-side business logic before documenting it.

## Files Added

- `specs/features/ai-credit-wallets.md` — technical documentation: data model
  (wallet, grant ledger, charge ledger, entitlements, packages, settings),
  ledger invariants, atomic RPCs, pg_cron settlement, migration/backfill
  behaviour, RLS, API/UI surface, runtime integration points, reconciliation
  SQL and deliberate non-goals.
- `specs/audits/README.md` — index for the new topical folder.
- `specs/audits/AI-CREDIT-WALLETS-AUDIT.md` — audit-oriented documentation:
  business rules (post-paid model, entitlement, idempotent settlement, pricing
  evidence, exception handling), roles and responsibilities, an audit-trail
  map, five BPMN-style Mermaid flowcharts (credit lifecycle, entitlement
  pre-flight, batch settlement, administrative intervention, reconciliation),
  executable key controls, residual risk assessment and compliance notes.

## Files Changed

- `specs/README.md` — registered the `audits/` folder in the folder map and
  added quick-answer entries for the credit system (audit + technical view).
- `specs/features/README.md` — registered `ai-credit-wallets.md`.
- `specs/plans/ai-services-wallets.md` — status changed from *plan (not
  implemented)* to *implemented*, with pointers to the live documentation.

## Findings from the PluraPi repository review (read-only)

The gateway side is further along than the handoff assumed; the documentation
reflects the verified state:

1. **Entitlement pre-flight is implemented** (`plurapi-sessions/src/ai-proxy.ts`):
   flag-gated via `PLURADASH_ENTITLEMENT_CHECK` (default **off**, enabling
   independent deployment), calls `can_use_service` with the service key,
   returns `402` only on an explicit revocation, fails open on transient
   errors, and never consults the balance.
2. **Refused requests are never billed** — a blocked request writes no
   `ai_query_logs` row, so refusal leaves no financial trace.
3. **Consistent service classification** — the pre-flight derives the service
   from the request's Pluracon shell (`architekt` → `planning`,
   `arbeiter`/`kreativ` → `coding`, otherwise `coding`), mirroring the
   settlement job's fallback chain.
4. **Price evidence** — each usage record carries `cost_source`
   (`openrouter-usage` exact metering vs. `computed-pricing` fallback), which
   settlement uses and auditors can rely on.
5. **Governance** — the `0014` SQL is canonical in the PluraPi repository
   (`plurapi-engine/migrations/`), where the handoff document is mirrored next
   to it; the Specy copy is for discoverability.
6. **Completeness risk identified** — if the gateway's Supabase service
   credential is missing, logging (the settlement input) is silently disabled
   (start-up warning only). Recorded as a residual risk in the audit document;
   no code change made (PluraPi-side).

## Impact Analysis

### Database

None — documentation only.

### Runtime

None — documentation only. The PluraPi repository was **not modified**.

### API surface

None.

## Compliance

- No core/plugin boundary changes; documentation only.
- New topical folder `specs/audits/` registered in `specs/README.md` per
  AGENTS.md §2.
