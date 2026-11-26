import React from 'react';
import { Badge, Box, EmptyState, Heading, Inline, Link, Stack, xcss } from '@forge/react';
import { groupOpenGaps, noGapsState } from '../../engine/dashboard.js';
import { NoRequirementsState, NoScanState } from './EmptyStates';

const groupStyle = xcss({
  padding: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'border.radius',
});

const GapGroup = ({ group }) => (
  <Box xcss={groupStyle}>
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Heading size="small">{group.title}</Heading>
        <Badge>{group.count}</Badge>
      </Inline>
      <Inline space="space.150" shouldWrap>
        {group.keys.map((key) => (
          <Link key={key} href={`/browse/${key}`}>
            {key}
          </Link>
        ))}
      </Inline>
    </Stack>
  </Box>
);

const NoGaps = (props) => {
  const state = noGapsState(props);
  if (state === 'noScan') return <NoScanState />;
  if (state === 'noRequirements') return <NoRequirementsState />;
  if (state === 'partial') {
    return (
      <EmptyState
        header="No gaps you can see"
        description="Some requirements are hidden by your Jira permissions, so ask a project admin to confirm this project is audit-ready."
      />
    );
  }
  return (
    <EmptyState
      header="Everything is audit-ready"
      description="Every requirement has linked implementation and passed verification."
    />
  );
};

export const GapsTab = ({ openGaps, hasScan, requirementCount, hiddenCount }) => {
  const groups = groupOpenGaps(openGaps);

  if (groups.length === 0) {
    return <NoGaps hasScan={hasScan} requirementCount={requirementCount} hiddenCount={hiddenCount} />;
  }

  return (
    <Stack space="space.200">
      {groups.map((group) => (
        <GapGroup key={group.code} group={group} />
      ))}
    </Stack>
  );
};
