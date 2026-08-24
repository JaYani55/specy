# 2026-08-06 — Database Integration Guide for Agents

## Summary

Added `specs/agents/database-integration.md`, an agent-facing overview of Specy's
database layer and the mandatory dedicated-schema rule for plugin databases.

Contents:

- Data access layer: PostgreSQL via Supabase, `@supabase/supabase-js` as query client
  (no classic ORM), raw idempotent SQL migrations registered in
  `scripts/setup.mjs` → `MIGRATION_ORDER`
- Client discipline: user-scoped client (RLS enforced) vs. admin client (service role,
  Secrets Store key) with usage rules and IDOR guidance
- Core `public` schema map grouped by concern: identity/roles, tenancy, content model,
  platform services; shared RLS helpers and trigger conventions
- **Plugin database rule:** every plugin must own a dedicated schema named after its
  slug — never create tables in `public`, never ALTER core tables. Includes a complete
  neutral reference skeleton (fictional `inventory` plugin): schema creation,
  tenant-scoped table with FK into `public`, RLS policies using shared helpers, grants
  for `authenticated`/`service_role`, and a CASCADE downmigration
- How plugin API routes access their schema (user-scoped vs admin clients)
- Implementation checklist for new plugins

## Files Added

- `specs/agents/database-integration.md`

## Files Changed

- `specs/agents/README.md` — registered the new document
- `specs/README.md` — added quick-answer entry point

## Impact Analysis

- **Database:** none — documentation only.
- **Runtime:** none.
- **API surface:** none.
