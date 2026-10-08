# Billing: refunds, cancellation and subscription state

How the code behaves. If a policy document and this file disagree, one of them is
a bug — they are meant to be checked against each other.

## The rule

**Nothing in the product refunds money on its own.** There is exactly one code
path that returns money to a customer:

```
POST /billing/refund-charges   →  IBillingProvider.refundCharges()
```

It is gated on `user.isSuperAdmin` (`apps/backend/src/api/routes/billing.controller.ts`),
driven from the admin panel, and writes a `REFUND_ISSUED` / `REFUND_FAILED`
`BillingEvent` carrying the id of the admin who approved it.

Everything else — cancellation, downgrade, trial end, failed payment, platform
outage — stops future charges at most. Nothing reverses a charge that already
settled.

## Cancellation

`setToCancel()` in `stripe.service.ts` has three branches:

| Situation | What happens | Money returned |
|---|---|---|
| Already scheduled to cancel | Un-cancels (toggle) | — |
| Latest invoice unpaid (`past_due` / `open` / `uncollectible`) | Cancels immediately, subscription marked `FAILED` | None. There is no paid period left to honour. |
| Normal, paid | `cancel_at_period_end: true`; status stays `ACTIVE`, `cancelAt` is set | None. Access continues to `cancelAt`; the period already paid for is not returned. |

`stripe.subscriptions.cancel()` is deliberately called **without** `prorate: true`
in both the immediate-cancel branch and the admin `cancelSubscription()`. Adding
that flag would make cancellation refund on its own — don't.

Cancelling does not touch the account, workspace, posts, media or connected
channels. `deleteSubscription()` downgrades the org to FREE, which disables
channels beyond the free limit and non-admin users, and stops the posting cron.
Nothing is deleted. There is no organization-deletion path in the codebase at
all; data removal is a separate, manual process.

## Plan changes

`subscribe()` on an existing subscription picks its proration behaviour from the
direction of the change:

- **Upgrade** (higher price) → `always_invoice`. The difference is charged now,
  which is what the customer just asked for.
- **Downgrade** (same or lower price) → `create_prorations`. The unused value
  becomes a credit line on the **next renewal invoice**.

The downgrade case is the one to be careful about. `always_invoice` on a
downgrade raises an immediate *negative* invoice, which Stripe settles onto the
customer's cash balance — money parked in an account that can later be paid out,
i.e. a refund by another name, created with no admin review. `create_prorations`
keeps the same value as a discount against what is owed next period and never
becomes cash.

Either way the customer is not refunded. Every plan change writes a
`PLAN_CHANGED` event recording the direction, the amounts, the proration
behaviour used, and `refund_issued: false`.

`POST /billing/prorate` is a preview only (`invoices.createPreview`) — it quotes
a number and moves nothing. It still previews with `create_prorations` and
`billing_cycle_anchor: 'now'`, so for a downgrade the quoted figure is
approximate; it is display-only.

## The Stripe billing portal

`createBillingPortalLink()` pins an explicit portal **configuration** rather than
inheriting the Stripe dashboard's default. This matters: left on the default,
anyone with dashboard access could switch portal cancellation to "immediately,
with prorated refund" and quietly override both the access-until-period-end rule
and the manual-refund rule, without a code change.

The pinned configuration is the policy:

- `subscription_cancel`: enabled, `mode: 'at_period_end'`, `proration_behavior: 'none'`
- `subscription_update`: **disabled** — plan changes go through our own flow so
  proration is chosen deliberately and a `PLAN_CHANGED` event is written
- `payment_method_update`, `invoice_history`, limited `customer_update`: enabled

It is looked up by `metadata.service === 'postaryx'`, created if missing, and
re-applied on every boot, so editing the constants in `getPortalConfigurationId()`
and redeploying moves every customer onto the new rules. If the lookup fails the
session still opens on the dashboard default and the failure is logged loudly —
that fallback is the exact state the method exists to avoid, so treat the log
line as an alert.

## Trials

7 days (`trial_period_days: 7`), applied only when `allowTrial` is set on the
organization. A payment method is required — Stripe Checkout collects it, and
`checkValidCard()` additionally puts a $1.00 manual-capture authorization on the
card and immediately voids it. No money is captured during the trial.

`finishTrial()` ends the trial early at the customer's request, which charges the
card immediately. The UI states that this charge is final before the customer
confirms (`pre-condition.component.tsx`). Recorded as `TRIAL_FINISHED`.

## Subscription states

`Subscription.status` (`SubscriptionStatus`):

`status` answers exactly one question: **what is the gateway doing with this
subscription's money right now.** Whether the customer has asked to cancel is a
separate fact and lives in `Subscription.cancelAt`.

