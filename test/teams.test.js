import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isFreshTeamCache,
  NO_TEAM,
  parseTeams,
  resolveOwnerTeam,
  TEAM_CACHE_MS,
  TEAMS_OPERATION_NAME,
} from '../src/engine/teams.js';

const NOW = 1_800_000_000_000;

test('the operation name meets the Teamwork Graph naming rule', () => {
  assert.match(TEAMS_OPERATION_NAME, /^[A-Za-z0-9]{3,}_[A-Za-z0-9]{4,}$/);
  assert.ok(TEAMS_OPERATION_NAME.length <= 100);
});

const teamNode = (id, displayName) => ({ id, data: { __typename: 'AtlassianTeam', id, displayName } });
const graphResponse = (columns) => ({ data: { customQuery: { edges: [{ node: { columns } }] } } });
const teamsColumn = (...nodes) => ({ key: 'teams', value: { __typename: 'CypherQueryResultListNode', nodes } });

describe('parseTeams', () => {
  test('reads teams from a collected list', () => {
    const json = graphResponse([teamsColumn(teamNode('t1', 'Firmware'))]);

    assert.deepEqual(parseTeams(json), [{ id: 't1', name: 'Firmware' }]);
  });

  test('reads a single team node', () => {
    const json = graphResponse([{ key: 'teams', value: teamNode('t1', 'Firmware') }]);

    assert.deepEqual(parseTeams(json), [{ id: 't1', name: 'Firmware' }]);
  });

  test('sorts by name so the first team stays stable', () => {
    const json = graphResponse([teamsColumn(teamNode('t2', 'Quality'), teamNode('t1', 'Firmware'))]);

    assert.deepEqual(parseTeams(json).map((team) => team.name), ['Firmware', 'Quality']);
  });

  test('lists a team once', () => {
    const json = graphResponse([teamsColumn(teamNode('t1', 'Firmware'), teamNode('t1', 'Firmware'))]);

    assert.equal(parseTeams(json).length, 1);
  });

  test('ignores other columns and nodes without a name', () => {
    const json = graphResponse([
      { key: 'other', value: { nodes: [teamNode('x', 'Wrong')] } },
      teamsColumn({ id: 'hidden', data: null }),
    ]);

    assert.deepEqual(parseTeams(json), []);
  });

  test('handles an empty or failed response', () => {
    assert.deepEqual(parseTeams({ data: { customQuery: null } }), []);
    assert.deepEqual(parseTeams({}), []);
    assert.deepEqual(parseTeams(null), []);
  });
});

describe('isFreshTeamCache', () => {
  const teams = [{ id: 't1', name: 'Firmware' }];

  test('accepts an entry under 24 hours old', () => {
    assert.equal(isFreshTeamCache({ teams, cachedAt: NOW - TEAM_CACHE_MS + 1 }, NOW), true);
  });

  test('rejects an expired entry that KVS still returns', () => {
    assert.equal(isFreshTeamCache({ teams, cachedAt: NOW - TEAM_CACHE_MS }, NOW), false);
  });

  test('rejects empty or malformed entries', () => {
    assert.equal(isFreshTeamCache({ teams: [], cachedAt: NOW }, NOW), false);
    assert.equal(isFreshTeamCache({ teams }, NOW), false);
    assert.equal(isFreshTeamCache(undefined, NOW), false);
  });
});

describe('resolveOwnerTeam', () => {
  const saved = { owner_account_id: 'a1', owner_team: 'Firmware' };

  test('uses the team that was looked up', () => {
    assert.equal(resolveOwnerTeam({ ownerAccountId: 'a1', lookedUpTeam: 'Quality', saved }), 'Quality');
  });

  test('keeps the saved team when the same owner has no result', () => {
    assert.equal(resolveOwnerTeam({ ownerAccountId: 'a1', lookedUpTeam: null, saved }), 'Firmware');
  });

  test('does not give a new owner the old owner team', () => {
    assert.equal(resolveOwnerTeam({ ownerAccountId: 'a2', lookedUpTeam: null, saved }), NO_TEAM);
  });

  test('an unassigned requirement has no team', () => {
    assert.equal(resolveOwnerTeam({ ownerAccountId: null, lookedUpTeam: null, saved }), NO_TEAM);
  });

  test('a requirement never saved before has no team', () => {
    assert.equal(resolveOwnerTeam({ ownerAccountId: 'a1', lookedUpTeam: null }), NO_TEAM);
  });

  test('the label is the requested text', () => {
    assert.equal(NO_TEAM, 'No team found');
  });
});
