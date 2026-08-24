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

**Updated 2026-08-01:** programmatic MCP authentication now uses OAuth 2.1 (Authorization Code + PKCE) with Supabase Auth as the Authorization Server. The password-grant `login` MCP tool was removed; it now returns OAuth flow instructions. See [`OAuth_MCP_Authentication.md`](OAuth_MCP_Authentication.md) for the full model. The visibility rules below are unchanged — only the token acquisition path changed.

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
4. Call `create_schema` to create the schema for the authenticated tenant.
5. Call `start_schema_registration` to generate the registration code programmatically.
6. Build the frontend against the created schema and call `register_frontend` with the returned code.
7. Call `create_page` to create page content validated against the schema.
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

Published content is read through `GET /api/schemas/:slug/pages` and optional detail content through `GET /api/schemas/:slug/pages/:pageSlug`. The response preserves stored schema/page JSON, including arbitrary field casing and nested content blocks.

## 8. Summary

The MCP registry now follows a simple rule set:

- draft does not expose
- published exposes
- public exposes without auth
- closed exposes with valid Supabase JWT
- no hidden metadata flags control exposure
