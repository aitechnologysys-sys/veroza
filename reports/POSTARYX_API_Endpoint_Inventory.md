# POSTARYX — API Endpoint Inventory

**Repo:** `postiz-app` (fork of gitroomhq/postiz-app, origin `aitechnologysys-sys/veroza`)
**Base URL:** NestJS has **no global prefix** (`apps/backend/src/main.ts` — no `setGlobalPrefix`). nginx exposes the backend at `/api/` → `proxy_pass http://localhost:3000/` (`var/docker/nginx.conf:20-21`), so the public path is `https://host/api` + the controller path below. The frontend is served from `/` → `localhost:4200` (`nginx.conf:54`).

**Auth legend**
- 🔒 = `AuthMiddleware` applied (session cookie `auth` required) — controller listed in `authenticatedController` at `apps/backend/src/api/api.module.ts:49-69`
- 🔓 = no session auth
- 🔑 = API key / bearer token (`PublicAuthMiddleware`)
- ✍️ = HMAC signature verified
- 🎫 = gated only by a JWT signed with `JWT_SECRET`

---

## 1. Authentication

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET | `/auth/can-register` 🔓 | `apps/backend/src/api/routes/auth.controller.ts:35` | Reports whether self-serve signup is open (`DISABLE_REGISTRATION` + org count check in `services/auth/auth.service.ts:24-33`) |
| POST | `/auth/register` 🔓 | `auth.controller.ts:42` | Create user + organization; sets the `auth` cookie (`:72-82`); sends activation email if an email provider is configured |
| POST | `/auth/login` 🔓 | `auth.controller.ts:116` | Password login; bcrypt compare + `activated` check (`services/auth/auth.service.ts:89-91`); sets `auth` cookie (`:137-147`) |
| POST | `/auth/forgot` 🔓 | `auth.controller.ts:180` | Issue password-reset token (JWT with a manual 20-min `expires` field, `services/auth/auth.service.ts:217-233`) |
| POST | `/auth/forgot-return` 🔓 | `auth.controller.ts:194` | Consume the reset token and set a new password (`services/auth/auth.service.ts:235-245`) |
| POST | `/auth/activate` 🔓 | `auth.controller.ts:220` | Consume the email activation code; sets the `auth` cookie (`:234-244`) |
| POST | `/auth/resend-activation` 🔓 | `auth.controller.ts:255` | Re-send the activation email |
| GET | `/auth/oauth/:provider` 🔓 | `auth.controller.ts:215` | **Login-with-provider** (GitHub/Google/generic SSO — distinct from social channel connect). Returns the provider authorize URL. Providers in `apps/backend/src/services/auth/providers/` |
| POST | `/auth/oauth/:provider/exists` 🔓 | `auth.controller.ts:270` | Complete SSO login/registration; sets the `auth` cookie (`:287-297`) |
| GET | `/auth/oauth-mobile-callback` 🔓 | `auth.controller.ts:202` | Mobile/WebView SSO callback bridge |
| POST | `/user/logout` 🔒 | `apps/backend/src/api/routes/users.controller.ts:240` | Clears the `auth` cookie. **Client-side only** — no server-side JTI/denylist (`services/auth/auth.middleware.ts:11-25`) |
| GET | `/user/self` 🔒 | `users.controller.ts:64` | Current session identity — the de facto "am I logged in" probe |
| GET | `/user/impersonate` 🔒 | `users.controller.ts:102` | Search users to impersonate — **superadmin only** (`:104-106`) |
| POST | `/user/impersonate` 🔒 | `users.controller.ts:114` | Assume another org's identity — **superadmin only** (`:116-118`); swap happens in `auth.middleware.ts:59-85` |
| GET | `/user/agent-media-sso` 🔒 | `users.controller.ts:47` | Short-lived SSO handoff for the media agent |

**Frontend auth routes:** `apps/frontend/src/app/(app)/auth/page.tsx` (register), `auth/login/page.tsx`, `auth/forgot/page.tsx`, `auth/forgot/[token]/page.tsx`, `auth/activate/[code]/page.tsx`, `auth/login-required/page.tsx`.

