# Polar Integration Plan

Plan to replace Stripe with Polar as the payment gateway, while building an abstraction layer that makes it straightforward to swap to Paddle or another provider if needed.

---

## Motivation

Stripe is unavailable in the deployment country. Polar (polar.sh) is a merchant-of-record platform targeting open-source and developer-tools products with:
- Hosted checkout (redirect-based, no embedded SDK)
- Subscription management API
- Customer portal
- Webhook events for the subscription lifecycle
- Global availability

---

## Design Principle: Provider Abstraction

Rather than replacing `StripeService` with a `PolarService` one-for-one, we introduce a `IBillingProvider` interface. Both `StripeService` and the new `PolarService` implement it. `BillingController` depends only on the interface. Switching providers in the future means:
1. Writing a new service class that implements the interface
2. Updating the provider binding in the DI module
3. Updating 3–5 environment variables

No controller or repository changes needed for future swaps.

---

## Phase 1 — Define the Provider Interface

**File to create:** `libraries/nestjs-libraries/src/services/billing/billing.provider.interface.ts`

```typescript
export interface CheckoutResult {
  url?: string;          // redirect checkout URL (Polar, Paddle)
  clientSecret?: string; // embedded checkout secret (Stripe only)
  autoApplyCoupon?: string;
}

export interface CancelResult {
  cancelAt?: Date;
}

export interface ProrationResult {
  price: number;
}

export interface ChargeRecord {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
  refunded: boolean;
  amountRefunded: number;
  description?: string;
  receiptUrl?: string;
  invoicePdfUrl?: string;
}

export interface WebhookEvent {
  type: string;
  data: Record<string, any>;
}

export interface IBillingProvider {
  // Customer
  createOrGetCustomer(organizationId: string): Promise<string>;

  // Checkout
  createCheckout(params: {
    uniqueId: string;
    organizationId: string;
    userId: string;
    body: BillingSubscribeDto;
    allowTrial: boolean;
  }): Promise<CheckoutResult>;

  createEmbeddedCheckout(params: {
    uniqueId: string;
    organizationId: string;
    userId: string;
    body: BillingSubscribeDto;
    allowTrial: boolean;
  }): Promise<CheckoutResult>;

  // Subscription management
  cancelSubscription(organizationId: string): Promise<CancelResult>;
  cancelSubscriptionAdmin(organizationId: string): Promise<void>;
  finishTrial(customerId: string): Promise<void>;
  prorate(organizationId: string, body: BillingSubscribeDto): Promise<ProrationResult>;

  // Portal
  createBillingPortalLink(customerId: string): Promise<{ url: string }>;

  // Discounts
  checkDiscount(customerId: string): Promise<boolean>;
  applyDiscount(customerId: string): Promise<boolean>;

  // Webhook
  validateWebhook(rawBody: Buffer, signature: string): WebhookEvent;
  handleSubscriptionCreated(event: WebhookEvent): Promise<any>;
  handleSubscriptionUpdated(event: WebhookEvent): Promise<any>;
  handleSubscriptionDeleted(event: WebhookEvent): Promise<any>;
  handlePaymentSucceeded(event: WebhookEvent): Promise<any>;

  // Admin
  getCharges(organizationId: string): Promise<ChargeRecord[]>;
  refundCharges(organizationId: string, chargeIds: string[]): Promise<{ refunded: string[]; failed: string[] }>;
}
```

---

## Phase 2 — Refactor StripeService to Implement the Interface

**File:** `libraries/nestjs-libraries/src/services/stripe.service.ts`

Rename the existing methods to match the interface signatures above. No behavioral changes — this is a pure structural alignment. After this phase, all existing functionality still goes through Stripe but `BillingController` now depends on `IBillingProvider` (injected via a token), not directly on `StripeService`.

Key DI change:

```typescript
// libraries/nestjs-libraries/src/services/billing/billing.module.ts (new file)
const BILLING_PROVIDER = process.env.BILLING_PROVIDER ?? 'stripe';

@Module({
  providers: [
    {
      provide: 'BILLING_PROVIDER',
      useClass: BILLING_PROVIDER === 'polar' ? PolarService : StripeService,
    },
    StripeService,
    PolarService,
    SubscriptionService,
  ],
  exports: ['BILLING_PROVIDER', SubscriptionService],
})
export class BillingModule {}
```

