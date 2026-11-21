// Converts a Jira search result into the input evaluate() expects. Pure: no API calls.

const passTimeFor = (testPassTimes, key) =>
  (testPassTimes instanceof Map ? testPassTimes.get(key) : testPassTimes?.[key]) ?? null;

function toLink(linkedIssue, testPassTimes, settings) {
  const { key, fields = {} } = linkedIssue;
  const type = fields.issuetype?.name ?? null;
  const status = fields.status?.name ?? null;
  const isPassedTest = settings.testTypes.includes(type) && settings.passedStatuses.includes(status);

  return {
    key,
    summary: fields.summary ?? null,
    type,
    status,
    statusCategory: fields.status?.statusCategory?.key ?? null,
    passedAt: isPassedTest ? passTimeFor(testPassTimes, key) : null,
  };
}

// An issue can be linked more than once, so links are unique by key.
function uniqueLinkedIssues(issueLinks) {
  const byKey = new Map();
  for (const issueLink of issueLinks) {
    const linkedIssue = issueLink.outwardIssue ?? issueLink.inwardIssue;
    if (linkedIssue?.key && !byKey.has(linkedIssue.key)) {
      byKey.set(linkedIssue.key, linkedIssue);
    }
  }
  return [...byKey.values()];
}

export function buildChain(jiraIssue, testPassTimes, settings) {
  const { key, fields } = jiraIssue;

  return {
    requirement: {
      key,
      summary: fields.summary,
      assigneeAccountId: fields.assignee?.accountId ?? null,
      // Jira's `updated` also changes on links and comments, so the caller
      // must set this from the changelog of content fields.
      contentChangedAt: null,
    },
    links: uniqueLinkedIssues(fields.issuelinks ?? []).map((linkedIssue) =>
      toLink(linkedIssue, testPassTimes, settings),
    ),
  };
}
