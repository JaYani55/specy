import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import type { Env } from '../lib/supabase';
import { buildMailSecretName, buildS3SecretName, getMailSecretNamespace, getManagedSecretMetadata, getS3SourceSecretNamespace, upsertManagedSecret } from '../lib/managedSecrets';
import { invalidateLoggingConfigCache } from '../middleware/agentLogger';
import { createSupabaseAdminClient } from '../lib/supabase';
import { getBrandingConfig, getExtraMediaSources, getLoggingConfig, getMailConfig, getMediaSourceMounts, getStorageConfig, upsertBrandingConfig, upsertExtraMediaSources, upsertLoggingConfig, upsertMailConfig, upsertMediaSourceMounts, upsertStorageConfig, type ExtraMediaSource, type MediaSourceMount } from '../lib/systemConfig';

const config = new Hono<{ Bindings: Env }>();

interface MailConfigPayload {
  provider: 'smtp' | 'resend' | '';
  fromName: string;
  fromEmail: string;
  replyToEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  resendApiKey?: string;
}

interface LoggingConfigPayload {
  mode?: 'all' | 'custom';
  enabledEndpointKeys?: unknown;
}

interface BrandingConfigPayload {
  logoMode?: 'default' | 'custom';
  customLogoUrl?: string;
  logoScale?: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

async function parseUpstreamFunctionBody(response: Response): Promise<string | null> {
  const bodyText = await response.text().catch(() => '');
  if (!bodyText) return null;

  try {
    const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
    return parsed.error || parsed.message || bodyText;
  } catch {
    return bodyText;
  }
}

async function getFunctionInvokeErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') {
    return String(error ?? 'Unknown function invocation error');
  }

  const maybeError = error as { message?: string; context?: unknown };
  const maybeResponse = maybeError.context;

  if (
    maybeResponse
    && typeof maybeResponse === 'object'
    && 'text' in maybeResponse
    && typeof (maybeResponse as Response).text === 'function'
  ) {
    const response = maybeResponse as Response;
    const upstreamMessage = await parseUpstreamFunctionBody(response);
    if (upstreamMessage) {
      return `Edge Function HTTP ${response.status}: ${upstreamMessage}`;
    }
    return `Edge Function HTTP ${response.status}`;
  }

  return maybeError.message || 'Unknown function invocation error';
}

function normalizeMailPayload(input: MailConfigPayload) {
  return {
    provider: input.provider,
    fromName: input.fromName.trim(),
    fromEmail: input.fromEmail.trim(),
    replyToEmail: input.replyToEmail?.trim() ?? '',
    smtpHost: input.smtpHost?.trim() ?? '',
    smtpPort: Number.isFinite(input.smtpPort) ? Number(input.smtpPort) : 587,
    smtpSecure: Boolean(input.smtpSecure),
    smtpUsername: input.smtpUsername?.trim() ?? '',
    smtpPassword: input.smtpPassword?.trim() ?? '',
    resendApiKey: input.resendApiKey?.trim() ?? '',
  };
}

async function getMailSecretStatus(env: Env) {
  const [smtpPassword, resendApiKey] = await Promise.all([
    getManagedSecretMetadata(env, buildMailSecretName('smtp-password')),
    getManagedSecretMetadata(env, buildMailSecretName('resend-api-key')),
  ]);

  return {
    smtpPasswordConfigured: smtpPassword !== null,
    resendApiKeyConfigured: resendApiKey !== null,
  };
}

config.get('/storage', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const storage = await getStorageConfig(c.env);
  return c.json({ storage });
});

config.get('/branding', async (c) => {
  const branding = await getBrandingConfig(c.env);
  return c.json({ branding });
});

config.put('/branding', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: BrandingConfigPayload;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  await upsertBrandingConfig(c.env, {
    logoMode: body.logoMode === 'custom' ? 'custom' : 'default',
    customLogoUrl: body.customLogoUrl?.trim() ?? '',
    logoScale: Number.isFinite(body.logoScale)
      ? Math.min(180, Math.max(50, Math.round(Number(body.logoScale))))
      : 100,
  });

  const branding = await getBrandingConfig(c.env);

  return c.json({
    success: true,
    branding,
  });
});

config.put('/storage', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: { provider: 'supabase' | 'r2' | ''; bucket: string; r2PublicUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.provider || !body.bucket?.trim()) {
    return c.json({ error: 'Missing required fields: provider, bucket' }, 400);
  }

  if (body.provider !== 'supabase' && body.provider !== 'r2') {
    return c.json({ error: 'Provider must be "supabase" or "r2"' }, 400);
  }

  await upsertStorageConfig(c.env, {
    provider: body.provider,
    bucket: body.bucket.trim(),
    r2PublicUrl: body.r2PublicUrl?.trim() ?? '',
  });

  return c.json({ success: true });
});

