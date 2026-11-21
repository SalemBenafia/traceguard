import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  DynamicTable,
  Heading,
  Inline,
  Link,
  List,
  ListItem,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { passedLabel } from '../engine/issueTrace.js';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RagLozenge } from './components/RagLozenge';
import { errorMessage, StatusMessage } from './components/StatusMessage';

const LOAD_ERROR = 'TraceGuard could not check this work item. Click Recheck to try again.';

const IssueLink = ({ issueKey }) => <Link href={`/browse/${issueKey}`}>{issueKey}</Link>;

const IMPLEMENTATION_HEAD = {
  cells: [
    { key: 'key', content: 'Key', width: 20 },
    { key: 'summary', content: 'Summary', width: 55 },
    { key: 'status', content: 'Status', width: 25 },
  ],
};

const VERIFICATION_HEAD = {
  cells: [
    { key: 'key', content: 'Key', width: 15 },
    { key: 'summary', content: 'Summary', width: 40 },
    { key: 'status', content: 'Status', width: 15 },
    { key: 'passed', content: 'Passed on', width: 30 },
  ],
};

const baseCells = (item) => [
  { key: 'key', content: <IssueLink issueKey={item.key} /> },
  { key: 'summary', content: item.summary ?? '-' },
  { key: 'status', content: item.status ?? '-' },
];

const implementationRow = (item) => ({ key: item.key, cells: baseCells(item) });

const verificationRow = (item) => ({
  key: item.key,
  cells: [...baseCells(item), { key: 'passed', content: passedLabel(item) }],
});

const TraceTable = ({ title, head, rows, emptyText }) => (
  <Stack space="space.050">
    <Heading size="xsmall">{title}</Heading>
    <DynamicTable label={title} head={head} rows={rows} emptyView={emptyText} />
  </Stack>
);

const GapList = ({ gaps }) =>
  gaps.length === 0 ? (
    <Text>No gaps found.</Text>
  ) : (
    <List type="unordered">
      {gaps.map((gap) => (
        <ListItem key={gap.code}>{gap.message}</ListItem>
      ))}
    </List>
  );

const RequirementView = ({ requirement, warnings }) => (
  <Stack space="space.200">
    {warnings.map((warning) => (
      <StatusMessage key={warning} message={{ appearance: 'warning', text: warning }} />
    ))}
    <Inline space="space.100" alignBlock="center">
      <Text weight="bold">Traceability status</Text>
      <RagLozenge rag={requirement.rag} />
    </Inline>
    <GapList gaps={requirement.gaps} />
    <TraceTable
      title="Implementation"
      head={IMPLEMENTATION_HEAD}
      rows={requirement.implementation.map(implementationRow)}
      emptyText="No linked implementation work."
    />
    <TraceTable
      title="Verification"
      head={VERIFICATION_HEAD}
      rows={requirement.verification.map(verificationRow)}
      emptyText="No linked tests."
    />
  </Stack>
);

const SupportingView = ({ requirements }) => (
  <Stack space="space.100">
    <Heading size="xsmall">Supports these requirements</Heading>
    {requirements.map((requirement) => (
      <Inline key={requirement.req_key} space="space.100" alignBlock="center" shouldWrap>
        <IssueLink issueKey={requirement.req_key} />
        <Text>{requirement.summary}</Text>
        <RagLozenge rag={requirement.rag} />
      </Inline>
    ))}
  </Stack>
);

const TraceView = ({ trace }) => {
  if (trace.kind === 'requirement') {
    return <RequirementView requirement={trace.requirement} warnings={trace.warnings ?? []} />;
  }
  if (trace.kind === 'supporting') return <SupportingView requirements={trace.requirements} />;
  return <Text>Not part of a traced requirement.</Text>;
};

const IssuePanel = () => {
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await invoke('getIssueTrace');
      if (response.ok) setTrace(response);
      else setError(response.error);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack space="space.200">
      {error && <StatusMessage message={errorMessage(error)} />}
      {trace && <TraceView trace={trace} />}
      {isLoading && <Spinner size="small" label="Checking traceability" />}
      <Inline>
        <Button onClick={load} isDisabled={isLoading}>
          Recheck
        </Button>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <ErrorBoundary>
      <IssuePanel />
    </ErrorBoundary>
  </React.StrictMode>
);
