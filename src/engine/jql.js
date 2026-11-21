// Pure helpers that keep a saved requirement JQL inside its own project.

const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

// Its message is safe to show to the user.
export class RequirementJqlError extends Error {}

const invalidJql = () =>
  new RequirementJqlError('The Requirement JQL has unbalanced quotes or brackets. Fix it in Settings.');

const startsOrderBy = (jql, index) =>
  !/\w/.test(jql[index - 1] ?? '') && /^order\s+by\b/i.test(jql.slice(index));

// Finds a top-level ORDER BY, ignoring text in quotes and brackets.
function findOrderBy(jql) {
  let quote = null;
  let depth = 0;
  let orderByIndex = -1;

  for (let index = 0; index < jql.length; index += 1) {
    const char = jql[index];
    if (char === '\\') {
      index += 1;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      // A closing bracket here could escape the project filter added below.
      if (depth < 0) throw invalidJql();
    } else if (depth === 0 && orderByIndex < 0 && startsOrderBy(jql, index)) {
      orderByIndex = index;
    }
  }

  if (quote || depth !== 0) throw invalidJql();
  return orderByIndex;
}

function splitOrderBy(jql) {
  const orderByIndex = findOrderBy(jql);
  if (orderByIndex < 0) return { filter: jql.trim(), orderBy: 'ORDER BY key ASC' };
  return { filter: jql.slice(0, orderByIndex).trim(), orderBy: jql.slice(orderByIndex).trim() };
}

// Always limits results to one project, because app-level scans can see every project.
export function requirementJql(projectKey, savedJql, keys = null) {
  if (!PROJECT_KEY.test(projectKey)) throw new Error(`Invalid project key: ${projectKey}`);

  const invalidKey = keys?.find((key) => !ISSUE_KEY.test(key));
  if (invalidKey) throw new Error(`Invalid issue key: ${invalidKey}`);

  const { filter, orderBy } = splitOrderBy(savedJql);
  const conditions = [`project = "${projectKey}"`];
  if (keys) conditions.push(`key in (${keys.map((key) => `"${key}"`).join(', ')})`);
  if (filter) conditions.push(`(${filter})`);

  return `${conditions.join(' AND ')} ${orderBy}`;
}
