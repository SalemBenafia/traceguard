import Resolver from '@forge/resolver';
import { createAuditPack } from './auditPack';
import { getHistory, getMatrix, getOpenGaps } from './db/repo';
import { AuditPackError } from './engine/auditPack';
import { RequirementJqlError } from './engine/jql';
import { filterForViewer, filterGapsForViewer, referencedIssueKeys, toDashboardRow } from './engine/visibility';
import { getIssueTrace } from './issueTrace';
import { hasProjectPermission, visibleIssueKeys } from './jira/client';
import { runNightly } from './nightly';
import { scanProject } from './scanner';
import { defaultSettings, getSavedSettings, saveSettings, SettingsValidationError } from './settings';
import { matrixForViewer } from './viewerData';

const resolver = new Resolver();

// Forge stops UI-invoked functions at 25 seconds. This leaves time to save the scan.
const RESCAN_TIME_BUDGET_MS = 15_000;
const NIGHTLY_NOW_SCAN_BUDGET_MS = 10_000;
const NIGHTLY_NOW_DEADLINE_MS = 20_000;

const failure = (error) => ({ ok: false, error });
const projectKeyFrom = (context) => context.extension?.project?.key;
const NO_PROJECT_ERROR = 'TraceGuard could not find this project, so reload the page and try again.';
const NO_ACCESS_ERROR = 'You do not have access to this project, so ask a project admin for access.';

// Everything the project page shows, limited to what this viewer can see.
async function dashboardForViewer(projectKey) {
  const matrix = await getMatrix(projectKey);
  const openGaps = await getOpenGaps(projectKey);
  const history = await getHistory(projectKey);
  const visibleKeys = await visibleIssueKeys([
    ...referencedIssueKeys(matrix),
    ...openGaps.map((gap) => gap.req_key),
  ]);

  const visibleMatrix = filterForViewer(matrix, visibleKeys);
  return {
    matrix: visibleMatrix.map(toDashboardRow),
    hiddenCount: matrix.length - visibleMatrix.length,
    openGaps: filterGapsForViewer(openGaps, visibleKeys),
    history,
    lastScan: history[0] ?? null,
  };
}

resolver.define('getSettings', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  // Settings live in app storage, which does not apply Jira permissions by itself.
  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }
  const saved = await getSavedSettings(projectKey);
  return {
    ok: true,
    settings: saved ?? defaultSettings(projectKey),
    hasSavedSettings: saved !== null,
    // Only controls the button. runNightlyNow checks this permission again.
    canRunNightly: await hasProjectPermission(projectKey, 'ADMINISTER_PROJECTS').catch(() => false),
  };
});

resolver.define('runNightlyNow', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'ADMINISTER_PROJECTS'))) {
    return failure('Only project admins can run the nightly job, so ask a project admin to run it.');
  }

  const { failures, ...summary } = await runNightly({
    projectKeys: [projectKey],
    graphAsUser: true,
    scanBudgetMs: NIGHTLY_NOW_SCAN_BUDGET_MS,
    deadlineAt: Date.now() + NIGHTLY_NOW_DEADLINE_MS,
  });
  return failures.length > 0 ? failure(failures[0].message) : { ok: true, ...summary };
});

resolver.define('saveSettings', async ({ payload, context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'ADMINISTER_PROJECTS'))) {
    return failure('Only project admins can change TraceGuard settings, so ask a project admin to make this change.');
  }

  try {
    return { ok: true, settings: await saveSettings(projectKey, payload) };
  } catch (error) {
    if (error instanceof SettingsValidationError) return failure(error.message);
    throw error;
  }
});

resolver.define('rescan', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }

  try {
    // Reads Jira as the app so the shared audit data does not depend on who clicked.
    const { warnings } = await scanProject(projectKey, {
      asUser: false,
      graphAsUser: true,
      source: 'manual',
      timeBudgetMs: RESCAN_TIME_BUDGET_MS,
    });
    return { ok: true, ...(await dashboardForViewer(projectKey)), warnings };
  } catch (error) {
    if (error instanceof RequirementJqlError) return failure(error.message);
    throw error;
  }
});

resolver.define('getOverview', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }
  return { ok: true, ...(await dashboardForViewer(projectKey)) };
});

resolver.define('getMatrix', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }
  return { ok: true, matrix: (await matrixForViewer(projectKey)).map(toDashboardRow) };
});

resolver.define('getHistory', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }
  return { ok: true, history: await getHistory(projectKey) };
});

resolver.define('getIssueTrace', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  const issueKey = context.extension?.issue?.key;
  if (!projectKey || !issueKey) return failure('TraceGuard could not find this work item, so reload the page and try again.');

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure(NO_ACCESS_ERROR);
  }

  try {
    return { ok: true, ...(await getIssueTrace(projectKey, issueKey)) };
  } catch (error) {
    if (error instanceof RequirementJqlError) return failure(error.message);
    throw error;
  }
});

resolver.define('createAuditPack', async ({ payload, context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  try {
    const pack = await createAuditPack(projectKey, payload?.spaceKey, payload?.releaseName, true);
    return { ok: true, ...pack };
  } catch (error) {
    if (error instanceof AuditPackError) return failure(error.message);
    throw error;
  }
});

export const handler = resolver.getDefinitions();
