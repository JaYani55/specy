import { supabase } from '@/lib/supabase';

export interface PageContentTemplate {
  id: string;
  schema_id: string;
  tenant_id: string | null;
  name: string;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function listPageContentTemplates(
  schemaId: string,
  tenantId: string | null,
): Promise<PageContentTemplate[]> {
  if (!schemaId) throw new Error('A schema is required to load page templates.');
  let query = supabase
    .from('page_content_templates')
    .select('id, schema_id, tenant_id, name, content, created_at, updated_at')
    .eq('schema_id', schemaId);
  query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PageContentTemplate[];
}

export async function savePageContentTemplate(input: {
  schemaId: string;
  tenantId: string | null;
  name: string;
  content: Record<string, unknown>;
}): Promise<PageContentTemplate> {
  const name = input.name.trim();
  if (!input.schemaId) throw new Error('A schema is required to save a page template.');
  if (!name || name.length > 120) throw new Error('Template name must be between 1 and 120 characters.');
  if (!isJsonObject(input.content)) throw new Error('Template content must be a JSON object.');
  if (new TextEncoder().encode(JSON.stringify(input.content)).byteLength > 1048576) {
    throw new Error('Template content exceeds the 1 MiB limit.');
  }

  const { data, error } = await supabase
    .from('page_content_templates')
    .insert({
      schema_id: input.schemaId,
      tenant_id: input.tenantId,
      name,
      content: input.content,
    })
    .select('id, schema_id, tenant_id, name, content, created_at, updated_at')
    .single();
  if (error?.code === '23505') {
    throw new Error('A page template with this name already exists for this schema.');
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Page template was not returned after saving.');
  return data as PageContentTemplate;
}
