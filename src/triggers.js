import { kvs } from '@forge/kvs';
import { groupKeysByProject } from './engine/gapComment';
import { runNightly } from './nightly';
import { findRequirementKeysForIssue, scanRequirements } from './scanner';
import { listProjectsWithSettings } from './settings';

const RESCAN_WINDOW_MS = 30_000;
const EVENT_SCAN_BUDGET_MS = 20_000;
const NIGHTLY_BUDGET_MS = 840_000; // The function is stopped at 900 seconds.
const LAST_SCAN_TTL = { value: 5, unit: 'MINUTES' };

const lastScanKey = (requirementKey) => `event-scan:${requirementKey}`;

// KVS can briefly return expired values, so the stored time is always compared.
async function claimScan(requirementKey) {
  try {
    const lastScanAt = await kvs.get(lastScanKey(requirementKey));
    if (typeof lastScanAt === 'number' && Date.now() - lastScanAt < RESCAN_WINDOW_MS) return false;

    await kvs.set(lastScanKey(requirementKey), Date.now(), { ttl: LAST_SCAN_TTL });
  } catch (error) {
    console.error(`[TG] Could not check the last scan of ${requirementKey}: ${error.message}`);
  }
  return true;
}

async function forgetScans(requirementKeys) {
  for (const key of requirementKeys) {
    try {
      await kvs.delete(lastScanKey(key));
    } catch (error) {
      console.error(`[TG] Could not reset the last scan of ${key}: ${error.message}`);
    }
  }
}

async function keysDueForScan(requirementKeys) {
  const due = [];
  for (const key of requirementKeys) {
    if (await claimScan(key)) due.push(key);
  }
  return due;
}

// scanRequirements handles one project at a time, and links can cross projects.
async function scanByProject(requirementKeys) {
  const deadlineAt = Date.now() + EVENT_SCAN_BUDGET_MS;

  for (const [projectKey, keys] of groupKeysByProject(requirementKeys)) {
    try {
      await scanRequirements(keys, {
        asUser: false,
        source: 'event',
        timeBudgetMs: Math.max(deadlineAt - Date.now(), 1_000),
      });
    } catch (error) {
      console.error(`[TG] Event scan failed for ${projectKey}: ${error.message}`);
      await forgetScans(keys);
    }
  }
}

function issueIdsFrom(event) {
  if (event?.issue?.id) return [event.issue.id];
  return [event?.sourceIssueId, event?.destinationIssueId].filter(Boolean);
}

export async function onJiraEvent(event) {
  try {
    const keys = new Set();
    for (const id of issueIdsFrom(event)) {
      (await findRequirementKeysForIssue(id)).forEach((key) => keys.add(key));
    }

    const dueKeys = await keysDueForScan([...keys]);
    if (dueKeys.length > 0) await scanByProject(dueKeys);
  } catch (error) {
    console.error(`[TG] Event failed: ${error?.message ?? error}`);
  }
}

export async function nightlyScan() {
  try {
    const projectKeys = await listProjectsWithSettings();
    const summary = await runNightly({ projectKeys, deadlineAt: Date.now() + NIGHTLY_BUDGET_MS });
    console.log(
      `[TG] Nightly job finished: ${projectKeys.length} projects, ${summary.scanned} requirements, ` +
        `${summary.commentsPosted} comments, ${summary.commentsWaiting} waiting, ${summary.failures.length} failed`,
    );
  } catch (error) {
    console.error(`[TG] Nightly job failed: ${error?.message ?? error}`);
  }
}
