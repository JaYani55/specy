# Architecture — Dynamic Schema-Driven PageBuilder

## Overview

The service-CMS pagebuilder is a **decoupled, backend-first pagebuilder**. The CMS (backend) defines page schemas which any frontend must comply with. Schemas are saved as LLM-ready `.txt` specifications served via a public Hono API on Cloudflare Workers. An LLM Agent building/editing the frontend can ingest the schema via HTTP to build compliant templates that consume page content via the JSONB structure defined in the CMS.

This architecture enables:
- **Multi-frontend support**: One CMS powering multiple frontends (Next.js, SvelteKit, etc.)
- **Schema-driven content**: Content editors work within the constraints of a registered schema
- **LLM-assisted frontend generation**: Schemas include machine-readable specs, per-field help text, placeholders, and meta-descriptions
- **ISR-ready communication**: On-demand revalidation webhooks notify frontends of content changes
- **Reversible registration**: Domains can be disconnected at any time via the Unhook flow

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Service-CMS (React SPA)                  │
│                                                                 │
│  /pages                         Schema Hub (list all schemas)   │
│  /pages/schema/new              Schema Editor (create new)      │
│  /pages/schema/:slug            Page list for schema            │
│  /pages/schema/:slug/edit/:id   PageBuilder (edit page)         │
│  /pages/schema/:slug/new        PageBuilder (new page)          │
└────────────────┬────────────────────────────────────────────────┘
                 │ Direct Supabase client calls
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase (PostgreSQL)                        │
│                                                                 │
│  page_schemas    Schema definitions, registration, LLM config   │
│  pages           Page content (JSONB), linked to schema         │
│  mentorbooking_products   Legacy FK to pages via product_page_id│
└────────────────┬────────────────────────────────────────────────┘
                 │ Service role key (server-side only)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Hono API (Cloudflare Workers)                       │
│                                                                 │
│  GET  /api/schemas                    List all schemas          │
│  GET  /api/schemas/:slug/spec.txt     LLM-ready schema spec     │
│  POST /api/schemas/:slug/register     Frontend registration      │
│  GET  /api/schemas/:slug/health       Domain ONLINE/OFFLINE      │
│  POST /api/schemas/:slug/revalidate   Trigger ISR on frontend   │
│  /mcp                                 MCP agent endpoint        │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTP (public)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Frontend (Next.js / SvelteKit / etc.)              │
│                                                                 │
│  Consumes page content from Supabase                            │
│  Implements ISR revalidation endpoint                           │
│  Registers with CMS via registration callback                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `page_schemas`

| Column | Type | Details |
|--------|------|---------|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `name` | `varchar(255)` | NOT NULL — e.g., "Service-Product", "Blog" |
| `slug` | `varchar(255)` | UNIQUE NOT NULL — URL-friendly identifier |
| `description` | `text` | Human-readable description |
| `schema` | `jsonb` | NOT NULL — JSON schema definition (see Schema Field Format below) |
| `llm_instructions` | `text` | Custom instructions for the LLM agent |
| `registration_code` | `varchar(64)` | UNIQUE — one-time code for frontend callback |
| `registration_status` | `varchar(50)` | `'pending'` \| `'waiting'` \| `'registered'` \| `'archived'` |
| `frontend_url` | `text` | Base URL of the frontend consuming this schema |
| `revalidation_endpoint` | `text` | ISR webhook path (e.g., `/api/revalidate`) |
| `revalidation_secret` | `text` | Shared secret for webhook auth |
| `slug_structure` | `text` | URL pattern for pages, default `'/:slug'` |
| `is_default` | `boolean` | `DEFAULT false` — marks built-in schemas |
| `created_at` | `timestamptz` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `DEFAULT now()` (auto-updated via trigger) |

### `pages`

| Column | Type | Details |
|--------|------|---------|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `slug` | `varchar(255)` | UNIQUE NOT NULL |
| `name` | `varchar(255)` | NOT NULL |
| `status` | `varchar(50)` | `'draft'` \| `'published'` \| `'archived'` |
| `is_draft` | `boolean` | `DEFAULT true`, auto-synced with status |
| `content` | `jsonb` | NOT NULL — the full page content matching schema |
| `schema_id` | `uuid` FK | REFERENCES `page_schemas(id)` — nullable for legacy |
| `domain_url` | `text` | The frontend domain this page belongs to |
| `updated_at` | `timestamptz` | Auto-updated via trigger |
| `published_at` | `timestamptz` | Nullable |

