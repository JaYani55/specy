/**
 * Plugin claim predicate evaluation (Claim Management, specs/plans/CLAIM_MANAGEMENT.md).
 *
 * Pure functions — kept separate from loader.ts so build-time tests can import
 * them without pulling the generated plugin registry.
 *
 * Fail-closed doctrine: an omitted, failed or over-budget claim never matches
 * a predicate. RLS remains the enforcement plane; claims are metadata for
 * tooling decisions, never an RLS bypass.
 */

/**
 * Deep-subset match: every entry of `expected` must equal the corresponding
 * value in `actual` (objects compared recursively, primitives by value).
 */
export function claimValueMatches(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    return expected === actual;
  }
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((entry, index) => claimValueMatches(entry, actual[index]));
  }
  if (Array.isArray(actual)) return false;
  return Object.entries(expected as Record<string, unknown>).every(
    ([key, value]) => claimValueMatches(value, (actual as Record<string, unknown>)[key]),
  );
}

/**
 * Evaluates `access.claims` predicates against the namespaced plugin claim
 * (`claims.<plugin_id>`).
 *
 * Fail-closed: when no token claims are available (callers that do not pass
 * them) the predicate never matches — a plugin using `access.claims` stays
 * hidden until the calling context provides the token claims.
 */
export function pluginClaimMatches(
  pluginId: string,
  requiredClaims: Record<string, Record<string, unknown>>,
  tokenClaims?: Record<string, unknown> | null,
): boolean {
  if (!tokenClaims) return false;
  const pluginClaimObject = tokenClaims[pluginId];
  if (!pluginClaimObject || typeof pluginClaimObject !== 'object' || Array.isArray(pluginClaimObject)) {
    return false;
  }

  return Object.entries(requiredClaims).every(([claimKey, expected]) =>
    claimValueMatches(expected, (pluginClaimObject as Record<string, unknown>)[claimKey]),
  );
}
