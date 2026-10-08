import Stripe from 'stripe';
import { Injectable } from '@nestjs/common';
import { Organization, SubscriptionStatus, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { groupBy } from 'lodash';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { IBillingProvider } from '@gitroom/nestjs-libraries/services/billing.provider.interface';
import { BillingEventsService } from '@gitroom/nestjs-libraries/database/prisma/billing-events/billing.events.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

// Pinned explicitly rather than inheriting whatever the installed stripe-node
// happens to pin. The Stripe webhook endpoint must be configured with this same
// version — event payload shapes are version-dependent, and a mismatch fails
// silently (e.g. paymentSucceeded() reads invoice.parent.subscription_details,
// which does not exist on older versions, so it early-returns { ok: true }).
// Bumping this means bumping the webhook endpoint's API version in the Stripe
// dashboard in the same change. See docs/billing-current-state.md.
const STRIPE_API_VERSION = '2026-02-25.clover';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing', {
  apiVersion: STRIPE_API_VERSION,
});

// Money only ever flows back to a customer through refundCharges(), which is
// superadmin-only. Nothing in here — cancellation, downgrade, trial end, failed
// payment — may issue a refund on its own. When a plan change leaves the
// customer owed something, it becomes credit against the next invoice, never
// cash back to the card. See docs/billing-refund-policy.md.
// status answers one question only: what is the gateway doing with this
// subscription's money right now. Whether the customer has asked to cancel is a
// separate fact and lives in Subscription.cancelAt — a cancelled subscription is
// still ACTIVE and still fully entitled until that date, and conflating the two
// would make `status === 'ACTIVE'` cut a paid-up customer off early.
const stripeStatusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  canceled: 'EXPIRED',
  incomplete: 'FAILED',
  incomplete_expired: 'FAILED',
  // We never call pause_collection, so this is unreachable today. If pausing is
  // ever introduced it needs a state of its own rather than this approximation.
  paused: 'CANCELED',
};

const toSubscriptionStatus = (
  subscription: Pick<Stripe.Subscription, 'status'>
): SubscriptionStatus => stripeStatusMap[subscription.status] || 'ACTIVE';

