---
name: upstream-sync
description: Bring upstream Postiz (gitroomhq/postiz-app) changes into Postaryx's postaryx-app through a sync branch, merging release tag by release tag and resolving conflicts by the rules in docs/UPSTREAM-SYNC.md. Use when the user asks to sync, update, merge or catch up with upstream / Postiz, or to cherry-pick a single upstream fix.
---

# Upstream sync (Postiz → Postaryx)

Postaryx (`postaryx-app`) is a modified clone of Postiz. The `upstream` remote is `gitroomhq/postiz-app`, and pushing to it is disabled. This skill keeps our `main` current with upstream without losing our deliberate differences: billing provider abstraction with Polar, VK removal, CI build, rebrand, upload limits, and provider fixes.

**Scope:** `postaryx-app` only. `clientside-landing` never takes part in this.

## Read before doing anything

1. `docs/UPSTREAM-SYNC.md`: the rulebook. It lists every conflict group and the resolution rule for each. This skill is the procedure; that document holds the rules.
2. `CLAUDE.md`: the rule to stay close to upstream, and the billing rules (`isBillingEnabled()`, the Stripe API version pin).
3. `docs/database-migrations.md`: only if a step changes `schema.prisma`.

## Hard rules

- Never merge upstream directly into `main` or into a feature branch. Always use a `chore/upstream-sync-*` branch cut from `main`.
- Never push, and never open a PR, without the user's explicit OK in this session. Never re-enable the upstream push URL.
- Ask before each merge commit. Commit messages are one line.
- Never delete or weaken `scripts/check-banned-providers.mjs` to get a build passing.
- Never run `prisma db push` against production. Schema changes become reviewed SQL (see `docs/database-migrations.md`).
- When unsure whose side wins a conflict, stop and ask. Show both sides in plain words, not a raw diff dump.

## Step 0 — Measure and report

```bash
cd postaryx-app
git fetch upstream --tags && git fetch origin
git switch main && git pull --ff-only
BASE=$(git merge-base main upstream/main)
git log -1 --format='%h %ad %s' --date=short $BASE        # last common commit
git rev-list --count main..upstream/main                  # behind
git rev-list --count upstream/main..main                  # ours
```

Per-tag table: new commits, cumulative conflicts if merged into `main`, and `schema.prisma` growth.

```bash
prev=$BASE
for t in $(git tag --merged upstream/main --no-merged main --sort=creatordate | grep -E '^v[0-9]') upstream/main; do
  n=$(git rev-list --count $prev..$t)
  c=$(git merge-tree --write-tree --name-only main $t | sed -n '2,/^$/p' | grep -vc '^$')
  s=$(git diff --shortstat $prev $t -- '*schema.prisma')
  echo "$t $(git log -1 --format=%ad --date=short $t) commits=$n conflicts=$c schema:${s:-none}"
  prev=$t
done
```

Report the table to the user. The conflict counts are cumulative from `main`, so the jump between rows shows where new conflicts come from.

## Step 1 — Plan the steps (default: step by step)

Merge **one release tag at a time**, not `upstream/main` in a single go. Upstream tested each tag as a release, so every intermediate state is something real users ran. That also makes breakage traceable to one step.

How to group tags into steps:
- Aim for roughly 100–300 upstream commits per step. Fold tiny patch tags (for example `v2.21.9`, `v2.21.10`) into the next step.
- **Isolate any tag that changes `schema.prisma` a lot into its own step,** so the database migration can be reviewed alone.
- The last step is `upstream/main` only if the commits after the newest tag are worth taking now. Otherwise stop at the tag.
- If we are fewer than about 150 commits behind with no schema change, one step is fine.

Show the plan as a table (step, target, commits, schema yes/no) and wait for the user's OK.

## Step 2 — Prepare

```bash
git status --porcelain                      # must be clean; if not, stop and ask
git config rerere.enabled true              # remembers conflict resolutions
git config rerere.autoupdate true
git switch -c chore/upstream-sync-<final-target>-<YYYY-MM-DD> main
```

## Step 3 — For each step

