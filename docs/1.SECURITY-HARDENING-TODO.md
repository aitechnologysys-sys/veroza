# Security Hardening — TODO

Working checklist from an audit on 8 Aug 2026. Ordered by priority: **P0 items are
live exposures**, P3 is hygiene. Each item says what to do, why, and how to
verify. Tick boxes as you go.

Nothing here is blocking the deployment work — but P0 should land before the
first real customer.

**Context that makes several of these urgent:** `aitechnologysys-sys/veroza` is a
**public** repo, so every committed file is world-readable.

---

## Start here — see the database locally

Do this first. It costs nothing, and P0-2 and P1-2 are much easier to reason
about once you've actually looked at the data.

Postgres deliberately publishes **no host port** (`docker inspect` shows
`{"5432/tcp":null}`), so DBeaver cannot reach `localhost:5432`. Bridge it with a
throwaway container — no tracked file is touched, and it disappears on stop:

```bash
# prod-local stack must be running: docker compose -p postiz-prod up -d
docker run -d --rm --name pg-bridge \
  --network postiz-prod_postiz-network \
  -p 127.0.0.1:5433:5433 \
  alpine/socat tcp-listen:5433,fork,reuseaddr tcp-connect:postiz-postgres:5432
```

DBeaver → **New Connection → PostgreSQL**:

| Field | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` |
| Database | `postiz-db-prod` |
| Username | `postiz-user` |
| Password | `postiz-password` |

Verified working: real PostgreSQL handshake on `127.0.0.1:5433`, 69 tables.

Tear down with `docker stop pg-bridge`.

⚠️ **Dev and prod are different databases with different credentials.** Don't
mix them up:

| | `postiz-dev` | `postiz-prod` |
|---|---|---|
| Port | `5432`, already published | none — bridge on `5433` |
| Database | `postiz-db-local` | `postiz-db-prod` |
| User / password | `postiz-local` / `postiz-local-pwd` | `postiz-user` / `postiz-password` |

For the **dev** database you need no bridge — connect straight to
`localhost:5432`. Using 5433 for prod-local lets you save both in DBeaver
without a clash.

---

# P0 — live credential exposure

## [ ] P0-1. Rotate everything that was in `.env.prod`

`.env.prod` was committed in **`1195455e`** and removed in `da0cb264`.
`1195455e` is an ancestor of `main` in a **public** repo, so its contents are
readable right now at
`github.com/aitechnologysys-sys/veroza/commit/1195455e`.

Inspect it (do **not** paste values into a chat or ticket):

```bash
git show 1195455e:.env.prod
```

~47 keys. Rotate in this order:

1. **`JWT_SECRET`** — forges a session for any account. Rotating logs everyone
   out; that is the point.
2. **`DATABASE_URL` password**, **`RESEND_API_KEY`**, **`EMAIL_PASS`** — data
   access and outbound-email abuse from your domain.
3. **`POLAR_ACCESS_TOKEN`**, **`POLAR_WEBHOOK_SECRET`**, and any `STRIPE_*` —
   billing.
4. **`CLOUDFLARE_*`**, **`NGROK_AUTHTOKEN`**, **`OPENAI_API_KEY`** — cost abuse.
5. All social `*_CLIENT_SECRET` / `X_API_SECRET` — regenerate in each developer
   console.

**Do not** try to fix this by rewriting history. The commit has been public,
GitHub caches commit objects independently of branches, and any clone or fork
keeps it. Rotation is the only reliable remediation.

**How to apply a rotation:** edit `.env.prod` on the VM, then
`docker compose -p postiz up -d postiz`. No rebuild, no re-pull — config is read
at container start. Seconds.

## [ ] P0-2. Get database passwords out of the committed compose file

`docker-compose.yaml` is public and contains:

```yaml
POSTGRES_PASSWORD: postiz-password    # line 109 — the app database
POSTGRES_PASSWORD: temporal          # line 165 — temporal's database
```

**Currently contained**, not yet a breach: neither Postgres nor Redis publishes a
host port, so they are only reachable from inside the `postiz-network` bridge.
But they are publicly-documented credentials guarding your data, so any foothold
on the box or in any container needs no password guessing — and the moment
someone publishes 5432 for debugging (see P1-2!) it becomes directly exploitable.

Replace the literals with substitution sourced from the **uncommitted** `.env`:

```yaml
# docker-compose.yaml
postiz-postgres:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
    POSTGRES_USER: ${POSTGRES_USER:-postiz-user}
    POSTGRES_DB: ${POSTGRES_DB:-postiz-db-prod}
```

The `:?` form makes Compose refuse to start with a clear error if it's unset —
better than silently defaulting to a weak value. Put the real values in `.env`
(already gitignored) and update `DATABASE_URL` in the `postiz` service to match.

🔴 **Critical ordering detail:** `POSTGRES_PASSWORD` only takes effect when the
data directory is **first initialised**. On an existing volume, changing it does
nothing — you must either:

```bash
docker exec -it postiz-postgres psql -U postiz-user -d postiz-db-prod \
  -c "ALTER USER \"postiz-user\" WITH PASSWORD 'new-strong-password';"
