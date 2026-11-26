import React, { useState } from 'react';
import { Box, DynamicTable, Inline, Label, Link, Select, Stack, Text, xcss } from '@forge/react';
import {
  ALL_TEAMS,
  filterByRag,
  filterByTeam,
  gapName,
  implementationLabel,
  sortByRag,
  teamFilterOptions,
  teamLabel,
  testsLabel,
} from '../../engine/dashboard.js';
import { NoRequirementsState, NoScanState } from './EmptyStates';
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
    { key: 'requirement', content: 'Requirement', width: 8 },
    { key: 'summary', content: 'Summary', width: 21 },
    { key: 'owner', content: 'Owner', width: 10 },
    { key: 'team', content: 'Team', width: 9 },
    { key: 'implementation', content: 'Implementation', width: 9 },
    { key: 'verification', content: 'Verification (P/F/T)', width: 10 },
    { key: 'status', content: 'Status', width: 7 },
    { key: 'gaps', content: 'Gaps', width: 26 },
  ],
};

const GapCell = ({ gaps }) => {
  if (gaps.length === 0) return <Text>Audit-ready</Text>;

  return (
    <Stack space="space.050">
      {gaps.map((gap) => (
        <Stack key={gap.code} space="space.0">
          <Text weight="medium">{gapName(gap.code)}</Text>
          <Text size="small" color="color.text.subtle">
            {gap.message}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
};

const toTableRow = (row) => ({
  key: row.req_key,
  cells: [
    { key: 'requirement', content: <Link href={`/browse/${row.req_key}`}>{row.req_key}</Link> },
    { key: 'summary', content: row.summary },
    { key: 'owner', content: row.owner_name ?? 'Unassigned' },
    { key: 'team', content: teamLabel(row) },
    { key: 'implementation', content: implementationLabel(row.chain?.counts) },
    { key: 'verification', content: testsLabel(row.chain?.counts) },
    { key: 'status', content: <RagLozenge rag={row.rag} /> },
    { key: 'gaps', content: <GapCell gaps={row.gaps} /> },
  ],
});

export const MatrixTab = ({ matrix, hasScan }) => {
  const [filter, setFilter] = useState(FILTER_OPTIONS[0]);
  const [team, setTeam] = useState(ALL_TEAMS);

  if (!hasScan) return <NoScanState />;
  if (matrix.length === 0) return <NoRequirementsState />;

  // A rescan can remove the selected team, so the filter falls back to all teams.
  const teamOptions = teamFilterOptions(matrix);
  const selectedTeam = teamOptions.find((option) => option.value === team) ?? teamOptions[0];
  const filteredRows = filterByTeam(filterByRag(matrix, filter.value), selectedTeam.value);
  const rows = sortByRag(filteredRows).map(toTableRow);

  return (
    <Stack space="space.200">
      <Inline space="space.200" shouldWrap>
        <Box xcss={filterStyle}>
          <Label labelFor={FILTER_ID}>Status</Label>
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
        emptyView="No requirements match these filters, so change the status or team."
      />
    </Stack>
  );
};
