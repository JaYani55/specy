import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610050001_backfill_event_registration_capacity.sql', import.meta.url), 'utf8');

describe('legacy Event registration and participant capacity backfill', () => {
  it('maps explicit localized registration labels and typed custom values', () => {
    assert.match(migration, /when 'anmeldung offen' then 'open'/);
    assert.match(migration, /when 'warteliste' then 'waitlist'/);
    assert.match(migration, /when 'ausgebucht' then 'full'/);
    assert.match(migration, /event_row\.page_content ->> 'status'/);
    assert.match(migration, /event_row\.custom_fields ->> 'registration_status'/);
  });

  it('reads legacy camelCase and current snake_case participant fields without guessing', () => {
    assert.match(migration, /custom_fields -> 'participantMin'/);
    assert.match(migration, /custom_fields -> 'participantMax'/);
    assert.match(migration, /page_content -> 'participantMin'/);
    assert.match(migration, /page_content -> 'participantMax'/);
    assert.match(migration, /raw_value !~ '\^\[0-9\]\+\(\\\.0\+\)\?\$'/);
    assert.match(migration, /Do not guess which conflicting legacy value is correct/);
  });

  it('preserves already-populated structured values and is safe to rerun', () => {
    assert.match(migration, /coalesce\(event_row\.registration_status, normalized_status\)/);
    assert.match(migration, /coalesce\(event_row\.participant_min, inferred_min\)/);
    assert.match(migration, /coalesce\(event_row\.participant_max, inferred_max\)/);
    assert.match(migration, /where e\.registration_status is null[\s\S]*e\.participant_max is null/);
  });
});
