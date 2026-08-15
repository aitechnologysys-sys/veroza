
# POSTARYX — Platform Approval Technical Readiness Audit

**Scope:** Full source audit of the `postiz-app` working tree (fork of gitroomhq/postiz-app, origin `aitechnologysys-sys/veroza`, branch `chore/reduce-docker-size_#6`).
**Audited for:** Meta (Facebook/Instagram/Threads) App Review + Business Verification, LinkedIn Standard/Community Management API, TikTok Content Posting API audit, Pinterest, Google OAuth verification (YouTube), Reddit, X.
**Method:** Static read of actual code. Every claim below carries a `file:line` reference. Items I could not find are stated as NOT FOUND with the search performed.
**Date:** 12 Aug 2026

---

## 0. Executive verdict

**Overall: (B) NEEDS FIX BEFORE APPLYING — do not submit tomorrow.**

The application is functionally rich and architecturally sound in places (strong SSRF defences, no raw SQL, consistent tenant scoping, real PKCE in two providers). But it fails on the exact controls platform reviewers test first:

1. **OAuth access and refresh tokens are stored in plaintext in Postgres** for 32 of 33 providers.
2. **There is no Meta Data Deletion Callback and no Deauthorize Callback.** Both are mandatory form fields in the Meta App Dashboard.
3. **There is no user account deletion anywhere** — no endpoint, no UI, no service method.
4. **"Disconnect channel" is a soft delete that leaves the live access token in the database forever** and never calls the platform's revocation endpoint.
5. **A fresh reviewer account cannot connect a single channel** under the current production config (FREE tier = 0 channels, billing enforced).
6. **`.env.prod` containing real production secrets was committed to git history** (commit `1195455e`). It is untracked now, but the secrets are still recoverable from history.

Items 1–5 are each individually sufficient grounds for rejection by Meta and TikTok. Item 6 is an incident to handle regardless of any application.

---

## 1. OAuth Integration Security

### 1.1 Architecture of the flow (governs every provider)

| Stage | Location |
|---|---|
| Initiate (authenticated) | `apps/backend/src/api/routes/integrations.controller.ts:194` — `GET /integrations/social/:integration` |
| State/verifier persisted | `integrations.controller.ts:226-248` — six Redis keys, 3600s TTL: `refresh:{state}`, `onboarding:{state}`, `redirect:{state}`, `organization:{state}`, `login:{state}` (holds `codeVerifier`), `external:{state}` |
| Callback landing | `apps/frontend/src/components/launches/continue.integration.tsx:59-89` — reads `code`/`state` from query string |
| Exchange (unauthenticated) | `apps/backend/src/api/routes/no.auth.integrations.controller.ts:43-90` — `POST /integrations/social-connect/:integration` |
| State verification | `no.auth.integrations.controller.ts:61-70` — `ioRedis.get('login:'+state)` → `'Invalid state'`; `ioRedis.get('organization:'+state)` → `'Organization not found'` |

**State is verified.** The callback endpoint has no session guard, but the `state` value is a server-minted Redis key that binds the callback to the initiating organization. This is a legitimate CSRF mitigation, with one caveat below.

**Caveat — state entropy.** `makeId()` (`libraries/nestjs-libraries/src/services/make.is.ts:1-10`) builds the string character-by-character from `Math.random()`, not a CSPRNG. It is used for `state` in the majority of providers, typically at length 6 (`facebook.provider.ts`, `instagram.provider.ts`, `threads.provider.ts`, `linkedin.provider.ts`, `pinterest.provider.ts`, `reddit.provider.ts`, `youtube.provider.ts` at length 7). TikTok uses `Math.random().toString(36).substring(2)` (`tiktok.provider.ts:309`). Only `kick.provider.ts:27-38` and `whop.provider.ts:30-32` use `crypto.randomBytes`; `x.provider.ts:350-396` uses `crypto.randomBytes(16)` for its OAuth1 nonce. A 6-character `Math.random()` state is a weak CSRF token by any reviewer's standard.

### 1.2 Per-provider matrix

| Provider | Flow | PKCE | State verified | Refresh implemented | Proactive refresh cron | Revoke on disconnect |
|---|---|---|---|---|---|---|
| Facebook | OAuth 2.0 code + `fb_exchange_token` long-lived | No (n/a) | Yes | **No — stub** `facebook.provider.ts:194` | via cron → fails → disconnect | **No** |
| Instagram (Business, via FB) | OAuth 2.0 code (FB dialog) `instagram.provider.ts:371-385` | No (n/a) | Yes | **No — stub** `:68-78` | — | **No** |
| Instagram (Standalone) | OAuth 2.0 code | No (n/a) | Yes | Yes `:75-102` (`ig_refresh_token`, 58d) | Yes (`refreshCron=true` `:30`) | **No** |
| Threads | OAuth 2.0 code + `th_exchange_token` | No (n/a) | Yes | Yes `:73-93` (58d) | Yes (`:30`) | **No** |
| LinkedIn (personal) | OAuth 2.0 code + refresh_token | No | Yes | Yes `:98-147` | `refreshWait=true` `:44` | **No** |
| LinkedIn (page) | OAuth 2.0 code + refresh_token | No | Yes | Yes `:40-91` | — | **No** |
| TikTok | OAuth 2.0 code, **malformed PKCE** | **Broken** — see below | Yes | Yes `:263-306` (23h hardcoded) | **No cron** | **No** |
| Pinterest | OAuth 2.0 code, Basic auth | No | Yes | Yes `:111-148` | **No cron** | **No** |
| YouTube / Google | OAuth 2.0 offline (`googleapis`) `:26-28` | No | Yes | Yes `:259-280` | **No cron** (reactive on `invalid_grant`) | **No** |
| Reddit | OAuth 2.0 code, `duration=permanent` | No | Yes | Yes `:61-95` | **No cron** | **No** |
| X / Twitter | **OAuth 1.0a** 3-legged (`twitter-api-v2`) | n/a | Yes (`oauth_token` as state) | n/a — `expiresIn: 999999999` `:326` | n/a | **No** |
| Kick | OAuth 2.0 + **real S256 PKCE** `:27-38` | **Yes** | Yes | Yes | — | **No** |
| Whop | OAuth 2.0 + **real S256 PKCE** `:30-32`, no client secret | **Yes** | Yes | — | — | **No** |
| Discord | OAuth 2.0 code + bot perms bitmask `377957124096` | No | Yes | — | — | **No** |
| Slack, Dribbble, Twitch, Mastodon, GMB, MeWe | OAuth 2.0 code | No | Yes | mixed | — | **No** |
| Bluesky | App password (`customFields`) | n/a | n/a | n/a | — | n/a |
| Nostr | User-supplied private key (`customFields`) | n/a | n/a | n/a | — | n/a |
| Dev.to, Medium, Hashnode, Lemmy, Listmonk, WordPress, Telegram, Skool, Moltbook | API key / credentials / custom | n/a | n/a | n/a | — | n/a |
| Farcaster (`wrapcast`) | Neynar signer blob | n/a | **No signature check** — see below | n/a | — | n/a |

