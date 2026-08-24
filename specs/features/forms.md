# Forms Feature

## Overview

The Forms feature turns ServiceCMS into a form authoring, hosting, and submission platform inside the existing CMS. Forms are stored as JSONB definitions in Supabase, managed through a dedicated `/forms` area in the React SPA, exposed through public or authenticated share links, and available to agents through REST endpoints on the Cloudflare Worker API.

The feature supports three delivery modes:

1. **CMS-managed forms** in `/forms` for staff users.
2. **Reusable form references inside page content** through a new `form` content block in the page builder.
3. **Direct share and agent access** through public/authenticated URLs and REST endpoints.

The implementation follows the same broad design principles already used for pages and schemas:

- JSONB-backed authoring model
- Supabase as system of record
- role-based access through Supabase JWT claims and RLS
- Cloudflare Worker API for machine access
- manual English/German UI labels in the CMS

---

## User Flows

### 1. Create and Manage Forms in the CMS

Staff users can navigate to `/forms` and:

- create a new form
- define the form schema as JSON
- add optional LLM instructions
- choose whether the form is draft, published, or archived
- choose whether the form can be opened through a direct share page
- choose whether the form can be accessed through the REST API
- choose whether authentication is required for both share access and API submissions
- inspect submitted answers in `/forms/:formId/answers`

### 2. Embed Forms in Pages

The page builder supports a `form` content block. This block does **not** store a snapshot copy of the form schema. Instead, it stores a reference to a published form.

This means:

- page JSONB stores `form_id` plus form metadata
- the same form can be reused across multiple pages
- updates to the form definition can be reflected wherever the form is rendered

### 3. Direct Share Pages

When `share_enabled` is true, a form can be opened directly from the ServiceCMS domain via its `share_slug`.

Examples:

- `/forms/share/jay/contact-form`
- `/forms/share/workspace-a/lead-capture`

If `requires_auth` is true, the share page is only usable by authenticated users.

The tenant segment in public share URLs must be the workspace slug from `public.tenants.slug`.

- Correct: `/forms/share/jay/contact-form`
- Incorrect: building the path from `public.tenants.name`

Backend routes may still accept legacy name-derived tenant segments for compatibility, but all new frontend links and embedded references must use `tenant.slug`.

### 4. Agent / REST Access

The Worker API exposes machine-readable form definitions and accepts submissions.

This supports:

- AI agents that need to inspect required fields before filling them
- external automation or web apps that need to submit answers programmatically
- authenticated submissions using a Supabase bearer token when the form requires authentication

---

## Data Model

### `public.forms`

The `forms` table stores authored forms.

| Column | Type | Details |
| --- | --- | --- |
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `name` | `varchar(255)` | Human-readable name |
| `slug` | `varchar(255)` | Internal unique slug |
| `description` | `text` | Optional description |
| `schema` | `jsonb` | Form field definition |
| `llm_instructions` | `text` | Optional agent guidance |
| `status` | `varchar(50)` | `draft` \| `published` \| `archived` |
| `share_enabled` | `boolean` | Enables direct share page |
| `share_slug` | `varchar(255)` | Unique ServiceCMS route slug for shared access |
| `requires_auth` | `boolean` | One auth mode for share and API access |
| `api_enabled` | `boolean` | Enables REST access |
| `created_at` | `timestamptz` | Creation timestamp |
| `updated_at` | `timestamptz` | Auto-updated via trigger |
| `published_at` | `timestamptz` | First/last published timestamp |
| `type` | `varchar(50)` | `form` \| `poll` |
| `deadline_at` | `timestamptz` | Optional submission cutoff |
| `voting_mode` | `varchar(50)` | `anonymous` \| `name_only` \| `auth` |
| `reminder_interval` | `varchar(50)` | `off` \| `hourly` \| `daily` \| `weekly` |
| `reminders_enabled` | `boolean` | Enables automated staff reminders |

### `public.forms_answers`

The `forms_answers` table stores all submitted answers.

