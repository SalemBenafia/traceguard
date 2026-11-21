import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildGapComment, gapMessage, groupKeysByProject, utcDay } from '../src/engine/gapComment.js';

const paragraph = (doc) => doc.content[0].content;

describe('buildGapComment', () => {
  test('builds a valid ADF document with the gap message', () => {
    const doc = buildGapComment({ message: 'No linked test.' });

    assert.equal(doc.type, 'doc');
    assert.equal(doc.version, 1);
    assert.equal(doc.content[0].type, 'paragraph');
    assert.ok(paragraph(doc).some((node) => node.type === 'text' && node.text === 'No linked test.'));
  });

  test('mentions the owner by account id', () => {
    const doc = buildGapComment({ message: 'No linked test.', ownerAccountId: 'acc-1', ownerName: 'Demo Owner' });

    assert.deepEqual(paragraph(doc).find((node) => node.type === 'mention'), {
      type: 'mention',
      attrs: { id: 'acc-1', text: '@Demo Owner' },
    });
  });

  test('a mention works without a display name', () => {
    const doc = buildGapComment({ message: 'No linked test.', ownerAccountId: 'acc-1', ownerName: null });

    assert.deepEqual(paragraph(doc).find((node) => node.type === 'mention').attrs, { id: 'acc-1' });
  });

  test('has no mention when there is no owner', () => {
    const doc = buildGapComment({ message: 'Requirement has no owner.', ownerAccountId: null });

    assert.equal(paragraph(doc).some((node) => node.type === 'mention'), false);
  });

  test('never creates an empty text node', () => {
    const doc = buildGapComment({ message: 'x', ownerAccountId: 'acc-1', ownerName: 'A' });

    assert.ok(paragraph(doc).filter((node) => node.type === 'text').every((node) => node.text.length > 0));
  });
});

describe('gapMessage', () => {
  const gaps = [{ code: 'NO_TEST', message: 'No linked test.' }];

  test('finds the message for a code', () => {
    assert.equal(gapMessage(gaps, 'NO_TEST'), 'No linked test.');
  });

  test('falls back to the code', () => {
    assert.equal(gapMessage(gaps, 'NO_OWNER'), 'Gap NO_OWNER');
  });
});

describe('groupKeysByProject', () => {
  test('groups keys by project and removes duplicates', () => {
    const groups = groupKeysByProject(['SPF-1', 'ABC-2', 'SPF-3', 'SPF-1']);

    assert.deepEqual([...groups.entries()], [['SPF', ['SPF-1', 'SPF-3']], ['ABC', ['ABC-2']]]);
  });

  test('handles a project key containing an underscore', () => {
    assert.deepEqual([...groupKeysByProject(['MY_APP-7']).keys()], ['MY_APP']);
  });

  test('handles no keys', () => {
    assert.equal(groupKeysByProject([]).size, 0);
  });
});

describe('utcDay', () => {
  test('uses the UTC calendar day', () => {
    assert.equal(utcDay(new Date('2026-11-21T23:30:00-02:00')), '2026-11-22');
  });
});