### POSTARYX as an OAuth provider (third-party apps authorizing against you)

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET | `/oauth/authorize` 🔓 | `apps/backend/src/api/routes/oauth.controller.ts:23` | Authorization-request metadata for the consent screen |
| POST | `/oauth/authorize` 🔒 | `oauth.controller.ts:63` | User grants consent; mints a 10-min authorization code (`database/prisma/oauth/oauth.service.ts:83-101`) |
| POST | `/oauth/token` 🔓 | `oauth.controller.ts:41` | Code→token exchange; client secret compared with `!==` (`oauth.service.ts:116`). **No PKCE** — `code_verifier` absent from `dtos/oauth/token-exchange.dto.ts` |
| GET/POST/PUT/DELETE | `/user/oauth-app` 🔒 | `oauth-app.controller.ts:19,25,34,43` | CRUD for your registered OAuth apps (`@CheckPolicies([Create, ADMIN])`) |
| POST | `/user/oauth-app/rotate-secret` 🔒 | `oauth-app.controller.ts:49` | Rotate an app's client secret |
| GET | `/user/approved-apps` 🔒 | `approved-apps.controller.ts:12` | List apps the user has authorized |
| DELETE | `/user/approved-apps/:id` 🔒 | `approved-apps.controller.ts:17` | Revoke a third-party app's access token (`oauth.repository.ts:229-239`, scoped by `userId`) |

---

## 2. OAuth callback (social channel connect)

The flow: authenticated initiate → Redis-stored `state` → provider redirect → **frontend** page → unauthenticated exchange.

| Method | Endpoint / route | File | Purpose |
|---|---|---|---|
| GET | `/integrations/social/:integration` 🔒 | `apps/backend/src/api/routes/integrations.controller.ts:193-248` | **Step 1 — initiate.** Calls `generateAuthUrl()`, writes 6 Redis keys with 3600s TTL: `refresh:{state}`, `onboarding:{state}`, `redirect:{state}`, `organization:{state}`, `login:{state}` (code verifier), `external:{state}` (`:226-248`). Gated by `@CheckPolicies([Create, CHANNEL])` (`:47`) |
| — | `GET /integrations/social/[provider]` (frontend page) | `apps/frontend/src/app/(app)/integrations/social/[provider]/page.tsx` | **Step 2 — the actual redirect_uri.** Renders `ContinueIntegration`, which reads `code`/`state` from the query string (`components/launches/continue.integration.tsx:59-89`) and POSTs them to the backend |
| POST | `/integrations/social-connect/:integration` 🔓 | `apps/backend/src/api/routes/no.auth.integrations.controller.ts:43-90` | **Step 3 — token exchange.** Verifies state: `ioRedis.get('login:'+state)` → `'Invalid state'` (`:61-70`), `ioRedis.get('organization:'+state)` → `'Organization not found'`. Calls provider `authenticate()`, persists the integration |
| GET | `/integrations/` 🔓 | `no.auth.integrations.controller.ts:38` | Public list of available provider identifiers |
| POST | `/integrations/public/provider/:id/connect` 🔓 | `no.auth.integrations.controller.ts:320` | Save the selected page/board/channel for a multi-entity provider, unauthenticated variant |
| POST | `/integrations/provider/:id/connect` 🔒 | `integrations.controller.ts:46` | Same, authenticated variant |
| GET | `/auth/oauth/:provider` + `POST /auth/oauth/:provider/exists` | `auth.controller.ts:215,270` | **Login** OAuth callback (not channel connect) — see §1 |
| — | `/provider/:p` (frontend WebView bridge) | `apps/frontend/src/app/(provider)/provider/[p]/page.tsx` | Native-app WebView bridge for provider settings forms; auth via `?loggedAuth=<jwt>` query param |
| — | `/provider/add` (frontend) | `apps/frontend/src/app/(provider)/provider/add/page.tsx` | Add-provider WebView screen |

**Note:** `redirectUrl` is accepted as a free-form query param at `integrations.controller.ts:199,237-239` and pushed unvalidated by `continue.integration.tsx:44-58` — open redirect on the OAuth entry point.

