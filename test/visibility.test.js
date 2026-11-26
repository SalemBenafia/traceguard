import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filterForViewer,
  filterGapsForViewer,
  referencedIssueKeys,
  toDashboardRow,
} from '../src/engine/visibility.js';

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

describe('toDashboardRow', () => {
  const stored = {
    project_key: 'SPF',
    req_key: 'SPF-1',
    summary: 'Bolus limit',
    status: 'Open',
    owner_account_id: 'account-1',
    owner_name: 'Owner',
    owner_team: 'Firmware',
    rag: 'red',
    gaps: [{ code: 'NO_TEST', severity: 'red', message: 'No verification is linked.' }],
    chain: { links: [{ key: 'SPF-21', summary: 'Linked work' }], counts: { impl: 1 } },
    explanation: 'cached text',
    explanation_hash: 'hash',
    scanned_at: '2026-11-22 10:00:00',
  };

  test('keeps what the dashboard shows', () => {
    assert.deepEqual(toDashboardRow(stored), {
      req_key: 'SPF-1',
      summary: 'Bolus limit',
      owner_name: 'Owner',
      owner_team: 'Firmware',
      rag: 'red',
      gaps: stored.gaps,
      chain: { counts: { impl: 1 } },
    });
  });

  test('removes links and account ids', () => {
    const text = JSON.stringify(toDashboardRow(stored));

    assert.doesNotMatch(text, /account-1|SPF-21|Linked work|cached text/);
  });
});

describe('filterGapsForViewer', () => {
  test('hides gaps on requirements the viewer cannot see', () => {
    const gaps = [
      { req_key: 'SPF-1', gap_code: 'NO_TEST' },
      { req_key: 'SPF-2', gap_code: 'NO_OWNER' },
    ];

    assert.deepEqual(filterGapsForViewer(gaps, new Set(['SPF-2'])), [gaps[1]]);
  });
});
