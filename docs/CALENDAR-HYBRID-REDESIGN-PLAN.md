# Calendar tab (`/launches`) — hybrid redesign implementation plan

Status: **approved design, not started** (written 2026-10-19).
Scope: **UI only** for the Calendar tab. No behaviour, data, API or state change.

## 1. Design reference

Canvas: https://claude.ai/artifact/DpZwFfefgPsxANg9mNrSsP

| Artboard | Use |
|---|---|
| `Main.dc.html` — "Hybrid calendar — light" | Source of truth for layout, spacing and the light theme |
| `HybridDark.dc.html` — "Hybrid calendar — dark" | Same markup with `theme="dark"`; source of the dark tokens |
| `ModalA/ModalADark/ModalB/ModalC` | **Out of scope.** Create Post modal is still being decided (A vs C). Do not touch `components/new-launch/*`. |

To read the exact markup and token values in a new session, use the Artifact tool with
`action: "read"`, `url` above, `path: "project/Main.dc.html"`. The tokens are in that
file's `renderVals()`; they are also copied in §5 below.

The hybrid is three earlier directions combined:

- **Channel dock (from "C")** — channels move from the left sidebar into a horizontal dock above the calendar.
- **Masthead + type (from "E")** — "Week 43" in Fraunces, italic date range, round prev/next, black "Today" pill, underlined text tabs for Day/Week/Month and Calendar/List, customer pill.
- **Grid (from "D")** — rounded, gapped cells; posts as tiles with a coloured top band (tag tint + platform + time chip) and a body (avatar, one line of text, tag/draft line).

### Important: the app shell is NOT part of this redesign

The mockup shows a `Postaryx · Calendar Agent Analytics Media Plugs` bar at the very top. That is a
**stand-in** for the real app shell. The real shell — left icon rail (`TopMenu`) and the 80px header
(`Title`, streak, org selector, mode toggle, language, extension, feedback, notifications) in
`components/new-layout/layout.component.tsx` — is shared by every page and **stays exactly as it is**.
Everything in this plan lives inside `LaunchesComponent`, i.e. the `children` slot of that shell.

## 2. Hard rules (read before writing code)

1. **Do not change behaviour.** Only JSX structure, `className`, inline presentational styles, and new
   presentational wrappers. Every handler, hook, prop, condition, `ref`, cookie, URL param, fetch and SWR key
   stays byte-for-byte the same.
2. **Do not touch these files at all:**
   `calendar.context.tsx`, everything in `components/new-launch/`, `components/new-layout/*`,
   `components/layout/top.menu.tsx`, any backend file, `posts.list.minify.ts`.
3. **Handlers/hooks inside files you do touch are frozen:** `usePostActions`, every `useDrop`/`useDrag`
   spec (including the "already published — update or reschedule?" dialog in `CalendarColumn`),
   `addModal`, `getDateRange`, `setToday/setDay/setWeek/setMonth/setList/setCalendarView/setCustomer/next/previous`,
   `previousPage/nextPage/setListStateFilter`, `changeItemGroup`, `refreshChannel`, `continueIntegration`, `update`.
   Move the JSX that *calls* them, never the functions themselves.
4. **No hardcoded hex in components** (repo rule, `CLAUDE.md`). Add CSS variables in `colors.scss`
   for both `.dark` and `.light`, map them in `tailwind.config.cjs`, use the Tailwind names.
   The one allowed dynamic colour is the tag colour from the DB (already applied inline today).
5. **Keep both themes working.** Theme = `mode` cookie → `body.dark` / `body.light`
   (`components/layout/mode.component.tsx`). Every new token needs a value in both blocks.
6. **Keep RTL working.** Keep `rtl:rotate-180` on directional chevrons; use `start/end`, `ps/pe`, `ms/me`
   instead of `left/right`, `pl/pr`, `ml/mr`.
7. **New user-facing strings** go through `t('key', 'Default')` and get added to
   `libraries/react-shared-libraries/src/translation/locales/en/translation.json`.
   Other locales are filled by the lingo.dev pipeline (`i18n.json`); don't hand-edit them.
8. **Commits:** only when the user asks; one-line messages; never push.

## 3. Behaviour inventory — everything that must still work

Use this as the QA checklist (§8). Code anchors are current line numbers, approximate.

