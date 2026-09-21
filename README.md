<p align="center">
  <a href="https://postaryx.com/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/frontend/public/logos/01_Postaryx_Main_Logo_Dark.svg">
    <img alt="Postaryx Logo" src="apps/frontend/public/logos/02_Postaryx_Main_Logo_Light.svg" width="280"/>
  </picture>
  </a>
</p>

<p align="center">
<a href="https://opensource.org/license/agpl-v3">
  <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License">
</a>
</p>

<div align="center">
  <strong>
  <h2>Your ultimate AI social media scheduling tool</h2><br />
  </strong>
  Postaryx offers everything you need to manage your social media posts,<br />build an audience, capture leads, and grow your business.
</div>

<div class="flex" align="center">
  <br />
  <img alt="Instagram" src="apps/frontend/public/icons/platforms/instagram.png" width="32">
  <img alt="Youtube" src="apps/frontend/public/icons/platforms/youtube.png" width="32">
  <img alt="Dribbble" src="apps/frontend/public/icons/platforms/dribbble.png" width="32">
  <img alt="Linkedin" src="apps/frontend/public/icons/platforms/linkedin.png" width="32">
  <img alt="Reddit" src="apps/frontend/public/icons/platforms/reddit.png" width="32">
  <img alt="TikTok" src="apps/frontend/public/icons/platforms/tiktok.png" width="32">
  <img alt="Facebook" src="apps/frontend/public/icons/platforms/facebook.png" width="32">
  <img alt="Pinterest" src="apps/frontend/public/icons/platforms/pinterest.png" width="32">
  <img alt="Threads" src="apps/frontend/public/icons/platforms/threads.png" width="32">
  <img alt="X" src="apps/frontend/public/icons/platforms/x.png" width="32">
  <img alt="Slack" src="apps/frontend/public/icons/platforms/slack.png" width="32">
  <img alt="Discord" src="apps/frontend/public/icons/platforms/discord.png" width="32">
  <img alt="Mastodon" src="apps/frontend/public/icons/platforms/mastodon.png" width="32">
  <img alt="Bluesky" src="apps/frontend/public/icons/platforms/bluesky.png" width="32">
</div>

<br /><br />

# Intro

- Schedule all your social media posts (many AI features)
- Measure your work with analytics.
- Invite your team members to collaborate, comment, and schedule posts.
- Automate posting through the public API and the NodeJS SDK.

## Tech Stack

- Pnpm workspaces (Monorepo)
- NextJS (React)
- NestJS
- Prisma (Default to PostgreSQL)
- Temporal
- Resend (email notifications)

## Quick Start

To have the project up and running, please follow the [Quick Start Guide](./docs/LOCAL-DEVELOPMENT.md)

## Postaryx Compliance

