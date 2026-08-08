# POSTARYX — 2 OCPU / 12 GB Containment & Deployment Plan

Written 5 Aug 2026. Companion to your existing `docs/ORACLE-VM-DEPLOYMENT.md`,
`docs/INFRASTRUCTURE-AND-DEPLOYMENT.md`, and the infra/cost audit. This plan
does not repeat what those already cover well (Nginx/Certbot setup, firewall
layers, backup scripts) — it focuses specifically on **fitting the stack into
2 OCPU/12 GB safely**, in the order you should actually do it.

## 0. Decisions this plan is built on

These came out of our conversation — stated up front so nothing is silently
assumed:

| Question | Decision |
|---|---|
| Frontend hosting | **Stay on the VM.** No Vercel split. Reasons in §2. |
| Current state | **Pre-launch** — no real customer data on the instance yet. |
| Resize to 2 OCPU/12 GB | **Last step**, after everything below is built and tested — not first. |
| Object storage (R2) | **Not set up yet.** Stay on local disk for now; wired for a same-day flip later (§7). |
| Custom domain | **Not registered yet.** This blocks more than it looks like (§8) — treat it as a soon-not-later item. |

One correction to keep in view: your instance is still running the **old**
4 OCPU/24 GB spec. Oracle's actual Always Free entitlement, since 15 June
2026, is 2 OCPU/12 GB. Nothing has forced a resize yet, but the stated policy
is suspension-until-resized for anything over the new limit — this plan gets
you safely inside the new limit *before* Oracle (or your own PAYG billing)
makes that decision for you.

---

## 1. Why we're not splitting the frontend to Vercel

I read the actual auth and routing code (not the docs) before ruling this
out, so this is evidence, not a guess:

- **Auth is cookie-based, and the cookie's `Domain` is derived from
  `FRONTEND_URL`** via `tldts` (`libraries/helpers/src/subdomain/subdomain.management.ts`,
  used in `apps/backend/src/api/routes/auth.controller.ts` and
  `auth.middleware.ts`). In production the cookie is `httpOnly, secure,
  sameSite: 'none'`. Browsers only accept a `Set-Cookie: Domain=` that is the
  responding host or a **superdomain** of it. A Vercel default domain
  (`*.vercel.app`) is on the public suffix list, so this cookie would never
  reach it. It *would* work on a custom subdomain of the same registrable
  domain (e.g. `app.postaryx.com` + `api.postaryx.com`) — but you don't have
  a domain yet (§8).
