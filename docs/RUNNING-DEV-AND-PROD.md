# Running Dev and Prod on the Same Machine (and switching between them)

You have two stacks in this repo:

- **Dev** — [docker-compose.dev.yaml](../docker-compose.dev.yaml) (deps only) +
  `pnpm run dev` on the host. Hot-reload. See [LOCAL-DEVELOPMENT.md](./LOCAL-DEVELOPMENT.md).
- **Prod** — [docker-compose.yaml](../docker-compose.yaml). One command pulls a
  CI-built image and runs the whole app in Docker — it no longer builds locally.
  See [INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md).

This guide answers: **can I run one, then the other, then go back — without breaking
the database?** Short answer: **yes, if you isolate them by Docker Compose
*project***. If you don't, switching to the other stack throws a Postgres auth
error. Here's exactly why, and how to do it cleanly.

> First time running the prod stack? It needs a `.env` with `POSTARYX_DB_*` /
> `POSTARYX_REDIS_PASSWORD` / `POSTARYX_TEMPORAL_DB_PASSWORD` set before either
> command below will start — see
> [PROD-DEPLOY-PREREQUISITE.md](./PROD-DEPLOY-PREREQUISITE.md).

---

## TL;DR (the golden rule)

> **Give each stack its own Compose project name, and never run both at once.**

```bash
# DEV  (deps in Docker, app on host)
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push      # first time / after schema changes
pnpm run dev
# stop it:
docker compose -p postaryx-dev -f docker-compose.dev.yaml down

# PROD (everything in Docker; pulls a CI-built image, does NOT build)
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
# stop it:
docker compose -p postaryx-prod down
```

