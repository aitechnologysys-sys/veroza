# Schema migrations: order and ledger

Every file here is reviewed SQL that brings a deployed database up to the
`schema.prisma` of the code that needs it. **Deploying the code does not apply
them.** Our startup no longer runs `prisma db push` (see
[../database-migrations.md](../database-migrations.md)), so a file that is never
applied means the new code runs against a database that is missing its tables and
columns.

Why there are no Prisma `migrations/` folders: upstream Postiz never used Prisma
Migrate. It runs `prisma db push --accept-data-loss` on every start, which needs no
history. We removed that (it can drop data), and until we adopt Prisma Migrate
(see "Making it impossible to miss" below) these files are the history.

## Rules

1. **Every database that runs a deployment needs every file, in this order.**
   That means production, staging, a demo and any self-hosted install. Apply files
   only once, and never skip one.
2. **Apply before deploying the code that needs it.** All files so far are
   additive enough that the *old* code keeps working on the *new* schema, so
   "migrate first, then deploy" is always safe. The other order is not.
3. **Record every apply in the ledger below,** in the same PR or commit as the
   deploy note. A database not in the ledger is treated as "unknown": check it
   (see "Is it applied?") before you deploy to it.
4. Local development databases do **not** use these files. After pulling, run
   `pnpm prisma-db-push` as before.

## Files, in order

| # | File | What it does | Requires | Destructive? |
|---|---|---|---|---|
| 1 | `2026-10-14-meta-deletion-request.sql` | `MetaDeletionRequest` table and 3 enums (Meta deauthorize / data-deletion callbacks, #25) | – | No |
| 2 | `2026-11-07-upstream-v2.24.0.sql` | Upstream v2.24.0: 39 tables (agent memory, Clipping), `Subscription.provider` (defaults to `'stripe'`), `Provider.APPLE`, OAuthApp columns become nullable | #1 | No data loss. Two columns become nullable and one FK is re-created |
| 3 | `2026-11-07-upstream-v2.25.1.sql` | Upstream v2.25.1: `Integration.customName`, `Post.batchId`, comment threads, `OAuthSelfHostedAuthorization` | #2 | No data loss. `Comments.userId` becomes nullable and its FK is re-created |
| 4 | `2026-11-07-upstream-main-5a131eb0.sql` | Upstream main: `User.timezoneName` and 5 indexes | #3 | No. The two `Post` indexes lock writes to `Post` while they build |

Code that needs them: #1 is on `main` since 23 Oct 2026 (PR #25). #2 to #4 come with
the `chore/upstream-sync-2026-11-07` merge.

## Ledger: where each file has been applied

Fill in one row per database and file when you apply it. Leave nothing implied.

| Environment (database) | File | Applied on | By | Check query result after |
|---|---|---|---|---|
| production (`postaryx-postgres` on the Oracle VM) | #1 `2026-10-14-meta-deletion-request.sql` | **unknown, check it** | | |
| production | #2 `2026-11-07-upstream-v2.24.0.sql` | not yet | | |
| production | #3 `2026-11-07-upstream-v2.25.1.sql` | not yet | | |
| production | #4 `2026-11-07-upstream-main-5a131eb0.sql` | not yet | | |

## Is it applied? (one query for all four files)

On the production server (`/opt/postaryx/postaryx-app`):

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT
  to_regclass('"MetaDeletionRequest"') IS NOT NULL                 AS f1_meta_deletion,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Subscription'
            AND column_name = 'provider')                          AS f2_v2_24_0,
  to_regclass('"OAuthSelfHostedAuthorization"') IS NOT NULL        AS f3_v2_25_1,
  to_regclass('"Post_organizationId_publishDate_idx"') IS NOT NULL AS f4_main_5a131eb0;
SQL
```

`t` means applied and `f` means not applied. Each column checks one object that only
its file creates. For the full picture, including drift no file explains, run
`pnpm migrate:diff` with `DATABASE_URL` pointing at that database, from a checkout of
the code you are about to deploy. Empty output means the database matches the code.

## Applying

```bash
cd /opt/postaryx/postaryx-app && git pull          # the files come with the code

# 1. Back up (custom format, restorable with pg_restore)
docker exec postaryx-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ~/backups/postaryx-$(date +%Y%m%d-%H%M).dump

# 2. Apply ONE file, in a single transaction: on any error nothing is applied
docker exec -i postaryx-postgres sh -c \
  'psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' \
  < docs/migrations/<file>.sql
# (`-f -` is needed: psql ignores -1 for plain stdin. A failure exits with code 3.)

# 3. Re-run the "Is it applied?" query, then record the row in the ledger above
```

Repeat step 2 per file, in order. Only after the last one, deploy the new image
(the everyday flow in `docs/3. (First time important) CI-BUILD-CUTOVER.md`).

`-1` wraps the file in one transaction. That is safe for every file so far on
Postgres 17, including `ALTER TYPE ... ADD VALUE` in #2. A future file that needs
`CREATE INDEX CONCURRENTLY` must be applied without `-1`, and its header must say so.

## Rollback criteria

**The schema is never rolled back for these files.** They only add things, and
the code before the merge works on the newer schema, so rolling back means
redeploying the previous image (`POSTARYX_IMAGE_TAG=<sha>`, see "Rolling back" in
the cutover doc). Dropping what a file added after the new code has written to it
loses customer data.

| Situation | Do |
|---|---|
| A file fails while applying | Nothing was applied (`-1`). Don't deploy. Read the error; usually the database has drifted. Run `pnpm migrate:diff` against it, fix forward with a reviewed file, and re-apply |
| Files applied, new code not deployed yet | Nothing to undo. The old code keeps running. Deploy when ready |
| New code deployed, and within the first hour any of these happens: login or calendar broken; scheduled posts not publishing (Temporal UI shows failing `postWorkflowV112` runs); Stripe webhook deliveries failing in the Stripe dashboard; the orchestrator or backend crash-looping; Sentry errors several times the usual rate | **Roll back the image**, keep the schema. Then fix forward |
| A specific feature is broken but core posting and billing work | Don't roll back. Fix forward |
| The database itself is damaged (data loss, not a missing column) | Restore the backup taken before applying (`pg_restore`). This **loses everything written since the backup**, so it is the last resort |

**Why roll back fast or not at all:** the new code starts workflows that the old
image's worker does not have: `postWorkflowV106` to `V112` (main stops at V105),
`sendSingleEmailWorkflow` and `streakWorkflowV2`. After a rollback, posts scheduled
on the new code and emails queued on it wait in Temporal, and nothing runs them
until you deploy the new code again. They are not lost, only delayed. The longer
the rollback lasts, the more of them wait.

## Making it impossible to miss

Today this ledger is the only record, and nothing stops a deploy when a file is
missing. Two ways to close that gap:

- **Now:** the everyday deploy steps in the cutover doc start with the
  "Is it applied?" check. A reviewer of any PR that adds a file here should make
  sure the PR also adds its "not yet" ledger rows.
- **Next (recommended, separate PR):** adopt Prisma Migrate with a baseline
  after these four files are applied everywhere. Generate `0_init` from the
  then-current schema, mark it applied with `prisma migrate resolve --applied 0_init`
  on each database, and keep later changes as migration folders.
  `prisma migrate status` then lists pending migrations for any database, and the
  deploy can run `prisma migrate deploy`, which only applies pending ones and never
  drops data. Upstream sync steps would generate a migration folder instead of a
  file here. The `_prisma_migrations` table replaces this ledger.
