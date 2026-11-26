import React from 'react';
import { EmptyState } from '@forge/react';

export const NoScanState = ({ description = 'Open the Overview tab and click Run first scan.', action }) => (
  <EmptyState header="No scan yet" description={description} primaryAction={action} />
);

export const NoRequirementsState = ({ action }) => (
  <EmptyState
    header="No requirements found"
    description="Check the Requirement JQL in Settings, then click Rescan on the Overview tab."
    primaryAction={action}
  />
);
