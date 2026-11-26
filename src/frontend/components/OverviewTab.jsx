import React from 'react';
import { Box, Button, Heading, Inline, Lozenge, Stack, Text, xcss } from '@forge/react';
import { auditReadyPercent, formatScanTime, ragTotals } from '../../engine/dashboard.js';
import { AuditPackForm } from './AuditPackForm';
import { NoRequirementsState, NoScanState } from './EmptyStates';
import { errorMessage, StatusMessage } from './StatusMessage';

const tileStyle = xcss({
  padding: 'space.200',
  width: '220px',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'border.radius',
});

const Tile = ({ label, value, appearance, hint }) => (
  <Box xcss={tileStyle}>
    <Stack space="space.100">
      {appearance ? <Lozenge appearance={appearance}>{label}</Lozenge> : <Text weight="bold">{label}</Text>}
      <Heading size="xlarge">{String(value)}</Heading>
      <Text size="small" color="color.text.subtle">{hint}</Text>
    </Stack>
  </Box>
);

// A plain function, because UI Kit cannot render custom components passed through props.
const scanButton = ({ label, isScanning, onRescan }) => (
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

const NoData = ({ hasScan, isScanning, onRescan }) =>
  hasScan ? (
    <NoRequirementsState action={scanButton({ label: 'Rescan', isScanning, onRescan })} />
  ) : (
    <NoScanState
      description="Run the first scan to see how audit-ready this project is."
      action={scanButton({ label: 'Run first scan', isScanning, onRescan })}
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
        {scanButton({ label: 'Rescan', isScanning, onRescan })}
      </Inline>
      <Inline space="space.200" shouldWrap>
        <Tile label="Total" value={totals.total} hint="All requirements in this project." />
        <Tile label="Green" value={totals.green} appearance="success" hint="Audit-ready, with no gaps." />
        <Tile label="Amber" value={totals.amber} appearance="moved" hint="Has gaps that need attention." />
        <Tile label="Red" value={totals.red} appearance="removed" hint="Has gaps that block the audit." />
      </Inline>
      <AuditPackForm isDisabled={isScanning} />
    </Stack>
  );
};
