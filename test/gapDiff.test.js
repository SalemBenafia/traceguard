import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { batchByBytes, chunk, diffGaps, gapEventId, sortByKeyNumber } from '../src/engine/gapDiff.js';

const scanned = (key, ...codes) => ({ key, gaps: codes.map((code) => ({ code })) });
const openEvent = (id, reqKey, gapCode) => ({ id, req_key: reqKey, gap_code: gapCode });
const count = (reqKey, gapCode, eventCount) => ({ req_key: reqKey, gap_code: gapCode, event_count: eventCount });

describe('diffGaps', () => {
  test('opens every gap on the first scan', () => {
    const { toOpen, toClose } = diffGaps({
      scanned: [scanned('SPF-1', 'NO_TEST', 'NO_OWNER')],
      openEvents: [],
      eventCounts: [],
    });

    assert.deepEqual(toOpen, [
      { reqKey: 'SPF-1', gapCode: 'NO_TEST', previousEvents: 0 },
      { reqKey: 'SPF-1', gapCode: 'NO_OWNER', previousEvents: 0 },
    ]);
    assert.deepEqual(toClose, []);
  });

  test('changes nothing when the same gap is still open', () => {
    const result = diffGaps({
      scanned: [scanned('SPF-1', 'NO_TEST')],
      openEvents: [openEvent('e1', 'SPF-1', 'NO_TEST')],
      eventCounts: [count('SPF-1', 'NO_TEST', 1)],
    });

    assert.deepEqual(result, { toOpen: [], toClose: [] });
  });

  test('closes a gap that is gone', () => {
    const result = diffGaps({
      scanned: [scanned('SPF-1')],
      openEvents: [openEvent('e1', 'SPF-1', 'NO_TEST')],
      eventCounts: [count('SPF-1', 'NO_TEST', 1)],
    });

    assert.deepEqual(result, { toOpen: [], toClose: ['e1'] });
  });

  test('a reopened gap knows how many events came before it', () => {
    const { toOpen } = diffGaps({
      scanned: [scanned('SPF-1', 'NO_TEST')],
      openEvents: [],
      eventCounts: [count('SPF-1', 'NO_TEST', '2')],
    });

    assert.deepEqual(toOpen, [{ reqKey: 'SPF-1', gapCode: 'NO_TEST', previousEvents: 2 }]);
  });

  test('leaves gaps of requirements outside a partial scan alone', () => {
    const result = diffGaps({
      scanned: [scanned('SPF-1')],
      openEvents: [openEvent('e2', 'SPF-2', 'NO_TEST')],
      eventCounts: [count('SPF-2', 'NO_TEST', 1)],
    });

    assert.deepEqual(result, { toOpen: [], toClose: [] });
  });

  test('closes every open gap of a removed requirement', () => {
    const result = diffGaps({
      scanned: [],
      removedKeys: ['SPF-2'],
      openEvents: [openEvent('e2', 'SPF-2', 'NO_TEST'), openEvent('e3', 'SPF-2', 'NO_OWNER')],
      eventCounts: [],
    });

    assert.deepEqual(result.toClose, ['e2', 'e3']);
  });
});

describe('gapEventId', () => {
  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  test('fits the 36-character id column', () => {
    assert.match(gapEventId('SPF', 'SPF-1', 'NO_TEST', 0), UUID_SHAPE);
  });

  test('is the same for overlapping scans', () => {
    assert.equal(gapEventId('SPF', 'SPF-1', 'NO_TEST', 0), gapEventId('SPF', 'SPF-1', 'NO_TEST', 0));
  });

  test('differs when any part differs', () => {
    const base = gapEventId('SPF', 'SPF-1', 'NO_TEST', 0);

    assert.notEqual(base, gapEventId('ABC', 'SPF-1', 'NO_TEST', 0));
    assert.notEqual(base, gapEventId('SPF', 'SPF-2', 'NO_TEST', 0));
    assert.notEqual(base, gapEventId('SPF', 'SPF-1', 'NO_OWNER', 0));
    assert.notEqual(base, gapEventId('SPF', 'SPF-1', 'NO_TEST', 1));
  });
});

describe('sortByKeyNumber', () => {
  test('sorts SPF-2 before SPF-10', () => {
    const rows = [{ req_key: 'SPF-10' }, { req_key: 'SPF-2' }, { req_key: 'SPF-1' }];

    assert.deepEqual(sortByKeyNumber(rows).map((row) => row.req_key), ['SPF-1', 'SPF-2', 'SPF-10']);
  });

  test('does not change the input', () => {
    const rows = Object.freeze([{ req_key: 'SPF-2' }, { req_key: 'SPF-1' }]);

    assert.equal(sortByKeyNumber(rows)[0].req_key, 'SPF-1');
  });
});

describe('batching', () => {
  test('chunk splits a list', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });

  test('batchByBytes respects the row limit', () => {
    assert.deepEqual(batchByBytes([['a'], ['b'], ['c']], 2, 1000), [[['a'], ['b']], [['c']]]);
  });

  test('batchByBytes respects the byte limit', () => {
    const rows = [['x'.repeat(60)], ['y'.repeat(60)], ['z']];

    assert.deepEqual(batchByBytes(rows, 10, 100).map((batch) => batch.length), [1, 2]);
  });

  test('batchByBytes counts multi-byte characters', () => {
    const rows = [['é'.repeat(40)], ['é'.repeat(40)]];

    assert.equal(batchByBytes(rows, 10, 100).length, 2);
  });

  test('an oversized row gets its own batch', () => {
    const rows = [['a'], ['x'.repeat(200)], ['b']];

    assert.deepEqual(batchByBytes(rows, 10, 100).map((batch) => batch.length), [1, 1, 1]);
  });
});
