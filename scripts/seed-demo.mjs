// Creates the SmartPump demo data in Jira, or removes it with --reset.
// Run with `npm run seed` or `npm run seed:reset`. Config comes from scripts/.env.

const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PROJECT_KEY } = process.env;

const DEMO_LABEL = 'tg-demo';
const MIN_REQUEST_GAP_MS = 200; // At most 5 requests per second.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const STALE_EDIT_DELAY_MS = 2_000;
const SEARCH_SETTLE_MS = 2_000; // Jira search can lag behind recent writes.

const SCENARIOS = {
  GREEN: { story: 'Done', test: 'Passed' },
  NO_TEST: { story: 'Done', test: null },
  NO_IMPLEMENTATION: { story: null, test: 'Passed' },
  TEST_FAILED: { story: 'Done', test: 'Failed' },
  TEST_NOT_RUN: { story: 'Done', test: 'Not run' },
  IMPLEMENTATION_OPEN: { story: 'In Progress', test: 'Passed' },
  STALE_VERIFICATION: { story: 'Done', test: 'Passed' },
  NO_OWNER: { story: 'Done', test: 'Passed' },
};

const REQUIRED_STATUSES = {
  Story: ['In Progress', 'Done'],
  Test: ['Not run', 'Passed', 'Failed'],
};

const STALE_REVISED_DESCRIPTION =
  'The pump must verify the cryptographic signature of every firmware image before installing it. ' +
  'Images signed with a revoked key or older than the installed version are rejected, and the running firmware stays active.';

