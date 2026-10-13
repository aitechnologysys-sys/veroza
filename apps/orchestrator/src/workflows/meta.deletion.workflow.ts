import { proxyActivities } from '@temporalio/workflow';
import { MetaActivity } from '@gitroom/orchestrator/activities/meta.activity';

/**
 * Deleting is retried with backoff because the failure modes are transient —
 * a database blip, a provider timing out during revocation. Five attempts over
 * a widening interval, then the request is marked FAILED and an operator is
 * alerted rather than the workflow disappearing.
 */
const { processMetaDeletion } = proxyActivities<MetaActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 5,
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '10 minutes',
  },
});

// Bookkeeping after a terminal failure must not inherit the aggressive retry
// of the work itself, and must not be abandoned if it hiccups either.
const { failMetaDeletion, alertMetaDeletionFailure } =
  proxyActivities<MetaActivity>({
    startToCloseTimeout: '2 minute',
    taskQueue: 'main',
    retry: { maximumAttempts: 3, initialInterval: '10 seconds' },
  });

export async function metaDeletionWorkflow({
  requestId,
}: {
  requestId: string;
}) {
  try {
    return await processMetaDeletion(requestId);
  } catch (err) {
    // Only the message — the error may carry upstream payloads.
    const reason =
      (err as any)?.cause?.message || (err as any)?.message || 'Unknown error';

    await failMetaDeletion(requestId, String(reason));
    await alertMetaDeletionFailure(requestId, String(reason));

    // Rethrow so the failure is visible in Temporal rather than looking like a
    // clean finish.
    throw err;
  }
}
