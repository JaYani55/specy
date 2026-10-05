export type SchemaEntityKindValue = 'page' | 'service-product' | 'event';

/**
 * Catalogue schemas hold both the product's canonical page and its event pages.
 * Pages are classified by their linked aggregate (product row vs event row),
 * not by the schema kind alone. 'service-product' remains a legacy alias that
 * the catalogue unification migration converted to 'event'; it is still
 * accepted defensively so stale rows keep working.
 */
export const CATALOGUE_ENTITY_KIND: SchemaEntityKindValue = 'event';
export const CATALOGUE_ENTITY_KINDS: readonly SchemaEntityKindValue[] = ['event', 'service-product'];

export const isCatalogueEntityKind = (kind: string | null | undefined): boolean =>
  kind === 'event' || kind === 'service-product';
