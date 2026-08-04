-- Standard agent-retrievable frontend implementation prompts.
-- Public, published records are exposed through /api/specs and dynamic MCP tools.

insert into public.llm_specs (
  slug, name, description, definition, llm_instructions, status,
  is_public, is_main_template, tags, metadata
)
select
  'specy-frontend-guide',
  'Specy Frontend Guide',
  'Framework-neutral instructions for agents building and registering a Specy frontend.',
  jsonb_build_object(
    'kind', 'standard-frontend-prompt',
    'version', '2026-08-03',
    'framework', 'framework-neutral',
    'content_scopes', jsonb_build_array('page-collection', 'single-page'),
    'retrieval', jsonb_build_object('api', '/api/specs/specy-frontend-guide', 'mcp_tool', 'specy-frontend-guide')
  ),
  $$# Specy Frontend Guide

You are building a frontend backed by Specy. Start with `start_here`, then authenticate before mutation tools, call `list_schemas`, and call `get_schema_spec` for the exact schema. Never query the CMS database directly from a public frontend; use the schema-scoped API.

## Choose the content scope

- `page-collection`: many page records. Render a collection host path and, when the schema defines one, a detail route containing `:slug`. Fetch published pages at `/api/schemas/{schema_slug}/pages`, preserve the `content` object, and map each page slug to the registered detail route.
- `single-page`: one existing page surface. Render the registered `page_target.host_path`; do not create a new slug route or call `create_page` for this schema. Fetch the schema's published content and place it at the registered target.

Use the schema's exact `integration_requirements`, `content_scope`, `page_target`, `route_base_path`, and `required_slug_structure`. Do not invent routes or use browser fragments such as `#posts` as server targets. A fragment may be a client-side link only; revalidation must use `/` or another real server path.

## Registration and publication

Build and deploy the frontend before registration. Register with `POST /api/schemas/{schema_slug}/register`, using the one-time code, canonical frontend URL, `/api/revalidate`, a strong shared secret, and only the targets defined by the schema. Store the secret outside source control. Editors publish content in Specy; the frontend must fetch published records and must not add demo fallback content when the API is empty.

Verify the schema spec, public spec, pages endpoint, registration, health endpoint, frontend listing, detail or host route, and newly published content. If new records must appear without a redeploy, use request-time SSR or another runtime delivery mode; static route generation alone cannot discover new slugs.

## Content safety

Preserve every content key and nested object exactly. Support ContentBlock items defensively by `type`: `text`, `heading`, `image`, `quote`, `list`, `video`, `form`, and `audio`. Unknown block types must not crash rendering. Preserve exact user-defined keys including `Content`, `Code Block`, `author-name`, and `author-picture`.

## Revalidation

Accept `POST /api/revalidate`, require exactly `Authorization: Bearer <registered-secret>`, return `401` for missing or wrong credentials, and never expose the secret to browser code. Revalidation is an optimization; request-time fetching remains the source of truth for SSR.

## MCP

Use the public MCP endpoint and standard prompt specs when available. The standard guides are retrievable from `/api/specs` and `/api/specs/{slug}` and as zero-argument MCP tools named `specy-frontend-guide`, `astro`, and `nextjs`.$$,
  'published', true, true,
  '["standard", "frontend", "specy", "mcp", "agent"]'::jsonb,
  '{"standard_prompt": true, "scope": "frontend", "mcp_exposed": true}'::jsonb
where not exists (select 1 from public.llm_specs where slug = 'specy-frontend-guide');

insert into public.llm_specs (
  slug, name, description, definition, llm_instructions, status,
  is_public, is_main_template, tags, metadata
)
select
  'astro', 'Astro Specy Frontend Guide',
  'Astro SSR implementation guide for Specy, including blog collections and single-page schemas.',
  jsonb_build_object('kind', 'standard-frontend-prompt', 'version', '2026-08-03', 'framework', 'astro', 'adapter', 'cloudflare-workers', 'output', 'server', 'content_scopes', jsonb_build_array('page-collection', 'single-page')),
  $$# Astro + Specy Frontend Guide

Use Astro SSR when editors must create or publish Specy pages without redeploying the frontend. The required flow is: Specy page creation → published pages API → Astro request-time fetch → Cloudflare Worker → public route.

## Configuration

Install `@astrojs/cloudflare` and Wrangler. Configure `output: 'server'` and the Cloudflare adapter with `imageService: 'passthrough'`. Deploy with `npm run build` followed by `npx wrangler deploy`; do not use `wrangler pages deploy dist` for this SSR Worker. Do not add `getStaticPaths()` to CMS routes. Keep `.wrangler/`, `dist/`, `.astro/`, `.env*`, and local secret files ignored.

Use non-secret Wrangler variables such as `SPECY_API_BASE` and `SPECY_SCHEMA_SLUG`. Store `REVALIDATION_SECRET` with `npx wrangler secret put REVALIDATION_SECRET --name <worker>`.

## Server client

Create one server-side helper that fetches `${SPECY_API_BASE}/api/schemas/${SPECY_SCHEMA_SLUG}/pages`. Accept either a raw array or an envelope containing `pages` or `items`. Return an empty array for an unusable upstream response; never add hardcoded fallback posts. Preserve all content keys and nested objects. Log upstream status and a request ID server-side without exposing secrets.

## Page collections: blog example

For `content_scope: page-collection` and a route contract `/blog` plus `/blog/:slug`, implement `src/pages/blog/index.astro` with `export const prerender = false` and fetch pages at request time. Render links to `/blog/${post.slug}`. Implement `src/pages/blog/[slug].astro` without `getStaticPaths()`, fetch current published pages, find the requested slug, and render a not-found response when absent. A newly published slug must work without `astro build`.

