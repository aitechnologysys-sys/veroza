# Postaryx Fork Migration Decisions

## 1. Migration Overview

Postiz and Postaryx are now separate products.

Postaryx was created from the Postiz codebase and is being moved toward its own product identity, package identity, deployment surface, and user-facing branding. This migration is not a blind rename. The goal is:

- establish Postaryx as an independent product
- preserve compatibility where existing technical boundaries still depend on Postiz-era identifiers
- avoid unnecessary breakage in i18n, env handling, external integrations, and upstream sync

This document records the major migration decisions reflected in the current uncommitted diff, why they were made, and what remains.

## 2. Major Changes Made

### Category: Product branding

What changed:
- User-facing product naming moved from `Postiz` / `GitroomHQ` to `Postaryx` across core app surfaces.
- Titles, headings, UI copy, SDK naming, and product references were updated where they represent the current product.

Why it changed:
- Postaryx is intended to launch as a distinct product, not as a hosted alias of Postiz.

Examples:
- frontend page titles and auth flows
- billing copy
- public API copy
- email copy for agency workflows

Decision status:
- Permanent

### Category: Frontend UI

What changed:
- Frontend product identity now presents as Postaryx.
- Logo asset was renamed for the primary frontend surface.
- User-facing wording in translations was updated in many locales without renaming the underlying translation keys.

Why it changed:
- Users should see Postaryx consistently in active product surfaces.

Examples:
- auth pages
- app layouts
- onboarding
- billing pages
- public API page

Decision status:
- Permanent for visible branding
- Temporary for internal translation key names

### Category: Backend identity

What changed:
- Backend package/app naming moved toward Postaryx.
- Backend product-facing strings and some runtime identifiers were updated where they affect user-visible behavior.

Why it changed:
- Backend-generated messages, metadata, and routes should align with the new product identity where they belong to Postaryx.

Examples:
- backend package names
- mobile OAuth callback default scheme
- swagger title
- agency emails and links

Decision status:
- Permanent

### Category: SDK/package identity

What changed:
- SDK package identity was changed to `@postaryx/node`.
- SDK docs and default production API endpoint were updated to Postaryx.

Why it changed:
- Postaryx needs its own product-facing SDK identity.

Examples:
- `apps/sdk/package.json`
- `apps/sdk/src/index.ts`
- `apps/sdk/README.md`

Decision status:
- Permanent

### Category: API/domain changes

What changed:
- Production-oriented defaults now point toward Postaryx API/domain targets rather than Postiz.
- Upload URL handling was moved behind configuration for frontend runtime usage.

Why it changed:
- Runtime code should not depend on legacy Postiz or Gitroom infrastructure for Postaryx surfaces.

Examples:
- `POSTARYX_API_URL`
- `POSTARYX_DOMAIN`
- `NEXT_PUBLIC_POSTARYX_UPLOAD_URL`

Decision status:
- Permanent
- Infrastructure behind some domains is still pending

### Category: OAuth/authentication

What changed:
- Preferred env naming changed from `POSTIZ_*` OAuth keys to `POSTARYX_*`.
- Frontend and backend logic accept `POSTIZ_*` as compatibility fallbacks.
- Mobile deep-link defaults moved from `postiz://` to `postaryx://`.

Why it changed:
- Postaryx needs its own auth identity, but existing deployments should not break immediately.

Examples:
- `POSTARYX_OAUTH_*`
- `NEXT_PUBLIC_POSTARYX_OAUTH_*`
- `MOBILE_APP_SCHEME` fallback default

Decision status:
- Permanent for new env names and product identity
- Temporary for old env fallbacks

### Category: Environment variables

What changed:
- New Postaryx-prefixed variables were added for API/domain/support email/upload URL/extension URL.
- Existing compatibility aliases were retained where removing them would break deployments.

Why it changed:
- Postaryx runtime behavior should be configurable without hardcoded Postiz destinations.

Decision status:
- Mixed: some are permanent new config, some are temporary compatibility support

### Category: Extension changes

What changed:
- Browser extension manifests and runtime allowlists were aligned to `postaryx.com`.
- Extension install CTA no longer sends users to the Postiz Chrome Web Store listing.
- Extension install link is now configurable; if missing, the install CTA is hidden.

Why it changed:
- Postaryx users must not be routed into the original Postiz extension listing.

Decision status:
- Permanent strategy
- Current rollout is temporary until a Postaryx listing exists

### Category: Billing/payment identity

What changed:
- Polar metadata uses `service: 'postaryx'`.
- Stripe was confirmed to still be active code when billing is enabled and `BILLING_PROVIDER` is not `polar`.
- Stripe metadata and webhook filtering were aligned from `gitroom` to `postaryx`.