*All provider paths above are relative to `libraries/nestjs-libraries/src/integrations/social/`.*

### 1.3 Specific OAuth defects

**TikTok PKCE is not real PKCE.** `tiktok.provider.ts:308-328` sets `codeVerifier = state` (the plain CSRF value), and the authorize URL sent to `/v2/auth/authorize/` contains **no `code_challenge` and no `code_challenge_method`**. The raw value is then submitted as `code_verifier` at token exchange (`:340`). There is no SHA-256 binding. TikTok's audit process specifically checks PKCE for the Login Kit / Content Posting API. Compare with the correct implementation already in this codebase at `kick.provider.ts:27-38`.

**No provider revokes tokens.** Exhaustive grep of `libraries/nestjs-libraries/src/integrations/` for `revoke`, `deauthorize`, `/revoke`, `me/permissions` returns exactly two hits — `facebook.provider.ts:271` and `instagram.provider.ts:418` — and both are **GET** requests to `graph.facebook.com/v20.0/me/permissions` used to *read* granted scopes for `checkScopes()`. Neither is a `DELETE`. `SocialAbstract` (`social.abstract.ts`) defines no `revoke()` contract, and `IntegrationService.deleteChannel` (`integration.service.ts:273-275`) never calls into a provider.

**Farcaster trusts a client-supplied blob.** `farcaster.provider.ts` `authenticate()` does `JSON.parse(Buffer.from(code,'base64').toString())` on the `code` parameter with no HMAC/signature verification that it originated from Neynar. A caller who reaches the callback with a valid `state` can assert an arbitrary `signer_uuid`/`fid`.

**Open redirect on the connect flow.** `integrations.controller.ts:199,237-239` accepts an arbitrary `redirectUrl` query parameter, stores it under `redirect:{state}`, and returns it as `returnURL`; `continue.integration.tsx:44-58,116-195` calls `push(returnURL)` unconditionally. No origin allowlist. A reviewer probing your OAuth entry point will find this.

**`redirectmeto.com` third-party relay.** Instagram-standalone (`:111-115`), Threads (`:101-107`), TikTok (`:316-320,341-345`) and Slack (`:54,80`) rewrite the redirect URI through `https://redirectmeto.com/${FRONTEND_URL}` whenever `FRONTEND_URL` does not contain `https`. On a non-HTTPS deployment this routes the OAuth **authorization code** through an unaffiliated public relay. This must never be reachable in a production or reviewer-facing build.

### 1.4 Secret storage and frontend exposure

**Secrets are server-side only. This part is clean.**

- No hardcoded client IDs or secrets in source. The only literal is a dummy placeholder UUID fallback at `farcaster.provider.ts:20` when `NEYNAR_SECRET_KEY` is unset.
- Grep of `apps/frontend` for `*_SECRET`, `*_APP_SECRET`, `*_API_SECRET`: **no matches**. `NEXT_PUBLIC_*` variables are limited to backend URL, upload directory, extension ID, Sentry DSN, GTM ID and Facebook Pixel ID — none secret.
- All provider secrets are read from `process.env` inside provider classes executing in the NestJS backend.

**However — the platforms you are applying to are not configured in production.** From `.env.prod`:

| Var | Present in `.env.prod` |
|---|---|
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | **absent** |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | **absent** |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | **absent** |
| `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET` | **absent** |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | **absent** |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | **absent** |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | present |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | present |
| `X_API_KEY` / `X_API_SECRET` | present |

And `integration.manager.ts:166-168` (`getAllowedSocialsIntegrations()`) returns **every** provider in the hardcoded list regardless of whether its env vars are set. A reviewer clicking "Facebook" on your production instance today gets an OAuth URL with `client_id=undefined`. That is a guaranteed rejection at the screencast stage.

---

## 2. Access Token Storage

### Answer: **No. OAuth access and refresh tokens are NOT encrypted at rest.**

**Evidence.** `IntegrationRepository.createOrUpdateIntegration` (`libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts:243-296`) writes `token` and `refreshToken` verbatim into both the `create` and `update` branches of the Prisma upsert. No encryption call. `updateIntegration` (`:141-183`) does the same for the refresh path. `IntegrationService.checkAnalytics` (`integration.service.ts:280-320`) and the publish path read `.token` directly and hand it to the provider SDK — confirming no decryption step exists on the way out either.

Of 33 providers, exactly one (`skool.provider.ts:121`) pre-encrypts its own value before persisting.

### What *is* encrypted

`AuthService.fixedEncryption` / `fixedDecryption` (`libraries/helpers/src/auth/auth.service.ts:22-33,49-55`) is applied to:

| Field | Location |
|---|---|
| `Organization.apiKey` | `organization.repository.ts:270` |
| `ThirdParty.apiKey` | `third-party.repository.ts:51,59` |
| `OAuthApp.clientSecret` | `oauth.service.ts` |
| `OAuthAuthorization.accessToken` / `authorizationCode` | `oauth.service.ts` |
| `Integration.customInstanceDetails` | `no.auth.integrations.controller.ts:228-239` (Bluesky, Lemmy, Listmonk, Skool) |

### Algorithm and key management — the encryption that exists is weak

```
libraries/helpers/src/auth/auth.service.ts
:6    algorithm = 'aes-256-cbc'
:9-20 deriveLegacyKeyIv(secret) → EVP_BytesToKey(JWT_SECRET, null, 256, 16, 'md5')
:22-33 encrypt/decrypt with that derived key AND that derived IV
```

Four distinct problems:

1. **The IV is fixed and deterministic.** Derived from `JWT_SECRET`, so it is identical for every record. AES-CBC with a constant IV is deterministic encryption: identical plaintexts produce identical ciphertexts. This is intentional (the ciphertext is used as an indexed lookup key in `oauth.repository.ts:184-207`), but it forfeits IND-CPA security.
2. **The KDF is `EVP_BytesToKey` with MD5** — OpenSSL's deprecated legacy derivation, no salt, no iteration count.
3. **No authentication.** No AEAD, no HMAC. Ciphertext is malleable.
4. **The API key case is security theatre.** `Organization.apiKey` is generated as `fixedEncryption(makeId(20))` and the **ciphertext itself is the bearer token** presented by the client and matched by DB equality. The plaintext is never used again. A database dump therefore yields directly usable API keys without needing `JWT_SECRET` at all.

