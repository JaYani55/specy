import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import type { Env } from '../lib/supabase';
import { buildMailSecretName, getMailSecretNamespace, getManagedSecretMetadata, upsertManagedSecret } from '../lib/managedSecrets';
import { createSupabaseAdminClient } from '../lib/supabase';
import { getLoggingConfig, getMailConfig, getStorageConfig, upsertLoggingConfig, upsertMailConfig, upsertStorageConfig } from '../lib/systemConfig';

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

export default config;