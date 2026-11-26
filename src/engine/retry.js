// Pure retry policy for rate-limited reads. The caller supplies send and sleep.
export const MAX_ATTEMPTS = 3;
export const MAX_DELAY_MS = 5_000;
export const TIME_RESERVE_MS = 8_000; // Leaves time to save results and answer.

const BASE_DELAY_MS = 1_000;

function retryAfterMs(retryAfter) {
  if (retryAfter === null || retryAfter === undefined || retryAfter === '') return null;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

// Retry-After is a minimum, so jitter only adds to it.
function jitteredDelay(requestedMs, attempt, random) {
  if (requestedMs !== null) return Math.min(requestedMs * (1 + random() * 0.3), MAX_DELAY_MS);
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1) * (0.7 + random() * 0.6), MAX_DELAY_MS);
}

// Returns null when the request should not be tried again.
export function retryDelayMs({ retryAfter, attempt, remainingMs = Infinity, random = Math.random }) {
  if (attempt >= MAX_ATTEMPTS) return null;

  const requestedMs = retryAfterMs(retryAfter);
  if (requestedMs !== null && requestedMs > MAX_DELAY_MS) return null;

  const delayMs = jitteredDelay(requestedMs, attempt, random);
  return delayMs <= remainingMs - TIME_RESERVE_MS ? delayMs : null;
}

export async function sendWithRetry(send, { sleep, remainingMs = () => Infinity, random = Math.random }) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await send();
    if (res.status !== 429) return res;

    const delayMs = retryDelayMs({
      retryAfter: res.headers?.get?.('retry-after'),
      attempt,
      remainingMs: remainingMs(),
      random,
    });
    if (delayMs === null) return res;
    await sleep(delayMs);
  }
}
