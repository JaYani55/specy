export type PublicEntityKind = 'page' | 'service-product' | 'event';

export interface PublicPageRecord {
  id: string;
  slug: string;
  name: string;
  status: 'published';
  content: Record<string, unknown>;
  domain_url: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface PublicProductReference {
  id: string;
  page_id: string;
}

export type PublicIncludesResult =
  | { ok: true; includeEntity: boolean }
  | { ok: false; error: string };

export function parsePublicEntityIncludes(value: string | undefined, entityKind: PublicEntityKind): PublicIncludesResult {
  if (!value) return { ok: true, includeEntity: false };
  const includes = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (includes.length !== 1 || includes[0] !== 'entity') {
    return { ok: false, error: 'Supported include is entity only.' };
  }
  if (entityKind !== 'service-product') {
    return { ok: false, error: 'The entity include is available only for service-product schemas.' };
  }
  return { ok: true, includeEntity: true };
}

/** Add only the named, tenant-filtered public product reference; content stays untouched. */
export function projectPublicProductRelations(
  pages: PublicPageRecord[],
  products: PublicProductReference[],
): Array<PublicPageRecord & { relations: { entity: { kind: 'service-product'; id: string } } }> {
  const byPageId = new Map(products.map((product) => [product.page_id, product.id]));
  return pages.flatMap((page) => {
    const productId = byPageId.get(page.id);
    return productId
      ? [{ ...page, relations: { entity: { kind: 'service-product' as const, id: productId } } }]
      : [];
  });
}
