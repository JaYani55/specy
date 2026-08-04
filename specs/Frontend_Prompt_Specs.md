# Standard Frontend Prompt Specs

## Purpose

Specy provides canonical, agent-retrievable implementation prompts for frontend integrations. The standard prompts are stored as public published `global_llm_specs` records and are exposed through REST discovery and dynamic MCP tools. They are deliberately not tenant-owned. The original `llm_specs` rows remain available for backwards compatibility with installations that already applied the first seed migration.

## Standard slugs

- `specy-frontend-guide` — framework-neutral workflow and contracts.
- `astro` — Astro SSR on Cloudflare Workers.
- `nextjs` — Next.js App Router runtime integration.

The records are available through `/api/specs`, `/api/specs/{slug}`, and MCP tools with the same names.

## Content scope

### Page collection

A page-collection schema contains multiple page records. Frontends must implement the registered collection host path and any registered detail route containing `:slug`. New published slugs must be discoverable at runtime when the product requirement does not allow a redeploy.

### Single page

A single-page schema represents one existing frontend page surface. The frontend must render the registered `page_target.host_path`, must not invent a slug route, and must not use `create_page` to create another record. Revalidation targets real server paths, never browser fragments.

## UI

The authenticated console keeps the existing MCP registry at `/mcp` and exposes the standard prompt collection at `/mcp/specs`. The collection page renders a collapsible table with copyable Markdown prompts and links to public API details.

## Security

Prompts are intentionally public and contain no credentials. Registration secrets remain deployment secrets and are never included in source-controlled configuration or browser code.
