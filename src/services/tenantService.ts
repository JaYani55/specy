import { supabase } from '@/lib/supabase';

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
  is_tenant_admin: boolean;
  is_default: boolean;
}

interface TenantMembershipRow {
  tenant_id: string;
  is_tenant_admin: boolean;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  default_for_user_id: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type TenantRecord = TenantRow;

export interface TenantMembershipRecord {
  tenant_id: string;
  user_id: string;
  is_tenant_admin: boolean;
  status: 'active' | 'invited' | 'suspended';
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

const generateTenantSlug = (value: string): string => (
  value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'workspace'
);

const getCurrentUserId = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error(error.message);
  }

  return data.user?.id ?? null;
};

export const getVisibleTenants = async (): Promise<TenantRecord[]> => {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug, default_for_user_id, created_by, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TenantRecord[];
};

export const getVisibleTenantNameMap = async (
  tenantIds?: Array<string | null | undefined>,
): Promise<Record<string, string>> => {
  const visibleTenants = await getVisibleTenants();
  const allowedIds = tenantIds
    ? new Set(tenantIds.filter((tenantId): tenantId is string => Boolean(tenantId)))
    : null;

  return visibleTenants.reduce<Record<string, string>>((accumulator, tenant) => {
    if (!allowedIds || allowedIds.has(tenant.id)) {
      accumulator[tenant.id] = tenant.name;
    }
    return accumulator;
  }, {});
};

export const getTenantOptions = async (): Promise<TenantOption[]> => {
  const userId = await getCurrentUserId();
  if (!userId) {
    return [];
  }

  const visibleTenants = await getVisibleTenants();

  const { data: memberships, error: membershipsError } = await supabase
    .from('tenant_users')
    .select('tenant_id, is_tenant_admin')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (membershipsError) {
    throw new Error(membershipsError.message);
  }

  const membershipRows = (memberships ?? []) as TenantMembershipRow[];
  const tenantMap = new Map(
    visibleTenants.map((tenant) => [tenant.id, tenant]),
  );

  return membershipRows
    .map((membership) => {
      const tenant = tenantMap.get(membership.tenant_id);
      if (!tenant) {
        return null;
      }

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        is_tenant_admin: membership.is_tenant_admin,
        is_default: tenant.default_for_user_id === userId,
      } satisfies TenantOption;
    })
    .filter((tenant): tenant is TenantOption => tenant !== null)
    .sort((left, right) => {
      if (left.is_default !== right.is_default) {
        return left.is_default ? -1 : 1;
      }
      if (left.is_tenant_admin !== right.is_tenant_admin) {
        return left.is_tenant_admin ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
};

export const pickInitialTenantId = (
  options: TenantOption[],
  preferredTenantId?: string | null,
): string => {
  if (preferredTenantId && options.some((option) => option.id === preferredTenantId)) {
    return preferredTenantId;
  }

  const preferredOption = options.find((option) => option.is_default) ?? options[0];
  return preferredOption?.id ?? '';
};

export const getTenantMemberships = async (
  tenantIds?: string[],
): Promise<TenantMembershipRecord[]> => {
  let query = supabase
    .from('tenant_users')
    .select('tenant_id, user_id, is_tenant_admin, status, invited_by, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (tenantIds && tenantIds.length > 0) {
    query = query.in('tenant_id', tenantIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TenantMembershipRecord[];
};

export const createTenant = async (input: { name: string; slug?: string }): Promise<TenantRecord> => {
  const slug = generateTenantSlug(input.slug || input.name);
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      name: input.name.trim(),
      slug,
    })
    .select('id, name, slug, default_for_user_id, created_by, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as TenantRecord;
};

export const updateTenant = async (
  id: string,
  input: { name?: string; slug?: string },
): Promise<TenantRecord> => {
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) {
    updateData.name = input.name.trim();
  }
  if (input.slug !== undefined) {
    updateData.slug = generateTenantSlug(input.slug);
  }

  const { data, error } = await supabase
    .from('tenants')
    .update(updateData)
    .eq('id', id)
    .select('id, name, slug, default_for_user_id, created_by, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as TenantRecord;
};

export const upsertTenantMembership = async (input: {
  tenant_id: string;
  user_id: string;
  is_tenant_admin?: boolean;
  status?: TenantMembershipRecord['status'];
}): Promise<void> => {
  const { error } = await supabase
    .from('tenant_users')
    .upsert({
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      is_tenant_admin: Boolean(input.is_tenant_admin),
      status: input.status ?? 'active',
    }, { onConflict: 'tenant_id,user_id' });

  if (error) {
    throw new Error(error.message);
  }
};

export const updateTenantMembership = async (
  tenantId: string,
  userId: string,
  input: Partial<Pick<TenantMembershipRecord, 'is_tenant_admin' | 'status'>>,
): Promise<void> => {
  const { error } = await supabase
    .from('tenant_users')
    .update(input)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message);
  }
};

export const deleteTenantMembership = async (tenantId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('tenant_users')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message);
  }
};
