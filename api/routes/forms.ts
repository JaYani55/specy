import { AwsClient } from 'aws4fetch';
import { Hono } from 'hono';
import { buildMediaMountUrl, ensureSupabaseStorageBucket, resolveAllMediaSourceMounts, resolvePrimaryMediaConfig } from '../lib/mediaStorage';
import { buildS3SecretName, getManagedSecretValue } from '../lib/managedSecrets';
import { verifyAuthSession } from '../lib/auth';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from '../lib/supabase';

const forms = new Hono<{ Bindings: Env }>();

type FormFieldType = 'text' | 'textarea' | 'help-text' | 'image' | 'email' | 'number' | 'file-upload' | 'checkbox' | 'single-select' | 'multi-select' | 'select' | 'radio' | 'date';

interface FormUploadedFileValue {
  name: string;
  path: string;
  url: string;
  bucket: string;
  content_type: string | null;
  size: number | null;
}

interface FormFieldDefinition {
  order?: number;
  name: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  meta_description?: string;
  required?: boolean;
  content?: string;
  src?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  options?: string[];
  upload_mount?: string;
  upload_bucket?: string;
  upload_folder?: string;
}

interface FormRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  status: 'published' | 'archived';
  share_enabled: boolean;
  share_slug: string | null;
  requires_auth: boolean;
  api_enabled: boolean;
  tenant_id?: string | null;
  owner_user_id?: string | null;
}

interface FormWithTenantRow extends FormRow {
  tenants?: {
    name: string;
    slug?: string;
  } | null;
}

const normalizeTenantNameSegment = (value: string): string => value
  .toLowerCase()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

interface NotificationRecipient {
  email: string;
  label: string;
  kind: 'owner' | 'staff';
  staffId?: string;
  userId?: string;
}

interface MailDeliveryJobRow {
  id: string;
}

const VALID_FIELD_TYPES = new Set<FormFieldType>([
  'text',
  'textarea',
  'help-text',
  'image',
  'email',
  'number',
  'file-upload',
  'checkbox',
  'single-select',
  'multi-select',
  'select',
  'radio',
  'date',
]);

const DISPLAY_ONLY_FIELD_TYPES = new Set<FormFieldType>(['help-text', 'image']);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseBearerToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value);

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const isUploadedFileValue = (value: unknown): value is FormUploadedFileValue => (
  isPlainObject(value)
  && typeof value.name === 'string'
  && typeof value.path === 'string'
  && typeof value.url === 'string'
  && typeof value.bucket === 'string'
  && (value.content_type === null || typeof value.content_type === 'string')
  && (value.size === null || typeof value.size === 'number')
);

const formatAnswerValue = (value: string | number | boolean | string[] | FormUploadedFileValue | null): string => {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (isUploadedFileValue(value)) return value.url ? `${value.name} (${value.url})` : value.name;
  if (value === null || value === '') return '-';
  return String(value);
};

const buildAnswerSummaryText = (
  fields: FormFieldDefinition[],
  answers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null>,
): string => fields
  .map((field) => `${field.label}: ${formatAnswerValue(answers[field.name] ?? null)}`)
  .join('\n');

const buildAnswerSummaryHtml = (
  fields: FormFieldDefinition[],
  answers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null>,
): string => fields
  .map((field) => `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;vertical-align:top;">${escapeHtml(field.label)}</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${escapeHtml(formatAnswerValue(answers[field.name] ?? null))}</td></tr>`)
  .join('');

