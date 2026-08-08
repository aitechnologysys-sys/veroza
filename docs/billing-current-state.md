# Billing — Current State, Stripe Enablement, and Stripe Test-Mode Setup

**Status as of 2026-08-02.** Authoritative description of what is actually in the tree today.

**Active configuration: Stripe, with `BILLING_ENABLED` as the single enforcement switch.** Polar is implemented and parked.

Companion docs:
- `docs/stripe-implementation.md` — how Stripe worked *before* the migration. Still accurate for the Stripe code path (that code is untouched), but its "Architecture Overview" is now out of date.
- `docs/polar-integration-plan.md` — the plan that was written *before* the Polar work. Partially superseded; see [Where reality diverges from the plan](#where-reality-diverges-from-the-plan).

---

## TL;DR

1. Both `StripeService` and `PolarService` exist and both implement `IBillingProvider`. The active one is chosen at runtime by `BILLING_PROVIDER` (`polar` → Polar, anything else including unset → Stripe).
2. **The active provider is Stripe.** Polar is parked — its code, env vars and webhook route are all still in place, and switching back is a one-line env change.
3. **Two independent switches**, as of the `BILLING_ENABLED` refactor:
   - `BILLING_ENABLED` — is billing *enforced*? Single source of truth, read only through `isBillingEnabled()`.
   - `BILLING_PROVIDER` — *which gateway* handles checkout when it is.

   Previously these were conflated: the presence of `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` acted as the enforcement gate in 15 scattered places. That is fixed — see [The billing gate](#the-billing-gate-billing_enabled).
4. For Stripe test mode you do **not** need to create any products by hand — upstream Postiz creates Stripe Products and Prices on the fly, name-matched. If you want to pre-create them, the exact required shape is in [What to create in Stripe test mode](#what-to-create-in-stripe-test-mode).

---

## 1. Current architecture

```
BillingController (apps/backend/src/api/routes/billing.controller.ts)
    └── @Inject('BILLING_PROVIDER') → IBillingProvider
            ├── StripeService   (libraries/nestjs-libraries/src/services/stripe.service.ts,  987 lines)
            └── PolarService    (libraries/nestjs-libraries/src/services/polar.service.ts,   554 lines)
                    └── SubscriptionService → SubscriptionRepository → Prisma

StripeController  POST /stripe                                    → StripeService  (direct, not via the interface)
PolarController   POST /payment-webhook, POST /api/payment-webhook → PolarService   (direct, not via the interface)
```

`SubscriptionService` / `SubscriptionRepository` / `pricing.ts` remain payment-provider-agnostic — they only touch the local DB. That was true before the migration and is still true.

### Provider selection (DI)

`libraries/nestjs-libraries/src/database/prisma/database.module.ts:73-78`:

```ts
{
  provide: 'BILLING_PROVIDER',
  useFactory: (stripe: StripeService, polar: PolarService) =>
    process.env.BILLING_PROVIDER === 'polar' ? polar : stripe,
  inject: [StripeService, PolarService],
}
```

Note the default: anything other than the exact string `polar` — including unset — resolves to **Stripe**.

### The interface

`libraries/nestjs-libraries/src/services/billing.provider.interface.ts`:

```
checkSubscription(organizationId, subscriptionId): Promise<number>   // 0 = none, 1 = cancelled, 2 = active
checkDiscount(paymentId): Promise<boolean>
applyDiscount(paymentId): Promise<boolean>
finishTrial(paymentId): Promise<any>
embedded(uniqueId, organizationId, userId, body, allowTrial): Promise<CheckoutResult>   // { client_secret?, url?, auto_apply_coupon? }
subscribe(uniqueId, organizationId, userId, body, allowTrial): Promise<SubscribeResult> // { url?, portal?, id? }
getCustomerByOrganizationId(organizationId): Promise<string | null>
createBillingPortalLink(customerId): Promise<{ url }>
setToCancel(organizationId): Promise<{ id, cancel_at? }>
prorate(organizationId, body): Promise<{ price }>
lifetimeDeal(organizationId, code): Promise<{ success }>
getCharges(organizationId): Promise<any[]>
refundCharges(organizationId, chargeIds): Promise<{ refunded, failed }>
cancelSubscription(organizationId): Promise<{ cancelled }>
```

Webhook handling is **not** on the interface. Each provider has its own controller and its own webhook methods. Both controllers are registered unconditionally in `apps/backend/src/api/api.module.ts:72-82`, so both endpoints are live regardless of `BILLING_PROVIDER`. In practice this is harmless — the inactive one will reject anything it receives on signature verification — but it does mean `POST /stripe` is a reachable route today.

### Frontend

`apps/frontend/src/components/billing/first.billing.component.tsx` handles **both** shapes returned by `POST /billing/embedded`:

- `data.url` present → `window.location.href = data.url` (Polar hosted checkout) — line ~110
- `data.client_secret` present **and** `stripeClient` env set → renders `<EmbeddedBilling>` with Stripe Elements — line ~218

So the frontend needs no changes to switch providers. The Stripe SDK (`@stripe/stripe-js`, `@stripe/react-stripe-js`) is still installed and still used by `embedded.billing.tsx`.

---

## 2. The billing gate: `BILLING_ENABLED`

### The one switch

```ts
// libraries/helpers/src/utils/is.billing.enabled.ts
export const isBillingEnabled = () => process.env.BILLING_ENABLED === 'true';
```

That is the **only** thing that decides whether pricing is enforced. Note it requires the literal string `true` — `1`, `yes`, or a non-empty value will not enable it.

When it returns `false` the deployment behaves as free / self-hosted: every org reports as ULTIMATE with 10 000 channels, channel / credit / team-member limits are not applied, permission checks short-circuit to allowed, the public API and the publisher do not require a subscription, and the billing UI is hidden. This is the same default upstream Postiz has — it just used a different signal to get there.

**Never re-introduce a `process.env.STRIPE_*` check as an enforcement gate.** Import `isBillingEnabled()` instead. The two Stripe env vars that legitimately remain in code are the ones that genuinely configure the gateway:

- `stripe.service.ts:16` — `new Stripe(process.env.STRIPE_SECRET_KEY)`
- `(app)/layout.tsx` — `stripeClient={process.env.STRIPE_PUBLISHABLE_KEY}`, which feeds `loadStripe()`

### What changed

Upstream Postiz used the presence of `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` as a proxy for *"is this a paid SaaS deployment or a free self-hosted one?"*, in 15 scattered places. The Polar migration added `BILLING_PROVIDER` but left those checks alone, which meant the enforcement decision was coupled to which gateway's credentials happened to be present. All of them now route through `isBillingEnabled()`:

| File | Was | Now |
|---|---|---|
| `apps/backend/src/api/routes/users.controller.ts` ×3 | `!STRIPE_PUBLISHABLE_KEY` | `!isBillingEnabled()` — `totalChannels`, `tier`, `isTrailing` |
| `apps/backend/src/services/auth/permissions/permissions.service.ts` ×2 | `!STRIPE_PUBLISHABLE_KEY` | `!isBillingEnabled()` — default tier, and the permission short-circuit |
| `libraries/nestjs-libraries/.../integrations/integration.service.ts` | `!!STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — channel-count limit |
| `libraries/nestjs-libraries/.../organizations/organization.repository.ts` | `STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — STANDARD-tier team restriction |
| `apps/backend/src/api/routes/media.controller.ts` | `STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — AI credit exhaustion |
| `apps/backend/src/api/routes/no.auth.integrations.controller.ts` | `STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — trial reconnect block |
| `apps/backend/src/services/auth/public.auth.middleware.ts` ×2 | `!!STRIPE_SECRET_KEY` | `isBillingEnabled()` — public API subscription requirement |
| `apps/orchestrator/src/activities/post.activity.ts` ×3 | `STRIPE_SECRET_KEY` | `isBillingEnabled()` — publish-time subscription check |
| `apps/frontend/src/app/(app)/layout.tsx` ×3 | `!!STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — `billingEnabled`, `dub`, Plausible |
| `apps/frontend/src/app/(provider)/layout.tsx`, `(extension)/layout.tsx` | `!!STRIPE_PUBLISHABLE_KEY` | `isBillingEnabled()` — `billingEnabled` |

Two of these were judgement calls worth knowing about: `dub` (referral attribution — it rides on the checkout metadata, so it belongs to billing) and `Plausible` (analytics — not strictly billing, but it was on the same gate and moving it keeps the Stripe key out of non-gateway code). Both preserve the previous behaviour exactly.

`billingEnabled` reaches the client through `VariableContextComponent`; components read it with `useVariables()`. That plumbing is unchanged.

This is a deliberate divergence from upstream. Keep it in its own commit so `git merge upstream/main` stays readable.

---

## 3. Polar implementation — what's complete and what isn't

`PolarService` talks to the Polar REST API directly with `axios` (no `@polar-sh/sdk` dependency). Base URL switches on `POLAR_SERVER=sandbox` → `https://sandbox-api.polar.sh`, otherwise `https://api.polar.sh`.

### Working

| Capability | Notes |
|---|---|
| Webhook signature verification | Standard-Webhooks HMAC-SHA256 over `{id}.{timestamp}.{body}`, base64. Includes a 5-minute timestamp window. The secret is used as **raw UTF-8 including the `polar_whs_` prefix** — see the comment at `polar.service.ts:60-64`; this was the subject of commit `06d65f34`. |
| `subscription.created` / `subscription.updated` | Upserts via `SubscriptionService.createOrUpdateSubscription()`. Reads `billing`, `period`, `uniqueId` from checkout metadata. |
| `subscription.canceled` / `subscription.revoked` | Soft-deletes the subscription. |
| `order.created` | Fires the purchase tracking event. |
| Customer create/lookup | Uses `GET /v1/customers/external/{orgId}`, **not** the list endpoint — the list endpoint ignores an unknown `external_id` filter and would return the oldest customer (fixed in `0cfb1088`). Customer id is stored in `Organization.paymentId`, same column as Stripe used. |
| Hosted checkout | `POST /v1/checkouts`, returns `{ url }`. 7-day trial via `trial_interval: 'day'` + `trial_interval_count: 7` when `allowTrial`. |
| Cancel / un-cancel | `PATCH /v1/subscriptions/{id}` with `cancel_at_period_end`. Toggling behaviour matches Stripe's. |
| Customer portal | `POST /v1/customer-sessions` → `customer_portal_url`. |
| Charges / refunds (admin) | `GET /v1/orders`, `POST /v1/refunds`. |
| Lifetime deal codes | Identical logic to Stripe's — never touched the gateway anyway. |

### Not implemented / degraded vs Stripe

| Capability | Polar behaviour | Impact |
|---|---|---|
| `finishTrial()` | No-op, returns `{ ok: true }`. Polar has no "end trial now" API. | The "finish trial early" button silently does nothing; trial expires on its own. |
| `checkDiscount()` / `applyDiscount()` | Return `false`. | Loyalty-discount feature is dead under Polar. |
| `prorate()` | Returns `{ price: 0 }`. Polar has no proration-preview API. | Upgrade flow shows no prorated amount. |
| Plan upgrade (`subscribe()` with an existing sub) | **Cancels the old subscription, then creates a brand-new checkout.** Stripe upgraded in place with `proration_behavior: 'always_invoice'`. | User re-enters payment; there's a window where they have no active subscription. Worth revisiting — Polar does support subscription product updates. |
| `getCharges()` | `refunded` hardcoded `false`, `amount_refunded` `0`, no `receiptUrl` / `invoicePdfUrl`. | Admin charges view loses invoice PDF links and refund state. |
| Card pre-authorisation | Not done. Stripe ran a $1 authorise-and-cancel before honouring a trial (`stripe.service.ts:30-98`). | Polar validates the card itself before firing the webhook, so this is acceptable, but trial abuse characteristics differ. |
| `checkSubscription()` fallback | Only returns `1` (cancelled) or `0`; never returns `2` from the Polar-side lookup. | Post-checkout polling relies on the webhook landing. Usually fine; slow webhooks make the success page spin longer. |

---

## 4. Where reality diverges from the plan

`docs/polar-integration-plan.md` is not what got built. Differences that matter when reading it:

| Plan said | Actually built |
|---|---|
| Interface at `services/billing/billing.provider.interface.ts` | `services/billing.provider.interface.ts` (no `billing/` folder) |
| New `BillingModule` with the provider binding | Binding lives in the existing `database.module.ts` |
| Interface method names like `createCheckout`, `cancelSubscription(orgId)`, `handleSubscriptionCreated` on the interface | Kept Postiz's original names (`embedded`, `subscribe`, `setToCancel`). Webhook handlers are **not** on the interface. |
| Rename `stripe.controller.ts` → `webhook.controller.ts` | `stripe.controller.ts` untouched; `polar.controller.ts` added alongside |
| Remove the Stripe frontend SDK | Still installed and still used |
| Replace `STRIPE_PUBLISHABLE_KEY` gate with `BILLING_ENABLED` / `NEXT_PUBLIC_BILLING_PROVIDER` | Done, as `BILLING_ENABLED` — see section 2 |
| `lifetimeDeal` not mentioned | Part of the interface, implemented by both providers |

Keeping Postiz's original method names was the right call for merge-ability with upstream, and is consistent with the "stay close to upstream" goal.

---

## 5. How to enable Stripe

No code changes required. Stripe is the **default** provider — you get it by not setting `BILLING_PROVIDER=polar`.

### 5.1 Environment variables

```bash
# Enforce billing at all — must be the literal string "true"
BILLING_ENABLED=true

# Provider selection — omit entirely, or set to anything other than "polar"
BILLING_PROVIDER=stripe

# Required
STRIPE_PUBLISHABLE_KEY=pk_test_...   # frontend only: feeds loadStripe()
STRIPE_SECRET_KEY=sk_test_...        # backend: every Stripe API call
STRIPE_SIGNING_KEY=whsec_...         # webhook signature verification

# Optional
STRIPE_DISCOUNT_ID=                  # coupon id for the loyalty-discount feature; if unset, checkDiscount() returns false
```

### Where to get each one

All of these come from the [Stripe Dashboard](https://dashboard.stripe.com/). Flip the **Test mode** toggle (top right) first — test-mode and live-mode keys are separate sets and are not interchangeable.

| Var | Where | Looks like |
|---|---|---|
| `STRIPE_PUBLISHABLE_KEY` | **Developers → API keys** → "Publishable key". Shown in full, no reveal step — it is designed to be public and ships to the browser. | `pk_test_51Abc...` |
| `STRIPE_SECRET_KEY` | Same page → "Secret key" → *Reveal*. Only shown once on creation for restricted keys; the default one can be revealed any time. | `sk_test_51Abc...` |
| `STRIPE_SIGNING_KEY` | Two sources depending on environment — see 5.2 and 5.3. | `whsec_...` |
| `STRIPE_DISCOUNT_ID` | **Product catalogue → Coupons** → create one → copy its ID. Optional. | `abc123XY` |

Direct link with test mode on: `https://dashboard.stripe.com/test/apikeys`.

Notes:
- `STRIPE_SIGNING_KEY_CONNECT` and `FEE_AMOUNT` were in `.env.example` but are **not referenced anywhere in the code**. Both have been removed from the example file.
- `STRIPE_PUBLISHABLE_KEY` is read in a **server component** (`(app)/layout.tsx`), so it is a runtime read — a container restart picks up a change, no frontend rebuild needed. (Only `NEXT_PUBLIC_*` vars are inlined at build time.)
- Leave the Polar vars in place — they're inert when `BILLING_PROVIDER !== 'polar'`. Rolling back is a one-line env change.
- In the Docker stack, all of these flow through `env_file: .env.prod` in `docker-compose.yaml`. Nothing needs adding to the `environment:` block.

### 5.2 Webhook

Endpoint: `POST https://<backend-host>/stripe`

Events to subscribe (`apps/backend/src/api/routes/stripe.controller.ts:38-49`):

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

**API version: pick the newest `*.clover` the dropdown offers.** As of this writing that is `2025-12-15.clover` (the account's default). Stripe defaults a new endpoint to the account default anyway, so in practice: leave it, but verify it says clover.

The requirement is **same major version as the SDK**, not an identical date string. The outbound API version and the webhook event version are independent settings; both just need to be in the same generation as the types the code compiles against.

⚠️ **Do not upgrade the account to `2026-07-29.dahlia` or any later major.** `stripe@20.4.0` is generated for clover (`ApiMajorVersion = 'clover'`). A dahlia webhook endpoint would deliver dahlia-shaped events to clover-typed parsing code. Moving to dahlia is a deliberate three-part migration — bump the `stripe` package to a dahlia generation, update `STRIPE_API_VERSION`, and change the endpoint version — not a dashboard click.

For the CLI, `stripe listen` also uses the account default; override with `--stripe-version`.

The code pin at `stripe.service.ts:8-16`:

```ts
const STRIPE_API_VERSION = '2026-02-25.clover';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing', {
  apiVersion: STRIPE_API_VERSION,
});
```

Upstream Postiz does not pass `apiVersion` and just inherits whatever the installed `stripe` package pins (`node_modules/stripe/cjs/apiVersion.js`, currently the same value for `stripe@20.4.0`). We pin explicitly so a dependency bump can't silently shift the wire format — a small, deliberate divergence.

The code pin deliberately does **not** match the endpoint's date string — the dashboard doesn't offer `2026-02-25.clover`, and it doesn't need to. Don't "fix" this by casting the pin down (`'2025-12-15.clover' as Stripe.LatestApiVersion`); `apiVersion` is typed as a literal alias of the SDK's own version, so the cast asserts something false about types generated for a different date, for no benefit.

**A version mismatch across a major fails silently, not loudly.** `paymentSucceeded()` reads `event.data.object.parent?.subscription_details?.subscription` (`stripe.service.ts:838`). That nested shape arrived in `2025-03-31.basil`; older versions put it at top-level `invoice.subscription`. On a too-old endpoint version the optional chain yields `undefined`, the guard on the next line returns `{ ok: true }`, and purchase tracking never fires — no error, no log. Any clover version is safe; that's the bar to hold.

Filtering behaviour: the controller drops any event whose `data.object.metadata.service !== 'gitroom'`, except `invoice.payment_succeeded` which is always processed. **Postiz stamps `service: 'gitroom'` on Stripe subscription metadata; the Polar path stamps `service: 'postiz'`.** If you ever change that string on the Stripe side, the webhook will start silently no-op'ing on every event — the endpoint returns `{ ok: true }` with no log.

### 5.3 Local development — getting the webhook in

Everything except the webhook works with just the two API keys. The webhook needs Stripe to be able to reach your backend. Three options, in order of convenience:

**a) Stripe CLI (simplest).** `package.json` already has the script:

```bash
pnpm dev:stripe
# = stripe listen --forward-to localhost:3000/stripe  +  pnpm run dev
```

Requires the [Stripe CLI](https://stripe.com/docs/stripe-cli) and `stripe login`. `stripe listen` prints a `whsec_...` on startup — **that** is `STRIPE_SIGNING_KEY` for local dev. It is a different value from the dashboard's endpoint secret, and it changes each time you start a fresh listen session unless you pass `--load-from-webhooks-api`.

**b) ngrok.** Point a tunnel at the backend, not the frontend — the webhook route is on port 3000:

```bash
ngrok http 3000
# → https://<random>.ngrok-free.app
```

Then in the dashboard: **Developers → Webhooks → Add endpoint**, URL `https://<random>.ngrok-free.app/stripe`, select the four events from 5.2, and copy the endpoint's **Signing secret** into `STRIPE_SIGNING_KEY`. Restart the backend so it picks up the new value. Free ngrok URLs change on every restart, so the endpoint has to be re-pointed each session — the Stripe CLI avoids that, but ngrok is the right choice if you also want a stable URL for OAuth callbacks. (`NGROK_AUTHTOKEN` is already in `.env.prod`.)

**c) Deployed backend.** Same as (b) but with the real host: `https://<backend-host>/stripe`, signing secret from the dashboard.

You can defer all of this. Without a working webhook, checkout completes on Stripe's side but no `Subscription` row is written, so the post-checkout poll (`GET /billing/check/:id`) will spin. Everything up to that point is testable.

### 5.4 Verification checklist

1. `BILLING_ENABLED=true` is set — confirm `GET /user/self` reports `tier: "FREE"` for a new org rather than `"ULTIMATE"`. If it says ULTIMATE, the flag isn't being read.
2. `GET /billing/` returns the org's subscription (or `null`) rather than erroring.
3. `POST /billing/embedded` with `{ billing: "STANDARD", period: "MONTHLY" }` returns a `client_secret` (Stripe) rather than a `url` (Polar) — the quickest confirmation of which provider is bound.
4. Stripe test dashboard → Products: `STANDARD` should now exist with a `$29.00/month` price, auto-created by the call above.
5. Complete a checkout with test card `4242 4242 4242 4242`; confirm a `Subscription` row appears and `Organization.paymentId` is a `cus_...`. (Needs the webhook.)
6. Confirm `Organization.allowTrial` flipped to `false` and `isTrailing` reflects the Stripe status.

---

## 6. What to create in Stripe test mode

### The short answer: nothing

This is the part worth internalising from how Postiz does it. `StripeService.embedded()`, `subscribe()` and `prorate()` all **find-or-create** the Product and the Price at request time (`stripe.service.ts:661-703`, `727-769`, `205-248`):

```ts
const findProduct =
  allProducts.data.find(p => p.name.toUpperCase() === body.billing.toUpperCase())
  || await stripe.products.create({ active: true, name: body.billing });

const findPrice =
  pricesList.data.find(p =>
       p.recurring?.interval === (period === 'MONTHLY' ? 'month' : 'year')
    && p.unit_amount === priceData[period === 'MONTHLY' ? 'month_price' : 'year_price'] * 100)
  || await stripe.prices.create({ ... });
```

Prices in `pricing.ts` are the source of truth; Stripe is just a mirror that gets populated lazily. So in a fresh test-mode account, the first checkout for each tier/period creates what it needs. **Start with an empty test account and let it self-populate — that is the upstream-faithful path and the one least likely to break.**

### The one package to start with

If you want a single package to exercise the flow: **STANDARD / MONTHLY — $29.00 USD, recurring monthly.** It's the cheapest paid tier, it's the default preselected tier in the billing UI (`first.billing.component.tsx` initialises `tier = 'STANDARD'`, `period = 'MONTHLY'`), and monthly is the only period where promotion codes are enabled (`allow_promotion_codes: body.period === 'MONTHLY'`), so it also lets you test coupons.

### If you pre-create products anyway

You must match exactly what the lookup expects, or you'll get silent duplicates. Product name is matched **case-insensitively** against the tier name; price is matched on **interval + unit_amount only**.

| Product name | Price nickname | Amount (USD) | Interval |
|---|---|---|---|
| `STANDARD` | `STANDARD MONTHLY` | 29.00 | month |
| `STANDARD` | `STANDARD YEARLY` | 278.00 | year |
| `TEAM` | `TEAM MONTHLY` | 39.00 | month |
| `TEAM` | `TEAM YEARLY` | 374.00 | year |
| `PRO` | `PRO MONTHLY` | 49.00 | month |
| `PRO` | `PRO YEARLY` | 470.00 | year |
| `ULTIMATE` | `ULTIMATE MONTHLY` | 99.00 | month |
| `ULTIMATE` | `ULTIMATE YEARLY` | 950.00 | year |

All prices: currency `usd`, `active: true`, standard recurring pricing (not tiered), no `lookup_key` needed.

There is no `FREE` product — the FREE tier never reaches Stripe.

**Two traps if you hand-create:**

1. **Nickname mismatch.** `embedded()` and `subscribe()` match on interval + amount only, but `prorate()` *also* requires `nickname === "<TIER> <PERIOD>"` (`stripe.service.ts:229`). A price created with a different nickname will be used for checkout but rejected by proration, which will then create a *second*, duplicate price. Use the exact nicknames in the table.
2. **Price drift.** Matching is on exact `unit_amount`. If you edit `pricing.ts` without archiving the old Stripe price, the next checkout creates a new price alongside the old one — existing subscribers stay on the old amount, which is usually what you want, but the product accumulates orphan prices. Archive deliberately.

Because prices are amount-matched, **renaming a tier orphans its product** — a rename means creating a new product and migrating subscribers. Relevant if the Postaryx rebrand ever touches tier names. It shouldn't.

### Optional test-mode extras

| Feature | What to create | Where it's read |
|---|---|---|
| Auto-applied promo | A **promotion code** (or its coupon) with metadata `autoapply=true`. Only surfaced for MONTHLY. Expiry, `redeem_by`, and `max_redemptions` are all respected. | `stripe.service.ts:372-417`; returned to the frontend as `auto_apply_coupon` |
| Loyalty discount | A **coupon**; put its id in `STRIPE_DISCOUNT_ID`. Only offered to monthly subscribers with at least one charge over $10 who have no existing discount. | `stripe.service.ts:556-620` |
| Customer portal | Enable + configure the Billing customer portal in the test dashboard. | `GET /billing/portal` |

### Trial behaviour to expect in test mode

New orgs have `allowTrial = true`, so checkout is created with `trial_period_days: 7`. On `customer.subscription.created`, `checkValidCard()` runs a **$1.00 manual-capture PaymentIntent and immediately cancels it** to prove the card is chargeable. If it fails, the payment method is detached and the Stripe subscription is cancelled — the DB is never updated.

Useful test cards:

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | Succeeds; passes the $1 authorisation |
| `4000 0000 0000 0341` | Attaches fine but fails on charge — exercises the `checkValidCard` rejection path |
| `4000 0025 0000 3155` | Requires 3D Secure — exercises the SCA path (see commit `5f2f5581`, "3d secure fix") |

---

## 7. Rolling between providers

| Direction | Steps |
|---|---|
| → Stripe | Set `BILLING_PROVIDER=stripe` (or remove it), set the three `STRIPE_*` vars, point the Stripe webhook at `/stripe`, restart. |
| → Polar | Set `BILLING_PROVIDER=polar`, set `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` / the eight `POLAR_PRICE_*` ids (and `POLAR_SERVER=sandbox` for testing), point the Polar webhook at `/payment-webhook`, restart. |

`BILLING_ENABLED` is orthogonal to both — it stays `true` across a provider switch.

No schema change either way — `Organization.paymentId` holds whichever provider's customer id, and the `Subscription` table has no provider-specific columns.

**Mixed-state caveat:** if any org subscribed via Stripe and others via Polar, `paymentId` values are not interchangeable — the newly active provider will fail to find those customers and will create new ones, leaving the original subscription live and billing at the old provider. There is no migration path in the code for this. Only do a clean cutover before real customers exist, or write a reconciliation script first.

---

## 8. Known cleanup items

Not blocking, but worth tracking:

1. **`.env.prod` is tracked by git and holds real credentials.** `.gitignore` now lists it, but that does not untrack an already-tracked file — run `git rm --cached .env.prod` and commit. Its Polar sandbox token and ngrok authtoken are in the repo history regardless, so rotate them. **Do not put the Stripe secret key in this file until it is untracked.**
2. **`POLAR_PRICE_*` naming** — `getConfiguredProductId()` (`polar.service.ts:198-207`) prefers `POLAR_PRODUCT_{TIER}_{PERIOD}` and falls back to `POLAR_PRICE_{TIER}_{PERIOD}`, then does a `/v1/products` scan to resolve a price id to its product id. `.env.prod` uses the `POLAR_PRICE_*` form. Setting `POLAR_PRODUCT_*` instead skips the extra API call and the in-memory cache entirely — simpler and one fewer failure mode.
3. **`getPackages()` is dead code** — `stripe.service.ts:175-199` early-returns `{}` before touching Stripe. Still exposed via `users.controller.ts:181`. Upstream quirk; harmless.
4. **Webhook handling isn't on the interface** — adding a third provider means adding a third controller. Fine for two providers; revisit if a third appears.
5. **Polar feature gaps** — `finishTrial`, `checkDiscount`/`applyDiscount`, `prorate` and in-place upgrades are all stubs or degraded (section 3). Only matters when Polar comes back.
