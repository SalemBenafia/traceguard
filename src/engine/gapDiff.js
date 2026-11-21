// Pure helpers for saving scans: gap changes, stable ids, sorting and batching.
import { createHash } from 'node:crypto';

const gapKey = (reqKey, gapCode) => `${reqKey}\u0000${gapCode}`;
const issueNumber = (key) => Number(key.slice(key.lastIndexOf('-') + 1));

// Works out which gap events to open and close. Requirements outside `scanned`
// and `removedKeys` are left alone, so partial scans cannot close their gaps.
export function diffGaps({ scanned, removedKeys = [], openEvents, eventCounts }) {
  const openGaps = new Set(openEvents.map((event) => gapKey(event.req_key, event.gap_code)));
  const counts = new Map(
    eventCounts.map((row) => [gapKey(row.req_key, row.gap_code), Number(row.event_count)]),
  );
  const currentGaps = new Set(
    scanned.flatMap((requirement) => requirement.gaps.map((gap) => gapKey(requirement.key, gap.code))),
  );
  const scannedKeys = new Set(scanned.map((requirement) => requirement.key));
  const removed = new Set(removedKeys);

  const toOpen = scanned.flatMap((requirement) =>
    requirement.gaps
      .filter((gap) => !openGaps.has(gapKey(requirement.key, gap.code)))
      .map((gap) => ({
        reqKey: requirement.key,
        gapCode: gap.code,
        previousEvents: counts.get(gapKey(requirement.key, gap.code)) ?? 0,
      })),
  );

  const toClose = openEvents
    .filter(
      (event) =>
        removed.has(event.req_key) ||
        (scannedKeys.has(event.req_key) && !currentGaps.has(gapKey(event.req_key, event.gap_code))),
    )
    .map((event) => event.id);

  return { toOpen, toClose };
}

// Overlapping scans produce the same id, so the database keeps one event.
export function gapEventId(projectKey, reqKey, gapCode, previousEvents) {
  const hex = createHash('sha256')
    .update(JSON.stringify([projectKey, reqKey, gapCode, previousEvents]))
    .digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

export function sortByKeyNumber(items, keyOf = (item) => item.req_key) {
  return [...items].sort(
    (a, b) => issueNumber(keyOf(a)) - issueNumber(keyOf(b)) || keyOf(a).localeCompare(keyOf(b)),
  );
}

export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// Groups rows so each multi-row write stays under Forge's request size limit.
export function batchByBytes(rows, maxRows, maxBytes) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (batch.length > 0 && (batch.length >= maxRows || batchBytes + rowBytes > maxBytes)) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(row);
    batchBytes += rowBytes;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}
