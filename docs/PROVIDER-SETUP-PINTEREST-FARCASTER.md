# Provider setup: Pinterest and Farcaster

## Pinterest: upgrading from Trial to Standard access

### The problem
Publishing a Pin fails with:

> Pinterest: Apps with Trial access may not create Pins in production https://api.pinterest.com - use API Sandbox https://api-sandbox.pinterest.com instead.

This is **not a code bug**. The Pinterest developer app is on **Trial access**:
- Trial apps can log users in (OAuth) and read their boards.
- Trial apps can only create Pins on the sandbox API (`api-sandbox.pinterest.com`).
- Sandbox Pins are only visible to the account that created them.

`pinterest.provider.ts` posts to the real API (`api.pinterest.com`), so Pinterest rejects the request. The error used to show as "Unknown Error". Since PR #16 we surface Pinterest's own message instead.

**Fix:** upgrade the app to **Standard access**. No code change is needed. Once Standard access is approved, the existing code and tokens work as they are.

### How to request the upgrade
1. Go to **developers.pinterest.com → My apps** and click **Upgrade** on the app's card. The button only shows once the app is eligible.
2. Check that the **use case** description and the **privacy policy URL** are correct. Use the public one on postaryx.com.
3. Upload a **demo video** and submit.
4. Pinterest replies by email. Waits of around 10 days or more have been reported, and some people never get the email and have to check the dashboard.

### The demo video (where most requests get rejected)
The two most common rejection reasons:
- "Demo did not show the full OAuth flow"
- "Demo did not show Pinterest integration"

Record **one continuous video** showing these steps:

1. **OAuth flow, in Postaryx:**
   - Add channel → Pinterest.
   - Pinterest's consent screen → Allow.
   - The channel appears in Postaryx.

   Postaryx can already do this under Trial access.
2. **Board selection, in Postaryx:** open the post editor and pick a board. The board list comes from Pinterest's API.
3. **Pin creation, via terminal or Postman.** Postaryx can't do this step under Trial access because it calls the real API. Pinterest accepts terminal and Postman recordings for this part, so call the sandbox directly:

   ```bash
   # create a sandbox board (sandbox has its own boards, separate from the real ones)
   curl -X POST https://api-sandbox.pinterest.com/v5/boards \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"Postaryx demo"}'

   # create a Pin on it, using the board id returned above
   curl -X POST https://api-sandbox.pinterest.com/v5/pins \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"board_id":"<id>","title":"Scheduled from Postaryx","description":"Demo pin",
          "media_source":{"source_type":"image_url","url":"https://<public-image>.jpg"}}'
   ```

   For `$TOKEN`, use a token generated in the Pinterest developer portal for the app. If the sandbox rejects it, generate a sandbox-specific token there.

Narrate or caption the video, for example: "Postaryx schedules Pins for the user's own boards. It only posts content the user creates and schedules."

### Text for the use-case field
> Postaryx is a social media scheduling tool. Users connect their own Pinterest account via OAuth, choose one of their boards, and schedule Pins (image or video, with title, description and link) to be published at a chosen time. We read the user's boards and basic profile to show where they can post, and read Pin analytics to show performance. We don't store passwords, and users can disconnect at any time.

### Optional: sandbox switch in code
If Pinterest rejects the terminal-based demo, we could add an env switch (e.g. `PINTEREST_API_BASE`) that points the `boards`, `media` and `pins` calls at the sandbox while recording.
- Boards must also come from the sandbox, because sandbox has its own boards. Switching only pin creation would fail with "Board not found".
- Upstream Postiz has no such switch, so it would be a fork divergence.
- Skip it unless it's actually needed.

### After approval
Retry the failed "Hi Pin" post. The notification should show a `https://www.pinterest.com/pin/<id>` link.

