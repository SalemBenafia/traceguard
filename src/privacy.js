import { privacy } from '@forge/api';
import { anonymiseOwners, clearOwnerTeams, getStoredOwners } from './db/repo';
import { errorLabel } from './engine/errors';
import { chunk } from './engine/gapDiff';
import { applyPrivacyUpdates, collectReportedAccounts, REPORT_BATCH_SIZE } from './engine/privacy';
import { deleteCachedTeam, listCachedTeamOwners } from './graph/teams';

const store = { anonymiseOwners, clearOwnerTeams, deleteCachedTeam };

// The helper rejects with the HTTP response, so only its status is kept.
async function reportBatch(accounts) {
  try {
    return await privacy.reportPersonalData(accounts);
  } catch (error) {
    console.error(`[TG] Personal data report request failed: ${errorLabel(error)}`);
    throw Object.assign(new Error('Personal data report failed.'), { code: errorLabel(error) });
  }
}

// Daily job: reports every stored account id, then erases or refreshes as Atlassian asks.
export async function runPrivacyReport() {
  try {
    const accounts = collectReportedAccounts({
      storedOwners: await getStoredOwners(),
      cachedTeams: await listCachedTeamOwners(),
    });
    const totals = { reported: 0, erased: 0, refreshed: 0 };

    // One batch at a time, so a failure stops before the next request.
    for (const batch of chunk(accounts, REPORT_BATCH_SIZE)) {
      const { erased, refreshed } = await applyPrivacyUpdates(await reportBatch(batch), store);
      totals.reported += batch.length;
      totals.erased += erased;
      totals.refreshed += refreshed;
    }

    console.log(
      `[TG] Privacy report finished: ${totals.reported} reported, ${totals.erased} erased, ${totals.refreshed} refreshed`,
    );
  } catch (error) {
    console.error(`[TG] Privacy report failed: ${errorLabel(error)}`);
  }
}