const buildNotificationContent = (input: {
  form: FormRow;
  fields: FormFieldDefinition[];
  answers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null>;
  answerId: string;
  submittedVia: 'share' | 'api' | 'page';
  sourceSlug: string | null;
  recipientLabel: string;
}): { subject: string; text: string; html: string } => {
  const answerSummaryText = buildAnswerSummaryText(input.fields, input.answers);
  const answerSummaryHtml = buildAnswerSummaryHtml(input.fields, input.answers);
  const sourceLine = input.sourceSlug ? `Source: ${input.sourceSlug}` : 'Source: -';
  const htmlSource = input.sourceSlug ? escapeHtml(input.sourceSlug) : '-';
  const subject = `Neue Formularantwort: ${input.form.name}`;
  const text = [
    `Hallo ${input.recipientLabel},`,
    '',
    `fuer das Formular "${input.form.name}" wurde eine neue Antwort gespeichert.`,
    '',
    `Antwort-ID: ${input.answerId}`,
    `Formular-Slug: ${input.form.slug}`,
    `Eingangskanal: ${input.submittedVia}`,
    sourceLine,
    '',
    'Antworten:',
    answerSummaryText,
  ].join('\n');
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;">',
    `<p>Hallo ${escapeHtml(input.recipientLabel)},</p>`,
    `<p>fuer das Formular <strong>${escapeHtml(input.form.name)}</strong> wurde eine neue Antwort gespeichert.</p>`,
    '<table style="border-collapse:collapse;margin:16px 0;">',
    `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;">Antwort-ID</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${escapeHtml(input.answerId)}</td></tr>`,
    `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;">Formular-Slug</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${escapeHtml(input.form.slug)}</td></tr>`,
    `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;">Eingangskanal</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${escapeHtml(input.submittedVia)}</td></tr>`,
    `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;">Quelle</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${htmlSource}</td></tr>`,
    '</table>',
    '<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:720px;">',
    '<thead><tr><th colspan="2" style="text-align:left;padding:8px 12px;border:1px solid #d9d9d9;background:#f3f4f6;">Antworten</th></tr></thead>',
    `<tbody>${answerSummaryHtml}</tbody>`,
    '</table>',
    '</div>',
  ].join('');

  return { subject, text, html };
};

const resolveOwnerRecipient = async (
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  form: FormRow,
): Promise<NotificationRecipient | null> => {
  if (!form.owner_user_id) return null;

  const [{ data: ownerUser, error: ownerUserError }, { data: ownerProfile, error: ownerProfileError }] = await Promise.all([
    admin.auth.admin.getUserById(form.owner_user_id),
    admin
      .from('user_profile')
      .select('Username')
      .eq('user_id', form.owner_user_id)
      .maybeSingle(),
  ]);

  if (ownerUserError) throw new Error(ownerUserError.message);
  if (ownerProfileError) throw new Error(ownerProfileError.message);

  const email = ownerUser.user?.email?.trim() ?? '';
  if (!isValidEmail(email)) return null;

  return {
    email,
    label: typeof ownerProfile?.Username === 'string' && ownerProfile.Username.trim() ? ownerProfile.Username.trim() : 'Form owner',
    kind: 'owner',
    userId: form.owner_user_id,
  };
};

const resolveStaffRecipients = async (
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  formId: string,
): Promise<NotificationRecipient[]> => {
  const { data: recipientRows, error: recipientError } = await admin
    .from('form_notification_recipients')
    .select('staff_id')
    .eq('form_id', formId);

  if (recipientError) throw new Error(recipientError.message);

  const staffIds = [...new Set((recipientRows ?? []).map((row) => row.staff_id as string).filter(Boolean))];
  if (staffIds.length === 0) return [];

  const { data: staffRows, error: staffError } = await admin
    .from('staff')
    .select('id, display_name, email')
    .in('id', staffIds);

  if (staffError) throw new Error(staffError.message);

  return (staffRows ?? [])
    .map((row) => {
      const email = typeof row.email === 'string' ? row.email.trim() : '';
      if (!isValidEmail(email)) return null;
      return {
        email,
        label: typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : 'Staff',
        kind: 'staff' as const,
        staffId: row.id as string,
      } as NotificationRecipient;
    })
    .filter((recipient): recipient is NotificationRecipient => recipient !== null);
};

