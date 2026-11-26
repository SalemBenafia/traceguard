import {
  claimPendingComment,
  clearPendingComments,
  getPendingGapComments,
  releaseCommentSlot,
  releasePendingComment,
  removeOldCommentSlots,
  reserveCommentSlot,
} from './db/repo';
import { errorLabel } from './engine/errors';
import { buildGapComment, utcDay } from './engine/gapComment';
import { RequirementJqlError } from './engine/jql';
import { addComment } from './jira/client';
import { scanProject } from './scanner';
import { getSettings } from './settings';

const MAX_COMMENTS_PER_DAY = 20;
const COMMENT_TIME_RESERVE_MS = 60_000;
const PROJECT_FAILED = 'The nightly job could not finish for this project, so check the app logs and run it again.';

async function postComment(projectKey, pending, day, slot) {
  if (!(await claimPendingComment(pending.eventId))) {
    await releaseCommentSlot(day, slot);
    return false;
  }

  try {
    await addComment(pending.reqKey, buildGapComment(pending));
    return true;
  } catch (error) {
    console.error(`[TG] Could not comment on ${pending.reqKey}: ${errorLabel(error)}`);
    await releasePendingComment(projectKey, pending);
    await releaseCommentSlot(day, slot);
    return false;
  }
}

async function postProjectComments(projectKey, deadlineAt) {
  const pendingComments = await getPendingGapComments(projectKey);
  const day = utcDay();
  let posted = 0;

  for (const pending of pendingComments) {
    if (Date.now() >= deadlineAt) break;

    const slot = await reserveCommentSlot(day, MAX_COMMENTS_PER_DAY);
    if (slot === null) break;
    if (await postComment(projectKey, pending, day, slot)) posted += 1;
  }

  return { posted, waiting: pendingComments.length - posted };
}

function scanBudget(scanBudgetMs, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  return scanBudgetMs ?? Math.max(remaining - COMMENT_TIME_RESERVE_MS, 1_000);
}

async function runProject(projectKey, { scanBudgetMs, deadlineAt, graphAsUser }) {
  const scan = await scanProject(projectKey, {
    asUser: false,
    graphAsUser,
    source: 'nightly',
    timeBudgetMs: scanBudget(scanBudgetMs, deadlineAt),
  });

  const settings = await getSettings(projectKey);
  if (!settings.commentOnNewGaps) {
    await clearPendingComments(projectKey);
    return { scan, posted: 0, waiting: 0 };
  }
  return { scan, ...(await postProjectComments(projectKey, deadlineAt)) };
}

const failureMessage = (error) => (error instanceof RequirementJqlError ? error.message : PROJECT_FAILED);

// One failing project is reported and never stops the others.
export async function runNightly({ projectKeys, deadlineAt, scanBudgetMs = null, graphAsUser = false }) {
  const summary = { scanned: 0, commentsPosted: 0, commentsWaiting: 0, warnings: [], failures: [] };
  await removeOldCommentSlots(utcDay()).catch((error) => {
    console.error(`[TG] Could not remove old comment limits: ${errorLabel(error)}`);
  });

  for (const projectKey of projectKeys) {
    if (Date.now() >= deadlineAt) {
      summary.warnings.push(`The nightly job ran out of time before ${projectKey}, so run it again for that project.`);
      continue;
    }

    try {
      const { scan, posted, waiting } = await runProject(projectKey, {
        scanBudgetMs,
        deadlineAt,
        graphAsUser,
      });
      summary.scanned += scan.requirements.length;
      summary.commentsPosted += posted;
      summary.commentsWaiting += waiting;
      summary.warnings.push(...scan.warnings);
    } catch (error) {
      console.error(`[TG] Nightly job failed for ${projectKey}: ${errorLabel(error)}`);
      summary.failures.push({ projectKey, message: failureMessage(error) });
    }
  }
  return summary;
}