---

## 3. Social account connection (management)

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET | `/integrations/list` 🔒 | `integrations.controller.ts:88` | List the org's connected channels |
| GET | `/integrations/:id` 🔒 | `integrations.controller.ts:178` | Single integration, org-scoped via `getIntegrationById(org.id, id)` |
| GET | `/integrations/customers` 🔒 | `integrations.controller.ts:61` | Customer/client groupings for channels |
| PUT | `/integrations/:id/group` 🔒 | `integrations.controller.ts:66` | Assign a channel to a customer group |
| PUT | `/integrations/:id/customer-name` 🔒 | `integrations.controller.ts:79` | Rename the customer a channel belongs to |
| POST | `/integrations/:id/settings` 🔒 | `integrations.controller.ts:126` | Per-provider settings (`updateProviderSettings`) |
| POST | `/integrations/:id/nickname` 🔒 | `integrations.controller.ts:138` | Rename a channel in the UI |
| POST | `/integrations/:id/time` 🔒 | `integrations.controller.ts:256` | Set preferred posting times |
| POST | `/integrations/function` 🔒 | `integrations.controller.ts:321-379` | **Generic provider RPC** — invokes an arbitrary named method on the provider class with the stored token. Contains the inline refresh-and-retry path (`:355-372`) |
| POST | `/integrations/mentions` 🔒 | `integrations.controller.ts:265` | Resolve @-mentions against the platform |
| GET | `/integrations/telegram/updates` 🔒 | `integrations.controller.ts:451` | Telegram bot pairing poll |
| POST | `/integrations/moltbook/register` 🔒 | `integrations.controller.ts:456` | Register a Moltbook agent |
| GET | `/integrations/moltbook/status` 🔒 | `integrations.controller.ts:471` | Poll Moltbook agent approval |
| GET | `/integrations/:identifier/internal-plugs` 🔒 | `integrations.controller.ts:56` | Available automation "plugs" for a provider |
| GET | `/integrations/plug/list` 🔒 | `integrations.controller.ts:420` | All plug definitions |
| GET | `/integrations/:id/plugs` 🔒 | `integrations.controller.ts:425` | Plugs configured on a channel |
| POST | `/integrations/:id/plugs` 🔒 | `integrations.controller.ts:433` | Configure a plug |
| PUT | `/integrations/plugs/:id/activate` 🔒 | `integrations.controller.ts:442` | Toggle a plug |
| GET | `/public/v1/integrations` 🔑 | `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts:265` | Public API: list channels |
| GET | `/public/v1/social/:integration` 🔑 | `public.integrations.controller.ts:286` | Public API: generate a connect URL |
| GET | `/public/v1/is-connected` 🔑 | `public.integrations.controller.ts:259` | Public API: connection status probe |
| GET | `/public/v1/integration-settings/:id` 🔑 | `public.integrations.controller.ts:381` | Public API: read channel settings |
| POST | `/public/v1/integration-trigger/:id` 🔑 | `public.integrations.controller.ts:473` | Public API: fire a provider function |
| POST | `/enterprise/create-user` 🎫 | `apps/backend/src/api/routes/enterprise.controller.ts:20` | Provision a max-tier org. **No session auth** — only a `JWT_SECRET`-signed payload |
| POST | `/enterprise/url` 🎫 | `enterprise.controller.ts:45` | Mint an OAuth connect URL + Redis state for an arbitrary org |

---

## 4. Social account disconnect

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| DELETE | `/integrations/` 🔒 | `integrations.controller.ts:402-418` | **The disconnect route.** → `IntegrationService.deleteChannel` (`database/prisma/integrations/integration.service.ts:273-275`) → `integration.repository.ts:533-543`: `update({ data: { deletedAt: new Date() } })`. **Soft delete — `token` and `refreshToken` are left intact, and no provider revoke endpoint is called.** Also cancels that channel's posts (`:407-414`) |
| POST | `/integrations/disable` 🔒 | `integrations.controller.ts:381` | Mark a channel disabled (over plan limit) without deleting it |
| POST | `/integrations/enable` 🔒 | `integrations.controller.ts:389` | Re-enable, subject to `subscription.totalChannels` / `pricing.FREE.channel` |
| DELETE | `/public/v1/integrations/:id` 🔑 | `public.integrations.controller.ts:362` | Public API disconnect — same soft-delete path |
| POST | `/enterprise/delete-channel` 🎫 | `enterprise.controller.ts:94` | Delete a channel for any org, gated only by a `JWT_SECRET`-signed payload |
| — | *(internal, not HTTP)* `disconnectChannel(org, integration)` | `integration.service.ts:184`; called from `integrations/refresh.integration.service.ts:96-99` | Auto-disconnect when token refresh permanently fails |

