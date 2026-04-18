# Booking Content Management System

A modern, decoupled CMS built with Vite, React, and Cloudflare Workers.

## 🚀 Quick Start

### 1. Install Dependencies
```sh
npm install
```

### 2. Run Setup Wizard
This interactive script guides you through Cloudflare login, Worker and Supabase secret wiring, database migrations, Supabase Edge Function deployment, the first admin account, and the initial Cloudflare deploy.
```sh
npm run setup
```

On Windows you can also use `setup.bat`. On Unix-like systems you can use `./setup.sh`.

### 3. Local Development
Start the frontend and backend services:

**Terminal 1: Frontend (Dashboard)**
```sh
npm run dev
```

**Terminal 2: Backend (API)**
```sh
npm run dev:api
```

## 🔌 Plugin Management

The system features a modular plugin architecture. Use these scripts to manage plugins:

- **Install All Plugins:** `npm run plugin:install:all`
- **Install Specific Plugin:** `npm run plugin:install`
- **Install Local Plugins:** `npm run plugin:install:local`
- **Remove Plugin:** `npm run plugin:remove`

## 🛠 Project Structure

- `src/`: React frontend components and pages.
- `api/`: Cloudflare Workers backend.
- `scripts/`: Setup and plugin management utilities.
- `migrations/`: SQL database schemas for Supabase.

## 🧰 Technologies
- **Frontend:** React, Vite, Tailwind CSS, Shadcn UI
- **Backend:** Hono, Cloudflare Workers
- **Database:** Supabase (PostgreSQL)
- **Deployment:** Wrangler


### Frontend (SPA)
- **Vite & React 18**: High-performance dashboard
- **Tailwind CSS & Shadcn UI**: Consistent design system
- **TanStack Query**: Efficient state management

### Backend (API & Worker)
- **Hono & Cloudflare Workers**: Serverless API layer
- **MCP (Model Context Protocol)**: Direct integration for AI Agents
- **Supabase**: PostgreSQL database, Authentication, and Storage
- **Seatable**: External data source for mentor management

## API & Agent Integration

The API provides two main entry points for automation:

1. **REST Discovery**: `http://localhost:8787/api/schemas` lists all available page schemas and their specifications.
2. **MCP Endpoint**: `http://localhost:8787/mcp` provides a Model Context Protocol interface for AI agents (like Claude Desktop) to discover, read, and register schemas automatically.

In production, Cloudflare static assets are configured with selective worker-first routing for `/api/*`, `/mcp`, `/mcp/*`, and `/.well-known/*`. This keeps the SPA asset-first for normal frontend requests while guaranteeing that API and MCP discovery endpoints always reach the Worker.

## Production
```sh
# Build Frontend
npm run build

# Deploy API to Cloudflare
npm run deploy:api
```

## New Install Verification

After `npm run setup`, verify these outcomes before handing the system over:

1. The wizard reports successful database migrations and auth hook registration, or prints the exact manual fallback if the hook API call failed.
2. The wizard reports `send_email` deployed and the admin UI mail test succeeds under `/verwaltung/connections`.
3. Submitting a configured form creates a row in `forms_answers` and corresponding rows in `mail_delivery_jobs` / `mail_delivery_events`.
4. The deployed Worker has the three runtime secrets bound: `CF_API_TOKEN`, `SUPABASE_PUBLISHABLE_KEY`, and `SECRETS_ENCRYPTION_KEY`.
5. If the setup run had to retry Worker secrets after the first deploy, the follow-up redeploy completed successfully.

## Updating A Live Deployment
Use the updater when you want to pull the latest code from the canonical GitHub remote, run integrity checks, rebuild, and redeploy in one step.

```sh
# Cross-platform via npm
npm run cf:update

# Windows
scripts\cf-update.bat

# Linux / macOS
bash scripts/cf-update.sh
```

The updater performs these checks by default:

- Verifies `origin` points to `https://github.com/JaYani55/specy.git`
- Refuses to pull over tracked local changes unless `--allow-dirty` is passed
- Confirms `wrangler.jsonc` exists and no placeholder setup values remain
- Runs `npm install`, `npm run lint`, `npm run build`, and `npm run deploy`

You can run the integrity checks without pulling or deploying via:

```sh
npm run cf:update:check
```