**Key location: `JWT_SECRET`, and it is reused for three unrelated purposes** — session JWT signing, password-reset/activation token signing, and derivation of the AES key *and* IV. It is also the secret behind the privileged `EnterpriseController` and `PublicController.modifySubscription` endpoints. One leak compromises sessions, encrypted DB columns, and org-provisioning simultaneously. Rotating it invalidates every encrypted column in the database.

**Is the encryption key separated from the database?** Yes in the sense that `JWT_SECRET` and `DATABASE_URL` are distinct env vars in `.env.prod` — but both live in the same file, loaded into the same process, with no KMS, no HSM, no envelope encryption. `configuration.checker.ts:28` only checks `JWT_SECRET` is non-empty; no length or entropy floor, and no rejection of the `.env.example` placeholder text.

---

## 3. Database Security

### Sensitive fields (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`)

| Model | Field | Protection |
|---|---|---|
| `Integration` | `token` (String, required) | **Plaintext** |
| `Integration` | `refreshToken` (String?) | **Plaintext** |
| `Integration` | `tokenExpiration`, `internalId`, `rootInternalId`, `profile`, `additionalSettings` | Plaintext |
| `Integration` | `customInstanceDetails` | Encrypted (deterministic AES-CBC) |
| `User` | `password` | bcrypt cost 10 — correct |
| `User` | `email`, `name`, `picture`, `ip`, `agent` | Plaintext |
| `Organization` | `apiKey` | "Encrypted" but ciphertext *is* the credential |
| `Organization` | `paymentId` (Stripe customer) | Plaintext |
| `GitHub` | `token` | **Plaintext** |
| `ThirdParty` | `apiKey` | Encrypted |
| `OAuthApp` | `clientSecret` | Encrypted |
| `OAuthAuthorization` | `accessToken`, `authorizationCode` | Encrypted (deterministic, indexed) |
| `Post` | `content`, `title`, `settings`, `error` | Plaintext |
| `Media` | `path`, `name`, `originalName` | Plaintext |
| `Errors` | `message`, `platform`, `body` | Plaintext — stores **raw provider response bodies** |
| `Webhooks` | `url` | Plaintext; **model has no signing-secret field at all** |
| `mastra_*` (5 tables) | AI agent spans, messages, resources | Plaintext |

### SQL injection — clean

Repo-wide grep for `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`: **zero matches** in `apps/` and `libraries/`. All access is via the Prisma query builder with parameterised `where`/`data` objects. No injection surface found.

### ORM and migration safety — a real production risk

- `libraries/nestjs-libraries/src/database/prisma/migrations/` **does not exist**. There is no migration history at all.
- `package.json:34` — `"prisma-db-push": "... db push --accept-data-loss ..."`
- `package.json:18` — `"pm2-run": "pm2 delete all || true && pnpm run prisma-db-push && ..."`

The production container runs **`prisma db push --accept-data-loss` on every single start**. Destructive schema changes (column drops, type narrowing) are auto-approved with no review gate, no versioned SQL, and no rollback path. For a system holding live OAuth tokens for third-party platforms, this is the single most dangerous line in the repository.

### Database permissions and transport

- `docker-compose.yaml:114-116` — dedicated non-superuser role `postiz-user`, database `postiz-db-prod`. Good. Password is the hardcoded literal `postiz-password`, not env-substituted.
- No host port published for Postgres (`docker-compose.yaml:119-121`), so it is reachable only on the internal bridge network. This is the main thing keeping the hardcoded password from being critical.
- **No `sslmode` anywhere** — grep for `sslmode`/`rejectUnauthorized` returns nothing. App↔DB traffic is unencrypted. Acceptable only while co-located; an immediate problem the day `DATABASE_URL` points at a managed Postgres.

### Tenant isolation — good at the boundary, thin in the repository layer

`organizationId` is always resolved server-side via `@GetOrgFromRequest()` (`libraries/nestjs-libraries/src/user/org.from.request.ts:3-8`) from `request.org`, populated only by `AuthMiddleware`. Grep for `@Body('organizationId')` / `@Query('organizationId')` across `apps/backend/src/api/routes`: **no matches**. No live IDOR found.

Latent gaps — repository methods with no org filter, currently protected only by their callers:

- `IntegrationRepository.updateNameAndUrl(id,...)` `:365-374` — `where: { id }` only
- `IntegrationRepository.setBetweenRefreshSteps(id)` `:343-352` — `where: { id }` only
- `IntegrationRepository.getPlug(plugId)` `:120-128` — no org filter
- `PostsRepository.getPost(...)` `:360-384` and `getPostById(...)` `:687-697` — org filter is a **conditional spread** (`...(orgId ? {} : {})`), i.e. optional by signature
- `PostsRepository.updatePost(id, ...)` `:386-395` — no org filter

---

## 4. Data Deletion Compliance

| Requirement | Status | Evidence |
|---|---|---|
| User account self-deletion | **MISSING** | No `@Delete` in `users.controller.ts`; `users.service.ts`/`users.repository.ts` contain no delete method; no frontend UI (grep of `apps/frontend/src` for delete-account: zero hits; `components/settings/` has 7 components, none for deletion) |
| Organization deletion | **MISSING** | `organization.repository.ts` / `organization.service.ts` — only `deleteTeamMember` exists |
| Connected-channel disconnect | **EXISTS but soft** | `integrations.controller.ts:402-418` → `integration.repository.ts:533-543`: `update({ data: { deletedAt: new Date() } })` — **`token` and `refreshToken` are not cleared** |
| OAuth token deletion from DB | **MISSING** | Same as above — the live token survives "disconnect" indefinitely |
| Remote token revocation | **MISSING** | No provider implements it; see §1.3 |
| **Meta Data Deletion Callback** | **MISSING** | Grep for `signed_request`, `data_deletion`, `confirmation_code`, `parseSignedRequest`: **zero backend matches** |
| **Meta Deauthorize Callback** | **MISSING** | Grep for `deauthorize`, `deauth`: zero matches |
| GDPR data export | **MISSING** | Zero matches for `GDPR`, `data-export`, `export-data` in `apps/`/`libraries/` (only hits are marketing docs under `market/`) |
| Post deletion | Soft only | `posts.repository.ts:319-328` — `deletedAt` stamp via `updateMany` |
| Media deletion | Soft only, **file never removed** | `media.repository.ts:40-50` sets `deletedAt`. `IUploadProvider.removeFile` **is implemented** (`local.storage.ts:116-121`, `cloudflare.storage.ts:158+`) but grep shows it is **never called** from `MediaService`, `PostsService` or any controller. Uploaded files persist on disk/R2 forever. |
| Retention / purge job | **MISSING** | `apps/orchestrator/src/workflows/` contains only autopost, digest-email, missing-post, post v1.0.1–5, refresh-token, send-email, streak. No `@Cron`, no Temporal Schedule, no purge script. Soft-deleted rows and the `Errors` table accumulate indefinitely. |
| Inbound platform webhook verification | **N/A — none received** | `webhooks.controller.ts` is *outbound* user-configured webhooks only. The only verified inbound webhook is Stripe (`stripe.controller.ts:16-23`, HMAC over raw body) — use it as the reference implementation. |

