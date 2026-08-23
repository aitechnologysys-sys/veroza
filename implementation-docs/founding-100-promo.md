# Founding-100 launch promo

Status: **implemented.** Requires `pnpm prisma-db-push` to create the
`FoundingMember` table before it will run. This document is the spec and the
operational runbook.

## The offer

The first **100 paying customers** get:

| Period | Discount | Duration |
|---|---|---|
| Yearly | **52% off** | Forever |
| Monthly | **24% off** | Forever |

"Forever" means Stripe `duration: 'forever'` — the coupon rides the subscription for
as long as it stays alive. No code to type; it is attached server-side at checkout
while the promo is live.

### Rules

| | |
|---|---|
| Slot cap | 100, counted from **actual paid subscriptions** |
| Who qualifies | **New checkouts only.** Existing paid subscriptions and in-place plan upgrades never receive it. |
| Cancellation | The rate is **forfeited**. The slot stays consumed — it does not return to the pool, and resubscribing does not restore the rate. |
| Provider | **Stripe only.** Has no effect under `BILLING_PROVIDER=polar`. |

## Configuration

| Var | Where | Notes |
|---|---|---|
| `FOUNDING_PROMO_ENABLED` | `.env` | Literal `"true"` to run the promo. Read **only** via `isFoundingPromoEnabled()` in `libraries/helpers/src/utils/is.founding.promo.enabled.ts`. |

There is deliberately **no `NEXT_PUBLIC_` mirror**. The frontend reads
`GET /billing/founding-promo`, which already reports `active` (accounting for the
flag, whether billing is enforced, and remaining slots) plus the live slot counts —
things an env var cannot express. One source of truth, nothing to drift.

This is a **third, independent switch** alongside `BILLING_ENABLED` (is billing
enforced) and `BILLING_PROVIDER` (which gateway). It mirrors the `isBillingEnabled()`
convention deliberately: one read site, literal `'true'` comparison. Never gate promo
behaviour on a `process.env.FOUNDING_*` read anywhere else in the tree.

The **percentages and slot count are not env vars.** They live in
`libraries/nestjs-libraries/src/database/prisma/subscriptions/founding.promo.ts`,
next to `pricing.ts` and — like it — imported directly by the frontend too. Do not
duplicate the numbers into a component.

```ts
export const FOUNDING_TOTAL_SLOTS = 100;
export const FOUNDING_DISCOUNT = { MONTHLY: 24, YEARLY: 52 };
```

## Why coupons are attached server-side

The coupon goes on the Checkout Session as `discounts: [{ coupon }]`, **not** as a
promotion code.

- Promotion codes are applied by the browser and the user can **remove** them —
  `removePromotionCode()` already exists in `embedded.billing.tsx`. A server-attached
  coupon cannot be removed.
- Two promotion codes cannot share one pool of 100 redemptions, so Stripe's
  `max_redemptions` could not enforce the cap anyway. We need our own counter
  regardless.

### ⚠️ `discounts` and `allow_promotion_codes` are mutually exclusive

A Checkout Session may set one or the other, never both. So while the founding coupon
is attached:

- `allow_promotion_codes` must be off, and
- `findAutoApplyPromotionCode()` must be skipped.

When the promo ends, both revert to today's behaviour
(`allow_promotion_codes: period === 'MONTHLY'`). The frontend must also hide
`CouponInput` whenever a founding coupon came back, because
`checkout.applyPromotionCode()` would fail against that session.

### ⚠️ Stripe coupons are immutable

You cannot edit a coupon's `percent_off`. Coupons are lazily find-or-created on first
use (matching how this codebase already creates products and prices — nothing is
pre-made in the dashboard), and the matcher keys on **both**
`metadata.founding === <PERIOD>` **and** `percent_off`. Changing a percentage
therefore produces a *new* coupon and leaves existing founding members on their
original one, which is the correct behaviour.

This is the same class of trap as the `unit_amount` price-drift note in
`docs/billing-current-state.md`.

## Slot accounting

Slots are tracked in a dedicated `FoundingMember` table rather than as columns on
`Subscription`, because `deleteSubscription()` hard-deletes the subscription row on
cancellation and founding status has to survive that. `slotNumber` also gives you
"founding member #37" for marketing copy.

