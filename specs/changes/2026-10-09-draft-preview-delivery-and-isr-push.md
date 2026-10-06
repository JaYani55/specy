# Draft preview delivery & backend ISR push

- **Date:** 2026-10-09
- **Scope:** Pages API (draft delivery), backend revalidation push, preview URL resolution (published vs draft), dashboard preview buttons, schema editor preview slug display
- **Trigger:** Bug report (Akademie Freytag project): draft pages returned 404 on `/preview/:slug`; the pages API served drafts to no caller; no API delivered draft content to frontends; and **no revalidation POSTs were ever observed** at the registered frontend endpoint (verified via `wrangler tail` for MCP `update_page`, direct REST PATCH, and status changes). Additionally, published entries opened the preview slug instead of the public slug.

## Summary

Implements both requested delivery models and fixes the URL-resolution bug:

1. **Pull model (preferred, stateless):** `GET /api/schemas/:slug/pages` and `GET /api/schemas/:slug/pages/:pageSlug` now serve draft pages when the request presents the schema's registered revalidation secret as `Authorization: Bearer <secret>` **and** passes `include_drafts=true` (alias `preview=1`). The response reports `drafts_included: true`. Anonymous callers and user sessions are unchanged (published only, draft pages still 404). The frontend renders `/preview/:slug` statelessly from these endpoints — no cache required.
2. **Push model (ISR-style):** the backend now fires revalidation on **every page create/update and publication transition — drafts included**. New shared helper `api/lib/schemaRevalidation.ts` (`triggerPageRevalidation`) sends one POST per enabled frontend target (preview targets included, so preview routes are rebuilt) to the registered `revalidation_endpoint` with `Authorization: Bearer <secret>`, the legacy `path`/`slug` query parameters, and a JSON payload `{ schema_slug, page_id, slug, status, event, preview_path?, content? }`. A 401 is retried with `?secret=` for legacy frontends. Wired into REST `POST /:slug/pages`, `PATCH /:slug/pages/:pageId` (ordinary **and** event-aggregate paths) and MCP `specy_pages_schemas_create_page` / `specy_pages_schemas_update_page`; the write responses carry a `revalidation` outcome field (`attempted`, `skipped_reason`, `success`, per-target `results`). Pushes never block or fail the write.
3. **Published pages never resolve the preview route:** `specy_pages_schemas_preview` resolves `url_kind: 'preview'` for drafts and `url_kind: 'public'` for published pages (non-preview detail target), failing with `public_route_not_configured` when no public detail route exists. The dashboard follow-suit: the published-page eye button in the schema pages overview now opens the public detail URL; draft pages get a preview button (preview slug). The editor save alert shows the public link for published pages plus an optional preview link, and the preview link for drafts.
4. **First publication guidance:** on publish, revalidation runs (client-side status change already triggered it; the backend now fires too) and failures surface as a warning toast plus the existing revalidation feedback; the save alert for published pages links both the public and preview URL so the frontend build state can be verified directly.
5. **Schema options show the preview slug:** the Schema Editor's frontend-target section displays the effective preview slug structure next to preview targets when `preview_slug_structure` is set, and gains a dedicated bilingual input for `preview_slug_structure` in the integration requirements.

## Files Added

- `api/lib/schemaRevalidation.ts` — shared ISR push (`triggerPageRevalidation`, `pageRevalidationEventName`), secret resolution and Bearer check (`isRevalidationSecretValid`, `resolveRevalidationSecret`).
- `tests/pageRevalidationAndDrafts.test.mjs` — 14 tests: event-name mapping; behavioral push test with stubbed fetch (signed POST per target incl. preview, payload contract, skipped reasons, legacy `?secret=` retry on 401); draft delivery source contracts; manifest documentation; MCP wiring; public-vs-preview resolution.

## Files Changed

- `api/routes/schemas.ts` — `pushPageRevalidation`/`hasDraftDeliveryAccess` helpers; ISR push in page create and page update (ordinary + event aggregate); draft delivery with `include_drafts`/`preview=1` + Bearer secret on the pages list and detail endpoints (`drafts_included` response field).
- `api/routes/mcp.ts` — `pushMcpPageRevalidation` helper; `create_page`/`update_page` fire pushes (status-aware events); preview tool resolves public URL for published pages.
- `api/lib/frontendManifest.ts` — manifest documents `draft_delivery` and the `revalidation.push_payload` contract.
- `src/utils/schemaRouting.ts` — normalization keeps `preview_slug_structure` trimmed.
- `src/features/page-builder/SchemaContentEditor.tsx` — status-aware save alert: draft → preview link; published → public link + optional preview link; warnings for missing public/preview configuration.
- `src/pages/PagesSchemaDetail.tsx` — published eye button opens the public detail URL; new preview button for drafts.
- `src/features/schema-editor/SchemaEditorPage.tsx` — `preview_slug_structure` input field; effective preview slug shown on preview targets.
- `specs/agents/frontend-integration-manifest.md` — draft delivery, push payload contract, backward compatibility.
- `specs/agents/mcp-exposition.md` — preview tool public/preview resolution, page-tool pushes, draft delivery exception.
- `specs/features/frontend-targets.md` — new "Draft delivery & backend ISR push" section; preview resolution now draft-only for published exclusion; error catalog row `public_route_not_configured`.

## Impact analysis

- **Database:** none (no migration; revalidation secrets are reused as-is, legacy plaintext and managed Secrets Store rows both work).
- **Runtime:** one additional admin-client read (revalidation config) and 0–n outbound POSTs per page write; outbound POSTs run with a 10 s timeout each and never throw. Draft delivery adds one secret comparison per draft-flagged request.
- **API surface:** pages list/detail accept `include_drafts=true` / `preview=1` with the revalidation secret Bearer and return `drafts_included`; page create/update responses carry `revalidation`; preview tool emits `url_kind` + `public_url`/`preview_url`.

## Verification

- `npm run typecheck` / `typecheck:api` — clean for all touched files.
- `npm test` — 447 tests pass (14 new).
- `npm run build` — succeeds end to end.

## Note

The dashboard keeps its client-side `triggerRevalidation` calls for immediate user feedback; together with the backend push this can produce two revalidation POSTs per dashboard save. Revalidation POSTs are idempotent (rebuild), so this is acceptable and documented.
