# Authentication & Authorization Model

This document describes the authentication and authorization model used by Specy. It covers how Supabase handles sessions, how custom JWT claims encode roles, how the backend and frontend enforce access, and how plugins can introduce custom roles without modifying core.

---

## 1. Authentication (Login & Session Management)

Authentication is handled entirely by Supabase Auth. The frontend uses the [@supabase/supabase-js](src/lib/supabase.ts) client to sign in, sign out, and manage session lifecycle.

### Login Flow

1. User submits email + password.
2. [AuthContext.login()](src/contexts/AuthContext.tsx#L218) calls `supabase.auth.signInWithPassword()`.
3. Supabase returns an access token (JWT) and a refresh token.
4. The JWT is decoded client-side with `jwtDecode` to extract `user_roles` from custom claims.
5. The frontend checks that the user has at least one allowed role (`user`, `staff`, `admin`, `super-admin`). If not, access is denied.
6. On successful login, the session and user data are stored in the auth reducer and the React Query cache is primed with fresh data.

### Session Persistence

Supabase stores the session in localStorage by default. On app load, [AuthProvider's initAuth()](src/contexts/AuthContext.tsx#L85) checks for an existing session via `supabase.auth.getSession()` and restores it if valid. An `onAuthStateChange` listener handles `SIGNED_IN`, `SIGNED_OUT`, and `TOKEN_REFRESHED` events reactively.

### Logout

[logout()](src/contexts/AuthContext.tsx#L256) clears the React Query cache, localStorage, sessionStorage, cookies, calls `supabase.auth.signOut()`, and redirects to `/login`.

---

## 2. Role Model: Database & JWT Claims

### Database Tables

Core roles are stored in two tables:

- **[roles](migrations/roles.sql)**: Role definitions (`user`, `staff`, `admin`, `super-admin`) seeded idempotently by migration.
- **[user_roles](migrations/user_roles.sql)**: Maps users to roles via `user_id` and `role_id` foreign keys.

### Custom JWT Claim: `user_roles`

Roles are encoded into the JWT as a custom claim named `user_roles`. This claim is injected by a Supabase Auth Hook (database-level trigger) that runs on sign-in and token refresh. The hook reads `public.user_roles` and writes the array of role names into `raw_app_meta_data.user_roles` or directly into the token's `user_roles` claim.

This means every authenticated request carries the user's roles in the JWT itself — no database lookup is needed for authorization.

### SQL Helper: `current_user_roles()`

Throughout the database (migrations, RLS policies), the helper function `public.current_user_roles()` reads the `user_roles` array from the JWT's `request.jwt.claims`:

```sql
create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles', '[]'::jsonb)
      )
    ),
    '{}'::text[]
  )
$$;
```

Additional helpers derive common checks from this:
- `public.is_super_admin()` — returns true if `'super-admin'` is in `current_user_roles()`.
- `public.is_content_admin()` — returns true if `current_user_roles()` intersects with `['admin', 'super-admin']`.

---

## 3. Backend Authorization (Hono / Worker)

The backend uses two authorization functions from [api/lib/auth.ts](api/lib/auth.ts):

### `requireAppRole(c, requiredRole)`

Hierarchical role check. The `AppRole` type defines an ordering: `user < admin < super-admin`. A user with `admin` passes `requireAppRole(c, 'user')` — they meet or exceed the minimum rank. Staff is normalized to `user` for this check.

### `requireAnyJwtRole(c, requiredRoles: string[])`

Exact match check. The user must have at least one of the listed roles in their JWT `user_roles` claim. This is used for non-hierarchical roles like `support` that plugins introduce:

```typescript
const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);
```

### `verifyAuthSession(env, token)`

Decodes the JWT and returns a `VerifiedAuthSession` with `token`, `roles`, `userId`, and raw `claims`. Used by middleware and routes that need the session context without enforcing a specific role.

### Session Verification

All backend functions use `createSupabaseClient(env, token)` and call `supabase.auth.getClaims(token)` to verify the token against Supabase Auth. This validates expiry, signature, and revocation in one call.

---

## 4. Frontend Authorization (React)

### AuthContext

[AuthContext](src/contexts/AuthContext.tsx) provides the current user's roles via `user.roles` (string array) and `user.role` (the primary `UserRole` enum). It exposes permission helpers:

- `hasRole(role: UserRole)` — checks if a specific role string is in the user's role array.
- `hasAnyRole(roles: UserRole[])` — checks if any of the given roles match.

### Protected Routes

[ProtectedRoute](src/components/auth/ProtectedRoute.tsx) uses the `requiredRole` prop (`AppRole` type) to gate access to pages. It mirrors the backend's hierarchical check: a user with `admin` can access a page requiring `user`.

### Plugin Access Gating

Plugins declare access rules in their [PluginDefinition](src/types/plugin.ts#L277):

```typescript
const plugin: PluginDefinition = {
  access: {
    anyRole: ['support', 'super-admin'],
  },
};
```

The `PluginAccessRule.anyRole` array gates:
- **Plugin routes** — the page is hidden if the user lacks a matching role.
- **Sidebar items** — the navigation item is hidden.
- **Plugin hooks** — frontend hooks are filtered by user roles via `getPluginHooks(target, userRoles)`.

---

## 5. RLS (Row-Level Security) at the Database Layer

All content tables use PostgreSQL Row-Level Security. Policies evaluate the JWT's `user_roles` via `public.current_user_roles()` and the caller's identity via `auth.uid()`.

### Policy Patterns

| Pattern | Example |
|---|---|
| **Super-admin only** | `public.is_super_admin()` |
| **Support or super-admin** | `public.is_super_admin() OR public.is_support()` |
| **Row owner** | `user_id = public.current_user_id()` |
| **Tenant member** | `public.is_tenant_member(tenant_id)` |
| **Tenant admin** | `public.is_tenant_admin(tenant_id)` or `public.can_administer_user_in_tenant(tenant_id, target_user_id)` |

### Tenant-Aware Policies

The multi-tenant model adds an additional layer:

```sql
CREATE POLICY "tenant users can read own storage objects"
  ON public.tenant_storage_objects
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      user_id = public.current_user_id()
      AND public.is_tenant_member(tenant_id, public.current_user_id())
    )
    OR public.is_tenant_admin(tenant_id, public.current_user_id())
  );
```

This ensures users can only see objects within their own tenant, while super-admins retain global visibility.

---

## 6. When to Use `createSupabaseClient` vs `createSupabaseAdminClient`

From [api/lib/supabase.ts](api/lib/supabase.ts):

### `createSupabaseClient(env, token?)`

- Uses the Supabase **publishable key** (anon key).
- Pass the caller's Bearer token to activate RLS (`auth.uid()`, `current_user_roles()`).
- Omit the token for intentionally unauthenticated operations (public reads, logging).
- **This is the default for all user-facing endpoints.** Always prefer this.

### `createSupabaseAdminClient(env)`

- Uses the Supabase **service role key** (bypasses RLS entirely).
- Only available server-side via `SS_SUPABASE_SECRET_KEY` (Cloudflare Secrets Store).
- **Never use this for user-facing content operations.**
- Reserved exclusively for:
  - Reading/writing `system_config`.
  - Reading/writing `managed_secrets`.
  - Plugin registry writes and deletes.
  - Migration operations.
  - Background sync jobs (legacy — now replaced by user-scoped sync).
  - Operations that truly require bypassing RLS for platform-level concerns.

**Rule of thumb:** If the operation is triggered by a user request and relates to user-visible content (pages, forms, objects, events, staff, KB documents), use `createSupabaseClient` with the caller's token. If the operation is a platform-level administrative action (config, secrets, migrations), use `createSupabaseAdminClient`.

---

## 7. Plugin Custom Roles

Plugins can introduce custom roles beyond the core `AppRole` set (`user`, `admin`, `super-admin`). These roles are stored in `public.roles` and `public.user_roles` like any other role, and are injected into the JWT's `user_roles` claim by the Supabase Auth Hook.

### Declaring a Custom Role in a Plugin

1. **Add the role to the database** via a plugin migration:
   ```sql
   INSERT INTO public.roles (name, description)
   VALUES ('support', 'Global support operator')
   ON CONFLICT (name) DO NOTHING;
   ```

2. **Gate plugin routes and UI** via `PluginDefinition.access.anyRole`:
   ```typescript
   access: {
     anyRole: ['support', 'super-admin'],
   },
   ```

3. **Enforce on the backend** with `requireAnyJwtRole`:
   ```typescript
   const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);
   ```

4. **Enforce at the database layer** by adding RLS policies that reference the custom role (the `is_support()` function in migration 009 demonstrates this pattern):
   ```sql
   CREATE OR REPLACE FUNCTION public.is_support()
   RETURNS BOOLEAN
   LANGUAGE sql
   STABLE
   AS $$
     SELECT coalesce('support' = any(public.current_user_roles()), false)
   $$;
   ```

### JWT Claim Consistency

Because roles flow from `public.user_roles` → Supabase Auth Hook → JWT `user_roles` claim → `current_user_roles()`, any role added via plugin migrations is automatically available in the JWT after the next sign-in or token refresh. No core modification is required.

---

## 8. Summary: Authorisation Decision Tree

```
Request arrives
  ├─ No token → 401 (Authentication required)
  └─ Has token
       ├─ Token invalid/expired → 401 (Invalid or expired session)
       └─ Token valid
            ├─ Route uses requireAnyJwtRole(['support', 'super-admin'])
            │    └─ Check user_roles claim for match → 403 if none
            ├─ Route uses requireAppRole(c, 'admin')
            │    └─ Check hierarchical rank (user < admin < super-admin) → 403 if below
            └─ Route uses verifyAuthSession (no explicit role gate)
                 └─ Session context available, route decides internally
```

### Example: Knowledge Base Settings Access

```typescript
// Frontend: KB tools and settings pages are gated by support|super-admin
access: { anyRole: ['support', 'super-admin'] }

// Backend: POST /api/plugin/pluradash/settings
const auth = await requireAnyJwtRole(c, ['support', 'super-admin']);

// Database: pluradash.tenant_settings RLS
CREATE POLICY "pluradash tenant members can read settings"
  ON pluradash.tenant_settings
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_support()
  );
```