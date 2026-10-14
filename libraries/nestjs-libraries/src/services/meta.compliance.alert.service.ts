import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Operational alerting for Meta deletion requests.
 *
 * Deletion is a legal obligation with a deadline, so a request that fails or
 * stalls must reach a human. This routes through Sentry, which is already
 * initialized for both the backend and the orchestrator
 * (`initialize.sentry.ts`) and already has on-call routing — rather than the
 * in-app notification system, which needs an organization to address and is a
 * customer-facing channel, not an operational one.
 *
 * Alerts carry an opaque request ID and nothing else. No Meta user ID, no
 * tokens, no signed_request, no organization, no channel names.
 */

export type MetaAlertCategory =
  // Retries exhausted; the data may still be stored.
  | 'deletion_failed'
  // Verified, but the identity matched nothing we hold.
  | 'identity_unmatched'
  // Accepted but still not finished inside the agreed window.
  | 'deletion_stalled'
  // The alert channel itself could not be reached.
  | 'alert_delivery_failed';

export interface MetaAlert {
  requestId: string;
  category: MetaAlertCategory;
  /** Operator-facing detail. Must already be free of personal data. */
  detail?: string;
}

@Injectable()
export class MetaComplianceAlertService {
  /**
   * Fire an alert. Never throws: an alert failing must not roll back a
   * deletion that otherwise succeeded. A failure to deliver is itself logged
   * so it stays observable.
   */
  async alert({ requestId, category, detail }: MetaAlert): Promise<boolean> {
    const environment = process.env.NODE_ENV || 'development';
    const timestamp = new Date().toISOString();

    // initializeSentry() returns early when neither SENTRY_DSN nor the legacy
    // NEXT_PUBLIC_SENTRY_DSN is set, and captureMessage then silently does
    // nothing. Reporting that as delivered would hide a compliance alert that
    // never left the process, so an uninitialized client counts as a delivery
    // failure.
    const sentryReady = Boolean((Sentry as any).getClient?.());

    try {
      if (!sentryReady) {
        // Name the variable an operator should actually set. SENTRY_DSN is
        // what .env.example and scripts/preflight.sh use; NEXT_PUBLIC_* is a
        // Next.js browser convention kept only for backward compatibility.
        throw new Error('Sentry is not initialized (SENTRY_DSN unset)');
      }

      Sentry.withScope((scope) => {
        scope.setLevel(
          category === 'identity_unmatched' ? 'warning' : 'error'
        );
        scope.setTags({
          feature: 'meta-data-deletion',
          meta_alert_category: category,
          environment,
        });
        scope.setContext('meta_deletion_request', {
          requestId,
          category,
          environment,
          timestamp,
          ...(detail ? { detail } : {}),
        });
        // Group by category and request so repeated alerts for the same
        // request collapse into one Sentry issue instead of a storm, while a
        // different request still raises its own.
        scope.setFingerprint(['meta-data-deletion', category, requestId]);

        Sentry.captureMessage(
          `Meta data deletion: ${category} (request ${requestId})`
        );
      });

      // Structured, greppable, and free of anything sensitive.
      console.error(
        JSON.stringify({
          event: 'meta_deletion_alert',
          category,
          requestId,
          environment,
          timestamp,
          ...(detail ? { detail } : {}),
        })
      );

      return true;
    } catch (err) {
      // The alert channel itself failed. Log loudly rather than silently
      // dropping a compliance signal.
      console.error(
        JSON.stringify({
          event: 'meta_deletion_alert_delivery_failed',
          category,
          requestId,
          environment,
          timestamp,
          error: (err as Error)?.message || 'unknown',
        })
      );
      return false;
    }
  }
}
