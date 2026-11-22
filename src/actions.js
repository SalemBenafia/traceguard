// Rovo action handlers. Inputs can be hallucinated, so every read is authorized
// with the signed-in user's own Jira permissions.
import { createAuditPack as publishAuditPack } from './auditPack';
import { getLatestScanRun, getRequirement } from './db/repo';
import {
  accountIdFrom,
  normalizeSeverity,
  parseRequirementKey,
  resolveProjectKey,
  toGapList,
  toRequirementAnswer,
  toTraceSummary,
} from './engine/agentViews';
import { AuditPackError } from './engine/auditPack';
import { RequirementJqlError } from './engine/jql';
import { filterForViewer, referencedIssueKeys } from './engine/visibility';
import { hasProjectPermission, visibleIssueKeys } from './jira/client';
import { scanProject } from './scanner';
import { getSettings } from './settings';
import { matrixForViewer } from './viewerData';

const FIRST_SCAN_BUDGET_MS = 35_000;
const ASK_FOR_PROJECT = 'Which Jira project? Give me a key such as SPF.';
const GENERIC_ERROR = 'TraceGuard could not complete this request. Please try again.';

const noAccess = (projectKey) => ({ error: `You do not have access to project ${projectKey}.` });
const isConsentError = (error) => error?.name === 'NEEDS_AUTHENTICATION_ERR';

async function canBrowse(projectKey, context) {
  if (!accountIdFrom(context)) return false;
  try {
    return await hasProjectPermission(projectKey, 'BROWSE_PROJECTS');
  } catch (error) {
    if (isConsentError(error)) throw error;
    console.error(`[TG] Could not check access to ${projectKey}: ${error.message}`);
    return false;
  }
}

// Agents get a clear message instead of a failed action.
const asAction = (name, handler) => async (payload, context) => {
  try {
    return await handler(payload ?? {}, context);
  } catch (error) {
    if (isConsentError(error)) throw error;
    if (error instanceof AuditPackError || error instanceof RequirementJqlError) return { error: error.message };
    console.error(`[TG] Action ${name} failed: ${error.message}`);
    return { error: GENERIC_ERROR };
  }
};

async function latestOrFirstScan(projectKey) {
  const latest = await getLatestScanRun(projectKey);
  if (latest) return latest;

  await scanProject(projectKey, {
    asUser: false,
    graphAsUser: true,
    source: 'agent',
    timeBudgetMs: FIRST_SCAN_BUDGET_MS,
  });
  return getLatestScanRun(projectKey);
}

export const traceSummary = asAction('tg-get-trace-summary', async (payload, context) => {
  const projectKey = resolveProjectKey(payload);
  if (!projectKey) return { error: ASK_FOR_PROJECT };
  if (!(await canBrowse(projectKey, context))) return noAccess(projectKey);

  const lastScan = await latestOrFirstScan(projectKey);
  return toTraceSummary(projectKey, await matrixForViewer(projectKey), lastScan);
});

export const requirementTrace = asAction('tg-get-requirement-trace', async (payload, context) => {
  const key = parseRequirementKey(payload.requirementKey);
  if (!key) return { error: 'Give me a requirement key such as SPF-12.' };

  const projectKey = key.slice(0, key.lastIndexOf('-'));
  if (!(await canBrowse(projectKey, context))) return noAccess(projectKey);

  // A hidden requirement gets the same answer as one that does not exist.
  const notFound = { error: `TraceGuard has no saved trace for ${key}.` };
  const row = await getRequirement(projectKey, key);
  if (!row) return notFound;

  const visibleKeys = await visibleIssueKeys(referencedIssueKeys([row]));
  const [visibleRow] = filterForViewer([row], visibleKeys);
  if (!visibleRow) return notFound;

  return toRequirementAnswer(visibleRow, await getSettings(projectKey));
});

export const listGaps = asAction('tg-list-gaps', async (payload, context) => {
  const projectKey = resolveProjectKey(payload);
  if (!projectKey) return { error: ASK_FOR_PROJECT };
  if (!(await canBrowse(projectKey, context))) return noAccess(projectKey);

  return toGapList(projectKey, await matrixForViewer(projectKey), normalizeSeverity(payload.severity));
});

export const createAuditPack = asAction('tg-create-audit-pack', async (payload, context) => {
  const projectKey = resolveProjectKey(payload);
  if (!projectKey) return { error: ASK_FOR_PROJECT };
  if (!(await canBrowse(projectKey, context))) return noAccess(projectKey);

  return publishAuditPack(projectKey, payload.spaceKey, payload.releaseName, true);
});
