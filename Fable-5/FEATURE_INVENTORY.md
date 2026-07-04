# Feature Inventory

## Implemented Features

### Account And Workspace Management

- User registration and login.
- Account activation.
- Forgot-password and reset-password flow.
- Resend activation email.
- Local email/password authentication.
- Google login.
- GitHub login.
- Farcaster/Neynar login.
- Wallet login.
- Generic OAuth login support.
- Organization creation and membership.
- Organization switching.
- Team member invitation/addition.
- Team member removal.
- User profile/personal settings.
- Email notification preferences.
- API key rotation.
- Admin impersonation.

### Social Channel Integrations

- Connect social/provider accounts.
- List available social integrations.
- List connected channels.
- Group integrations.
- Rename/nickname integrations.
- Assign customer/client names to integrations.
- Configure integration-specific settings.
- Configure preferred posting times per integration.
- Enable, disable, and delete integrations.
- Refresh extension-based integrations.
- Trigger provider-specific integration functions.
- Fetch mentions where supported.
- Handle Telegram updates and Moltbook registration/status flows.

Implemented provider list:

- X
- LinkedIn
- LinkedIn Page
- Reddit
- Instagram
- Instagram Standalone
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

### Post Creation And Scheduling

- Create posts from the web app.
- Save drafts.
- Schedule queued posts.
- Publish through connected integrations.
- Group related posts across platforms.
- Edit scheduled dates.
- Delete post groups.
- Find the next available posting slot.
- Find the next available posting slot for a specific integration.
- Validate posts server-side before scheduling.
- Detect missing content for a post.
- Export debug data for a post group for superadmins.
- Track post creation source: web, API, CLI, MCP, autopost, or unknown.
- Generate drafts from AI-created content.
- Generate posts from source content.
- Split long content into separate posts.
- Apply tags to posts.
- Create, edit, list, and delete tags.
- Add comments to posts.
- View public post previews and comments.
- Update release IDs and release URLs.
- Track post-level errors and publishing states.

### Media And Creative Tools

- Upload media through the app.
- Upload media through the public API.
- Upload media from a URL through the public API with file validation.
- Save media metadata.
- Delete media.
- Retrieve media library items.
- Generate AI images.
- Generate AI images from prompts.
- Generate AI videos.
- Retrieve available video options.
- Call video provider functions.
- Support local disk storage.
- Support Cloudflare R2/S3-compatible storage.
- Support Transloadit configuration in the frontend layout.

### AI And Agent Features

- In-app copilot chat.
- Mastra-based Postiz agent.
- Agent thread list and thread message recall.
- AI post generation.
- AI draft generation.
- AI post splitting.
- Website/content extraction into post ideas.
- AI prompt generation for image creation.
- AI voice text generation for video workflows.
- AI image generation using OpenAI image models.
- fal.ai image/video model calls.
- Video generation through Image Text Slides and Veo3-style providers.
- Agent tools for listing integrations, validating/scheduling posts, triggering integrations, uploading from URL, generating images, and generating videos.
- AI credit checks by organization and feature type.

### Analytics And Monitoring

- Integration analytics endpoint.
- Post analytics endpoint.
- Platform analytics UI components.
- GitHub stars/forks analytics components.
- Admin stats page.
- Admin errors page.
- Platform error listing.
- Queue monitor endpoint.
- Sentry instrumentation and metrics hooks.

### Billing And Commercial Features

- Subscription lookup.
- Subscription tiers.
- Stripe checkout/subscribe flow.
- Stripe customer portal.
- Stripe webhook handling.
- Stripe charges and refund-related admin endpoints.
- Trial finishing/checking.
- Discount checking and application.
- Proration.
- Subscription cancelation.
- Manual subscription add/cancel endpoints.
- Lifetime deal flow.
- Polar payment webhook handling.
- Configurable billing provider selection.
- Organization subscription and channel-limit enforcement.
- AI credit accounting.

### Automation And Developer Platform

- Public API for uploads, upload-from-url, post listing, post creation, post deletion, post status updates, integrations, notifications, video generation, analytics, and integration triggers.
- Organization API key support.
- Node SDK package.
- Webhook creation, update, deletion, listing, and test/send support.
- Third-party integration management.
- HeyGen and Reelfarm third-party provider integrations.
- OAuth app creation, update, deletion, secret rotation, authorization, token exchange, and approved-app deletion.
- MCP/agent-oriented code paths and creation method tracking.

### Content Utilities

- Reusable signatures.
- Default signature lookup.
- Signature create, update, delete, and auto-add support.
- Reusable content sets.
- Content set create, update, delete, and listing.
- Autopost rules for URL/RSS-style recurring content.
- Autopost activate/deactivate.
- Autopost manual send.
- Short-link preference setting.
- Short-link provider support for Dub, Kutt, LinkDrip, and Short.io.

### Admin And Operations

- Announcements list, create, and delete.
- Admin stats.
- Admin publishing/platform errors.
- User impersonation.
- Enterprise endpoints for creating users, resolving URLs, and deleting channels.
- Health and root endpoints.
- Temporal workflows for scheduled posts, missing post handling, token refresh, digest emails, streak emails, autopost, and send-email flows.

## Features Partially Implemented

- Agency/marketplace flow: database entities for agencies, orders, messages, order items, and payout problems exist, but this appears less central and less visibly exposed than the core scheduler.
- AI agents: substantial infrastructure exists, but these features are likely still evolving because they depend on Mastra, CopilotKit, OpenAI, Tavily, tools, memory, and credit logic.
- Video generation: Image Text Slides and Veo3 providers exist, but availability depends on external credentials and provider readiness.
- Third-party provider ecosystem: HeyGen and Reelfarm are implemented, but the abstraction suggests more providers are expected.
- Custom Mastodon provider: the provider file exists, but it is commented out of the main integration list.
- OAuth platform: app registration, authorization, token, and approved-app flows exist, but product packaging and developer documentation may need strengthening for broad adoption.
- Enterprise endpoints: useful building blocks exist, but they look more like specialized operational APIs than a full enterprise admin product.

## Planned Extension Points Found In The Code

- Social integration provider abstraction for adding more publishing platforms.
- Provider-specific plugs and internal plugs.
- Provider-specific validation schemas and custom functions.
- Third-party provider abstraction.
- Video provider abstraction.
- Short-link provider abstraction.
- Authentication provider abstraction.
- Upload storage provider abstraction.
- Billing provider selection between Stripe and Polar.
- Public API and SDK for external automation.
- OAuth app model for building a developer platform around Postiz.
- MCP/agent tools for AI-driven automation.
- Temporal workflow versioning for scheduled publishing behavior.
