# Incident report: Pinterest, Whop, Kick, Farcaster

## Context
These four issues came from manual testing after PR #16 (`3e495e87`, 2026-10-08). That PR changed all four providers: it added Pinterest error surfacing, made Whop's `client_secret` optional, let Kick posts through settings validation, and ported Farcaster managed signers from upstream. The new error messages in #16 are what made two of these failures visible.

| # | Incident | Type | Code change? |
|---|---|---|---|
| 1 | Pinterest "Trial access may not create Pins" | Pinterest app access tier | No (optional) |
| 2 | "Could not add provider: client_secret is required" | Missing env var (Whop) | No (optional UX) |
| 3 | Kick release URL uses `_` instead of `-` | **Real bug** | **Yes** |
| 4 | Farcaster "not configured" | Missing env vars | No |

---

## 1. Pinterest: "Apps with Trial access may not create Pins in production"

**Root cause:** the Pinterest developer app has **Trial** access. Trial apps can do OAuth and read boards, but `POST /v5/pins` is only allowed on `api-sandbox.pinterest.com`. Our code always calls `api.pinterest.com` (`pinterest.provider.ts:333`). The code is correct. Before #16, this same failure showed up as "Unknown Error". The new `handleErrors` 4xx branch (`pinterest.provider.ts:111-129`) is now showing Pinterest's real message, so that part works.

**Fix (recommended, no code):** in the Pinterest developer portal (My Apps → the app), apply for **Standard access**. Pinterest normally wants a demo video of the full flow: connect, pick a board, create a Pin. Once approved, the same code and the same tokens work in production.

**Optional code change (only if the demo video has to be recorded through our app):** add an env switch such as `PINTEREST_API_BASE` (default `https://api.pinterest.com`) and use it for the `boards`, `media`, and `pins` calls.
- Boards also have to come from the sandbox host, because sandbox has its own boards. If only pin creation switched, it would fail with "Board not found".
- Check Pinterest's docs on whether sandbox needs a separate sandbox token before building this.
- Upstream Postiz has nothing like this, so it would be a fork divergence and would need a note in `docs/`. I recommend skipping it unless the access review really needs it.

---

## 2. "Could not add provider: Authentication failed: client_secret is required"

**Yes, it's Whop.** Evidence:
- The text `Authentication failed: <error_description>` is produced in only one place in the codebase: `whop.provider.ts:156-160`.
- The `_swuid` param in the callback URL base64-decodes to `{"w":"wuid_…", …}`, which is a Whop user id.

**Root cause:** Whop's `/oauth/token` rejected the exchange because no `client_secret` was sent. Since #16 we only send it when `process.env.WHOP_CLIENT_SECRET` is set (`whop.provider.ts:146-150`). The OAuth app is a confidential client, so it needs the secret. That means **`WHOP_CLIENT_SECRET` isn't reaching the backend process.** Likely reasons:
- it isn't set in that environment's `.env` / deployment secrets, or
- it was added but the backend wasn't restarted, or
- the backend running there predates #16.

**Fix (config):**
1. Set `WHOP_CLIENT_SECRET` to the OAuth app's **client secret** from the Whop developer dashboard. This is not an `apik_…` API key; `.env.example` already says so.
2. Make sure the redirect URI in Whop is exactly `${FRONTEND_URL}/integrations/social/whop`.
3. Restart the backend and reconnect.
4. For deployed environments, also add it to the CI/deploy secrets (see `docs/3. … CI-BUILD-CUTOVER.md`).

The same missing secret will also break `refreshToken` later, because it uses the same conditional.

**Optional small UX change:** in `authenticate`, if Whop returns `client_secret is required` and `WHOP_CLIENT_SECRET` is unset, return "Whop is not configured: set WHOP_CLIENT_SECRET" instead. This matches the Farcaster style. Low priority.

---

## 3. Kick: release URL is `kick.com/swe_qwertz15` but the real channel is `kick.com/swe-qwertz15`

