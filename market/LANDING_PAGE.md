# Landing Page — Complete Spec & Copy

**Prepared:** July 2026
**Source of truth:** POSITIONING_STRATEGY.md (client-first wedge), ICP_ANALYSIS.md (Maya primary, Dana secondary), SALES_PLAYBOOK.md (objections = FAQ), ACQUISITION_STRATEGY.md.
**Conflict note (per your rule #3):** the brief says "agencies and SMBs." The approved ICP is **agencies + freelance SMMs**; SMBs are non-target. This page speaks to Maya first, Dana second. SMBs get a quiet routing link in the footer, not a voice on the page.
**Placeholder:** `[Product]`. Stack: Next.js App Router + Tailwind + shadcn/ui.

**Global design tokens (all sections inherit):**
- Type: Inter or Geist. H1 `text-5xl/text-6xl font-semibold tracking-tight`, body `text-lg text-muted-foreground`, max line length `max-w-[60ch]`
- Color: near-black canvas option (`zinc-950`) with light mode default; ONE accent (electric blue or emerald) used ONLY for CTAs and live-data accents — scarcity of accent = premium
- Radius `rounded-2xl` cards, `rounded-lg` buttons; borders `border-zinc-200/dark:border-zinc-800`, shadows minimal
- Spacing rhythm: sections `py-24 md:py-32`, container `max-w-6xl mx-auto px-6`
- Animation: `framer-motion` fade-up 12px / 0.4s / stagger 0.06s on scroll-into-view, ONCE per element; respect `prefers-reduced-motion`. No parallax, no floating blobs.
- All claims that appear as numbers must link to their proof (dashboard, calculator, changelog). This is a positioning rule, not a style choice.

---

## 1. Sticky Navigation

**Conversion goal:** Keep the trial CTA one glance away at every scroll depth; route researchers (Pricing, Compare) without losing them.

**Copy:**
- Links: `Product` · `Pricing` · `Compare` · `Changelog`
- Right: `Log in` (ghost) · `Start Free Trial` (solid accent)

**Why this structure converts:** Four links max — every removed link raises CTA share-of-attention. `Pricing` is present because hiding pricing reads as enterprise-gotcha to this audience (post-Later trauma); `Compare` captures the "vs Buffer" researcher mid-page instead of losing them to Google; `Changelog` is a trust signal ("alive, shipping") that costs one word. No dropdown menus — dropdowns hide decisions and add friction.

- **Desktop:** `h-16`, blurred translucent bar (`backdrop-blur border-b bg-background/80`), logo left, links center, auth right
- **Mobile:** logo + hamburger (shadcn `Sheet`); `Start Free Trial` stays visible OUTSIDE the sheet as a compact button
- **Components:** `NavigationMenu`, `Button`, `Sheet`
- **Hierarchy:** `<Header> → <Nav/> + <AuthActions/>`
- **Animation:** border+blur fade in after 24px scroll
- **Implementation:** server component; CTA fires analytics event `nav_cta_click`

---

## 2. Hero

**Conversion goal:** In 5 seconds: who it's for, the two pains it kills, one obvious action.

**Copy:**
- **Eyebrow (small, muted):** For agencies and social media managers
- **H1:** Run every client's social media from one place. Without paying for it twice.
- **Supporting headline (H2, muted):** Client workspaces. One-link approvals. Flat pricing that doesn't grow every time you win a client.
- **Description (one line, not a paragraph):** Stop chasing approvals in WhatsApp and paying per-channel fees. Built for people who run social for other people.
- **Primary CTA:** `Start Free Trial` — microcopy beneath: *No card required · Free migration included*
- **Secondary CTA:** `Book a Demo` (outline) — microcopy: *20 minutes, with a founder*

**Dashboard screenshot placement:** Full-width product shot below the CTAs, slightly cropped at bottom edge (signals "scroll for more"). The screenshot MUST show the wedge, not a generic calendar: **left = client workspace sidebar with 6+ named client brands; center = calendar; overlaid right = a phone-frame mock of the client approval link with an "Approve" button.** The phone overlay is the differentiation rendered as an image.

- **Desktop:** centered text stack (`max-w-3xl`), CTAs side by side, screenshot `max-w-6xl` with `rounded-2xl border shadow-2xl`, subtle radial gradient behind it (one, faint, from accent at 8% opacity — the only gradient on the page)
- **Mobile:** stacked; CTAs full-width, primary above secondary; screenshot swaps to the phone-approval crop (mobile visitors see the mobile-relevant proof)
- **Components:** `Button` ×2, `Badge` (eyebrow), custom `HeroShot` with `next/image` priority
- **Hierarchy:** `Eyebrow → H1 → H2 → P → CTAGroup → HeroShot`
- **Visual hierarchy:** H1 largest by 2×; primary CTA is the only saturated element above the fold
- **Animation:** single fade-up sequence on load (≤0.6s total); screenshot rises last
- **Implementation:** preload hero image; H1 is real text (SEO), never baked into the image

---

## 3. Trust / Social Proof

**Conversion goal:** Reduce perceived risk within one scroll of the promise.

**Two versions — ship v1 now, swap to v2 when earned. Never fake logos: this audience (professional marketers) smells a padded logo strip instantly, and one fake signal poisons every real one.**

**v1 copy (pre-customers) — proof of character instead of proof of crowd:**
- Strip of four live stats/badges:
  - **`99.X% publishing success — last 30 days`** → links to the public reliability dashboard
  - **`< 2h support response — answered by the founders`**
  - **`Open-source core — your data is never hostage`**
  - **`Monthly billing · Cancel anytime · Renewal = sticker price`**
- One-line caption: *We're new. So we prove it with live numbers, not logos.*

**v2 copy (≥8 customers):** logo strip ("Agencies that moved from Buffer, Later, and Hootsuite"), customer count, G2/Capterra rating badges when they exist, keep the reliability stat — it stays forever.

- **Desktop:** 4-column stat row, monochrome, `py-12` (compact — trust strips shouldn't feel like a section)
- **Mobile:** 2×2 grid
- **Components:** `Card` (borderless), inline SVG icons
- **Visual direction:** muted, small type; live numbers in tabular figures with the accent color — the only color in the strip
- **Animation:** count-up on the success-rate number only
- **Implementation:** success rate fetched at build+ISR from the real dashboard API; if the number can't be fetched, hide it — never hardcode a trust stat

---

## 4. Problem

**Conversion goal:** "They get my life" — emotional recognition that earns the solution section.

**Copy:**
- **H2:** You didn't start an agency to do this all day.
- Four pain cards, written as the ICP says them (verbatim-style, quotation-marked):
  1. **The approval chase.** "Client approvals are screenshots in WhatsApp. Someone approves the wrong version, it publishes, and it's my fault."
  2. **The growth tax.** "Every new client raises my software bill $20–40 a month — before I've earned a dollar from them."
  3. **The 3pm dread.** "Did the post go out? I check. Every time. Because once, it didn't."
  4. **Reporting week.** "Two days a month copy-pasting screenshots into slide decks. Per client."
- **Closing line (transition):** Every tool you've tried was built for a brand posting its own content — then stretched to fit you. The stretch marks are your Tuesday.

- **Desktop:** 2×2 card grid, `max-w-5xl`; each card: bold pain title + quote in `text-muted-foreground italic`
- **Mobile:** vertical stack
- **Components:** `Card` ×4
- **Visual direction:** slightly darker background band (`bg-zinc-50 dark:bg-zinc-900`) — the "problem valley" before the solution's lighter band; no icons of sad people, no illustrations — the words carry it
- **Animation:** staggered fade-up
- **Implementation:** replace quotes with real (permissioned) discovery-call verbatims as they're collected — tracked as a content TODO

---

## 5. Solution

**Conversion goal:** Map each pain to one capability — comprehension, not feature awe.

**Copy:**
- **H2:** [Product] is built around your clients. Because your business is.
- **Sub:** Not a scheduler with client features taped on. Every part of the product starts from the client relationship.
- Four pain→capability rows (mirror §4's order exactly — the reader should feel the click):
  1. **The approval chase → One-link approvals.** Send your client a link. They see their posts — only theirs — approve or comment, on their phone. Nothing publishes without sign-off. *Why it matters: the wrong-version disaster becomes structurally impossible.*
  2. **The growth tax → Flat pricing.** One price. Generous channel limits. Client #11 costs you $0 more. *Why it matters: your next client is margin, not overhead.*
  3. **The 3pm dread → Reliability you can watch.** A public success-rate dashboard, and an alert within 60 seconds if anything fails — so you know before your client does. *Why it matters: you stop checking. That's the product.*
  4. **Reporting week → Reports that build themselves.** Per-client, your logo, generated from live data. *Why it matters: reporting day becomes reporting minute.*

- **Desktop:** alternating two-column rows (text left/screenshot right, then flipped); each row's screenshot shows THAT capability (approval link on phone, pricing math, alert toast, report PDF)
- **Mobile:** text above screenshot, stacked
- **Components:** custom `FeatureRow` (image + copy), `Badge` for the pain label
- **Hierarchy:** `H2 → Sub → FeatureRow ×4`
- **Visual direction:** real UI screenshots in browser/phone chrome frames; captions under each screenshot in `text-sm text-muted-foreground`
- **Animation:** screenshot slides 16px toward text on scroll-in
- **Implementation:** screenshots from a seeded demo workspace with realistic client names ("Harbor Dental", "Fig & Vine Restaurant Group") — never lorem ipsum content in shots

---

## 6. Benefits

**Conversion goal:** Let the visitor pre-live the outcome — numbers they can retell their co-founder.

**Copy:**
- **H2:** What changes in your first month
- Outcome grid (each = stat + one sentence, scenario-framed so no claim is fabricated):
  - **$240 → $99/mo.** What a 10-client, 40-channel agency pays on Buffer vs. here. *[link: see the math →]*
  - **Approval turnaround in hours, not days.** A link your client can tap beats a screenshot they scroll past.
  - **Two days of reporting → about 20 minutes.** Generated, branded, sent.
  - **Zero midnight checks.** Alerts find you; you don't go looking.
  - **Unlimited team seats.** Your VA, your designer, your new hire — no per-seat math, ever.
  - **Migration in an afternoon.** We move your channels and queue with you, free, on a call.

- **Desktop:** 3×2 grid of stat cards, big numerals (`text-4xl font-semibold`), sentence beneath
- **Mobile:** 2-column, then 1 at `sm`
- **Components:** `Card` ×6
- **Visual direction:** numerals in foreground color, NOT accent (accent stays reserved for CTAs); the Buffer-math card links to the interactive calculator
- **Animation:** none beyond section fade — numbers should feel like facts, not fireworks
- **CTA (section-end, quiet):** text link — *Calculate your stack's real cost →*

---

## 7. Core Features

**Conversion goal:** Completeness reassurance for the evaluator ("does it have everything I'd give up?") — after the wedge has already done the selling.

**Copy — H2:** Everything the day job needs. Nothing you'll have to explain to your client.

Eight cards (outcome title → what it does → business impact). Order = wedge first, table-stakes last:
1. **Nothing publishes without sign-off.** Client approval links with comments and an audit trail. *Impact: your CYA record when "who approved this?" happens.*
2. **Eleven clients. Eleven clean rooms.** Workspaces scope channels, calendars, media, and team access per client. *Impact: no crossover, no "why can I see another brand?"*
3. **Plan a month in one afternoon.** Calendar + queues + best-slot suggestions per client. *Impact: batching becomes your default speed.*
4. **Reports with your logo, not ours.** Per-client analytics composed into a branded, shareable artifact. *Impact: the deliverable your retainer is judged on, automated.*
5. **Publish everywhere your clients are.** Instagram, Facebook, LinkedIn, TikTok, YouTube, Google Business Profile, Pinterest, and more. *Impact: one composer, per-platform formatting handled.*
6. **First drafts in the client's voice.** AI drafting and long-post splitting inside the workflow — not a gimmick beside it. *Impact: editing beats blank pages; the approval step keeps humans in charge.*
7. **A media library per client.** Assets, brand files, and generated images scoped to each workspace. *Impact: no more Drive-folder archaeology.*
8. **Plugs into your ops.** API, webhooks, Zapier/n8n — schedule from wherever work actually starts. *Impact: your workflow, not ours.*

- **Desktop:** 4×2 card grid, icon + title + 2 lines; hover raises border to accent at 40%
- **Mobile:** 1-column stack, collapsed to title + first line with expand
- **Components:** `Card` ×8, lucide icons (consistent 1.5px stroke)
- **Visual direction:** monochrome icons; NO screenshots here (screenshots were §5's job — repeating them bloats the page)
- **Implementation note:** AI card is #6 of 8 by design — positioning rule "AI never leads." White-label appears in Pricing (Business tier), not here, until it ships (roadmap S2) — we don't card features that don't exist.

---

## 8. Product Workflow

**Conversion goal:** Make the product feel light — collapse "another tool to learn" anxiety.

**Copy:**
- **H2:** Five steps. One place. Every client.
- Steps (horizontal): **Plan** (calendar per client) → **Create** (drafts, AI assist, media) → **Approve** (client taps a link) → **Publish** (every channel, on schedule, watched) → **Report** (branded, automatic)
- Caption under **Approve**, accent-colored: *the step every other tool forgot*

- **Desktop:** horizontal 5-node stepper with connecting line; each node = icon + word + 4-word caption; a thin progress line draws in on scroll
- **Mobile:** vertical timeline, same nodes
- **Components:** custom `WorkflowStepper` (ol/li semantics for a11y)
- **Visual direction:** the Approve node is visually distinct (filled vs. outlined) — the diagram itself restates the differentiation
- **Animation:** line draws left→right once (0.8s); reduced-motion gets the static line
- **Implementation:** pure SVG/CSS — no lottie/video weight for a five-word diagram

---

## 9. Comparison with Alternatives

**Conversion goal:** Win the evaluation the visitor is already privately running.

**Copy:**
- **H2:** The honest comparison
- **Sub:** No tool bashing. Just what a 10-client agency's week looks like on each setup.

| | Manual posting | Spreadsheets + 4 tools | Per-channel schedulers | **[Product]** |
|---|---|---|---|---|
| Client workspaces | — | Folders, if disciplined | Bolted on, extra cost | **Built in** |
| Client approvals | Screenshots in chat | Sheet comments, lost | Rare, or $33/client extra | **One link, audit trail** |
| Cost at 10 clients / 40 channels | Your evenings | $150+ across tools | **~$200–380/mo** | **Flat $[X]/mo** |
| Failure alerts | You find out from the client | You find out from the client | Buried in a dashboard | **Under 60 seconds** |
| Monthly reports | 2 days of copy-paste | 2 days of copy-paste | Extra tier, extra cost | **Generated, branded** |
| Team seats | — | Free but chaotic | Per-seat fees | **Unlimited** |
| Billing | — | Death by subscriptions | Renewal surprises | **Monthly, cancel anytime, sticker price** |

- **Footer line under table:** Prices are what we verified in July 2026 — sources on our [Compare] pages. If a competitor fits you better, our comparison pages say so.
- **CTA below table:** `Start Free Trial` + text link *See detailed comparisons →*

- **Desktop:** shadcn `Table` in a `Card`, [Product] column highlighted (`bg-accent/5`, accent top border)
- **Mobile:** the table scrolls horizontally inside `overflow-x-auto` with the [Product] column pinned right; OR collapses to per-row "them vs us" cards at `sm` — build the cards version, it converts better on phones
- **Components:** `Table`, `Card`, `Button`
- **Visual direction:** generic-category columns (not brand names) in the table itself — brand-specific pages live under /compare where they earn SEO; checkmarks minimal, words over icons
- **Implementation:** table content from a constants file shared with the /compare pages — one source of truth when competitor prices change

---

## 10. Testimonials (placeholders)

**Conversion goal:** Voice-of-customer proof, one per value pillar.

**Structure — three cards, each tagged to a pillar (replace with permissioned verbatims from design partners; keep the pillar mapping):**
1. **Agency Owner — pillar: margin.** Placeholder: "We moved 9 clients over in one afternoon — the founders did it with us. Our software bill dropped by more than half, and it stops growing when we sign someone new." — *Name, Agency, 9 clients*
2. **Marketing Manager — pillar: approvals.** Placeholder: "Our client approves posts from her phone in the school pickup line. The screenshot era is genuinely over." — *Name, Role, Agency*
3. **Social Media Manager — pillar: reliability/dignity.** Placeholder: "I used to check every scheduled post at 3pm. Now an alert would find me first — so I just… don't." — *Name, freelance SMM, 5 clients*

- **Desktop:** 3-column cards: quote large (`text-xl`), avatar + name + context row beneath; client-count in the attribution line (specificity = credibility)
- **Mobile:** single column stack (no carousel — carousels hide 2/3 of your proof)
- **Components:** `Card`, `Avatar`
- **Visual direction:** real faces when permissioned; until then, initials avatars — never stock photos
- **Implementation:** render section ONLY when `testimonials.length ≥ 2` and real — a placeholder-looking testimonial section is worse than none. Until then the page ships without §10 and the trust strip (§3) carries proof.

---

## 11. Pricing (placeholders)

**Conversion goal:** Frame value before revealing numbers; make the middle choice obvious.

**Copy:**
- **H2:** One flat price. It stays flat when you grow.
- **Sub:** No per-channel fees. No per-seat fees. No renewal surprises. *(the three "no"s are the positioning)*
- Three cards:
  - **Starter** — *For freelancers.* $[X]/mo · framed beneath price: *about $[X÷clients]/client/month* · [N] channels, [N] client workspaces, approval links, unlimited posts
  - **Pro — Recommended** — *For agencies.* $[X]/mo · framed: *your next client costs $0 more* · [N] channels, unlimited workspaces, unlimited team, branded reports, priority support
  - **Business** — *For agencies whose clients see everything.* $[X]/mo · white-label portal & reports, custom domain, migration done-for-you, direct founder line
- **Under all cards (the billing-kindness strip, always visible):** Monthly billing · Cancel anytime, self-serve · Renewal price = the price on this page · Free trial, no card
- **CTA per card:** `Start Free Trial` (Pro's is solid accent; others outline). Business adds text link *Book a Demo →*

- **Desktop:** 3 cards, Pro elevated (`scale-[1.03]`, accent border, "Recommended" `Badge`); annual/monthly `Tabs` toggle (annual shows "2 months free")
- **Mobile:** Pro FIRST in the stack, then Starter, Business
- **Components:** `Card` ×3, `Badge`, `Tabs`, `Button`
- **Visual direction:** feature lists ≤6 rows — pricing cards are for deciding, not documenting; link *Compare all features →* beneath
- **Implementation:** numbers from a pricing constants file (single source with the app's billing config — the page must never disagree with checkout); per-client math computed, not hardcoded

---

## 12. FAQ

**Conversion goal:** Retire the objections the Sales Playbook says kill deals — in writing, before the trial.

**Copy (shadcn `Accordion`, answers ≤4 sentences, voice: calm, concrete, zero hedging):**

1. **Which social platforms are supported?** Instagram, Facebook, LinkedIn (profiles and pages), TikTok, YouTube, Pinterest, Google Business Profile, Threads, and more — plus community channels like Discord, Telegram, and Bluesky. We publish an honest per-platform capability matrix rather than a long logo list. X (Twitter) support is on the roadmap — X charges tools $200+/month for API access, and we'd rather add it sustainably than bill you a surprise add-on for it.
2. **Can I manage multiple clients?** It's the whole point. Every client gets a workspace — their channels, calendar, media, and approvals, fully separated. Your client never sees another client's content. Neither does the freelancer you offboarded last month.
3. **Is there an approval workflow?** Yes — the real one. You send your client a link; they approve or comment from any device; nothing publishes without sign-off (per client, your choice). Every approval is logged, so "who approved this?" always has an answer.
4. **Can my team collaborate?** Unlimited team members on every agency plan — no per-seat fees. Assign people to specific clients, so your VA sees exactly what they should and nothing else.
5. **Is there a free trial?** Yes — full product, no card required. We also migrate your channels and queue with you on a call, free, during the trial. Run us alongside your current tool and judge the difference.
6. **Can I cancel anytime?** Yes, self-serve, in two clicks, no email to support required. Monthly billing is the default, and your renewal price is the price on this page. We know why you're asking — we read the same Trustpilot pages you do.
7. **Is white-label supported?** Branded (your logo) client reports are on Pro. The fully white-labeled client portal with your domain is rolling out on Business — book a demo and we'll show you where it stands honestly.
8. **How secure is my data?** Tokens encrypted at rest, workspaces isolated per organization, and we'll sign a DPA. The core of our platform is open source — you can audit what runs, and your data is exportable. Lock-in isn't part of the business model.
9. **Can I migrate from another platform?** Yes — and you don't do it alone. Send us your client list and 30 minutes for the connection screens; we move your channels and scheduled queue with you, usually the same day. Keep your old tool running in parallel until you're sure.

- **Desktop:** single-column accordion, `max-w-3xl` centered; first item open by default
- **Mobile:** identical
- **Components:** `Accordion` (type="multiple")
- **Implementation:** render FAQPage JSON-LD schema (SEO rich results); every answer's claims must match the product on the day it ships — FAQ honesty is audited in the weekly review

---

## 13. Final CTA

**Conversion goal:** Convert the scroller who is now convinced but tired; one decision, restated risk-free.

**Copy:**
- **H2:** The screenshot era is over.
- **Supporting:** Set up your first client tonight — or let us migrate everything with you tomorrow. Either way, your next client won't raise your software bill.
- **Primary CTA:** `Start Free Trial` — microcopy: *No card · Full product · Free migration*
- **Secondary CTA:** `Book a Demo` — microcopy: *20 minutes with a founder, not an SDR*
- **Last line (small, muted — the character close):** Built by two founders who answer their own support. [Changelog →]

- **Desktop:** full-width band, `py-24`, near-black background in light mode (inverted contrast block — the visual "end"), centered stack
- **Mobile:** stacked, full-width buttons
- **Components:** `Button` ×2
- **Visual direction:** the ONE place the accent may be used generously (subtle accent glow behind the CTA); no screenshot — decision, not information
- **Animation:** none; stillness reads as confidence

**Footer (after final CTA):** columns — Product / Compare (per-competitor links) / Resources (Cost Report, Calculator, Changelog, API docs) / Company (Support SLA, Security, the open-source acknowledgment page — the calm §9-positioning paragraph lives at a URL we control). Small line for non-ICP inbound: *Not an agency? [Product] for your own brand →* (routes SMBs without giving them the homepage).

---

# CRO Review

## Section-by-section

| # | Section | Why it converts | Psychological principle | Weakness | Improvement |
|---|---|---|---|---|---|
| 1 | Nav | CTA omnipresent; researcher paths kept on-site | Mere-exposure; choice architecture | `Changelog` may leak clicks pre-conversion | Move Changelog to footer if nav CTR analytics show leakage |
| 2 | Hero | Names the buyer + both pains + risk-free action in one view | Relevance heuristic; specificity = credibility | Two-part H1 is long for 5-sec scan | A/B the shorter alt headline #1 below |
| 3 | Trust | Live numbers where fake logos would backfire; honesty as differentiator | Costly signaling ("we show what others hide") | Weak vs. crowd-proof until v2 | Add founder faces + names to v1 — humans beat abstractions for two-person credibility |
| 4 | Problem | Verbatim pain in first person triggers "that's me" | Pain agitation; identity resonance | Four cards may over-dwell for hot traffic | Anchor-link "Skip to how it works" for referral/demo-intent visitors |
| 5 | Solution | 1:1 pain→fix mapping in the same order = felt "click" | Cognitive fluency; problem-solution congruence | Alternating rows get long on mobile | Mobile: collapse to tabbed switcher (pain tabs → capability panel) |
| 6 | Benefits | Numbers the visitor can retell internally ("$240→$99") | Concrete > abstract (vividness effect); loss aversion on the math | Some numbers are scenario-framed, not customer-proven yet | Wire each stat to calculator/dashboard; replace with cohort data at ~40 customers |
| 7 | Features | Answers "what do I give up?" after desire exists | Completeness reassurance; reduces switching-cost fear | 8 cards risk skim-blindness | Bold the first three words of each card body — skimmers get the outcome anyway |
| 8 | Workflow | Five words make the product feel learnable in a day | Processing fluency; goal-gradient (5 short steps) | Could read as generic scheduler flow | The filled "Approve" node + caption carries the differentiation — keep it loud |
| 9 | Comparison | Meets the private evaluation head-on, honestly | Anchoring (their $380 vs our flat); trust via two-sided argument | Category columns are softer than brand names | Correct trade-off: brands live on /compare pages; add "see brand-by-brand" link prominently |
| 10 | Testimonials | Persona-matched proof per pillar | Social proof (similarity-based) | Placeholders are a liability if they look fake | Ship page WITHOUT this section until 2+ real quotes exist (rule already in spec) |
| 11 | Pricing | Three "no"s reframe price as fairness; decoy structure centers Pro | Decoy/center-stage effect; certainty effect (billing promises) | Placeholder numbers block real evaluation | Publish real numbers ASAP — hidden pricing contradicts the fairness pillar (highest-priority TODO on this page) |
| 12 | FAQ | Retires the Playbook's actual deal-killers in writing | Objection inoculation; fluency of recall for the X/white-label honesty | Long answers tempt skimming | Keep ≤4 sentences hard limit; bold the direct answer's first word ("Yes —") |
| 13 | Final CTA | One decision, restated risk reversal, human close | Peak-end rule; risk reversal | "Screenshot era" lands only if §4 was read | Fallback for skimmers: microcopy under CTA restates "no card · free migration" |

## Alternatives & Tests

**Three alternative hero headlines:**
1. **Your next client shouldn't raise your software bill.** *(loss-aversion, shortest, agency-only)*
2. **The social media platform for people who run social media for other people.** *(pure ICP mirror — polarizing on purpose)*
3. **Client approvals in one link. Client channels at one flat price.** *(double wedge, most literal)*

**Three alternative subheadlines:**
1. Workspaces, approvals, and reports for every client — at a price that ignores how many channels you add.
2. Built for agencies and freelance SMMs. Priced like it's on your side.
3. Everything between "client signs" and "post publishes" — including the sign-off your current tool forgot.

**Three alternative primary CTAs:**
1. `Start Free — No Card` *(risk reversal inside the button)*
2. `Try It With One Client` *(matches the parallel-run close from the Sales Playbook — lowers commitment threshold)*
3. `See Your Price in 30 Seconds` *(routes through the calculator — for the pricing-anchored visitor)*

**Three A/B testing ideas with hypotheses:**
1. **Hero: current H1 vs. alt #1 ("next client…bill").** *Hypothesis:* the single-pain loss frame lifts trial starts ≥15% for cold community/Reddit traffic because it's parseable in one fixation; current two-part H1 wins for warm demo-intent traffic. Segment by UTM.
2. **Primary CTA: `Start Free Trial` vs. `Try It With One Client`.** *Hypothesis:* the one-client frame lifts trial→activation (not just clicks) ≥20% because it imports the parallel-run mental model — measure activation (3+ channels in 48h), not click-through, or the test lies.
3. **§6 Benefits: static stat cards vs. interactive cost calculator embedded inline.** *Hypothesis:* visitors who touch the calculator convert to trial at 2×+ the rate of readers (self-generated anchoring beats stated anchoring); if true, promote calculator to the hero's secondary slot for cold traffic.

**Weakest section and the fix:**
**§3 Trust — by necessity, not design.** Pre-customers, we have no logos, counts, or ratings, and every substitute (live stats, open-source, founder SLA) is character evidence, not crowd evidence — the thing risk-averse Maya wants most. Mitigations, in order: (1) put the two founders' real names and faces in v1 with the support promise — for a two-person company, named humans are the strongest available trust asset; (2) get the reliability dashboard genuinely public and linked before launch so at least one claim is independently checkable; (3) treat the first two permissioned testimonials as a launch-blocking growth task (design-partner deal includes them), because v1→v2 of this section is the single highest-leverage conversion upgrade available in the first 60 days; (4) borrow authority precisely: "built on the open-source core with 32k+ GitHub stars" is legitimate, verifiable crowd-proof we already own — use it once, in this section, with the star count live-fetched.
