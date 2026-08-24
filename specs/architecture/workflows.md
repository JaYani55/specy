# Architecture Workflow

## Purpose

This document provides a high-level BPMN-style overview of the complete ServiceCMS repository. It focuses on the main business and system workflows rather than implementation details.

The repo combines:

- a React SPA for CMS management
- a Cloudflare Worker API built with Hono
- a Supabase backend for auth, data, and storage
- a schema-driven page builder
- a forms subsystem
- an objects subsystem (arbitrary schema-validated JSONB data objects)
- a plugin and webapp extension model
- agent-facing REST and MCP entry points

---

## BPMN Scope

The overview is split into the following major processes:

1. Environment setup and deployment
2. User authentication and role access
3. Page schema lifecycle
4. Page content authoring and publishing
5. Forms authoring and submission
6. Objects authoring and retrieval
7. Agent and API interaction
8. Plugin lifecycle
9. Runtime content consumption
10. Isibot flow authoring (PluraDash plugin) — constructs the per-tenant
    flow document consumed by the separate isibot-fon Cloudflare Worker.

---

## Participants

### Pool: ServiceCMS Platform

Lanes:

- Staff User
- React SPA
- Cloudflare Worker API
- Supabase
- External Frontend
- Agent / Automation Client
- Plugin Runtime

---

## 1. Setup and Deployment Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start Event: New environment required
  Task: Run npm install
  Task: Run npm run setup
  Task: Enter Cloudflare and Supabase credentials
  Task: Confirm migration and deployment steps
  End Event: Environment deployed

Lane: React SPA / Local Tooling
  Task: Build frontend bundle with Vite

Lane: Setup Wizard
  Task: Authenticate with Cloudflare
  Task: Resolve account and secrets store
  Task: Persist worker secrets and vars
  Task: Apply ordered SQL migrations
  Task: Register Supabase auth hook
  Task: Optionally create first super-admin
  Task: Trigger production build
  Task: Trigger wrangler deploy

Lane: Supabase
  Task: Execute schema migrations
  Task: Store auth hook and database objects

(Start)
  -> Install dependencies
  -> Configure Cloudflare account and secrets
  -> Configure Supabase URL and keys
  -> Apply migrations
  -> Register auth access hook
  -> Build frontend
  -> Deploy worker
(End: ServiceCMS ready)
```

---

## 2. Authentication and Role Access Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start Event: User opens application
  Task: Submit credentials
  End Event: Access granted or denied

Lane: React SPA
  Task: Initialize auth state
  Gateway: Session valid?
    -> No: Redirect to /login
    -> Yes: Continue to protected routes
  Task: Resolve role-based navigation

Lane: Supabase
  Task: Authenticate user
  Task: Issue JWT
  Task: Inject user_roles via access hook

Lane: React SPA
  Gateway: Required role present?
    -> No: Redirect to safe route
    -> Yes: Render protected page
```

### Role Gate Summary

```text
Authenticated user
  -> JWT contains user_roles
  -> Frontend checks route access
  -> UI renders allowed navigation items
```

---

## 3. Page Schema Lifecycle Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start Event: Need a new page type
  Task: Open /pages/schema/new
  Task: Define schema JSONB
  Task: Add LLM instructions
  Task: Save schema
  Gateway: Register frontend now?
    -> No: End Event: Schema stored as pending

Lane: React SPA
  Task: Validate schema structure
  Task: Persist schema to Supabase
  Task: Show schema status and registration controls

Lane: Supabase
  Task: Store page_schemas record

Lane: Staff User
  Task: Start registration

Lane: React SPA
  Task: Generate registration code
  Task: Poll registration state

Lane: External Frontend
  Task: Read schema spec.txt
  Task: Build matching frontend template
  Task: POST registration callback

Lane: Cloudflare Worker API
  Task: Validate registration code
  Task: Save frontend URL, revalidation endpoint, secret, slug structure

Lane: Supabase
  Task: Update page_schemas.registration_status = registered

Lane: React SPA
  End Event: Schema becomes active and routable
```

### Decision Logic

```text
Schema created
  -> Pending
  -> Registered
  -> Archived