**Missing:** no route anywhere calls `DELETE https://graph.facebook.com/v20.0/me/permissions`, Google `/revoke`, or the LinkedIn/Reddit/X revocation endpoints. `SocialAbstract` (`libraries/nestjs-libraries/src/integrations/social.abstract.ts`) defines no `revoke()` contract.

---

## 5. Token refresh

| Method | Endpoint / trigger | File | Purpose |
|---|---|---|---|
| GET | `/integrations/social/:integration?refresh=<id>` 🔒 | `integrations.controller.ts:193-248` | **Manual re-auth.** The `refresh` query param is stored at `refresh:{state}` and threaded into the provider's `redirect_uri`, so a user can re-consent for an existing channel |
| POST | `/integrations/function` 🔒 | `integrations.controller.ts:355-372` | **Reactive refresh.** On a `RefreshToken` exception, calls `RefreshIntegrationService.refresh()`, optionally waits 10s (`refreshWait`), then retries the call |
| POST | `/integrations/social-connect/:integration` 🔓 | `no.auth.integrations.controller.ts:43` | Re-running the connect flow with `refresh` set overwrites the stored tokens via `createOrUpdateIntegration` |
| POST | `/integrations/extension-refresh` 🔓 | `no.auth.integrations.controller.ts:336` | Browser-extension cookie refresh (Skool-style cookie-auth providers) |
| PUT | `/public/v1/posts/:id/status` 🔑 | `public.integrations.controller.ts:433` | Public API post state change; can re-enter the publish path that triggers refresh |
| — | Temporal workflow `refreshTokenWorkflow` | `apps/orchestrator/src/workflows/refresh.token.workflow.ts` | **Proactive refresh.** Infinite loop: reads `tokenExpiration`, `sleep()`s until expiry, re-reads the integration (bails if `deletedAt`/`inBetweenSteps`/`refreshNeeded`), then calls the `refreshToken` activity. Retry: `maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes'` |
| — | Workflow starter | `libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts:57-70` | `startRefreshWorkflow()` — **returns early unless `integration.refreshCron` is true**, so only Instagram-standalone (`refreshCron` at `:30`) and Threads (`:30`) get proactive refresh. TikTok, Pinterest, YouTube, Reddit, LinkedIn are reactive-only |
| — | Refresh core | `refresh.integration.service.ts:20-46` (`refresh`), `:74-120` (`refreshProcess`) | Calls the provider's `refreshToken()`; on failure marks `refreshNeeded`, notifies, and **disconnects the channel** (`:80-99`) |
| — | Activity | `apps/orchestrator/src/activities/integrations.activity.ts` | `getIntegrationsById`, `refreshToken` — the side-effecting halves of the workflow |
| — | CLI command | `apps/commands/src/tasks/refresh.tokens.ts` | `refresh` command → `IntegrationService.refreshTokens()` — bulk refresh, run manually |

---

## 6. User deletion

**No endpoint exists.** Verified by enumerating every route decorator in `users.controller.ts` (15 routes, no `@Delete`), `settings.controller.ts`, and `auth.controller.ts`, plus grep of `database/prisma/users/users.service.ts` and `users.repository.ts` for `delete`/`remove` — zero matches. No frontend UI (`apps/frontend/src/components/settings/` has 7 components, none for deletion).