### What must be built for Meta App Review

1. **`POST /facebook/data-deletion`** — parse `signed_request`, base64url-split, verify HMAC-SHA256 with `FACEBOOK_APP_SECRET`, reject on mismatch; resolve the Meta `user_id` to your `Integration` rows; erase; return `{ url, confirmation_code }`; expose a status-check page at that `url`.
2. **`POST /facebook/deauthorize`** — same signature verification; immediately null `token`/`refreshToken` and disconnect the integration.
3. **Real revocation** on user-initiated disconnect: `DELETE https://graph.facebook.com/v20.0/me/permissions?access_token=…`, plus `https://oauth2.googleapis.com/revoke` (Google), LinkedIn/Reddit/X equivalents.
4. **Hard-delete semantics.** Every deletion path today is a `deletedAt` stamp. Nothing built on top of it satisfies "delete the person's data." Either hard-delete or add a time-bounded purge job that finally erases rows *and* calls the already-implemented `removeFile()`.
5. **A user-facing account deletion page**, linked from the privacy policy, and a public "delete my data" instructions URL.

---

## 5. Privacy Policy — Technical Data Inventory

Everything below is grounded in code or `.env.prod`. Nothing inferred.

### User data collected directly

| Data | Where stored | Why (code purpose) | Retention |
|---|---|---|---|
| Email address | `User.email` | Login identity, notifications, billing | Indefinite — no deletion path exists |
| Password (bcrypt hash) | `User.password` | Local auth (`auth.service.ts:36`) | Indefinite |
| Name, profile picture | `User.name`, `User.picture` | UI display | Indefinite |
| IP address | `User.ip` (`auth.controller.ts:47,121` via `@RealIP()`) | Signup/login logging | Indefinite |
| User agent | `User.agent` | Signup/login logging | Indefinite |
| Timezone | `User.timezone` | Post scheduling | Indefinite |
| Organization name, API key, Stripe customer id | `Organization.*` | Tenancy, public API, billing | Indefinite |

### Platform (social) data collected

| Data | Where stored | Why |
|---|---|---|
| OAuth access token | `Integration.token` (**plaintext**) | Publishing and analytics API calls |
| OAuth refresh token | `Integration.refreshToken` (**plaintext**) | Token renewal |
| Token expiry | `Integration.tokenExpiration` | Refresh scheduling |
| Platform account/page ID | `Integration.internalId`, `rootInternalId` | Target selection for publishing |
| Platform display name, handle, avatar | `Integration.name`, `profile`, `picture` | Channel list UI |
| Granted scopes (read only) | via `checkScopes()` — not persisted | Validating required permissions |
| Post analytics/insights | fetched on demand per provider `analytics()` | Analytics dashboards |
| Published post ID and URL | `Post.releaseId`, `Post.releaseURL` | Linking back to the live post |
| Raw platform error responses | `Errors.body`, `Post.error` | Debugging failed publishes — **includes whatever the platform returned** |
| Custom instance credentials | `Integration.customInstanceDetails` (encrypted) | Bluesky/Lemmy/Listmonk/Mastodon self-hosted |

### User content

Post content, titles, descriptions, scheduled dates, comments, signatures, tags, sets, plugs, autopost rules, webhook URLs — all plaintext in Postgres. Uploaded media (images, MP4 up to 1 GB) stored via `STORAGE_PROVIDER` with metadata in `Media` (`path`, `name`, `originalName`, `thumbnail`, `fileSize`). AI agent conversations and traces in `mastra_ai_spans`, `mastra_messages`, `mastra_resources`, `mastra_evals`.

### Third-party processors (from `.env.prod` and code)

| Processor | What it receives | Evidence |
|---|---|---|
| **Cloudflare R2** | All uploaded user media | `CLOUDFLARE_*`, `libraries/nestjs-libraries/src/upload/cloudflare.storage.ts` |
| **Stripe** | Email, name, org id, payment data | `STRIPE_*`, `stripe.service.ts` |
| **Polar** (implemented, parked) | Same as Stripe | `POLAR_*`, `polar.service.ts` |
| **Resend / SMTP** | Email address, notification content | `RESEND_API_KEY`, `EMAIL_HOST/USER/PASS`, `email.service.ts` |
| **OpenAI** | Post content and AI prompts | `OPENAI_API_KEY`, `libraries/nestjs-libraries/src/openai/` |
| **PostHog** | **User ID, email and name** — `posthog.identify(user.id, { email, name })` | `libraries/helpers/src/utils/use.fire.events.ts:20` |
| **Google Tag Manager / Google Ads** | Page views, conversion events | `apps/frontend/src/components/layout/gtm.component.tsx:29,46-51` |
| **Meta / Facebook Pixel** | Page views, conversion events | `apps/frontend/src/components/layout/facebook.component.tsx:11-18` |
| **Sentry** | Error traces; if enabled, **all console output and full OpenAI prompts/completions** | `initialize.sentry.ts:29-33` (`recordInputs/recordOutputs: true`) — currently disabled, DSN unset |
| **Temporal** | Workflow payloads including post content | `TEMPORAL_ADDRESS` |
| **Neynar** | Farcaster signer data | `NEYNAR_*` |
| **redirectmeto.com** | **OAuth authorization codes** on non-HTTPS deployments | §1.3 |

Your privacy policy must name PostHog, Facebook Pixel and Google Ads explicitly — Meta's reviewers check that the pixel you run is disclosed, and PostHog receiving user emails is a processor relationship that needs a DPA.

**Retention statement you can currently make truthfully:** "indefinitely, until manually removed by an administrator." There is no automated retention anywhere. If your policy claims a retention period, it will be false.

---

## 6. Security Controls

### Authentication

