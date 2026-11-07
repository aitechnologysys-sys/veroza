# Database migrations

Deploying new code does **not** update the database. Apply the SQL files here
yourself, **before** you deploy the code.

---

## Production: what to do

Do this when the code that needs the files is merged to `main` and the "Build image"
action is green.

**1. Get the files on the server**

```bash
ssh ubuntu@<VM_PUBLIC_IP>
cd /opt/postaryx/postaryx-app
git pull
```

**2. Check what is already applied**

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT
  to_regclass('"MetaDeletionRequest"') IS NOT NULL                 AS f1,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Subscription'
            AND column_name = 'provider')                          AS f2,
  to_regclass('"OAuthSelfHostedAuthorization"') IS NOT NULL        AS f3,
  to_regclass('"Post_organizationId_publishDate_idx"') IS NOT NULL AS f4;
SQL
```

`t` means done. `f` means you still need to apply that file (f1 = file 1, and so on).

**3. Back up**

```bash
mkdir -p ~/backups
docker exec postaryx-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ~/backups/postaryx-$(date +%Y%m%d-%H%M).dump
```

**4. Apply every file that showed `f`, one at a time, in order (1 → 4)**

```bash
docker exec -i postaryx-postgres sh -c \
  'psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' \
  < docs/migrations/<FILE>.sql
```

If a file fails, nothing from it is applied. **Stop here and don't deploy.**

**5. Run step 2 again.** All four must now be `t`.

**6. Deploy the new code**

```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d postaryx
docker exec postaryx printenv NEXT_PUBLIC_VERSION   # must be the commit you deployed
```

**7. Smoke test:** log in, open the calendar, and schedule a post on one channel.

**8. Fill in the [ledger](#ledger)** below and commit it.

### If something goes wrong after the deploy

| What you see | What to do |
|---|---|
| Login, calendar or posting broken, or Stripe webhooks failing | Roll back the **app only**, within the hour: `POSTARYX_IMAGE_TAG=<previous sha>` on the `pull` and `up` commands. **Leave the database alone.** |
| One feature broken, but posting and billing work | Don't roll back. Fix forward |
| The database itself is damaged | Restore the backup from step 3 (`pg_restore`). This loses everything written since the backup |

Never undo a SQL file. The old code works fine on the new database.

Roll back quickly or not at all. Posts scheduled on the new code don't publish
while the old code is running; they wait until the new code is back.

---

## Local (your machine): what to do

Don't use these SQL files locally. After pulling:

```bash
pnpm dev:docker        # start Postgres, Redis and Temporal (if not running)
pnpm install
pnpm prisma-db-push    # syncs your local database to schema.prisma
pnpm dev
```

---

## Files, in order

| # | File | Adds |
|---|---|---|
| 1 | `2026-10-14-meta-deletion-request.sql` | Meta data-deletion records (Facebook integration, #25). **Already needed by `main`** |
| 2 | `2026-11-07-upstream-v2.24.0.sql` | Upstream v2.24.0 (billing provider column, agent memory, clipping) |
| 3 | `2026-11-07-upstream-v2.25.1.sql` | Upstream v2.25.1 (channel rename, comment threads) |
| 4 | `2026-11-07-upstream-main-5a131eb0.sql` | Upstream main (user timezone, 5 indexes) |

Files 2–4 come with the upstream sync (`chore/upstream-sync-2026-11-07`). If step 2
shows `f1` as `f` on production today, apply file 1 now; don't wait for the sync.

Every database that runs a deployment (production, staging, any other install)
needs all files, applied once each, in order.

## Ledger

Add a row each time you apply a file to a database.

| Database | File | Applied on | By |
|---|---|---|---|
| production | 1 | unknown, check it (step 2) | |
| production | 2 | not yet | |
| production | 3 | not yet | |
| production | 4 | not yet | |

---

## Background

- **Why plain SQL files:** upstream Postiz syncs the database on every start with
  `prisma db push --accept-data-loss`, which can drop data. We turned that off, so
  schema changes are reviewed SQL. Details: [../database-migrations.md](../database-migrations.md).
- **When adding a new file:** add it to "Files, in order", add a "not yet" ledger row
  per database, and add a check for it to the step 2 query.
- **Planned improvement:** move to Prisma Migrate once these four files are applied
  everywhere. The database then tracks what is applied itself
  (`prisma migrate status`), and this ledger goes away.
