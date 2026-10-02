import { supabase } from '@/lib/supabase';
import { ensureUniquePageSlug } from '@/services/pageService';
import type { PageBuilderData } from '@/types/pagebuilder';

export interface LegacyProductPageContext {
  product: PageBuilderData | null;
  name: string;
  pageId: string | null;
  schemaId: string | null;
  tenantId: string | null;
}

/**
 * Resolve an old numeric product reference to its linked page. Schema-bound
 * pages are redirected to the canonical schema route by PageBuilderPage.
 */
export async function getLegacyProductPageContext(legacyProductId: string): Promise<LegacyProductPageContext> {
  const { data: product, error: productError } = await supabase
    .from('mentorbooking_products')
    .select('product_page_id, name, tenant_id')
    .eq('id', legacyProductId)
    .single();

  if (productError) throw new Error(productError.message);
  if (!product) throw new Error('Product not found.');

  if (!product.product_page_id) {
    return {
      product: null,
      name: product.name,
      pageId: null,
      schemaId: null,
      tenantId: product.tenant_id ?? null,
    };
  }

  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('id, schema_id, tenant_id, content')
    .eq('id', product.product_page_id)
    .single();

  if (pageError) throw new Error(pageError.message);
  if (page.schema_id && (page.tenant_id ?? null) !== (product.tenant_id ?? null)) {
    throw new Error('Product and schema page must belong to the same workspace.');
  }

  return {
    product: page.content as PageBuilderData,
    name: product.name,
    pageId: page.id,
    schemaId: page.schema_id,
    tenantId: page.tenant_id ?? null,
  };
}

/** Legacy-only writer. Schema-bound pages must use their entity-aware writer. */
export async function saveLegacyProductPage(
  legacyProductId: string,
  content: PageBuilderData,
  productName: string,
): Promise<{ slug: string }> {
  const { data: product, error: productError } = await supabase
    .from('mentorbooking_products')
    .select('product_page_id')
    .eq('id', legacyProductId)
    .single();

  if (productError) throw new Error(productError.message);
  if (!product?.product_page_id) {
    throw new Error('This legacy product has no linked content page. Create schema-based products through Product schemas.');
  }

  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('schema_id')
    .eq('id', product.product_page_id)
    .single();
  if (pageError) throw new Error(pageError.message);
  if (page.schema_id) {
    throw new Error('Schema-bound content must be saved through the schema-driven PageBuilder.');
  }

  const slug = await ensureUniquePageSlug(productName, product.product_page_id);
  const { error } = await supabase
    .from('pages')
    .update({ content, slug, name: productName })
    .eq('id', product.product_page_id);
  if (error) throw new Error(error.message);
  return { slug };
}
