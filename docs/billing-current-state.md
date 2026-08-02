# Billing — Current State, Stripe Enablement, and Stripe Test-Mode Setup

**Status as of 2026-08-02.** Authoritative description of what is actually in the tree today.

Companion docs:
- `docs/stripe-implementation.md` — how Stripe worked *before* the migration. Still accurate for the Stripe code path (that code is untouched), but its "Architecture Overview" is now out of date.
- `docs/polar-integration-plan.md` — the plan that was written *before* the Polar work. Partially superseded; see [Where reality diverges from the plan](#where-reality-diverges-from-the-plan).

---

## TL;DR

1. Both `StripeService` and `PolarService` exist and both implement `IBillingProvider`. The active one is chosen at runtime by `BILLING_PROVIDER` (`polar` → Polar, anything else including unset → Stripe).
2. **Stripe was never removed.** Re-enabling it is an env-var change plus a webhook endpoint — no code changes.
3. **The real kill-switch is still `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY`**, not `BILLING_PROVIDER`. This is the single most important thing in this document — see [The Stripe env vars are still the global billing gate](#-the-stripe-env-vars-are-still-the-global-billing-gate). Right now (`.env.prod` has `STRIPE_PUBLISHABLE_KEY` commented out) the app runs in **unlimited self-hosted mode**: every org is treated as ULTIMATE with 10 000 channels and no permission checks, even though Polar checkout works and writes real `Subscription` rows.
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

## 2. ⚠️ The Stripe env vars are still the global billing gate

Upstream Postiz uses `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` as a proxy for *"is this a paid SaaS deployment or a free self-hosted one?"*. The Polar migration added `BILLING_PROVIDER` but **did not replace those checks**. They are scattered across backend, frontend, and orchestrator:

| File:line | Check | Effect when Stripe key is unset |
|---|---|---|
| `apps/backend/src/api/routes/users.controller.ts:79` | `!STRIPE_PUBLISHABLE_KEY` | `totalChannels` = 10 000 |
| `apps/backend/src/api/routes/users.controller.ts:81` | `!STRIPE_PUBLISHABLE_KEY` | tier reported as `ULTIMATE` |
| `apps/backend/src/api/routes/users.controller.ts:88` | `!STRIPE_PUBLISHABLE_KEY` | `isTrailing` forced to `false` |
| `apps/backend/src/services/auth/permissions/permissions.service.ts:27` | `!STRIPE_PUBLISHABLE_KEY` | default tier `PRO` instead of `FREE` |
| `apps/backend/src/services/auth/permissions/permissions.service.ts:52` | `!STRIPE_PUBLISHABLE_KEY` | **all permission checks short-circuit to allowed** |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts:259` | `!!STRIPE_PUBLISHABLE_KEY` | channel-count limit not enforced |
| `libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts:233` | `STRIPE_PUBLISHABLE_KEY` | team-member restriction for STANDARD tier not enforced |
| `apps/backend/src/api/routes/media.controller.ts:60` | `STRIPE_PUBLISHABLE_KEY` | AI credit exhaustion not enforced |
| `apps/backend/src/api/routes/no.auth.integrations.controller.ts:202` | `STRIPE_PUBLISHABLE_KEY` | (integration gating) |
| `apps/backend/src/services/auth/public.auth.middleware.ts:31,49` | `!!STRIPE_SECRET_KEY` | public API usable without a subscription |
| `apps/orchestrator/src/activities/post.activity.ts:115,133,209` | `STRIPE_SECRET_KEY` | posts publish without a subscription check |
| `apps/frontend/src/app/(app)/layout.tsx:65` (and `(provider)`, `(extension)`) | `!!STRIPE_PUBLISHABLE_KEY` → `billingEnabled` | billing UI, upgrade prompts, wallet login, Chrome-extension banner, event tracking all hidden |

### What this means today

`.env.prod` has `BILLING_PROVIDER=polar` and `STRIPE_PUBLISHABLE_KEY` commented out. So the current deployment is:

- ✅ Polar checkout works, webhooks work, `Subscription` rows get written
- ❌ Nothing is **enforced** — every org behaves as ULTIMATE/unlimited
- ❌ `billingEnabled` is `false` in the frontend, so the billing page, upgrade CTAs and the pricing modal are hidden — users cannot reach checkout through normal UI

That combination is only correct if you intend to ship free/unlimited for now. If you intend to actually sell, this has to be fixed.

### Recommended fix (not yet implemented)

Introduce one explicit flag and route every check through it, instead of piggybacking on a Stripe key:

```bash
BILLING_ENABLED=true        # is billing enforced at all?
BILLING_PROVIDER=polar      # which gateway, when enabled
```

Mechanically: add `BILLING_ENABLED` to `.env`, replace the 15 call sites above with it, and in the three frontend layouts change `billingEnabled={!!process.env.STRIPE_PUBLISHABLE_KEY}` to `billingEnabled={process.env.BILLING_ENABLED === 'true'}`. Keep `stripeClient={process.env.STRIPE_PUBLISHABLE_KEY}` as-is — that one genuinely is Stripe-specific (it feeds `loadStripe()`).

This diverges from upstream, so it should be a single well-labelled commit to keep future merges readable.

**Interim workaround if you need enforcement on today's code without that refactor:** set `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY` to any non-empty Stripe *test* values while leaving `BILLING_PROVIDER=polar`. The gates flip on, and no Stripe API call is ever made because `BILLING_PROVIDER` routes everything to `PolarService`. It's a hack — the `STRIPE_PUBLISHABLE_KEY` value would also be handed to `loadStripe()` in the frontend — but it unblocks testing enforcement.

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
| Replace `STRIPE_PUBLISHABLE_KEY` gate with `BILLING_ENABLED` / `NEXT_PUBLIC_BILLING_PROVIDER` | **Not done** — see section 2 |
| `lifetimeDeal` not mentioned | Part of the interface, implemented by both providers |

Keeping Postiz's original method names was the right call for merge-ability with upstream, and is consistent with the "stay close to upstream" goal.

---

## 5. How to enable Stripe

No code changes required. Stripe is the **default** provider — you get it by not setting `BILLING_PROVIDER=polar`.

### 5.1 Environment variables

```bash
# Provider selection — omit entirely, or set to anything other than "polar"
BILLING_PROVIDER=stripe

# Required
STRIPE_PUBLISHABLE_KEY=pk_test_...   # frontend: loadStripe() + the global billing gate (see section 2)
STRIPE_SECRET_KEY=sk_test_...        # backend: every Stripe API call
STRIPE_SIGNING_KEY=whsec_...         # webhook signature verification

# Optional
STRIPE_DISCOUNT_ID=                  # coupon id for the loyalty-discount feature; if unset, checkDiscount() returns false
```

Notes:
- `STRIPE_SIGNING_KEY_CONNECT` appears in `.env.example` but is **not referenced anywhere in the code**. Ignore it.
- `FEE_AMOUNT` in `.env.example` is likewise unreferenced.
- `STRIPE_PUBLISHABLE_KEY` is read at **build time** by Next.js in `apps/frontend/src/app/(app)/layout.tsx`. Changing it requires a frontend rebuild, not just a restart.
- Leave the Polar vars in place — they're inert when `BILLING_PROVIDER !== 'polar'`. Rolling back is a one-line env change.

### 5.2 Webhook

Endpoint: `POST https://<backend-host>/stripe`

Events to subscribe (`apps/backend/src/api/routes/stripe.controller.ts:38-49`):

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

Filtering behaviour: the controller drops any event whose `data.object.metadata.service !== 'gitroom'`, except `invoice.payment_succeeded` which is always processed. **Postiz stamps `service: 'gitroom'` on Stripe subscription metadata; the Polar path stamps `service: 'postiz'`.** If you ever change that string on the Stripe side, the webhook will start silently no-op'ing on every event — the endpoint returns `{ ok: true }` with no log.

### 5.3 Local development

`package.json` already has a script for this:

```bash
pnpm dev:stripe
# = stripe listen --forward-to localhost:3000/stripe  +  pnpm run dev
```

Requires the [Stripe CLI](https://stripe.com/docs/stripe-cli) and `stripe login`. `stripe listen` prints a `whsec_...` on startup — that is the value for `STRIPE_SIGNING_KEY` in local dev (it is **not** the same as the dashboard's signing secret).

### 5.4 Verification checklist

1. `GET /billing/` returns the org's subscription (or `null`) rather than erroring.
2. `POST /billing/embedded` with `{ billing: "STANDARD", period: "MONTHLY" }` returns a `client_secret` (Stripe) rather than a `url` (Polar) — that's the quickest confirmation of which provider is bound.
3. Check the Stripe test dashboard → Products: `STANDARD` should now exist with a `$29.00/month` price, auto-created by the call above.
4. Complete a checkout with test card `4242 4242 4242 4242`; confirm a `Subscription` row appears and `Organization.paymentId` is a `cus_...`.
5. Confirm `Organization.allowTrial` flipped to `false` and `isTrailing` reflects the Stripe status.

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
| → Stripe | Set `BILLING_PROVIDER=stripe` (or remove it), set the three `STRIPE_*` vars, point the Stripe webhook at `/stripe`, rebuild the frontend. |
| → Polar | Set `BILLING_PROVIDER=polar`, set `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` / the eight `POLAR_PRICE_*` ids (and `POLAR_SERVER=sandbox` for testing), point the Polar webhook at `/payment-webhook`. |

No schema change either way — `Organization.paymentId` holds whichever provider's customer id, and the `Subscription` table has no provider-specific columns.

**Mixed-state caveat:** if any org subscribed via Stripe and others via Polar, `paymentId` values are not interchangeable — the newly active provider will fail to find those customers and will create new ones, leaving the original subscription live and billing at the old provider. There is no migration path in the code for this. Only do a clean cutover before real customers exist, or write a reconciliation script first.

---

## 8. Known cleanup items

Not blocking, but worth tracking:

1. **`BILLING_ENABLED` refactor** — section 2. The highest-value item; billing is not actually enforced today.
2. **`POLAR_PRICE_*` naming** — `getConfiguredProductId()` (`polar.service.ts:198-207`) prefers `POLAR_PRODUCT_{TIER}_{PERIOD}` and falls back to `POLAR_PRICE_{TIER}_{PERIOD}`, then does a `/v1/products` scan to resolve a price id to its product id. `.env.prod` uses the `POLAR_PRICE_*` form. Setting `POLAR_PRODUCT_*` instead skips the extra API call and the in-memory cache entirely — simpler and one fewer failure mode.
3. **`.env.example` is Stripe-only** — no `BILLING_PROVIDER` or `POLAR_*` entries. Anyone setting up fresh from it gets no billing.
4. **Secrets are committed in `.env.prod`** — the file is tracked by git (`.gitignore` covers `.env` only, not `.env.prod`), and it currently contains a live Polar sandbox access token, the Polar webhook secret, and an ngrok authtoken. Sandbox credentials, so low severity today — but this file must not gain production credentials in its current form. Add `.env.prod` to `.gitignore`, `git rm --cached` it, and rotate the tokens before going live.
5. **`getPackages()` is dead code** — `stripe.service.ts:175-199` early-returns `{}` before touching Stripe. Still exposed via `users.controller.ts:181`. Upstream quirk; harmless.
6. **Webhook handling isn't on the interface** — adding a third provider means adding a third controller. Fine for two providers; revisit if a third appears.
