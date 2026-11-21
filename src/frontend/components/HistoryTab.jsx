import React from 'react';
import { DynamicTable } from '@forge/react';
import { formatScanTime } from '../../engine/dashboard.js';

const ROWS_PER_PAGE = 15;

const HEAD = {
  cells: [
    { key: 'date', content: 'Date', width: 36 },
    { key: 'source', content: 'Source', width: 22 },
    { key: 'green', content: 'Green', width: 14 },
    { key: 'amber', content: 'Amber', width: 14 },
    { key: 'red', content: 'Red', width: 14 },
  ],
};

const toTableRow = (run) => ({
  key: run.id,
  cells: [
    { key: 'date', content: formatScanTime(run.finished_at) },
    { key: 'source', content: run.source },
    { key: 'green', content: String(run.green ?? 0) },
    { key: 'amber', content: String(run.amber ?? 0) },
    { key: 'red', content: String(run.red ?? 0) },
  ],
});

// The backend already returns scan runs newest first.
export const HistoryTab = ({ history }) => (
  <DynamicTable
    label="Scan history"
    head={HEAD}
    rows={history.map(toTableRow)}
    rowsPerPage={ROWS_PER_PAGE}
    emptyView="No scans yet. Run the first scan from the Overview tab."
  />
);