| Method | Endpoint | File | What it actually does |
|---|---|---|---|
| DELETE | `/settings/team/:id` 🔒 | `apps/backend/src/api/routes/settings.controller.ts:39` | **Not account deletion.** Removes a `UserOrganization` join row — evicts a teammate from an org (`organization.repository.ts:377-378`). The `User` record survives |
| — | Organization deletion | — | **Missing.** `organization.repository.ts` / `organization.service.ts` expose only `deleteTeamMember` |
| — | GDPR export | — | **Missing.** Zero matches for `GDPR`, `data-export`, `export-data` in `apps/` and `libraries/` |

Adjacent deletions that do exist (all soft):

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| DELETE | `/posts/:group` 🔒 | `posts.controller.ts:250` | Soft-delete a post group — `deletedAt` stamp (`posts.repository.ts:319-328`) |
| DELETE | `/media/:id` 🔒 | `apps/backend/src/api/routes/media.controller.ts:39` | Soft-delete media — `deletedAt` only; `IUploadProvider.removeFile()` (`upload/local.storage.ts:116-121`, `upload/cloudflare.storage.ts:158+`) is implemented but **never called**, so the file stays in storage |
| DELETE | `/posts/tags/:id` 🔒 | `posts.controller.ts:104` | Delete a tag |
| DELETE | `/webhooks/:id` 🔒 | `webhooks.controller.ts:48` | Delete a webhook |
| DELETE | `/autopost/:id` 🔒 | `autopost.controller.ts:48` | Delete an autopost rule |
| DELETE | `/public/v1/posts/:id`, `/public/v1/posts/group/:group` 🔑 | `public.integrations.controller.ts:240,250` | Public API post deletion |

---

## 7. Data deletion callback (platform-initiated)

**Nothing exists.** Repo-wide grep across `apps/` and `libraries/` for `signed_request`, `data_deletion`, `confirmation_code`, `parseSignedRequest`, `deauthorize`, `deauth` returns **zero backend matches**.

| Required by | Endpoint needed | Status |
|---|---|---|
| Meta — "Data Deletion Request URL" | `POST /facebook/data-deletion` | **MISSING** |
| Meta — "Deauthorize Callback URL" | `POST /facebook/deauthorize` | **MISSING** |
| Meta — deletion status page | `GET /facebook/data-deletion/:code` | **MISSING** |
| Any platform | Inbound webhook signature verification (`X-Hub-Signature`, `hub.challenge`) | **MISSING** — no platform webhooks are received at all |

**Reference implementation to copy:** the Stripe webhook is the only correctly signature-verified inbound endpoint —

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| POST | `/stripe` ✍️🔓 | `apps/backend/src/api/routes/stripe.controller.ts:16-23` | `validateRequest(req.rawBody, headers['stripe-signature'], STRIPE_SIGNING_KEY)` — HMAC over the raw body. Mirror this shape for the Meta `signed_request` callbacks |
| POST | `/payment-webhook`, `/api/payment-webhook` ✍️🔓 | `apps/backend/src/api/routes/polar.controller.ts:16` | Polar billing webhook; signature via `createHmac` in `services/polar.service.ts` |

---

