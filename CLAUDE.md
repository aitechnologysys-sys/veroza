# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Postiz is an AI social media scheduling tool supporting 28+ channels (Instagram, X, LinkedIn, YouTube, TikTok, Discord, Slack, Bluesky, etc.). It's a production system with real users — always consider backward compatibility and data migrations when changing the schema or existing behavior.

## Monorepo Structure

PNPM workspace with two top-level areas:

**Apps** (`apps/`):
- `backend` — NestJS REST API (port 3000)
- `frontend` — Next.js 16 app (React 19, Vite for some parts)
- `orchestrator` — Temporal worker for background jobs (workflows + activities)
- `extension` — Browser extension
- `sdk` — Published npm package

**Libraries** (`libraries/`):
- `nestjs-libraries` — Shared backend code: Prisma DB layer, integrations, services, DTOs, emails, Redis, Temporal modules. **Most server logic lives here.**
- `helpers` — Shared utilities + the `useFetch` hook used by the frontend
- `react-shared-libraries` — Shared React components

**Path aliases** (defined in `tsconfig.base.json`):
- `@gitroom/backend/*` → `apps/backend/src/*`
- `@gitroom/frontend/*` → `apps/frontend/src/*`
- `@gitroom/nestjs-libraries/*` → `libraries/nestjs-libraries/src/*`
- `@gitroom/helpers/*` → `libraries/helpers/src/*`
- `@gitroom/react/*` → `libraries/react-shared-libraries/src/*`
- `@gitroom/orchestrator/*` → `apps/orchestrator/src/*`

## Commands

```bash
# Development
pnpm dev                        # run all apps in parallel
pnpm dev-backend                # backend + frontend only
pnpm dev:backend                # backend only
pnpm dev:frontend               # frontend only
pnpm dev:orchestrator           # orchestrator only
pnpm dev:docker                 # start docker deps (Postgres, Redis, Temporal)

# Build
pnpm build                      # build all apps sequentially
pnpm build:backend
pnpm build:frontend
pnpm build:orchestrator

# Database (Prisma 6.5 — always use the pinned version via pnpm dlx)
pnpm prisma-generate            # regenerate Prisma client after schema changes
pnpm prisma-db-push             # push schema to DB (used in dev/CI)

# Lint (root only)
pnpm eslint .

# Tests
pnpm test                       # jest with coverage
```

Node version: `>=22.12.0 <23.0.0`. Package manager: `pnpm@10.6.1`.

## Backend Architecture

Strict three-layer pattern — no shortcuts:
```
Controller → Service → Repository
```
Or with a manager layer:
```
Controller → Manager → Service → Repository
```

- **Controllers** live in `apps/backend/src/api/routes/` (one file per domain: posts, integrations, auth, media, billing, etc.) and `apps/backend/src/public-api/`.
- **Services and Repositories** live in `libraries/nestjs-libraries/src/database/prisma/<domain>/`. Each domain folder has a `*.service.ts` and `*.repository.ts`.
- **Business logic, integrations, emails, Redis, Temporal modules** all live under `libraries/nestjs-libraries/src/`.

The Prisma schema is at `libraries/nestjs-libraries/src/database/prisma/schema.prisma`. After any schema change: run `pnpm prisma-generate` (dev) or `pnpm prisma-db-push` (apply to DB).

## Orchestrator (Temporal)

Background jobs are implemented with [Temporal](https://temporal.io):
- **Workflows**: `apps/orchestrator/src/workflows/` — define durable, retryable job flows (post scheduling, email digests, token refresh, streak tracking, autopost)
- **Activities**: `apps/orchestrator/src/activities/` — actual side-effecting work (post publish, email send, integration API calls)

The backend enqueues work via the Temporal client; the orchestrator worker executes it.

## Social Integrations

Each platform is a provider class in `libraries/nestjs-libraries/src/integrations/social/`. They extend `social.abstract.ts` and implement the publish/analytics/oauth lifecycle. Adding a new platform means creating a provider here and registering it in `integration.manager.ts`.

## Frontend Architecture

Next.js 15 app router with grouped routes:
- `(app)/(site)/` — main authenticated app (launches/calendar, analytics, media, settings, billing, plugs)
- `(app)/auth/` — login, register, forgot password
- `(provider)/provider/` — OAuth callback pages
- `(extension)/modal/` — browser extension modal

**Data fetching**: always use SWR via the `useFetch` hook from `@gitroom/helpers/utils/custom.fetch.tsx`. Each SWR call must be in its own hook at the top level — never nest `useSWR` inside callbacks or object literals (violates `react-hooks/rules-of-hooks`).

```ts
// Correct
const useMyData = () => useSWR('/endpoint', fetch);

// Wrong — do not do this
const useMyData = () => ({
  data: () => useSWR('/endpoint', fetch),
});
```

**UI components**: reuse from `apps/frontend/src/components/ui/`. Check existing components before writing new ones.

## Styling

Tailwind 3 (`tailwind.config.cjs`). CSS variables are defined in:
- `apps/frontend/src/app/colors.scss` — color tokens
- `apps/frontend/src/app/global.scss` — global styles

Use the semantic Tailwind color names mapped to CSS variables (`primary`, `secondary`, `third`, `forth`, `fifth`, `sixth`, `seventh`, `gray`, `input`, `inputText`, `tableBorder`). Do **not** use `--color-custom*` variables — they are deprecated. Do **not** use hardcoded hex colors.

## Key Constraints

- **Production system** — migrations may be needed when changing the Prisma schema or existing API contracts.
- **PNPM only** — do not use npm or yarn.
- **No external UI component libraries** — write native components using Tailwind + existing patterns.
- **Linting** — run only from the repo root.
- **TypeScript strict mode** is on (`strict: true`) but `strictNullChecks` is off.
