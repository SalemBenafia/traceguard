// Pure helpers for owner teams from Teamwork Graph.

export const NO_TEAM = 'No team found';
export const TEAM_CACHE_MS = 24 * 60 * 60 * 1000;

// Teamwork Graph requires [company]_[operation]: at least 3 and 4 characters.
export const TEAMS_OPERATION_NAME = 'traceguard_userTeams';

function teamNodes(column) {
  if (column.key !== 'teams') return [];
  return Array.isArray(column.value?.nodes) ? column.value.nodes : [column.value];
}

// Sorted so the "first team" does not change between scans.
export function parseTeams(json) {
  const teamsById = new Map();
  for (const edge of json?.data?.customQuery?.edges ?? []) {
    for (const column of edge.node?.columns ?? []) {
      for (const node of teamNodes(column)) {
        if (node?.data?.displayName) {
          teamsById.set(node.data.id, { id: node.data.id, name: node.data.displayName });
        }
      }
    }
  }
  return [...teamsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// KVS can briefly return expired values, so the stored time is always checked.
export const isFreshTeamCache = (entry, now = Date.now()) =>
  Array.isArray(entry?.teams) &&
  entry.teams.length > 0 &&
  typeof entry.cachedAt === 'number' &&
  now - entry.cachedAt < TEAM_CACHE_MS;

// Graph results depend on who asks, so a missing result never erases a known team.
export function resolveOwnerTeam({ ownerAccountId, lookedUpTeam, saved }) {
  if (!ownerAccountId) return NO_TEAM;
  if (lookedUpTeam) return lookedUpTeam;
  if (saved?.owner_account_id === ownerAccountId && saved.owner_team) return saved.owner_team;
  return NO_TEAM;
}
