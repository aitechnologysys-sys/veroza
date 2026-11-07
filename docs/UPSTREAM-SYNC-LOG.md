# Upstream sync log

One entry per sync step: what was merged, how it was verified, how conflicts were
resolved, and the decisions made. Rules live in [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md);
the procedure is the `/upstream-sync` skill (`.claude/skills/upstream-sync/SKILL.md`).

## Sync of November 2026: catching up from v2.21.8 (29 May) to upstream main

Branch `chore/upstream-sync-2026-11-07`, cut from `origin/main` at `45ea7360a`. Plan:

| Step | Target | Upstream commits | Schema change | Status |
|---|---|---|---|---|
| 1 | `v2.23.0` (folds in v2.21.9, v2.21.10, v2.22.1) | 170 | no | **done**: `1102d44f` |
| – | `chore/fix-test-harness` (our branch, cut from `main`) | – | – | **merged in**: `896422ea` (own PR to `main` too) |
| 2 | `v2.24.0` | 269 | yes, about 880 lines | **done**: `9902dbad` |
| 3 | `v2.25.1` (folds in v2.25.0) | 304 | small | pending |
| 4 | `v2.25.3` / `upstream/main` | 160 + 56 | tiny | pending |

---

## Step 1 (`v2.23.0`) is merged and verified

Merged and committed on 7 Nov 2026 as `1102d44f`. 170 upstream commits; 41 conflicted files; 129 files changed in total. No push.

**Verification**

- Backend, orchestrator and frontend all build (`nest build` x2, `next build`). The frontend type-checks clean.
- `scripts/check-banned-providers.mjs` passes. `git diff --check` is clean.
- **Unit tests are identical to the `origin/main` baseline.** The same 13 tests fail on both, and nothing new fails. 161 pass, including 2 new ones. (`pnpm test` itself is broken on `main`; see the testing notes below.)
- **No database change in this step.** `schema.prisma` is untouched.

**How conflicts were resolved**

| Area | Resolution |
|---|---|
| Docs (README, CLAUDE, SECURITY, CONTRIBUTING, PR template), `i18n.lock` | Kept ours. Upstream's changes were about Postiz's own CLA, CVE policy and sponsors. `i18n.lock` takes theirs |
| 15 translation files | Key-level 3-way merge. Postaryx branding kept (all 9 strings), upstream's new keys added (for example the coupon strings), the 19 keys we removed stay removed. No new "Postiz" strings came in |
| Upload limits | Kept our single source of truth (`maxUploadSizeFor`: 10 MB images / 1 GB video). Upstream's new exported `getMaxSize` is now a thin wrapper around it, so their upload-from-URL paths use our limits |
| Uploads route | Took upstream's **path-traversal security fix**, combined with our `resolveUploadDirectory` |
| YouTube | Took upstream's new resumable, chunked upload (`postPending` / `checkPostStatus` / `finalizePost`). Ported our #28 fix into `finalizePost`: a failed thumbnail never fails a published video and returns a `warning` instead. The legacy `post()` path passes the warning through. `youtube.thumbnail.spec.ts` was updated for the new upload path, with 2 new `finalizePost` tests |
| Post workflow | Upstream now starts new posts on **`postWorkflowV106`**. Our notices (`publishedNotification`: thumbnail warning, "waiting for verification") existed only in V105, so they're now wired into V106 as well. `PendingCheckResponse` can carry `warning`. V106 has never run in our production, so editing it is replay-safe |
| Orchestrator publish activity | Took upstream's split (`postSocial` / `postSocialPending` → `postSocialInternal`), keeping our `isBillingEnabled()` gate |
| Billing | Took the "another account with this email already has an active subscription" block (a provider-agnostic DB check) and the super-admin coupon tools (Stripe-only, so they call `StripeService` directly). **Disabled** `/billing/chatbase-refund` and **kept** `/billing/lifetime` (decisions below). Fixed 2 places where upstream quietly re-added `process.env.STRIPE_PUBLISHABLE_KEY` gates (`organization.service.ts`, `stripe.service.ts`) to use `isBillingEnabled()` |
| `users.controller`, `layout.tsx`, `no.auth.integrations` | Kept our `isBillingEnabled()`. Took upstream's SSRF-safe dispatcher import and `isChatBase` prop |
| Admin impersonation panel | Kept our billing-events log and added upstream's coupon modal |
| Integrations | Took the new **Tumblr** provider and kept our approval badges and `MastodonCustomProvider`. WordPress: took upstream's clearer login errors, keeping our credential-safe `logProviderError`. Pinterest: took upstream's analytics fetch, keeping our env-based base URL. TikTok and MCP config: kept our Postaryx wording |
| `docker-compose.yaml`, `.env.example` | Kept ours (we pull a prebuilt image and bind to loopback). `TUMBLR_*` env vars came in from upstream |

**Questions and your answers**

