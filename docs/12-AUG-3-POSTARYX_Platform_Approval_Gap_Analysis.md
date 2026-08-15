# POSTARYX — Platform Approval Compliance Gap Analysis

**Entity:** Lunark Dynamics LLC · **Product:** POSTARYX
**Inputs:** Platform Approvals Manual (`platform-approvals.html`, v1 Aug 2026) · Technical Readiness Audit (`12-AUG-1`) · API Endpoint Inventory (`12-AUG-2`)
**Date:** 12 Aug 2026
**Verdict:** **Do not submit any hard-gate application in current state.** 21 items are individually sufficient grounds for rejection at Meta, LinkedIn, TikTok or Google.

---

## 0. Method, and what I could not verify

Every row below is decided by the code audit only. Nothing is credited on plausibility. Where the audit is silent, the row is marked **❌ Missing** with `audit silent` in the evidence column — that is a *verify-then-downgrade* item, not a proven absence, and I have flagged each one so you don't spend effort re-building something that may exist.

Two scope limits you should know about:

1. **I was not given your privacy policy, terms, or any legal document text** — only the manual that specifies what they must contain. So §E (legal-vs-code mismatch) is written as *"if your policy asserts X, it is currently false"*. Feed me the actual policy text and I can turn §E into line-level findings.
2. **The audit did not enumerate frontend marketing/legal routes.** The endpoint inventory covers `/auth/*`, `/integrations/*` and `/provider/*` frontend pages only. Every `/privacy`, `/terms`, `/about` row in §I is therefore unevidenced rather than proven missing. Check these first — they may be a five-minute confirmation rather than a week of work.

**Status key**

| Symbol | Meaning |
|---|---|
| ✅ | Confirmed implemented by the code audit |
| ⚠️ | Exists but incomplete, misconfigured, or non-compliant as built |
| ❌ | Not implemented, or not evidenced anywhere in the audit |

The **"In manual?"** column cites the manual section that demands the item, so you can take any disputed row back to the primary source.

---

## A. OAuth integration requirements

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| OAuth 2.0 authorization-code flow, per provider | §01C | ✅ | `integrations.controller.ts:194` → `no.auth.integrations.controller.ts:43-90`; 33 providers | — | None |
| `state` minted server-side and verified on callback | §01C | ✅ | `no.auth.integrations.controller.ts:61-70` — Redis `login:{state}`, `organization:{state}`, 3600s TTL | — | None |
| `state` from a CSPRNG, adequate length | Implied (CSRF) | ⚠️ | `make.is.ts:1-10` — `Math.random()` char-by-char, **length 6** across ~28 providers incl. Facebook, Instagram, Threads, LinkedIn, Pinterest, Reddit | High | Rewrite `makeId` on `crypto.randomBytes`; raise `state` to ≥32 chars |
| PKCE where the platform requires it (TikTok Login Kit, X) | §08, §11 | ❌ | `tiktok.provider.ts:308-345` — `codeVerifier = state`, **no `code_challenge` / `code_challenge_method` sent**; raw value submitted as verifier at `:340` | **Critical** | Implement S256 properly. Working reference already in-tree: `kick.provider.ts:27-38` |
| X app inside a Project, OAuth 2.0 **with PKCE**, Read+Write | §11 | ❌ | `x.provider.ts:350-396` — OAuth **1.0a** 3-legged via `twitter-api-v2`; `expiresIn: 999999999` at `:326` | High | Migrate X to OAuth 2.0 + PKCE, or accept that the manual's stated access model doesn't match your client |
| Redirect URIs on the real domain — no `ngrok`, no raw IP, no `localhost` | §04 pre-flight | ⚠️ | CORS allowlist hardcodes `http://localhost:6274` (`main.ts:24-49`); `NGROK_AUTHTOKEN` present in `.env.prod` | High | Dev-gate the localhost origin; remove ngrok from the prod env; audit registered redirect URIs on each platform console |
| Authorization codes never routed through a third party | §01B (implied), §04 | ❌ | `redirectmeto.com` relay whenever `FRONTEND_URL` lacks `https`: `instagram.standalone:111-115`, `threads:101-107`, `tiktok:316-320,341-345`, `slack:54,80` | **Critical** | Delete the fallback from production builds; hard-fail on non-HTTPS `FRONTEND_URL` |
| No open redirect adjacent to the OAuth entry point | §01C (reviewer probes) | ❌ | `integrations.controller.ts:199,237-239` stores arbitrary `redirectUrl`; `continue.integration.tsx:44-58` calls `push(returnURL)` unconditionally | High | Allowlist `redirectUrl` against your own origin |
| Client secrets server-side only, never in the browser bundle | §01D | ✅ | Grep of `apps/frontend` for `*_SECRET`, `*_APP_SECRET`: no matches. `NEXT_PUBLIC_*` limited to non-secrets | — | None |
| Every connector shown in the UI has working credentials | §04, §19 W2 | ❌ | `.env.prod` has **no** FB / IG / Threads / TikTok / Pinterest / YouTube keys, yet `integration.manager.ts:166-168` returns all providers unconditionally → reviewer clicking "Facebook" gets `client_id=undefined` | **Critical** | Configure keys; filter `getAllowedSocialsIntegrations()` on env presence |
| Per-connector feature flag / kill switch ("temporarily unavailable") | §01C, §20 | ❌ | Same hardcoded list at `integration.manager.ts:166-168`; no flag mechanism found | High | Ship the flag before launch — manual calls it a product requirement, not a nicety |
| Token refresh implemented per provider | §06, §01C | ⚠️ | Implemented: IG-standalone, Threads, LinkedIn ×2, TikTok, Pinterest, YouTube, Reddit. **Stub only: Facebook `facebook.provider.ts:194`, Instagram-via-FB `:68-78`** | **Critical** | Implement `fb_exchange_token` refresh for real. A Facebook connection currently dies silently at day 60 |
| Proactive refresh worker running *before* the Meta 60-day expiry | §06 "60-day token trap" | ⚠️ | `refresh.integration.service.ts:57-70` returns early unless `refreshCron` is true — set **only** on IG-standalone (`:30`) and Threads (`:30`). TikTok, Pinterest, YouTube, Reddit, LinkedIn, Facebook are reactive-only | **Critical** | Enable `refreshCron` for every OAuth 2.0 provider with a finite token |
| Per-connection health check | §01C, §20 | ❌ | No periodic health workflow; `monitor.controller.ts:1-14` returns `"Queue X is healthy"` unconditionally for any name, checking nothing | High | Build a real per-integration health probe (token validity, account type, scope drift, rate-limit state) |
| In-app "reconnect required" banner + email to customer | §06 | ⚠️ | Refresh failure notifies and disconnects (`refresh.integration.service.ts:80-99`), but the publish path marks the post ERROR **silently** on exhausted refresh (`post.workflow.v1.0.5.ts:230-233`) | High | Notify on that branch as the `bad_body` branch already does (`:248-259`) |
| Upstream token revocation on disconnect | §01C ("actually revokes the token upstream") | ❌ | Exhaustive grep for `revoke`, `deauthorize`, `me/permissions`: two hits only — `facebook.provider.ts:271`, `instagram.provider.ts:418`, both **GET** for `checkScopes()`. `SocialAbstract` defines no `revoke()` | **Critical** | Add `revoke()` to `SocialAbstract`; `DELETE graph.facebook.com/v20.0/me/permissions`, Google `/revoke`, LinkedIn / Reddit / X equivalents |
| Local token deletion on disconnect | §01C ("deletes it locally") | ❌ | `integration.repository.ts:533-543` — `update({ data: { deletedAt } })` only. **`token` and `refreshToken` survive indefinitely** | **Critical** | Null both columns in the same transaction as the soft delete |
| Disconnect visible in the UI | §01C | ✅ | `DELETE /integrations/` at `integrations.controller.ts:402-418`; also cancels that channel's posts `:407-414` | — | None (behaviour behind it is the problem, not the affordance) |
| Disconnect failure handling | §01C | ❌ | No error path around revocation because no revocation exists | Medium | Treat remote-revoke failure as non-blocking: delete locally, queue a retry, log it |
| Farcaster signer payload authenticated | §16 (key custody) | ❌ | `farcaster.provider.ts` `authenticate()` — `JSON.parse(base64(code))` with **no signature check**; any caller with a valid `state` can assert an arbitrary `signer_uuid`/`fid` | High | Verify the payload with Neynar before trusting it |
| Reddit descriptive `User-Agent` in `platform:app-id:version (by /u/user)` format | §13 | ❌ | Audit silent — no User-Agent finding for `reddit.provider.ts` | High | Verify; Reddit states it will throttle or block unidentified clients |
| Discord: no privileged intents requested | §14 | ⚠️ | Bot permissions bitmask `377957124096` — broad. Gateway intents not audited | Medium | Confirm zero privileged *intents*; trim the permission bitmask to what publishing needs |
| PKCE on POSTARYX's own OAuth server | Best practice | ❌ | `dtos/oauth/token-exchange.dto.ts` has no `code_verifier`; `oauth.service.ts:116` compares secrets with `!==` | Low | Add PKCE + `timingSafeEqual` |

