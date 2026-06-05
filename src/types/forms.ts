export type FormStatus = 'published' | 'archived';

export type FormType = 'form' | 'poll';
export type VotingMode = 'live' | 'deadline';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'help-text'
  | 'image'
  | 'email'
  | 'number'
  | 'file-upload'
  | 'checkbox'
  | 'single-select'
  | 'multi-select'
  | 'select'
  | 'radio'
  | 'date'
  | 'consent-poll'
  | 'consent-vote';

export interface FormUploadedFileValue {
  name: string;
  path: string;
  url: string;
  download_url?: string;
  bucket: string;
  content_type: string | null;
  size: number | null;
}

export type FormAnswerValue = string | number | boolean | string[] | FormUploadedFileValue | null;

export interface FormFieldDefinition {
  editorId?: string;
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
  allow_custom?: boolean;
  upload_provider?: string;
  upload_mount?: string;
  upload_bucket?: string;
  upload_folder?: string;
}

export type FormSchemaDefinition = Record<string, Omit<FormFieldDefinition, 'name'>>;

export interface FormNotificationRecipient {
  id: string;
  staff_id: string;
  display_name: string;
  email: string | null;
  account_user_id: string | null;
}

export interface FormNotificationSettings {
  notify_owner: boolean;
  notify_staff: boolean;
  delete_answer_after_email: boolean;
  recipients: FormNotificationRecipient[];
}

export interface FormNotificationStaffOption {
  id: string;
  display_name: string;
  email: string | null;
  account_user_id: string | null;
}

export interface FormRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: FormType;
  schema: FormSchemaDefinition;
  llm_instructions: string | null;
  status: FormStatus;
  share_enabled: boolean;
  share_slug: string | null;
  requires_auth: boolean;
  api_enabled: boolean;
  allow_anonymous: boolean;
  voting_mode: VotingMode;
  deadline_at: string | null;
  reminder_interval: string | null;
  reminder_sent_at: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
  notification_settings?: FormNotificationSettings | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface FormAnswerRecord {
  id: string;
  form_id: string;
  submitted_by: string | null;
  submitter_name: string | null;
  answers: Record<string, FormAnswerValue>;
  source_slug: string | null;
  submitted_via: 'share' | 'api' | 'page';
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PublicFormDefinition {
  form: Pick<FormRecord, 'id' | 'name' | 'slug' | 'description' | 'type' | 'status' | 'share_enabled' | 'share_slug' | 'requires_auth' | 'api_enabled' | 'allow_anonymous' | 'voting_mode' | 'deadline_at'>;
  fields: FormFieldDefinition[];
  llm_instructions: string | null;
}

export interface ParsedFormSchemaResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fields: FormFieldDefinition[];
  normalizedSchema: FormSchemaDefinition | null;
}