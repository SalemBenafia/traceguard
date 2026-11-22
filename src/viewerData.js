import { getMatrix } from './db/repo';
import { filterForViewer, referencedIssueKeys } from './engine/visibility';
import { visibleIssueKeys } from './jira/client';

// Saved results are shared, so each viewer only receives what Jira lets them see.
export async function viewerMatrix(projectKey) {
  const matrix = await getMatrix(projectKey);
  const visibleKeys = await visibleIssueKeys(referencedIssueKeys(matrix));
  const visible = filterForViewer(matrix, visibleKeys);
  return { matrix: visible, hiddenCount: matrix.length - visible.length };
}

export const matrixForViewer = async (projectKey) => (await viewerMatrix(projectKey)).matrix;
