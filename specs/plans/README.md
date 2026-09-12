# Plans

Forward-looking plans and drafts. Documents here describe **not-yet-implemented** or
in-progress work; once shipped, the authoritative spec moves to its topical folder and
the implementation is recorded in `../changes/`.

| Document | Purpose |
|---|---|
| [`BINDING-MANAGEMENT.md`](BINDING-MANAGEMENT.md) | Binding Intent & Provisioning System (BIPS) — **implemented 2026-09-09**, implemented contract: [`../platform/binding-management.md`](../platform/binding-management.md) |
| [`CLAIM_MANAGEMENT.md`](CLAIM_MANAGEMENT.md) | Custom JWT claims for build-time plugins — **implemented 2026-09-09**, implemented contract: [`../auth/plugin-claims.md`](../auth/plugin-claims.md) |
| [`DEPLOYMENT-STATE-TRACKING.md`](DEPLOYMENT-STATE-TRACKING.md) | Deployment/installation state registry (core vs plugin ownership, FK to `plugins`, clean uninstall, prod re-check) — **implemented 2026-09-10**, contract: [`../platform/unified-setup-tui.md`](../platform/unified-setup-tui.md) §5 |
| [`docker-installer.md`](docker-installer.md) | Docker installer planning |
| [`managed_secrets_changes.md`](managed_secrets_changes.md) | Managed secrets change plan |
| [`Twilio_SMS_Notif.md`](Twilio_SMS_Notif.md) | Twilio SMS notification planning |
