// Runs on Jira issue and issue link events declared in manifest.yml.
export const onJiraEvent = async () => {
  console.log('[TG] stub on-jira-event');
  return { stub: true, name: 'on-jira-event' };
};

// Runs once a day. Its 900 second timeout is set on the function in manifest.yml.
export const nightlyScan = async () => {
  console.log('[TG] stub nightly-scan');
  return { stub: true, name: 'nightly-scan' };
};