| Control | Finding |
|---|---|
| Password policy | **`@MinLength(3)`, `@MaxLength(64)`, no complexity** — `create.org.user.dto.ts:12-17`, `login.user.dto.ts:11-15` |
| Hashing | bcrypt cost 10, `compareSync` — correct (`auth.service.ts:36-41`) |
| Brute-force / lockout | **NOT FOUND** — no counter, no delay, no CAPTCHA |
| Rate limit on login | **None** — `throttler.provider.ts:7-16` only enforces for `POST /public/v1/posts`; every other route returns `true` |
| Email activation | Enforced at login (`auth.service.ts:89-91`) and on every request (`auth.middleware.ts:55-57`, re-reads from DB — good). **But** `activated` is set to `true` when no email provider is configured (`organization.repository.ts:278`), and `.env.prod:37` sets `EMAIL_PROVIDER="resend|nodemailer"` — a literal placeholder that matches neither branch of the switch in `email.service.ts:27-34`, falling through to `EmptyProvider`. **Net effect: activation is silently disabled in production; new users are auto-activated.** |
| Password reset | JWT with a manual 20-min `expires` field checked in app code (`auth.service.ts:217-245`); the JWT itself has no `exp` claim |
| Activation link | Reuses the non-expiring session JWT (`auth.service.ts:75-82`) — a leaked activation email is a permanent credential |
| **MFA / 2FA** | **NOT FOUND** — grep for `totp`, `otpauth`, `speakeasy`, `twoFactor`, `2fa`, `authenticator`: no implementation |

### Session / JWT

- `sign(value, JWT_SECRET)` with **no `expiresIn`** (`libraries/helpers/src/auth/auth.service.ts:42-44`). **Session JWTs never expire.**
- Cookie `auth`: `httpOnly: true, secure: true, sameSite: 'none'`, `expires: +365 days` (`auth.controller.ts:72-82`). All flags conditional on `NOT_SECURED` being unset.
- Logout clears the cookie client-side only (`auth.middleware.ts:11-25`). **No server-side revocation, no JTI, no session store.** A stolen token is valid forever until `JWT_SECRET` rotates.
- JWT payload is the **entire User object** minus password, including `email` and `isSuperAdmin` (`auth.service.ts:314-319`).
- `verify()` does not pin `algorithms` (`auth.service.ts:46`). Not directly exploitable with a string HMAC key, but unpinned.
- Mitigating: `auth.middleware.ts:39-57` re-resolves the user from the database on every request and does not trust `activated`/`isSuperAdmin` from the token.

### Authorization

- Auth is Express middleware, not a Nest guard: `api.module.ts:110` applies `AuthMiddleware` to an explicit list of 19 controllers (`:49-69`).
- **Controllers outside that list** (`api.module.ts:72-83`): `RootController`, `StripeController` (signature-verified), `PolarController`, `AuthController`, `PublicController`, `MonitorController`, `EnterpriseController`, `NoAuthIntegrationsController`, `OAuthController`.
- **`EnterpriseController` is the notable one** (`enterprise.controller.ts:21-127`): `/enterprise/create-user`, `/enterprise/url`, `/enterprise/delete-channel` are gated **only** by a JWT signed with the same `JWT_SECRET` as user sessions. A `JWT_SECRET` leak grants max-tier org creation, OAuth link generation and channel deletion for any org. Same pattern in `PublicController.modifySubscription` (`:131-155`).
- `PoliciesGuard` (`permissions.guard.ts`) is subscription/feature enforcement, not authentication; it short-circuits to `true` for paths containing `/auth`, `/integrations/social-connect`, `/integrations/provider` (`:24-31`).
- RBAC: `SUPERADMIN | ADMIN | USER`. `AdminController` calls `assertSuperAdmin` per method (`:22-25,37,49,60`). Impersonation (`users.controller.ts:102-139`) is superadmin-only, checked against the DB-resolved flag.
- `PublicController.createAgent` (`:42-52`) compares `AGENT_API_KEY` with `!==`; `oauth.service.ts:116` compares client secrets with `!==`. No `timingSafeEqual` anywhere.

### Infrastructure

| Control | Finding |
|---|---|
| CORS | Allowlist, not wildcard: `[FRONTEND_URL, 'http://localhost:6274', MAIN_URL?]` with `credentials: true` (`apps/backend/src/main.ts:24-49`). The hardcoded localhost origin should be dev-gated. |
| CSRF token | **NOT FOUND** — no `csrf`/`XSRF` anywhere. With `sameSite: 'none'` + `credentials: true`, `multipart/form-data` upload endpoints are cross-site form-submittable without preflight. |
| Rate limiting | Redis-backed throttler configured (`app.module.ts:35-43`, `API_LIMIT` default 90/hr) but `throttler.provider.ts:7-16` applies it **only** to `POST /public/v1/posts`. Everything else — auth, media, admin, the rest of the public API — is unthrottled. |
| Security headers | No `helmet`. `next.config.js:10-22` sets only `Document-Policy`. `var/docker/nginx.conf:36-51` sets `nosniff` + a strict CSP **only on `/uploads/`**; the app and `/api/` locations (`:20-34,53-68`) have **no HSTS, no CSP, no X-Frame-Options**. |
| HTTPS | No redirect logic in-repo; TLS assumed at an external layer. No `trust proxy` set despite `@RealIP()` usage. |
| File upload | **Strong.** Magic-byte type sniffing against an allowlist, 10 MB image / 1 GB video caps, filename sanitisation (`custom.upload.validation.ts:9-67`), random 32-hex on-disk filenames with the client name never used in the path (`local.storage.ts:63-100`), re-validation at the storage layer, and uploads served under a `default-src 'none'; sandbox` CSP. |
| SSRF | **Strong framework, two gaps.** `isSafePublicHttpsUrl()` + `ssrfSafeDispatcher` (re-validating DNS at connect time) protect `streamFile`, `uploadSimple`, and `uploadsFromUrl`. **But** `webhooks.controller.ts:57-61` and `apps/orchestrator/src/activities/post.activity.ts:330-336` call bare `fetch()` with no dispatcher — DNS-rebinding bypass, and the orchestrator path fires webhook URLs validated weeks earlier at creation time. |
| `eval` / `child_process` | **NOT FOUND** |

---

## 7. Production Readiness

**Deployment.** Single container `ghcr.io/aitechnologysys-sys/veroza` (`docker-compose.yaml:28`), built in GitHub Actions from `Dockerfile.dev` (`.github/workflows/build-containers.yml:131`) — there is **no production Dockerfile**. Runtime is nginx + pm2 supervising three `pnpm start` processes (`Dockerfile.dev:28`). **No `ecosystem.config.js` exists** — pm2 runs on defaults with no restart policy or memory limit.

**Config validation does not block boot.** `apps/backend/src/main.ts:73-99` calls `checkConfiguration()` **after** `app.listen()` and only `Logger.warn`s failures. A missing `JWT_SECRET` or malformed `DATABASE_URL` will not stop the container from serving traffic. Only 7 vars are checked at all (`configuration.checker.ts:26-34`); no provider keys, no `TEMPORAL_ADDRESS`.

**Hardcoded credentials that ship.** `docker-compose.yaml:114-116` — `POSTGRES_PASSWORD: postiz-password`. `:170-171` — Temporal Postgres `temporal/temporal`. `docker-compose.dev.yaml:39-40` — pgAdmin `admin@admin.com` / `admin`, published on port 8082.

