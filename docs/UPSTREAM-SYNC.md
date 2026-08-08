# Upstream Sync — pulling Postiz's fixes into our code

Postiz keeps shipping bug fixes and features we want. This is how to take them
without losing our own changes.

Pulling **from** upstream is safe and sends them nothing — see
[UPSTREAM-ISOLATION.md](./UPSTREAM-ISOLATION.md).

---

## Where we stand right now

Measured 8 Aug 2026:

```
commits upstream has that we lack:   205
commits we have that upstream lacks:  19
last common commit:                   f7f1f318  (29 May 2026)
```

So we are about **ten weeks behind**. That gap is the single biggest reason to do
this deliberately rather than casually — 205 commits is a lot of surface area.

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

You will get conflicts. Expected — and we know exactly where, because we measured
the overlap between the files we changed and the files they changed.

### The 22 conflict hotspots, and how to resolve each

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

Also keep our explicit `STRIPE_API_VERSION` pin in `stripe.service.ts`; upstream
inherits the SDK default. If you bump the SDK, the pinned version must stay in
sync with the API version set on the Stripe webhook endpoint — a mismatch fails
silently. Background: [billing-current-state.md](./billing-current-state.md).

#### Group 3 — Deployment (our CI-build change)

| File | Resolution |
|---|---|
| `docker-compose.yaml` | **Keep ours entirely** for the `postiz` service — we pull an image, upstream builds one. Take their changes to *other* services (Postgres/Redis/Temporal versions) |
| `docker-compose.dev.yaml` | Usually take theirs; re-check ports |
| `.github/workflows/build-containers.yml` | **Keep ours.** Theirs pushes to `gitroomhq`'s namespace and builds amd64 we don't use |
| `.env.example` | Take theirs for new variables, keep our clarified comments |

Why: [CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §6.

#### Group 4 — Docs (ours always wins)

`README.md`, `CLAUDE.md` — these describe *our* fork. Take ours; skim their diff
only in case they documented a new env var worth copying.

#### Group 5 — Ordinary code conflicts (just read them)

`apps/backend/src/api/routes/users.controller.ts`,
`no.auth.integrations.controller.ts`,
`apps/backend/src/services/auth/public.auth.middleware.ts`,
`apps/frontend/src/app/(app|extension|provider)/layout.tsx`,
`apps/frontend/src/components/launches/continue.integration.tsx`,
`apps/orchestrator/src/activities/post.activity.ts`,
`libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`,
`libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts`

No policy here — read both sides and merge on the merits. Upstream usually wins
because these are their bug fixes.

### Regenerate the list before you start

The hotspot list above was accurate on 8 Aug 2026. It drifts. Recompute:

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
docker compose -p postiz-dev -f docker-compose.dev.yaml up -d
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