**Channel area** (`launches.component.tsx`, `add.provider.component.tsx`, `new.post.tsx`, `generator/generator.tsx`, `menu/menu.tsx`)
1. Collapse / expand channels — `collapseMenu` cookie (`launches.component.tsx:362`). In the dock this becomes "Hide channels / Show channels".
2. Add Channel button and the separate **"Send invite link to a customer"** button (`add.provider.component.tsx:~50–95`).
3. Create Post (`NewPost`, opens Set picker first when sets exist).
4. Generate with AI (`GeneratorComponent`) — only when `sortedIntegrations.length > 0 && user.tier.ai && billingEnabled`.
5. Create Post only shows when there is at least one channel.
6. Customer groups: header click toggles open/closed, persisted in `localStorage[group.name + '_isOpen']`.
7. Drag a channel onto another customer group → `changeItemGroup` (react-dnd type `'menu'`; `useDrop` on the group, `useDrag` on the name handle, `dragPreview` on the row).
8. Disconnected channel (`refreshNeeded`) → click reconnects; tooltip "Channel disconnected, click to reconnect."
9. Unfinished setup (`inBetweenSteps`) → red "!" overlay, click continues setup.
10. Disabled channel → 50% opacity; upgrade tooltip only when `totalNonDisabledChannels === user.totalChannels`.
11. Channel ⋯ menu (`<Menu …>`): create post, copy ID, reconnect, update credentials, additional settings, change bot picture/nickname, move/add to customer, edit time slots, enable/disable, delete. Pass the same props.
12. Tooltip with channel name when collapsed.
13. Empty state when there are no channels (illustration switches on `mode`).
14. Lifetime tier label and `NEXT_PUBLIC_VERSION` text (bottom of today's sidebar) must still render somewhere — put them at the end of the dock, muted mono.
15. `?msg=` / `?added=` / `window.opener` effects — untouched.

**Masthead / filters** (`filters.tsx`, `select.customer.tsx`)

16. Prev / next period; Today (no-op if already on current range).
17. Day / Week / Month switch (hidden in List mode).
18. Calendar / List toggle.
19. Customer select — component returns `null` when ≤1 customer; keep that.
20. List mode: pager "Page X of Y" with disabled states; state filter All / Scheduled / Draft / Published.
21. Range text per mode (see §6.3).

**Grid** (`calendar.tsx`)

22. Click empty future slot → `addModal` (Month uses random hour; current hour → now+10min).
23. Day view: empty slot shows the time-slot channels' avatars (greyscale, colour on hover).
24. Drag post to future slot; published/past-queued post asks "update or reschedule".
25. Past slots: `repeated-strip` hatch, `cursor-not-allowed`, no drop, `col-calendar` hover text "Date passed".
26. Drop target highlight while dragging over (`canDrop`).
27. Loading pulse overlay (`loading`).
28. Post tile: click → edit; hover → duplicate, preview (`/p/:id?share=true`), statistics **or** "connect post" when `releaseId === 'missing'` (hidden for X when `disableXAnalytics` or when no `releaseId`), delete, and **Copy debug JSON for super-admins only**.
29. Error state: red ring + "!" with `post.error` tooltip.
30. Draft prefix; tag names (comma-joined) and first tag's colour; `isBeforeNow` greyscale.
31. Creation-method badge when impersonating.
32. Show more (N) / Show less after 3 posts.
33. Today highlight in week header; Month: prev/next-month days present.
34. List view: date-grouped, time shown, empty-state messages per filter.

## 4. Files you will edit

| File | What changes |
|---|---|
| `apps/frontend/src/app/colors.scss` | New `--cal-*` tokens in `.dark` and `.light` (§5) |
| `apps/frontend/tailwind.config.cjs` | Map the new tokens to Tailwind colour names |
| `apps/frontend/src/app/global.scss` | Only if needed: `.repeated-strip` stripe tokens / spacing; keep class names |
| `components/launches/launches.component.tsx` | Sidebar → dock: `LaunchesComponent` outer layout, `MenuGroupComponent`, `MenuComponent` markup |
| `components/launches/add.provider.component.tsx` | Restyle the two buttons in `AddProviderButton` only (not the modal it opens) |
| `components/launches/new.post.tsx` | Restyle the Create Post button only |
| `components/launches/generator/generator.tsx` | Restyle the trigger div only (lines ~323+) |
| `components/launches/menu/menu.tsx` | Trigger styling only, if the ⋯ needs to sit on the avatar |
| `components/launches/filters.tsx` | Masthead layout and controls |
| `components/launches/select.customer.tsx` | Pill trigger styling only |
| `components/launches/calendar.tsx` | `WeekView`, `MonthView`, `DayView`, `ListView`, `CalendarColumn`, `CalendarItem` markup/classes |
| `libraries/react-shared-libraries/src/translation/locales/en/translation.json` | New keys (§7) |

These files also exist upstream (Postiz). Expect merge conflicts in them on future `git merge upstream/main`;
this document is the record of the intentional divergence.

## 5. Design tokens

Add as CSS variables (names are suggestions; keep the `--cal-` prefix so they're easy to find).
Values are taken from the canvas.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--cal-bg` | `#f7f6f3` | `#141210` | page area behind masthead and grid |
| `--cal-dock` | `#fbfaf8` | `#191712` | channel dock background |
| `--cal-card` | `#ffffff` | `#24211c` | post tile surface |
| `--cal-cell` | `#efece6` | `#1f1c17` | empty grid cell |
| `--cal-today` | `#fbefe7` | `#26190f` | today's column cells |
| `--cal-ink` | `#191712` | `#f4f1ea` | rules, Today pill bg, active tab text |
| `--cal-ink-inverse` | `#f7f6f3` | `#141210` | text on the Today pill / "+ Post at" block |
| `--cal-muted` | `#5f5b52` | `#a8a297` | secondary text, inactive tabs |
| `--cal-line` | `#e7e3db` | `#2a2620` | hairlines |
| `--cal-line-strong` | `#cfc8bb` | `#4a4438` | dashed borders, separators |
| `--cal-ember-soft` | `#f4e7df` | `#2e1a10` | drop-target fill, active nav tint |
| `--cal-ember-text` | `#9a330a` | `#f08a5d` | ember text on soft ember |
| `--cal-teal-bg` / `-fg` / `-line` | `#dff6f4` / `#0f766e` / `#b8e6e1` | `#12302d` / `#7fd8cd` / `#1d4f4a` | Generate (AI) button |
| `--cal-danger` / `-soft` | `#b42318` / `#fbeae8` | `#ff8a80` / `#3a1712` | delete action, failed badge |
| `--cal-hatch-a` / `-b` | `#ebe8e1` / `#f3f1ec` | `#1a1814` / `#201d18` | past-slot stripes |

Ember stays the existing `--new-btn-primary` (`#c2410c`).

**Tag band:** tint the band from the tag colour that's already applied inline today:
`style={{ backgroundColor: \`color-mix(in srgb, ${tagColor} 22%, var(--cal-card))\` }}`.
No tag → `var(--cal-line)`. Keep the text inside the band in `--cal-muted` / `--cal-ink`; don't
put text directly in the tag colour (arbitrary user colours fail contrast).

**Fonts:** Fraunces (`font-serif`), Geist (`font-sans`) and Geist Mono (`font-mono`) are already loaded
via `next/font` in `app/(app)/layout.tsx`. The mockup's mono is IBM Plex Mono; use `font-mono` (Geist Mono)
so the root layout isn't touched. Swapping to Plex later is a one-line font change, ask first.

**Radii / spacing:** cells 14px, tiles 12px, pills fully rounded, grid gap 8px, page padding 24–32px.

## 6. Implementation steps

Do them in this order; each step should leave the page working.

### 6.1 Tokens
Add §5 variables to both `.dark` and `.light` in `colors.scss`; map in `tailwind.config.cjs`
(e.g. `calCell: 'var(--cal-cell)'`). No visual change yet.

### 6.2 Layout shell of the tab (`LaunchesComponent`)
Today: `[sidebar 260/100px] [flex-1: <Filters/> <Calendar/>]` side by side.
New: one column — `[dock] [masthead (<Filters/>)] [grid (<Calendar/>)]`.

- Keep `<DNDProvider>`, `<Onboarding/>`, `<CalendarWeekProvider integrations={sortedIntegrations}>` wrappers exactly as they are.
- Keep the loading early-return.
- Keep the `collapseMenu` cookie. **Collapsed ("Hide channels") = a slimmer dock that still shows every channel avatar, as small icons (about 28px), with no name labels underneath; the name shows as a tooltip (the existing `collapsed` → `data-tooltip-content={integration.name}` logic).** Create Post / Generate / Add Channel / invite shrink to icon-only buttons, and the toggle reads "Show channels". Expanded = 44px avatars with names under them, and full-label buttons. Decided by the user on 2026-10-19; this mirrors the old collapsed sidebar, which kept icons and avatars and dropped the labels. Every per-channel state (disconnected "!", unfinished setup, disabled, ⋯ menu, drag to another customer group) must still work in the collapsed dock. The `group sidebar` class trick that hides labels can be replaced by plain conditionals on `collapseMenu === '1'`.

### 6.3 Channel dock
- Row: Create Post pill (ember) · Generate circle (teal, same visibility condition) · divider · groups · Add Channel (dashed circle) + invite button · spacer · tier/version text · Hide channels.
- `MenuGroupComponent` → an inline group: ungrouped channels render without a label; customer groups get a dashed pill label (`▸ NORTHWIND`) that toggles open/closed (same `changeOpenClose`, same localStorage key). The group wrapper keeps `ref={drop}` and the `isOver` overlay.
- `MenuComponent` → avatar (44px circle, platform badge bottom-end) with name under it (11.5px muted, ellipsis).
  - Keep `ref={dragPreview}` on the item root and `ref={drag}` + `role="Handle"` on the drag handle (make it the avatar+name block).
  - `refreshNeeded` → red ring + "!" badge, same onClick/tooltip. `inBetweenSteps` → same overlay click.
  - Disabled → opacity + same tooltip condition.
  - ⋯ `<Menu …/>` sits on the avatar's top-end corner, visible on hover/focus. Pass identical props.
- Overflow: dock scrolls horizontally (`overflow-x-auto`) when there are many channels.
- No channels → dock shows Add Channel + the existing empty-state copy inline (illustration optional; keep the `mode` switch if kept).

### 6.4 Masthead (`filters.tsx`)
Layout from the canvas:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  (3px --cal-ink rule)
POSTARYX · CALENDAR ───────────────── MONDAY, OCTOBER 19, 2026   (mono 11px, muted)
Week 43  October 19 – 25        (‹)(›)(Today)  Day Week Month | Calendar List  (👤 All customers ▾)
───────────────────────────────────────────────  (1px --cal-ink rule)
```
- Title per mode (display only, computed from `calendar.startDate/endDate` with `newDayjs`):
  - week → `t('week_number', 'Week {{number}}')` with `isoWeek()`; subtitle `MMMM D – D` (cross-month: `MMM D – MMM D`).
  - day → `dddd`; subtitle `LL`.
  - month → `MMMM`; subtitle `YYYY`.
  - list → `t('all_posts', 'All posts')`; subtitle = the existing "Page X of Y".
- Eyebrow right side: today's date, localized (`newDayjs().format('dddd, LL')`), upper-cased via CSS.
- Prev/next = 40px circles with `--cal-ink` border; Today = ink pill. Same handlers.
- Day/Week/Month and Calendar/List = text buttons in Fraunces 18px; active = 600 weight + 2px ember underline; use real `<button>`s with `aria-pressed`.
- List mode keeps the pager and the All/Scheduled/Draft/Published filter (same handlers/disabled logic), styled as the same underlined tabs.
- `SelectCustomer` → pill trigger (1px ink border, radius full). Keep its dropdown, toast and `null` return.

### 6.5 Week grid (`WeekView`, `CalendarColumn`, `CalendarItem`)
- Container: `grid-template-columns: 64px repeat(7, minmax(0,1fr))`, `gap: 8px`, keep the sticky header and the `overflow-auto` scroll box.
- Day header: big Fraunces date number + mono weekday; today = ember, 40px, `MON · TODAY`, 3px ember bottom border; others 26px with 1px ink bottom border. Keep `newDayjs().format('L')` comparison.
- Hour label: mono 11px muted, right-aligned (`convertTimeFormatBasedOnLocality` unchanged).
- `CalendarColumn` root keeps `ref={drop}` and all conditional classes' **meaning**: past → hatch + not-allowed (+ `col-calendar` when empty); loading → pulse; `canDrop` → 2px ember border + `--cal-ember-soft` fill (+ optional "Drop to move here" text, new string). Cell: 14px radius, `--cal-cell` (today column `--cal-today`), 4px padding.
- Empty future slot hover: the existing `+` becomes the ink block "＋ Post at {time}" (`t('post_at', 'Post at {{time}}')`, time from `getDate`). Same `onClick={integrations.length ? addModal : addProvider}`.
- `CalendarItem` → tile:
  - band (30px): platform name (mono 10px, from `post.integration.providerIdentifier`, upper-case) left, time chip (dark pill, mono 10px) right. Tag-tinted per §5. Drafts: transparent band, dashed tile border.
  - body: 22px avatar + platform badge, one line of `stripHtmlValidation(...)` text, second line = tag names joined (or "Draft"/"Draft · tag"), coloured with `--cal-muted`/ember.
  - hover row (replaces nothing — appears under the body on `group-hover`): debug JSON (super-admin), duplicate, preview, statistics / missing-release (exact same conditional as today), delete (`--cal-danger`). Same onClick props.
  - error: 2px danger border + "! Failed" chip top-start with the existing `post.error` tooltip.
  - keep `ref={dragRef}`, `opacity` from `useDrag`, `isBeforeNow` greyscale, creation-method badge.
- Show more / less → small pill buttons, same handlers and counts.

### 6.6 Month, Day, List views
Not separately drawn; apply the same language:
- **Month:** same cell/tile styling; date number in Fraunces top-start; prev/next-month days muted; today ember circle. Tiles may drop the band and use a compact one-line chip (platform dot · time · text) to fit 3 per cell — keep "Show more".
- **Day:** rows per time slot; time label in mono on the left; posts as full tiles in a wrapping row; empty-slot channel avatars keep greyscale→colour hover.
- **List:** date group headings in Fraunces 20px with a hairline; each post as a wide tile (reuse `CalendarItem` with `showTime`), same empty-state messages.
If anything here is unclear, ask the user for artboards before guessing.

### 6.7 Strings (§7) and RTL pass
### 6.8 QA (§8), then `pnpm eslint .` from the repo root and `pnpm build:frontend`.

## 7. New translation keys (en only)

| Key | Default |
|---|---|
| `week_number` | `Week {{number}}` |
| `all_posts` | `All posts` |
| `hide_channels` | `Hide channels` |
| `show_channels` | `Show channels` |
| `post_at` | `Post at {{time}}` |
| `drop_to_move_here` | `Drop to move here` (only if used) |
| `failed` | `Failed` |
| `today_label` | `Today` (only if the `MON · TODAY` suffix is used; `today` already exists — prefer reusing it) |

Check `en/translation.json` first; reuse existing keys (`today`, `day`, `week`, `month`, `show_more`, `show_less`, `draft`, …).

## 8. QA checklist

Run `pnpm dev-backend` and open `http://localhost:4200/launches`. Test **each item in both light and dark**
(toggle via the header mode switch), and once in an RTL language (Hebrew or Arabic).

- [ ] Every item 1–34 in §3.
- [ ] Collapsed dock (cookie `collapseMenu=1`) survives reload, shows small avatar icons with name tooltips, and every channel state/menu/drag still works there.
- [ ] 0 channels / 1 channel / many channels (dock scrolls).
- [ ] One customer (customer pill hidden) vs several customers.
- [ ] Billing off or no AI tier → Generate hidden.
- [ ] Super-admin → debug JSON icon present; normal user → absent.
- [ ] Impersonating → creation-method badge shows.
- [ ] Drag a published post → dialog appears; cancel leaves it in place.
- [ ] Drag a repeating post (`intervalInDays`) → calendar reloads.
- [ ] Past-slot hover shows "Date passed"; drop is refused.
- [ ] List mode: pager disabled states at first/last page; each state filter's empty message.
- [ ] URL params (`display`, `startDate`, `endDate`, `customer`) and `calendar-display` cookie unchanged in behaviour.
- [ ] Narrow window (~1024px and phone width): masthead wraps, grid scrolls horizontally, nothing overlaps.
- [ ] `git diff` review: changed lines are markup/classes/tokens/strings only — no logic diffs in the frozen functions listed in §2.

## 9. Optional, separate: real images on calendar tiles

**This needs a backend change.** The frontend can't get images on its own: `GET /posts`
(`posts.controller.ts:112` → `PostsService.getPostsMinified` → `PostsRepository.getPosts`) uses an explicit
Prisma `select` (`posts.repository.ts:~189`) that doesn't include `image`, and there's no query option to ask for it.

If the user approves it later, it's small:
1. Add `image: true` to that `select`. (`minifyPostItem` passes unknown keys through, so no change to
   `posts.list.minify.ts` is required; adding `image: 'im'` to `POST_ITEM_KEYS` is optional for payload size.)
2. Frontend: `JSON.parse(post.image || '[]')[0]?.path` → show it in the tile band, fall back to the tag band.
3. Side effects to accept: the **public API** `GET /public/v1/posts` (`public.integrations.controller.ts:148`)
   uses the same `getPosts`, so its response gains an `image` field (additive). Calendar payload grows a little.
   List view uses a different query (`getPostsList`) and would need the same one-line addition.

Do not do this as part of the UI work; it's a separate, user-approved change.