**`.env.prod` is in git history.** `git log --all --diff-filter=A -- .env.prod` → commit **`1195455e`** ("feat: polar webhook endpoint fix and update readme"). It is untracked in the working tree today (`git ls-files` shows only `.env.example`), and `.gitignore:7-10` carries a note about it — but the file was committed and every secret in it is recoverable from history on the `aitechnologysys-sys/veroza` remote: `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_SIGNING_KEY`, `LINKEDIN_CLIENT_SECRET`, `REDDIT_CLIENT_SECRET`, `X_API_SECRET`, `GITHUB_CLIENT_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, Cloudflare R2 keys, `NGROK_AUTHTOKEN`. **All of these must be rotated.** Note `JWT_SECRET` rotation also invalidates every `fixedEncryption` column — plan that migration.

**Debug / information exposure.**

- `next.config.js:26` — `productionBrowserSourceMaps: true`. Full original TypeScript source is reconstructable from the deployed frontend.
- `NODE_ENV` is never set at runtime in `docker-compose.yaml`, `.env` or `.env.prod`. Next.js self-sets it; the NestJS backend and orchestrator do not.
- Swagger is mounted unconditionally at `/docs` with no env gate and no auth (`libraries/helpers/src/swagger/load.swagger.ts:1-12`, called at `main.ts:69`). Your entire API surface is public documentation.
- `posts.repository.ts:414-446` persists the **raw provider response body** into `Errors.body` and `JSON.stringify(err)` into `Post.error`, which is then rendered directly in the UI tooltip (`calendar.tsx:1050-1057`). Own-org data only, but unfiltered internal detail.
- `listmonk.provider.ts:75-82` — **`console.log(body)` where `body` is `{ url, username, password }` in plaintext.** Also bare `console.log` of response bodies at `threads.provider.ts:43` and `reelfarm.provider.ts:69`.

**Logging / monitoring.** Nest's built-in `Logger` plus ad-hoc `console.log` to stdout, captured by pm2. No aggregation. Sentry is wired but **disabled** — `NEXT_PUBLIC_SENTRY_DSN` is absent from all env files. If enabled as configured, it would forward all console output (including the Listmonk password) and full OpenAI prompts/completions with no `beforeSend` scrubber (`initialize.sentry.ts:29-33`).

**Health checks are misleading.** `docker-compose.yaml:87-93` probes `http://localhost:5000` which hits `RootController` → `'App is running!'` via the frontend. The documented failure mode (`docker-compose.yaml:205-213`) is that Temporal being unreachable kills the backend at module init while the frontend keeps serving — **the healthcheck reports healthy while the API is dead**. `monitor.controller.ts:1-14` returns `"Queue X is healthy"` unconditionally for any name; it performs no check at all.

**Background jobs.** Temporal is a hard dependency (`temporal.module.ts:9-16`, `isGlobal: true`) — the backend will not boot without it, and pm2 does not restart it. Post publishing retry: `maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes'` (`post.workflow.v1.0.5.ts:19-46`) — **flat, no exponential backoff**. A separate 5-iteration application loop retries only `refresh_token` failures (`:50,167,219-237`). On `bad_body` failure the user gets an in-app + email notification (`:248-259`); on **exhausted token refresh the post is silently marked ERROR with no notification** (`:230-233`). Idempotency is a state check (`:90-93`), not a provider-level idempotency key — a lost response after a successful publish can double-post. There is **no retry button**; a user must re-save or reschedule the post.

---

## 8. Reviewer Test Account Readiness

| Check | Status |
|---|---|
| Signup works without manual approval | **Yes.** `DISABLE_REGISTRATION: 'false'` and `IS_GENERAL: 'true'` are forced in `docker-compose.yaml:63-64` |
| Email activation blocks the reviewer | **No** — but only by accident: `EMAIL_PROVIDER="resend|nodemailer"` (`.env.prod:37`) matches no case in `email.service.ts:27-34`, so `hasProvider()` is false and users are auto-activated |
| Login works | **Only over HTTPS.** Cookie is `secure: true, sameSite: 'none'` (`auth.middleware.ts:14-19`) and `NOT_SECURED` is unset. Over plain HTTP the browser drops the cookie and the session never persists. |
| Reviewer can connect a channel | **NO — hard blocker.** `BILLING_ENABLED=true` (`.env.prod:94`), new orgs get no `Subscription` row, so `permissions.service.ts:22-38` resolves tier `FREE`, and `pricing.FREE.channel = 0` (`pricing.ts:23-40`). `GET /integrations/social/:integration` carries `@CheckPolicies([Create, CHANNEL])` (`integrations.controller.ts:47,194`) and `0 > 0` is false. The reviewer gets *"You have reached the maximum number of channels for your subscription"* on the very first click. |
| Reviewer can create a post | **No** — `posts_per_month: 0` on FREE, same gate |
| Demo/seed data | **NOT FOUND** — no seed script, no fixtures, no demo mode |
| Empty states | Calendar/launches handles the no-posts case; analytics and media empty paths not confirmed — click through manually before handoff |
| Target platform credentials configured | **No** — Facebook, Instagram, Threads, TikTok, Pinterest and YouTube keys are all absent from `.env.prod`, yet all ~30 providers are shown in the UI unconditionally (`integration.manager.ts:166-168`) |

---

## 9. Screencast Readiness

| # | Step reviewers must see | Can it be recorded today? |
|---|---|---|
| 1 | Signup / login | **Yes**, if served over HTTPS |
| 2 | Connect social account | **No** — billing gate (§8) blocks the first click, and the target platforms have no credentials configured |
| 3 | Complete OAuth flow | **No** — blocked by 2; and for Instagram-standalone/Threads/TikTok/Slack on non-HTTPS it would route through `redirectmeto.com` |
| 4 | See connected account | Blocked by 2 |
| 5 | Create scheduled post | **No** — `posts_per_month: 0` on FREE |
| 6 | Publish | Blocked by 5 |
| 7 | Disconnect account | Route exists (`integrations.controller.ts:402-418`), reachable only after 2 |
| 8 | **Delete data** | **NO — does not exist.** No account deletion endpoint, no UI, no data-deletion callback. This is the step Meta and TikTok explicitly ask you to demonstrate. |

**A compliant screencast cannot be produced from the current build.** Steps 2 and 8 are hard stops.

---

## 10. Final Score

### A) READY NOW

