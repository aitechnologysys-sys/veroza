# Upstream sync log

One entry per sync step: what was merged, how it was verified, how conflicts were
resolved, and the decisions made. Rules live in [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md);
the procedure is the `/upstream-sync` skill (`.claude/skills/upstream-sync/SKILL.md`).

## Sync of November 2026: catching up from v2.21.8 (29 May) to upstream main

Branch `chore/upstream-sync-2026-11-07`, cut from `origin/main` at `45ea7360a`. Plan:

| Step | Target | Upstream commits | Schema change | Status |
|---|---|---|---|---|
| 1 | `v2.23.0` (folds in v2.21.9, v2.21.10, v2.22.1) | 170 | no | **done**: `1102d44f` |
| 2 | `v2.24.0` | 269 | yes, about 880 lines | pending |
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
