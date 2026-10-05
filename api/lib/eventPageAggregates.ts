import { normalizeSchemaPageSlug } from './schemaPages.ts';
import { CATALOGUE_ENTITY_KINDS, type SchemaEntityKindValue } from './schemaKinds.ts';
import type { createSupabaseClient } from './supabase';

export interface EventPageCreateInput {
  tenant_id: string;
  expected_definition_revision: number;
  name: string;
  slug?: string;
  content: Record<string, unknown>;
  event: {
    company: string;
    company_id?: string | null;
    product_id?: string | null;
    date: string;
    time: string;
    duration_minutes: number;
    timezone: string;
    mode?: 'live' | 'online' | 'hybrid';
    required_staff_count?: number;
    required_trait_id?: number | null;
    description?: string;
    custom_fields?: Record<string, unknown>;
    registration_status?: 'open' | 'waitlist' | 'full' | 'closed' | 'cancelled' | null;
    participant_min?: number | null;
    participant_max?: number | null;
  };
}

export class EventPageAggregateError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'EventPageAggregateError';
    this.status = status;
    this.code = code;
  }
}

type UserClient = Awaited<ReturnType<typeof createSupabaseClient>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return Boolean(value.trim());
  } catch {
    return false;
  }
}

function validateContent(content: unknown): content is Record<string, unknown> {
  if (!isRecord(content)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(content)).byteLength <= 1048576;
  } catch {
    return false;
  }
}

export function parseEventPageCreateInput(input: unknown):
  | { ok: true; value: EventPageCreateInput }
  | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: 'Request body must be a JSON object.' };
  if (!isUuid(input.tenant_id) || !Number.isSafeInteger(input.expected_definition_revision) || Number(input.expected_definition_revision) < 1) {
    return { ok: false, error: 'tenant_id and positive expected_definition_revision are required.' };
  }
  if (typeof input.name !== 'string' || !input.name.trim()) return { ok: false, error: 'name is required.' };
  if (input.slug !== undefined && typeof input.slug !== 'string') return { ok: false, error: 'slug must be a string.' };
  if (!validateContent(input.content)) return { ok: false, error: 'content must be a JSON object no larger than 1 MiB.' };
  if (!isRecord(input.event)) return { ok: false, error: 'event details are required for event schemas.' };

  const event = input.event;
  if (typeof event.company !== 'string' || !event.company.trim()) return { ok: false, error: 'event.company is required by the operational event record.' };
  const parsedDate = typeof event.date === 'string' ? new Date(`${event.date}T00:00:00Z`) : null;
  if (typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)
    || !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== event.date) {
    return { ok: false, error: 'event.date must be a valid YYYY-MM-DD date.' };
  }
  if (typeof event.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) return { ok: false, error: 'event.time must use HH:mm.' };
  if (!Number.isSafeInteger(event.duration_minutes) || Number(event.duration_minutes) < 1) return { ok: false, error: 'event.duration_minutes must be a positive integer.' };
  if (typeof event.timezone !== 'string' || !isTimezone(event.timezone)) return { ok: false, error: 'event.timezone must be a valid IANA timezone.' };
  if (event.product_id !== undefined && event.product_id !== null && !isUuid(event.product_id)) {
    return { ok: false, error: 'event.product_id must be a service-product UUID.' };
  }
  if (event.company_id !== undefined && event.company_id !== null && !isUuid(event.company_id)) {
    return { ok: false, error: 'event.company_id must be a UUID or null.' };
  }
  if (event.mode !== undefined && !['live', 'online', 'hybrid'].includes(String(event.mode))) return { ok: false, error: 'event.mode must be live, online, or hybrid.' };
  if (event.required_staff_count !== undefined && (!Number.isSafeInteger(event.required_staff_count) || Number(event.required_staff_count) < 1)) {
    return { ok: false, error: 'event.required_staff_count must be a positive integer.' };
  }
  if (event.required_trait_id !== undefined && event.required_trait_id !== null && (!Number.isSafeInteger(event.required_trait_id) || Number(event.required_trait_id) < 1)) {
    return { ok: false, error: 'event.required_trait_id must be a positive integer or null.' };
  }
  if (event.description !== undefined && typeof event.description !== 'string') return { ok: false, error: 'event.description must be a string.' };
  if (event.custom_fields !== undefined && !validateContent(event.custom_fields)) return { ok: false, error: 'event.custom_fields must be a JSON object no larger than 1 MiB.' };
  if (event.registration_status !== undefined && event.registration_status !== null
    && !['open', 'waitlist', 'full', 'closed', 'cancelled'].includes(String(event.registration_status))) {
    return { ok: false, error: 'event.registration_status must be open, waitlist, full, closed, cancelled, or null.' };
  }
  for (const [key, value] of [['participant_min', event.participant_min], ['participant_max', event.participant_max]] as const) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || Number(value) < 1)) {
      return { ok: false, error: `event.${key} must be a positive integer or null.` };
    }
  }
  if (typeof event.participant_min === 'number' && typeof event.participant_max === 'number'
    && event.participant_min > event.participant_max) {
    return { ok: false, error: 'event.participant_min cannot exceed event.participant_max.' };
  }

  const slug = typeof input.slug === 'string' && input.slug.trim() ? input.slug : input.name;
  return {
    ok: true,
    value: {
      tenant_id: input.tenant_id,
      expected_definition_revision: Number(input.expected_definition_revision),
      name: input.name.trim(),
      slug: normalizeSchemaPageSlug(slug),
      content: input.content,
      event: {
        company: event.company.trim(),
        ...(typeof event.company_id === 'string' ? { company_id: event.company_id } : {}),
        ...(typeof event.product_id === 'string' ? { product_id: event.product_id } : {}),
        date: event.date,
        time: event.time,
        duration_minutes: Number(event.duration_minutes),
        timezone: event.timezone,
        ...(typeof event.mode === 'string' ? { mode: event.mode as EventPageCreateInput['event']['mode'] } : {}),
        ...(typeof event.required_staff_count === 'number' ? { required_staff_count: event.required_staff_count } : {}),
        ...(typeof event.required_trait_id === 'number' || event.required_trait_id === null ? { required_trait_id: event.required_trait_id as number | null } : {}),
        ...(typeof event.description === 'string' ? { description: event.description } : {}),
        ...(isRecord(event.custom_fields) ? { custom_fields: event.custom_fields } : {}),
        ...(typeof event.registration_status === 'string' || event.registration_status === null
          ? { registration_status: event.registration_status as EventPageCreateInput['event']['registration_status'] } : {}),
        ...(typeof event.participant_min === 'number' || event.participant_min === null
          ? { participant_min: event.participant_min as number | null } : {}),
        ...(typeof event.participant_max === 'number' || event.participant_max === null
          ? { participant_max: event.participant_max as number | null } : {}),
      },
    },
  };
}