- Postaryx is an open-source, self-hosted social media scheduling tool that supports platforms like X (formerly Twitter), Bluesky, Mastodon, Discord, and others.
- Postaryx hosted service uses official, platform-approved OAuth flows.
- Postaryx does not automate or scrape content from social media platforms.
- Postaryx does not collect, store, or proxy API keys or access tokens from users.
- Postaryx never ask users to paste API keys into our hosted product.
- Postaryx Users always authenticate directly with the social platform (e.g., X, Discord, etc.), ensuring platform compliance and data privacy.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=aitechnologysys-sys/veroza&type=date&legend=top-left)](https://www.star-history.com/#aitechnologysys-sys/veroza&type=date&legend=top-left)

## License

This repository's source code is available under the [AGPL-3.0 license](LICENSE).


---

# Postaryx — development & deployment runbook

Everything below is specific to **this fork** (product: **Postaryx**; repo:
`aitechnologysys-sys/veroza`) and is not in upstream Postaryx. This is the
quick-reference; the linked docs hold the detail and the reasoning.

> **The one rule that prevents most pain:** always pass the same
> `-p <project>` to every Compose command for a stack — `up`, `down`, `pull`,
> `logs`, `ps`. Dev uses `postaryx-dev`, local prod uses `postaryx-prod`. Different
> project names keep their volumes separate, which is what lets you switch back
> and forth without Postgres auth errors or data loss. Never run both at once
> (they collide on ports and hardcoded `container_name`s). Full explanation:
> [docs/RUNNING-DEV-AND-PROD.md](docs/RUNNING-DEV-AND-PROD.md).

## 1. Local development (hot reload)

Dependencies in Docker, the three apps on the host.

```bash
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d   # Postgres, Redis, Temporal
pnpm run prisma-db-push        # first time, and after any schema change
pnpm run dev                   # backend + frontend + orchestrator
# → http://localhost:4200

# Testing a billing webhook? Expose the backend:
ngrok http 3000

docker compose -p postaryx-dev -f docker-compose.dev.yaml down    # stop
```

See [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md).

## 2. Running the production stack locally

Same `docker-compose.yaml` the server uses, so this is the honest rehearsal for
a deploy.

> **First time running this stack?** It needs a `.env` (not `.env.prod`) with
> `POSTARYX_DB_USER`/`POSTARYX_DB_PASSWORD`/`POSTARYX_DB_NAME`,
> `POSTARYX_REDIS_PASSWORD`, and `POSTARYX_TEMPORAL_DB_PASSWORD` — Compose
> refuses to start without them. See
> [docs/PROD-DEPLOY-PREREQUISITE.md](docs/5.%20PROD-DEPLOY-PREREQUISITE.md) for the
> one-time setup, and §3's ["Where configuration comes
> from"](#where-configuration-comes-from) for why `.env.prod` alone isn't enough.

**This no longer builds.** The `postaryx` service pulls a prebuilt image from
GHCR — see §3 for why. So a plain `up -d` fetches whatever CI last published
from `main`:

```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d postaryx
# remove the word postarxy after -d in above command if you want to restart everything.
# → http://localhost:4007       (webhook testing: ngrok http 4007)

docker compose -p postaryx-prod down
```

To run **local, uncommitted** code in the prod stack, build it yourself and
point the stack at it with env vars — never by editing `docker-compose.yaml`:

```bash
docker build -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=local -t postaryx-app:local .
POSTARYX_IMAGE=postaryx-app POSTARYX_IMAGE_TAG=local docker compose -p postaryx-prod up -d postaryx
```

⚠️ That build needs **~4 GB of free RAM** and takes a while. It is exactly the
spike we moved off the server; on a laptop it is merely slow.

## 3. How images are built and deployed

The server never builds. `Dockerfile.dev` compiles all three apps inside the
image with a 4 GB Node heap, which spikes a 12 GB box to ~11.4 GB and can OOM
the running stack. So CI builds, the server only pulls.

```
push to main  →  GitHub Actions (arm64 runner)  →  ghcr.io/aitechnologysys-sys/veroza  →  VM pulls
                 .github/workflows/build-containers.yml
```

**Tags the workflow publishes:**

| Tag               | When             | Purpose                                                 |
| ----------------- | ---------------- | ------------------------------------------------------- |
| `:<full-git-sha>` | every run        | immutable rollback handle                               |
| `:latest`         | **`main` only**  | what the VM pulls                                       |
| `:branch-<name>`  | any other branch | manual test builds — deliberately cannot move `:latest` |

**Deploy** (on the VM, after CI goes green):

```bash
cd /opt/postaryx/postaryx-app
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d postaryx
```

**Roll back** — no rebuild, the old image is already in GHCR:

```bash
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod pull postaryx
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx-prod up -d postaryx
```

Set the variable on **both** commands — `pull` and `up` read it independently.
The `image:` line in `docker-compose.yaml` is
`${POSTARYX_IMAGE:-ghcr.io/aitechnologysys-sys/veroza}:${POSTARYX_IMAGE_TAG:-latest}`
precisely so rollback never requires editing a tracked file on the server.

> **The project name is `-p postaryx-prod` on every machine** — the server and
> your laptop's prod rehearsal (§2) alike, which keeps it isolated from
> `postaryx-dev`. The server ran under a bare `-p postaryx` until its volumes were
> migrated to `postaryx-prod`; anything still saying `-p postaryx` is stale. If
> unsure what a box is using, run `docker compose ls` — a wrong `-p` silently
> targets a different, empty project instead of erroring.

**Running the workflow by hand:** the _Run workflow_ button only appears once a
workflow containing `workflow_dispatch` exists on the **default branch**. Until
`build-containers.yml` is merged to `main` there is no button anywhere. After
that, Actions → _Build image_ → _Run workflow_ → pick any branch.

### Where configuration comes from

The image contains **no configuration at all** — verified: four environment
variables total, of which the only meaningful one is the `NEXT_PUBLIC_VERSION`
build stamp. Config arrives at container start, from three different places that
are easy to confuse:

| Source                                      | Read by                                                | Contains                                                                                      | Committed?                                                |
| ------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **`.env.prod`** via `env_file:`             | injected into the container                            | every secret: `JWT_SECRET`, API keys, email, billing                                          | **No** — gitignored, and `.dockerignore` excludes `.env*` |
| **`environment:`** in `docker-compose.yaml` | injected into the container, **overrides `.env.prod`** | container-network wiring: `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`, `STORAGE_PROVIDER` | Yes                                                       |
| **`.env`** (a _different_ file)             | **Compose itself**, not the container                  | `${POSTARYX_PUBLIC_URL}`, `${POSTARYX_IMAGE}`, `${POSTARYX_IMAGE_TAG}` substitutions          | No                                                        |

Three consequences:

1. **`.env.prod` must be created on the server by hand, once.** Neither
   `git pull` nor the image brings it. Without it, `up` fails. `chmod 600` it.
2. **`environment:` beats `env_file:`.** Setting `DATABASE_URL` or
   `STORAGE_PROVIDER` in `.env.prod` does nothing — change those in
   `docker-compose.yaml` instead.
3. **Config changes need no rebuild and no re-pull.** Edit `.env.prod`, then
   `docker compose -p postaryx-prod up -d postaryx` to recreate the container. Seconds.

This runtime-config design is what makes a CI-built image safe: `NEXT_PUBLIC_*`
values are read in _server_ components and passed to the client through
`VariableContextComponent`, so none of them are compiled into the bundle.

> ⚠️ **`docker-compose.yaml` is committed to a public repo, so everything in its
> `environment:` blocks is world-readable.** The app's Postgres role
> (`POSTARYX_DB_USER`/`POSTARYX_DB_PASSWORD`/`POSTARYX_DB_NAME`), Redis's
> (`POSTARYX_REDIS_PASSWORD`), and Temporal's own internal Postgres password
> (`POSTARYX_TEMPORAL_DB_PASSWORD`) are all sourced from `${...}` substitution
> in the gitignored `.env`, not hardcoded — see
> [docs/1.SECURITY-HARDENING-TODO.md](docs/1.SECURITY-HARDENING-TODO.md) P0-2/P1-3.
> Postgres (`127.0.0.1:5432`, P1-2) and Redis (`127.0.0.1:6379`, added for
> Another Redis Desktop Manager / GUI access) both publish loopback-only —
> the `127.0.0.1:` prefix on each is the entire security control standing
> between that and a fully open service, so never widen either to a bare
> `"5432:5432"` / `"6379:6379"`.

## 4. GHCR package visibility — read this once

**A new GHCR package is created PRIVATE, even when the repo is public.** It does
not inherit the repository's visibility. This bites everyone exactly once, so:

|              | Package **private** (the default) | Package **public**   |
| ------------ | --------------------------------- | -------------------- |
| Storage      | 500 MB free, then $0.25/GB/month  | Unlimited, free      |
| Transfer out | 1 GB/month free, then $0.50/GB    | Unlimited, free      |
| VM can pull  | Only after `docker login ghcr.io` | Yes, unauthenticated |

Our image is several GB, so on the private default you blow the free allowance
immediately. **After the first successful build, flip it once:**

`github.com/users/aitechnologysys-sys/packages/container/veroza/settings`
→ _Danger Zone_ → _Change visibility_ → **Public**

(That is the URL shape for a **user**-owned package. An org-owned one lives
under `/orgs/<org>/packages/...`.)

Two consequences worth holding onto:

- **A public image publishes your source.** `Dockerfile.dev` copies the whole
  repo in, so anyone can `docker pull` and read it. Fine while this repo is
  public — but **if you ever make the repo private, make the package private in
  the same sitting**, or you are still shipping your source to the world.
- **If you keep the package private**, the VM needs a one-time login with a
  token scoped to `read:packages` only (never a full PAT):

  ```bash
  echo "$GHCR_READ_ONLY_PAT" | docker login ghcr.io -u <github-username> --password-stdin
  ```

Old versions are pruned automatically (newest 20 kept) by the workflow's
_Prune old image versions_ step. That is hygiene, not cost — on a public
package storage is free.

## 5. Tearing down and reclaiming disk

Four Docker object types, four different commands. Mixing them up is how people
either fail to free any space or delete a database they wanted.

| Command                         | Removes                               | Keeps                  |
| ------------------------------- | ------------------------------------- | ---------------------- |
| `docker compose -p <p> stop`    | nothing — just stops processes        | everything             |
| `docker compose -p <p> down`    | containers + project networks         | **volumes**, images    |
| `docker compose -p <p> down -v` | containers, networks, **and volumes** | images                 |
| `docker image prune`            | untagged (dangling) images            | tagged images, volumes |

### Restarting a service after an env change

`env_file` is read when a container is **created**, not when it starts. So
`restart` does nothing for a changed `.env.prod` — you need a recreate:

```bash
docker compose -p postaryx-prod up -d postaryx        # recreates just this service
docker compose -p postaryx-prod up -d --force-recreate postaryx   # if it reports "up-to-date"
```

Confirm the container actually took the value — a quoted or truncated paste is
invisible by eye:

```bash
docker compose -p postaryx-prod exec postaryx sh -c 'printf "[%s]\n" "$STRIPE_SIGNING_KEY"'
```

### Full reset — destroys all data

⚠️ **`-v` deletes `postgres-volume` (the database), `postaryx-uploads` (all
media), `postaryx-redis-data`, `postaryx-config`, and
`temporal-postgres-volume` (workflow history — every scheduled post).** There is
no undo. Only do this on a stack with nothing you need.

```bash
cd /opt/postaryx/postaryx-app

# 1. Look at what you're about to delete
docker compose -p postaryx-prod ps -a
docker volume ls | grep -Ei 'postaryx|temporal'

# 2. Destroy
docker compose -p postaryx-prod down -v --remove-orphans

# 3. Verify — both should print nothing
docker volume ls | grep -Ei 'postaryx|temporal'
docker ps -a     | grep -Ei 'postaryx|temporal'

# 4. Rebuild from scratch
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
docker compose -p postaryx-prod logs -f postaryx
```

Cold start is slower than a recreate: Temporal's `auto-setup` rebuilds its schema
and recreates the `default` namespace, and `prisma-db-push` builds the app schema
from nothing. Budget 2–3 minutes, and ignore Temporal connection errors in the
first 90s — that is what `start_period: 120s` on the healthcheck is for.

Step 3 is not ceremony. If the stack was ever started without `-p postaryx-prod`,
Compose owns a _second_ project whose volumes `down -v` never touched.
`docker compose ls -a` reveals it; remove strays with `docker volume rm <name>`.

Files on disk are **not** volumes and survive all of the above: `.env`,
`.env.prod`, `docker-compose.yaml`, the nginx vhost, and the TLS cert.

**What survives `--remove-orphans` and is protected from `-v`:** a volume marked
`external: true` is considered someone else's property and is skipped. Every
volume in our file is `external: false`, which is exactly why `-v` clears them.
That flag is the switch to flip if a volume ever holds something you can't lose.

### Reclaiming disk after a deploy

`pull` moves the `:latest` **tag** to the new digest; the previous image keeps
its layers, loses its only tag, and lingers as `<none> <none>` forever. Nothing
cleans it up on its own, and the image is several GB against a 50 GB boot volume.

```bash
docker system df                       # where the space actually went
docker images | grep -E 'veroza|none'
docker image prune -f                  # dangling only
```

Two cautions:

- **Don't habitually run `docker system prune -a`.** It removes every image not
  attached to a container, so running it while the stack is down also deletes
  `postgres:17-alpine`, `redis:7.2`, and the Temporal images — the next `up -d`
  re-downloads them for nothing.
- **Pruning does not cost you a rollback.** You only ever pull `:latest`, so the
  previous image is untagged locally and pruning it is free; GHCR still has the
  `:<full-git-sha>` tag (§3). Deleting the _package version_ in GHCR is the
  destructive one.

## 6. Where the rest of it is written down

| Doc                                                                                                | Covers                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [docs/CI-BUILD-CUTOVER.md](<docs/3.%20(First%20time%20important)%20CI-BUILD-CUTOVER.md>)           | **Do this once**, right after the CI-build change merges: make the GHCR package public, then test and deploy step by step    |
| [docs/UPSTREAM-ISOLATION.md](docs/UPSTREAM-ISOLATION.md)                                           | Proof that nothing of ours reaches Postaryx, the one gap that was closed, and where we still link to them                    |
| [docs/UPSTREAM-SYNC.md](docs/UPSTREAM-SYNC.md)                                                     | Pulling Postaryx's fixes in: cherry-pick vs merge, the known conflict hotspots, and how to verify                            |
| [docs/RUNNING-DEV-AND-PROD.md](docs/RUNNING-DEV-AND-PROD.md)                                       | Switching stacks safely, Compose project isolation, the Postgres auth error                                                  |
| [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md)                                             | Dev setup in depth                                                                                                           |
| [docs/PROD-DEPLOY-PREREQUISITE.md](docs/5.%20PROD-DEPLOY-PREREQUISITE.md)                          | What must exist before a deploy                                                                                              |
| [docs/ORACLE-VM-DEPLOYMENT.md](docs/ORACLE-VM-DEPLOYMENT.md)                                       | Server build-out: Nginx, Certbot, firewall, backups                                                                          |
| [docs/7. MULTI-DOMAIN-DEPLOYMENT-WALKTHROUGH.md](docs/7.%20MULTI-DOMAIN-DEPLOYMENT-WALKTHROUGH.md) | Landing on the apex, app on `app.`, API at `app./api` — DNS, vhost, TLS, Vercel env, and the one-string swap to a new domain |
| [docs/CONTAINMENT-DEPLOYMENT-PLAN.md](docs/4.%20CONTAINMENT-DEPLOYMENT-PLAN.md)                    | Fitting the stack in 2 OCPU / 12 GB; the CI-build rationale (§6)                                                             |
| [docs/INFRASTRUCTURE-AND-DEPLOYMENT.md](docs/INFRASTRUCTURE-AND-DEPLOYMENT.md)                     | Architecture overview                                                                                                        |
| [docs/billing-current-state.md](docs/billing-current-state.md)                                     | Stripe/Polar wiring, `BILLING_ENABLED`                                                                                       |
| [CLAUDE.md](CLAUDE.md)                                                                             | Repo conventions, the Postaryx rename policy, upstream-parity rule                                                           |
