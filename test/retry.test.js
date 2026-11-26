import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_ATTEMPTS, MAX_DELAY_MS, retryDelayMs, sendWithRetry, TIME_RESERVE_MS } from '../src/engine/retry.js';

const noJitter = () => 0;
const response = (status, retryAfter = null) => ({
  status,
  headers: { get: (name) => (name === 'retry-after' ? retryAfter : null) },
});

function scripted(responses) {
  const remaining = [...responses];
  const send = async () => {
    send.calls += 1;
    return remaining.shift();
  };
  send.calls = 0;
  return send;
}

function recordingSleep() {
  const sleep = async (ms) => sleep.delays.push(ms);
  sleep.delays = [];
  return sleep;
}

describe('retryDelayMs', () => {
  test('waits for at least Retry-After', () => {
    assert.equal(retryDelayMs({ retryAfter: '2', attempt: 1, random: noJitter }), 2_000);
    assert.equal(retryDelayMs({ retryAfter: '2', attempt: 1, random: () => 1 }), 2_600);
  });

  test('backs off when there is no Retry-After', () => {
    const delay = (attempt) => retryDelayMs({ retryAfter: null, attempt, random: () => 0.5 });
    assert.equal(delay(1), 1_000);
    assert.equal(delay(2), 2_000);
  });

  test('an unreadable Retry-After falls back to backoff', () => {
    assert.equal(retryDelayMs({ retryAfter: 'soon', attempt: 1, random: () => 0.5 }), 1_000);
  });

  test('does not retry when Jira asks for a longer wait than allowed', () => {
    assert.equal(retryDelayMs({ retryAfter: '1847', attempt: 1 }), null);
  });

  test('jitter never exceeds the longest wait', () => {
    const seconds = String(MAX_DELAY_MS / 1000);
    assert.equal(retryDelayMs({ retryAfter: seconds, attempt: 1, random: () => 1 }), MAX_DELAY_MS);
  });

  test('stops at the last attempt', () => {
    assert.equal(retryDelayMs({ retryAfter: '1', attempt: MAX_ATTEMPTS }), null);
  });

  test('never sleeps into the time needed to save results', () => {
    const tooLate = TIME_RESERVE_MS + 1_999;
    const inTime = TIME_RESERVE_MS + 2_000;
    assert.equal(retryDelayMs({ retryAfter: '2', attempt: 1, remainingMs: tooLate, random: noJitter }), null);
    assert.equal(retryDelayMs({ retryAfter: '2', attempt: 1, remainingMs: inTime, random: noJitter }), 2_000);
  });
});

describe('sendWithRetry', () => {
  test('returns a successful response without waiting', async () => {
    const send = scripted([response(200)]);
    const sleep = recordingSleep();

    assert.equal((await sendWithRetry(send, { sleep })).status, 200);
    assert.equal(send.calls, 1);
    assert.deepEqual(sleep.delays, []);
  });

  test('retries a 429 and returns the next success', async () => {
    const send = scripted([response(429, '1'), response(200)]);
    const sleep = recordingSleep();

    assert.equal((await sendWithRetry(send, { sleep, random: noJitter })).status, 200);
    assert.equal(send.calls, 2);
    assert.deepEqual(sleep.delays, [1_000]);
  });

  test('returns the 429 after the last attempt', async () => {
    const send = scripted(Array(MAX_ATTEMPTS + 1).fill(response(429, '0')));
    const sleep = recordingSleep();

    assert.equal((await sendWithRetry(send, { sleep })).status, 429);
    assert.equal(send.calls, MAX_ATTEMPTS);
  });

  test('does not retry other failures', async () => {
    const send = scripted([response(500), response(200)]);

    assert.equal((await sendWithRetry(send, { sleep: recordingSleep() })).status, 500);
    assert.equal(send.calls, 1);
  });
});
