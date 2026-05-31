const encodePathSegment = (value: string) => encodeURIComponent(value.trim());

export const buildFormSharePath = (tenantSlug: string, shareSlug: string) => (
  `/forms/share/${encodePathSegment(tenantSlug)}/${encodePathSegment(shareSlug)}`
);

export const buildObjectSharePath = (tenantSlug: string, shareSlug: string) => (
  `/objects/share/${encodePathSegment(tenantSlug)}/${encodePathSegment(shareSlug)}`
);