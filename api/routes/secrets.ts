/**
 * /api/secrets — Cloudflare Secrets Store management proxy
 *
 * These routes allow the /verwaltung/connections CMS UI to CRUD secrets
 * in your Cloudflare account's Secrets Store without exposing CF credentials
 * to the browser.
 *
 * Required Worker config (wrangler.jsonc):
 *   vars.CF_ACCOUNT_ID    — your Cloudflare account UUID
 *   vars.SECRETS_STORE_ID — your Secrets Store UUID
 *
 * Required Worker secret (set once via CLI):
 *   CF_API_TOKEN          — CF token with Account:Secrets Store:Edit
 *   npx wrangler secret put CF_API_TOKEN
 */

import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import type { Env } from '../lib/supabase';

const secrets = new Hono<{ Bindings: Env }>();

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

interface CloudflareErrorItem {
  message?: string;
}

interface CloudflareSecret {
  id: string;
  name: string;
  comment?: string;
  created_at?: string;
  updated_at?: string;
}

interface CloudflareApiResponse<T> {
  result?: T;
  errors?: CloudflareErrorItem[];
}

type SecretStatusName =
  | 'SUPABASE_SECRET_KEY'
  | 'CF_API_TOKEN'
  | 'SECRETS_ENCRYPTION_KEY';

type SecretEnvKey =
  | 'CF_API_TOKEN'
  | 'SECRETS_ENCRYPTION_KEY';

type SecretStoreBindingKey =
  | 'SS_SUPABASE_SECRET_KEY';

const SECRET_NAME_PATTERN = /^[A-Z0-9_]+$/;
const RESERVED_MANAGED_PREFIXES = ['REVALIDATION_'];

function getCloudflareErrorMessage<T>(json: CloudflareApiResponse<T>, fallback = 'CF API error') {
  return json.errors?.[0]?.message ?? fallback;
}

