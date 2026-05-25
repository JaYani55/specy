import type { Context } from 'hono';
import { createSupabaseClient, type Env } from './supabase';

export type AppRole = 'user' | 'admin' | 'super-admin';

interface JwtPayload {
  sub?: unknown;
  user_roles?: unknown;
  [key: string]: unknown;
}

export interface VerifiedAuthSession {
  token: string;
  roles: string[];
  userId: string | null;
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

export async function verifyAuthSession(env: Env, token: string): Promise<VerifiedAuthSession | null> {
  const supabase = await createSupabaseClient(env, token);
  const { data, error } = await supabase.auth.getClaims(token);

  if (error || !data) {
    return null;
  }

  return {
    token,
    roles: normalizeRoles(data.claims.user_roles),
    userId: normalizeUserId(data.claims.sub),
    claims: data.claims as JwtPayload,
  };
}

export async function requireAppRole(
  c: Context<{ Bindings: Env }>,
  requiredRole: AppRole,
): Promise<VerifiedAuthSession | Response> {
  const token = parseBearerToken(c.req.header('Authorization'));
  if (!token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const auth = await verifyAuthSession(c.env, token);

  if (!auth) {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  if (!hasRequiredRole(auth.roles, requiredRole)) {
    return c.json({ error: 'Insufficient permissions.' }, 403);
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
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  return auth;
}