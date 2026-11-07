# Upstream Sync — pulling Postiz's fixes into our code

Postiz keeps shipping bug fixes and features we want. This is how to take them
without losing our own changes.

Pulling **from** upstream is safe and sends them nothing — see
[UPSTREAM-ISOLATION.md](./UPSTREAM-ISOLATION.md).

---

## Where we stand right now

Measured 7 Nov 2026, on `chore/upstream-sync-2026-11-07` after the four-step
catch-up (before it: 959 behind, last common commit `f7f1f318` of 29 May 2026).
These become `main`'s numbers once that branch is merged. Re-measure with the
commands below, because this drifts every week:

```
commits upstream has that we lack:     0
commits we have that upstream lacks:  63   (on the sync branch)
last common commit:                   5a131eb0  (6 Nov 2026, after v2.25.3)
pending reviewed SQL:                 docs/migrations/2026-11-07-upstream-*.sql (3 files, in order)
```

We are **current with upstream**. Keep it that way with small, frequent merges (see
[Cadence](#cadence)). If a gap ever grows past ~150 commits again, merge **release tag
by release tag** (see [Step-by-step](#step-by-step-by-release-tag)). The per-step
record of the November catch-up is in [UPSTREAM-SYNC-LOG.md](./UPSTREAM-SYNC-LOG.md).

With Claude Code, run the `/upstream-sync` skill
(`.claude/skills/upstream-sync/SKILL.md`). It follows this document.

Re-measure any time:

```bash
git fetch upstream
git rev-list --count main..upstream/main   # how far behind
git rev-list --count upstream/main..main   # our own commits
git log --oneline main..upstream/main      # what they did
```

---

## Pick one of two strategies

| | **Cherry-pick** | **Merge** |
|---|---|---|
| Take | One specific fix | Everything up to a point |
| Use when | "TikTok upload is broken and they fixed it" | "We want to be current again" |
| Conflict risk | Low, contained | High, all at once |
| Effort | Minutes | Hours, plus real testing |
| Downside | History diverges further each time; you'll pay for it later | One big painful session |

**Recommendation:** cherry-pick urgently-needed fixes as they come up, and do a
full merge on a planned cadence (see [Cadence](#cadence) at the end). Do **not**
let cherry-picks become the only strategy — each one widens the gap that the
eventual merge has to close.

---

## Option A — Cherry-pick a single fix

Fastest path when you want one thing.

```bash
git fetch upstream

# 1. Find it. Search their log by keyword.
git log --oneline main..upstream/main --grep="youtube"

# 2. See exactly what it changes before you take it.
git show <their-sha>

# 3. Take it onto a branch, never straight onto main.
git checkout -b fix/upstream-youtube-chunking main
git cherry-pick <their-sha>
```

If the commit is a **merge commit** (most upstream PRs are), cherry-pick needs to
be told which side to take:

```bash
git cherry-pick -m 1 <their-merge-sha>
```

On conflict: resolve, `git add <files>`, `git cherry-pick --continue`. To abort
entirely, `git cherry-pick --abort`.

Then run the [verification checklist](#verify-after-any-sync) and open a PR.

---

## Option B — Full merge

Do this when you have a few uninterrupted hours, not before a deploy.

```bash
git fetch upstream
git checkout main && git pull                       # be current with our own remote
git checkout -b chore/upstream-merge-2026-08        # NEVER merge upstream onto main directly
git merge upstream/main
```

You will get conflicts. That's expected, and we know exactly where, because we measured
the overlap between the files we changed and the files they changed.

### Step-by-step by release tag

When we are far behind, don't merge `upstream/main` in one go. Merge one release tag
at a time on the same sync branch (`git merge --no-ff v2.23.0`, resolve, verify, commit,
then the next tag). The total conflict count is about the same, but:

- every step lands on a state upstream actually shipped and tested;
- when something breaks, you know which release caused it;
- a tag that changes `schema.prisma` a lot can be its own step, so its SQL is reviewed alone;
- you can stop after any step and still have a working branch.

Turn on `git config rerere.enabled true` (and `rerere.autoupdate true`) first. Git then
replays a resolution you already made when the same conflict reappears in a later step
or in a feature branch.

Plan made on 7 Nov 2026, using the per-tag measurement in the skill:

| Step | Target | Upstream commits | Schema change | Status |
|---|---|---|---|---|
| 1 | `v2.23.0` (folds in v2.21.9, v2.21.10, v2.22.1) | 170 | no | done |
| 2 | `v2.24.0` | 269 | **yes, about 880 lines; review the SQL alone** | done |
| 3 | `v2.25.1` (folds in v2.25.0) | 304 | small | done |
| 4 | `upstream/main` at `5a131eb0` (folds in v2.25.2, v2.25.3) | 216 | tiny (indexes) | done |

### The 25 conflict hotspots, and how to resolve each

These are the files both sides have touched since the last common commit. Group
by *why* they conflict; the resolution rule differs per group.

#### Group 1 — VK removal ⚠️ read this one carefully

| File | Situation |
|---|---|
| `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts` | **We deleted it, they modified it** |
| `libraries/nestjs-libraries/src/integrations/integration.manager.ts` | Registration list |
| `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx` | Frontend registry |
| `libraries/nestjs-libraries/src/dtos/posts/providers-settings/all.providers.settings.ts` | Settings registry |

VK was removed on purpose — VK Company is EU-sanctioned (13 Jul 2026) and we are
a US LLC onboarding with a bank and Stripe.

The `vk.provider.ts` case is a **delete/modify conflict**. Git will say
`deleted by us` and leave the file present. The resolution is to delete it again:

```bash
git rm libraries/nestjs-libraries/src/integrations/social/vk.provider.ts
```

For the three registry files, keep our version of the VK lines (i.e. absent) and
take their changes to *everything else* in the file. These are long literal
arrays — exactly the shape where a stray line survives a merge unnoticed.

**Safety net:** `scripts/check-banned-providers.mjs` fails the build if VK comes
back. Run it *before* you commit the merge:

```bash
node scripts/check-banned-providers.mjs
```

If it fails, re-remove what it names. **Do not delete the check** to make the
build pass.

#### Group 2 — Billing (our `BILLING_ENABLED` divergence)

| File |
|---|
| `libraries/nestjs-libraries/src/services/stripe.service.ts` |
| `apps/backend/src/api/routes/billing.controller.ts` |
| `apps/frontend/src/components/billing/first.billing.component.tsx` |

Upstream gates billing on the *presence of* `STRIPE_PUBLISHABLE_KEY`, in ~15
scattered places. We deliberately replaced that with a single
`isBillingEnabled()` helper. So when a conflict here shows upstream
re-introducing a `process.env.STRIPE_*` check:

- **Keep our** `isBillingEnabled()` call.
- **Take their** actual logic change around it.

Since the 2026-11-07 sync (step 2, v2.24.0) billing runs on **upstream's**
payment-provider system (`services/payment/`), and Polar is one more provider in it
(`@PaymentProvider({ provider: 'polar' })`). Our old `IBillingProvider` is gone, so
most billing code now matches upstream. The remaining Postaryx differences, which must
survive every merge:

- `StripeService.processWebhook`: `metadata.service !== 'postaryx'` (upstream checks
  `'gitroom'`; taking theirs silently drops **every** Stripe webhook), plus our
  `invoice.payment_failed` / `charge.dispute.*` cases.
- `PaymentProviderManager.getDefaultProvider`: picks `BILLING_PROVIDER` (default
  `stripe`) instead of registration order.
- `PaymentProviderAbstract.refundCharges` / `cancelSubscription` take an optional
  `actorUserId` (audit trail). `deleteSubscription(customerId, provider, status)` keeps
  our terminal status plus soft delete.
- `BillingController`: `/lifetime`, `/events` and the actor ids are ours; the Chatbase
  refund endpoints are disabled (404).
- Our refund-policy work (proration preview, portal, BillingEvent audit trail, #12/#17)
  lives in `stripe.service.ts`. Keep it.
- **Every** `service: 'gitroom'` that upstream writes into subscription metadata or
  checks on it becomes `'postaryx'`: `setToCancel` (cancel / un-cancel) writes it, and
  `trackConversion` (Facebook pixel purchase) checks it. Grep new upstream code for
  `'gitroom'` in `stripe.service.ts` on every sync. The one exception left as is: the
  admin coupons' `metadata: { service: 'gitroom', organizationId }`, which nothing reads.
- Upstream's automatic cancel of a duplicate subscription records a
  `SUBSCRIPTION_CANCELED_IMMEDIATELY` BillingEvent (ours), because it issues no refund.

Also keep our explicit `STRIPE_API_VERSION` pin in `stripe.service.ts`; upstream
inherits the SDK default. If you bump the SDK, the pinned version must stay in
sync with the API version set on the Stripe webhook endpoint — a mismatch fails
silently. Background: [billing-current-state.md](./billing-current-state.md).

#### Group 3 — Deployment (our CI-build change)

| File | Resolution |
|---|---|
| `docker-compose.yaml` | **Keep ours entirely** for the `postaryx` service — we pull an image, upstream builds one. Take their changes to *other* services (Postgres/Redis/Temporal versions) |
| `docker-compose.dev.yaml` | Usually take theirs; re-check ports |
| `.github/workflows/build-containers.yml` | **Keep ours.** Theirs pushes to `gitroomhq`'s namespace and builds amd64 we don't use |
| `.github/workflows/build.yml` | **Keep our `push: branches: [main]`.** Upstream's bare `push:` matches every branch and double-builds each commit once a PR is open |
| `.github/workflows/eslint.yml` | Ours only. Upstream's copy is the extensionless `eslint` file that never ran — if a merge resurrects it, delete it |
| `.env.example` | Take theirs for new variables, keep our clarified comments |
| `.github/workflows/deploy-aws.yml` | **Deleted, keep it deleted.** It dispatches Postiz's own AWS deploy (`gitroomhq/postiz-aws`). It is guarded to their repository, so it would only show as a skipped run here. If a merge brings it back, `git rm` it |
| `.gitmodules` | **We deleted it, they still ship it.** It declared a `gitroomhq/public-api` submodule at `libraries/plugins/src/list/public-api` — a path that does not exist in this repo and that nothing imports. A merge that restores the file is a delete/modify conflict: `git rm .gitmodules` again |

Why: [CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §6.

#### Group 4 — Docs (ours always wins)

`README.md`, `CLAUDE.md` — these describe *our* fork. Take ours; skim their diff
only in case they documented a new env var worth copying.

#### Group 4b — Mechanical files (resolve by rule, never line by line)

| File | Resolution |
|---|---|
| `pnpm-lock.yaml` | Take theirs, then run `pnpm install` once everything else is resolved |
| `package.json` | Their versions and scripts, plus our deliberate script differences (`pm2-run` without `prisma-db-push`, see [database-migrations.md](./database-migrations.md)) |
| `i18n.lock` | Take theirs |
| `locales/*/translation.json` (15 files) | **Key-level 3-way merge.** Start from theirs. Keys whose value we changed take ours (that's the rebrand: Postiz/Gitroom → Postaryx). Keys we deleted stay deleted. Keys we added stay. Then list any new `Postiz` strings upstream added, and decide on each one. A plain line merge is wrong here: the rebrand touched hundreds of lines and also renamed some keys |

#### Group 4c — Our product fixes since August

Uploads, which are 10 MB images / 1 GB video per type on every path including R2 (#23, #26, #27):
`custom.upload.validation.ts`, `upload.factory.ts`, `local.storage.ts`, `r2.uploader.ts`,
`cloudflare.storage.ts`, `media.controller.ts`, `media.service.ts`, `media.component.tsx`,
`api/uploads/[[...path]]/route.ts`.

Providers: nostr/dev.to/moltbook hex key (#15), telegram local media (#16),
hashnode/mastodon-custom (#10), kick/whop (#19), Pinterest base URL from env (#20),
Facebook integration (#25), YouTube scopes and thumbnail status (#28).

UI: hidden Chrome-extension button (#18), wallet removed, Google SSO enabled,
unpublished Docs buttons hidden (#30).

Rule: **if upstream fixed the same bug, take theirs and drop ours**, because that's
one less difference to carry. Otherwise keep our behaviour and take their other changes.
Upload limits are a product decision: keep 10 MB / 1 GB even if upstream changes its defaults.

#### Group 4d — Rebrand and hidden-surface divergences (since Nov 2026)

These came up on almost every file in the November catch-up. Rule: keep ours, take
their logic and their `mobile:` / responsive classes on top.

| What | Our side |
|---|---|
| Brand colour | Orange `#c2410c` (hover `#ea580c`) and the `btnPrimary` / `cardHover` / `textItemBlur` / `newBorder` tokens. Upstream's purple and pink (`#612BD3`, `#622FF6`, `#FC69FF`, `#D82D7E`, `#5520CB`, `#8b5cf6`) are recoloured, **including in files that merge without a conflict**: grep the merged diff for them before committing |
| Fonts | Geist / Fraunces only. Upstream's Plus Jakarta Sans (now `fonts/plus-jakarta-sans`) is not wired into any layout |
| Developer portal | `SHOW_DEVELOPER_PORTAL = false` in `settings.component.tsx` and `developer.icon.component.tsx` hides the Agents tab (public API, MCP) and the OAuth-app management under Apps. Upstream's directory connectors ("Add to Claude", "Official connector") stay off via `showPostizDirectoryConnectors` in `public.component.tsx`: they point at Postiz's listings |
| Onboarding | Single step (connect channels). Upstream's agent and tutorial steps are not taken |
| Sentry | Console levels from `SENTRY_CONSOLE_LEVELS` (default warn, error) and AI prompts only with `SENTRY_RECORD_AI_IO=true`. Upstream forwards every console level |
| YouTube thumbnail after upload | `finalizePost` never throws once the video is live; it returns a `warning` (#28). Upstream's `PublishedWithError` path covers only `BadBody` and still throws on token errors |
| Token refresh | `canRefreshToken === false` providers are never asked to refresh and skip upstream's concurrent-refresh wait |
| User-facing "Postiz" | Rebranded, including outbound identifiers (WordPress User-Agent, Discord bot error) and the HubSpot install notice. Left alone only behind switched-off features (`MCP_SELF_HOSTED_RELAY`, hidden connectors) |

#### Group 5 — Ordinary code conflicts (just read them)

`apps/backend/src/api/api.module.ts`,
`apps/backend/src/api/routes/users.controller.ts`,
`no.auth.integrations.controller.ts`,
`apps/backend/src/services/auth/public.auth.middleware.ts`,
`apps/frontend/src/app/(app|extension|provider)/layout.tsx`,
`apps/frontend/src/components/auth/login.tsx`,
`apps/frontend/src/components/launches/continue.integration.tsx`,
`apps/orchestrator/src/activities/post.activity.ts`,
`libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`,
`libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts`,
`.gitignore`

No policy here — read both sides and merge on the merits. Upstream usually wins
because these are their bug fixes (`.gitignore` is the exception — just union
both sides' entries, there's no "theirs vs ours" to weigh).

### Regenerate the list before you start

The hotspot list above was accurate on 16 Aug 2026. It drifts. Recompute:

```bash
BASE=$(git merge-base main upstream/main)
comm -12 \
  <(git diff --name-only "$BASE" main | sort) \
  <(git diff --name-only "$BASE" upstream/main | sort)
```

### Finish the merge

```bash
node scripts/check-banned-providers.mjs   # MUST pass before committing
git add -A
git commit                                # keep the default merge message, add notes on your resolutions
```

---

## Verify after any sync

Do all of these. A merge that compiles is not a merge that works.

```bash
# 1. Banned providers did not come back
node scripts/check-banned-providers.mjs

# 2. Dependencies + Prisma client are current with the merged schema
pnpm install
pnpm run prisma-generate

# 3. Everything builds
pnpm run build

# 4. Tests
pnpm test
```

**Did the Prisma schema change?** Check with:

```bash
git diff HEAD~1 -- libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

If it did, treat it as a production migration, not a `db push`. This is a live
system — see the constraints in [../CLAUDE.md](../CLAUDE.md).

**Then run it for real** before merging to `main`:

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push
pnpm run dev
# log in, load the calendar, schedule a post, check one social connector
```

Finally, open a PR to `main` so the *Build* workflow gates it, and after merge
watch *Build image* go green before deploying —
[CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md).

---

## Cadence

The 205-commit gap happened because there was no schedule. Suggested:

- **Monthly** full merge on a branch. Painful once a month beats agonising twice
  a year, because conflicts compound.
- **Immediately** cherry-pick anything security- or connector-related — e.g.
  upstream's recent `fix(security): non axios ssrf checking` and the
  YouTube/TikTok media-encoding fixes are exactly the class of change worth
  taking on sight.
- **Before** starting any large feature, sync first. Merging upstream into a
  half-finished feature branch is the worst version of this job.

**A note on keeping the gap small:** per [../CLAUDE.md](../CLAUDE.md), when
there's a choice between an idiomatic-for-us change and one that mirrors
upstream, mirror upstream. Every deliberate divergence is a conflict you have
agreed to resolve forever. Where we do diverge on purpose (billing, VK, CI
build), it's documented — keep that habit, because these documents are what make
the next merge tractable.
