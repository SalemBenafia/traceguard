import api, { route } from '@forge/api';
import { AuditPackError } from '../engine/auditPack';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const CANNOT_REACH =
  'TraceGuard could not reach Confluence. Check that the app is installed in Confluence and that you can view this space.';

// Marks a create request rejected because another page took the title first.
export class TitleTakenError extends Error {}

async function logFailure(action, res) {
  const details = (await res.text()).slice(0, 300);
  console.error(`[TG] Confluence ${action} failed with ${res.status}: ${details}`);
  return details;
}

export async function getSpace(spaceKey) {
  const res = await api
    .asUser()
    .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    await logFailure('space lookup', res);
    throw new AuditPackError(CANNOT_REACH);
  }

  const data = await res.json();
  const space = data.results?.[0];
  if (!space) throw new AuditPackError(`Confluence space ${spaceKey} was not found, or you cannot view it.`);
  return { id: space.id, baseUrl: data._links?.base };
}

export async function pageTitleExists(spaceId, title) {
  const res = await api
    .asUser()
    .requestConfluence(route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&limit=1`, {
      headers: { Accept: 'application/json' },
    });
  if (!res.ok) {
    await logFailure('title check', res);
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
    const details = await logFailure('page creation', res);
    if (res.status === 400 && /title/i.test(details)) throw new TitleTakenError(title);
    if (res.status === 403 || res.status === 404) {
      throw new AuditPackError('You do not have permission to create pages in this Confluence space.');
    }
    throw new AuditPackError('Confluence could not create the audit pack. Please try again.');
  }

  const page = await res.json();
  return `${page._links?.base ?? baseUrl}${page._links?.webui ?? ''}`;
}
