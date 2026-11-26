import api from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { errorLabel } from '../engine/errors';
import { isFreshTeamCache, parseTeams, TEAMS_OPERATION_NAME } from '../engine/teams';

const QUERY = `query ${TEAMS_OPERATION_NAME}($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultListNode {
              nodes {
                id
                data {
                  __typename
                  ... on AtlassianTeam {
                    id
                    displayName
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const TEAM_CACHE_TTL = { value: 24, unit: 'HOURS' };
const NO_TEAM_HINT =
  '[TG] Teamwork Graph returned no team - check scopes read:graph:user:atlassian and ' +
  'read:graph:team:atlassian, the saved query key, and that the user is in a team.';

const TEAM_CACHE_PREFIX = 'team:';
const TEAM_CACHE_PAGE_SIZE = 20;
const teamCacheKey = (accountId) => `${TEAM_CACHE_PREFIX}${accountId}`;
const queryKeyVariable = () => process.env.TWG_USER_TEAMS_QUERY_KEY;

const graphError = (code) => Object.assign(new Error('Teamwork Graph request failed.'), { code });

// Forge apps cannot call Teamwork Graph as the app, so this needs a signed-in user.
export async function getTeamsForUser(accountId) {
  const queryKey = queryKeyVariable();
  if (!queryKey || !accountId) return [];

  const variables = { queryKey, queryParams: { id: `ari:cloud:identity::user/${accountId}` } };
  const res = await api.asUser().requestTeamworkGraph(QUERY, variables, TEAMS_OPERATION_NAME);
  if (!res.ok) throw graphError(`HTTP_${res.status}`);

  const json = await res.json();
  const teams = parseTeams(json);
  if (json.errors?.length && teams.length === 0) {
    throw graphError(json.errors[0].extensions?.code ?? 'GRAPH_ERROR');
  }
  return teams;
}

async function readCachedTeam(accountId) {
  try {
    const entry = await kvs.get(teamCacheKey(accountId));
    return isFreshTeamCache(entry) ? entry.teams[0].name : null;
  } catch (error) {
    console.error(`[TG] Could not read the team cache: ${errorLabel(error)}`);
    return null;
  }
}

async function cacheTeams(accountId, teams) {
  try {
    await kvs.set(teamCacheKey(accountId), { teams, cachedAt: Date.now() }, { ttl: TEAM_CACHE_TTL });
  } catch (error) {
    console.error(`[TG] Could not save the team cache: ${errorLabel(error)}`);
  }
}

// One lookup per scan: each owner is resolved once, and it never throws.
export function createTeamLookup({ canCallGraph = false } = {}) {
  const teamsByOwner = new Map();
  let hintLogged = false;
  let graphFailed = false;

  const logHint = () => {
    if (hintLogged) return;
    hintLogged = true;
    console.warn(NO_TEAM_HINT);
  };

  const fetchTeam = async (accountId) => {
    const cachedTeam = await readCachedTeam(accountId);
    if (cachedTeam) return cachedTeam;

    if (!queryKeyVariable()) {
      logHint();
      return null;
    }
    if (!canCallGraph || graphFailed) return null;

    try {
      const teams = await getTeamsForUser(accountId);
      if (teams.length === 0) {
        logHint();
        return null;
      }
      await cacheTeams(accountId, teams);
      return teams[0].name;
    } catch (error) {
      graphFailed = true;
      console.error(`[TG] Teamwork Graph lookup failed: ${errorLabel(error)}`);
      logHint();
      return null;
    }
  };

  return (accountId) => {
    if (!accountId) return Promise.resolve(null);
    if (!teamsByOwner.has(accountId)) teamsByOwner.set(accountId, fetchTeam(accountId));
    return teamsByOwner.get(accountId);
  };
}

// Personal data reporting: every cached owner and when their teams were read.
export async function listCachedTeamOwners() {
  const owners = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(TEAM_CACHE_PREFIX)).limit(TEAM_CACHE_PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);

    const page = await query.getMany();
    for (const { key, value } of page.results) {
      owners.push({ accountId: key.slice(TEAM_CACHE_PREFIX.length), cachedAt: value?.cachedAt });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return owners;
}

export const deleteCachedTeam = (accountId) => kvs.delete(teamCacheKey(accountId));
