/**
 * Fire-and-forget webhook emission (Worker-side). Split from the pure
 * helpers in webhookEvents.ts so the test suite can import those directly
 * (repo convention: testable modules are dependency-free).
 */
import type { Env } from './supabase';
import { createSupabaseAdminClient } from './supabase';
import {
  type WebhookEventType,
  buildWebhookPayload,
  matchSubscriptions,
} from './webhookEvents';

/**
 * Fire-and-forget emission: resolve active subscriptions of the tenant that
 * subscribe to `event` and enqueue one delivery job each.
 */
export async function emitWebhookEvent(
  env: Env,
  input: { tenantId: string; event: WebhookEventType; data: Record<string, unknown> },
): Promise<void> {
  try {
    if (!input.tenantId) return;
    const admin = await createSupabaseAdminClient(env);
    const { data: subscriptions, error } = await admin
      .from('webhook_subscriptions')
      .select('id, events')
      .eq('tenant_id', input.tenantId)
      .eq('active', true);

    if (error) {
      console.error('webhook-emit/subscription-lookup', error.message);
      return;
    }

    const subscriptionIds = matchSubscriptions((subscriptions ?? []) as Array<{ id: string; events: string[] }>, input.event);
    if (!subscriptionIds.length) return;

    const payload = buildWebhookPayload(input.event, input.tenantId, input.data);
    const { error: insertError } = await admin.from('webhook_delivery_jobs').insert(
      subscriptionIds.map((subscriptionId) => ({
        subscription_id: subscriptionId,
        tenant_id: input.tenantId,
        event: input.event,
        payload,
      })),
    );

    if (insertError) {
      console.error('webhook-emit/insert', insertError.message);
    }
  } catch (e) {
    console.error('webhook-emit/unexpected', e instanceof Error ? e.message : String(e));
  }
}
