import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MetaDeletionService } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.service';
import { MetaComplianceAlertService } from '@gitroom/nestjs-libraries/services/meta.compliance.alert.service';

@Injectable()
@Activity()
export class MetaActivity {
  constructor(
    private _metaDeletionService: MetaDeletionService,
    private _metaComplianceAlertService: MetaComplianceAlertService
  ) {}

  /**
   * Delete the Meta-derived data for one accepted request.
   *
   * Idempotent: the service claims the row conditionally, so a Temporal retry
   * that re-runs a completed activity will not delete twice.
   *
   * A verified request that matches nothing is not an error — but it is worth
   * an operator's attention, since it can also mean an identity we failed to
   * map (for example a legacy row with a null rootInternalId).
   */
  @ActivityMethod()
  async processMetaDeletion(requestId: string) {
    const result = await this._metaDeletionService.process(requestId);

    if (result.status === 'UNMATCHED') {
      await this._metaComplianceAlertService.alert({
        requestId,
        category: 'identity_unmatched',
        detail: 'Verified request matched no stored integration',
      });
    }

    return result;
  }

  /**
   * Re-drive deletion requests that never got a workflow, and alert on any
   * that have been open far too long.
   */
  @ActivityMethod()
  async reconcileMetaDeletions() {
    const { restarted, stalled } = await this._metaDeletionService.reconcile();

    if (restarted.length) {
      console.error(
        JSON.stringify({
          event: 'meta_deletion_reconciled',
          restarted: restarted.length,
        })
      );
    }

    for (const requestId of stalled) {
      await this._metaComplianceAlertService.alert({
        requestId,
        category: 'deletion_stalled',
        detail: 'Open past the agreed processing window',
      });
    }

    return { restarted: restarted.length, stalled: stalled.length };
  }

  /** Record the terminal failure so an operator can find and retry it. */
  @ActivityMethod()
  async failMetaDeletion(requestId: string, reason: string) {
    await this._metaDeletionService.markFailed(requestId, reason);
  }

  /**
   * Alert on a deletion that exhausted its retries.
   *
   * Routed through Sentry, which is already initialized for this service and
   * has on-call routing. Carries an opaque request ID and a category — never
   * the Meta user ID, the organization, tokens or the signed request.
   */
  @ActivityMethod()
  async alertMetaDeletionFailure(requestId: string, reason?: string) {
    const delivered = await this._metaComplianceAlertService.alert({
      requestId,
      category: 'deletion_failed',
      detail: reason,
    });

    if (!delivered) {
      // Surfacing this as an activity failure makes an undelivered compliance
      // alert visible in Temporal rather than lost.
      throw new Error(
        `Could not deliver the compliance alert for request ${requestId}`
      );
    }
  }
}
