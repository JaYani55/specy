# Plans

Forward-looking plans and drafts. Documents here describe **not-yet-implemented** or
in-progress work; once shipped, the authoritative spec moves to its topical folder and
the implementation is recorded in `../changes/`.

| Document | Purpose |
|---|---|
| [`BINDING-MANAGEMENT.md`](BINDING-MANAGEMENT.md) | Binding Intent & Provisioning System (BIPS) — **implemented 2026-09-09**, implemented contract: [`../platform/binding-management.md`](../platform/binding-management.md) |
| [`CLAIM_MANAGEMENT.md`](CLAIM_MANAGEMENT.md) | Custom JWT claims for build-time plugins — **implemented 2026-09-09**, implemented contract: [`../auth/plugin-claims.md`](../auth/plugin-claims.md) |
| [`DEPLOYMENT-STATE-TRACKING.md`](DEPLOYMENT-STATE-TRACKING.md) | Deployment/installation state registry (core vs plugin ownership, FK to `plugins`, clean uninstall, prod re-check) — **implemented 2026-09-10**, contract: [`../platform/unified-setup-tui.md`](../platform/unified-setup-tui.md) §5 |
| [`PRODUCT-INTEGRATION.md`](PRODUCT-INTEGRATION.md) | Proposed service-product rebuild: Pages/MCP integration, independent staff/freelancer/guest identities, optional single-table customer CRM, event catalogue, typed external-service handoff, risk controls and legacy migration/removal |
| [`OBJECTS-PRODUCTS-INTEGRATION.md`](OBJECTS-PRODUCTS-INTEGRATION.md) | Plan-only integration of Product/Event records into the existing Objects schema/data/API/MCP contract, including per-Product custom-field ownership, transactional mirrors, public projection, migration, and rollout tests |
| [`Event-Integration.md`](Event-Integration.md) | Focused event-page integration slice — MVP implemented; snapshot-backed migration, live RLS/persona and frontend deployment verification remain pending |
| [`docker-installer.md`](docker-installer.md) | Docker installer planning |
| [`managed_secrets_changes.md`](managed_secrets_changes.md) | Managed secrets change plan |
| [`Twilio_SMS_Notif.md`](Twilio_SMS_Notif.md) | Twilio SMS notification planning |
| [`apps-merge-conflict-handling.md`](apps-merge-conflict-handling.md) | Multi-user PluraPi workspace sessions: session-scoped staging, retried 3-way merge on `dev` (auto-merge, structured conflicts, non-destructive rebase), save-time stale detection and deploy-side `merge-conflict`/PR fallback — **implemented 2026-10-27 (P0–P5; P6 deferred)**, change record: [`../changes/2026-10-27-apps-merge-conflict-handling.md`](../changes/2026-10-27-apps-merge-conflict-handling.md) |
| [`n8n-nodes-specy-connector-plan.md`](n8n-nodes-specy-connector-plan.md) | n8n connector package (`n8n-nodes-specy`, separate repo in `plugins/`): PAT-based auth, resource/operation matrix for objects/specs/forms/media (+ later pages/products), trigger-node options, and required core adjustments (pagination, list filters, outbound webhooks) |
| [`ai-services-wallets.md`](ai-services-wallets.md) | Revised plan for AI packages/entitlements, a live per-user credit wallet (grant ledger + spend ledger), atomic SQL RPCs, a `pg_cron` deduction job over `plurapi.ai_query_logs`, and super-admin model switching — PluraPi-owned migration `0014` companion, no `plurapi` DDL from core/plugin migrations |
