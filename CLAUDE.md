# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **fork of [Postiz](https://github.com/gitroomhq/postiz-app)** being taken in its own product direction. Names you will see:

| Where | Name |
|---|---|
| Product / brand (target) | **Postaryx** |
| Git repository (`origin`) | `aitechnologysys-sys/veroza` — **VEROZA** is the holding-company / repo name, not the product name |
| Upstream remote (`upstream`) | `gitroomhq/postiz-app` — the original Postiz repo, kept for pulling changes |
| Local directory | `postiz-app` (unchanged from the original clone) |
| `package.json` `name` | `gitroom` (unchanged upstream value) |

The rename to Postaryx is **not complete**. Code, packages, path aliases (`@gitroom/*`), env var names, database identifiers, and user-facing strings still say "postiz"/"gitroom" in most places. Do **not** do a blanket find-and-replace — a rename has to be scoped and deliberate (e.g. user-facing copy first, then env/config, and internal identifiers only if there's a concrete reason). Ask before renaming anything that crosses a runtime boundary: path aliases, env var names, Prisma model/column names, Stripe/Polar metadata values (`service: 'gitroom'` / `service: 'postiz'`), or the published SDK package.

Postiz/Postaryx is an AI social media scheduling tool supporting 28+ channels (Instagram, X, LinkedIn, YouTube, TikTok, Discord, Slack, Bluesky, etc.). Treat it as a production system — always consider backward compatibility and data migrations when changing the schema or existing behavior.

**Keeping close to upstream is a deliberate goal.** When there's a choice between an idiomatic-for-us change and one that mirrors what upstream Postiz does, prefer mirroring upstream — it keeps `git merge upstream/main` tractable. Where we intentionally diverge (e.g. the billing provider abstraction), document the divergence in `docs/`.

## Billing

Both `StripeService` and `PolarService` implement `IBillingProvider` and live behind two independent env switches:

| Var | Question it answers | Values |
|---|---|---|
| `BILLING_ENABLED` | Is billing **enforced** at all? | must be the literal `"true"`; anything else = free/self-hosted mode |
| `BILLING_PROVIDER` | **Which gateway** handles checkout? | `stripe` (default) \| `polar` |

**Currently active: Stripe.** Polar is implemented and parked.

`BILLING_ENABLED` is the single source of truth for enforcement, and it is read in exactly one place — `isBillingEnabled()` in `libraries/helpers/src/utils/is.billing.enabled.ts`. Import that function; **never** gate a feature on `process.env.STRIPE_*` or `process.env.POLAR_*`. Upstream Postiz used the presence of `STRIPE_PUBLISHABLE_KEY` as the enforcement gate in 15 scattered places; we deliberately diverge from upstream here. The only two legitimate `process.env.STRIPE_*` reads left in the tree are the Stripe SDK constructor and the `stripeClient` prop that feeds `loadStripe()`.

The Stripe API version is pinned explicitly in `stripe.service.ts` (`STRIPE_API_VERSION`), unlike upstream which inherits the SDK's default. It must stay in sync with the API version configured on the Stripe webhook endpoint — a mismatch fails silently. Don't remove the pin, and treat an SDK bump as a change that also touches the dashboard.

See **`docs/billing-current-state.md`** for the full picture: provider wiring, Stripe setup and test-mode products, webhook/ngrok setup, and the Polar feature gaps. Background: `docs/stripe-implementation.md` (pre-migration reference) and `docs/polar-integration-plan.md` (original plan, partially superseded).

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
