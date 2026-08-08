# Postiz — Local Development Guide

How to run Postiz on your machine for development: **infra dependencies in Docker,
the app processes on your host** (so you get hot-reload, breakpoints, and fast
rebuilds). This is different from production — see
[INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md) for the
build-from-source, all-in-Docker prod setup.

---

## The model

```
  Docker (deps only)                         Host (pnpm run dev)
  ────────────────────                       ───────────────────────────
  postiz-postgres   :5432  ◀───────────────  backend       :3000  (NestJS)
  postiz-redis      :6379  ◀───────────────  frontend      :4200  (Next.js)
  temporal          :7233  ◀───────────────  orchestrator  :3002  (Temporal worker)
  + temporal deps (es, pg, ui, admin)        extension            (browser ext build)
  + pgAdmin :8082, RedisInsight :5540
```

- [docker-compose.dev.yaml](../docker-compose.dev.yaml) runs **only the
  dependencies** (Postgres, Redis, the Temporal stack) **plus dev GUIs**
  (pgAdmin, RedisInsight). It does **not** run the app — you do, via `pnpm dev`.
- The app reads config from the repo-root **`.env`** (each app's scripts use
  `dotenv -e ../../.env`). The `.env` already points at `localhost`, which is
  correct here because the deps' ports are published to your host.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `>=22.12.0 <23.0.0` | Match `engines` in [package.json](../package.json). |
| pnpm | `10.6.1` | `corepack enable && corepack prepare pnpm@10.6.1 --activate` |
| Docker + Compose | recent | Docker Desktop is fine. Give it ~4 GB+ RAM (Elasticsearch). |

---

## First-time setup

### 1. Create your `.env`
If you don't already have one, copy the example and fill it in:
```bash
cp .env.example .env
```
The minimum that must be correct for local dev (the repo `.env` already has these):
```bash
DATABASE_URL="postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-db-local"
REDIS_URL="redis://localhost:6379"
TEMPORAL_ADDRESS="localhost:7233"
JWT_SECRET="any-long-random-string"
FRONTEND_URL="http://localhost:4200"
NEXT_PUBLIC_BACKEND_URL="http://localhost:3000"
BACKEND_INTERNAL_URL="http://localhost:3000"
STORAGE_PROVIDER="local"
UPLOAD_DIRECTORY="/absolute/path/to/postiz-app/uploads"
IS_GENERAL="true"
```
> ⚠️ The DB credentials in `.env` (`postiz-local` / `postiz-local-pwd` /
> `postiz-db-local`) **must match** the `POSTGRES_*` values in
> [docker-compose.dev.yaml](../docker-compose.dev.yaml). They already do — don't
> change one without the other.
>
> Social/AI/billing keys are optional — leave a key blank to disable that
> feature rather than leaving placeholder text in it.

### 2. Install dependencies
```bash
pnpm install
```
`postinstall` automatically runs `prisma generate`, so the Prisma client is ready.

### 3. Start the infra dependencies (Terminal 1)
```bash
docker compose -f docker-compose.dev.yaml up
# or detached, to free the terminal:
docker compose -f docker-compose.dev.yaml up -d
```
Wait until Temporal is healthy (the `temporalio/auto-setup` image creates the
`default` namespace and DB schema on first boot — give it ~30–60s the first time).

### 4. Create the database schema (first run, and after schema changes)
`pnpm dev` does **not** migrate the DB (unlike prod). Push the Prisma schema once
the Postgres container is up:
```bash
pnpm run prisma-db-push
```

### 5. Run the app (Terminal 2)
```bash
pnpm run dev
```
This runs **extension + orchestrator + backend + frontend** in parallel with
hot-reload. When it's up, open **http://localhost:4200**.

> Faster inner loop: if you don't need the orchestrator/extension, run
> `pnpm run dev-backend` (backend + frontend only). Note background jobs
> (scheduled publishing, emails, token refresh) won't run without the orchestrator.

---

## Daily workflow (after first-time setup)

```bash
# Terminal 1 — dependencies
docker compose -f docker-compose.dev.yaml up -d

# Terminal 2 — app
pnpm run dev
```
Stop the app with Ctrl-C. Stop deps with `docker compose -f docker-compose.dev.yaml down`
(add `-v` to also wipe DB/Redis/Temporal data — see below).

---

## Ports & dev tools

| URL | What |
|---|---|
| http://localhost:4200 | **Frontend** (the app you use) |
| http://localhost:3000 | **Backend** API (NestJS) |
| http://localhost:3002/health/status | **Orchestrator** health check |
| http://localhost:8080 | **Temporal UI** — inspect/debug workflow runs |
| http://localhost:8082 | **pgAdmin** — DB GUI (login `admin@admin.com` / `admin`) |
| http://localhost:5540 | **RedisInsight** — Redis GUI |
| localhost:5432 | Postgres (for `psql` / external clients) |
| localhost:6379 | Redis |
| localhost:7233 | Temporal gRPC (the app connects here) |

---

## Common tasks

```bash
# Apply schema changes to the local DB
pnpm run prisma-db-push

# Regenerate the Prisma client (after editing schema.prisma)
pnpm run prisma-generate

# Wipe and recreate the schema from scratch (DESTRUCTIVE)
pnpm run prisma-reset

# Lint (run from repo root only)
pnpm eslint .

# Tests
pnpm test
```

Run a single app instead of all four:
```bash
pnpm run dev:backend        # backend only
pnpm run dev:frontend       # frontend only
pnpm run dev:orchestrator   # orchestrator only
```

---

## Resetting / cleaning up

```bash
# Stop deps, keep data
docker compose -f docker-compose.dev.yaml down

# Stop deps AND delete all volumes (Postgres, Redis, Temporal pg + es)
docker compose -f docker-compose.dev.yaml down -v
```
> Temporal's Postgres and Elasticsearch now use **named volumes**
> (`temporal-postgres-volume`, `temporal-es-volume`), so workflow history
> survives a normal `down`/`up`. Only `down -v` wipes it. After a `down -v`,
> rerun `pnpm run prisma-db-push` to recreate the app schema.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend can't connect to DB | Is `docker compose -f docker-compose.dev.yaml up` running? Did you run `pnpm run prisma-db-push`? Do `.env` creds match the dev compose? |
| `relation ... does not exist` errors | Schema not pushed — run `pnpm run prisma-db-push`. |
| Orchestrator/health failing, no jobs run | Temporal not up yet. Check `docker compose -f docker-compose.dev.yaml logs temporal` and that `:7233` is reachable. First boot takes ~30–60s. |
| Elasticsearch container keeps restarting | Give Docker more RAM (≥4 GB). ES is the heaviest dep. |
| Port already in use (4200/3000/5432/…) | Another process/old container is bound. Stop it or change the port. |
| Frontend shows wrong API URL | `NEXT_PUBLIC_BACKEND_URL` in `.env` must be `http://localhost:3000` for local (no nginx proxy in dev). |

---

## How local differs from production (quick reference)

| | Local (`docker-compose.dev.yaml` + `pnpm dev`) | Production (`docker-compose.yaml`) |
|---|---|---|
| App processes | On host, hot-reload | Built into one image, run by pm2 |
| Reverse proxy | None — hit 4200/3000 directly | nginx on :5000 → exposed as :4007 |
| DB migration | Manual `pnpm run prisma-db-push` | Automatic on container boot |
| Config source | `.env` via `dotenv` | `env_file: .env` + compose `environment:` overrides |
| Dev GUIs | pgAdmin, RedisInsight included | Not included |
| Image | None (runs from source on host) | Built from `Dockerfile.dev` (`postiz-app:local`) |
</content>