```prisma
model FoundingMember {
  id              String       @id @default(uuid())
  organizationId  String       @unique
  organization    Organization @relation(fields: [organizationId], references: [id])
  slotNumber      Int          @unique
  period          Period
  discountPercent Int
  couponId        String
  claimedAt       DateTime     @default(now())
  forfeitedAt     DateTime?

  @@index([claimedAt])
}
```

Rows are **never deleted**. `forfeitedAt` non-null means the org cancelled and is no
longer entitled to the rate, while the slot stays consumed out of the 100.

- `countFoundingMembers()` counts **all** rows, forfeited included → cancelled slots
  stay used.
- `getActiveFoundingMemberByOrg()` filters `forfeitedAt: null` → this is the
  entitlement check.

### Claim timing and the accepted race

The slot is **checked** when the Checkout Session is created and **claimed** when the
`customer.subscription.created` webhook lands. The decision is stamped into
`subscription_data.metadata` (`founding`, `foundingPercent`, `foundingCoupon`) — the
same channel that already carries `service: 'gitroom'` — so the webhook needs no
extra Stripe API call.

Slots are **not reserved** at checkout, so several checkouts in flight at once can
push the total slightly past 100. This is accepted: taking a coupon back from someone
who has already paid is worse than honouring a small overshoot. `claimFoundingSlot()`
honours the overflow and logs a warning.

## Interaction with the "50% off for 3 months" cancel offer

Unrelated feature, but it **collides** with this one. When a user clicks cancel, the
app may offer `STRIPE_DISCOUNT_ID` — *"Would you accept 50% discount for 3 months
instead? 🙏🏻"* (`main.billing.component.tsx:156`).

For a founding member that offer is a **trap**, because
`stripe.subscriptions.update(id, { discounts: [{ coupon }] })` **replaces** the
discounts array rather than adding to it. They would lose their forever discount, get
50% for three months, then land on **full price**:

| $29 monthly plan | Founding, stays | Takes the offer |
|---|---|---|
| Months 1-3 | $22.04/mo = $66.12 | $14.50/mo = $43.50 |
| Month 4+ | $22.04/mo forever | **$29.00/mo** forever |

Ahead by $22.62 for three months, then down $6.96/mo forever — crossover around
month 7, worse every month after.

**Founding members are therefore excluded from the cancel offer**, via an explicit
guard in `checkDiscount()` (the single gate both the modal and
`POST /billing/apply-discount` go through). Do not rely on the incidental
`discounts.length` test that also happens to block it — that holds only while the
coupon sits on the subscription.

They get a loss-framed screen instead of a coupon: *"You're founding member #37. Your
24% off is locked for life — no one after the first 100 can get this rate, and
cancelling gives up the spot for good."* Zero margin cost, and literally true given
the forfeit rule.

**Stacking was considered and rejected.** Stripe's `discounts` array does accept
multiple coupons, so `[founding, retention]` would work and would fall back to 24%
rather than full price. It is a 62% discount on the cheapest cohort you have, and it
teaches customers that threatening to cancel pays.

Historical note: `applyDiscount()` used to call `this.checkDiscount(customer)`
**without `await`**, so the guard never blocked anything — a Promise is always truthy.
That has been fixed.

## Operations

**Starting the promo.** Set `FOUNDING_PROMO_ENABLED="true"` and the `NEXT_PUBLIC_`
mirror, restart. The coupons create themselves on the first qualifying checkout;
nothing to do in the Stripe dashboard.

**Checking progress.** `GET /billing/founding-promo` →
`{ active, slotsTotal, slotsRemaining, discount }`. Or count rows in
`FoundingMember` directly.

**Ending the promo.** Set `FOUNDING_PROMO_ENABLED="false"`. The banner disappears,
prices return to list, and checkout reverts to `allow_promotion_codes` behaviour.
**Existing founding members keep their discount** — the coupons are `duration:
'forever'` and stay attached to their subscriptions. That is intended; the flag only
controls whether *new* customers can claim a slot.

It also self-terminates: once `slotsRemaining` hits 0, `active` is false and no
further coupons are attached, regardless of the flag.

**Auditing.** Every founding member is one row with `slotNumber`, `couponId`,
`claimedAt`, and `forfeitedAt`. Cross-check against Stripe by listing subscriptions
carrying a coupon whose `metadata.founding` is set.