config.get('/mail', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const [mail, secrets] = await Promise.all([
    getMailConfig(c.env),
    getMailSecretStatus(c.env),
  ]);

  return c.json({ mail, secrets });
});

config.get('/logging', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const logging = await getLoggingConfig(c.env);
  return c.json({ logging });
});

config.put('/logging', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: LoggingConfigPayload;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const mode = body.mode === 'custom' ? 'custom' : 'all';
  const enabledEndpointKeys = Array.isArray(body.enabledEndpointKeys)
    ? body.enabledEndpointKeys.filter((entry): entry is string => typeof entry === 'string')
    : [];

  await upsertLoggingConfig(c.env, {
    mode,
    enabledEndpointKeys,
  });
  invalidateLoggingConfigCache();

  return c.json({
    success: true,
    logging: {
      mode,
      enabledEndpointKeys,
    },
  });
});

config.put('/mail', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: MailConfigPayload;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const input = normalizeMailPayload(body);

  if (input.provider !== 'smtp' && input.provider !== 'resend') {
    return c.json({ error: 'Provider must be "smtp" or "resend".' }, 400);
  }

  if (!input.fromEmail || !isValidEmail(input.fromEmail)) {
    return c.json({ error: 'A valid fromEmail is required.' }, 400);
  }

  if (input.replyToEmail && !isValidEmail(input.replyToEmail)) {
    return c.json({ error: 'replyToEmail must be a valid e-mail address.' }, 400);
  }

  if (input.provider === 'smtp') {
    if (!input.smtpHost || !input.smtpUsername || !Number.isInteger(input.smtpPort) || input.smtpPort <= 0) {
      return c.json({ error: 'SMTP provider requires smtpHost, smtpPort, and smtpUsername.' }, 400);
    }
  }

  await upsertMailConfig(c.env, {
    provider: input.provider,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyToEmail: input.replyToEmail,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUsername: input.smtpUsername,
  });

  if (input.smtpPassword) {
    await upsertManagedSecret(c.env, {
      name: buildMailSecretName('smtp-password'),
      namespace: getMailSecretNamespace(),
      value: input.smtpPassword,
      metadata: { provider: 'smtp' },
    });
  }

  if (input.resendApiKey) {
    await upsertManagedSecret(c.env, {
      name: buildMailSecretName('resend-api-key'),
      namespace: getMailSecretNamespace(),
      value: input.resendApiKey,
      metadata: { provider: 'resend' },
    });
  }

  const [mail, secrets] = await Promise.all([
    getMailConfig(c.env),
    getMailSecretStatus(c.env),
  ]);

  return c.json({ success: true, mail, secrets });
});

config.post('/mail/test', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const admin = await createSupabaseAdminClient(c.env);
  const result = await admin.functions.invoke('send_email', {
    body: { mode: 'test-connection' },
  });

  if (result.error) {
    const detail = await getFunctionInvokeErrorMessage(result.error);
    return c.json({ error: `Mail test failed: ${detail}` }, 502);
  }

  return c.json(result.data ?? { success: true });
});

// ── Extra media sources ───────────────────────────────────────────────────

const MOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function isValidMountId(id: string): boolean {
  return MOUNT_ID_PATTERN.test(id);
}

function isValidMediaMount(mount: MediaSourceMount): string | null {
  if (!mount.id || !isValidMountId(mount.id)) {
    return `Invalid mount id "${String(mount.id)}" — must be lowercase alphanumeric with hyphens`;
  }
  if (!mount.label?.trim()) {
    return `Mount "${mount.id}" is missing a label`;
  }
  if (!mount.bucket?.trim()) {
    return `Mount "${mount.id}" is missing a bucket`;
  }
  if (mount.type !== 'supabase' && mount.type !== 'r2' && mount.type !== 's3') {
    return `Mount "${mount.id}" type must be "supabase", "r2", or "s3"`;
  }
  if (mount.type === 's3' && !mount.endpoint?.trim()) {
    return `Mount "${mount.id}" is missing an endpoint`;
  }

  return null;
}

config.get('/media-mounts', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const mounts = await getMediaSourceMounts(c.env);
  return c.json({ mounts });
});