| Column | Type | Details |
| --- | --- | --- |
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` |
| `form_id` | `uuid` FK | References `public.forms(id)` |
| `submitted_by` | `uuid` | Optional `auth.users.id` when authenticated |
| `submitter_name` | `text` | Display name for non-auth polls |
| `answers` | `jsonb` | Submitted values |
| `source_slug` | `text` | Where the form was filled, e.g. a page slug or share slug |
| `submitted_via` | `varchar(50)` | `share` \| `api` \| `page` |
| `ip_address` | `text` | Optional request metadata |
| `user_agent` | `text` | Optional request metadata |
| `created_at` | `timestamptz` | Submission timestamp |

The `source_slug` field is required for staff review workflows because it shows where the form was used.

---

## Form Schema Format

Forms use a simpler schema model than page schemas. Each top-level key defines a single input field.

Example:

```json
{
  "first_name": {
    "type": "text",
    "label": "First name",
    "placeholder": "Ada",
    "required": true
  },
  "email": {
    "type": "email",
    "label": "Email",
    "placeholder": "ada@example.com",
    "required": true,
    "meta_description": "Primary contact address for follow-up."
  },
  "message": {
    "type": "textarea",
    "label": "Message",
    "placeholder": "How can we help?",
    "required": true
  },
  "topic": {
    "type": "select",
    "label": "Topic",
    "required": true,
    "options": ["Sales", "Support", "Partnership"]
  }
}
```

Supported field types in the first implementation:

- `text`
- `textarea`
- `help-text` *(display-only markdown guidance, not submitted as an answer)*
- `image` *(display-only image selected from the media picker, not submitted as an answer)*
- `email`
- `number`
- `file-upload`
- `checkbox`
- `select`
- `radio`
- `date`
- `consent-poll` *(special consensus poll configuration block)*
- `consent-vote` *(rendering component for the public vote interface)*

Field properties:

| Property | Required | Purpose |
| --- | --- | --- |
| `type` | yes | Field renderer and validator |
| `label` | yes | User-facing label |
| `description` | no | Help text shown in the UI |
| `placeholder` | no | Input placeholder |
| `meta_description` | no | Agent/developer context |
| `required` | no | Validation flag |
| `options` | conditional | Required for `select` and `radio` |
| `content` | conditional | Markdown body for `help-text` blocks |
| `src` | conditional | Public image URL for `image` blocks |
| `alt` | conditional | Accessible text for `image` blocks |
| `caption` | conditional | Optional caption for `image` blocks |
| `upload_provider` | conditional | Optional plugin-owned upload adapter, e.g. `pluradash` |
| `upload_folder` | conditional | Folder template used by the active upload provider |

---

## LLM Instructions

Each form can store `llm_instructions` alongside the schema.

Purpose:

- guide agents on how to interpret field intent
- document data-quality expectations
- explain constraints not obvious from the raw field list
- provide submission guidance for automation clients

Typical examples:

- "Do not fabricate contact details."
- "Always send business email addresses when available."
- "Use ISO dates in the date field."

The Worker API includes these instructions in the machine-readable response returned by `GET /api/forms/...`.

---

## Delivery Modes

### CMS Admin Mode

Protected routes:

- `/forms`
- `/forms/new`
- `/forms/:formId`
- `/forms/:formId/answers`

These screens are available to the same broad staff/admin audience that can access the existing CMS management areas.

### Page Builder Mode

The page builder content system now supports a block of type `form`.

Stored block shape:

```json
{
  "id": "content-1712420000000-abcd12345",
  "type": "form",
  "form_id": "<uuid>",
  "form_slug": "lead-capture",
  "form_name": "Lead Capture",
  "share_slug": "lead-capture",
  "requires_auth": false
}
```

This is intentionally a reference-based block rather than an embedded snapshot.

### Display-Only Blocks

The forms builder now supports two non-fillable block types alongside normal inputs:

- `help-text`: rendered as markdown in the public form and edited with the page-builder tiptap markdown editor
- `image`: rendered as a media-backed image and edited with the page-builder media picker

These blocks are stored in the same JSON schema but are skipped by answer generation and submission validation.

### File Upload Storage Hooks

The forms builder exposes plugin hook targets for file uploads so storage providers stay separate from core CMS logic.

Current hook surfaces:

- `forms.fileUpload.builder` for tenant-aware builder warnings and default provider selection
- `forms.fileUpload.upload` for backend storage handling
- `forms.fileUpload.notification` for enriching notification e-mails with provider-specific download links

This keeps the upload implementation EUPL-safe by routing provider behavior through declared interfaces instead of hardcoding plugin logic into core forms routes.

When no enabled provider is available for the selected tenant and current JWT role, the file-upload block shows `No File Storage configured`.

When PluraDash is enabled for the selected tenant, the builder stores uploads under the tenant file archive path:

- `file-archive/forms/{form_slug}/{field_name}/{submission_id}`

Notification e-mails include a PluraDash dashboard deep link for each uploaded file so support users can open the archive and trigger the authenticated download flow.

### Share Page Mode

The frontend exposes a public route matching `/:formShareSlug`.

Important constraints:

- `share_slug` must be unique
- `share_slug` must not collide with reserved app routes like `/events`, `/pages`, `/admin`, `/plugins`, `/login`, or `/forms`
- if `requires_auth` is enabled, the share page requires an authenticated session

### REST / Agent Mode

The Worker API exposes:

- `GET /api/forms`
- `GET /api/forms/:identifier`
- `POST /api/forms/:identifier/answers`
- `GET /api/forms/share/:shareSlug`
- `POST /api/forms/share/:shareSlug/answers`

Where `:identifier` can be either the form UUID or the internal slug.

---

## Poll Feature

The Poll feature is a specialized extension of the Forms system designed for quick consensus-finding and team coordination.

### Specialized Voting Modes

Polls can operate in three identity modes:

1. **Anonymous**: No identifying information is collected.
2. **Name Only**: Submitter provides a display name but no authentication is required.
3. **Authenticated**: Requires a Supabase session (standard for internal staff polls).

### Consensus Modeling (`consent-poll`)

Polls use a "Consensus" model instead of simple radio buttons. Options are configured in a specialized `consent-poll` field:

- Each option can be flagged with `is_ideal`, `is_acceptable`, or `is_forced`.
- Respondents use the `consent-vote` interface to express their position on each option.

### Deadlines and Automation

Polls support hard deadlines (`deadline_at`). Once the deadline passes:
- The share page closes for new submissions.
- Final results are calculated and visualized.

### Staff Reminders

When `reminders_enabled` is true, the Cloudflare Worker runs a `scheduled` job to identify staff members who haven't responded yet:
- Checks `reminder_interval` (Hourly, Daily, Weekly).
- Cross-references `public.user_profile` with `public.forms_answers`.
- Batches and sends email notifications via the mail delivery system.

### Results Visualization

All forms (and polls specifically) include a `/results` dashboard:
- **Pie Charts**: Distribution of simple radio/select responses.
- **Participation List**: Table of responses by name/user.
- **Consensus Matrix**: Aggregated positioning for consent-based polls.

---

## Microsoft Teams Integration

The forms system supports rich link unfurling and native sharing for Microsoft Teams.

### 1. Open Graph (OG) Data

Public share pages dynamically inject Open Graph meta tags into the document head when a form definition is loaded. Teams uses these tags to generate a visual preview card.

| Tag | Content Source |
| --- | --- |
| `og:title` | Form `name` |
| `og:description` | Form `description` |
| `og:url` | Current share URL (tenant-slug based) |
| `og:type` | `website` |

If `requires_auth` is true, the Teams scraper will not be able to bypass the login requirement and will show a generic card for the login page.

### 2. Teams Share Button

The `FormSharePage` includes a declarative share button that triggers the Teams payload distribution center.

- **Launcher Script**: `https://teams.microsoft.com/share/launcher.js`
- **Class Identifier**: `teams-share-button`
- **Configuration**:
    - `data-href`: The canonical share URL (built using `tenant.slug`).
    - `data-icon-type`: Set to `small` for header integration.

