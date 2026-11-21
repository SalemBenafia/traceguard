import Resolver from '@forge/resolver';
import { RequirementJqlError } from './engine/jql';
import { hasProjectPermission } from './jira/client';
import { scanProject } from './scanner';
import { getSettings, saveSettings, SettingsValidationError } from './settings';

const resolver = new Resolver();

// Forge stops UI-invoked functions at 25 seconds, so the scan ends before that.
const RESCAN_TIME_BUDGET_MS = 20_000;

const failure = (error) => ({ ok: false, error });
const projectKeyFrom = (context) => context.extension?.project?.key;
const NO_PROJECT_ERROR = 'TraceGuard could not find the current project.';

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
    const result = await scanProject(projectKey, {
      asUser: true,
      source: 'manual',
      timeBudgetMs: RESCAN_TIME_BUDGET_MS,
    });
    return { ok: true, result };
  } catch (error) {
    if (error instanceof RequirementJqlError) return failure(error.message);
    throw error;
  }
});

export const handler = resolver.getDefinitions();