| Question | Answer |
|---|---|
| Upstream added `POST /billing/chatbase-refund`: any subscriber can self-refund up to 1 month (last payment within 60 days) and cancel at once. It writes no audit record and bypasses our refund policy | **Disable it.** Both endpoints return 404. Upstream's code is kept so future merges stay small |
| Upstream removed `POST /billing/lifetime`, but our page and `IBillingProvider.lifetimeDeal` still use it | **Keep it.** No behaviour change; it can be removed later in its own PR |
| Commit step 1? | **Yes.** Committed as `1102d44f`, not pushed |
| Tumblr arrives as a new channel. Keep it? | **Add it.** Fully wired (backend, editor, settings, icon). To enable it: create a Tumblr OAuth app with redirect `${FRONTEND_URL}/integrations/social/tumblr` and set `TUMBLR_CLIENT_ID` / `TUMBLR_CLIENT_SECRET` |

**Unit and integration tests: status and plan**

Found during this step. It applies to `main` too, not only this branch:

- `pnpm test` doesn't start. `jest.config.ts` uses `@nx/jest`, which isn't installed.
- Run with a temporary ts-jest config, **13 tests already fail on `main`**. There are three causes: an undefined path/env argument (11), ESM packages Jest can't parse (7 suites), and a missing `reflect-metadata` import (2).
- CI runs no tests at all.

Plan (agreed: "do the rest as you please"):

1. **Before step 2:** on its own branch from `main`, fix `pnpm test`, fix the 13 baseline failures, and add a CI test job. Then merge that branch into the sync branch, so steps 2–4 are tested automatically.
2. **Unit tests** on what upstream merges tend to break: `isBillingEnabled` and the Stripe/Polar `IBillingProvider` contract, the disabled refund endpoints, upload limits, `publishedNotification` in V105 and V106, and a check that fails when new "Postiz" strings appear in `en` copy.
3. **Integration tests after the sync:** the backend against real Postgres and Redis in Docker, post publishing through a Temporal test environment (`*.e2e.spec.ts` already exist), and Stripe and Polar webhook signatures.

---

## Step 2 (`v2.24.0`) is merged and verified

Merged and committed on 7 Nov 2026 as `9902dbad`. 269 upstream commits; 62 conflicted files; 254 files changed in total. No push.

**Verification**

- Backend, orchestrator and frontend all build. Type-checks are clean apart from the pre-existing "implicit any" noise that `main` has too.
- `check-banned-providers` passes (`vk.provider.ts` was deleted again). `git diff --check` is clean.
- **`pnpm test`: 277 passed, 0 failed** (19 suites; the 2 e2e suites skip as designed). The test harness branch was merged first, so this is the real `pnpm test`.
- **Database change, not applied anywhere:** `docs/migrations/2026-11-07-upstream-v2.24.0.sql`. Review notes are at the top of the file:
  - It's additive: 39 tables (mostly Mastra agent memory, plus Clipping), indexes, new nullable or defaulted columns, and `Subscription.provider DEFAULT 'stripe'`.
  - It's not purely additive in two places, without losing data: two `OAuthApp` columns become nullable, and its foreign key is re-created with `ON DELETE SET NULL`.
  - It must be applied (per `docs/database-migrations.md`) **before** deploying this code.

**How conflicts were resolved**