## 8. Scheduled posting

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| POST | `/posts/` 🔒 | `apps/backend/src/api/routes/posts.controller.ts:179` | **Create/update a scheduled post.** Gated by `@CheckPolicies` on `Sections.POSTS_PER_MONTH`. Persists then calls `startWorkflow` (`database/prisma/posts/posts.service.ts:729`) |
| GET | `/posts/` 🔒 | `posts.controller.ts:112` | Calendar-range fetch |
| GET | `/posts/list` 🔒 | `posts.controller.ts:133` | List view |
| GET | `/posts/old` 🔒 | `posts.controller.ts:141` | Historic posts |
| GET | `/posts/:id` 🔒 | `posts.controller.ts:166` | Single post |
| GET | `/posts/group/:group` 🔒 | `posts.controller.ts:161` | Post group (one post across N channels) |
| GET | `/posts/group/:group/debug-export` 🔒 | `posts.controller.ts:149` | Debug dump — **includes raw `Errors.body` provider responses** (`posts.service.ts:443-488`) |
| PUT | `/posts/:id/date` 🔒 | `posts.controller.ts:258` | Reschedule; resets state to `QUEUE` and restarts the workflow (`posts.service.ts:967-999`) |
| POST | `/posts/valid` 🔒 | `posts.controller.ts:171` | Pre-flight content validation per provider |
| POST | `/posts/should-shortlink` 🔒 | `posts.controller.ts:67` | Shortlink decision for the composer |
| GET | `/posts/find-slot`, `/posts/find-slot/:id` 🔒 | `posts.controller.ts:120,125` | Next free scheduling slot |
| DELETE | `/posts/:group` 🔒 | `posts.controller.ts:250` | Cancel/soft-delete a scheduled group |
| PUT | `/posts/:id/release-id` 🔒 | `posts.controller.ts:58` | Record the platform's post ID after publish |
| GET | `/posts/:id/statistics` 🔒 | `posts.controller.ts:42` | Per-post stats |
| GET | `/posts/:id/missing` 🔒 | `posts.controller.ts:50` | Detect channels a group failed to reach |
| POST | `/posts/:id/comments` 🔒 | `posts.controller.ts:72` | Threaded comment/reply scheduling |
| POST | `/posts/separate-posts` 🔒 | `posts.controller.ts:268` | Split a thread into separate posts |
| POST | `/posts/generator`, `/posts/generator/draft` 🔒 | `posts.controller.ts:235,226` | AI post generation |
| GET/POST/PUT/DELETE | `/posts/tags`, `/posts/tags/:id` 🔒 | `posts.controller.ts:82,87,95,104` | Calendar tag CRUD |
| POST | `/public/v1/posts` 🔑 | `public.integrations.controller.ts:160` | **Public API create post — the only rate-limited route in the app** (`libraries/nestjs-libraries/src/throttler/throttler.provider.ts:7-16`, `API_LIMIT` default 90/hr) |
| GET | `/public/v1/posts` 🔑 | `public.integrations.controller.ts:147` | Public API list |
| GET | `/public/v1/find-slot/:id` 🔑 | `public.integrations.controller.ts:138` | Public API slot finder |
| GET | `/public/v1/posts/:id/missing` 🔑 | `public.integrations.controller.ts:424` | Public API missing-channel check |
| PUT | `/public/v1/posts/:id/status`, `/posts/:id/release-id` 🔑 | `public.integrations.controller.ts:433,443` | Public API state / release-ID updates |
| POST | `/public/v1/upload`, `/upload-from-url` 🔑 | `public.integrations.controller.ts:77,97` | Public API media upload (SSRF-guarded via `ssrfSafeDispatcher`) |
| GET | `/public/posts/:id`, `/public/posts/:id/comments` 🔓 | `public.controller.ts:54,74` | Public read of a shared post |

**Autopost (RSS-driven scheduling)**

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET/POST/PUT/DELETE | `/autopost/`, `/autopost/:id` 🔒 | `autopost.controller.ts:25,30,39,48` | CRUD for autopost rules |
| POST | `/autopost/:id/active` 🔒 | `autopost.controller.ts:56` | Toggle a rule |
| POST | `/autopost/send` 🔒 | `autopost.controller.ts:65` | Fetch/parse an RSS feed URL (`loadXML`) |

---

## 9. Background jobs (Temporal — not HTTP endpoints)

Temporal is a **hard dependency**: `TemporalModule.register({ isGlobal: true })` (`libraries/nestjs-libraries/src/temporal/temporal.module.ts:9-16`) runs at Nest bootstrap for the backend too, so the API will not start if Temporal is unreachable. Task queue: `main`.

