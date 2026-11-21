import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluate } from '../src/engine/rules.js';

const SETTINGS = Object.freeze({
  implementationTypes: ['Story', 'Task', 'Bug'],
  testTypes: ['Test'],
  passedStatuses: ['Passed'],
  failedStatuses: ['Failed'],
});

const CHANGED_AT = 1_000;
const BEFORE_CHANGE = 500;
const AFTER_CHANGE = 2_000;

const requirement = (overrides = {}) => ({
  key: 'SPF-1',
  summary: 'Maximum single bolus is limited to 25 units',
  assigneeAccountId: 'account-1',
  contentChangedAt: CHANGED_AT,
  ...overrides,
});

const storyLink = (overrides = {}) => ({
  key: 'SPF-21',
  type: 'Story',
  status: 'Done',
  statusCategory: 'done',
  passedAt: null,
  ...overrides,
});

const testLink = (overrides = {}) => ({
  key: 'SPF-22',
  type: 'Test',
  status: 'Passed',
  statusCategory: 'done',
  passedAt: AFTER_CHANGE,
  ...overrides,
});

const notRunTest = (overrides = {}) =>
  testLink({ status: 'Not run', statusCategory: 'new', passedAt: null, ...overrides });
const failedTest = (overrides = {}) => testLink({ status: 'Failed', passedAt: null, ...overrides });
const gapCodes = (result) => result.gaps.map((gap) => gap.code);

describe('evaluate: green', () => {
  test('a fully traced requirement has no gaps', () => {
    const result = evaluate(requirement(), [storyLink(), testLink()], SETTINGS);

    assert.equal(result.rag, 'green');
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(result.counts, { impl: 1, implDone: 1, tests: 1, passed: 1, failed: 0 });
  });
});

describe('evaluate: each gap on its own', () => {
  const singleGapCases = [
    { code: 'NO_IMPLEMENTATION', severity: 'red', rag: 'red', req: {}, links: () => [testLink()] },
    { code: 'NO_TEST', severity: 'red', rag: 'red', req: {}, links: () => [storyLink()] },
    { code: 'TEST_FAILED', severity: 'red', rag: 'red', req: {}, links: () => [storyLink(), failedTest()] },
    { code: 'TEST_NOT_RUN', severity: 'amber', rag: 'amber', req: {}, links: () => [storyLink(), notRunTest()] },
    {
      code: 'STALE_VERIFICATION',
      severity: 'red',
      rag: 'red',
      req: {},
      links: () => [storyLink(), testLink({ passedAt: BEFORE_CHANGE })],
    },
    {
      code: 'IMPLEMENTATION_OPEN',
      severity: 'amber',
      rag: 'amber',
      req: {},
      links: () => [storyLink({ status: 'In Progress', statusCategory: 'indeterminate' }), testLink()],
    },
    {
      code: 'NO_OWNER',
      severity: 'amber',
      rag: 'amber',
      req: { assigneeAccountId: null },
      links: () => [storyLink(), testLink()],
    },
  ];

  for (const { code, severity, rag, req, links } of singleGapCases) {
    test(`${code} is the only gap`, () => {
      const result = evaluate(requirement(req), links(), SETTINGS);

      assert.deepEqual(gapCodes(result), [code]);
      assert.equal(result.gaps[0].severity, severity);
      assert.equal(result.rag, rag);
      assert.ok(result.gaps[0].message.length > 0);
    });
  }

  test('a story still in the new category counts as open', () => {
    const result = evaluate(
      requirement(),
      [storyLink({ status: 'To Do', statusCategory: 'new' }), testLink()],
      SETTINGS,
    );

    assert.deepEqual(gapCodes(result), ['IMPLEMENTATION_OPEN']);
  });
});

describe('evaluate: severity', () => {
  test('red beats amber when both are present', () => {
    const result = evaluate(requirement({ assigneeAccountId: null }), [storyLink()], SETTINGS);

    assert.deepEqual(gapCodes(result).sort(), ['NO_OWNER', 'NO_TEST']);
    assert.equal(result.rag, 'red');
  });

  test('several amber gaps stay amber', () => {
    const openStory = storyLink({ status: 'In Progress', statusCategory: 'indeterminate' });
    const result = evaluate(requirement({ assigneeAccountId: null }), [openStory, notRunTest()], SETTINGS);

    assert.deepEqual(gapCodes(result).sort(), ['IMPLEMENTATION_OPEN', 'NO_OWNER', 'TEST_NOT_RUN']);
    assert.equal(result.rag, 'amber');
  });

  test('a requirement with no links reports both missing sides', () => {
    const result = evaluate(requirement(), [], SETTINGS);

    assert.deepEqual(gapCodes(result).sort(), ['NO_IMPLEMENTATION', 'NO_TEST']);
    assert.equal(result.rag, 'red');
  });
});