export async function createEventPageAggregate(
  client: UserClient,
  schema: { id: string; api_slug: string; tenant_id: string | null; entity_kind: string | null; content_scope: string | null; definition_revision: number | null },
  input: EventPageCreateInput,
) {
  if (!schema.tenant_id || schema.tenant_id !== input.tenant_id) {
    throw new EventPageAggregateError('Event schema does not belong to the requested workspace.', 404, 'P0002');
  }
  if (!CATALOGUE_ENTITY_KINDS.includes(schema.entity_kind as SchemaEntityKindValue) || schema.content_scope !== 'page-collection') {
    throw new EventPageAggregateError('Selected schema is not a catalogue page collection.', 409, '23514');
  }
  if (schema.definition_revision !== input.expected_definition_revision) {
    throw new EventPageAggregateError('Schema definition revision conflict.', 409, '40001');
  }

  let legacyProductId: number | null = null;
  if (input.event.product_id) {
    const { data: product, error } = await client.from('mentorbooking_products')
      .select('id')
      .eq('integration_id', input.event.product_id)
      .eq('tenant_id', input.tenant_id)
      .is('retired_at', null)
      .maybeSingle();
    if (error) throw new EventPageAggregateError(error.message, error.code === '42501' ? 403 : 500, error.code);
    if (!product) throw new EventPageAggregateError('Selected product not found in the requested workspace.', 404, 'P0002');
    legacyProductId = product.id as number;
  }

  const { data, error } = await client.rpc('create_event_page_aggregate_with_custom_fields', {
    target_tenant_id: input.tenant_id,
    target_schema_id: schema.id,
    expected_definition_revision: input.expected_definition_revision,
    target_event: {
      company: input.event.company,
      company_id: input.event.company_id ?? null,
      product_id: legacyProductId,
      date: input.event.date,
      time: input.event.time,
      end_time: (() => {
        const [hour, minute] = input.event.time.split(':').map(Number);
        const end = (hour * 60 + minute + input.event.duration_minutes) % (24 * 60);
        return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      })(),
      duration_minutes: input.event.duration_minutes,
      timezone: input.event.timezone,
      mode: input.event.mode ?? 'online',
      registration_status: input.event.registration_status ?? null,
      participant_min: input.event.participant_min ?? null,
      participant_max: input.event.participant_max ?? null,
      required_staff_count: input.event.required_staff_count ?? 1,
      amount_requiredmentors: input.event.required_staff_count ?? 1,
      required_trait_id: input.event.required_trait_id ?? null,
      description: input.event.description ?? '',
      staff_members: [],
      requesting_mentors: [],
      accepted_mentors: [],
      declined_mentors: [],
      initial_selected_mentors: [],
      teams_link: '',
    },
    target_page_name: input.name,
    target_page_slug: input.slug,
    target_page_content: input.content,
    target_event_custom_fields: input.event.custom_fields ?? {},
  });
  if (error) {
    const status = error.code === 'P0002' ? 404
      : error.code === '23514' || error.code === '23505' || error.code === '40001' ? 409
        : error.code === '22023' || error.code === '22P02' ? 400
          : error.code === '42501' ? 403 : 500;
    throw new EventPageAggregateError(error.message, status, error.code);
  }
  if (!data) throw new EventPageAggregateError('Event page creation returned no result.', 500);
  return data;
}

