import type { Env, ExecutionContext } from './supabase';

/**
 * Queue message hook contract.
 *
 * Plugins register handlers for the `queue.message` target to process
 * messages delivered by Cloudflare Queues. The core dispatches each
 * message to all registered handlers via ctx.waitUntil().
 *
 * EUPL note: this is a hook interface — plugins implement handlers
 * without modifying core queue dispatch logic.
 */

export const QUEUE_MESSAGE_HOOK = 'queue.message';

export interface QueueMessageHookContext {
  /** The queue message body (structured clone compatible). */
  message: unknown;
  /** The Worker environment bindings. */
  env: Env;
  /** The execution context for waitUntil(). */
  ctx: ExecutionContext;
}