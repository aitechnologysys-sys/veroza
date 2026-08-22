# CI Build Cutover — what to do after this merges

**Read this once, in order, the day the PR merges to `main`.** After that, the
day-to-day flow lives in [../README.md](../README.md) §3 and you won't need this
file again.

Every step below says what you're doing, the exact command, what success looks
like, and what to do if it fails. Nothing here requires guessing.

---

## What changed, in three sentences

The server used to build the app itself. That build compiles three apps with a
4 GB Node heap, which pushes a 12 GB box to ~11.4 GB and can kill the running
stack. **Now GitHub Actions builds the image, pushes it to GitHub's container
registry (GHCR), and the server only downloads it.**

```
merge to main  →  GitHub Actions builds (arm64, ~15 min)  →  ghcr.io/aitechnologysys-sys/veroza  →  server pulls
```

---

# Part A — After the merge

## Step 1. Confirm the build ran and passed

Merging to `main` automatically starts three workflows. The one that matters is
**Build image**.

1. Open **`https://github.com/aitechnologysys-sys/veroza/actions`**
2. Find the newest **Build image** run
3. Wait for the green tick (expect **10–20 minutes** — it installs all
   dependencies and builds three apps from scratch)

**Success:** green tick, and the run's summary page lists the tags it pushed:

```
ghcr.io/aitechnologysys-sys/veroza:latest
ghcr.io/aitechnologysys-sys/veroza:<the-commit-sha>
```