### Relationship Diagram

```
mentorbooking_products.product_page_id ──FK──► pages.id
pages.schema_id ──FK──► page_schemas.id
```

---

## Schema Field Format

Each field in a schema's `schema` JSONB column serialises a `SchemaFieldDefinition`:

```json
{
  "field_name": {
    "type": "string | number | boolean | array | object | ContentBlock[] | CodeBlock[]",
    "description": "Help text shown below the field in the Page Builder",
    "placeholder": "Input placeholder shown inside the input in the Page Builder",
    "meta_description": "Developer / LLM context — NOT rendered in Page Builder, only exposed via API and spec.txt",
    "required": true,
    "enum": ["option1", "option2"],
    "properties": { /* nested fields for type=object */ },
    "items": { /* item field definition for type=array */ }
  }
}
```

### SchemaFieldDefinition TypeScript interface

```ts
interface SchemaFieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'ContentBlock[]' | 'CodeBlock[]';
  description?: string;       // shown in PageBuilder below the field
  placeholder?: string;       // shown inside the input in PageBuilder
  meta_description?: string;  // developer/LLM context, API-only
  required?: boolean;
  properties?: SchemaFieldDefinition[];
  items?: SchemaFieldDefinition;
  enum?: string[];
}
```

**`meta_description`** is designed for LLM agents and developers to understand field intent, design decisions, and constraints. It is serialised into the schema JSONB and exposed via `GET /api/schemas/:slug/spec.txt` and the schema API — but is never rendered in the PageBuilder UI.

---

## Hono API Endpoints

All endpoints are served from `api/` directory, deployed as a Cloudflare Worker.

### `GET /api/schemas`
Returns the full schema index with registration status, spec URLs, and register URLs.

### `GET /api/schemas/:slug/spec.txt`
Returns the LLM-ready plaintext specification for a schema. Includes field definitions (including `meta_description`), content block types, LLM instructions, and a registration payload example. Content-Type: `text/plain`.

### `POST /api/schemas/:slug/register`
Completes frontend registration. Validates the one-time `registration_code`. Stores `frontend_url`, `revalidation_endpoint`, `revalidation_secret`, and `slug_structure`. Returns `403` on invalid/expired code.

Request body:
```json
{
  "code": "<registration_code>",
  "frontend_url": "https://your-site.com",
  "revalidation_endpoint": "/api/revalidate",
  "revalidation_secret": "<shared_secret>",
  "slug_structure": "/:slug"
}
```

### `GET /api/schemas/:slug/health`
Server-side domain health check. Returns `{ status: 'online' | 'offline', latency_ms }`.

### `POST /api/schemas/:slug/revalidate`
Triggers ISR revalidation on the registered frontend. The CMS calls this automatically after a page is saved when the schema is registered.

### `/mcp`
MCP-compatible endpoint exposing 4 tools: `list_schemas`, `get_schema_spec`, `register_frontend`, `check_health`.

---

## Schema Registration Flow

```
1. Staff creates schema in CMS → status='pending'
2. Staff clicks "Start Registration" → status='waiting', registration_code generated
3. CMS shows "Waiting for Frontend" screen, polls every 10s
4. LLM Agent / Developer fetches spec.txt, builds frontend template
5. Frontend POSTs to /register with code + frontend_url + revalidation config + slug_structure
   → status='registered', frontend_url/revalidation fields stored
6. CMS detects change → shows domain in TLD-grouped Pages view with health ping
7. Abort: clicking abort resets code=null, status='pending' → old code invalidated
```

### Unhook Flow (reversible disconnection)

```
1. Staff clicks "Unhook" button on a TLD card in the Pages view
2. Confirmation dialog shown (lists affected domain)
3. All schemas under that domain set: status='pending', frontend_url=null,
   revalidation_endpoint=null, revalidation_secret=null
4. Domain disappears from TLD view → schema moves to "Pending / Unassigned" group
5. Re-registration can begin from step 2 above
```