Always pass the **same `-p <name>`** to every command for that stack (`up`,
`down`, `logs`, `ps`). With separate projects, dev and prod keep **separate
volumes**, so you can switch back and forth forever with no auth errors and no
data loss. (Prefer not typing `-p` every time? See
[Make it automatic](#make-it-automatic-optional-one-time-edit).)

---

## 1. Why you can't run both **at the same time**

Even with separate projects, the two stacks collide if run simultaneously:

- **Published ports overlap:** both publish Postgres `5432` (as of P1-2) and
  Redis `6379` (just added, for GUI clients like Another Redis Desktop
  Manager) — neither prod service used to publish a host port, so these are
  newer collisions — plus Temporal `7233` and Temporal UI `8080` (dev also
  publishes `8082`, `5540`; prod also `4007`).
- **Container names are hardcoded and global:** both files set
  `container_name: postaryx-postgres`, `temporal`, `temporal-ui`, etc.
  `container_name` is **not** namespaced by project, so the second stack fails
  with *"container name already in use"*.

So the rule is **one stack at a time**: `down` the current one before `up`-ing the
other. (That's fine — you don't need both running.)

---

## 2. Why naive switching **breaks the database** (the auth error)

This is the part that bites people. Both compose files declare the **same volume
names**, and with the **default** project name (`postaryx-app`, taken from the repo
folder) they resolve to the **same physical Docker volumes**:

| Volume (declared in both files) | Default-project volume | Shared? | Problem? |
|---|---|---|---|
| `postgres-volume` (app DB) | `postaryx-app_postgres-volume` | ✅ shared | ⚠️ **YES** — see below |
| `temporal-postgres-volume` | `postaryx-app_temporal-postgres-volume` | ✅ shared | ⚠️ **YES, same bug** — since P3-2b, dev and prod use *different* `POSTARYX_DEV_TEMPORAL_DB_PASSWORD` / `POSTARYX_TEMPORAL_DB_PASSWORD` (previously both were the literal `temporal`, so this used to be harmless) |
| `temporal-es-volume` | `postaryx-app_temporal-es-volume` | ✅ shared | harmless — no auth involved (`xpack.security.enabled=false`) |

> The default-project volume names above say `postaryx-app` because that name
> comes from the repo folder (`docker-compose`'s default project name is the
> directory basename) — see [CLAUDE.md](../CLAUDE.md). This differs from the
> explicit `-p postaryx-dev` / `-p postaryx-prod` names used everywhere else in
> this guide, which is exactly the source of the confusion this doc exists to
> prevent.

The app's Postgres is the problem, because **dev and prod use different
credentials**:

| | User | Password | DB |
|---|---|---|---|
| **Dev** (`docker-compose.dev.yaml` + `.env`) | `POSTARYX_DEV_DB_USER` | `POSTARYX_DEV_DB_PASSWORD` | `POSTARYX_DEV_DB_NAME` |
| **Prod** (`docker-compose.yaml` + `.env`) | `POSTARYX_DB_USER` | `POSTARYX_DB_PASSWORD` | `POSTARYX_DB_NAME` |

Both rows are `${...}`-substituted from the same repo-root `.env` (see
[1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P0-2) — the
prefixes keep them distinct even though both stacks read the same file.

The official `postgres` image only runs its initialization (which **creates the
user/password from `POSTGRES_USER`/`POSTGRES_PASSWORD`**) **when the data
directory is empty** — i.e. the very first time the volume is used. On every later
start it sees existing data and **skips** init.

So, the breaking sequence:

1. You run **dev** first → `postgres-volume` is initialized with the
   `POSTARYX_DEV_DB_USER` role. Works fine.
2. You `down` dev, run **prod** (same default project → same volume) → Postgres
   sees existing data, **skips** init, so the `POSTARYX_DB_USER` role is **never
   created**. Prod connects with the wrong credentials and you get:

   ```
   FATAL: password authentication failed for user "<POSTARYX_DB_USER value>"
   # (or)  role "<POSTARYX_DB_USER value>" does not exist
   ```
   `prisma-db-push` and the backend fail to start.

> On this machine there is already a `postaryx-app_postgres-volume` (initialized by
> a prior dev run), so a prod run with the default project name **would** hit this
> immediately. That's exactly the situation this guide prevents.

The identical failure mode now also applies to **Temporal's own Postgres**
(`temporal-postgres-volume`) — same first-init-wins behavior, and dev/prod use
different passwords for it since P3-2b. Project isolation (§3) fixes both at
once; there's nothing Temporal-specific to do beyond that.

---

## 3. The fix: isolate by project name (recommended)

Give each stack its own project with `-p`. Volumes then become
`postaryx-dev_postgres-volume` and `postaryx-prod_postgres-volume` — **completely
separate**. Each stack initializes its own DB with its own credentials, once, and
keeps it. No clashes, no data loss on switching.

```bash
# ---- DEV ----
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push    # only needed the first time (or after schema changes)
pnpm run dev
# ... work ...
docker compose -p postaryx-dev -f docker-compose.dev.yaml down

# ---- PROD ----
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
# ... verify at http://localhost:4007 ...
docker compose -p postaryx-prod down
```

⚠️ **Be consistent.** Every command for a stack must carry the same `-p`. For
example `docker compose down` *without* `-p` targets the default `postaryx-app`
project, not `postaryx-prod` — so it won't stop what you started.

---

## 4. The exact scenario you asked about: dev → prod → dev again

With project isolation, this is clean and **no auth error ever**:

```bash
# 1) DEV
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push        # first time only
pnpm run dev                   # Ctrl-C when done
docker compose -p postaryx-dev -f docker-compose.dev.yaml down

# 2) PROD
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d            # creates its OWN db on first run
# check http://localhost:4007
docker compose -p postaryx-prod down

# 3) DEV again — your dev DB is still there, untouched
docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d
pnpm run dev                   # no prisma-db-push needed; schema/data persisted
```

Why it works: step 2 uses `postaryx-prod_*` volumes, so it never touches the
`postaryx-dev_*` data from step 1. Step 3 finds your dev DB exactly as you left it.

> First time you `up` **prod**, give it ~30–60s: it pulls the CI-built image
> (no local build — see README.md §3), runs `prisma-db-push` automatically
> (prod self-migrates on boot), and boots Temporal.

---

## 5. Make it automatic (optional one-time edit)

Typing `-p` every time is a footgun. You can bake the project name into each file
with the top-level **`name:`** key, then plain commands isolate correctly:

```yaml
# docker-compose.yaml      (prod) — add at the very top:
name: postaryx-prod

# docker-compose.dev.yaml  (dev)  — add at the very top:
name: postaryx-dev
```

After that:
```bash
docker compose up -d                               # → project postaryx-prod
docker compose -f docker-compose.dev.yaml up -d    # → project postaryx-dev
```
No `-p` needed, and they can never share volumes.

> ⚠️ **Migration note:** your existing data lives in the **old** default-project
> volumes (`postaryx-app_*`). After adding `name:`, the stacks point at new
> `postaryx-dev_*` / `postaryx-prod_*` volumes, which start **empty** — so re-run
> `pnpm run prisma-db-push` for dev and re-register. Your old data isn't deleted;
> it's just no longer referenced (clean it up later with `docker volume rm
> postaryx-app_postgres-volume …` once you're sure you don't need it).

Ask and I can apply this edit for you.

---

## 6. Other ways to fix it (and when to use them)

| Approach | How | Use when |
|---|---|---|
| **Separate projects** (recommended) | `-p postaryx-dev` / `-p postaryx-prod`, or `name:` in files | Always. Keeps both DBs, clean switching. |
| **Wipe on switch** | `docker compose down -v` before switching | You don't care about the other stack's data; quick and dirty. |
| **Align credentials** | Set `POSTARYX_DEV_DB_USER`/`POSTARYX_DEV_DB_PASSWORD` in `.env` to match `POSTARYX_DB_USER`/`POSTARYX_DB_PASSWORD` | You *want* one shared DB across both. Rare; mixes concerns. |

`down -v` deletes that project's named volumes (DB, Redis, Temporal pg + es). Only
use it when you intend to throw the data away. After a `-v` you'll re-run
`prisma-db-push` (dev) — prod re-migrates itself on next boot.

---

## 7. Inspecting & cleaning up

```bash
# What's running, and under which project?
docker compose -p postaryx-dev  -f docker-compose.dev.yaml ps
docker compose -p postaryx-prod ps

# See which volumes exist (note the project prefix)
docker volume ls | grep -E 'postiz|postaryx|temporal'

# Tail logs for a stack
docker compose -p postaryx-prod logs -f postaryx

# Remove a stack entirely, including its data
docker compose -p postaryx-prod down -v
```

---

## Cheat sheet

| Goal | Command |
|---|---|
| Start dev deps | `docker compose -p postaryx-dev -f docker-compose.dev.yaml up -d` |
| Run dev apps | `pnpm run prisma-db-push` (first time) → `pnpm run dev` |
| Stop dev | `docker compose -p postaryx-dev -f docker-compose.dev.yaml down` |
| Start/verify prod | `docker compose -p postaryx-prod pull postaryx && docker compose -p postaryx-prod up -d` → http://localhost:4007 |
| Stop prod | `docker compose -p postaryx-prod down` |
| Never | run both stacks at the same time |
| Never | use the default project for both (causes the auth error) |
</content>