Use schema-defined keys exactly. A common blog shape uses `content.hero.title`, `content.hero.description`, `content.subtitle`, and `content.Content`. Do not rename `Content`, `Code Block`, `author-name`, or `author-picture`.

## Single-page schemas

For `content_scope: single-page`, use the schema's `page_target.host_path` and render one existing route, such as `/`, `/about`, or `/docs`. Do not create a `[slug]` route, do not call `create_page`, and do not infer a collection from the content. Fetch the single published page at request time and pass its untouched `content` object to the renderer. If the target is `/`, revalidation targets `/`, never `/#section`.

## Content blocks

Render `ContentBlock[]` defensively: `text` → paragraph from `content`; `heading` → heading from `content` and `level`; `image` → image from `src`, `alt`, optional caption/dimensions; `quote` → quote from `text`, author, and source; `list` → ordered/unordered items; `video` → safe link/embed using `src`, provider, and caption; `form` and `audio` when present. Unknown types should be skipped or rendered safely.

## Revalidation endpoint

Add `src/pages/api/revalidate.ts` with `export const prerender = false` and an `ALL` handler. Reject non-POST with `405` and `Allow: POST`. Read the Worker binding through `cloudflare:workers`, compare the exact `Authorization: Bearer <secret>`, return `401` for missing or wrong credentials, and return `500` when the secret is not configured. A successful response acknowledges the path and slug; SSR still reads current Specy data on every request.

## Registration and verification

After deployment, call `start_schema_registration`, store the exact secret in the Worker, test `POST /api/revalidate`, then call `register_frontend` with the Worker URL, registration code, `/api/revalidate`, exact secret, and the schema's target (`/blog/:slug` for a blog collection or the fixed host path for a single page). Verify MCP schema retrieval, public spec retrieval, published pages, `/blog`, a known detail route where applicable, the fixed single-page route where applicable, and a newly published record without a rebuild.$$,
  'published', true, false,
  '["standard", "frontend", "astro", "cloudflare", "ssr", "specy", "mcp"]'::jsonb,
  '{"standard_prompt": true, "framework": "astro", "content_scopes": ["page-collection", "single-page"], "mcp_exposed": true}'::jsonb
where not exists (select 1 from public.llm_specs where slug = 'astro');

insert into public.llm_specs (
  slug, name, description, definition, llm_instructions, status,
  is_public, is_main_template, tags, metadata
)
select
  'nextjs', 'Next.js Specy Frontend Guide',
  'Next.js App Router implementation guide for Specy collections and single-page schemas.',
  jsonb_build_object('kind', 'standard-frontend-prompt', 'version', '2026-08-03', 'framework', 'nextjs-app-router', 'content_scopes', jsonb_build_array('page-collection', 'single-page')),
  $$# Next.js + Specy Frontend Guide

Build a Next.js App Router frontend from the exact Specy schema contract. First call `start_here`, authenticate before mutations, call `list_schemas`, and fetch `get_schema_spec`. Use the schema-scoped published pages API rather than direct Supabase access.

## Page collection

For `content_scope: page-collection`, implement the registered collection host path and detail route. A blog commonly uses `app/blog/page.tsx` and `app/blog/[slug]/page.tsx`. Fetch published pages at runtime, preserve the page `content` object, and resolve detail pages by slug. Do not rely on `generateStaticParams()` for newly created CMS pages. Use dynamic rendering or an appropriate runtime cache so a new published slug works without a frontend deployment.

## Single page

For `content_scope: single-page`, render the existing registered `page_target.host_path`, for example `app/page.tsx` or `app/about/page.tsx`. Do not create a `[slug]` route or call `create_page`. Fetch the single published page at runtime and preserve its exact content shape. Revalidation for `/` must target `/`, not `/#section`.

## Content and routes

Use the schema's exact `integration_requirements`, route ownership, target paths, and page discovery mode. Preserve exact keys including `Content`, `Code Block`, `author-name`, and `author-picture`. Render ContentBlock types `text`, `heading`, `image`, `quote`, `list`, `video`, `form`, and `audio` defensively; unknown types must not crash the page.

## Revalidation

Expose `app/api/revalidate/route.ts` with a POST handler. Require exactly `Authorization: Bearer <secret>`, return `401` for invalid credentials and `400` for missing paths, then invalidate the full server path with `revalidatePath`. Store the secret in the deployment environment, never in client JavaScript or source control. Revalidation is an optimization; runtime fetching remains authoritative.

## Registration

Deploy first, start registration, generate a strong secret, test the revalidation endpoint, and call `POST /api/schemas/{schema_slug}/register` with the exact registration code, canonical frontend URL, `/api/revalidate`, secret, and schema-defined targets. Verify schema and standard spec retrieval, the published pages endpoint, registration, health, collection listing/detail or single-page host route, and a newly published page. Do not use hardcoded fallback content to conceal API failures. Use the public API and MCP standard specs `specy-frontend-guide`, `astro`, and `nextjs` for additional instructions.$$,
  'published', true, false,
  '["standard", "frontend", "nextjs", "app-router", "specy", "mcp"]'::jsonb,
  '{"standard_prompt": true, "framework": "nextjs", "content_scopes": ["page-collection", "single-page"], "mcp_exposed": true}'::jsonb
where not exists (select 1 from public.llm_specs where slug = 'nextjs');
