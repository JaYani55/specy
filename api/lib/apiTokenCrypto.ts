/**
 * Pure API-token (PAT) primitives — no I/O, no imports.
 *
 * Format: `spc_<43-char base64url>` (32 random bytes).
 * Tokens are stored as SHA-256 hex hashes; the raw value is shown to the
 * caller exactly once at creation. See specs/auth/api-tokens.md for the
 * full contract.
 */

export const API_TOKEN_PREFIX = 'spc_';
export const MAX_ACTIVE_TOKENS_PER_USER = 10;

export interface GeneratedApiToken {
  /** Raw token — returned to the caller exactly once, never persisted. */
  raw: string;
  /** SHA-256 hex digest of the raw token — the only persisted form. */
  tokenHash: string;
  /** Short display prefix (e.g. `spc_a1b2c3d4`) for identification in lists. */
  displayPrefix: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateApiToken(): GeneratedApiToken {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = toBase64Url(bytes);
  const raw = `${API_TOKEN_PREFIX}${body}`;
  return {
    raw,
    tokenHash: '', // filled by hashApiToken (async) — kept out of the sync path
    displayPrefix: `${API_TOKEN_PREFIX}${body.slice(0, 8)}`,
  };
}

export async function hashApiToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** True when the bearer value has the API-token shape (not a Supabase JWT). */
export function isApiToken(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(API_TOKEN_PREFIX) && value.length > API_TOKEN_PREFIX.length + 8;
}

/**
 * Extract a raw API token from an Authorization header value.
 * Returns null when the header is absent, not a Bearer value, or not an API token.
 */
export function parseApiTokenValue(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  const value = match?.[1];
  if (value === undefined) return null;
  return isApiToken(value) ? value : null;
}

/**
 * Validate a user-supplied create payload. Returns an error message or null.
 * Expiry is optional — an absent/empty value means "never expires".
 */
export function validateTokenCreateInput(name: unknown, expiresAt: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
    return 'Token name must be between 1 and 100 characters.';
  }
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') return 'expires_at must be an ISO 8601 timestamp.';
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) return 'expires_at must be a valid ISO 8601 timestamp.';
    if (parsed.getTime() <= Date.now()) return 'expires_at must be in the future.';
  }
  return null;
}
