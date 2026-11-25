/**
 * Outbound webhook event emission (specs/platform/webhooks.md).
 *
 * Event surface (2026-11-25): Objects only — they carry tenant_id. Form
 * answers / page publications are future event types; subscriptions and
 * delivery jobs are tenant-scoped.
 *
 * Delivery is decoupled from the request: emission inserts rows into
 * webhook_delivery_jobs; the deliver_webhooks edge function processes the
 * queue via pg_cron with the mail-queue retry contract. Emission never
 * throws — a webhook failure must never fail the caller's request.
 */

export const WEBHOOK_EVENT_TYPES = [
  'object.created',
  'object.updated',
  'object.archived',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** Pure: which subscription ids want the given event type. */
export function matchSubscriptions(
  subscriptions: Array<{ id: string; events: string[] }>,
  event: WebhookEventType,
): string[] {
  return subscriptions
    .filter((sub) => sub.events.includes(event))
    .map((sub) => sub.id);
}

/** Pure: the envelope every delivery job receives. */
export function buildWebhookPayload(
  event: WebhookEventType,
  tenantId: string,
  data: Record<string, unknown>,
  occurredAt: string = new Date().toISOString(),
): Record<string, unknown> {
  return {
    event,
    tenant_id: tenantId,
    occurred_at: occurredAt,
    data,
  };
}
