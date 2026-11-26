import api, { route } from '@forge/api';
import { mapWithLimit } from '../engine/concurrency';
import { chunk } from '../engine/gapDiff';
import { readWithRetry, traceLabel } from '../http';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const VISIBILITY_BATCH_SIZE = 100;
const VISIBILITY_PARALLEL_BATCHES = 5;

// Carries the HTTP status so callers can react to specific Jira failures.
export class JiraApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const requester = (asUser) => (asUser ? api.asUser() : api.asApp());

// Response bodies can quote customer content, so they are never logged.
function failedRequest(action, res) {
  console.error(`[TG] ${action} failed with ${res.status}${traceLabel(res)}`);
  return new JiraApiError(`${action} failed with status ${res.status}.`, res.status);
}

export async function searchAll(jql, fields, { asUser = false, max = 500 } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const res = await readWithRetry(() =>
      requester(asUser).requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ jql, fields, maxResults: 100, nextPageToken }),
      }),
    );
    if (!res.ok) throw failedRequest('Jira search', res);

    const data = await res.json();
    issues.push(...data.issues);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && issues.length < max);

  return issues.slice(0, max);
}

export async function getChangelog(issueKey, { asUser = false } = {}) {
  const items = [];
  let startAt = 0;
  for (;;) {
    const res = await readWithRetry(() =>
      requester(asUser).requestJira(
        route`/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=100`,
        { headers: { Accept: 'application/json' } },
      ),
    );
    if (!res.ok) throw failedRequest(`Changelog for ${issueKey}`, res);

    const data = await res.json();
    items.push(...data.values);
    if (data.isLast || data.values.length === 0) return items;
    startAt += data.values.length;
  }
}

export async function getIssue(issueKey, fields, { asUser = false } = {}) {
  const res = await readWithRetry(() =>
    requester(asUser).requestJira(route`/rest/api/3/issue/${issueKey}?fields=${fields.join(',')}`, {
      headers: { Accept: 'application/json' },
    }),
  );
  if (!res.ok) throw failedRequest(`Reading ${issueKey}`, res);
  return res.json();
}

export async function addComment(issueKey, body) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw failedRequest(`Comment on ${issueKey}`, res);
}

async function fetchVisibleKeys(issueKeys) {
  const res = await readWithRetry(() =>
    api.asUser().requestJira(route`/rest/api/3/issue/bulkfetch`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ issueIdsOrKeys: issueKeys, fields: ['issuetype'] }),
    }),
  );
  if (!res.ok) throw failedRequest('Issue visibility check', res);

  const data = await res.json();
  return (data.issues ?? []).map((issue) => issue.key);
}

// Jira leaves out issues the signed-in user is not allowed to see.
export async function visibleIssueKeys(issueKeys) {
  const batches = chunk([...new Set(issueKeys)], VISIBILITY_BATCH_SIZE);
  const visible = await mapWithLimit(batches, VISIBILITY_PARALLEL_BATCHES, fetchVisibleKeys);
  return new Set(visible.flat());
}

// Runs as the signed-in user, so Jira answers for that user's own access.
export async function hasProjectPermission(projectKey, permission) {
  const res = await readWithRetry(() =>
    api
      .asUser()
      .requestJira(route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=${permission}`, {
        headers: { Accept: 'application/json' },
      }),
  );

  // Jira answers 404 when the user cannot see the project.
  if (res.status === 404) return false;
  if (!res.ok) throw failedRequest(`Permission check for ${projectKey}`, res);

  const { permissions } = await res.json();
  return permissions?.[permission]?.havePermission === true;
}
