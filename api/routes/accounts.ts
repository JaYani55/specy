import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import { createSupabaseAdminClient, type Env } from '../lib/supabase';

const accounts = new Hono<{ Bindings: Env }>();

interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  app: string[] | null;
}

interface UserRoleRow {
  user_id: string;
  roles: RoleRow | null;
}

interface ProfileRow {
  user_id: string;
  Username: string | null;
  pfp_url: string | null;
  created_at: string | null;
}

accounts.get('/', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) {
    return auth;
  }

  const admin = await createSupabaseAdminClient(c.env);

  const [{ data: profiles, error: profileError }, { data: userRoles, error: rolesError }] = await Promise.all([
    admin
      .from('user_profile')
      .select('user_id, "Username", pfp_url, created_at')
      .order('created_at', { ascending: false }),
    admin
      .from('user_roles')
      .select('user_id, roles(id, name, description, app)'),
  ]);

  if (profileError) {
    console.error('Error fetching user profiles:', profileError);
    return c.json({ error: 'Failed to load user profiles.' }, 500);
  }

  if (rolesError) {
    console.error('Error fetching user roles:', rolesError);
    return c.json({ error: 'Failed to load user roles.' }, 500);
  }

  const emailByUserId = new Map<string, string>();
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('Error fetching auth users:', error);
      return c.json({ error: 'Failed to load account emails.' }, 500);
    }

    const users = data.users ?? [];
    for (const user of users) {
      if (user.id && user.email) {
        emailByUserId.set(user.id, user.email);
      }
    }

    if (users.length < perPage) {
      break;
    }
  }

  const rolesByUser = new Map<string, RoleRow[]>();
  for (const row of (userRoles ?? []) as UserRoleRow[]) {
    if (!rolesByUser.has(row.user_id)) {
      rolesByUser.set(row.user_id, []);
    }

    if (row.roles) {
      rolesByUser.get(row.user_id)?.push(row.roles);
    }
  }

  const result = ((profiles ?? []) as ProfileRow[]).map((profile) => ({
    user_id: profile.user_id,
    Username: profile.Username,
    pfp_url: profile.pfp_url,
    created_at: profile.created_at,
    email: emailByUserId.get(profile.user_id) ?? null,
    roles: rolesByUser.get(profile.user_id) ?? [],
  }));

  return c.json(result);
});

export default accounts;