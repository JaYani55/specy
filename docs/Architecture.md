# Architecture Analysis - Mentor Booking Application

This document provides a comprehensive analysis of the frontend architecture, backend communication, and API structure of the Mentor Booking Application.

## 1. Frontend Architecture Analysis

The application is built using **React 18** with **Vite** as the build tool, following a modern component-based architecture with **TypeScript**.

### Current State
- **State Management:** Uses a hybrid approach with **React Context API** for global state (Auth, Theme, Data) and **TanStack Query (React Query)** for server-state management (caching and fetching).
- **UI & Styling:** Leverages **shadcn/ui** (built on Radix UI primitives) and **Tailwind CSS** for a consistent, accessible design system. **Framer Motion** is used for animations.
- **Form Handling:** Robust form management using **React Hook Form** integrated with **Zod** for schema-based validation.
- **Rich Content:** Features a complex "Page Builder" system that uses a JSONB content block structure, with **Tiptap** for rich text editing.

### Identified Problems
1.  **Monolithic Components:** Some page-level components (e.g., `App.tsx`, `PageBuilder.tsx`) have grown significantly, making them harder to audit and maintain.
2.  **Inconsistent Fetching Patterns:** While TanStack Query is present, some hooks still use manual `useEffect` with `useState` for data fetching, leading to potential data staleness or redundant API calls.
3.  **Prop Drilling in Forms:** The `PageBuilderForm` passes the `form` object down to multiple nested section forms (Hero, CTA, etc.) via props, which can be brittle.
4.  **No Internationalization (i18n):** User-facing strings and labels are hardcoded in German. While this is the current target language, it limits future expansion.
5.  **Complex Custom Storage:** `src/lib/supabase.ts` contains a manual implementation of storage to handle cross-browser session persistence, suggesting underlying issues with default session management.
6.  **Dependency Bloat:** (Fixed) The project previously had multiple redundant drag-and-drop libraries and unused UI packages.

### Applied Maintenance & Fixes
-   **Dependency Consolidation:**
    -   Successfully migrated from the deprecated `react-beautiful-dnd` to `@hello-pangea/dnd` in `src/components/admin/GroupMemberList.tsx`.
    -   Removed redundant `@dnd-kit` packages and unused `react-modal` / `react-device-detect`.
-   **Security Hardening:**
    -   Resolved 7 high-severity ReDoS vulnerabilities in `minimatch` by forcing version `^10.2.1` via `package.json` overrides.
    -   Updated `eslint` and `typescript-eslint` to latest stable versions.
-   **Stability & Refactoring:**
    -   **Full SeaTable Decommissioning:** Removed all legacy SeaTable library code, custom hooks, and type definitions. Verified codebase for 0 linting errors post-removal.
    -   **Context API Cleanup:** Refactored `AuthContext` and `DataContext` to eliminate third-party CRM initialization bottlenecks.
    -   **React 18 Named Export Fixes:** Standardized hook imports across high-traffic files (e.g., `App.tsx`) to resolve TS server resolution errors for `useEffect` and `useState`.
-   **Suggested Next Steps:**
    -   **Route Level Code-Splitting:** Implement `React.lazy` and `Suspense` in `App.tsx` to reduce the initial bundle size and improve load times.
    -   **Standardize Server State:** Categorize all API interactions into TanStack Query hooks (`useQuery`, `useMutation`) to ensure consistent caching and simplified error handling.
    -   **Use Form Context:** Refactor deep form structures to use `FormProvider` from `react-hook-form`, allowing nested components to consume the form state via `useFormContext`.
    -   **Introduce i18n Strategy:** Centralize all copy using a library like `react-i18next` to make the codebase more maintainable and ready for localization.
    -   **Refactor Content Block Logic:** Move the complex logic for generating and manipulating content block IDs/types into standalone utility functions or a dedicated custom hook.

---

## 2. Backend Communication & Feature Packets

The application has been migrated to a **Supabase-only architecture**. Historically, the app used a dual-backend setup with SeaTable for mentor management, but this has been decommissioned to improve reliability and reduce technical debt.

### Core Backend (Supabase)
-   **Authentication (Supabase Auth):** Handles user sessions, registration, and role-based access control (RBAC). 
-   **Product & Page Management:** Manages core product data (`mentorbooking_products`) and dynamic page content stored as JSONB in the `products` table.
-   **Mentor & Staff Management:** 
    -   Supabase now acts as the primary source of truth for all users.
    -   Profile metadata (names, bios, initials) is retrieved from the `user_profile` table.
    -   Staff and Mentor identification is handled via the `user_roles` and `roles` tables.
-   **Event & Calendar System:** Facilitates the scheduling of mentoring sessions and tracks event participation. Event history uses Supabase to resolve staff identities.
-   **Media Library (Supabase Storage):** A centralized media management system. Users can browse and upload files (Profile Photos, Product Images) to the `booking_media` bucket.

