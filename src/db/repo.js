import { randomUUID } from 'node:crypto';
import { sql } from '@forge/sql';
import { batchByBytes, chunk, diffGaps, gapEventId, sortByKeyNumber } from '../engine/gapDiff';
import { ensureMigrations } from './migrations';

const MAX_ROWS_PER_WRITE = 50;
const MAX_BYTES_PER_WRITE = 512 * 1024; // Forge SQL requests are limited to 1 MiB.
const MAX_KEYS_PER_STATEMENT = 200;
const MAX_HISTORY_ROWS = 100;

const REQUIREMENT_COLUMN_COUNT = 11;
const GAP_EVENT_COLUMN_COUNT = 5;

const UPSERT_COLUMNS = `project_key, req_key, summary, status, owner_account_id, owner_name,
  owner_team, rag, gaps_json, chain_json, scanned_at`;

const UPSERT_UPDATE = `ON DUPLICATE KEY UPDATE summary = VALUES(summary), status = VALUES(status),
  owner_account_id = VALUES(owner_account_id), owner_name = VALUES(owner_name),
  owner_team = VALUES(owner_team), rag = VALUES(rag), gaps_json = VALUES(gaps_json),
  chain_json = VALUES(chain_json), scanned_at = VALUES(scanned_at)`;

const SCAN_RUN_COLUMNS = 'id, project_key, source, started_at, finished_at, total, green, amber, red';

export const toSqlDate = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

const placeholders = (count) => Array(count).fill('?').join(', ');
const rowPlaceholders = (rowCount, columnCount) =>
  Array(rowCount).fill(`(${placeholders(columnCount)})`).join(', ');
const limitLength = (value, maxLength) => (value == null ? null : String(value).slice(0, maxLength));

async function execute(action, query, params = []) {
  try {
    return await sql.prepare(query).bindParams(...params).execute();
  } catch (error) {
    console.error(`[TG] SQL failed to ${action}: ${error.code ?? 'UNKNOWN'} ${error.message}`);
    throw new Error(`Could not ${action}.`);
  }
}

const insertScanRun = (runId, projectKey, source, startedAt) =>
  execute(
    'save the scan run',
    'INSERT INTO tg_scan_runs (id, project_key, source, started_at) VALUES (?, ?, ?, ?)',
    [runId, projectKey, limitLength(source, 16), startedAt],
  );

const requirementParams = (projectKey, requirement, scannedAt) => [
  projectKey,
  requirement.key,
  limitLength(requirement.summary ?? '', 512),
  limitLength(requirement.status, 64),
  limitLength(requirement.assigneeAccountId, 128),
  limitLength(requirement.ownerName, 255),
  limitLength(requirement.ownerTeam, 255),
  requirement.rag,
  JSON.stringify(requirement.gaps),
  JSON.stringify({
    links: requirement.links,
    counts: requirement.counts,
    contentChangedAt: requirement.contentChangedAt,
  }),
  scannedAt,
];

async function upsertRequirements(projectKey, requirements, scannedAt) {
  const rows = requirements.map((requirement) => requirementParams(projectKey, requirement, scannedAt));
  for (const batch of batchByBytes(rows, MAX_ROWS_PER_WRITE, MAX_BYTES_PER_WRITE)) {
    await execute(
      'save requirements',
      `INSERT INTO tg_requirements (${UPSERT_COLUMNS})
       VALUES ${rowPlaceholders(batch.length, REQUIREMENT_COLUMN_COUNT)} ${UPSERT_UPDATE}`,
      batch.flat(),
    );
  }
}

async function readSavedKeys(projectKey) {
  const { rows } = await execute(
    'read saved requirements',
    'SELECT req_key FROM tg_requirements WHERE project_key = ?',
    [projectKey],
  );
  return rows.map((row) => row.req_key);
}

// Only a complete scan with results can prove that a requirement is gone.
function findRemovedKeys(scanResult, savedKeys) {
  if (!scanResult.complete) return { removedKeys: [], warnings: [] };

  if (scanResult.requirements.length === 0 && savedKeys.length > 0) {
    return {
      removedKeys: [],
      warnings: ['Jira returned no requirements, so saved data was kept. Check the Requirement JQL and app access.'],
    };
  }

  const scannedKeys = new Set(scanResult.requirements.map((requirement) => requirement.key));
  return { removedKeys: savedKeys.filter((key) => !scannedKeys.has(key)), warnings: [] };
}

async function openGapEvents(projectKey, toOpen, openedAt) {
  const rows = toOpen.map(({ reqKey, gapCode, previousEvents }) => [
    gapEventId(projectKey, reqKey, gapCode, previousEvents),
    projectKey,
    reqKey,
    gapCode,
    openedAt,
  ]);

  for (const batch of chunk(rows, MAX_ROWS_PER_WRITE)) {
    await execute(
      'open gap events',
      `INSERT INTO tg_gap_events (id, project_key, req_key, gap_code, opened_at)
       VALUES ${rowPlaceholders(batch.length, GAP_EVENT_COLUMN_COUNT)}
       ON DUPLICATE KEY UPDATE id = id`,
      batch.flat(),
    );
  }
}