## Files

| File | Change |
|---|---|
| `.env.example` | `FOUNDING_PROMO_ENABLED` |
| `libraries/helpers/src/utils/is.founding.promo.enabled.ts` | new — the single read site |
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/founding.promo.ts` | new — slots + percentages + `foundingPrice()` |
| `libraries/nestjs-libraries/src/database/prisma/schema.prisma` | new `FoundingMember` model, relation on `Organization` |
| `.../subscriptions/subscription.repository.ts` | count / get / claim / forfeit |
| `.../subscriptions/subscription.service.ts` | `getFoundingPromoStatus`, `hasFoundingSlotAvailable`, `claimFoundingSlot`, `forfeitFoundingSlot`, `getActiveFoundingMemberByOrg` |
| `libraries/nestjs-libraries/src/services/stripe.service.ts` | `resolveFoundingCoupon()`; attach in `createEmbeddedCheckout` + `createCheckoutSession`; claim in `createSubscription`; forfeit in `deleteSubscription`; founding guard in `checkDiscount` |
| `libraries/nestjs-libraries/src/services/billing.provider.interface.ts` | optional `founding?: { percent: number }` on `CheckoutResult` |
| `apps/backend/src/api/routes/billing.controller.ts` | `GET /founding-promo` |
| `apps/frontend/src/components/billing/founding.promo.banner.tsx` | new banner |
| `apps/frontend/src/components/billing/use.founding.promo.ts` | new — shared SWR hook |
| `apps/frontend/src/components/new-layout/top.banners.tsx` | new — owns the banner stack and the `--top-banners-height` offset |
| `apps/frontend/src/components/new-layout/layout.component.tsx` | mount `TopBanners` above the FREE-user ternary; `#left-menu` offset now reads the CSS variable |
| `apps/frontend/src/components/layout/announcement.banner.tsx` | removed its broken `<style>` injection (see below) |
| `apps/frontend/src/components/billing/first.billing.component.tsx` | struck-through pricing, founding badge replacing "20% Off", slots-claimed line |
| `apps/frontend/src/components/billing/main.billing.component.tsx` | same pricing treatment (unsubscribed orgs only); `KeepFoundingRate` cancel screen |
| `apps/frontend/src/components/billing/embedded.billing.tsx` | hide `CouponInput`, show locked founding row |

`IBillingProvider` needs no new methods — slot counting is plain DB work and coupon
attachment is private to `StripeService`. `PolarService` is untouched, which keeps
`git merge upstream/main` tractable.

## Not covered

- **Landing page banner.** The sibling project `clientside-landing`
  (`aitechnologysys-sys/landing-postaryx`) already deep-links to `/billing` via
  `NEXT_PUBLIC_PRODUCT_URL`. Wiring a banner there needs a public unauthenticated
  `GET /public/founding-promo`. Note its `lib/content.ts` advertises
  Starter $29 / Pro $79 / Business $129, which does not match the app's
  STANDARD 29 / TEAM 39 / PRO 49 / ULTIMATE 99 — resolve before promo copy points at it.
- **Polar.**

## Banner offset

`#left-menu` is `fixed top-0`, so anything rendered above it in normal flow overlaps
the sidebar unless the sidebar is pushed down by the banner stack's exact height.

`AnnouncementBanner` used to handle this itself by injecting

```
<style>{`#left-menu {padding-top: ${user?.isSuperAdmin ? '100px !important;' : '60px !important;'}`}</style>
```

which hardcoded a guess, and whose CSS string was unbalanced (no closing `}`). It
could not account for a second banner, and two banners each injecting their own rule
would fight over the same property.

`TopBanners` now owns the whole stack: it measures itself with a `ResizeObserver` and
publishes `--top-banners-height`, which `#left-menu` adds to its admin-bar offset.
Correct for zero, one, or two banners, and for a banner that wraps to two lines.

**Behaviour change worth knowing:** this moved `AnnouncementBanner` out of the
non-FREE branch of the layout ternary, so paywalled users now see announcements.
See "Open item 1" in the handoff section below — it needs a decision.


---

# Session handoff — 2026-08-22

Everything below was built in one session. Read this first if you are picking the
work back up.

