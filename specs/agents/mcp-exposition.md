# MCP Registry And Exposure

This document describes the MCP registry and exposure model used by the CMS.

It covers:

- how MCP entries are stored
- how they move from draft to published
- how public and closed access work
- how schema attachments relate to MCP entries
- how REST and MCP clients discover them

This document reflects the codebase state as of April 18, 2026.

## 1. Purpose

The CMS contains an MCP registry in the admin UI at `/mcp`.

Each registry row is a reusable MCP entry stored in `llm_specs`.
An MCP entry can be used on its own through the MCP registry, and it can also be attached to a page schema for schema-specific workflows.

The key point is:

- MCP exposure is driven by explicit fields on the entry itself.
- There are no hidden exposure flags such as `metadata.mcp_exposed` or `metadata.global_discovery`.

## 2. MCP Entry Model

The `llm_specs` table remains the storage layer for MCP entries.

Relevant fields:

- `slug`: MCP tool name and stable identifier
- `name`: display name in the CMS
- `description`: summary for discovery and operator context
- `definition`: JSON payload for the MCP contract
- `llm_instructions`: optional guidance for agents
- `status`: lifecycle state
- `is_public`: access mode
- `is_main_template`: optional template marker for editors
- `tags`: search and grouping metadata

### 2.1 Status

The operational MCP lifecycle is:

- `draft`: visible to authenticated editors only, never exposed through public MCP discovery
- `published`: eligible for REST and MCP discovery

The database still supports `archived` for legacy cleanup workflows, but exposure is based on `draft` versus `published`.

### 2.2 Access

Access is derived directly from `is_public`:

- `is_public = true`: the MCP entry is `public`
- `is_public = false`: the MCP entry is `closed`

Rules:

- Published public MCP entries are discoverable without authentication.
- Published closed MCP entries require a valid Supabase auth JWT in `Authorization: Bearer <token>`.
- Draft entries are not discoverable through MCP regardless of access mode.

## 3. Registration And Exposure Process

### 3.1 Creating a custom MCP entry

1. Open the MCP section in the CMS.
2. Create a new MCP entry.
3. Fill in `name`, `slug`, `description`, `definition`, and optional `llm_instructions`.
4. Choose access mode:
   - public
   - closed
5. Save as draft or publish immediately.

### 3.2 When a custom MCP entry becomes available

An MCP entry is registered as a direct MCP tool when both conditions are true:

- `status = 'published'`
- the caller is allowed to see it

Caller visibility works like this:

- anonymous caller: only published public MCP entries
- authenticated caller with valid Supabase JWT: published public plus published closed MCP entries

No schema attachment is required for a custom MCP entry to appear in the MCP registry.
No extra metadata toggle is required.
No Worker restart is required.

## 4. REST And MCP Discovery

### 4.1 REST discovery

Public discovery endpoints continue to live under `/api/specs` for compatibility.

- `GET /api/specs` without auth returns published public MCP entries
- `GET /api/specs/:slug` without auth resolves published public MCP entries
- authenticated requests can access closed entries through the same endpoints with a valid Supabase JWT

### 4.2 MCP discovery

The MCP server is exposed at `/mcp`.

Built-in tools remain available:

- `start_here`
- `create_schema` _(authenticated)
- `start_schema_registration`
- `create_page`
- `new_schema` _(authenticated compatibility alias)
- `list_available_tools`
- `get_spec_definition`
- `list_schemas`
- `get_schema_spec`
- `register_frontend`
- `check_health`
- `specy_pages_schemas_list`, `specy_pages_schemas_get`
- `specy_pages_schemas_list_pages`, `specy_pages_schemas_get_page`
- `specy_pages_schemas_create_page`, `specy_pages_schemas_update_page`
- `specy_pages_schemas_update_definition`, `specy_pages_schemas_update_system_data`, `specy_pages_schemas_replace_frontend_targets`
- `specy_pages_schemas_preview`
- `specy_products_list`, `specy_products_create`, `specy_products_get`, `specy_products_update`, `specy_products_publish`, `specy_products_archive`, `specy_products_delete`

