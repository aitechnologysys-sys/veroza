import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import axios from 'axios';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import {
  IBillingProvider,
  CheckoutResult,
  SubscribeResult,
} from '@gitroom/nestjs-libraries/services/billing.provider.interface';

// Polar REST API base URL — set POLAR_SERVER=sandbox in .env for sandbox mode
const POLAR_BASE =
  process.env.POLAR_SERVER === 'sandbox'
    ? 'https://sandbox-api.polar.sh'
    : 'https://api.polar.sh';

@Injectable()
export class PolarService implements IBillingProvider {
  private readonly http = axios.create({
    baseURL: POLAR_BASE,
    headers: {
      Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  private readonly productIdByPriceId = new Map<string, string>();

  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService
  ) {}

  // ─── Webhook ────────────────────────────────────────────────────────────────

  validateWebhook(rawBody: Buffer, headers: Record<string, string>): any {
    const msgId = headers['webhook-id'];
    const msgTimestamp = headers['webhook-timestamp'];
    const msgSignatures = headers['webhook-signature'];

    if (!msgId || !msgTimestamp || !msgSignatures) {
      throw new Error('Missing Polar webhook headers');
    }

    const timestampMs = parseInt(msgTimestamp, 10) * 1000;
    if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      throw new Error('Polar webhook timestamp is too old');
    }

    // Polar base64-encodes the configured secret and hands it to the
    // standardwebhooks lib, which base64-decodes it again — the two cancel out.
    // The effective HMAC key is therefore the raw secret string as UTF-8 bytes
    // (whole string, including any "polar_whs_"/"whsec_" prefix, no decoding).
    const secretBytes = process.env.POLAR_WEBHOOK_SECRET!;

    const signedContent = `${msgId}.${msgTimestamp}.${rawBody.toString(
      'utf8'
    )}`;
    const expectedSig = createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    // webhook-signature is a space-separated list of "v1,<base64sig>" entries
    const signatures = msgSignatures
      .split(' ')
      .map((s: string) => s.split(',').slice(1).join(','))
      .filter(Boolean);

    if (!signatures.some((sig: string) => sig === expectedSig)) {
      throw new Error('Invalid Polar webhook signature');
    }

    return JSON.parse(rawBody.toString('utf8'));
  }

  async handleSubscriptionCreated(event: any) {
    return this._handleSubscriptionUpsert(event);
  }

  async handleSubscriptionUpdated(event: any) {
    return this._handleSubscriptionUpsert(event);
  }

  async handleSubscriptionDeleted(event: any) {
    const customerId = event.data?.customer_id;
    if (!customerId) return { ok: true };
    await this._subscriptionService.deleteSubscription(customerId);
    return { ok: true };
  }

  async handlePaymentSucceeded(event: any) {
    const subscriptionId = event.data?.subscription_id;
    if (!subscriptionId) return { ok: true };

    try {
      const { data: sub } = await this.http.get(
        `/v1/subscriptions/${subscriptionId}`
      );
      const { userId, ud } = sub.metadata || {};
      if (!userId) return { ok: true };

      const user = await this._userService.getUserById(userId);
      if (user?.ip && user?.agent) {
        const amount = event.data?.amount ?? 0;
        this._trackService.track(ud, user.ip, user.agent, TrackEnum.Purchase, {
          value: amount / 100,
        });
      }
    } catch {
      // don't fail the webhook if tracking fails
    }

    return { ok: true };
  }

  private async _handleSubscriptionUpsert(event: any) {
    const sub = event.data;
    const customerId: string = sub?.customer_id;
    const metadata = sub?.metadata || {};
    const { billing, period, uniqueId } = metadata as {
      billing: 'STANDARD' | 'PRO' | 'TEAM' | 'ULTIMATE';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    if (!billing || !period || !uniqueId || !customerId) {
      return { ok: false };
    }

    const isActive = sub?.status === 'active' || sub?.status === 'trialing';
    const cancelAtTimestamp = sub?.current_period_end
      ? sub.cancel_at_period_end
        ? Math.floor(new Date(sub.current_period_end).getTime() / 1000)
        : null
      : null;

    return this._subscriptionService.createOrUpdateSubscription(
      !isActive,
      uniqueId,
      customerId,
      pricing[billing].channel!,
      billing,
      period,
      cancelAtTimestamp
    );
  }

  // ─── Customer ────────────────────────────────────────────────────────────────

  async createOrGetCustomer(organization: Organization): Promise<string> {
    if (organization.paymentId) {
      return organization.paymentId;
    }

    const users = await this._organizationService.getTeam(organization.id);
    const email = users.users[0].user.email.includes('@')
      ? users.users[0].user.email
      : `${users.users[0].user.email}@postiz.com`;

    // Check if customer already exists in Polar by external_id.
    // Use the dedicated external-id endpoint (returns the single customer or
    // 404). The list endpoint ignores an unknown `external_id` filter and
    // returns ALL customers, so items[0] would wrongly match the oldest one.
    const existing = await this.http
      .get(`/v1/customers/external/${organization.id}`)
      .then((r) => r.data ?? null)
      .catch((): null => null);

    const customerId = existing
      ? existing.id
      : (
          await this.http.post('/v1/customers', {
            email,
            name: organization.name,
            external_id: organization.id,
          })
        ).data.id;

    await this._subscriptionService.updateCustomerId(
      organization.id,
      customerId
    );
    return customerId;
  }

  // ─── Checkout ────────────────────────────────────────────────────────────────

  private getConfiguredProductId(
    billing: string,
    period: 'MONTHLY' | 'YEARLY'
  ): string {
    const productKey = `POLAR_PRODUCT_${billing}_${period}`;
    const priceKey = `POLAR_PRICE_${billing}_${period}`;
    const id = process.env[productKey] || process.env[priceKey];
    if (!id) throw new Error(`Missing env var: ${productKey} or ${priceKey}`);
    return id;
  }

  private async getProductId(
    billing: string,
    period: 'MONTHLY' | 'YEARLY'
  ): Promise<string> {
    const configuredId = this.getConfiguredProductId(billing, period);
    const productKey = `POLAR_PRODUCT_${billing}_${period}`;

    if (process.env[productKey]) {
      return configuredId;
    }

    if (this.productIdByPriceId.has(configuredId)) {
      return this.productIdByPriceId.get(configuredId)!;
    }

    const { data } = await this.http.get('/v1/products', {
      params: { limit: 100 },
    });

    const product = (data?.items ?? []).find((item: any) =>
      (item?.prices ?? []).some(
        (price: any) =>
          price.id === configuredId || price.product_id === configuredId
      )
    );

    if (!product?.id) {
      throw new Error(
        `Could not find a Polar product for price id ${configuredId}. Set ${productKey} to the product id.`
      );
    }

    this.productIdByPriceId.set(configuredId, product.id);
    return product.id;
  }

  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<CheckoutResult> {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customerId = await this.createOrGetCustomer(org);
    const id = makeId(10);
    const productId = await this.getProductId(body.billing, body.period);

    const payload: Record<string, any> = {
      products: [productId],
      customer_id: customerId,
      success_url:
        process.env['FRONTEND_URL'] + `/launches?onboarding=true&check=${id}`,
      allow_discount_codes: body.period === 'MONTHLY',
      metadata: {
        service: 'postiz',
        billing: body.billing,
        period: body.period,
        userId,
        uniqueId: id,
        ud: uniqueId,
      },
    };

    if (allowTrial) {
      payload['trial_interval'] = 'day';
      payload['trial_interval_count'] = 7;
    } else {
      payload['allow_trial'] = false;
    }

    const { data } = await this.http.post('/v1/checkouts', payload);
    return { url: data.url };
  }

  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<SubscribeResult> {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customerId = await this.createOrGetCustomer(org);
    const currentSub = await this._subscriptionService.getSubscription(
      organizationId
    );

    if (!currentSub) {
      // New subscriber — create a checkout session and redirect
      const result = await this.embedded(
        uniqueId,
        organizationId,
        userId,
        body,
        allowTrial
      );
      return { url: result.url };
    }

    // Existing subscriber upgrading — cancel old subscription and create new checkout
    try {
      const activeSubs = await this._getActiveSubscriptions(customerId);
      if (activeSubs.length > 0) {
        await this.http.delete(`/v1/subscriptions/${activeSubs[0].id}`);
      }
    } catch {
      // If we can't cancel the old one, proceed anyway
    }

    const result = await this.embedded(
      uniqueId,
      organizationId,
      userId,
      body,
      false // no trial on upgrades
    );
    return { url: result.url };
  }

  // ─── Subscription management ─────────────────────────────────────────────────

  private async _getActiveSubscriptions(customerId: string) {
    const { data } = await this.http.get('/v1/subscriptions', {
      params: { customer_id: customerId, status: 'active' },
    });
    return data?.items ?? [];
  }

  async setToCancel(
    organizationId: string
  ): Promise<{ id: string; cancel_at?: Date }> {
    const id = makeId(10);
    const org = (await this._organizationService.getOrgById(organizationId))!;
    if (!org.paymentId) {
      return { id };
    }

    const activeSubs = await this._getActiveSubscriptions(org.paymentId);
    if (!activeSubs.length) return { id };

    const sub = activeSubs[0];

    if (sub.cancel_at_period_end) {
      // Toggle: un-cancel
      await this.http.patch(`/v1/subscriptions/${sub.id}`, {
        cancel_at_period_end: false,
      });
      return { id, cancel_at: undefined };
    }

    await this.http.patch(`/v1/subscriptions/${sub.id}`, {
      cancel_at_period_end: true,
    });

    const cancelAt = sub.current_period_end
      ? new Date(sub.current_period_end)
      : undefined;

    return { id, cancel_at: cancelAt };
  }

  async cancelSubscription(
    organizationId: string
  ): Promise<{ cancelled: boolean }> {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    if (!org.paymentId) throw new Error('No payment customer found');

    const activeSubs = await this._getActiveSubscriptions(org.paymentId);
    if (!activeSubs.length) throw new Error('No active subscription found');

    await this.http.delete(`/v1/subscriptions/${activeSubs[0].id}`);
    await this._subscriptionService.deleteSubscription(org.paymentId);

    return { cancelled: true };
  }

  async finishTrial(paymentId: string): Promise<any> {
    // Polar does not expose an API to end a trial early.
    // The trial will expire naturally on the trial_end date.
    // If needed in the future, cancel and recreate the subscription without a trial.
    return { ok: true };
  }

  // ─── Portal ──────────────────────────────────────────────────────────────────

  async createBillingPortalLink(customerId: string): Promise<{ url: string }> {
    const { data } = await this.http.post('/v1/customer-sessions', {
      customer_id: customerId,
    });
    return { url: data.customer_portal_url };
  }

  // ─── Discounts / proration ───────────────────────────────────────────────────

  async checkDiscount(_paymentId: string): Promise<boolean> {
    return false;
  }

  async applyDiscount(_paymentId: string): Promise<boolean> {
    return false;
  }

  async prorate(
    _organizationId: string,
    _body: BillingSubscribeDto
  ): Promise<{ price: number }> {
    return { price: 0 };
  }

  // ─── Charges / refunds ───────────────────────────────────────────────────────

  async getCharges(organizationId: string): Promise<any[]> {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) return [];

    const { data } = await this.http.get('/v1/orders', {
      params: { customer_id: org.paymentId, limit: 100 },
    });

    return (data?.items ?? []).map(
      (order: any): Record<string, any> => ({
        id: order.id,
        amount: order.amount,
        currency: order.currency ?? 'usd',
        created: order.created_at
          ? Math.floor(new Date(order.created_at).getTime() / 1000)
          : 0,
        status: order.status ?? 'succeeded',
        refunded: false,
        amount_refunded: 0,
        description: order.product?.name ?? null,
        receiptUrl: null,
        invoicePdfUrl: null,
      })
    );
  }

  async refundCharges(
    organizationId: string,
    chargeIds: string[]
  ): Promise<{ refunded: string[]; failed: string[] }> {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) throw new Error('No payment customer found');

    const refunded: string[] = [];
    const failed: string[] = [];

    for (const orderId of chargeIds) {
      try {
        await this.http.post('/v1/refunds', {
          order_id: orderId,
          reason: 'other',
        });
        refunded.push(orderId);
      } catch {
        failed.push(orderId);
      }
    }

    return { refunded, failed };
  }

