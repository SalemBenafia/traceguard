import api, { route } from '@forge/api';
import { AuditPackError } from '../engine/auditPack';
import { readWithRetry, traceLabel } from '../http';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const CANNOT_REACH =
  'TraceGuard could not reach Confluence, so check that the app is installed there and that you can view this space.';

// Marks a create request rejected because another page took the title first.
export class TitleTakenError extends Error {}

// Response bodies can quote customer content, so they are never logged.
const logFailure = (action, res) =>
  console.error(`[TG] Confluence ${action} failed with ${res.status}${traceLabel(res)}`);

export async function getSpace(spaceKey) {
  const res = await readWithRetry(() =>
    api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`, { headers: { Accept: 'application/json' } }),
  );
  if (!res.ok) {
    logFailure('space lookup', res);
    throw new AuditPackError(CANNOT_REACH);
  }

  const data = await res.json();
  const space = data.results?.[0];
  if (!space) throw new AuditPackError(`Confluence space ${spaceKey} was not found, so check the space key and your access.`);
  return { id: space.id, baseUrl: data._links?.base };
}

export async function pageTitleExists(spaceId, title) {
  const res = await readWithRetry(() =>
    api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&limit=1`, {
        headers: { Accept: 'application/json' },
      }),
  );
  if (!res.ok) {
    logFailure('title check', res);
    throw new AuditPackError(CANNOT_REACH);
  }
  return ((await res.json()).results ?? []).length > 0;
}

export async function createPage({ spaceId, title, html, baseUrl }) {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'storage', value: html } }),
  });

  if (!res.ok) {
    logFailure('page creation', res);
    const details = (await res.text()).slice(0, 300);
    if (res.status === 400 && /title/i.test(details)) throw new TitleTakenError(title);
    if (res.status === 403 || res.status === 404) {
      throw new AuditPackError('You cannot create pages in this Confluence space, so choose another space or ask a space admin for access.');
    }
    throw new AuditPackError('Confluence could not create the audit pack, so try again in a moment.');
  }

  const page = await res.json();
  return `${page._links?.base ?? baseUrl}${page._links?.webui ?? ''}`;
}
