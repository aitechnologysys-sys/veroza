# TikTok Content Posting API: posting-screen compliance

**Divergence from upstream Postiz.** TikTok's app review (Content Posting API audit) checks the posting
screen against its [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).
Upstream Postiz does not implement these, so we diverge here. Keep the changes when merging upstream.

| Guideline | Where |
|---|---|
| Call `creator_info/query` each time the posting screen opens | `TiktokProvider.creatorInfo()` (exposed via `POST /integrations/function`), loaded by `useCreatorInfo()` in `apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider.tsx` |
| Show the creator's nickname | Panel header: "Posting to {nickname}" + `@username` |
| Privacy options come only from `privacy_level_options`, with **no default** | Panel `privacy_level` select; `TikTokDto.privacy_level` is required for direct posts; the provider no longer falls back to `PUBLIC_TO_EVERYONE` and re-checks the level against `creator_info` at publish time |
| Comment / Duet / Stitch unchecked by default, and disabled when the creator turned them off | Panel checkboxes (shared `Checkbox` now honours `disabled`) |
| Duet / Stitch not shown for photo posts | Panel |
| Enforce `max_video_post_duration_sec` | Panel reads the video's duration; `TikTokDto.video_duration_sec` validator blocks posting |
| Disclosure: must pick "Your brand" and/or "Branded content"; label shown ("Promotional content" / "Paid partnership") | Panel + `TikTokDto.disclose` validator |
| Branded content cannot be private | `SELF_ONLY` disabled in the select; `TikTokDto.privacy_level` validator |
| Declaration always visible: Music Usage Confirmation (+ Branded Content Policy when branded) | Panel footer |
| Block posting when `creator_info` returns an error (e.g. posting cap reached) | `TikTokDto.creator_info_error` |

**Scope: the regular `tiktok` channel (Content Posting API).** The `tiktok-business` channel shares this
panel and `TikTokDto` but has no `creator_info` endpoint: for it the panel skips `creatorInfo`, shows the
full privacy list and keeps upstream's `PUBLIC_TO_EVERYONE` default (the Business API ignores privacy for
videos). The interaction defaults (all off), disclosure rules and declaration apply to both.

When merging upstream, also keep upstream's own additions to the panel (hide direct-post settings in
UPLOAD mode, Business music / location) - both sides were merged once in Nov 2026.

The DTO rules run both in the browser (form resolver) and on the server (`/posts/valid`). Tests:
`libraries/nestjs-libraries/src/dtos/posts/providers-settings/tiktok.dto.spec.ts`.

Also part of this change: the TikTok preview shows `@username` (scope `user.info.profile`). Published
posts link to TikTok through upstream's calendar "Open Post" button.
