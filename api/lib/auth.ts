import type { Context } from 'hono';
import { createSupabaseClient, type Env } from './supabase';

export type AppRole = 'user' | 'admin' | 'super-admin';

interface JwtPayload {
  sub?: unknown;
  user_roles?: unknown;
  is_agent?: unknown;
  tenant_id?: unknown;
  [key: string]: unknown;
}

export interface VerifiedAuthSession {
  token: string;
  roles: string[];
  userId: string | null;
  isAgent: boolean;
  tenantId: string | null;
  claims: JwtPayload;
}

const ROLE_ORDER: AppRole[] = ['user', 'admin', 'super-admin'];

export function parseBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

function normalizeRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function getRolesFromToken(token: string): string[] {
  const payload = decodeJwtPayload(token);
  return normalizeRoles(payload?.user_roles);
}

function normalizeUserId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hasRequiredRole(userRoles: string[], requiredRole: AppRole): boolean {
  const normalizedRoles = new Set<string>(userRoles.map((role) => role === 'staff' ? 'user' : role));
  const minimumRank = ROLE_ORDER.indexOf(requiredRole);

  return ROLE_ORDER.some((role, index) => index >= minimumRank && normalizedRoles.has(role));
}

function hasAnyJwtRole(userRoles: string[], requiredRoles: string[]): boolean {
  const normalizedRoles = new Set<string>(userRoles.map((role) => role === 'staff' ? 'user' : role));
  return requiredRoles.some((role) => normalizedRoles.has(role));
}

export async function verifyAuthSession(env: Env, token: string): Promise<VerifiedAuthSession | null> {
  const supabase = await createSupabaseClient(env, token);
  const { data, error } = await supabase.auth.getClaims(token);

  if (error || !data) {
    return null;
  }

  const claims = data.claims as JwtPayload;
  const roles = normalizeRoles(claims.user_roles);

  return {
    token,
    roles,
    userId: normalizeUserId(claims.sub),
    // is_agent is injected by custom_access_token_hook; fall back to the role
    // list so legacy tokens minted before the OAuth claims migration still work.
    isAgent: claims.is_agent === true || roles.includes('agent'),
    tenantId: normalizeUserId(claims.tenant_id),
    claims,
  };
}

/**
 * Build a 401 response carrying an RFC 9728 WWW-Authenticate challenge so MCP
 * clients can discover the OAuth 2.1 authorization server and start the
 * Authorization Code + PKCE flow.
 */
export function unauthorizedWithChallenge(
  c: Context<{ Bindings: Env }>,
  message: string,
): Response {
  const baseUrl = new URL(c.req.url).origin;
  const resourceMetadata = `${baseUrl}/.well-known/oauth-protected-resource`;
  return c.json({ error: message }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}"`,
  });
}

export async function requireAppRole(
  c: Context<{ Bindings: Env }>,
  requiredRole: AppRole,
): Promise<VerifiedAuthSession | Response> {
  const token = parseBearerToken(c.req.header('Authorization'));
  if (!token) {
    return unauthorizedWithChallenge(c, 'Authentication required.');
  }

  const auth = await verifyAuthSession(c.env, token);

  if (!auth) {
    return unauthorizedWithChallenge(c, 'Invalid or expired session.');
  }

  if (!hasRequiredRole(auth.roles, requiredRole)) {
    return c.json({ error: 'Insufficient permissions.' }, 403);
  }

  return auth;
}

export async function requireAnyJwtRole(
  c: Context<{ Bindings: Env }>,
  requiredRoles: string[],
): Promise<VerifiedAuthSession | Response> {
  const token = parseBearerToken(c.req.header('Authorization'));
  if (!token) {
    return unauthorizedWithChallenge(c, 'Authentication required.');
  }

  const auth = await verifyAuthSession(c.env, token);

  if (!auth) {
    return unauthorizedWithChallenge(c, 'Invalid or expired session.');
  }

  if (!hasAnyJwtRole(auth.roles, requiredRoles)) {
    return c.json({ error: 'Insufficient permissions.' }, 403);
  }

  return auth;
}

export async function requireAuthSession(
  c: Context<{ Bindings: Env }>,
): Promise<VerifiedAuthSession | Response> {
  const token = parseBearerToken(c.req.header('Authorization'));
  if (!token) {
    return unauthorizedWithChallenge(c, 'Authentication required.');
  }

  const auth = await verifyAuthSession(c.env, token);

  if (!auth) {
    return unauthorizedWithChallenge(c, 'Invalid or expired session.');
  }

  return auth;
}

export async function getOptionalAuthSession(
  c: Context<{ Bindings: Env }>,
): Promise<VerifiedAuthSession | null | Response> {
  const token = parseBearerToken(c.req.header('Authorization'));
  if (!token) {
    return null;
  }

  const auth = await verifyAuthSession(c.env, token);

  if (!auth) {
    return unauthorizedWithChallenge(c, 'Invalid or expired session.');
  }

  return auth;
}