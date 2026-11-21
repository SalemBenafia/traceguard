import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { latestContentChange, latestMoveToStatus, parseJiraTime } from '../src/engine/changelog.js';

const entry = (created, ...items) => ({ id: created, created, items });
const change = (fieldId, toString = 'value') => ({ field: fieldId, fieldId, toString });

const T1 = '2026-11-20T10:00:00.000+0000';
const T2 = '2026-11-20T11:00:00.000+0000';
const T3 = '2026-11-20T12:00:00.000+0000';

describe('parseJiraTime', () => {
  test('parses the Jira +0000 format', () => {
    assert.equal(parseJiraTime('2026-11-20T10:15:30.123+0000'), Date.UTC(2026, 10, 20, 10, 15, 30, 123));
  });

  test('applies a non-UTC offset', () => {
    assert.equal(parseJiraTime('2026-11-20T12:15:30.123+0200'), Date.UTC(2026, 10, 20, 10, 15, 30, 123));
    assert.equal(parseJiraTime('2026-11-20T05:15:30.123-0500'), Date.UTC(2026, 10, 20, 10, 15, 30, 123));
  });

  test('accepts a standard offset, Z, and no milliseconds', () => {
    const expected = Date.UTC(2026, 10, 20, 10, 15, 30);
    assert.equal(parseJiraTime('2026-11-20T10:15:30+00:00'), expected);
    assert.equal(parseJiraTime('2026-11-20T10:15:30Z'), expected);
  });

  test('returns null for unusable values', () => {
    for (const value of [null, undefined, '', 'yesterday', 123, '2026-13-40T10:15:30.123+0000', '2026-11-20']) {
      assert.equal(parseJiraTime(value), null);
    }
  });
});

describe('latestContentChange', () => {
  test('returns the latest summary or description change', () => {
    const changelog = [entry(T1, change('summary')), entry(T2, change('description')), entry(T3, change('assignee'))];

    assert.equal(latestContentChange(changelog), parseJiraTime(T2));
  });

  test('ignores links, labels and status changes', () => {
    const changelog = [entry(T1, change('status'), change('labels')), entry(T2, { field: 'Link', toString: 'x' })];

    assert.equal(latestContentChange(changelog), null);
  });

  test('finds a content change inside a multi-item entry', () => {
    assert.equal(latestContentChange([entry(T1, change('labels'), change('description'))]), parseJiraTime(T1));
  });

  test('falls back to the field name when fieldId is missing', () => {
    assert.equal(latestContentChange([entry(T1, { field: 'summary' })]), parseJiraTime(T1));
  });

  test('does not depend on changelog order', () => {
    assert.equal(
      latestContentChange([entry(T3, change('summary')), entry(T1, change('summary'))]),
      parseJiraTime(T3),
    );
  });

  test('returns null for an empty changelog', () => {
    assert.equal(latestContentChange([]), null);
  });
});

describe('latestMoveToStatus', () => {
  test('returns the last move to the status', () => {
    const changelog = [
      entry(T1, change('status', 'Passed')),
      entry(T2, change('status', 'Failed')),
      entry(T3, change('status', 'Passed')),
    ];

    assert.equal(latestMoveToStatus(changelog, 'Passed'), parseJiraTime(T3));
  });

  test('ignores moves to other statuses', () => {
    const changelog = [entry(T1, change('status', 'Passed')), entry(T2, change('status', 'Failed'))];

    assert.equal(latestMoveToStatus(changelog, 'Passed'), parseJiraTime(T1));
  });

  test('ignores other fields with the same text', () => {
    assert.equal(latestMoveToStatus([entry(T1, change('summary', 'Passed'))], 'Passed'), null);
  });

  test('returns null when the test never moved to the status', () => {
    assert.equal(latestMoveToStatus([], 'Passed'), null);
  });
});