  // ─── Subscription check ──────────────────────────────────────────────────────

  async checkSubscription(
    organizationId: string,
    subscriptionId: string
  ): Promise<number> {
    const dbSub = await this._subscriptionService.checkSubscription(
      organizationId,
      subscriptionId
    );
    if (dbSub) return 2;

    // Check Polar in case webhook hasn't arrived yet
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) return 0;

    try {
      const { data } = await this.http.get('/v1/subscriptions', {
        params: { customer_id: org.paymentId, status: 'all' },
      });
      const match = (data?.items ?? []).find(
        (s: any) => s.metadata?.uniqueId === subscriptionId
      );
      if (!match) return 0;
      return match.status === 'canceled' ? 1 : 0;
    } catch {
      return 0;
    }
  }

  // ─── Lifetime deal ───────────────────────────────────────────────────────────

  async lifetimeDeal(
    organizationId: string,
    code: string
  ): Promise<{ success: boolean }> {
    const getCurrentSubscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    if (getCurrentSubscription && !getCurrentSubscription?.isLifetime) {
      throw new Error('You already have a non lifetime subscription');
    }

    try {
      const testCode = AuthService.fixedDecryption(code);
      const findCode = await this._subscriptionService.getCode(testCode);
      if (findCode) {
        return { success: false };
      }

      const nextPackage = !getCurrentSubscription ? 'STANDARD' : 'PRO';
      const findPricing = pricing[nextPackage];

      await this._subscriptionService.createOrUpdateSubscription(
        false,
        makeId(10),
        organizationId,
        getCurrentSubscription?.subscriptionTier === 'PRO'
          ? getCurrentSubscription.totalChannels + 5
          : findPricing.channel!,
        nextPackage,
        'MONTHLY',
        null,
        testCode,
        organizationId
      );
      return { success: true };
    } catch (err) {
      console.error(err);
      return { success: false };
    }
  }

  // ─── Customer lookup ─────────────────────────────────────────────────────────

  async getCustomerByOrganizationId(
    organizationId: string
  ): Promise<string | null> {
    const org = await this._organizationService.getOrgById(organizationId);
    return org?.paymentId ?? null;
  }
}