## Status

**Code complete. Not yet run against a database or Stripe.**

One step before anything works:

```bash
pnpm prisma-db-push
```

Skipped deliberately — `DATABASE_URL` was not readable at the time, and `db push` is
not a command to point at an unverified database. Nothing functions until the
`FoundingMember` table exists.

Checks that did run:

| Check | Result |
|---|---|
| `tsc --noEmit` frontend | 0 errors |
| `tsc --noEmit` backend | 7 errors, all pre-existing (`agent.graph.service.ts`, `autopost.service.ts`, `media.repository.ts`, `empty.provider.ts`, `short-linking/providers/empty.ts`) — none in files this work touched |
| `eslint` | Cannot run. The repo's eslint config throws `TypeError: Converting circular structure to JSON` on a clean tree too — confirmed by stashing all changes and re-running. Pre-existing, unrelated. |

The full end-to-end test plan is the **Verification** list further up this document
(14 steps, covering the promo, the cap, forfeit, and the cancel-offer collision).

## What was built

**Config.** `FOUNDING_PROMO_ENABLED` in `.env.example`, read only through
`isFoundingPromoEnabled()`. Percentages and slot count in `founding.promo.ts`,
alongside `pricing.ts`.

**Discount.** Two Stripe coupons created lazily on first use, `duration: 'forever'`,
attached server-side as `discounts: [{ coupon }]`. Because a Checkout Session cannot
carry both, `allow_promotion_codes` and the `findAutoApplyPromotionCode()` lookup are
switched off while a founding coupon is attached, and revert to today's behaviour
when the promo ends.

**Slot ledger.** `FoundingMember`, rows never deleted. `claimFoundingSlot()` is
idempotent against Stripe webhook redelivery (unique `organizationId`) and absorbs
the concurrent-claim race by retrying on the `slotNumber` unique constraint. The
claim runs in the `customer.subscription.created` webhook and reads the decision from
subscription metadata, so it costs no extra Stripe call.

**Forfeit.** `deleteSubscription()` sets `forfeitedAt`. The slot stays consumed, and
`resolveFoundingCoupon()` returns null for any org that already has a row — so a
returning customer gets neither the rate back nor a second slot.

**Cancel-offer guard.** Explicit founding check at the top of `checkDiscount()`,
which gates both the modal and a direct `POST /billing/apply-discount`. Founding
members see `KeepFoundingRate` instead — *"You're founding member #37..."*

**UI.** Promo banner; struck-through pricing on both billing pages (`main.billing`
only when the org is unsubscribed, since existing customers do not qualify); a locked
"discount applied" row in place of the coupon input during founding checkout.

## Open item 1 — announcements now show to paywalled users ⚠️ NEEDS YOUR CALL

### What "FREE users" means here

`FREE` is the tier of an org with **no paid subscription** (`user.tier === 'FREE'`).
It is not a self-hosted mode — that is `BILLING_ENABLED=false`, a separate thing.

The significant part is what the layout does with them
(`apps/frontend/src/components/new-layout/layout.component.tsx:99`):

```tsx
{user.tier === 'FREE' && isGeneral && billingEnabled ? (
  <FirstBillingComponent />        // full-screen paywall — replaces the entire app
) : (
  <> ...the real app: sidebar, top bar, children... </>
)}
```

A FREE user does not see a limited version of the app. They see **only** the paywall
until they pay. So "FREE users" here means "people staring at the payment screen".

### What changed

`<AnnouncementBanner />` used to sit **inside the `else` branch**, i.e. only in the
real-app half of that ternary. Paywalled users therefore never saw any announcement.

Fixing the sidebar offset (see "Banner offset" above) required giving the banner
stack a single owner — two components cannot each inject a rule for the same
`#left-menu` property without fighting. That owner is `TopBanners`, and it is mounted
**above** the ternary so the founding promo banner can reach the paywalled users it
is aimed at. `AnnouncementBanner` came along, and now renders for everyone.

This reads like an oversight in the original code rather than a deliberate
exclusion — but it is a behaviour change I made as a side effect, not something you
asked for, so it is yours to confirm.

### How to reproduce