- Provider secrets are server-side only; no secret reaches the browser bundle
- No SQL injection surface — Prisma only, zero raw queries
- File upload validation (magic bytes, size caps, random on-disk names, sandboxed CSP on `/uploads/`)
- SSRF framework with connect-time DNS re-validation for uploads and media streaming
- Tenant isolation at the controller boundary — `organizationId` never accepted from user input
- bcrypt password hashing at cost 10
- OAuth `state` is server-minted, Redis-stored and verified on callback
- Correct S256 PKCE reference implementations already in the tree (`kick.provider.ts`, `whop.provider.ts`)
- Stripe webhook HMAC verification — a good in-repo template for the Meta callbacks

### B) NEEDS FIX BEFORE APPLYING

| # | Issue | Severity | Location | Why the platform cares | Recommended fix |
|---|---|---|---|---|---|
| 1 | OAuth access + refresh tokens stored plaintext | **Critical** | `integration.repository.ts:243-296`; `schema.prisma` `Integration.token/refreshToken` | Meta's Data Protection Assessment and TikTok's audit both ask directly whether platform tokens are encrypted at rest. "No" is a fail. | Encrypt with AES-256-GCM, random per-record IV, key from a KMS/secret manager separate from `JWT_SECRET`. Migrate existing rows. |
| 2 | No Meta Data Deletion Callback | **Critical** | NOT FOUND — no `signed_request` handler anywhere | Mandatory field in the Meta App Dashboard; submission cannot pass without it | Add `POST /facebook/data-deletion`: verify HMAC-SHA256 `signed_request` with the app secret, erase, return `{url, confirmation_code}`, plus a status page |
| 3 | No Deauthorize Callback | **Critical** | NOT FOUND | Mandatory Meta field; reviewers verify the app stops using tokens after a user removes it | Add `POST /facebook/deauthorize`, same verification, null the tokens and disconnect |
| 4 | No user account deletion (endpoint or UI) | **Critical** | `users.controller.ts`, `settings.controller.ts`, `users.service.ts`, `apps/frontend/src/components/settings/` | Meta, Google and TikTok all require a demonstrable in-product deletion path | Build `DELETE /user/self` with full cascade + a settings UI + a public deletion-instructions URL |
| 5 | Disconnect keeps the live token; never revokes remotely | **Critical** | `integration.repository.ts:533-543`; grep for `revoke` → only GET `me/permissions` | Retaining a usable token after disconnect is a direct platform-policy violation | Null `token`/`refreshToken` on disconnect and call `DELETE /me/permissions`, Google `/revoke`, LinkedIn/Reddit/X equivalents. Add `revoke()` to `SocialAbstract`. |
| 6 | Reviewer cannot connect any channel (FREE tier = 0) | **Critical** | `pricing.ts:23-40`; `.env.prod:94`; `permissions.service.ts:22-38` | The screencast cannot be recorded; reviewers reject on "could not test the integration" | Provision the reviewer org with a tier, or add a reviewer/trial tier granting ≥1 channel and ≥1 post |
| 7 | Target platform credentials absent from prod, yet all providers shown | **Critical** | `.env.prod` (no FB/IG/Threads/TikTok/Pinterest/YouTube keys); `integration.manager.ts:166-168` | Clicking "Facebook" in a review produces `client_id=undefined` and an error page | Configure the keys, and filter `getAllowedSocialsIntegrations()` by whether each provider's env vars are set |
| 8 | Real secrets committed to git history | **Critical** | commit `1195455e` adds `.env.prod` | Meta Business Verification and any security questionnaire treat leaked platform app secrets as disqualifying | Rotate **every** secret in that file; purge history (`git filter-repo`/BFG) or treat the repo as compromised; plan the `JWT_SECRET` rotation against encrypted columns |
| 9 | `prisma db push --accept-data-loss` on every container start | **Critical** | `package.json:18,34` | Not reviewer-visible, but it is the largest single risk to the token data you are about to be trusted with | Move to `prisma migrate deploy` with versioned migrations; remove the push from the boot path |
| 10 | Session JWTs never expire; no server-side revocation | **High** | `auth.service.ts:42-44`; `auth.middleware.ts:11-25` | Session management is a standard question in Meta's DPA | Add `expiresIn` (e.g. 7d) + refresh tokens, or a Redis session/JTI denylist honoured on logout |
| 11 | TikTok PKCE malformed — no `code_challenge` sent | **High** | `tiktok.provider.ts:308-345` | TikTok's audit checks PKCE for Login Kit / Content Posting | Implement S256 properly; copy `kick.provider.ts:27-38` |
| 12 | `state`/`codeVerifier` from `Math.random()`, often 6 chars | **High** | `make.is.ts:1-10` + ~28 providers | Weak CSRF token on the OAuth callback | Replace `makeId` internals with `crypto.randomBytes`; raise `state` to ≥32 chars |
| 13 | Over-broad scopes | **High** | `youtube.provider.ts` (`youtubepartner`, full `youtube`); `facebook`/`instagram` (`business_management`); `linkedin.provider.ts` (personal profile requesting `rw_organization_admin`, `w_organization_social`, `r_organization_social`) | Reviewers reject requests for scopes not justified by the demonstrated use case | Drop `youtubepartner`; use `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly`; drop `business_management` unless BM access is actually used; move org scopes to the `linkedin-page` provider only |
| 14 | No rate limiting on auth; 3-char minimum password | **High** | `throttler.provider.ts:7-16`; `create.org.user.dto.ts:12-17` | Account-takeover exposure on an app holding platform tokens | Throttle `/auth/*` per IP+account; raise minimum to 12 chars |
| 15 | `EMAIL_PROVIDER="resend\|nodemailer"` silently disables email | **High** | `.env.prod:37` vs `email.service.ts:27-34` | Activation is bypassed and no failure/notification email is ever delivered | Set the literal `resend` (or `nodemailer`); fail loudly on an unrecognised value |
| 16 | Media files never deleted from storage | **High** | `media.repository.ts:40-50`; `removeFile()` implemented but never called | Deletion requests cannot be honoured for user-uploaded content | Call `IUploadProvider.removeFile()` on media deletion and on account deletion |
| 17 | Plaintext credential logging | **High** | `listmonk.provider.ts:82` | Plaintext passwords in stdout; would ship to Sentry if enabled | Remove the `console.log`; add a lint rule against logging request/response bodies |
| 18 | Swagger `/docs` public + browser source maps public | **Medium** | `load.swagger.ts:1-12`, `main.ts:69`; `next.config.js:26` | Full API surface and source disclosure during a review | Gate `/docs` behind auth or `NODE_ENV`; use `hidden-source-map` and upload maps to Sentry only |
| 19 | Webhook delivery bypasses `ssrfSafeDispatcher` | **Medium** | `webhooks.controller.ts:57-61`; `post.activity.ts:330-336` | DNS-rebinding SSRF against internal services | Pass `dispatcher: ssrfSafeDispatcher` and re-validate the URL at send time |
| 20 | Open redirect on the OAuth entry point | **Medium** | `integrations.controller.ts:199,237-239`; `continue.integration.tsx:44-58` | Open redirects adjacent to an OAuth flow are a common rejection reason | Allowlist `redirectUrl` against your own origin |
| 21 | `redirectmeto.com` relay for OAuth codes | **Medium** | `instagram.standalone:111-115`, `threads:101-107`, `tiktok:316-345`, `slack:54,80` | Third-party relay of authorization codes is a disclosure problem | Remove the fallback entirely from production builds; require HTTPS |
| 22 | Config validation runs after `listen()` and only warns | **Medium** | `main.ts:73-99` | A misconfigured prod instance serves traffic silently | `process.exit(1)` on failure, before `listen()` |
| 23 | Healthcheck probes the frontend, not the API | **Medium** | `docker-compose.yaml:87-93`; `monitor.controller.ts:1-14` | Dead-API-but-healthy-container is the documented failure mode | Add a real `/health` checking DB + Redis + Temporal; point the healthcheck at it |
| 24 | `EnterpriseController` privileged ops share `JWT_SECRET` | **Medium** | `enterprise.controller.ts:21-127`; `public.controller.ts:131-155` | Blast radius of one secret | Separate signing key, or IP-allowlist these endpoints |
| 25 | No CSRF token with `sameSite:'none'` + `credentials:true` | **Medium** | `main.ts:24-49`; multipart routes in `media.controller.ts` | Cross-site form POST reaches upload endpoints without preflight | Add a CSRF token for multipart routes, or require a custom header |
| 26 | No security headers on app/API | **Medium** | `nginx.conf:20-34,53-68`; no helmet | HSTS/CSP absence is flagged in security questionnaires | Add helmet + HSTS, CSP, X-Frame-Options at nginx |
| 27 | Farcaster accepts an unsigned client blob | **Medium** | `farcaster.provider.ts` `authenticate()` | Account takeover of the Farcaster integration | Verify the payload signature with Neynar before trusting it |
| 28 | Hardcoded DB / pgAdmin passwords | **Medium** | `docker-compose.yaml:114-116,170-171`; `docker-compose.dev.yaml:39-40` | Default credentials in shipped config | Move to env substitution with generated values |
| 29 | Silent failure on exhausted token refresh | **Low** | `post.workflow.v1.0.5.ts:230-233` | Users lose posts with no notice; generates platform-side complaints | Notify on this branch as the `bad_body` branch does |
| 30 | Latent IDOR — repository methods without org filter | **Low** | `integration.repository.ts:120-128,343-374`; `posts.repository.ts:360-397,687-697` | Defence in depth; one careless future call site becomes a cross-tenant breach | Make `organizationId` a required argument in every repository method |