The `specy_products_*` tools form the **`specy-products`** aggregate workflow and require an explicit tenant UUID. They share REST aggregate operations and never use generic page CRUD for product schemas. Event schemas use the existing `specy_pages_schemas_create_page` / `specy_pages_schemas_update_page` tools with event-specific fields and tenant/revision checks; there is no separate event collection tool family.

The `specy_pages_schemas_*` tools form the hierarchy **`specy-pages > schemas`**. They expose schema inspection, schema-scoped page/content CRUD, revision-checked schema definition updates, and controlled system metadata repair. Page writes use the authenticated Supabase session/RLS; they cannot reassign schema or tenant ownership. `update_definition` requires `expected_revision`, preserves the uploaded schema JSON, and reports conflicts instead of overwriting a newer definition. Ordinary `page` schemas use page CRUD; `event` schemas dispatch through the same create/update page tools only when event details, explicit tenant context, and expected schema/page revisions are supplied. Product schemas still require `specy_products_*`. `update_system_data` supports the non-secret schema fields `frontend_url`, `slug_structure`, and `revalidation_endpoint`; frontend URLs are checked against outbound URL restrictions and the schema's canonical URL policy. Revalidation secrets and registration codes are never exposed or accepted by that update operation. Target changes use the existing validated `PUT /api/schemas/:slug/frontend-targets` contract; the MCP tool executes the same replacement logic in-process (never a self-fetch of the Worker's own URL, which can fail with Cloudflare 522 while the API is healthy). The full validation rule chain (exact structure matching per target, preview namespace separation, error naming and aggregation) is documented in [`features/frontend-targets.md`](../features/frontend-targets.md). `specy_pages_schemas_preview` resolves a page preview URL or reports the preview configuration. Previews are opt-in per schema: they only exist when an enabled `detail-page` frontend target whose `host_path` explicitly contains the `:slug` token is set together with a registered `frontend_url`. There is no implicit fallback to the schema `slug_structure`; the tool fails with `preview_not_configured` when the structure has not been set, and schemas remain fully usable without previews.

Dynamic MCP registration now works as follows:

- public GET/discovery metadata remains available without authentication
- MCP POST initialization requires OAuth and returns `401` with `WWW-Authenticate` when no bearer token is present
- authenticated callers receive mutation tools and published closed MCP entries

This means the tool list is caller-dependent by design.

## 5. Relationship To Schemas

Page schemas still use `page_schema_specs` attachments.

Those attachments are still relevant for:

- choosing a schema main contract
- attaching additional MCP entries to a schema workflow
- generating schema-oriented prompts and bundles

But schema attachment is no longer the gate for direct MCP registry exposure.

In other words:

- schema attachment controls schema context
- MCP publication controls MCP exposure

## 6. Auth Model For Closed MCP Entries

**Updated 2026-08-01:** programmatic MCP authentication now uses OAuth 2.1 (Authorization Code + PKCE) with Supabase Auth as the Authorization Server. The password-grant `login` MCP tool was removed; it now returns OAuth flow instructions. See [`OAuth_MCP_Authentication.md`](../auth/oauth-mcp-authentication.md) for the full model. The visibility rules below are unchanged — only the token acquisition path changed.

Requirements:

- the request must send `Authorization: Bearer <oauth-access-token>`
- the token must be a valid Supabase-issued access token (password session or OAuth 2.1 — both are validated via `auth.getClaims()`)
- OAuth clients discover the authorization server via `/.well-known/oauth-protected-resource` (RFC 9728); 401 responses include a `WWW-Authenticate` challenge pointing there

If the token is missing:

- MCP initialization returns `401` with `WWW-Authenticate` and protected-resource metadata
- clients should complete OAuth and reconnect before calling `tools/list`
- mutation tools such as `create_schema`, `start_schema_registration`, `register_frontend`, and `create_page` are not exposed

If the token is invalid or expired:

- the MCP endpoint responds with `401 Invalid or expired session` and a `WWW-Authenticate: Bearer resource_metadata="..."` header

