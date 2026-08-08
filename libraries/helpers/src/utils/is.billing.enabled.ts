/**
 * The single source of truth for whether billing is enforced.
 *
 * When false, the deployment behaves as free / self-hosted: every org is treated
 * as ULTIMATE, channel / credit / team-member limits are not applied, permission
 * checks pass, the public API and the publisher do not require a subscription,
 * and the billing UI is hidden.
 *
 * This deliberately does NOT fall back to STRIPE_PUBLISHABLE_KEY. Upstream Postiz
 * used the presence of that key as the gate, which conflated "which payment
 * gateway is configured" with "is billing enforced". Every one of those checks now
 * routes through this flag, so the two decisions are independent.
 *
 * Which gateway handles checkout is a separate question, answered by
 * BILLING_PROVIDER. See docs/billing-current-state.md.
 */
export const isBillingEnabled = () => process.env.BILLING_ENABLED === 'true';