async function closeGapEvents(projectKey, eventIds, closedAt) {
  for (const batch of chunk(eventIds, MAX_KEYS_PER_STATEMENT)) {
    await execute(
      'close gap events',
      `UPDATE tg_gap_events SET closed_at = ?
       WHERE project_key = ? AND closed_at IS NULL AND id IN (${placeholders(batch.length)})`,
      [closedAt, projectKey, ...batch],
    );
  }
}

async function applyGapChanges(projectKey, scanned, removedKeys, changedAt) {
  const { rows: openEvents } = await execute(
    'read open gaps',
    'SELECT id, req_key, gap_code FROM tg_gap_events WHERE project_key = ? AND closed_at IS NULL',
    [projectKey],
  );
  const { rows: eventCounts } = await execute(
    'read gap history',
    `SELECT req_key, gap_code, COUNT(*) AS event_count FROM tg_gap_events
     WHERE project_key = ? GROUP BY req_key, gap_code`,
    [projectKey],
  );

  const { toOpen, toClose } = diffGaps({ scanned, removedKeys, openEvents, eventCounts });
  await openGapEvents(projectKey, toOpen, changedAt);
  await closeGapEvents(projectKey, toClose, changedAt);
}

async function deleteRequirements(projectKey, keys) {
  for (const batch of chunk(keys, MAX_KEYS_PER_STATEMENT)) {
    await execute(
      'remove old requirements',
      `DELETE FROM tg_requirements WHERE project_key = ? AND req_key IN (${placeholders(batch.length)})`,
      [projectKey, ...batch],
    );
  }
}

// Counts saved rows, so a partial scan does not look like a drop in requirements.
async function countSavedByRag(projectKey) {
  const { rows } = await execute(
    'count requirements',
    'SELECT rag FROM tg_requirements WHERE project_key = ?',
    [projectKey],
  );
  const totals = { total: rows.length, green: 0, amber: 0, red: 0 };
  for (const { rag } of rows) totals[rag] += 1;
  return totals;
}

const finishScanRun = (runId, finishedAt, totals) =>
  execute(
    'finish the scan run',
    'UPDATE tg_scan_runs SET finished_at = ?, total = ?, green = ?, amber = ?, red = ? WHERE id = ?',
    [finishedAt, totals.total, totals.green, totals.amber, totals.red, runId],
  );

// Forge SQL runs each statement separately. This order means a failed save can
// be repeated safely, and an unfinished run is never reported as the latest.
export async function saveScan(projectKey, scanResult, source) {
  await ensureMigrations();

  const runId = randomUUID();
  const scannedAt = toSqlDate(new Date(scanResult.scannedAt));
  await insertScanRun(runId, projectKey, source, toSqlDate(new Date(scanResult.startedAt)));

  const savedKeys = await readSavedKeys(projectKey);
  const { removedKeys, warnings } = findRemovedKeys(scanResult, savedKeys);

  await upsertRequirements(projectKey, scanResult.requirements, scannedAt);
  await applyGapChanges(projectKey, scanResult.requirements, removedKeys, scannedAt);
  await deleteRequirements(projectKey, removedKeys);
  await finishScanRun(runId, toSqlDate(), await countSavedByRag(projectKey));

  return { runId, warnings };
}

// Raw JSON columns are removed so filtered links cannot reach a viewer through them.
function toRequirement({ gaps_json: gapsJson, chain_json: chainJson, ...row }) {
  return { ...row, gaps: JSON.parse(gapsJson), chain: JSON.parse(chainJson) };
}

export async function getMatrix(projectKey) {
  await ensureMigrations();
  const { rows } = await execute(
    'load the matrix',
    'SELECT * FROM tg_requirements WHERE project_key = ?',
    [projectKey],
  );
  return sortByKeyNumber(rows).map(toRequirement);
}

export async function getRequirement(projectKey, reqKey) {
  await ensureMigrations();
  const { rows } = await execute(
    'load the requirement',
    'SELECT * FROM tg_requirements WHERE project_key = ? AND req_key = ?',
    [projectKey, reqKey],
  );
  return rows.length > 0 ? toRequirement(rows[0]) : null;
}

export async function getHistory(projectKey, limit = 30) {
  await ensureMigrations();
  const { rows } = await execute(
    'load scan history',
    `SELECT ${SCAN_RUN_COLUMNS} FROM tg_scan_runs
     WHERE project_key = ? AND finished_at IS NOT NULL
     ORDER BY finished_at DESC, started_at DESC LIMIT ${MAX_HISTORY_ROWS}`,
    [projectKey],
  );
  const safeLimit = Math.min(Math.max(1, Math.trunc(Number(limit)) || 30), MAX_HISTORY_ROWS);
  return rows.slice(0, safeLimit);
}

export async function getLatestScanRun(projectKey) {
  const [latest] = await getHistory(projectKey, 1);
  return latest ?? null;
}

export async function getOpenGaps(projectKey) {
  await ensureMigrations();
  const { rows } = await execute(
    'load open gaps',
    `SELECT id, project_key, req_key, gap_code, opened_at FROM tg_gap_events
     WHERE project_key = ? AND closed_at IS NULL`,
    [projectKey],
  );
  return sortByKeyNumber(rows);
}
