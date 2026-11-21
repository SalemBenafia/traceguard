// Rovo action handlers. Real versions must check permissions in the user's
// context, because Rovo action inputs cannot be trusted for authorization.

export const traceSummary = async () => {
  console.log('[TG] stub action-trace-summary');
  return { stub: true, name: 'action-trace-summary' };
};

export const requirementTrace = async () => {
  console.log('[TG] stub action-req-trace');
  return { stub: true, name: 'action-req-trace' };
};

export const listGaps = async () => {
  console.log('[TG] stub action-list-gaps');
  return { stub: true, name: 'action-list-gaps' };
};

export const createAuditPack = async () => {
  console.log('[TG] stub action-audit-pack');
  return { stub: true, name: 'action-audit-pack' };
};
