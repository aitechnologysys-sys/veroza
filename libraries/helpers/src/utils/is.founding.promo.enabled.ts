/**
 * Whether the Founding-100 launch promo is running.
 *
 * The first 100 paying customers get 52% off yearly / 24% off monthly, forever.
 * The coupon is attached server-side at checkout — there is no code to enter.
 *
 * This is a third switch, independent of both BILLING_ENABLED (is billing
 * enforced at all) and BILLING_PROVIDER (which gateway). Like isBillingEnabled(),
 * this is the only place the env var is read — never gate promo behaviour on a
 * process.env.FOUNDING_* check elsewhere.
 *
 * Stripe only. Has no effect under BILLING_PROVIDER="polar".
 *
 * The promo also self-terminates once all 100 slots are claimed, regardless of
 * this flag. Percentages and the slot count live in founding.promo.ts.
 *
 * See implementation-docs/founding-100-promo.md.
 */
export const isFoundingPromoEnabled = () =>
  process.env.FOUNDING_PROMO_ENABLED === 'true';