config.put('/media-mounts', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: { mounts: MediaSourceMount[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.mounts)) {
    return c.json({ error: 'mounts must be an array' }, 400);
  }

  for (const mount of body.mounts) {
    const validationError = isValidMediaMount(mount);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }
  }

  const deduped = Array.from(new Map(body.mounts.map((mount) => [mount.id, mount])).values());
  const mounts = await upsertMediaSourceMounts(c.env, deduped);
  return c.json({ success: true, mounts });
});

config.put('/media-mounts/:id/secret', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const mountId = c.req.param('id');
  if (!isValidMountId(mountId)) {
    return c.json({ error: 'Invalid mount id' }, 400);
  }

  const mounts = await getMediaSourceMounts(c.env);
  const mount = mounts.find((entry) => entry.id === mountId);
  if (!mount) {
    return c.json({ error: 'Mount not found' }, 404);
  }
  if (mount.type !== 's3') {
    return c.json({ error: 'Only S3 mounts use managed secrets' }, 400);
  }

  let body: { secretAccessKey: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.secretAccessKey?.trim()) {
    return c.json({ error: 'secretAccessKey is required' }, 400);
  }

  await upsertManagedSecret(c.env, {
    name: buildS3SecretName(mountId),
    namespace: getS3SourceSecretNamespace(),
    value: body.secretAccessKey.trim(),
    metadata: { sourceId: mountId },
  });

  return c.json({ success: true });
});

config.delete('/media-mounts/:id', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const mountId = c.req.param('id');
  if (!isValidMountId(mountId)) {
    return c.json({ error: 'Invalid mount id' }, 400);
  }

  const mounts = await getMediaSourceMounts(c.env);
  const filtered = mounts.filter((mount) => mount.id !== mountId);
  await upsertMediaSourceMounts(c.env, filtered);

  try {
    const admin = await createSupabaseAdminClient(c.env);
    await admin
      .from('managed_secrets')
      .delete()
      .eq('name', buildS3SecretName(mountId));
  } catch {
    // not critical
  }

  return c.json({ success: true });
});

/** GET /config/media-sources — list extra S3-compatible media sources */
config.get('/media-sources', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const sources = await getExtraMediaSources(c.env);
  return c.json({ sources });
});

/** PUT /config/media-sources — replace the full list of extra sources (non-secret fields only) */
config.put('/media-sources', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  let body: { sources: ExtraMediaSource[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.sources)) {
    return c.json({ error: 'sources must be an array' }, 400);
  }

  for (const s of body.sources) {
    if (!s.id || !isValidS3SourceId(s.id)) {
      return c.json({ error: `Invalid source id "${String(s.id)}" — must be lowercase alphanumeric with hyphens` }, 400);
    }
    if (!s.label?.trim()) return c.json({ error: `Source "${s.id}" is missing a label` }, 400);
    if (s.type !== 's3') return c.json({ error: `Source "${s.id}" type must be "s3"` }, 400);
    if (!s.bucket?.trim()) return c.json({ error: `Source "${s.id}" is missing a bucket` }, 400);
    if (!s.endpoint?.trim()) return c.json({ error: `Source "${s.id}" is missing an endpoint` }, 400);
  }

  // Deduplicate by id — last write wins
  const deduped = Array.from(new Map(body.sources.map((s) => [s.id, s])).values());
  await upsertExtraMediaSources(c.env, deduped);
  return c.json({ success: true, sources: deduped });
});

/** PUT /config/media-sources/:id/secret — store the secret access key for a source */
config.put('/media-sources/:id/secret', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const sourceId = c.req.param('id');
  if (!isValidMountId(sourceId)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }

  let body: { secretAccessKey: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.secretAccessKey?.trim()) {
    return c.json({ error: 'secretAccessKey is required' }, 400);
  }

  await upsertManagedSecret(c.env, {
    name: buildS3SecretName(sourceId),
    namespace: getS3SourceSecretNamespace(),
    value: body.secretAccessKey.trim(),
    metadata: { sourceId },
  });

  return c.json({ success: true });
});

/** DELETE /config/media-sources/:id — remove an extra source (config + secret) */
config.delete('/media-sources/:id', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const sourceId = c.req.param('id');
  if (!isValidMountId(sourceId)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }

  const sources = await getExtraMediaSources(c.env);
  const filtered = sources.filter((s) => s.id !== sourceId);
  await upsertExtraMediaSources(c.env, filtered);

  // Best-effort: remove the managed secret (don't fail if it doesn't exist)
  try {
    const admin = await createSupabaseAdminClient(c.env);
    await admin
      .from('managed_secrets')
      .delete()
      .eq('name', buildS3SecretName(sourceId));
  } catch {
    // not critical
  }

  return c.json({ success: true });
});

export default config;