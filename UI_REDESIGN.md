# UI Redesign — review guide

Branch: `feat/ui-redesign-postaryx` (from `main`)
Source of truth: the 9 artboards in `postaryx-redesign/` (`canvas.json` maps them)

**Presentation only.** No dependencies added, no API calls, props, routes, state, or
handlers changed. Every route that existed on `main` still exists and still does the
same thing.

---

## How to look at it

```bash
pnpm dev:frontend          # or: pnpm dev-backend for backend + frontend
```

Sign in, then walk these URLs. Column three is what actually changed on that screen.

| # | URL | What to look at |
|---|-----|-----------------|
| 1 | `/launches` | Dark rail, PX mark, WORK/GROW/ACCOUNT groups. Paper body, two white cards. Serif month title, hairline arrows, one Day/Week/Month/List segmented control. Bordered post chips with mono times. |
| 2 | `/analytics` | Stat cards with mono eyebrow labels and serif numerals. Charts now ember/forest/teal instead of purple/green/blue. |
| 3 | `/media` | Card panel, serif heading. |
| 4 | `/plugs` | *(rail label: **Automate**)* Card panels, serif heading, bordered tiles. |
| 5 | `/third-party` | *(rail label: **Channels**)* Card panels, serif heading, bordered tiles. |
| 6 | `/settings` | Sidebar + content as two cards, serif section headings. |
| 7 | `/billing` | Card panel. |
| 8 | `/agents` | Normalised collapse chevron. |
| 9 | `/auth/login`, `/auth` | Ink shell (was neutral black), serif headline, ember highlight. |
| 10 | `/oauth/authorize` | Ink surfaces, ember accents. |
| 11 | **Composer** — click any empty calendar slot, or *Create Post* | 20px bordered modal, serif column headers, 10px action buttons. |
| 12 | Any page, **theme toggle** in the header | Dark mode: hairlines are warm grey now, not purple. |

Rail labels were renamed to match the design — **Media → Library**, **Plugs →
Automate**, **Integrations → Channels**. Routes are unchanged (`/media`, `/plugs`,
`/third-party`); only the visible words moved. The page title in the header reads
from the same list, so it follows.

---

## Light vs dark

The artboards are light-mode only, but this is implemented theme-aware: every new
token is declared in **both** the `.light` and `.dark` blocks of `colors.scss`, and
every new class reads a CSS variable rather than a literal. Two deliberate
exceptions, both matching the design:

- **The nav rail is dark in both themes** — the artboards show a dark rail against a
  light body, so its tokens don't flip.
- **Auth / OAuth / provider shells are always dark**, hence the separate `ink*` tokens.

Light mode is what I checked against the artboards. Dark mode is structurally
correct — all tokens flip — but has had less visual review.

---

## Design system

