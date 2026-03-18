# YATDA Plugin — Iteration Report

**Reviewer:** GitHub Copilot (automated code review)  
**Date:** 2026-03-16  
**Scope:** Full source review — frontend (`src/`), backend API (`api/`), migrations (`migrations/`), manifest (`plugin.json`)  
**Plugin Version:** 0.1.0

---

## Executive Summary

The plugin's architecture is solid — the DB schema is well-designed with good use of triggers, the API is well-structured with Hono, and the frontend views are feature-complete. However, **two critical integration issues** block all functionality from working in a deployed CMS environment: a Cloudflare Worker binding name mismatch for Supabase keys and an API route path mismatch. These must be resolved before any feature testing is meaningful. Additionally, a high-priority UX gap means first-time users (existing CMS users) can never see the board at all.

---

## Issues

### CRITICAL — Blocks all functionality

---

#### C3 — `@tanstack/react-table@8.20.0` does not exist (install failure)

**File:** `plugin.json` → `required_npm_dependencies`

```
npm error notarget No matching version found for @tanstack/react-table@8.20.0.
```

`8.20.0` is not a published version of `@tanstack/react-table`. The package jumped from `8.19.x` to `8.21.x`. Using an exact non-existent version causes `npm install` to fail with `ETARGET`, which aborts all package installation (FullCalendar, gantt-task-react, zustand are also not installed). This means the build step immediately fails with unresolved imports.

**Fix:** Change the version specifier to a caret range:

```json
// plugin.json — current (broken)
"required_npm_dependencies": {
  "@tanstack/react-table": "^8.20.0"
}

// Fixed
"required_npm_dependencies": {
  "@tanstack/react-table": "^8.0.0"
}
```

This resolves to the latest published `8.x` release instead of demanding a specific patch that does not exist.

---

#### C4 — Migrations are not idempotent: re-install cascade failure

**Files:** `migrations/003_create_users.sql`, `migrations/008_create_tickets.sql`