const REQUIREMENTS = [
  {
    number: 1,
    summary: 'Dose calculation uses the configured insulin-to-carb ratio',
    scenario: 'GREEN',
    description:
      'The bolus calculator must use the insulin-to-carb ratio configured for the active time segment. A dose is not proposed if no valid ratio is configured.',
  },
  {
    number: 2,
    summary: 'Maximum single bolus is limited to 25 units',
    scenario: 'GREEN',
    description:
      'The pump must reject any single bolus request above 25 units. The rejection is shown to the user and recorded in the event history.',
  },
  {
    number: 3,
    summary: 'Occlusion alarm within 3 minutes of a blockage',
    scenario: 'TEST_FAILED',
    description:
      'The pump must raise an audible and visual occlusion alarm within 3 minutes of a blockage in the infusion line. Delivery stays paused until the user acknowledges the alarm.',
  },
  {
    number: 4,
    summary: 'Low-battery alarm at 15% charge',
    scenario: 'GREEN',
    description:
      'The pump must raise a low-battery alarm when the remaining charge reaches 15%. The alarm repeats every 30 minutes until the battery is replaced or charged.',
  },
  {
    number: 5,
    summary: 'Alarm volume is never below 45 dB',
    scenario: 'NO_TEST',
    description:
      'Alarm output must measure at least 45 dB at a distance of 1 meter at every volume setting. The user interface must not offer a setting that goes below this level.',
  },
  {
    number: 6,
    summary: 'Every dose event is written to a tamper-evident audit log',
    scenario: 'GREEN',
    description:
      'Each delivered, cancelled, or failed dose must be appended to a hash-chained audit log. Any break in the chain is reported during the next log review.',
  },
  {
    number: 7,
    summary: 'Firmware updates are signature-verified',
    scenario: 'STALE_VERIFICATION',
    description:
      'The pump must verify the cryptographic signature of every firmware image before installing it. An image with a missing or invalid signature is rejected, and the running firmware stays active.',
  },
  {
    number: 8,
    summary: 'Bluetooth pairing requires a 6-digit PIN',
    scenario: 'TEST_NOT_RUN',
    description:
      'A new Bluetooth device can pair only after the user enters the 6-digit PIN shown on the pump. The PIN expires after 60 seconds or after three failed attempts.',
  },
  {
    number: 9,
    summary: 'Patient data at rest is AES-256 encrypted',
    scenario: 'GREEN',
    description:
      'All patient data stored on the device must be encrypted with AES-256. Encryption keys are held in the secure element and are never written to general storage.',
  },
  {
    number: 10,
    summary: 'Clinician mode requires a PIN',
    scenario: 'NO_IMPLEMENTATION',
    description:
      'Access to clinician settings must require a dedicated PIN that is separate from the patient lock. Five consecutive failed attempts lock clinician mode for 15 minutes.',
  },
  {
    number: 11,
    summary: 'Basal rate changes take effect within 1 minute',
    scenario: 'GREEN',
    description:
      'A confirmed basal rate change must take effect within 1 minute. The previous rate continues without interruption until the new rate starts.',
  },
  {
    number: 12,
    summary: 'Reservoir-low warning at 20 units',
    scenario: 'IMPLEMENTATION_OPEN',
    description:
      'The pump must warn the user when the reservoir holds 20 units or less. The warning shows the estimated delivery time remaining at the current basal rate.',
  },
  {
    number: 13,
    summary: 'Doses are displayed with one decimal place',
    scenario: 'GREEN',
    description:
      'All dose values on the pump display must be shown with exactly one decimal place. Displayed values are rounded only for presentation and never change the delivered amount.',
  },
  {
    number: 14,
    summary: 'Time-zone changes never shift the basal schedule',
    scenario: 'NO_TEST',
    description:
      'Changing the device time zone must not move or alter the programmed basal schedule without explicit user confirmation. The pump shows the old and new schedule times before any change is applied.',
  },
  {
    number: 15,
    summary: 'Delivery is suspended on a critical fault',
    scenario: 'TEST_FAILED',
    description:
      'The pump must suspend all insulin delivery as soon as a critical hardware or software fault is detected. Delivery can resume only after the fault clears and the user confirms restart.',
  },
  {
    number: 16,
    summary: 'Self-test runs at power-on',
    scenario: 'GREEN',
    description:
      'The pump must run a self-test of its motor, sensors, memory, and alarms at every power-on. Delivery stays disabled until all self-test checks pass.',
  },
  {
    number: 17,
    summary: 'Error codes are documented in the user manual',
    scenario: 'NO_OWNER',
    description:
      'Every error code the pump can display must appear in the user manual with its meaning and recommended action. The manual is reviewed against the error code list before each release.',
  },
  {
    number: 18,
    summary: 'Out-of-range temperature warning',
    scenario: 'TEST_NOT_RUN',
    description:
      'The pump must warn the user when its internal temperature leaves the 5 to 40 degree Celsius operating range. The warning includes guidance on protecting the insulin from heat or cold.',
  },
  {
    number: 19,
    summary: 'Remote bolus from the phone app needs confirmation on the pump',
    scenario: 'NO_TEST',
    description:
      'A bolus requested from the phone app must not start until the user confirms it on the pump. An unconfirmed request expires after 2 minutes and is logged.',
  },
  {
    number: 20,
    summary: 'Delivery accuracy within +/-5%',
    scenario: 'GREEN',
    description:
      'Delivered insulin volume must stay within plus or minus 5% of the programmed amount across the operating range. Accuracy is measured using the gravimetric bench method.',
  },
];

const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
const demoJql = `project = "${PROJECT_KEY}" AND labels = "${DEMO_LABEL}"`;
const totals = { requirements: 0, stories: 0, tests: 0, links: 0 };

