# Tech Stack

## Frontend

- Next.js with React.
- TypeScript.
- Tailwind CSS, Sass, Mantine components, and shared in-repo React components.
- Tiptap editor tooling for rich text/content editing.
- Uppy and upload helpers for media upload workflows.
- Chart.js and analytics-oriented UI components.
- Sentry, PostHog, GTM, Plausible/DataFast/Facebook Pixel hooks where configured.
- Browser extension code exists as a separate app in the monorepo.

## Backend

- NestJS API application.
- TypeScript.
- Prisma ORM.
- PostgreSQL as the main application database.
- Redis for rate limiting and supporting infrastructure.
- Temporal client integration for workflow orchestration.
- CASL-style permission/authorization checks.
- Swagger-related tooling for API documentation.
- Sentry for error tracking and metrics.

## Infrastructure

- Monorepo managed with pnpm workspaces.
- Docker Compose for local and production-style deployments.
- PostgreSQL for app data.
- Redis for cache/rate-limit support.
- Temporal for background workflows.
- Temporal's Docker stack includes separate PostgreSQL and Elasticsearch services for workflow persistence and visibility.
- Optional local file storage or Cloudflare R2/S3-compatible storage for uploads.
- PM2 scripts exist for process-managed deployments.

## Third-Party Integrations

Implemented social/community/content integrations include:

- X
- LinkedIn profile
- LinkedIn page
- Reddit
- Instagram
- Instagram standalone
- Facebook
- Threads
- YouTube
- Google Business Profile
- TikTok
- Pinterest
- Dribbble
- Discord
- Slack
- Kick
- Twitch
- Mastodon
- Bluesky
- Lemmy
- Farcaster
- Telegram
- Nostr
- VK
- Medium
- Dev.to
- Hashnode
- WordPress
- Listmonk
- Moltbook
- Whop
- Skool
- MeWe

Other integrations and services found in the codebase:

- HeyGen and Reelfarm as third-party provider integrations.
- Short-link providers: Dub, Kutt, LinkDrip, Short.io, and an empty/no-op provider.
- Email providers: Resend and SMTP/Nodemailer.
- Billing providers: Stripe and Polar.
- Analytics/tracking integrations: Sentry, PostHog, GTM, Plausible/DataFast, Facebook Pixel.
- Newsletter-related providers: Beehiiv and Listmonk.
- OAuth and social auth vendors: Google, GitHub, Farcaster/Neynar, wallet authentication, and generic OAuth.

## Deployment

- Local development uses Docker for dependencies and pnpm scripts for app services.
- Production-style deployment uses Docker Compose with the app, PostgreSQL, Redis, and Temporal services.
- The production compose file expects environment variables for public URLs, credentials, billing, AI, social providers, email, and storage.
- Railway configuration is present.
- Jenkins build files are present.
- Deployment documentation exists for local development, production prerequisites, infrastructure/deployment, and Oracle VM deployment.

## Authentication

Supported authentication methods include:

- Local email/password registration and login.
- Google OAuth.
- GitHub OAuth.
- Farcaster authentication through Neynar.
- Wallet authentication.
- Generic OAuth provider support.

The product also supports:

- Account activation and resend activation flows.
- Forgot-password and reset-password flows.
- Organization membership and organization switching.
- API key rotation for public API access.
- Impersonation endpoints for privileged/admin use.
- OAuth application creation, authorization, token exchange, secret rotation, and approved-app management.

## AI Integrations

AI capabilities use several layers:

- OpenAI for chat, post generation, content extraction, post splitting, prompt generation, and image generation.
- CopilotKit for in-app copilot/agent chat.
- Mastra for agent runtime, memory, tools, and agent threads.
- LangChain/LangGraph packages for graph-style AI workflows.
- Tavily is referenced for research/search-style AI workflows.
- fal.ai for image/video model calls.
- Kie.ai/Veo3 path for video generation.
- ElevenLabs is referenced for audio/voice in video workflows.
- AI usage is tied to subscription/credit checks for image and video generation.
