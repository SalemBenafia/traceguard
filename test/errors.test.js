import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorLabel } from '../src/engine/errors.js';

test('errorLabel prefers a code, then a status, then a name', () => {
  assert.equal(errorLabel({ code: 'SQL_FAILED', status: 500, name: 'Error' }), 'SQL_FAILED');
  assert.equal(errorLabel({ status: 429, name: 'Error' }), '429');
  assert.equal(errorLabel(new TypeError('private text')), 'TypeError');
});

test('errorLabel never returns the error message', () => {
  const error = new Error('The value jane@example.com does not exist');
  assert.doesNotMatch(errorLabel(error), /jane/);
});

test('errorLabel rejects a code that contains free text', () => {
  assert.equal(errorLabel({ code: 'Duplicate entry for Jane Doe' }), 'UNKNOWN');
  assert.equal(errorLabel({ code: 'x'.repeat(65) }), 'UNKNOWN');
});

test('errorLabel handles missing errors', () => {
  assert.equal(errorLabel(null), 'UNKNOWN');
  assert.equal(errorLabel(undefined), 'UNKNOWN');
});
