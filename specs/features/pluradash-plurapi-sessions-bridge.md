# PluraDash ↔ PluraPi-Sessions Bridge

> **Moved.** This document has been consolidated into the canonical,
> single bridge entry point:
>
> **[`specs/agents/plurapi-agent-bridge.md`](../agents/plurapi-agent-bridge.md)**
>
> It covers: architecture, the `POST /v1/builds` push contract (incl. the
> JWT-tenant push target), DO read proxies, token realms, the
> `pluradash.build_targets` data model, worker configuration, and the
> **triage playbook** (Worker-router-404 vs. DO-miss, known failure
> signatures, verification flow).
>
> Feature-level neighbours: [`pluradash-github-app-integration.md`](pluradash-github-app-integration.md)
> (GitHub Apps admin panel), [`pluradash-r2-sync-engine.md`](pluradash-r2-sync-engine.md)
> (workspace sync).
