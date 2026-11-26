import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GapsTab } from './components/GapsTab';
import { HistoryTab } from './components/HistoryTab';
import { MatrixTab } from './components/MatrixTab';
import { OverviewTab } from './components/OverviewTab';
import { SettingsTab } from './components/SettingsTab';

const LOAD_ERROR = 'TraceGuard could not load this project, so click Try again.';
const SCAN_ERROR = 'The scan could not finish, so your last results are still shown and you can click Rescan to try again.';

const panelStyle = xcss({ paddingBlock: 'space.200' });

const Panel = ({ children }) => (
  <Box xcss={panelStyle}>
    <ErrorBoundary>{children}</ErrorBoundary>
  </Box>
);

// Shows loading and load errors, so a tab only renders once its data exists.
const DataPanel = ({ data, loadError, onRetry, children }) => {
  if (data) return <Panel>{children(data)}</Panel>;

  return (
    <Panel>
      {loadError ? (
        <Stack space="space.200">
          <SectionMessage appearance="error">
            <Text>{loadError}</Text>
          </SectionMessage>
          <Box>
            <Button onClick={onRetry}>Try again</Button>
          </Box>
        </Stack>
      ) : (
        <Spinner label="Loading requirements" />
      )}
    </Panel>
  );
};

const App = () => {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [isScanning, setIsScanning] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await invoke('getOverview');
      if (response.ok) setData(response);
      else setLoadError(response.error);
    } catch {
      setLoadError(LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rescan = async () => {
    setIsScanning(true);
    setScanError(null);
    setWarnings([]);
    try {
      const response = await invoke('rescan');
      if (response.ok) {
        setData(response);
        setWarnings(response.warnings ?? []);
      } else {
        setScanError(response.error);
      }
    } catch {
      setScanError(SCAN_ERROR);
    } finally {
      setIsScanning(false);
    }
  };

  const dataPanelProps = { data, loadError, onRetry: load };

  return (
    <Tabs id="traceguard-tabs">
      <TabList>
        <Tab>Overview</Tab>
        <Tab>Matrix</Tab>
        <Tab>Gaps</Tab>
        <Tab>History</Tab>
        <Tab>Settings</Tab>
      </TabList>
      <TabPanel>
        <DataPanel {...dataPanelProps}>
          {(loaded) => (
            <OverviewTab
              data={loaded}
              isScanning={isScanning}
              onRescan={rescan}
              scanError={scanError}
              warnings={warnings}
            />
          )}
        </DataPanel>
      </TabPanel>
      <TabPanel>
        <DataPanel {...dataPanelProps}>{(loaded) => <MatrixTab matrix={loaded.matrix} hasScan={Boolean(loaded.lastScan)} />}</DataPanel>
      </TabPanel>
      <TabPanel>
        <DataPanel {...dataPanelProps}>
          {(loaded) => (
            <GapsTab
              openGaps={loaded.openGaps}
              hasScan={Boolean(loaded.lastScan)}
              requirementCount={loaded.matrix.length}
              hiddenCount={loaded.hiddenCount ?? 0}
            />
          )}
        </DataPanel>
      </TabPanel>
      <TabPanel>
        <DataPanel {...dataPanelProps}>{(loaded) => <HistoryTab history={loaded.history} />}</DataPanel>
      </TabPanel>
      <TabPanel>
        <Panel>
          <SettingsTab />
        </Panel>
      </TabPanel>
    </Tabs>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