let apiBaseUrl = '';
let nextRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[TG] ${message}`);
const sameName = (a, b) => a?.trim().toLowerCase() === b.trim().toLowerCase();
const itemsCreated = () => totals.requirements + totals.stories + totals.tests;

// Rejects bad config before credentials are sent anywhere.
function resolveApiBaseUrl() {
  const config = { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PROJECT_KEY };
  const missing = Object.keys(config).filter((name) => !config[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}. Copy scripts/.env.example to scripts/.env and fill it in.`);
  }

  const placeholders = Object.keys(config).filter((name) => /[<>]/.test(config[name]));
  if (placeholders.length) {
    throw new Error(`Replace the placeholder value of ${placeholders.join(', ')} in scripts/.env.`);
  }

  if (!/^[A-Z][A-Z0-9_]+$/.test(PROJECT_KEY)) {
    throw new Error(`PROJECT_KEY "${PROJECT_KEY}" is not a valid Jira project key.`);
  }

  let url;
  try {
    url = new URL(JIRA_BASE_URL);
  } catch {
    throw new Error('JIRA_BASE_URL is not a valid URL.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  const isSiteUrl = url.hostname.endsWith('.atlassian.net') && path === '';
  const isGatewayUrl = url.hostname === 'api.atlassian.com' && /^\/ex\/jira\/[\w-]+$/.test(path);
  if (url.protocol !== 'https:' || !(isSiteUrl || isGatewayUrl)) {
    throw new Error(
      'JIRA_BASE_URL must be https://<site>.atlassian.net or https://api.atlassian.com/ex/jira/<cloudId>.',
    );
  }
  return `${url.origin}${path}`;
}

// Requests run one at a time, so spacing each from the last enforces the rate limit.
async function throttle() {
  while (Date.now() < nextRequestAt) {
    await sleep(nextRequestAt - Date.now());
  }
  nextRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
}

function jiraError(method, path, status, body) {
  const hint =
    status === 401
      ? ' Check JIRA_EMAIL and JIRA_API_TOKEN. A token with scopes needs the api.atlassian.com base URL.'
      : '';
  const error = new Error(`${method} ${path} -> ${status} ${body.slice(0, 500)}${hint}`);
  error.status = status;
  return error;
}

async function sendRequest(method, path, fetchOptions) {
  await throttle();
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      ...fetchOptions,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });
  } catch (cause) {
    throw new Error(`${method} ${path} failed before Jira responded: ${cause.message}`);
  }
}

// `idempotent` marks calls that are safe to repeat after a 429.
async function jira(path, options = {}) {
  const { idempotent, ...fetchOptions } = options;
  const method = fetchOptions.method || 'GET';
  const canRetry = idempotent ?? method !== 'POST';

  for (let attempt = 0; ; attempt += 1) {
    const res = await sendRequest(method, path, fetchOptions);
    const retryAfterSeconds = Number(res.headers.get('retry-after'));
    const shouldRetry =
      res.status === 429 && canRetry && retryAfterSeconds > 0 && attempt < MAX_RATE_LIMIT_RETRIES;

    if (shouldRetry) {
      log(`Rate limited on ${method} ${path}. Retrying in ${retryAfterSeconds}s.`);
      await sleep(retryAfterSeconds * 1000);
      continue;
    }
    if (!res.ok) {
      throw jiraError(method, path, res.status, await res.text());
    }

    const text = await res.text();
    // 201/204 can have an empty body.
    return text ? JSON.parse(text) : null;
  }
}

const adf = (text) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const createIssue = (issueTypeId, summary, description) =>
  jira('/rest/api/3/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: PROJECT_KEY },
        issuetype: { id: issueTypeId },
        summary,
        description: adf(description),
        labels: [DEMO_LABEL],
      },
    }),
  });

async function link(fromKey, toKey) {
  await jira('/rest/api/3/issueLink', {
    method: 'POST',
    body: JSON.stringify({
      type: { name: 'Relates' },
      inwardIssue: { key: fromKey },
      outwardIssue: { key: toKey },
    }),
  });
  totals.links += 1;
}

const assign = (issueKey, accountId) =>
  jira(`/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId }),
  });

const editDescription = (issueKey, description) =>
  jira(`/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: { description: adf(description) } }),
  });

