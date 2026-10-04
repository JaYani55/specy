import { supabase } from '@/lib/supabase';
import { isValidIanaTimezone, normalizeEventPageSlug } from '@/utils/eventPage';

export interface PublicEventPageLink {
  event_id: string;
  page_id: string;
  tenant_id: string;
  page_slug: string;
  page_status: 'draft' | 'published' | 'archived';
  page_updated_at: string;
}

export interface EventPageAggregate {
  id: string;
  page_id: string;
  tenant_id: string;
  date: string;
  time: string;
  end_time: string | null;
  duration_minutes: number | null;
  mode: 'live' | 'online' | 'hybrid' | null;
  product_id: number | null;
  timezone: string | null;
  custom_fields?: Record<string, unknown>;
}

export interface CreatePublicEventPageInput {
  tenant_id: string;
  schema_id: string;
  expected_definition_revision: number;
  event: {
    company: string;
    company_id?: string | null;
    date: string;
    time: string;
    end_time: string;
    duration_minutes: number;
    description?: string;
    status?: string;
    mode?: string;
    staff_members?: string[];
    requesting_mentors?: string[];
    accepted_mentors?: string[];
    declined_mentors?: string[];
    amount_requiredmentors?: number;
    required_staff_count?: number;
    required_trait_id?: number | null;
    product_id?: number | null;
    teams_link?: string;
    initial_selected_mentors?: string[];
    timezone: string;
    custom_fields?: Record<string, unknown>;
  };
  page_name: string;
  page_slug?: string;
  content?: Record<string, unknown>;
}

export interface EventPageMutationResult {
  event_id: string;
  page_id: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  updated_at: string;
}

export async function getEventPageAggregateByPage(pageId: string, tenantId: string): Promise<EventPageAggregate> {
  if (!tenantId) throw new Error('An active workspace is required to load an event page.');
  const { data, error } = await supabase
    .from('mentorbooking_events')
    .select('id, page_id, tenant_id, date, time, end_time, duration_minutes, mode, product_id, timezone, custom_fields')
    .eq('page_id', pageId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Event page not found in the selected workspace.');
  return data as EventPageAggregate;
}

export async function createPublicEventPage(input: CreatePublicEventPageInput): Promise<PublicEventPageLink> {
  if (!input.tenant_id) throw new Error('An active workspace is required to create an event.');
  if (!isValidIanaTimezone(input.event.timezone)) throw new Error('Choose a valid event timezone.');
  const { data, error } = await supabase.rpc('create_event_page_aggregate_with_custom_fields', {
    target_tenant_id: input.tenant_id,
    target_schema_id: input.schema_id,
    expected_definition_revision: input.expected_definition_revision,
    target_event: input.event,
    target_page_name: input.page_name.trim(),
    target_page_slug: normalizeEventPageSlug(input.page_slug || input.page_name),
    target_page_content: input.content ?? {},
    target_event_custom_fields: input.event.custom_fields ?? {},
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Event page creation returned no result.');
  return data as PublicEventPageLink;
}

export async function updateEventPage(input: {
  event_id: string;
  tenant_id: string;
  expected_definition_revision: number;
  expected_page_updated_at: string;
  name: string;
  slug: string;
  content: Record<string, unknown>;
}): Promise<EventPageMutationResult> {
  if (!input.tenant_id) throw new Error('An active workspace is required to save an event page.');
  const { data, error } = await supabase.rpc('update_event_page_aggregate', {
    target_event_id: input.event_id,
    expected_tenant_id: input.tenant_id,
    expected_definition_revision: input.expected_definition_revision,
    expected_page_updated_at: input.expected_page_updated_at,
    target_page_name: input.name.trim(),
    target_page_slug: normalizeEventPageSlug(input.slug),
    target_page_content: input.content,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Event page update returned no result.');
  return data as EventPageMutationResult;
}

export async function setEventPagePublication(input: {
  event_id: string;
  tenant_id: string;
  expected_definition_revision: number;
  expected_page_updated_at: string;
  status: 'draft' | 'published' | 'archived';
}): Promise<EventPageMutationResult> {
  if (!input.tenant_id) throw new Error('An active workspace is required to change event publication.');
  const { data, error } = await supabase.rpc('set_event_page_publication', {
    target_event_id: input.event_id,
    expected_tenant_id: input.tenant_id,
    expected_definition_revision: input.expected_definition_revision,
    expected_page_updated_at: input.expected_page_updated_at,
    target_status: input.status,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Event page publication returned no result.');
  return data as EventPageMutationResult;
}
