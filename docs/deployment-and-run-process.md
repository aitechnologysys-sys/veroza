# Deployment and run process

The single entry point for running Postaryx locally and deploying it to production.
Written for the November 2026 upstream sync (`chore/upstream-sync-2026-11-07`, 959
upstream commits, three new SQL migrations, new env vars). It still applies after
that release: §2 is the normal deploy procedure, and the
sync-specific steps are marked **[Nov 2026 sync]**.

Where this doc and an older doc disagree, this doc follows what the code and config
files say. §6 lists the older statements that are now wrong.

---

## 0. Quick facts

| Thing | Value |
|---|---|
| Public app URL | `https://app.postaryx.com` (API at `/api`, same origin). Landing `postaryx.com` is on Vercel, not covered here |
| Server | Oracle Cloud Ampere A1 (arm64) Ubuntu VM, `ssh ubuntu@<VM_PUBLIC_IP>` |
| Repo on the server | `/opt/postaryx/postaryx-app` (branch `main`) |
| Compose project name | `postaryx-prod`. **Every** command takes `-p postaryx-prod`. A wrong name doesn't error. It silently targets an empty stack. `docker compose ls` shows the real one |
| Image | `ghcr.io/aitechnologysys-sys/veroza:latest` (main only) and `:<full-git-sha>` (every build, the rollback handle). Built by `.github/workflows/build-containers.yml`. The VM **never builds** |
| Containers | `postaryx` (nginx :5000 + backend :3000 + frontend :4200 + orchestrator :3002, under pm2), `postaryx-postgres`, `postaryx-redis`, `temporal`, `temporal-postgresql`, `temporal-elasticsearch`, `temporal-ui`, `temporal-admin-tools` |
| Request path | browser → host nginx :443 (`/etc/nginx/sites-available/postaryx-app.conf`) → `127.0.0.1:4007` → container nginx :5000 (`var/docker/nginx.conf`) → backend :3000 / frontend :4200 |
| Config files on the VM | `.env.prod`: secrets, injected into the container via `env_file:`. `.env`: Compose `${...}` substitution only (`POSTARYX_DB_*`, `POSTARYX_REDIS_PASSWORD`, `POSTARYX_TEMPORAL_DB_PASSWORD`, `POSTARYX_PUBLIC_URL`, optional `POSTARYX_IMAGE[_TAG]`). Both gitignored, both `chmod 600` |
| `environment:` in `docker-compose.yaml` | Overrides `.env.prod` for `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`, `*_URL`, `IS_GENERAL`, `DISABLE_REGISTRATION`, `STORAGE_PROVIDER`, `UPLOAD_DIRECTORY`. Setting those in `.env.prod` does nothing |
| Schema changes | **Never automatic.** The container start (`pm2-run`) does not touch the schema. Production schema changes are the reviewed SQL files in `docs/migrations/`, applied by hand, **before** the code that needs them |

---

## 1. Run locally (development)

Dependencies run in Docker. The four apps run on your machine with hot reload.

### 1.1 Prerequisites

| Tool | Version | Source |
|---|---|---|
| Node.js | **22.23.4** | `package.json` `engines` and `Dockerfile.dev` (`node:22.23.4-bookworm-slim`). Older docs say `>=22.12 <23`. Any 22.x runs, but use 22.23.4 to match the image. Ignore the `volta` block (`20.17.0`), which is stale |
| pnpm | **10.6.1** | `package.json` `packageManager`. `corepack enable && corepack prepare pnpm@10.6.1 --activate` |
| Docker + Compose | recent | Give Docker 4 GB+ RAM (Elasticsearch) |

Use pnpm only, never npm or yarn.

### 1.2 `.env`

```bash
cp .env.example .env      # only if you don't have one yet
```

The minimum that must be right for `pnpm dev`:

| Var | Local value | Why |
|---|---|---|
| `POSTARYX_DEV_DB_USER`, `POSTARYX_DEV_DB_PASSWORD`, `POSTARYX_DEV_DB_NAME` | defaults in `.env.example` are fine | `docker-compose.dev.yaml` refuses to start without them (`:?`), and `DATABASE_URL` is built from them |
| `POSTARYX_DEV_TEMPORAL_DB_PASSWORD` | default is fine | dev compose refuses to start without it |
| `DATABASE_URL` | leave the `${POSTARYX_DEV_DB_*}` template | expanded by dotenv-expand |
| `REDIS_URL` | `redis://localhost:6379` | dev Redis has no password |
| `JWT_SECRET` | any long random string | auth |
| `FRONTEND_URL` | `http://localhost:4200` | must be exactly the URL in your browser |
| `NEXT_PUBLIC_BACKEND_URL`, `BACKEND_INTERNAL_URL` | `http://localhost:3000` | no nginx in dev |
| `STORAGE_PROVIDER` / `UPLOAD_DIRECTORY` | `local` / `uploads` | relative path resolves against the repo root |
| `IS_GENERAL` | `true` | required |
| `BILLING_ENABLED` | `false`, or `true` only when testing Stripe | see `docs/billing-current-state.md` |

Leave every social, AI or billing key you don't use **blank**. Placeholder text counts as "set".