`BillingController` injects `@Inject('BILLING_PROVIDER') private readonly _billing: IBillingProvider`.

---

## Phase 3 — Implement PolarService

**File to create:** `libraries/nestjs-libraries/src/services/polar.service.ts`

### Polar API Fundamentals

- Base URL: `https://api.polar.sh`
- Auth: `Authorization: Bearer ${POLAR_ACCESS_TOKEN}` on every request
- SDK: `@polar-sh/sdk` (installable via pnpm) or plain `fetch`
- Products and prices are configured in the Polar dashboard, not created dynamically — product/price IDs are stored as env vars

### Mapping: Stripe Concepts → Polar Concepts

| Stripe | Polar |
|---|---|
| Customer (`cus_xxx`) | Customer (`customer.id`) |
| Product + Price | Product with variants (price IDs from dashboard) |
| Checkout Session | Checkout Session (`POST /v1/checkouts`) |
| `client_secret` / `ui_mode: custom` | Redirect checkout URL only (no embedded SDK) |
| `customer.subscription.created` | `subscription.created` webhook |
| `customer.subscription.updated` | `subscription.updated` webhook |
| `customer.subscription.deleted` | `subscription.canceled` webhook |
| `invoice.payment_succeeded` | `order.created` webhook |
| Billing portal | Polar customer portal (`/customer-portal`) |
| Coupon / promo code | Discount codes in Polar dashboard |

### Key Method Implementations

#### `createOrGetCustomer(organizationId)`
```
GET https://api.polar.sh/v1/customers?external_id={organizationId}
If not found:
  POST https://api.polar.sh/v1/customers
    { email, name, external_id: organizationId }
Store customer.id in Organization.paymentId (same column, no schema change)
```

#### `createCheckout(...)` and `createEmbeddedCheckout(...)`
Polar only supports hosted redirect checkout — there is no embedded form SDK. Both methods return `{ url }`. The frontend must be updated to redirect instead of rendering `<PaymentElement>`.

```
POST https://api.polar.sh/v1/checkouts
{
  products: [{ product_id: POLAR_PRICE_IDS[billing][period] }],
  customer_id: customerId,
  metadata: { service: 'postiz', billing, period, userId, uniqueId },
  success_url: FRONTEND_URL + `/launches?onboarding=true&check=${uniqueId}`,
  ...(allowTrial ? { trial_period_days: 7 } : {})
}
Returns { url }
```

Product IDs are mapped from environment variables (see Phase 5).

#### `cancelSubscription(organizationId)`
```
GET https://api.polar.sh/v1/subscriptions?customer_id={customerId}&active=true
PATCH https://api.polar.sh/v1/subscriptions/{id}
  { cancel_at_period_end: true }
```

#### `createBillingPortalLink(customerId)`
```
POST https://api.polar.sh/v1/customer-portal/sessions
  { customer_id: customerId }
Returns { url }
```

#### `validateWebhook(rawBody, signature)`
Polar signs webhooks with HMAC-SHA256. Verify:
```typescript
import { createHmac } from 'crypto';
const digest = createHmac('sha256', process.env.POLAR_WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
if (digest !== signature) throw new Error('Invalid webhook signature');
```

#### `handleSubscriptionCreated(event)` / `handleSubscriptionUpdated(event)`
Extract `billing`, `period`, `uniqueId` from `event.data.metadata`. Call `SubscriptionService.createOrUpdateSubscription()` — same as Stripe path. No card validation step needed (Polar handles payment validation before firing the webhook).

#### `handleSubscriptionDeleted(event)` (maps to `subscription.canceled`)
Call `SubscriptionService.deleteSubscription(customerId)`.

#### `handlePaymentSucceeded(event)` (maps to `order.created`)
Extract `userId` and `amount` from `event.data`. Fire the tracking event via `TrackService`.