### 3. Transport Workflow

1. **Trigger**: User clicks the share button.
2. **Pop-up**: A `window.open()` pop-up opens `https://teams.microsoft.com/share`.
3. **Selection**: User selects target channel/chat.
4. **Unfurling**: Teams backend performs a standard `GET` to the shared URL to fetch OG metadata.
5. **Post**: The preview card and optional message are injected into the Teams conversation.

---

## API Contracts

### `GET /api/forms`

Returns all published forms visible to the current caller.

Example response:

```json
{
  "forms": [
    {
      "id": "...",
      "name": "Lead Capture",
      "slug": "lead-capture",
      "description": "Collect inbound requests.",
      "status": "published",
      "share_enabled": true,
      "share_slug": "lead-capture",
      "requires_auth": false,
      "api_enabled": true
    }
  ]
}
```

### `GET /api/forms/:identifier`

Returns one published form in a normalized machine-readable structure.

Example response:

```json
{
  "form": {
    "id": "...",
    "name": "Lead Capture",
    "slug": "lead-capture",
    "description": "Collect inbound requests.",
    "status": "published",
    "share_enabled": true,
    "share_slug": "lead-capture",
    "requires_auth": false,
    "api_enabled": true
  },
  "fields": [
    {
      "name": "email",
      "type": "email",
      "label": "Email",
      "required": true,
      "placeholder": "ada@example.com",
      "meta_description": "Primary contact address for follow-up."
    }
  ],
  "llm_instructions": "Do not fabricate contact details."
}
```