### Sources
- [Access tiers – Pinterest Developers](https://developers.pinterest.com/docs/key-concepts/access-tiers/)
- [Pinterest API FAQs](https://community.pinterest.biz/t/frequently-asked-questions-pinterest-api/2083)
- [Upgrading from trial to standard API access](https://community.pinterest.biz/t/upgrading-from-trial-to-standard-api-access/30014)
- [Upgrading from trial to standard](https://community.pinterest.biz/t/upgrading-from-trial-to-standard/39171)

---

## Farcaster: setting up Neynar managed signers

### The problem
Clicking **Add channel → Farcaster** shows:

> Farcaster is not configured: set NEYNAR_APP_FID and NEYNAR_APP_MNEMONIC

This is **not a code bug**. It is a deliberate setup check in `FarcasterProvider.createSigner()` (`libraries/nestjs-libraries/src/integrations/social/farcaster.provider.ts`).

Since PR #16 (ported from upstream Postiz #2078/#2080), connecting Farcaster uses Neynar **managed signers**:
- The backend creates a signer and signs a key request with the **app account's** wallet.
- The user scans a QR code and approves the request in their Farcaster app.

Signing that request needs the app account's FID and recovery phrase. Those two vars aren't set, so the check stops with this message.

### Env vars

All of these go in the backend env. Restart the backend after setting them.

| Var | What it is | Where to get it |
|---|---|---|
| `NEYNAR_SECRET_KEY` | Neynar **API key** | Neynar dashboard → your app. Without it, the client falls back to a dummy key and every call fails. |
| `NEYNAR_CLIENT_ID` | Neynar **Client ID** | Same Neynar app page. Also read by the frontend (`apps/frontend/src/app/(app)/layout.tsx`), so set it there too if the frontend has its own env file. |
| `NEYNAR_APP_FID` | Numeric Farcaster ID of the Postaryx app account | Farcaster app → Profile → ⋯ → About, or look up the username in Neynar. |
| `NEYNAR_APP_MNEMONIC` | Recovery phrase of the app account's wallet | Farcaster app → Settings → Advanced → Show recovery phrase. |
| `NEYNAR_SPONSOR_SIGNERS` | `"true"` = Neynar pays the user's one-time signer fee out of our Neynar credits | Our choice. |

```
NEYNAR_SECRET_KEY="..."
NEYNAR_CLIENT_ID="..."
NEYNAR_APP_FID="123456"
NEYNAR_APP_MNEMONIC="word1 word2 ... word12"
NEYNAR_SPONSOR_SIGNERS="true"
```

On `NEYNAR_SPONSOR_SIGNERS`:
- Our code only asks Neynar to sponsor the signer when it is `"true"`.
- Without it, the user may be asked to pay a small fee in the Farcaster app.
- Neynar's docs say they sponsor by default, so check during testing whether users get charged.

### Step 1: Neynar (API access)
1. Sign up at **dev.neynar.com** and create an app named "Postaryx".
2. Copy the **API key** into `NEYNAR_SECRET_KEY`.
3. Copy the **Client ID** into `NEYNAR_CLIENT_ID`.

### Step 2: A Farcaster account for Postaryx (the "app account")
This is the account users see on the approval screen ("Postaryx wants to post on your behalf").

1. Install the **Farcaster** app (formerly Warpcast) on a phone.
   - As far as we know, sign-up only works in the mobile app; farcaster.xyz in a browser only logs in an existing account by QR code.
   - The recovery phrase is also only available in the mobile app.
2. Create a **new, dedicated** account (e.g. `@postaryx`) and give it the Postaryx name and logo. Never use a personal account.
3. Copy the account's **FID** into `NEYNAR_APP_FID`.
4. Copy the **recovery phrase** into `NEYNAR_APP_MNEMONIC`, as 12 or 24 words in quotes, separated by single spaces.
5. Delete the phrase from anywhere else you pasted it.

### Step 3: Test the connection
1. Restart the backend.
2. In Postaryx, click **Add channel → Farcaster**. A QR code modal should appear.
3. Scan the QR code with a **different** Farcaster account (a personal test account, which can be on the same phone) and approve.
4. The modal closes and the channel appears in the list. Publish a short test post.

If it fails, the modal shows Neynar's error message.

### Security: the recovery phrase
- It gives **full control** of the Postaryx Farcaster account and its wallet. Our code only uses it to sign each user's key request.
- Keep it only in the server env and the deployment secrets. Never commit it, and never paste it into chat or tickets.
- Add it to the secret inventory in `docs/1.SECURITY-HARDENING-TODO.md`.
- If it leaks:
  1. Move the account to a new wallet (recovery address) in the Farcaster app.
  2. Update `NEYNAR_APP_MNEMONIC`.
  3. Restart the backend.

### Sources
- [Write data w/ managed signers – Neynar](https://docs.neynar.com/docs/integrate-managed-signers)
- [Register signed key – Neynar](https://docs.neynar.com/reference/register-signed-key)
- [Mini app authentication – Neynar](https://docs.neynar.com/docs/mini-app-authentication)
