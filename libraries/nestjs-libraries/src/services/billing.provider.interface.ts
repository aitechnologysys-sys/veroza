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
  refundCharges(
    organizationId: string,
    chargeIds: string[]
  ): Promise<{ refunded: string[]; failed: string[] }>;
  cancelSubscription(organizationId: string): Promise<{ cancelled: boolean }>;
}