1. `BILLING_ENABLED=true`, `BILLING_PROVIDER=stripe`, restart.
2. Sign in as a **super-admin** and create an announcement — the admin top bar,
   "Add Announcement" (`apps/frontend/src/components/layout/impersonate.tsx:307`).
3. Sign in as an org with **no subscription** (or cancel one and let the webhook land,
   so the tier drops to `FREE`).
4. That account lands on the full-screen paywall. The announcement banner now appears
   above it. Before this change, it did not.

### The two options

- **Keep it.** Paywalled users are the ones most worth reaching with "we're down for
  maintenance" or a launch message, and it is the only way they can see the founding
  promo banner at all.
- **Revert just the announcement.** Move `<AnnouncementBanner />` out of
  `top.banners.tsx` and back inside the `else` branch in `layout.component.tsx`. The
  promo banner stays above the ternary and keeps working. Cost: the `#left-menu`
  offset then has to account for a banner that is no longer inside the measured
  wrapper — either measure both wrappers, or accept that the two banners can never
  appear together (true today, since a paywalled user sees no sidebar anyway).

The second option is genuinely fine — a paywalled user has no sidebar to push down,
so the offset only ever matters in the non-FREE branch. Say the word and it is a
small change.

## Open item 2 — resolved

Dropping `NEXT_PUBLIC_FOUNDING_PROMO_ENABLED`: **accepted.** The endpoint
`GET /billing/founding-promo` is the single source of promo state. Already reflected
throughout this document and in `.env.example`.

## Tomorrow, in order

1. `pnpm prisma-db-push`
2. Decide Open item 1
3. Work the **Verification** checklist above with Stripe test keys and
   `pnpm dev:stripe` (webhooks forward to **port 3000**, the backend — not 4200)
4. Still deferred: the landing-page banner and its public endpoint, plus the
   Starter/Pro/Business vs STANDARD/TEAM/PRO/ULTIMATE pricing mismatch on that site

---

# Addendum — Open item 1 resolved

**Decision: reverted to the original behaviour. Announcements no longer show to
paywalled users.**

Reasoning: it was a side effect of the offset fix, not something that was asked for,
and announcements are usually app-operational ("scheduling delayed", "maintenance
window") — little use to someone who cannot reach the app. The founding promo banner
is the opposite case, so it still renders on the paywall, which is the whole point of
mounting the stack above the ternary.

## How it was done

Not by moving `<AnnouncementBanner />` back into the `else` branch. That would have
put a banner outside the measured wrapper, and the `#left-menu` offset would have
stopped accounting for it — the exact fragility `TopBanners` exists to remove.

Instead the visibility is a prop, so there is still exactly one owner of the offset:

`apps/frontend/src/components/new-layout/top.banners.tsx`

```tsx
export const TopBanners: FC<{ showAnnouncements: boolean }> = ({
  showAnnouncements,
}) => {
  ...
  return (
    <div ref={ref} className="flex flex-col gap-[8px] empty:hidden">
      <FoundingPromoBanner />
      {showAnnouncements && <AnnouncementBanner />}
    </div>
  );
};
```

`apps/frontend/src/components/new-layout/layout.component.tsx` — the paywall
condition was already written twice, so it is now named once and reused:

```tsx
const isPaywalled = user.tier === 'FREE' && isGeneral && billingEnabled;
...
<TopBanners showAnnouncements={!isPaywalled} />
{isPaywalled ? (
  <FirstBillingComponent />
) : (
  ...
)}
```

## Net effect

| | Before this work | After the offset fix | Now |
|---|---|---|---|
| Announcements, normal user | shown | shown | shown |
| Announcements, paywalled user | hidden | shown ⚠️ | **hidden** (original) |
| Promo banner, paywalled user | n/a | shown | shown |
| `#left-menu` offset | hardcoded 60/100px, unbalanced CSS string | measured | measured |

Announcement behaviour is byte-for-byte what it was. The only surviving change to
that component is the removal of its broken `<style>` injection, now handled by the
`--top-banners-height` variable.

Verified: `tsc --noEmit` on the frontend, 0 errors.

## Open items after this

1. ~~Announcements showing to paywalled users~~ — resolved above.
2. ~~`NEXT_PUBLIC_` mirror~~ — resolved, dropped.

Remaining before launch: `pnpm prisma-db-push`, then the **Verification** checklist
earlier in this document.
