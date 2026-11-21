import Resolver from '@forge/resolver';
import { getHistory, getLatestScanRun, getMatrix } from './db/repo';
import { RequirementJqlError } from './engine/jql';
import { filterForViewer, referencedIssueKeys } from './engine/visibility';
import { hasProjectPermission, visibleIssueKeys } from './jira/client';
import { scanProject } from './scanner';
import { getSettings, saveSettings, SettingsValidationError } from './settings';

const resolver = new Resolver();

// Forge stops UI-invoked functions at 25 seconds. This leaves time to save the scan.
const RESCAN_TIME_BUDGET_MS = 15_000;

const failure = (error) => ({ ok: false, error });
const projectKeyFrom = (context) => context.extension?.project?.key;
const NO_PROJECT_ERROR = 'TraceGuard could not find the current project.';

// Saved results are shared, so each viewer only receives what Jira lets them see.
async function matrixForViewer(projectKey) {
  const matrix = await getMatrix(projectKey);
  const visibleKeys = await visibleIssueKeys(referencedIssueKeys(matrix));
  return filterForViewer(matrix, visibleKeys);
}

resolver.define('getSettings', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  // Settings live in app storage, which does not apply Jira permissions by itself.
  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure('You need access to this project to view its TraceGuard settings.');
  }
  return { ok: true, settings: await getSettings(projectKey) };
});

resolver.define('saveSettings', async ({ payload, context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'ADMINISTER_PROJECTS'))) {
    return failure('Only project admins can change TraceGuard settings.');
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
    return failure('You need access to this project to run a TraceGuard scan.');
  }

  try {
    // Reads Jira as the app so the shared audit data does not depend on who clicked.
    const { warnings } = await scanProject(projectKey, {
      asUser: false,
      source: 'manual',
      timeBudgetMs: RESCAN_TIME_BUDGET_MS,
    });
    return {
      ok: true,
      matrix: await matrixForViewer(projectKey),
      latestRun: await getLatestScanRun(projectKey),
      warnings,
    };
  } catch (error) {
    if (error instanceof RequirementJqlError) return failure(error.message);
    throw error;
  }
});

resolver.define('getMatrix', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure('You need access to this project to view its traceability matrix.');
  }
  return { ok: true, matrix: await matrixForViewer(projectKey) };
});

resolver.define('getHistory', async ({ context }) => {
  const projectKey = projectKeyFrom(context);
  if (!projectKey) return failure(NO_PROJECT_ERROR);

  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    return failure('You need access to this project to view its scan history.');
  }
  return { ok: true, history: await getHistory(projectKey) };
});

export const handler = resolver.getDefinitions();
