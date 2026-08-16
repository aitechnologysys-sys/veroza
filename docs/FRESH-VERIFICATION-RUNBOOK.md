# Fresh Verification Runbook — dev + prod, from a clean slate

One-time checklist to prove dev and prod both actually work end-to-end after
the postaryx rename and the P0-2/P1-1/P1-2/P1-3/P3-2b security fixes.
Written as if you're running this for the first time. Sources: `README.md`,
`docs/RUNNING-DEV-AND-PROD.md`, `docs/CI-BUILD-CUTOVER.md`,
`docs/LOCAL-DEVELOPMENT.md`, `docs/1.SECURITY-HARDENING-TODO.md`.

> All credentials below are `${VAR}` references, not literal values — read
> the real ones out of your own gitignored `.env`. This file is committed to
> a public repo; never paste actual secret values into it.

Run every command from the repo root.

---

## 1. Full cleanup — remove every container, network, volume

```bash
# Stop and remove both stacks if running (ignores errors if already down)
docker compose -p postaryx-dev  -f docker-compose.dev.yaml down -v 2>/dev/null
docker compose -p postaryx-prod -f docker-compose.yaml     down -v 2>/dev/null

# Belt-and-suspenders: catch anything orphaned under old/default project names
docker ps -a --format '{{.Names}}' | grep -iE 'postiz|postaryx|temporal' | xargs -r docker rm -f
docker volume ls --format '{{.Name}}' | grep -iE 'postiz|postaryx' | xargs -r docker volume rm
docker network ls --format '{{.Name}}' | grep -iE 'postiz|postaryx' | xargs -r docker network rm

# Verify — all three should print nothing
docker ps -a --format '{{.Names}}' | grep -iE 'postiz|postaryx|temporal'
docker volume ls --format '{{.Name}}' | grep -iE 'postiz|postaryx'
docker network ls --format '{{.Name}}' | grep -iE 'postiz|postaryx'
```

⚠️ `down -v` **deletes all data** (Postgres, Redis, Temporal). That's the
point here (clean slate), but don't run this against a stack with data you
care about outside this exercise.

---

## 2. Bring up the dev stack

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
```

Wait ~30–60s for Temporal's first-boot schema/namespace setup, then confirm
everything is healthy:

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml ps
```

All of `postaryx-postgres`, `postaryx-redis`, `postaryx-pg-admin`,
`postaryx-redisinsight`, `temporal`, `temporal-postgresql`,
`temporal-elasticsearch`, `temporal-ui`, `temporal-admin-tools` should show
`Up` (Postgres/Redis/temporal will show `(healthy)`).

Push the Prisma schema (first run only):

```bash
pnpm install # (if not installed)
pnpm run prisma-db-push
```

---

## 3. Connect DBeaver → dev Postgres

New Connection → **PostgreSQL**:

| Field    | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| Host     | `localhost`                                                           |
| Port     | `5432`                                                                |
| Database | `POSTARYX_DEV_DB_NAME` from `.env` (default `postaryx-db-local`)      |
| Username | `POSTARYX_DEV_DB_USER` from `.env` (default `postaryx-local`)         |
| Password | `POSTARYX_DEV_DB_PASSWORD` from `.env` (default `postaryx-local-pwd`) |

Test Connection → should succeed immediately (no SSH tunnel needed for dev).

---

## 4. Connect Another Redis Desktop Manager → dev Redis

New Connection:

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| Host     | `127.0.0.1`                                            |
| Port     | `6379`                                                 |
| Password | _(leave blank — dev Redis has no auth, intentionally)_ |

---

## 5. Run the app against dev (optional but recommended — the real test)

```bash
pnpm run dev
# → http://localhost:4200 — register/login, schedule a test post
```

```bash
# To check stripe, change the .env BILLING_ENABLED=true,
# re-run pnpm run dev
#and In another terminal, run
ngrok http 3000
```

Ctrl-C when done. This is the actual end-to-end proof, not just "containers
are healthy."

---

## 6. Tear down dev before starting prod