#### `prorate(...)` — Not supported by Polar
Polar does not expose a proration preview API. Return `{ price: 0 }` to suppress the proration UI. The frontend already handles this gracefully (shows "Contact us" or hides the prorate step when price is 0).

#### `checkDiscount()` / `applyDiscount()`
Polar discount codes are applied at checkout by the customer or auto-applied via the `discount_id` field in the checkout session. The loyalty discount feature (`STRIPE_DISCOUNT_ID`) does not have a direct Polar equivalent — return `false` / no-op for now. Can be revisited once the integration is live.

---

## Phase 4 — Backend Webhook Controller Update

**File:** `apps/backend/src/api/routes/stripe.controller.ts`

Rename to `webhook.controller.ts` (or keep both and gate by env var). The new controller uses `IBillingProvider`:

```typescript
@Controller('/payment-webhook')
export class PaymentWebhookController {
  constructor(@Inject('BILLING_PROVIDER') private readonly _billing: IBillingProvider) {}

  @Post('/')
  async handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['webhook-id'] ?? req.headers['stripe-signature'];
    const event = this._billing.validateWebhook(req.rawBody, signature as string);

    switch (event.type) {
      case 'subscription.created':
      case 'customer.subscription.created':
        return this._billing.handleSubscriptionCreated(event);
      case 'subscription.updated':
      case 'customer.subscription.updated':
        return this._billing.handleSubscriptionUpdated(event);
      case 'subscription.canceled':
      case 'customer.subscription.deleted':
        return this._billing.handleSubscriptionDeleted(event);
      case 'order.created':
      case 'invoice.payment_succeeded':
        return this._billing.handlePaymentSucceeded(event);
    }
    return { ok: true };
  }
}
```

Register the new webhook URL in the Polar dashboard: `https://your-domain.com/payment-webhook`.

---

## Phase 5 — Environment Variables for Polar

Add to `.env`:

```bash
# Payment provider selection
BILLING_PROVIDER=polar             # 'stripe' | 'polar'

# Polar credentials
POLAR_ACCESS_TOKEN=               # From Polar dashboard → Settings → API Keys
POLAR_WEBHOOK_SECRET=             # From Polar dashboard → Webhooks → Signing secret

# Polar product/price IDs (from Polar dashboard → Products)
# Format: POLAR_PRICE_{TIER}_{PERIOD}
POLAR_PRICE_STANDARD_MONTHLY=
POLAR_PRICE_STANDARD_YEARLY=
POLAR_PRICE_TEAM_MONTHLY=
POLAR_PRICE_TEAM_YEARLY=
POLAR_PRICE_PRO_MONTHLY=
POLAR_PRICE_PRO_YEARLY=
POLAR_PRICE_ULTIMATE_MONTHLY=
POLAR_PRICE_ULTIMATE_YEARLY=
```

The lookup helper in `PolarService`:
```typescript
private getPriceId(billing: string, period: 'MONTHLY' | 'YEARLY'): string {
  const key = `POLAR_PRICE_${billing}_${period}`;
  const id = process.env[key];
  if (!id) throw new Error(`Missing env var: ${key}`);
  return id;
}
```

Stripe env vars (`STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_SIGNING_KEY`) can be removed once Polar is confirmed working.

---

## Phase 6 — Frontend Changes

### 6a. Remove Stripe Embedded Checkout

`apps/frontend/src/components/billing/embedded.billing.tsx` — the entire component uses `@stripe/react-stripe-js/checkout`. With Polar, checkout is redirect-based, so this file is replaced.

**New flow in `main.billing.component.tsx`:**
1. User selects a plan → `POST /billing/embedded` (or `/billing/subscribe`)
2. Backend returns `{ url }` instead of `{ client_secret }`
3. Frontend does `window.location.href = url`
4. Polar handles payment on their hosted page
5. On return to `success_url`, the existing `/launches?onboarding=true&check=<id>` flow polls `GET /billing/check/:id` — **no change needed here**

### 6b. Remove Stripe SDK

```bash
pnpm remove @stripe/stripe-js @stripe/react-stripe-js
```

Only after confirming no other part of the codebase uses them.

