# 2026-08-06 — Knowledge-Base Restructure of `/specs` + R2 File Storage Spec

## Summary

Restructured the internal `/specs` directory from a flat file list into a
**Karpathy-style knowledge base with topical folders**. Each folder has a `README.md`
index; `specs/README.md` is the master map with navigation rules for agents.
`AGENTS.md` §2 was rewritten to describe KB navigation instead of the flat file table.

Additionally added a new agent-facing specification
`specs/agents/r2-file-storage.md` documenting the unified R2 file & media storage:
API-vs-binding decision matrix, authentication, endpoint reference,
`tenant_storage_objects` / `tenant_storage_allocations` schema, object key
conventions, and the recommended integration pattern for external microservices.

All moves were performed with `git mv` to preserve file history.

## Files Added

- `specs/README.md` — knowledge-base master index and navigation rules
- `specs/architecture/README.md`, `specs/auth/README.md`, `specs/platform/README.md`,
  `specs/features/README.md`, `specs/plugins/README.md`, `specs/agents/README.md`,
  `specs/plans/README.md` — per-folder indexes
- `specs/agents/r2-file-storage.md` — unified R2 file storage integration guide

## Files Changed

Renames (content unchanged except link fixes):

| Old path | New path |
|---|---|
| `specs/Architecture.md` | `specs/architecture/system-overview.md` |
| `specs/Architecture_Pagebuilder.md` | `specs/architecture/page-builder.md` |
| `specs/architecture-workflow.md` | `specs/architecture/workflows.md` |
| `specs/Auth-docs.md` | `specs/auth/authentication-authorization.md` |
| `specs/OAuth_MCP_Authentication.md` | `specs/auth/oauth-mcp-authentication.md` |
| `specs/multi-tenancy.md` | `specs/platform/multi-tenancy.md` |
| `specs/Supabase_Cloudflare-Setup.md` | `specs/platform/supabase-cloudflare-setup.md` |
| `specs/Core_Extension_AudioBlock_Queues_Secrets.md` | `specs/platform/core-extension-audio-queues-secrets.md` |
| `specs/Forms.md` | `specs/features/forms.md` |
| `specs/TIPTAP_INTEGRATION.md` | `specs/features/tiptap-rich-text.md` |
| `specs/Plugin_Development.md` | `specs/plugins/development.md` |
| `specs/Plugin_Installation.md` | `specs/plugins/installation.md` |
| `specs/EUPL_Compliance.md` | `specs/plugins/eupl-compliance.md` |
| `specs/Specs_MCP_Exposition.md` | `specs/agents/mcp-exposition.md` |
| `specs/Specy_Agent_System_Prompt.md` | `specs/agents/agent-system-prompt.md` |
| `specs/Frontend_Integration_Manifest.md` | `specs/agents/frontend-integration-manifest.md` |
| `specs/Frontend_Prompt_Specs.md` | `specs/agents/frontend-prompt-specs.md` |
| `specs/TODO - Docker Installer.md` | `specs/plans/docker-installer.md` |

Link fixes inside renamed documents: relative cross-links between specs updated to new
paths; repo-root links (`src/`, `api/`, `migrations/`) adjusted for the extra folder
depth. A post-restructure link audit (resolving every relative markdown link against
the repository root) found and repaired broken repo-root references in
`architecture/system-overview.md`, `auth/authentication-authorization.md`,
`auth/oauth-mcp-authentication.md`, and `plugins/installation.md`.

Other updated files:

- `AGENTS.md` — §2 rewritten for the topical-folder knowledge base; spec path references in §3/§4 updated
- `README.md` — EUPL compliance links updated to `specs/plugins/eupl-compliance.md`
- `api/index.ts` — `.well-known/mcp.json` `documentation_url` → `/specs/agents/mcp-exposition.md`
- `api/routes/plugins.ts` — `install_docs` → `/specs/plugins/development.md`

## Impact Analysis

- **Database:** none. The doc references existing tables (`tenant_storage_objects`,
  `tenant_storage_allocations`) from migration `202605250001_tenant_storage_management.sql`.
- **Runtime:** only two string literals changed (`documentation_url`, `install_docs`);
  no behavior change.
- **API surface:** unchanged; documentation URLs served by discovery endpoints now
  point at the new paths.
