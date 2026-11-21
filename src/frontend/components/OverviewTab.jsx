import React from 'react';
import { Box, Button, EmptyState, Heading, Inline, Lozenge, Stack, Text, xcss } from '@forge/react';
import { auditReadyPercent, formatScanTime, ragTotals } from '../../engine/dashboard.js';
import { errorMessage, StatusMessage } from './StatusMessage';

const tileStyle = xcss({
  padding: 'space.200',
  minWidth: '140px',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'border.radius',
});

const Tile = ({ label, value, appearance }) => (
  <Box xcss={tileStyle}>
    <Stack space="space.100">
      {appearance ? <Lozenge appearance={appearance}>{label}</Lozenge> : <Text weight="bold">{label}</Text>}
      <Heading size="xlarge">{String(value)}</Heading>
    </Stack>
  </Box>
);

const ScanButton = ({ label, isScanning, onRescan }) => (
  <Button appearance="primary" onClick={onRescan} isDisabled={isScanning}>
    {isScanning ? 'Scanning...' : label}
  </Button>
);

const ScanMessages = ({ scanError, warnings }) => (
  <>
    {scanError && <StatusMessage message={errorMessage(scanError)} />}
    {warnings.map((warning) => (
      <StatusMessage key={warning} message={{ appearance: 'warning', text: warning }} />
    ))}
  </>
);

const NoData = ({ hasScan, isScanning, onRescan }) => (
  <EmptyState
    header={hasScan ? 'No requirements found' : 'No scan yet'}
    description={
      hasScan
        ? 'The last scan found no requirements you can see. Check the Requirement JQL in Settings, then scan again.'
        : 'Run the first scan to see how audit-ready this project is.'
    }
    primaryAction={
      <ScanButton label={hasScan ? 'Rescan' : 'Run first scan'} isScanning={isScanning} onRescan={onRescan} />
    }
  />
);

export const OverviewTab = ({ data, isScanning, onRescan, scanError, warnings }) => {
  if (data.matrix.length === 0) {
    return (
      <Stack space="space.200">
        <ScanMessages scanError={scanError} warnings={warnings} />
        <NoData hasScan={Boolean(data.lastScan)} isScanning={isScanning} onRescan={onRescan} />
      </Stack>
    );
  }

  const totals = ragTotals(data.matrix);

  return (
    <Stack space="space.200">
      <ScanMessages scanError={scanError} warnings={warnings} />
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        <Stack space="space.050">
          <Heading size="medium">{`Audit-ready: ${auditReadyPercent(totals)}%`}</Heading>
          <Text>{`Last scan: ${formatScanTime(data.lastScan?.finished_at)}`}</Text>
        </Stack>
        <ScanButton label="Rescan" isScanning={isScanning} onRescan={onRescan} />
      </Inline>
      <Inline space="space.200" shouldWrap>
        <Tile label="Total" value={totals.total} />
        <Tile label="Green" value={totals.green} appearance="success" />
        <Tile label="Amber" value={totals.amber} appearance="moved" />
        <Tile label="Red" value={totals.red} appearance="removed" />
      </Inline>
    </Stack>
  );
};
