/**
 * API-token (PAT) exchange — bridges self-service PATs onto Supabase Auth.
 *
 * A PAT never carries authorization itself. It is an alias for an existing
 * account: the exchange mints a *genuine* Supabase session for the same
 * user_id, so the custom access-token hook injects `user_roles` / `tenant_id`
 * and RLS behaves identically to a human login.
 *
 * Minting path: admin `generateLink` (magic link) → server-side verify against
 * GoTrue → session JSON. The refresh token never leaves the Worker; callers
 * receive only the short-lived access token (~1 h) and simply re-exchange.
 *
 * Contract: specs/auth/api-tokens.md
 */
import { createSupabaseAdminClient, resolveSecret, type Env } from './supabase';
import { hashApiToken, isApiToken } from './apiTokenCrypto';

export interface MintedSession {
  accessToken: string;
  expiresAt: number; // epoch ms
  userId: string;
}

interface ApiTokenRow {
  id: string;
  user_id: string;
  revoked_at: string | null;
  expires_at: string | null;
}

// Per-isolate cache of minted sessions, keyed by token hash. Access tokens
// live ~1 h; re-minting costs two admin round-trips, so we cache until shortly
// before expiry. Workers may evict isolates at any time — a cache miss simply
// re-mints, correctness never depends on the cache.
const MINTED_SESSION_CACHE_TTL_MARGIN_MS = 120_000;

const mintedSessionCache = new Map<string, { session: MintedSession; cachedUntil: number }>();

function decodeJwtExpiry(token: string): number {
  try {
    const [, payload] = token.split('.');
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + 3_600_000;
  } catch {
    return Date.now() + 3_600_000;
  }
}

export function isApiTokenValue(value: string | undefined | null): boolean {
  return isApiToken(value);
}

/**
 * Resolve a raw `spc_…` bearer value to an active api_tokens row.
 * Returns null when unknown, revoked, or expired.
 */
async function resolveActiveTokenRow(env: Env, tokenHash: string): Promise<ApiTokenRow | null> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('api_tokens')
    .select('id, user_id, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as ApiTokenRow;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

async function getAccountEmail(env: Env, userId: string): Promise<string | null> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

/**
 * Mint a real Supabase session for the account via the admin magic-link
 * generation + server-side verify flow. Requires the GoTrue /verify endpoint
 * to return a JSON session (standard for non-browser API clients).
 */
async function mintSupabaseSession(env: Env, userId: string): Promise<MintedSession> {
  const email = await getAccountEmail(env, userId);
  if (!email) {
    throw new Error('Token exchange failed: the linked account has no confirmed email address.');
  }

  const admin = await createSupabaseAdminClient(env);
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error('Token exchange failed: could not generate a session for the linked account.');
  }

  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const anonKey = await resolveSecret(env.SS_SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_PUBLISHABLE_KEY);
  const verifyResponse = await fetch(
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`,
    {
      headers: {
        apikey: anonKey,
        Accept: 'application/json',
      },
      redirect: 'manual',
    },
  );

  const contentType = verifyResponse.headers.get('content-type') ?? '';
  if (!verifyResponse.ok || !contentType.includes('application/json')) {
    throw new Error('Token exchange failed: the auth server did not return a JSON session for the verification request.');
  }

  const session = (await verifyResponse.json()) as { access_token?: unknown };
  if (typeof session.access_token !== 'string' || !session.access_token) {
    throw new Error('Token exchange failed: session payload missing access_token.');
  }

  return {
    accessToken: session.access_token,
    expiresAt: decodeJwtExpiry(session.access_token),
    userId,
  };
}

async function touchLastUsed(env: Env, tokenId: string): Promise<void> {
  try {
    const admin = await createSupabaseAdminClient(env);
    await admin
      .from('api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenId);
  } catch {
    // Best-effort attribution only — never fail the exchange over it.
  }
}

/**
 * Exchange a raw PAT for a cached/minted Supabase session.
 * Returns null when the token is unknown/revoked/expired.
 * Throws with a descriptive message on minting infrastructure failures.
 */
export async function exchangeApiTokenForSession(
  env: Env,
  rawToken: string,
): Promise<MintedSession | null> {
  if (!isApiToken(rawToken)) return null;

  const tokenHash = await hashApiToken(rawToken);

  const cached = mintedSessionCache.get(tokenHash);
  if (cached && cached.cachedUntil > Date.now()) {
    return cached.session;
  }

  const row = await resolveActiveTokenRow(env, tokenHash);
  if (!row) return null;

  const session = await mintSupabaseSession(env, row.user_id);
  void touchLastUsed(env, row.id);

  mintedSessionCache.set(tokenHash, {
    session,
    cachedUntil: Math.min(session.expiresAt - MINTED_SESSION_CACHE_TTL_MARGIN_MS, Date.now() + 3_600_000),
  });

  return session;
}
