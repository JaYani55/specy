import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610030001_event_page_aggregates.sql', import.meta.url), 'utf8');
const createEvent = readFileSync(new URL('../src/pages/CreateEvent.tsx', import.meta.url), 'utf8');
const pageBuilder = readFileSync(new URL('../src/features/page-builder/PageBuilderPage.tsx', import.meta.url), 'utf8');
const schemasRoute = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
const mcpRoute = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');


describe('event page integration contract', () => {
  it('links at most one event page and checks tenant/schema ownership in the database', () => {
    assert.match(migration, /add column if not exists page_id uuid null/i);
    assert.match(migration, /foreign key \(page_id\) references public\.pages\(id\) on delete restrict/i);
    assert.match(migration, /create unique index if not exists mentorbooking_events_page_id_key/i);
    assert.match(migration, /Selected product does not belong to the event workspace/i);
    assert.match(migration, /Selected company does not belong to the event workspace/i);
    assert.match(migration, /Event pages must use an event page-collection schema/i);
    assert.match(migration, /enforce_event_page_link[\s\S]*deferrable initially deferred/i);
  });

  it('creates the event and draft page atomically through caller-scoped RPCs', () => {
    assert.match(migration, /create or replace function public\.create_event_page_aggregate/i);
    assert.match(migration, /security invoker/i);
    assert.match(migration, /set_config\('specy\.event_page_write', 'on', true\)/i);
    assert.match(migration, /grant execute on function public\.create_event_page_aggregate[\s\S]*to authenticated/i);
    assert.match(createEvent, /createPublicEventPage\(/);
    assert.match(createEvent, /tenant_id: activeTenantId/);
    assert.match(migration, /values \(btrim\(target_page_name\), target_page_slug, 'draft'/i);
  });

  it('rejects generic event page writes and removes linked pages when events are deleted', () => {
    assert.match(migration, /Event pages must be changed through the event aggregate service/i);
    assert.match(migration, /create or replace function public\.delete_event_page_after_event_delete/i);
    assert.match(migration, /delete from public\.pages where id = old\.page_id and tenant_id = old\.tenant_id/i);
    assert.match(pageBuilder, /getEventPageAggregateByPage/);
  });

  it('exposes event-aware REST and MCP Pages post/update operations', () => {
    assert.match(schemasRoute, /schemas\.post\('\/:slug\/pages'/);
    assert.match(schemasRoute, /schemas\.patch\('\/:slug\/pages\/:pageId'/);
    assert.match(mcpRoute, /eventPageCreateDetailsSchema/);
    assert.match(mcpRoute, /createEventPageAggregate\(supabase, schema, parsed\.value\)/);
    assert.match(mcpRoute, /updateEventPageAggregate\(supabase, schema, page_id/);
  });

  it('serves event pages only through registered schema delivery and allow-listed projections', () => {
    assert.doesNotMatch(schemasRoute, /Event public delivery is not enabled for this schema yet/);
    assert.match(schemasRoute, /projectPublicEventRelations/);
    assert.match(schemasRoute, /\.eq\('tenant_id', schema\.tenant_id\)/);
    assert.match(schemasRoute, /\.eq\('status', 'published'\)/);
    assert.match(schemasRoute, /supported_includes: entityKind === 'service-product' \? \['entity'\] : entityKind === 'event'/);
  });
});