### 1.3 Start the dependencies

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
docker compose -p postaryx-dev -f docker-compose.dev.yaml ps     # wait ~30–60 s for temporal on first boot
```

This starts Postgres :5432, Redis :6379, Temporal :7233, Temporal UI :8080, pgAdmin :8082 and RedisInsight :5540. All of them listen on `127.0.0.1` only. `pnpm dev:docker` runs the same thing without `-p`. Keep using `-p postaryx-dev` so dev and a local prod rehearsal never share volumes (see `RUNNING-DEV-AND-PROD.md` §2).

### 1.4 Database schema (local)

```bash
pnpm install              # postinstall runs prisma generate
pnpm prisma-db-push       # syncs your local DB to schema.prisma
```

- Locally, **don't** apply the `docs/migrations/*.sql` files. `prisma-db-push` does
  the same job for a disposable DB. The SQL files exist for production, where
  `db push` is banned.
- Run `pnpm prisma-db-push` again after every pull that changes `schema.prisma`.
  Pulling this sync branch is one of those pulls.
- On this branch `prisma-db-push` **no longer passes `--accept-data-loss`**
  (upstream removed it). If a push would drop data, it now stops and asks. For a
  throwaway DB, `pnpm prisma-reset` wipes it and recreates it.

### 1.5 Run the apps

| Command | Runs |
|---|---|
| `pnpm dev` | extension + orchestrator + backend + frontend → http://localhost:4200 |
| `pnpm dev-backend` | backend + frontend only (no scheduled posts, emails or token refresh, because there's no orchestrator) |
| `pnpm dev:backend` / `pnpm dev:frontend` / `pnpm dev:orchestrator` | one app |
| `pnpm dev:stripe` | `stripe listen --forward-to localhost:3000/stripe` + `pnpm dev` |
| `pnpm build` | builds frontend, backend and orchestrator one after another (what the image does) |
| `pnpm eslint .` | lint, from the repo root only |
| `pnpm check:providers` | banned-provider gate (CI runs it before every image build) |

Orchestrator health: http://localhost:3002/health/status. Temporal UI: http://localhost:8080.

### 1.6 Tests

```bash
pnpm test        # jest + coverage; JUnit report in reports/junit.xml
```

Expect **299 passed, 15 skipped, 0 failed** (23 suites + 2 skipped) on this branch.
The two `*.e2e.spec.ts` suites skip themselves unless `META_E2E_*` env vars are set.
If your local `.env` sets `REDIS_URL`, Jest prints "open handles" after the summary and
doesn't exit (a few specs connect to that Redis). The results above it are still valid;
Ctrl-C. CI runs the same command
on every PR (`.github/workflows/test.yml`).

### 1.7 Optional: rehearse the production stack on your laptop

Run the same `docker-compose.yaml` the server uses, against a CI-built image.

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml down     # the stacks collide on ports and container names
# .env must also hold POSTARYX_DB_USER/_PASSWORD/_NAME, POSTARYX_REDIS_PASSWORD, POSTARYX_TEMPORAL_DB_PASSWORD
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
docker compose -p postaryx-prod ps
curl -I http://127.0.0.1:4007                       # 307 → /auth when logged out, then 200 with -L
docker exec postaryx printenv NEXT_PUBLIC_VERSION
```

- To test a branch before it merges, run **Actions → Build image → Run workflow**
  on that branch. Then add `POSTARYX_IMAGE_TAG=branch-<branch with / replaced by ->`
  to both commands, for example
  `POSTARYX_IMAGE_TAG=branch-chore-upstream-sync-2026-11-07`. The image is arm64
  only, which works on Apple Silicon.
- **An empty rehearsal database gets no schema.** The container no longer runs
  `db push`. For a brand-new, empty DB only, create the schema once with
  `docker exec postaryx pnpm run prisma-db-push`, then restart the app with
  `docker compose -p postaryx-prod restart postaryx`. **Never run this against
  the production database.**
- Stop with `docker compose -p postaryx-prod down`. Leave out `-v` unless you mean to wipe the data.

### 1.8 Common local pitfalls

| Symptom | Cause / fix |
|---|---|
| `password authentication failed` / `role ... does not exist` after switching between dev and prod stacks | Both stacks used the same volume. Always pass `-p postaryx-dev` / `-p postaryx-prod` (`RUNNING-DEV-AND-PROD.md` §2–3) |
| `container name already in use`, port 5432/6379/7233/8080 busy | Both stacks are up. `down` one first |
| `relation ... does not exist` | Run `pnpm prisma-db-push` |
| Orchestrator health fails, no jobs run | Temporal not ready yet. First boot takes 30–60 s. `docker compose -p postaryx-dev -f docker-compose.dev.yaml logs temporal` |
| Elasticsearch keeps restarting | Give Docker ≥ 4 GB RAM |
| Frontend calls the wrong API | `NEXT_PUBLIC_BACKEND_URL` must be `http://localhost:3000` in dev |
| `docker compose down` "does nothing" | You left out `-p`, so it targeted the default `postaryx-app` project |
| pgAdmin / RedisInsight can't connect | Use host `postaryx-postgres` / `postaryx-redis`, not `localhost`. They run inside the Docker network |

---

## 2. Deploy to production

Follow these phases in order, with a terminal open. Each step says what success
looks like. **If a step fails, stop.** Don't skip ahead.

The rule behind the order is **schema first**. Old code runs fine on the new
schema, because every migration is additive. New code on the old schema breaks.
So the SQL goes in while the old container is still serving, and the new image
goes live after that.

### Phase A: before merging (day before is fine)

**A1. The PR is green.** `Build`, `Test` (299 passing), `ESLint` and `CodeQL` checks on the PR to `main`.

**A2. Prepare the env changes.** Go through the table in §5 and collect the values
you need. Nothing is required for the app to run. For this release: `TRUSTED_PROXY_HOPS`
(recommended), `DCR_VERIFIED_DOMAINS` only if Claude.ai/ChatGPT connectors should
work, and reCAPTCHA keys only if you want guest comments. Don't edit `.env.prod` yet.
That happens in step C10.

**A3. Optional but recommended: rehearse the image locally** with the branch image (§1.7).

**A4. Pick a low-traffic window.** Nothing scheduled to publish in the next ~30 min if possible (check the calendar).

### Phase B: merge and wait for the image

**B1.** Merge the PR to `main`.

**B2.** Open https://github.com/aitechnologysys-sys/veroza/actions. Wait for the
**Build image** run for the merge commit to go green (10–20 min). Its summary lists
`:latest` and `:<sha>`. Note the full sha:

```bash
NEW_SHA=<full sha of the merge commit on main>
```

> Do not deploy before this is green. Until then `:latest` is still the previous build.

### Phase C: on the server, migrations then rollout

**C1. Connect and confirm you are on the right stack.**

```bash
ssh ubuntu@<VM_PUBLIC_IP>
cd /opt/postaryx/postaryx-app
docker compose ls                                     # expect: postaryx-prod
docker compose -p postaryx-prod ps                    # everything Up / healthy before you start
df -h /                                               # need room for a DB dump + a new ~3 GB image
```

**C2. Record what is running now (your rollback target), and keep a local copy of that image.**

```bash
docker exec postaryx printenv NEXT_PUBLIC_VERSION     # e.g. v1.47.0-1a2b3c4. Write down the short sha
OLD_IMAGE_ID=$(docker inspect postaryx --format '{{.Image}}'); echo "$OLD_IMAGE_ID"
docker tag "$OLD_IMAGE_ID" postaryx-app:rollback-pre-sync

# The image you might roll back to must NOT run `prisma db push` on start
# (that would drop the new tables). Expect no "prisma-db-push" in this line:
docker exec postaryx sh -c 'grep "\"pm2-run\"" /app/package.json'
```

If the `pm2-run` line contains `prisma-db-push`, production runs an image older than
PR #25. **Do not use it as a rollback target.** Tell the owner before continuing.

**C3. Pull the code and check the server copy is clean.**

```bash
git status --short                                    # expect: nothing (local edits to tracked files break git pull)
git branch --show-current                             # expect: main
git pull
git log -1 --format=%H                                # expect: $NEW_SHA
grep -A1 "^  postaryx:" docker-compose.yaml           # expect an image: line and NO build: block
docker pull ghcr.io/aitechnologysys-sys/veroza:$NEW_SHA   # proves the image exists and is pullable
```

`denied` on the pull means the GHCR package is private and this VM has no login. See
`3. (First time important) CI-BUILD-CUTOVER.md` Step 2. `manifest unknown` means the
build hasn't finished, or the sha has a typo.

**C4. Check which migrations are already applied.**

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT
  to_regclass('"MetaDeletionRequest"') IS NOT NULL                       AS f1_meta_deletion,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Subscription' AND column_name = 'provider') AS f2_v2_24_0,
  to_regclass('"OAuthSelfHostedAuthorization"') IS NOT NULL              AS f3_v2_25_1,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'User' AND column_name = 'timezoneName')     AS f4_column,
  to_regclass('"Post_organizationId_publishDate_idx"') IS NOT NULL       AS f4_index;
SQL
```

`t` = applied, `f` = still to do. Expected before this release: `f1` probably `t`
(it is needed by `main` since #25, but the ledger says "unknown"), and `f2`, `f3`,
`f4_*` all `f`.

**C5. Back up the database.**

```bash
mkdir -p ~/backups
DUMP=~/backups/postaryx-$(date +%Y%m%d-%H%M).dump
docker exec postaryx-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DUMP"
ls -lh "$DUMP"                                         # must be clearly non-zero
docker exec -i postaryx-postgres pg_restore --list < "$DUMP" | head -5   # proves the dump is readable
```

Copy it off the box as well, for example `scp` from your laptop or OCI Object Storage.

**C6. Pre-flight data checks [Nov 2026 sync]. Run only if `f2` was `f`.**

File 2 adds a primary key to `mastra_ai_spans` (AI agent trace spans). That fails if the
table is missing, already has a primary key, or has duplicate keys:

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT to_regclass('"mastra_ai_spans"') AS spans_table,
       to_regclass('"mastra_scorers"')  AS scorers_table;
SELECT count(*) AS existing_pk FROM pg_constraint
 WHERE conrelid = to_regclass('"mastra_ai_spans"') AND contype = 'p';
SELECT count(*) AS duplicate_keys FROM (
  SELECT 1 FROM "mastra_ai_spans" GROUP BY "traceId", "spanId" HAVING count(*) > 1) d;
SELECT count(*) AS post_rows, pg_size_pretty(pg_total_relation_size('"Post"')) AS post_size FROM "Post";
SQL
```

| Result | Meaning |
|---|---|
| both tables non-empty names, `existing_pk = 0`, `duplicate_keys = 0` | Good, continue |
| a table is empty/NULL | File 2 will fail on `ALTER TABLE`. Stop and investigate the schema drift |
| `existing_pk = 1` | File 2 will fail ("multiple primary keys"). Stop. The file needs that line removed, as a reviewed change |
| `duplicate_keys > 0` | File 2 will fail. These rows are observability data, not customer content. With the owner's OK, dedupe (keeps one row per key) and re-run the check: `DELETE FROM "mastra_ai_spans" a USING "mastra_ai_spans" b WHERE a.ctid < b.ctid AND a."traceId" = b."traceId" AND a."spanId" = b."spanId";` |

Keep `post_rows` for step C7, file 4.

Optional, about 3 minutes: rehearse the SQL on a throwaway copy, here on the VM.
List only the files that showed `f` in C4.

```bash
docker run -d --name pg-rehearsal -e POSTGRES_USER=rehearsal -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal postgres:17-alpine
until docker exec pg-rehearsal pg_isready -U rehearsal >/dev/null 2>&1; do sleep 1; done; sleep 3
docker exec -i pg-rehearsal pg_restore -U rehearsal -d rehearsal --no-owner --no-acl < "$DUMP"
for f in 2026-11-07-upstream-v2.24.0 2026-11-07-upstream-v2.25.1 2026-11-07-upstream-main-5a131eb0; do
  echo "== $f"
  docker exec -i pg-rehearsal psql -1 -v ON_ERROR_STOP=1 -U rehearsal -d rehearsal -f - < docs/migrations/$f.sql || { echo "FAILED: $f"; break; }
done
docker rm -f pg-rehearsal
```

`pg-rehearsal` publishes no port, and its password is throwaway. Every file has to
finish without `FAILED`.

**C7. Apply the migrations: one at a time, in this order, only those that showed `f`.**

**Do not apply them with a glob** (`*.sql`). Alphabetical order puts
`upstream-main-5a131eb0` before `upstream-v2.24.0`, which is wrong.

Each command runs one file in a single transaction (`-1`) and stops at the first error
(`ON_ERROR_STOP`). If it fails, nothing from that file is applied. **Stop there and
don't deploy.** The old code keeps running fine on whatever was applied before.

```bash
APPLY='psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -'

# 1. Meta data-deletion records (only if f1 = f)
docker exec -i postaryx-postgres sh -c "$APPLY" < docs/migrations/2026-10-14-meta-deletion-request.sql

# 2. Upstream v2.24.0 (billing provider column, agent memory, clipping, Apple login)
docker exec -i postaryx-postgres sh -c "$APPLY" < docs/migrations/2026-11-07-upstream-v2.24.0.sql

# 3. Upstream v2.25.1 (channel rename, comment threads). Needs 2 first
docker exec -i postaryx-postgres sh -c "$APPLY" < docs/migrations/2026-11-07-upstream-v2.25.1.sql

# 4. Upstream main 5a131eb0 (User.timezoneName + 5 indexes). Needs 2 and 3 first
#    See the note below before running this one.
docker exec -i postaryx-postgres sh -c "$APPLY" < docs/migrations/2026-11-07-upstream-main-5a131eb0.sql
```

A successful run prints only lines like `CREATE TYPE`, `ALTER TABLE` and `CREATE INDEX`,
with no `ERROR`.

> **File 4 and `CREATE INDEX CONCURRENTLY`.** A plain `CREATE INDEX` blocks writes
> to the table while it builds. For `Post`, writes include scheduling and the
> orchestrator marking posts published. If `post_rows` from C6 is in the tens of
> thousands, the build takes seconds, so run file 4 as above. If `Post` is large
> (roughly 1M+ rows or several GB), build the two `Post` indexes without blocking
> first, then apply the rest of the file. `CONCURRENTLY` can't run inside a
> transaction, so these commands have no `-1`:
>
> ```bash
> docker exec -i postaryx-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
> CREATE INDEX CONCURRENTLY "Post_publishDate_state_deletedAt_parentPostId_integrationId_idx" ON "Post"("publishDate", "state", "deletedAt", "parentPostId", "integrationId", "organizationId", "creationMethod");
> CREATE INDEX CONCURRENTLY "Post_organizationId_publishDate_idx" ON "Post"("organizationId", "publishDate");
> SQL
> # the rest of file 4, minus those two lines, in one transaction:
> grep -v '^CREATE INDEX "Post_' docs/migrations/2026-11-07-upstream-main-5a131eb0.sql \
>   | docker exec -i postaryx-postgres sh -c "$APPLY"
> ```
>
> A failed `CONCURRENTLY` build leaves an **invalid** index behind. The check in C8
> catches it. Drop it with `DROP INDEX CONCURRENTLY "<name>";` and run the
> statement again.

**C8. Verify the schema.**

Re-run the C4 query. **All five columns must be `t`.** Then confirm no index was left invalid:

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT indexrelid::regclass AS invalid_index FROM pg_index WHERE NOT indisvalid;   -- expect 0 rows
SQL
```

Optional, stronger check: diff the live DB against the new `schema.prisma`. There's
no pnpm on the VM, so this runs Prisma in a one-off container on the stack's network.
Check the network name with `docker network ls | grep postaryx-network`. If the DB
password has URL-special characters (`@ : / ? #`), percent-encode it in the URL.

```bash
set -a; . ./.env; set +a
DBURL="postgresql://${POSTARYX_DB_USER}:${POSTARYX_DB_PASSWORD}@postaryx-postgres:5432/${POSTARYX_DB_NAME:-postaryx-db-prod}"
docker run --rm --network postaryx-prod_postaryx-network -v "$PWD":/repo -w /repo -e DATABASE_URL="$DBURL" \
  node:22.23.4-bookworm-slim npx -y prisma@6.5.0 migrate diff \
  --from-url "$DBURL" \
  --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
unset DBURL
```

| Output | Action |
|---|---|
| `-- This is an empty migration.` | Perfect. Continue |
| Only `DROP ...` lines | The live DB has objects the schema doesn't know about. That drift is older than tonight and harmless to the new code. **Don't apply it.** Note it for follow-up and continue |
| Any `CREATE` / `ADD COLUMN` / `ALTER COLUMN` line | The new code expects something that's missing. **Stop and don't deploy.** Re-check C4 and C7 |

**C9. Pre-deploy data check: Polar subscriptions [Nov 2026 sync].**

File 2 gave every existing `Subscription` row `provider = 'stripe'`. A subscription
managed by Polar must say `'polar'`, or billing actions route to Stripe. Stripe
customer ids start with `cus_`. Polar's don't.

```bash
docker exec -i postaryx-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
-- 1. Find them (expected: 0 rows. Polar is parked)
SELECT s.id, s."organizationId", o.name, o."paymentId", s.provider, s.status, s."deletedAt"
FROM "Subscription" s
JOIN "Organization" o ON o.id = s."organizationId"
WHERE o."paymentId" IS NOT NULL
  AND left(o."paymentId", 4) <> 'cus_';
SQL
```

If it returns rows, relabel them. Check the `UPDATE` count matches the row count above before `COMMIT`:

```bash
docker exec -i postaryx-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
UPDATE "Subscription" s
   SET provider = 'polar'
  FROM "Organization" o
 WHERE o.id = s."organizationId"
   AND o."paymentId" IS NOT NULL
   AND left(o."paymentId", 4) <> 'cus_'
   AND s.provider = 'stripe';
SELECT provider, count(*) FROM "Subscription" GROUP BY provider;
COMMIT;   -- or ROLLBACK; if the numbers are not what you expected
SQL
```

Rows with a `NULL` `paymentId` (lifetime or admin-granted plans) stay `'stripe'`, which is the default web provider.

**C10. Update `.env.prod` [Nov 2026 sync].**

```bash
cp .env.prod ~/backups/env.prod.$(date +%Y%m%d-%H%M)     # keep the old one for rollback
chmod 600 ~/backups/env.prod.*
nano .env.prod
```

Make it match §5: **add** `TRUSTED_PROXY_HOPS` (and `DCR_VERIFIED_DOMAINS` if you want the connectors), **confirm**
`BILLING_ENABLED="true"`, and **make sure the "keep unset" vars are absent**. Then verify
without printing secrets:

```bash
grep -E '^(BILLING_ENABLED|BILLING_PROVIDER|DCR_VERIFIED_DOMAINS|TRUSTED_PROXY_HOPS|EMAIL_PROVIDER)=' .env.prod
grep -cE '^RECAPTCHA_(SITE|SECRET)_KEY=.+' .env.prod      # 2 if guest comments wanted, 0 otherwise. 1 is a mistake
grep -E '^(CHATBASE_TOKEN|CANVA_APP_ORIGIN|MCP_SELF_HOSTED_RELAY|DISABLE_SSRF_PROTECTION|MCP_ONLY|NOT_SECURED|RUNPOD_API_URL)=' .env.prod   # expect NO output
grep -E '^POSTARYX_PUBLIC_URL=' .env                      # expect https://app.postaryx.com (no trailing slash)
```

Confirm the `TRUSTED_PROXY_HOPS` topology still holds (see §5 for why the value is 2):

```bash
dig +short app.postaryx.com                    # exactly the VM's IP. 104.21.x / 172.67.x means Cloudflare proxies it → use 3
sudo nginx -T 2>/dev/null | grep -nE 'X-Forwarded-For|real_ip'   # one "$proxy_add_x_forwarded_for" line for app.postaryx.com, no real_ip_* lines
```

**C11. Roll out the new image.**

```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d postaryx
docker compose -p postaryx-prod logs -f postaryx       # Ctrl-C once pm2 shows backend, frontend, orchestrator online
docker exec postaryx printenv NEXT_PUBLIC_VERSION      # must end in the first 7 chars of $NEW_SHA
```

Only the `postaryx` container restarts. Postgres, Redis and Temporal keep running.
The healthcheck allows 90 s of start-up. The orchestrator sits at 100% CPU for
2–3 min while it bundles workflows, which is normal.

### Phase D: post-deploy verification

**D1. Containers and processes (on the VM).** This is the health block from `README.md` §7:

```bash
docker compose -p postaryx-prod ps                      # all Up; postaryx, postgres, redis, temporal "(healthy)"
docker exec postaryx pm2 ls                             # backend, frontend, orchestrator all online, restart count not climbing
docker exec postaryx node -e '
const checks = [["backend","http://localhost:3000/monitor/queue/check"],["frontend","http://localhost:4200/"],["orchestrator","http://localhost:3002/health/status"]];
(async () => { for (const [n,u] of checks) { try { const r = await fetch(u,{signal:AbortSignal.timeout(15000)}); console.log(n.padEnd(13), r.status); } catch { console.log(n.padEnd(13),"DOWN"); } } })()'
docker exec temporal-admin-tools temporal task-queue describe --task-queue main --address temporal:7233   # at least one poller, last access < 1 min (wait ~5 min after start)
docker compose -p postaryx-prod logs --since 15m postaryx 2>&1 | grep -iE 'error|missing environment variable|ECONNREFUSED|P[0-9]{4}' | head -40
```

`P2022` / `P2021` lines (Prisma "column/table does not exist") mean a migration is
missing. Re-check C4. `Missing environment variable: X` is printed by the email
provider at boot, so check that `EMAIL_PROVIDER` and its keys are set.

**D2. From your laptop.**

```bash
curl -sI https://app.postaryx.com | head -1                                       # 200 or 307 (→ /auth)
curl -s -o /dev/null -w '%{http_code}\n' https://app.postaryx.com/api/            # any status except 502 / hang
curl -sI https://app.postaryx.com | grep -i x-robots-tag                          # noindex, nofollow
# MCP dynamic client registration must refuse an unlisted web redirect (expect a 4xx, nothing created):
curl -s -w '\n%{http_code}\n' -X POST https://app.postaryx.com/api/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"deploy-check","redirect_uris":["https://example.org/callback"]}'
```

**D3. In the browser (the part curl can't prove).**

- [ ] Log in at https://app.postaryx.com. The `auth` cookie domain is `.postaryx.com`.
- [ ] **Save something** (create a draft post, or change a setting). If every save fails
  with `403 Cross-site request blocked`, the new CSRF check (§5.4) doesn't recognise the
  browser's origin: `POSTARYX_PUBLIC_URL` in `.env` must be exactly
  `https://app.postaryx.com` (scheme + host, no path). Roll back the app if it can't be
  fixed in minutes.
- [ ] Calendar loads. Settings shows the new tabs (Integrations, Plugs, Apps). Existing channels are listed and none suddenly need a reconnect.
- [ ] Upload an image in the composer. It renders from `/uploads/...`.
- [ ] **Schedule a test post on one channel a few minutes out and confirm it publishes.** This is the only proof that Temporal and the orchestrator work. New posts start on `postWorkflowV112`.
- [ ] Billing page loads with the plan cards. No "every feature unlocked" behaviour, which would mean `BILLING_ENABLED` isn't `"true"`.
- [ ] Stripe Dashboard → Developers → Webhooks → our endpoint (`.../api/stripe`): deliveries after the deploy return 2xx. Send a test event if nothing arrived naturally.
- [ ] Open a post preview link in a private window and try to comment as a guest. Without reCAPTCHA keys the expected reply is "Sign in to comment on this post". With keys, the captcha runs.

**D4. Record it.** Fill in the ledger in `docs/migrations/README.md` (database, file,
date, who) and commit that on `main` from your laptop, not from the VM. Also update
the ledger in §4 below.

**D5. Clean up** after a day of normal running: `docker image prune -f`. That removes
untagged layers only, so `postaryx-app:rollback-pre-sync` stays until you
`docker rmi` it.

---

## 3. Rollback

### When to roll back

| What you see | Action |
|---|---|
| Login, calendar or posting broken, or Stripe webhooks failing | Roll back **the app only**, within the hour (steps below). **Leave the database alone** |
| One feature broken, posting and billing work | Don't roll back. Fix forward |
| The database itself is damaged (failed partial manual change, corrupted data) | Restore the backup (last section below). This loses everything written since C5 |

Roll back quickly or not at all. Posts scheduled by the new code start on
`postWorkflowV112`, which the old worker doesn't know. They don't publish while the
old code runs, and they resume when the new code is back.

### Roll back the app (normal path)

```bash
cd /opt/postaryx/postaryx-app
# Preferred: the exact image that was running before (tagged in C2), no download needed
POSTARYX_IMAGE=postaryx-app POSTARYX_IMAGE_TAG=rollback-pre-sync docker compose -p postaryx-prod up -d postaryx

# Alternative: any earlier main build from GHCR. Set the variable on BOTH commands
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod pull postaryx
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod up -d postaryx

docker exec postaryx printenv NEXT_PUBLIC_VERSION      # confirm you are on the old build
```

- **Never roll back to an image whose `pm2-run` runs `prisma-db-push`** (anything
  before PR #25, see C2). It would sync the schema back on start and drop the new
  tables and columns, including the `MetaDeletionRequest` audit records we must keep.
- `.env.prod` can stay as it is. The old code ignores the new variables. Restore the
  C10 copy only if a changed **existing** value is the problem.
- The `docker-compose.yaml` on the server didn't change in this release, so no `git` rollback is needed.
- To return to normal later, drop the variables: `docker compose -p postaryx-prod pull postaryx && docker compose -p postaryx-prod up -d postaryx`.
- GHCR keeps the 20 newest images. If you park on an old sha for a long time, add it to `ignore-versions` in `.github/workflows/build-containers.yml`.

### What is safe to leave in the database after a code rollback

**Everything. Never "undo" a migration file.** All four files only add tables,
columns, indexes, an enum value, or relax a `NOT NULL`. The old code doesn't read
what it doesn't know about, and every new `NOT NULL` column has a default, so old
inserts still work.

| Left behind | Effect on old code |
|---|---|
| New tables (`mastra_*`, `Clipping*`, `OAuthSelfHostedAuthorization`, `MetaDeletionRequest`) | Ignored |
| New nullable / defaulted columns (`Subscription.provider`, `Media.status`, `Post.batchId`, `User.timezoneName`, `Integration.customName`, comment threading, ...) | Ignored. Defaults fill old inserts |
| `OAuthApp.organizationId`/`clientSecret` and `Comments.userId` now nullable, FKs `ON DELETE SET NULL` | Harmless. Rows written by the new code with NULLs (dynamically registered MCP clients, guest comments) may not display correctly in the old UI. No crash expected on the core paths |
| `Provider` enum value `APPLE` | Only present if someone signed in with Apple. Old code never writes it |
| New indexes | Only faster queries |

Dropping any of it needs a reviewed `DROP` of its own, and only if the data is genuinely disposable.

### Restore the database (last resort)

```bash
cd /opt/postaryx/postaryx-app
docker compose -p postaryx-prod stop postaryx                     # nothing may write while restoring
docker exec postaryx-postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i postaryx-postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < ~/backups/postaryx-YYYYMMDD-HHMM.dump
# The DB now has the pre-migration schema. Start the OLD image, not the new one:
POSTARYX_IMAGE=postaryx-app POSTARYX_IMAGE_TAG=rollback-pre-sync docker compose -p postaryx-prod up -d postaryx
```

Then mark files 2–4 as "not yet" again in the ledger.

---

## 4. Migration ledger

Production schema changes live in `docs/migrations/` as reviewed SQL (generated with
`prisma@6.5.0 migrate diff`). Apply them in the **order column**, never by filename sort.

| Order | File | Generated | What it adds | Purely additive? | Production status |
|---|---|---|---|---|---|
| 1 | `2026-10-14-meta-deletion-request.sql` | 2026-10-14 | `MetaDeletionRequest` table + 3 enums + 3 indexes (Meta deauthorize / data-deletion callbacks, PR #25). Already needed by `main` | **Yes** | **Unknown.** Check with C4 |
| 2 | `2026-11-07-upstream-v2.24.0.sql` | 2026-11-07 | Upstream v2.24.0: 39 tables (mostly `mastra_*` agent memory, `Clipping`/`ClippingClip`), 57 indexes, `Subscription.provider` (`NOT NULL DEFAULT 'stripe'`), `Media.status`/`processingError`, `deletedAt` on User/Organization, OAuth DCR columns, enum `Provider` + `APPLE`, PK on `mastra_ai_spans` | **No, but no data loss:** `OAuthApp.organizationId`/`clientSecret` become nullable, the `OAuthApp → Organization` FK is re-created `ON DELETE SET NULL`, and a primary key is added to the existing `mastra_ai_spans` (fails on duplicate keys, see C6) | **Pending** (not applied anywhere) |
| 3 | `2026-11-07-upstream-v2.25.1.sql` | 2026-11-07 | Upstream v2.25.1: `Integration.customName`, `Post.batchId`, comment threading/anchoring columns, `OAuthSelfHostedAuthorization` table, 5 indexes | **No, but no data loss:** `Comments.userId` becomes nullable and its FK is re-created `ON DELETE SET NULL` (was RESTRICT) | **Pending** |
| 4 | `2026-11-07-upstream-main-5a131eb0.sql` | 2026-11-07 | Upstream main at `5a131eb0`: `User.timezoneName` (nullable) + 5 indexes (2 on `Post`) | **Yes.** Index builds lock writes. Consider `CONCURRENTLY` for the 2 `Post` indexes (C7) | **Pending** |

Dependencies: 3 needs 2, and 4 needs 2 and 3. File 1 is independent but goes first.
Every database that runs this code (production, staging, any other install) needs
all four, each applied once. The authoritative per-database ledger, with who and when,
is in [migrations/README.md](./migrations/README.md#ledger). Update both after applying.

---

## 5. Env vars added or changed by the Nov 2026 upstream sync

Sources: `git diff origin/main...HEAD -- .env.example`, the step notes in
`UPSTREAM-SYNC-LOG.md`, a diff of every `process.env.X` the code reads on `main` vs
this branch, and the security-fix pass on the branch. Set them in **`.env.prod`**,
then recreate the container (C11). No rebuild is needed.

**Nothing in this section is needed for the app to start or for existing features to
keep working.** Most new lines in `.env.example` are placeholders for features we
don't use (§5.2–5.3: leave them out). Two values are **recommended** (§5.1), and
`BILLING_ENABLED` is worth confirming.

### 5.1 Recommended, set before the new code goes live

| Var | Prod value | What it does / what happens if it's unset |
|---|---|---|
| `DCR_VERIFIED_DOMAINS` | `claude.ai,claude.com,chatgpt.com,openai.com` | MCP OAuth dynamic client registration (`POST /api/oauth/register`) accepts `https` redirect URIs only on these domains and their subdomains. **Unset is the safe default:** every web (https) redirect URI is refused, so the Claude.ai and ChatGPT connectors can't connect, and nothing else is affected. Set it only if people should be able to connect Postaryx to Claude.ai / ChatGPT. Loopback (`http://localhost:...`) and native-app schemes (`cursor://...`) are always allowed. Add `cursor.com` if Cursor's web flow is needed |
| `TRUSTED_PROXY_HOPS` | **`2`** | How many reverse proxies in front of the backend append to `X-Forwarded-For`. The backend takes the client IP from that many entries from the right, so a client can't spoof it by sending its own header. The per-IP rate limits use it: OAuth client registration (20/h), Farcaster sign-in (30/h) and guest comments. Public API posting is limited per workspace and doesn't use it. Unset defaults to `1`, the rightmost entry. That is spoof-proof here, but it's the Docker gateway address, so everyone shares one bucket for those limits (e.g. 30 Farcaster sign-ins per hour in total). Our chain, verified in the docs: host nginx appends the client IP (`7. MULTI-DOMAIN-DEPLOYMENT-WALKTHROUGH.md` line 279, `2. ORACLE-CLOUD-SETUP-WALKTHROUGH.md` line 457), the container nginx appends the host nginx's address (`var/docker/nginx.conf` lines 25 and 58), then the backend. Cloudflare is **DNS only** (grey cloud) for `app` (walkthrough §4.3, lines 151 and 169–184), so it adds nothing. **If `app` is ever switched to Cloudflare-proxied (orange), change this to `3`.** C10 has the check |
| `BILLING_ENABLED` | `"true"` (literal) | Not new, but **confirm it.** Anything other than `"true"` turns on free self-hosted mode: every org is ULTIMATE, permission checks pass, and every member effectively gets admin permissions |
| `BILLING_PROVIDER` | `stripe` | Not new. Picks the gateway for **new** checkouts only. Existing subscriptions use `Subscription.provider` (see C9) |

### 5.2 Required only if you want the feature

| Var | Prod value | Notes |
|---|---|---|
| `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` | both set, or both unset | reCAPTCHA v2 invisible keys for **guest comments on public preview links**. The Postaryx change fails closed: unless the secret is set, guest comments are **rejected** ("Sign in to comment on this post"). Signed-in members can still comment. Setting only one of the two is a misconfiguration |
| `TUMBLR_CLIENT_ID` / `TUMBLR_CLIENT_SECRET` | if we offer Tumblr | New Tumblr channel (decided: add it). Redirect `${FRONTEND_URL}/integrations/social/tumblr` |
| `TIKTOK_BUSINESS_CLIENT_ID` / `TIKTOK_BUSINESS_CLIENT_SECRET` | if we offer TikTok Business | New `tiktok-business` provider |
| `HIDDEN_PROVIDERS` | e.g. `tiktok` | Comma-separated providers hidden from the add-channel screen |
| `MIGRATE_PROVIDERS` | e.g. `tiktok:tiktok-business` | Reconnecting `old` goes through `new` and migrates the channel in place |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | if we offer Sign in with Apple | The button only shows when `APPLE_CLIENT_ID` is set. The code reads exactly these four (plus `APPLE_APP_BUNDLE_ID` for iOS, which we don't have). `.env.example` also lists `APPLE_BUNDLE_ID` and `APPLE_SERVICE_ID`, which **the code doesn't read**, and repeats the Apple block twice |
| `EMAIL_PROVIDER` = `ses` + `SES_REGION`, `SES_ACCESS_KEY`, `SES_SECRET_ACCESS_KEY` | only if moving email to Amazon SES | New SES provider. `EMAIL_PROVIDER` itself is **not new**: it must already be `resend` or `nodemailer` for email (and account activation) to work. `RESEND_API_KEY` alone doesn't enable email |
| `OPENAI_OAUTH_CLIENT_ID` | only if we publish our own ChatGPT app | The one OAuth client allowed to receive verified email claims for ChatGPT Enterprise |
| `EVOLINK_API_KEY` | optional | Seedance AI video generation |

### 5.3 Leave unset in production

| Var | Why |
|---|---|
| `CHATBASE_TOKEN` | Loads **Postiz's own** Chatbase support bot in our UI and sends it customer billing ids |
| `CANVA_APP_ORIGIN` | Adds a Canva app origin to backend CORS. We have no Canva app |
| `MCP_SELF_HOSTED_RELAY` | Postiz Cloud's relay for MCP calls to self-hosted instances. Shows Postiz-branded UI |
| `DISABLE_SSRF_PROTECTION` | Turns off the private-IP block on server-side fetches (WordPress, Mastodon, Bluesky PDS, webhooks...) |
| `MCP_ONLY` | Not in `.env.example`. If set, the backend serves **only** the OAuth/MCP controllers, so the whole API disappears |
| `EXCLUDE_QUEUE`, `WORKER_CONCURRENCY_DIVIDER` | Not in `.env.example`. Multi-server orchestrator tuning. We run one worker |
| `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `IN_APP_PURCHASE_REJECT_SANDBOX`, `APPLE_APP_BUNDLE_ID` | Upstream's mobile app billing / native sign-in. We have no mobile app |
| `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_APP_CLIENT_ID`, `HUBSPOT_APP_CLIENT_SECRET` | Postiz's HubSpot app integration |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `RUNPOD_INGEST_ENDPOINT_ID`, `RUNPOD_CLIPPER_ENDPOINT_ID`, `DEEPGRAM_API_KEY` | Media normalisation and video clipping. Requires `STORAGE_PROVIDER=cloudflare`, and we run `local` |
| `RUNPOD_API_URL` | Local development only, per `.env.example` |
| `NOT_SECURED` | Not new. Dev-only. It downgrades auth cookies |

Removed by the sync (safe to delete from `.env.prod` if present): `NEXT_PUBLIC_POSTHOG_KEY`,
`NEXT_PUBLIC_POSTHOG_HOST` (upstream removed PostHog), `AGENT_MEDIA_SSO_KEY`, `KIEAI_API_KEY`.

### 5.4 Behaviour changes from the security fixes (no env needed)

Made on the sync branch after the pre-merge security review (Nov 2026). They need no
configuration beyond §5.1, but they change what users and integrations see:

| Change | What to expect | If something breaks |
|---|---|---|
| **CSRF check** (`apps/backend/src/services/auth/csrf.origin.check.ts`) | A POST/PUT/PATCH/DELETE authenticated by the `auth` cookie is refused (`403 Cross-site request blocked`) unless its `Origin` is `FRONTEND_URL`, `MAIN_URL` or `CANVA_APP_ORIGIN`. Webhooks, the public API (API key), MCP, widgets and server-side calls are unaffected | Every save in the app failing = the browser origin doesn't match `FRONTEND_URL`. See D3 |
| **No framing** (`apps/frontend/next.config.js`) | Every app page sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` | Nothing embeds the app today. If something must, it needs its own exception |
| **OAuth/MCP app approval is admin-only** | Only ADMIN members can approve "connect this app to your workspace". Others get "Only workspace admins can connect apps" | Ask a workspace admin to connect it |
| **Dynamic client registration** | Rate-limited to 20 registrations per IP per hour, and web redirects only on `DCR_VERIFIED_DOMAINS` | — |
| **Impersonation** lasts 8 hours (was 365 days) | Super-admins get dropped back to their own account after a working day | Impersonate again |
| **SSRF protection** also blocks raw private IPs and redirects to them | A channel or webhook pointing at `http://10.x…`, `127.0.0.1`, `169.254.169.254` etc. now fails. Public hosts are unaffected | Expected. Don't set `DISABLE_SSRF_PROTECTION` |
| **Guest comments** need reCAPTCHA | See §5.2. Rate limits now key on the real client IP (`TRUSTED_PROXY_HOPS`) | — |
| **`.github/workflows/staging-conflicts.yml` removed** | Upstream's own merge bot. Nothing to do | — |

---

## 6. Where the detailed docs are

| Doc | Use it for | Status |
|---|---|---|
| [migrations/README.md](./migrations/README.md) | Applying SQL in prod, the per-database ledger | **Authoritative** for migrations. Its step-2 check doesn't cover `User.timezoneName` (C4 here does) |
| [database-migrations.md](./database-migrations.md) | Why `db push` is gone, how to write a new migration file | Authoritative. Its claim that `prisma-db-push` runs `--accept-data-loss` is out of date on this branch (the flag was removed) |
| [UPSTREAM-SYNC-LOG.md](./UPSTREAM-SYNC-LOG.md), [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md) | What the Nov 2026 sync changed and why | Current |
| [`../README.md`](../README.md) §1–5, §7 | Day-to-day commands, config sources, the prod health check | Current |
| [3. (First time important) CI-BUILD-CUTOVER.md](<./3. (First time important) CI-BUILD-CUTOVER.md>) | One-time switch to CI-built images, GHCR visibility, troubleshooting pulls | Current. Its "Quick reference" already says schema first |
| [7. MULTI-DOMAIN-DEPLOYMENT-WALKTHROUGH.md](<./7. MULTI-DOMAIN-DEPLOYMENT-WALKTHROUGH.md>) | DNS (Cloudflare grey cloud), host nginx vhost, TLS, end-to-end checks for `app.postaryx.com` | **Authoritative** for the host nginx/domain setup. Supersedes `ORACLE-VM-DEPLOYMENT.md` §7 (`postaryx.conf`, `postaryx.example.com`) |
| [2. ORACLE-CLOUD-SETUP-WALKTHROUGH.md](<./2. ORACLE-CLOUD-SETUP-WALKTHROUGH.md>) | Creating the VM, Docker, first bring-up | Current |
| [ORACLE-VM-DEPLOYMENT.md](./ORACLE-VM-DEPLOYMENT.md) | Firewall layers, backups cron, logging, monitoring | Partly outdated (below) |
| [4. CONTAINMENT-DEPLOYMENT-PLAN.md](<./4. CONTAINMENT-DEPLOYMENT-PLAN.md>) | Fitting the stack in 12 GB, why CI builds, storage flip | Background |
| [5. PROD-DEPLOY-PREREQUISITE.md](<./5. PROD-DEPLOY-PREREQUISITE.md>) | `.env` vs `.env.prod` | Partly outdated (below) |
| [6. FRESH-VERIFICATION-RUNBOOK.md](<./6. FRESH-VERIFICATION-RUNBOOK.md>) | Clean-slate dev + local prod verification | Current |
| [LOCAL-DEVELOPMENT.md](./LOCAL-DEVELOPMENT.md), [RUNNING-DEV-AND-PROD.md](./RUNNING-DEV-AND-PROD.md) | Dev ports, GUI tools, dev ↔ prod switching | Current |
| [INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md) | What each container is | Outdated on email and compose URLs (below) |
| [billing-current-state.md](./billing-current-state.md) | Stripe/Polar wiring, webhook setup | Current |

### Statements in older docs that are now wrong (don't follow them)

1. **"Prod self-migrates on boot / `up -d` runs `prisma-db-push`".** False since PR #25: `pm2-run` only starts the processes (`package.json`). **Fixed on 12 Nov 2026** in all 14 places (INFRASTRUCTURE, ORACLE-VM, docs 2, 5, 6 and 7, RUNNING-DEV-AND-PROD, LOCAL-DEVELOPMENT, README). If you find the claim anywhere else, it is wrong. A brand-new, empty prod DB needs a one-time `docker exec postaryx pnpm run prisma-db-push` (§1.7); an existing one gets the SQL files.
2. **Node version.** `CLAUDE.md` and `LOCAL-DEVELOPMENT.md` say `>=22.12.0 <23.0.0`, `package.json` `volta` says `20.17.0`, and CI (`build.yml`, `test.yml`) uses `22.12.0`. On this branch `engines` and `Dockerfile.dev` pin **22.23.4**, which is authoritative because it's what production runs. pnpm only warns on the mismatch.
3. **"Update `MAIN_URL`/`FRONTEND_URL`/`NEXT_PUBLIC_BACKEND_URL` in `docker-compose.yaml` before going live"** (`5. PROD-DEPLOY-PREREQUISITE.md`, `INFRASTRUCTURE-AND-DEPLOYMENT.md` §8). Superseded. Set `POSTARYX_PUBLIC_URL` in `.env` (compose file comments, `7. MULTI-DOMAIN...` §6).
4. **"`RESEND_API_KEY` set ⇒ email on and activation required"** (`INFRASTRUCTURE-AND-DEPLOYMENT.md` §8, old `.env.example`). The switch is `EMAIL_PROVIDER` (`email.service.ts`).
5. **Restart policy.** `ORACLE-VM-DEPLOYMENT.md` §10 says everything is `unless-stopped`. In `docker-compose.yaml`, `postaryx`, `postaryx-postgres` and `postaryx-redis` are `restart: always`, and the Temporal services are `unless-stopped`.
6. **Host vhost name.** `ORACLE-VM-DEPLOYMENT.md` uses `/etc/nginx/sites-available/postaryx.conf` for `postaryx.example.com`. The walkthrough for the real domain uses `postaryx-app.conf` for `app.postaryx.com`. Check with `ls -l /etc/nginx/sites-enabled/`.
7. **Migration procedure.** The SQL file headers say "`pnpm migrate:diff` then `pnpm migrate:apply`". That needs pnpm and `DATABASE_URL` on the host, which the VM doesn't have. Use the `docker exec ... psql -1` procedure in `migrations/README.md` / C7 here. `database-migrations.md` also points to a "Rollback criteria" heading in `migrations/README.md`. That section is called "If something goes wrong after the deploy".
8. **"Unset `DCR_VERIFIED_DOMAINS` = any client can self-register"** (the comment in `.env.example` on `main`/upstream) is upstream's behaviour. Postaryx refuses web redirects when it's unset (see §5.1).
9. **Broken relative links.** Several docs link `CI-BUILD-CUTOVER.md`, `CONTAINMENT-DEPLOYMENT-PLAN.md` and `PROD-DEPLOY-PREREQUISITE.md` without their number prefixes. `UPSTREAM-SYNC-LOG.md`'s summary says "follow `docs/CI-BUILD-CUTOVER.md`". The real file is `3. (First time important) CI-BUILD-CUTOVER.md`, and its one-time cutover steps are only needed if the cutover hasn't been done.
