import { supabase } from '../lib/supabase';
import { API_URL } from '@/lib/apiUrl';

// ─── Types ───────────────────────────────────────────────────────────

export interface Role {
  id: number;
  name: string;
  description: string | null;
  app: string[] | null;
}

export interface AccountUser {
  user_id: string;
  Username: string | null;
  pfp_url: string | null;
  created_at: string | null;
  email?: string | null;
  roles: Role[];
}

export interface CreateRolePayload {
  name: string;
  description?: string;
  app?: string[];
}

export interface UpdateRolePayload {
  name?: string;
  description?: string;
  app?: string[];
}

export interface CreateAccountPayload {
  email: string;
  password: string;
  username?: string;
  roleIds?: number[];
}

interface UserRoleRow {
  user_id: string;
  role_id: number;
  roles: Role | null;
}

const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

const buildApiHeaders = async (): Promise<HeadersInit> => {
  const token = await getAuthToken();
  return token
    ? { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    : { Accept: 'application/json' };
};

// ─── Role CRUD ───────────────────────────────────────────────────────

export const fetchRoles = async (): Promise<Role[]> => {
  const { data, error } = await supabase
    .from('roles')
    .select('id, name, description, app')
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching roles:', error);
    throw error;
  }
  return data || [];
};

export const createRole = async (payload: CreateRolePayload): Promise<Role> => {
  const { data, error } = await supabase
    .from('roles')
    .insert({
      name: payload.name,
      description: payload.description || null,
      app: payload.app || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating role:', error);
    throw error;
  }
  return data;
};

export const updateRole = async (id: number, payload: UpdateRolePayload): Promise<Role> => {
  const { data, error } = await supabase
    .from('roles')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating role:', error);
    throw error;
  }
  return data;
};

export const deleteRole = async (id: number): Promise<void> => {
  const { error } = await supabase
    .from('roles')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting role:', error);
    throw error;
  }
};

// ─── User Accounts ──────────────────────────────────────────────────

export const fetchAccounts = async (): Promise<AccountUser[]> => {
  // Fetch profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profile')
    .select('user_id, "Username", pfp_url, created_at')
    .order('created_at', { ascending: false });

  if (profileError) {
    console.error('Error fetching user profiles:', profileError);
    throw profileError;
  }

  // Fetch all user_roles with role details
  const { data: userRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, role_id, roles(id, name, description, app)');

  if (rolesError) {
    console.error('Error fetching user roles:', rolesError);
    throw rolesError;
  }

  // Build a map of user_id → roles
  const rolesByUser = new Map<string, Role[]>();
  for (const ur of (userRoles ?? []) as UserRoleRow[]) {
    const userId = ur.user_id;
    if (!rolesByUser.has(userId)) {
      rolesByUser.set(userId, []);
    }
    const role = ur.roles;
    if (role) {
      rolesByUser.get(userId)!.push(role);
    }
  }

  return (profiles || []).map((p) => ({
    user_id: p.user_id,
    Username: p.Username,
    pfp_url: p.pfp_url,
    created_at: p.created_at,
    roles: rolesByUser.get(p.user_id) || [],
  }));
};

export const fetchAdminAccounts = async (): Promise<AccountUser[]> => {
  const response = await fetch(`${API_URL}/api/accounts`, {
    headers: await buildApiHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || 'Failed to load accounts.');
  }

  return await response.json() as AccountUser[];
};

// ─── Role Assignment ────────────────────────────────────────────────

export const assignRole = async (userId: string, roleId: number): Promise<void> => {
  const { error } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role_id: roleId });

  if (error) {
    // Ignore duplicate key (already assigned)
    if (error.code === '23505') return;
    console.error('Error assigning role:', error);
    throw error;
  }
};

export const removeRole = async (userId: string, roleId: number): Promise<void> => {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('role_id', roleId);

  if (error) {
    console.error('Error removing role:', error);
    throw error;
  }
};

// ─── Account Creation ───────────────────────────────────────────────

/**
 * Creates a new user account via Supabase Auth, then creates the profile
 * and assigns initial roles.
 * 
 * NOTE: This uses signUp which sends a confirmation email.
 * For admin-created accounts without email confirm you need the service_role key
 * or can disable email confirmation in Supabase dashboard.
 */
export const createAccount = async (payload: CreateAccountPayload): Promise<{ userId: string }> => {
  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      // Don't sign in as the new user — we're an admin creating an account
      data: {
        username: payload.username || null,
      },
    },
  });

  if (authError) {
    console.error('Error creating auth user:', authError);
    throw authError;
  }

  const userId = authData.user?.id;
  if (!userId) {
    throw new Error('User creation did not return a user ID');
  }

  // 2. Create user_profile row
  const { error: profileError } = await supabase
    .from('user_profile')
    .insert({
      user_id: userId,
      Username: payload.username || null,
    });

  if (profileError) {
    console.error('Error creating user profile:', profileError);
    // Don't throw — the auth user was created; we'll try to assign roles anyway
  }

  // 3. Assign initial roles
  if (payload.roleIds && payload.roleIds.length > 0) {
    const roleInserts = payload.roleIds.map((roleId) => ({
      user_id: userId,
      role_id: roleId,
    }));

    const { error: rolesError } = await supabase
      .from('user_roles')
      .insert(roleInserts);

    if (rolesError) {
      console.error('Error assigning initial roles:', rolesError);
    }
  }

  return { userId };
};
