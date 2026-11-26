import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALL_TEAMS,
  auditReadyPercent,
  filterByRag,
  filterByTeam,
  formatScanTime,
  gapName,
  groupOpenGaps,
  implementationLabel,
  noGapsState,
  ragTotals,
  scanSourceLabel,
  sortByRag,
  teamFilterOptions,
  teamLabel,
  testsLabel,
} from '../src/engine/dashboard.js';

const row = (reqKey, rag) => ({ req_key: reqKey, rag });
const gap = (reqKey, gapCode) => ({ req_key: reqKey, gap_code: gapCode });
const UTC_GB = { locale: 'en-GB', timeZone: 'UTC' };

describe('sortByRag', () => {
  test('puts red first, then amber, then green', () => {
    const rows = [row('SPF-1', 'green'), row('SPF-2', 'amber'), row('SPF-3', 'red')];

    assert.deepEqual(sortByRag(rows).map((item) => item.rag), ['red', 'amber', 'green']);
  });

  test('sorts by key number inside each colour', () => {
    const rows = [row('SPF-10', 'red'), row('SPF-2', 'red'), row('SPF-1', 'green')];

    assert.deepEqual(sortByRag(rows).map((item) => item.req_key), ['SPF-2', 'SPF-10', 'SPF-1']);
  });

  test('does not change the input', () => {
    const rows = Object.freeze([row('SPF-1', 'green'), row('SPF-2', 'red')]);

    assert.equal(sortByRag(rows)[0].rag, 'red');
  });
});

describe('filterByRag', () => {
  const rows = [row('SPF-1', 'green'), row('SPF-2', 'amber'), row('SPF-3', 'red')];

  test('all keeps every row', () => {
    assert.equal(filterByRag(rows, 'all').length, 3);
  });

  test('a colour keeps only that colour', () => {
    assert.deepEqual(filterByRag(rows, 'amber').map((item) => item.req_key), ['SPF-2']);
  });
});

describe('team filter', () => {
  const rows = [
    { req_key: 'SPF-1', owner_team: 'Quality' },
    { req_key: 'SPF-2', owner_team: 'Firmware' },
    { req_key: 'SPF-3', owner_team: 'No team found' },
    { req_key: 'SPF-4', owner_team: null },
    { req_key: 'SPF-5', owner_team: 'Firmware' },
  ];

  test('rows saved before teams existed show No team found', () => {
    assert.equal(teamLabel(rows[3]), 'No team found');
  });

  test('lists each team once, sorted, with No team found last', () => {
    assert.deepEqual(teamFilterOptions(rows).map((option) => option.label), [
      'All teams',
      'Firmware',
      'Quality',
      'No team found',
    ]);
  });

  test('all teams keeps every row', () => {
    assert.equal(filterByTeam(rows, ALL_TEAMS).length, 5);
  });

  test('a team keeps only its rows', () => {
    assert.deepEqual(filterByTeam(rows, 'Firmware').map((row) => row.req_key), ['SPF-2', 'SPF-5']);
  });

  test('No team found includes rows with an empty team', () => {
    assert.deepEqual(filterByTeam(rows, 'No team found').map((row) => row.req_key), ['SPF-3', 'SPF-4']);
  });
});

describe('totals', () => {
  test('ragTotals counts each colour', () => {
    const rows = [row('A-1', 'green'), row('A-2', 'green'), row('A-3', 'amber'), row('A-4', 'red')];

    assert.deepEqual(ragTotals(rows), { total: 4, green: 2, amber: 1, red: 1 });
  });

  test('auditReadyPercent is green divided by total', () => {
    assert.equal(auditReadyPercent({ total: 20, green: 9 }), 45);
  });

  test('auditReadyPercent rounds down so nearly done is never 100', () => {
    assert.equal(auditReadyPercent({ total: 1000, green: 999 }), 99);
  });

  test('auditReadyPercent is 100 only when everything is green', () => {
    assert.equal(auditReadyPercent({ total: 3, green: 3 }), 100);
  });

  test('auditReadyPercent is 0 with no requirements', () => {
    assert.equal(auditReadyPercent({ total: 0, green: 0 }), 0);
  });
});