export interface EventPageUpdateInput {
  tenant_id: string;
  expected_definition_revision: number;
  expected_page_updated_at: string;
  content?: Record<string, unknown>;
  name?: string;
  slug?: string;
  status?: 'draft' | 'published' | 'archived';
}

export async function updateEventPageAggregate(
  client: UserClient,
  schema: { id: string; tenant_id: string | null; entity_kind: string | null; definition_revision: number | null },
  pageId: string,
  input: EventPageUpdateInput,
) {
  if (!schema.tenant_id || schema.tenant_id !== input.tenant_id) {
    throw new EventPageAggregateError('Event schema does not belong to the requested workspace.', 404, 'P0002');
  }
  if (schema.entity_kind !== 'event' && schema.entity_kind !== 'service-product') {
    throw new EventPageAggregateError('This schema does not contain event pages.', 409, '23514');
  }
  if (schema.definition_revision !== input.expected_definition_revision) {
    throw new EventPageAggregateError('Schema definition revision conflict.', 409, '40001');
  }
  const { data: page, error: pageError } = await client.from('pages')
    .select('id, schema_id, tenant_id, name, slug, content, status, updated_at')
    .eq('id', pageId)
    .eq('schema_id', schema.id)
    .eq('tenant_id', input.tenant_id)
    .maybeSingle();
  if (pageError) throw new EventPageAggregateError(pageError.message, pageError.code === '42501' ? 403 : 500, pageError.code);
  if (!page) throw new EventPageAggregateError('Event page not found in the requested workspace.', 404, 'P0002');
  const { data: event, error: eventError } = await client.from('mentorbooking_events')
    .select('id')
    .eq('page_id', pageId)
    .eq('tenant_id', input.tenant_id)
    .maybeSingle();
  if (eventError) throw new EventPageAggregateError(eventError.message, eventError.code === '42501' ? 403 : 500, eventError.code);
  if (!event) throw new EventPageAggregateError('No operational event is linked to this page.', 404, 'P0002');
  if (page.updated_at !== input.expected_page_updated_at) {
    throw new EventPageAggregateError('Event page version conflict. Reload the page and retry.', 409, '40001');
  }
  if (input.content === undefined && input.name === undefined && input.slug === undefined && input.status === undefined) {
    throw new EventPageAggregateError('Provide content, name, slug, or status to update.', 400, '22023');
  }
  if (input.content === undefined && input.name === undefined && input.slug === undefined && input.status !== undefined) {
    const { data, error } = await client.rpc('set_event_page_publication', {
      target_event_id: event.id,
      expected_tenant_id: input.tenant_id,
      expected_definition_revision: input.expected_definition_revision,
      expected_page_updated_at: input.expected_page_updated_at,
      target_status: input.status,
    });
    if (error) {
      const status = error.code === 'P0002' ? 404
        : error.code === '23514' || error.code === '23505' || error.code === '40001' ? 409
          : error.code === '22023' || error.code === '22P02' ? 400
            : error.code === '42501' ? 403 : 500;
      throw new EventPageAggregateError(error.message, status, error.code);
    }
    if (!data) throw new EventPageAggregateError('Event page publication returned no result.', 500);
    return data;
  }
  const content = input.content ?? page.content as Record<string, unknown>;
  if (!validateContent(content)) throw new EventPageAggregateError('content must be a JSON object no larger than 1 MiB.', 400, '22023');

  const { data: updated, error: updateError } = await client.rpc('update_event_page_aggregate', {
    target_event_id: event.id,
    expected_tenant_id: input.tenant_id,
    expected_definition_revision: input.expected_definition_revision,
    expected_page_updated_at: input.expected_page_updated_at,
    target_page_name: input.name?.trim() || page.name,
    target_page_slug: normalizeSchemaPageSlug(input.slug?.trim() || page.slug),
    target_page_content: content,
  });
  if (updateError) {
    const status = updateError.code === 'P0002' ? 404
      : updateError.code === '23514' || updateError.code === '23505' || updateError.code === '40001' ? 409
        : updateError.code === '22023' || updateError.code === '22P02' ? 400
          : updateError.code === '42501' ? 403 : 500;
    throw new EventPageAggregateError(updateError.message, status, updateError.code);
  }
  if (!updated) throw new EventPageAggregateError('Event page update returned no result.', 500);
  if (!input.status) return updated;

  const updatedRecord = updated as { updated_at: string };
  const { data: published, error: publicationError } = await client.rpc('set_event_page_publication', {
    target_event_id: event.id,
    expected_tenant_id: input.tenant_id,
    expected_definition_revision: input.expected_definition_revision,
    expected_page_updated_at: updatedRecord.updated_at,
    target_status: input.status,
  });
  if (publicationError) {
    const status = publicationError.code === 'P0002' ? 404
      : publicationError.code === '23514' || publicationError.code === '23505' || publicationError.code === '40001' ? 409
        : publicationError.code === '22023' || publicationError.code === '22P02' ? 400
          : publicationError.code === '42501' ? 403 : 500;
    throw new EventPageAggregateError(publicationError.message, status, publicationError.code);
  }
  return published ?? updated;
}
