import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { getSettings, saveSettings, SettingsValidationError } from './settings';

const resolver = new Resolver();

const failure = (error) => ({ ok: false, error });
const projectKeyFrom = (context) => context.extension?.project?.key;
const NO_PROJECT_ERROR = 'TraceGuard could not find the current project.';

// Runs as the signed-in user, so Jira answers for that user's own access.
async function hasProjectPermission(projectKey, permission) {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=${permission}`, {
      headers: { Accept: 'application/json' },
    });

  // Jira answers 404 when the user cannot see the project.
  if (res.status === 404) return false;
  if (!res.ok) {
    console.error(`[TG] Permission check failed for ${projectKey}: ${res.status}`);
    throw new Error(`Could not check your permissions for project ${projectKey}.`);
  }

  const { permissions } = await res.json();
  return permissions?.[permission]?.havePermission === true;
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

export const handler = resolver.getDefinitions();
