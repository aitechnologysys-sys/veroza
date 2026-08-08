# Project Overview

## What The Product Currently Does

Postiz is an open-source social media management platform. It helps a user or team connect multiple social channels, create content, schedule posts, publish them through platform integrations, manage media assets, review analytics, and automate parts of the content workflow with AI.

The product is positioned as an alternative to tools such as Buffer, Hypefury, and Twitter Hunter, with a stronger emphasis on self-hosting, broad integration coverage, API automation, and AI-assisted content creation.

## Key Features

- Multi-channel social scheduling across major social, community, blog, and messaging platforms.
- Calendar/list based post management with drafts, queued posts, published posts, and failed posts.
- AI-assisted post generation, post splitting, image generation, video generation, and chat/agent workflows.
- Media library with local or cloud-backed upload storage.
- Team and organization workspace model with roles and subscription limits.
- Public API for automation, including upload, scheduling, integration listing, notifications, analytics, and post status updates.
- OAuth app support, allowing external apps to request access through Postiz.
- Webhooks and third-party integrations for automation.
- Billing support through Stripe and Polar.
- Analytics for connected integrations and individual posts where supported.
- Browser extension and provider-specific connection flows.
- Admin monitoring for usage stats and platform errors.

## User Journey

1. A user registers or logs in with email/password, Google, GitHub, Farcaster, wallet authentication, or a generic OAuth provider when configured.
2. The product creates or loads the user's organization workspace.
3. The user connects one or more social channels through supported provider flows.
4. The user uploads or generates media, writes content, and optionally uses AI to create drafts or split long content into channel-friendly posts.
5. The user schedules posts manually, saves drafts, or finds open posting slots.
6. Temporal-based background workflows publish scheduled content and refresh integration tokens.
7. The user reviews post status, errors, comments, notifications, and analytics.
8. Advanced users automate Postiz through the public API, webhooks, third-party tools, OAuth apps, or the SDK.

## Architecture Summary

Postiz is a TypeScript monorepo with several applications and shared libraries:

- Frontend: a Next.js React app that contains the user interface for scheduling, analytics, media, billing, settings, agents, and integrations.
- Backend: a NestJS API that handles authentication, organizations, posts, media, integrations, billing, AI, public API, OAuth apps, and admin endpoints.
- Orchestrator: a NestJS worker service using Temporal for scheduled publishing, token refreshes, email workflows, autopost workflows, and recurring jobs.
- Database: PostgreSQL managed through Prisma.
- Cache and rate limiting: Redis.
- Workflow engine: Temporal, with its own persistence and search stack in Docker.
- Shared libraries: reusable React components, NestJS services, integrations, upload providers, AI services, database services, and helpers.

## Major Strengths

- Very broad integration surface for social publishing and community platforms.
- Self-hostable architecture with Docker Compose and deployment documentation.
- Mature product modules beyond a simple scheduler: billing, organizations, public API, OAuth apps, webhooks, AI, media, analytics, and admin tooling.
- Strong automation story through public APIs, SDK, Make/n8n-style usage, webhooks, and MCP/agent-oriented code.
- Clear separation between user-facing app, backend API, worker/orchestrator, and shared libraries.
- Built-in extensibility patterns for new social providers, video providers, third-party providers, short-link providers, and authentication providers.

## Current Limitations

- Integration quality likely varies by provider because each social platform has different API rules, media limits, analytics support, and OAuth requirements.
- Several features appear advanced or emerging, especially AI agents, marketplace/order flows, third-party media providers, and video generation.
- The data model stores some flexible provider data as strings or JSON-like text, which is useful for speed but can make reporting, migration, and governance harder.
- Production operation depends on many environment variables and external vendor credentials.
- Billing is implemented for both Stripe and Polar, which is powerful but increases operational complexity.
- The app has many feature areas, but not all have equally visible product documentation or onboarding guidance inside the repository.
