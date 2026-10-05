export interface ObjectVisibilityFlags {
  status?: string | null;
  api_enabled?: boolean | null;
  requires_auth?: boolean | null;
}

/** Matches the anonymous read contract enforced by GET /api/objects/:idOrSlug. */
export function isPublicObjectReadable(object: ObjectVisibilityFlags): boolean {
  return object.status === 'published' && object.api_enabled === true && object.requires_auth === false;
}