`apps/frontend/src/app/global.scss` — reusable classes, all styling shorthands with
no behavioural surface. Prefixed `ds-` (not `px-`, which would collide with
Tailwind's padding-x utility):

| Class | Use |
|---|---|
| `ds-h1`, `ds-h2` | Fraunces display headings |
| `ds-eyebrow` | mono uppercase label above a section |
| `ds-th` | mono table header |
| `ds-mono` | mono metadata (times, counts, page numbers) |
| `ds-badge` | small mono status pill |
| `ds-card` | white panel, hairline border, 16px radius |
| `ds-sub` | secondary caption |
| `ds-seg` | segmented control (`data-on={bool}` on children) |
| `ds-btn`, `ds-btn2` | 13px inline buttons — distinct from the 44px form `Button` |
| `ds-dot` | 7px status dot |

`apps/frontend/src/app/colors.scss` — new tokens, also exposed as Tailwind colours
in `tailwind.config.cjs`:

- rail: `railBg` `railLabel` `railItem` `railItemActiveBg` `railItemActive`
- text: `pxMuted` `pxFaint`
- surfaces: `segTrack` `segThumb` `hairline`
- states: `dangerBg` `dangerBorder` `pxDanger` `pxSuccess` `pxWarning`
- data-viz: `chart1` (ember) `chart2` (forest) `chart3` (teal)
- always-dark: `ink` `inkRaised` `inkHover` `inkHairline`

The palette, type ramp and radii already existed on `main` from the rebrand commit
(`b4720da9`); this branch adds what the artboards use beyond it.

---

## Commits

| Commit | Scope |
|---|---|
| `999cab72` | tokens + `ds-` primitive classes |
| `b4fb8d59` | dark rail, PX mark, grouped menu |
| `7f1d00cc` | header controls → org chip, ember accents |
| `8c00677e` | paper body + card panels on calendar |
| `a80f39c7` | calendar toolbar, serif date, segmented views |
| `4468fbca` | bordered post chips, mono calendar headers |
| `b146a55b` | analytics cards, chart tokens |
| `f6db5523` | remove leftover Postiz purple (58 refs, 18 files) |
| `76296170` | card panels on media/automate/channels/settings/billing |
| `25a977e9` | serif page headings, bordered tile cards |
| `171aca02` | tokenize status colours + ink surfaces |
| `f0c1174e` | rename `px-` classes → `ds-` |
| `815d4558` | dark mode: purple hairlines → warm grey |
| `65e3d3e7` | ink auth shell, serif headings |

---

## Files changed (67)

### Foundation
- `apps/frontend/tailwind.config.cjs`
- `apps/frontend/src/app/colors.scss`
- `apps/frontend/src/app/global.scss`

### Shell — rail, header, modals
- `src/components/new-layout/layout.component.tsx`
- `src/components/new-layout/logo.tsx`
- `src/components/new-layout/menu-item.tsx`
- `src/components/new-layout/layout.media.component.tsx`
- `src/components/layout/top.menu.tsx`
- `src/components/layout/organization.selector.tsx`
- `src/components/layout/streak.component.tsx`
- `src/components/layout/mode.component.tsx`
- `src/components/layout/language.component.tsx`
- `src/components/layout/new-modal.tsx`
- `src/components/layout/loading.tsx`
- `src/components/ui/logo-text.component.tsx`
- `src/components/ui/icons/index.tsx`

### Calendar / launches
- `src/components/launches/launches.component.tsx`
- `src/components/launches/filters.tsx`
- `src/components/launches/calendar.tsx`
- `src/components/launches/statistics.tsx`
- `src/components/launches/time.table.tsx`
- `src/components/launches/tags.component.tsx`
- `src/components/launches/select.customer.tsx`
- `src/components/launches/repeat.component.tsx`
- `src/components/launches/ai.image.tsx`
- `src/components/launches/missing-release.modal.tsx`
- `src/components/launches/continue.integration.tsx`
- `src/components/launches/creation.method.badge.tsx`
- `src/components/launches/information.component.tsx`

### Composer
- `src/components/new-launch/manage.modal.tsx`
- `src/components/new-launch/modal.wrapper.component.tsx`
- `src/components/new-launch/editor.tsx`
- `src/components/new-launch/select.current.tsx`
- `src/components/new-launch/delay.component.tsx`
- `src/components/new-launch/add.post.button.tsx`
- `src/components/new-launch/picks.socials.component.tsx`
- `src/components/new-launch/providers/pinterest/pinterest.preview.tsx`
- `src/components/new-launch/providers/tiktok/tiktok.provider.tsx`

### Analytics
- `src/components/platform-analytics/platform.analytics.tsx`
- `src/components/platform-analytics/render.analytics.tsx`
- `src/components/analytics/chart-social.tsx`

### Pages — media, automate, channels, settings, billing, agents, admin
- `src/app/(app)/(site)/billing/page.tsx`
- `src/app/(app)/(site)/admin/stats/page.tsx`
- `src/app/(app)/(site)/admin/errors/page.tsx`
- `src/components/layout/settings.component.tsx`
- `src/components/settings/global.settings.tsx`
- `src/components/settings/signatures.component.tsx`
- `src/components/settings/teams.component.tsx`
- `src/components/plugs/plugs.tsx`
- `src/components/plugs/plug.tsx`
- `src/components/third-parties/third-party.component.tsx`
- `src/components/third-parties/third-party.list.component.tsx`
- `src/components/third-parties/third-party.media.tsx`
- `src/components/third-parties/third-party.media-library.tsx`
- `src/components/media/media.component.tsx`
- `src/components/agents/agent.tsx`
- `src/components/billing/embedded.billing.tsx`
- `src/components/billing/first.billing.component.tsx`
- `src/components/developer/developer.component.tsx`
- `src/components/public-api/public.component.tsx`

### Auth / OAuth
- `src/app/(app)/auth/layout.tsx`
- `src/app/(app)/oauth/authorize/layout.tsx`
- `src/app/(app)/oauth/authorize/page.tsx`
- `src/app/(app)/integrations/social/layout.tsx`
- `src/components/auth/login.tsx`
- `src/components/auth/register.tsx`
- `src/components/auth/testimonial.tsx`

---

## Notes worth a second opinion

1. **Day/Week/Month and the calendar/list toggle merged into one 4-way segmented
   control**, per the artboard. Every entry calls the handler it already had, and
   `setCalendarView` became unreachable (Week covers it) so it was removed.

2. **`OrganizationSelector` now shows the org name** in a chip instead of a bare
   globe icon. It still returns `null` when there's only one org, as before.

3. **Platform preview mocks keep their own greys** (`#A3A3A3` in the LinkedIn /
   Facebook / YouTube previews) — those imitate the real platforms, so tokenizing
   them would make the previews less accurate. Left alone on purpose.

4. **`--color-custom*` values were not otherwise touched.** They're deprecated per
   `CLAUDE.md`; three dark-mode ones held the purple border and were updated with the
   rest, nothing more.

## Not done

- The **"Needs you"** artboard is a new page, not a restyle — it needs backend work,
  so it's out of scope here.
- The **command / AI search bar** in the artboard header is new functionality; the
  header keeps the existing page title instead.
- The artboards' **campaign lanes** on the calendar are a new grouping feature, not a
  restyle.
- **Dark mode has had less visual review** than light — see *Light vs dark* above.
