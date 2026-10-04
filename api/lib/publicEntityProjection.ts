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

export interface PublicEventReference {
  id: string;
  page_id: string;
  date: string;
  time: string;
  end_time: string | null;
  duration_minutes: number | null;
  mode: 'live' | 'online' | 'hybrid' | null;
  timezone: string | null;
  product_id: number | null;
}

export interface PublicEventProduct {
  legacy_id: number;
  id: string;
  name: string;
  page_slug: string;
  schema_api_slug: string;
}

export interface PublicIncludes {
  includeEntity: boolean;
  includeEvent: boolean;
  includeProduct: boolean;
}

export type PublicIncludesResult =
  | { ok: true; includes: PublicIncludes }
  | { ok: false; error: string };

export function applyDefaultPublicEventInclude(includes: PublicIncludes, includeQuery: string | undefined): PublicIncludes {
  return includeQuery === undefined || includeQuery.trim() === ''
    ? { ...includes, includeEvent: true }
    : includes;
}

export function parsePublicEntityIncludes(value: string | undefined, entityKind: PublicEntityKind): PublicIncludesResult {
  const includes = value
    ? value.split(',').map((part) => part.trim()).filter(Boolean)
    : [];
  if (new Set(includes).size !== includes.length) {
    return { ok: false, error: 'Include values must be unique.' };
  }

  const allowed = entityKind === 'service-product'
    ? new Set(['entity'])
    : entityKind === 'event'
      ? new Set(['entity', 'event', 'product'])
      : new Set<string>();
  const unsupported = includes.find((include) => !allowed.has(include));
  if (unsupported) {
    return { ok: false, error: entityKind === 'service-product'
      ? 'Supported include is entity only.'
      : entityKind === 'event'
        ? 'Supported event includes are entity, event and product.'
        : 'Includes are not supported for ordinary page schemas.' };
  }

  return {
    ok: true,
    includes: {
      includeEntity: includes.includes('entity'),
      includeEvent: includes.includes('event'),
      includeProduct: includes.includes('product'),
    },
  };
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

/** Project only approved occurrence fields and public product identities. */
export function projectPublicEventRelations(
  pages: PublicPageRecord[],
  events: PublicEventReference[],
  products: PublicEventProduct[],
  includes: PublicIncludes,
): Array<PublicPageRecord & { relations?: Record<string, unknown> }> {
  const eventByPageId = new Map(events.map((event) => [event.page_id, event]));
  const productByLegacyId = new Map(products.map((product) => [product.legacy_id, product]));

  return pages.flatMap((page) => {
    const event = eventByPageId.get(page.id);
    // A public event requires an explicit IANA timezone; malformed legacy rows
    // are withheld rather than delivered with ambiguous local time.
    if (!event || !event.timezone) return [];

    const relations: Record<string, unknown> = {};
    if (includes.includeEntity) relations.entity = { kind: 'event', id: event.id };
    if (includes.includeEvent) {
      relations.event = {
        date: event.date,
        time: event.time,
        end_time: event.end_time,
        duration_minutes: event.duration_minutes,
        mode: event.mode,
        timezone: event.timezone,
      };
    }
    if (includes.includeProduct && event.product_id !== null) {
      const product = productByLegacyId.get(event.product_id);
      if (product) {
        relations.product = { id: product.id, name: product.name, slug: product.page_slug, schema_api_slug: product.schema_api_slug };
      }
    }

    return [Object.keys(relations).length ? { ...page, relations } : page];
  });
}
