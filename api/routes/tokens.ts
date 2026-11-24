import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { requireAuthSession, unauthorizedWithChallenge } from '../lib/auth';
import {
  MAX_ACTIVE_TOKENS_PER_USER,
  generateApiToken,
  hashApiToken,
  parseApiTokenValue,
  validateTokenCreateInput,
} from '../lib/apiTokenCrypto';

const tokens = new Hono<{ Bindings: Env }>();

interface ApiTokenRecord {
  id: string;
  user_id: string;
  tenant_id: string | null;
  name: string;
  prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const TOKEN_PROJECTION = 'id, user_id, tenant_id, name, prefix, expires_at, last_used_at, revoked_at, created_at';

function serializeRecord(row: ApiTokenRecord) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

// POST /api/tokens — create a PAT for the caller's own account.
// Super-admin accounts may not hold PATs; PAT-authenticated sessions may not
// mint further PATs (no token chaining).
tokens.post('/', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;

  if (auth.roles.includes('super-admin')) {
    return c.json({ error: 'API tokens cannot be created for super-admin accounts.' }, 403);
  }
  if (auth.viaApiToken) {
    return c.json({ error: 'API tokens cannot be created while authenticated with an API token.' }, 403);
  }
  if (!auth.userId) {
    return c.json({ error: 'Authenticated session has no user identity.' }, 401);
  }

  const body = await c.req.json<{ name?: unknown; expires_at?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

  const validationError = validateTokenCreateInput(body.name, body.expires_at);
  if (validationError) return c.json({ error: validationError }, 400);

  const supabase = await createSupabaseClient(c.env, auth.token);

  const { count: activeCount, error: countError } = await supabase
    .from('api_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .is('revoked_at', null);

  if (countError) {
    return c.json({ error: 'Failed to check existing tokens.' }, 500);
  }
  if ((activeCount ?? 0) >= MAX_ACTIVE_TOKENS_PER_USER) {
    return c.json(
      { error: `Active token limit reached (max ${MAX_ACTIVE_TOKENS_PER_USER}). Revoke a token first.` },
      400,
    );
  }

  const generated = generateApiToken();
  const tokenHash = await hashApiToken(generated.raw);

  const { data, error } = await supabase
    .from('api_tokens')
    .insert({
      user_id: auth.userId,
      tenant_id: auth.tenantId,
      name: String(body.name).trim(),
      token_hash: tokenHash,
      prefix: generated.displayPrefix,
      expires_at: body.expires_at ? new Date(String(body.expires_at)).toISOString() : null,
    })
    .select(TOKEN_PROJECTION)
    .single();

  if (error || !data) {
    return c.json({ error: 'Failed to create API token.' }, 500);
  }

  // The raw token is returned exactly once and never persisted.
  return c.json({ token: generated.raw, token_record: serializeRecord(data as ApiTokenRecord) }, 201);
});

// GET /api/tokens — list the caller's own tokens (metadata only, never secrets).
tokens.get('/', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  if (!auth.userId) return c.json({ error: 'Authenticated session has no user identity.' }, 401);

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('api_tokens')
    .select(TOKEN_PROJECTION)
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    return c.json({ error: 'Failed to load API tokens.' }, 500);
  }

  return c.json({ tokens: (data ?? []).map((row) => serializeRecord(row as ApiTokenRecord)) });
});

// DELETE /api/tokens/:id — revoke the caller's own token (soft revoke, auditable).
tokens.delete('/:id', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  if (!auth.userId) return c.json({ error: 'Authenticated session has no user identity.' }, 401);

  const id = c.req.param('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: 'Invalid token id.' }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    return c.json({ error: 'Failed to revoke API token.' }, 500);
  }
  if (!data) {
    return c.json({ error: 'Token not found or already revoked.' }, 404);
  }

  return c.json({ success: true });
});

// POST /api/tokens/session — explicit exchange: PAT in, short-lived access
// token out. The refresh token never leaves the Worker; callers re-exchange
// per run (or rely on transparent exchange on any Bearer-authenticated route).
tokens.post('/session', async (c) => {
  const rawToken = parseApiTokenValue(c.req.header('Authorization'));
  if (!rawToken) {
    return unauthorizedWithChallenge(c, 'Provide an API token as `Authorization: Bearer spc_…`.');
  }

  const auth = await requireAuthSession(c);
  if (auth instanceof Response) {
    return c.json({ error: 'Unknown, revoked or expired API token.' }, 401);
  }

  const expClaim = auth.claims.exp;
  const expiresAt = typeof expClaim === 'number' ? expClaim * 1000 : Date.now() + 3_600_000;

  return c.json({
    token_type: 'Bearer',
    access_token: auth.token,
    expires_at: new Date(expiresAt).toISOString(),
  });
});

export default tokens;