const enqueueFormAnswerNotifications = async (input: {
  env: Env;
  form: FormRow;
  fields: FormFieldDefinition[];
  answers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null>;
  answerId: string;
  submittedBy: string | null;
  submittedVia: 'share' | 'api' | 'page';
  sourceSlug: string | null;
}): Promise<void> => {
  const admin = await createSupabaseAdminClient(input.env);
  const { data: settings, error: settingsError } = await admin
    .from('form_notification_settings')
    .select('notify_owner, notify_staff')
    .eq('form_id', input.form.id)
    .maybeSingle();

  if (settingsError) throw new Error(settingsError.message);
  if (!settings?.notify_owner && !settings?.notify_staff) return;

  const recipientMap = new Map<string, NotificationRecipient>();

  if (settings.notify_owner) {
    const ownerRecipient = await resolveOwnerRecipient(admin, input.form);
    if (ownerRecipient) recipientMap.set(ownerRecipient.email.toLowerCase(), ownerRecipient);
  }

  if (settings.notify_staff) {
    const staffRecipients = await resolveStaffRecipients(admin, input.form.id);
    for (const recipient of staffRecipients) {
      recipientMap.set(recipient.email.toLowerCase(), recipient);
    }
  }

  const recipients = [...recipientMap.values()];
  if (recipients.length === 0) return;

  const jobsToInsert = recipients.map((recipient) => {
    const content = buildNotificationContent({
      form: input.form,
      fields: input.fields,
      answers: input.answers,
      answerId: input.answerId,
      submittedVia: input.submittedVia,
      sourceSlug: input.sourceSlug,
      recipientLabel: recipient.label,
    });

    return {
      event_type: 'form_answer_notification',
      status: 'pending',
      form_id: input.form.id,
      answer_id: input.answerId,
      recipient_email: recipient.email,
      subject: content.subject,
      payload: {
        html: content.html,
        text: content.text,
        formName: input.form.name,
        formSlug: input.form.slug,
        answerId: input.answerId,
        submittedVia: input.submittedVia,
        sourceSlug: input.sourceSlug,
        recipientKind: recipient.kind,
        recipientLabel: recipient.label,
        recipientStaffId: recipient.staffId ?? null,
        recipientUserId: recipient.userId ?? null,
      },
      queued_by: input.submittedBy,
    };
  });

  const { data: jobs, error: jobsError } = await admin
    .from('mail_delivery_jobs')
    .insert(jobsToInsert)
    .select('id');

  if (jobsError) throw new Error(jobsError.message);
  if (!jobs || jobs.length === 0) return;

  const { error: eventsError } = await admin
    .from('mail_delivery_events')
    .insert((jobs as MailDeliveryJobRow[]).map((job) => ({
      job_id: job.id,
      event_type: 'queued',
      message: 'Queued form answer notification for delivery.',
      metadata: {
        formId: input.form.id,
        answerId: input.answerId,
      },
    })));

  if (eventsError) throw new Error(eventsError.message);

  await Promise.allSettled((jobs as MailDeliveryJobRow[]).map(async (job) => {
    const result = await admin.functions.invoke('send_email', {
      body: { mode: 'deliver-job', jobId: job.id },
    });

    if (result.error) {
      console.error(`Failed to invoke send_email for job ${job.id}: ${result.error.message}`);
    }
  }));
};

