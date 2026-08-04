# 2026-08-03 — Standard frontend prompt specs

## Summary

Added canonical Astro, Next.js, and framework-neutral Specy frontend implementation prompts. Added explicit guidance for both page-collection and single-page schemas, replacing SvelteKit guidance in the frontend onboarding flows. The prompts are seeded as public published MCP registry specs and are intended for direct agent retrieval and copy/paste.

## Files Added

- `migrations/202608030002_frontend_prompt_specs.sql`
- `migrations/202608030003_global_llm_specs.sql`
- `specs/Frontend_Prompt_Specs.md`
- `specs/changes/2026-08-03-frontend-prompt-specs.md`

## Files Changed

- `scripts/setup.mjs`
- `scripts/lib/core-update.mjs`
- `src/pages/Pages.tsx`
- `src/components/pagebuilder/SchemaWaitingScreen.tsx`
- `src/App.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/pages/McpPromptSpecs.tsx`
- `api/lib/specRegistry.ts`
- `api/routes/specs.ts`

## Impact analysis

### Database

Adds the tenant-independent `public.global_llm_specs` table and copies the three standard prompts into it. The original `public.llm_specs` seed remains for compatibility.

### Runtime

The dashboard gains Astro and Next.js prompt selection and a protected `/mcp/specs` prompt-library page. Existing `/mcp` registry behavior remains unchanged.

### API surface

The standard records are discoverable through existing `/api/specs`, `/api/specs/:slug`, and dynamic MCP registry tools. No secrets or private content are added.
