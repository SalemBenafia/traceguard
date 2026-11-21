import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { filterForViewer, referencedIssueKeys } from '../src/engine/visibility.js';

const row = (reqKey, ...linkKeys) => ({
  req_key: reqKey,
  rag: 'green',
  chain: { links: linkKeys.map((key) => ({ key })), counts: {} },
});

describe('referencedIssueKeys', () => {
  test('lists requirements and linked issues once', () => {
    const matrix = [row('SPF-1', 'SPF-21', 'SPF-22'), row('SPF-2', 'SPF-22')];

    assert.deepEqual(referencedIssueKeys(matrix), ['SPF-1', 'SPF-21', 'SPF-22', 'SPF-2']);
  });
});

describe('filterForViewer', () => {
  test('hides requirements the viewer cannot see', () => {
    const result = filterForViewer([row('SPF-1'), row('SPF-2')], new Set(['SPF-1']));

    assert.deepEqual(result.map((item) => item.req_key), ['SPF-1']);
  });

  test('hides linked issues the viewer cannot see', () => {
    const result = filterForViewer([row('SPF-1', 'SPF-21', 'SPF-22')], new Set(['SPF-1', 'SPF-21']));

    assert.deepEqual(result[0].chain.links, [{ key: 'SPF-21' }]);
  });

  test('does not change the stored row', () => {
    const matrix = [row('SPF-1', 'SPF-21')];

    filterForViewer(matrix, new Set(['SPF-1']));

    assert.equal(matrix[0].chain.links.length, 1);
  });
});