```

---

## 4. Page Content Authoring and Publishing Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start Event: Need a new page
  Task: Open schema page detail
  Task: Create new page or edit existing page
  Task: Fill schema-driven content fields
  Task: Optionally use content blocks
  Task: Save page
  Gateway: Publish now?
    -> No: End Event: Draft saved
    -> Yes: Continue to publish
Lane: React SPA
  Task: Load schema and page data
  Task: Render schema-driven form
  Task: Validate content
  Task: Save page JSONB to Supabase
  Gateway: Schema registered?
    -> No: End Event: Page stored only in CMS
    -> Yes: Trigger revalidation

Lane: Supabase
  Task: Store page in pages table
  Task: Update status and timestamps

Lane: Cloudflare Worker API
  Task: POST revalidation to external frontend
  Task: Log API activity when applicable

Lane: External Frontend
  Task: Receive revalidation request
  Task: Invalidate or rebuild page path
  End Event: Updated content visible to end users
```

### Content Model Summary

```text
Page authoring
  -> Schema selected
  -> JSONB content created
  -> Content blocks optionally embedded
  -> Page saved as draft/published/archived
  -> External frontend revalidated when connected
```

---

## 5. Forms Authoring and Submission Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start Event: Need a new form
  Task: Create or edit form
  Task: Define form schema JSONB
  Task: Add LLM instructions
  Task: Configure share/API/auth settings
  Task: Save form
  Gateway: Publish form?
    -> No: End Event: Draft form stored
    -> Yes: Continue to usage modes

Lane: React SPA
  Task: Validate form schema
  Task: Persist form to Supabase
  Task: Expose form in forms list and page-builder pickers

Lane: Supabase
  Task: Store forms record

Lane: Staff User
  Gateway: Deployment mode?
    -> Page embed
    -> Direct share link
    -> Agent/API access

Lane: React SPA
  Task: For page embed, store form reference block in page JSONB
  Task: For answers review, open /forms/:formId/answers

Lane: Agent / Automation Client
  Task: GET machine-readable form definition
  Task: POST answers

Lane: End User
  Task: Open share page or embedded page
  Task: Fill fields
  Task: Submit answers

Lane: Cloudflare Worker API
  Task: Resolve form by slug, id, or share_slug
  Task: Validate access rules
  Task: Validate answers against stored schema
  Task: Store answer with source_slug and submitted_via

Lane: Supabase
  Task: Write forms_answers record

Lane: Staff User
  End Event: Review answers in CMS
```

### Forms Delivery Modes

```text
Published form
  -> Referenced inside page content
  -> Exposed as REST definition/submission endpoint
```

### Forms Access Rules

```text
Gateway: requires_auth?
  -> Yes: bearer token / authenticated session required
  -> No: public access allowed
```

---

## 6. Objects Authoring and Retrieval Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: Staff User (admin/super-admin)
  Start Event: Need a reusable data object
  Task: Open /objects/new
  Task: Define schema fields (name, type, description, meta)
  Task: Fill data JSONB payload
  Task: Configure access (api_enabled, requires_auth)
  Task: Save object
  End Event: Object stored and accessible via API

Lane: React SPA
  Task: Render schema field editor (types: string, number, boolean, array, object, url, email, date, price)
  Task: Validate data JSON
  Task: POST/PUT to /api/objects via objectService
  Task: Show saved object in /objects list

Lane: Cloudflare Worker API
  Task: Validate admin JWT
  Task: Persist object to Supabase
  Task: Serve GET /api/objects/:idOrSlug (enforce requires_auth per object)

Lane: Supabase
  Task: Store public.objects row (schema + data as JSONB)
  Task: Enforce RLS (admin write, anon read when published + api_enabled + !requires_auth)

Lane: Agent / Automation Client
  Task: GET /api/objects/:idOrSlug
  Task: Consume schema definition and data payload
  End Event: Structured data returned as JSON
```

### Object Access Rules

```text
Gateway: requires_auth?
  -> Yes: bearer token required for GET
  -> No: public access when status=published and api_enabled=true
```

### Object Data Model

```text
Object created
  -> schema JSONB: field definitions with type, description, placeholder, meta_description
  -> data JSONB:   the actual payload matching the schema
  -> Returned together by GET /api/objects/:idOrSlug
```

---

