import React, { useState } from 'react';
import { Box, DynamicTable, Label, Link, Select, Stack, xcss } from '@forge/react';
import { filterByRag, implementationLabel, sortByRag, testsLabel } from '../../engine/dashboard.js';
import { RagLozenge } from './RagLozenge';

const FILTER_ID = 'tg-matrix-filter';
const ROWS_PER_PAGE = 20;

const FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Red', value: 'red' },
  { label: 'Amber', value: 'amber' },
  { label: 'Green', value: 'green' },
];

const filterStyle = xcss({ maxWidth: '240px' });

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
    { key: 'team', content: row.owner_team ?? '-' },
    { key: 'implementation', content: implementationLabel(row.chain?.counts) },
    { key: 'tests', content: testsLabel(row.chain?.counts) },
    { key: 'status', content: <RagLozenge rag={row.rag} /> },
    { key: 'gaps', content: row.gaps.map((gap) => gap.code).join(', ') || '-' },
  ],
});

export const MatrixTab = ({ matrix }) => {
  const [filter, setFilter] = useState(FILTER_OPTIONS[0]);
  const rows = sortByRag(filterByRag(matrix, filter.value)).map(toTableRow);

  return (
    <Stack space="space.200">
      <Box xcss={filterStyle}>
        <Label labelFor={FILTER_ID}>Filter by status</Label>
        <Select inputId={FILTER_ID} options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
      </Box>
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