```

…or destroy the volume and start fresh (`docker compose -p postiz down -v`,
which **deletes all data**). **Do this while pre-launch** — it is nearly free
today and a migration exercise once you have customers.

## [ ] P0-3. Turn on GitHub Secret scanning and Push protection

Both are free on public repos. Push protection blocks a future `.env` at push
time instead of you finding it months later.

Settings → **Code security and analysis** → enable **Secret scanning** and
**Push protection**.

## [ ] P0-4. Review who can actually push

I could not check this — the API returned `403 Must have push access to view
repository collaborators`, because the `gh` CLI here is authenticated as
`koushik-kumar-deb`, which has no write access to this repo.

Settings → **Collaborators and teams**. Confirm the list is only who you expect.

> Note: the ~72 "contributors" on the repo and package pages are **not** an
> access list. They are authors of commits in the inherited Postiz history
> (`nevo-david` alone has 1,435). Authorship implies zero permissions. Ignore
> that number; check the collaborators list instead.

---

# P1 — network exposure

## [ ] P1-1. Bind the dev stack's ports to loopback

`docker-compose.dev.yaml` publishes **six ports on `0.0.0.0`** — every interface,
including whatever Wi-Fi you're on:

| Service | Port | What it is |
|---|---|---|
| `postiz-postgres` | `5432:5432` | **database**, credentials in the public repo |
| `postiz-redis` | `6379:6379` | **Redis, no password at all** |
| `postiz-pg-admin` | `8082:80` | **pgAdmin web UI** |
| `postiz-redisinsight` | `5540:5540` | **RedisInsight web UI** |
| `temporal` | `7233:7233` | Temporal gRPC, no auth |
| `temporal-ui` | `8080:8080` | Temporal web UI, no auth |

On a home network that's low risk. On café/hotel/conference Wi-Fi, anyone on the
LAN can reach your database and two admin UIs. The production compose already
gets this right — all three of its published ports are `127.0.0.1`-bound.

Fix: prefix every one with `127.0.0.1:`.

```yaml
ports:
  - '127.0.0.1:5432:5432'
```

Verify:

```bash
node -e '
const y=require("yaml"),fs=require("fs");
const d=y.parse(fs.readFileSync("docker-compose.dev.yaml","utf8"));
for(const [n,s] of Object.entries(d.services||{}))
  for(const p of (s.ports||[]))
    console.log((String(p).startsWith("127.0.0.1")?"OK  ":"OPEN")+"  "+n+"  "+p);'
```

Every line should read `OK`.

## [ ] P1-2. Loopback-publish Postgres in production, for DBeaver

This is the production answer to "how do I connect DBeaver," and it must be done
the same way `temporal-ui` already is.

🔴 **Never write `ports: - "5432:5432"` on the VM.** Docker writes its own
iptables rules and **bypasses `ufw`**, so that publishes your database straight
to the internet — guarded by a password that is in a public repo (P0-2). This is
the single most dangerous change you could make to this stack.

The safe pattern, exactly mirroring `temporal-ui`:

```yaml
# docker-compose.yaml, on the VM
postiz-postgres:
  ports:
    # Loopback-ONLY. The leading 127.0.0.1 is the entire security control:
    # it binds to the VM's internal interface, unreachable from outside.
    # Reach it through an SSH tunnel — same approach as temporal-ui:8080.
    - '127.0.0.1:5432:5432'
```

Then from your Mac, either tunnel manually:

```bash
ssh -i your-key.key -L 5434:127.0.0.1:5432 ubuntu@<VM_PUBLIC_IP>
# leave that running, then point DBeaver at 127.0.0.1:5434
```

…or let DBeaver do it (nicer — it reconnects for you):

**DBeaver → connection → SSH tab**

| Field | Value |
|---|---|
| Use SSH Tunnel | ✅ |
| Host / Port | `<VM_PUBLIC_IP>` / `22` |
| User Name | `ubuntu` |
| Authentication | Public Key → your `.key` file |

**Main tab**

| Field | Value |
|---|---|
| Host | `127.0.0.1` ← resolved *on the VM*, after the tunnel |
| Port | `5432` |
| Database | `postiz-db-prod` |
| Username | `postiz-user` |
| Password | the rotated one from P0-2 |

Verify from your Mac that the port is **not** open publicly:

```bash
nc -z -w5 <VM_PUBLIC_IP> 5432 && echo "EXPOSED — fix immediately" || echo "OK: not reachable"
```

Two habits for production access:

- Do P0-2 **before** enabling this. Don't tunnel to a database whose password is
  on GitHub.
- In DBeaver set the **connection type to Production** — it colours the UI red
  and prompts before writes.

## [ ] P1-3. Give Redis a password and a memory cap

`postiz-redis` currently has **no `requirepass`, no `maxmemory`, and no eviction
policy** — it will grow until the box runs out of RAM. (The memory half is also
`CONTAINMENT-DEPLOYMENT-PLAN.md` §3c.)

```yaml
postiz-redis:
  image: redis:7.2
  command:
    - redis-server
    - --requirepass
    - ${REDIS_PASSWORD:?set REDIS_PASSWORD in .env}
    - --maxmemory
    - 256mb
    - --maxmemory-policy
    - allkeys-lru