Implemented via `unhookSchema(id)` in `pageService.ts` (Supabase direct update).

---

## Slug Structure & Preview URLs

`slug_structure` is a URL pattern stored per schema upon registration. The `:slug` token is replaced with the page's URL slug to form the preview URL.

| slug_structure | page slug | result URL |
|---|---|---|
| `/:slug` | `my-page` | `https://site.com/my-page` |
| `/blog/:slug` | `my-post` | `https://site.com/blog/my-post` |
| `/products/:slug` | `widget` | `https://site.com/products/widget` |

The CMS Page Builder constructs the preview URL as:
```
{frontend_url} + slug_structure.replace(':slug', pageSlug)
```

The preview link appears in `SchemaPageBuilderForm` after saving, and only when `frontend_url` is set on the schema (i.e. the schema is registered).

The CMS sends revalidation calls with the bare slug (e.g. `my-post`), not the full URL path. Frontend revalidation handlers should prepend the route prefix if needed.

---

## PageBuilder Component Architecture

### Mode Detection

`PageBuilderForm` is the entry point. It always declares all hooks unconditionally, then delegates based on mode:

```
PageBuilderForm
  ├── schema && schemaSlug → SchemaPageBuilderForm   (schema-driven)
  └── (else)              → legacy hardcoded form    (Hero/CTA/Cards/Features/FAQ)
```

### Schema-Driven Mode: `SchemaPageBuilderForm`

Located at `src/components/pagebuilder/SchemaPageBuilderForm.tsx`.

**Key behaviours:**
- Parses `schema.schema` JSONB into `SchemaFieldDefinition[]` via `parseSchemaFields()`
- Splits fields into `requiredFields` (always shown) and `optionalFields` (added one-by-one via pill buttons)
- On edit, automatically activates optional fields that have non-empty `initialData`
- Builds initial form state via `buildInitialData()` with type-appropriate empty defaults
- Saves via `savePage()`, then triggers `triggerRevalidation()` if schema is registered
- Shows ISR result (success/failure, revalidated slug) after save
- Preview URL built from `schema.frontend_url` + `slug_structure`
- Slug auto-generated from page name (manual override supported)
- Sticky footer shows schema name + ISR active badge

**`SchemaFieldRenderer`** is a recursive component that handles all field types:

| Field type | Rendered as |
|---|---|
| `ContentBlock[]` | `ContentBlocksEditor` (inline block list with add dropdown) |
| `CodeBlock[]` | Structured code variants editor with language, pattern, frameworks, and code textarea |
| `string` + `enum` | `Select` |
| `string` (long-text heuristic) | `Textarea` |
| `string` | `Input` |
| `number` | `Input[type=number]` |
| `boolean` | `Checkbox` |
| `object` | Recursive nested renderer with dashed left border |
| `array` | Repeatable item list with add/remove |

Long-text heuristic: field name or description contains `description`, `content`, `text`, `body`, `summary`, `bio`, or `instructions`.

### Example: `CodeBlock[]` schema field

```json
{
  "examples": {
    "type": "CodeBlock[]",
    "description": "Alternative implementations of the same logic.",
    "meta_description": "Use this for code examples that may vary by language, framework, or implementation pattern. Each item should contain the exact source code plus a language identifier for frontend syntax highlighting.",
    "items": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string",
          "description": "Visible label for this variant"
        },
        "language": {
          "type": "string",
          "required": true,
          "enum": ["typescript", "javascript", "python", "php"],
          "meta_description": "Syntax highlighting token consumed by the frontend renderer."
        },
        "pattern": {
          "type": "string",
          "enum": ["functional", "class-based", "server-action", "api-route"],
          "meta_description": "Optional implementation style or architectural pattern."
        },
        "frameworks": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["react", "nextjs", "express", "hono"]
          },
          "meta_description": "Optional framework tags. When enum values are provided, the Page Builder renders a multi-select control."
        },
        "code": {
          "type": "string",
          "required": true,
          "description": "Source code",
          "meta_description": "Exact source code snippet. Preserve indentation and syntax exactly as it should be rendered."
        }
      }
    }
  }
}
```