const normalizeSchema = (rawSchema: Record<string, unknown>): { fields: FormFieldDefinition[]; errors: string[] } => {
  const fields: FormFieldDefinition[] = [];
  const errors: string[] = [];

  for (const [name, value] of Object.entries(rawSchema)) {
    if (!isPlainObject(value)) {
      errors.push(`${name} must be an object.`);
      continue;
    }

    const type = value.type;
    const label = value.label;

    if (typeof type !== 'string' || !VALID_FIELD_TYPES.has(type as FormFieldType)) {
      errors.push(`${name}.type is invalid.`);
      continue;
    }

    if (typeof label !== 'string' || !label.trim()) {
      errors.push(`${name}.label is required.`);
      continue;
    }

    const field: FormFieldDefinition = {
      name,
      type: type as FormFieldType,
      label,
      description: typeof value.description === 'string' ? value.description : undefined,
      placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined,
      meta_description: typeof value.meta_description === 'string' ? value.meta_description : undefined,
      required: typeof value.required === 'boolean' ? value.required : false,
      content: typeof value.content === 'string' ? value.content : undefined,
      src: typeof value.src === 'string' ? value.src : undefined,
      alt: typeof value.alt === 'string' ? value.alt : undefined,
      caption: typeof value.caption === 'string' ? value.caption : undefined,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? value.width : undefined,
      height: typeof value.height === 'number' && Number.isFinite(value.height) ? value.height : undefined,
      options: Array.isArray(value.options) ? value.options.filter((entry): entry is string => typeof entry === 'string') : undefined,
      upload_mount: typeof value.upload_mount === 'string' ? value.upload_mount : undefined,
      upload_bucket: typeof value.upload_bucket === 'string' ? value.upload_bucket : undefined,
      upload_folder: typeof value.upload_folder === 'string' ? value.upload_folder : undefined,
    };

    if (DISPLAY_ONLY_FIELD_TYPES.has(field.type)) {
      field.required = false;
    }

    if (value.order !== undefined && typeof value.order === 'number' && Number.isFinite(value.order)) {
      field.order = Math.max(0, Math.trunc(value.order));
    }

    if ((field.type === 'select' || field.type === 'radio' || field.type === 'single-select' || field.type === 'multi-select') && (!field.options || field.options.length === 0)) {
      errors.push(`${name}.options is required.`);
      continue;
    }

    if (field.type === 'file-upload' && !field.upload_folder) {
      field.upload_folder = 'forms/{form_slug}/{field_name}/{submission_id}';
    }

    fields.push(field);
  }

  const sortedFields = [...fields]
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftOrder = left.field.order;
      const rightOrder = right.field.order;
      const leftHasOrder = typeof leftOrder === 'number';
      const rightHasOrder = typeof rightOrder === 'number';

      if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) {
        return (leftOrder as number) - (rightOrder as number);
      }

      if (leftHasOrder && !rightHasOrder) {
        return -1;
      }

      if (!leftHasOrder && rightHasOrder) {
        return 1;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.field);

  return { fields: sortedFields, errors };
};