### C) NICE TO HAVE

- MFA/2FA (not required by these reviews, but the first thing any enterprise buyer asks)
- GDPR data export endpoint
- Automated retention/purge job for soft-deleted rows, `Errors`, and notifications
- `crypto.timingSafeEqual` for API key and client-secret comparison
- PKCE support in your own OAuth provider (`oauth.controller.ts` — DTOs have no `code_verifier`)
- `algorithms: ['HS256']` pinned on JWT verify
- `ecosystem.config.js` with restart/memory policy; a real production Dockerfile
- Exponential backoff (`backoffCoefficient > 1`) on publish retries
- Provider-level idempotency keys to prevent double-posting
- Retire the stale Jenkins pipeline (Node 20 / pnpm 8 vs the pinned Node 22.12 / pnpm 10.6.1)
- `sslmode=require` on `DATABASE_URL` before moving to managed Postgres
- A per-route `error.tsx` for launches/analytics/media instead of only the global boundary

---

## Final answer: realistic rejection risks if you apply tomorrow

**Meta (Business Verification + App Review) — rejection near-certain.**
Business Verification itself is a business-documents process and would likely pass. App Review would not. The Data Deletion Callback URL and Deauthorize Callback URL are required fields you cannot fill in, because the endpoints do not exist. The screencast requirement cannot be satisfied: a fresh account cannot connect a channel (FREE tier = 0), Facebook/Instagram/Threads credentials are not configured in production at all, and there is no "delete my data" flow to demonstrate. If the submission reached the Data Protection Assessment, "are platform tokens encrypted at rest" would be answered No. Expect rejection at the first reviewer touch, likely with a generic "unable to test the integration" note that tells you nothing.

**LinkedIn (Standard tier / Community Management API) — rejection likely.**
LinkedIn's review is lighter and your LinkedIn credentials *are* configured, so the OAuth flow itself would work. Two things sink it. First, the personal-profile provider requests `rw_organization_admin`, `w_organization_social` and `r_organization_social` alongside `w_member_social` — org-admin scopes for a personal-posting integration. LinkedIn's reviewers are consistent about rejecting scope requests not justified by the demonstrated use case. Second, the same demo problem: a fresh account hits the channel paywall before it can connect. If you fix the tier gate and split the scopes so personal requests only `openid profile w_member_social`, LinkedIn is your most winnable application — possibly the only one worth submitting in the near term.

**TikTok (Content Posting API audit) — rejection near-certain.**
TikTok's audit is the most technically detailed of the three. `TIKTOK_CLIENT_ID` is not set in production, so there is nothing to test. The PKCE implementation sends no `code_challenge` — TikTok explicitly checks this. There is no token revocation on disconnect and no user data deletion. TikTok also requires an unbranded demo video showing the full post lifecycle including content disclosure settings; you cannot record it.

**Google OAuth verification (YouTube) — rejection likely, and expensive.**
Not in your list of "tomorrow" applications, but worth flagging: `youtubepartner` plus full `youtube` scope puts you squarely in Google's restricted-scope tier, which triggers a mandatory third-party CASA security assessment (paid, weeks of turnaround). With plaintext token storage and no deletion path you would fail that assessment. Narrow the scopes to `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly` *before* you ever submit, or you buy an expensive rejection.

### Ordering

**Handle the git-history secret leak today**, independent of any application — rotate `JWT_SECRET`, both Stripe keys, LinkedIn, Reddit, X, GitHub, Resend, OpenAI, Polar and Cloudflare R2 credentials, and plan the `JWT_SECRET` rotation against the `fixedEncryption` columns.

Then the minimum viable submission set is items **1–8** from the table: token encryption, both Meta callbacks, account deletion, real revocation on disconnect, a reviewer-usable tier, and the missing provider credentials. Realistically two to three weeks of focused work. Items 9–17 should follow before any security questionnaire from a platform partner lands.

If you want a single application to file soon, make it **LinkedIn** — fix the scope split and the tier gate first.
