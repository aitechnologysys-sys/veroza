# Deploying Postiz on an Oracle Cloud Ubuntu VM

> A production-ready, single-app deployment guide for running Postiz on an Oracle
> Cloud **Ampere A1 (ARM64) Ubuntu** VM behind a host Nginx + Let's Encrypt, with
> conventions that scale to 2–3 apps on the same box later.
>
> Companion to [INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md),
> which explains **what** each container is. This doc explains **how to operate
> the stack on the host**.

---

## 0. What you're deploying (the 30-second model)

Postiz ships as **one Docker image running three Node processes** behind an
**internal Nginx**, plus its data/infra dependencies:

```
                          ┌──────────────────────────────────────────────┐
  Browser ─ HTTPS ─▶ host │  postaryx  (single container)                  │
   (nginx :443)      nginx│   internal nginx :5000  (the only exposed     │
        │            ─────▶│     │                    port → host :4007)   │
        │                  │     ├── /        → frontend (Next.js :4200)  │
        │                  │     ├── /api/    → backend  (NestJS  :3000)  │
        │                  │     └── /uploads → local disk                │
        │                  │   orchestrator (Temporal worker :3002)        │
        │                  │   (all 3 managed by pm2)                      │
        │                  └────┬───────────────┬───────────────┬─────────┘
        │                  ┌────▼────┐    ┌──────▼──────┐  ┌─────▼─────────┐
        │                  │ postgres│    │   redis     │  │ Temporal (×5) │
        │                  └─────────┘    └─────────────┘  └───────────────┘
```

Two consequences that drive every decision below:

1. **Postiz already routes `/` and `/api` internally**, so the host only proxies
   **one** upstream port (`127.0.0.1:4007`).
2. **It pulls a CI-built image** (built from `Dockerfile.dev` in GitHub
   Actions — never on this box) and **self-migrates the DB on boot**
   (`prisma-db-push`). The full stack is **8 containers** (app + Postgres +
   Redis + a 5-container Temporal stack including Elasticsearch). Budget
   ~3–4 GB RAM steady-state for Postiz alone.

---

## 1. Architecture decisions (and why)

| Decision | Choice | Why this over the alternative |
|---|---|---|
| **Reverse proxy** | **Nginx on the host** (systemd) + Certbot | One auto-renewing cert store for all current/future apps; decoupled from app rebuilds; trivial to add vhosts. Traefik/Caddy-in-Docker only pay off at ~10+ apps and couple every app onto a shared proxy network. |
| **Docker networks** | **One bridge network per project** (the default) | Keeps each app isolated (security + no DNS collisions). The host Nginx bridges apps at the loopback layer, so they never need to share a network. |
| **Auto-updates (Watchtower)** | **No** | Postiz runs DB migrations on boot — an unattended update could migrate/break production even though it's just a pull now (no local build). Use deliberate `git pull && docker compose pull` with a rollback path. |
| **Domains** | **Single domain** for Postiz | Postiz's internal Nginx already serves `/api`. Splitting into `api.*` would force internal-nginx edits + cross-origin cookies/CORS for zero benefit. (Multi-domain pattern below is for *future, separate* apps.) |

### Three gotchas that dominate this setup

1. **Docker bypasses the host firewall.** A container port published to `0.0.0.0`
   is reachable from the internet **even if `ufw` denies it** — Docker inserts its
   own iptables `DOCKER` chain. **Fix: bind every container port to `127.0.0.1`**
   and let host Nginx be the only public listener.
2. **OCI Security Lists / NSGs are a second firewall** at the VCN level. Ports
   80/443 must be opened there too, or traffic never reaches the VM.
