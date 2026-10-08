import { Injectable } from '@nestjs/common';
import {
  BillingEventsRepository,
  ListBillingEventsParams,
  RecordBillingEvent,
} from '@gitroom/nestjs-libraries/database/prisma/billing-events/billing.events.repository';

@Injectable()
export class BillingEventsService {
  constructor(private _billingEventsRepository: BillingEventsRepository) {}

  /**
   * Append one billing event. Deliberately swallows its own failures: the audit
   * trail must never be able to fail a checkout, a cancellation or a webhook
   * acknowledgement. A dropped row is logged and moves on.
   */
  async record(event: RecordBillingEvent) {
    if (!event?.organizationId) {
      return;
    }

    try {
      await this._billingEventsRepository.create(event);
    } catch (err) {
      console.error('Failed to record billing event', event.type, err);
    }
  }

  list(organizationId: string, params: ListBillingEventsParams = {}) {
    return this._billingEventsRepository.list(organizationId, params);
  }
}
