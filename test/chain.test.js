import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { buildChain } from '../src/engine/chain.js';
import { evaluate } from '../src/engine/rules.js';

const SETTINGS = Object.freeze({
  implementationTypes: ['Story', 'Task', 'Bug'],
  testTypes: ['Test'],
  passedStatuses: ['Passed'],
  failedStatuses: ['Failed'],
});

const PASS_TIME = 1_763_700_000_000;

const loadFixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/jira-requirement.json', import.meta.url), 'utf8'));

const linkByKey = (chain, key) => chain.links.find((link) => link.key === key);

const linkedIssue = (key, typeName, statusName, categoryKey) => ({
  key,
  fields: {
    issuetype: { name: typeName },
    status: { name: statusName, statusCategory: { key: categoryKey } },
  },
});

describe('buildChain: requirement', () => {
  test('maps key, summary and owner from the Jira issue', () => {
    const { requirement } = buildChain(loadFixture(), {}, SETTINGS);

    assert.deepEqual(requirement, {
      key: 'SPF-7',
      summary: 'Firmware updates are signature-verified',
      assigneeAccountId: 'fixture-account-1',
      contentChangedAt: null,
    });
  });

  test('an unassigned issue has a null owner', () => {
    const issue = loadFixture();
    issue.fields.assignee = null;

    assert.equal(buildChain(issue, {}, SETTINGS).requirement.assigneeAccountId, null);
  });
});

describe('buildChain: links', () => {
  test('reads both outwardIssue and inwardIssue', () => {
    const chain = buildChain(loadFixture(), {}, SETTINGS);

    assert.equal(linkByKey(chain, 'SPF-27').type, 'Story');
    assert.equal(linkByKey(chain, 'SPF-28').type, 'Test');
  });

  test('reads status name and statusCategory from the linked issue', () => {
    const chain = buildChain(loadFixture(), {}, SETTINGS);

    assert.equal(linkByKey(chain, 'SPF-29').status, 'In Progress');
    assert.equal(linkByKey(chain, 'SPF-29').statusCategory, 'indeterminate');
    assert.equal(linkByKey(chain, 'SPF-27').statusCategory, 'done');
  });

  test('an issue linked twice is counted once', () => {
    const chain = buildChain(loadFixture(), {}, SETTINGS);

    assert.deepEqual(chain.links.map((link) => link.key), ['SPF-27', 'SPF-28', 'SPF-29', 'SPF-30']);
  });

  test('each link has exactly the shape evaluate expects', () => {
    const chain = buildChain(loadFixture(), { 'SPF-28': PASS_TIME }, SETTINGS);

    assert.deepEqual(linkByKey(chain, 'SPF-28'), {
      key: 'SPF-28',
      type: 'Test',
      status: 'Passed',
      statusCategory: 'done',
      passedAt: PASS_TIME,
    });
  });

  test('an issue with no issuelinks field has no links', () => {
    const issue = loadFixture();
    delete issue.fields.issuelinks;

    assert.deepEqual(buildChain(issue, {}, SETTINGS).links, []);
  });

  test('a link entry without a linked issue is skipped', () => {
    const issue = loadFixture();
    issue.fields.issuelinks = [{ id: '1', type: { name: 'Relates' } }];

    assert.deepEqual(buildChain(issue, {}, SETTINGS).links, []);
  });

  test('a linked issue with missing status data does not throw', () => {
    const issue = loadFixture();
    issue.fields.issuelinks = [{ outwardIssue: { key: 'SPF-99', fields: { issuetype: { name: 'Story' } } } }];

    assert.deepEqual(buildChain(issue, {}, SETTINGS).links, [
      { key: 'SPF-99', type: 'Story', status: null, statusCategory: null, passedAt: null },
    ]);
  });
});

describe('buildChain: passedAt', () => {
  test('accepts a plain object of pass times', () => {
    const chain = buildChain(loadFixture(), { 'SPF-28': PASS_TIME }, SETTINGS);

    assert.equal(linkByKey(chain, 'SPF-28').passedAt, PASS_TIME);
  });

  test('accepts a Map of pass times', () => {
    const chain = buildChain(loadFixture(), new Map([['SPF-28', PASS_TIME]]), SETTINGS);

    assert.equal(linkByKey(chain, 'SPF-28').passedAt, PASS_TIME);
  });

  test('is null for a passed test without a known time', () => {
    assert.equal(linkByKey(buildChain(loadFixture(), {}, SETTINGS), 'SPF-28').passedAt, null);
  });

  test('is null for a test that is no longer in a passed status', () => {
    const chain = buildChain(loadFixture(), { 'SPF-30': PASS_TIME }, SETTINGS);

    assert.equal(linkByKey(chain, 'SPF-30').passedAt, null);
  });

  test('is null for work that is not a test', () => {
    const issue = loadFixture();
    issue.fields.issuelinks = [{ outwardIssue: linkedIssue('SPF-40', 'Story', 'Passed', 'done') }];

    assert.equal(buildChain(issue, { 'SPF-40': PASS_TIME }, SETTINGS).links[0].passedAt, null);
  });

  test('follows custom settings', () => {
    const custom = { ...SETTINGS, testTypes: ['Verification'], passedStatuses: ['Done'] };
    const issue = loadFixture();
    issue.fields.issuelinks = [{ inwardIssue: linkedIssue('SPF-41', 'Verification', 'Done', 'done') }];

    assert.equal(buildChain(issue, { 'SPF-41': PASS_TIME }, custom).links[0].passedAt, PASS_TIME);
  });
});

describe('buildChain with evaluate', () => {
  test('the fixture produces the expected audit result', () => {
    const { requirement, links } = buildChain(loadFixture(), { 'SPF-28': PASS_TIME }, SETTINGS);
    const result = evaluate(requirement, links, SETTINGS);

    assert.equal(result.rag, 'red');
    assert.deepEqual(result.gaps.map((gap) => gap.code), ['TEST_FAILED', 'IMPLEMENTATION_OPEN']);
    assert.deepEqual(result.counts, { impl: 2, implDone: 1, tests: 2, passed: 1, failed: 1 });
  });

  test('a change time added by the caller can raise STALE_VERIFICATION', () => {
    const issue = loadFixture();
    issue.fields.issuelinks = issue.fields.issuelinks.slice(0, 2);
    const { requirement, links } = buildChain(issue, { 'SPF-28': PASS_TIME }, SETTINGS);
    const result = evaluate({ ...requirement, contentChangedAt: PASS_TIME + 1 }, links, SETTINGS);

    assert.deepEqual(result.gaps.map((gap) => gap.code), ['STALE_VERIFICATION']);
  });
});

test('buildChain does not change the Jira issue', () => {
  const issue = loadFixture();
  const before = structuredClone(issue);

  buildChain(issue, { 'SPF-28': PASS_TIME }, SETTINGS);

  assert.deepEqual(issue, before);
});
