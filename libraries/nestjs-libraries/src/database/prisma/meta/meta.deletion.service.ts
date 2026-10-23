import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MetaApp, MetaCallbackType } from '@prisma/client';
import { MetaDeletionRepository } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { TemporalService } from 'nestjs-temporal-core';
import { AnalyticsCacheService } from '@gitroom/nestjs-libraries/redis/analytics.cache.service';
import { META_APP_PROVIDERS } from '@gitroom/nestjs-libraries/services/meta.signed.request.service';

export interface AcceptedMetaRequest {
  id: string;
  confirmationCode: string;
}

/** What the public status page is allowed to show. Nothing account-specific. */
export interface PublicDeletionStatus {
  confirmationCode: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
  receivedAt: string | null;
  completedAt: string | null;
}

@Injectable()
export class MetaDeletionService {
  constructor(
    private _metaDeletionRepository: MetaDeletionRepository,
    private _integrationRepository: IntegrationRepository,
    private _integrationManager: IntegrationManager,
    private _temporalService: TemporalService,
    private _analyticsCacheService: AnalyticsCacheService
  ) {}

  /**
   * Hand the request to the orchestrator.
   *
   * The workflow ID is derived from the request, and conflicts reuse the
   * running execution, so a replayed callback cannot start a second deletion
   * even if it slips past the open-request check.
   */
  async enqueue(requestId: string) {
    await this._temporalService.client
      .getRawClient()
      ?.workflow.start('metaDeletionWorkflow', {
        args: [{ requestId }],
        workflowId: `meta_deletion_${requestId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
  }

  /**
   * 24 random bytes. Meta only requires an alphanumeric code, but it is also
   * the key to a public URL, so it has to be unguessable — otherwise anyone
   * could enumerate other people's requests.
   */
  private static confirmationCode(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * Record a verified callback and return the code to hand back to Meta.
   *
   * Meta retries callbacks, so a replay for an identity that is already being
   * processed returns the original request instead of queueing a second
   * deletion of the same data.
   */
  async accept(
    metaApp: MetaApp,
    metaUserId: string,
    callbackType: MetaCallbackType
  ): Promise<{ request: AcceptedMetaRequest; isNew: boolean }> {
    const open = await this._metaDeletionRepository.findOpen(
      metaApp,
      metaUserId,
      callbackType
    );

    if (open) {
      return {
        request: { id: open.id, confirmationCode: open.confirmationCode },
        isNew: false,
      };
    }

    const created = await this._metaDeletionRepository.create({
      confirmationCode: MetaDeletionService.confirmationCode(),
      callbackType,
      metaApp,
      metaUserId,
    });

    return {
      request: {
        id: created.id,
        confirmationCode: created.confirmationCode,
      },
      isNew: true,
    };
  }

  /**
   * Delete the Meta-derived data for one accepted request.
   *
   * Called from the Temporal activity. Safe to run twice: claiming the row is
   * conditional, and a request that is no longer PENDING is treated as already
   * handled rather than re-deleted.
   */
  async process(
    requestId: string
  ): Promise<{ matched: number; status: string }> {
    const claimed = await this._metaDeletionRepository.claimForProcessing(
      requestId
    );

    if (!claimed) {
      // Already in a terminal state — completed, unmatched or failed. Report
      // what it settled on rather than re-running the deletion.
      const existing = await this._metaDeletionRepository.findById(requestId);
      return {
        matched: existing?.matchedCount ?? 0,
        status: existing?.status ?? 'UNKNOWN',
      };
    }

    const request = await this._metaDeletionRepository.findById(requestId);
    if (!request) {
      throw new Error(`Meta deletion request ${requestId} disappeared`);
    }

    // On a retry the targets are already known: the first attempt scrubbed
    // rootInternalId, so a fresh lookup would come back empty and the request
    // would wrongly settle as UNMATCHED with cached data still present.
    const recorded = request.matchedTargets
      ? (JSON.parse(request.matchedTargets) as {
          id: string;
          organizationId: string;
        }[])
      : null;

    const integrations = recorded
      ? await this._integrationRepository.findMetaIntegrationsByIds(
          recorded.map((t) => t.id)
        )
      : await this._integrationRepository.findMetaIntegrationsByUserId(
          META_APP_PROVIDERS[request.metaApp] || [],
          request.metaUserId
        );

    if (!recorded) {
      await this._metaDeletionRepository.recordMatchedTargets(
        requestId,
        integrations.map((i: any) => ({
          id: i.id,
          organizationId: i.organizationId,
        }))
      );
    }

    for (const integration of integrations) {
      // Best effort, and deliberately before the scrub so the token still
      // exists to revoke with. A failure here must not stop the deletion —
      // the obligation is to drop our copy, not to succeed upstream.
      await this.revokeQuietly(
        integration.id,
        integration.providerIdentifier,
        integration.token
      );

      // Read the post IDs before scrubbing so the cache keys can be built;
      // the scrub leaves the posts in place but clears their Meta receipts.
      const postIds =
        await this._integrationRepository.getPostIdsForIntegration(
          integration.id
        );

      await this._integrationRepository.scrubMetaIntegration(integration.id);

      // Cached provider analytics are Meta-derived personal data and outlive
      // the row by up to an hour on their TTL, so they are cleared explicitly.
      // Scoped to the owning organization, so no other tenant is reachable.
      const cleared = await this.clearAnalyticsQuietly(
        integration.organizationId,
        integration.id,
        postIds
      );

      // An incomplete sweep means Meta-derived data is still cached. Refuse to
      // call the request done: throwing hands it back to Temporal's retry, and
      // the scrub is idempotent so repeating it is safe. After the retries are
      // spent the workflow marks it FAILED and alerts, which is the correct
      // outcome for data we could not prove we removed.
      if (!cleared) {
        throw new Error(
          `Analytics cache cleanup was incomplete for integration ${integration.id}`
        );
      }
    }

    await this._metaDeletionRepository.markCompleted(
      requestId,
      integrations.length
    );

    return {
      matched: integrations.length,
      status: integrations.length > 0 ? 'COMPLETED' : 'UNMATCHED',
    };
  }

  private async revokeQuietly(
    integrationId: string,
    providerIdentifier: string,
    token: string
  ) {
    try {
      const provider = this._integrationManager.getSocialIntegration(
        providerIdentifier
      ) as { revokeToken?: (token: string) => Promise<unknown> } | undefined;

      if (!provider?.revokeToken || !token) {
        return;
      }

      await provider.revokeToken(token);
    } catch {
      // Never log the error body — it can echo the token back.
      console.error(
        `Meta deletion: upstream revocation failed for integration ${integrationId}`
      );
    }
  }

  /**
   * Clear one integration's cached analytics.
   *
   * Returns whether the sweep finished. A Redis error or a truncated scan both
   * mean Meta-derived data may remain, which the caller turns into a retry —
   * the cache is derived data, but it is still personal data we were asked to
   * delete.
   */
  private async clearAnalyticsQuietly(
    organizationId: string,
    integrationId: string,
    postIds: string[]
  ): Promise<boolean> {
    try {
      const result =
        await this._analyticsCacheService.clearIntegrationAnalytics(
          organizationId,
          integrationId,
          postIds
        );

      if (result.truncated) {
        console.error(
          JSON.stringify({
            event: 'meta_deletion_cache_scan_truncated',
            integrationId,
          })
        );
        return false;
      }

      return true;
    } catch {
      console.error(
        JSON.stringify({
          event: 'meta_deletion_cache_cleanup_failed',
          integrationId,
        })
      );
      return false;
    }
  }

  /**
   * Re-drive requests that never got a workflow.
   *
   * The row is persisted before the workflow starts, so a crash between the
   * two, a Temporal outage, or an enqueue that threw all leave a request that
   * nothing will ever process. Starting the workflow again is safe: the ID is
   * derived from the request and conflicts reuse the running execution, so an
   * already-running deletion is untouched.
   *
   * Returns what it found so the caller can alert on anything long overdue.
   */
  async reconcile(
    graceMinutes = 10,
    stalledHours = 24
  ): Promise<{ restarted: string[]; stalled: string[] }> {
    const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);
    const stalledBefore = new Date(Date.now() - stalledHours * 60 * 60 * 1000);

    const stranded = await this._metaDeletionRepository.findStranded(cutoff);
    const restarted: string[] = [];
    const stalled: string[] = [];

    for (const request of stranded) {
      try {
        await this.enqueue(request.id);
        restarted.push(request.id);
      } catch {
        console.error(
          JSON.stringify({
            event: 'meta_deletion_reconcile_enqueue_failed',
            requestId: request.id,
          })
        );
      }

      if (request.createdAt < stalledBefore) {
        stalled.push(request.id);
      }
    }

    return { restarted, stalled };
  }

  async markFailed(requestId: string, reason: string) {
    await this._metaDeletionRepository.markFailed(requestId, reason);
  }

  /**
   * The public view of a request. Returns only the status and timestamps —
   * never the Meta user ID, the integrations involved, or the failure reason,
   * since the URL is reachable by anyone holding the code.
   */
  async publicStatus(confirmationCode: string): Promise<PublicDeletionStatus> {
    const request =
      await this._metaDeletionRepository.findByConfirmationCode(
        confirmationCode
      );

    if (!request) {
      return {
        confirmationCode,
        status: 'not_found',
        receivedAt: null,
        completedAt: null,
      };
    }

    // UNMATCHED means the request was honoured and there was nothing stored.
    // To the requester that is indistinguishable from completed, and saying so
    // avoids confirming whether an account existed.
    const status =
      request.status === 'UNMATCHED'
        ? 'completed'
        : (request.status.toLowerCase() as PublicDeletionStatus['status']);

    return {
      confirmationCode: request.confirmationCode,
      status,
      receivedAt: request.createdAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
    };
  }
}
