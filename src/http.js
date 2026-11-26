import { setTimeout as sleep } from 'node:timers/promises';
import { getAppContext } from '@forge/api';
import { sendWithRetry } from './engine/retry';

function remainingMs() {
  try {
    return getAppContext().invocationRemainingTimeInMillis();
  } catch {
    return Infinity;
  }
}

// Only for reads: a retried write could be applied twice.
export const readWithRetry = (send) => sendWithRetry(send, { sleep, remainingMs });

export function traceLabel(res) {
  const traceId = res.headers?.get?.('atl-traceid');
  return traceId ? ` (trace ${traceId})` : '';
}
