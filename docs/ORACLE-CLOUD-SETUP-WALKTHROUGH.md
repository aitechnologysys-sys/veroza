# Oracle Cloud Free Tier — Postaryx Setup & Deployment Walkthrough

**Written for:** someone who has never touched Oracle Cloud Infrastructure (OCI)
before. Every step says exactly what to click, what to type, and what
"success" looks like.

**Who:** Lunark Dynamics
**Product:** Postaryx
**Domain:** `postaryx.com` (not purchased yet — §8 covers buying it)

This doc takes you from *no Oracle account* to *Postaryx live on
`https://postaryx.com`*, in order:

1. [Read this first — a time-sensitive free-tier change](#0-read-this-first--a-time-sensitive-free-tier-change)
2. [Create your Oracle Cloud account](#1-create-your-oracle-cloud-account)
3. [Orient yourself in the console](#2-orient-yourself-in-the-oci-console)
4. [Set up networking (VCN)](#3-set-up-networking-vcn)
5. [Create the compute instance](#4-create-the-compute-instance-the-free-vm)
6. [Open the network firewall (Security List)](#5-open-the-network-firewall-security-list)
7. [Connect and prepare the server](#6-connect-and-prepare-the-server)
8. [Deploy Postaryx](#7-deploy-postaryx)
9. [Point postaryx.com at your server](#8-point-postaryxcom-at-your-server)
10. [Final verification checklist](#9-final-verification-checklist)
11. [What to do next](#10-what-to-do-next)

Companion docs this walkthrough draws on and hands off to:
[ORACLE-VM-DEPLOYMENT.md](./ORACLE-VM-DEPLOYMENT.md) (deep operational
reference — backups, rollback, monitoring),
[CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) (why we
target 2 OCPU/12 GB and how to trim the stack to fit),
[1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) (do this
*after* you're live), [../README.md](../README.md) §1–4 (day-to-day
deploy commands once this is all set up).

---

## 0. Read this first — a time-sensitive free-tier change

**Today is 12 Aug 2026.** On 15 June 2026, Oracle quietly halved the Always
Free "Ampere A1" compute allowance from **4 OCPU / 24 GB RAM** down to
**2 OCPU / 12 GB RAM**. Oracle is enforcing this on **18 Aug 2026** — any
Always-Free Ampere A1 instance (or combination of instances) above 2
OCPU/12 GB will be automatically terminated on or after that date.

**What this means for you, concretely:** because you're starting from
scratch, this is good news, not bad news — just build at the *current* limit
from day one and there's nothing to fix later:

- Provision **one instance at 2 OCPU / 12 GB**. Don't try to grab 4/24 — you
  either won't be offered it, or it'll be reclaimed within days.
- This matches what [CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md)
  already assumes and plans around, so §7 below has you deploy a stack sized
  for exactly this box from the start (no resize-later exercise needed).

### What you'll need before starting
- An email address, a mobile phone number, and a credit/debit card. Oracle
  requires these for identity verification even for the free tier; **your
  card is not charged** unless you explicitly upgrade to a paid account. Set
  an OCI budget alert at $1 in §10 as a safety net regardless.
- About 45–60 minutes for the account + instance + network steps.
- An SSH client (macOS Terminal works out of the box).

---

## 1. Create your Oracle Cloud account

1. Go to the Oracle Cloud Free Tier sign-up page and click **Start for
   free**.
2. Fill in your email, verify it via the code Oracle emails you.
3. Fill in your account/country information. When asked for the **company
   name**, use **Lunark Dynamics**.
4. **Choose your Home Region carefully — you cannot change it later**, and
   Always-Free compute can only be provisioned in your home region. Pick a
   region physically close to your expected users (e.g. an `us-*` region for
   a US audience, `eu-*` for Europe, `ap-*` for Asia-Pacific).
5. Verify your mobile number (SMS code) and add a payment card.
6. Accept the agreement and submit. Account provisioning usually takes a
   couple of minutes; you'll land in the OCI Console once it's ready.

**Known rough edge:** Always-Free Ampere A1 capacity is popular and
sometimes shows **"Out of host capacity"** when you try to create an
instance (§4). That's an Oracle capacity issue, not something wrong with
your account — retry in a different Availability Domain, or try again after
a few minutes/hours. It usually succeeds within a day.

---

## 2. Orient yourself in the OCI Console

Three things to know before clicking around:

- **☰ hamburger menu (top-left)** — this is how you get everywhere:
  Compute, Networking, Storage, Identity, Billing.
- **Compartment selector** — OCI organizes resources into "compartments"
  (like folders). As a solo/first deployment, just use the **root
  compartment** (your tenancy name) everywhere below — don't create new
  compartments, it only adds friction at this scale.
- **Region selector (top-right)** — must always show your **home region**
  from step 1. Always-Free resources silently fail to appear (or fail to
  create) in the wrong region.

---

## 3. Set up networking (VCN)

A VCN (Virtual Cloud Network) is your private network inside OCI — think of
it as the equivalent of a VPC on AWS/GCP. You need one with a public subnet
so your instance gets a public IP.

**Recommended for a first deployment: let the instance wizard create it for
you.** When you create the compute instance in §4, its networking step
offers **"Create new virtual cloud network"** — pick that, and OCI
provisions all of the following automatically, correctly wired together:

- A VCN with a private CIDR block (e.g. `10.0.0.0/16`)
- A **public subnet** inside it
- An **Internet Gateway** (lets subnet traffic reach the internet)
- A **route table** routing `0.0.0.0/0` through that gateway
- A **default Security List** (the network-level firewall you'll edit in §5)

If you'd rather create it explicitly first (so you can see/understand each
piece before the instance exists): **☰ → Networking → Virtual Cloud
Networks → Start VCN Wizard → "Create VCN with Internet Connectivity"**,
give it a name (e.g. `postaryx-vcn`), accept the defaults, and click
**Create**. Either path produces the same result — pick whichever you're
more comfortable with. This walkthrough assumes the quick path (created
during §4) from here on.

---

## 4. Create the compute instance (the free VM)

1. **☰ → Compute → Instances → Create Instance.**
2. **Name:** `postaryx-prod` (or similar — this is just a label).
3. **Image and shape:**
   - Click **Edit** next to "Image and shape."
   - Image: **Canonical Ubuntu**, select **24.04** (aarch64/ARM build —
     the wizard auto-selects the ARM image once you pick the Ampere shape
     below; if it shows an x86 image, re-select Ubuntu 24.04 after step 4).
   - Shape: click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**.
   - Set the sliders to **2 OCPU** and **12 GB memory** — exactly the
     current Always Free ceiling (see §0). Going higher either isn't
     offered as "Always Free" or gets reclaimed.
4. **Networking:**
   - Virtual cloud network: **Create new virtual cloud network** (name it
     `postaryx-vcn`) — this does everything described in §3 for you.
   - Subnet: **Create new public subnet** (accept the default).
   - Leave **"Assign a public IPv4 address"** checked — you need this to
     reach the box and to point your domain at it later.
5. **Add SSH keys:**
   - Choose **"Generate a key pair for me"**.
   - Click **Save private key** and **Save public key**. Save the private
     key somewhere durable (e.g. `~/.ssh/postaryx-oci.key`) — **Oracle does
     not store it; if you lose it, you lose access to the box.**
   - On macOS, lock down the permissions immediately:
     ```bash
     chmod 400 ~/.ssh/postaryx-oci.key
     ```
6. **Boot volume:** leave the default (~50 GB) — plenty for the OS + Docker
   images. Your Always Free block-storage pool is 200 GB total, shared
   across boot volumes, extra volumes, and backups, so there's room to grow
   later if needed.
7. Click **Create**. The instance takes 1–3 minutes to reach the **Running**
   state. Note the **Public IP address** shown on the instance's detail
   page — you'll use it constantly below. This walkthrough refers to it as
   `<VM_PUBLIC_IP>`.

---

## 5. Open the network firewall (Security List)

OCI has **two independent firewalls** — the VCN's Security List (cloud-level)
and the VM's own `ufw` (host-level, §6). Traffic must pass **both**. Do this
one first, or you won't even reach the box to configure the second.

1. On the instance's detail page, click the subnet link under
   **Primary VNIC** (or **☰ → Networking → Virtual Cloud Networks →
   `postaryx-vcn` → Security Lists → Default Security List**).
2. Click **Add Ingress Rules** and add:

   | Source CIDR | IP Protocol | Destination Port | Why |
   |---|---|---|---|
   | `<your-current-IP>/32` | TCP | 22 | SSH — restrict to your own IP, not the world |
   | `0.0.0.0/0` | TCP | 80 | HTTP (needed for Certbot's domain validation in §8) |
   | `0.0.0.0/0` | TCP | 443 | HTTPS — the real public entry point |

   Find your current IP with `curl ifconfig.me` if you don't know it. If
   your IP changes often (e.g. mobile/coffee-shop Wi-Fi), you can widen SSH
   to `0.0.0.0/0` temporarily and narrow it again later — just know that
   widens your attack surface in the meantime.

3. **Do not** add rules for 4007, 5432, 6379, 7233, or 8080 — those are
   Postiz's internal ports and stay loopback-bound on the host (§6–7
   explain why). Opening them here would expose your database directly to
   the internet.

---

## 6. Connect and prepare the server

```bash
ssh -i ~/.ssh/postaryx-oci.key ubuntu@<VM_PUBLIC_IP>
```

`ubuntu` is the default login user for Canonical's Ubuntu image on OCI. If
this hangs or refuses, double check: the Security List rule from §5 covers
your *current* IP, and you're using the matching private key.

Once you're in:

```bash
# Keep the OS current
sudo apt update && sudo apt upgrade -y

# Install Docker Engine + the Compose plugin (official Docker script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # picks up the group change in this session without re-login

# Confirm both work
docker --version
docker compose version

# Docker starts on boot by default after the install above, but make sure:
sudo systemctl enable --now docker

# Host-level firewall — the second layer mentioned in §5.
# Only SSH for now; port 80/443 get added in §8 once Nginx exists.
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status verbose
```

**Cap Docker's logs now**, before anything is running — an uncapped
`json-file` log driver is the single most common cause of a full disk on a
small box:

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

---

## 7. Deploy Postaryx

### 7.1 Get the code

```bash
sudo mkdir -p /opt/postaryx && sudo chown $USER:$USER /opt/postaryx
cd /opt/postaryx
git clone https://github.com/aitechnologysys-sys/veroza.git postaryx-app
cd postaryx-app
```

(The directory is named `postaryx-app` to match the local dev clone — see the
naming table in [CLAUDE.md](../CLAUDE.md): the repo is `veroza`, the product is
Postaryx. Docker container/network/volume names, the compose project name, and
the clone directory itself all say `postaryx` now.)

### 7.2 The image is pulled, never built here

**Do not run `docker compose build` on this VM.** `Dockerfile.dev` builds
all three apps with a 4 GB Node heap, which alone would consume a third of
this box's 12 GB and can crash the running stack. GitHub Actions already
builds the image and pushes it to GHCR; this VM only pulls. Full detail:
[CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md) and
[../README.md](../README.md) §3.

If the GHCR package (`ghcr.io/aitechnologysys-sys/veroza`) is still
**private** (check by trying the pull in §7.5 — a `denied`/`unauthorized`
error means it is), you need a one-time login with a **`read:packages`-only**
token — never a full-access token:

```bash
echo "$GHCR_READ_ONLY_PAT" | docker login ghcr.io -u <your-github-username> --password-stdin
```

### 7.3 Configure secrets

```bash
cp .env.example .env.prod
chmod 600 .env.prod
nano .env.prod
```

Set at minimum:
- `JWT_SECRET` — generate one: `openssl rand -base64 48`
- `IS_GENERAL=true`
- Leave `DATABASE_URL` / `REDIS_URL` / `TEMPORAL_ADDRESS` alone — the
  compose `environment:` block overrides these to the container names
  regardless of what's in this file.
- Clear any placeholder values (e.g. `X_API_KEY="Twitter API key…"`) —
  leave a key blank to disable that integration rather than shipping a
  placeholder string.
- Every social/email/AI/billing key is optional at this stage — you can add
  them later without a rebuild (§7.6 covers why).

### 7.4 Trim the stack to fit 2 OCPU / 12 GB

Because you're deploying fresh at the current Always-Free ceiling (§0),
build the trimmed stack from the start rather than doing it as cleanup
later. Full rationale in
[CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §3; the
short version — edit `docker-compose.yaml`:

1. **Delete the entire `temporal-elasticsearch` service block** (saves the
   single biggest chunk of RAM — Temporal's "standard visibility" on
   Postgres, which you already have via `temporal-postgresql`, is enough
   for scheduling social posts). Also remove, from the `temporal` service's
   `environment:` and `depends_on:`, every line referencing it
   (`ENABLE_ES`, `ES_SEEDS`, `ES_VERSION`, and the `temporal-elasticsearch`
   dependency), and delete the now-unused `temporal-es-volume` under
   `volumes:`.
2. **Delete the `temporal-ui` and `temporal-admin-tools` service blocks** —
   neither is required for the app to run. Run them on demand later if you
   need to debug:
   ```bash
   docker compose -p postaryx run --rm temporal-admin-tools tctl --namespace default namespace describe
   ```
3. **Cap Redis memory** — nothing bounds it today. In the `postaryx-redis`
   service, add:
   ```yaml
   command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
   ```

This takes the stack from ~4.4–7.4 GB steady-state (with a build spike
avoided entirely, since you're pulling) down to ~3.4–5.8 GB — comfortable
inside 12 GB.

### 7.5 Bring it up

```bash
docker compose -p postaryx pull postaryx
docker compose -p postaryx up -d
docker compose -p postaryx logs -f postaryx     # watch nginx + pm2 + prisma-db-push start (~90s)
```

Open another terminal (or Ctrl-C once logs settle) and verify:

```bash
docker compose -p postaryx ps          # every container: healthy/running
curl -I http://127.0.0.1:4007        # expect: HTTP/1.1 200 OK
```

At this point Postaryx is running on the VM but only reachable from inside
it (port 4007 is loopback-only, by design — see the comment in
`docker-compose.yaml`). §8 puts a real domain and HTTPS in front of it.

### 7.6 How you'll update it later

Once §8's domain/TLS setup is done, day-to-day updates are two commands —
covered in full in [../README.md](../README.md) §3 and
[CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md):

```bash
cd /opt/postaryx/postaryx-app
docker compose -p postaryx pull postaryx
docker compose -p postaryx up -d postaryx
```

No rebuild, no manual migration — `prisma-db-push` runs automatically on
container start.

---

## 8. Point postaryx.com at your server

### 8.1 Buy the domain

`postaryx.com` isn't registered yet. Any registrar works — a few
commonly-used ones: Cloudflare Registrar (sells at wholesale cost, and
pairs naturally with using Cloudflare for DNS), Namecheap, or Porkbun. Pick
one, search `postaryx.com`, and complete the purchase. When asked for
**registrant / organization**, use **Lunark Dynamics**.

Consider enabling **WHOIS privacy** (most registrars include it free) so
your personal details aren't published in the public WHOIS record.

### 8.2 Create the DNS record

In your registrar's (or Cloudflare's) DNS settings for `postaryx.com`, add:

| Type | Name | Value |
|---|---|---|
| A | `@` | `<VM_PUBLIC_IP>` |
| A (or CNAME) | `www` | `<VM_PUBLIC_IP>` (or `postaryx.com` if CNAME) |

Wait for propagation (usually minutes, sometimes up to a few hours), then
confirm from your Mac:

```bash
dig +short postaryx.com
# should print <VM_PUBLIC_IP>
```

> If you put the domain behind Cloudflare's proxy (orange cloud), turn
> proxying **off** (grey cloud, "DNS only") until Certbot has issued a
> certificate in §8.4 — Certbot's HTTP validation needs to reach your VM
> directly.

### 8.3 Set the app's public URL and install Nginx

```bash
cd /opt/postaryx/postaryx-app
echo 'POSTARYX_PUBLIC_URL=https://postaryx.com' > .env
```

This one variable drives `MAIN_URL`, `FRONTEND_URL`, and
`NEXT_PUBLIC_BACKEND_URL` consistently (see the comments in
`docker-compose.yaml`). It's runtime-read, so no rebuild is needed — just
recreate the container after this and after Certbot runs:
`docker compose -p postaryx up -d postaryx`.

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/postaryx.conf
```

`/etc/nginx/sites-available/postaryx.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name postaryx.com www.postaryx.com;

    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:4007;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/postaryx.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Now open the host firewall for web traffic (the Security List in §5
# already allows 80/443 at the cloud level — this is the second layer)
sudo ufw allow 'Nginx Full'
sudo ufw status verbose
```

At this point `http://postaryx.com` should load the app (unencrypted).
Confirm before moving on:
```bash
curl -I http://postaryx.com    # expect 200 (or a redirect once Certbot runs next)
```

### 8.4 Get HTTPS with Let's Encrypt

```bash
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot

sudo certbot --nginx -d postaryx.com -d www.postaryx.com --redirect --agree-tos -m you@example.com

sudo systemctl status snap.certbot.renew.timer   # confirm auto-renewal is scheduled
sudo certbot renew --dry-run                     # confirm renewal actually works
```

Certbot rewrites `postaryx.conf` to serve `:443` and redirect `:80 → :443`.

Recreate the app container so it picks up the HTTPS `POSTARYX_PUBLIC_URL`
from §8.3:
```bash
docker compose -p postaryx up -d postaryx
```

### 8.5 Add security headers (do this after HTTPS works, not before)

```bash
sudo nano /etc/nginx/sites-available/postaryx.conf
```
Inside the `:443 server {}` block Certbot created, add:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
server_tokens off;
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```
(HSTS *before* HTTPS works would lock your browser out of the plain-HTTP
fallback while you're still debugging — that's why this is last.)

---

## 9. Final verification checklist

1. `docker compose -p postaryx ps` → every container `healthy`/`running`.
2. On the VM: `curl -I http://127.0.0.1:4007` → `200`.
3. On the VM: `curl -I https://postaryx.com` → `200` with a valid cert.
4. From your Mac (outside the VM):
   ```bash
   curl --max-time 5 http://<VM_PUBLIC_IP>:4007   # must TIME OUT
   curl -I https://postaryx.com                   # must return 200
   ```
5. Open `https://postaryx.com` in a browser, register an account, log in.
6. **Schedule a test post a few minutes out** and confirm it actually
   publishes — this is the real end-to-end proof that Temporal/the
   orchestrator works, not just that the frontend loads.
7. `docker compose -p postaryx logs postaryx | grep -i prisma` → migration ran
   clean, no errors.

---

## 10. What to do next

You're live. A few things worth doing in the first week, each already
written up elsewhere in `docs/`:

- **Rotate the hardcoded Postgres passwords** (`postaryx-password`,
  `temporal`) that ship in the committed `docker-compose.yaml` — P0-2 in
  [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md). Cheap now,
  a migration exercise once you have real customer data.
- **Set an OCI budget alert at $1** so any accidental billing surfaces
  immediately — Console → **☰ → Billing & Cost Management → Budgets**.
- **Set `DISABLE_REGISTRATION=true`** in `docker-compose.yaml` once your own
  accounts exist, so randoms can't sign up and start burning your AI/API
  quota (P2-1 in the same doc).
- **Configure off-box backups and rehearse a restore** —
  [ORACLE-VM-DEPLOYMENT.md](./ORACLE-VM-DEPLOYMENT.md) §12 has the script.
  An unrehearsed backup is not a backup.
- **Register your social OAuth apps** (X, LinkedIn, Instagram, etc.) now
  that you have a real HTTPS domain — each platform's developer console
  needs an `https://postaryx.com/...` callback URL, which didn't exist
  before this walkthrough.
- **Day-to-day updates** after this point follow
  [../README.md](../README.md) §3 and
  [CI-BUILD-CUTOVER.md](./CI-BUILD-CUTOVER.md): merge to `main`, wait for
  the green "Build image" check, then `pull` + `up -d` on the VM — no
  building on the box, ever.