## 7. Operator Workflow

Recommended workflow for a custom MCP entry:

1. Create the MCP entry as draft.
2. Validate the JSON definition and agent instructions.
3. Choose `public` or `closed` access.
4. Publish the MCP entry.
5. Test anonymously if it is public.
6. Test with a valid Supabase JWT if it is closed.

Recommended workflow for schema-driven frontend generation:

1. Call `start_here` to get the current Specy workflow and auth model.
2. Let the MCP client complete OAuth 2.1 automatically after the Worker returns its `WWW-Authenticate` challenge. Do not copy authorization codes or JWTs into chat.
3. Use `list_schemas` and `get_schema_spec` to inspect existing patterns.
4. Call `create_schema` to create the schema for the authenticated tenant. The returned `schema_slug` is tenant-local; use the returned `api_slug` (also exposed as the legacy `slug` field) for schema MCP/API tool arguments.
5. Call `start_schema_registration` with that `api_slug` to generate the registration code programmatically.
6. Build the frontend against the created schema and call `register_frontend` with the returned code.
7. Call `specy_pages_schemas_create_page` to create ordinary pages; for event schemas include explicit tenant/schema revision and operational `event` details (this creates a draft page).
8. Call `check_health` to verify the registered frontend is reachable.

### Target-aware schema registration

`register_frontend` accepts the legacy `slug_structure` field for existing agents, but new integrations should submit `targets`:

```json
{
   "targets": [
      {
         "target_key": "home.posts",
         "kind": "collection-slot",
         "host_path": "/",
         "placement_key": "home.posts",
         "is_primary": true
      },
      {
         "target_key": "posts.detail",
         "kind": "detail-page",
         "host_path": "/posts/:slug",
         "supports_preview": true
      }
   ]
}
```

Collection slots are suitable when a schema is rendered inside an existing landing page. A URL such as `/#posts` is a browser fragment and must not be registered. The frontend maps `placement_key` to its own component; Specy only stores and revalidates the server path `/`.

Published content is read through `GET /api/schemas/:slug/pages` and optional detail content through `GET /api/schemas/:slug/pages/:pageSlug`. Those public delivery endpoints remain published-only and are not page-management APIs. REST page management uses authenticated `POST/PATCH /api/schemas/:slug/pages`; MCP management tools `specy_pages_schemas_list_pages`, `specy_pages_schemas_get_page`, `specy_pages_schemas_create_page`, and `specy_pages_schemas_update_page` use caller RLS and preserve arbitrary page JSON. Event-classified page creation/update dispatches to the event aggregate rather than generic page CRUD.

Schema discovery and schema specs include `entity_kind`, `definition_revision`, and non-executable `editor_config` metadata. Product/event classifications must be tenant-owned page collections. Existing schemas with pages cannot be reclassified or moved until an explicit conversion workflow exists.

A mistaken schema frontend URL can be corrected without restarting the registration flow. Use `specy_pages_schemas_get` to inspect the current system metadata, then `specy_pages_schemas_update_system_data` with the corrected `frontend_url`. Supply `api_slug` when possible; a tenant-local schema slug is accepted only when it resolves to exactly one visible schema. The equivalent REST contract is authenticated `PATCH /api/schemas/:slug/system-data`; it accepts only `frontend_url`, legacy `slug_structure`, and `revalidation_endpoint`. `frontend_url` is normalized to its origin and validated against URL safety and canonical frontend requirements. Schema content, page content, registration codes, and secret values are not part of this update.

MCP tool logging records the logical tool name and, when a bearer session verifies successfully, the Supabase user ID and email claim. A tool-level failure is recorded with its inner status code (and the outer transport status separately), even when the enclosing JSON-RPC HTTP response is `200`. MCP POST operations require OAuth; the published `GET /api/schemas/:slug/pages` delivery endpoint remains intentionally public and returns published content only so frontends can render it.

## 8. Summary

The MCP registry now follows a simple rule set:

- draft does not expose
- published exposes
- public exposes without auth
- closed exposes with valid Supabase JWT
- no hidden metadata flags control exposure
