# AGENTS.md — Specy CMS

Instructions for AI coding agents and human contributors working on this repository.

---

## 1. What is Specy?

Specy is an **open-source, headless CMS** that treats content as a living specification — serving it anywhere from static frontends to AI agents. It is built for developers who want full control and marketers who need maximum utility.

- **Schema-Driven** — Define once, consume everywhere. Model-agnostic data logic.
- **Agentic MCP** — Expose specs via Model Context Protocol so AI agents understand your data architecture natively.
- **ISR & Blocks** — Real-time block building with Incremental Static Regeneration.
- **Security First** — Cloudflare Secrets Store; API keys never touch the filesystem.
- **Host Anywhere** — Cloudflare Workers (5-minute setup) or Docker / self-hosted.
- **Licensed under EUPL v1.2** — Business-friendly copyleft. Plugins remain separate works.

**Stack:** Hono (API), Supabase (DB/Auth/Storage), React + Vite + TypeScript + Tailwind + shadcn/ui (Dashboard), Cloudflare Workers (deployment).

---

## 2. File Structure & Documentation

### Repository Layout

```
├── api/                  # Hono Worker API (routes, middleware, lib)
├── src/                  # React SPA (pages, components, hooks, services, contexts, lib, types)
├── migrations/           # SQL migration files (ordered, idempotent)
├── functions/            # Supabase Edge Functions (send_email)
├── plugins/              # Workspace plugin directories (gitignored — see §4)
├── scripts/              # Build, install, setup, and registry tooling
├── specs/                # All project documentation (see below)
├── wrangler.jsonc        # Cloudflare Worker config (generated from wrangler.default.jsonc)
└── wrangler.default.jsonc  # Template for wrangler.jsonc
```

### `/specs` Directory

All project documentation lives here. Key files:

| File | Purpose |
|---|---|
| `Architecture.md` | Frontend architecture, backend communication, maintenance history |
| `architecture-workflow.md` | BPMN-style overview of all system workflows |
| `Architecture_Pagebuilder.md` | Page builder architecture deep-dive |
| `Auth-docs.md` | Authentication and authorization model |
| `EUPL_Compliance.md` | EUPL licensing rules for plugins and core |
| `Plugin_Development.md` | Complete plugin development guide |
| `Plugin_Installation.md` | Plugin lifecycle: register, install, configure, update, remove |
| `Forms.md` | Forms subsystem documentation |
| `multi-tenancy.md` | Multi-tenancy model and RLS policies |
| `Specs_MCP_Exposition.md` | MCP server and spec exposure |
| `Supabase_Cloudflare-Setup.md` | Infrastructure setup guide |
| `TIPTAP_INTEGRATION.md` | Rich text editor integration |
| `Core_Extension_AudioBlock_Queues_Secrets.md` | Core extension documentation |
| `TODO - Docker Installer.md` | Docker installer planning |

### `/specs/changes` Directory

Every change must be documented here with a date-prefixed filename: `YYYY-MM-DD-<description>.md`.

Existing change logs:
- `2026-04-13-smtp-notification-foundation.md`
- `2026-06-20-page-schema-visibility-fix.md`
- `2026-07-04-pluradash-worker-connectors.md`

---

## 3. Code of Conduct & Contributor Rules

### Documentation Requirements

- **All changes must be documented** in `/specs/changes/` with the date in the filename (`YYYY-MM-DD-<description>.md`).
- **All new systems and features must be documented** in the `/specs/` folder with a dedicated specification file.
- Change documentation must include: Summary, Files Added, Files Changed, and impact analysis (database, runtime, API surface).

### Core vs. Plugin Boundary (STRICT)

All changes are **strictly bound** between Core Changes and Plugin Changes:

- **Core changes** must be documented in `/specs/` and `/specs/changes/`.
- **Plugin changes** must be documented in the plugin's own repository. Plugins are **separate repositories** and must NOT be committed to the core repo. The `.gitignore` already enforces this: `plugins/*/` is gitignored.
- **Communication between plugins and core** can ONLY happen via clearly delineated **Hooks and APIs**. Plugins must never import internal implementation details from core pages or components.
- **If a new Hook or API is created**, it must be documented in `/specs/` with its contract (target name, scope, context shape, and usage guidance).

### General Rules