**If it fails**, see [Troubleshooting](#troubleshooting) — check the failing
step's name first, it maps directly to a row in that table.

> **Do not deploy yet.** Between the merge and this build finishing, the
> `docker-compose.yaml` on `main` points at an image that does not exist. A
> deploy in that window fails with `manifest unknown`.

## Step 2. Make the package public ⚠️ THE ONE THING PEOPLE MISS

**A new GHCR package is created PRIVATE — even though this repository is
public. It does not inherit the repo's visibility.** You must change it by hand,
once, and only once ever.

1. Open **`https://github.com/users/aitechnologysys-sys/packages/container/veroza/settings`**
2. Scroll to **Danger Zone**
3. Click **Change visibility** → choose **Public** → type `veroza` to confirm

### Why this matters

| | Private (the default) | Public (what you want) |
|---|---|---|
| Storage | 500 MB free, then **$0.25/GB/month** | Unlimited, **free** |
| Download traffic | 1 GB/month free, then **$0.50/GB** | Unlimited, **free** |
| Can the server download it? | Only after `docker login` | Yes, no login needed |

Our image is **several GB**. On the private default you pass the free allowance
on the very first build and start paying. Public costs nothing.

### The trade-off, stated plainly

A public image lets **anyone** run `docker pull` and read our **entire source
code**, because `Dockerfile.dev` copies the whole repository into the image.

That is fine **today** — this repository is already public, so nothing new is
exposed.

> 🔴 **If this repository is ever made private, make the package private in the
> same sitting.** Otherwise the repo is closed but the image is still handing
> out the full source to anyone who asks. Changing repo visibility does *not*
> change package visibility.

### If you decide to keep it private instead

Then the server needs a one-time login. Create a token at
**Settings → Developer settings → Personal access tokens** with **only** the
`read:packages` scope — never a full-access token:

```bash
echo "$GHCR_READ_ONLY_PAT" | docker login ghcr.io -u <your-github-username> --password-stdin
```

And budget for the storage/traffic charges in the table above.

## Step 3. Confirm the image can actually be downloaded

Run this **on your own machine**, logged out, to prove the server won't need
credentials:

```bash
docker logout ghcr.io
docker pull ghcr.io/aitechnologysys-sys/veroza:latest
```

**Success:** the layers download and it ends with `Status: Downloaded newer image`.

**If you get `denied` or `unauthorized`:** the package is still private. Go back
to Step 2.

---

# Part B — Test it

## Step 4. Test on your own machine first, not the server

Never let the server be the first place a new image runs.

> Needs a `.env` with `POSTARYX_DB_*`/`POSTARYX_REDIS_PASSWORD`/
> `POSTARYX_TEMPORAL_DB_PASSWORD` set — see
> [PROD-DEPLOY-PREREQUISITE.md](./PROD-DEPLOY-PREREQUISITE.md) if this is your
> first time running the prod stack locally.

```bash
# Make sure the dev stack is not running (it collides on ports)
docker compose -p postaryx-dev -f docker-compose.dev.yaml down

# Start the production stack locally, using the image CI just built
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d

# Watch it start — takes ~90 seconds
docker compose -p postaryx-prod logs -f postaryx
```

**Check all four of these:**

```bash
# 1. Every container is running / healthy
docker compose -p postaryx-prod ps

# 2. The app answers
curl -I http://127.0.0.1:4007          # expect: HTTP/1.1 200 OK

# 3. You are running the exact commit you think you are.
#    Prints v<version.txt>-<short-sha>, e.g. v1.47.0-a1b2c3d
docker exec postaryx printenv NEXT_PUBLIC_VERSION

# 4. Open it in a browser and log in
open http://localhost:4007
```

Then stop it:

```bash
docker compose -p postaryx-prod down
```

**If the app doesn't come up**, read the logs from step 2 above. This is a
normal application problem, not a registry problem — the image downloaded fine
or you'd have failed at Step 3.

## Step 5. Deploy to the server

Only after Step 4 passed.

```bash
ssh ubuntu@<VM_PUBLIC_IP>
cd /opt/postaryx/postaryx-app

# Get the code change that switches compose from building to pulling
git pull

# Confirm the project name (this server uses "postaryx", not "postaryx-prod")
docker compose ls

# Download the new image and restart just the app
docker compose -p postaryx pull postaryx
docker compose -p postaryx up -d postaryx

# Watch it come up
docker compose -p postaryx logs -f postaryx
```

**Verify, exactly as in Step 4:**

```bash
docker compose -p postaryx ps
curl -I http://127.0.0.1:4007
docker exec postaryx printenv NEXT_PUBLIC_VERSION   # must match the commit you deployed
```

Then load the real site in a browser and log in.

> **`docker compose ls` matters.** A wrong `-p` name does not error — it
> silently creates or targets a *different, empty* stack. If this server's
> project is `postaryx`, every command must say `-p postaryx`.

## Step 6. Confirm the server never builds again

```bash
grep -A1 "^  postaryx:" docker-compose.yaml
```

You should see an `image:` line and **no `build:` block**. If you see `build:`,
the `git pull` in Step 5 didn't land — the server is still capable of the
memory spike this whole change exists to remove.

---

# Rolling back

Every build also publishes a `:<commit-sha>` tag, so going back is a download,
not a rebuild. Get the sha from the Actions run or `git log`.

```bash
# On the server. Set the variable on BOTH lines — pull and up read it separately.
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx pull postaryx
POSTARYX_IMAGE_TAG=<full-git-sha> docker compose -p postaryx up -d postaryx

# Confirm you're on the old build
docker exec postaryx printenv NEXT_PUBLIC_VERSION
```

To go back to normal afterwards, just drop the variable:

```bash
docker compose -p postaryx pull postaryx && docker compose -p postaryx up -d postaryx
```

Nothing tracked by git is edited, so the server never ends up with local
changes that fight the next `git pull`.

⚠️ The workflow keeps the **20 newest** images and deletes older ones. If you
intend to sit on an old build for a long time, add its sha to `ignore-versions`
in `.github/workflows/build-containers.yml` so cleanup can't delete it out from
under you.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `denied` / `unauthorized` on `docker pull` | Package is still private | Step 2 — make it public, or `docker login` with a `read:packages` token |
| `manifest unknown` on `docker pull` | No image for that tag yet — usually deploying before the build finished, or a typo'd sha | Wait for the green tick in Step 1, then retry |
| Build fails at **Check banned providers** | A banned social provider (VK etc.) came back, most likely via an upstream merge | Re-remove the lines it names. Do **not** delete the check — see `scripts/check-banned-providers.mjs` |
| Build fails at **Log in to GHCR** | Workflow lacks `packages: write` | Confirm the `permissions:` block in `build-containers.yml` is intact |
| Build queues forever, never starts | No `ubuntu-24.04-arm` runner available | Free for public repos, so this shouldn't happen here. If it does, the repo went private — check its visibility |
| Build fails at **Prune old image versions** | Cleanup problem only | Harmless. The step is `continue-on-error`, the image already pushed |
| App up but shows the *old* version | Pulled but didn't recreate the container | `docker compose -p postaryx up -d postaryx` again; verify with `docker exec postaryx printenv NEXT_PUBLIC_VERSION` |
| Compose commands seem to do nothing | Wrong `-p` project name | `docker compose ls` and use the name you actually see |

---

# Quick reference — the everyday flow, after all of the above

```bash
# 1. Merge to main. Wait for "Build image" to go green in the Actions tab.
# 2. On the server:
cd /opt/postaryx/postaryx-app
docker compose -p postaryx pull postaryx
docker compose -p postaryx up -d postaryx
docker exec postaryx printenv NEXT_PUBLIC_VERSION   # sanity check
```

That's it. No building, no memory spike, no downtime risk from a deploy.

**Related:** [../README.md](../README.md) §3–4 (runbook + visibility) ·
[CONTAINMENT-DEPLOYMENT-PLAN.md](./CONTAINMENT-DEPLOYMENT-PLAN.md) §6 (why) ·
[ORACLE-VM-DEPLOYMENT.md](./ORACLE-VM-DEPLOYMENT.md) (server setup)