### Legacy CRM Migration
-   **Decommissioned SeaTable Integration:** All direct connections to the SeaTable API have been removed. 
-   **Under Construction Notice:** Feature sections that relied exclusively on SeaTable data (e.g., detailed mentor bios, specific experience fields) currently display an "Under Construction" migration notice. Data is being transitioned to the `user_profile` table in Supabase.
-   **Fallback Names:** In areas where first/last names were previously sourced from SeaTable, the application now gracefully falls back to the Supabase `Username`.

---

## 3. API Structure & Environment Variables

The application uses specialized clients to interact with Supabase services:

### API Clients
1.  **Supabase Client (`src/lib/supabase.ts`):** The primary client for database operations, authentication, and standard storage tasks.
2.  **FileUpload Client (`src/lib/fileUploadClient.ts`):** A specialized configuration for the Supabase storage bucket that allows for multipart file uploads without manual `Content-Type` boundary management.

### Required Environment Variables
To run the application, only the standard Supabase credentials are required. SeaTable environmental variables are no longer used.

| Variable | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | The URL of your Supabase project (e.g., `https://xyz.supabase.co`). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key for your Supabase project. |

---

## 4. Database Schema & Migrations

All database tables are defined as plain SQL files under `migrations/`. They are applied in dependency order by the interactive setup wizard (`scripts/setup.mjs`) via the **Supabase Management API**.

### Migration Files

| File | Description |
| :--- | :--- |
| `preamble.sql` | **Must run first.** Defines shared types (`app_enum`) and all trigger functions used by later migrations. Fully idempotent via `CREATE OR REPLACE` / `DO $$ … EXCEPTION WHEN duplicate_object`. |
| `user_profile.sql` | User profile table (`public.user_profile`). No foreign-key dependencies outside `auth.users`. |
| `roles.sql` | Application roles table (`public.roles`). Uses the `app_enum[]` type defined in `preamble.sql`. |
| `employers.sql` | Employer organisation table (`public.employers`). Has a FK to `user_profile`. |
| `user_roles.sql` | Many-to-many join between `user_profile` and `roles`. |
| `mentor_groups.sql` | Mentor group definitions. No external FK dependencies. |
| `products.sql` | Product/page records stored as JSONB (`public.products`). Uses `set_current_timestamp_updated_at` and `sync_is_draft_with_status` trigger functions. **Note:** this table is renamed to `pages` by `pages.sql`. |
| `page_schemas.sql` | Schema registry for the dynamic page-builder (`public.page_schemas`). Seeded with the default `service-product` schema. Uses `set_current_timestamp_updated_at`. |
| `mentorbooking_products.sql` | Booking products / pillars (`public.mentorbooking_products`). FK to `products`. |
| `pages.sql` | Renames `products` → `pages`, adds `schema_id` FK to `page_schemas`, and renames the FK constraint on `mentorbooking_products`. **Must run after `mentorbooking_products.sql`** so the constraint to rename already exists. |
| `mentorbooking_events.sql` | Event scheduling table. FKs to `employers` and `mentorbooking_products`. Uses `update_event_status` and `update_event_status_on_request` trigger functions. |
| `mentorbooking_events_archive.sql` | Archived events table. Same FK requirements as `mentorbooking_events`. |
| `mentorbooking_notifications.sql` | Per-user event notifications. FK to `user_profile`. |
| `agent_logs.sql` | Page-builder AI agent request/response log. FK to `page_schemas`. |
| `Auth/Access_hook.sql` | Supabase Auth hook function (`custom_access_token_hook`) that injects `user_roles` into JWT claims. Requires `roles` and `user_roles` tables to exist. Also includes `GRANT EXECUTE … TO supabase_auth_admin`, `GRANT USAGE ON SCHEMA public`, and the corresponding `REVOKE` from `authenticated`, `anon`, `public` — required for the hook to be callable by Supabase Auth internals. |
| `storage.default.sql` _(template)_ | **Template only — not applied directly.** Defines four RLS policies for Supabase Storage (`public read`, `authenticated insert/update/delete`) using the placeholder `REPLACE_WITH_STORAGE_BUCKET`. The wizard substitutes the user-chosen bucket name and applies the result. **Skipped entirely when `STORAGE_PROVIDER = r2`** — Cloudflare R2 manages its own permissions outside Supabase. |

### Dependency Order

```
preamble.sql                    (app_enum, trigger functions)
  └─ user_profile.sql
       └─ employers.sql
       └─ user_roles.sql
  └─ roles.sql
       └─ user_roles.sql
  └─ products.sql
       └─ mentorbooking_products.sql
            └─ pages.sql        (renames products + FK on mentorbooking_products)
            └─ mentorbooking_events.sql
            └─ mentorbooking_events_archive.sql
  └─ page_schemas.sql
       └─ pages.sql
       └─ agent_logs.sql
  mentor_groups.sql             (standalone)
  mentorbooking_notifications.sql  (← user_profile)
  Auth/Access_hook.sql          (← roles + user_roles — must be last)
  storage.sql                   (generated from storage.default.sql — Supabase provider only)
```

### Shared Types & Trigger Functions (`preamble.sql`)

