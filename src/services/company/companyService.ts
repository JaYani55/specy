import { supabase } from '@/lib/supabase';

export interface CompanyRecord {
  id: string;
  name: string;
  logo_url?: string | null;
}

export const getCompanyById = async (id: string, tenantId: string): Promise<CompanyRecord | null> => {
  if (!id || !tenantId) {
    return null;
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, logo_url')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle<CompanyRecord>();

  if (error) {
    console.error('Error fetching company:', error);
    return null;
  }

  return data ?? null;
};

export const ensureCompanyRecord = async ({
  companyId,
  companyName,
  tenantId,
}: {
  companyId?: string;
  companyName: string;
  tenantId: string;
}): Promise<CompanyRecord> => {
  const normalizedName = companyName.trim();

  if (!tenantId) throw new Error('An active workspace is required for company selection.');
  if (!normalizedName) {
    throw new Error('Company name is required');
  }

  if (companyId) {
    const existingCompany = await getCompanyById(companyId, tenantId);
    if (existingCompany) {
      return existingCompany;
    }
  }

  const { data: matchingCompany, error: matchingError } = await supabase
    .from('companies')
    .select('id, name, logo_url')
    .ilike('name', normalizedName)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle<CompanyRecord>();

  if (matchingError) {
    throw matchingError;
  }

  if (matchingCompany) {
    return matchingCompany;
  }

  const { data: createdCompany, error: createError } = await supabase
    .from('companies')
    .insert({ name: normalizedName, tenant_id: tenantId })
    .select('id, name, logo_url')
    .single<CompanyRecord>();

  if (createError) {
    throw createError;
  }

  return createdCompany;
};