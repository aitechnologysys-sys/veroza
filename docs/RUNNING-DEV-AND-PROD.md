# Running Dev and Prod on the Same Machine (and switching between them)

You have two stacks in this repo:

- **Dev** — [docker-compose.dev.yaml](../docker-compose.dev.yaml) (deps only) +
  `pnpm run dev` on the host. Hot-reload. See [LOCAL-DEVELOPMENT.md](./LOCAL-DEVELOPMENT.md).
- **Prod** — [docker-compose.yaml](../docker-compose.yaml). One command builds and
  runs the whole app in Docker. See [INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md).

This guide answers: **can I run one, then the other, then go back — without breaking
the database?** Short answer: **yes, if you isolate them by Docker Compose
*project***. If you don't, switching to the other stack throws a Postgres auth
error. Here's exactly why, and how to do it cleanly.

---

## TL;DR (the golden rule)

> **Give each stack its own Compose project name, and never run both at once.**

```bash
# DEV  (deps in Docker, app on host)
docker compose -p postiz-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push      # first time / after schema changes
pnpm run dev
# stop it:
docker compose -p postiz-dev -f docker-compose.dev.yaml down

# PROD (everything in Docker; pulls a CI-built image, does NOT build)
docker compose -p postiz-prod pull postiz
docker compose -p postiz-prod up -d
# stop it:
docker compose -p postiz-prod down
```

