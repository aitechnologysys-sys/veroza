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
| 3 | `v2.25.1` (folds in v2.25.0) | 304 | small | **done**: `91db3c53` |
| 4 | `upstream/main` at `5a131eb0` (folds in v2.25.2, v2.25.3) | 216 | tiny (indexes) | **done**: `2e11b7ee` |

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

---

## Step 3 (`v2.25.1`) is merged and verified

Merged and committed on 7 Nov 2026 as `91db3c53`. 304 upstream commits; 65 conflicted files (15 of them translations); 241 files changed in total. No push.

**Verification**

- Backend, orchestrator and frontend all build.
- `check-banned-providers` passes (`vk.provider.ts` and the frontend `vk/vk.provider.tsx` were deleted again). `git diff --check` is clean. The `process.env.STRIPE_*` / `POLAR_*` reads are the same 9 config reads as before; upstream added no new billing gates.
- **`pnpm test`: 277 passed, 0 failed** (19 suites; the 2 e2e suites skip as designed). Two of our specs asserted on behaviour upstream deliberately changed and were updated (see testing notes).
- **Database change, not applied anywhere:** `docs/migrations/2026-11-07-upstream-v2.25.1.sql`. Apply it **after** the v2.24.0 file. Review notes are at the top of the file:
  - Additive: `Integration.customName`, `Post.batchId`, comment threading/anchoring columns, the `OAuthSelfHostedAuthorization` table, 5 indexes. All new columns are nullable.
  - Not purely additive, without data loss: `Comments.userId` becomes nullable (anonymous preview comments) and its foreign key is re-created with `ON DELETE SET NULL`.

**How conflicts were resolved**

