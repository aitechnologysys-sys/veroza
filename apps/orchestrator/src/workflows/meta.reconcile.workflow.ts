import { proxyActivities, sleep } from '@temporalio/workflow';
import { MetaActivity } from '@gitroom/orchestrator/activities/meta.activity';

/**
 * Safety net for Meta deletion requests.
 *
 * A request row is written before its workflow is started, so a crash between
 * the two, a Temporal outage, or an enqueue that threw leaves a request that
 * nothing would ever pick up. This sweeps for those and re-drives them, and
 * raises an alert for any that have been open far longer than they should be.
 *
 * Mirrors missingPostWorkflow: one long-running execution that loops, rather
 * than an external scheduler.
 */
const { reconcileMetaDeletions } = proxyActivities<MetaActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function metaDeletionReconcileWorkflow() {
  while (true) {
    // Leave a grace period before the first sweep so a just-accepted request
    // is not re-driven while its own workflow is still starting.
    await sleep('15 minutes');
    await reconcileMetaDeletions();
  }
}
