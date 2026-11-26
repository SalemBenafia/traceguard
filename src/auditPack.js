import { createPage, getSpace, pageTitleExists, TitleTakenError } from './confluence/client';
import { getLatestScanRun } from './db/repo';
import {
  auditPackTitle,
  AuditPackError,
  buildAuditPackPage,
  isValidSpaceKey,
  normalizeReleaseName,
  titleForAttempt,
} from './engine/auditPack';
import { utcDay } from './engine/gapComment';
import { hasProjectPermission } from './jira/client';
import { getSettings } from './settings';
import { viewerMatrix } from './viewerData';

const MAX_TITLE_ATTEMPTS = 20;

function chooseSpaceKey(input, settings) {
  const spaceKey = (typeof input === 'string' ? input.trim() : '') || settings.auditSpaceKey;
  if (!spaceKey) {
    throw new AuditPackError('Enter a Confluence space key, or set one in TraceGuard Settings.');
  }
  if (!isValidSpaceKey(spaceKey)) {
    throw new AuditPackError('Use only letters and digits in the Confluence space key.');
  }
  return spaceKey;
}

// A page created between the check and the write moves on to the next title.
async function createWithFreeTitle(space, baseTitle, html) {
  for (let attempt = 1; attempt <= MAX_TITLE_ATTEMPTS; attempt += 1) {
    const title = titleForAttempt(baseTitle, attempt);
    if (await pageTitleExists(space.id, title)) continue;

    try {
      const url = await createPage({ spaceId: space.id, title, html, baseUrl: space.baseUrl });
      return { title, url };
    } catch (error) {
      if (!(error instanceof TitleTakenError)) throw error;
    }
  }
  throw new AuditPackError('Too many audit packs use this title, so enter a different release name.');
}

export async function createAuditPack(projectKey, spaceKey, releaseName, asUser) {
  if (asUser !== true) throw new AuditPackError('Audit packs must be created by a signed-in user, so sign in and try again.');
  if (!(await hasProjectPermission(projectKey, 'BROWSE_PROJECTS'))) {
    throw new AuditPackError(`You do not have access to project ${projectKey}, so ask a project admin for access.`);
  }

  const settings = await getSettings(projectKey);
  const targetSpaceKey = chooseSpaceKey(spaceKey, settings);
  const scan = await getLatestScanRun(projectKey);
  if (!scan) throw new AuditPackError('Run a scan on the Overview tab before creating an audit pack.');

  const { matrix, hiddenCount } = await viewerMatrix(projectKey);
  if (matrix.length === 0) throw new AuditPackError('You cannot see any requirements to include, so check the Requirement JQL or ask a project admin for access.');

  const space = await getSpace(targetSpaceKey);
  if (!space.baseUrl) throw new AuditPackError('TraceGuard could not find the Confluence site address, so try again in a moment.');

  const release = normalizeReleaseName(releaseName);
  const day = utcDay();
  const html = buildAuditPackPage({
    projectKey,
    releaseName: release,
    matrix,
    jiraBaseUrl: new URL(space.baseUrl).origin,
    scanId: scan.id,
    generatedOn: day,
    hiddenCount,
  });

  const page = await createWithFreeTitle(space, auditPackTitle({ projectKey, releaseName: release, day }), html);
  console.log(`[TG] Audit pack created for ${projectKey} in space ${targetSpaceKey}`);
  return { ...page, spaceKey: targetSpaceKey };
}