| Workflow | File | Started from | Purpose / retry policy |
|---|---|---|---|
| `postWorkflowV105` | `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.5.ts` | `database/prisma/posts/posts.service.ts:729` (`workflow.start`) | **Publish a scheduled post.** Activity retry `maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes'`, `startToCloseTimeout: '10 minute'` (`:19-46`). Plus a 5-iteration app-level loop for `refresh_token` failures (`:50,167,219-237`). Idempotency = state check `state !== 'QUEUE'` (`:90-93`). On `bad_body` → notify + email (`:248-259`); on exhausted refresh → **silent ERROR, no notification** (`:230-233`) |
| `post.workflow.v1.0.1` … `v1.0.4` | same directory | legacy in-flight workflows | Kept for version compatibility with running executions |
| `refreshTokenWorkflow` | `workflows/refresh.token.workflow.ts` | `integrations/refresh.integration.service.ts:63`, `workflowId: refresh_{id}`, `workflowIdConflictPolicy: 'TERMINATE_EXISTING'` | Sleep-until-expiry then refresh; only for providers with `refreshCron` set |
| `missingPostWorkflow` | `workflows/missing.post.workflow.ts` | `temporal/infinite.workflow.register.ts:12-19` on module init, **only if `process.env.RUN_CRON` is set**, `workflowId: 'missing-post-workflow'` | Long-running sweeper for posts that never published |
| `digestEmailWorkflow` | `workflows/digest.email.workflow.ts` | `database/prisma/notifications/notification.service.ts:58` (`signalWithStart`) | Batches in-app notifications into a digest email |
| `sendEmailWorkflow` | `workflows/send.email.workflow.ts` | `services/email.service.ts:46` (`signalWithStart`) | Durable outbound email send |
| `streakWorkflow` | `workflows/streak.workflow.ts` | `apps/orchestrator/src/activities/post.activity.ts:256` | Posting-streak tracking after a successful publish |
| `autopost.workflow.ts` | `workflows/autopost.workflow.ts` | **no `workflow.start` caller found** — grep for `autopostWorkflow` across `apps/` and `libraries/` returns only the definition | RSS→post automation; appears unwired |

**Activities** (`apps/orchestrator/src/activities/`): `post.activity.ts` (publish, webhooks, streak), `integrations.activity.ts` (`getIntegrationsById`, `refreshToken`), `email.activity.ts`, `autopost.activity.ts`.

**CLI commands** (`apps/commands/src/tasks/`, run via `nestjs-command`): `refresh.tokens.ts` (`refresh`), `configuration.ts`, `agent.run.ts`.

**Job-health endpoints**

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET | `/monitor/queue/:name` 🔓 | `apps/backend/src/api/routes/monitor.controller.ts:7-14` | **Stub** — returns `"Queue {name} is healthy."` unconditionally for any name; performs no check |
| GET | `/` 🔓 | `apps/backend/src/api/routes/root.controller.ts:4` | Returns `'App is running!'`. This is what the container healthcheck probes (`docker-compose.yaml:87-93`) — it does not verify DB, Redis or Temporal |

**No cron/scheduler exists** beyond the `RUN_CRON`-gated `missingPostWorkflow`: zero matches for `@Cron`, `ScheduleClient`, `createSchedule`, `node-cron` or `@nestjs/schedule` across `apps/` and `libraries/`. No purge/retention job.

---

## 10. Webhooks

### Outbound — user-configured (org notifies its own systems)

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| GET | `/webhooks/` 🔒 | `apps/backend/src/api/routes/webhooks.controller.ts:26` | List the org's webhooks |
| POST | `/webhooks/` 🔒 | `webhooks.controller.ts:31` | Create; URL validated by `@IsSafeWebhookUrl` (`dtos/webhooks/webhooks.dto.ts:11-30`) |
| PUT | `/webhooks/` 🔒 | `webhooks.controller.ts:40` | Update |
| DELETE | `/webhooks/:id` 🔒 | `webhooks.controller.ts:48` | Delete |
| POST | `/webhooks/send` 🔒 | `webhooks.controller.ts:56-65` | Test-fire a webhook. **Bare `fetch(query.url)` with no `ssrfSafeDispatcher`** (`:57-61`) — DNS-rebinding SSRF gap |
| — | *(internal)* `sendWebhooks()` | `apps/orchestrator/src/activities/post.activity.ts:315-338` | Fires configured webhooks after a publish. Also **bare `fetch()` with no dispatcher** (`:330-336`), against a URL validated only at creation time |

The `Webhooks` Prisma model has **no signing-secret field** — outbound deliveries are unsigned, so receivers cannot verify them.

