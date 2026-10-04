import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectPublicCustomFields } from '../api/lib/customFields.ts';

const route = readFileSync(new URL('../api/routes/products.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/202610040003_product_event_custom_fields.sql', import.meta.url), 'utf8');

describe('dynamic product/event custom fields', () => {
  it('projects only configured public fields and leaves private/undefined data out', () => {
    assert.deepEqual(projectPublicCustomFields({
      registration_status: { type: 'string', is_public: true },
      internal_note: { type: 'string', is_public: false },
      not_configured: { type: 'string', is_public: true },
      invalid_number: { type: 'number', is_public: true },
    }, {
      registration_status: 'open',
      internal_note: 'internal',
      invalid_number: 'not-a-number',
    }), { registration_status: 'open' });
  });

  it('stores custom values independently for both entity types and adds a public workspace slug endpoint', () => {
    assert.match(migration, /mentorbooking_products[\s\S]*custom_fields jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /mentorbooking_events[\s\S]*custom_fields jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /tenant_custom_field_definitions/);
    assert.match(route, /products\.get\('\/:workspaceSlug\/:productSlug'/);
    assert.match(route, /createSupabaseAdminClient\(c\.env\)/);
    assert.match(route, /\.eq\('status', 'published'\)/);
    assert.match(route, /entity_kind', 'service-product'/);
    assert.match(route, /registration_status', 'registered'/);
    assert.match(route, /events: publicEvents/);
    assert.match(route, /projectPublicCustomFields\(eventFieldDefinition\?\.definitions, event\.custom_fields\)/);
  });
});
