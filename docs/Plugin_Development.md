# Plugin Development Guide

This document is the definitive reference for developing, installing, and maintaining plugins for this CMS.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Plugin Directory Structure](#2-plugin-directory-structure)
3. [plugin.json Manifest](#3-pluginjson-manifest)
4. [Frontend Entrypoint (src/index.tsx)](#4-frontend-entrypoint-srcindextsx)
5. [Adding Pages and Routes](#5-adding-pages-and-routes)
6. [Adding Sidebar Items](#6-adding-sidebar-items)
7. [Adding API Routes](#7-adding-api-routes)
8. [Adding Database Migrations](#8-adding-database-migrations)
9. [Reading Plugin Configuration](#9-reading-plugin-configuration)
10. [Available Imports and Shared Infrastructure](#10-available-imports-and-shared-infrastructure)
11. [Installation Workflow](#11-installation-workflow)
12. [Security Requirements](#12-security-requirements)
13. [Licensing and EUPL Compliance](#13-licensing-and-eupl-compliance)
14. [Versioning and Compatibility](#14-versioning-and-compatibility)
15. [Complete Minimal Example](#15-complete-minimal-example)

---

## 1. Overview

The plugin system works similarly to WordPress plugins with a key difference: it is **build-time, not runtime**. Plugins are GitHub repositories. The install script downloads them, copies their code into `src/plugins/{slug}/`, and rewrites a registry file that the main application imports at compile time. A **rebuild and redeploy is required** after installing or updating a plugin.

```
GitHub repo  →  install script  →  src/plugins/{slug}/  →  registry.ts  →  build  →  deploy
```

Plugins can contribute:
- **Frontend pages** (React components) registered as routes
- **Sidebar navigation items** (linked to those routes)
- **API routes** (Hono handlers, mounted under `/api/plugins/{slug}/`)
- **Database migrations** (SQL files to apply to Supabase)
- **Configuration values** (key-value pairs stored in the `plugins` table)

---

## 2. Plugin Directory Structure

Every plugin repository must follow this layout:

```
my-plugin/
├── plugin.json          ← REQUIRED: manifest file (see §3)
├── src/
│   ├── index.tsx        ← REQUIRED: exports PluginDefinition as default
│   └── pages/
│       └── Dashboard.tsx
├── api/
│   └── index.ts         ← OPTIONAL: Hono route file for API additions
├── migrations/
│   └── 001_create_my_table.sql   ← OPTIONAL: SQL migration files
└── README.md
```

The only **strictly required** files are `plugin.json` and the entrypoint declared in it (defaults to `src/index.tsx`).

---

## 3. plugin.json Manifest

This is the metadata file the install script reads and validates.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A short description shown in the Plugins admin page.",
  "author": "Your Name",
  "author_url": "https://github.com/yourname",
  "license": "MIT",
  "repository": "https://github.com/yourname/my-plugin",
  "entrypoint": "src/index.tsx",
  "api_entrypoint": "api/index.ts",
  "migrations": [
    "migrations/001_create_my_table.sql"
  ],
  "min_cms_version": ">=1.0.0",
  "required_npm_dependencies": {
    "some-library": "^2.0.0"
  },
  "config_schema": [
    {
      "key": "api_key",
      "type": "secret",
      "label": "API Key",
      "description": "Your service API key",
      "required": false
    }
  ]
}
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique lowercase identifier. Used as directory name in `src/plugins/`. URL-safe characters only (`a-z`, `0-9`, `-`). |
| `name` | `string` | Human-readable display name. |
| `version` | `string` | Semantic version (e.g. `"1.2.0"`). |
| `author` | `string` | Author name. |
| `license` | `string` | SPDX license identifier (e.g. `"MIT"`, `"Apache-2.0"`). |
| `repository` | `string` | Full GitHub URL. |

### Optional fields

| Field | Type | Default | Description |
|---|---|---|---|
| `description` | `string` | — | Short description. |
| `author_url` | `string` | — | Author website or GitHub profile URL. |
| `entrypoint` | `string` | `"src/index.tsx"` | Path to the frontend TS/TSX entrypoint relative to the plugin root. |
| `api_entrypoint` | `string` | `"api/index.ts"` | Path to the Hono API route file (only needed if the plugin adds API routes). |
| `migrations` | `string[]` | `[]` | SQL migration file paths relative to the plugin root. The install script prints these — you must apply them manually. |
| `min_cms_version` | `string` | — | Minimum CMS version required (semver range). Informational only. |
| `required_npm_dependencies` | `object` | `{}` | npm packages this plugin requires, as `{"package-name": "semver-range"}`. The install script runs `npm install` for these automatically. |
| `config_schema` | `object[]` | `[]` | Configuration fields the plugin needs. Each entry has `key` (string), `type` (`"string"` or `"secret"`), `label`, `description`, and `required` (boolean). The install script prints these at the end; values are set via the Plugins admin UI at `/plugins`. |

---

## 4. Frontend Entrypoint (src/index.tsx)

The entrypoint file must export a `PluginDefinition` object as its **default export**. This is the contract between the plugin and the CMS.

```typescript
// src/plugins/my-plugin/src/index.tsx
import type { PluginDefinition } from '@/types/plugin';
import { LayoutDashboard } from 'lucide-react';
import Dashboard from './pages/Dashboard';

const plugin: PluginDefinition = {
  // Must match plugin.json "id"
  id: 'my-plugin',
  // Must match plugin.json "name"
  name: 'My Plugin',
  // Must match plugin.json "version"
  version: '1.0.0',

  routes: [
    {
      path: '/plugins/my-plugin/dashboard',
      component: Dashboard,
      requiredRole: 'staff',  // 'super-admin' | 'admin' | 'staff' | undefined
    },
  ],

  sidebarItems: [
    {
      key: 'my-plugin-dashboard',
      path: '/plugins/my-plugin/dashboard',
      label: 'My Plugin',
      icon: LayoutDashboard,
      group: 'admin',         // 'main' | 'admin'
      requiredRole: 'staff',
    },
  ],
};

export default plugin;
```

> **Important**: All paths must be unique across all plugins. Always namespace your paths under `/plugins/{your-plugin-id}/`.

---

## 5. Adding Pages and Routes

Declare routes in the `routes` array of your `PluginDefinition`. Each route maps a URL path to a React component.

```typescript
interface PluginRoute {
  path: string;              // URL path, e.g. "/plugins/my-plugin/settings"
  component: ComponentType;  // React page component
  requiredRole?: 'super-admin' | 'admin' | 'staff';  // omit for any authenticated user
}
```

**Route namespacing rules:**
- All plugin routes MUST start with `/plugins/{plugin-id}/`
- This prevents conflicts with CMS-native routes

**Role gating:**
- `undefined` — any authenticated user can access
- `'staff'` — requires staff role or higher (staff, admin, super-admin)
- `'admin'` — requires admin or super-admin role
- `'super-admin'` — requires SUPERADMIN role only

**Example page component:**

```typescript
// src/plugins/my-plugin/src/pages/Dashboard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">My Plugin Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user?.email}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Plugin content goes here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## 6. Adding Sidebar Items

Declare sidebar items in the `sidebarItems` array. Each item adds an entry to the application sidebar.

```typescript
interface PluginSidebarItem {
  key: string;               // Unique key, e.g. "my-plugin-dashboard"
  path: string;              // URL this item navigates to (must match a route path)
  label: string;             // Display label (English)
  icon: LucideIcon;          // Lucide icon component
  group: 'main' | 'admin';  // Sidebar section
  requiredRole?: 'super-admin' | 'admin' | 'staff';
}
```

**Group behaviour:**
- `'main'` — appears alongside Events, Calendar, List (visible to all authenticated users by default)
- `'admin'` — appears alongside Pages, Administration (only shown when `canAccessVerwaltung` is true, i.e. staff+)

**Icon usage:**
Import icons from `lucide-react`. All icons in the lucide-react package installed in the CMS are available.

```typescript
import { LayoutDashboard, Settings, Database } from 'lucide-react';
```

---

## 7. Adding API Routes

If your plugin needs server-side functionality, create a Hono route file.

### File location

```
my-plugin/api/index.ts
```

Declare this path in `plugin.json` as `"api_entrypoint": "api/index.ts"`.

### Route file structure

```typescript
// src/plugins/my-plugin/api/index.ts
import { Hono } from 'hono';
import { getSupabaseClient, type PluginEnv } from './lib/supabase'; // see §7 "Accessing Supabase"

const myPlugin = new Hono<{ Bindings: PluginEnv }>();

myPlugin.get('/', async (c) => {
  return c.json({ plugin: 'my-plugin', status: 'ok' });
});

myPlugin.get('/data', async (c) => {
  const token = c.req.header('Authorization')?.slice(7) ?? '';
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const supabase = getSupabaseClient(c.env, token);
  const { data, error } = await supabase.from('my_plugin_table').select('*');
  if (error) return c.json({ error: 'Failed to fetch data' }, 500);
  return c.json({ data });
});

export default myPlugin;
```

### Mounting API routes

Plugin API routes are **mounted automatically** by the install script. When installed, `api/plugin-routes.ts` is regenerated and `api/index.ts` calls `mountPluginRoutes(app)` which wires up all active plugin routes at startup. No manual edit to `api/index.ts` is required.

The mount path is always:

```
/api/plugin/{plugin-id}/...
```

> **Note the singular `/api/plugin/`**, not `/api/plugins/`. The plural path `/api/plugins` is reserved for the plugin registry listing endpoint. Your plugin's own `API_BASE` constant (in `src/lib/api.ts` or equivalent) must use `/api/plugin/{slug}` — using `/api/plugins/{slug}` will result in 404 for all API calls.

Generated mount code (for reference):

```typescript
// api/plugin-routes.ts — AUTO-GENERATED, do not edit
import myPlugin from '../src/plugins/my-plugin/api/index';

export function mountPluginRoutes(app: Hono<{ Bindings: Env }>): void {
  app.route('/api/plugin/my-plugin', myPlugin);
}
```

### Accessing Supabase from API routes

#### Recommended pattern — ship your own `api/lib/supabase.ts`

Create a `lib/supabase.ts` file inside your plugin's `api/` directory. This keeps the plugin self-contained and avoids fragile relative paths back into the CMS internals.

Copy this template verbatim (it is the same pattern used internally by plugins in this CMS):

```typescript
// src/plugins/my-plugin/api/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

interface SecretsStoreBinding { get(): Promise<string>; }

export interface PluginEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SS_SUPABASE_SECRET_KEY: SecretsStoreBinding;
}

/** User-scoped client — respects RLS using the caller's JWT. Use for ALL user-facing handlers. */
export function getSupabaseClient(env: PluginEnv, token: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Service-role client — bypasses RLS entirely. Use ONLY for privileged bootstrap operations. */
export async function getSupabaseAdminClient(env: PluginEnv) {
  const key = await env.SS_SUPABASE_SECRET_KEY.get();
  return createClient(env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Extract user ID from JWT payload without a network call. */
export function getUserIdFromToken(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub as string;
  } catch {
    return '';
  }
}
```

Import it in your route file:

```typescript
import { getSupabaseClient, type PluginEnv } from './lib/supabase';
// or from a subdirectory:
import { getSupabaseClient, type PluginEnv } from '../lib/supabase';
```

#### Alternative — import directly from the CMS lib

If you prefer not to ship your own lib, import from the CMS's `api/lib/supabase.ts`. The correct relative path from `src/plugins/my-plugin/api/index.ts` (four levels up to the workspace root, then into `api/`) is:

```typescript
import { createSupabaseClient, createSupabaseAdminClient, type Env } from '../../../../api/lib/supabase';
```

> **Warning:** `../../api/lib/supabase` is a common mistake — that path resolves to the non-existent `src/plugins/api/lib/supabase`. Always count four `../` levels from any file inside `src/plugins/{slug}/api/`.

#### Authentication in route handlers

The CMS API has **no authentication middleware**. There is no JWT verification in the Hono layer — all access control is enforced by Supabase RLS at the database level. Your route handlers **must** pass the user's JWT to the Supabase client so that `auth.uid()` and `request.jwt.claims` are set in PostgreSQL:

```typescript
// ✓ Correct — user context flows through to Supabase RLS
myPlugin.get('/data', async (c) => {
  const token = c.req.header('Authorization')?.slice(7) ?? '';
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const supabase = getSupabaseClient(c.env, token); // token sets Authorization header
  const { data, error } = await supabase.from('my_plugin_table').select('*');
  // RLS ensures this user can only see their own rows
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

// ✗ Wrong — no user context; RLS blocks authenticated-only rows
myPlugin.get('/data', async (c) => {
  const supabase = getSupabaseClient(c.env, ''); // empty token → anon user
  ...
});
```

The admin client (`getSupabaseAdminClient` / `createSupabaseAdminClient`) bypasses RLS entirely and must only be used for **privileged bootstrap operations** that cannot run as a regular user — for example, provisioning an initial user profile on first visit. Use it sparingly.

#### Roles and authorization

Do **not** implement role checks in your API route handlers. The CMS uses a JWT claims injection hook (`custom_access_token_hook` in `migrations/Auth/Access_hook.sql`) that injects a `user_roles` array into every Supabase JWT at sign-in. Authorization belongs in RLS policies:

```sql
-- Check roles in an RLS policy
CREATE POLICY "admins_can_delete"
  ON public.my_plugin_data
  FOR DELETE TO authenticated
  USING (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']
  );
```

---

## 8. Adding Database Migrations

If your plugin requires new database tables or schema changes:

1. Create a SQL file in `my-plugin/migrations/`, e.g. `001_create_my_table.sql`
2. Declare it in `plugin.json` under `"migrations"`
3. When the install script runs, it detects and **prints** these files — you must apply them manually

### Migration file conventions

Follow the same patterns used in the CMS's own migrations:
- Use `public.` schema prefix
- Enable RLS and add appropriate policies
- Reference the `set_current_timestamp_updated_at()` trigger for `updated_at` columns
- Prefix table names with your plugin slug to avoid conflicts: `{plugin_slug}_{table_name}`

### Idempotency requirement

**All migration files must be safe to run more than once.** The install script may apply a migration, fail partway through, and then be run again on a reinstall. Non-idempotent migrations cascade-fail: if migration 003 fails because a trigger already exists, migrations 004–015 will all fail because the table created in 003 doesn't exist.

Key patterns:

```sql
-- Trigger functions: always use CREATE OR REPLACE
CREATE OR REPLACE FUNCTION public.my_plugin_on_insert() ...

-- Triggers: drop before creating (works on Postgres 14+)
DROP TRIGGER IF EXISTS trg_my_plugin_insert ON my_table;
CREATE TRIGGER trg_my_plugin_insert
  AFTER INSERT ON my_table
  FOR EACH ROW EXECUTE FUNCTION public.my_plugin_on_insert();

-- Tables: use IF NOT EXISTS
CREATE TABLE IF NOT EXISTS public.my_plugin_data ( ... );

-- ENUM types: guard with a DO block
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_status_enum') THEN
    CREATE TYPE my_status_enum AS ENUM ('open', 'closed');
  END IF;
END $$;

-- Indexes: use IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_my_plugin_data_user_id ON public.my_plugin_data(user_id);

-- Policies: drop before recreating
DROP POLICY IF EXISTS "my_policy" ON public.my_plugin_data;
CREATE POLICY "my_policy" ON public.my_plugin_data ...
```

> **Why this matters**: Postgres does not support `CREATE TRIGGER IF NOT EXISTS` (before Postgres 17) or `CREATE TYPE IF NOT EXISTS`. Always use the patterns above — bare `CREATE TRIGGER` and `CREATE TYPE` will error on second run.

```sql
-- migrations/001_create_my_table.sql
CREATE TABLE public.my_plugin_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_my_plugin_data_updated_at
  BEFORE UPDATE ON public.my_plugin_data
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

ALTER TABLE public.my_plugin_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_my_plugin_data"
  ON public.my_plugin_data
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_my_plugin_data"
  ON public.my_plugin_data
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

---

## 9. Reading Plugin Configuration

Admins can set key-value configuration pairs via the Plugins admin page (`/plugins`). These are stored as JSONB in the `plugins` database table.

To read config from your plugin, query the `plugins` table:

```typescript
import { supabase } from '@/lib/supabase';

async function getPluginConfig(pluginSlug: string): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('plugins')
    .select('config')
    .eq('slug', pluginSlug)
    .single();
  return (data?.config as Record<string, string>) ?? {};
}

// Usage
const config = await getPluginConfig('my-plugin');
const apiKey = config['api_key'] ?? '';
```

> **Security**: Never store secrets (API keys, passwords) as plain config values. Use Supabase Secrets or the CMS's built-in secrets management (`/verwaltung/connections`) for sensitive credentials.

---

## 10. Available Imports and Shared Infrastructure

Plugins can import from the CMS's shared code using the `@/` path alias, which resolves to `src/`.

### Always available

```typescript
// Authentication + user state
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';

// Theme + language
import { useTheme } from '@/contexts/ThemeContext';

// Data context
import { useData } from '@/contexts/DataContext';

// Supabase client (authenticated, respects RLS)
import { supabase } from '@/lib/supabase';

// File upload client (for Supabase Storage)
import { fileUploadClient } from '@/lib/fileUploadClient';

// shadcn/ui components (the full library is available)
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

// Type definitions
import type { User, UserRole } from '@/types/auth';
import type { PluginDefinition, PluginManifest } from '@/types/plugin';

// Icons
import { SomeIcon } from 'lucide-react';
```

### Do not import

- Do **not** re-initialise the Supabase client. Always import the existing `supabase` from `@/lib/supabase`.
- Do **not** import the file upload client for non-storage operations.
- Do **not** import internal implementation details from other pages (treat them as private).

---

## 11. Installation Workflow

The full installation workflow — including registering via the UI, running the install script, applying migrations, mounting API routes, configuring secrets, building, deploying, updating, and removing — is documented in **[Plugin_Installation.md](Plugin_Installation.md)**.

Quick reference:

```bash
# Install a plugin from GitHub
node scripts/install-plugins.mjs --add https://github.com/owner/my-plugin

# Then build and deploy
npm run build
npx wrangler deploy
```

---

## 12. Security Requirements

All plugins must comply with these rules:

### Code safety
- **No `eval()`** or `new Function()` with dynamic strings
- **No dynamic script loading** (`document.createElement('script')`, `import()` with user-supplied paths)
- **No `dangerouslySetInnerHTML`** unless content is sanitised (use DOMPurify)
- **No XSS vectors** — always escape user input in rendered output

### Data access
- **Respect RLS** — use the authenticated Supabase client (`@/lib/supabase`), not a raw service key
- **Admin client** (`createSupabaseAdminClient` in API routes) should only be used for operations that legitimately bypass RLS
- **No SSRF** — do not make server-side HTTP requests to user-supplied URLs without validation
- **Input validation** — validate all user input at the API boundary using Zod or equivalent

### Secrets
- **Never hardcode secrets** in plugin source code
- **Never commit `.env` files** or API keys to the plugin repository
- Use plugin config (§9) for non-sensitive settings
- Use the CMS secrets management for sensitive credentials

### Dependencies
- Keep npm dependencies minimal and well-maintained
- Avoid packages with known CVEs
- Do not add `devDependencies` that are not already in the CMS's `package.json` as production dependencies

---

## 13. Licensing and EUPL Compliance

The CMS core is licensed under the **European Union Public Licence (EUPL) v1.2**. This license includes a "copyleft" clause, but the plugin system is architected to ensure that your plugin code remains a **Separate Work**.

To maintain compliance and avoid the copyleft clause:
- **Always use the plugin registry** for integration.
- **Do not modify the CMS core** (anything outside of `src/plugins/{slug}/`) for your plugin's logic.
- **Use the provided interfaces** (`PluginDefinition`, `PluginRoute`) for all interaction points.

For more detailed information, see the [EUPL Compliance Guide](EUPL_Compliance.md).

---

## 14. Versioning and Compatibility

### Plugin versioning
- Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
  - `PATCH` — bug fixes, no API or schema changes
  - `MINOR` — new features, backward compatible
  - `MAJOR` — breaking changes (route paths changed, table columns removed, etc.)

### CMS compatibility
- Declare `min_cms_version` in `plugin.json` using semver range syntax
- Breaking CMS updates that affect the plugin API will be documented in this repo's changelog

### Database migration versioning
- Prefix migration files with a zero-padded sequence: `001_`, `002_`, etc.
- Never modify an already-applied migration — create a new one instead

---

## 14. Complete Minimal Example

This is a fully functional plugin that adds a simple admin page.

### plugin.json
```json
{
  "id": "hello-plugin",
  "name": "Hello Plugin",
  "version": "1.0.0",
  "description": "A minimal example plugin.",
  "author": "Your Name",
  "license": "MIT",
  "repository": "https://github.com/yourname/hello-plugin",
  "entrypoint": "src/index.tsx"
}
```

### src/index.tsx
```typescript
import type { PluginDefinition } from '@/types/plugin';
import { Smile } from 'lucide-react';
import HelloPage from './pages/HelloPage';

const plugin: PluginDefinition = {
  id: 'hello-plugin',
  name: 'Hello Plugin',
  version: '1.0.0',
  routes: [
    {
      path: '/plugins/hello-plugin',
      component: HelloPage,
      requiredRole: 'staff',
    },
  ],
  sidebarItems: [
    {
      key: 'hello-plugin-main',
      path: '/plugins/hello-plugin',
      label: 'Hello Plugin',
      icon: Smile,
      group: 'admin',
      requiredRole: 'staff',
    },
  ],
};

export default plugin;
```

### src/pages/HelloPage.tsx
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function HelloPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Hello Plugin</h1>
      <Card>
        <CardHeader>
          <CardTitle>Hello, {user?.email}!</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This is a minimal plugin page. Extend it to build your feature.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Installation

```bash
node scripts/install-plugins.mjs --add https://github.com/yourname/hello-plugin
npm run build
npx wrangler deploy
```

After deployment, navigate to `/plugins/hello-plugin` as a staff user to see the page. The sidebar item "Hello Plugin" will appear under the Administration section.