| Area | Resolution |
|---|---|
| Docs (`README`, `CLAUDE`, `SECURITY`), `.env.example` | Kept ours. Added upstream's new vars to `.env.example`: `CANVA_APP_ORIGIN`, `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` (anonymous preview comments) and `MCP_SELF_HOSTED_RELAY` (documented as off; it is Postiz Cloud's relay to self-hosted instances) |
| Translations | Key-level merge as before. 150 rebranded values kept, 240 keys we removed stay removed, upstream's new keys added. One new "Postiz" string (`connector_self_hosted_description`) is only shown behind the disabled connector buttons |
| **Stripe** (`stripe.service.ts`) | Took upstream's duplicate-subscription handling (a newer live subscription for the same customer is cancelled on `customer.subscription.created`; on deletion a surviving live subscription keeps the org on its plan), `getLiveSubscriptions` (incomplete subs never count as live), cancel/un-cancel over **all** live subscriptions with `updateCancelAt`, the checkout block when a live subscription exists, and `getInvoices`. Kept ours on top: the `'postaryx'` metadata tag on cancel/un-cancel (upstream writes `'gitroom'`, which our webhook would ignore), terminal statuses (FAILED / CANCELED / EXPIRED) on every delete path, and all `BillingEvent` audit records. **Added** an audit record (`SUBSCRIPTION_CANCELED_IMMEDIATELY`) when a duplicate is auto-cancelled, because upstream issues no refund there |
| Billing controller | Both import sets; upstream's admin-only `GET /billing/invoices` and "send the cancellation email only when a cancel was actually scheduled" came in cleanly |
| Billing UI | Took upstream's redesigned plan cards, billing history page and Stripe.js load-failure message, recoloured to our orange (`#c2410c` / `#ea580c`). Kept our Polar `{ url }` redirect and the `data?.client_secret` guard, plus upstream's `blocked` refresh |
| Settings | Took upstream's move of **Integrations, Plugs and Apps into Settings tabs** (the old `/plugs` and `/third-party` pages now redirect). Upstream renamed the Developers tab to **Agents**; it stays hidden by our `SHOW_DEVELOPER_PORTAL = false`, which now also hides the OAuth-app management inside Apps, so Apps shows only Approved Apps |
| MCP / Public API page, onboarding | Upstream's new "Official connector" auth tab is wired to our `showPostizDirectoryConnectors = false` (it pointed at Postiz's directory listings, and would also have shown on any build with `NEXT_PUBLIC_VERSION`). Kept our docs-link gating, Postaryx server names and styling, plus upstream's mobile classes. Onboarding stays single-step (upstream's agent and tutorial steps not taken) |
| OAuth consent screen | Upstream moved it to `components/oauth/authorize.component.tsx` (sign-in for signed-out visitors). Rebranded strings and colours there; `proxy.ts` exempts both `/logos/` (ours) and `/oauth/authorize` (theirs) |
| Frontend restyle vs upstream's mobile layout | About 25 components: kept our tokens, radii (8px), colours and the removed Jakarta Sans font, and added upstream's `mobile:` classes. Where upstream rewrote a file we had only recoloured (preview page, plugs, third-party, select-current, manage modal, editor), took theirs and re-applied the rebrand. Purple/pink upstream colours that merged without conflict in 7 files (filters, date picker, repeat, select channels/customer, tags, mobile top bar) were recoloured too |
| Editor uploads | Took upstream's inline images and paste handling; kept our per-file limit (`isOverUploadLimit`, 10 MB images / 1 GB video) instead of their 1 GB per-batch total |
| Providers | **Nostr:** upstream fixed the same hex-key bug (#15), so took theirs. **Instagram:** upstream's checkpoint → disconnect mapping, then our code-190 classification. **YouTube:** both our `revokeToken` and upstream's `invalid_rapt` refresh message (rebranded). **Listmonk / X / Moltbook:** both import sets. **WordPress:** upstream's new User-Agent changed from `Postiz/1.0 (+https://postiz.com)` to `Postaryx/1.0 (+https://postaryx.com)` |
| Token refresh | Kept our `canRefreshToken === false` short-circuit and took upstream's error capture plus `refreshErrorMessage`. Reconnect keeps the new `expiresIn` as well as the refresh token (upstream fixed the same bug) |
| Other backend | Integrations controller: both endpoints (upstream's `PUT /:id/custom-name`, our `/approval-status`). Throttler: took upstream's IP fallback for unauthenticated routes. MCP: agent stays `postaryx`, plus upstream's tool listing |
| Workflows | No new post-workflow version in this step. Upstream edited `autopost`, `missing.post` and `streak` workflows behind `patched()` markers (replay-safe) and added `streakWorkflowV2` and `sendSingleEmailWorkflow` alongside the old ones |

**Questions and your answers**

| Question | Answer |
|---|---|
| Commit step 3? | **Yes.** Committed as `91db3c53`, not pushed |

Open, no decision needed to continue:
- **Polar gap:** upstream's `getInvoices` is not implemented for Polar (default "not supported"), so the new billing history would error for a Polar org. Polar is parked.
- **Duplicate subscriptions:** upstream cancels a duplicate Stripe subscription without refunding it. We now leave an audit record so support can refund by hand; an automatic refund would be a policy decision.
- New "Postiz" copy only behind switched-off features: `oauth/self.hosted.component.tsx` (needs `MCP_SELF_HOSTED_RELAY=true`) and the connector descriptions on the hidden Agents page.

**Unit and integration tests: status**

- `pnpm test` ran for real (no scratch config needed): 277 passed, 0 failed.
- Updated two of our specs to upstream's deliberate behaviour changes:
  - `no.auth.integrations.reconnect.spec.ts`: a missing code verifier is still rejected, now with "This connection link expired or was already used".
  - `refresh.integration.service.spec.ts`: a provider that cannot refresh still gets `refreshNeeded`, but no longer also calls `disconnectChannel` (that sent a second, cause-less email).
- Next, as planned: unit tests for the Stripe duplicate/survivor paths (the `'postaryx'` tag on cancel, terminal statuses, the new audit record), the `SHOW_DEVELOPER_PORTAL` gating of the Agents tab, and the earlier list (provider selection, Polar no-ops, upload limits, `publishedNotification`, new "Postiz" strings).

---

## Step 4 (`upstream/main` at `5a131eb0`) is merged and verified

Merged and committed on 7 Nov 2026 as `2e11b7ee`. 216 upstream commits (v2.25.2, v2.25.3 and 56 commits after it, mostly fixes); 33 conflicted files (15 of them translations). The sync branch is now **0 commits behind upstream**. No push.

Why `upstream/main` instead of stopping at `v2.25.3`: the 56 later commits are almost all provider and billing fixes (token refresh races, TikTok chunk retries, Instagram, Bluesky, invites, streaks), and the conflict count only grew from 28 to 33.

**Verification**

- Backend, orchestrator and frontend all build.
- `check-banned-providers` passes (`vk.provider.ts` deleted again). No leftover conflict markers; the only `diff --check` hit is trailing whitespace in upstream's vendored font licence (`fonts/plus-jakarta-sans/OFL.txt`), left as is. The `process.env.STRIPE_*` / `POLAR_*` reads are the same 9 config reads.
- **`pnpm test`: 277 passed, 0 failed.**
- **Database change, not applied anywhere:** `docs/migrations/2026-11-07-upstream-main-5a131eb0.sql`. Purely additive: `User.timezoneName` (nullable) and 5 indexes. Apply it after the v2.24.0 and v2.25.1 files. The two new `Post` indexes lock writes while they build, so consider `CREATE INDEX CONCURRENTLY` for those in production.

**How conflicts were resolved**

| Area | Resolution |
|---|---|
| Mechanical | VK deleted again; upstream's new `.github/workflows/deploy-aws.yml` (Postiz's own AWS deploy) **removed**, new rule in Group 3. Translations: key-level merge; the new HubSpot notice and the media-settings tooltip were rebranded in all 15 locales and in the code defaults |
| `.env.example` | Kept ours (`EMAIL_REPLY_TO` etc.) and added upstream's `SES_*`, `HUBSPOT_*` and `RUNPOD_API_URL` |
| **Stripe** | Took upstream's 3-D Secure handling when a trial is ended early or a plan changes (`getRequiredActionFromSubscription`), the trial-end fix for already-paying subscriptions, and the first-payment-only pixel tracking (`trackConversion`). **Changed its `metadata.service !== 'gitroom'` check to `'postaryx'`**, otherwise no conversion would ever be tracked. Kept our audit records: SUBSCRIPTION_CREATED, TRIAL_FINISHED, PLAN_CHANGED, PAYMENT_SUCCEEDED, plus the PAST_DUE reset on payment |
| Email | Took upstream's SES provider (opt-in with `EMAIL_PROVIDER="ses"`) and the `List-Unsubscribe` header on every provider; kept our `EMAIL_REPLY_TO` fallback |
| YouTube | Upstream fixed the same "thumbnail fails after the upload" bug, but only for `BadBody` (`PublishedWithError`); a token error still throws after the video is live. **Kept ours** (#28: never throws, returns a warning) and took their quota message, phone-verification message, `postDbId` and the media-thumbnail fallback |
| Token refresh | Took upstream's wait for a concurrent refresh and "notify only once per disconnect". Providers with `canRefreshToken === false` skip the wait (nothing can refresh them concurrently) |
| Layouts and fonts | Kept our fonts (Geist / Fraunces) in all three layouts and the main layout; upstream's Jakarta Sans font module is unused. Took upstream's removal of PostHog (we never configured it) and the user-timezone sync |
| Settings | Kept the Agents tab behind `SHOW_DEVELOPER_PORTAL`, with upstream's new "Agents / Dev" label |
| Other | Backend: kept `disarmWatchdog()`, added upstream's ALB keep-alive timeouts. Bluesky: upstream's clearer login errors plus our `logProviderError`. Local storage: kept our `resolveLocalPath` delete, which already covers upstream's path-traversal fix and tolerates missing files. Sentry: kept ours (configurable console levels, AI prompts opt-in). Onboarding: kept single step. Date picker: upstream's timezone-aware "today", our colour. Pre-condition and Discord error texts rebranded |
| Colours | 3 more upstream purples recoloured (billing, notifications, date picker) |
| Workflows | No workflow file changed. `post.activity.ts` gained internal `PublishedWithError` handling (no activity parameter change) |

**Questions and your answers**

| Question | Answer |
|---|---|
| Commit step 4 and do the finish step? | **Yes.** Committed as `2e11b7ee`, not pushed |

**Unit and integration tests: status**

- 277 passed, 0 failed. `refresh.integration.service.spec.ts` mock updated for upstream's new calls (`getIntegrationById`; `refreshNeeded` now returns whether this attempt flagged the channel).
- Still to write, as planned: Stripe `'postaryx'` tag checks (`processWebhook`, `setToCancel`, `trackConversion`), the duplicate/survivor paths and their audit records, `SHOW_DEVELOPER_PORTAL` gating, provider selection, Polar no-ops, upload limits, `publishedNotification`, and a check against new "Postiz" strings and upstream purples.

---

## Sync summary (November 2026)

- Four steps, 959 upstream commits, about 200 conflicted files in total. The branch is level with upstream `5a131eb0`.
- **Before deploying:** apply the three SQL files in order (`upstream-v2.24.0`, `upstream-v2.25.1`, `upstream-main-5a131eb0`) per `docs/database-migrations.md`, then follow `docs/CI-BUILD-CUTOVER.md`.
- **Open items:** Polar lacks `getInvoices` (billing history errors for a Polar org; Polar is parked). Duplicate Stripe subscriptions are cancelled without a refund (audit record only). Copy upstream's useful `CLAUDE.md` engineering rules into ours.
- Feature branches should merge `main` **after** this lands; rerere replays the same resolutions.
- Next sync: in 2–4 weeks.
