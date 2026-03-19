# YATDA Plugin — Iteration Feedback Report

**Date:** 2026-03-19  
**Reviewer:** service-cms maintainer  
**Plugin version under review:** 1.0.0  
**Status:** Feedback for next iteration

---

## Summary

Two issues were identified during integration testing. One renders a core action (creating a ticket) inaccessible, the other makes plugin configuration unintuitive without prior knowledge of the required keys.

---

## Issue 1 — "Add Task" Button is Invisible

### Description

The `+ Add Task` button in `BoardHeader.tsx` is present in the DOM but appears invisible to users. The root cause is a CSS variable incompatibility between the plugin and the host CMS.

### Root cause

The plugin's `BoardHeader.module.css` applies the `--accent` custom property directly:

```css
.addBtn {
  background: var(--accent);
  color: #fff;
}
.addBtn:hover { background: var(--accent-hover); }
```

The host CMS follows the shadcn/Tailwind convention where `--accent` is stored as a raw HSL triple (e.g. `210 40% 96.1%`), not a usable color value on its own. Using `background: var(--accent)` with that value produces an invalid CSS declaration and falls back to a transparent background. With `color: #fff`, this results in white text on a transparent surface — effectively invisible.

Additionally, `--accent-hover` is not defined anywhere in the host CMS, so the hover state is also broken.

### Impact

Users cannot create new tickets. The `+ Add Task` button is rendered but cannot be seen or clicked with confidence, making ticket creation impossible via the UI.

### Suggested fixes

**Option A — Use `hsl()` wrappers (least intrusive):**  
Wrap all color variable references that expect HSL triples:

```css
.addBtn {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}
.addBtn:hover { background: hsl(var(--accent) / 0.85); }
```

This aligns with the pattern used by the rest of the host CMS (shadcn components all use `hsl(var(--...))`) and requires no changes outside the plugin.

**Option B — Scoped fallback variables:**  
In `BoardPage.module.css` or a new `yatda-tokens.css`, re-declare plugin-scoped variables with safe fallback values:

```css
.yatdaRoot {
  --yatda-accent: hsl(var(--accent, 221 83% 53%));
  --yatda-accent-hover: hsl(var(--accent) / 0.85);
}
```

Then replace `var(--accent)` / `var(--accent-hover)` with `var(--yatda-accent)` / `var(--yatda-accent-hover)` across all module CSS files.

### Additional UX gap — No per-column "add" button in Kanban view

