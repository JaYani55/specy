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

type SecretEnvKey =
  | 'SUPABASE_URL'
  | 'SUPABASE_PUBLISHABLE_KEY'
  | 'SUPABASE_SECRET_KEY'
  | 'STORAGE_PROVIDER'
  | 'STORAGE_BUCKET'
  | 'R2_PUBLIC_URL'
  | 'CF_API_TOKEN';

type SecretStoreBindingKey =
  | 'SS_SUPABASE_URL'
  | 'SS_SUPABASE_PUBLISHABLE_KEY'
  | 'SS_SUPABASE_SECRET_KEY'
  | 'SS_STORAGE_PROVIDER'
  | 'SS_STORAGE_BUCKET'
  | 'SS_R2_PUBLIC_URL';

function getCloudflareErrorMessage<T>(json: CloudflareApiResponse<T>, fallback = 'CF API error') {
  return json.errors?.[0]?.message ?? fallback;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
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

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/secrets
 * List all secrets in the Secrets Store (names + metadata only — values never returned).
 */
secrets.get('/', async (c) => {
  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const url = `${CF_API_BASE}/accounts/${c.env.CF_ACCOUNT_ID}/secrets_store/stores/${c.env.SECRETS_STORE_ID}/secrets`;

  const res = await fetch(url, { headers: cfHeaders(c.env.CF_API_TOKEN!) });
  const json = await res.json() as CloudflareApiResponse<CloudflareSecret[]>;

  if (!res.ok) {
    return c.json({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ secrets: json.result ?? [] });
});

/**
 * GET /api/secrets/env-status
 * Returns which known secrets/env-vars have a non-empty value bound in this Worker.
 * Checks both plain env vars (wrangler.jsonc vars) and Secrets Store bindings.
 * Values are NEVER returned — only boolean presence.
 */
const KNOWN_KEYS: Array<{ name: SecretEnvKey; envKey: SecretEnvKey; ssKey?: SecretStoreBindingKey }> = [
  { name: 'SUPABASE_URL',            envKey: 'SUPABASE_URL',            ssKey: 'SS_SUPABASE_URL' },
  { name: 'SUPABASE_PUBLISHABLE_KEY', envKey: 'SUPABASE_PUBLISHABLE_KEY', ssKey: 'SS_SUPABASE_PUBLISHABLE_KEY' },
  { name: 'SUPABASE_SECRET_KEY',      envKey: 'SUPABASE_URL',            ssKey: 'SS_SUPABASE_SECRET_KEY' }, // no plain fallback by design
  { name: 'STORAGE_PROVIDER',        envKey: 'STORAGE_PROVIDER',  ssKey: 'SS_STORAGE_PROVIDER' },
  { name: 'STORAGE_BUCKET',          envKey: 'STORAGE_BUCKET',    ssKey: 'SS_STORAGE_BUCKET' },
  { name: 'R2_PUBLIC_URL',           envKey: 'R2_PUBLIC_URL',     ssKey: 'SS_R2_PUBLIC_URL' },
  { name: 'CF_API_TOKEN',            envKey: 'CF_API_TOKEN' },
];

secrets.get('/env-status', (c) => {
  const env = c.env;
  const status: Array<{ name: string; hasValue: boolean; source: 'secrets-store' | 'env-var' | 'unset' }> = KNOWN_KEYS.map(({ name, envKey, ssKey }) => {
    const fromSS = ssKey ? !!env[ssKey] : false;
    // For SUPABASE_SECRET_KEY there is intentionally no plain env fallback
    const fromEnv = name !== 'SUPABASE_SECRET_KEY' ? !!env[envKey] : false;
    return {
      name,
      hasValue: fromSS || fromEnv,
      source: fromSS ? 'secrets-store' : fromEnv ? 'env-var' : 'unset',
    };
  });
  return c.json({ status });
});

/**
 * GET /api/secrets/stores
 * List all Secrets Stores in the account. Useful for discovering the store ID.
 */
secrets.get('/stores', async (c) => {
  const token = c.env.CF_API_TOKEN;
  const accountId = c.env.CF_ACCOUNT_ID;

  if (!token) return c.json({ error: 'CF_API_TOKEN is not set' }, 503);
  if (!accountId || accountId === '<YOUR_CLOUDFLARE_ACCOUNT_ID>')
    return c.json({ error: 'CF_ACCOUNT_ID is not configured' }, 503);

  const url = `${CF_API_BASE}/accounts/${accountId}/secrets_store/stores`;
  const res = await fetch(url, { headers: cfHeaders(token) });
  const json = await res.json() as CloudflareApiResponse<Array<{ id: string; name: string; created_at?: string }>>;

  if (!res.ok) {
    return c.json({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ stores: json.result ?? [] });
});

/**
 * PUT /api/secrets/:name
 * Create or update a secret by name.
 * Body: { value: string, comment?: string }
 */
secrets.post('/:name', async (c) => {
  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const secretName = c.req.param('name');
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
    // Update by ID
    res = await fetch(`${storeBase}/${existing.id}`, {
      method: 'PUT',
      headers: cfHeaders(c.env.CF_API_TOKEN!),
      body: JSON.stringify({
        value: body.value,
        comment: body.comment || '',
      }),
    });
  } else {
    // Create new
    res = await fetch(storeBase, {
      method: 'POST',
      headers: cfHeaders(c.env.CF_API_TOKEN!),
      body: JSON.stringify({
        name: secretName,
        value: body.value,
        scopes: ['workers'],
        comment: body.comment || '',
      }),
    });
  }

  const json = await res.json() as CloudflareApiResponse<CloudflareSecret>;

  if (!res.ok) {
    return c.json({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
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
  const configErr = missingConfig(c.env);
  if (configErr) return c.json({ error: configErr }, 503);

  const secretName = c.req.param('name');
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
    return c.json({ error: getCloudflareErrorMessage(json), cf: json }, res.status);
  }

  return c.json({ success: true, deleted: secretName });
});

export default secrets;
