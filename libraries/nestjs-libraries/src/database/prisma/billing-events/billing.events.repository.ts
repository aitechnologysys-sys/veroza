import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BillingEventType } from '@prisma/client';

export interface RecordBillingEvent {
  organizationId: string;
  type: BillingEventType;
  provider?: string;
  reference?: string | null;
  actorUserId?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  payload?: any;
}

export interface ListBillingEventsParams {
  page?: number;
  limit?: number;
  type?: BillingEventType;
}

@Injectable()
export class BillingEventsRepository {
  constructor(private _billingEvent: PrismaRepository<'billingEvent'>) {}

  create(event: RecordBillingEvent) {
    return this._billingEvent.model.billingEvent.create({
      data: {
        organizationId: event.organizationId,
        type: event.type,
        provider: event.provider || process.env.BILLING_PROVIDER || 'stripe',
        reference: event.reference || null,
        actorUserId: event.actorUserId || null,
        amount: typeof event.amount === 'number' ? event.amount : null,
        currency: event.currency || null,
        description: event.description || null,
        payload: JSON.stringify(event.payload ?? {}),
      },
    });
  }

  async list(organizationId: string, params: ListBillingEventsParams) {
    const page = Math.max(0, params.page || 0);
    const limit = Math.min(Math.max(1, params.limit || 50), 200);
    const skip = page * limit;
    const where = {
      organizationId,
      ...(params.type ? { type: params.type } : {}),
    };

    const [items, total] = await Promise.all([
      this._billingEvent.model.billingEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this._billingEvent.model.billingEvent.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      hasMore: skip + items.length < total,
    };
  }
}