Why it changed:
- If Stripe remains active for Postaryx, billing metadata must identify the correct product.

Decision status:
- Permanent if Stripe remains supported

### Category: Email/domain changes

What changed:
- Agency emails now use configurable Postaryx domain and support email.
- Hardcoded Postiz agency links were replaced with configurable Postaryx values.

Why it changed:
- Outbound Postaryx emails must not direct users to Postiz.

Decision status:
- Permanent

### Category: Documentation changes

What changed:
- README and product docs were partially updated toward Postaryx.
- Several support, docs, and integration links were intentionally left for later or converted into temporary placeholders where no final Postaryx destination exists yet.

Why it changed:
- Product-facing docs should begin reflecting Postaryx, but not by inventing infrastructure that does not exist yet.

Decision status:
- Mixed: some permanent, some temporary placeholders, some still pending

## 3. New Environment Variables

### `POSTARYX_API_URL`

Purpose:
- Preferred production API base URL for the Postaryx SDK and related product references.

Why:
- Avoid defaulting production-oriented flows to Postiz or localhost.

Used by:
- `apps/sdk/src/index.ts`

Production requirement:
- Yes, if Postaryx uses a dedicated public API host.

Type:
- Required for explicit production config
- Has a built-in default in SDK code

### `POSTARYX_DOMAIN`

Purpose:
- Primary product domain used in user-facing email links and related surfaces.

Why:
- Avoid hardcoded Postiz URLs in outbound messaging.

Used by:
- `libraries/nestjs-libraries/src/database/prisma/agencies/agencies.service.ts`

Production requirement:
- Yes

Type:
- Optional at code level because it falls back to `FRONTEND_URL` and then `https://postaryx.com`

### `POSTARYX_SUPPORT_EMAIL`

Purpose:
- Support email for Postaryx-generated communication.

Why:
- Avoid sending users or internal notification flows to Postiz-branded email addresses.

Used by:
- `libraries/nestjs-libraries/src/database/prisma/agencies/agencies.service.ts`

Production requirement:
- Yes for clean production branding

Type:
- Optional at code level because it falls back to `EMAIL_FROM_ADDRESS`

### `NEXT_PUBLIC_POSTARYX_UPLOAD_URL`

Purpose:
- Controls frontend runtime upload/media URLs for Postaryx surfaces.

Why:
- Avoid hardcoded `uploads.gitroom.com` references in runtime UI examples.

Used by:
- `apps/frontend/src/components/webhooks/webhooks.tsx`

Production requirement:
- Yes, if Postaryx serves uploads from its own host

Type:
- Optional at code level because it falls back to `https://uploads.postaryx.com`

### `NEXT_PUBLIC_POSTARYX_EXTENSION_URL`

Purpose:
- Controls the Postaryx browser extension install destination.

Why:
- Avoid sending users to the Postiz Chrome Web Store listing.

Used by:
- `apps/frontend/src/components/launches/add.provider.component.tsx`

Production requirement:
- Yes, if Postaryx plans to expose extension installation from the UI

Type:
- Optional
- If unset, the install CTA is hidden

### `NEXT_PUBLIC_POSTARYX_OAUTH_DISPLAY_NAME`

Purpose:
- Preferred frontend display name for generic OAuth login.

Why:
- Move public auth branding to Postaryx-prefixed config.

Used by:
- frontend app/provider/extension layouts

Production requirement:
- Optional

Type:
- Optional
- `POSTIZ` fallback still supported

### `NEXT_PUBLIC_POSTARYX_OAUTH_LOGO_URL`

Purpose:
- Preferred frontend logo for generic OAuth login.

Why:
- Move public auth branding to Postaryx-prefixed config.

Used by:
- frontend app/provider/extension layouts

Production requirement:
- Optional

Type:
- Optional
- `POSTIZ` fallback still supported

### `POSTARYX_GENERIC_OAUTH`

Purpose:
- Preferred generic OAuth enablement flag for Postaryx.

Why:
- Shift product config naming to Postaryx while preserving compatibility.

Used by:
- frontend layouts

Production requirement:
- Optional

Type:
- Optional
- `POSTIZ_GENERIC_OAUTH` fallback still supported

### `POSTARYX_OAUTH_URL`

Purpose:
- Parent OAuth provider URL for Postaryx generic OAuth configuration.

Why:
- Preferred new naming for Postaryx deployments.

Used by:
- environment documentation today

Production requirement:
- Depends on deployment

Type:
- Optional

### `POSTARYX_OAUTH_AUTH_URL`

Purpose:
- OAuth authorization endpoint.

Why:
- Preferred Postaryx naming.

Used by:
- `apps/backend/src/services/auth/providers/oauth.provider.ts`

