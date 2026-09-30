export interface SchemaPathIdentity {
  id?: string;
  slug: string;
  api_slug?: string | null;
  tenant_id?: string | null;
  tenant_slug?: string | null;
}

/** Stable identifier used by the existing schema API routes. */
export const getSchemaApiSlug = (schema: SchemaPathIdentity): string => (
  schema.api_slug || schema.slug
);

/**
 * New tenant-owned schemas use /pages/schema/:tenantSlug/:localSlug.
 * System/global and legacy links retain their original one-segment URL.
 */
export const getSchemaConsolePath = (schema: SchemaPathIdentity): string => {
  const encode = (segment: string) => encodeURIComponent(segment);
  if (schema.tenant_id && schema.tenant_slug) {
    return `/pages/schema/${encode(schema.tenant_slug)}/${encode(schema.slug)}`;
  }
  return `/pages/schema/${encode(getSchemaApiSlug(schema))}`;
};
