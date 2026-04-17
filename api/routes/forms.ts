import { Hono } from 'hono';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from '../lib/supabase';

const forms = new Hono<{ Bindings: Env }>();

type FormFieldType = 'text' | 'textarea' | 'email' | 'number' | 'checkbox' | 'single-select' | 'multi-select' | 'select' | 'radio' | 'date';

interface FormFieldDefinition {
  name: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  meta_description?: string;
  required?: boolean;
  options?: string[];
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
  owner_user_id?: string | null;
}

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
  'email',
  'number',
  'checkbox',
  'single-select',
  'multi-select',
  'select',
  'radio',
  'date',
]);

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

const formatAnswerValue = (value: string | number | boolean | string[] | null): string => {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === '') return '-';
  return String(value);
};

const buildAnswerSummaryText = (
  fields: FormFieldDefinition[],
  answers: Record<string, string | number | boolean | string[] | null>,
): string => fields
  .map((field) => `${field.label}: ${formatAnswerValue(answers[field.name] ?? null)}`)
  .join('\n');

const buildAnswerSummaryHtml = (
  fields: FormFieldDefinition[],
  answers: Record<string, string | number | boolean | string[] | null>,
): string => fields
  .map((field) => `<tr><td style="padding:8px 12px;border:1px solid #d9d9d9;font-weight:600;vertical-align:top;">${escapeHtml(field.label)}</td><td style="padding:8px 12px;border:1px solid #d9d9d9;">${escapeHtml(formatAnswerValue(answers[field.name] ?? null))}</td></tr>`)
  .join('');

const buildNotificationContent = (input: {
  form: FormRow;
  fields: FormFieldDefinition[];
  answers: Record<string, string | number | boolean | string[] | null>;
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
  answers: Record<string, string | number | boolean | string[] | null>;
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
      options: Array.isArray(value.options) ? value.options.filter((entry): entry is string => typeof entry === 'string') : undefined,
    };

    if ((field.type === 'select' || field.type === 'radio' || field.type === 'single-select' || field.type === 'multi-select') && (!field.options || field.options.length === 0)) {
      errors.push(`${name}.options is required.`);
      continue;
    }

    fields.push(field);
  }

  return { fields, errors };
};

const validateAnswers = (
  fields: FormFieldDefinition[],
  answers: unknown,
): { errors: string[]; normalizedAnswers: Record<string, string | number | boolean | string[] | null> } => {
  const errors: string[] = [];
  const normalizedAnswers: Record<string, string | number | boolean | string[] | null> = {};

  if (!isPlainObject(answers)) {
    return { errors: ['answers must be an object.'], normalizedAnswers };
  }

  const fieldMap = new Map(fields.map((field) => [field.name, field]));

  for (const key of Object.keys(answers)) {
    if (!fieldMap.has(key)) {
      errors.push(`Unexpected field: ${key}.`);
    }
  }

  for (const field of fields) {
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
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  shareSlug: string,
): Promise<FormRow | null> => {
  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('share_slug', shareSlug)
    .maybeSingle();

  if (error) throw error;
  return (data as FormRow | null) ?? null;
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

forms.get('/share/:shareSlug', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const form = await getFormByShareSlug(supabase, c.req.param('shareSlug'));
  if (!form) return c.json({ error: 'Form not found.' }, 404);
  if (!form.share_enabled) return c.json({ error: 'Share link is disabled for this form.' }, 403);
  if (form.requires_auth && !token) return c.json({ error: 'Authentication required.' }, 401);

  const { fields, errors } = normalizeSchema(form.schema || {});
  if (errors.length > 0) return c.json({ error: 'Stored form schema is invalid.', details: errors }, 500);

  return c.json(serializeForm(form, fields));
});

forms.post('/share/:shareSlug/answers', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);
  const form = await getFormByShareSlug(supabase, c.req.param('shareSlug'));

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
    const { data } = await supabase.auth.getUser(token);
    submittedBy = data.user?.id ?? null;
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
    const { data } = await supabase.auth.getUser(token);
    submittedBy = data.user?.id ?? null;
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