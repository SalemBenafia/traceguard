// Pure helpers for Atlassian personal data reporting. The caller supplies the storage functions.
import { parseScanTime } from './dashboard.js';

export const REPORT_BATCH_SIZE = 90; // Limit of the report-accounts API per request.
export const FORMER_USER = 'Former user';

const ACCOUNT_ID = /^[\w:-]{1,128}$/;
const UNKNOWN_TIME = 0; // An unknown retrieval time is reported as the oldest possible one.

export const isAccountId = (value) => typeof value === 'string' && ACCOUNT_ID.test(value);

function toMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string') return parseScanTime(value)?.getTime() ?? null;
  return null;
}

// Each account is reported with the oldest time any of its stored data was read.
export function collectReportedAccounts({ storedOwners = [], cachedTeams = [] }) {
  const oldest = new Map();
  const note = (accountId, time) => {
    if (!isAccountId(accountId)) return;
    const millis = toMillis(time) ?? UNKNOWN_TIME;
    if (!oldest.has(accountId) || millis < oldest.get(accountId)) oldest.set(accountId, millis);
  };

  for (const row of storedOwners) note(row.owner_account_id, row.oldest_scanned_at);
  for (const entry of cachedTeams) note(entry.accountId, entry.cachedAt);

  return [...oldest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountId, millis]) => ({ accountId, updatedAt: new Date(millis).toISOString() }));
}

// "closed" means erase. "updated" means the copy is stale and may be read again.
export function planPrivacyActions(updates) {
  const erase = new Set();
  const refresh = new Set();
  for (const update of updates ?? []) {
    if (!isAccountId(update?.accountId)) continue;
    if (update.status === 'closed') erase.add(update.accountId);
    if (update.status === 'updated') refresh.add(update.accountId);
  }
  for (const accountId of erase) refresh.delete(accountId);
  return { erase: [...erase], refresh: [...refresh] };
}

export async function applyPrivacyUpdates(updates, store) {
  const { erase, refresh } = planPrivacyActions(updates);

  if (erase.length > 0) await store.anonymiseOwners(erase);
  if (refresh.length > 0) await store.clearOwnerTeams(refresh);
  for (const accountId of [...erase, ...refresh]) await store.deleteCachedTeam(accountId);

  return { erased: erase.length, refreshed: refresh.length };
}