Both stacks publish Postgres on host port `5432` — they **cannot** run at the
same time.

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml down
```

(No `-v` here if you want to keep today's dev data for later — your call.)

---

## 7. Bring up the prod stack (local rehearsal)

```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
```

First boot takes ~30–60s (pulls image if needed, runs `prisma-db-push`
automatically, boots Temporal). Confirm:

```bash
docker compose -p postaryx-prod ps
curl -I http://127.0.0.1:4007          # expect: 307 → location: /auth (not logged in yet — that's correct)
curl -I -L http://127.0.0.1:4007       # follow the redirect: expect 200 OK on the login page
docker exec postaryx printenv NEXT_PUBLIC_VERSION   # sanity check
```

---

## 8. Connect DBeaver → prod Postgres

New Connection (or edit the dev one — same host/port, different everything
else) → **PostgreSQL**:

| Field    | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Host     | `127.0.0.1`                                                 |
| Port     | `5432`                                                      |
| Database | `POSTARYX_DB_NAME` from `.env` (default `postaryx-db-prod`) |
| Username | `POSTARYX_DB_USER` from `.env`                              |
| Password | `POSTARYX_DB_PASSWORD` from `.env`                          |

---

## 9. Connect Another Redis Desktop Manager → prod Redis

`postaryx-redis` now publishes `127.0.0.1:6379`, loopback-only — mirroring
the Postgres pattern from P1-2. New Connection:

| Field    | Value                                 |
| -------- | ------------------------------------- |
| Host     | `127.0.0.1`                           |
| Port     | `6379`                                |
| Password | `POSTARYX_REDIS_PASSWORD` from `.env` |

Verified: `docker port postaryx-redis` shows `6379/tcp -> 127.0.0.1:6379`,
`nc -zv 127.0.0.1 6379` succeeds, and the container's healthcheck (which
itself requires successful auth) reports `healthy` — so `--requirepass` is
still enforced over the new port, not bypassed by it.

CLI alternative, if you'd rather not open a GUI:
```bash
docker exec postaryx-redis redis-cli -a "$POSTARYX_REDIS_PASSWORD" --no-auth-warning info memory
docker exec postaryx-redis redis-cli -a "$POSTARYX_REDIS_PASSWORD" --no-auth-warning keys '*'
```

---

## 10. Open the app and actually use it

```bash
open http://localhost:4007
```

Register/login, schedule a test post a few minutes out — confirms the
Temporal orchestrator works end-to-end inside the real prod container, not
just that containers report healthy.

---

## 11. Final cleanup — back to a clean slate

```bash
docker compose -p postaryx-prod -f docker-compose.yaml down -v
docker ps -a --format '{{.Names}}' | grep -iE 'postiz|postaryx|temporal'   # → nothing
docker volume ls --format '{{.Name}}' | grep -iE 'postiz|postaryx'        # → nothing
docker network ls --format '{{.Name}}' | grep -iE 'postiz|postaryx'       # → nothing
```

If you want dev running again afterward instead of a totally clean machine:

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
```

---

## Reference — every credential this checklist needs, by name

| Var (in `.env`)                                                              | Used for                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POSTARYX_DEV_DB_USER` / `POSTARYX_DEV_DB_PASSWORD` / `POSTARYX_DEV_DB_NAME` | dev Postgres (DBeaver)                                            |
| `POSTARYX_DB_USER` / `POSTARYX_DB_PASSWORD` / `POSTARYX_DB_NAME`             | prod Postgres (DBeaver)                                           |
| `POSTARYX_REDIS_PASSWORD`                                                    | prod Redis (Another Redis Desktop Manager, or CLI)                |
| _(none)_                                                                     | dev Redis (Another Redis Desktop Manager) — intentionally no auth |

See [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P0-2/P1-3
for why these live in `.env` rather than being hardcoded, and
[PROD-DEPLOY-PREREQUISITE.md](./PROD-DEPLOY-PREREQUISITE.md) for the one-time
setup if `.env` doesn't have them yet.