| Area | Resolution |
|---|---|
| **Billing architecture** | Upstream introduced its own payment-provider system (`services/payment/`: Stripe for web, RevenueCat for mobile, `Subscription.provider`). **Adopted it (your decision below).** Polar is now the `'polar'` web provider. Our `IBillingProvider` and the `'BILLING_PROVIDER'` DI token are removed. `BILLING_PROVIDER` (default `stripe`) still picks the provider for new checkouts, via a small patch to `PaymentProviderManager.getDefaultProvider`. Existing subscriptions stay with the provider on their row |
| Billing: kept ours on top | `/billing/lifetime`, the `/billing/events` audit log, admin ids on refund and cancel (optional `actorUserId` added to upstream's abstract class), Chatbase refund still disabled. `deleteSubscription(customer, provider, status)` keeps both upstream's "only the owning provider" guard and our terminal status plus soft delete. Account deletion now records `CANCELED` |
| **Stripe webhooks** (critical) | Upstream moved webhook dispatch into `StripeService.processWebhook`, which ignores events not tagged `service: 'gitroom'`. Ours are tagged `'postaryx'`, so taking theirs would have **silently dropped every Stripe webhook**. Ported our dispatch (the `'postaryx'` tag, `invoice.payment_failed`, disputes) into it, and took upstream's thin `StripeController` |
| Polar | Now extends `PaymentProviderAbstract`, with `processWebhook` (so `/payment/polar` works too; `/payment-webhook` is kept), `portalLink`, and organization-based `checkDiscount` / `applyDiscount` / `finishTrial`. `cancelAllSubscriptions` is a safe no-op when Polar owns nothing, because upstream calls it on **every** provider during account deletion and the default would have thrown |
| `isBillingEnabled()` guard | Upstream added 2 new `STRIPE_PUBLISHABLE_KEY` gates without conflicts (`clipping.service.ts`, `generate.image.tool.ts`) and 1 inside a conflict (public-API auth middleware). All 3 now use `isBillingEnabled()` |
| Uploads | Took upstream's **streaming uploads** (file type sniffed from the stream, size capped while streaming, no more buffering a 1 GB video in memory). The validation pipe is gone upstream. `getMaxSize` still wraps our `maxUploadSizeFor` (10 MB / 1 GB). Kept our R2 declared-size check, our safer Cloudflare delete-key parsing, and our local-storage path resolver, extended to accept the filesystem paths upstream's streaming cleanup passes |
| Post workflow | New posts now start on **`postWorkflowV112`** (V107–V112 are new upstream). Ported `publishedNotification` (thumbnail warning, pending verification) into V112, as was done for V106 in step 1. None of V106–V112 has run in our production, so this is replay-safe |
| YouTube | Kept our safe-thumbnail try/catch; the thumbnail is now downloaded through upstream's SSRF-safe client. Spec mock updated |
| Providers | **Mastodon custom:** upstream fixed the same instance-URL bug, so took theirs (plus `makeSecureId` and the new pending flow), but restored our `generateAuthUrl(external)` signature. Upstream's `(refresh, external)` would hand custom-instance logins the client info in the wrong parameter (#10). **Pinterest:** took upstream's new pending/finalize flow and routed all 11 URLs through our `PINTEREST_API_BASE`. **Hashnode:** both sides made the same `gql-beta` fix; kept ours (better tag handling). **Moltbook:** kept our rate-limit-aware `write()`, now on upstream's SSRF-safe client, plus upstream's `makeSecureId` (CVE fix) |
| Integration manager | Kept our approval badges and added upstream's `HIDDEN_PROVIDERS` / `MIGRATE_PROVIDERS` env switches. The OAuth reconnect guard still uses server-side state; upstream's `migrateIntegration` rejects non-migrations with the same error |
| Auth | Took **Sign in with Apple** (shown only when `APPLE_CLIENT_ID` is set) and upstream's OAuth redirect. Kept our login layout and the removed Farcaster login button |
| MCP / Public API page | Took upstream's MCP OAuth sign-in and client list, renamed the server to `postaryx` in every client config, kept our styling and docs link. **Turned off** upstream's "Add to Claude / ChatGPT / Grok" buttons and the chat-only "install the Postiz CLI" option: they point at **Postiz's** directory listings and cloud, not ours. The two new MCP servers are named "Postaryx MCP" |
| Onboarding | Kept our single-step onboarding. Upstream's new agent step (Postiz CLI and connectors) and tutorial step were not taken |
| Translations | Key-level merge as in step 1. The two shown "Sign in with Postiz" strings were rebranded in all 15 locales. Upstream's agent-onboarding keys still say "Postiz", but nothing displays them |
| Docs / config | Kept our `CLAUDE.md`, `SECURITY.md`, docker-compose files and `.env.example`, adding upstream's new vars (Apple, RevenueCat, `HIDDEN_PROVIDERS`, `MIGRATE_PROVIDERS`). `.gitignore` is the union of both. `pnpm-lock.yaml` is theirs, and it installs cleanly |
| Duplicates | Both sides had added the same `ThrottlerRealIpGuard` and the same `AuthService` import; one copy each was removed |
| `CLAUDE.md`, `docs/billing-current-state.md`, `docs/UPSTREAM-SYNC.md` | Updated for the new billing architecture, so later syncs and sessions don't follow the retired `IBillingProvider` |

**Questions and your answers**

| Question | Answer |
|---|---|
| Upstream rebuilt billing around its own provider system (overlapping our `IBillingProvider`). Adopt upstream's, with Polar as a provider, or keep ours alongside? | **Adopt upstream's.** Done as described above |
| Commit step 2? | Covered by "do the rest as you please": committed as `9902dbad`, not pushed |

Open, no decision needed to continue:
- Upstream's admin coupons tag Stripe coupons `service: 'gitroom'`. Nothing reads that tag, and `CLAUDE.md` says to ask before renaming Stripe metadata, so it was left as is.
- Upstream's `CLAUDE.md` gained useful engineering rules (a workflow that's on `origin/main` is never edited, a new version is added instead; activity parameters never change). Worth copying into ours.

**Unit and integration tests: status**

- `chore/fix-test-harness` (`b7167e6e`, cut from `main`) makes `pnpm test` work:
  - a plain ts-jest config replaces the missing `@nx/jest`;
  - a setup file loads `reflect-metadata` and sets a temporary `UPLOAD_DIRECTORY`;
  - Jest now transpiles the ESM-only packages;
  - a new **CI `Test` workflow** runs on every PR.

  On `main` it turns 13 failures into **272 passing**. It can go in as its own PR.
- Step 2 extended the ESM list for upstream's upgraded `file-type` and updated two stale mocks: the YouTube spec now stubs the SSRF-safe axios client, and the OAuth reconnect spec now mocks `migrateIntegration`.
- Next, as planned: unit tests for the billing provider selection and `processWebhook` dispatch (the `'postaryx'` tag), Polar's `cancelAllSubscriptions` no-op, upload limits, `publishedNotification` in V112, and a check against new "Postiz" strings. Integration tests after the sync.

