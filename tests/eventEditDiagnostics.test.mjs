import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editEvent = readFileSync(new URL('../src/pages/EditEvent.tsx', import.meta.url), 'utf8');
const revalidationFeedback = readFileSync(new URL('../src/components/revalidation/RevalidationFeedback.tsx', import.meta.url), 'utf8');

describe('event editing and revalidation feedback', () => {
  it('does not report success when RLS or workspace filters update zero event rows', () => {
    assert.match(editEvent, /\.select\('id'\)\s*\.maybeSingle\(\)/);
    assert.match(editEvent, /if \(!updatedEvent\) throw new Error/);
    assert.match(editEvent, /value\.details/);
    assert.match(editEvent, /value\.code/);
    assert.match(editEvent, /Event was saved, but the event list could not be refreshed/);
  });

  it('keeps endpoint and upstream revalidation diagnostics behind a collapsed disclosure', () => {
    assert.match(revalidationFeedback, /<details className=/);
    assert.match(revalidationFeedback, /diagnostics\.httpStatus/);
    assert.match(revalidationFeedback, /target\.endpoint/);
    assert.match(revalidationFeedback, /target\.path/);
    assert.match(revalidationFeedback, /target\.message/);
  });
});
