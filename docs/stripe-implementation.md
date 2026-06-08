# Stripe Payment Implementation

Current state of the Stripe billing integration in Postiz. Written as a reference before migrating to an alternative payment gateway.

---

## Architecture Overview

```
BillingController (apps/backend/src/api/routes/billing.controller.ts)
    └── StripeService (libraries/nestjs-libraries/src/services/stripe.service.ts)
            └── SubscriptionService (libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.service.ts)
                    └── SubscriptionRepository (libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.repository.ts)

StripeController (apps/backend/src/api/routes/stripe.controller.ts)   ← webhook only
    └── StripeService
```

The `SubscriptionService` and `SubscriptionRepository` are **payment-provider-agnostic** — they only interact with the local Prisma DB. All Stripe-specific logic lives in `StripeService`.

Billing is **disabled entirely** when `STRIPE_PUBLISHABLE_KEY` is not set. Without it, users get unlimited premium access (the self-hosted use case).

---

## File Map

| File | Purpose |
|---|---|
| `apps/backend/src/api/routes/billing.controller.ts` | REST controller for all billing actions (`/billing/*`) |
| `apps/backend/src/api/routes/stripe.controller.ts` | Webhook receiver (`POST /stripe`) |
| `libraries/nestjs-libraries/src/services/stripe.service.ts` | All Stripe SDK calls |
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.service.ts` | Business logic wrapping the repository |
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.repository.ts` | Prisma queries |
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` | Tier definitions (prices, feature flags, channel limits) |
| `apps/frontend/src/components/billing/embedded.billing.tsx` | Stripe Elements embedded checkout UI |
| `apps/frontend/src/components/billing/first.billing.component.tsx` | Pricing page / tier selector |
| `apps/frontend/src/components/billing/main.billing.component.tsx` | Main billing page wrapper |
| `apps/frontend/src/components/billing/billing.component.tsx` | Inner billing UI |
| `apps/frontend/src/components/billing/lifetime.deal.tsx` | Lifetime deal code redemption UI |
| `apps/frontend/src/components/billing/finish.trial.tsx` | Early trial end UI |
| `apps/frontend/src/app/(app)/(site)/billing/page.tsx` | Billing route |

---

## Database Schema (Billing-Related)

### `Organization` model (billing columns)
```
paymentId    String?   -- Stripe Customer ID (cus_xxx)
isTrailing   Boolean   -- true while in 7-day trial
allowTrial   Boolean   -- true if org has not yet consumed their trial
```

### `Subscription` model
```
id               String           @id @default(cuid())
organizationId   String           @unique
subscriptionTier SubscriptionTier -- STANDARD | TEAM | PRO | ULTIMATE
identifier       String?          -- uniqueId from subscription metadata (used to detect duplicates)
cancelAt         DateTime?        -- set when cancellation is scheduled
period           Period           -- MONTHLY | YEARLY
totalChannels    Int              -- channel limit unlocked by current tier
isLifetime       Boolean          @default(false)
deletedAt        DateTime?        -- soft delete on cancellation
```

### `Credits` model
Tracks AI credit consumption per org. Used by `SubscriptionRepository.useCredit()` — wraps any AI call and rolls back the credit record if the underlying call fails.

### `UsedCodes` model
Tracks redeemed lifetime deal codes so they cannot be used twice.

---

## API Endpoints

All routes require authentication (org context via cookie).

### User-facing

| Method | Route | What it does |
|---|---|---|
| `POST` | `/billing/embedded` | Create an embedded checkout session (returns `client_secret` + optional `auto_apply_coupon`) |
| `POST` | `/billing/subscribe` | Create a redirect checkout session or upgrade an existing subscription in-place |
| `GET` | `/billing/check/:id` | Poll subscription status after checkout (returns 0=not found, 1=cancelled, 2=active) |
| `GET` | `/billing/` | Get current subscription for the org |
| `GET` | `/billing/portal` | Generate a Stripe billing portal URL |
| `POST` | `/billing/cancel` | Schedule cancellation (at period end, or immediately if payment failed) |
| `POST` | `/billing/finish-trial` | End the trial immediately |
| `GET` | `/billing/is-trial-finished` | Check whether the org is still in trial |
| `GET` | `/billing/check-discount` | Check if org qualifies for a loyalty discount (returns JWT or false) |
| `POST` | `/billing/apply-discount` | Apply the loyalty discount coupon to current subscription |
| `POST` | `/billing/prorate` | Preview the prorated cost of switching to a different plan |
| `POST` | `/billing/lifetime` | Redeem a lifetime deal code (bypasses Stripe entirely) |

### Admin-only (requires `user.isSuperAdmin`)

| Method | Route | What it does |
|---|---|---|
| `GET` | `/billing/charges` | List all charges with invoice PDF links |
| `POST` | `/billing/refund-charges` | Refund one or more charge IDs |
| `POST` | `/billing/cancel-subscription` | Immediately cancel the org's subscription |
| `POST` | `/billing/add-subscription` | Manually grant a subscription tier |

### Webhook

| Method | Route | What it does |
|---|---|---|
| `POST` | `/stripe` | Receives and verifies Stripe webhook events |

---

## Webhook Event Handling

`POST /stripe` validates the payload using `stripe.webhooks.constructEvent()` with `STRIPE_SIGNING_KEY`.

Events are filtered: any event where `metadata.service !== 'gitroom'` is silently ignored (except `invoice.payment_succeeded` which is always processed).

| Stripe Event | Handler | Effect |
|---|---|---|
| `customer.subscription.created` | `StripeService.createSubscription()` | Validates card, upserts subscription in DB |
| `customer.subscription.updated` | `StripeService.updateSubscription()` | Validates card, upserts subscription in DB |
| `customer.subscription.deleted` | `StripeService.deleteSubscription()` | Soft-deletes subscription in DB |
| `invoice.payment_succeeded` | `StripeService.paymentSucceeded()` | Fires a purchase tracking event |

### Card Validation on Subscription Create/Update

When `org.allowTrial` is `true` (trial-eligible org), the webhook handler runs a `$1.00` authorize-and-cancel payment intent to confirm the card is chargeable. If the authorization fails, the Stripe subscription is cancelled immediately and the DB is not updated.

---

## Checkout Flows

### Embedded Checkout (primary)

Used when `STRIPE_PUBLISHABLE_KEY` is set in the frontend. Creates a Stripe checkout session with `ui_mode: 'custom'`. Returns a `client_secret` to the frontend. The frontend renders `<CheckoutProvider>` from `@stripe/react-stripe-js/checkout` with `<PaymentElement>`.

Flow:
1. User picks a plan → `POST /billing/embedded`
2. Backend creates/gets a Stripe Customer, finds or creates the Product+Price, calls `stripe.checkout.sessions.create({ ui_mode: 'custom' })`
3. Returns `{ client_secret, auto_apply_coupon? }` to frontend
4. Frontend renders the embedded form. If `auto_apply_coupon` is present, it auto-applies via `checkout.applyPromotionCode()`
5. User submits → Stripe fires webhook → subscription activated in DB

### Redirect Checkout (fallback)

`POST /billing/subscribe` — used for the plan upgrade flow when there is an existing active subscription. If no current subscription, creates a standard redirect checkout session (returns `{ url }`). If one exists, upgrades in-place via `stripe.subscriptions.update()` with `proration_behavior: 'always_invoice'`.

---

## Subscription Lifecycle

```
New user
  └─ allowTrial = true (set during org creation)

