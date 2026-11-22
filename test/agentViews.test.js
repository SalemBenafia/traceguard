import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  accountIdFrom,
  MAX_GAP_ITEMS,
  normalizeSeverity,
  parseRequirementKey,
  resolveProjectKey,
  toGapList,
  toRequirementAnswer,
  toTraceSummary,
} from '../src/engine/agentViews.js';

const SETTINGS = {
  implementationTypes: ['Story', 'Task', 'Bug'],
  testTypes: ['Test'],
  passedStatuses: ['Passed'],
  failedStatuses: ['Failed'],
};

const gap = (code, severity, message = `Message ${code}`) => ({ code, severity, message });
const row = (key, rag, gaps = [], overrides = {}) => ({
  req_key: key,
  summary: `Summary ${key}`,
  status: 'To Do',
  owner_name: 'Demo Owner',
  owner_team: 'Firmware',
  rag,
  gaps,
  explanation: null,
  chain: { links: [], counts: {} },
  ...overrides,
});

describe('inputs', () => {
  test('prefers the project key input and normalizes it', () => {
    assert.equal(resolveProjectKey({ projectKey: ' spf ', context: { jira: { projectKey: 'ABC' } } }), 'SPF');
  });

  test('falls back to the Jira context', () => {
    assert.equal(resolveProjectKey({ context: { jira: { projectKey: 'ABC' } } }), 'ABC');
  });

  test('rejects missing or unsafe project keys', () => {
    for (const payload of [{}, undefined, { projectKey: 'SPF" OR 1=1' }, { projectKey: 'A' }, { projectKey: 'TOOLONGPROJECT' }]) {
      assert.equal(resolveProjectKey(payload), null);
    }
  });

  test('validates requirement keys', () => {
    assert.equal(parseRequirementKey(' spf-12 '), 'SPF-12');
    assert.equal(parseRequirementKey('MY_APP-7'), 'MY_APP-7');
    for (const value of ['SPF', 'SPF-', '-1', 'SPF-1 OR 1=1', '../SPF-1', null, 5]) {
      assert.equal(parseRequirementKey(value), null);
    }
  });

  test('accepts only red or amber severity', () => {
    assert.equal(normalizeSeverity('RED'), 'red');
    assert.equal(normalizeSeverity(' amber '), 'amber');
    for (const value of ['green', 'high', '', null, undefined, 1]) {
      assert.equal(normalizeSeverity(value), null);
    }
  });

  test('reads the account id from either documented place', () => {
    assert.equal(accountIdFrom({ principal: { accountId: 'a1' } }), 'a1');
    assert.equal(accountIdFrom({ accountId: 'a2' }), 'a2');
    assert.equal(accountIdFrom({}), null);
    assert.equal(accountIdFrom(undefined), null);
  });
});

describe('toTraceSummary', () => {
  test('returns counts, percent, last scan and red items only', () => {
    const matrix = [
      row('SPF-1', 'green'),
      row('SPF-2', 'amber', [gap('NO_OWNER', 'amber')]),
      row('SPF-3', 'red', [gap('NO_TEST', 'red')]),
    ];

    assert.deepEqual(toTraceSummary('SPF', matrix, { finished_at: '2026-11-22 10:15:30' }), {
      projectKey: 'SPF',
      total: 3,
      green: 1,
      amber: 1,
      red: 1,
      auditReadyPercent: 33,
      lastScan: '22 Nov 2026, 10:15 UTC',
      topRed: [{ key: 'SPF-3', summary: 'Summary SPF-3', gaps: ['NO_TEST'] }],
    });
  });

  test('limits red items to 10, in key order', () => {
    const matrix = Array.from({ length: 12 }, (_, index) => row(`SPF-${12 - index}`, 'red'));
    const { topRed } = toTraceSummary('SPF', matrix, null);

    assert.equal(topRed.length, 10);
    assert.equal(topRed[0].key, 'SPF-1');
  });

  test('handles no scan', () => {
    assert.equal(toTraceSummary('SPF', [], null).lastScan, null);
  });
});

describe('toRequirementAnswer', () => {
  const links = [
    { key: 'SPF-21', summary: 'Build', type: 'Story', status: 'Done', statusCategory: 'done', passedAt: null },
    { key: 'SPF-22', summary: 'Check', type: 'Test', status: 'Passed', statusCategory: 'done', passedAt: Date.UTC(2026, 10, 20, 10, 15) },
    { key: 'SPF-23', summary: 'Other', type: 'Epic', status: 'Open', statusCategory: 'new', passedAt: null },
  ];

  test('returns only the fields the agent needs', () => {
    const answer = toRequirementAnswer(
      row('SPF-7', 'red', [gap('STALE_VERIFICATION', 'red', 'Changed.')], { chain: { links, counts: {} } }),
      SETTINGS,
    );

    assert.deepEqual(answer, {
      key: 'SPF-7',
      summary: 'Summary SPF-7',
      status: 'red',
      jiraStatus: 'To Do',
      owner: 'Demo Owner',
      team: 'Firmware',
      gaps: [{ code: 'STALE_VERIFICATION', message: 'Changed.' }],
      implementation: [{ key: 'SPF-21', summary: 'Build', status: 'Done' }],
      verification: [{ key: 'SPF-22', summary: 'Check', status: 'Passed', passedOn: '20 Nov 2026, 10:15 UTC' }],
    });
  });

  test('includes a cached explanation when there is one', () => {
    assert.equal(toRequirementAnswer(row('SPF-1', 'green', [], { explanation: 'Why' }), SETTINGS).explanation, 'Why');
  });

  test('labels a requirement with no owner', () => {
    const answer = toRequirementAnswer(row('SPF-1', 'amber', [], { owner_name: null, owner_team: null }), SETTINGS);

    assert.equal(answer.owner, 'Unassigned');
    assert.equal(answer.team, 'No team found');
  });
});

describe('toGapList', () => {
  const matrix = [
    row('SPF-1', 'green'),
    row('SPF-2', 'amber', [gap('NO_OWNER', 'amber')]),
    row('SPF-3', 'red', [gap('NO_TEST', 'red'), gap('NO_OWNER', 'amber')]),
  ];

  test('groups by requirement, red first, with a next step', () => {
    const result = toGapList('SPF', matrix, null);

    assert.deepEqual(result.requirements.map((item) => item.key), ['SPF-3', 'SPF-2']);
    assert.equal(result.requirements[0].gaps.length, 2);
    assert.ok(result.requirements[0].gaps[0].nextStep.length > 0);
    assert.deepEqual([result.severity, result.totalGaps, result.shownGaps, result.truncated], ['all', 3, 3, false]);
  });

  test('filters by gap severity', () => {
    const result = toGapList('SPF', matrix, 'red');

    assert.deepEqual(result.requirements.map((item) => item.key), ['SPF-3']);
    assert.deepEqual(result.requirements[0].gaps.map((item) => item.code), ['NO_TEST']);
  });

  test('returns at most 50 gaps and says when it truncates', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      row(`SPF-${index + 1}`, 'red', [gap('NO_TEST', 'red'), gap('TEST_FAILED', 'red')]),
    );
    const result = toGapList('SPF', many, null);
    const shown = result.requirements.reduce((sum, item) => sum + item.gaps.length, 0);

    assert.equal(shown, MAX_GAP_ITEMS);
    assert.deepEqual([result.totalGaps, result.shownGaps, result.truncated], [60, 50, true]);
  });

  test('handles no gaps', () => {
    assert.deepEqual(toGapList('SPF', [row('SPF-1', 'green')], null).requirements, []);
  });
});
