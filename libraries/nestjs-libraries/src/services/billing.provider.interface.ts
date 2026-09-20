import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';

export interface CheckoutResult {
  client_secret?: string;
  url?: string;
  auto_apply_coupon?: string;
}

export interface SubscribeResult {
  url?: string;
  portal?: string;
  id?: string;
}

export interface IBillingProvider {
  checkSubscription(
    organizationId: string,
    subscriptionId: string
  ): Promise<number>;

  checkDiscount(paymentId: string): Promise<boolean>;
  applyDiscount(paymentId: string): Promise<boolean>;
  finishTrial(paymentId: string): Promise<any>;

  embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<CheckoutResult>;

  subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<SubscribeResult>;

  getCustomerByOrganizationId(organizationId: string): Promise<string | null>;
  createBillingPortalLink(customerId: string): Promise<{ url: string }>;
  setToCancel(
    organizationId: string
  ): Promise<{ id: string; cancel_at?: Date }>;
  prorate(
    organizationId: string,
    body: BillingSubscribeDto
  ): Promise<{ price: number }>;
  lifetimeDeal(
    organizationId: string,
    code: string
  ): Promise<{ success: boolean }>;
  getCharges(organizationId: string): Promise<any[]>;
  // actorUserId identifies the admin who approved the refund / cancellation; it
  // is recorded on the BillingEvent so every manual money decision has a name
  // attached to it.
  refundCharges(
    organizationId: string,
    chargeIds: string[],
    actorUserId?: string
  ): Promise<{ refunded: string[]; failed: string[] }>;
  cancelSubscription(
    organizationId: string,
    actorUserId?: string
  ): Promise<{ cancelled: boolean }>;
}
