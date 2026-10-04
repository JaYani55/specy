import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIanaTimezone, normalizeEventPageSlug } from '../src/utils/eventPage.ts';

describe('event page helpers', () => {
  it('requires a recognized IANA timezone for public event pages', () => {
    assert.equal(isValidIanaTimezone('Europe/Berlin'), true);
    assert.equal(isValidIanaTimezone('UTC'), true);
    assert.equal(isValidIanaTimezone(''), false);
    assert.equal(isValidIanaTimezone('Not/A_Timezone'), false);
  });

  it('normalizes page slugs without depending on event display content', () => {
    assert.equal(normalizeEventPageSlug('Sommer-Workshop Ä & Ö'), 'sommer-workshop-ae-oe');
    assert.equal(normalizeEventPageSlug('themenwerkstatt_22102026'), 'themenwerkstatt-22102026');
    assert.equal(normalizeEventPageSlug('!!!'), 'event');
  });
});