- **Three server-rendered pages call `BACKEND_INTERNAL_URL`**, which
  `docker-compose.yaml` hardcodes to `http://localhost:3000` — i.e., they
  assume frontend and backend share a box: `apps/frontend/src/proxy.ts:134`
  (runs on *every request*, not an edge case), `apps/frontend/src/app/(app)/auth/page.tsx:17`,
  and the post-preview page `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx:39`.
  On Vercel these would need to be repointed to a public backend URL, adding
  a real network hop (and a new failure mode: these pages would go down if
  the Oracle box is briefly unreachable, which isn't true today).
- **The build is one step for all three apps**: `Dockerfile.dev` does
  `pnpm install && pnpm run build` for frontend+backend+orchestrator
  together, then `pm2` starts all three, behind **one internal Nginx**
  (`var/docker/nginx.conf`) that proxies `/` to the frontend and `/api/` to
  the backend. Splitting the frontend out means patching this Dockerfile,
  the compose file, and the internal Nginx config to stop building/serving
  it — a divergence from upstream Postiz you'd have to keep re-applying on
  every `git pull` from upstream.
- **The RAM number doesn't actually justify it.** The audit's "1.6–2.6 GB"
  figure for the `postiz` container is *combined* for all three Node
  processes, not just the frontend. The real RAM danger isn't the frontend's
  steady-state footprint — it's the **~4 GB Next.js build spike** (see §6),
  and moving the build into CI fixes that regardless of where the frontend
  ends up running. Once that's fixed and the stack is trimmed (§3), you're at
  3.4–5.8 GB steady-state against 12 GB — comfortable headroom without
  touching Vercel at all.

**When to revisit this:** once you have a real custom domain and if Oracle's
region latency becomes an actual user complaint, or you want independent
frontend deploys. Not before.

---

## 2. Current footprint vs. target

From your own `docker-compose.yaml` (9 services) and the audit's per-container
estimates:

| State | Steady RAM | Against 12 GB |
|---|---|---|
| As shipped (all 9 containers, building on-box) | 4.4–7.4 GB steady, **11.4 GB during a build** | 37–62% steady, **95% during build** |
| Trimmed (§3) + built off-box (§6) | 3.4–5.8 GB, no on-box build spike | 28–48%, no OOM risk |

The trim + off-box build combination is what makes 12 GB comfortable. Do
both before resizing.

---

## 3. Trim the stack

Three changes to `docker-compose.yaml`, in order of impact:

### 3a. Drop Elasticsearch (–~1.1 GB, the biggest single win)

Temporal only uses Elasticsearch for *advanced* visibility (complex workflow
search). Standard visibility (Postgres-backed, which you already have via
`temporal-postgresql`) is enough for scheduling social posts.

```yaml
# Remove this entire service block:
temporal-elasticsearch:
  ...

# In the `temporal` service, remove:
- ENABLE_ES=true          # → delete, or set to 'false'
- ES_SEEDS=temporal-elasticsearch
- ES_VERSION=v7

# And remove `temporal-elasticsearch` from `temporal`'s `depends_on:`.

# Remove the now-unused volume:
temporal-es-volume:
  external: false
```

**Test this on staging first**, exactly as the audit says — verify Temporal
comes up healthy and a scheduled post round-trips before doing this in
production.

### 3b. Remove `temporal-ui` and `temporal-admin-tools` from the persistent stack (–~0.25 GB)

Neither is needed for the app to function. Delete both service blocks from
the production `docker-compose.yaml`. When you actually need `tctl`/the
Temporal CLI (e.g. for §4 below), run it on demand instead of keeping it
running 24/7:

```bash
docker compose -p postiz run --rm temporal-admin-tools tctl --namespace default namespace describe
```

For the UI, reach it via an ad-hoc container + SSH tunnel only when
debugging, rather than a standing container.

### 3c. Cap Redis memory (not currently set anywhere in your compose)

Your `postiz-redis` service has no `maxmemory` and no eviction policy today —
it will grow unbounded. Add:

```yaml
postiz-redis:
  image: redis:7.2
  command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
  ...
```

256 MB is a starting point for your scale (queues + cache) — watch
`docker exec postiz-redis redis-cli info memory` after real traffic and
adjust.

---

## 4. Temporal workflow retention — set it explicitly, don't trust the default

I looked for where your default namespace's retention is actually set and
found an inconsistency worth flagging rather than guessing past:
`var/docker/create-namespace-default.sh` creates the namespace with `--rd 1`
(1 day), but **that script isn't referenced anywhere in `docker-compose.yaml`**
— your `temporal` service (the `temporalio/auto-setup` image) auto-creates the
`default` namespace itself on first boot, using its own internal default,
which that script doesn't control. I'm not going to assert a specific number
here since I can't verify which path actually ran on your box.

**Do this instead of trusting either default:**

```bash
# 1. Check what's actually in effect right now:
docker compose -p postiz run --rm temporal-admin-tools \
  tctl --namespace default namespace describe

# 2. Set it explicitly to 7 days (plenty for scheduled social posts).
#    Verify the exact flag with --help first — tctl syntax varies by version:
docker compose -p postiz run --rm temporal-admin-tools \
  tctl --namespace default namespace update --help
# then something along the lines of:
docker compose -p postiz run --rm temporal-admin-tools \
  tctl --namespace default namespace update --retention 168h
```

If you ever tear down and recreate the namespace from scratch, you can also
set it at creation time via the `temporal` service's environment:
`DEFAULT_NAMESPACE_RETENTION: 168h` — but since your namespace already
exists, that only takes effect on a fresh namespace, not this one.

---

## 5. Cap Docker logs (10 minutes, prevents the #2 cause of a dead box)

`/etc/docker/daemon.json` on the VM:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

```bash
sudo systemctl restart docker   # restarts all containers — do this in a maintenance window
```

---

## 6. Move the build off the VM, into CI

This is the fix for the actual OOM risk (§2) — not the Vercel split.

**Current state:** `Dockerfile.dev` runs `NODE_OPTIONS="--max-old-space-size=4096" pnpm run build`
*inside the image build*, on whatever machine runs `docker compose build`.
Today that's the VM itself, which is why the build competes with the running
stack for RAM.

**Fix:** build the image in GitHub Actions on a **hosted ARM64 Linux
runner** (these are GA now, and priced at $0.005/min — about 17% cheaper
than the x86 runner, not a premium tier), push to GHCR, and have the VM only
pull.

**Status: done (8 Aug 2026).** An earlier draft of this section proposed
creating a new `.github/workflows/build-image.yml`. That was a mistake — the
repo already had `.github/workflows/build-containers.yml` doing exactly this
job, inherited from upstream. It was simply unusable as-is for this fork:

- it pushed to `ghcr.io/gitroomhq/postiz-app` (upstream's namespace) in 12
  places, which we have no write access to — dead on arrival;
- it triggered only on git tags, not on `main`;
- it built amd64 *and* arm64 plus a manifest across 3 jobs, and we have no
  amd64 target (Oracle Ampere A1 is arm64, dev machines are Apple Silicon);
- it passed `--no-cache --pull`, so no layer reuse at all.

So `build-containers.yml` was **rewritten in place** rather than duplicated —
one job, arm64 only, pushing to `ghcr.io/${{ github.repository }}` (i.e.
`ghcr.io/aitechnologysys-sys/veroza`). Read that file for the current
definition; it is commented in detail. Keeping the upstream filename means the
inevitable merge conflict shows up as a conflict to resolve rather than as two
divergent workflows both trying to build.

Three details worth knowing, since they are the parts that usually go wrong:

1. **`permissions: packages: write` is mandatory.** `GITHUB_TOKEN` is
   read-only by default and the push to GHCR fails without it.
2. **The image name matches `github.repository` on purpose.** GitHub
   auto-links a GHCR package to the repo of the same name, which is what makes
   the default `GITHUB_TOKEN` sufficient. Naming the image `postaryx` instead
   would leave the package unlinked and the first push would 403 until the
   package is created and granted repo access by hand. Rename it later,
   deliberately, alongside the rest of the Postaryx rename — not now.
3. **Only `main` may move `:latest`.** Every run pushes `:<full-git-sha>`, but
   `:latest` — the tag the VM pulls — is pushed only when the ref is the default
   branch. A manual `workflow_dispatch` run on a feature branch gets
   `:branch-<sanitised-name>` instead. Without this, testing the workflow from a
   branch would quietly make that branch production's next deploy.
4. **Baked-in config is not a problem here, and this was verified rather than
   assumed.** The usual way a "move the build to CI" change breaks is that
   `NEXT_PUBLIC_*` values get inlined into the client bundle at build time and
   the CI runner doesn't have them. Postiz avoids this by reading them in
   *server* components and threading them to the client through
   `VariableContextComponent` (`apps/frontend/src/app/(app)/layout.tsx:61-107`)
   — runtime values. The only client components that read `process.env`
   directly are `launches.component.tsx` (`NEXT_PUBLIC_VERSION`, passed as a
   build arg) and `facebook.component.tsx` (`NEXT_PUBLIC_FACEBOOK_PIXEL`,
   optional). A CI-built image is behaviour-identical to the old on-box build.

At your build frequency this comfortably fits inside GitHub's free-tier CI
minutes (2,000 min/month on the Free plan, 3,000 on Pro) — a single build is
likely well under 15 minutes.

**Known limitation — caching barely helps yet.** The workflow wires up
`type=gha` build cache, but `Dockerfile.dev` runs `COPY . /app` *before*
`pnpm install`, so any source change invalidates the copy layer and every
layer after it, install and build included. Getting real cache hits means
restructuring the Dockerfile to copy `pnpm-lock.yaml` + all workspace
`package.json` files first, install, then copy sources. That is a genuine
divergence from upstream's Dockerfile and was left alone for now. Revisit if
build wall-clock or CI minutes actually start to hurt.

**On the VM**, the `postiz` service in `docker-compose.yaml` now pulls instead
of building — the `build:` block and `pull_policy: never` are gone, replaced by:

```yaml
image: ${POSTIZ_IMAGE:-ghcr.io/aitechnologysys-sys/veroza}:${POSTIZ_IMAGE_TAG:-latest}
```

The two indirections exist so that rollback and local builds need no edit to
the compose file (see the comment block above that line).

One-time on the VM, authenticate to pull a private GHCR image:
```bash
echo "$GHCR_READ_ONLY_PAT" | docker login ghcr.io -u <your-username> --password-stdin
```
(Use a token scoped to `read:packages` only, not your full PAT.)

Deploy flow becomes:
```bash
cd /opt/postiz/postiz-app
docker compose -p postiz pull postiz
docker compose -p postiz up -d postiz
```
No `build`, no 4 GB spike, no risk to the running stack during a deploy.
Rollback is a tag change, no rebuild — every `main` build also pushes a
`:<full-git-sha>` tag:
```bash
POSTIZ_IMAGE_TAG=<full-git-sha> docker compose -p postiz up -d postiz
```

### 6a. The other workflows, cleaned up at the same time

`.github/workflows/` was inherited wholesale from upstream and several files
were either broken or actively wrong for this repo:

| File | What was wrong | Action |
|---|---|---|
| `eslint` | **No file extension.** GitHub only loads `.yml`/`.yaml`, so this workflow had never run once. It also pointed at `apps/{backend,frontend}/.eslintrc.json`, neither of which exists — the real config is the root `eslint.config.mjs`. | Renamed to `eslint.yml`, retargeted at the root config |
| `issue-label-triggers.yml` | Auto-closed issues *in this repo* with a message telling people to "contact Nevo David" about the Postiz public website. Live and would have fired. | Deleted |
| `stale.yml` | Gated to `gitroomhq/postiz-app` so it no-ops here, but woke on a `*/30 * * * *` cron forever. | Deleted |
| `build-extension.yaml`, `publish-extension.yml` | Hardcode `FRONTEND_URL=https://platform.postiz.com` and publish to *Postiz's* Chrome Web Store listing. Manual-dispatch-only, so never fired by accident. | Deleted — restore and retarget if/when we ship our own extension, which needs the domain from §8 anyway |

**Open item: linting is broken independently of CI.** `pnpm eslint .` — the
command CLAUDE.md documents — crashes before checking a single file:

```
TypeError: Converting circular structure to JSON
  at @eslint/eslintrc/lib/shared/config-validator.js
```

`package.json` pins `eslint@8.57.0` while `eslint-config-next@16.2.6` (matching
`next@16.2.6`) targets ESLint 9's flat config; loading it through `FlatCompat`
on ESLint 8 blows up. `eslint.yml` is therefore `continue-on-error: true` for
now — it reports, it does not gate. Fixing this properly is an ESLint 9 upgrade
plus triaging whatever new rules then fire across the tree, which is real work
and separate from this plan. Delete the `continue-on-error` line once it's done.

**Also worth deciding:** `build.yml` triggers on bare `push:` with no branch
filter *and* `pull_request:`, so a PR branch in this repo builds twice per
push, and `main` now runs both `build.yml` and the image build. Narrowing it to
`push: branches: [main]` would halve that. Left alone for now because it is
pure upstream and harmless apart from CI minutes.

---

## 7. Storage: stay on local disk for now, but wire the flip in advance

You don't have a Cloudflare/R2 account yet, and you're pre-launch — local
disk is genuinely fine to start with; there's no media pressure yet.
**But don't wait until it's urgent**, per the audit's own numbers: at 50
customers, local disk (~100 GB usable) fills in about 6 weeks, and it's a
full outage (uploads 500, posts fail, Postgres stops writing), not a
graceful degradation. The trigger to flip: **before your first real
customer, not after.**

What to do now, so the flip later really is just a config change:

1. Leave `STORAGE_PROVIDER=local` in `.env.prod` as-is.
2. Add the Cloudflare keys to `.env.prod` **commented out with placeholder
   values**, so the file's shape is ready:
   ```bash
   #STORAGE_PROVIDER=cloudflare
   #CLOUDFLARE_ACCOUNT_ID=""
   #CLOUDFLARE_ACCESS_KEY=""
   #CLOUDFLARE_SECRET_ACCESS_KEY=""
   #CLOUDFLARE_BUCKETNAME=""
   #CLOUDFLARE_BUCKET_URL=""
   #CLOUDFLARE_REGION="auto"
   ```
3. Interim safety net while on local disk: set a disk-usage alarm at 70%
   (OCI Monitoring, free) — don't rely on noticing. A one-line cron check is
   also fine if you want something immediate:
   ```bash
   df / --output=pcent | tail -1 | tr -dc '0-9'   # wire into your monitoring of choice
   ```

**When you do set up R2** (whenever the account exists): create the bucket,
generate an API token scoped to that bucket, fill in the real values above,
uncomment them, flip `STORAGE_PROVIDER=cloudflare`, restart the `postiz`
container. Your fork already has the uploader code
(`libraries/nestjs-libraries/src/upload/`) — this genuinely is just an env
change, nothing to build. A custom domain for the bucket (e.g.
`media.postaryx.com`) needs the domain from §8 first, and is required before
TikTok/Instagram will accept your media URLs — so this and §8 are linked.

---

## 8. Domain: not registered yet — know what's actually blocked by that

This is a bigger dependency than "nice to have for a URL." Without a
registered domain you cannot yet:
- Get a TLS certificate (Certbot needs a DNS-validated domain)
- Get a working R2 custom domain for media (§7)
- Register OAuth apps with Meta, TikTok, LinkedIn, etc. — all require an
  HTTPS callback URL on a real domain

So while the infra work above (§3–6) can proceed today, **full external
testing of the product — logging in over HTTPS, connecting real social
accounts — is blocked until you register a domain.** I'd treat that as a
"do this soon" item rather than something to defer indefinitely, since
everything else in this plan is genuinely usable the moment you have it.

**Meanwhile**, if you want to verify the trimmed+CI-built stack works before
the domain exists:
- Keep the OCI Security List ingress for 80/443 restricted to your own IP
  only (not `0.0.0.0/0`) — this lets you hit `http://<VM_PUBLIC_IP>` for
  internal smoke-testing without exposing an unencrypted endpoint to the
  internet.
- Once the domain exists, follow `docs/ORACLE-VM-DEPLOYMENT.md` §7–9
  exactly as written (host Nginx vhost, Certbot, opening 80/443 to
  `0.0.0.0/0`) — that doc is already correct for this step, nothing to
  change there.

---

## 9. Resize to 2 OCPU / 12 GB — do this last

Only after §3–6 are live and you've confirmed (via `docker stats
--no-stream`) that steady-state RAM is where §2's table predicts. Per
`docs/ORACLE-VM-DEPLOYMENT.md`:

1. Console → Instance → **Actions → More Actions → Edit** → 2 OCPU, 12 GB.
2. Reboots in ~2 minutes; keeps disk and public IP.
3. If you hit "Out of host capacity," stop the instance first or try a
   different fault domain.
4. Set an **OCI budget alert at $1** while you're in the console, so any
   accidental PAYG billing surfaces immediately.

**Idle reclamation is not a risk for this instance once running** — Oracle
only reclaims an Always Free instance idle 7 days when CPU, network, *and*
memory are all below 20%. A running Postiz stack keeps memory at 40–60%
permanently, so production is safe on that basis alone. (The thing that
*does* get reclaimed is a forgotten staging instance — watch for that
separately if you ever spin one up.)

---

## 10. Ongoing safeguards checklist

- [ ] OCI budget alert at $1 (§9)
- [ ] Disk-usage alarm at 70% (§7)
- [ ] Redis `maxmemory` + eviction policy set (§3c)
- [ ] Docker logs capped (§5)
- [ ] Off-box backups configured and **one restore rehearsed** — already
      specified in `docs/ORACLE-VM-DEPLOYMENT.md` §12, unchanged by this plan
- [ ] Temporal namespace retention confirmed explicitly, not assumed (§4)

## 11. What's deliberately deferred, and the trigger to revisit it

| Deferred | Why it's OK for now | Revisit when |
|---|---|---|
| Cloudflare R2 / object storage | No media pressure pre-launch | Before your first real customer, or if local disk crosses ~50% |
| Custom domain registration | Infra work doesn't need it yet | Before any real OAuth/social-connector testing — treat as near-term, not "later" |
| Splitting frontend to Vercel | RAM problem already solved without it (§1) | Oracle-region latency becomes a real complaint, or you want independent frontend deploys |
| X (Twitter) bring-your-own-key | Not a containment issue | Before launch, per the cost audit — this is a pricing/product decision, not infra |

---

## Appendix: sources for this plan

- Your `docker-compose.yaml`, `Dockerfile.dev`, `var/docker/nginx.conf`,
  `package.json`, `var/docker/create-namespace-default.sh`,
  `dynamicconfig/development-sql.yaml` — read directly from your repo.
- `docs/ORACLE-VM-DEPLOYMENT.md` and `docs/INFRASTRUCTURE-AND-DEPLOYMENT.md`
  — your own deployment documentation.
- The infra/cost audit HTML you shared (Parts 01–04, 09, 12–14).
- Auth/CORS/SSR code investigation: `apps/backend/src/api/routes/auth.controller.ts`,
  `apps/backend/src/services/auth/auth.middleware.ts`,
  `libraries/helpers/src/subdomain/subdomain.management.ts`,
  `libraries/helpers/src/utils/custom.fetch.func.ts`, `apps/backend/src/main.ts`,
  `libraries/helpers/src/utils/internal.fetch.ts`, `apps/frontend/src/proxy.ts`,
  `apps/frontend/src/app/(app)/auth/page.tsx`,
  `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx`.
- GitHub Actions hosted ARM64 runner pricing/GA status, verified via web
  search (Aug 2026): [GitHub Actions pricing update changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/),
  [GitHub Actions 2026 pricing summary](https://cicdpipelinecost.com/github-actions-pricing).