**Root cause (bug, also present upstream):**
- `getUserInfo` (`kick.provider.ts:134-154`) reads `GET /public/v1/users` and uses `user.name` (the display username, which has the `_`) as both `name` and `username`.
- `username` is saved as `integration.profile` (`integration.repository.ts:255,284`).
- `post()` and `comment()` build `https://kick.com/${integration.profile}` (`kick.provider.ts:185, 222`).
- Kick channel URLs use the channel **slug**, where `_` becomes `-`. So the link 404s or points to the wrong page.

**Fix (code):**
- In `kick.provider.ts`, after reading the user, call `GET https://api.kick.com/public/v1/channels` with the same bearer token. With no query params it returns the authenticated user's channel. We already request the `channel:read` scope (`kick.provider.ts:20`).
- Use `data[0].slug` as `username`. Keep `user.name` as the display `name`. Fall back to `user.name` if the channels call fails, so connecting never breaks.
- Both `authenticate` and `refreshToken` already go through `getUserInfo`, so both get fixed.
- Don't guess the slug with a string replace of `_` → `-`; the API is the source of truth.
- Existing Kick integrations still have the old `profile`. Reconnecting the channel updates it, because the upsert's `update` branch sets `profile`. No migration needed.
- Posts already published keep their old `releaseURL`. Fine to leave as is.
- Since this bug exists upstream too, consider sending the fix upstream to keep the fork's diff small.

**Files:** `libraries/nestjs-libraries/src/integrations/social/kick.provider.ts` (only `getUserInfo`).

---

## 4. Farcaster: "not configured: set NEYNAR_APP_FID and NEYNAR_APP_MNEMONIC"

**Root cause:** expected guard, working as intended. Since #16 (upstream ports #2078/#2080), connecting Farcaster uses Neynar **managed signers**:
- `POST /auth/farcaster/signer` → `FarcasterProvider.createSigner()` (`farcaster.provider.ts:91-133`, `auth.controller.ts:278`).
- It signs an EIP-712 key request with the app account's custody wallet, so it needs that account's FID and mnemonic.
- Those two vars aren't set, so it throws on purpose (`farcaster.provider.ts:96-100`).

**Fix (config), all backend env:**
| Var | Where to get it |
|---|---|
| `NEYNAR_SECRET_KEY` | Neynar dashboard API key. Without it, the client falls back to a dummy key (`farcaster.provider.ts:21-23`) and every call fails. |
| `NEYNAR_CLIENT_ID` | Neynar dashboard. It controls whether the Farcaster button shows; it must already be set, since the button appeared. |
| `NEYNAR_APP_FID` | FID of a **dedicated** Farcaster account for Postaryx. Users see this name when they approve. |
| `NEYNAR_APP_MNEMONIC` | Recovery phrase of that account's custody wallet (Warpcast → Settings → Advanced). |
| `NEYNAR_SPONSOR_SIGNERS` | `true` = Neynar pays the on-chain signer fee from our credits; otherwise the user pays in Warpcast. |

**Security note:** the mnemonic gives full control of that Farcaster account.
- Use a throwaway or app-only account, never a personal one.
- Keep the mnemonic only in deployment secrets, never in the repo.
- Add it to `docs/1.SECURITY-HARDENING-TODO.md`'s secret inventory.

No code change.

---

## Proposed implementation scope (if approved)
1. **Kick slug fix:** edit `getUserInfo` in `kick.provider.ts` only.
2. *(Optional)* Clearer Whop "not configured" message in `whop.provider.ts`.
3. Everything else is environment and portal setup for whoever owns the env/secrets: Pinterest Standard access, `WHOP_CLIENT_SECRET`, the Neynar vars.

## Verification
- **Kick:** reconnect the Kick channel, then check `integration.profile` in the DB is `swe-qwertz15`. Publish a chat post; the notification link should open the real channel. Run `pnpm eslint` on the file and `pnpm build:backend`.
- **Whop:** with `WHOP_CLIENT_SECRET` set and the backend restarted, the OAuth connect finishes and the channel shows in the list. Publish a forum post.
- **Farcaster:** with the vars set, "Add Farcaster" shows the QR modal. Approve in Warpcast; the channel connects and a test cast publishes.
- **Pinterest:** after Standard access is granted, retry the failed "Hi Pin" post; the notification should show the `pinterest.com/pin/<id>` link.
