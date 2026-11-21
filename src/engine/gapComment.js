// Pure helpers for the Jira comments posted about new gaps.

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

function ownerNodes(ownerAccountId, ownerName) {
  if (!ownerAccountId) return [];

  const attrs = { id: ownerAccountId, ...(ownerName ? { text: `@${ownerName}` } : {}) };
  return [text(' Owner: '), { type: 'mention', attrs }];
}

export function buildGapComment({ message, ownerAccountId = null, ownerName = null }) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          text('TraceGuard found a new audit gap: ', [{ type: 'strong' }]),
          text(message),
          ...ownerNodes(ownerAccountId, ownerName),
        ],
      },
    ],
  };
}

export const gapMessage = (gaps, gapCode) =>
  gaps.find((gap) => gap.code === gapCode)?.message ?? `Gap ${gapCode}`;

export function groupKeysByProject(keys) {
  const groups = new Map();
  for (const key of new Set(keys)) {
    const projectKey = key.slice(0, key.lastIndexOf('-'));
    groups.set(projectKey, [...(groups.get(projectKey) ?? []), key]);
  }
  return groups;
}

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
