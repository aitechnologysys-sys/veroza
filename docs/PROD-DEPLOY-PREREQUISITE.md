# Prod Deploy Prerequisites

Everything you need to know before running the production Docker Compose stack.

---

## Config files

| File | Purpose |
|---|---|
| `.env.prod` | **All secrets and API keys** for prod. Injected into the container via `env_file:`. Edit this file. |
| `.env` | **DB/Redis/Temporal passwords** Compose substitutes into `docker-compose.yaml`'s `${...}` placeholders — a *different* mechanism from `env_file:`, and Compose never reads `.env.prod` for it. See [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P0-2/P1-3 for why these are two separate files. |
| `docker-compose.yaml` | Reads `.env.prod` via `env_file` for secrets, and `.env` via `${...}` substitution for DB/Redis/Temporal passwords. |

**Both files are gitignored and must be created by hand on whichever machine
runs `docker compose up`** — neither `git pull` nor the image brings them.
Before first `up`, create `.env` next to `docker-compose.yaml`:

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

Compose refuses to start with a clear error if any of these are missing,
rather than silently falling back to a weak default.

---

## What `.env.prod` controls

These are **not** overridden by `docker-compose.yaml` — you must set them correctly in `.env.prod`:

- `JWT_SECRET` — change this to a strong random value in prod
- `EMAIL_PROVIDER`, `RESEND_API_KEY` / SMTP settings
- `CLOUDFLARE_*` — if using R2 for file storage
- `X_API_KEY/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`, etc. — social OAuth keys
- `OPENAI_API_KEY`
- `BILLING_PROVIDER`, `POLAR_*` keys and price IDs
- `NGROK_AUTHTOKEN` — only needed if you run ngrok for local webhook testing

---

## What `docker-compose.yaml` overrides (ignore in `.env.prod`)

The compose file's `environment:` block always wins over `.env.prod` for these:

| Variable | Hardcoded value |
|---|---|
| `DATABASE_URL` | `postgresql://${POSTARYX_DB_USER}:${POSTARYX_DB_PASSWORD}@postaryx-postgres:5432/${POSTARYX_DB_NAME}` — user/password/name come from the gitignored `.env`, not hardcoded; see [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P0-2 |
| `REDIS_URL` | `redis://:${POSTARYX_REDIS_PASSWORD}@postaryx-redis:6379` — password comes from the gitignored `.env`; see [1.SECURITY-HARDENING-TODO.md](./1.SECURITY-HARDENING-TODO.md) P1-3 |
| `TEMPORAL_ADDRESS` | `temporal:7233` |
| `MAIN_URL` | `http://localhost:4007` |
| `FRONTEND_URL` | `http://localhost:4007` |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:4007/api` |
| `BACKEND_INTERNAL_URL` | `http://localhost:3000` |
| `IS_GENERAL` | `true` |
| `DISABLE_REGISTRATION` | `false` |
| `STORAGE_PROVIDER` | `local` |
| `UPLOAD_DIRECTORY` | `/uploads` |
| `NEXT_PUBLIC_UPLOAD_DIRECTORY` | `/uploads` |

> **Real domain deployment**: update `MAIN_URL`, `FRONTEND_URL`, and `NEXT_PUBLIC_BACKEND_URL` in `docker-compose.yaml` before going live.

---

## ngrok / Polar webhook

- **Dev mode** (`pnpm run dev`): backend runs on host port 3000 → `ngrok http 3000` works as-is.
- **Prod docker**: port 3000 is internal to the container, not published. The full app is on port 4007 → use `ngrok http 4007` for webhook testing against a prod build.

---

## Starting prod

```bash
docker compose -p postaryx-prod pull postaryx
docker compose -p postaryx-prod up -d
```

- The `postaryx` service **pulls** a CI-built image from GHCR; it no longer builds
  locally. See the deployment runbook in [../README.md](../README.md).
- First boot takes ~30–60s after the pull: runs `prisma-db-push`, starts Temporal.
- App is available at [http://localhost:4007](http://localhost:4007).
- Stop with: `docker compose -p postaryx-prod down`

See [RUNNING-DEV-AND-PROD.md](./RUNNING-DEV-AND-PROD.md) for volume isolation details and the dev ↔ prod switching guide.
