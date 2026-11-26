import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  EmptyState,
  Form,
  FormFooter,
  Heading,
  HelperMessage,
  Label,
  LoadingButton,
  RequiredAsterisk,
  Spinner,
  Stack,
  Textfield,
  Toggle,
  useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { errorMessage, StatusMessage } from './StatusMessage';

const LIST_FIELDS = ['implementationTypes', 'testTypes', 'passedStatuses', 'failedStatuses'];

const TEXT_FIELDS = [
  {
    name: 'requirementJql',
    label: 'Requirement JQL',
    help: 'Finds the Jira work items TraceGuard treats as requirements.',
    required: true,
  },
  {
    name: 'implementationTypes',
    label: 'Implementation work types',
    help: 'Comma-separated, for example: Story, Task, Bug',
  },
  { name: 'testTypes', label: 'Verification work types', help: 'Comma-separated, for example: Test' },
  { name: 'passedStatuses', label: 'Passed statuses', help: 'Comma-separated, for example: Passed' },
  { name: 'failedStatuses', label: 'Failed statuses', help: 'Comma-separated, for example: Failed' },
  {
    name: 'auditSpaceKey',
    label: 'Confluence space key for audit packs',
    help: 'Letters and digits only. Leave empty if not used yet.',
  },
];

// The form edits lists as comma-separated text.
const toFormValues = (settings) => ({
  ...settings,
  ...Object.fromEntries(LIST_FIELDS.map((field) => [field, settings[field].join(', ')])),
});

const SettingsTextField = ({ field, register, getFieldId }) => (
  <Box>
    <Label labelFor={getFieldId(field.name)}>
      {field.label}
      {field.required && <RequiredAsterisk />}
    </Label>
    <Textfield {...register(field.name)} />
    <HelperMessage>{field.help}</HelperMessage>
  </Box>
);

const SettingsForm = ({ settings, onSave }) => {
  const { register, handleSubmit, getFieldId, formState } = useForm({
    defaultValues: toFormValues(settings),
  });

  return (
    <Form onSubmit={handleSubmit(onSave)}>
      <Stack space="space.200">
        {TEXT_FIELDS.map((field) => (
          <SettingsTextField key={field.name} field={field} register={register} getFieldId={getFieldId} />
        ))}
        <Box>
          <Label labelFor={getFieldId('commentOnNewGaps')}>Comment on new gaps</Label>
          <Toggle {...register('commentOnNewGaps')} />
          <HelperMessage>Adds a Jira comment when TraceGuard finds a new gap.</HelperMessage>
        </Box>
        <FormFooter>
          <LoadingButton appearance="primary" type="submit" isLoading={formState.isSubmitting}>
            Save
          </LoadingButton>
        </FormFooter>
      </Stack>
    </Form>
  );
};

const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const nightlyResultText = ({ scanned, commentsPosted, commentsWaiting }) =>
  `Nightly job finished: ${counted(scanned, 'requirement')} scanned, ` +
  `${counted(commentsPosted, 'comment')} posted, ${commentsWaiting} waiting.`;

const NoSettingsState = ({ canEdit }) => (
  <EmptyState
    header="No settings saved yet"
    description={
      canEdit
        ? 'Review the defaults below and click Save to turn on live updates and the nightly scan.'
        : 'Ask a project admin to save these settings to turn on live updates and the nightly scan.'
    }
  />
);

const NightlyRunner = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState([]);

  const run = async () => {
    setIsRunning(true);
    setMessages([]);
    try {
      const result = await invoke('runNightlyNow');
      if (!result.ok) {
        setMessages([errorMessage(result.error)]);
        return;
      }
      setMessages([
        { appearance: 'success', text: nightlyResultText(result) },
        ...result.warnings.map((text) => ({ appearance: 'warning', text })),
      ]);
    } catch {
      setMessages([errorMessage('The nightly job could not finish, so click Run nightly job now to try again.')]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Stack space="space.100">
      <Heading size="xsmall">Nightly job</Heading>
      {messages.map((message) => (
        <StatusMessage key={message.text} message={message} />
      ))}
      <Box>
        <Button onClick={run} isDisabled={isRunning}>
          {isRunning ? 'Running...' : 'Run nightly job now'}
        </Button>
      </Box>
    </Stack>
  );
};

export const SettingsTab = () => {
  const [settings, setSettings] = useState(null);
  const [canRunNightly, setCanRunNightly] = useState(false);
  const [hasSavedSettings, setHasSavedSettings] = useState(true);
  const [formVersion, setFormVersion] = useState(0);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    invoke('getSettings')
      .then((result) => {
        if (result.ok) {
          setSettings(result.settings);
          setCanRunNightly(result.canRunNightly === true);
          setHasSavedSettings(result.hasSavedSettings === true);
        } else {
          setMessage(errorMessage(result.error));
        }
      })
      .catch(() => setMessage(errorMessage('TraceGuard could not load settings, so reload the page to try again.')));
  }, []);

  const save = async (values) => {
    setMessage(null);
    try {
      const result = await invoke('saveSettings', values);
      if (!result.ok) {
        setMessage(errorMessage(result.error));
        return;
      }
      setSettings(result.settings);
      setHasSavedSettings(true);
      // A new key rebuilds the form so it shows the cleaned, saved values.
      setFormVersion((version) => version + 1);
      setMessage({ appearance: 'success', text: 'Settings saved.' });
    } catch {
      setMessage(errorMessage('TraceGuard could not save settings, so click Save to try again.'));
    }
  };

  if (!settings) {
    return message ? <StatusMessage message={message} /> : <Spinner label="Loading settings" />;
  }

  return (
    <Stack space="space.200">
      {message && <StatusMessage message={message} />}
      {!hasSavedSettings && <NoSettingsState canEdit={canRunNightly} />}
      <SettingsForm key={formVersion} settings={settings} onSave={save} />
      {canRunNightly && <NightlyRunner />}
    </Stack>
  );
};