| Symbol | Type | Used by |
| :--- | :--- | :--- |
| `public.app_enum` | `ENUM` | `roles.sql` (`app app_enum[]` column) |
| `set_current_timestamp_updated_at()` | trigger fn | `products.sql`, `page_schemas.sql` |
| `sync_is_draft_with_status()` | trigger fn | `products.sql` (keeps `is_draft` ↔ `status` in sync) |
| `update_event_status()` | trigger fn | `mentorbooking_events.sql` (INSERT / UPDATE trigger) |
| `update_event_status_on_request()` | trigger fn | `mentorbooking_events.sql` (UPDATE trigger) |

---

## 5. Setup Wizard (`scripts/setup.mjs`)

Run with `npm run setup`. An interactive CLI wizard ([@clack/prompts](https://github.com/natemoo-re/clack) + [picocolors](https://github.com/alexeyraspopov/picocolors)) that provisions a fresh Cloudflare Workers deployment end-to-end.

### Wizard Steps

| Step | Function | What it does |
| :--- | :--- | :--- |
| 1 | `stepLogin()` | Runs `wrangler login` if not already authenticated. |
| 2 | `detectAccountId()` | Lists Cloudflare account memberships from `wrangler whoami` and lets the user choose one, or enter an Account ID manually. |
| 3 | `stepSecretsStore()` | Lists existing Secrets Stores via `wrangler secrets-store store list`. Creates one named `service-cms` if none exist. |
| 4 | `patchWranglerJsonc()` | Copies `wrangler.default.jsonc` → `wrangler.jsonc` and substitutes `CF_ACCOUNT_ID` + `SECRETS_STORE_ID`. |
| 5 | `stepApiToken()` | Prompts for a Cloudflare API token and stores it as a Worker secret via `wrangler secret put CF_API_TOKEN`. |
| 6 | `stepSupabaseSecrets()` | Collects Supabase URL, publishable key, secret key, and storage config. Stores: `SUPABASE_PUBLISHABLE_KEY` as a Worker secret; `SUPABASE_SECRET_KEY` in the Secrets Store. Calls `writeEnvFile()` to write `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Vite build-time substitution. |
| 6b | `patchWranglerVars()` | Writes `SUPABASE_URL`, `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `R2_PUBLIC_URL` into the `vars` block of `wrangler.jsonc`. |
| 7 | `stepMigrations()` | Applies all SQL migrations via the Supabase Management API (see below). When `STORAGE_PROVIDER = supabase`, also generates and applies storage RLS policies from `storage.default.sql` with the user-chosen bucket name substituted. Skips storage policies entirely for R2. After all migrations succeed, automatically registers `custom_access_token_hook` as the Supabase JWT claims hook via `PATCH /v1/projects/{ref}/config/auth`. |
| 8 | `stepFirstAdmin()` | Optionally creates the first super-admin user. Creates an auth user with `email_confirm: true` (immediately active), upserts a `super-admin` role with `app: ["mentorbooking"]`, creates a `user_profile` row, and assigns the role via `user_roles`. |
| 9 | `stepBuild()` | Runs `npm run build`. Vite reads `.env` written in step 6 and bakes `VITE_` variables into the browser bundle. |
| 10 | `stepDeploy()` | Runs `wrangler deploy`. |

### Secret Storage Strategy

| Value | Where stored | Reason |
| :--- | :--- | :--- |
| `CF_API_TOKEN` | Worker secret (`wrangler secret put`) | Used by the deployed Worker at runtime for the `/verwaltung/connections` UI |
| `SUPABASE_PUBLISHABLE_KEY` | Worker secret (`wrangler secret put`) | Safe for client use but kept out of source control |
| `SUPABASE_SECRET_KEY` | Cloudflare Secrets Store | Bypasses RLS — must be kept strictly server-side |
| `SUPABASE_URL`, `STORAGE_*` | `wrangler.jsonc` `vars` block (git-ignored) | Non-sensitive; written once by the wizard |

### `wrangler.jsonc` Template System

`wrangler.default.jsonc` is the **committed** template. It contains placeholder strings (`REPLACE_WITH_YOUR_CF_ACCOUNT_ID`, etc.) and defines only the `SS_SUPABASE_SECRET_KEY` binding under `secrets_store_secrets`. The wizard generates `wrangler.jsonc` (git-ignored) by substituting real values — it is never committed.

### Migration Step Detail (`stepMigrations`)

1. **Schema check** — queries the Supabase REST API with the secret key to see if `pages` already exists. If so, offers to skip.
2. **PAT prompt** — asks for a Supabase personal access token (must start with `sb_pat_` or `sbp_`). The PAT is used only during setup and is never stored.
3. **Sequential execution** — applies each file in the [dependency order](#dependency-order) above via `POST https://api.supabase.com/v1/projects/{ref}/database/query`.
4. **Interactive failure handling** — if a migration fails, the error is displayed in full and the user is asked `Continue with remaining migrations? (y/N)` (default: No) before proceeding.
5. **Auth hook registration** — after all migrations succeed, sends `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` with `hook_custom_access_token_enabled: true` and `hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook"`. Equivalent to registering the hook manually in **Authentication → Auth Hooks** in the Supabase dashboard.