## 7. Agent and API Interaction Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

  Start Event: Agent needs CMS data or submission access
  Gateway: Interaction type?
    -> Schema discovery
    -> Form retrieval
    -> Form submission
    -> Object retrieval
    -> MCP tool usage

Lane: Cloudflare Worker API
  Task: Accept REST or MCP request
  Task: Apply CORS and request logging middleware
  Gateway: Endpoint type?
    -> /api/schemas
    -> /api/forms
    -> /api/objects
    -> /mcp
    -> plugin routes
  Task: Resolve Supabase client scope
  Gateway: Authorization required?
    -> Yes: Use bearer token
    -> No: Use anon/public access path

Lane: Supabase
  Task: Execute select/insert/update under RLS or admin scope

Lane: Cloudflare Worker API
  Task: Return normalized response
  Task: Persist agent log when enabled
  End Event: Agent receives structured result
```

### Interaction Matrix

```text
Agent wants page schema
  -> GET /api/schemas or /api/schemas/:slug/spec.txt

  -> GET /api/forms/:identifier

Agent submits form answers
  -> POST /api/forms/:identifier/answers

Agent wants a data object
  -> GET /api/objects/:idOrSlug

Agent wants CMS-native tool interface
  -> POST /mcp
```

---

## 8. Plugin Lifecycle Workflow

### BPMN Overview

```text

Lane: Staff User
  Start Event: Need new extension or webapp
  Task: Install plugin
  Task: Enable or configure plugin
  Task: Access plugin routes or sidebar items
  End Event: Plugin available in UI/API

Lane: Local Tooling
  Task: Run plugin install or uninstall script
  Task: Update plugin registry files

Lane: React SPA
  Task: Load plugin sidebar items
  Task: Load plugin routes at build/runtime

Lane: Cloudflare Worker API
  Task: Mount plugin API routes

Lane: Supabase

Lane: Plugin Runtime
  Task: Provide feature UI and/or API endpoints
```

### Plugin States

  -> disabled or error
```

---

## 9. Runtime Content Consumption Workflow

### BPMN Overview

```text
Pool: ServiceCMS Platform

Lane: End User
  Start Event: Visit published frontend or shared form URL
  Task: Request content page or form page

Lane: External Frontend
  Gateway: Request type?
    -> Published page
    -> Shared form page
  Task: Resolve slug or route
  Task: Fetch backing data from Supabase or CMS-managed route
  Task: Render page or form

Lane: Supabase
  Task: Return page JSONB, form JSONB, and related metadata

Lane: End User
  Gateway: Interaction required?
    -> Read content only
    -> Submit form
  End Event: Content consumed or submission completed
```

### Runtime Read Path

```text
Frontend request
  -> Resolve slug
  -> Fetch page or form data
  -> Render based on stored JSONB
  -> Optional submission back into Worker API
```

---

## 10. Isibot Flow Authoring (PluraDash Plugin)

```text
Pool: ServiceCMS Platform + External isibot-fon Worker

Lane: Staff User (support / super-admin)
  Start Event: New tenant needs a phone-flow
  Task: Open /plugins/pluradash/isibot/flow
  Task: Create new flow or edit existing
  Task: Configure business hours + config
  Task: Add and connect nodes (gather/record/dial/hangup)
  Task: Save flow
  End Event: Flow persisted

Lane: React SPA (PluraDash plugin)
  Task: Load descriptors via isibot.flow.types hook
  Task: Render builder UI with Card/Accordion layout
  Task: Validate inputs against the discriminated union
  Task: POST to /api/plugin/pluradash/isibot/flows
  Task: Display kv_sync.ok from response
  End Event: Editor state synced with response

Lane: Cloudflare Worker API
  Task: Authenticate JWT (support | super-admin)
  Task: Validate payload with Zod (IsibotFlowUpsertSchema)
  Task: Resolve tenant
  Task: Upsert JSONB into pluradash.isibot_flows
  Task: Mirror document to ISIBOT_FLOWS_KV (best-effort)
  Task: Return { flow, kv_sync: { ok, key, synced_at, error } }

Lane: Supabase
  Task: Store flow row (RLS: tenant members SELECT, tenant admins WRITE)

Lane: Cloudflare KV
  Task: Store isibot/{tenantId} -> JSON document
  End Event: KV mirror visible to isibot-fon worker

Lane: External isibot-fon Worker
  Start Event: Incoming Twilio call
  Task: GET isibot/{tenantId} from KV
  Task: Hydrate TwiML state machine from node map
  Task: Render welcome_open / welcome_closed based on business_hours
  End Event: Caller reaches the destination
```

