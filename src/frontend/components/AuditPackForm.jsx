import React, { useState } from 'react';
import { Box, Button, Heading, HelperMessage, Inline, Label, Link, SectionMessage, Stack, Text, Textfield, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';
import { errorMessage, StatusMessage } from './StatusMessage';

const SPACE_FIELD_ID = 'tg-audit-space';
const RELEASE_FIELD_ID = 'tg-audit-release';
const CREATE_ERROR = 'The audit pack could not be created. Please try again.';

const fieldStyle = xcss({ width: '260px' });

const CreatedPack = ({ pack }) => (
  <SectionMessage appearance="success">
    <Stack space="space.050">
      <Text>Audit pack created.</Text>
      <Link href={pack.url} openNewTab>
        {pack.title}
      </Link>
    </Stack>
  </SectionMessage>
);

export const AuditPackForm = ({ isDisabled }) => {
  const [spaceKey, setSpaceKey] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);

  const create = async () => {
    setIsCreating(true);
    setPack(null);
    setError(null);
    try {
      const response = await invoke('createAuditPack', { spaceKey, releaseName });
      if (response.ok) setPack(response);
      else setError(response.error);
    } catch {
      setError(CREATE_ERROR);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Stack space="space.100">
      <Heading size="small">Audit pack</Heading>
      {error && <StatusMessage message={errorMessage(error)} />}
      {pack && <CreatedPack pack={pack} />}
      <Inline space="space.200" shouldWrap>
        <Box xcss={fieldStyle}>
          <Label labelFor={SPACE_FIELD_ID}>Confluence space key</Label>
          <Textfield id={SPACE_FIELD_ID} value={spaceKey} onChange={(event) => setSpaceKey(event.target.value)} />
          <HelperMessage>Leave empty to use the space from Settings.</HelperMessage>
        </Box>
        <Box xcss={fieldStyle}>
          <Label labelFor={RELEASE_FIELD_ID}>Release name</Label>
          <Textfield id={RELEASE_FIELD_ID} value={releaseName} onChange={(event) => setReleaseName(event.target.value)} />
          <HelperMessage>Optional. Leave empty to use today's date.</HelperMessage>
        </Box>
      </Inline>
      <Box>
        <Button onClick={create} isDisabled={isDisabled || isCreating}>
          {isCreating ? 'Creating...' : 'Create audit pack'}
        </Button>
      </Box>
    </Stack>
  );
};