const validateAnswers = (
  fields: FormFieldDefinition[],
  answers: unknown,
): { errors: string[]; normalizedAnswers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null> } => {
  const errors: string[] = [];
  const normalizedAnswers: Record<string, string | number | boolean | string[] | FormUploadedFileValue | null> = {};

  if (!isPlainObject(answers)) {
    return { errors: ['answers must be an object.'], normalizedAnswers };
  }

  const fieldMap = new Map(fields.map((field) => [field.name, field]));

  for (const key of Object.keys(answers)) {
    const field = fieldMap.get(key);
    if (!field) {
      errors.push(`Unexpected field: ${key}.`);
      continue;
    }

    if (DISPLAY_ONLY_FIELD_TYPES.has(field.type)) {
      errors.push(`${key} is a display-only field and cannot be submitted.`);
    }
  }

  for (const field of fields) {
    if (DISPLAY_ONLY_FIELD_TYPES.has(field.type)) {
      continue;
    }

    const value = answers[field.name];
    const isEmptyString = typeof value === 'string' && value.trim() === '';
    const isMissing = value === undefined || value === null || isEmptyString;

    if (field.required && isMissing && field.type !== 'checkbox' && field.type !== 'multi-select') {
      errors.push(`${field.name} is required.`);
      continue;
    }

    if (value === undefined || value === null || isEmptyString || (field.type === 'multi-select' && Array.isArray(value) && value.length === 0)) {
      if (field.type === 'checkbox') {
        normalizedAnswers[field.name] = false;
      } else if (field.type === 'multi-select') {
        normalizedAnswers[field.name] = [];
      } else {
        normalizedAnswers[field.name] = null;
      }
      continue;
    }

    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'date':
        if (typeof value !== 'string') {
          errors.push(`${field.name} must be a string.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      case 'email':
        if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${field.name} must be a valid email address.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      case 'number': {
        const numericValue = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numericValue)) {
          errors.push(`${field.name} must be a number.`);
        } else {
          normalizedAnswers[field.name] = numericValue;
        }
        break;
      }
      case 'file-upload':
        if (!isUploadedFileValue(value)) {
          errors.push(`${field.name} must be an uploaded file object.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      case 'checkbox':
        if (typeof value !== 'boolean') {
          errors.push(`${field.name} must be true or false.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      case 'select':
      case 'single-select':
      case 'radio':
        if (typeof value !== 'string') {
          errors.push(`${field.name} must be a string.`);
        } else if (!field.options?.includes(value)) {
          errors.push(`${field.name} must be one of: ${field.options?.join(', ')}.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      case 'multi-select':
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
          errors.push(`${field.name} must be an array of strings.`);
        } else if (value.some((entry) => !field.options?.includes(entry))) {
          errors.push(`${field.name} contains values outside the allowed options.`);
        } else {
          normalizedAnswers[field.name] = value;
        }
        break;
      default:
        errors.push(`${field.name} has unsupported field type.`);
    }
  }

  return { errors, normalizedAnswers };
};

const sanitizeUploadPathSegment = (value: string, fallback: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
};

const resolveUploadFolder = (field: FormFieldDefinition, form: FormRow, submissionId: string): string => {
  const template = field.upload_folder?.trim() || 'forms/{form_slug}/{field_name}/{submission_id}';
  return template
    .replaceAll('{form_slug}', sanitizeUploadPathSegment(form.slug, 'form'))
    .replaceAll('{field_name}', sanitizeUploadPathSegment(field.name, 'field'))
    .replaceAll('{submission_id}', sanitizeUploadPathSegment(submissionId, 'submission'))
    .split('/')
    .map((segment) => sanitizeUploadPathSegment(segment, 'segment'))
    .filter(Boolean)
    .join('/');
};

const uploadFormFile = async (input: {
  env: Env;
  requestUrl: string;
  form: FormRow;
  field: FormFieldDefinition;
  file: File;
  submissionId: string;
}): Promise<FormUploadedFileValue> => {
  const availableMounts = await resolveAllMediaSourceMounts(input.env, input.requestUrl);
  const defaultMount = availableMounts.find((mount) => mount.isDefault) ?? await resolvePrimaryMediaConfig(input.env, input.requestUrl);
  const selectedMountId = input.field.upload_mount?.trim();
  const legacyBucketOverride = input.field.upload_bucket?.trim();

  const storageConfig = selectedMountId
    ? availableMounts.find((mount) => mount.id === selectedMountId) ?? null
    : defaultMount;

  if (!storageConfig) {
    throw new Error(`Configured upload mount ${selectedMountId} is not available.`);
  }

  if (!storageConfig.configured || storageConfig.provider === 'unconfigured') {
    throw new Error('Storage is not configured for form uploads.');
  }

  const selectedBucket = storageConfig.provider === 'supabase'
    ? legacyBucketOverride || storageConfig.bucket
    : storageConfig.bucket;

  if (!selectedBucket) {
    throw new Error('Storage is not configured for form uploads.');
  }

  if ((storageConfig.provider === 'r2' || storageConfig.provider === 's3') && legacyBucketOverride && legacyBucketOverride !== storageConfig.bucket) {
    throw new Error(`${storageConfig.provider.toUpperCase()} form uploads must use the configured bucket ${storageConfig.bucket}.`);
  }

  const folder = resolveUploadFolder(input.field, input.form, input.submissionId);
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${folder}/${Date.now()}-${safeName}`;

  if (storageConfig.provider === 's3') {
    if (!storageConfig.endpoint || !storageConfig.accessKeyId) {
      throw new Error('S3 form uploads require an endpoint and access key ID on the default mount.');
    }

    const secretAccessKey = await getManagedSecretValue(input.env, buildS3SecretName(storageConfig.id));
    if (!secretAccessKey) {
      throw new Error(`S3 form uploads require a stored secret access key for mount ${storageConfig.id}.`);
    }

    const client = new AwsClient({
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey,
      region: storageConfig.region || 'us-east-1',
      service: 's3',
    });
    const endpoint = storageConfig.endpoint.replace(/\/+$/, '');
    const url = `${endpoint}/${storageConfig.bucket}/${key}`;
    const buf = await input.file.arrayBuffer();
    const response = await client.fetch(url, {
      method: 'PUT',
      body: buf,
      headers: { 'Content-Type': input.file.type || 'application/octet-stream' },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`S3 upload failed (${response.status}): ${detail}`);
    }

    return {
      name: input.file.name,
      path: key,
      url: buildMediaMountUrl(storageConfig, input.requestUrl, key),
      bucket: selectedBucket,
      content_type: input.file.type || null,
      size: Number.isFinite(input.file.size) ? input.file.size : null,
    };
  }

  if (storageConfig.provider === 'r2') {
    const buf = await input.file.arrayBuffer();
    await input.env.MEDIA_BUCKET!.put(key, buf, { httpMetadata: { contentType: input.file.type || 'application/octet-stream' } });
    return {
      name: input.file.name,
      path: key,
      url: buildMediaMountUrl(storageConfig, input.requestUrl, key),
      bucket: selectedBucket,
      content_type: input.file.type || null,
      size: Number.isFinite(input.file.size) ? input.file.size : null,
    };
  }

  await ensureSupabaseStorageBucket(input.env, selectedBucket);
  const admin = await createSupabaseAdminClient(input.env);
  const buf = await input.file.arrayBuffer();
  const { error } = await admin.storage
    .from(selectedBucket)
    .upload(key, buf, { contentType: input.file.type || 'application/octet-stream', upsert: true });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = admin.storage.from(selectedBucket).getPublicUrl(key);
  return {
    name: input.file.name,
    path: key,
    url: data.publicUrl,
    bucket: selectedBucket,
    content_type: input.file.type || null,
    size: Number.isFinite(input.file.size) ? input.file.size : null,
  };
};

const handleFormUploadRequest = async (input: {
  env: Env;
  requestUrl: string;
  form: FormRow | null;
  shareMode: boolean;
  token?: string;
  formData: FormData;
}): Promise<Response> => {
  const form = input.form;
  if (!form) return new Response(JSON.stringify({ error: 'Form not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  if (input.shareMode && !form.share_enabled) return new Response(JSON.stringify({ error: 'Share link is disabled for this form.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  if (!input.shareMode && !form.api_enabled) return new Response(JSON.stringify({ error: 'API access is disabled for this form.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  if (form.requires_auth && !input.token) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const { fields, errors } = normalizeSchema(form.schema || {});
  if (errors.length > 0) return new Response(JSON.stringify({ error: 'Stored form schema is invalid.', details: errors }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const file = input.formData.get('file');
  const fieldName = input.formData.get('field_name');
  const submissionId = input.formData.get('submission_id');

  if (!(file instanceof File)) return new Response(JSON.stringify({ error: 'No file provided.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (typeof fieldName !== 'string' || !fieldName.trim()) return new Response(JSON.stringify({ error: 'field_name is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (typeof submissionId !== 'string' || !submissionId.trim()) return new Response(JSON.stringify({ error: 'submission_id is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const field = fields.find((entry) => entry.name === fieldName);
  if (!field) return new Response(JSON.stringify({ error: `Unknown field: ${fieldName}.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (field.type !== 'file-upload') return new Response(JSON.stringify({ error: `${fieldName} is not a file-upload field.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    const uploaded = await uploadFormFile({
      env: input.env,
      requestUrl: input.requestUrl,
      form,
      field,
      file,
      submissionId,
    });
    return new Response(JSON.stringify({ file: uploaded }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload file.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

const getFormByIdentifier = async (
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  identifier: string,
): Promise<FormRow | null> => {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
  const query = supabase.from('forms').select('*');

  const result = isUuid
    ? await query.eq('id', identifier).maybeSingle()
    : await query.eq('slug', identifier).maybeSingle();

  if (result.error) throw result.error;
  return (result.data as FormRow | null) ?? null;
};

const getFormByShareSlug = async (
  env: Env,
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  tenantNameSegment: string,
  shareSlug: string,
): Promise<FormRow | null> => {
  const { data, error } = await supabase
    .from('forms')
    .select('*, tenants:tenant_id (name, slug)')
    .eq('share_slug', shareSlug)
    .eq('share_enabled', true)
    .neq('status', 'archived')
    .limit(20);

  if (error) throw error;
  const forms = (data as FormWithTenantRow[] | null) ?? [];
  const requestedTenantSegment = normalizeTenantNameSegment(tenantNameSegment);

  for (const form of forms) {
    if (!form.tenant_id) {
      continue;
    }

    let resolvedTenantName: string | null = form.tenants?.name ?? null;
    let resolvedTenantSlug: string | null = form.tenants?.slug ?? null;

    // When called as anon, tenant joins can be hidden by RLS; resolve tenant via admin as fallback.
    if ((!resolvedTenantName || !resolvedTenantSlug) && form.tenant_id) {
      const admin = await createSupabaseAdminClient(env);
      const { data: tenantData, error: tenantError } = await admin
        .from('tenants')
        .select('name, slug')
        .eq('id', form.tenant_id)
        .maybeSingle();

      if (tenantError) throw tenantError;
      resolvedTenantName = typeof tenantData?.name === 'string' ? tenantData.name : resolvedTenantName;
      resolvedTenantSlug = typeof tenantData?.slug === 'string' ? tenantData.slug : resolvedTenantSlug;
    }

    const matchesTenant = [resolvedTenantName, resolvedTenantSlug]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeTenantNameSegment(value) === requestedTenantSegment);

    if (matchesTenant) {
      return form;
    }
  }

  return null;
};

const serializeForm = (form: FormRow, fields: FormFieldDefinition[]) => ({
  form: {
    id: form.id,
    name: form.name,
    slug: form.slug,
    description: form.description,
    status: form.status,
    share_enabled: form.share_enabled,
    share_slug: form.share_slug,
    requires_auth: form.requires_auth,
    api_enabled: form.api_enabled,
  },
  fields,
  llm_instructions: form.llm_instructions,
});

forms.get('/', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const { data, error } = await supabase
    .from('forms')
    .select('id, name, slug, description, status, share_enabled, share_slug, requires_auth, api_enabled')
    .eq('status', 'published')
    .order('name', { ascending: true });

  if (error) return c.json({ error: 'Failed to load forms.' }, 500);
  return c.json({ forms: data ?? [] });
});

forms.get('/share/:tenantName/:shareSlug', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const form = await getFormByShareSlug(c.env, supabase, c.req.param('tenantName'), c.req.param('shareSlug'));
  if (!form) return c.json({ error: 'Form not found.' }, 404);
  if (!form.share_enabled) return c.json({ error: 'Share link is disabled for this form.' }, 403);
  if (form.requires_auth && !token) return c.json({ error: 'Authentication required.' }, 401);

  const { fields, errors } = normalizeSchema(form.schema || {});
  if (errors.length > 0) return c.json({ error: 'Stored form schema is invalid.', details: errors }, 500);

  return c.json(serializeForm(form, fields));
});

forms.post('/share/:tenantName/:shareSlug/upload', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const form = await getFormByShareSlug(c.env, supabase, c.req.param('tenantName'), c.req.param('shareSlug'));
  const formData = await c.req.formData().catch(() => null);

  if (!formData) return c.json({ error: 'Invalid multipart body.' }, 400);

  const response = await handleFormUploadRequest({
    env: c.env,
    requestUrl: c.req.url,
    form,
    shareMode: true,
    token,
    formData,
  });

  return response;
});

forms.post('/share/:tenantName/:shareSlug/answers', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const form = await getFormByShareSlug(c.env, supabase, c.req.param('tenantName'), c.req.param('shareSlug'));

  if (!form) return c.json({ error: 'Form not found.' }, 404);
  if (!form.share_enabled) return c.json({ error: 'Share link is disabled for this form.' }, 403);
  if (form.requires_auth && !token) return c.json({ error: 'Authentication required.' }, 401);

  const { fields, errors: schemaErrors } = normalizeSchema(form.schema || {});
  if (schemaErrors.length > 0) return c.json({ error: 'Stored form schema is invalid.', details: schemaErrors }, 500);

  const body = await c.req.json().catch(() => null);
  if (!body || !isPlainObject(body)) return c.json({ error: 'Invalid JSON body.' }, 400);

  const { errors, normalizedAnswers } = validateAnswers(fields, body.answers);
  if (errors.length > 0) return c.json({ error: 'Validation failed.', details: errors }, 400);

  let submittedBy: string | null = null;
  if (token) {
    const auth = await verifyAuthSession(c.env, token);
    if (!auth) return c.json({ error: 'Invalid or expired session.' }, 401);
    submittedBy = auth.userId;
  }

  const sourceSlug = typeof body.source_slug === 'string' ? body.source_slug : form.share_slug;
  const answerId = crypto.randomUUID();
  const { error } = await supabase
    .from('forms_answers')
    .insert({
      id: answerId,
      form_id: form.id,
      submitted_by: submittedBy,
      answers: normalizedAnswers,
      source_slug: sourceSlug,
      submitted_via: 'share',
      ip_address: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    })
    ;

  if (error) return c.json({ error: 'Failed to save answers.', detail: error.message }, 500);

  try {
    await enqueueFormAnswerNotifications({
      env: c.env,
      form,
      fields,
      answers: normalizedAnswers,
      answerId,
      submittedBy,
      submittedVia: 'share',
      sourceSlug,
    });
  } catch (notificationError) {
    console.error(`Failed to queue form answer notifications for ${answerId}:`, notificationError);
  }

  return c.json({ success: true, answer_id: answerId });
});

forms.get('/:identifier', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const form = await getFormByIdentifier(supabase, c.req.param('identifier'));
  if (!form) return c.json({ error: 'Form not found.' }, 404);
  if (!form.api_enabled) return c.json({ error: 'API access is disabled for this form.' }, 403);
  if (form.requires_auth && !token) return c.json({ error: 'Authentication required.' }, 401);

  const { fields, errors } = normalizeSchema(form.schema || {});
  if (errors.length > 0) return c.json({ error: 'Stored form schema is invalid.', details: errors }, 500);

  return c.json(serializeForm(form, fields));
});

forms.post('/:identifier/upload', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const form = await getFormByIdentifier(supabase, c.req.param('identifier'));
  const formData = await c.req.formData().catch(() => null);

  if (!formData) return c.json({ error: 'Invalid multipart body.' }, 400);

  const response = await handleFormUploadRequest({
    env: c.env,
    requestUrl: c.req.url,
    form,
    shareMode: false,
    token,
    formData,
  });

  return response;
});

forms.post('/:identifier/answers', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const form = await getFormByIdentifier(supabase, c.req.param('identifier'));

  if (!form) return c.json({ error: 'Form not found.' }, 404);
  if (!form.api_enabled) return c.json({ error: 'API access is disabled for this form.' }, 403);
  if (form.requires_auth && !token) return c.json({ error: 'Authentication required.' }, 401);

  const { fields, errors: schemaErrors } = normalizeSchema(form.schema || {});
  if (schemaErrors.length > 0) return c.json({ error: 'Stored form schema is invalid.', details: schemaErrors }, 500);

  const body = await c.req.json().catch(() => null);
  if (!body || !isPlainObject(body)) return c.json({ error: 'Invalid JSON body.' }, 400);

  const { errors, normalizedAnswers } = validateAnswers(fields, body.answers);
  if (errors.length > 0) return c.json({ error: 'Validation failed.', details: errors }, 400);

  let submittedBy: string | null = null;
  if (token) {
    const auth = await verifyAuthSession(c.env, token);
    if (!auth) return c.json({ error: 'Invalid or expired session.' }, 401);
    submittedBy = auth.userId;
  }

  const submittedVia = body.submitted_via === 'page' ? 'page' : 'api';
  const sourceSlug = typeof body.source_slug === 'string' ? body.source_slug : form.slug;
  const answerId = crypto.randomUUID();
  const { error } = await supabase
    .from('forms_answers')
    .insert({
      id: answerId,
      form_id: form.id,
      submitted_by: submittedBy,
      answers: normalizedAnswers,
      source_slug: sourceSlug,
      submitted_via: submittedVia,
      ip_address: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    })
    ;

  if (error) return c.json({ error: 'Failed to save answers.', detail: error.message }, 500);

  try {
    await enqueueFormAnswerNotifications({
      env: c.env,
      form,
      fields,
      answers: normalizedAnswers,
      answerId,
      submittedBy,
      submittedVia,
      sourceSlug,
    });
  } catch (notificationError) {
    console.error(`Failed to queue form answer notifications for ${answerId}:`, notificationError);
  }

  return c.json({ success: true, answer_id: answerId });
});

export default forms;