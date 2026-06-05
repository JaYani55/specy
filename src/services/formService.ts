import { supabase } from '@/lib/supabase';
import { API_URL } from '@/lib/apiUrl';
import type {
  FormAnswerRecord,
  FormNotificationRecipient,
  FormNotificationSettings,
  FormNotificationStaffOption,
  FormUploadedFileValue,
  FormRecord,
  FormSchemaDefinition,
  PublicFormDefinition,
} from '@/types/forms';
import { generateFormSlug, validateShareSlug } from '@/utils/forms';

const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

const buildHeaders = async (): Promise<HeadersInit> => {
  const token = await getAuthToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

const buildAuthHeaders = async (): Promise<HeadersInit> => {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const getForms = async (): Promise<FormRecord[]> => {
  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as FormRecord[];
};

export const getPublishedForms = async (): Promise<FormRecord[]> => {
  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('status', 'published')
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as FormRecord[];
};

const getCurrentUserId = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  return data.user?.id ?? null;
};

const getFormNotificationSettings = async (formId: string): Promise<FormNotificationSettings> => {
  const [{ data: settingsRow, error: settingsError }, { data: recipientRows, error: recipientsError }] = await Promise.all([
    supabase
      .from('form_notification_settings')
      .select('notify_owner, notify_staff, delete_answer_after_email')
      .eq('form_id', formId)
      .maybeSingle(),
    supabase
      .from('form_notification_recipients')
      .select('id, staff_id')
      .eq('form_id', formId),
  ]);

  if (settingsError) throw new Error(settingsError.message);
  if (recipientsError) throw new Error(recipientsError.message);

  const staffIds = (recipientRows ?? []).map((row) => row.staff_id as string);
  let recipients: FormNotificationRecipient[] = [];

  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase
      .from('staff')
      .select('id, display_name, email, account_user_id')
      .in('id', staffIds)
      .order('display_name', { ascending: true });

    if (staffError) throw new Error(staffError.message);

    const staffMap = new Map((staffRows ?? []).map((row) => [row.id as string, row]));
    recipients = (recipientRows ?? []).map((row) => {
      const staff = staffMap.get(row.staff_id as string);
      return {
        id: row.id as string,
        staff_id: row.staff_id as string,
        display_name: (staff?.display_name as string | undefined) ?? 'Unknown',
        email: (staff?.email as string | null | undefined) ?? null,
        account_user_id: (staff?.account_user_id as string | null | undefined) ?? null,
      };
    });
  }

  return {
    notify_owner: Boolean(settingsRow?.notify_owner),
    notify_staff: Boolean(settingsRow?.notify_staff),
    delete_answer_after_email: Boolean(settingsRow?.delete_answer_after_email),
    recipients,
  };
};

const withNotificationSettings = async (form: FormRecord): Promise<FormRecord> => ({
  ...form,
  notification_settings: await getFormNotificationSettings(form.id),
});

interface SaveFormInput {
  name: string;
  description?: string;
  type?: FormRecord['type'];
  schema: FormSchemaDefinition;
  llm_instructions?: string;
  status: FormRecord['status'];
  share_enabled: boolean;
  share_slug?: string | null;
  requires_auth: boolean;
  api_enabled: boolean;
  allow_anonymous: boolean;
  voting_mode?: FormRecord['voting_mode'];
  deadline_at?: string | null;
  reminder_interval?: string | null;
  tenant_id?: string | null;
  notification_settings?: {
    notify_owner: boolean;
    notify_staff: boolean;
    delete_answer_after_email: boolean;
    staff_recipient_ids: string[];
  };
}

const normalizeInput = (input: SaveFormInput, ownerUserId?: string | null) => {
  const slug = generateFormSlug(input.name);
  const shareSlug = input.share_enabled ? generateFormSlug(input.share_slug || input.name) : null;

  if (input.share_enabled && shareSlug) {
    const shareSlugError = validateShareSlug(shareSlug);
    if (shareSlugError) throw new Error(shareSlugError);
  }

  return {
    name: input.name,
    slug,
    description: input.description || null,
    type: input.type || 'form',
    schema: input.schema,
    llm_instructions: input.llm_instructions || null,
    status: input.status,
    share_enabled: input.share_enabled,
    share_slug: shareSlug,
    requires_auth: input.requires_auth,
    api_enabled: input.api_enabled,
    allow_anonymous: input.allow_anonymous,
    voting_mode: input.voting_mode || 'live',
    deadline_at: input.deadline_at || null,
    reminder_interval: input.reminder_interval || null,
    tenant_id: input.tenant_id || null,
    owner_user_id: ownerUserId || null,
    published_at: input.status === 'published' ? new Date().toISOString() : null,
  };
};