### `StandaloneContentBlockEditor`

Located at `src/components/pagebuilder/StandaloneContentBlockEditor.tsx`.

Standalone version of the content block editor with no react-hook-form dependency. Used by `SchemaPageBuilderForm` for `ContentBlock[]` fields. Handles all 6 block types with a `patch()` helper pattern.

### Legacy Mode: `PageBuilderForm`

Remains for the `mentorbooking_products` → `pages` flow. Uses react-hook-form + Zod with hardcoded sections (Hero, CTA, Cards, Features, FAQ). Preview URL uses a relative path (`/${savedSlug}`).

---

## Schema Editor (`SchemaEditor`)

Located at `src/pages/SchemaEditor.tsx`.

Provides UI to define schema fields. Each field supports:

| Property | UI Control | Purpose |
|---|---|---|
| `name` | `Input` (monospace) | JSON key name |
| `type` | `Select` | Field type |
| `description` (Help Text) | `Input` | Shown below the field in PageBuilder |
| `placeholder` | `Input` | Shown inside the input in PageBuilder |
| `meta_description` | `Textarea` | Developer/LLM context, API-only |
| `required` | `Checkbox` | Shown as required in PageBuilder |

Serialisation: `fieldsToJsonSchema()` converts the field array to the JSONB format stored in Supabase. Deserialisation: `jsonSchemaToFields()` parses the stored JSONB back into the editor. Both functions include `placeholder`, `required`, and `meta_description`.

---

## Pages View (`Pages.tsx`)

### TLD-Grouped View

Registered schemas are grouped by `frontend_url` domain. Each TLD group shows:
- Domain + external link
- Online/Offline health badge with latency
- Schema count + active count
- **Unhook button** (red, destructive outline): shown only when `domain` is set and at least one schema is registered. Triggers `unhookSchema()` for all schemas in the group.

### Onboarding Screen

Shown when no TLD has a registered frontend. Features:
- 4-step connection guide
- API endpoint display (REST + MCP) with copy buttons
- **Framework toggle** (Next.js / SvelteKit) that switches the agent prompt
- Agent prompt with 6 sections: Discovery, Data Model, ISR Setup, Registration, Slug Structure & Preview URLs, Health Check, MCP Integration
- Active registration codes for `waiting` schemas (shown inline with copy button)
- Available schemas list with "Start Registration" action

---

## Content Block Types (shared primitives)

| Type | Fields |
|------|--------|
| `text` | `content: string` |
| `heading` | `content: string`, `level: 'heading1'...'heading6'` |
| `image` | `src, alt, caption?, width?, height?` |
| `quote` | `text, author?, source?` |
| `list` | `style: 'ordered' \| 'unordered'`, `items: string[]` |
| `video` | `src, provider: 'youtube' \| 'vimeo' \| 'other'`, `caption?` |

All blocks extend `BaseBlock: { id: string, type: string }`.

Block IDs generated as: `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

---

## Key Service Functions (`pageService.ts`)

| Function | Description |
|---|---|
| `getSchemas()` | Fetch all schemas |
| `getSchema(slug)` | Fetch single schema by slug |
| `createSchema(input)` | Create new schema |
| `updateSchema(id, input)` | Update name/description/schema/llm_instructions |
| `deleteSchema(id)` | Set status → `'archived'` |
| `startSchemaRegistration(id)` | Generate registration code, set status → `'waiting'` |
| `unhookSchema(id)` | Reset status → `'pending'`, null out `frontend_url`, `revalidation_endpoint`, `revalidation_secret` |
| `savePage(pageId, content, name, schemaId)` | Upsert page record |
| `triggerRevalidation(schemaSlug, pageSlug)` | POST to Hono revalidation endpoint |
| `groupSchemasByTLD(schemas)` | Group schemas by `frontend_url` domain |
| `checkDomainHealthDirect(domain)` | Client-side HEAD ping for latency display |

---

## Environment Variables

### CMS (Vite)
| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable (public) key |
| `VITE_API_URL` | Hono Worker URL (default: `http://localhost:8787`) |

