# TODO - Docker Installer Plan

This specification outlines the plan for adding a Docker-based deployment path to the Service CMS, enabling users to run the entire stack (API, Frontend, and Plugins) in a containerized environment. This path will exist simultaneously with the existing Cloudflare Workers deployment path.

---

## 1. Goal
Provide a "one-click" or simple CLI-based setup for deploying the Service CMS into any Docker-compatible environment (VPS, Home Server, Kubernetes, etc.).

## 2. Technical Strategy
The current architecture uses **Hono** for the API and **Vite** for the frontend. While the API is currently optimized for Cloudflare Workers (using `wrangler` and R2 bindings), Hono is platform-agnostic and can run on Node.js, Deno, Bun, or any standard Docker container.

### A. API Containerization
- **Runtime**: Use Node.js or Bun as the server runtime inside Docker.
- **Server Adapter**: Switch from `wrangler` (Worker) to `hono/node-server` or `hono/bun` in the Docker-specific entry point.
- **Environment Variables**: Map Cloudflare Bindings (`env.SUPABASE_URL`, etc.) to standard OS environment variables.
- **Storage**: Introduce a `local-fs` or `s3-compatible` storage provider for the `/api/media` routes to replace R2 dependency when not in Cloudflare.

### B. Frontend Containerization
- **Build**: Use the existing `vite build`.
- **Serving**: Serve static assets using **Nginx** or the same Node.js server.
- **Proxying**: The container should handle routing between the UI and the API (`/api/*` and `/mcp/*` to the Hono app, everything else to the static SPA).

---

## 3. Required Changes

### [ ] Task 1: Agnostic API Entry Point
Create a new entry point for the API that doesn't depend on Cloudflare's `export default { fetch }` pattern.
- **File**: `api/serve.ts` (new)
- **Description**: Uses `@hono/node-server` to start a persistent listener on port 3000.
- **Logic**: Loads variables from `process.env` and maps them to the `Env` interface used by the routes.

### [ ] Task 2: File System Storage Provider
Add a third storage provider to `api/routes/media.ts`.
- **Providers**: `supabase`, `r2` -> Add `local`.
- **Implementation**: Implementation of `put`, `get`, `list`, `delete` using the `fs` module (or a volume-mounted path).

### [ ] Task 3: Dockerfile & Docker Compose
- **`Dockerfile`**: A multi-stage build:
  1. **Build Stage**: Runs `npm install` and `npm run build`.
  2. **Production Stage**: Copies the build artifacts and the `api/` directory. Starts the Hono server.
- **`docker-compose.yml`**:
  - `service-cms`: The main app.
  - `env_file`: `.env` for Supabase credentials.
  - `volumes`: For persistent media storage if `local` provider is used.

### [ ] Task 4: Setup Script Enhancements
Update `scripts/setup.mjs` or create `scripts/setup-docker.mjs`.
- **Feature**: Optional toggle to generate a `.env` file formatted for Docker instead of `wrangler.jsonc` / `.dev.vars`.

---

## 4. Proposed File Structure Changes
```text
/
├── Dockerfile              # New: Multi-stage build
├── docker-compose.yml       # New: Local orchestration
├── .dockerignore           # New: Exclude node_modules, etc.
├── api/
│   ├── index.ts            # Existing: Workers entry
│   └── serve.ts            # New: Node/Bun entry for Docker
└── scripts/
    └── setup-docker.mjs    # New: Interactive Docker setup
```

## 5. Deployment Workflow (Docker)
1. User runs `node scripts/setup-docker.mjs`.
2. Script asks for Supabase URL/Key.
3. Script generates `.env`.
4. User runs `docker-compose up -d`.
5. App is live on `localhost:8080`.

## 6. Migration & Compatibility
- **Auth**: Continues to use Supabase Auth (external).
- **Database**: Continues to use Supabase/PostgreSQL (external).
- **Plugins**: The `plugin-routes.ts` logic already auto-wires routes; as long as the Docker entry point imports it, plugins will work exactly the same way.