const syncFormNotificationSettings = async (formId: string, notificationSettings?: SaveFormInput['notification_settings']): Promise<void> => {
  const normalized = {
    notify_owner: Boolean(notificationSettings?.notify_owner),
    notify_staff: Boolean(notificationSettings?.notify_staff),
    delete_answer_after_email: Boolean(notificationSettings?.delete_answer_after_email),
    staff_recipient_ids: [...new Set((notificationSettings?.staff_recipient_ids ?? []).filter(Boolean))],
  };

  const { error: upsertSettingsError } = await supabase
    .from('form_notification_settings')
    .upsert({
      form_id: formId,
      notify_owner: normalized.notify_owner,
      notify_staff: normalized.notify_staff,
      delete_answer_after_email: normalized.delete_answer_after_email,
    }, { onConflict: 'form_id' });

  if (upsertSettingsError) throw new Error(upsertSettingsError.message);

  const { data: existingRecipients, error: existingRecipientsError } = await supabase
    .from('form_notification_recipients')
    .select('staff_id')
    .eq('form_id', formId);

  if (existingRecipientsError) throw new Error(existingRecipientsError.message);

  const existingStaffIds = (existingRecipients ?? []).map((row) => row.staff_id as string);
  const staffIdsToDelete = existingStaffIds.filter((staffId) => !normalized.staff_recipient_ids.includes(staffId));
  const staffIdsToInsert = normalized.staff_recipient_ids.filter((staffId) => !existingStaffIds.includes(staffId));

  if (staffIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('form_notification_recipients')
      .delete()
      .eq('form_id', formId)
      .in('staff_id', staffIdsToDelete);

    if (deleteError) throw new Error(deleteError.message);
  }

  if (staffIdsToInsert.length > 0) {
    const { error: insertRecipientsError } = await supabase
      .from('form_notification_recipients')
      .insert(staffIdsToInsert.map((staffId) => ({ form_id: formId, staff_id: staffId })));

    if (insertRecipientsError) throw new Error(insertRecipientsError.message);
  }
};

export const getForm = async (idOrSlug: string): Promise<FormRecord> => {
  const bySlug = await supabase
    .from('forms')
    .select('*')
    .eq('slug', idOrSlug)
    .maybeSingle();

  if (bySlug.data) return withNotificationSettings(bySlug.data as FormRecord);

  const byId = await supabase
    .from('forms')
    .select('*')
    .eq('id', idOrSlug)
    .single();

  if (byId.error) throw new Error(byId.error.message);
  return withNotificationSettings(byId.data as FormRecord);
};

export const createForm = async (input: SaveFormInput): Promise<FormRecord> => {
  const ownerUserId = await getCurrentUserId();
  const payload = normalizeInput(input, ownerUserId);
  const { data, error } = await supabase
    .from('forms')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  const form = data as FormRecord;
  await syncFormNotificationSettings(form.id, input.notification_settings);
  return withNotificationSettings(form);
};

export const updateForm = async (id: string, input: SaveFormInput): Promise<FormRecord> => {
  const payload = normalizeInput(input);
  const { data, error } = await supabase
    .from('forms')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  const form = data as FormRecord;
  await syncFormNotificationSettings(form.id, input.notification_settings);
  return withNotificationSettings(form);
};

export const getFormNotificationStaffOptions = async (): Promise<FormNotificationStaffOption[]> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, display_name, email, account_user_id')
    .eq('status', 'active')
    .order('display_name', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    display_name: row.display_name as string,
    email: (row.email as string | null | undefined) ?? null,
    account_user_id: (row.account_user_id as string | null | undefined) ?? null,
  }));
};

export const deleteForm = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from('forms')
    .update({ status: 'archived', share_enabled: false })
    .eq('id', id);

  if (error) throw new Error(error.message);
};

export const getFormAnswers = async (formId: string): Promise<FormAnswerRecord[]> => {
  const { data, error } = await supabase
    .from('forms_answers')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as FormAnswerRecord[];
};

export const getPublicFormByShareSlug = async (tenantName: string, shareSlug: string): Promise<PublicFormDefinition> => {
  const response = await fetch(`${API_URL}/api/forms/share/${encodeURIComponent(tenantName)}/${encodeURIComponent(shareSlug)}`, {
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to load form.');
  }

  return response.json();
};

export const getApiFormDefinition = async (identifier: string): Promise<PublicFormDefinition> => {
  const response = await fetch(`${API_URL}/api/forms/${encodeURIComponent(identifier)}`, {
    headers: await buildHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to load form definition.');
  }

  return response.json();
};

export const submitFormAnswers = async (
  identifier: string | { tenantName: string; identifier: string },
  payload: {
    answers: Record<string, unknown>;
    submitter_name?: string;
    source_slug?: string;
    submitted_via?: 'share' | 'api' | 'page';
  },
  mode: 'share' | 'api' = 'share',
): Promise<{ success: boolean; answer_id: string }> => {
  const url = mode === 'share'
    ? (() => {
      if (typeof identifier === 'string') {
        throw new Error('Share form submission requires tenantName and identifier.');
      }
      return `${API_URL}/api/forms/share/${encodeURIComponent(identifier.tenantName)}/${encodeURIComponent(identifier.identifier)}/answers`;
    })()
    : `${API_URL}/api/forms/${encodeURIComponent(typeof identifier === 'string' ? identifier : identifier.identifier)}/answers`;

  const response = await fetch(url, {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to submit form answers.');
  }

  return response.json();
};

export const uploadFormFile = async (
  identifier: string | { tenantName: string; identifier: string },
  payload: {
    file: File;
    field_name: string;
    submission_id: string;
  },
  mode: 'share' | 'api' = 'share',
): Promise<FormUploadedFileValue> => {
  const url = mode === 'share'
    ? (() => {
      if (typeof identifier === 'string') {
        throw new Error('Share file upload requires tenantName and identifier.');
      }
      return `${API_URL}/api/forms/share/${encodeURIComponent(identifier.tenantName)}/${encodeURIComponent(identifier.identifier)}/upload`;
    })()
    : `${API_URL}/api/forms/${encodeURIComponent(typeof identifier === 'string' ? identifier : identifier.identifier)}/upload`;

  const formData = new FormData();
  formData.append('file', payload.file);
  formData.append('field_name', payload.field_name);
  formData.append('submission_id', payload.submission_id);

  const response = await fetch(url, {
    method: 'POST',
    headers: await buildAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to upload form file.');
  }

  const data = await response.json() as { file: FormUploadedFileValue };
  return data.file;
};