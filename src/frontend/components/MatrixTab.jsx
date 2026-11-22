import React, { useState } from 'react';
import { Box, DynamicTable, Inline, Label, Link, Select, Stack, xcss } from '@forge/react';
import {
  ALL_TEAMS,
  filterByRag,
  filterByTeam,
  implementationLabel,
  sortByRag,
  teamFilterOptions,
  teamLabel,
  testsLabel,
} from '../../engine/dashboard.js';
import { RagLozenge } from './RagLozenge';

const FILTER_ID = 'tg-matrix-filter';
const TEAM_FILTER_ID = 'tg-matrix-team-filter';
const ROWS_PER_PAGE = 20;

const FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Red', value: 'red' },
  { label: 'Amber', value: 'amber' },
  { label: 'Green', value: 'green' },
];

const filterStyle = xcss({ width: '240px' });

const HEAD = {
  cells: [
    { key: 'requirement', content: 'Requirement', width: 9 },
    { key: 'summary', content: 'Summary', width: 27 },
    { key: 'owner', content: 'Owner', width: 12 },
    { key: 'team', content: 'Team', width: 9 },
    { key: 'implementation', content: 'Implementation', width: 10 },
    { key: 'tests', content: 'Tests (P/F/T)', width: 9 },
    { key: 'status', content: 'Status', width: 8 },
    { key: 'gaps', content: 'Gaps', width: 16 },
  ],
};

const toTableRow = (row) => ({
  key: row.req_key,
  cells: [
    { key: 'requirement', content: <Link href={`/browse/${row.req_key}`}>{row.req_key}</Link> },
    { key: 'summary', content: row.summary },
    { key: 'owner', content: row.owner_name ?? 'Unassigned' },
    { key: 'team', content: teamLabel(row) },
    { key: 'implementation', content: implementationLabel(row.chain?.counts) },
    { key: 'tests', content: testsLabel(row.chain?.counts) },
    { key: 'status', content: <RagLozenge rag={row.rag} /> },
    { key: 'gaps', content: row.gaps.map((gap) => gap.code).join(', ') || '-' },
  ],
});

export const MatrixTab = ({ matrix }) => {
  const [filter, setFilter] = useState(FILTER_OPTIONS[0]);
  const [team, setTeam] = useState(ALL_TEAMS);

  // A rescan can remove the selected team, so the filter falls back to all teams.
  const teamOptions = teamFilterOptions(matrix);
  const selectedTeam = teamOptions.find((option) => option.value === team) ?? teamOptions[0];
  const filteredRows = filterByTeam(filterByRag(matrix, filter.value), selectedTeam.value);
  const rows = sortByRag(filteredRows).map(toTableRow);

  return (
    <Stack space="space.200">
      <Inline space="space.200" shouldWrap>
        <Box xcss={filterStyle}>
          <Label labelFor={FILTER_ID}>Filter by status</Label>
          <Select inputId={FILTER_ID} options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        </Box>
        <Box xcss={filterStyle}>
          <Label labelFor={TEAM_FILTER_ID}>Team</Label>
          <Select
            inputId={TEAM_FILTER_ID}
            options={teamOptions}
            value={selectedTeam}
            onChange={(option) => setTeam(option.value)}
          />
        </Box>
      </Inline>
      <DynamicTable
        label="Traceability matrix"
        head={HEAD}
        rows={rows}
        rowsPerPage={ROWS_PER_PAGE}
        emptyView="No requirements match this filter."
      />
    </Stack>
  );
};
