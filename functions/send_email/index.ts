import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

type MailProvider = 'smtp' | 'resend';
type JobStatus = 'pending' | 'processing' | 'sent' | 'failed';

type MailConfig = {
  provider: MailProvider;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
};

type MailJob = {
  id: string;
  form_id: string | null;
  answer_id: string | null;
  provider: MailProvider | null;
  status: JobStatus;
  recipient_email: string;
  subject: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type SendRequest = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

type ProviderSendResult = {
  provider: MailProvider;
  messageId: string | null;
  response: Record<string, unknown>;
};

type ProviderTestResult = {
  provider: MailProvider;
  ok: boolean;
  detail?: string;
  response?: Record<string, unknown>;
};

type ProviderAdapter = {
  provider: MailProvider;
  testConnection(): Promise<ProviderTestResult>;
  send(message: SendRequest): Promise<ProviderSendResult>;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_SUPABASE_SECRET_KEY = Deno.env.get('APP_SUPABASE_SECRET_KEY') ?? '';
const SECRETS_ENCRYPTION_KEY = Deno.env.get('SECRETS_ENCRYPTION_KEY') ?? '';
const MAIL_NAMESPACE = 'mail';
const SMTP_PASSWORD_SECRET = 'MAIL_SMTP_PASSWORD';
const RESEND_API_KEY_SECRET = 'MAIL_RESEND_API_KEY';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

if (!SUPABASE_URL || !APP_SUPABASE_SECRET_KEY || !SECRETS_ENCRYPTION_KEY) {
  throw new Error('Missing required function secrets: SUPABASE_URL, APP_SUPABASE_SECRET_KEY, or SECRETS_ENCRYPTION_KEY.');
}

const supabase = createClient(SUPABASE_URL, APP_SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
}

async function decryptManagedSecret(secret: string, payload: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = payload.split('.');
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error('Managed secret payload is malformed');
  }

  const key = await importEncryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64) },
    key,
    fromBase64(ciphertextBase64),
  );

  return new TextDecoder().decode(plaintext);
}

async function getSystemConfig(namespace: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value')
    .eq('namespace', namespace);

  if (error) {
    throw new Error(error.message);
  }

  return Object.fromEntries((data ?? []).map((row) => [row.key as string, row.value as string]));
}

async function getManagedSecretValue(name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('managed_secrets')
    .select('encrypted_value')
    .eq('name', name)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const encryptedValue = data?.encrypted_value as string | undefined;
  if (!encryptedValue) {
    return null;
  }

  return decryptManagedSecret(SECRETS_ENCRYPTION_KEY, encryptedValue);
}

async function getMailConfig(): Promise<MailConfig> {
  const values = await getSystemConfig(MAIL_NAMESPACE);
  const provider = values.provider;

  if (provider !== 'smtp' && provider !== 'resend') {
    throw new Error('Mail provider is not configured.');
  }

  return {
    provider,
    fromName: values.from_name ?? '',
    fromEmail: values.from_email ?? '',
    replyToEmail: values.reply_to_email ?? '',
    smtpHost: values.smtp_host ?? '',
    smtpPort: Number.parseInt(values.smtp_port ?? '587', 10),
    smtpSecure: values.smtp_secure === 'true',
    smtpUsername: values.smtp_username ?? '',
  };
}

function formatFromAddress(config: MailConfig): string {
  const name = config.fromName.trim();
  return name ? `${name} <${config.fromEmail}>` : config.fromEmail;
}

async function createProvider(config: MailConfig): Promise<ProviderAdapter> {
  if (config.provider === 'resend') {
    const apiKey = await getManagedSecretValue(RESEND_API_KEY_SECRET);
    if (!apiKey) {
      throw new Error('Resend API key is not configured.');
    }

    return {
      provider: 'resend',
      async testConnection() {
        const response = await fetch('https://api.resend.com/domains', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Resend test failed: HTTP ${response.status} ${detail}`);
        }

        const payload = await response.json();
        return {
          provider: 'resend',
          ok: true,
          response: { domainCount: Array.isArray(payload?.data) ? payload.data.length : undefined },
        };
      },
      async send(message) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: formatFromAddress(config),
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            reply_to: message.replyTo || config.replyToEmail || undefined,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(`Resend send failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
        }

        return {
          provider: 'resend',
          messageId: typeof payload?.id === 'string' ? payload.id : null,
          response: payload as Record<string, unknown>,
        };
      },
    };
  }

  const smtpPassword = await getManagedSecretValue(SMTP_PASSWORD_SECRET);
  if (!smtpPassword) {
    throw new Error('SMTP password is not configured.');
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUsername,
      pass: smtpPassword,
    },
    connectionTimeout: 10000,
  });

  return {
    provider: 'smtp',
    async testConnection() {
      await transport.verify();
      return {
        provider: 'smtp',
        ok: true,
        detail: 'SMTP server accepted the connection and credentials.',
      };
    },
    async send(message) {
      const info = await transport.sendMail({
        from: formatFromAddress(config),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo || config.replyToEmail || undefined,
      });

      return {
        provider: 'smtp',
        messageId: typeof info.messageId === 'string' ? info.messageId : null,
        response: {
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
        },
      };
    },
  };
}

