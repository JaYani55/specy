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
├── specs/                # Knowledge base: topical documentation folders (see below)
├── wrangler.jsonc        # Cloudflare Worker config (generated from wrangler.default.jsonc)
└── wrangler.default.jsonc  # Template for wrangler.jsonc
```

### `/specs` — Knowledge Base

All project documentation lives in `/specs`, organized as a **knowledge base with
topical folders**. Each folder contains a `README.md` indexing its documents; the root
[`specs/README.md`](specs/README.md) is the master map.

**How to navigate:**

1. Start at `specs/README.md` — it maps every folder and answers common questions.
2. Open the relevant topical folder's `README.md`, then the individual documents.
3. Follow relative cross-links between documents as needed.
4. When adding documentation: place it in the matching topical folder, use a
   kebab-case filename, and register it in that folder's `README.md`.
5. Older documents in `specs/changes/` may reference pre-restructure paths — treat
   those references as historical.

| Folder | Purpose |
|---|---|
| `specs/architecture/` | System overview, page builder deep-dive, BPMN workflow overview |
| `specs/auth/` | Authentication & authorization model, OAuth 2.1 MCP authentication |
| `specs/platform/` | Supabase/Cloudflare setup, multi-tenancy & RLS, core extensions (audio blocks, queues, secrets) |
| `specs/features/` | Forms subsystem, Tiptap rich text integration |
| `specs/plugins/` | Plugin development guide, installation lifecycle, EUPL licensing |
| `specs/agents/` | Agent-facing docs: MCP exposition, agent system prompt, frontend integration manifest/prompt specs, R2 file storage integration |
| `specs/plans/` | Forward-looking plans and drafts (not yet implemented) |
| `specs/changes/` | Date-prefixed change records — mandatory for every change |

Key entry points:

- New to the codebase → `specs/architecture/system-overview.md`
- Auth model → `specs/auth/authentication-authorization.md`
- Multi-tenancy / RLS → `specs/platform/multi-tenancy.md`
- Writing plugins → `specs/plugins/development.md`
- Storing files/media → `specs/agents/r2-file-storage.md`

### `/specs/changes` Directory

Every change must be documented here with a date-prefixed filename: `YYYY-MM-DD-<description>.md`.

Existing change logs:
- `2026-04-13-smtp-notification-foundation.md`
- `2026-06-20-page-schema-visibility-fix.md`
- `2026-07-04-pluradash-worker-connectors.md`
- `2026-09-09-binding-intent-provisioning.md`

---

## 3. Code of Conduct & Contributor Rules

### Documentation Requirements

- **All changes must be documented** in `/specs/changes/` with the date in the filename (`YYYY-MM-DD-<description>.md`).
- **All new systems and features must be documented** in `/specs/` inside the matching topical folder (with a kebab-case filename), registered in that folder's `README.md`, and listed in `specs/README.md` if a new folder is created.
- Change documentation must include: Summary, Files Added, Files Changed, and impact analysis (database, runtime, API surface).

### Core vs. Plugin Boundary (STRICT)

All changes are **strictly bound** between Core Changes and Plugin Changes:

- **Core changes** must be documented in `/specs/` and `/specs/changes/`.
- **Plugin changes** must be documented in the plugin's own repository. Plugins are **separate repositories** and must NOT be committed to the core repo. The `.gitignore` already enforces this: `plugins/*/` is gitignored.
- **Communication between plugins and core** can ONLY happen via clearly delineated **Hooks and APIs**. Plugins must never import internal implementation details from core pages or components.
- **If a new Hook or API is created**, it must be documented in the appropriate `/specs/` topical folder with its contract (target name, scope, context shape, and usage guidance).
- **Every new plugin hook target must be documented in [`specs/agents/plugin-hooks.md`](specs/agents/plugin-hooks.md)** — the authoritative hook target registry (§2 dispatch table: target, scope, kind, dispatch point, context shape, status). Undocumented hooks are treated as incomplete. Declared-but-unwired targets (in `hook_metadata` without core dispatch) must be flagged there with a ⚠️ status.

### General Rules

- Follow existing folder structure and naming conventions.
- Use TypeScript throughout. No `any` without justification.
- All user-facing text in the dashboard is in German.
- Do not document UI/technical behavior in the frontend. User-facing UI must stay free of technical or meta documentation (e.g. default values, feature-flag behavior, implementation notes). Such information belongs in `/specs`, not in the interface the user sees.
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
- See `specs/plugins/development.md` and `specs/plugins/eupl-compliance.md` for full details.

---

## 5. Migrations & Install Scripts

### Database Migrations

- All SQL migrations live in `/migrations/` with ordered, zero-padded numeric prefixes (e.g., `001_preamble.sql`, `002_user_profile.sql`).
- Migrations must be **idempotent** — safe to run multiple times. Use `CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`, etc.
- **When adding a new migration**, you MUST register it in `scripts/lib/migration-order.mjs` in the `MIGRATION_ORDER_CORE` array at the correct position in the dependency chain (validated by `tests/coreMigrations.test.mjs`).
- Core migrations target the `public` schema. Plugin migrations must target their own dedicated schema (e.g., `my_plugin`).

### Plugin Migrations

- Every plugin migration **MUST** come with a matching **downmigration** file in `migrations/down/` with the same filename.
- Downmigrations must be runnable in reverse order for clean uninstallation.
- The `install-plugins.mjs` script validates migration compliance (downmigrations present, schema ownership, idempotency) before accepting a plugin.
- The `uninstall-plugin.mjs` script prompts to apply downmigrations during removal.

### Cloudflare Worker Bindings

- **Binding management is part of a plugin.** Developers declare their cloud system bindings based on the deployment path (`deployment_path` in `plugin.json`) — **`cloudflare` is the current default and only deployment path**. Plugins declare *intents* (`wrangler_intents`: binding + purpose + scope), never concrete instances; core resolves per-environment instance names (`{worker-name}--{plugin-id}--{purpose}`), provisions them (`npm run bindings:provision`, create-or-get + git-ignored resource ledger `.bindings-ledger.json`) and injects the resolved entries.
- The deprecated legacy form `wrangler_bindings` (concrete instance entries, injected verbatim) is still accepted during migration; `wrangler_intents` wins when both are present. Mixed workspaces are supported.
- Binding intent validation runs at install time and on every `predev`/`prebuild` (via `ensure-registry.mjs`); violations abort with plugin-referenced errors. Provisioning failures are config-level errors that abort before `wrangler deploy`.
- The injection happens inside the auto-generated `PLUGIN BINDINGS` section. Never manually edit that section.
- `r2_buckets` is owned by the CMS core and cannot be declared by plugins — plugins consume the shared `MEDIA_BUCKET` binding. `vars` and `secrets_store_secrets` merge into the core sections with per-name conflict detection (duplicates across plugins abort the build).
- Full contract (resolution, provisioning, ledger, teardown, deployment-path extensibility for other vendors): [`specs/platform/binding-management.md`](specs/platform/binding-management.md).

### Install & Uninstall Scripts

| Script | Purpose |
|---|---|
| `scripts/setup.mjs` | First-time setup wizard (Cloudflare, Supabase, migrations, deploy) |
| `scripts/install-plugins.mjs` | Install plugins from GitHub or Supabase registry |
| `scripts/uninstall-plugin.mjs` | Cleanly remove a plugin (directory, registry, deps, downmigrations) |
| `scripts/ensure-registry.mjs` | Rebuild plugin registries + wrangler bindings (runs on predev/prebuild) |
| `scripts/register-plugins.mjs` | Rebuild registries from workspace plugins |
| `scripts/state-recheck.mjs` | Reconcile recorded deployment state against local manifests/live systems (`npm run state:recheck`) |

### Deployment State Publication

- Every **major component** (core Worker deploy, core migrations, core edge
  functions, auth hook) and every **plugin** must record its deployment/install
  state in `public.deployment_state` **after the external system confirms
  success** (write-after-confirm). State is tagged with `owner_kind`
  (`core`/`plugin`) and `component`; plugin rows must carry `plugin_id`
  (FK → `public.plugins`).
- **New plugins** must have their install flow write `code`, `migrations`,
  `claims` and `bindings` rows; their uninstall flow must remove them (cascade
  + explicit teardown).
- **New migration/state keys** must be added to the component taxonomy in
  [`specs/platform/unified-setup-tui.md`](specs/platform/unified-setup-tui.md)
  (or its successor) and covered by a test.
- State is **never** written before confirmation, **never** carries secrets, and
  is **always** idempotent (`ON CONFLICT DO UPDATE`). Re-check/repair with
  `npm run state:recheck -- --sync`.

### Generated Files (do not edit manually)

These are regenerated by the scripts above and are gitignored:
- `src/plugins/registry.ts` — plugin entrypoint imports
- `src/plugins/hooks-registry.ts` — flattened hook contributions
- `api/plugin-routes.ts` — Hono route mount table
- `api/plugin-hooks.ts` — backend hook contributions
- `api/plugin-metadata.ts` — runtime discovery metadata
- `api/plugin-claims.ts` — plugin claim declaration registry (descriptive; see specs/auth/plugin-claims.md)
- `api/plugin-bindings.ts` — plugin binding intent descriptor registry (descriptive; see specs/platform/binding-management.md)
- `plugin-deps.json` — per-plugin npm dependency tracking
- `.bindings-ledger.json` — per-deployment resource ledger for provisioned plugin binding instances (BIPS)
- `wrangler.jsonc` — generated from `wrangler.default.jsonc` + plugin bindings