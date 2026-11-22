import { randomUUID } from 'node:crypto';
import { sql } from '@forge/sql';
import { gapMessage, groupKeysByProject } from '../engine/gapComment';
import { batchByBytes, chunk, diffGaps, gapEventId, sortByKeyNumber } from '../engine/gapDiff';
import { ensureMigrations } from './migrations';

const MAX_ROWS_PER_WRITE = 50;
const MAX_BYTES_PER_WRITE = 512 * 1024; // Forge SQL requests are limited to 1 MiB.
const MAX_KEYS_PER_STATEMENT = 200;
const MAX_HISTORY_ROWS = 100;
const MAX_PENDING_COMMENT_ROWS = 200;
const UNRECORDED_SOURCES = new Set(['panel']);

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

export async function getSavedOwners(projectKey) {
  await ensureMigrations();
  const { rows } = await execute(
    'read saved owners',
    'SELECT req_key, owner_account_id, owner_team FROM tg_requirements WHERE project_key = ?',
    [projectKey],
  );
  return new Map(rows.map((row) => [row.req_key, row]));
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
    // Queued first: a retry reuses the same id, so a new gap cannot lose its comment.
    await execute(
      'queue gap comments',
      `INSERT INTO tg_pending_gap_comments (event_id, project_key, req_key, gap_code, queued_at)
       VALUES ${rowPlaceholders(batch.length, GAP_EVENT_COLUMN_COUNT)}
       ON DUPLICATE KEY UPDATE event_id = event_id`,
      batch.flat(),
    );
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
    await execute(
      'remove queued gap comments',
      `DELETE FROM tg_pending_gap_comments
       WHERE project_key = ? AND event_id IN (${placeholders(batch.length)})`,
      [projectKey, ...batch],
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

  // Opening a work item is not a project scan, so it stays out of the scan history.
  const recordRun = !UNRECORDED_SOURCES.has(source);
  const runId = recordRun ? randomUUID() : null;
  const scannedAt = toSqlDate(new Date(scanResult.scannedAt));
  if (recordRun) await insertScanRun(runId, projectKey, source, toSqlDate(new Date(scanResult.startedAt)));

  const savedKeys = await readSavedKeys(projectKey);
  const { removedKeys, warnings } = findRemovedKeys(scanResult, savedKeys);

  await upsertRequirements(projectKey, scanResult.requirements, scannedAt);
  await applyGapChanges(projectKey, scanResult.requirements, removedKeys, scannedAt);
  await deleteRequirements(projectKey, removedKeys);
  if (recordRun) await finishScanRun(runId, toSqlDate(), await countSavedByRag(projectKey));

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

// Looks up saved requirements by key. Linked requirements can be in other projects.
export async function getStoredRequirements(keys) {
  await ensureMigrations();

  const found = [];
  for (const [projectKey, projectKeys] of groupKeysByProject(keys)) {
    for (const batch of chunk(projectKeys, MAX_KEYS_PER_STATEMENT)) {
      const { rows } = await execute(
        'load linked requirements',
        `SELECT req_key, summary, rag, owner_team FROM tg_requirements
         WHERE project_key = ? AND req_key IN (${placeholders(batch.length)})`,
        [projectKey, ...batch],
      );
      found.push(...rows);
    }
  }
  return sortByKeyNumber(found);
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

// New gaps still waiting for a comment, skipping any that have since closed.
export async function getPendingGapComments(projectKey) {
  await ensureMigrations();
  const { rows } = await execute(
    'load queued gap comments',
    `SELECT p.event_id, p.req_key, p.gap_code, r.owner_account_id, r.owner_name, r.gaps_json
     FROM tg_pending_gap_comments p
     JOIN tg_gap_events e ON e.id = p.event_id
     JOIN tg_requirements r ON r.project_key = p.project_key AND r.req_key = p.req_key
     WHERE p.project_key = ? AND e.closed_at IS NULL
     ORDER BY p.queued_at, p.event_id LIMIT ${MAX_PENDING_COMMENT_ROWS}`,
    [projectKey],
  );
  return sortByKeyNumber(rows).map((row) => ({
    eventId: row.event_id,
    reqKey: row.req_key,
    gapCode: row.gap_code,
    ownerAccountId: row.owner_account_id,
    ownerName: row.owner_name,
    message: gapMessage(JSON.parse(row.gaps_json), row.gap_code),
  }));
}

// Removing the row first means only one job can ever post this comment.
export async function claimPendingComment(eventId) {
  const { rows } = await execute(
    'claim a gap comment',
    'DELETE FROM tg_pending_gap_comments WHERE event_id = ?',
    [eventId],
  );
  return rows.affectedRows === 1;
}

export const releasePendingComment = (projectKey, { eventId, reqKey, gapCode }) =>
  execute(
    'return a gap comment to the queue',
    `INSERT INTO tg_pending_gap_comments (event_id, project_key, req_key, gap_code, queued_at)
     VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE event_id = event_id`,
    [eventId, projectKey, reqKey, gapCode, toSqlDate()],
  );

export const clearPendingComments = (projectKey) =>
  execute('clear queued gap comments', 'DELETE FROM tg_pending_gap_comments WHERE project_key = ?', [
    projectKey,
  ]);

export async function removeOldCommentSlots(today) {
  await ensureMigrations();
  await execute('remove old comment limits', 'DELETE FROM tg_comment_slots WHERE comment_day < ?', [today]);
}

// Inserting a free slot is atomic, so overlapping jobs cannot exceed the daily limit.
export async function reserveCommentSlot(day, maxPerDay) {
  const { rows } = await execute(
    'read the comment limit',
    'SELECT slot FROM tg_comment_slots WHERE comment_day = ?',
    [day],
  );
  const usedSlots = new Set(rows.map((row) => Number(row.slot)));

  for (let slot = 1; slot <= maxPerDay; slot += 1) {
    if (usedSlots.has(slot)) continue;
    const { rows: result } = await execute(
      'reserve a comment',
      'INSERT IGNORE INTO tg_comment_slots (comment_day, slot) VALUES (?, ?)',
      [day, slot],
    );
    if (result.affectedRows === 1) return slot;
  }
  return null;
}

export const releaseCommentSlot = (day, slot) =>
  execute('release a comment', 'DELETE FROM tg_comment_slots WHERE comment_day = ? AND slot = ?', [
    day,
    slot,
  ]);

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