Production requirement:
- Required when generic OAuth is used

Type:
- Required for that feature
- `POSTIZ_OAUTH_AUTH_URL` fallback still supported

### `POSTARYX_OAUTH_TOKEN_URL`

Purpose:
- OAuth token endpoint.

Why:
- Preferred Postaryx naming.

Used by:
- backend OAuth provider

Production requirement:
- Required when generic OAuth is used

Type:
- Required for that feature
- `POSTIZ_OAUTH_TOKEN_URL` fallback still supported

### `POSTARYX_OAUTH_USERINFO_URL`

Purpose:
- OAuth userinfo endpoint.

Why:
- Preferred Postaryx naming.

Used by:
- backend OAuth provider

Production requirement:
- Required when generic OAuth is used

Type:
- Required for that feature
- `POSTIZ_OAUTH_USERINFO_URL` fallback still supported

### `POSTARYX_OAUTH_CLIENT_ID`

Purpose:
- OAuth client ID for generic OAuth.

Why:
- Preferred Postaryx naming.

Used by:
- backend OAuth provider

Production requirement:
- Required when generic OAuth is used

Type:
- Required for that feature
- `POSTIZ_OAUTH_CLIENT_ID` fallback still supported

### `POSTARYX_OAUTH_CLIENT_SECRET`

Purpose:
- OAuth client secret for generic OAuth.

Why:
- Preferred Postaryx naming.

Used by:
- backend OAuth provider

Production requirement:
- Required when generic OAuth is used

Type:
- Required for that feature
- `POSTIZ_OAUTH_CLIENT_SECRET` fallback still supported

## 4. Domain Strategy

### `postaryx.com`

Current status:
- Treated as the canonical public site/root brand domain in config and docs.

Current code dependency:
- Yes, via defaults and product-facing links.

Infrastructure status:
- Domain ownership/DNS/hosting still need to be verified as live.

### `api.postaryx.com`

Current status:
- Treated as the intended public API host for SDK/default production references.

Current code dependency:
- Yes, SDK default and product-facing API references depend on this being the eventual public API.

Infrastructure status:
- Must exist before publishing SDK/docs that rely on it.

### `docs.postaryx.com`

Current status:
- Intended future docs host, but not yet the active code/documentation baseline.

Current code dependency:
- No hard runtime dependency in the current migration.

Infrastructure status:
- Still needs to be created if Postaryx wants a dedicated docs property.

### `app.postaryx.com`

Current status:
- Intended dedicated application host for the SaaS surface.

Current code dependency:
- Referenced in docs/strategy and expected deployment architecture.

Infrastructure status:
- Needs to be created/configured if Postaryx separates marketing site and app host.

### `uploads.postaryx.com`

Current status:
- Intended dedicated upload/media host.

Current code dependency:
- Used as the default for `NEXT_PUBLIC_POSTARYX_UPLOAD_URL`.

Infrastructure status:
- Needs to exist if Postaryx will serve uploads from a separate public host.

## 5. Things Intentionally NOT Changed

### Translation keys

Keys such as:

- `use_postiz_api_to_integrate_with_your_tools`
- `connect_your_mcp_client_to_postiz_to_schedule_your_posts_faster`
- `faq_postiz_gitroom_is_proudly_open_source`

were intentionally not renamed.

Why:
- The visible values were updated to Postaryx in many locales.
- Renaming keys requires coordinated changes across:
  - every locale file
  - frontend call sites
  - `i18n.lock`
- A separate i18n migration is safer than mixing key renames into product-surface rebranding.

### Internal packages

Example:
- `@postiz/wallets`

Why it remains:
- It is an external/internal package dependency boundary, not just copy.
- Renaming it requires either:
  - a real replacement package, or
  - a compatibility wrapper

This is migration work, not string cleanup.

### License and upstream references

Why they remain:
- Postaryx is a fork of Postiz.
- AGPL/legal attribution and upstream history must remain intact.
- Upstream sync docs and references are operationally important for future maintenance.

### Compatibility environment variables

Examples:
- `POSTIZ_OAUTH_*`
- `NEXT_PUBLIC_POSTIZ_OAUTH_*`
- `POSTIZ_GENERIC_OAUTH`

Why they remain:
- Existing deployments may still use them.
- The runtime now prefers `POSTARYX_*` but still accepts old names as fallbacks.
- Removing them now would create avoidable configuration breakage.

### Some internal runtime identifiers

Examples:
- workspace root package name
- selected internal ids and storage names

Why they remain:
- They are lower priority than user-facing separation.
- They can affect tooling, deployment continuity, or upstream mergeability.

## 6. Integration Decisions

### n8n

