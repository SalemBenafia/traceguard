// Pure helpers that shape saved scan data for the dashboard.
import { NO_TEAM } from './teams.js';

export const ALL_TEAMS = '__all_teams__';

const RAG_ORDER = { red: 0, amber: 1, green: 2 };

// Listed in display order: red gaps first, then amber.
const GAP_TITLES = {
  NO_IMPLEMENTATION: 'Requirements with no implementation',
  NO_TEST: 'Requirements with no verification',
  TEST_FAILED: 'Requirements with failed verification',
  STALE_VERIFICATION: 'Requirements changed after their last passed verification',
  TEST_NOT_RUN: 'Requirements with verification not run',
  IMPLEMENTATION_OPEN: 'Requirements with unfinished implementation',
  NO_OWNER: 'Requirements with no owner',
};
const GAP_ORDER = Object.keys(GAP_TITLES);

const GAP_NAMES = {
  NO_IMPLEMENTATION: 'No implementation',
  NO_TEST: 'No verification',
  TEST_FAILED: 'Verification failed',
  STALE_VERIFICATION: 'Verification out of date',
  TEST_NOT_RUN: 'Verification not run',
  IMPLEMENTATION_OPEN: 'Implementation open',
  NO_OWNER: 'No owner',
};

const SCAN_SOURCES = {
  manual: 'Manual scan',
  nightly: 'Nightly scan',
  event: 'Jira update',
  agent: 'Rovo agent',
};

const SCAN_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

const issueNumber = (key) => Number(key.slice(key.lastIndexOf('-') + 1));
const compareKeys = (a, b) => issueNumber(a) - issueNumber(b) || a.localeCompare(b);

export function sortByRag(rows) {
  return [...rows].sort(
    (a, b) => RAG_ORDER[a.rag] - RAG_ORDER[b.rag] || compareKeys(a.req_key, b.req_key),
  );
}

export const filterByRag = (rows, rag) => (rag === 'all' ? rows : rows.filter((row) => row.rag === rag));

export const teamLabel = (row) => row.owner_team ?? NO_TEAM;

export const filterByTeam = (rows, team) =>
  team === ALL_TEAMS ? rows : rows.filter((row) => teamLabel(row) === team);

// Named teams come first, alphabetically, with "No team found" last.
export function teamFilterOptions(rows) {
  const names = [...new Set(rows.map(teamLabel))].sort((a, b) => a.localeCompare(b));
  const ordered = [...names.filter((name) => name !== NO_TEAM), ...names.filter((name) => name === NO_TEAM)];
  return [
    { label: 'All teams', value: ALL_TEAMS },
    ...ordered.map((name) => ({ label: name, value: name })),
  ];
}

export const gapName = (code) => GAP_NAMES[code] ?? 'Gap';

export const scanSourceLabel = (source) => SCAN_SOURCES[source] ?? 'Scan';

// "Audit-ready" is only claimed when the viewer can see every requirement.
export function noGapsState({ hasScan, requirementCount, hiddenCount }) {
  if (!hasScan) return 'noScan';
  if (requirementCount === 0) return 'noRequirements';
  return hiddenCount > 0 ? 'partial' : 'ready';
}

export function ragTotals(rows) {
  const totals = { total: rows.length, green: 0, amber: 0, red: 0 };
  for (const { rag } of rows) totals[rag] += 1;
  return totals;
}

// Rounds down so a project that is not fully green never displays 100%.
export const auditReadyPercent = ({ total, green }) =>
  total === 0 ? 0 : Math.floor((green * 100) / total);

function gapOrder(code) {
  const index = GAP_ORDER.indexOf(code);
  return index === -1 ? GAP_ORDER.length : index;
}

export function groupOpenGaps(openGaps) {
  const keysByCode = new Map();
  for (const { gap_code: code, req_key: key } of openGaps) {
    if (!keysByCode.has(code)) keysByCode.set(code, new Set());
    keysByCode.get(code).add(key);
  }

  return [...keysByCode.entries()]
    .map(([code, keys]) => ({
      code,
      title: GAP_TITLES[code] ?? code,
      count: keys.size,
      keys: [...keys].sort(compareKeys),
    }))
    .sort((a, b) => gapOrder(a.code) - gapOrder(b.code) || a.code.localeCompare(b.code));
}

export const implementationLabel = (counts) => `${counts?.implDone ?? '-'}/${counts?.impl ?? 0}`;

export const testsLabel = (counts) =>
  `${counts?.passed ?? 0}/${counts?.failed ?? 0}/${counts?.tests ?? 0}`;

// Saved DATETIME values have no time zone and are always written in UTC.
function parseScanTime(value) {
  const match = SCAN_TIME.exec(value);
  if (!match) return null;

  const [, date, time, fraction = '', zone = 'Z'] = match;
  const standardZone = zone === 'Z' ? zone : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const parsed = new Date(`${date}T${time}${fraction}${standardZone}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatScanTime(value, { locale, timeZone } = {}) {
  if (value === null || value === undefined) return 'Never';

  const parsed = parseScanTime(String(value));
  if (!parsed) return String(value);
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
}
