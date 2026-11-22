import { ensureMigrations } from './db/migrations';
import { getSavedOwners, saveScan } from './db/repo';
import { buildChain } from './engine/chain';
import { latestContentChange, latestMoveToStatus } from './engine/changelog';
import { mapWithLimit } from './engine/concurrency';
import { requirementJql, RequirementJqlError } from './engine/jql';
import { groupKeysByProject } from './engine/gapComment';
import { linkedIssueKeys, sameLinkedIssues } from './engine/issueTrace';
import { evaluate } from './engine/rules';
import { resolveOwnerTeam } from './engine/teams';
import { createTeamLookup } from './graph/teams';
import { getChangelog, getIssue, searchAll } from './jira/client';
import { getSavedSettings, getSettings } from './settings';

const MAX_REQUIREMENTS = 500;
const MAX_PARALLEL_REQUIREMENTS = 5;
const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'issuelinks', 'issuetype', 'updated'];
const LIMITED_VIEW_WARNING =
  'You cannot see every linked work item, so this result may be incomplete and was not saved.';

// A test linked to several requirements only has its changelog read once per scan.
function createChangelogReader(asUser) {
  const cache = new Map();
  return (issueKey) => {
    if (!cache.has(issueKey)) cache.set(issueKey, getChangelog(issueKey, { asUser }));
    return cache.get(issueKey);
  };
}

async function readPassTimes(links, settings, readChangelog) {
  const passedTests = links.filter(
    (link) => settings.testTypes.includes(link.type) && settings.passedStatuses.includes(link.status),
  );

  const passTimes = new Map();
  for (const test of passedTests) {
    passTimes.set(test.key, latestMoveToStatus(await readChangelog(test.key), test.status));
  }
  return passTimes;
}

async function scanIssue(issue, { settings, readChangelog, teamFor, savedOwners }) {
  const contentChangedAt = latestContentChange(await readChangelog(issue.key));
  const { links: linksWithoutTimes } = buildChain(issue, new Map(), settings);
  const passTimes = await readPassTimes(linksWithoutTimes, settings, readChangelog);

  const chain = buildChain(issue, passTimes, settings);
  const requirement = { ...chain.requirement, contentChangedAt };
  const { rag, gaps, counts } = evaluate(requirement, chain.links, settings);

  return {
    ...requirement,
    status: issue.fields.status?.name ?? null,
    ownerName: issue.fields.assignee?.displayName ?? null,
    ownerTeam: resolveOwnerTeam({
      ownerAccountId: requirement.assigneeAccountId,
      lookedUpTeam: await teamFor(requirement.assigneeAccountId),
      saved: savedOwners.get(issue.key),
    }),
    rag,
    gaps,
    counts,
    links: chain.links,
  };
}

async function findRequirements(jql, asUser) {
  try {
    // One extra result shows whether the limit was reached.
    return await searchAll(jql, SEARCH_FIELDS, { asUser, max: MAX_REQUIREMENTS + 1 });
  } catch (error) {
    if (error.status === 400) {
      throw new RequirementJqlError('Jira rejected the Requirement JQL. Check it in Settings.');
    }
    throw error;
  }
}

// Saved results are shared, so a user's scan is only saved if it matches the app's view.
async function appSeesSameLinks(jql, userIssues) {
  const appIssues = await searchAll(jql, ['issuelinks'], { asUser: false, max: MAX_REQUIREMENTS + 1 });
  return sameLinkedIssues(userIssues, appIssues);
}

function countByRag(requirements) {
  const totals = { total: requirements.length, green: 0, amber: 0, red: 0 };
  for (const { rag } of requirements) totals[rag] += 1;
  return totals;
}

