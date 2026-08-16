# Postiz — Infrastructure & Deployment Guide

> A complete map of every moving part in the Postiz stack: what each Docker
> service is, **why** it exists, how the pieces talk to each other, and how much
> disk + RAM you should budget when you deploy.
>
> Sources for this doc: [docker-compose.yaml](../docker-compose.yaml),
> [docker-compose.dev.yaml](../docker-compose.dev.yaml),
> [Dockerfile.dev](../Dockerfile.dev),
> [var/docker/nginx.conf](../var/docker/nginx.conf),
> [package.json](../package.json), and the app source under
> [apps/](../apps/) and [libraries/](../libraries/).

---

## 1. The 30-second mental model

Postiz is **one application split into three Node.js processes** plus a set of
**infrastructure dependencies**. Everything is wired together with Docker Compose.

```
                         ┌─────────────────────────────────────────────┐
   Browser  ── :4007 ──▶ │  postaryx  (single container)                 │
                         │                                             │
                         │   nginx :5000  (reverse proxy, the only     │
                         │     │           port exposed)               │
                         │     ├── /         → frontend (Next.js :4200)│
                         │     ├── /api/     → backend  (NestJS  :3000)│
                         │     └── /uploads/ → local disk              │
                         │                                             │
                         │   orchestrator (Temporal worker :3002)      │
                         │   (all 3 processes managed by pm2)          │
                         └───────┬───────────────┬────────────┬────────┘
                                 │               │            │
                    ┌────────────▼──┐   ┌────────▼─────┐   ┌──▼──────────────┐
                    │ postaryx-postgres│   │ postaryx-redis │   │  Temporal stack │
                    │  (app data)    │   │ (queue/cache)│   │  (5 containers) │
                    └────────────────┘   └──────────────┘   └─────────────────┘
```

Two key takeaways:

1. **The `postaryx` container runs 3 apps at once**, not one. `nginx` fronts them
   and is the only thing you expose to the world (mapped `4007:5000`).
2. **The "Temporal stack" is 5 separate containers** that together provide one
   capability: durable, scheduled background jobs. This is where most of the
   container count — and most of the surprise RAM/disk usage — comes from.

---

## 2. What runs *inside* the `postaryx` container