### Hono Worker (Cloudflare)
| Variable | Description |
|----------|-----------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key (safe for Worker) |
| `SUPABASE_SECRET_KEY` | Secret key — server-side only, bypasses RLS |

---

## Key Decisions

1. **Rename `products` → `pages`**: Single source of truth, avoids ambiguity with `mentorbooking_products`
2. **Hono on Cloudflare Workers**: Co-located in repo, server-side fetch for domain pings
3. **DB polling over Realtime**: Simpler for one-time registration events
4. **Schema-driven PageBuilder replaces hardcoded sections**: `SchemaPageBuilderForm` reads field structure from JSONB at runtime; legacy form retained for `mentorbooking_products` flow
5. **Required/Optional field split**: Content editors see only required fields by default; optional fields added individually to reduce cognitive load
6. **`meta_description` API-only**: Keeps PageBuilder UI clean while giving LLM agents and developers full field context via the spec endpoint
7. **`StandaloneContentBlockEditor`**: Decoupled from react-hook-form so `SchemaPageBuilderForm` can manage its own state without the legacy form context
8. **Unhook is non-destructive**: Only clears registration fields — the schema definition, pages, and content are preserved
9. **`slug_structure` drives preview URLs**: Stored at registration time, used by both PageBuilder (preview link) and ISR (path construction)
10. **Framework toggle in agent prompt**: Next.js and SvelteKit prompts share the same discovery/data model sections but have framework-specific ISR setup code


## Overview

The service-CMS pagebuilder is a **decoupled, backend-first pagebuilder**. The CMS (backend) defines page schemas which any frontend must comply with. Schemas are saved as LLM-ready `.txt` specifications served via a public Hono API on Cloudflare Workers. An LLM Agent building/editing the frontend can ingest the schema via HTTP to build compliant templates that consume page content via the JSONB structure defined in the CMS.

This architecture enables:
- **Multi-frontend support**: One CMS powering multiple frontends (Next.js, SvelteKit, etc.)
- **Schema-driven content**: Content editors work within the constraints of a registered schema
- **LLM-assisted frontend generation**: Schemas include machine-readable specs and custom instructions
- **ISR-ready communication**: On-demand revalidation webhooks notify frontends of content changes

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Service-CMS (React SPA)                  │
│                                                                 │
│  /pages                    Schema Hub (list all schemas)        │
│  /pages/schema/new         Schema Editor (create new)           │
│  /pages/schema/:slug       Page list for schema                 │
│  /pages/schema/:slug/edit/:id   PageBuilder (edit page)         │
│  /pages/schema/:slug/new        PageBuilder (new page)          │
└────────────────┬────────────────────────────────────────────────┘
                 │ Direct Supabase client calls
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase (PostgreSQL)                        │
│                                                                 │
│  page_schemas    Schema definitions, registration, LLM config   │
│  pages           Page content (JSONB), linked to schema         │
│  mentorbooking_products   Legacy FK to pages via product_page_id│
└────────────────┬────────────────────────────────────────────────┘
                 │ Service role key (server-side only)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Hono API (Cloudflare Workers)                       │
│                                                                 │
│  GET  /api/schemas/:slug/spec.txt     LLM-ready schema spec     │
│  POST /api/schemas/:slug/register     Frontend registration      │
│  GET  /api/schemas/:slug/health       Domain ONLINE/OFFLINE      │
│  POST /api/schemas/:slug/revalidate   Trigger ISR on frontend    │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTP (public)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Frontend (Next.js / SvelteKit / etc.)              │
│                                                                 │
│  Consumes page content from Supabase                            │
│  Implements ISR revalidation endpoint                           │
│  Registers with CMS via registration callback                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `page_schemas` (NEW)