### 6c. Billing gate: `STRIPE_PUBLISHABLE_KEY` → `BILLING_PROVIDER`

Currently the frontend checks `STRIPE_PUBLISHABLE_KEY` (via env) to determine whether to show the billing UI. Change this to check a `BILLING_ENABLED` flag or `NEXT_PUBLIC_BILLING_PROVIDER`.

Grep for `STRIPE_PUBLISHABLE_KEY` in the frontend and replace with the new env var:
```bash
grep -r "STRIPE_PUBLISHABLE_KEY" apps/frontend/src/
```

### 6d. Components to update

| Component | Change |
|---|---|
| `embedded.billing.tsx` | Replace entirely with a redirect handler (or remove) |
| `main.billing.component.tsx` | Remove `loadStripe()`, remove `<EmbeddedBilling>`, redirect on `{ url }` response |
| `first.billing.component.tsx` | No change (pure pricing UI) |
| `finish.trial.tsx` | No change (calls `POST /billing/finish-trial` which maps to the interface) |
| `billing.component.tsx` | Check for Stripe portal references, replace with provider-agnostic portal call |

---

## Phase 7 — Polar Dashboard Setup

Before writing any code, complete these steps in the Polar dashboard:

1. **Create an organization** at polar.sh
2. **Create Products** matching the 4 paid tiers (STANDARD, TEAM, PRO, ULTIMATE), each with monthly and yearly variants at the prices defined in `pricing.ts`
3. **Copy the price/product IDs** into `.env` as `POLAR_PRICE_*` variables
4. **Configure a webhook endpoint**: `https://your-domain.com/payment-webhook`
   - Events to subscribe: `subscription.created`, `subscription.updated`, `subscription.canceled`, `order.created`
5. **Copy the webhook signing secret** into `POLAR_WEBHOOK_SECRET`
6. **Generate an API key** and set as `POLAR_ACCESS_TOKEN`

---

## No-Schema-Change Guarantee

The Prisma schema requires zero changes:
- `Organization.paymentId` stores the Polar Customer ID instead of Stripe Customer ID — same column, same type
- `Subscription` table is fully provider-agnostic (no Stripe-specific columns)
- `Credits`, `UsedCodes` — unaffected

---

## Rollback Plan

Because both providers implement the same interface and are selected via `BILLING_PROVIDER`, rolling back to Stripe is:
1. Set `BILLING_PROVIDER=stripe` in env
2. Set `STRIPE_PUBLISHABLE_KEY` in frontend env
3. Redeploy

Existing subscription rows in the DB are untouched — users who subscribed via Stripe retain their `Organization.paymentId` (Stripe customer ID). You would need to handle the case where some orgs have Stripe customer IDs and some have Polar customer IDs if both providers coexist, but a clean cutover avoids this.

---

## Future: Adding Paddle

If Polar is rejected, integrating Paddle requires:
1. Create `PaddleService` implementing `IBillingProvider`
2. Map Paddle webhook events to the interface methods
3. Add Paddle product/price IDs as env vars
4. Set `BILLING_PROVIDER=paddle`
5. Frontend: Paddle also supports redirect checkout, same `{ url }` response pattern — no UI change needed beyond what was done for Polar

The interface design ensures the controller, repository, and pricing table are never touched again for a gateway swap.

---

## Implementation Order

| Step | What | Effort |
|---|---|---|
| 1 | Create `IBillingProvider` interface file | ~30 min |
| 2 | Refactor `StripeService` to implement it (rename/align methods) | ~2 hrs |
| 3 | Update `BillingController` to inject `IBillingProvider` | ~1 hr |
| 4 | Create `BillingModule` with conditional provider binding | ~30 min |
| 5 | Set up Polar dashboard + configure products/webhooks | ~1 hr |
| 6 | Implement `PolarService` | ~4 hrs |
| 7 | Update webhook controller to be provider-agnostic | ~1 hr |
| 8 | Update frontend (remove Stripe SDK, redirect on `{ url }`) | ~2 hrs |
| 9 | Test end-to-end in Polar test mode | ~2 hrs |
| 10 | Deploy with `BILLING_PROVIDER=polar`, monitor webhooks | — |
