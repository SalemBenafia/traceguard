import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
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
    help: 'Finds the work items TraceGuard treats as requirements.',
    required: true,
  },
  {
    name: 'implementationTypes',
    label: 'Implementation work types',
    help: 'Comma-separated, for example: Story, Task, Bug',
  },
  { name: 'testTypes', label: 'Test work types', help: 'Comma-separated, for example: Test' },
  { name: 'passedStatuses', label: 'Passed statuses', help: 'Comma-separated, for example: Passed' },
  { name: 'failedStatuses', label: 'Failed statuses', help: 'Comma-separated, for example: Failed' },
  {
    name: 'auditSpaceKey',
    label: 'Audit Confluence space key',
    help: 'Letters and digits only. Leave empty if not used yet.',
  },
  { name: 'llmModel', label: 'LLM model', help: 'Leave empty to use the default model.' },
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

const nightlyResultText = ({ scanned, commentsPosted, commentsWaiting }) =>
  `Nightly job finished: ${scanned} requirements scanned, ${commentsPosted} comments posted, ` +
  `${commentsWaiting} comments waiting.`;

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
      setMessages([errorMessage('The nightly job could not finish. Please try again.')]);
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
  const [formVersion, setFormVersion] = useState(0);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    invoke('getSettings')
      .then((result) => {
        if (result.ok) {
          setSettings(result.settings);
          setCanRunNightly(result.canRunNightly === true);
        } else {
          setMessage(errorMessage(result.error));
        }
      })
      .catch(() => setMessage(errorMessage('Could not load settings. Please try again.')));
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
      // A new key rebuilds the form so it shows the cleaned, saved values.
      setFormVersion((version) => version + 1);
      setMessage({ appearance: 'success', text: 'Settings saved.' });
    } catch {
      setMessage(errorMessage('Could not save settings. Please try again.'));
    }
  };

  if (!settings) {
    return message ? <StatusMessage message={message} /> : <Spinner label="Loading settings" />;
  }

  return (
    <Stack space="space.200">
      {message && <StatusMessage message={message} />}
      <SettingsForm key={formVersion} settings={settings} onSave={save} />
      {canRunNightly && <NightlyRunner />}
    </Stack>
  );
};
