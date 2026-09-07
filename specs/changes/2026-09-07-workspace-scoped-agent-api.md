# 2026-09-07 — Workspace-Scoped Agent API Endpoints

## Summary

Investigation triggered by the question "why is the workspace name not part of
the API answer endpoint URL?" revealed an inconsistency in how workspace
linking is handled across form endpoints:

- **Share endpoints** (`/api/forms/share/:tenantName/:shareSlug`,
  `/s/…`) include the workspace and actively validate it —
  `getFormByShareSlug` matches the segment against the form's tenant
  (name, slug, or organization slug); a mismatch returns 404.
- **Agent/REST endpoints** (`GET /api/forms/:identifier`,
  `POST /api/forms/:identifier/answers`, `/upload`) resolved forms **only** by
  globally unique slug/UUID with **no workspace segment and no tenant
  validation**. Workspace binding flowed implicitly through the form record,
  but the URL was not self-describing and the endpoint ignored the workspace
  dimension entirely.

### Changes

1. **New workspace-scoped API routes** (primary URLs for frontend/agent
   integration; legacy slug-only routes remain for backward compatibility):
   - `GET /api/forms/:tenantName/:formSlug` — form metadata + schema
   - `POST /api/forms/:tenantName/:formSlug/answers` — submit answers
   - `POST /api/forms/:tenantName/:formSlug/upload` — multipart file upload

   Resolution (`getApiFormByTenantAndSlug`, admin lookup) matches the slug and
   validates the tenant segment via the shared `formMatchesTenantSegment`
   helper (tenant name / slug / organization slug, normalized the same way as
   share segments). Mismatch → 404. All existing route-level semantics
   (`api_enabled` → 403, `requires_auth` → 401) are preserved.

2. **Refactoring + consistency fix**: the three answer-submission pipelines
   (identifier, share, short-share) were near-identical duplicates; they now
   share `submitFormAnswers()`. This also closes a real gap: the
   **poll deadline check existed only on the share routes** — closed polls
   previously still accepted answers through the identifier/agent API route;
   now the deadline is enforced on every channel. `submitted_via: 'page'`
   body-declaration semantics for page-embedded submissions are preserved.

3. **Agent-API card** (form editor) displays the workspace-scoped URL
   `POST {API_URL}/api/forms/{tenantSlug}/{formSlug}/answers`.

### Follow-up: workspace name instead of (legacy id-like) slug

Legacy workspaces carry a backfilled slug derived from the creator's user
UUID (`workspace-<uuid-without-dashes>`, see the tenant backfill migration),
so the displayed URL showed an id-like segment. The endpoint segment now uses
the raw workspace **name** (`tenants.name`) — which the server-side tenant
matching validates against — normalized with a client-side
`normalizeTenantNameSegment` that mirrors the API logic exactly. The raw name
is exposed as an additive `tenant_name` field on `TenantOption`
(`option.name` remains the organization-preferring display name).

## Files Changed

- `api/routes/forms.ts` — `formMatchesTenantSegment` helper (extracted from
  `getFormByShareSlug`); `getApiFormByTenantAndSlug` resolver; shared
  `submitFormAnswers` pipeline (schema validation, poll-deadline enforcement,
  answer validation, insert, notification enqueueing); tenant-scoped
  GET/upload/answers routes; identifier + both share answer handlers
  refactored onto the shared pipeline.
- `src/pages/FormEditor.tsx` — answer endpoint URL now
  `{API_URL}/api/forms/{normalizedWorkspaceName}/{formSlug}/answers`.
- `src/services/tenantService.ts` — exported `normalizeTenantNameSegment`
  (mirrors the API segment normalization); additive `TenantOption.tenant_name`
  (raw `tenants.name`, since `option.name` prefers the organization name).
- `src/lib/apiCatalog.ts` — new catalog entry `forms-api-submit-tenant`.
- `specs/changes/2026-09-07-workspace-scoped-agent-api.md` (this document).

## Database impact

None.

## API surface impact

- Additive: three new tenant-scoped routes. Legacy routes unchanged in
  behavior **except** that `POST /api/forms/:identifier/answers` now also
  enforces the poll deadline (bug fix — closed polls no longer accept
  submissions through the agent API).
- Route-matching notes: literal share prefixes (`share`, `s`) are registered
  first and keep precedence; no conflicts with the new 3-segment routes.

## Verification

- `typecheck:api` / `typecheck` — clean; `npm test` 81/81; `npm run build`
  succeeds.
- Not verified live here: submit through the new tenant URL for a matching
  and a mismatching workspace (expect 200 / 404), verify closed-poll 403 on
  the legacy identifier route, and page-embed submissions
  (`submitted_via: 'page'`) still persist correctly.
