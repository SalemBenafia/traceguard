import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isTracedWorkType,
  linkedIssueKeys,
  passedLabel,
  sameLinkedIssues,
  toRequirementTrace,
} from '../src/engine/issueTrace.js';

const SETTINGS = {
  implementationTypes: ['Story', 'Task', 'Bug'],
  testTypes: ['Test'],
  passedStatuses: ['Passed'],
  failedStatuses: ['Failed'],
};
const UTC_GB = { locale: 'en-GB', timeZone: 'UTC' };

const issueWithLinks = (key, ...linkedKeys) => ({
  key,
  fields: {
    issuelinks: linkedKeys.map((linkedKey, index) =>
      index % 2 === 0 ? { outwardIssue: { key: linkedKey } } : { inwardIssue: { key: linkedKey } },
    ),
  },
});

describe('linkedIssueKeys', () => {
  test('reads inward and outward links once each', () => {
    const issue = issueWithLinks('SPF-1', 'SPF-2', 'SPF-3', 'SPF-2');

    assert.deepEqual(linkedIssueKeys(issue), ['SPF-2', 'SPF-3']);
  });

  test('handles an issue with no links', () => {
    assert.deepEqual(linkedIssueKeys({ key: 'SPF-1', fields: {} }), []);
  });
});

describe('isTracedWorkType', () => {
  test('accepts implementation and test types', () => {
    assert.equal(isTracedWorkType('Story', SETTINGS), true);
    assert.equal(isTracedWorkType('Test', SETTINGS), true);
  });

  test('rejects other types', () => {
    assert.equal(isTracedWorkType('Epic', SETTINGS), false);
    assert.equal(isTracedWorkType(undefined, SETTINGS), false);
  });
});

describe('sameLinkedIssues', () => {
  test('matches regardless of order', () => {
    const user = [issueWithLinks('SPF-1', 'SPF-2', 'SPF-3')];
    const app = [issueWithLinks('SPF-1', 'SPF-3', 'SPF-2')];

    assert.equal(sameLinkedIssues(user, app), true);
  });

  test('fails when the user sees fewer links', () => {
    const user = [issueWithLinks('SPF-1', 'SPF-2')];
    const app = [issueWithLinks('SPF-1', 'SPF-2', 'SPF-3')];

    assert.equal(sameLinkedIssues(user, app), false);
  });

  test('fails when the user sees fewer requirements', () => {
    assert.equal(sameLinkedIssues([], [issueWithLinks('SPF-1')]), false);
  });

  test('fails when the app cannot see the requirement', () => {
    assert.equal(sameLinkedIssues([issueWithLinks('SPF-1')], []), false);
  });
});

describe('toRequirementTrace', () => {
  const requirement = {
    key: 'SPF-7',
    summary: 'Firmware updates are signature-verified',
    rag: 'red',
    gaps: [{ code: 'TEST_FAILED', severity: 'red', message: '1 linked test(s) failed.' }],
    links: [
      { key: 'SPF-21', summary: 'Build it', type: 'Story', status: 'Done', passedAt: null },
      { key: 'SPF-22', summary: 'Check it', type: 'Test', status: 'Passed', passedAt: 1000 },
      { key: 'SPF-23', summary: 'Check more', type: 'Test', status: 'Failed', passedAt: null },
      { key: 'SPF-24', summary: 'Unrelated', type: 'Epic', status: 'Open', passedAt: null },
    ],
  };

  test('splits links into implementation and verification', () => {
    const trace = toRequirementTrace(requirement, SETTINGS);

    assert.deepEqual(trace.implementation, [{ key: 'SPF-21', summary: 'Build it', status: 'Done' }]);
    assert.deepEqual(trace.verification, [
      { key: 'SPF-22', summary: 'Check it', status: 'Passed', isPassed: true, passedAt: 1000 },
      { key: 'SPF-23', summary: 'Check more', status: 'Failed', isPassed: false, passedAt: null },
    ]);
  });

  test('includes the owner and team', () => {
    const trace = toRequirementTrace({ ...requirement, ownerName: 'Demo Owner', ownerTeam: 'Firmware' }, SETTINGS);

    assert.equal(trace.ownerName, 'Demo Owner');
    assert.equal(trace.ownerTeam, 'Firmware');
  });

  test('keeps the requirement status and gaps', () => {
    const trace = toRequirementTrace(requirement, SETTINGS);

    assert.equal(trace.key, 'SPF-7');
    assert.equal(trace.rag, 'red');
    assert.deepEqual(trace.gaps, requirement.gaps);
  });
});

describe('passedLabel', () => {
  test('shows the date a test passed', () => {
    const passedAt = Date.UTC(2026, 10, 20, 10, 15);

    assert.equal(passedLabel({ isPassed: true, passedAt }, UTC_GB), '20 Nov 2026, 10:15');
  });

  test('says Unknown for a pass with no recorded time', () => {
    assert.equal(passedLabel({ isPassed: true, passedAt: null }), 'Unknown');
  });

  test('shows - for a test that has not passed', () => {
    assert.equal(passedLabel({ isPassed: false, passedAt: null }), '-');
  });
});
