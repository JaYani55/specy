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
