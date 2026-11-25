import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  WEBHOOK_EVENT_TYPES,
  isWebhookEventType,
  matchSubscriptions,
  buildWebhookPayload,
} = await import('../api/lib/webhookEvents.ts');

describe('webhook event emission helpers', () => {
  test('event surface is object-scoped (tenant-carrying entities)', () => {
    assert.deepEqual(WEBHOOK_EVENT_TYPES, ['object.created', 'object.updated', 'object.archived']);
  });

  test('isWebhookEventType rejects unknown events', () => {
    assert.equal(isWebhookEventType('object.created'), true);
    assert.equal(isWebhookEventType('form.answer.created'), false);
    assert.equal(isWebhookEventType(42), false);
  });

  test('matchSubscriptions returns only subscribers of the event', () => {
    const subs = [
      { id: 'a', events: ['object.created', 'object.updated'] },
      { id: 'b', events: ['object.created'] },
      { id: 'c', events: ['object.archived'] },
    ];
    assert.deepEqual(matchSubscriptions(subs, 'object.created'), ['a', 'b']);
    assert.deepEqual(matchSubscriptions(subs, 'object.updated'), ['a']);
    assert.deepEqual(matchSubscriptions(subs, 'object.archived'), ['c']);
  });

  test('buildWebhookPayload produces the delivery envelope', () => {
    const payload = buildWebhookPayload('object.created', 'tenant-1', { id: 'o1' }, '2026-11-25T00:00:00.000Z');
    assert.deepEqual(payload, {
      event: 'object.created',
      tenant_id: 'tenant-1',
      occurred_at: '2026-11-25T00:00:00.000Z',
      data: { id: 'o1' },
    });
  });
});
