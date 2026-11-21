// Pure helpers for the Traceability issue panel.
import { formatScanTime } from './dashboard.js';

export const linkedIssueKeys = (issue) => [
  ...new Set(
    (issue.fields?.issuelinks ?? [])
      .map((link) => (link.outwardIssue ?? link.inwardIssue)?.key)
      .filter(Boolean),
  ),
];

export const isTracedWorkType = (typeName, settings) =>
  settings.implementationTypes.includes(typeName) || settings.testTypes.includes(typeName);

const linkFingerprint = (issue) => JSON.stringify([issue.key, linkedIssueKeys(issue).sort()]);

// True when two readers of Jira see the same requirements and the same links.
export function sameLinkedIssues(userIssues, appIssues) {
  const appFingerprints = new Set(appIssues.map(linkFingerprint));
  return (
    userIssues.length === appIssues.length &&
    userIssues.every((issue) => appFingerprints.has(linkFingerprint(issue)))
  );
}

export function toRequirementTrace(requirement, settings) {
  const { key, summary, rag, gaps, links } = requirement;

  return {
    key,
    summary,
    rag,
    gaps,
    implementation: links
      .filter((link) => settings.implementationTypes.includes(link.type))
      .map((link) => ({ key: link.key, summary: link.summary, status: link.status })),
    verification: links
      .filter((link) => settings.testTypes.includes(link.type))
      .map((link) => ({
        key: link.key,
        summary: link.summary,
        status: link.status,
        isPassed: settings.passedStatuses.includes(link.status),
        passedAt: link.passedAt,
      })),
  };
}

export function passedLabel({ isPassed, passedAt }, options) {
  if (!isPassed) return '-';
  return passedAt ? formatScanTime(new Date(passedAt).toISOString(), options) : 'Unknown';
}
