/**
 * In-isolate log write buffer.
 *
 * Log rows are collected per Worker isolate and flushed as a single batched
 * insert when either a size threshold or a short coalescing delay is hit.
 * This turns N log events into 1 REST round-trip — each avoided round-trip
 * also avoids a matching entry in the Supabase edge logs, which was the main
 * driver of the platform's logging overage.
 *
 * Trade-off: if an isolate dies inside the coalescing window, the buffered
 * rows are lost. Logs are best-effort by design here — a lost diagnostic row
 * is preferable to N× the API traffic. Failed batches are retried once and
 * then dropped with an `onError` report; logging must never break requests.
 *
 * The buffer is generic (row + context types) so both the core agentLogger
 * (`agent_logs`) and plugins (e.g. PluraDash `sync_logs`) can reuse it.
 */

export interface LogBufferConfig<Row, Ctx> {
  /** Flush immediately once the buffer holds this many rows. */
  batchSize: number;
  /** Otherwise, flush this many milliseconds after the first buffered row. */
  flushDelayMs: number;
  /**
   * Persists a batch. Must throw on failure so the retry logic engages.
   * `ctx` is the latest context passed to `push` (the Worker `env`) — it is
   * captured per push so flushes always use the current bindings.
   */
  insert: (rows: Row[], ctx: Ctx) => Promise<void>;
  /** Called when a batch ultimately fails after the single retry. */
  onError?: (error: unknown, rowCount: number, ctx: Ctx) => void;
}

export interface LogBuffer<Row, Ctx> {
  /**
   * Buffers a row and schedules a flush. `schedule` (typically
   * `executionCtx.waitUntil` on Cloudflare Workers) keeps the flush task
   * alive after the response returns; without it the task still runs on
   * runtimes that allow background promises (Node, tests).
   */
  push: (row: Row, ctx: Ctx, schedule?: (task: Promise<unknown>) => void) => void;
  /** Flushes whatever is buffered right now (no-op when empty). */
  flush: (ctx: Ctx) => Promise<void>;
  /** Number of rows currently waiting in the buffer (test introspection). */
  readonly size: number;
}

/**
 * Extracts a `waitUntil` registrar from a Hono context (or any object that
 * exposes `executionCtx`). Returns `undefined` on runtimes without an
 * execution context (local tests, Node) — callers then fall back to running
 * the flush task inline.
 */
export function getWaitUntil(context: unknown): ((promise: Promise<unknown>) => void) | undefined {
  try {
    const ctx = context as { executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void } } | undefined;
    const executionCtx = ctx?.executionCtx;
    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      return executionCtx.waitUntil.bind(executionCtx);
    }
  } catch {
    // Hono throws when executionCtx is accessed outside Workers.
  }
  return undefined;
}

export function createLogBuffer<Row, Ctx>(config: LogBufferConfig<Row, Ctx>): LogBuffer<Row, Ctx> {
  let buffer: Row[] = [];
  let delayedFlushPending = false;
  let latestCtx: Ctx | undefined;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    const ctx = latestCtx;
    buffer = [];

    const insertBatch = async (): Promise<void> => {
      if (!ctx) throw new Error('log buffer flush without context');
      await config.insert(batch, ctx);
    };

    try {
      await insertBatch();
    } catch {
      // One retry for transient hiccups, then give up — best-effort only.
      try {
        await insertBatch();
      } catch (error) {
        if (ctx) config.onError?.(error, batch.length, ctx);
      }
    }
  };

  return {
    push(row, ctx, schedule) {
      latestCtx = ctx;
      buffer.push(row);

      if (buffer.length >= config.batchSize) {
        const task = flush();
        if (schedule) schedule(task);
        return;
      }

      if (delayedFlushPending) return;
      delayedFlushPending = true;
      const task = (async () => {
        // Coalescing window: requests arriving within this delay share one
        // batched insert. The delay runs inside the waitUntil task, which
        // keeps the Worker context alive for its duration.
        await new Promise((resolve) => setTimeout(resolve, config.flushDelayMs));
        delayedFlushPending = false;
        await flush();
      })();
      if (schedule) schedule(task);
    },
    flush,
    get size() {
      return buffer.length;
    },
  };
}