describe('evaluate: STALE_VERIFICATION', () => {
  const staleResult = (req, tests) => gapCodes(evaluate(requirement(req), [storyLink(), ...tests], SETTINGS));

  test('is not raised when the test passed after the last change', () => {
    assert.deepEqual(staleResult({}, [testLink({ passedAt: AFTER_CHANGE })]), []);
  });

  test('is not raised when the test passed at the same moment as the change', () => {
    assert.deepEqual(staleResult({}, [testLink({ passedAt: CHANGED_AT })]), []);
  });

  test('is raised when the change is one millisecond after the pass', () => {
    assert.deepEqual(staleResult({}, [testLink({ passedAt: CHANGED_AT - 1 })]), ['STALE_VERIFICATION']);
  });

  test('uses the most recent passing test', () => {
    const tests = [
      testLink({ key: 'SPF-22', passedAt: BEFORE_CHANGE }),
      testLink({ key: 'SPF-23', passedAt: AFTER_CHANGE }),
    ];

    assert.deepEqual(staleResult({}, tests), []);
  });

  test('is not raised when the change time is unknown', () => {
    assert.deepEqual(staleResult({ contentChangedAt: null }, [testLink({ passedAt: BEFORE_CHANGE })]), []);
  });

  test('ignores tests that did not pass', () => {
    const result = staleResult({}, [failedTest({ passedAt: BEFORE_CHANGE })]);

    assert.deepEqual(result, ['TEST_FAILED']);
  });

  test('is raised when a changed requirement only has a pass with no known time', () => {
    assert.deepEqual(staleResult({}, [testLink({ passedAt: null })]), ['STALE_VERIFICATION']);
  });

  test('a known pass after the change clears a pass with no known time', () => {
    const tests = [
      testLink({ key: 'SPF-22', passedAt: null }),
      testLink({ key: 'SPF-23', passedAt: AFTER_CHANGE }),
    ];

    assert.deepEqual(staleResult({}, tests), []);
  });

  test('a pass with no known time is fine when the requirement never changed', () => {
    assert.deepEqual(staleResult({ contentChangedAt: null }, [testLink({ passedAt: null })]), []);
  });
});

describe('evaluate: custom settings', () => {
  const custom = {
    implementationTypes: ['Epic'],
    testTypes: ['Verification'],
    passedStatuses: ['Done'],
    failedStatuses: ['Rejected'],
  };
  const epic = storyLink({ type: 'Epic' });
  const verification = (overrides) => testLink({ type: 'Verification', ...overrides });

  test('passedStatuses ["Done"] counts a Done test as passed', () => {
    const result = evaluate(requirement(), [epic, verification({ status: 'Done' })], custom);

    assert.equal(result.rag, 'green');
    assert.equal(result.counts.passed, 1);
  });

  test('the default Passed status no longer counts', () => {
    const result = evaluate(requirement(), [epic, verification({ status: 'Passed' })], custom);

    assert.deepEqual(gapCodes(result), ['TEST_NOT_RUN']);
    assert.equal(result.counts.passed, 0);
  });

  test('a custom failed status raises TEST_FAILED', () => {
    const result = evaluate(requirement(), [epic, verification({ status: 'Rejected', passedAt: null })], custom);

    assert.deepEqual(gapCodes(result), ['TEST_FAILED']);
  });

  test('work types outside the settings are ignored', () => {
    const result = evaluate(requirement(), [storyLink(), testLink()], custom);

    assert.deepEqual(gapCodes(result).sort(), ['NO_IMPLEMENTATION', 'NO_TEST']);
    assert.deepEqual(result.counts, { impl: 0, implDone: 0, tests: 0, passed: 0, failed: 0 });
  });
});

describe('evaluate: several tests', () => {
  test('one passed and one failed test raises TEST_FAILED', () => {
    const links = [storyLink(), testLink({ key: 'SPF-22' }), failedTest({ key: 'SPF-23' })];
    const result = evaluate(requirement(), links, SETTINGS);

    assert.deepEqual(gapCodes(result), ['TEST_FAILED']);
    assert.equal(result.rag, 'red');
    assert.deepEqual(result.counts, { impl: 1, implDone: 1, tests: 2, passed: 1, failed: 1 });
    assert.match(result.gaps[0].message, /1 linked test/);
  });

  test('the failure message counts every failed test', () => {
    const links = [storyLink(), failedTest({ key: 'SPF-22' }), failedTest({ key: 'SPF-23' })];
    const result = evaluate(requirement(), links, SETTINGS);

    assert.match(result.gaps[0].message, /2 linked test/);
  });

  test('one passed and one not-run test raises TEST_NOT_RUN', () => {
    const links = [storyLink(), testLink({ key: 'SPF-22' }), notRunTest({ key: 'SPF-23' })];
    const result = evaluate(requirement(), links, SETTINGS);

    assert.deepEqual(gapCodes(result), ['TEST_NOT_RUN']);
    assert.equal(result.rag, 'amber');
    assert.match(result.gaps[0].message, /1 linked test/);
  });

  test('one failed and one not-run test raises both gaps', () => {
    const links = [storyLink(), failedTest({ key: 'SPF-22' }), notRunTest({ key: 'SPF-23' })];
    const result = evaluate(requirement(), links, SETTINGS);

    assert.deepEqual(gapCodes(result), ['TEST_FAILED', 'TEST_NOT_RUN']);
    assert.equal(result.rag, 'red');
  });
});

test('evaluate does not change its inputs', () => {
  const req = Object.freeze(requirement());
  const links = Object.freeze([Object.freeze(storyLink()), Object.freeze(testLink())]);

  assert.doesNotThrow(() => evaluate(req, links, SETTINGS));
});
