// Pure helpers that read timestamps from Jira changelog entries.

const JIRA_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:?\d{2})$/;
const CONTENT_FIELDS = new Set(['summary', 'description']);

// Jira writes offsets as +0000, which is not the standard +00:00 date format.
export function parseJiraTime(value) {
  if (typeof value !== 'string') return null;

  const match = JIRA_TIME.exec(value);
  if (!match) return null;

  const [, dateTime, offset] = match;
  const standardOffset = offset === 'Z' ? offset : `${offset.slice(0, 3)}:${offset.slice(-2)}`;
  const epochMs = Date.parse(`${dateTime}${standardOffset}`);
  return Number.isNaN(epochMs) ? null : epochMs;
}

const fieldOf = (item) => item.fieldId ?? item.field;

function latestMatchingChange(changelog, itemMatches) {
  const times = changelog
    .filter((entry) => (entry.items ?? []).some(itemMatches))
    .map((entry) => parseJiraTime(entry.created))
    .filter((time) => time !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

export const latestContentChange = (changelog) =>
  latestMatchingChange(changelog, (item) => CONTENT_FIELDS.has(fieldOf(item)));

export const latestMoveToStatus = (changelog, statusName) =>
  latestMatchingChange(changelog, (item) => fieldOf(item) === 'status' && item.toString === statusName);