---

## B. Access token and credential security

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| **OAuth tokens encrypted at rest** | §01D, §03 DPA | ❌ | `integration.repository.ts:243-296` writes `token` / `refreshToken` verbatim in both create and update branches; `:141-183` same on refresh; read path hands `.token` straight to the SDK. **32 of 33 providers plaintext** (only `skool.provider.ts:121` pre-encrypts) | **Critical** | AES-256-GCM, random per-record IV, migrate existing rows. This is a direct question on Meta's DPA and TikTok's audit |
| Refresh tokens protected | §01D | ❌ | Same rows — `Integration.refreshToken` plaintext in `schema.prisma` | **Critical** | Same |
| **Encryption key not stored beside the data** | §01D (verbatim) | ❌ | `auth.service.ts:9-20` derives the AES key **and IV** from `JWT_SECRET`, which lives in the same `.env.prod` loaded into the same process. No KMS, no envelope encryption | **Critical** | Move to a KMS / secret manager; separate the token-encryption key from `JWT_SECRET` entirely |
| Encryption that would survive a security questionnaire | §01D | ⚠️ | `auth.service.ts:6` `aes-256-cbc`; `:9-20` `EVP_BytesToKey` **MD5**, no salt, no iterations; **fixed deterministic IV**; no AEAD/HMAC | High | AES-256-GCM + HKDF/scrypt. Keep a deterministic blind index *separately* for the `oauth.repository.ts:184-207` lookup that needs it |
| Credentials not usable straight from a DB dump | §01D | ❌ | `Organization.apiKey` = `fixedEncryption(makeId(20))` and **the ciphertext itself is the bearer token** matched by DB equality. A dump yields working API keys without `JWT_SECRET` | High | Store a hash of the API key; present the plaintext once at issuance |
| Bring-your-own credentials (Bluesky app password, Nostr key) encrypted at rest | §16 | ⚠️ | `customInstanceDetails` encrypted for **Bluesky, Lemmy, Listmonk, Skool** (`no.auth.integrations.controller.ts:228-239`). **Nostr is not in that list** and stores a user-supplied private key | High | Encrypt Nostr keys; confirm no code path logs them |
| Secret management — where env vars live, who reads them | §01D | ⚠️ | Flat `.env.prod` on the host; `configuration.checker.ts:26-34` checks 7 vars for non-emptiness only, no entropy floor, no rejection of `.env.example` placeholders | High | Secret manager; add length/entropy validation; reject placeholders |
| No secrets in the repository | §01D | ❌ | **`.env.prod` was committed** — `git log --all --diff-filter=A -- .env.prod` → commit `1195455e`. Recoverable from history on the `aitechnologysys-sys/veroza` remote: `JWT_SECRET`, both Stripe keys, `LINKEDIN_CLIENT_SECRET`, `REDDIT_CLIENT_SECRET`, `X_API_SECRET`, `GITHUB_CLIENT_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, Polar tokens, Cloudflare R2 keys, `NGROK_AUTHTOKEN` | **Critical** | Rotate **every** secret today, independent of any application. Purge history or treat the repo as compromised. **Plan the `JWT_SECRET` rotation against every `fixedEncryption` column — including the API keys that *are* their own ciphertext** |
| No hardcoded credentials shipping in config | §01D | ⚠️ | `docker-compose.yaml:114-116` `POSTGRES_PASSWORD: postiz-password`; `:170-171` `temporal/temporal`; `docker-compose.dev.yaml:39-40` pgAdmin `admin@admin.com`/`admin` on port 8082 | Medium | Env substitution with generated values |
| No credential logging | §01D (audit logging) | ❌ | `listmonk.provider.ts:75-82` — `console.log(body)` where body is `{ url, username, password }`. Bare response-body logs at `threads.provider.ts:43`, `reelfarm.provider.ts:69` | High | Remove; add a lint rule against logging request/response bodies. Note `initialize.sentry.ts:29-33` sets `recordInputs/recordOutputs: true` — if you ever enable Sentry, that password ships to a subprocessor |

---

## C. Data deletion compliance

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| **Account deletion that removes all platform-derived data** | §01C (verbatim) | ❌ | No `@Delete` in `users.controller.ts` (15 routes); nothing in `users.service.ts` / `users.repository.ts`; no UI — `components/settings/` has 7 components, none for deletion | **Critical** | `DELETE /user/self` with full cascade + settings UI. Meta, Google and TikTok each require a demonstrable in-product path |
| Workspace / organisation deletion | §01C | ❌ | `organization.repository.ts` / `organization.service.ts` expose only `deleteTeamMember`. `DELETE /settings/team/:id` evicts a teammate; the `User` survives | **Critical** | Org deletion with cascade across integrations, posts, media, webhooks, agent tables |
| Delete connected accounts + their tokens | §01C | ❌ | Soft delete only, tokens retained — see §A | **Critical** | See §A |
| **Meta Data Deletion Request Callback (working endpoint, not a page)** | §01B, §04 | ❌ | Repo-wide grep for `signed_request`, `data_deletion`, `confirmation_code`, `parseSignedRequest`: **zero backend matches** | **Critical** | `POST /api/facebook/data-deletion`: base64url-split `signed_request`, verify HMAC-SHA256 with `FACEBOOK_APP_SECRET`, reject on mismatch, resolve Meta `user_id` → `Integration` rows, erase, return `{ url, confirmation_code }`. Mirror `stripe.controller.ts:16-23`, the one correctly-verified inbound webhook in the tree |
| Meta deletion **status page** at the returned `url` | §04 | ❌ | Same grep | **Critical** | `GET /facebook/data-deletion/:code` showing request state |
| Meta **Deauthorize** Callback | §04 pre-flight | ❌ | Grep for `deauthorize`, `deauth`: zero matches | **Critical** | `POST /api/facebook/deauthorize`, same signature verification, null tokens + disconnect |
| Inbound platform webhook signature verification (`X-Hub-Signature`, `hub.challenge`) | §04, §21 | ❌ | No platform webhooks received at all. Only Stripe and Polar inbound are verified | High | Build on the Stripe pattern when you add Meta webhooks |
| Hard-delete semantics behind every deletion path | §01B, §01D retention | ❌ | Posts `posts.repository.ts:319-328` (`deletedAt`), media `media.repository.ts:40-50` (`deletedAt`), channels `:533-543` — all soft | **Critical** | Hard-delete, or a time-bounded purge job that actually erases |
| Uploaded media removed from storage on deletion | §01D retention | ❌ | `IUploadProvider.removeFile()` **is implemented** (`local.storage.ts:116-121`, `cloudflare.storage.ts:158+`) but grep shows it is **never called**. Files persist on disk/R2 forever | High | Call it from `MediaService` and from account deletion |
| Retention / purge job | §01D "retention schedule per data type" | ❌ | `apps/orchestrator/src/workflows/` contains no purge workflow; zero matches for `@Cron`, `ScheduleClient`, `createSchedule`, `node-cron`, `@nestjs/schedule`. Soft-deleted rows and the `Errors` table accumulate indefinitely | High | Temporal Schedule that purges soft-deleted rows past TTL and calls `removeFile()` |
| Public data-deletion **instructions** page | §01B, §19 W0 | ❌ | Audit silent on frontend legal routes | **Critical** | Stable URL, linked from the privacy policy and from the Meta app config |
| GDPR data export | Not required by these gates | ❌ | Zero matches for `GDPR`, `data-export`, `export-data` outside `market/` | Low | Post-approval |

---

## D. Legal claims vs. what the code can support

I don't have your policy text. These are the assertions the manual *requires* a compliant policy to make — each one is currently false in code, so publishing the policy first creates a documented misrepresentation.

| If your policy asserts… | Code reality | Evidence | Severity | Required Action |
|---|---|---|---|---|
| "OAuth tokens are encrypted at rest" | Plaintext, 32/33 providers | `integration.repository.ts:243-296` | **Critical** | Encrypt before publishing the claim |
| "Encryption keys are managed separately from the data" | Key + IV derived from `JWT_SECRET` in the same env file | `auth.service.ts:9-20` | **Critical** | KMS, then claim it |
| "We retain data for N days/months" | Nothing is ever purged. The only truthful statement today is *"indefinitely, until manually removed by an administrator"* | No purge job anywhere | **Critical** | Build retention, then state a period |
| "You can delete your account and all associated data" | No endpoint, no UI, no service method | §C above | **Critical** | Build it, then claim it |
| "Disconnecting a platform revokes our access" | Token retained live in the DB forever; no upstream revoke | `integration.repository.ts:533-543` | **Critical** | Build it, then claim it |
| "Deleted media is removed from storage" | `removeFile()` never called | `media.repository.ts:40-50` | High | Wire it up |
| "We do not share data with ad networks" | **Facebook Pixel and Google Ads/GTM run on the frontend** | `facebook.component.tsx:11-18`; `gtm.component.tsx:29,46-51` | High | Either remove the pixels or disclose them by name. Meta reviewers check that the pixel you run is disclosed |
| Subprocessor list (manual's example names Oracle, Cloudflare, Stripe, email) | Actual list is longer: Cloudflare R2, Stripe, Polar, Resend/SMTP, OpenAI, **PostHog (receives user id + email + name)**, Google Tag Manager / Ads, Meta Pixel, Temporal, Neynar, Sentry (wired, DSN unset), redirectmeto.com | `use.fire.events.ts:20` `posthog.identify(user.id,{email,name})`; `.env.prod` | High | Name all of them; get a DPA with PostHog specifically |
| "Access is logged and audited" | Ad-hoc `console.log` to stdout via pm2, no aggregation, no audit log | §G below | High | Don't claim it yet |
| Pinterest: "we do not cache Pinterest API data" (their storage rule) | Board/pin identifiers and names persisted indefinitely in `Integration.internalId`, `rootInternalId`, `name`, `profile` with no TTL | `schema.prisma` Integration fields, all plaintext | High | Strip what you don't need, TTL the rest, then describe the behaviour accurately (§09) |
| Per-platform sections naming Meta / LinkedIn / TikTok specifically | Unknown — policy not provided | — | **Critical** | A generic policy fails. Meta rejects on a policy that never names Facebook (§04) |

---

## E. Platform-specific product requirements

These are the build-to-spec items in the manual's per-platform parts. Reviewers test them directly, and the audit could not confirm a single one of the TikTok UX requirements.

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| **Meta** — minimum scope set, no `business_management` | §04 | ⚠️ | `facebook`/`instagram` providers request `business_management` | High | Drop it unless you genuinely enumerate Business assets |
| Meta — test user with a real **admin role on a test Page** | §04 | ❌ | No seed/demo data of any kind (`audit §8`) | **Critical** | Provision the asset and document it in the submission notes |
| Meta — app icon 1024×1024, category, Privacy/Terms URLs, deletion callback populated | §04 | ❌ | Callback doesn't exist, so the field cannot be filled | **Critical** | §C |
| **Instagram** — lead with the Instagram Login (standalone) path | §05 | ✅ | `instagram.standalone.provider.ts` exists, has real refresh (`:75-102`, `ig_refresh_token`, 58d) **and** `refreshCron=true` `:30` — the one Meta path with a working token lifecycle | — | Submit this path first, as the manual advises |
| Instagram — surface remaining quota from `GET /content_publishing_limit` (100 posts/24h) | §05 | ❌ | Audit silent | High | Build it; an agency with 12 clients hits this and blames you |
| Instagram — media on a publicly reachable URL at review time | §05 | ⚠️ | Cloudflare R2 configured (`cloudflare.storage.ts`), but no evidence of a verified public custom domain; local-disk provider also supported | **Critical** | Object storage on a custom domain must be live before the IG **and** TikTok reviews |
| Instagram — normalise to JPEG on upload (MPO/JPS unsupported) | §05 | ❌ | Upload validation does magic-byte allowlisting (`custom.upload.validation.ts:9-67`) but no evidence of JPEG normalisation | High | Normalise at upload |
| Instagram — carousel ≤10 items, first-item aspect ratio | §05 | ❌ | Audit silent | Medium | Enforce in the composer |
| Instagram — pre-flight account-type check (personal accounts cannot publish) | §05 | ❌ | Audit silent | High | Detect at connect time and tell the user to convert |
| **Threads** — separate Meta app, Tech Provider verification | §06 | N/A (console) | — | High | Console-side; run in parallel with business verification |
| Threads — refresh before 60-day expiry | §06 | ✅ | `threads.provider.ts:73-93` (58d) + `refreshCron` `:30` | — | None |
| **LinkedIn** — personal path requests only `openid profile w_member_social` | §07 | ❌ | `linkedin.provider.ts` personal provider requests `rw_organization_admin`, `w_organization_social`, `r_organization_social` alongside `w_member_social` | **Critical** | Split the scopes: org scopes belong to `linkedin-page` only. LinkedIn rejects scopes the demo doesn't justify — **and a rejection burns the app** |
| LinkedIn — display a **member's comment** on a Page post inside the product | §07 required test case 3 | ❌ | `POST /posts/:id/comments` is *comment scheduling*, not comment reading. No inbox/engagement surface evidenced | **Critical** | This is required test-case beat #3 of five. Without a comment-display feature, the Standard-tier screencast cannot be recorded — and Standard rejection sends you back to a new app and a new Development-tier application |
| LinkedIn — show exactly which commenter personal-data fields you display | §07 test case 4 | ❌ | Depends on the above | **Critical** | Same |
| **TikTok** — fresh `creator_info` fetch at compose time, nickname displayed | §08 | ❌ | Audit silent | **Critical** | The audit *is* the UX guidelines. Build all seven TikTok composer rows below before the audit |
| TikTok — block posting when creator hit their daily limit | §08 | ❌ | Audit silent | **Critical** | Same endpoint response |
| TikTok — Privacy Status dropdown **with no default selection** | §08 | ❌ | Audit silent | **Critical** | A pre-selected default is a named rejection reason |
| TikTok — Comment / Duet / Stitch toggles, greyed out where the account restricts them | §08 | ❌ | Audit silent | **Critical** | Build |
| TikTok — Music Usage Confirmation string + link shown before publish | §08 | ❌ | Audit silent | **Critical** | Exact string, not paraphrased |
| TikTok — commercial-content disclosure toggle with the exact Your Brand / Branded Content strings and forced-public rule | §08 | ❌ | Audit silent | **Critical** | Strings change by combination — implement all three cases |
| TikTok — content preview, no POSTARYX watermark, editable presets, express consent, "may take minutes" warning | §08 | ❌ | Audit silent | **Critical** | Build |
| TikTok — media domain verified under Manage URL properties (`PULL_FROM_URL`) | §08 | ❌ | Audit silent; storage domain not evidenced | **Critical** | Verify the prefix before submitting |
| **Pinterest** — minimal scopes, no indefinite caching | §09 | ❌ | Board/pin metadata persisted plaintext with no TTL | High | Strip and TTL; then describe it in the policy |
| **YouTube** — narrow scopes | §10 | ❌ | `youtube.provider.ts` requests `youtubepartner` **and full `youtube`** → Google restricted-scope tier → mandatory paid third-party CASA assessment | **Critical** | Reduce to `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly` **before** ever submitting |
| YouTube — never call `search.list`; use `channels.list` + `playlistItems.list` | §10 | ❌ | Audit silent | High | Verify and remove if present. 100 units per call against a 10,000/day cap |
| YouTube — quota metering per plan tier, alarm at 70% | §10 | ❌ | Audit silent | High | Instrument before launch |
| **X** — per-customer BYO keys | §11 | ❌ | Only instance-level `X_API_KEY` / `X_API_SECRET` in `.env.prod`; no per-customer credential schema | High | Schema + UI change. At $0.200 per post containing a URL this is ~16% of gross revenue at every scale — retrofitting later is a migration *and* a price increase in the same conversation |
| **Reddit** — per-account rate limiting, subreddit rule surfacing, cross-post throttle | §13 | ❌ | Audit silent | High | One customer spamming 20 subreddits gets **your** client ID flagged |
| **VK connector removed** | §18 | ❌ | Audit enumerates 33 providers and does not confirm VK's presence or absence | High | Verify and remove before opening a bank or Stripe account |
| **"Postiz" / "Gitroom" strings purged** from UI, `<title>`, emails, package.json, app display names | §00 "the fork problem" | ❌ | Audit confirms the fork (`postiz-app`, origin `veroza`, image `ghcr.io/aitechnologysys-sys/veroza`) but performed no branding grep | **Critical** | Grep the whole tree. At Meta and LinkedIn "what is your relationship to Postiz?" is answered by rejection, not a conversation |

---

## F. Security and infrastructure

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| TLS in transit (app edge) | §01D | ⚠️ | No redirect logic in-repo, TLS assumed external; no `trust proxy` despite `@RealIP()` usage | Medium | Terminate properly; set trust proxy |
| Encryption in transit, app ↔ DB | §01D | ❌ | No `sslmode` / `rejectUnauthorized` anywhere. Mitigated only by Postgres having no published host port (`docker-compose.yaml:119-121`) | High | `sslmode=require` before `DATABASE_URL` points anywhere managed |
| Encryption at rest, DB + object storage | §01D | ❌ | Audit silent (volume-level and R2-level encryption not evidenced) | High | Confirm and document — it's a DPA line item |
| Password storage | §01D | ✅ | bcrypt cost 10, `compareSync` (`auth.service.ts:36-41`) | — | None |
| Password policy | §01D least-privilege/access | ❌ | `@MinLength(3)`, `@MaxLength(64)`, no complexity (`create.org.user.dto.ts:12-17`) | High | Minimum 12 |
| Rate limiting / brute-force protection on auth | §01D | ❌ | `throttler.provider.ts:7-16` throttles **only** `POST /public/v1/posts`. No lockout, no delay, no CAPTCHA | High | Throttle `/auth/*` per IP + account |
| Session management | §01D, DPA | ❌ | `auth.service.ts:42-44` signs with **no `expiresIn`** — session JWTs never expire. Logout clears the cookie client-side only (`auth.middleware.ts:11-25`), no JTI, no denylist. Cookie `expires: +365d`. Payload is the whole User object incl. `isSuperAdmin` | High | `expiresIn` + refresh tokens, or a Redis JTI denylist honoured at logout. Mitigating: middleware re-resolves the user from DB each request (`:39-57`) |
| Activation / email verification working | §01C | ⚠️ | `.env.prod:37` sets `EMAIL_PROVIDER="resend\|nodemailer"` — a literal that matches neither branch of `email.service.ts:27-34`, falling through to `EmptyProvider`, so `organization.repository.ts:278` auto-activates everyone. **Activation is silently disabled in production** | High | Set the literal value and fail loudly on an unrecognised one — **but see the trap in §J** |
| MFA | §01C says reviewer account has 2FA **disabled** | ❌ | No `totp`/`speakeasy`/`2fa` implementation | Low | Not required by these gates. First thing an enterprise buyer asks |
| RBAC | §01D | ✅ | `SUPERADMIN \| ADMIN \| USER`; `assertSuperAdmin` per method; impersonation superadmin-only against the DB flag | — | None |
| Tenant isolation | §01D | ✅ | `organizationId` always from `@GetOrgFromRequest()`; zero matches for `@Body('organizationId')`/`@Query('organizationId')`. No live IDOR | — | Harden the latent gaps below |
| — latent: repository methods with no org filter | Defence in depth | ⚠️ | `integration.repository.ts:120-128,343-374`; `posts.repository.ts:360-397,687-697` (org filter is a conditional spread) | Low | Make `organizationId` a required argument |
| Privileged endpoints not sharing the session secret | §01D least privilege | ⚠️ | `enterprise.controller.ts:21-127` (`create-user`, `url`, `delete-channel`) and `public.controller.ts:131-155` gated **only** by a `JWT_SECRET`-signed payload | High | Separate signing key or IP allowlist. Compounds the git-history leak: that secret is already public |
| CORS | §01D | ✅ | Allowlist not wildcard (`main.ts:24-49`) — but dev-gate `localhost:6274` | Low | Dev-gate |
| CSRF | §01D | ❌ | No `csrf`/`XSRF` anywhere; with `sameSite:'none'` + `credentials:true`, multipart upload routes are cross-site form-submittable without preflight | Medium | CSRF token on multipart routes or require a custom header |
| Security headers (HSTS/CSP/X-Frame-Options) | §01D | ❌ | No helmet; `nginx.conf:36-51` sets CSP only on `/uploads/`; app and `/api/` locations have none | Medium | helmet + HSTS + CSP at nginx |
| File upload hardening | §01D | ✅ | Magic-byte sniffing, 10 MB image / 1 GB video caps, filename sanitisation, random 32-hex on-disk names, `default-src 'none'; sandbox` CSP on `/uploads/` | — | None |
| SSRF protection | §01D | ⚠️ | Strong framework (`isSafePublicHttpsUrl` + `ssrfSafeDispatcher` with connect-time DNS re-validation) — but `webhooks.controller.ts:57-61` and `post.activity.ts:330-336` use bare `fetch()` | Medium | Pass the dispatcher; re-validate at send time |
| Audit logging and log retention | §01D | ❌ | Nest `Logger` + ad-hoc `console.log` to stdout via pm2. No aggregation, no audit trail. Sentry wired but DSN unset | High | Structured logging with a scrubber, retention policy, and an actual audit log for token/deletion events |
| Backup, restore-test cadence, off-provider location | §01D | ❌ | Audit silent | High | Required by the DPA. Document and *test* the restore |
| Incident response plan with named owner + timeline | §01D | ❌ | Document, not code | High | Write it — the git-leak is your first incident and it's already open |
| Subprocessor inventory | §01D | ⚠️ | The audit's §5 table is your raw material | Medium | Turn it into the policy document |
| Data integrity of the token store | Implied | ❌ | `package.json:18,34` — production container runs **`prisma db push --accept-data-loss` on every start**, and `migrations/` does not exist. Destructive schema changes auto-approved, no versioned SQL, no rollback | **Critical** | `prisma migrate deploy` with versioned migrations; remove push from the boot path. Not reviewer-visible; it is the largest single risk to the tokens you're asking to be trusted with |
| Config validation blocks boot | §01C reliability | ⚠️ | `main.ts:73-99` runs `checkConfiguration()` **after** `app.listen()` and only warns | Medium | `process.exit(1)` before `listen()` |
| Meaningful health check | §20 | ❌ | `docker-compose.yaml:87-93` probes the **frontend**; `monitor.controller.ts:1-14` is a stub. Documented failure mode: Temporal unreachable kills the backend while the container reports healthy | Medium | Real `/health` checking DB + Redis + Temporal |
| No public API/source disclosure during review | §01F hygiene | ⚠️ | Swagger mounted unconditionally at `/docs`, no auth, no env gate (`load.swagger.ts:1-12`, `main.ts:69`); `next.config.js:26` `productionBrowserSourceMaps: true` | Medium | Gate `/docs`; `hidden-source-map` |
| Outbound webhook signing | §01D integrity | ❌ | `Webhooks` model has **no signing-secret field** — deliveries are unverifiable by receivers | Low | Add a secret + HMAC header |
| Publish reliability (no double-post, backoff) | §20 | ⚠️ | `post.workflow.v1.0.5.ts:19-46` `maximumAttempts:3, backoffCoefficient:1` (flat); idempotency is a state check `:90-93`, not a provider idempotency key — a lost response after a successful publish can double-post. No retry button | Medium | Exponential backoff + provider idempotency keys |

---

## G. Reviewer account and approval testing

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| Public self-serve signup, no invite code | §01C | ✅ | `DISABLE_REGISTRATION:'false'`, `IS_GENERAL:'true'` forced in `docker-compose.yaml:63-64` | — | None |
| No manual approval step | §01C | ✅ | No approval gate found | — | None |
| No email-verification loop a reviewer can get stuck in | §01C | ⚠️ | Passes **only by accident** — the misconfigured `EMAIL_PROVIDER` auto-activates users (`.env.prod:37`) | High | Fix email properly **and** pre-activate the reviewer account. See §J |
| Login works | §01C | ⚠️ | Cookie is `secure:true, sameSite:'none'` (`auth.middleware.ts:14-19`), `NOT_SECURED` unset → over plain HTTP the browser drops it and the session never persists | High | HTTPS-only deployment (already required) |
| Permanent reviewer test account, non-expiring password, 2FA off | §01C | ❌ | No seed script, no fixtures, no demo mode | **Critical** | Provision and document credentials in every submission's notes |
| Pre-loaded connected test asset + sample scheduled posts | §01C | ❌ | Same | **Critical** | Seed a test Page/board/Page-post set so the UI isn't empty |
| **Reviewer can connect a channel** | §01C | ❌ | `BILLING_ENABLED=true` (`.env.prod:94`), new orgs get no `Subscription` row → `permissions.service.ts:22-38` resolves `FREE` → `pricing.FREE.channel = 0` → `@CheckPolicies([Create, CHANNEL])` on `integrations.controller.ts:47,194` fails on the **first click** with *"You have reached the maximum number of channels for your subscription"* | **Critical** | Provision the reviewer org with a tier, or add a reviewer/trial tier with ≥1 channel and ≥1 post |
| Reviewer can create and schedule a post | §01C | ❌ | `posts_per_month: 0` on FREE, same gate | **Critical** | Same |
| Reviewer can publish | §01C | ❌ | Blocked by the above + missing provider credentials | **Critical** | Same |
| Reviewer can disconnect | §01C | ⚠️ | Route exists, reachable only after connecting; behaviour non-compliant (§A) | **Critical** | §A |
| Reviewer can delete their data | §01C | ❌ | Does not exist | **Critical** | §C |
| Empty states handled | §01C | ⚠️ | Calendar/launches handles no-posts; analytics and media empty paths unconfirmed | Low | Click through before handoff |
| **A compliant screencast can be recorded today** | §01E | ❌ | Steps 2 (connect) and 8 (delete data) are hard stops | **Critical** | Everything above |

---

## H. Public legal pages and website requirements

The audit did not enumerate frontend marketing routes, so every row is unevidenced. Confirm these first — several may already exist.

| Requirement from Platform Manual | In manual? | Code Status | Evidence from audit | Severity | Required Action |
|---|---|---|---|---|---|
| `/privacy` — stable URL, per-platform sections, lawful basis, retention, deletion mechanism, subprocessors, transfer posture | §01B | ❌ | Audit silent | **Critical** | A generic policy is a named Meta rejection reason |
| `/terms` — stable URL | §01B | ❌ | Audit silent | **Critical** | Build |
| `/data-deletion` — instructions page, stable URL | §01B | ❌ | Audit silent | **Critical** | Build; link from the policy and the Meta app config |
| `/about` or `/legal` — states the Lunark ↔ POSTARYX relationship + registered address | §A.1, §19 W0 | ❌ | Audit silent | **Critical** | This is the evidence Meta accepts for the two-names link |
| Footer on **every** page: "POSTARYX is operated by Lunark Dynamics LLC" | §A.1 | ❌ | Audit silent | **Critical** | Meta requires the display name or a clear reference visible on the business website |
| Privacy policy + terms name Lunark Dynamics LLC as contracting entity and data controller, with registered address | §A.1 | ❌ | Audit silent | **Critical** | Build |
| `/cookie-policy` — required given GTM, Google Ads and Meta Pixel are live | Implied by §01D disclosure | ❌ | Pixels confirmed at `facebook.component.tsx:11-18`, `gtm.component.tsx:29,46-51` | High | You are running three trackers; disclose them |
| `/refund-policy` | Not in manual (Stripe/consumer-law driven) | ❌ | Audit silent | Medium | Build for Stripe onboarding |
| `/contact` + support address a human reads within 24h | §01B | ❌ | Audit silent | High | Reviewers sometimes email |
| Marketing site describes what POSTARYX does, who for, and shows pricing — not a coming-soon page | §01B | ❌ | Audit silent | **Critical** | Required before any Wave 2 application |
| Domain verified in Google Search Console; TikTok URL-prefix property verified | §01B | ❌ | Audit silent | **Critical** | Prerequisite for Google OAuth brand verification and TikTok `PULL_FROM_URL` |
| Company/product identity correct everywhere (no Postiz/Gitroom) | §00 | ❌ | Fork confirmed, branding grep not performed | **Critical** | §E |

---

# Critical Blockers Before Applying

Ordered by what a reviewer hits first.

**Blocks every hard gate**

1. **Reviewer cannot connect a channel.** FREE tier = 0 channels with billing enforced. First click, first minute, dead. `pricing.ts:23-40`, `.env.prod:94`.
2. **Reviewer cannot create a post.** `posts_per_month: 0` on FREE.
3. **No account deletion.** No endpoint, no UI, no service method. Meta, TikTok and Google each require you to demonstrate it.
4. **Disconnect retains a live token and never revokes upstream.** The manual states reviewers check this specifically. It is also a direct policy violation once you hold real tokens.
5. **OAuth tokens plaintext at rest**, key derived from the same `JWT_SECRET` that sits in the same file. "Are platform tokens encrypted at rest" is a Meta DPA question and a TikTok audit question.
6. **No reviewer test account, no seed data, no pre-connected test asset.**
7. **Legal pages unconfirmed**, and the entity-to-product link (footer, `/legal`, policy contracting entity) not evidenced anywhere.
8. **Postiz / Gitroom strings not purged.** Unresolved at Meta and LinkedIn means rejection, not a question.
9. **Real secrets in git history** (commit `1195455e`) including `LINKEDIN_CLIENT_SECRET`, `REDDIT_CLIENT_SECRET`, `X_API_SECRET`, `JWT_SECRET`. Business verification and any security questionnaire treat leaked platform app secrets as disqualifying. **Handle this today regardless of any application.**

**Meta specifically**

10. **No Data Deletion Request Callback.** Mandatory dashboard field you cannot fill.
11. **No Deauthorize Callback.** Same.
12. **No deletion status page** for the URL the callback must return.
13. **Facebook / Instagram / Threads credentials absent from production**, while all ~30 connectors render unconditionally → `client_id=undefined`.
14. **Facebook token refresh is a stub** (`facebook.provider.ts:194`) — connections die at day 60.
15. **Media must be publicly fetchable from a stable domain**; object storage on a verified custom domain not evidenced.

**LinkedIn specifically** — remember: rejection burns the app permanently.

16. **Personal-profile provider requests org-admin scopes.** `rw_organization_admin`, `w_organization_social`, `r_organization_social` for a personal-posting integration.
17. **No comment-display surface.** Required test-case beats 3 and 4 (show a member's comment on the Page post; name which commenter personal-data fields you display) cannot be recorded. Standard-tier rejection means a new app *and* a new Development-tier application.

**TikTok specifically**

18. **PKCE sends no `code_challenge`.** TikTok checks this explicitly.
19. **The entire composer UX spec is unbuilt** — fresh `creator_info`, daily-limit block, no-default privacy dropdown, interaction toggles greyed per account restriction, Music Usage Confirmation string, commercial-disclosure toggle with the three exact string combinations, content preview, no watermark, upload-duration warning. TikTok's audit *is* this checklist.
20. **`TIKTOK_CLIENT_ID` absent from production** — there is nothing to test.

**Google / YouTube specifically**

21. **`youtubepartner` + full `youtube` scope** puts you in the restricted tier, triggering a mandatory paid third-party CASA assessment that plaintext tokens and no deletion path would fail. Narrow the scopes *before* submitting or you buy an expensive rejection.

---

# Medium Priority Improvements

Raise approval confidence and survive the questionnaire that follows approval, but unlikely to be the stated rejection reason.

- **Session JWTs that expire** + server-side revocation on logout (`auth.service.ts:42-44`)
- **`state` from a CSPRNG at ≥32 chars** instead of 6 chars of `Math.random()`
- **Rate limiting on `/auth/*`** and a 12-character minimum password
- **Remove `redirectmeto.com`** from all production paths
- **Close the open redirect** on the OAuth entry point
- **Verify the Farcaster signer blob** with Neynar
- **Media `removeFile()` actually called** on deletion
- **Retention/purge job** so the retention period in your policy becomes true
- **Remove the Listmonk plaintext password log**; add a lint rule; add a Sentry `beforeSend` scrubber before enabling Sentry
- **Security headers** (helmet, HSTS, CSP, X-Frame-Options) and CSRF on multipart routes
- **Gate `/docs`**; switch to `hidden-source-map`
- **`ssrfSafeDispatcher` on both webhook paths**
- **Separate signing key for `EnterpriseController`** and `modifySubscription`
- **Real `/health`** checking DB + Redis + Temporal; stop probing the frontend
- **`sslmode=require`**, then move off the hardcoded Postgres password
- **Config validation before `listen()`**, exiting non-zero
- **Notify on exhausted token refresh** (`post.workflow.v1.0.5.ts:230-233`)
- **Exponential backoff + provider idempotency keys** on publish
- **Per-connector beta badges and a public platform-coverage page** (§20 product-side insurance)
- **`timingSafeEqual`** for API-key and client-secret comparison
- **Backup, restore test, off-provider copy** — documented, because the DPA asks

---

# Final Engineering Roadmap

## Phase 0 — Today, unrelated to any application

Rotate every secret in commit `1195455e`: `JWT_SECRET`, both Stripe keys, LinkedIn, Reddit, X, GitHub, Resend, OpenAI, Polar, Cloudflare R2, ngrok. Purge history with `git filter-repo`/BFG or treat the repo as compromised.

**Sequence the `JWT_SECRET` rotation carefully.** It is the derivation input for every `fixedEncryption` column, and `Organization.apiKey` is a case where the ciphertext *is* the credential. Rotating naively invalidates every customer API key and every encrypted column. Plan: dual-read with old and new keys → re-encrypt → cut over. Do this before you introduce the new token-encryption key, not after.

Also stop `prisma db push --accept-data-loss` from running on container start (`package.json:18,34`) and generate a baseline migration. Every hour that stays in the boot path is an hour your token store can be destructively altered without review.

## Phase 1 — Mandatory before any application (~2–3 weeks focused)

**Deletion and revocation**
- `POST /api/facebook/data-deletion` — signed-request HMAC verification, cascade erase, `{url, confirmation_code}` response
- `GET /facebook/data-deletion/:code` status page
- `POST /api/facebook/deauthorize` — same verification, null tokens, disconnect
- `DELETE /user/self` + org deletion, full cascade, settings UI, public instructions page
- `revoke()` on `SocialAbstract`; implement for Meta (`DELETE /me/permissions`), Google (`/revoke`), LinkedIn, Reddit, X; null `token`/`refreshToken` on disconnect
- Call `removeFile()` on media and account deletion

**Token security**
- AES-256-GCM, random per-record IV, key from a KMS separate from `JWT_SECRET`; migrate existing rows
- Encrypt Nostr keys

**Reviewer path**
- Reviewer/trial tier with ≥1 channel and ≥1 post, or provision the reviewer org directly
- Seed script: reviewer account, connected test asset, sample scheduled posts
- Pre-activate the reviewer account so fixing email doesn't lock them out

**Platform config**
- Configure FB / IG / Threads / TikTok / Pinterest / YouTube credentials
- Filter the connector list on env presence + per-connector feature flag
- Real Facebook `fb_exchange_token` refresh; `refreshCron` on every finite-token provider
- Fix TikTok PKCE (S256, copy `kick.provider.ts:27-38`)
- LinkedIn scope split — personal gets `openid profile w_member_social` only
- YouTube scopes narrowed to `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly`
- Drop `business_management` from Meta unless genuinely used

**Public surface**
- `/privacy` (per-platform sections), `/terms`, `/data-deletion`, `/legal` or `/about`, `/contact`, `/cookie-policy`; footer entity line on every page
- Grep and purge Postiz / Gitroom everywhere including `package.json`, email templates, page titles, registered app display names
- Remove VK
- Object storage on a verified custom HTTPS domain; verify in Search Console and TikTok URL properties
- Security & data-handling policy document (Part 01§D) — it answers the Meta DPA later

**TikTok composer** — the full UX spec. Treat this as its own workstream; it is the single largest unbuilt feature in this list.

## Phase 2 — Security and compliance hardening (before the DPA lands)

CSPRNG state · session expiry + revocation · auth rate limiting + 12-char passwords · remove `redirectmeto.com` · close the open redirect · Farcaster signature verification · retention/purge job · remove credential logging + Sentry scrubber · security headers + CSRF · gate `/docs` + hidden source maps · SSRF dispatcher on webhooks · separate enterprise signing key · real health check · `sslmode=require` · env-substituted DB passwords · config validation before `listen()` · notification on exhausted refresh · Pinterest cache stripping and TTL · audit logging with retention · backup + tested restore · incident response plan with a named owner.

## Phase 3 — Nice to have

MFA · GDPR export · per-customer X BYO keys (move to Phase 1 if X ships at launch — the 16%-of-revenue math is a business blocker even though it isn't an approval blocker) · Instagram quota surfacing and account-type pre-flight · JPEG normalisation · carousel limits · Reddit per-account throttling and subreddit rule surfacing · YouTube quota metering and 70% alarm · webhook signing secrets · exponential backoff and idempotency keys · required `organizationId` in every repository method · PKCE on your own OAuth server · pinned JWT algorithms · `timingSafeEqual` · production Dockerfile + `ecosystem.config.js` · status page and beta badges · retire the stale Jenkins pipeline.

---

# If you apply tomorrow: realistic rejection reasons

**Meta (Business Verification + App Review) — rejection near-certain.**
Business Verification is a documents process and would probably pass on its own, assuming *Lunark Dynamics LLC* matches your Articles and EIN letter character for character. App Review will not. The Data Deletion Callback URL and Deauthorize Callback URL are required dashboard fields you cannot populate because the endpoints do not exist. The screencast cannot be recorded: a fresh account cannot connect a channel (FREE = 0), Facebook/Instagram/Threads credentials are absent from production so the connector produces `client_id=undefined`, and there is no delete-my-data flow to film — which is the step Meta explicitly asks you to demonstrate. If the submission survived to the Data Protection Assessment, "are platform tokens encrypted at rest" is answered No. Expect a generic *"unable to test the integration"* note that tells you nothing. The separate risk: any surviving Postiz/Gitroom string invites a question that Meta answers with rejection rather than conversation.

**LinkedIn (Development → Standard) — rejection likely, and the app is burned.**
LinkedIn credentials *are* configured, so the flow itself works, which makes this the most tempting and most dangerous submission. Three things sink it. The personal-profile provider requests `rw_organization_admin`, `w_organization_social` and `r_organization_social` for personal posting — LinkedIn is consistent about rejecting scopes the demo doesn't justify. The reviewer hits the channel paywall before connecting anything. And the Standard-tier screencast requires five specific beats including *how a member's comment on the post is displayed inside your app* and *exactly which commenter personal-data fields you show* — POSTARYX has comment *scheduling*, not comment *display*, so two of five beats cannot be filmed. Development-tier rejection costs you a new app. Standard-tier rejection costs you a new app **and** a new Development-tier application. Do not submit until the scope split, the tier gate, and a comment-display surface all exist.

**TikTok (Content Posting API audit) — rejection near-certain.**
`TIKTOK_CLIENT_ID` is absent from production, so there is nothing to audit. PKCE sends no `code_challenge`, which TikTok checks directly. The composer implements none of the mandated publishing UX — no fresh `creator_info` fetch, no daily-limit block, no undefaulted privacy dropdown, no interaction toggles, none of the exact disclosure strings. There is no token revocation and no user deletion. The unbranded demo video showing the full lifecycle including content-disclosure settings cannot be recorded. Separately, remember the failure that looks like success: even a passing integration publishes `SELF_ONLY` until the audit clears, so shipping TikTok to customers pre-audit means every customer's post is invisible and your own test posts look fine.

**Google OAuth verification (YouTube) — rejection likely and expensive.**
`youtubepartner` plus full `youtube` scope puts you in the restricted-scope tier, which triggers a mandatory third-party CASA security assessment — paid, weeks of turnaround. With plaintext tokens, no deletion path, no audit logging, and no tested backup you would fail that assessment after paying for it. Narrow the scopes first. Note also the arithmetic that makes YouTube a post-approval connector regardless: 10,000 units/day against 1,600 units per upload is six uploads per day across your entire customer base, and you break that at roughly three customers.

**Pinterest — rejection possible on one specific ground.**
The OAuth video is straightforward once the tier gate is fixed. The exposure is the data-storage rule: Pinterest bars caching most API data, and board/pin identifiers and names sit in `Integration` plaintext with no TTL. "We cache boards indefinitely" is a failed review and a compliance problem afterwards.

**Reddit — unpredictable, and the ask is easy to skip.**
Commercial use requires explicit written approval, which is a request you make rather than a review you pass. Two code gaps to close first: the required `User-Agent` identification format, and per-account rate limiting with subreddit rule surfacing — because on Reddit a single customer spamming twenty subreddits gets *your* client ID flagged, not just theirs.

---

# J. Three sequencing traps in this fix list

Worth internalising before you assign the work, because each one turns a fix into a regression.

1. **Fixing email breaks the reviewer.** `EMAIL_PROVIDER="resend|nodemailer"` currently disables activation, which is the only reason self-serve signup works for a reviewer in another timezone. Set the literal value and activation turns on — so pre-activate the reviewer account, or add a deterministic activation path, in the same change.

2. **Rotating `JWT_SECRET` invalidates every encrypted column, including customer API keys.** `Organization.apiKey` is stored as ciphertext that *is* the bearer token. Dual-read, re-encrypt, cut over. Do the rotation before introducing the new KMS-backed token key so you migrate once, not twice.

3. **Fixing the FREE-tier gate must not open a free-forever hole.** Granting `pricing.FREE.channel ≥ 1` globally changes your billing model. Prefer a reviewer/trial tier or direct provisioning of the reviewer org, and confirm `permissions.service.ts:22-38` resolves it the way you expect before recording anything.

**If you want one application filed soon, make it LinkedIn Development tier** — but only after the scope split, the tier gate, the deletion path and the branding purge. The comment-display gap is a Standard-tier problem, not a Development-tier one, so Development is genuinely winnable within Phase 1. Everything Meta and TikTok needs is Phase 1 complete plus, for TikTok, the composer workstream on top.
