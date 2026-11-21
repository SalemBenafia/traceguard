import { ensureMigrations } from './db/migrations';
import { saveScan } from './db/repo';
import { buildChain } from './engine/chain';
import { latestContentChange, latestMoveToStatus } from './engine/changelog';
import { mapWithLimit } from './engine/concurrency';
import { requirementJql, RequirementJqlError } from './engine/jql';
import { evaluate } from './engine/rules';
import { getChangelog, searchAll } from './jira/client';
import { getSettings } from './settings';

const MAX_REQUIREMENTS = 500;
const MAX_PARALLEL_REQUIREMENTS = 5;
const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'issuelinks', 'issuetype', 'updated'];

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

async function scanIssue(issue, settings, readChangelog) {
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

function countByRag(requirements) {
  const totals = { total: requirements.length, green: 0, amber: 0, red: 0 };
  for (const { rag } of requirements) totals[rag] += 1;
  return totals;
}

async function runScan(projectKey, keys, { asUser = false, source = 'unknown', timeBudgetMs = null } = {}) {
  const startedAt = Date.now();
  const outOfTime = () => timeBudgetMs !== null && Date.now() - startedAt >= timeBudgetMs;
  console.log(`[TG] Scan started for ${projectKey} (source: ${source})`);
  await ensureMigrations();

  const settings = await getSettings(projectKey);
  const found = await findRequirements(requirementJql(projectKey, settings.requirementJql, keys), asUser);
  const issues = found.slice(0, MAX_REQUIREMENTS);
  const readChangelog = createChangelogReader(asUser);
  const requirements = await mapWithLimit(
    issues,
    MAX_PARALLEL_REQUIREMENTS,
    (issue) => scanIssue(issue, settings, readChangelog),
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

  const { runId, warnings: saveWarnings } = await saveScan(projectKey, result, source);
  console.log(`[TG] Scan saved for ${projectKey}: ${requirements.length} requirements (run ${runId})`);
  return { ...result, runId, warnings: [...warnings, ...saveWarnings] };
}

export const scanProject = (projectKey, options) => runScan(projectKey, null, options);

const projectKeyOf = (issueKey) => issueKey.slice(0, issueKey.lastIndexOf('-'));

export async function scanRequirements(keys, options) {
  const uniqueKeys = [...new Set(keys)];
  const projectKeys = new Set(uniqueKeys.map(projectKeyOf));
  if (projectKeys.size !== 1) {
    throw new Error('scanRequirements needs at least one key, all from the same project.');
  }
  return runScan([...projectKeys][0], uniqueKeys, options);
}