3. **Ubuntu uses AppArmor, not SELinux** — it does *not* block Nginx→upstream
   proxying, so no `setsebool` step is needed (that's an Oracle-Linux-only step).

---

## 2. Phase 0 — Tear down the previous app (if replacing one)

> Skip this section on a fresh VM. Run it to remove a prior disposable stack
> (here: `ai-chatbot-backend`). **`down -v` permanently deletes that app's data.**

```bash
ssh -i your-key.key ubuntu@<VM_PUBLIC_IP>

# Locate its compose file (contexts like ../services/* mean it lives in a subdir)
find ~ -maxdepth 4 -name 'docker-compose*.y*ml' 2>/dev/null
docker ps --format '{{.Names}}'        # confirm the containers to remove

# Tear down from the compose dir — removes containers, named volumes, AND images
cd <path-to-that-compose-dir>
docker compose down -v --rmi all --remove-orphans

# Safety net if anything survives a project-name mismatch (adjust names):
docker rm -f $(docker ps -aq --filter 'name=unified_') 2>/dev/null
docker network rm unified_network 2>/dev/null
docker volume ls         # then: docker volume rm <leftover>
docker images            # then: docker rmi <leftover>

# Confirm the host is clean (the Docker daemon itself stays installed)
docker ps -a; docker volume ls; docker network ls; df -h
```

---

## 3. Server directory layout & naming conventions

```
/opt/
└── postaryx/
    └── postaryx-app/              # git clone of the Postiz repo
        ├── docker-compose.yaml    # edited for loopback ports + real URLs (§5, §7)
        ├── .env.prod              # secrets — chmod 600, NEVER committed
        └── ...
/opt/backups/postaryx/               # nightly DB + uploads dumps
/etc/nginx/sites-available/postaryx.conf   # symlinked into sites-enabled/
```

**Always run Postiz with an explicit compose project name** so its containers,
network, and volumes are namespaced (Postiz's Temporal containers are otherwise
unprefixed) and future apps can never collide:

```bash
cd /opt/postaryx/postaryx-app
docker compose -p postaryx pull postaryx
docker compose -p postaryx up -d
```

**Naming convention — apply to every app you add:**

| Resource | Pattern | Postiz example |
|---|---|---|
| Compose project | `<project>` | `postaryx` (via `-p postaryx`) |
| Container | `<project>-<role>` | `postaryx`, `postaryx-postgres`, `postaryx-redis` |
| Network | `<project>-<purpose>` | `postaryx-network`, `temporal-network` |
| Volume | `<project>-<purpose>` | `postgres-volume`, `postaryx-uploads` |

---

## 4. Get the code & configure secrets

```bash
sudo mkdir -p /opt/postaryx && sudo chown $USER:$USER /opt/postaryx
cd /opt/postaryx
git clone https://github.com/<your-fork>/postiz-app.git postaryx-app
cd postaryx-app
cp .env.prod.example .env.prod 2>/dev/null || cp .env.example .env.prod
chmod 600 .env.prod
```

In `.env.prod` set at minimum:
- `JWT_SECRET` — `openssl rand -base64 48`
- `IS_GENERAL=true`
- Any social/email/AI keys you use (blank disables that feature)
- Leave `DATABASE_URL` / `REDIS_URL` / `TEMPORAL_ADDRESS` alone — the compose
  `environment:` block overrides them to the correct container names.

> Keep a redacted `.env.prod.example` in git documenting which keys exist.

**Also required — Postgres, Redis, and Temporal's own DB password** (see
[1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P0-2/P1-3): create a
**plain `.env`** file next to `docker-compose.yaml` — a *different* file from
`.env.prod`, since Compose only reads `.env` for `${...}` substitution, never
`.env.prod` — with:
```bash
cat >> .env << 'EOF'
POSTARYX_DB_USER=postaryx-user
POSTARYX_DB_PASSWORD=<a-strong-generated-password>
POSTARYX_DB_NAME=postaryx-db-prod
POSTARYX_REDIS_PASSWORD=<a-strong-generated-password>
POSTARYX_TEMPORAL_DB_PASSWORD=<a-strong-generated-password>
EOF
chmod 600 .env
```
Compose refuses to start without these (`:?` substitution) rather than falling
back to a weak default — see P0-2/P1-3 in the same doc. §7 below appends
`POSTARYX_PUBLIC_URL` to this same
file once you have a domain — don't overwrite it, append to it.

---

## 5. Port allocation & loopback binding

Reserve a 100-port block per app, and **bind every Postiz container port to
`127.0.0.1`** so only host Nginx faces the internet.

| Project | Loopback entry | Public hostname |
|---|---|---|
| **postaryx** | `127.0.0.1:4007` | `postaryx.example.com` |
| future app2 | `127.0.0.1:81xx` | app2 domain(s) |

These edits are already applied to `docker-compose.yaml` in this repo:

```yaml
postaryx:        ports: ["127.0.0.1:4007:5000"]   # entry point, loopback-only
postaryx-postgres:  ports: ["127.0.0.1:5432:5432"]  # loopback-only, for DBeaver
postaryx-redis:  ports: ["127.0.0.1:6379:6379"]  # loopback-only, for GUI clients
temporal:      ports: ["127.0.0.1:7233:7233"]
temporal-ui:   ports: ["127.0.0.1:8080:8080"]   # reach via SSH tunnel
# spotlight service removed (dev-only error viewer)
```

To reach the Temporal UI for debugging, SSH-tunnel it:
```bash
ssh -i your-key.key -L 8080:127.0.0.1:8080 ubuntu@<VM_PUBLIC_IP>
# then open http://localhost:8080 in your local browser
```

Same pattern for Postgres — see [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md)
P1-2 for the full DBeaver-over-SSH-tunnel walkthrough.

---

## 6. Bring up the stack

> **Never build on this box.** `Dockerfile.dev` builds all three apps with a
> 4 GB Node heap; on a 12 GB instance that spikes to ~11.4 GB and can OOM the
> running stack. GitHub Actions builds the image and pushes it to GHCR — this
> server only ever pulls. If the package is still private you need a one-time
> `docker login ghcr.io` with a `read:packages` token first. See
> [../README.md](../README.md) §3–4 and
> [CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §6.

```bash
cd /opt/postaryx/postaryx-app
docker compose -p postaryx pull postaryx        # fetch the newest CI-built image
docker compose -p postaryx up -d
docker compose -p postaryx logs -f postaryx     # watch nginx + pm2 + prisma-db-push
docker compose -p postaryx ps                 # all required containers healthy/running
curl -I http://127.0.0.1:4007               # expect 200 once warmed up (~90s healthcheck)
```

---

## 7. Host Nginx reverse proxy

Install Nginx (if not present) and add a vhost. Because Postiz's internal Nginx
already splits `/` and `/api`, the host vhost is a thin pass-through to one
upstream.

```bash
sudo apt update && sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/postaryx.conf
```

`/etc/nginx/sites-available/postaryx.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name postaryx.example.com;

    client_max_body_size 2G;          # match Postiz's internal 2G upload limit

    location / {
        proxy_pass http://127.0.0.1:4007;     # Postiz's internal nginx does the rest
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # tells Postiz it's behind HTTPS
        proxy_set_header Upgrade $http_upgrade;        # websockets / live updates
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/postaryx.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default     # optional: drop the welcome page
sudo nginx -t && sudo systemctl reload nginx
```

**Set the public URL.** The compose `environment:` block reads a single
`POSTARYX_PUBLIC_URL` variable (defaulting to `http://localhost:4007` so the stack
also runs locally). Append it to the same `.env` file you created in §4 (next
to `docker-compose.yaml`, alongside `POSTARYX_DB_*` — don't overwrite it):
```bash
echo 'POSTARYX_PUBLIC_URL=https://postaryx.example.com' >> /opt/postaryx/postaryx-app/.env
```
This sets `MAIN_URL`, `FRONTEND_URL`, and `NEXT_PUBLIC_BACKEND_URL` (= URL + `/api`)
consistently. They're runtime values, so **no rebuild** is needed — just
`docker compose -p postaryx up -d postaryx`. A mismatch between this and the real
domain is the #1 cause of broken login and OAuth callbacks.

> Don't put `POSTARYX_PUBLIC_URL` in `.env.prod` — that file is injected into the
> container at runtime but is **not** read for `${...}` substitution. The public
> URL must be in `.env` (or the shell environment).

### Multi-domain pattern (for future, separate apps)

For an app whose frontend and backend are *separate* services, give each hostname
its own `server {}` block proxying to that service's loopback port — e.g.
`project2.com` → `127.0.0.1:8101`, `api.project2.com` → `127.0.0.1:8102`. Postiz
does **not** need this; one block is correct.

---

## 8. SSL with Let's Encrypt / Certbot

Create a DNS **A record** `postaryx.example.com → <VM_PUBLIC_IP>` (and `AAAA` if you
use IPv6) and wait for propagation (`dig postaryx.example.com`). Then:

```bash
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot

# Issues the cert and rewrites postaryx.conf for :443 with an 80→443 redirect
sudo certbot --nginx -d postaryx.example.com --redirect --agree-tos -m you@example.com

sudo systemctl status snap.certbot.renew.timer    # auto-renewal
sudo certbot renew --dry-run
```

Use this one Nginx + Certbot for every future app/domain — a single renewal
mechanism for all.

---

## 9. Firewall (two layers — both required)

**Layer A — OCI Security List / NSG (cloud).** VCN → your subnet's Security List →
**Ingress Rules** → add stateful `0.0.0.0/0 TCP 80` and `0.0.0.0/0 TCP 443`. Keep
SSH (22) restricted to your IP. Do **not** open 4007/5432/6379/7233/8080 —
they're loopback-only (`5432` since P1-2 for DBeaver, `6379` added later for
GUI Redis clients — see
[1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md)).

**Layer B — host firewall (`ufw`).**
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'        # 80 + 443
sudo ufw enable
sudo ufw status verbose
```

**Verify the loopback binding actually works** — from a machine *outside* the VM:
```bash
curl --max-time 5 http://<VM_PUBLIC_IP>:4007   # must TIME OUT
curl --max-time 5 http://<VM_PUBLIC_IP>:8080   # must TIME OUT
nc -z -w5 <VM_PUBLIC_IP> 5432 && echo "EXPOSED — fix immediately" || echo "OK: not reachable"
nc -z -w5 <VM_PUBLIC_IP> 6379 && echo "EXPOSED — fix immediately" || echo "OK: not reachable"
curl -I https://postaryx.example.com             # must return 200
```

---

## 10. Restart policies

All Postiz services use **`restart: unless-stopped`** (survives reboots, respects
a manual `docker compose stop`). Ensure the daemon starts on boot:
```bash
sudo systemctl enable --now docker
```

---

## 11. Logging strategy

Docker's default `json-file` logs grow unbounded and fill disks. Cap them
daemon-wide in `/etc/docker/daemon.json`:
```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```
```bash
sudo systemctl restart docker      # restarts all containers — use a maintenance window
```
- App logs (all three Node processes via pm2): `docker compose -p postaryx logs -f postaryx`
- Host Nginx: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`

---

## 12. Backups

Critical volumes: **`postgres-volume`** (all app data) and **`postaryx-uploads`**
(media, when `STORAGE_PROVIDER=local`). Temporal volumes are recommended.

`/opt/backups/postaryx/backup.sh` (`chmod +x`, run via root cron at 03:00):
```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%F)
DIR=/opt/backups/postaryx
mkdir -p "$DIR"
docker exec postaryx-postgres pg_dump -U postaryx-user postaryx-db-prod | gzip > "$DIR/db-$TS.sql.gz"
docker run --rm -v postaryx_postaryx-uploads:/u -v "$DIR":/b alpine \
  tar czf "/b/uploads-$TS.tar.gz" -C /u .
find "$DIR" -name '*.gz' -mtime +14 -delete    # keep 14 days
```
```bash
sudo crontab -e
# 0 3 * * * /opt/backups/postaryx/backup.sh >> /var/log/postaryx-backup.log 2>&1
```
> The uploads volume is named `postaryx_postaryx-uploads` (compose prepends the
> `-p postaryx` project name). Confirm with `docker volume ls`.

Copy `/opt/backups/` **off the VM** (OCI Object Storage via `oci os object put`,
or `rsync` elsewhere). **Test a restore at least once** — a backup you've never
restored is a hope, not a backup.

Restore outline:
```bash
gunzip -c db-YYYY-MM-DD.sql.gz | docker exec -i postaryx-postgres psql -U postaryx-user -d postaryx-db-prod
```

---

## 13. Environment variable management

- All secrets live in **`.env.prod`** — `chmod 600`, root-owned, git-ignored.
- Infra wiring (`DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`) is set in the
  compose `environment:` block, which **overrides** `.env.prod` — leave those alone.
- Public `*_URL`s and storage paths are also in `environment:` (runtime-read).
- Each future app keeps its own env file in its own `/opt/<app>` directory — never
  a shared global env.

---

## 14. Updating after new commits

Merging to `main` triggers the CI build (see §2a of
[INFRASTRUCTURE-AND-DEPLOYMENT.md](./INFRASTRUCTURE-AND-DEPLOYMENT.md) and
[CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md)) — the VM never builds, only pulls:

```bash
cd /opt/postaryx/postaryx-app
git pull                                      # picks up any tracked-file changes (compose, configs)
docker compose -p postaryx pull postaryx      # fetch the newest CI-built image
docker compose -p postaryx up -d postaryx     # recreate the app container; runs prisma-db-push
docker compose -p postaryx logs -f postaryx   # watch boot + migration
docker image prune -f                         # reclaim old image layers
```
Bump `version.txt` to show the new version in the UI — CI stamps it as
`<version.txt>-<short-sha>` (`NEXT_PUBLIC_VERSION`, the one build-time arg).

---

## 15. Zero-downtime deployment

**Option A — pre-pull, fast swap (recommended; ~seconds of blip):** the commands
in §14. The DB/Redis/Temporal containers keep running; only the app container
restarts, and host Nginx holds the connection during it.

**Option B — blue-green (true zero-downtime):**
1. Run a second app container on `127.0.0.1:4008` and health-check it.
2. Flip the host Nginx `proxy_pass` from `:4007` to `:4008` and `sudo systemctl reload nginx`.
3. Retire the old container.

**Migration caveat:** `prisma-db-push` runs on every app boot. Prefer
backward-compatible schema changes, and **back up the DB before any deploy that
touches `schema.prisma`**.

---

## 16. Rollback strategy

1. **Image (the normal path):** no rebuild needed — every `main` build also
   pushes a `:<full-git-sha>` tag to GHCR, so pin and re-pull:
   ```bash
   POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx pull postaryx
   POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx up -d postaryx
   ```
   Set the variable on **both** commands — `pull` and `up` read it independently.
2. **Code (tracked files only — compose, configs):** `git log --oneline` →
   `git checkout <previous-good-sha>` for the files that changed, then repeat
   step 1 with that commit's image tag. (Tag known-good releases, e.g.
   `git tag deploy-2026-06-28`, for fast targets.)
3. **Data:** if a bad migration corrupted the DB, restore the latest dump (§12).
   This is why the pre-deploy backup is mandatory for schema changes.

---

## 17. Security best practices

- **Loopback-bind all container ports** (§5) — the keystone, since Docker bypasses `ufw`.
- **TLS everywhere** via Certbot; force HTTP→HTTPS (`--redirect`).
- Set `DISABLE_REGISTRATION=true` once your accounts exist (private instance).
- Set a strong, unique `POSTARYX_DB_PASSWORD` in `.env` (§4 — Compose refuses to
  start without one, no weak default to forget) and a strong unique `JWT_SECRET`.
- Drop optional containers you don't use: `spotlight` (removed), and
  `temporal-ui` / `temporal-admin-tools` if you don't need the dashboard/CLI.
- `chmod 600 .env.prod`; SSH key-only auth; restrict port 22 in the OCI Security List.
- Keep the host patched: `sudo apt update && sudo apt upgrade`. Rebuild for base
  image CVEs.

---

## 18. Common mistakes that cause downtime

1. Forgetting the **OCI Security List** ingress for 80/443 → unreachable even
   though Nginx is fine.
2. Leaving container ports on **`0.0.0.0`** → Postgres/Temporal exposed to the
   internet (Docker bypasses `ufw`).
3. **`MAIN_URL`/`FRONTEND_URL`** not matching the real HTTPS domain → broken login
   and OAuth callbacks.
4. **Disk full** from uncapped Docker logs (§11) or the ~3 GB image piling up
   across rebuilds — run `docker image prune -f`.
5. **`docker compose down -v`** on Postiz → the `-v` wipes named volumes = data
   loss. Use `down` (no `-v`) for restarts; `-v` is only for the Phase 0 teardown.
6. **Build OOM** — not an issue at 24 GB, but the Next.js build needs ~4 GB; it
   fails silently on smaller VMs.
7. ARM surprise — Postiz's images (node, postgres, redis, elasticsearch 7.17,
   temporal) are all multi-arch and run fine on Ampere; just never pull an
   `amd64`-only side image onto this host.