async function appendDeliveryEvent(jobId: string, eventType: 'queued' | 'testing' | 'sending' | 'sent' | 'failed', message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabase.from('mail_delivery_events').insert({
    job_id: jobId,
    event_type: eventType,
    message,
    metadata,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function shouldDeleteAnswerAfterEmail(formId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('form_notification_settings')
    .select('delete_answer_after_email')
    .eq('form_id', formId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.delete_answer_after_email);
}

async function maybeDeleteDeliveredAnswer(job: MailJob) {
  if (!job.form_id || !job.answer_id) {
    return;
  }

  const deleteAnswer = await shouldDeleteAnswerAfterEmail(job.form_id);
  if (!deleteAnswer) {
    return;
  }

  const { count, error: remainingJobsError } = await supabase
    .from('mail_delivery_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', job.form_id)
    .eq('answer_id', job.answer_id)
    .neq('status', 'sent');

  if (remainingJobsError) {
    throw new Error(remainingJobsError.message);
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const answerId = job.answer_id;
  const { error: deleteAnswerError } = await supabase
    .from('forms_answers')
    .delete()
    .eq('id', answerId)
    .eq('form_id', job.form_id);

  if (deleteAnswerError) {
    throw new Error(deleteAnswerError.message);
  }

  await appendDeliveryEvent(job.id, 'sent', 'Stored form answer deleted after successful outbound delivery.', {
    formId: job.form_id,
    answerId,
    autoDeleted: true,
  });
}

async function processJob(jobId: string) {
  const { data, error } = await supabase
    .from('mail_delivery_jobs')
    .select('id, form_id, answer_id, provider, status, recipient_email, subject, payload, attempt_count')
    .eq('id', jobId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const job = data as MailJob;
  const config = await getMailConfig();
  const provider = await createProvider(config);

  const { error: markProcessingError } = await supabase
    .from('mail_delivery_jobs')
    .update({
      provider: provider.provider,
      status: 'processing',
      attempt_count: job.attempt_count + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', job.id);

  if (markProcessingError) {
    throw new Error(markProcessingError.message);
  }

  await appendDeliveryEvent(job.id, 'sending', 'Starting outbound mail delivery.', {
    provider: provider.provider,
    recipientEmail: job.recipient_email,
  });

  try {
    const result = await provider.send({
      to: job.recipient_email,
      subject: job.subject,
      html: typeof job.payload.html === 'string' ? job.payload.html : undefined,
      text: typeof job.payload.text === 'string' ? job.payload.text : undefined,
      replyTo: typeof job.payload.reply_to === 'string' && job.payload.reply_to.trim() ? job.payload.reply_to.trim() : undefined,
    });

    const { error: markSentError } = await supabase
      .from('mail_delivery_jobs')
      .update({
        provider: result.provider,
        status: 'sent',
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', job.id);

    if (markSentError) {
      throw new Error(markSentError.message);
    }

    await appendDeliveryEvent(job.id, 'sent', 'Outbound mail delivery succeeded.', {
      provider: result.provider,
      messageId: result.messageId,
      response: result.response,
    });

    await maybeDeleteDeliveredAnswer(job);

    return {
      success: true,
      jobId: job.id,
      provider: result.provider,
      messageId: result.messageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from('mail_delivery_jobs')
      .update({
        status: 'failed',
        last_error: message,
      })
      .eq('id', job.id);

    await appendDeliveryEvent(job.id, 'failed', 'Outbound mail delivery failed.', {
      provider: provider.provider,
      error: message,
    });

    throw error;
  }
}

async function processPendingJobs(limit: number) {
  const { data, error } = await supabase
    .from('mail_delivery_jobs')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const results = [];
  for (const row of data ?? []) {
    results.push(await processJob(row.id as string));
  }

  return results;
}

serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const mode = typeof body.mode === 'string' ? body.mode : 'process-pending';

  try {
    if (mode === 'test-connection') {
      const config = await getMailConfig();
      const provider = await createProvider(config);
      const result = await provider.testConnection();
      return json({ success: true, ...result });
    }

    if (mode === 'deliver-job') {
      if (typeof body.jobId !== 'string' || !body.jobId) {
        return json({ error: 'jobId is required for deliver-job mode.' }, 400);
      }

      const result = await processJob(body.jobId);
      return json(result);
    }

    if (mode === 'process-pending') {
      const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 25) : 10;
      const results = await processPendingJobs(limit);
      return json({ success: true, processed: results.length, results });
    }

    return json({ error: `Unsupported mode: ${mode}` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