@Injectable()
export class StripeService implements IBillingProvider {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    private _billingEventsService: BillingEventsService,
    private _notificationService: NotificationService
  ) {}

  private async orgIdByCustomer(customerId: string) {
    const org = await this._organizationService.getOrgByCustomerId(customerId);
    return org?.id;
  }

  private async record(
    customerId: string,
    event: Omit<
      Parameters<BillingEventsService['record']>[0],
      'organizationId' | 'provider'
    >
  ) {
    const organizationId = await this.orgIdByCustomer(customerId);
    if (!organizationId) {
      return;
    }

    await this._billingEventsService.record({
      ...event,
      organizationId,
      provider: 'stripe',
    });
  }
  validateRequest(rawBody: Buffer, signature: string, endpointSecret: string) {
    return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  }

  async checkValidCard(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    if (event.data.object.status === 'incomplete') {
      return false;
    }

    const getOrgFromCustomer =
      await this._organizationService.getOrgByCustomerId(
        event.data.object.customer as string
      );

    if (!getOrgFromCustomer?.allowTrial) {
      return true;
    }

    console.log('Checking card');

    const paymentMethods = await stripe.paymentMethods.list({
      customer: event.data.object.customer as string,
    });

    // find the last one created
    const latestMethod = paymentMethods.data.reduce(
      (prev, current) => {
        if (prev.created < current.created) {
          return current;
        }
        return prev;
      },
      { created: -100 } as Stripe.PaymentMethod
    );

    if (!latestMethod.id) {
      return false;
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 100,
        currency: 'usd',
        payment_method: latestMethod.id,
        customer: event.data.object.customer as string,
        off_session: true,
        capture_method: 'manual', // Authorize without capturing
        confirm: true, // Confirm the PaymentIntent
      });

      if (paymentIntent.status !== 'requires_capture') {
        console.error('Cant charge');
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
        return false;
      }

      await stripe.paymentIntents.cancel(paymentIntent.id as string);
      return true;
    } catch (err) {
      try {
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
      } catch (err) {
        /*dont do anything*/
      }
      return false;
    }
  }

  async createSubscription(event: Stripe.CustomerSubscriptionCreatedEvent) {
    const { uniqueId, billing, period } = event.data.object.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    try {
      const check = await this.checkValidCard(event);
      if (!check) {
        return { ok: false };
      }
    } catch (err) {
      return { ok: false };
    }

    await this.record(event.data.object.customer as string, {
      type: 'SUBSCRIPTION_CREATED',
      reference: event.data.object.id,
      description: `${billing} ${period} — ${event.data.object.status}`,
      payload: {
        status: event.data.object.status,
        billing,
        period,
        trial_end: event.data.object.trial_end,
      },
    });

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at,
      toSubscriptionStatus(event.data.object)
    );
  }
  async updateSubscription(event: Stripe.CustomerSubscriptionUpdatedEvent) {
    const { uniqueId, billing, period } = event.data.object.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    const check = await this.checkValidCard(event);
    if (!check) {
      return { ok: false };
    }

    await this.record(event.data.object.customer as string, {
      type: 'SUBSCRIPTION_UPDATED',
      reference: event.data.object.id,
      description: `${billing} ${period} — ${event.data.object.status}`,
      payload: {
        status: event.data.object.status,
        billing,
        period,
        cancel_at_period_end: event.data.object.cancel_at_period_end,
        cancel_at: event.data.object.cancel_at,
      },
    });

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at,
      toSubscriptionStatus(event.data.object)
    );
  }

  async deleteSubscription(event: Stripe.CustomerSubscriptionDeletedEvent) {
    const customer = event.data.object.customer as string;

    await this.record(customer, {
      type: 'SUBSCRIPTION_DELETED',
      reference: event.data.object.id,
      description: `Subscription ended (${event.data.object.status})`,
      payload: {
        status: event.data.object.status,
        ended_at: event.data.object.ended_at,
        cancellation_details: event.data.object.cancellation_details,
      },
    });

    // Terminal state, by why it ended: FAILED when Stripe gave up collecting,
    // CANCELED when someone deliberately ended it, EXPIRED when the period
    // simply ran out. None of the three refunds anything.
    const reason = event.data.object.cancellation_details?.reason;
    const terminalStatus: SubscriptionStatus =
      event.data.object.status === 'unpaid' ||
      event.data.object.status === 'incomplete_expired' ||
      reason === 'payment_failed'
        ? 'FAILED'
        : reason === 'cancellation_requested'
        ? 'CANCELED'
        : 'EXPIRED';

    await this._subscriptionService.deleteSubscription(customer, terminalStatus);
  }

  /**
   * A renewal charge failed. Stripe keeps retrying on its own dunning schedule;
   * our job is to reflect PAST_DUE in our own state, leave a record, and tell the
   * customer. No money moves here in either direction.
   */
  async paymentFailed(event: Stripe.InvoicePaymentFailedEvent) {
    const invoice = event.data.object;
    const customer =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customer) {
      return { ok: true };
    }

    const organizationId = await this.orgIdByCustomer(customer);
    if (!organizationId) {
      return { ok: true };
    }

    await this._billingEventsService.record({
      organizationId,
      provider: 'stripe',
      type: 'PAYMENT_FAILED',
      reference: invoice.id,
      amount: invoice.amount_due,
      currency: invoice.currency,
      description: 'Renewal payment failed',
      payload: {
        attempt_count: invoice.attempt_count,
        next_payment_attempt: invoice.next_payment_attempt,
        billing_reason: invoice.billing_reason,
        hosted_invoice_url: invoice.hosted_invoice_url,
      },
    });

    await this._subscriptionService.setSubscriptionStatus(customer, 'PAST_DUE');

    try {
      await this._notificationService.inAppNotification(
        organizationId,
        'Payment failed',
        `We couldn't process your latest payment. Please update your payment method to keep your subscription active.${
          invoice.hosted_invoice_url
            ? ` You can pay the open invoice here: ${invoice.hosted_invoice_url}`
            : ''
        }`,
        true,
        false,
        'info'
      );
    } catch (err) {
      console.error('Failed to notify org about failed payment', err);
    }

    return { ok: true };
  }

  async disputeCreated(event: Stripe.ChargeDisputeCreatedEvent) {
    const dispute = event.data.object;
    await this.recordDispute(dispute, 'DISPUTE_CREATED');
    return { ok: true };
  }

  async disputeClosed(event: Stripe.ChargeDisputeClosedEvent) {
    const dispute = event.data.object;
    await this.recordDispute(dispute, 'DISPUTE_CLOSED');
    return { ok: true };
  }

  private async recordDispute(
    dispute: Stripe.Dispute,
    type: 'DISPUTE_CREATED' | 'DISPUTE_CLOSED'
  ) {
    const chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;

    let customer: string | undefined;
    try {
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        customer =
          typeof charge.customer === 'string'
            ? charge.customer
            : charge.customer?.id;
      }
    } catch (err) {
      console.error('Could not resolve customer for dispute', dispute.id, err);
    }

    if (!customer) {
      return;
    }

    await this.record(customer, {
      type,
      reference: dispute.id,
      amount: dispute.amount,
      currency: dispute.currency,
      description: `Dispute ${dispute.status} (${dispute.reason})`,
      payload: {
        charge: chargeId,
        status: dispute.status,
        reason: dispute.reason,
        evidence_due_by: dispute.evidence_details?.due_by,
      },
    });
  }

  async createOrGetCustomer(organization: Organization) {
    if (organization.paymentId) {
      return organization.paymentId;
    }

    const users = await this._organizationService.getTeam(organization.id);
    const customer = await stripe.customers.create({
      email:
        users.users[0].user.email.indexOf('@') > -1
          ? users.users[0].user.email
          : `${users.users[0].user.email}@postiz.com`,
      name: organization.name,
    });
    await this._subscriptionService.updateCustomerId(
      organization.id,
      customer.id
    );
    return customer.id;
  }

  async getPackages() {
    // returning empty to test
    return {};
    const products = await stripe.prices.list({
      active: true,
      expand: ['data.tiers', 'data.product'],
      lookup_keys: [
        'standard_monthly',
        'standard_yearly',
        'pro_monthly',
        'pro_yearly',
      ],
    });

    const productsList = groupBy(
      products.data.map((p) => ({
        name: (p.product as Stripe.Product)?.name,
        recurring: p?.recurring?.interval!,
        price: p?.tiers?.[0]?.unit_amount! / 100,
      })),
      'recurring'
    );

    return { ...productsList };
  }

  async prorate(organizationId: string, body: BillingSubscribeDto) {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const priceData = pricing[body.billing];
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.nickname === body.billing + ' ' + body.period &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const proration_date = Math.floor(Date.now() / 1000);

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      const price = await stripe.invoices.createPreview({
        customer,
        subscription: currentUserSubscription?.data?.[0]?.id,
        subscription_details: {
          proration_behavior: 'create_prorations',
          billing_cycle_anchor: 'now',
          items: [
            {
              id: currentUserSubscription?.data?.[0]?.items?.data?.[0]?.id,
              price: findPrice?.id!,
              quantity: 1,
            },
          ],
          proration_date: proration_date,
        },
      });

      return {
        price: price?.amount_remaining ? price?.amount_remaining / 100 : 0,
      };
    } catch (err) {
      return { price: 0 };
    }
  }

  async getCustomerSubscriptions(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customer = org.paymentId;
    return stripe.subscriptions.list({
      customer: customer!,
      status: 'all',
    });
  }

  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.latest_invoice'],
        })
      ).data.filter((f) => f.status !== 'canceled'),
    };

    const sub = currentUserSubscription.data[0];

    // If the user is toggling back (un-cancelling), just remove the cancel
    if (sub.cancel_at_period_end) {
      const { cancel_at } = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: false,
        metadata: { service: 'postaryx', id },
      });

      await this._billingEventsService.record({
        organizationId,
        provider: 'stripe',
        type: 'SUBSCRIPTION_CANCEL_REVERTED',
        reference: sub.id,
        description: 'Scheduled cancellation removed',
      });

      return {
        id,
        cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
      };
    }

    // Check if the latest invoice has a failed payment
    const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      sub.status === 'past_due' ||
      latestInvoice?.status === 'open' ||
      latestInvoice?.status === 'uncollectible';

    if (hasFailedPayment) {
      // Payment already failed, so there is no paid period left to honour —
      // cancel immediately. Note the deliberate absence of `prorate: true`:
      // cancelling never returns money, it only stops future charges.
      await stripe.subscriptions.cancel(sub.id);
      await this._subscriptionService.deleteSubscription(customer, 'FAILED');

      await this._billingEventsService.record({
        organizationId,
        provider: 'stripe',
        type: 'SUBSCRIPTION_CANCELED_IMMEDIATELY',
        reference: sub.id,
        description:
          'Cancelled immediately — the latest invoice was unpaid. No refund issued.',
        payload: { status: sub.status, latest_invoice: latestInvoice?.id },
      });

      return {
        id,
        cancel_at: new Date(),
      };
    }

    // Payment succeeded — the customer keeps access to the end of the period
    // they already paid for, and that payment is not returned.
    const { cancel_at } = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
      metadata: { service: 'postaryx', id },
    });

    await this._billingEventsService.record({
      organizationId,
      provider: 'stripe',
      type: 'SUBSCRIPTION_CANCEL_SCHEDULED',
      reference: sub.id,
      description: 'Cancellation scheduled for the end of the billing period',
      payload: { cancel_at },
    });

    // Status deliberately untouched: the subscription is still ACTIVE and the
    // customer is still entitled until cancel_at. The cancellation is recorded
    // by cancelAt, which the customer.subscription.updated webhook writes.

    return {
      id,
      cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
    };
  }

  async getCustomerByOrganizationId(organizationId: string): Promise<string | null> {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    return org.paymentId ?? null;
  }

  /**
   * The portal configuration is pinned here rather than inherited from whatever
   * the Stripe dashboard's default happens to be. Left on the default, an
   * operator could switch portal cancellation to "immediately, with prorated
   * refund" and silently override both the access-until-period-end rule and the
   * rule that refunds are manual only. The configuration below is the policy:
   *
   *   - cancel: at period end, proration_behavior 'none' (no credit, no refund)
   *   - update: disabled, so plan changes go through our own prorated flow
   *
   * Cached per process; re-resolved on the next boot, so editing the constants
   * here and redeploying is enough to move every customer onto the new config.
   */
  private static portalConfigurationId: string | null = null;

  private async getPortalConfigurationId(): Promise<string | undefined> {
    if (StripeService.portalConfigurationId) {
      return StripeService.portalConfigurationId;
    }

    const features: Stripe.BillingPortal.ConfigurationCreateParams['features'] =
      {
        customer_update: {
          enabled: true,
          allowed_updates: ['email', 'address', 'tax_id'],
        },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        // Plan changes must go through POST /billing (prorate + subscribe) so we
        // control the proration behaviour and record a PLAN_CHANGED event.
        subscription_update: { enabled: false },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          proration_behavior: 'none',
          cancellation_reason: {
            enabled: true,
            options: [
              'too_expensive',
              'missing_features',
              'switched_service',
              'unused',
              'customer_service',
              'too_complex',
              'low_quality',
              'other',
            ],
          },
        },
      };

    try {
      const existing = await stripe.billingPortal.configurations.list({
        limit: 100,
      });

      const found = existing.data.find(
        (configuration) =>
          configuration.active &&
          configuration.metadata?.service === 'postaryx'
      );

      if (found) {
        // Keep it aligned with the policy above even if someone edited it in the
        // dashboard.
        const updated = await stripe.billingPortal.configurations.update(
          found.id,
          { features }
        );
        StripeService.portalConfigurationId = updated.id;
        return updated.id;
      }

      const created = await stripe.billingPortal.configurations.create({
        features,
        metadata: { service: 'postaryx' },
        ...(process.env.NEXT_PUBLIC_POLICIES_URL ||
        process.env.NEXT_PUBLIC_TERMS_URL
          ? {
              business_profile: {
                ...(process.env.NEXT_PUBLIC_POLICIES_URL
                  ? { privacy_policy_url: process.env.NEXT_PUBLIC_POLICIES_URL }
                  : {}),
                ...(process.env.NEXT_PUBLIC_TERMS_URL
                  ? {
                      terms_of_service_url: process.env.NEXT_PUBLIC_TERMS_URL,
                    }
                  : {}),
              },
            }
          : {}),
      });

      StripeService.portalConfigurationId = created.id;
      return created.id;
    } catch (err) {
      // Never block a customer from reaching the portal because we could not
      // reconcile the configuration — but make the fallback loud, because the
      // dashboard default is exactly the state this method exists to avoid.
      console.error(
        'Could not resolve the Postaryx billing portal configuration; ' +
          'falling back to the Stripe dashboard default. Verify that its ' +
          'cancellation mode is "at period end" with no proration.',
        err
      );
      return undefined;
    }
  }

  async createBillingPortalLink(customer: string) {
    const configuration = await this.getPortalConfigurationId();

    return stripe.billingPortal.sessions.create({
      customer,
      return_url: process.env['FRONTEND_URL'] + '/billing',
      ...(configuration ? { configuration } : {}),
    });
  }

  /**
   * Find an active promotion code with autoapply: true metadata
   * Only returns codes that are active and not expired
   * Returns the promotion code string (not the ID) for frontend auto-apply
   */
  private async findAutoApplyPromotionCode(): Promise<string | null> {
    try {
      const promotionCodes = await stripe.promotionCodes.list({
        active: true,
        limit: 100,
      });

      const now = Math.floor(Date.now() / 1000);

      for (const promoCode of promotionCodes.data) {
        const coupon =
          typeof promoCode.promotion.coupon === 'string'
            ? null
            : promoCode.promotion.coupon;

        // Check if it has autoapply metadata set to true (check both promo and coupon metadata)
        const autoApply = Object.assign(
          {},
          promoCode.metadata,
          coupon?.metadata
        )?.autoapply;
        if (autoApply !== 'true') continue;

        // Check if the promotion code has expired
        if (promoCode.expires_at && promoCode.expires_at < now) continue;

        // Check if the coupon has expired (redeem_by)
        if (coupon?.redeem_by && coupon.redeem_by < now) continue;

        // Check if max redemptions reached
        if (
          promoCode.max_redemptions &&
          promoCode.times_redeemed >= promoCode.max_redemptions
        )
          continue;

        // Found a valid auto-apply promotion code - return the code string for frontend
        return promoCode.code;
      }

      return null;
    } catch (err) {
      console.error('Error finding auto-apply promotion code:', err);
      return null;
    }
  }

  private async createEmbeddedCheckout(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const user = await this._userService.getUserById(userId);

    try {
      await stripe.customers.update(customer, {
        email:
          user.email.indexOf('@') > -1
            ? user.email
            : `${user.email}@postiz.com`,
        ...(body.dub
          ? {
              metadata: {
                dubCustomerExternalId: userId,
                dubClickId: body.dub,
              },
            }
          : {}),
      });
    } catch (err) {}

    // Check for auto-apply promotion code (only for monthly plans)
    let autoApplyPromoCode: string | null = null;
    if (body.period === 'MONTHLY') {
      autoApplyPromoCode = await this.findAutoApplyPromotionCode();
    }

    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';
    const { client_secret } = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      customer,
      return_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 7 } : {}),
        metadata: {
          service: 'postaryx',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      ...(body.datafast_session_id && body.datafast_visitor_id
        ? {
            metadata: {
              datafast_visitor_id: body.datafast_visitor_id,
              datafast_session_id: body.datafast_session_id,
            },
          }
        : {}),
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    // Return auto-apply promo code for frontend to apply
    return {
      client_secret,
      ...(autoApplyPromoCode ? { auto_apply_coupon: autoApplyPromoCode } : {}),
    };
  }

  private async createCheckoutSession(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';

    if (body.dub) {
      await stripe.customers.update(customer, {
        metadata: {
          dubCustomerExternalId: userId,
          dubClickId: body.dub,
        },
      });
    }

    const { url } = await stripe.checkout.sessions.create({
      customer,
      cancel_url: process.env['FRONTEND_URL'] + `/billing?cancel=true${isUtm}`,
      success_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 7 } : {}),
        metadata: {
          service: 'postaryx',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    return { url };
  }

  async finishTrial(paymentId: string) {
    const list = (
      await stripe.subscriptions.list({
        customer: paymentId,
      })
    ).data.filter((f) => f.status === 'trialing');

    const updated = await stripe.subscriptions.update(list[0].id, {
      trial_end: 'now',
    });

    // Ending a trial early charges the card immediately and that charge is final
    // — the UI says so before the customer confirms, and this is the record of it.
    await this.record(paymentId, {
      type: 'TRIAL_FINISHED',
      reference: updated.id,
      description: 'Trial ended early at the customer\'s request — charged now',
    });

    return updated;
  }

  async checkDiscount(customer: string) {
    if (!process.env.STRIPE_DISCOUNT_ID) {
      return false;
    }

    const list = await stripe.charges.list({
      customer,
      limit: 1,
    });

    if (!list.data.filter((f) => f.amount > 1000).length) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    if (!currentUserSubscription) {
      return false;
    }

    if (
      currentUserSubscription.data?.items.data[0]?.price.recurring?.interval ===
        'year' ||
      currentUserSubscription.data?.discounts.length
    ) {
      return false;
    }

    return true;
  }

  async applyDiscount(customer: string) {
    const check = this.checkDiscount(customer);
    if (!check) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    await stripe.subscriptions.update(currentUserSubscription.data.id, {
      discounts: [
        {
          coupon: process.env.STRIPE_DISCOUNT_ID!,
        },
      ],
    });

    return true;
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    const orgValue = await this._subscriptionService.checkSubscription(
      organizationId,
      subscriptionId
    );

    if (orgValue) {
      return 2;
    }

    const getCustomerSubscriptions = await this.getCustomerSubscriptions(
      organizationId
    );
    if (getCustomerSubscriptions.data.length === 0) {
      return 0;
    }

    if (
      getCustomerSubscriptions.data.find(
        (p) => p.metadata.uniqueId === subscriptionId
      )?.canceled_at
    ) {
      return 1;
    }

    return 0;
  }

  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    return this.createEmbeddedCheckout(
      uniqueId,
      id,
      customer,
      body,
      findPrice!.id,
      userId,
      allowTrial
    );
  }

  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const getCurrentSubscriptions =
      await this._subscriptionService.getSubscription(organizationId);

    if (!getCurrentSubscriptions) {
      return this.createCheckoutSession(
        uniqueId,
        id,
        customer,
        body,
        findPrice!.id,
        userId,
        allowTrial
      );
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    const existingSubscription = currentUserSubscription.data[0];
    const currentAmount =
      existingSubscription?.items?.data?.[0]?.price?.unit_amount ?? 0;
    const isUpgrade = (findPrice!.unit_amount ?? 0) > currentAmount;

    // Upgrades invoice the difference straight away — the customer asked for more
    // and pays for it now. Downgrades deliberately do NOT use 'always_invoice':
    // that raises an immediate negative invoice, which Stripe settles onto the
    // customer's cash balance, i.e. money sitting in an account that can later be
    // paid out. 'create_prorations' keeps the same value as a credit line on the
    // next renewal invoice instead, so a downgrade reduces what is owed next
    // period and never becomes a refund. See docs/billing-refund-policy.md.
    const prorationBehavior: Stripe.SubscriptionUpdateParams.ProrationBehavior =
      isUpgrade ? 'always_invoice' : 'create_prorations';

    try {
      await stripe.subscriptions.update(existingSubscription.id, {
        cancel_at_period_end: false,
        metadata: {
          service: 'postaryx',
          ...body,
          userId,
          id,
          ud: uniqueId,
        },
        proration_behavior: prorationBehavior,
        items: [
          {
            id: existingSubscription.items.data[0].id,
            price: findPrice!.id,
            quantity: 1,
          },
        ],
      });

      await this._billingEventsService.record({
        organizationId,
        provider: 'stripe',
        type: 'PLAN_CHANGED',
        reference: existingSubscription.id,
        actorUserId: userId,
        amount: findPrice!.unit_amount ?? null,
        currency: findPrice!.currency,
        description: `${isUpgrade ? 'Upgrade' : 'Downgrade'} to ${
          body.billing
        } ${body.period}`,
        payload: {
          from_amount: currentAmount,
          to_amount: findPrice!.unit_amount,
          proration_behavior: prorationBehavior,
          // Explicit: a downgrade credits the next invoice, it does not refund.
          refund_issued: false,
        },
      });

      return { id };
    } catch (err) {
      const { url } = await this.createBillingPortalLink(customer);
      return {
        portal: url,
      };
    }
  }

  async paymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent) {
    // get subscription from payment
    const subscriptionId =
      event.data.object.parent?.subscription_details?.subscription;
    if (!subscriptionId) {
      return { ok: true };
    }
    const subscription = await stripe.subscriptions.retrieve(
      typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
    );

    const { userId, ud } = subscription.metadata;
    const user = await this._userService.getUserById(userId);
    if (user && user.ip && user.agent) {
      this._trackService.track(ud, user.ip, user.agent, TrackEnum.Purchase, {
        value: event.data.object.amount_paid / 100,
      });
    }

    const customer =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    if (customer) {
      await this.record(customer, {
        type: 'PAYMENT_SUCCEEDED',
        reference: event.data.object.id,
        amount: event.data.object.amount_paid,
        currency: event.data.object.currency,
        description: 'Invoice paid',
        payload: {
          billing_reason: event.data.object.billing_reason,
          subscription: subscription.id,
          invoice_pdf: event.data.object.invoice_pdf,
        },
      });

      // Clears a PAST_DUE left by an earlier failed attempt.
      await this._subscriptionService.setSubscriptionStatus(
        customer,
        toSubscriptionStatus(subscription)
      );
    }

    return { ok: true };
  }

  async getCharges(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return [];
    }

    const charges = await stripe.charges.list({
      customer: org.paymentId,
      limit: 100,
    });

    const chargeList = charges.data
      .filter((f) => f.status === 'succeeded')
      .map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        created: charge.created,
        status: charge.status,
        refunded: charge.refunded,
        amount_refunded: charge.amount_refunded,
        description: charge.description,
        receipt_url: charge.receipt_url || null,
        invoice: (charge as any).invoice || null,
      }));

    const invoiceIds = chargeList
      .map((c) => c.invoice)
      .filter((id): id is string => !!id && typeof id === 'string');

    const invoicePdfMap: Record<string, string> = {};
    for (const invoiceId of invoiceIds) {
      try {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.invoice_pdf) {
          invoicePdfMap[invoiceId] = inv.invoice_pdf;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    return chargeList.map((charge) => ({
      ...charge,
      invoice_pdf:
        charge.invoice && invoicePdfMap[charge.invoice as string]
          ? invoicePdfMap[charge.invoice as string]
          : null,
    }));
  }

  /**
   * The only path in the product that returns money to a customer. Reachable
   * solely from POST /billing/refund-charges, which is superadmin-gated — every
   * refund is a deliberate manual act and is recorded as one.
   */
  async refundCharges(
    organizationId: string,
    chargeIds: string[],
    actorUserId?: string
  ) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const refunded: string[] = [];
    const failed: string[] = [];

    for (const chargeId of chargeIds) {
      try {
        const refund = await stripe.refunds.create({ charge: chargeId });
        refunded.push(chargeId);

        await this._billingEventsService.record({
          organizationId,
          provider: 'stripe',
          type: 'REFUND_ISSUED',
          reference: refund.id,
          actorUserId,
          amount: refund.amount,
          currency: refund.currency,
          description: `Manual refund of charge ${chargeId}`,
          payload: { charge: chargeId, status: refund.status },
        });
      } catch (err) {
        failed.push(chargeId);

        await this._billingEventsService.record({
          organizationId,
          provider: 'stripe',
          type: 'REFUND_FAILED',
          reference: chargeId,
          actorUserId,
          description: `Refund of charge ${chargeId} failed`,
          payload: { error: (err as Error)?.message },
        });
      }
    }

    return { refunded, failed };
  }

  async cancelSubscription(organizationId: string, actorUserId?: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const customer = org.paymentId;

    const subscriptions = (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
      })
    ).data.filter((f) => f.status !== 'canceled');

    if (!subscriptions.length) {
      throw new Error('No active subscription found');
    }

    // No `prorate: true` — an admin cancellation stops the subscription, it does
    // not return money. Refunds go through refundCharges() as a separate,
    // explicitly recorded decision.
    await stripe.subscriptions.cancel(subscriptions[0].id);
    await this._subscriptionService.deleteSubscription(customer, 'CANCELED');

    await this._billingEventsService.record({
      organizationId,
      provider: 'stripe',
      type: 'SUBSCRIPTION_CANCELED_IMMEDIATELY',
      reference: subscriptions[0].id,
      actorUserId,
      description: 'Cancelled immediately by an admin. No refund issued.',
    });

    return { cancelled: true };
  }

  async lifetimeDeal(organizationId: string, code: string) {
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
        return {
          success: false,
        };
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
        'ACTIVE',
        testCode,
        organizationId
      );

      await this._billingEventsService.record({
        organizationId,
        provider: 'stripe',
        type: 'LIFETIME_REDEEMED',
        description: `Lifetime code redeemed — ${nextPackage}`,
      });

      return {
        success: true,
      };
    } catch (err) {
      console.log(err);
      return {
        success: false,
      };
    }
  }
}
