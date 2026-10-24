import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogBuffer } from '../api/lib/logBuffer.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFakeInsert() {
  const state = { batches: [], failuresLeft: 0 };
  const insert = async (rows, ctx) => {
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      throw new Error(`simulated insert failure (${state.failuresLeft} failures left)`);
    }
    state.batches.push({ rows, ctx });
  };
  return { insert, state };
}

test('logBuffer: flushes buffered rows as a single batch after the coalescing delay', async () => {
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({ batchSize: 10, flushDelayMs: 10, insert });

  buffer.push({ id: 1 }, 'env-a');
  buffer.push({ id: 2 }, 'env-a');
  assert.equal(buffer.size, 2);
  assert.equal(state.batches.length, 0, 'nothing flushed before the delay');

  await sleep(40);
  assert.equal(state.batches.length, 1, 'exactly one batched insert');
  assert.deepEqual(state.batches[0].rows.map((r) => r.id), [1, 2]);
  assert.equal(state.batches[0].ctx, 'env-a');
  assert.equal(buffer.size, 0);
});

test('logBuffer: flushes immediately when the batch size threshold is reached', async () => {
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({ batchSize: 3, flushDelayMs: 5_000, insert });

  buffer.push({ id: 1 }, 'env');
  buffer.push({ id: 2 }, 'env');
  assert.equal(state.batches.length, 0);

  buffer.push({ id: 3 }, 'env');
  assert.equal(state.batches.length, 1, 'threshold triggers an immediate flush');
  assert.deepEqual(state.batches[0].rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(buffer.size, 0);
});

test('logBuffer: coalesces rows arriving within the delay window into one insert', async () => {
  const { insert, state } = makeFakeInsert();
  // Generous margins: sub-10ms scheduling hiccups under load must not split the
  // batch (this test is about coalescing semantics, not timer precision).
  const buffer = createLogBuffer({ batchSize: 10, flushDelayMs: 50, insert });

  buffer.push({ id: 1 }, 'env');
  await sleep(10);
  buffer.push({ id: 2 }, 'env');
  await sleep(10);
  buffer.push({ id: 3 }, 'env');

  await sleep(100);
  assert.equal(state.batches.length, 1, 'one shared insert for all three rows');
  assert.equal(state.batches[0].rows.length, 3);
});

test('logBuffer: retries a failed batch once and then reports via onError', async () => {
  const errors = [];
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({
    batchSize: 10,
    flushDelayMs: 5,
    insert,
    onError: (error, rowCount, ctx) => errors.push({ message: error.message, rowCount, ctx }),
  });

  state.failuresLeft = 2; // first attempt fails, retry fails too → onError
  buffer.push({ id: 1 }, 'env-x');
  await sleep(30);

  assert.equal(state.batches.length, 0, 'failed batch is not persisted');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowCount, 1);
  assert.equal(errors[0].ctx, 'env-x');
  assert.match(errors[0].message, /simulated insert failure/);
  assert.equal(buffer.size, 0, 'failed rows are dropped, not retried forever');

  // Recovery: the next row goes through normally.
  buffer.push({ id: 2 }, 'env-x');
  await sleep(30);
  assert.equal(state.batches.length, 1);
  assert.deepEqual(state.batches[0].rows.map((r) => r.id), [2]);
});

test('logBuffer: retries a transient failure once and succeeds', async () => {
  const errors = [];
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({
    batchSize: 10,
    flushDelayMs: 5,
    insert,
    onError: (error) => errors.push(error),
  });

  state.failuresLeft = 1; // first attempt fails, retry succeeds
  buffer.push({ id: 1 }, 'env');
  await sleep(30);

  assert.equal(state.batches.length, 1, 'retry persisted the batch');
  assert.deepEqual(state.batches[0].rows.map((r) => r.id), [1]);
  assert.equal(errors.length, 0);
});

test('logBuffer: flush() persists pending rows immediately', async () => {
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({ batchSize: 10, flushDelayMs: 60_000, insert });

  buffer.push({ id: 1 }, 'env');
  await buffer.flush('env');

  assert.equal(state.batches.length, 1);
  assert.deepEqual(state.batches[0].rows.map((r) => r.id), [1]);
  assert.equal(buffer.size, 0);
});

test('logBuffer: flush on an empty buffer is a no-op', async () => {
  const { insert, state } = makeFakeInsert();
  const buffer = createLogBuffer({ batchSize: 10, flushDelayMs: 5, insert });

  await buffer.flush('env');
  assert.equal(state.batches.length, 0);
});