Current state:
- The public API UI still links to `n8n-nodes-postiz`.

Decision:
- Treat it as a shared compatibility integration for now.

Why:
- No Postaryx-owned package was identified in the repo or current migration context.
- Inventing a Postaryx package name would be misleading.

Current UI handling:
- The label was clarified as `N8N Node (Postiz-compatible)`.

Future action:
- Either publish a real Postaryx-owned n8n package and update the link
- Or remove the integration CTA until Postaryx owns the destination

### Stripe / pricing

Current state:
- Billing is controlled by `BILLING_ENABLED`.
- Provider selection is controlled by `BILLING_PROVIDER`.
- If billing is enabled and provider is not `polar`, Stripe is the active provider.

Decision:
- Stripe is active, not dead legacy.
- Stripe metadata and webhook filtering must identify Postaryx consistently.

Why:
- Keeping Stripe on `gitroom` while Polar uses `postaryx` creates inconsistent billing identity and webhook filtering behavior.

Current result:
- Stripe active service metadata was aligned to `postaryx`.

Future action:
- Audit Stripe dashboard/webhook filters and any external analytics/reconciliation systems for the service id change

### Extension

Current state:
- Runtime and manifests already align to `postaryx.com`.
- Public install flow previously still pointed to the Postiz Chrome Web Store listing.

Decision:
- No Postaryx user should be sent to Postiz for extension installation.

Current result:
- Install URL is now environment-driven through `NEXT_PUBLIC_POSTARYX_EXTENSION_URL`.
- If unset, the install CTA is hidden.

Future action:
- Publish or configure the real Postaryx extension listing

## 7. Remaining Work Before Production

### Must do before launch

- Create and verify Postaryx production domains:
  - `postaryx.com`
  - `app.postaryx.com`
  - `api.postaryx.com`
  - `uploads.postaryx.com`
- Create DNS and hosting/infrastructure behind those domains
- Create and configure the Postaryx browser extension listing
- Set `NEXT_PUBLIC_POSTARYX_EXTENSION_URL`
- Verify OAuth apps and callback URLs for Postaryx domains and `postaryx://` mobile scheme
- Verify Stripe dashboard/webhooks and any downstream consumers after the `service: 'postaryx'` change
- Decide whether `n8n-nodes-postiz` remains officially supported as compatibility or should be removed until a Postaryx package exists
- Confirm docs destinations instead of using temporary repo links/placeholders

### Can do later

- Translation key migration from `postiz` / `gitroom` key names to Postaryx-oriented key names
- Internal package cleanup where replacements do not yet exist
- Workspace/root package identity cleanup
- README and support/documentation polish
- Additional cleanup of old fallback email suffixes and legacy helper strings
- Broader internal identifier cleanup where runtime compatibility risk is low

## 8. Final Decision Summary

| Area | Decision | Reason | Future action |
|------|----------|--------|---------------|
| Product branding | Move active product surfaces to Postaryx | Postaryx is a separate product | Continue filling remaining UI/docs gaps |
| Frontend UI | Update visible copy first | User-facing separation matters most | Clean up remaining edge cases |
| Backend identity | Update product-facing backend defaults and copy | Emails, callbacks, metadata should represent Postaryx | Audit remaining non-user-facing legacy ids |
| SDK | Create Postaryx SDK identity | New product needs its own package and API identity | Maintain as independent package |
| OAuth env names | Prefer `POSTARYX_*` | New product config should use Postaryx names | Remove old fallbacks later if safe |
| `POSTIZ_*` OAuth fallbacks | Keep temporarily | Avoid breaking existing deployments | Remove in later compatibility cleanup |
| Translation keys | Keep old keys temporarily | Avoid breaking i18n references and `i18n.lock` | Do a dedicated key migration later |
| Translation values | Update visible values now | Users should see Postaryx | Finish remaining locale edge cases |
| `@postiz/wallets` | Keep | External dependency boundary still exists | Replace only when a real alternative exists |
| License/upstream refs | Keep | Legal attribution and upstream maintenance require them | Retain |
| n8n integration | Treat current package as compatibility | No verified Postaryx-owned package exists | Publish Postaryx package or remove CTA |
| Stripe identity | Align active metadata to Postaryx | Stripe remains an active provider path | Verify downstream systems |
| Polar identity | Keep `postaryx` service id | Correct for independent product separation | Verify external billing setup |
| Extension install link | Make configurable and hide if absent | Do not route Postaryx users to Postiz | Set real Postaryx listing URL |
| Upload URL | Move to env var | Avoid hardcoded Gitroom infrastructure in runtime UI | Provision upload host |
| Docs links | Partial update only | Some final Postaryx destinations do not yet exist | Replace placeholders with real docs/support properties |

