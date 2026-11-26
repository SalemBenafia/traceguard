// Pure helpers that build an audit pack in Confluence storage format.
import { auditReadyPercent, ragTotals, sortByRag, teamLabel } from './dashboard.js';

const MAX_RELEASE_NAME_LENGTH = 100;
const SPACE_KEY = /^[A-Za-z0-9]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;
const INVALID_XML_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const STATUS_MACROS = {
  green: { colour: 'Green', title: 'Green' },
  amber: { colour: 'Yellow', title: 'Amber' },
  red: { colour: 'Red', title: 'Red' },
};

export const NEXT_STEPS = {
  NO_IMPLEMENTATION: 'Link the implementation work for this requirement.',
  NO_TEST: 'Link a verification test to this requirement.',
  TEST_FAILED: 'Fix the failure and run the verification again.',
  STALE_VERIFICATION: 'Run the verification again against the changed requirement.',
  TEST_NOT_RUN: 'Run the verification and record the result.',
  IMPLEMENTATION_OPEN: 'Finish the linked implementation.',
  NO_OWNER: 'Assign an owner to this requirement.',
};

// Its message is safe to show to the user.
export class AuditPackError extends Error {}

export const escapeStorage = (value) =>
  String(value ?? '')
    .replace(INVALID_XML_CHARS, '')
    .replace(/[&<>"']/g, (char) => XML_ENTITIES[char]);

export const isValidSpaceKey = (value) => typeof value === 'string' && SPACE_KEY.test(value);

export const normalizeReleaseName = (value) =>
  typeof value === 'string'
    ? value.replace(CONTROL_CHARS, ' ').trim().slice(0, MAX_RELEASE_NAME_LENGTH)
    : '';

export const auditPackTitle = ({ projectKey, releaseName, day }) =>
  `Audit pack - ${projectKey} - ${releaseName || day}`;

export const titleForAttempt = (baseTitle, attempt) =>
  attempt === 1 ? baseTitle : `${baseTitle} (${attempt})`;

export function summarizeAudit({ projectKey, releaseName, totals }) {
  const noun = totals.total === 1 ? 'requirement' : 'requirements';
  const scope = releaseName ? ` for release ${releaseName}` : '';
  return (
    `Project ${projectKey} has ${totals.total} ${noun}${scope}: ${totals.green} audit-ready (Green), ` +
    `${totals.amber} needing attention (Amber) and ${totals.red} blocking the audit (Red). ` +
    `Overall, the project is ${auditReadyPercent(totals)}% audit-ready.`
  );
}

const macroParameter = (name, value) => `<ac:parameter ac:name="${name}">${escapeStorage(value)}</ac:parameter>`;

function statusMacro(rag) {
  const { colour, title } = STATUS_MACROS[rag] ?? { colour: 'Grey', title: rag };
  return `<ac:structured-macro ac:name="status">${macroParameter('colour', colour)}${macroParameter('title', title)}</ac:structured-macro>`;
}

const infoPanel = (totals) =>
  `<ac:structured-macro ac:name="info">${macroParameter('title', 'Audit readiness')}<ac:rich-text-body><p>` +
  `Total: ${totals.total} | Green: ${totals.green} | Amber: ${totals.amber} | Red: ${totals.red} | ` +
  `Audit-ready: ${auditReadyPercent(totals)}%</p></ac:rich-text-body></ac:structured-macro>`;

const issueLink = (key, jiraBaseUrl) =>
  `<a href="${escapeStorage(`${jiraBaseUrl}/browse/${encodeURIComponent(key)}`)}">${escapeStorage(key)}</a>`;

const requirementRow = (row, jiraBaseUrl) =>
  '<tr>' +
  `<td>${issueLink(row.req_key, jiraBaseUrl)}</td>` +
  `<td>${escapeStorage(row.summary)}</td>` +
  `<td>${escapeStorage(row.owner_name ?? 'Unassigned')}</td>` +
  `<td>${escapeStorage(teamLabel(row))}</td>` +
  `<td>${statusMacro(row.rag)}</td>` +
  `<td>${escapeStorage(row.gaps.map((gap) => gap.code).join(', ') || '-')}</td>` +
  '</tr>';

const requirementTable = (rows, jiraBaseUrl) =>
  '<table><tbody><tr><th>Requirement</th><th>Summary</th><th>Owner</th><th>Team</th><th>Status</th><th>Gaps</th></tr>' +
  `${rows.map((row) => requirementRow(row, jiraBaseUrl)).join('')}</tbody></table>`;

const gapItem = (gap) =>
  `<li><p>${escapeStorage(gap.message)} <strong>Next step:</strong> ` +
  `${escapeStorage(NEXT_STEPS[gap.code] ?? 'Review this gap.')}</p></li>`;

const requirementGaps = (row, jiraBaseUrl) =>
  `<li><p>${issueLink(row.req_key, jiraBaseUrl)} ${escapeStorage(row.summary)}</p>` +
  `<ul>${row.gaps.map(gapItem).join('')}</ul></li>`;

function openGapsSection(rows, jiraBaseUrl) {
  const withGaps = rows.filter((row) => row.gaps.length > 0);
  const content =
    withGaps.length > 0
      ? `<ul>${withGaps.map((row) => requirementGaps(row, jiraBaseUrl)).join('')}</ul>`
      : '<p>No open gaps.</p>';
  return `<h2>Open gaps and next steps</h2>${content}`;
}

function hiddenNote(hiddenCount) {
  if (hiddenCount === 0) return '';
  const subject = hiddenCount === 1 ? '1 requirement was' : `${hiddenCount} requirements were`;
  return `<p><em>${subject} left out because the person who created this pack cannot see them in Jira.</em></p>`;
}

export function buildAuditPackPage({ projectKey, releaseName, matrix, jiraBaseUrl, scanId, generatedOn, hiddenCount }) {
  const rows = sortByRag(matrix);
  const totals = ragTotals(rows);

  return [
    `<p>${escapeStorage(summarizeAudit({ projectKey, releaseName, totals }))}</p>`,
    hiddenNote(hiddenCount),
    infoPanel(totals),
    '<h2>Requirements</h2>',
    requirementTable(rows, jiraBaseUrl),
    openGapsSection(rows, jiraBaseUrl),
    '<hr />',
    `<p><em>Generated by TraceGuard on ${escapeStorage(generatedOn)} from scan ${escapeStorage(scanId)}</em></p>`,
  ].join('');
}