// graphAsUser is only for scans started by a person: background jobs have no user for Teamwork Graph.
async function runScan(
  projectKey,
  keys,
  { asUser = false, source = 'unknown', timeBudgetMs = null, graphAsUser = asUser } = {},
) {
  const startedAt = Date.now();
  const outOfTime = () => timeBudgetMs !== null && Date.now() - startedAt >= timeBudgetMs;
  console.log(`[TG] Scan started for ${projectKey} (source: ${source})`);
  await ensureMigrations();

  const settings = await getSettings(projectKey);
  const jql = requirementJql(projectKey, settings.requirementJql, keys);
  const found = await findRequirements(jql, asUser);
  const issues = found.slice(0, MAX_REQUIREMENTS);
  const scanContext = {
    settings,
    readChangelog: createChangelogReader(asUser),
    teamFor: createTeamLookup({ canCallGraph: graphAsUser }),
    savedOwners: await getSavedOwners(projectKey),
  };
  const requirements = await mapWithLimit(
    issues,
    MAX_PARALLEL_REQUIREMENTS,
    (issue) => scanIssue(issue, scanContext),
    outOfTime,
  );

  const warnings = [];
  if (found.length > MAX_REQUIREMENTS) {
    warnings.push(`Only the first ${MAX_REQUIREMENTS} requirements were scanned.`);
  }
  if (requirements.length < issues.length) {
    warnings.push(
      `The scan stopped early to stay within Forge's time limit: ${requirements.length} of ${issues.length} requirements were checked.`,
    );
  }

  const result = {
    projectKey,
    startedAt: new Date(startedAt).toISOString(),
    scannedAt: new Date().toISOString(),
    // Only a complete project scan may remove saved requirements.
    complete: keys === null && found.length <= MAX_REQUIREMENTS && requirements.length === issues.length,
    totals: countByRag(requirements),
    requirements,
    warnings,
  };

  if (asUser && !(await appSeesSameLinks(jql, found))) {
    console.log(`[TG] Scan for ${projectKey} not saved: the user sees different links than the app`);
    return { ...result, saved: false, warnings: [...warnings, LIMITED_VIEW_WARNING] };
  }

  const { runId, warnings: saveWarnings } = await saveScan(projectKey, result, source);
  console.log(`[TG] Scan saved for ${projectKey}: ${requirements.length} requirements (run ${runId})`);
  return { ...result, saved: true, runId, warnings: [...warnings, ...saveWarnings] };
}

export const scanProject = (projectKey, options) => runScan(projectKey, null, options);

export async function isRequirement(projectKey, issueKey, settings) {
  const jql = requirementJql(projectKey, settings.requirementJql, [issueKey]);
  return (await findRequirements(jql, true)).length > 0;
}

const projectKeyOf = (issueKey) => issueKey.slice(0, issueKey.lastIndexOf('-'));

// A bad JQL in one project must not stop events for the others, so it counts as no match.
async function savedRequirementKeys(projectKey, keys) {
  const settings = await getSavedSettings(projectKey);
  if (!settings) return [];

  try {
    const jql = requirementJql(projectKey, settings.requirementJql, keys);
    const issues = await searchAll(jql, ['summary'], { asUser: false, max: keys.length });
    return issues.map((issue) => issue.key);
  } catch (error) {
    if (error instanceof RequirementJqlError || error.status === 400) {
      console.error(`[TG] Requirement JQL failed for ${projectKey}: ${error.message}`);
      return [];
    }
    throw error;
  }
}

async function readIssueLinks(issueIdOrKey) {
  try {
    return await getIssue(issueIdOrKey, ['issuelinks'], { asUser: false });
  } catch (error) {
    // The work item may have been deleted before this event arrived.
    if (error.status === 404) return null;
    throw error;
  }
}

export async function findRequirementKeysForIssue(issueIdOrKey) {
  const issue = await readIssueLinks(issueIdOrKey);
  if (!issue) return [];

  const ownMatch = await savedRequirementKeys(projectKeyOf(issue.key), [issue.key]);
  if (ownMatch.length > 0) return ownMatch;

  const requirementKeys = [];
  for (const [projectKey, keys] of groupKeysByProject(linkedIssueKeys(issue))) {
    requirementKeys.push(...(await savedRequirementKeys(projectKey, keys)));
  }
  return requirementKeys;
}

export async function scanRequirements(keys, options) {
  const uniqueKeys = [...new Set(keys)];
  const projectKeys = new Set(uniqueKeys.map(projectKeyOf));
  if (projectKeys.size !== 1) {
    throw new Error('scanRequirements needs at least one key, all from the same project.');
  }
  return runScan([...projectKeys][0], uniqueKeys, options);
}