Beyond the invisible header button, the `KanbanColumn` component (`KanbanView.tsx`) has no `+` button at the bottom of each column. This is a standard affordance in Kanban applications (Jira, Linear, GitHub Projects) and is expected by users. Adding an `onClick={() => openTicket(null)}` button at the base of each column (optionally pre-selecting the column's status in the `TicketModal`) would significantly improve discoverability.

---

## Issue 2 — Plugin Config Dialog Has No Pre-populated Parameter Defaults

### Description

The `plugin.json` manifest defines a `config_schema` array with four well-documented configuration keys (`google_client_id`, `google_client_secret`, `google_redirect_uri`, `token_encryption_key`). However, this information is never surfaced in the CMS plugin configuration UI.

When an admin opens the configuration dialog for YATDA in `/plugins`, they see an empty key-value editor with no indication of what keys are required or expected.

### Root cause — two-layer gap

**1. The `config_schema` field is absent from all relevant TypeScript types.**

- `PluginManifest` (`src/types/plugin.ts`) does not include a `config_schema` field.
- `PluginRegistration` (`src/types/plugin.ts`) has no `config_schema` field.
- `PluginDefinition` (the runtime descriptor exported from `src/index.tsx`) also lacks it.

As a result the schema data in `plugin.json` is read by the install script but then discarded — it never reaches the runtime or the database.

**2. The config dialog in `Plugins.tsx` is fully generic.**

`openConfig()` converts `plugin.config` (saved key-value pairs) into the pairs list. For a plugin that has never been configured, this list is empty and gives no guidance:

```tsx
const openConfig = (plugin: PluginRegistration) => {
  setConfigPlugin(plugin);
  setConfigPairs(toConfigPairs(plugin.config ?? {}));  // empty on first open
};
```

### Suggested fixes

**Step 1 — Add `config_schema` to `PluginManifest`:**

```ts
export interface ConfigSchemaEntry {
  key: string;
  type: 'string' | 'secret';
  label: string;
  description?: string;
  required?: boolean;
}

export interface PluginManifest {
  // ... existing fields ...
  config_schema?: ConfigSchemaEntry[];
}
```

**Step 2 — Persist the schema in the database and/or expose it through `PluginDefinition`.**

Either store `config_schema` in the `plugins` table as a JSONB column so `PluginRegistration` can carry it, or expose it through the runtime `PluginDefinition` (simpler, since it doesn't require a migration):

```ts
export interface PluginDefinition {
  // ... existing fields ...
  configSchema?: ConfigSchemaEntry[];
}
```

**Step 3 — Pre-populate the config dialog from the schema.**

In `Plugins.tsx`, when a runtime plugin with a matching slug has a `configSchema`, seed the pairs list with its keys (preserving already-saved values):

```ts
const openConfig = (plugin: PluginRegistration) => {
  setConfigPlugin(plugin);
  const savedPairs = toConfigPairs(plugin.config ?? {});
  const runtimePlugin = runtimePlugins.find((r) => r.id === plugin.slug);
  const schema = runtimePlugin?.configSchema ?? [];
  // Merge: use saved value if present, otherwise empty string
  const merged = schema.map((entry) => ({
    key: entry.key,
    value: plugin.config?.[entry.key] ?? '',
  }));
  // Append any saved keys that were not in the schema (manual pairs)
  const schemaKeys = new Set(schema.map((e) => e.key));
  const extra = savedPairs.filter((p) => !schemaKeys.has(p.key));
  setConfigPairs([...merged, ...extra]);
};
```

**Optional UX enhancement — show schema metadata inline:**  
Display `label` and `description` from the schema entry next to each row (e.g. as a tooltip or sub-label), and use `type === 'secret'` to render a password-type input instead of plain text. This prevents accidental exposure of OAuth secrets in the config dialog.

---

---

## Issue 3 — Ambiguous PostgREST Relationship: `YATDA_Ticket_Assignees` → `YATDA_Users`

### Description

This is the error currently raised at runtime:

> Could not embed because more than one relationship was found for 'YATDA_Ticket_Assignees' and 'YATDA_Users'

### Root cause

`009_create_ticket_assignees.sql` defines **two foreign keys from `YATDA_Ticket_Assignees` to `YATDA_Users`**:

```sql
create table "YATDA_Ticket_Assignees" (
  ticket_id   uuid not null references "YATDA_Tickets" (ticket_id) on delete cascade,
  user_id     uuid not null references "YATDA_Users" (user_id) on delete cascade,   -- FK #1
  assigned_at timestamptz not null default now(),
  assigned_by uuid references "YATDA_Users" (user_id) on delete set null,            -- FK #2
  primary key (ticket_id, user_id)
);
```

Both `user_id` and `assigned_by` point to the same target table. When PostgREST resolves the embedded join:

```ts
user:YATDA_Users(user_id, username, display_name, avatar_url)
```

...it finds two candidate FK paths and cannot decide which to use, so it throws the ambiguity error.

### Affected query sites in `api/routes/tickets.ts`

This embedded join appears in **four separate select calls**, all of which are broken:

1. `GET /` — list tickets
2. `GET /:id` — single ticket (also embeds comments)
3. `POST /` — create ticket (select after insert)
4. `PATCH /:id` — update ticket (select after update)

### Why the column-name hint alone does not fix it

The `!<column>` shorthand (e.g. `!user_id`) was added in **PostgREST 12.2**. Supabase projects that were provisioned before that version ship with an older PostgREST binary and only support `!<constraint_name>` hints. Because the FKs in `009_create_ticket_assignees.sql` were declared inline without explicit names, PostgreSQL auto-generated opaque names (`YATDA_Ticket_Assignees_user_id_fkey`, `YATDA_Ticket_Assignees_assigned_by_fkey`). Those names are unknown to the developer, change depending on how the migration is applied, and cannot be relied upon in embed hints.

### Required fix — Named FK constraints + constraint-name hint

**Step 1 — Add a migration to rename the FK constraints:**

```sql
-- migrations/016_name_ticket_assignee_fks.sql
ALTER TABLE "YATDA_Ticket_Assignees"
  DROP CONSTRAINT "YATDA_Ticket_Assignees_user_id_fkey",
  ADD  CONSTRAINT "fk_ticket_assignees_assignee"
       FOREIGN KEY (user_id) REFERENCES "YATDA_Users" (user_id) ON DELETE CASCADE;

ALTER TABLE "YATDA_Ticket_Assignees"
  DROP CONSTRAINT "YATDA_Ticket_Assignees_assigned_by_fkey",
  ADD  CONSTRAINT "fk_ticket_assignees_assigner"
       FOREIGN KEY (assigned_by) REFERENCES "YATDA_Users" (user_id) ON DELETE SET NULL;
```

A parallel file is also needed in `supabase/migrations/` for Supabase CLI users.

**Step 2 — Update the embed hint in all four query sites** (both `api/routes/tickets.ts` and `packages/api/src/routes/tickets.ts`):

```diff
- user:YATDA_Users!user_id(user_id, username, display_name, avatar_url)
+ user:YATDA_Users!fk_ticket_assignees_assignee(user_id, username, display_name, avatar_url)
```

The constraint-name hint works on **all PostgREST versions** and is self-documenting.

**Step 3 — Register the migration in `plugin.json`:**

```json
"migrations": [
  ...
  "migrations/016_name_ticket_assignee_fks.sql"
]
```

**Alternative — Drop `assigned_by` if audit-trailing is not needed:**  
`assigned_by` is populated on INSERT but is never selected, filtered on, or returned in any API response. Dropping it removes the ambiguity entirely with no hint changes required. This would be a `016_drop_assigned_by.sql` migration with a corresponding column drop and a matching down migration.

---

## Issue 4 — Missing UPDATE Policy on `YATDA_Workspace_Members`

### Description

`014_enable_rls.sql` defines three policies for `YATDA_Workspace_Members`:

- `wm_select_member` (SELECT)
- `wm_insert_admin` (INSERT)
- `wm_delete_admin` (DELETE)

There is **no UPDATE policy**. With RLS enabled, the absence of an UPDATE policy means any attempt to change a member's `role` (e.g. promoting a member to admin, or demoting an admin) is silently blocked by Supabase — the operation returns no rows affected without an error, making it appear to succeed.

### Impact

Workspace role management is completely non-functional at the database level. There is no way to change `role` for an existing `YATDA_Workspace_Members` row through the Supabase client or REST API.

### Fix

Add the missing policy:

```sql
create policy "wm_update_admin"
  on "YATDA_Workspace_Members" for update
  to authenticated
  using (yatda_is_workspace_admin(workspace_id))
  with check (yatda_is_workspace_admin(workspace_id));
```

This can be added as a new migration file (e.g. `016_fix_workspace_member_update_policy.sql`) or appended to `014_enable_rls.sql` if the database has not yet been deployed.

---

## Issue 5 — `YATDA_Users` Has No INSERT RLS Policy

### Description

`014_enable_rls.sql` enables RLS on `YATDA_Users` and defines SELECT and UPDATE policies, but **no INSERT policy**. This is intentional — user rows are always created via the `SECURITY DEFINER` trigger `trg_on_auth_user_created` (which bypasses RLS), or via the admin client in `POST /users/me/ensure`.

However, this creates a hidden dependency that is not documented and is fragile:

- If the trigger is accidentally dropped or fails, there is no fallback path for a regular authenticated user to create their own profile row.
- Any future feature that needs a user to INSERT their own row will fail silently, with no clear error message explaining why RLS is blocking it.

### Recommendation

Add an explicit INSERT policy scoped to the user's own `user_id`, so the intent is visible and there is a safe fallback:

```sql
create policy "users_insert_own"
  on "YATDA_Users" for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
```

This does not change current behavior (the trigger still fires first) but makes the permissions model explicit and self-evident.

---

## Issue 6 — `sync_hash` Comment Is Ambiguous (MD5 vs SHA-256)

### Description

`013_create_external_task_map.sql` documents `sync_hash` as:

```sql
sync_hash text, -- MD5 / SHA-256 of external task JSON, for change detection
```

The comment states both MD5 and SHA-256, indicating the implementation choice was left unresolved. MD5 produces known collisions and should not be used even for non-security purposes where correctness matters (a hash collision would suppress a real sync update). The column type is just `text` with no constraint on hash format or length.

### Recommendation

- Commit to **SHA-256** (32-byte hex = 64 chars) and document it clearly.
- Optionally constrain the column: `sync_hash text check (length(sync_hash) = 64)`.
- Update the application-layer code in `api/lib/google-tasks.ts` and any other sync handlers accordingly.

---

## Issue 7 — `014_disable_rls.sql` Down Migration Fails if Issue 4 Fix is Applied

### Description

When the `wm_update_admin` policy (the fix for Issue 4) is applied to the database and the plugin is subsequently uninstalled, the down migration `014_disable_rls.sql` fails with:

```
ERROR: 2BP01: cannot drop function yatda_is_workspace_admin(uuid) because other objects depend on it
DETAIL: policy wm_update_admin on table "YATDA_Workspace_Members" depends on function yatda_is_workspace_admin(uuid)
HINT: Use DROP ... CASCADE to drop the dependent objects too.
```

### Root cause

`014_disable_rls.sql` drops the `yatda_is_workspace_admin()` helper function, but `wm_update_admin` references that function and must be dropped first. Because `wm_update_admin` was not part of the original `014_enable_rls.sql`, it was never added to the corresponding down migration.

### Cascade effect

The failure of `014_disable_rls.sql` leaves `YATDA_Workspace_Members` intact (its RLS policies still exist). This then causes every subsequent down migration to fail in sequence:

| Migration | Reason for failure |
|-----------|--------------------|
| `005_drop_workspace_members.sql` | `users_select_workspace_peer` policy on `YATDA_Users` references the table |
| `004_drop_workspaces.sql` | `YATDA_Workspace_Members_workspace_id_fkey` FK still exists |
| `003_drop_users.sql` | FKs from `YATDA_Workspaces` and `YATDA_Workspace_Members` still exist |
| `002_drop_connectors.sql` | FK from `YATDA_Users` still exists |

Five tables remain in the database and require manual cleanup.

### Fix — update `014_disable_rls.sql` to drop `wm_update_admin` first

The down migration must explicitly drop any policy that references the helper functions **before** dropping the functions themselves, regardless of whether those policies were part of the original `014_enable_rls.sql`. The fix is to prepend the following to `014_disable_rls.sql`:

```sql
-- Drop the wm_update_admin policy added as a fix for the missing UPDATE policy
-- (must be dropped before yatda_is_workspace_admin() can be removed)
DROP POLICY IF EXISTS "wm_update_admin" ON "YATDA_Workspace_Members";
```

The `IF EXISTS` guard makes this safe to run even if the Issue 4 fix was never applied.

### Manual cleanup for affected databases

For any database where the partial uninstall has already run, the remaining objects must be dropped manually in this order:

```sql
-- 1. Drop leftover policies that block the tables
DROP POLICY IF EXISTS "wm_update_admin" ON "YATDA_Workspace_Members";
DROP POLICY IF EXISTS "users_select_workspace_peer" ON "YATDA_Users";

-- 2. Drop remaining tables in dependency order
DROP TABLE IF EXISTS "YATDA_Workspace_Members" CASCADE;
DROP TABLE IF EXISTS "YATDA_Workspaces" CASCADE;
DROP TABLE IF EXISTS "YATDA_Users" CASCADE;
DROP TABLE IF EXISTS "YATDA_Connectors" CASCADE;

-- 3. Drop remaining functions (if not already gone)
DROP FUNCTION IF EXISTS yatda_is_workspace_admin(uuid);
DROP FUNCTION IF EXISTS yatda_is_workspace_member(uuid);
DROP FUNCTION IF EXISTS yatda_set_updated_at();
DROP FUNCTION IF EXISTS yatda_handle_new_user();
DROP FUNCTION IF EXISTS yatda_create_personal_workspace();
DROP FUNCTION IF EXISTS yatda_add_owner_as_member();
```

### General lesson

Any migration that adds a policy referencing a helper function must also update the corresponding down migration to drop that policy **before** the function drop. Down migrations must stay in sync with all forward migrations, not just the one they nominally reverse.

---

## Issue 8 — Literal `"undefined"` String Passed as Filter Causes 500 on All Ticket Queries

### Description

All ticket list requests fail with HTTP 500. The full request URL observed at runtime is:

```
GET /api/plugin/yatda/tickets?workspace_id=...&status=undefined&category_id=undefined
```

The literal string `"undefined"` is passed as the `status` and `category_id` query parameters. Because `"undefined"` is a truthy non-empty string, the API applies it as a filter:

```ts
if (status) query = query.eq("ticket_status", status);
```

This sends `eq("ticket_status", "undefined")` to PostgREST, which tries to cast `"undefined"` to the `ticket_status_enum` type and fails, returning a Postgres error — surfaced to the client as a 500.

### Impact

- The board never loads (the initial fetch of tickets always fails).
- Creating a ticket appears to fail silently: the POST succeeds and the ticket is actually saved, but `onSuccess` calls `invalidateQueries`, which triggers a refetch of the broken list endpoint. The UI shows no confirmation and the newly created ticket never appears.

### Root cause — two layers

**Layer 1 — Frontend: `URLSearchParams` coerces `undefined` to the string `"undefined"`**

In `src/lib/api.ts`:

```ts
list: (params: { workspace_id: string; status?: string; category_id?: string }) => {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  //                                            ^^^^^^^^^^^^^^^^^^^
  // TypeScript is silenced by the cast, but at runtime undefined values
  // are serialised as the string "undefined".
  return request<Ticket[]>(`/tickets?${qs}`);
},
```

**Fix:** Only include params that are actually defined:

```ts
list: (params: { workspace_id: string; status?: string; category_id?: string }) => {
  const p: Record<string, string> = { workspace_id: params.workspace_id };
  if (params.status !== undefined) p.status = params.status;
  if (params.category_id !== undefined) p.category_id = params.category_id;
  const qs = new URLSearchParams(p).toString();
  return request<Ticket[]>(`/tickets?${qs}`);
},
```

**Layer 2 — Backend: `if (status)` treats `"undefined"` as a truthy filter value**

In `api/routes/tickets.ts` and `packages/api/src/routes/tickets.ts`:

```ts
if (status) query = query.eq("ticket_status", status);      // truthy — "undefined" passes
if (category_id) query = query.eq("category_id", category_id);
```

**Fix:** Guard against the literal string as a defensive measure, so a malformed caller doesn't cause a 500:

```ts
if (status && status !== "undefined") query = query.eq("ticket_status", status);
if (category_id && category_id !== "undefined") query = query.eq("category_id", category_id);
```

Both layers need to be fixed. The frontend fix prevents the string from being sent; the backend fix prevents a 500 if it ever is.

---

## Checklist for Next Iteration

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1a | `+ Add Task` button invisible due to `--accent` / `--accent-hover` CSS variable mismatch | Critical | Open |
| 1b | No per-column "add" button in Kanban view | Minor | Open |
| 2a | `config_schema` not typed in `PluginManifest` / `PluginDefinition` | Medium | Open |
| 2b | Config dialog does not pre-populate rows from schema | Medium | Open |
| 2c | Secret config fields rendered as plain text inputs | Minor | Open |
| 3  | Ambiguous FK: `YATDA_Ticket_Assignees` has two FKs to `YATDA_Users` — `!user_id` hint fails on pre-12.2 PostgREST; named constraints + `!fk_ticket_assignees_assignee` hint required | Critical | Open |
| 4  | Missing UPDATE policy on `YATDA_Workspace_Members` — member role changes silently fail | High | Open |
| 5  | No INSERT policy on `YATDA_Users` — intent undocumented, fragile trigger dependency | Low | Open |
| 6  | `sync_hash` comment says "MD5 / SHA-256" — ambiguous, MD5 is collision-vulnerable | Low | Open |
| 7  | `014_disable_rls.sql` down migration doesn't drop `wm_update_admin` before dropping `yatda_is_workspace_admin()` — uninstall fails and leaves 4 tables orphaned | High | Open (manual DB cleanup required) |
| 8a | Frontend `URLSearchParams` cast serialises `undefined` options as the string `"undefined"` — all ticket list queries fail with 500 | Critical | Open |
| 8b | Backend `if (status)` guard treats literal `"undefined"` string as a valid enum filter — causes Postgres type error | High | Open |