| Status | Meaning | Terminal? |
|---|---|---|
| `TRIALING` | Inside the 7-day trial. No money taken. | no |
| `ACTIVE` | Paid and current. | no |
| `PAST_DUE` | A renewal charge failed; the gateway is still retrying. | no |
| `CANCELED` | Deliberately ended, by the customer or an admin. | yes |
| `EXPIRED` | Reached the end of the paid period without renewing. | yes |
| `FAILED` | Dunning ran out, or the card was rejected outright. | yes |

Derived from the gateway status by `toSubscriptionStatus()` (Stripe) and
`polarStatus()` (Polar), both of which are straight lookups with no special
cases.

**A scheduled cancellation does not change `status`.** A customer who cancels on
the 1st with a period ending on the 30th stays `ACTIVE` with `cancelAt` set to
the 30th, because they are still paid up and still entitled to the product for
those 29 days. "Has this customer cancelled?" is `cancelAt !== null`; "can this
customer use the product?" is the status. Keeping them apart matters: if `status`
flipped to `CANCELED` on the 1st, any future gate written as
`status === 'ACTIVE'` would cut off a paying customer 29 days early, and
`CANCELED` would mean two opposite things depending on whether `deletedAt`
happened to be set. `CANCELED` is reserved for the terminal state, written when
the subscription actually ends.

If the admin panel or any other surface needs to *show* "cancelled", it renders
that from `cancelAt` — which also gives it the date to show.

Retiring a subscription is a **soft** delete: `deletedAt` is stamped and the
status set by why it ended — `FAILED` when Stripe gave up collecting,
`CANCELED` when someone deliberately ended it (`cancellation_details.reason`),
`EXPIRED` when the period simply ran out. Every read path filters on `deletedAt`, and
re-subscribing revives the row. The row is the only record of the org's last tier
and period, and support needs it after the fact.

## Payment failure

`invoice.payment_failed` sets the subscription to `PAST_DUE`, writes a
`PAYMENT_FAILED` event (attempt count, next attempt, hosted invoice URL), and
sends the organization an in-app + email notice with a link to pay the open
invoice.

Retries and the eventual give-up are Stripe's dunning schedule, configured in the
dashboard, not in code. When Stripe finally gives up it sends
`customer.subscription.deleted`, which retires the subscription as `FAILED` and
drops the org to FREE.

Third-party platform outages (a social API being down) are not billing events and
never trigger a refund, automatic or otherwise.

## The audit trail

`BillingEvent` is append-only and never mutated or deleted. One row per
subscription, payment, refund, cancellation and dispute event, with the gateway
object id in `reference`, the approving admin in `actorUserId` where a human
decided, and the raw gateway detail in `payload`.

Read it at `GET /billing/events` (superadmin only), or in the admin panel under
the charges table.

Recorded types: `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`,
`SUBSCRIPTION_CANCEL_SCHEDULED`, `SUBSCRIPTION_CANCEL_REVERTED`,
`SUBSCRIPTION_CANCELED_IMMEDIATELY`, `SUBSCRIPTION_DELETED`, `PLAN_CHANGED`,
`TRIAL_FINISHED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `REFUND_ISSUED`,
`REFUND_FAILED`, `DISPUTE_CREATED`, `DISPUTE_CLOSED`, `LIFETIME_REDEEMED`.

`BillingEventsService.record()` swallows its own failures by design — the audit
trail must never be able to fail a checkout, a cancellation or a webhook ack. A
dropped row is logged.

## Webhooks that must be enabled

Beyond the original four, the Stripe endpoint now needs:

- `invoice.payment_failed`
- `charge.dispute.created`
- `charge.dispute.closed`

Invoice and dispute objects do not carry our subscription metadata, so they
bypass the `metadata.service === 'postaryx'` guard in `stripe.controller.ts` and
are resolved to an organization by customer id inside the service instead. If you
add another metadata-less event type, add it to `bypassesMetadataCheck` too or it
will be silently dropped.

## Polar

Polar is implemented and parked. It follows the same rule — `refundCharges()`
(`POST /v1/refunds`) is the only money-returning path and is superadmin-gated,
and `setToCancel()` cancels at period end. It does **not** yet have webhook-side
payment-failure handling, dispute handling, or any `BillingEvent` writes at all —
it maps gateway status onto `SubscriptionStatus` and nothing more, so a
Polar-backed deployment currently has no audit trail. `refundCharges()` accepts
`actorUserId` to satisfy the interface and ignores it. Close those gaps before
switching `BILLING_PROVIDER=polar`.
