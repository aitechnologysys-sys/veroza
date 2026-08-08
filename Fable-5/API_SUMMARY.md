# API Summary

## Major APIs

### Auth API

Handles registration, login, account activation, password recovery, OAuth login, mobile OAuth callback, registration availability, and provider existence checks.

### Users API

Handles the current user, profile updates, organization switching, organization membership, email notification settings, API key rotation, subscription lookup, subscription tiers, logout, agent media SSO, and impersonation.

### Integrations API

Handles connecting social channels, listing integrations, grouping integrations, customer/client assignment, nicknames, provider settings, posting times, mentions, provider functions, enable/disable/delete, plugs, Telegram updates, and Moltbook-specific flows.

### Posts API

Handles post listing, post details, post creation, post validation, draft creation, scheduling, date changes, post deletion, grouped posts, comments, tags, statistics, missing content detection, release IDs, short-link decisioning, and AI generation flows.

### Media API

Handles uploads, server-side upload handling, media metadata, media listing, media deletion, AI image generation, AI video generation, video options, and video provider functions.

### Public API

Provides automation endpoints for external clients:

- Upload files.
- Upload media from a URL.
- Find open posting slots.
- List posts.
- Create posts.
- Delete posts by ID or group.
- Check connection status.
- List integrations.
- Connect social integrations.
- Get notifications.
- Generate video.
- Call video functions.
- Delete integrations.
- Get integration settings.
- Get missing post content.
- Change post status.
- Update release IDs.
- Retrieve integration and post analytics.
- Trigger integration-specific functions.

### Billing API

Handles subscription status, discounts, trials, embedded checkout, subscription creation, billing portal, cancellation, proration, lifetime deals, charges, refunds, and admin subscription changes.

### Stripe And Polar Webhook APIs

Receive payment and subscription events from Stripe and Polar.

### Copilot And Agent API

Handles in-app copilot chat, Mastra agent chat, AI credit lookup, agent thread listing, and thread message history.

### Settings API

Handles team management and short-link preferences.

### Webhooks API

Handles webhook list, create, update, delete, and test/send operations.

### OAuth App API

Handles OAuth app list, create, update, delete, and client-secret rotation.

### OAuth Authorization API

Handles app authorization and token exchange for external applications.

### Approved Apps API

Lists and revokes apps a user or organization has approved.

### Third-Party API

Handles third-party provider listing, connected third-party accounts, deletion, submission, function calls, imports, and provider connection.

### Autopost API

Handles autopost rule list, create, update, delete, activate/deactivate, and manual send.

### Sets And Signatures APIs

Handle reusable content sets and reusable post signatures.

### Analytics API

Handles integration-level and post-level analytics.

### Admin, Monitor, Public, And Enterprise APIs

Support admin statistics, admin error visibility, queue monitoring, public post previews/comments, public agent endpoint, subscription modification, enterprise user creation, enterprise URL handling, and enterprise channel deletion.

## Services

Important backend services include:

- AuthService and AuthProviderManager for login and provider-based authentication.
- PermissionsService and policy guards for subscription/role-based access control.
- PostsService for scheduling, validation, creation, draft generation, post listing, and post state handling.
- IntegrationService, RefreshIntegrationService, and IntegrationManager for connected channels.
- MediaService and UploadFactory for uploads and storage.
- SubscriptionService, StripeService, and PolarService for billing.
- NotificationService for in-app notifications.
- WebhooksService for outbound automation hooks.
- OAuthService for developer-app authorization.
- AgentGraphService and MastraService for AI agent workflows.
- OpenaiService, FalService, and VideoManager for AI media and content generation.
- ShortLinkService for link-shortening decisions and provider routing.
- ThirdPartyManager and ThirdPartyService for external provider connections.
- Temporal workflow modules for scheduled and recurring background work.

## Integrations

The platform integrates with:

- Social publishing platforms: X, LinkedIn, Reddit, Instagram, Facebook, Threads, YouTube, Google Business Profile, TikTok, Pinterest, Dribbble, Discord, Slack, Kick, Twitch, Mastodon, Bluesky, Lemmy, Farcaster, Telegram, Nostr, VK, Medium, Dev.to, Hashnode, WordPress, Listmonk, Moltbook, Whop, Skool, and MeWe.
- AI providers and frameworks: OpenAI, CopilotKit, Mastra, LangChain/LangGraph, Tavily, fal.ai, Veo3/Kie.ai path, and ElevenLabs path.
- Billing providers: Stripe and Polar.
- Storage providers: local filesystem and Cloudflare R2/S3-compatible storage.
- Email providers: Resend and SMTP/Nodemailer.
- Short-link providers: Dub, Kutt, LinkDrip, and Short.io.
- Third-party creative/media providers: HeyGen and Reelfarm.
- Observability and tracking: Sentry, PostHog, GTM, Plausible/DataFast, and Facebook Pixel.
- Automation ecosystem: public API, Node SDK, OAuth apps, webhooks, and external automation tools such as n8n/Make-style workflows.
