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
}

export const getTenantOptions = async (): Promise<TenantOption[]> => {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }

  const userId = authData.user?.id;
  if (!userId) {
    return [];
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from('tenant_users')
    .select('tenant_id, is_tenant_admin')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (membershipsError) {
    throw new Error(membershipsError.message);
  }

  const membershipRows = (memberships ?? []) as TenantMembershipRow[];
  const tenantIds = membershipRows.map((membership) => membership.tenant_id);

  if (tenantIds.length === 0) {
    return [];
  }

  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name, slug, default_for_user_id')
    .in('id', tenantIds);

  if (tenantsError) {
    throw new Error(tenantsError.message);
  }

  const tenantMap = new Map(
    ((tenants ?? []) as TenantRow[]).map((tenant) => [tenant.id, tenant]),
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
