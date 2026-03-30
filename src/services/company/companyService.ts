import { supabase } from '@/lib/supabase';

export interface CompanyRecord {
  id: string;
  name: string;
  logo_url?: string | null;
}

export const getCompanyById = async (id: string): Promise<CompanyRecord | null> => {
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, logo_url')
    .eq('id', id)
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
}: {
  companyId?: string;
  companyName: string;
}): Promise<CompanyRecord> => {
  const normalizedName = companyName.trim();

  if (!normalizedName) {
    throw new Error('Company name is required');
  }

  if (companyId) {
    const existingCompany = await getCompanyById(companyId);
    if (existingCompany) {
      return existingCompany;
    }
  }

  const { data: matchingCompany, error: matchingError } = await supabase
    .from('companies')
    .select('id, name, logo_url')
    .ilike('name', normalizedName)
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
    .insert({ name: normalizedName })
    .select('id, name, logo_url')
    .single<CompanyRecord>();

  if (createError) {
    throw createError;
  }

  return createdCompany;
};