export function sanitizeRevalidationDiagnostic(message: string, secretValue: string | null): string {
  let sanitized = message.slice(0, 4096);
  if (secretValue) {
    for (const secret of new Set([secretValue, encodeURIComponent(secretValue)])) {
      if (secret) sanitized = sanitized.split(secret).join('[redacted]');
    }
  }
  return sanitized
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/([?&]secret=)[^&\s"'<>]+/gi, '$1[redacted]')
    .slice(0, 1500);
}
