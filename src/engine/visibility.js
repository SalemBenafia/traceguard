// Pure helpers that limit shared scan results to what one viewer can see in Jira.

export const referencedIssueKeys = (matrix) => [
  ...new Set(matrix.flatMap((row) => [row.req_key, ...row.chain.links.map((link) => link.key)])),
];

export const filterGapsForViewer = (openGaps, visibleKeys) =>
  openGaps.filter((gap) => visibleKeys.has(gap.req_key));

export const filterForViewer = (matrix, visibleKeys) =>
  matrix
    .filter((row) => visibleKeys.has(row.req_key))
    .map((row) => ({
      ...row,
      chain: { ...row.chain, links: row.chain.links.filter((link) => visibleKeys.has(link.key)) },
    }));