| Column | Type | Details |
|--------|------|---------|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `name` | `varchar(255)` | NOT NULL — e.g., "Service-Product", "Blog" |
| `slug` | `varchar(255)` | UNIQUE NOT NULL — URL-friendly identifier |
| `description` | `text` | Human-readable description |
| `schema` | `jsonb` | NOT NULL — JSON schema definition (keys, types, nesting) |
| `llm_instructions` | `text` | Custom instructions for the LLM agent |
| `registration_code` | `varchar(64)` | UNIQUE — one-time code for frontend callback |
| `registration_status` | `varchar(50)` | `'pending'` \| `'waiting'` \| `'registered'` \| `'archived'` |
| `frontend_url` | `text` | Base URL of the frontend consuming this schema |
| `revalidation_endpoint` | `text` | ISR webhook path (e.g., `/api/revalidate`) |
| `revalidation_secret` | `text` | Shared secret for webhook auth |
| `slug_structure` | `text` | URL pattern for pages, default `'/:slug'` |
| `is_default` | `boolean` | `DEFAULT false` — marks built-in schemas |
| `created_at` | `timestamptz` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `DEFAULT now()` (auto-updated via trigger) |

### `pages` (RENAMED from `products`)

| Column | Type | Details |
|--------|------|---------|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `slug` | `varchar(255)` | UNIQUE NOT NULL |
| `name` | `varchar(255)` | NOT NULL |
| `status` | `varchar(50)` | `'draft'` \| `'published'` \| `'archived'` |
| `is_draft` | `boolean` | `DEFAULT true`, auto-synced with status |
| `content` | `jsonb` | NOT NULL — the full page content matching schema |
| `schema_id` | `uuid` FK | REFERENCES `page_schemas(id)` — nullable for legacy |
| `domain_url` | `text` | The frontend domain this page belongs to |
| `updated_at` | `timestamptz` | Auto-updated via trigger |
| `published_at` | `timestamptz` | Nullable |

### Relationship Diagram

```
mentorbooking_products.product_page_id ──FK──► pages.id
pages.schema_id ──FK──► page_schemas.id
```

---

## Hono API Endpoints

All endpoints are served from `api/` directory, deployed as a Cloudflare Worker.

### `GET /api/schemas/:slug/spec.txt`
Returns the LLM-ready plaintext specification for a schema. Content-Type: `text/plain`.

### `POST /api/schemas/:slug/register`
Completes frontend registration. Validates the one-time `registration_code`. Returns `403` on invalid/expired code.

### `GET /api/schemas/:slug/health`
Server-side domain health check. Returns `{ status: 'online' | 'offline', latency_ms }`.

### `POST /api/schemas/:slug/revalidate`
Triggers ISR revalidation on the registered frontend via its webhook endpoint.

---

## Schema Registration Flow

```
1. Staff creates schema in CMS → status='waiting', generates registration_code
2. CMS shows "Waiting for Frontend" screen, polls every 10s
3. LLM Agent / Developer fetches spec.txt, builds frontend template
4. POSTs to /register with code + frontend URLs → status='registered'
5. CMS detects change → shows success + domain info
6. Abort: Sets code=null, status='pending' → old code invalidated
```

---

## Content Block Types (shared primitives)

| Type | Fields |
|------|--------|
| `text` | `content: string` |
| `heading` | `content: string`, `level: 'heading1'...'heading6'` |
| `image` | `src, alt, caption?, width?, height?` |
| `quote` | `text, author?, source?` |
| `list` | `style: 'ordered' \| 'unordered'`, `items: string[]` |
| `video` | `src, provider: 'youtube' \| 'vimeo' \| 'other'`, `caption?` |

All blocks extend `BaseBlock: { id: string, type: string }`

---

## Environment Variables

### CMS (Vite)
| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable (public) key |
| `VITE_API_URL` | Hono Worker URL |

### Hono Worker (Cloudflare)
| Variable | Description |
|----------|-----------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key (safe for Worker) |
| `SUPABASE_SECRET_KEY` | Secret key — server-side only, bypasses RLS |

---

## Key Decisions

1. **Rename `products` → `pages`**: Single source of truth, avoids ambiguity with `mentorbooking_products`
2. **Hono on Cloudflare Workers**: Co-located in repo, server-side fetch for domain pings
3. **DB polling over Realtime**: Simpler for one-time registration events
4. **Keep existing form components**: Known sections use concrete components, custom sections use generic editor
5. **Blog schema mirrors Service-Product**: Same blocks, differentiated by labels and defaults
6. **Schema .txt via Hono API**: Dynamically generated from DB, always current