### `POST /api/forms/:identifier/answers`

Request body:

```json
{
  "answers": {
    "email": "ada@example.com",
    "message": "Please contact me."
  },
  "source_slug": "service-offer-page",
  "submitted_via": "page"
}
```

Success response:

```json
{
  "success": true,
  "answer_id": "<uuid>"
}
```

Validation behavior:

- unknown fields are rejected
- required fields must be present
- `email` values must match an email format
- `number` values must be numeric
- `select` and `radio` values must be one of the allowed options
- `checkbox` values must be boolean

### Share Endpoints

`GET /api/forms/share/:shareSlug` and `POST /api/forms/share/:shareSlug/answers` use the same normalized definition and submission contract, but resolve the form by `share_slug` instead of internal slug/UUID.

---

## Authentication and RLS

The feature follows the project’s existing auth model based on Supabase JWT claim roles.

### CMS Access

CMS management screens under `/forms` are protected through the same route-guarding approach used by `/pages` and `/admin`.

### Form Visibility Rules

- authenticated users can read forms through Supabase client access according to RLS
- anonymous users can only read forms that are `published` and enabled for sharing or API access and do not require auth
- archived forms are not intended for public use

### Submission Rules

- anonymous users can submit only to published forms that do not require auth
- authenticated users can submit to published forms when allowed by the form configuration
- the API and share page both use the same `requires_auth` flag

### Answer Review Rules

Submitted answers are readable only through authenticated CMS access and are intended for staff/admin review workflows.

---

## Frontend Surface Area

Main frontend files:

- `src/pages/Forms.tsx` — forms list screen
- `src/pages/FormEditor.tsx` — JSON schema editor and settings
- `src/pages/FormAnswers.tsx` — answer review view
- `src/pages/FormSharePage.tsx` — direct share renderer and submit flow
- `src/services/formService.ts` — frontend CRUD and submission helpers
- `src/utils/forms.ts` — schema parsing, slug generation, reserved-route checks
- `src/types/forms.ts` — shared form contracts

Navigation updates:

- sidebar entry in `AppSidebar.tsx`
- navbar entry in `Navbar.tsx`
- breadcrumb support in `Breadcrumb.tsx`

---

## Backend Surface Area

Main backend files:

- `migrations/forms.sql`
- `migrations/forms_answers.sql`
- `api/routes/forms.ts`
- `api/index.ts`
- `scripts/setup.mjs`

The setup wizard’s explicit migration order was updated so fresh installs create the new tables automatically.

---

## Operational Notes

### Reserved Share Slugs

Because direct share pages live at the ServiceCMS root, not under `/forms/:slug`, reserved route checks are essential. A share slug must not collide with existing app routes.

### Tenant URL Rule

Public share routes are tenant-scoped. Use `public.tenants.slug` as the canonical tenant URL segment across forms, objects, embedded content blocks, and API examples. Do not derive public URLs from `public.tenants.name`.

### Current Scope

This first implementation intentionally keeps the form model narrow:

- flat top-level fields only
- no nested groups or multi-step flows
- no file-upload field type yet
- no version-history table yet
- no notification or webhook system on submission yet

### Recommended Future Extensions

Potential follow-up work:

1. add form versioning
2. add file-upload fields with storage retention rules
3. add answer export and filtering
4. add notification hooks or email workflows
5. add dedicated frontend renderers for embedded page forms

---

## Verification Checklist

When working on this feature, verify the following:

1. new installs create `forms` and `forms_answers`
2. `/forms` allows create, edit, and archive workflows
3. published forms appear in the page-builder form picker
4. direct share pages load correctly for valid `share_slug` values
5. auth-required forms reject anonymous access on share and REST endpoints
6. REST `GET` returns normalized fields plus `llm_instructions`
7. REST `POST` validates answers and stores `source_slug`
8. `/forms/:formId/answers` shows submitted answers and source metadata