### Integration-scoped webhook links

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| — | `IntegrationsWebhooks` join model | `database/prisma/schema.prisma:583` | Associates webhooks with specific channels; managed through the `/webhooks` routes above |

### Inbound — third parties calling you

| Method | Endpoint | File | Purpose |
|---|---|---|---|
| POST | `/stripe` ✍️🔓 | `stripe.controller.ts:16-23` | Billing events; HMAC-verified against `STRIPE_SIGNING_KEY` over the raw body. **The only properly verified inbound webhook** |
| POST | `/payment-webhook`, `/api/payment-webhook` ✍️🔓 | `polar.controller.ts:16` | Polar billing events; verified via `createHmac` with `POLAR_WEBHOOK_SECRET` in `services/polar.service.ts` |
| POST | `/public/modify-subscription` 🎫 | `public.controller.ts:131-155` | Change any org's subscription tier — gated only by a `JWT_SECRET`-signed payload, no session auth |
| POST | `/public/agent` 🔓+key | `public.controller.ts:42-52` | Agent callback; compares `body.apiKey !== process.env.AGENT_API_KEY` with `!==` (no `timingSafeEqual`) |
| POST | `/public/t`, `/user/t` | `public.controller.ts:79`, `users.controller.ts:285` | Analytics/tracking ingest (`libraries/nestjs-libraries/src/track/track.service.ts`) |
| GET | `/public/stream` 🔓 | `public.controller.ts:158-238` | Media proxy/stream. SSRF-hardened — re-validates every redirect hop with `isSafePublicHttpsUrl` + `ssrfSafeDispatcher` (`:180-190`) |

**No social platform webhooks are received.** No `X-Hub-Signature` verification, no `hub.challenge` handler, no Meta/TikTok/LinkedIn callback receivers anywhere in `apps/backend/src/api/routes/` or `apps/backend/src/public-api/`.

---

## Appendix — full controller map

| Controller file | Path prefix | Session auth |
|---|---|---|
| `auth.controller.ts` | `/auth` | 🔓 |
| `users.controller.ts` | `/user` | 🔒 |
| `settings.controller.ts` | `/settings` | 🔒 |
| `integrations.controller.ts` | `/integrations` | 🔒 |
| `no.auth.integrations.controller.ts` | `/integrations` | 🔓 |
| `posts.controller.ts` | `/posts` | 🔒 |
| `media.controller.ts` | `/media` | 🔒 |
| `analytics.controller.ts` | `/analytics` | 🔒 |
| `webhooks.controller.ts` | `/webhooks` | 🔒 |
| `autopost.controller.ts` | `/autopost` | 🔒 |
| `sets.controller.ts` | `/sets` | 🔒 |
| `signature.controller.ts` | `/signatures` | 🔒 |
| `notifications.controller.ts` | `/notifications` | 🔒 |
| `announcements.controller.ts` | `/announcements` | 🔒 |
| `third-party.controller.ts` | `/third-party` | 🔒 |
| `copilot.controller.ts` | `/copilot` | 🔒 |
| `billing.controller.ts` | `/billing` | 🔒 |
| `admin.controller.ts` | `/admin` | 🔒 + `assertSuperAdmin` |
| `oauth-app.controller.ts` | `/user/oauth-app` | 🔒 |
| `approved-apps.controller.ts` | `/user/approved-apps` | 🔒 |
| `oauth.controller.ts` | `/oauth` (two blocks, `:19` and `:59`) | mixed |
| `public.controller.ts` | `/public` | 🔓 |
| `enterprise.controller.ts` | `/enterprise` | 🎫 |
| `stripe.controller.ts` | `/stripe` | ✍️ |
| `polar.controller.ts` | `/` | ✍️ |
| `monitor.controller.ts` | `/monitor` | 🔓 |
| `root.controller.ts` | `/` | 🔓 |
| `public-api/routes/v1/public.integrations.controller.ts` | `/public/v1` | 🔑 |

Middleware wiring: `apps/backend/src/api/api.module.ts:49-69` (the `authenticatedController` list) and `:110` (`consumer.apply(AuthMiddleware)`).
