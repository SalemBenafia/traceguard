import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Form,
  FormFooter,
  HelperMessage,
  Label,
  LoadingButton,
  RequiredAsterisk,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textfield,
  Toggle,
  useForm,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

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

const panelStyle = xcss({ paddingBlock: 'space.200' });

const errorMessage = (text) => ({ appearance: 'error', text });

// The form edits lists as comma-separated text.
const toFormValues = (settings) => ({
  ...settings,
  ...Object.fromEntries(LIST_FIELDS.map((field) => [field, settings[field].join(', ')])),
});

const StatusMessage = ({ message }) => (
  <SectionMessage appearance={message.appearance}>
    <Text>{message.text}</Text>
  </SectionMessage>
);

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

const SettingsTab = () => {
  const [settings, setSettings] = useState(null);
  const [formVersion, setFormVersion] = useState(0);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    invoke('getSettings')
      .then((result) => {
        if (result.ok) setSettings(result.settings);
        else setMessage(errorMessage(result.error));
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
    </Stack>
  );
};

const PlaceholderPanel = ({ name }) => (
  <Box xcss={panelStyle}>
    <Text>{name} - coming soon</Text>
  </Box>
);

const ProjectPage = () => (
  <Tabs id="traceguard-tabs">
    <TabList>
      <Tab>Overview</Tab>
      <Tab>Matrix</Tab>
      <Tab>Gaps</Tab>
      <Tab>History</Tab>
      <Tab>Settings</Tab>
    </TabList>
    <TabPanel>
      <PlaceholderPanel name="Overview" />
    </TabPanel>
    <TabPanel>
      <PlaceholderPanel name="Matrix" />
    </TabPanel>
    <TabPanel>
      <PlaceholderPanel name="Gaps" />
    </TabPanel>
    <TabPanel>
      <PlaceholderPanel name="History" />
    </TabPanel>
    <TabPanel>
      <Box xcss={panelStyle}>
        <SettingsTab />
      </Box>
    </TabPanel>
  </Tabs>
);

ForgeReconciler.render(
  <React.StrictMode>
    <ProjectPage />
  </React.StrictMode>
);