function jsonError(body: unknown, status: number) {
  return Response.json(body, { status });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

function missingConfig(env: Env) {
  if (!env.CF_API_TOKEN) return 'CF_API_TOKEN is not set. Run: npx wrangler secret put CF_API_TOKEN';
  if (!env.CF_ACCOUNT_ID || env.CF_ACCOUNT_ID === '<YOUR_CLOUDFLARE_ACCOUNT_ID>')
    return 'CF_ACCOUNT_ID is not configured in wrangler.jsonc vars';
  if (!env.SECRETS_STORE_ID || env.SECRETS_STORE_ID === '<YOUR_SECRETS_STORE_ID>')
    return 'SECRETS_STORE_ID is not configured in wrangler.jsonc vars';
  return null;
}

function validateSecretName(secretName: string): string | null {
  if (!SECRET_NAME_PATTERN.test(secretName)) {
    return 'Secret name must contain only uppercase letters, numbers, and underscores';
  }

  if (RESERVED_MANAGED_PREFIXES.some((prefix) => secretName.startsWith(prefix))) {
    return `Secret names starting with ${RESERVED_MANAGED_PREFIXES.join(', ')} are reserved for the managed secret system`;
  }

  return null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/secrets
 * List all secrets in the Secrets Store (names + metadata only — values never returned).
 */
secrets.get('/', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const url = `${CF_API_BASE}/accounts/${c.env.CF_ACCOUNT_ID}/secrets_store/stores/${c.env.SECRETS_STORE_ID}/secrets`;

  const res = await fetch(url, { headers: cfHeaders(c.env.CF_API_TOKEN!) });
  const json = await res.json() as CloudflareApiResponse<CloudflareSecret[]>;

  if (!res.ok) {
    return jsonError({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ secrets: json.result ?? [] });
});

/**
 * GET /api/secrets/env-status
 * Returns which sensitive runtime secrets have a non-empty value bound in this Worker.
 * Checks both Worker secrets and Secrets Store bindings.
 * Values are NEVER returned — only boolean presence.
 */
const KNOWN_KEYS: Array<{ name: SecretStatusName; envKey?: SecretEnvKey; ssKey?: SecretStoreBindingKey }> = [
  { name: 'SUPABASE_SECRET_KEY',                                      ssKey: 'SS_SUPABASE_SECRET_KEY' },
  { name: 'CF_API_TOKEN',            envKey: 'CF_API_TOKEN' },
  { name: 'SECRETS_ENCRYPTION_KEY',  envKey: 'SECRETS_ENCRYPTION_KEY' },
];

secrets.get('/env-status', (c) => {
  const authPromise = requireAppRole(c, 'super-admin');
  return authPromise.then((auth) => {
    if (auth instanceof Response) return auth;

    const env = c.env;
    const status: Array<{ name: string; hasValue: boolean; source: 'secrets-store' | 'env-var' | 'unset' }> = KNOWN_KEYS.map(({ name, envKey, ssKey }) => {
      const fromSS = ssKey ? !!env[ssKey] : false;
      // For SUPABASE_SECRET_KEY there is intentionally no plain env fallback
      const fromEnv = envKey ? !!env[envKey] : false;
      return {
        name,
        hasValue: fromSS || fromEnv,
        source: fromSS ? 'secrets-store' : fromEnv ? 'env-var' : 'unset',
      };
    });
    return c.json({ status });
  });
});

/**
 * GET /api/secrets/stores
 * List all Secrets Stores in the account. Useful for discovering the store ID.
 */
secrets.get('/stores', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const token = c.env.CF_API_TOKEN;
  const accountId = c.env.CF_ACCOUNT_ID;

  if (!token) return c.json({ error: 'CF_API_TOKEN is not set' }, 503);
  if (!accountId || accountId === '<YOUR_CLOUDFLARE_ACCOUNT_ID>')
    return c.json({ error: 'CF_ACCOUNT_ID is not configured' }, 503);

  const url = `${CF_API_BASE}/accounts/${accountId}/secrets_store/stores`;
  const res = await fetch(url, { headers: cfHeaders(token) });
  const json = await res.json() as CloudflareApiResponse<Array<{ id: string; name: string; created_at?: string }>>;

  if (!res.ok) {
    return jsonError({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ stores: json.result ?? [] });
});

/**
 * PUT /api/secrets/:name
 * Create or update a secret by name.
 * Body: { value: string, comment?: string }
 */
secrets.post('/:name', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const secretName = c.req.param('name');
  const secretNameError = validateSecretName(secretName);
  if (secretNameError) {
    return c.json({ error: secretNameError }, 400);
  }

  let body: { value: string; comment?: string };
  try {
    // Explicitly read as text and parse to see if it's really valid
    const raw = await c.req.text();
    if (!raw) {
      return c.json({ error: 'Empty request body' }, 400);
    }
    body = JSON.parse(raw);
  } catch (e) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body || !body.value) {
    return c.json({ error: 'Request body must include { value: string }' }, 400);
  }

  const storeBase = `${CF_API_BASE}/accounts/${c.env.CF_ACCOUNT_ID}/secrets_store/stores/${c.env.SECRETS_STORE_ID}/secrets`;

  // First: check if the secret already exists (to decide create vs update)
  const listRes = await fetch(storeBase, { headers: cfHeaders(c.env.CF_API_TOKEN!) });
  const listJson = await listRes.json() as CloudflareApiResponse<CloudflareSecret[]>;
  const existing = (listJson.result ?? []).find((secret) => secret.name === secretName);

  let res: Response;

  if (existing) {
    // Cloudflare Secrets Store updates use PATCH with a single object body.
    res = await fetch(`${storeBase}/${existing.id}`, {
      method: 'PATCH',
      headers: cfHeaders(c.env.CF_API_TOKEN!),
      body: JSON.stringify({
        value: body.value,
        comment: body.comment || '',
      }),
    });
  } else {
    // Cloudflare Secrets Store creation expects an array payload.
    res = await fetch(storeBase, {
      method: 'POST',
      headers: cfHeaders(c.env.CF_API_TOKEN!),
      body: JSON.stringify([
        {
          name: secretName,
          value: body.value,
          scopes: ['workers'],
          comment: body.comment || '',
        },
      ]),
    });
  }

  const json = await res.json() as CloudflareApiResponse<CloudflareSecret>;

  if (!res.ok) {
    return jsonError({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({
    success: true,
    action: existing ? 'updated' : 'created',
    secret: { name: secretName, id: json.result?.id },
  });
});

/**
 * DELETE /api/secrets/:name
 * Delete a secret by name.
 */
secrets.delete('/:name', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const secretName = c.req.param('name');
  const secretNameError = validateSecretName(secretName);
  if (secretNameError) {
    return c.json({ error: secretNameError }, 400);
  }

  const storeBase = `${CF_API_BASE}/accounts/${c.env.CF_ACCOUNT_ID}/secrets_store/stores/${c.env.SECRETS_STORE_ID}/secrets`;

  // Look up the secret ID first
  const listRes = await fetch(storeBase, { headers: cfHeaders(c.env.CF_API_TOKEN!) });
  const listJson = await listRes.json() as CloudflareApiResponse<CloudflareSecret[]>;
  const existing = (listJson.result ?? []).find((secret) => secret.name === secretName);

  if (!existing) {
    return c.json({ error: `Secret "${secretName}" not found in store` }, 404);
  }

  const res = await fetch(`${storeBase}/${existing.id}`, {
    method: 'DELETE',
    headers: cfHeaders(c.env.CF_API_TOKEN!),
  });

  if (!res.ok) {
    const json = await res.json() as CloudflareApiResponse<unknown>;
    return jsonError({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ success: true, deleted: secretName });
});

export default secrets;
