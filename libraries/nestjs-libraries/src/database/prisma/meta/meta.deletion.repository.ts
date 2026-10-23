import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  MetaApp,
  MetaCallbackType,
  MetaDeletionStatus,
} from '@prisma/client';

export interface CreateMetaDeletionRequest {
  confirmationCode: string;
  callbackType: MetaCallbackType;
  metaApp: MetaApp;
  metaUserId: string;
}

/** Statuses that mean a request is still in flight. */
const OPEN_STATUSES: MetaDeletionStatus[] = ['PENDING', 'PROCESSING'];

@Injectable()
export class MetaDeletionRepository {
  constructor(
    private _metaDeletionRequest: PrismaRepository<'metaDeletionRequest'>
  ) {}

  create(request: CreateMetaDeletionRequest) {
    return this._metaDeletionRequest.model.metaDeletionRequest.create({
      data: {
        confirmationCode: request.confirmationCode,
        callbackType: request.callbackType,
        metaApp: request.metaApp,
        metaUserId: request.metaUserId,
        status: 'PENDING',
      },
    });
  }

  /**
   * An already-running request for the same identity and callback type.
   * Meta retries callbacks, so a replay must join the existing request rather
   * than start a second deletion of the same data.
   */
  findOpen(
    metaApp: MetaApp,
    metaUserId: string,
    callbackType: MetaCallbackType
  ) {
    return this._metaDeletionRequest.model.metaDeletionRequest.findFirst({
      where: {
        metaApp,
        metaUserId,
        callbackType,
        status: { in: OPEN_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByConfirmationCode(confirmationCode: string) {
    return this._metaDeletionRequest.model.metaDeletionRequest.findUnique({
      where: { confirmationCode },
    });
  }

  findById(id: string) {
    return this._metaDeletionRequest.model.metaDeletionRequest.findUnique({
      where: { id },
    });
  }

  /**
   * Claim a request for processing.
   *
   * PROCESSING is claimable as well as PENDING: a request that threw part way
   * through stays PROCESSING, and the Temporal retry has to be able to pick it
   * up again or the work would silently never finish. Concurrency is handled
   * upstream — one workflow per request ID, and Temporal runs one activity
   * attempt at a time — so re-claiming cannot mean two workers at once.
   *
   * Terminal states are not claimable, which is what stops a completed
   * deletion from being run a second time.
   */
  async claimForProcessing(id: string) {
    const { count } =
      await this._metaDeletionRequest.model.metaDeletionRequest.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: { status: 'PROCESSING', attempts: { increment: 1 } },
      });

    return count === 1;
  }

  /**
   * Record which integrations this request resolved to, before any of them are
   * scrubbed. Scrubbing clears rootInternalId, so without this a retry could
   * not re-derive the set and would settle as UNMATCHED.
   */
  recordMatchedTargets(
    id: string,
    targets: { id: string; organizationId: string }[]
  ) {
    return this._metaDeletionRequest.model.metaDeletionRequest.update({
      where: { id },
      data: {
        matchedTargets: JSON.stringify(targets),
        matchedCount: targets.length,
      },
    });
  }

  /**
   * Requests still open past a grace period.
   *
   * These are the ones at risk of being stranded: the row is written before the
   * workflow is started, so a crash, a Temporal outage or a failed enqueue in
   * between leaves a request nothing will ever pick up.
   */
  findStranded(olderThan: Date, limit = 100) {
    return this._metaDeletionRequest.model.metaDeletionRequest.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        createdAt: { lt: olderThan },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  markCompleted(id: string, matchedCount: number) {
    return this._metaDeletionRequest.model.metaDeletionRequest.update({
      where: { id },
      data: {
        status: matchedCount > 0 ? 'COMPLETED' : 'UNMATCHED',
        matchedCount,
        failureReason: null,
        completedAt: new Date(),
      },
    });
  }

  /** `reason` is operator-facing only and is never rendered publicly. */
  markFailed(id: string, reason: string) {
    return this._metaDeletionRequest.model.metaDeletionRequest.update({
      where: { id },
      data: {
        status: 'FAILED',
        // Bound it: the reason is an upstream error string we do not control.
        failureReason: reason.slice(0, 500),
      },
    });
  }
}