### Decision Logic

```text
Save flow
  -> Supabase row is the source of truth
  -> KV mirror is best-effort
  -> kv_sync.ok === false surfaces a warning (no request failure)
  -> Operator can re-mirror via POST .../sync or the "Jetzt synchronisieren" button
```

### Flow Document Contract

The full document shape, KV key layout, and KV sync semantics are
documented in `specs/isibot-flows.md`. The summary:

- JSONB row in `pluradash.isibot_flows` is authoritative.
- KV key: `isibot/{tenantId}` (single key per tenant holding the full
  document as JSON).
- Setup wizard provisions the `isibot-flows` KV namespace + binding on
  first run; `wrangler.default.jsonc` is never modified.
- RLS: tenant members SELECT, tenant admins INSERT/UPDATE/DELETE.
- Auth on the API: support OR super-admin (mirrors the rest of PluraDash).

---

## Cross-Cutting Control Flows

### Logging and Observability

```text
Incoming API request
  -> agentLogger middleware
  -> request metadata captured
  -> request handled
  -> response and duration logged
```

### Authorization

```text
User/API request
  -> Supabase JWT
  -> access hook injects user_roles
  -> frontend route guard checks role
  -> database RLS checks row access
```

### Content Storage Pattern

```text
Authoring UI
  -> Build structured JSONB payload
  -> Save to Supabase table
  -> Re-read through frontend or API
  -> Render in SPA, external frontend, or agent client
```

---

## End-to-End Repository Workflow Summary

```text
(Start)
  -> Set up infrastructure and secrets
  -> Apply migrations and deploy worker/frontend
  -> Authenticate users and enforce role access
  -> Author schemas, pages, forms, objects, and plugins in the CMS
  -> Persist structured JSONB content in Supabase
  -> Serve data through SPA, Worker REST routes, and MCP
  -> Trigger frontend revalidation when published content changes
  -> Accept runtime submissions and log operational activity
(End: CMS, API, forms, objects, plugins, and frontend ecosystem operating together)
```

---

## Repo-Level BPMN Condensed View

```text
Pool: ServiceCMS Platform

Lane: Staff User
  Start
  -> Configure environment
  -> Log in
  -> Manage schemas
  -> Manage pages
  -> Manage forms
  -> Manage objects
  -> Manage plugins
  -> Author Isibot phone-flows (PluraDash)
  -> Review answers and logs
  End

Lane: React SPA
  -> Authenticate session
  -> Render protected admin UI
  -> Validate authoring input
  -> Save JSONB content
  -> Trigger API workflows

Lane: Cloudflare Worker API
  -> Expose REST and MCP endpoints
  -> Validate requests
  -> Log agent/API traffic
  -> Coordinate revalidation, form submissions, and Isibot KV mirrors

Lane: Supabase
  -> Store users, roles, pages, schemas, forms, objects, answers, plugins
  -> Enforce RLS
  -> Return data to SPA and API

Lane: Cloudflare KV
  -> Mirror Isibot flow documents under isibot/{tenantId}
  -> Read by the external isibot-fon worker on each call

Lane: External Frontend / Agent
  -> Consume schema specs, page content, forms, or objects
  -> Register frontend
  -> Submit answers or request content

Lane: External isibot-fon Worker
  -> Read isibot/{tenantId} from KV
  -> Drive TwiML state machine from the per-tenant node map
```

---

## Notes

This document is intentionally high-level. It is meant to help contributors understand how the repository behaves as a system.

For implementation detail, use these docs alongside this workflow:

- `docs/Architecture.md`
- `docs/Architecture_Pagebuilder.md`
- `docs/Forms.md`
- `docs/Plugin_Development.md`
- `docs/Supabase_Cloudflare-Setup.md`
- `specs/isibot-flows.md` — PluraDash Isibot Flow Builder: JSONB ↔ KV contract, KV key layout, and provisioning notes for the external isibot-fon worker.