Always pass the **same `-p <name>`** to every command for that stack (`up`,
`down`, `logs`, `ps`). With separate projects, dev and prod keep **separate
volumes**, so you can switch back and forth forever with no auth errors and no
data loss. (Prefer not typing `-p` every time? See
[Make it automatic](#make-it-automatic-optional-one-time-edit).)

---

## 1. Why you can't run both **at the same time**

Even with separate projects, the two stacks collide if run simultaneously:

- **Published ports overlap:** both publish Temporal `7233` and Temporal UI
  `8080` (dev also publishes `5432`, `6379`, `8082`, `5540`; prod also `4007`,
  `8969`).
- **Container names are hardcoded and global:** both files set
  `container_name: postiz-postgres`, `temporal`, `temporal-ui`, etc.
  `container_name` is **not** namespaced by project, so the second stack fails
  with *"container name already in use"*.

So the rule is **one stack at a time**: `down` the current one before `up`-ing the
other. (That's fine — you don't need both running.)

---

## 2. Why naive switching **breaks the database** (the auth error)

This is the part that bites people. Both compose files declare the **same volume
names**, and with the **default** project name (`postiz-app`, taken from the repo
folder) they resolve to the **same physical Docker volumes**:

| Volume (declared in both files) | Default-project volume | Shared? | Problem? |
|---|---|---|---|
| `postgres-volume` (app DB) | `postiz-app_postgres-volume` | ✅ shared | ⚠️ **YES** — see below |
| `temporal-postgres-volume` | `postiz-app_temporal-postgres-volume` | ✅ shared | harmless (same creds) |
| `temporal-es-volume` | `postiz-app_temporal-es-volume` | ✅ shared | harmless |

The app's Postgres is the problem, because **dev and prod use different
credentials**:

| | User | Password | DB |
|---|---|---|---|
| **Dev** (`docker-compose.dev.yaml` + `.env`) | `postiz-local` | `postiz-local-pwd` | `postiz-db-local` |
| **Prod** (`docker-compose.yaml` env override) | `postiz-user` | `postiz-password` | `postiz-db-local` |

The official `postgres` image only runs its initialization (which **creates the
user/password from `POSTGRES_USER`/`POSTGRES_PASSWORD`**) **when the data
directory is empty** — i.e. the very first time the volume is used. On every later
start it sees existing data and **skips** init.

So, the breaking sequence:

1. You run **dev** first → `postgres-volume` is initialized with role
   `postiz-local`. Works fine.
2. You `down` dev, run **prod** (same default project → same volume) → Postgres
   sees existing data, **skips** init, so role `postiz-user` is **never created**.
   Prod connects with `postiz-user:postiz-password` and you get:

   ```
   FATAL: password authentication failed for user "postiz-user"
   # (or)  role "postiz-user" does not exist
   ```
   `prisma-db-push` and the backend fail to start.

> On this machine there is already a `postiz-app_postgres-volume` (initialized by
> a prior dev run), so a prod run with the default project name **would** hit this
> immediately. That's exactly the situation this guide prevents.

---

## 3. The fix: isolate by project name (recommended)

Give each stack its own project with `-p`. Volumes then become
`postiz-dev_postgres-volume` and `postiz-prod_postgres-volume` — **completely
separate**. Each stack initializes its own DB with its own credentials, once, and
keeps it. No clashes, no data loss on switching.

```bash
# ---- DEV ----
docker compose -p postiz-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push    # only needed the first time (or after schema changes)
pnpm run dev
# ... work ...
docker compose -p postiz-dev -f docker-compose.dev.yaml down

# ---- PROD ----
docker compose -p postiz-prod pull postiz
docker compose -p postiz-prod up -d
# ... verify at http://localhost:4007 ...
docker compose -p postiz-prod down
```

⚠️ **Be consistent.** Every command for a stack must carry the same `-p`. For
example `docker compose down` *without* `-p` targets the default `postiz-app`
project, not `postiz-prod` — so it won't stop what you started.

---

## 4. The exact scenario you asked about: dev → prod → dev again

With project isolation, this is clean and **no auth error ever**:

```bash
# 1) DEV
docker compose -p postiz-dev -f docker-compose.dev.yaml up -d
pnpm run prisma-db-push        # first time only
pnpm run dev                   # Ctrl-C when done
docker compose -p postiz-dev -f docker-compose.dev.yaml down

# 2) PROD
docker compose -p postiz-prod pull postiz
docker compose -p postiz-prod up -d            # creates its OWN db on first run
# check http://localhost:4007
docker compose -p postiz-prod down

# 3) DEV again — your dev DB is still there, untouched
docker compose -p postiz-dev -f docker-compose.dev.yaml up -d
pnpm run dev                   # no prisma-db-push needed; schema/data persisted
```

Why it works: step 2 uses `postiz-prod_*` volumes, so it never touches the
`postiz-dev_*` data from step 1. Step 3 finds your dev DB exactly as you left it.

> First time you `up` **prod**, give it ~30–60s: it builds the image, runs
> `prisma-db-push` automatically (prod self-migrates on boot), and boots Temporal.

---

## 5. Make it automatic (optional one-time edit)

Typing `-p` every time is a footgun. You can bake the project name into each file
with the top-level **`name:`** key, then plain commands isolate correctly:

```yaml
# docker-compose.yaml      (prod) — add at the very top:
name: postiz-prod

# docker-compose.dev.yaml  (dev)  — add at the very top:
name: postiz-dev
```

After that:
```bash
docker compose up -d                               # → project postiz-prod
docker compose -f docker-compose.dev.yaml up -d    # → project postiz-dev
```
No `-p` needed, and they can never share volumes.

> ⚠️ **Migration note:** your existing data lives in the **old** default-project
> volumes (`postiz-app_*`). After adding `name:`, the stacks point at new
> `postiz-dev_*` / `postiz-prod_*` volumes, which start **empty** — so re-run
> `pnpm run prisma-db-push` for dev and re-register. Your old data isn't deleted;
> it's just no longer referenced (clean it up later with `docker volume rm
> postiz-app_postgres-volume …` once you're sure you don't need it).

Ask and I can apply this edit for you.

---

## 6. Other ways to fix it (and when to use them)

| Approach | How | Use when |
|---|---|---|
| **Separate projects** (recommended) | `-p postiz-dev` / `-p postiz-prod`, or `name:` in files | Always. Keeps both DBs, clean switching. |
| **Wipe on switch** | `docker compose down -v` before switching | You don't care about the other stack's data; quick and dirty. |
| **Align credentials** | Make dev `.env` + dev compose use `postiz-user`/`postiz-password` (match prod) | You *want* one shared DB across both. Rare; mixes concerns. |

`down -v` deletes that project's named volumes (DB, Redis, Temporal pg + es). Only
use it when you intend to throw the data away. After a `-v` you'll re-run
`prisma-db-push` (dev) — prod re-migrates itself on next boot.

---

## 7. Inspecting & cleaning up

```bash
# What's running, and under which project?
docker compose -p postiz-dev  -f docker-compose.dev.yaml ps
docker compose -p postiz-prod ps

# See which volumes exist (note the project prefix)
docker volume ls | grep -E 'postiz|temporal'

# Tail logs for a stack
docker compose -p postiz-prod logs -f postiz

# Remove a stack entirely, including its data
docker compose -p postiz-prod down -v
```

---

## Cheat sheet

| Goal | Command |
|---|---|
| Start dev deps | `docker compose -p postiz-dev -f docker-compose.dev.yaml up -d` |
| Run dev apps | `pnpm run prisma-db-push` (first time) → `pnpm run dev` |
| Stop dev | `docker compose -p postiz-dev -f docker-compose.dev.yaml down` |
| Start/verify prod | `docker compose -p postiz-prod pull postiz && docker compose -p postiz-prod up -d` → http://localhost:4007 |
| Stop prod | `docker compose -p postiz-prod down` |
| Never | run both stacks at the same time |
| Never | use the default project for both (causes the auth error) |
</content>
