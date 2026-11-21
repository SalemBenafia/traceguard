// Pure gap rules: no API calls and no storage.
//
// requirement: { key, summary, assigneeAccountId, contentChangedAt (epoch ms or null) }
// links: [{ key, type, status, passedAt (epoch ms or null), statusCategory ('new'|'indeterminate'|'done') }]
// settings: { implementationTypes, testTypes, passedStatuses, failedStatuses }

const latestPassTime = (passedTests) => Math.max(0, ...passedTests.map((test) => test.passedAt || 0));

function isStale(requirement, passedTests) {
  const lastPass = latestPassTime(passedTests);
  return lastPass > 0 && Boolean(requirement.contentChangedAt) && requirement.contentChangedAt > lastPass;
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

  const gaps = [];
  const add = (code, severity, message) => gaps.push({ code, severity, message });

  if (implementation.length === 0) add('NO_IMPLEMENTATION', 'red', 'No linked story, task or bug.');
  if (tests.length === 0) add('NO_TEST', 'red', 'No linked test.');
  if (failed.length > 0) add('TEST_FAILED', 'red', `${failed.length} linked test(s) failed.`);
  if (tests.length > 0 && passed.length === 0 && failed.length === 0) {
    add('TEST_NOT_RUN', 'amber', 'Tests exist but none has run yet.');
  }
  if (isStale(requirement, passed)) {
    add('STALE_VERIFICATION', 'red', 'Requirement changed after its last passing test.');
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
      tests: tests.length,
      passed: passed.length,
      failed: failed.length,
    },
  };
}