The migration files use bare `CREATE TRIGGER` and `CREATE TYPE` statements with no `IF NOT EXISTS` or `OR REPLACE` guard. If a previous install attempt applied any migration partially (e.g., the trigger function was created but the table wasn't), a subsequent install attempt fails immediately:

```
migrations/003_create_users.sql ✗
  ERROR: 42710: trigger "trg_on_auth_user_created" for relation "users" already exists
```

Because migration 003 is the one that creates `YATDA_Users`, its failure causes every subsequent migration to fail with `relation "YATDA_Users" does not exist`, producing a cascade of 13 consecutive failures:

```
004 ✗ — relation "YATDA_Users" does not exist
005 ✗ — relation "YATDA_Workspaces" does not exist
006 ✗ — relation "YATDA_Workspaces" does not exist
007 ✗ — relation "YATDA_Categories" does not exist
008 ✗ — type "ticket_status_enum" already exists  ← second partial-install artefact
009–015 ✗ — cascade from 008 / 003
```

**Fix:** Make both affected statements idempotent:

```sql
-- migrations/003_create_users.sql
-- Replace: CREATE OR REPLACE FUNCTION for the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user_for_yatda() ...

-- Replace bare CREATE TRIGGER with:
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created ...

-- Or use CREATE TRIGGER ... IF NOT EXISTS (Postgres 17+ syntax):
CREATE OR REPLACE TRIGGER trg_on_auth_user_created ...
```

```sql
-- migrations/008_create_tickets.sql
-- Guard the enum creation:
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status_enum') THEN
    CREATE TYPE ticket_status_enum AS ENUM ('backlog', 'todo', 'in-progress', 'in-review', 'done');
  END IF;
END $$;
```

**General rule:** All plugin migrations must be idempotent. They may run more than once if the plugin is reinstalled or if a partial run occurred. See §8 of [Plugin_Development.md](Plugin_Development.md) for the full convention.

---

#### C1 — API path mismatch: `/api/plugins/` vs `/api/plugin/`

**File:** `src/lib/api.ts`, line 3  
**File:** *(CMS)* `scripts/install-plugins.mjs`, `rebuildPluginRoutes()`

```ts
// Current (broken)
const API_BASE = "/api/plugins/yatda";

// Required
const API_BASE = "/api/plugin/yatda";
```

The CMS mounts plugin routers at `/api/plugin/<slug>` (singular). Every `fetch` call from the YATDA frontend targets `/api/plugins/yatda` (plural), which does not exist. All API calls return 404.

**Fix:** Change `API_BASE` in `src/lib/api.ts` to `/api/plugin/yatda`.

---

#### C2 — Supabase binding names do not match the CMS environment

**File:** `api/lib/supabase.ts`

The plugin declares two Cloudflare Worker bindings that do not exist in the CMS worker environment:

| What the plugin expects | What the CMS Worker actually exposes | Effect |
|---|---|---|
| `SUPABASE_ANON_KEY` | `SUPABASE_PUBLISHABLE_KEY` | `getSupabaseClient()` gets `undefined` for the anon key |
| `SUPABASE_SERVICE_KEY` | `SS_SUPABASE_SECRET_KEY` | `getSupabaseAdminClient()` gets `undefined` for the service key |

`SUPABASE_URL` is correctly named and does not need to change.

```ts
// Current (broken)
export interface PluginEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;      // ← wrong
  SUPABASE_SERVICE_KEY: string;   // ← wrong
}

// Fixed
export interface PluginEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SS_SUPABASE_SECRET_KEY: string;
}
```

Update `getSupabaseClient` and `getSupabaseAdminClient` accordingly:

```ts
export function getSupabaseClient(env: PluginEnv, userToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
}

export function getSupabaseAdminClient(env: PluginEnv) {
  return createClient(env.SUPABASE_URL, env.SS_SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
}
```

---

### HIGH — Significantly impairs core functionality

---

#### H1 — Existing CMS users are never provisioned in YATDA

**Files:** `migrations/003_create_users.sql`, `migrations/004_create_workspaces.sql`

The DB trigger `trg_on_auth_user_created` only fires on `INSERT` into `auth.users`. Any CMS user who was created before YATDA migrations were applied will have no `YATDA_Users` row, no personal workspace, and no workspace membership. For these users:

1. `GET /workspaces` returns an empty array (RLS `workspaces_select_member` hides all rows).
2. `BoardPage` never sets `activeWorkspaceId`.
3. The "Add Task" button never renders (gated on `activeWorkspaceId`).
4. The board shows an empty loading state indefinitely.

This is **the most likely cause of the screenshot showing 0 tickets and no way to add them**.

**Fix — Option A (recommended): backfill via API on first visit**

Add a `POST /users/me/ensure` endpoint that creates the `YATDA_Users` row and personal workspace if they don't exist, using the admin client. Call it once from `BoardPage` on mount when `useWorkspaces` returns an empty array and `isLoading` is false.

```ts
// api/routes/users.ts
users.post("/me/ensure", async (c) => {
  const token = c.req.header("Authorization")?.slice(7) ?? "";
  const userId = getUserIdFromToken(token);
  const adminClient = getSupabaseAdminClient(c.env);

  const { data: { user } } = await adminClient.auth.admin.getUserById(userId);
  if (!user) return c.json({ error: "User not found" }, 404);

  const { error } = await adminClient
    .from("YATDA_Users")
    .insert({
      user_id: userId,
      username: user.user_metadata?.username ?? user.email?.split("@")[0] ?? userId,
      display_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    })
    .onConflict("user_id")
    .ignore();

  if (error) return c.json({ error: error.message }, 500);

  // The DB trigger will create the personal workspace and workspace membership automatically
  return c.json({ ok: true });
});
```

**Fix — Option B: backfill SQL migration**

Add a `015_backfill_existing_users.sql` migration that inserts `YATDA_Users` rows for all existing `auth.users` entries that are missing one. The trigger chain (`trg_yatda_personal_workspace` → `trg_yatda_workspace_owner_member`) will propagate the workspace and membership rows automatically.

---

#### H2 — No workspace creation UI

**File:** `src/components/layout/BoardHeader.tsx`

```tsx
// Current — button only visible if workspace already exists
{activeWorkspaceId && (
  <button className={styles.addBtn} onClick={() => openTicket(null)}>
    + Add Task
  </button>
)}
```

There is no way for a user to:
- Create a personal workspace manually
- Create a team workspace
- See any prompt explaining why the board is empty

**Fix:** Render a "Create my workspace" prompt when `workspaces?.length === 0` and `!isLoadingWorkspaces`, either in `BoardPage` or `BoardHeader`. For the personal workspace case, a single button calling the `POST /users/me/ensure` endpoint (H1 fix) is sufficient.

---

#### H3 — `handleDragOver` fires status-update mutations on every pointer-move event

**File:** `src/components/views/KanbanView.tsx`

```tsx
function handleDragOver(event: DragOverEvent) {
  // ...
  if (targetStatus && activeTicketItem.ticket_status !== targetStatus) {
    updateTicket.mutate({ id: activeId, body: { ticket_status: targetStatus } });
  }
}
```

`handleDragOver` fires for every `pointermove` event. When the cursor crosses a column boundary this check fires `updateTicket.mutate` repeatedly because `activeTicketItem.ticket_status` is read from the TanStack Query cache, which does not update until a mutation completes and is invalidated. The practical result is many redundant PATCH requests to the server for a single drag action.

**Fix:** Track the in-flight target status in local state and only commit to the server in `handleDragEnd`.

```tsx
const [pendingStatus, setPendingStatus] = useState<Record<string, TicketStatus>>({});

function handleDragOver(event: DragOverEvent) {
  const { active, over } = event;
  if (!over) return;
  const activeId = active.id as string;
  const overId = over.id as string;
  const activeItem = tickets.find((t) => t.ticket_id === activeId);
  if (!activeItem) return;
  const overColumn = COLUMNS.find((c) => c.id === overId);
  const overItem = tickets.find((t) => t.ticket_id === overId);
  const targetStatus = overColumn?.id ?? overItem?.ticket_status;
  if (targetStatus && targetStatus !== (pendingStatus[activeId] ?? activeItem.ticket_status)) {
    setPendingStatus((prev) => ({ ...prev, [activeId]: targetStatus }));
  }
}

function handleDragEnd(event: DragEndEvent) {
  setActiveTicket(null);
  const { active } = event;
  const activeId = active.id as string;
  const newStatus = pendingStatus[activeId];
  if (newStatus) {
    updateTicket.mutate({ id: activeId, body: { ticket_status: newStatus } });
    setPendingStatus((prev) => { const n = { ...prev }; delete n[activeId]; return n; });
  }
  // ... existing within-column sort logic
}
```

---

### MEDIUM — Impairs secondary features

---

#### M1 — Filter state is never connected to data queries

**Files:** `src/store/uiStore.ts`, `src/pages/BoardPage.tsx`

The UI store has `filterStatus` and `filterCategoryId` fields but `BoardPage` never passes them to `useTickets`:

```tsx
// BoardPage.tsx — current
const { data: tickets = [], isLoading } = useTickets(activeWorkspaceId);

// Should be:
const { filterStatus, filterCategoryId } = useUIStore();
const { data: tickets = [], isLoading } = useTickets(activeWorkspaceId, {
  status: filterStatus ?? undefined,
  categoryId: filterCategoryId ?? undefined,
});
```

Any filter controls in the header UI do nothing — tickets are never filtered.

---

#### M2 — Optimistic update uses wrong cache key

**File:** `src/hooks/useTickets.ts`

`useUpdateTicket` performs its optimistic update against the cache key `["tickets", workspaceId]`, but `useTickets` stores data under `TICKETS_KEY(workspaceId, opts)` which includes `opts.status` and `opts.categoryId`. With no filters active the keys coincidentally match, but once M1 is fixed and filters are used, the optimistic update will target a cache entry that does not exist and the UI will flicker.

**Fix:** Either always use the same key format in both places (include opts in the update key), or use `queryClient.invalidateQueries({ queryKey: ["tickets", workspaceId] })` as a prefix-invalidation (`exact: false` is the default).

---

#### M3 — `POST /tickets` response is missing joined fields

**File:** `api/routes/tickets.ts`

The create handler returns only the raw inserted row. The `Ticket` TypeScript type includes `assignees` and `category` as joined objects. The POST response has both as `undefined`. If any code reads from the returned ticket directly (rather than waiting for a refetch after cache invalidation), it will render missing data.

**Fix:** Re-fetch or use a joined select in the insert call:

```ts
const { data: ticket } = await supabase
  .from("YATDA_Tickets")
  .insert({ ... })
  .select("*, category:YATDA_Categories(*), assignees:YATDA_Ticket_Assignees(*, user:YATDA_Users(*))")
  .single();
```

---

#### M4 — No down-migrations provided

**Status: Addressed** — All 15 down-migrations are present in the correct drop order (`migrations/down/001_drop_extensions.sql` through `migrations/down/015_revert_backfill_existing_users.sql`). However, migration 011 contains a bug that causes a partial cascade failure during uninstall. See **M5**.

---

#### M5 — Down-migration 011 drops shared function without CASCADE

**File:** `migrations/down/011_drop_comments.sql`

Migration 011 attempts to drop `yatda_set_updated_at()`, the trigger function shared by all 5 YATDA tables. At the point 011 runs, those tables and their triggers still exist. PostgreSQL refuses the bare `DROP FUNCTION` because live triggers depend on it:

```
ERROR: 2BP01: cannot drop function yatda_set_updated_at() because other objects depend on it
DETAIL:  trigger trg_yatda_users_updated_at on table "YATDA_Users" depends on function yatda_set_updated_at()
         trigger trg_yatda_workspaces_updated_at on table "YATDA_Workspaces" depends on function yatda_set_updated_at()
         trigger trg_yatda_categories_updated_at on table "YATDA_Categories" depends on function yatda_set_updated_at()
         trigger trg_yatda_tickets_updated_at on table "YATDA_Tickets" depends on function yatda_set_updated_at()
         trigger trg_yatda_milestones_updated_at on table "YATDA_Milestones" depends on function yatda_set_updated_at()
```

Because the migration runs inside a transaction, the `DROP TABLE "YATDA_Comments"` that precedes the function drop is also rolled back when the function drop fails. This leaves `YATDA_Comments` intact, which then triggers a cascade of 5 further failures:

| Migration | Fails because |
|-----------|---------------|
| 008 — drop tickets | `YATDA_Comments_ticket_id_fkey` still exists (Comments not dropped) |
| 006 — drop categories | `YATDA_Tickets_category_id_fkey` still exists (Tickets not dropped) |
| 004 — drop workspaces | FK constraints from Categories and Tickets still reference Workspaces |
| 003 — drop users | FK constraints from Workspaces, Tickets, and Comments still reference Users |
| 002 — drop connectors | `YATDA_Users_user_origin_fkey` still references Connectors |

After the failed uninstall, 6 tables remain in the database: `YATDA_Comments`, `YATDA_Tickets`, `YATDA_Categories`, `YATDA_Workspaces`, `YATDA_Users`, `YATDA_Connectors`.

**Fix:** Add `CASCADE` to the function drop in `migrations/down/011_drop_comments.sql`:

```sql
-- Current (broken)
DROP FUNCTION yatda_set_updated_at();

-- Fixed
DROP FUNCTION IF EXISTS yatda_set_updated_at() CASCADE;
```

`CASCADE` drops all dependent triggers automatically. Those triggers are on tables that will be dropped by migrations 008→006→004→003 anyway — the `CASCADE` only removes the forward dependency that blocks this single function drop.

**Confirmed fixed in run 2 (2026-03-18):** After this fix, migrations 011 through 004 all succeed. However, two additional failures surface in 003 and 002 — see M6.

---

#### M6 — Down-migrations 003/002 non-idempotent and missing function cleanup; three functions orphaned after uninstall

**Files:** `migrations/down/003_drop_users.sql`, `migrations/down/002_drop_connectors.sql`  
**Confirmed from live uninstall run (2026-03-18)**

After the M5 fix resolves migrations 011–004, two failures remain:

**Migration 003 — `relation "YATDA_Users" does not exist`**

The bare `DROP TABLE "YATDA_Users"` fails if the table was partially cleaned up by a previous failed uninstall attempt. Additionally, `yatda_handle_new_user()` was created in 003 and never dropped — it has a live trigger `trg_on_auth_user_created` on `auth.users` that depends on it. Attempting to drop the function manually confirms this:

```
ERROR: 2BP01: cannot drop function yatda_handle_new_user() because other objects depend on it
DETAIL:  trigger trg_on_auth_user_created on table auth.users depends on function yatda_handle_new_user()
HINT:  Use DROP ... CASCADE to drop the dependent objects too.
```

**Fix for `003_drop_users.sql`** — explicitly drop the `auth.users` trigger before dropping the function, then use `IF EXISTS` on the table:

```sql
-- Drop the auth.users trigger first so the function has no dependents
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS yatda_handle_new_user();
-- yatda_set_updated_at() was already dropped by 011 — IF EXISTS handles this safely
DROP FUNCTION IF EXISTS yatda_set_updated_at();
DROP TABLE IF EXISTS "YATDA_Users";
```

Alternatively, `DROP FUNCTION IF EXISTS yatda_handle_new_user() CASCADE` removes the trigger implicitly, which is acceptable since the trigger will not exist once the DB is fully cleaned.

**Migration 002 — `cannot drop YATDA_Connectors` (FK from `YATDA_Users`)**

If 003 fails and `YATDA_Users` still exists, the FK `YATDA_Users_user_origin_fkey` prevents dropping `YATDA_Connectors`. The 003 fix above resolves the root cause, but 002 also needs `IF EXISTS` for idempotency:

```sql
-- Current (brittle)
DROP TABLE "YATDA_Connectors";

-- Fixed
DROP TABLE IF EXISTS "YATDA_Connectors";
```

**Three trigger functions orphaned after uninstall**

Even after a fully successful uninstall, three trigger functions remain in the database because their down-migrations do not drop them:

| Function | Trigger it owns | Where it must be dropped |
|----------|----------------|-------------------------|
| `yatda_handle_new_user` | `trg_on_auth_user_created` on `auth.users` | `003_drop_users.sql` (see fix above) |
| `yatda_add_owner_as_member` | workspace owner trigger (likely `trg_yatda_workspace_owner_member`) | corresponding down-migration for workspace members |
| `yatda_stamp_phase_timestamp` | phase/ticket trigger | corresponding down-migration for tickets or milestones |

The pattern for any function that owns a trigger **on a table outside the plugin schema** (e.g., `auth.users`) is:

```sql
-- Preferred: explicit trigger drop first, then function
DROP TRIGGER IF EXISTS <trigger_name> ON <schema.table>;
DROP FUNCTION IF EXISTS <function_name>();
```

---

### LOW — Minor issues and polish

---

#### L1 — Gantt and Calendar views share the same icon as Kanban

**File:** `src/components/layout/BoardHeader.tsx`

```ts
const VIEW_ICONS: Record<ActiveView, string> = {
  kanban: "▦",
  list: "☰",
  gantt: "▦",      // ← same as kanban
  calendar: "▦",   // ← same as kanban
};
```

Suggested replacements: gantt → `"📊"`, calendar → `"📅"`.

---

#### L2 — Static PBKDF2 salt in `api/lib/crypto.ts`

```ts
salt: enc.encode("yatda-token-salt"),
```

The PBKDF2 salt is hardcoded. A static salt means all deployments using the same `token_encryption_key` value derive an identical key. The practical risk is low (the raw key is admin-configured, not user-supplied), but a random per-token salt stored in the ciphertext string (`"<saltB64>:<ivB64>:<ctB64>"`) would be more correct.

---

#### L3 — `pgcrypto` extension is enabled but never used

**File:** `migrations/001_create_extensions.sql`

All token encryption uses the Web Crypto API in application code. `pgcrypto` is not referenced in any SQL. It can be removed.

---

#### L4 — `ticket_status_enum` blocks status changes without a migration

**File:** `migrations/008_create_tickets.sql`

PostgreSQL `ENUM` types require `ALTER TYPE ... ADD VALUE` to add new values and cannot remove values without recreating the type. If statuses ever need to be configurable per workspace or a new pipeline stage is added, this will require a migration. A `text` column with a `CHECK` constraint or a separate lookup table would be more flexible.

---

#### L5 — View components rendered with `null!` workspace

**File:** `src/pages/BoardPage.tsx`

```tsx
{activeView === "kanban" && (
  <KanbanView tickets={tickets} workspaceId={activeWorkspaceId!} />
)}
```

When no workspace is loaded, `activeWorkspaceId` is `null` but the non-null assertion passes it through. Add a guard:

```tsx
{activeView === "kanban" && activeWorkspaceId && (
  <KanbanView tickets={tickets} workspaceId={activeWorkspaceId} />
)}
```

---

## Migration Chain Summary

The trigger chain for new users is well-designed and correct:

```
auth.users INSERT
  → trg_on_auth_user_created   → YATDA_Users INSERT
      → trg_yatda_personal_workspace  → YATDA_Workspaces INSERT
          → trg_yatda_workspace_owner_member → YATDA_Workspace_Members INSERT
```

All three trigger functions use `SECURITY DEFINER`, so they correctly bypass RLS during setup. The chain only fails for **existing users** because triggers are not back-applied (H1).

---

## RLS Policy Summary

The RLS policies in `014_enable_rls.sql` are correct and complete:

- `YATDA_Connector_Credentials` has SELECT-only policy — INSERT/UPDATE go through the admin client in the OAuth callback. Correct, as long as binding names are fixed (C2).
- `YATDA_Workspace_Members` insert policy is gated on workspace admin role. The owner-as-member trigger bypasses this via `SECURITY DEFINER`. Correct.
- The `yatda_is_workspace_member` helper function is `SECURITY DEFINER STABLE`, so it can see all membership rows regardless of the calling user's RLS context. Correct.

---

## Priority Fix Order

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | C3 — Fix `@tanstack/react-table` version to `^8.0.0` in `plugin.json` | 1 line |
| 2 | C4 — Make migrations 003 and 008 idempotent (guard trigger + enum) | ~10 lines SQL |
| 3 | C1 — Change `API_BASE` from `/api/plugins/` to `/api/plugin/` in `src/lib/api.ts` | 1 line |
| 4 | C2 + Architecture Addendum — Fix binding names and switch to user-scoped Supabase client | ~30 lines |
| 5 | H1 — Provision existing users (`POST /users/me/ensure` + call from `BoardPage`) | ~50 lines |
| 6 | H2 — Add empty-workspace UI prompt | ~20 lines |
| 7 | H3 — Move cross-column status mutation to `handleDragEnd` | ~30 lines |
| 8 | M1 + M2 — Wire filter state to `useTickets` + fix cache key | ~20 lines |
| 9 | M3 — Return joined ticket from `POST /tickets` | ~5 lines |
| 10 | M4 — Write down-migrations | ✓ Addressed (15 down-migrations present) |
| 11 | M5 — Fix `DROP FUNCTION ... CASCADE` in `011_drop_comments.sql` | 1 line SQL |
| 12 | M6 — Fix 003/002 idempotency + drop orphaned functions with CASCADE | ~10 lines SQL |
| 13 | L1–L5 — Polish | minor |

**Confirmed from live install run (2026-03-18):** C3 and C4 are now the top blockers. The npm failure on `@tanstack/react-table@8.20.0` means the build fails before any code runs. Migration idempotency (C4) means reinstalling after a partial run will always cascade-fail every migration from 003 onward.

**Confirmed from live uninstall runs (2026-03-18):**
- M4 resolved — 15 down-migrations present in correct order.
- M5 fix confirmed — migrations 011 through 004 now all succeed in run 2.
- M6 identified in run 2 — 003 fails (`YATDA_Users doesn't exist`), 002 fails (FK from YATDA_Users blocks YATDA_Connectors drop), three trigger functions (`yatda_add_owner_as_member`, `yatda_handle_new_user`, `yatda_stamp_phase_timestamp`) remain orphaned in the database after uninstall.

---

## Architecture Addendum — CMS Backend Clarifications

> **Added:** 2026-03-18  
> This section corrects assumptions made in C2 and provides a full description of how the CMS backend authenticates requests and manages authorization. The plugin must align with these patterns, not work around them.

---

### How the CMS API actually works

#### No application-layer authentication middleware

The CMS Hono API (`api/index.ts`) has **no auth middleware**. There is no JWT verification step, no session check, and no route guard in any of the core route handlers (`schemas.ts`, `media.ts`, `plugins.ts`, `mcp.ts`, etc.). The only middleware wired to `/api/*` is `agentLogger`, which logs requests to the `agent_logs` table — it does not inspect or verify any `Authorization` header.

All access control is delegated entirely to **Supabase RLS policies evaluated at the database layer**.

#### How requests are authenticated in practice

The CMS frontend (and plugins) include a Supabase-issued JWT as `Authorization: Bearer <token>` on every API request. The Hono route handler does not validate this token itself. Instead, it passes the token through to Supabase when constructing a **user-scoped client**:

```ts
// The correct pattern for any user-facing route
const token = c.req.header("Authorization")?.slice(7) ?? "";
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
});
// All queries now run as the authenticated user. RLS is enforced automatically.
```

Supabase then validates the JWT signature internally and sets `auth.uid()` and `request.jwt.claims` for the duration of that connection. RLS policies evaluate against these values.

#### The admin client is for privileged operations only

`createSupabaseAdminClient` (which uses `SS_SUPABASE_SECRET_KEY`) bypasses RLS entirely. In the CMS codebase it is used in **exactly one place**: auto-creating missing storage buckets in `api/routes/media.ts`. It is not used for any user-facing data queries.

The plugin's current architecture uses the admin client for all API operations that require elevated access (e.g., provisioning users, fetching workspace data). This is architecturally incorrect — it means RLS policies are never exercised, and the plugin bypasses the security model the CMS is built on.

---

### How roles and authorization work

The CMS uses a **JWT claims injection** model, not application-layer role checks.

1. When a user signs in, Supabase calls the `custom_access_token_hook` Postgres function (`migrations/Auth/Access_hook.sql`).
2. The hook reads `public.user_roles` (joined with `public.roles`) for the signing-in user and injects the result as a `user_roles` JSON array into the JWT claims.
3. Every subsequent API request by that user carries a JWT containing e.g. `"user_roles": ["admin"]`.
4. RLS policies check this claim directly:

```sql
-- Example RLS policy using the injected claim
WITH CHECK (
  (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['super-admin']
)
```

**The plugin must not reinvent this.** It should not maintain its own role-lookup logic in the API layer. Role-based access in YATDA should be enforced via RLS policies that read `current_setting('request.jwt.claims', true)::jsonb -> 'user_roles'`, exactly as the CMS does.

The `YATDA_Users` table is appropriate for YATDA-specific profile data (username, display name, avatar). It is **not** the place to store or check CMS roles.

---

### Corrected `api/lib/supabase.ts` for the plugin

The C2 fix in this report corrected the binding names but left the architectural approach unchanged. The correct plugin Supabase setup aligns with the CMS pattern:

```ts
import { createClient } from "@supabase/supabase-js";

// Plugin shares env bindings with the CMS worker — these are the real names.
export interface PluginEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;          // plain var (local dev via .dev.vars)
  SS_SUPABASE_SECRET_KEY: SecretsStoreBinding; // Secrets Store binding (production only)
}

// Use this for ALL user-facing routes.
// Passes the user's JWT so that RLS is enforced and auth.uid() is set.
export function getSupabaseClient(env: PluginEnv, userToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Use this ONLY for privileged operations that must bypass RLS
// (e.g., POST /users/me/ensure to provision a missing YATDA_Users row).
// Requires SS_SUPABASE_SECRET_KEY to be a Cloudflare Secrets Store binding.
export async function getSupabaseAdminClient(env: PluginEnv) {
  const key = await env.SS_SUPABASE_SECRET_KEY.get();
  return createClient(env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

Every route handler should extract the token and use the user-scoped client:

```ts
// Standard pattern for all plugin route handlers
router.get("/workspaces", async (c) => {
  const token = c.req.header("Authorization")?.slice(7) ?? "";
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseClient(c.env, token);
  // RLS ensures this query only returns workspaces the user is a member of
  const { data, error } = await supabase.from("YATDA_Workspaces").select("*");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});
```

The admin client should only appear in the `POST /users/me/ensure` handler or equivalent privileged bootstrap route.

---

### Summary of architectural corrections

| Assumption in original review | Reality |
|---|---|
| CMS exposes `SUPABASE_ANON_KEY` binding | CMS exposes `SUPABASE_PUBLISHABLE_KEY` (plain var) |
| CMS exposes `SUPABASE_SERVICE_KEY` binding | CMS exposes `SS_SUPABASE_SECRET_KEY` (Secrets Store binding, requires `.get()`) |
| Plugin should use admin client for user queries | Plugin must use user-scoped client (pass Bearer token) for all user-facing queries |
| Roles checked in API layer | Roles are in the JWT (`user_roles` claim); access control belongs in RLS policies |
| `YATDA_Users` is the source of truth for roles | CMS `public.roles` / `user_roles` → JWT claims is the source of truth; `YATDA_Users` is for YATDA profile data only |

The C1 path fix (`/api/plugin/yatda`) and the C2 binding name fixes remain correct and necessary. The additional correction here is that the plugin must also switch from admin-client-first to user-scoped-client-first, or RLS will never be exercised and the security model will be silently bypassed.
