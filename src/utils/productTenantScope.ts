export function normalizeProductTenantId(tenantId: string | null | undefined): string | null {
  return typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : null;
}

export function requireProductTenantId(tenantId: string | null | undefined): string {
  const normalized = normalizeProductTenantId(tenantId);
  if (!normalized) throw new Error('An active workspace is required for product operations.');
  return normalized;
}
