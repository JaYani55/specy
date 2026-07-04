import type { PluginHookContribution } from '../../src/types/plugin';
import { getRegisteredApiPluginHooks } from '../plugin-hooks';
import type { Env } from './supabase';

export interface FormUploadedFileValue {
  name: string;
  path: string;
  url: string;
  download_url?: string;
  bucket: string;
  content_type: string | null;
  size: number | null;
}

export interface FormUploadFormRef {
  id: string;
  name: string;
  slug: string;
  share_slug: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
}

export interface FormUploadFieldRef {
  name: string;
  label: string;
  type: string;
  upload_provider?: string;
  upload_folder?: string;
}

export interface FormFileUploadHookContext {
  env: Env;
  requestUrl: string;
  form: FormUploadFormRef;
  field: FormUploadFieldRef;
  file: File;
  submissionId: string;
  handled: boolean;
  fileValue: FormUploadedFileValue | null;
  error: string | null;
}

export interface FormFileNotificationLink {
  fieldName: string;
  fieldLabel: string;
  fileName: string;
  url: string;
}

export type FormAnswerValue = string | number | boolean | string[] | FormUploadedFileValue | Record<string, unknown> | null;

export interface FormFileNotificationHookContext {
  requestUrl: string;
  form: FormUploadFormRef;
  answerId: string;
  answers: Record<string, FormAnswerValue>;
  fields: FormUploadFieldRef[];
  fileLinks: FormFileNotificationLink[];
}

export const FORM_FILE_UPLOAD_HOOK = 'forms.fileUpload.upload';
export const FORM_FILE_NOTIFICATION_HOOK = 'forms.fileUpload.notification';

const DEFAULT_HOOK_ORDER = 100;

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

function getApiPluginHooks(target: string): PluginHookContribution[] {
  return getRegisteredApiPluginHooks().filter((hook) => hook.target === target);
}

export async function runFormFileUploadHooks(context: FormFileUploadHookContext): Promise<FormFileUploadHookContext> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(FORM_FILE_UPLOAD_HOOK))) {
    nextContext = await hook.handler(nextContext) as FormFileUploadHookContext;
    if (nextContext.handled) {
      break;
    }
  }

  return nextContext;
}

export async function runFormFileNotificationHooks(context: FormFileNotificationHookContext): Promise<FormFileNotificationHookContext> {
  let nextContext = context;

  for (const hook of sortHooks(getApiPluginHooks(FORM_FILE_NOTIFICATION_HOOK))) {
    nextContext = await hook.handler(nextContext) as FormFileNotificationHookContext;
  }

  return nextContext;
}