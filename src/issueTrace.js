import { getStoredRequirements } from './db/repo';
import { isTracedWorkType, linkedIssueKeys, toRequirementTrace } from './engine/issueTrace';
import { getIssue } from './jira/client';
import { isRequirement, scanRequirements } from './scanner';
import { getSettings } from './settings';

const NOT_TRACED = { kind: 'none' };

async function requirementTrace(issueKey, settings) {
  const scan = await scanRequirements([issueKey], { asUser: true, source: 'panel' });
  const [requirement] = scan.requirements;
  if (!requirement) return NOT_TRACED;

  return {
    kind: 'requirement',
    requirement: toRequirementTrace(requirement, settings),
    warnings: scan.warnings,
  };
}

// Reads links as the user, so only requirements they can see are looked up.
async function supportingTrace(issueKey, settings) {
  const issue = await getIssue(issueKey, ['issuetype', 'issuelinks'], { asUser: true });
  if (!isTracedWorkType(issue.fields?.issuetype?.name, settings)) return NOT_TRACED;

  const requirements = await getStoredRequirements(linkedIssueKeys(issue));
  return requirements.length > 0 ? { kind: 'supporting', requirements } : NOT_TRACED;
}

export async function getIssueTrace(projectKey, issueKey) {
  const settings = await getSettings(projectKey);
  return (await isRequirement(projectKey, issueKey, settings))
    ? requirementTrace(issueKey, settings)
    : supportingTrace(issueKey, settings);
}
