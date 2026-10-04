import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeRevalidationDiagnostic } from '../api/lib/revalidationDiagnostics.ts';

describe('revalidation diagnostics', () => {
  it('redacts configured secrets and bearer tokens from upstream errors', () => {
    const message = '401 for secret=top-secret Authorization: Bearer eyJhbGciOi.example-token';
    const sanitized = sanitizeRevalidationDiagnostic(message, 'top-secret');
    assert.equal(sanitized.includes('top-secret'), false);
    assert.equal(sanitized.includes('example-token'), false);
    assert.match(sanitized, /\[redacted\]/);
  });

  it('redacts encoded secrets and bounds diagnostic response size', () => {
    const encodedSecret = encodeURIComponent('secret value/with+symbols');
    const sanitized = sanitizeRevalidationDiagnostic(`${encodedSecret} ${'x'.repeat(5000)}`, 'secret value/with+symbols');
    assert.equal(sanitized.includes(encodedSecret), false);
    assert.ok(sanitized.length <= 1500);
  });

  it('returns per-target path/status errors and sanitized upstream feedback', () => {
    const route = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
    assert.match(route, /sanitizeRevalidationDiagnostic\(parsed\.error \|\| parsed\.message \|\| bodyText, secretValue\)/);
    assert.match(route, /status: response\.status,[\s\S]*endpoint,[\s\S]*message: response\.ok/);
    assert.match(route, /status: 0,[\s\S]*endpoint,[\s\S]*message: sanitizeRevalidationDiagnostic/);
  });
});
