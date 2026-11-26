// Pure gap rules: no API calls and no storage.
//
// requirement: { key, summary, assigneeAccountId, contentChangedAt (epoch ms or null) }
// links: [{ key, type, status, passedAt (epoch ms or null), statusCategory ('new'|'indeterminate'|'done') }]
// settings: { implementationTypes, testTypes, passedStatuses, failedStatuses }

const latestPassTime = (passedTests) => Math.max(0, ...passedTests.map((test) => test.passedAt || 0));

// A pass with no known time cannot prove the test ran after the latest change.
function isStale(requirement, passedTests) {
  if (passedTests.length === 0 || !requirement.contentChangedAt) return false;
  return requirement.contentChangedAt > latestPassTime(passedTests);
}

function ragFor(gaps) {
  if (gaps.some((gap) => gap.severity === 'red')) return 'red';
  return gaps.length > 0 ? 'amber' : 'green';
}

export function evaluate(requirement, links, settings) {
  const implementation = links.filter((link) => settings.implementationTypes.includes(link.type));
  const tests = links.filter((link) => settings.testTypes.includes(link.type));
  const passed = tests.filter((test) => settings.passedStatuses.includes(test.status));
  const failed = tests.filter((test) => settings.failedStatuses.includes(test.status));
  const notRun = tests.filter((test) => !passed.includes(test) && !failed.includes(test));

  const gaps = [];
  const add = (code, severity, message) => gaps.push({ code, severity, message });

  if (implementation.length === 0) add('NO_IMPLEMENTATION', 'red', 'No implementation is linked.');
  if (tests.length === 0) add('NO_TEST', 'red', 'No verification is linked.');
  if (failed.length > 0) add('TEST_FAILED', 'red', `${failed.length} linked verification item(s) failed.`);
  if (notRun.length > 0) add('TEST_NOT_RUN', 'amber', `${notRun.length} linked verification item(s) have not run.`);
  if (isStale(requirement, passed)) {
    add('STALE_VERIFICATION', 'red', 'Requirement changed after its last passed verification.');
  }
  if (implementation.some((item) => item.statusCategory !== 'done')) {
    add('IMPLEMENTATION_OPEN', 'amber', 'Some implementation work is not done.');
  }
  if (!requirement.assigneeAccountId) add('NO_OWNER', 'amber', 'Requirement has no owner.');

  return {
    rag: ragFor(gaps),
    gaps,
    counts: {
      impl: implementation.length,
      implDone: implementation.filter((item) => item.statusCategory === 'done').length,
      tests: tests.length,
      passed: passed.length,
      failed: failed.length,
    },
  };
}
