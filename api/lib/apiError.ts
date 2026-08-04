export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_INVALID'
  | 'SCHEMA_NOT_FOUND'
  | 'SCHEMA_NOT_PUBLIC'
  | 'SCHEMA_REGISTRATION_STATE_INVALID'
  | 'REGISTRATION_CODE_INVALID'
  | 'REVALIDATION_SECRET_REQUIRED'
  | 'REVALIDATION_NOT_CONFIGURED'
  | 'REVALIDATION_UPSTREAM_UNAUTHORIZED'
  | 'REVALIDATION_UPSTREAM_FAILURE'
  | 'SINGLE_PAGE_CREATE_NOT_ALLOWED'
  | 'INTERNAL_SCHEMA_MISMATCH';

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  request_id?: string;
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  options?: Omit<ApiErrorPayload, 'code' | 'message'>,
): { error: ApiErrorPayload } {
  return {
    error: {
      code,
      message,
      ...options,
    },
  };
}

export function serializeMcpError(
  code: ApiErrorCode,
  message: string,
  options?: Omit<ApiErrorPayload, 'code' | 'message'>,
): string {
  return JSON.stringify(apiError(code, message, options), null, 2);
}
