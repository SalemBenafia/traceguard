import { kvs, WhereConditions } from '@forge/kvs';
import { errorLabel } from './engine/errors';

const SETTINGS_PREFIX = 'settings:';
const SETTINGS_PAGE_SIZE = 20;
const MAX_JQL_LENGTH = 1000;
const LIST_LABELS = {
  implementationTypes: 'Implementation work types',
  testTypes: 'Verification work types',
  passedStatuses: 'Passed statuses',
  failedStatuses: 'Failed statuses',
};
const LIST_FIELDS = Object.keys(LIST_LABELS);

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
  console.error(`[TG] Failed to ${action} settings for ${projectKey}: ${errorLabel(cause)}`);
  return new Error(`Could not ${action} TraceGuard settings.`);
}

function requireText(value, label) {
  if (typeof value !== 'string') {
    throw new SettingsValidationError(`Enter ${label} as plain text.`);
  }
  return value.trim();
}

// Accepts comma-separated text from the form, or an array.
function toCleanList(value, field) {
  const items = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
    throw new SettingsValidationError(`Enter ${LIST_LABELS[field]} as a comma-separated list.`);
  }
  return items.map((item) => item.trim()).filter(Boolean);
}

function validateJql(value) {
  const jql = requireText(value, 'Requirement JQL');
  if (!jql) {
    throw new SettingsValidationError('Enter a Requirement JQL so TraceGuard can find your requirements.');
  }
  if (jql.length >= MAX_JQL_LENGTH) {
    throw new SettingsValidationError(`Shorten the Requirement JQL to under ${MAX_JQL_LENGTH} characters.`);
  }
  return jql;
}

function validateSpaceKey(value) {
  const spaceKey = requireText(value, 'the Confluence space key');
  if (!/^[a-zA-Z0-9]*$/.test(spaceKey)) {
    throw new SettingsValidationError('Use only letters and digits in the Confluence space key.');
  }
  return spaceKey;
}

// Returns only known fields, so extra data from the client is never stored.
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SettingsValidationError('Fill in the settings form and click Save again.');
  }
  if (typeof input.commentOnNewGaps !== 'boolean') {
    throw new SettingsValidationError('Turn Comment on new gaps on or off, then click Save again.');
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