async function moveToStatus(issueKey, statusName) {
  const { transitions } = await jira(`/rest/api/3/issue/${issueKey}/transitions`);
  const transition = transitions.find(
    (candidate) => candidate.isAvailable !== false && sameName(candidate.to?.name, statusName),
  );
  if (!transition) {
    const available = transitions.map((candidate) => candidate.to?.name).join(', ') || 'none';
    throw new Error(`${issueKey} has no transition to "${statusName}". Available: ${available}.`);
  }
  await jira(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
}

async function assertStatus(issueKey, statusName) {
  const issue = await jira(`/rest/api/3/issue/${issueKey}?fields=status`);
  const actual = issue.fields?.status?.name;
  if (!sameName(actual, statusName)) {
    throw new Error(`${issueKey} should start in "${statusName}" but is in "${actual}".`);
  }
}

async function fetchProjectWorkTypes() {
  const workTypes = [];
  let startAt = 0;
  for (;;) {
    const page = await jira(
      `/rest/api/3/issue/createmeta/${PROJECT_KEY}/issuetypes?startAt=${startAt}&maxResults=50`,
    );
    const pageItems = page.issueTypes ?? page.createMetaIssueType ?? [];
    workTypes.push(...pageItems);
    startAt += pageItems.length;
    if (pageItems.length === 0 || startAt >= page.total) {
      return workTypes;
    }
  }
}

async function findWorkTypeIds() {
  const workTypes = await fetchProjectWorkTypes();
  const idFor = (name) => workTypes.find((workType) => sameName(workType.name, name))?.id;
  const ids = { Requirement: idFor('Requirement'), Story: idFor('Story'), Test: idFor('Test') };

  const missing = Object.keys(ids).filter((name) => !ids[name]);
  if (missing.length) {
    const available = workTypes.map((workType) => workType.name).join(', ') || 'none';
    throw new Error(
      `Project ${PROJECT_KEY} is missing work type(s): ${missing.join(', ')}. Available: ${available}. Nothing was created.`,
    );
  }
  return ids;
}

// Checks workflows up front so a bad setup cannot leave a half-seeded project.
async function assertRequiredStatuses() {
  const workTypes = await jira(`/rest/api/3/project/${PROJECT_KEY}/statuses`);
  for (const [workTypeName, statusNames] of Object.entries(REQUIRED_STATUSES)) {
    const workType = workTypes.find((candidate) => sameName(candidate.name, workTypeName));
    const missing = statusNames.filter(
      (statusName) => !workType?.statuses?.some((status) => sameName(status.name, statusName)),
    );
    if (missing.length) {
      throw new Error(
        `${workTypeName} workflow is missing status(es): ${missing.join(', ')}. Nothing was created.`,
      );
    }
  }
}

async function searchDemoKeys() {
  const keys = [];
  let nextPageToken;
  do {
    const page = await jira('/rest/api/3/search/jql', {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({
        jql: demoJql,
        fields: ['key'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    keys.push(...page.issues.map((issue) => issue.key ?? issue.id));
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);
  return keys;
}

async function createRequirements(requirementTypeId, accountId) {
  log(`Creating ${REQUIREMENTS.length} requirements...`);
  const seeded = [];
  for (const requirement of REQUIREMENTS) {
    const { key } = await createIssue(requirementTypeId, requirement.summary, requirement.description);
    totals.requirements += 1;

    if (requirement.number === 1 && key !== `${PROJECT_KEY}-1`) {
      log(`Warning: the first requirement is ${key}, so keys will not be ${PROJECT_KEY}-1 to ${PROJECT_KEY}-20.`);
    }

    // The assignee endpoint also clears any project default for the unowned requirement.
    await assign(key, requirement.scenario === 'NO_OWNER' ? null : accountId);
    log(`Requirement ${requirement.number}/${REQUIREMENTS.length}: ${key} created`);
    seeded.push({ ...requirement, key });
  }
  return seeded;
}

async function createLinkedItem(typeId, totalName, prefix, verb, requirement) {
  const { key } = await createIssue(
    typeId,
    `${prefix}: ${requirement.summary}`,
    `${verb} requirement ${requirement.key}: ${requirement.summary}.`,
  );
  totals[totalName] += 1;
  await link(requirement.key, key);
  return key;
}

// Links are created before transitions so they cannot make a passed test look stale.
async function buildScenario(requirement, workTypeIds) {
  const plan = SCENARIOS[requirement.scenario];
  const storyKey = plan.story
    ? await createLinkedItem(workTypeIds.Story, 'stories', 'Implement', 'Implements', requirement)
    : null;
  const testKey = plan.test
    ? await createLinkedItem(workTypeIds.Test, 'tests', 'Verify', 'Verifies', requirement)
    : null;

  if (storyKey) await moveToStatus(storyKey, plan.story);
  if (testKey && plan.test === 'Not run') await assertStatus(testKey, plan.test);
  if (testKey && plan.test !== 'Not run') await moveToStatus(testKey, plan.test);

  if (requirement.scenario === 'STALE_VERIFICATION') {
    await sleep(STALE_EDIT_DELAY_MS);
    await editDescription(requirement.key, STALE_REVISED_DESCRIPTION);
  }

  const story = storyKey ? `story ${storyKey} ${plan.story}` : 'no story';
  const test = testKey ? `test ${testKey} ${plan.test}` : 'no test';
  log(`${requirement.key} ${requirement.scenario}: ${story}, ${test}`);
}

function printSeedSummary(requirements) {
  const counts = {};
  for (const { scenario } of requirements) {
    counts[scenario] = (counts[scenario] || 0) + 1;
  }

  log('Seed complete.');
  log(`Requirements: ${totals.requirements} (${requirements[0].key} to ${requirements.at(-1).key})`);
  log(`Stories: ${totals.stories}, Tests: ${totals.tests}, Links: ${totals.links}`);
  log(`Total work items: ${itemsCreated()}`);
  for (const [scenario, count] of Object.entries(counts)) {
    log(`  ${scenario}: ${count}`);
  }
}

async function seedDemoData() {
  const { accountId } = await jira('/rest/api/3/myself');
  const workTypeIds = await findWorkTypeIds();
  await assertRequiredStatuses();

  const existing = await searchDemoKeys();
  if (existing.length) {
    throw new Error(
      `${existing.length} ${DEMO_LABEL} work item(s) already exist in ${PROJECT_KEY}. ` +
        'Run npm run seed:reset first. If you just reset, wait a minute for Jira search to catch up.',
    );
  }

  const requirements = await createRequirements(workTypeIds.Requirement, accountId);
  log('Creating stories and tests...');
  for (const requirement of requirements) {
    await buildScenario(requirement, workTypeIds);
  }
  printSeedSummary(requirements);
}

async function deleteDemoItem(key, result) {
  try {
    await jira(`/rest/api/3/issue/${key}`, { method: 'DELETE' });
    result.deleted += 1;
    log(`Deleted ${key}`);
  } catch (error) {
    // A 404 means stale search results listed an item that is already gone.
    if (error.status !== 404) {
      result.failed.push(key);
      console.error(`[TG] Could not delete ${key}: ${error.message}`);
    }
  }
}

// Searches again after each pass because Jira search can lag behind recent writes.
async function resetDemoData() {
  const seen = new Set();
  const result = { deleted: 0, failed: [] };

  for (;;) {
    const newKeys = (await searchDemoKeys()).filter((key) => !seen.has(key));
    if (newKeys.length === 0) break;

    for (const key of newKeys) {
      seen.add(key);
      await deleteDemoItem(key, result);
    }
    await sleep(SEARCH_SETTLE_MS);
  }

  log(`Reset complete. Deleted ${result.deleted} ${DEMO_LABEL} work item(s) from ${PROJECT_KEY}.`);
  if (result.failed.length) {
    console.error(`[TG] Could not delete ${result.failed.length}: ${result.failed.join(', ')}`);
    process.exitCode = 1;
  }
}

async function main() {
  apiBaseUrl = resolveApiBaseUrl();
  if (process.argv.includes('--reset')) {
    await resetDemoData();
  } else {
    await seedDemoData();
  }
}

main().catch((error) => {
  console.error(`[TG] Stopped: ${error.message}`);
  if (itemsCreated() > 0) {
    console.error(`[TG] ${itemsCreated()} work item(s) were created. Run npm run seed:reset before trying again.`);
  }
  process.exitCode = 1;
});
