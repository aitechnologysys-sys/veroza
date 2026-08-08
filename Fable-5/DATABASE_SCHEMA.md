# Database Schema

## Main Entities

The application database is PostgreSQL and is modeled with Prisma. The main business entities are:

- Organization: the workspace/account container. Most content, billing, integrations, users, media, webhooks, and API access belong to an organization.
- User: an individual person who can log in through local auth or an external provider.
- UserOrganization: the membership table connecting users to organizations with roles such as superadmin, admin, and user.
- Subscription: the organization's commercial plan, period, channel limits, lifetime status, and cancellation state.
- Credits: usage balances for AI-related features such as AI images and AI videos.
- Integration: a connected social/channel account, including provider type, profile data, tokens, posting times, disabled state, and provider-specific settings.
- Customer: a grouping object used to associate integrations with client/customer names.
- Post: a scheduled, draft, published, or failed piece of content tied to an organization and integration.
- Comments: collaboration comments on posts.
- Tags and TagsPosts: labels that organize posts.
- Media: uploaded or generated media assets.
- Webhooks and IntegrationsWebhooks: outbound automation hooks and their connected integrations.
- Signatures: reusable post signatures that can be auto-added.
- Sets: reusable saved content sets.
- AutoPost: RSS/URL-style automation rules for recurring content creation.
- Notifications: product notifications inside an organization.
- Errors: captured publishing/platform errors.
- ThirdParty: connected third-party provider records, such as HeyGen or Reelfarm.
- OAuthApp and OAuthAuthorization: developer OAuth apps and user/org approvals.
- Announcement: admin-created product announcements.
- Agent/Mastra tables: memory, messages, threads, traces, scorers, and workflow snapshots for AI agent features.

There are also marketplace/agency-oriented entities:

- SocialMediaAgency and SocialMediaAgencyNiche.
- MessagesGroup and Messages.
- Orders and OrderItems.
- PayoutProblems.

## Relationships

- One organization has many users through UserOrganization.
- One organization has one current Subscription.
- One organization has many integrations, posts, media files, tags, comments, webhooks, notifications, third-party connections, OAuth apps, and autopost rules.
- One integration belongs to one organization and can have many posts.
- One post belongs to one organization and one integration.
- One post can have comments, tags, errors, child posts, and a parent post.
- Tags and posts have a many-to-many relationship through TagsPosts.
- Webhooks and integrations have a many-to-many relationship through IntegrationsWebhooks.
- Users can belong to many organizations and can author comments.
- OAuth apps belong to organizations and can be authorized by users within organizations.
- Marketplace/order entities connect buyers, sellers, organizations, messages, order items, posts, and payout issues.

## Current Data Model

The schema is broad and product-oriented rather than minimal. It supports:

- Multi-tenant organizations.
- Team collaboration and roles.
- Multiple authentication providers.
- Billing and commercial plan enforcement.
- Social publishing to many providers.
- Scheduling, drafts, published states, failed states, recurring intervals, and grouped post sets.
- API/CLI/MCP/autopost creation attribution through a post creation method field.
- Media management.
- AI agent memory and observability tables.
- Public API and OAuth platform use cases.
- Marketplace and agency concepts that appear to be future-facing or less central than scheduling.

Important post states:

- QUEUE
- PUBLISHED
- ERROR
- DRAFT

Important subscription tiers:

- STANDARD
- PRO
- TEAM
- ULTIMATE

Important creation methods:

- WEB
- API
- MCP
- AUTOPOST
- CLI
- UNKNOWN

## Scalability Concerns

- Token and provider settings are stored directly on Integration records, with several provider-specific fields stored as strings. This keeps integration development flexible but can complicate analytics, validation, and migrations at scale.
- Post content and settings are also flexible, which is useful for many platforms but makes cross-platform reporting more difficult.
- The Post table is central and will grow quickly because every scheduled, published, failed, draft, and recurring post is stored there.
- The schema has many indexes on posts, integrations, organizations, and timestamps, which is good for operational queries but will need monitoring as usage grows.
- AI agent tables can grow quickly if chat histories, traces, scorers, and workflow snapshots are retained without lifecycle policies.
- Media storage is outside the database, but Media rows will grow with every upload or generated asset; retention and cleanup policies will matter.
- Marketplace/order tables add complexity even if the current product focus is scheduling.
- OAuthApp has a unique constraint involving organization and deletedAt that may effectively limit active app records per organization depending on database behavior and intended product rules.
- The project uses Prisma db push scripts, including an accept-data-loss option for local workflows; production schema migration discipline should be clearly defined before scaling a hosted service.
