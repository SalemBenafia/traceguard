import React from 'react';
import { Badge, Box, EmptyState, Heading, Inline, Link, Stack, xcss } from '@forge/react';
import { groupOpenGaps } from '../../engine/dashboard.js';

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

export const GapsTab = ({ openGaps, hasScan }) => {
  const groups = groupOpenGaps(openGaps);

  if (groups.length === 0) {
    return (
      <EmptyState
        header={hasScan ? 'No open gaps' : 'No scan yet'}
        description={
          hasScan
            ? 'The latest scan found no open gaps that you can see.'
            : 'Run the first scan from the Overview tab to find audit gaps.'
        }
      />
    );
  }

  return (
    <Stack space="space.200">
      {groups.map((group) => (
        <GapGroup key={group.code} group={group} />
      ))}
    </Stack>
  );
};