```

Then update `REDIS_URL` in the `postiz` service to
`redis://:${REDIS_PASSWORD}@postiz-redis:6379`. Restart and confirm the app still
queues posts — a wrong URL fails at runtime, not at boot.

Watch actual usage before trusting 256 MB:

```bash
docker exec postiz-redis redis-cli -a "$REDIS_PASSWORD" info memory | grep used_memory_human
```

---

# P2 — application configuration

## [ ] P2-1. Close public registration

```yaml
DISABLE_REGISTRATION: 'false'   # docker-compose.yaml line 64
```

Anyone who finds the URL can create an account. Fine while nobody knows the
domain; not fine once it's public and you're paying for AI calls per user. Set to
`'true'` as soon as your own accounts exist.

## [ ] P2-2. Keep `NOT_SECURED` unset in production — verify, don't assume

Currently correct: not present in `docker-compose.yaml`, and commented out in
`.env.example`. Worth knowing what it does, because setting it would be severe —
it drops `credentials: true` from CORS **and** exposes `auth`, `showorg` and
**`impersonate`** headers (`apps/backend/src/main.ts:26-43`).

```bash
docker exec postiz printenv NOT_SECURED || echo "OK: unset"
```

CORS itself is fine — restricted to `FRONTEND_URL` and `MAIN_URL`, no wildcard.
Auth cookies are `secure: true, httpOnly: true, sameSite: 'none'`. No action.

## [ ] P2-3. Add security headers at the host nginx

The container's nginx sets `X-Content-Type-Options` and a CSP, but **only on the
`/uploads/` block**. The app itself gets none.

The host nginx terminates TLS, so that's the right place for HSTS. Add to the
vhost from `ORACLE-VM-DEPLOYMENT.md` §7, *after* Certbot works:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
server_tokens off;
```

Don't add HSTS before HTTPS works — you'll lock yourself out of the plain-HTTP
version while debugging.

---

# P3 — hygiene and operations

## [ ] P3-1. Run a dependency audit

`pnpm audit` timed out during this session, so it's unmeasured. Run it properly
and triage:

```bash
pnpm audit --audit-level high
```

Dependabot config exists (`.github/Dependabot.yml`) and CodeQL runs on `main`.

## [ ] P3-2. Cap Docker logs on the VM

Unbounded JSON logs are a common cause of a full disk.
`CONTAINMENT-DEPLOYMENT-PLAN.md` §5:

```json
/* /etc/docker/daemon.json */
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

```bash
sudo systemctl restart docker   # restarts all containers — maintenance window
```

## [ ] P3-3. Drop `temporal-elasticsearch`

Still in the stack. Removing it frees ~1.1 GB **and** removes an
unauthenticated Elasticsearch from your Docker network. Full instructions:
`CONTAINMENT-DEPLOYMENT-PLAN.md` §3a. Test on staging first.

## [ ] P3-4. Off-box backups, and rehearse one restore

Specified in `ORACLE-VM-DEPLOYMENT.md` §12. An unrehearsed backup is not a
backup. Also relevant to P0-2: verify a dump still restores after you change the
Postgres password.

## [ ] P3-5. Keep GHCR package visibility matched to the repo

The package is public, which is correct and free while the repo is public.
`Dockerfile.dev` copies the whole repo into the image, so **a public image
publishes your source**.

🔴 If this repo is ever made private, make the package private in the same
sitting — changing repo visibility does **not** change package visibility.
`github.com/users/aitechnologysys-sys/packages/container/veroza/settings`

---

## Verified fine — no action needed

Recorded so nobody re-audits them:

- **CORS** — restricted to `FRONTEND_URL` + `MAIN_URL`, no wildcard.
- **Auth cookies** — `secure`, `httpOnly`, `sameSite: 'none'`.
- **Production published ports** — all three are `127.0.0.1`-bound.
- **Secrets in the image** — 4 env vars total, only `NEXT_PUBLIC_VERSION`.
  `.dockerignore` excludes `.env*`, and `.env.prod` is untracked, so CI cannot
  bake secrets in.
- **Rate limiting** — NestJS `ThrottlerModule` is active.
- **No telemetry to upstream** — see `UPSTREAM-ISOLATION.md`.
- **Upstream push blocked** — `upstream` remote's push URL is `DISABLED`. Note
  this is per-clone `.git/config` and does **not** survive a fresh clone.

---

**Related:** [CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md) ·
[CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) ·
[ORACLE-VM-DEPLOYMENT.md](./ORACLE-VM-DEPLOYMENT.md) ·
[UPSTREAM-ISOLATION.md](./UPSTREAM-ISOLATION.md)
