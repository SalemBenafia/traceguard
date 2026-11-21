import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { mapWithLimit } from '../src/engine/concurrency.js';

const numbers = (count) => Array.from({ length: count }, (_, index) => index);

describe('mapWithLimit', () => {
  test('keeps the input order', async () => {
    const result = await mapWithLimit([30, 1, 15], 3, async (delay) => {
      await sleep(delay);
      return delay;
    });

    assert.deepEqual(result, [30, 1, 15]);
  });

  test('never runs more than the limit at once', async () => {
    let running = 0;
    let highest = 0;

    await mapWithLimit(numbers(23), 5, async () => {
      running += 1;
      highest = Math.max(highest, running);
      await sleep(2);
      running -= 1;
    }).then(() => undefined);

    assert.equal(highest, 5);
  });

  test('handles an empty list', async () => {
    assert.deepEqual(await mapWithLimit([], 5, async (item) => item), []);
  });

  test('stops starting work when asked and returns finished results', async () => {
    let started = 0;
    const result = await mapWithLimit(
      numbers(10),
      2,
      async (item) => {
        started += 1;
        return item;
      },
      () => started >= 4,
    );

    assert.deepEqual(result, [0, 1, 2, 3]);
  });

  test('rejects on failure and starts no further work', async () => {
    let started = 0;
    const run = mapWithLimit(numbers(20), 2, async (item) => {
      started += 1;
      await sleep(1);
      if (item === 1) throw new Error('boom');
      return item;
    });

    await assert.rejects(run, /boom/);
    await sleep(10);
    assert.ok(started <= 3);
  });
});