User initiates checkout
  └─ createOrGetCustomer()   ← creates Stripe Customer if paymentId is null
  └─ find/create Stripe Product + Price by name match
  └─ createEmbeddedCheckout() or createCheckoutSession()
       └─ trial_period_days: 7 if allowTrial === true
       └─ subscription metadata: { service: 'gitroom', billing, period, userId, uniqueId, ud }

Stripe webhook: subscription.created
  └─ checkValidCard()         ← $1 auth/cancel if allowTrial === true
  └─ createOrUpdateSubscription()
       └─ upserts Subscription row
       └─ sets organization.isTrailing = (status !== 'active')
       └─ sets organization.allowTrial = false

Plan upgrade (subscriber → higher tier)
  └─ subscribe() detects existing DB subscription
  └─ stripe.subscriptions.update() with new Price
  └─ Stripe fires subscription.updated webhook → updateSubscription()

Cancel (user-initiated)
  └─ setToCancel():
       - if already cancel_at_period_end: remove cancellation (toggle)
       - if payment failed (past_due/open invoice): cancel immediately
       - otherwise: cancel_at_period_end = true

Stripe webhook: subscription.deleted
  └─ deleteSubscription() → soft-deletes DB row (sets deletedAt)

Lifetime deal
  └─ Bypasses Stripe entirely
  └─ Code decrypted, checked against UsedCodes, then createOrUpdateSubscription()
```

---

## Pricing Tiers

Defined in `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts`. Prices are hardcoded in code — Stripe Products and Prices are created dynamically if they don't exist yet (name-matched).

| Tier | Monthly | Yearly | Channels | Posts/mo | Team | AI Images |
|---|---|---|---|---|---|---|
| FREE | $0 | $0 | 0 | 0 | No | 0 |
| STANDARD | $29 | $278 | 5 | 400 | No | 20 |
| TEAM | $39 | $374 | 10 | unlimited | Yes | 100 |
| PRO | $49 | $470 | 30 | unlimited | Yes | 300 |
| ULTIMATE | $99 | $950 | 100 | unlimited | Yes | 500 |

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `STRIPE_PUBLISHABLE_KEY` | Frontend | Loads `@stripe/stripe-js`; if absent billing is fully disabled |
| `STRIPE_SECRET_KEY` | Backend (StripeService) | All Stripe API calls |
| `STRIPE_SIGNING_KEY` | Backend (StripeController) | Webhook signature verification |
| `STRIPE_DISCOUNT_ID` | Backend (StripeService) | Coupon ID for the loyalty discount feature |

---

## Frontend Dependencies (Stripe-specific)

```
@stripe/stripe-js           -- loads Stripe.js
@stripe/react-stripe-js     -- <CheckoutProvider>, <PaymentElement>, useCheckout()
```

Used exclusively in:
- `apps/frontend/src/components/billing/embedded.billing.tsx`
- `apps/frontend/src/components/billing/main.billing.component.tsx` (loads `loadStripe()`)

---

## Feature Gaps / Known Quirks

- `getPackages()` always returns `{}` (early-return before the actual Stripe products call) — pricing is fully driven by the local `pricing.ts` constants, not fetched from Stripe.
- Products and Prices are created dynamically in Stripe if not found by name match — this means renaming a tier would create orphan products.
- The `checkDiscount()` and `applyDiscount()` loyalty discount feature requires `STRIPE_DISCOUNT_ID` to be set and only applies to monthly subscribers with at least one charge > $10.
- Proration preview (`POST /billing/prorate`) calls `stripe.invoices.createPreview()` which is Stripe-specific and has no generic equivalent.
