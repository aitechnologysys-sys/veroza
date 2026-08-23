/**
 * Founding-100 launch promo terms.
 *
 * Single source of truth for the numbers — imported by the backend and, like
 * pricing.ts, directly by the frontend. Never hardcode these into a component.
 *
 * Changing FOUNDING_DISCOUNT after launch creates a *new* Stripe coupon rather
 * than editing the existing one (Stripe coupons are immutable), so customers who
 * already claimed a slot stay on their original rate.
 *
 * See implementation-docs/founding-100-promo.md.
 */

export type FoundingPeriod = 'MONTHLY' | 'YEARLY';

export const FOUNDING_TOTAL_SLOTS = 100;

export const FOUNDING_DISCOUNT: Record<FoundingPeriod, number> = {
  MONTHLY: 24,
  YEARLY: 52,
};

export interface FoundingPromoStatus {
  active: boolean;
  slotsTotal: number;
  slotsClaimed: number;
  slotsRemaining: number;
  discount: Record<FoundingPeriod, number>;
}

export const foundingPrice = (price: number, period: FoundingPeriod) =>
  Math.round(price * (100 - FOUNDING_DISCOUNT[period])) / 100;