---

## 19. Monitoring

- **Built-in:** `docker compose -p postaryx ps` (health), `docker stats --no-stream`
  (live RAM/CPU — watch Elasticsearch and the three Node processes), `df -h` +
  `docker system df` (disk).
- **Uptime:** an external HTTP check (UptimeRobot / Healthchecks.io) on
  `https://postaryx.example.com` — catches outages the host can't self-report.
- **OCI native:** the OCI Monitoring agent provides CPU/mem/disk alarms for free.
- **Optional later (shared across apps):** a single
  Prometheus + Grafana + cAdvisor + node-exporter stack on its own loopback port,
  proxied at `grafana.example.com`.
- App-level: the **Temporal UI** (`:8080`, via SSH tunnel) and **Spotlight** (if
  re-enabled) inspect workflow runs and errors.

---

## 20. End-to-end verification checklist

1. **After teardown (if any):** `docker ps -a` shows no leftover containers from
   the old app; `docker volume ls` is clean.
2. `docker compose -p postaryx ps` → all required containers `healthy`/`running`.
3. On the VM: `curl -I http://127.0.0.1:4007` → `200`.
4. On the VM: `curl -I https://postaryx.example.com` → `200` with a valid cert.
5. From outside the VM: `curl --max-time 5 http://<VM_PUBLIC_IP>:4007` and `:8080`,
   plus `nc -z -w5 <VM_PUBLIC_IP> 5432` and `:6379` → all **timeout/not
   reachable** (confirms loopback binding + firewall, including Postgres
   since P1-2 and Redis added later for GUI clients).
6. In a browser: load the site, register/login, and **schedule a test post a few
   minutes out** → confirms the Temporal orchestrator works end-to-end (the real
   integration test for this app).
7. `docker compose -p postaryx logs postaryx | grep -i prisma` → migration ran clean.
8. Run `backup.sh` once manually; verify `db-*.sql.gz` and `uploads-*.tar.gz` are
   non-empty.
