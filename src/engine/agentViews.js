// Pure helpers that validate Rovo inputs and keep action responses small.
import { NEXT_STEPS } from './auditPack.js';
import { auditReadyPercent, formatScanTime, ragTotals, sortByRag, teamLabel } from './dashboard.js';
import { passedLabel, toRequirementTrace } from './issueTrace.js';

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/;
const REQUIREMENT_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const UTC_FORMAT = { locale: 'en-GB', timeZone: 'UTC' };
const TOP_RED_LIMIT = 10;

export const MAX_GAP_ITEMS = 50;

const utcLabel = (label) => `${label} UTC`;

export function resolveProjectKey(payload) {
  const raw = payload?.projectKey || payload?.context?.jira?.projectKey || '';
  const projectKey = String(raw).trim().toUpperCase();
  return PROJECT_KEY.test(projectKey) ? projectKey : null;
}

export function parseRequirementKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toUpperCase();
  return REQUIREMENT_KEY.test(key) ? key : null;
}

export function normalizeSeverity(value) {
  const severity = String(value ?? '').trim().toLowerCase();
  return severity === 'red' || severity === 'amber' ? severity : null;
}

// The Forge docs show the user id in both places.
export const accountIdFrom = (context) => context?.principal?.accountId ?? context?.accountId ?? null;

export function toTraceSummary(projectKey, matrix, lastScan) {
  const totals = ragTotals(matrix);
  const redRows = sortByRag(matrix).filter((row) => row.rag === 'red');

  return {
    projectKey,
    total: totals.total,
    green: totals.green,
    amber: totals.amber,
    red: totals.red,
    auditReadyPercent: auditReadyPercent(totals),
    lastScan: lastScan?.finished_at ? utcLabel(formatScanTime(lastScan.finished_at, UTC_FORMAT)) : null,
    topRed: redRows.slice(0, TOP_RED_LIMIT).map((row) => ({
      key: row.req_key,
      summary: row.summary,
      gaps: row.gaps.map((gap) => gap.code),
    })),
  };
}

export function toRequirementAnswer(row, settings) {
  const trace = toRequirementTrace(
    { key: row.req_key, summary: row.summary, rag: row.rag, gaps: row.gaps, links: row.chain?.links ?? [] },
    settings,
  );

  return {
    key: row.req_key,
    summary: row.summary,
    status: row.rag,
    jiraStatus: row.status,
    owner: row.owner_name ?? 'Unassigned',
    team: teamLabel(row),
    gaps: row.gaps.map(({ code, message }) => ({ code, message })),
    implementation: trace.implementation,
    verification: trace.verification.map(({ key, summary, status, isPassed, passedAt }) => ({
      key,
      summary,
      status,
      passedOn: isPassed && passedAt ? utcLabel(passedLabel({ isPassed, passedAt }, UTC_FORMAT)) : null,
    })),
    ...(row.explanation ? { explanation: row.explanation } : {}),
  };
}

const toGapItem = ({ code, severity, message }) => ({
  code,
  severity,
  message,
  nextStep: NEXT_STEPS[code] ?? 'Review this gap.',
});

export function toGapList(projectKey, matrix, severity) {
  const matching = sortByRag(matrix)
    .map((row) => ({ row, gaps: row.gaps.filter((gap) => !severity || gap.severity === severity) }))
    .filter(({ gaps }) => gaps.length > 0);
  const totalGaps = matching.reduce((sum, { gaps }) => sum + gaps.length, 0);

  const requirements = [];
  let shownGaps = 0;
  for (const { row, gaps } of matching) {
    if (shownGaps >= MAX_GAP_ITEMS) break;
    const shown = gaps.slice(0, MAX_GAP_ITEMS - shownGaps);
    shownGaps += shown.length;
    requirements.push({ key: row.req_key, summary: row.summary, rag: row.rag, gaps: shown.map(toGapItem) });
  }

  return {
    projectKey,
    severity: severity ?? 'all',
    totalGaps,
    shownGaps,
    truncated: shownGaps < totalGaps,
    requirements,
  };
}
