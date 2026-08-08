# Current Product State

## Maturity Level

Postiz appears to be a late-beta to production-capable product, especially for self-hosted and technically comfortable users. The core scheduling, integration, API, billing, media, and workflow architecture is substantial and goes well beyond a prototype.

Strategically, it is best described as a broad, actively evolving social media operating system rather than a narrow scheduler. That breadth is a strength, but it also means some advanced areas appear less mature than the core scheduling product.

## What Appears Production Ready

- Core monorepo structure and app separation.
- Next.js frontend and NestJS backend.
- PostgreSQL/Prisma persistence.
- Organization/workspace model.
- User authentication and multiple auth providers.
- Team membership and roles.
- Social channel connection model.
- Post scheduling, drafts, validation, state tracking, grouping, and deletion.
- Temporal-based background publishing workflows.
- Redis-backed API throttling.
- Media upload and storage abstraction.
- Public API for automation.
- Billing integration with Stripe and Polar.
- Email notification infrastructure.
- Sentry instrumentation.
- Docker Compose deployment path.
- Documentation for local development and deployment.
- Large provider ecosystem for social publishing.
- Admin views for stats and errors.

## What Is Still Missing Or Needs Strengthening

- Clear product-level documentation for which provider features are fully supported, partially supported, or limited by platform APIs.
- Clear operational guidance for production database migrations. The local workflow uses Prisma db push patterns that should not be treated as a full production migration process without review.
- Retention policies for AI logs, agent memory, media, workflow histories, notifications, and publishing errors.
- Stronger product packaging around AI agents, OAuth apps, marketplace/agency flows, and video generation.
- More explicit onboarding around required environment variables for each provider.
- More visible quality/status matrix for the many social integrations.
- Clear separation in product messaging between stable core features and experimental/extension features.
- Governance around token storage, provider-specific settings, and secret handling as deployments scale.
- Formal analytics coverage expectations by provider.
- More business-facing documentation for hosted vs self-hosted differences, support model, and enterprise readiness.

## Business Readiness Assessment

Postiz is strong enough to support real users for the main use case: connect channels, create content, schedule posts, and automate publishing. It also has credible foundations for teams, monetization, AI, APIs, and self-hosted deployment.

The main strategic risk is not lack of capability. The main risk is product sprawl: many integrations, AI features, automation surfaces, billing paths, and marketplace concepts are present at once. The next maturity step is to clarify the core commercial journey, identify which advanced modules are officially supported, and create operational guardrails for scale.
