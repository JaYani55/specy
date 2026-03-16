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

**Directory:** `migrations/` (no `down/` subdirectory)

The CMS uninstall script looks for `migrations/down/*.sql` to reverse the schema on plugin uninstall. Without them the script auto-generates DROP statements from the up-migrations, but developer-authored reversals would be more precise (e.g. dropping RLS policies before dropping tables, removing seed data, etc.).

**Recommended:** Create `migrations/down/` with explicit reversal files. Drop order is the reverse of creation:

```
migrations/down/014_disable_rls.sql
migrations/down/013_drop_external_task_map.sql
migrations/down/012_drop_connector_credentials.sql
migrations/down/011_drop_comments.sql
migrations/down/010_drop_milestones.sql
migrations/down/009_drop_ticket_assignees.sql
migrations/down/008_drop_tickets.sql        -- also drops ticket_status_enum
migrations/down/007_drop_category_users.sql
migrations/down/006_drop_categories.sql
migrations/down/005_drop_workspace_members.sql
migrations/down/004_drop_workspaces.sql
migrations/down/003_drop_users.sql          -- also drops shared trigger functions
migrations/down/002_drop_connectors.sql
migrations/down/001_drop_extensions.sql     -- optional
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
| 1 | C1 — Change `API_BASE` from `/api/plugins/` to `/api/plugin/` | 1 line |
| 2 | C2 — Fix binding names in `api/lib/supabase.ts` | ~10 lines |
| 3 | H1 — Provision existing users (`POST /users/me/ensure` + call from `BoardPage`) | ~50 lines |
| 4 | H2 — Add empty-workspace UI prompt | ~20 lines |
| 5 | H3 — Move cross-column status mutation to `handleDragEnd` | ~30 lines |
| 6 | M1 + M2 — Wire filter state to `useTickets` + fix cache key | ~20 lines |
| 7 | M3 — Return joined ticket from `POST /tickets` | ~5 lines |
| 8 | M4 — Write down-migrations | ~80 lines SQL |
| 9 | L1–L5 — Polish | minor |

Items C1 and C2 are the most impactful for the least effort. Fix those two and the plugin will be able to make its first real API call.
