import type { PageSchema } from '@/types/pagebuilder';

export type SchemaEntityKindValue = NonNullable<PageSchema['entity_kind']> | 'page';

/**
 * Catalogue schemas hold both the product's canonical page and its event pages.
 * Pages are classified by their linked aggregate (product row vs event row),
 * not by the schema kind alone. 'service-product' is a legacy alias that the
 * catalogue unification migration converted to 'event'; it is still accepted
 * defensively so stale rows keep working.
 */
export const CATALOGUE_ENTITY_KIND = 'event' as const;
export const CATALOGUE_ENTITY_KINDS: readonly string[] = ['event', 'service-product'];

export const isCatalogueSchema = (kind: string | null | undefined): boolean =>
  kind === 'event' || kind === 'service-product';

/** Label for the unified schema purpose shown in the editor and lists. */
export const schemaPurposeLabel = (kind: string | null | undefined, language: string): string => {
  if (isCatalogueSchema(kind)) return language === 'en' ? 'Catalogue schema' : 'Katalogschema';
  return language === 'en' ? 'Page schema' : 'Seitenschema';
};