> **This deployment pulls a prebuilt image built in CI**, not from the
> published `ghcr.io/gitroomhq/postiz-app` and not built locally. See
> [§2a](#2a-our-image-built-in-ci-pulled-everywhere).

The image is built from [Dockerfile.dev](../Dockerfile.dev): a Node 22 + nginx
base, with `pnpm build` run for all three apps. At runtime the container does:

```sh
nginx && pnpm run pm2     # CMD in the Dockerfile
```

`pm2` (a Node process manager) starts three long-running processes in parallel
(`pnpm run --parallel pm2` → each app's `pm2` script):

| Process          | Port  | Framework        | Job |
|------------------|-------|------------------|-----|
| **frontend**     | 4200  | Next.js 16 / React 19 | The web UI (calendar, analytics, settings, billing). |
| **backend**      | 3000  | NestJS REST API  | All business logic, auth, integrations, DB access. |
| **orchestrator** | 3002  | NestJS + Temporal worker | Connects to Temporal, executes background jobs (publishing posts, emails, token refresh). Port 3002 only serves a health check. |

`nginx` (config in [var/docker/nginx.conf](../var/docker/nginx.conf)) listens on
**:5000** and routes:

- `/api/*` → `localhost:3000` (backend)
- `/uploads/*` → served from local disk (with strict CSP / `nosniff` headers)
- everything else → `localhost:4200` (frontend)

It also sets `client_max_body_size 2G` (large media uploads) and forwards a set
of custom Postiz headers (`Reload`, `Onboarding`, `Auth`, `Showorg`,
`Impersonate`, etc.).

> **Why one container with 3 processes?** It keeps the self-host story simple —
> one image, one thing to run. In a larger production deployment you can split
> backend / frontend / orchestrator into separate containers (the per-app
> `start:prod:*` scripts exist for exactly this), but the default compose ships
> them together.

On first boot the entrypoint also runs `pnpm run prisma-db-push` (via the `pm2`
script) to sync the database schema — so the app self-migrates against
`postaryx-postgres`.

---

## 2a. Our image: built in CI, pulled everywhere

> **This section changed.** The compose file used to build the app in place. It
> now **pulls** a prebuilt image, because building on a 12 GB server spikes it to
> ~11.4 GB and can OOM the running stack. GitHub Actions builds instead. The
> authoritative walkthrough is the runbook in [../README.md](../README.md) §3;
> the rationale is [CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §6.

The `postaryx` service resolves its image from two overridable variables:

```yaml
  postaryx:
    image: ${POSTARYX_IMAGE:-ghcr.io/aitechnologysys-sys/veroza}:${POSTARYX_IMAGE_TAG:-latest}
```

Defaults give you `ghcr.io/aitechnologysys-sys/veroza:latest` — the newest image
built from `main`. Overriding `POSTARYX_IMAGE_TAG` with a git sha is how you roll
back; overriding both is how you run a locally built image. Neither requires
editing this tracked file, which matters on a server.

**Why this is safe / prod-ready:** the image is produced from the *same*
`Dockerfile.dev` with the *same* single build arg as before (see
[.github/workflows/build-containers.yml](../.github/workflows/build-containers.yml)),
just on a CI runner instead of the target box — so it is behavior-identical to
the old local build. Verified: `NEXT_PUBLIC_*` values are read in *server*
components and threaded to the client at runtime, so nothing environment-specific
is baked in.

### Run commands
```bash
# Fetch the newest CI-built image and start the whole stack
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d

# Update just the app after CI publishes a new image
docker compose -p postaryx-prod pull postaryx && docker compose -p postaryx-prod up -d postaryx

# Roll back to a specific build (no rebuild — set the var on BOTH commands)
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod pull postaryx
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod up -d postaryx
```

### Building locally anyway (uncommitted code)
```bash
docker build -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=local -t postaryx-app:local .
POSTARYX_IMAGE=postaryx-app POSTARYX_IMAGE_TAG=local docker compose -p postaryx-prod up -d postaryx
```
Fine on a dev machine with RAM to spare. **Never do this on the server.**

### Build resource notes
- The Next.js build runs with `NODE_OPTIONS=--max-old-space-size=4096` — give
  Docker **at least ~4 GB of build RAM** or the frontend build can OOM.
- First build is **several minutes** (full `pnpm install` + building three apps,
  `--no-cache`-style fresh deps). Subsequent builds reuse layer cache and are faster.
- The build needs internet access (npm registry + `fetch-gtm` postinstall).

### Build-time vs runtime config (important)
- **Only `NEXT_PUBLIC_VERSION` is baked into the image at build time** (it is read
  by a *client* component, so it must be a build arg).
- **Everything else is runtime config**, including `NEXT_PUBLIC_BACKEND_URL`.
  Postiz reads those `NEXT_PUBLIC_*` values in Next.js **server components** at
  request time and hands them to the client via a context provider. That's the
  whole reason one generic image works for every install — and why you can change
  URLs/keys without rebuilding. Set them in `.env` / compose `environment:`.

### Where config comes from
- `env_file: .env` loads all secrets/keys (JWT, Cloudflare, social, email, OpenAI,
  Polar/Stripe) from the repo-root `.env`.
- The `environment:` block in compose **overrides** `.env` for infra wiring that
  must use container names: `DATABASE_URL`→`postaryx-postgres`, `REDIS_URL`→
  `postaryx-redis`, `TEMPORAL_ADDRESS`→`temporal`, plus the public `*_URL`s and
  storage paths. (Compose precedence: `environment:` > `env_file:`.)
- ⚠️ Your `.env` keeps `localhost` values for `DATABASE_URL`/`REDIS_URL`/
  `TEMPORAL_ADDRESS` — that's correct for `pnpm dev` on the host. Inside the
  container the `environment:` overrides take over, so **the same `.env` works for
  both** dev and the compose stack. Don't "fix" the localhost values in `.env`.
- ⚠️ `.env` is in `.dockerignore`, so secrets are **never** baked into an image
  layer. Config is injected only at runtime.

---

## 3. Every service in `docker-compose.yaml` (production)

Below, each service is grouped by the capability it provides. **Disk** = the
on-disk size of the image (approx, linux/amd64). **RAM** = a realistic steady-
state working set, not a hard limit. These are estimates — see
[§7](#7-how-to-measure-exact-numbers-on-your-machine) to get exact numbers.

### 3a. The application

#### `postaryx`
- **Image:** `ghcr.io/aitechnologysys-sys/veroza:latest` by default — **built in CI** from this source via `Dockerfile.dev` (see [§2a](#2a-our-image-built-in-ci-pulled-everywhere)). Override with `POSTARYX_IMAGE` / `POSTARYX_IMAGE_TAG`.
- **What:** The app itself (frontend + backend + orchestrator + nginx, see §2).
- **Why:** This is the product.
- **Ports:** `127.0.0.1:4007:5000` — the only user-facing port, loopback-only (a host reverse proxy is the sole public listener).
- **Depends on:** `postaryx-postgres` (healthy), `postaryx-redis` (healthy), `temporal` (healthy) — the backend opens its Temporal connection at module-init time, before the app is otherwise ready, so it must wait for Temporal too.
- **Config:** `env_file: .env` (secrets) + `environment:` overrides (infra wiring).
- **Healthcheck:** Node `fetch('http://localhost:5000')`, 90s start period.
- **Volumes:** `postaryx-config:/config/`, `postaryx-uploads:/uploads/` (uploaded media when `STORAGE_PROVIDER=local`).
- **Disk:** ~2.5–3.5 GB (large — bundles Node, three built apps, `sharp`, `canvas`, `polotno`, nginx, and the full `node_modules`). Plus build-cache layers on the host.
- **RAM:** ~700 MB–1.5 GB at runtime (three Node processes). **Build needs ~4 GB.**

### 3b. Application data stores (required)

#### `postaryx-postgres`
- **Image:** `postgres:17-alpine`
- **What:** The primary application database (users, orgs, integrations, posts, billing). Schema lives in [schema.prisma](../libraries/nestjs-libraries/src/database/prisma/schema.prisma); accessed via Prisma.
- **Why:** Postiz's system of record. Connected via `DATABASE_URL`.
- **Ports:** `127.0.0.1:5432:5432` — loopback-only, for DBeaver access (see [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P1-2). Not reachable from outside the host.
- **Volume:** `postgres-volume:/var/lib/postgresql/data` (named volume — **this is your real data, back it up**).
- **Disk:** ~280 MB image + your data (grows with usage).
- **RAM:** ~150–400 MB.

#### `postaryx-redis`
- **Image:** `redis:7.2`
- **What:** In-memory store used for caching, rate-limiting (`@nestjs/throttler` + `ioredis`), and as a lightweight queue/pub-sub between processes.
- **Why:** Fast ephemeral state. Connected via `REDIS_URL`. (Note: durable scheduled jobs go through **Temporal**, not Redis — Redis here is for caching/throttling/short-lived coordination.)
- **Auth + memory cap:** requires a password (`--requirepass ${POSTARYX_REDIS_PASSWORD}` from `.env`) and caps memory at `256mb` with `allkeys-lru` eviction — see [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P1-3.
- **Ports:** `127.0.0.1:6379:6379` — loopback-only, for GUI clients (Another Redis Desktop Manager etc.), mirroring the Postgres pattern above.
- **Volume:** `postaryx-redis-data:/data` (AOF/RDB persistence).
- **Disk:** ~140 MB image + small data.
- **RAM:** ~50–200 MB.

### 3c. The Temporal stack (5 containers — see §4 for the deep dive)

| Service | Image | Disk (approx) | RAM (approx) | Role |
|---|---|---|---|---|
| `temporal` | `temporalio/auto-setup:1.28.1` | ~450 MB | ~200–400 MB | The Temporal **server** (the workflow engine). |
| `temporal-postgresql` | `postgres:16` | ~430 MB | ~150–300 MB | Temporal's **own** database (separate from app DB). |
| `temporal-elasticsearch` | `elasticsearch:7.17.27` | ~640 MB | ~300–600 MB | Workflow **visibility / search** index. |
| `temporal-ui` | `temporalio/ui:2.34.0` | ~120 MB | ~50–100 MB | Web dashboard (`:8080`) to inspect workflows. |
| `temporal-admin-tools` | `temporalio/admin-tools:1.28.1-...` | ~400 MB | ~20 MB (idle) | CLI container (`tctl`/`temporal` CLI) for admin tasks. |

---

## 4. The Temporal stack, explained (the part that confuses people)

**Why does a "social scheduler" need 5 extra containers?**

Postiz's whole value proposition is *scheduling*: "publish this post Tuesday at
9am," "retry if X's API is down," "refresh this OAuth token before it expires,"
"send the weekly digest email." Those are **durable, long-running, retryable
background jobs** — and that's exactly what [Temporal](https://temporal.io) does.

Instead of fragile cron jobs or a homegrown queue, Postiz models each job as a
**workflow**. You can see them in
[apps/orchestrator/src/workflows/](../apps/orchestrator/src/workflows/):

- `post-workflows/post.workflow.v1.0.*` — publishing a scheduled post (versioned, so in-flight jobs survive deploys).
- `autopost.workflow.ts` — recurring auto-posting.
- `digest.email.workflow.ts` / `send.email.workflow.ts` — rate-limited email sending (700 ms between sends).
- `refresh.token.workflow.ts` — refresh social OAuth tokens before they expire.
- `missing.post.workflow.ts` — hourly sweep for posts that should have gone out.
- `streak.workflow.ts` — user posting-streak reminders.

The **orchestrator** process (inside the `postaryx` container) is the Temporal
*worker* — it long-polls the Temporal server for tasks and runs the actual
side-effecting code ([activities/](../apps/orchestrator/src/activities/)). The
**backend** is the Temporal *client* — it starts/signals workflows. Both reach
the server via `TEMPORAL_ADDRESS=temporal:7233`.

Now, why each of the 5 containers exists:

1. **`temporal`** — the server/brain. It schedules tasks, tracks workflow state,
   handles retries and timers. By itself it stores nothing — it needs a DB and
   (in this config) a search index.

2. **`temporal-postgresql`** — Temporal persists all workflow state here. It is
   **deliberately a separate Postgres from `postaryx-postgres`** so Temporal's
   internal bookkeeping never mixes with your application data. (`DB=postgres12`,
   `POSTGRES_SEEDS=temporal-postgresql`.)

3. **`temporal-elasticsearch`** — Temporal's "advanced visibility": it indexes
   workflows so you can search/filter them (by type, status, time, custom search
   attributes) in the UI and via the API. It's enabled here with `ENABLE_ES=true`
   / `ES_VERSION=v7`. **This is the single biggest infra dependency by RAM/disk.**
   It's tuned tiny in this compose (`ES_JAVA_OPTS=-Xms256m -Xmx256m` and very low
   disk watermarks) precisely because ES is otherwise a memory hog.

4. **`temporal-ui`** — the web dashboard on `:8080`. Purely for humans to
   inspect/debug workflow runs. **Not required for the app to function.**

5. **`temporal-admin-tools`** — a CLI-only sidecar (it just sits with `tty`/`stdin`
   open). Used to run admin commands like registering the `default` namespace
   (see [var/docker/create-namespace-default.sh](../var/docker/create-namespace-default.sh)).
   It does no work at runtime. **Not required for the app to function.**

> The `temporal` image used here is `auto-setup`, which conveniently creates the
> DB schema and namespace on first boot. It's great for self-hosting but is
> technically a "dev convenience" image — fine for small/medium deployments.

### Could you slim the Temporal stack down?
- **`temporal-ui`** and **`temporal-admin-tools`** can be removed in production
  if you don't need the dashboard/CLI (you can always run them ad-hoc). That
  saves a container each but little RAM.
- **`temporal-elasticsearch`** *can* be dropped (Temporal can run "standard
  visibility" on Postgres only), but **the current compose hard-wires ES** via
  `ENABLE_ES=true`. Removing it requires editing the `temporal` service env and
  is the highest-impact change if you're RAM-constrained.

---

## 5. Networking & data persistence

### Networks
Two bridge networks isolate concerns:
- **`postaryx-network`** — app ↔ its Postgres/Redis.
- **`temporal-network`** — the 5 Temporal containers + the `postaryx` app (the app
  joins *both* networks so the orchestrator can reach `temporal:7233`).

### Named volumes (production compose)
| Volume | Mounted by | Holds | Back up? |
|---|---|---|---|
| `postgres-volume` | `postaryx-postgres` | **All app data** | ✅ Critical |
| `postaryx-uploads` | `postaryx` | Uploaded media (if `STORAGE_PROVIDER=local`) | ✅ Critical (unless using Cloudflare R2) |
| `postaryx-redis-data` | `postaryx-redis` | Redis persistence | ⚠️ Nice-to-have |
| `postaryx-config` | `postaryx` | App config | ⚠️ Nice-to-have |
| `temporal-postgres-volume` | `temporal-postgresql` | Temporal workflow state | ⚠️ Recommended |
| `temporal-es-volume` | `temporal-elasticsearch` | Temporal visibility index | ⚠️ Recommended |

> ✅ **Temporal's data now uses named volumes.** Previously
> `temporal-postgresql` and `temporal-elasticsearch` used *anonymous* volumes, so
> workflow history was lost on recreate. They now map to
> `temporal-postgres-volume` and `temporal-es-volume`, so history survives
> `docker compose up -d` recreates. (A `docker compose down -v` still wipes them —
> that flag removes named volumes too.)

---

## 6. Footprint summary — how much space does this take?

> ⚠️ **These are approximations** for linux/amd64. Exact sizes vary by
> architecture (Apple Silicon pulls arm64 variants) and image updates. Disk =
> image size on disk; "+ data" grows with usage. See §7 to measure precisely.

### Production stack (`docker-compose.yaml`) — 8 containers

| Service | Image disk | Steady RAM | Required? |
|---|---:|---:|:--|
| postaryx | ~2.5–3.5 GB | ~700 MB–1.5 GB | ✅ Yes |
| postaryx-postgres | ~280 MB | ~150–400 MB | ✅ Yes |
| postaryx-redis | ~140 MB | ~50–200 MB | ✅ Yes |
| temporal | ~450 MB | ~200–400 MB | ✅ Yes* |
| temporal-postgresql | ~430 MB | ~150–300 MB | ✅ Yes* |
| temporal-elasticsearch | ~640 MB | ~300–600 MB | ✅ Yes* (as configured) |
| temporal-ui | ~120 MB | ~50–100 MB | ❌ Optional |
| temporal-admin-tools | ~400 MB | ~20 MB | ❌ Optional |
| **TOTAL** | **~5.0–6.0 GB disk** | **~1.6–3.6 GB RAM** | |

\* The whole Temporal group is required because background jobs (scheduled
publishing, emails, token refresh) run through it. Individual Temporal
*containers* `temporal-ui` and `temporal-admin-tools` are not.

**Practical guidance:**
- **Minimum viable RAM:** ~4 GB will run it but is tight (ES + 3 Node processes
  + 3 Postgres-class processes). **Recommended: 8 GB.** With 4 GB, expect to
  drop `temporal-ui`, `temporal-admin-tools`.
- **Disk:** budget **~10–15 GB** total to leave headroom for image layers,
  Postgres growth, uploaded media, and Docker overhead. Pure images are ~6 GB;
  the rest is data + breathing room.
- **Biggest single consumers:** the `postaryx` image (disk) and
  `temporal-elasticsearch` (RAM). If you're squeezed, those are where to look.

### Dev stack (`docker-compose.dev.yaml`) — does NOT include the app

The dev compose runs **only dependencies** (you run the apps locally via
`pnpm dev`). It swaps in lighter/heavier images and adds admin GUIs:

| Service | Image | Note vs prod |
|---|---|---|
| postaryx-postgres | `postgres:17-alpine` | exposes `127.0.0.1:5432` (loopback-only, per P1-1) |
| postaryx-redis | `redis:7-alpine` (~40 MB) | lighter than prod's `redis:7.2` |
| postaryx-pg-admin | `dpage/pgadmin4:latest` (~450 MB) | DB GUI on `:8082` — dev only |
| postaryx-redisinsight | `redis/redisinsight:latest` (~350 MB) | Redis GUI on `:5540` — dev only |
| temporal (×5) | same as prod | same Temporal stack |

> The dev compose file itself warns: *"Do not use this yml for production."*

---

## 7. How to measure exact numbers on your machine

The figures above are estimates. To get real numbers after pulling/starting:

```bash
# Exact on-disk size of every image used
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}'

# Total disk used by images / containers / volumes
docker system df -v

# Live RAM + CPU per running container
docker stats --no-stream
```

Run `docker stats` after the stack has been up a few minutes and you've used the
app a little — Elasticsearch and the Node processes only reach steady state after
warm-up.

---

## 8. Deployment checklist (the practical part)

The goal you stated is to deploy this. Here's the short version.

### Pull the image first
This stack pulls a CI-built image ([§2a](#2a-our-image-built-in-ci-pulled-everywhere)):
```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
```
On the server, pull — never build. If you are building on a dev machine instead,
ensure Docker has ≥4 GB build RAM and internet access.

### Required environment variables (set in `.env`; see [.env.example](../.env.example))
- `JWT_SECRET` — **generate a long random string** (e.g. `openssl rand -base64 48`).
- `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS` — your `.env` keeps these on
  `localhost` for host-side `pnpm dev`; the compose `environment:` block overrides
  them to `postaryx-postgres` / `postaryx-redis` / `temporal` inside the container.
  **No action needed** unless you change the topology.
- `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL` / `BACKEND_INTERNAL_URL`
  (set in compose `environment:`) — **must match the exact public URL** users hit.
  They default to `http://localhost:4007` — change to your real domain. Because
  `NEXT_PUBLIC_BACKEND_URL` is runtime-read, **no rebuild is needed** to change it.
- `IS_GENERAL=true` (required for self-host).
- ⚠️ Clean the **placeholder** values in `.env` (e.g. `X_API_KEY="Twitter API key…"`,
  `OPENAI_API_KEY="OpenAI API key"`) — leave a key blank to disable that feature
  rather than shipping placeholder text.

### Storage decision
- `STORAGE_PROVIDER=local` → media saved to the `postaryx-uploads` volume, served
  by nginx at `/uploads/`. Simple, but you own the backups.
- `STORAGE_PROVIDER=cloudflare` → media in Cloudflare R2 (set the `CLOUDFLARE_*`
  vars). Recommended for multi-instance / scale. Note `.env.example` says R2 was
  historically required for things like social avatars — verify per platform.

### Optional integrations (only set what you use)
- **Social APIs** — each platform (X, LinkedIn, YouTube, TikTok, Discord, Slack,
  …) needs its own `*_CLIENT_ID` / `*_SECRET`. Blank = that platform disabled.
- **Email** — `RESEND_API_KEY` (+ `EMAIL_FROM_*`). If set, users must activate
  via email; if unset, users auto-activate.
- **Payments** — `STRIPE_*` (only for the paid/SaaS mode).
- **AI** — `OPENAI_API_KEY` for AI features.

### Before going live
1. Put a TLS-terminating reverse proxy (or your platform's ingress) in front of
   port `4007`, and set the `*_URL` vars to the `https://` domain.
2. ✅ Temporal data already persists via named volumes (done in this compose, §5).
3. Back up `postgres-volume` and `postaryx-uploads` regularly.
4. Drop `temporal-ui`, `temporal-admin-tools` if you don't need them (smaller
   attack surface + less RAM).
5. Set `DISABLE_REGISTRATION=true` once your accounts exist, if it's a private
   instance.
6. Update by pulling, not rebuilding: merge to `main`, wait for the *Build
   image* workflow, then `docker compose -p postaryx-prod pull postaryx && docker
   compose -p postaryx-prod up -d postaryx`. Bump `version.txt` if you want a new
   version string in the UI — CI stamps it as `<version.txt>-<short-sha>`.

> The maintainers' canonical install guide is
> <https://docs.postiz.com/installation/docker-compose> — cross-check version
> bumps there. Since our image is built in CI from *this* repo (see §2a), it
> follows this repo's `main`, not the upstream `:latest` tag.

**Production: `pull` + `up -d` does everything**

Two commands fetch and run the entire stack. But "everything" means the production way, not dev mode:

1. Pulls the CI-built `postaryx` image from GHCR (Dockerfile.dev already ran in
   GitHub Actions — see §2a. Never builds locally on the server).
2. Starts all 8 containers — the app + Postgres + Redis + the Temporal stack.
3. Inside the `postaryx` container, the entrypoint (CMD) runs `nginx && pnpm run pm2`, which:
   - runs `prisma-db-push` (auto-migrates the DB), then
   - starts backend + frontend + orchestrator under pm2 using their start
     scripts (the built `dist/` output, e.g. `next start`, `node dist/.../main.js`)
     — not `pnpm run dev`.
4. So: no separate terminal, no manual migration, no `pnpm dev`. It's
   `pnpm run pm2`, the production runner.

**Local: two manual steps, on purpose.** The dev compose runs only the
dependencies (no app container). So you run the apps yourself:

```bash
# Terminal 1 — dependencies only
docker compose -f docker-compose.dev.yaml up

# Terminal 2 — the apps, in dev/hot-reload mode
pnpm run prisma-db-push   # first time + after schema changes
pnpm run dev
```

**The key distinction**

| | Prod | Local |
|---|---|---|
| Who runs the apps? | The container (pm2) | You (`pnpm run dev`) |
| Which mode? | Built apps (`start`) | Dev mode (`dev`, hot-reload) |
| DB migration | Automatic on boot | Manual `prisma-db-push` |
| Command count | 2 (`pull` + `up -d`) | 2 (`compose up` + `pnpm dev`) |

Why the difference? Prod wants one self-contained, optimized image that just
pulls and runs. Local wants hot-reload and breakpoints, which means running
the source on your host — so the apps stay out of Docker and you start them
yourself.

pnpm run dev ≠ what prod does. Prod's in-container pnpm run pm2 is the production counterpart to it.