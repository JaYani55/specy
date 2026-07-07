# Specy — Open Source CMS for Spec-Driven Development

The architect's choice for modern web ecosystems. Powered by [Hono](https://hono.dev/), [Supabase](https://supabase.com/), and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

[Start Building](https://github.com/JaYani55/specy) · `npm run setup`

---

## What is Specy?

Specy is an open-source, headless CMS that treats your content as a living specification — serving it anywhere from static frontends to AI agents. It's built for developers who want full control and marketers who need maximum utility.

- **Schema-Driven** — Define once, consume everywhere. Model-agnostic approach keeps your data logic pure and portable.
- **Agentic MCP** — Expose your specs via Model Context Protocol. Let AI agents understand your data architecture as natively as your frontend does.
- **ISR & Blocks** — Real-time block building with Incremental Static Regeneration. Static performance with dynamic editing power.
- **Security First** — Cloudflare Secrets Store ensures your API keys never touch the filesystem. MCP tools are exposed through a secure, permissioned proxy layer.
- **Host Anywhere** — Cloudflare native (5-minute setup) or Docker / self-hosted on your own infrastructure.
- **Licensed under EUPL v1.2** — The most business-friendly copyleft license. Protects your work without forcing virality on proprietary plugins or separate modules.

---

## Core Features

Specy is a **business backend** that saves your business data as specifications. Every content type is a living spec, consumable via REST and MCP for seamless automation integration.

### 1. Headless CMS Page Builder
Define page schemas easily over JSON or the visual schema builder, then connect your frontend via a coding agent over MCP. Define any dynamic object — galleries, blogs, landing pages, product catalogs. Full control for developers, maximum workflow utility for marketers.

### 2. Forms Builder
Build forms with a visual builder or raw JSON schema. Connect your frontend directly to the REST API. Toggle email notifications to staff on submission. One database, one schema — every form, every answer, every integration.

### 3. Events
Define events and connect them to calendar APIs to display directly on any page. Let users sign up for events on your website without handing off booking processes to third-party tools.

### 4. Staff Directory
Define staff profiles, connect them to on- and offboarding processes, and dynamically display team information on your website. Never leave outdated information on your webpages again.

### 5. Dynamic Objects
Define arbitrary JSON objects — pricing lists, configuration tables, reference data — and display them in your frontend or expose them via MCP to customer-facing chatbots.

### REST & MCP Exposure
Every feature exposes its data dynamically through REST endpoints and the MCP server. AI agents, chatbots, and external services can discover, read, and write your content using the same interfaces your frontend uses.

---

## Install & Update Process

### 🚀 Quick Start

```sh
npm install
```

### Run Setup Wizard
```sh
npm run setup
```
This interactive script guides you through Cloudflare login, Worker and Supabase secret wiring, database migrations, Supabase Edge Function deployment, the first admin account, and the initial Cloudflare deploy.

On Windows you can also use `setup.bat`. On Unix-like systems you can use `./setup.sh`.

### Local Development

**Terminal 1: Frontend (Dashboard)**
```sh
npm run dev
```

**Terminal 2: Backend (API)**
```sh
npm run dev:api
```

### Production
```sh
npm run build
npm run deploy:api
```

### Updating A Live Deployment
```sh
npm run cf:update
```
The updater pulls the latest code, runs integrity checks, rebuilds, and redeploys in one step. It validates origin, checks for local changes, compares core migrations against your Supabase instance, and re-applies any missing migrations before deploying.

```sh
npm run cf:update:check    # integrity checks only
npm run cf:update:dry-run  # preview pending changes
```

On Windows: `scripts\cf-update.bat` · On Linux/macOS: `bash scripts/cf-update.sh`

### New Install Verification
1. The wizard reports successful database migrations and auth hook registration.
2. The wizard reports `send_email` deployed and the admin UI mail test succeeds under `/verwaltung/connections`.
3. Submitting a configured form creates rows in `forms_answers` and `mail_delivery_jobs`.
4. The deployed Worker has three runtime secrets bound: `CF_API_TOKEN`, `SUPABASE_PUBLISHABLE_KEY`, and `SECRETS_ENCRYPTION_KEY`.
5. If the setup run had to retry Worker secrets after the first deploy, the follow-up redeploy completed successfully.

---

## Plugin Installation and Development

Specy features a modular plugin architecture built on the Hook and Provider pattern. Plugins live in the `plugins/` directory and interact with the core through defined interfaces — they never modify core files.

### Plugin Management Commands
```sh
npm run plugin:install:all    # Install all plugins
npm run plugin:install        # Install a specific plugin
npm run plugin:install:local  # Install local plugins
npm run plugin:remove         # Remove a plugin
```

### Plugin Development
- Keep all plugin logic within your plugin directory (`plugins/{slug}/`).
- Use the official `PluginDefinition` and `PluginManifest` interfaces to register your plugin.
- Namespace your routes under `/plugins/{slug}/`.
- Never modify files in `src/components/`, `src/pages/`, or `api/` directly — the build system gathers your plugin code automatically.

See [specs/EUPL_Compliance.md](specs/EUPL_Compliance.md) for detailed development guidelines.

---

## EUPL Licensing and Hooks

This CMS core is licensed under the **European Union Public Licence v1.2 (EUPL-1.2)**. Plugins are structured as separate works through the **Hook and Provider Architecture**:

| Entity | Role | EUPL Role |
|---|---|---|
| **CMS Core** | **Provider** | Provides hooks (empty slots like routes, sidebar, API mounting). |
| **Plugin** | **Implementation** | Fills those slots with specific logic. |

Because the plugin does not require the internal logic of the CMS to function — only the *shape* of the interfaces — it qualifies as a separate work under the interoperability exceptions of European copyright law.

This means you can distribute plugins under any license (MIT, Apache, proprietary) without triggering the EUPL's copyleft clause.

See [specs/EUPL_Compliance.md](specs/EUPL_Compliance.md) for the full compliance guide.

---

## Become a Contributor

Interested in contributing to Specy? We'd love to hear from you.

**Write to:** [jay@pluracon.org](mailto:jay@pluracon.org)
