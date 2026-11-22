import { kvs, WhereConditions } from '@forge/kvs';

const SETTINGS_PREFIX = 'settings:';
const SETTINGS_PAGE_SIZE = 20;
const MAX_JQL_LENGTH = 1000;
const LIST_FIELDS = ['implementationTypes', 'testTypes', 'passedStatuses', 'failedStatuses'];

// Marks errors whose message is safe and useful to show to the user.
export class SettingsValidationError extends Error {}

const settingsKey = (projectKey) => `${SETTINGS_PREFIX}${projectKey}`;

export const defaultSettings = (projectKey) => ({
  requirementJql: `project = ${projectKey} AND issuetype = Requirement`,
  implementationTypes: ['Story', 'Task', 'Bug'],
  testTypes: ['Test'],
  passedStatuses: ['Passed'],
  failedStatuses: ['Failed'],
  auditSpaceKey: '',
  commentOnNewGaps: true,
});

function storageError(action, projectKey, cause) {
  console.error(`[TG] Failed to ${action} settings for ${projectKey}: ${cause.message}`);
  return new Error(`Could not ${action} TraceGuard settings.`);
}

function requireText(value, label) {
  if (typeof value !== 'string') {
    throw new SettingsValidationError(`${label} must be text.`);
  }
  return value.trim();
}

// Accepts comma-separated text from the form, or an array.
function toCleanList(value, field) {
  const items = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
    throw new SettingsValidationError(`${field} must be a comma-separated list.`);
  }
  return items.map((item) => item.trim()).filter(Boolean);
}

function validateJql(value) {
  const jql = requireText(value, 'Requirement JQL');
  if (!jql) {
    throw new SettingsValidationError('Requirement JQL is required.');
  }
  if (jql.length >= MAX_JQL_LENGTH) {
    throw new SettingsValidationError(`Requirement JQL must be under ${MAX_JQL_LENGTH} characters.`);
  }
  return jql;
}

function validateSpaceKey(value) {
  const spaceKey = requireText(value, 'Audit space key');
  if (!/^[a-zA-Z0-9]*$/.test(spaceKey)) {
    throw new SettingsValidationError('Audit space key can only contain letters and digits.');
  }
  return spaceKey;
}

// Returns only known fields, so extra data from the client is never stored.
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SettingsValidationError('Settings are missing.');
  }
  if (typeof input.commentOnNewGaps !== 'boolean') {
    throw new SettingsValidationError('Comment on new gaps must be on or off.');
  }

  const lists = Object.fromEntries(
    LIST_FIELDS.map((field) => [field, toCleanList(input[field], field)]),
  );

  return {
    requirementJql: validateJql(input.requirementJql),
    ...lists,
    auditSpaceKey: validateSpaceKey(input.auditSpaceKey),
    commentOnNewGaps: input.commentOnNewGaps,
  };
}

export async function getSettings(projectKey) {
  try {
    const saved = await kvs.get(settingsKey(projectKey));
    return { ...defaultSettings(projectKey), ...(saved || {}) };
  } catch (error) {
    throw storageError('load', projectKey, error);
  }
}

// Returns null for a project whose admin has never saved settings.
export async function getSavedSettings(projectKey) {
  try {
    const saved = await kvs.get(settingsKey(projectKey));
    return saved ? { ...defaultSettings(projectKey), ...saved } : null;
  } catch (error) {
    throw storageError('load', projectKey, error);
  }
}

export async function listProjectsWithSettings() {
  const projectKeys = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(SETTINGS_PREFIX)).limit(SETTINGS_PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);

    const page = await query.getMany();
    projectKeys.push(...page.results.map(({ key }) => key.slice(SETTINGS_PREFIX.length)));
    cursor = page.nextCursor;
  } while (cursor);
  return projectKeys;
}

export async function saveSettings(projectKey, input) {
  const clean = validateSettings(input);
  try {
    await kvs.set(settingsKey(projectKey), clean);
    return clean;
  } catch (error) {
    throw storageError('save', projectKey, error);
  }
}
