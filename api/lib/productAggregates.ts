import { normalizeSchemaPageSlug } from './schemaPages.ts';

export interface CreateServiceProductInput {
  tenant_id: string;
  schema_id: string;
  expected_definition_revision: number;
  name: string;
  slug?: string;
  content: Record<string, unknown>;
  idempotency_key: string;
}

export interface UpdateServiceProductInput {
  tenant_id: string;
  expected_version: number;
  expected_definition_revision: number;
  name?: string;
  slug?: string;
  content?: Record<string, unknown>;
}

export type InputResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseCreateServiceProductInput(input: unknown): InputResult<CreateServiceProductInput> {
  if (!isRecord(input)) return { ok: false, error: 'Request body must be a JSON object.' };
  if (!isUuid(input.tenant_id) || !isUuid(input.schema_id) || !isUuid(input.idempotency_key)) {
    return { ok: false, error: 'tenant_id, schema_id, and idempotency_key must be UUIDs.' };
  }
  if (!Number.isSafeInteger(input.expected_definition_revision) || Number(input.expected_definition_revision) < 1) {
    return { ok: false, error: 'expected_definition_revision must be a positive integer.' };
  }
  if (typeof input.name !== 'string' || !input.name.trim()) return { ok: false, error: 'name is required.' };
  if (!isRecord(input.content)) return { ok: false, error: 'content must be a JSON object.' };
  const slug = normalizeSchemaPageSlug(typeof input.slug === 'string' && input.slug.trim() ? input.slug : input.name);
  if (new TextEncoder().encode(JSON.stringify(input.content)).byteLength > 1048576) {
    return { ok: false, error: 'content exceeds the 1 MiB limit.' };
  }
  return {
    ok: true,
    value: {
      tenant_id: input.tenant_id,
      schema_id: input.schema_id,
      expected_definition_revision: Number(input.expected_definition_revision),
      name: input.name.trim(),
      slug,
      content: input.content,
      idempotency_key: input.idempotency_key,
    },
  };
}

export function parseUpdateServiceProductInput(input: unknown): InputResult<UpdateServiceProductInput> {
  if (!isRecord(input)) return { ok: false, error: 'Request body must be a JSON object.' };
  if (!isUuid(input.tenant_id)) return { ok: false, error: 'tenant_id must be a UUID.' };
  if (!Number.isSafeInteger(input.expected_version) || Number(input.expected_version) < 1) {
    return { ok: false, error: 'expected_version must be a positive integer.' };
  }
  if (!Number.isSafeInteger(input.expected_definition_revision) || Number(input.expected_definition_revision) < 1) {
    return { ok: false, error: 'expected_definition_revision must be a positive integer.' };
  }
  if (input.name === undefined && input.slug === undefined && input.content === undefined) {
    return { ok: false, error: 'Provide at least one product field to update.' };
  }
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
    return { ok: false, error: 'name must be a non-empty string.' };
  }
  if (input.slug !== undefined && (typeof input.slug !== 'string' || !input.slug.trim())) {
    return { ok: false, error: 'slug must be a non-empty string.' };
  }
  if (input.content !== undefined && !isRecord(input.content)) {
    return { ok: false, error: 'content must be a JSON object.' };
  }
  const value: UpdateServiceProductInput = {
    tenant_id: input.tenant_id,
    expected_version: Number(input.expected_version),
    expected_definition_revision: Number(input.expected_definition_revision),
    ...(typeof input.name === 'string' ? { name: input.name.trim() } : {}),
    ...(typeof input.slug === 'string' ? { slug: normalizeSchemaPageSlug(input.slug) } : {}),
    ...(isRecord(input.content) ? { content: input.content } : {}),
  };
  if (value.content && new TextEncoder().encode(JSON.stringify(value.content)).byteLength > 1048576) {
    return { ok: false, error: 'content exceeds the 1 MiB limit.' };
  }
  return { ok: true, value };
}