1. **Merge:** `git merge --no-ff <tag>`. Leave conflicts in place; don't abort.
2. **List and classify:** run `git diff --name-only --diff-filter=U` and `git status --short`, which also shows delete/modify conflicts. Sort every file into a group from `docs/UPSTREAM-SYNC.md`. If a file fits no group, treat it as "ordinary code".
3. **Resolve the mechanical groups yourself**, following the rulebook:
   - `pnpm-lock.yaml`: run `git checkout --theirs pnpm-lock.yaml`. After the other files are resolved, run `pnpm install` to regenerate it. For `package.json`, merge by hand: their versions and scripts, plus our deliberate script differences (see `pm2-run` in `docs/database-migrations.md`).
   - Translation JSONs (`libraries/react-shared-libraries/src/translation/locales/*/translation.json`): do a key-level 3-way merge, not a line merge. Write a small node script for it in the scratchpad, not in the repo. Use the merge base, ours and theirs from `git show :1:<f>`, `:2:<f>` and `:3:<f>`. Logic:
     - Start from **theirs**.
     - A key whose value we changed relative to the base takes **ours**. This is how the rebrand survives: Postiz/Gitroom → Postaryx.
     - A key we deleted stays deleted, unless upstream changed its value since the base. In that case, ask.
     - A key we added is kept.
     - After the merge, scan the values for `Postiz`/`postiz.com`/`Gitroom` that upstream newly added, and list them for the user. Don't auto-replace them, because some are legitimate (for example the `postiz` npm package or attribution).
     - Keep key order stable (theirs, then ours appended). `i18n.lock`: take theirs.
   - Docs that describe our fork (`README.md`, `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/*TEMPLATE*`): take ours. Mention any new env var their diff documents.
   - Delete/modify conflicts on files we removed on purpose (`vk.provider.ts`, `.gitmodules`, others in the rulebook): `git rm` them again.
4. **Resolve the judgment groups.** These are billing (Stripe/Polar/`isBillingEnabled`), uploads, providers we fixed, deployment and ordinary code. For each file:
   - Summarize what upstream changed and what we had.
   - If upstream fixed the same bug we fixed, prefer theirs and drop ours.
   - Otherwise keep our behavior and take their other changes.
   - Resolve the clear cases. Collect the unclear ones and ask the user in **one batch**.
5. **Guards:** all of these must pass before committing.
   ```bash
   node scripts/check-banned-providers.mjs
   git diff --check                                          # no leftover conflict markers
   grep -rnE "process\.env\.(STRIPE|POLAR)_" apps libraries --include='*.ts' --include='*.tsx' | grep -v node_modules
   ```
   The grep should show only the legitimate reads listed in `CLAUDE.md`.
6. **Verify:**
   ```bash
   pnpm install && pnpm run prisma-generate && pnpm run build && pnpm test
   ```
   Report failures with their output. Don't hide them.
7. **Schema:** if `schema.prisma` changed in this step, generate the SQL per `docs/database-migrations.md` into `docs/migrations/<date>-upstream-<tag>.sql`. Flag anything destructive (drops, type changes, NOT NULL without a default). Don't apply it anywhere.
8. **Commit:** ask, then `git commit --no-edit` (keeps `Merge tag '<tag>'`).
9. **Log the step (always):** append a section to `docs/UPSTREAM-SYNC-LOG.md`, using the format of the existing entries:
   - **Header:** "Step N (`<tag>`) is merged and verified".
   - **Size:** commits and conflicted files.
   - **Verification:** builds, guards, tests compared with the `origin/main` baseline, schema.
   - **Resolutions:** a table by area.
   - **Questions for the user:** each one with **the user's answer** filled in once it arrives.
   - **Testing notes:** test-coverage status and next steps.

   Commit the log on its own (`docs: upstream sync log for step N (<tag>)`). Then go to the next step.

**Tests:** if `pnpm test` can't run, use a ts-jest config in the scratchpad that maps the `@gitroom/*` aliases. Run it on the sync branch **and** on a clean `origin/main` worktree. Report only the failures that are new compared with that baseline.

**Workflows:** upstream adds new post-workflow versions (for example `postWorkflowV106`). Any Postaryx behaviour inside older versions (for example `publishedNotification`: thumbnail warning, pending verification) must be carried into the new version. Do this before it ever runs in production; once a workflow version is running there, edits must stay replay-safe.

## Step 4 — Finish

- Give a short report: the steps done, the conflicts resolved per group, the decisions the user made, upstream fixes that replaced ours, new brand strings, and SQL files waiting for review.
- Update `docs/UPSTREAM-SYNC.md`: the "Where we stand" numbers, plus any new deliberate difference introduced since the last sync, with its resolution rule.
- Ask before pushing the branch and opening a PR into `main`. CI gates it. Production rollout follows `docs/CI-BUILD-CUTOVER.md`, after the SQL is applied.
- Remind the user that open feature branches should merge `main` **after** the sync lands. rerere replays the same resolutions there.
- Recommend the next sync in 2–4 weeks. Small, frequent merges are cheap.

## Cherry-pick mode (one urgent fix)

When the user wants a single upstream fix, follow "Option A" in `docs/UPSTREAM-SYNC.md`:
1. Find the commit with `git log --oneline main..upstream/main --grep=<kw>`.
2. Show it with `git show`.
3. Create a branch `fix/upstream-<topic>` from `main`.
4. Run `git cherry-pick [-m 1] <sha>`.
5. Run the same guards and verification as Step 3.

Note that a later full merge absorbs it.
