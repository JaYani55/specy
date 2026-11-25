# 2026-11-25 — n8n Connector Package Scaffold (`n8n-nodes-specy`)

## Summary

Scaffolded the **`n8n-nodes-specy`** n8n community node package as a **separate git repository**
at `plugins/n8n-nodes-specy/` (gitignored, satellite-repo convention — it is not a Specy
plugin: no hooks, registry entries, migrations, or binding intents). The package builds
successfully (`tsc` + icon copy) and ships a first working set of resources against the
existing REST API. The detailed implementation plan (scope, endpoint matrix, phases, trigger
options, and **required core adjustments**) is documented in
[`../plans/n8n-nodes-specy-connector-plan.md`](../plans/n8n-nodes-specy-connector-plan.md).

## Files Added

- `plugins/n8n-nodes-specy/` — new standalone repo (own `.git`, MIT license)
  - `package.json` (n8n manifest), `tsconfig.json`, `index.ts`
  - `credentials/SpecyApi.credentials.ts` — Base URL + PAT (`spc_…`), generic header auth, `genericAuth = true`
  - `nodes/Specy/Specy.node.ts` — resource/operation router (Object, Spec, Form, Media)
  - `nodes/Specy/{Object,Spec,Form,Media}.resource.ts`, `GenericFunctions.ts`, `types.ts`, `specy.svg`
  - `scripts/copy-assets.mjs`, `README.md`, `LICENSE`, `.gitignore`, `.npmignore`
- `specs/plans/n8n-nodes-specy-connector-plan.md` — connector plan (registered in `specs/plans/README.md`)

## Files Changed

- `specs/plans/README.md` — registered the plan document.

## Impact Analysis

- **Database:** none (no core migration; the connector repo is outside the core codebase).
- **Runtime:** none — the connector is a separate npm package consuming the existing `/api/*`
  surface via PAT authentication (transparent Bearer exchange, `specs/auth/api-tokens.md`).
- **API surface:** unchanged. The plan flags future core capabilities as candidates
  (objects list pagination / `updated_since` filter, outbound webhooks) — none implemented
  yet; see plan §7.
- **Licensing:** connector is MIT (separate work); core remains EUPL-1.2. No core imports.
