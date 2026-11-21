import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { requirementJql, RequirementJqlError } from '../src/engine/jql.js';

describe('requirementJql', () => {
  test('limits the saved JQL to the project with a stable order', () => {
    assert.equal(
      requirementJql('SPF', 'project = SPF AND issuetype = Requirement'),
      'project = "SPF" AND (project = SPF AND issuetype = Requirement) ORDER BY key ASC',
    );
  });

  test('an OR cannot widen the search to another project', () => {
    assert.equal(
      requirementJql('SPF', 'issuetype = Requirement OR project = SECRET'),
      'project = "SPF" AND (issuetype = Requirement OR project = SECRET) ORDER BY key ASC',
    );
  });

  test('a closing bracket cannot escape the project filter', () => {
    assert.throws(() => requirementJql('SPF', 'status = Open) OR (project = SECRET'), RequirementJqlError);
  });

  test('unbalanced quotes and brackets are rejected', () => {
    for (const jql of ['summary ~ "open', '(status = Open', "summary ~ 'open"]) {
      assert.throws(() => requirementJql('SPF', jql), RequirementJqlError);
    }
  });

  test('keeps ORDER BY outside the brackets', () => {
    assert.equal(
      requirementJql('SPF', 'issuetype = Requirement order by created DESC'),
      'project = "SPF" AND (issuetype = Requirement) order by created DESC',
    );
  });

  test('handles a saved JQL that only has ORDER BY', () => {
    assert.equal(requirementJql('SPF', 'ORDER BY created DESC'), 'project = "SPF" ORDER BY created DESC');
  });

  test('ignores ORDER BY and brackets inside quotes', () => {
    assert.equal(
      requirementJql('SPF', 'summary ~ "order by (x"'),
      'project = "SPF" AND (summary ~ "order by (x") ORDER BY key ASC',
    );
  });

  test('handles escaped quotes', () => {
    const jql = 'summary ~ "say \\"hi\\" (now"';

    assert.equal(requirementJql('SPF', jql), `project = "SPF" AND (${jql}) ORDER BY key ASC`);
  });

  test('does not treat a longer word as ORDER BY', () => {
    assert.equal(
      requirementJql('SPF', 'reorder by = 1'),
      'project = "SPF" AND (reorder by = 1) ORDER BY key ASC',
    );
  });

  test('adds a key list', () => {
    assert.equal(
      requirementJql('SPF', 'issuetype = Requirement', ['SPF-1', 'SPF-20']),
      'project = "SPF" AND key in ("SPF-1", "SPF-20") AND (issuetype = Requirement) ORDER BY key ASC',
    );
  });

  test('rejects unsafe project and issue keys', () => {
    assert.throws(() => requirementJql('SPF" OR 1=1', 'status = Open'), /Invalid project key/);
    assert.throws(() => requirementJql('SPF', 'status = Open', ['SPF-1") OR (x']), /Invalid issue key/);
  });
});