describe('groupOpenGaps', () => {
  test('groups by code with a friendly title, count and sorted keys', () => {
    const groups = groupOpenGaps([gap('SPF-19', 'NO_TEST'), gap('SPF-5', 'NO_TEST')]);

    assert.deepEqual(groups, [
      { code: 'NO_TEST', title: 'Requirements with no verification', count: 2, keys: ['SPF-5', 'SPF-19'] },
    ]);
  });

  test('every gap code has a friendly title', () => {
    const codes = [
      'NO_IMPLEMENTATION',
      'NO_TEST',
      'TEST_FAILED',
      'STALE_VERIFICATION',
      'TEST_NOT_RUN',
      'IMPLEMENTATION_OPEN',
      'NO_OWNER',
    ];
    const groups = groupOpenGaps(codes.map((code, index) => gap(`SPF-${index + 1}`, code)));

    assert.deepEqual(groups.map((group) => group.code), codes);
    assert.ok(groups.every((group) => group.title !== group.code));
  });

  test('an unknown code still appears, after the known ones', () => {
    const groups = groupOpenGaps([gap('SPF-1', 'NEW_RULE'), gap('SPF-2', 'NO_OWNER')]);

    assert.deepEqual(groups.map((group) => group.title), ['Requirements with no owner', 'NEW_RULE']);
  });

  test('a requirement is listed once per code', () => {
    const [group] = groupOpenGaps([gap('SPF-1', 'NO_TEST'), gap('SPF-1', 'NO_TEST')]);

    assert.equal(group.count, 1);
    assert.deepEqual(group.keys, ['SPF-1']);
  });

  test('no gaps gives no groups', () => {
    assert.deepEqual(groupOpenGaps([]), []);
  });
});

describe('labels', () => {
  test('implementationLabel shows done/total', () => {
    assert.equal(implementationLabel({ impl: 3, implDone: 2 }), '2/3');
  });

  test('implementationLabel shows - before the next scan stores done', () => {
    assert.equal(implementationLabel({ impl: 3 }), '-/3');
  });

  test('testsLabel shows passed/failed/total', () => {
    assert.equal(testsLabel({ passed: 2, failed: 1, tests: 4 }), '2/1/4');
  });

  test('labels survive missing counts', () => {
    assert.equal(implementationLabel(undefined), '-/0');
    assert.equal(testsLabel(undefined), '0/0/0');
  });
});

describe('formatScanTime', () => {
  test('reads a saved DATETIME as UTC', () => {
    assert.equal(formatScanTime('2026-11-20 10:15:30', UTC_GB), '20 Nov 2026, 10:15');
  });

  test('converts to the viewer time zone', () => {
    assert.equal(
      formatScanTime('2026-11-20 10:15:30', { locale: 'en-GB', timeZone: 'Asia/Tokyo' }),
      '20 Nov 2026, 19:15',
    );
  });

  test('accepts ISO timestamps', () => {
    assert.equal(formatScanTime('2026-11-20T10:15:30.000Z', UTC_GB), '20 Nov 2026, 10:15');
    assert.equal(formatScanTime('2026-11-20T12:15:30+0200', UTC_GB), '20 Nov 2026, 10:15');
  });

  test('says Never when there is no time', () => {
    assert.equal(formatScanTime(null), 'Never');
    assert.equal(formatScanTime(undefined), 'Never');
  });

  test('shows an unknown format as it is instead of failing', () => {
    assert.equal(formatScanTime('not a date'), 'not a date');
  });
});

describe('display names', () => {
  test('every gap code has a readable name', () => {
    const codes = ['NO_IMPLEMENTATION', 'NO_TEST', 'TEST_FAILED', 'STALE_VERIFICATION', 'TEST_NOT_RUN', 'IMPLEMENTATION_OPEN', 'NO_OWNER'];

    assert.ok(codes.every((code) => gapName(code) !== 'Gap' && !gapName(code).includes('_')));
  });

  test('an unknown gap code never shows a raw code', () => {
    assert.equal(gapName('NEW_RULE'), 'Gap');
  });

  test('scan sources have readable names', () => {
    assert.deepEqual(['manual', 'nightly', 'event', 'agent', 'other'].map(scanSourceLabel), [
      'Manual scan',
      'Nightly scan',
      'Jira update',
      'Rovo agent',
      'Scan',
    ]);
  });
});

describe('noGapsState', () => {
  test('asks for a scan first', () => {
    assert.equal(noGapsState({ hasScan: false, requirementCount: 0, hiddenCount: 0 }), 'noScan');
  });

  test('never calls an empty project audit-ready', () => {
    assert.equal(noGapsState({ hasScan: true, requirementCount: 0, hiddenCount: 0 }), 'noRequirements');
  });

  test('never calls a partly hidden project audit-ready', () => {
    assert.equal(noGapsState({ hasScan: true, requirementCount: 5, hiddenCount: 1 }), 'partial');
  });

  test('is audit-ready only when every requirement is visible', () => {
    assert.equal(noGapsState({ hasScan: true, requirementCount: 5, hiddenCount: 0 }), 'ready');
  });
});