- Follow existing folder structure and naming conventions.
- Use TypeScript throughout. No `any` without justification.
- All user-facing text in the dashboard is in German.
- Run `npm run build` before committing — the prebuild hook runs `ensure-registry.mjs` automatically.
- Test your changes locally with `npm run dev` (frontend) and `npm run dev:api` (backend).

---

## 4. EUPL Licensing & Plugin Development

### License

The CMS core is licensed under the **European Union Public Licence v1.2 (EUPL-1.2)**. This is a copyleft license with an important exception: **plugins are separate works**.

### Hook and Provider Architecture

| Entity | Role | EUPL Role |
|---|---|---|
| **CMS Core** | **Provider** | Provides hooks (empty slots: routes, sidebar, API mounting) |
| **Plugin** | **Implementation** | Fills those slots with specific logic |

Because plugins only depend on the *shape* of core interfaces (not internal logic), they qualify as separate works under EU interoperability law. Plugins can be licensed under **any license** (MIT, Apache, proprietary).

### Plugin Rules

- Plugins live in `plugins/{slug}/` and are **separate git repositories**.
- Plugin directories are gitignored (`plugins/*/` in `.gitignore`).
- Plugins communicate with core ONLY through:
  - `PluginDefinition` interface (routes, sidebar items, hooks)
  - Generated plugin route mounting (`/api/plugin/{slug}/`)
  - Documented hook targets (e.g., `settings.defaultLanding.options`, `isibot.flow.types`, `knowledgeBase.entity.actions`)
- Never modify core files (`src/`, `api/`, `migrations/`) for plugin logic.
- Importing from `@/components/ui/*`, `@/contexts/*`, `@/hooks/*`, and `@/types/*` is permitted for interoperability.
- See `specs/Plugin_Development.md` and `specs/EUPL_Compliance.md` for full details.

---

## 5. Migrations & Install Scripts

### Database Migrations

- All SQL migrations live in `/migrations/` with ordered, zero-padded numeric prefixes (e.g., `001_preamble.sql`, `002_user_profile.sql`).
- Migrations must be **idempotent** — safe to run multiple times. Use `CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`, etc.
- **When adding a new migration**, you MUST register it in `scripts/setup.mjs` in the `MIGRATION_ORDER` array at the correct position in the dependency chain.
- Core migrations target the `public` schema. Plugin migrations must target their own dedicated schema (e.g., `my_plugin`).

### Plugin Migrations

- Every plugin migration **MUST** come with a matching **downmigration** file in `migrations/down/` with the same filename.
- Downmigrations must be runnable in reverse order for clean uninstallation.
- The `install-plugins.mjs` script validates migration compliance (downmigrations present, schema ownership, idempotency) before accepting a plugin.
- The `uninstall-plugin.mjs` script prompts to apply downmigrations during removal.

### Cloudflare Worker Bindings

- Wrangler bindings required by plugins (AI Gateway, KV namespaces, Durable Objects) are declared in `plugin.json` under `wrangler_bindings`.
- These are **automatically injected** into `wrangler.jsonc` by `ensure-registry.mjs` (runs on every `predev`/`prebuild`).
- The injection happens inside the auto-generated `PLUGIN BINDINGS` section. Never manually edit that section.
- `r2_buckets`, `vars`, and `secrets_store_secrets` are owned by the CMS core and cannot be declared by plugins.

### Install & Uninstall Scripts

| Script | Purpose |
|---|---|
| `scripts/setup.mjs` | First-time setup wizard (Cloudflare, Supabase, migrations, deploy) |
| `scripts/install-plugins.mjs` | Install plugins from GitHub or Supabase registry |
| `scripts/uninstall-plugin.mjs` | Cleanly remove a plugin (directory, registry, deps, downmigrations) |
| `scripts/ensure-registry.mjs` | Rebuild plugin registries + wrangler bindings (runs on predev/prebuild) |
| `scripts/register-plugins.mjs` | Rebuild registries from workspace plugins |

### Generated Files (do not edit manually)

These are regenerated by the scripts above and are gitignored:
- `src/plugins/registry.ts` — plugin entrypoint imports
- `src/plugins/hooks-registry.ts` — flattened hook contributions
- `api/plugin-routes.ts` — Hono route mount table
- `api/plugin-hooks.ts` — backend hook contributions
- `api/plugin-metadata.ts` — runtime discovery metadata
- `plugin-deps.json` — per-plugin npm dependency tracking
- `wrangler.jsonc` — generated from `wrangler.default.jsonc` + plugin bindings