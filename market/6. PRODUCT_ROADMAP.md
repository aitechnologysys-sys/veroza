# Product Roadmap — Optimized for Product-Market Fit

**Prepared:** July 2026
**Basis:** Feature Inventory (what the fork already has), ICP Analysis (Maya/Dana), Positioning Strategy (client-first wedge), Business Understanding Report (sprawl + AGPL constraints).

---

## 0. Roadmap Philosophy (read first — it explains every scoring decision)

1. **We inherited a feature-rich product. The roadmap's first job is subtraction, not addition.** The fork already has 30+ integrations, AI generation, a public API, billing, webhooks, and half-built marketplace/OAuth-platform concepts. PMF risk is not "missing features" — it's sprawl obscuring the wedge. Several "features" below are removals or hardening. That is deliberate.
2. **Every feature must serve the positioning sentence:** *the client is the atomic unit.* If a feature doesn't make client work better (workspaces, approvals, reports, reliability, margin), it doesn't get built before PMF.
3. **Validation gates, not dates, promote features.** Anything beyond the 3-month horizon is a hypothesis. The stated gate (e.g., "≥5 customers asked unprompted") must trip before engineering starts. The objection log from the Sales Playbook is the roadmap's input queue.
4. **The AGPL rule:** features built inside the fork must be source-shared with users on request. Strategy: **speed first, moat second** — wedge features may ship inside the fork as v1 (validation beats purity), then get rebuilt as separate proprietary services once proven (the 6-month horizon does exactly this).
5. **Priority score** (0–10): `Pain severity for ICP (0–3) + Wedge alignment (0–3) + Revenue/retention impact (0–2) + Evidence it's wanted (0–2)`, sanity-checked against complexity. Complexity: **S** (<1 wk), **M** (1–3 wk), **L** (1–2 mo), **XL** (2+ mo) — one-founder weeks, since only ~1 founder is on product.

**PMF definition we're building toward:** ≥40 paying agency customers, ≥85% logo retention at month 3, ≥30% of new customers from referral/word-of-mouth, and trial→paid ≥20% self-serve. The roadmap ends its job there; scale features come after.

---

## 1. MVP — Must Have (Days 0–45, before/alongside first 10 customers)

The MVP question is not "what to build" — it's "what must be true before we take an agency's money."

### M1. Publishing reliability instrumentation + public dashboard — **Priority 10/10 · Complexity M**
- **Problem:** "Will Instagram actually publish? I've been burned." — the existential objection. Upstream's worst reviews are IG failures; we inherit that suspicion by default.
- **Business impact:** Gates every sale. The public success-rate dashboard is also a positioning asset no competitor shows (Trust block, homepage §5).
- **Why now:** Nothing else matters if posts don't go out. The Errors table and Sentry hooks already exist — this is instrumentation + a public page, not new architecture. Two weeks of continuous synthetic publishing to test accounts before the first real customer.

### M2. Failure alerting (≤60s email/in-app on any failed publish) — **Priority 9/10 · Complexity S**
- **Problem:** "You'll know before the client knows" is a core promise; today errors sit in an admin page.
- **Business impact:** Converts our scariest weakness (things fail sometimes) into a differentiator (you find out instantly, a human responds).
- **Why now:** Cheap (notification infra + Errors table exist), and it's load-bearing for the trust pitch in every demo.

### M3. Client approval workflow v1 (the wedge) — **Priority 10/10 · Complexity M–L**
- **Problem:** Approvals are WhatsApp screenshots; wrong versions go out; it's the agency's fault. The single most repeated pain in the research, and Planable's whole business proves people pay for exactly this.
- **What v1 is:** per-client shareable link → client sees only their pending posts → approve / comment → nothing publishes without sign-off (per-client toggle). Works beautifully on a phone. **Not in v1:** multi-step chains, reminders, revision threading.
- **Business impact:** This is the differentiation. Without it, we're a cheaper Buffer — a losing position per the ICP analysis.
- **Why now, and why inside the fork:** the public-post-preview + comments plumbing already exists to build on. Ship it in the fork (AGPL-shared, accepted), validate the wedge with 10 design partners, rebuild proprietary later (see N6/S1).

### M4. Client workspace hardening — **Priority 9/10 · Complexity M**
- **Problem:** "My client must never see another client's content." The Customer entity and grouping exist, but agency-grade isolation (workspace-scoped views, clean switching, per-client media) needs polish from "grouping feature" to "product spine."
- **Business impact:** It's the atomic unit of the positioning. Demos live or die on §8's "eleven clients, eleven workspaces" moment.
- **Why now:** Mostly UI/UX over existing schema — high leverage, low risk.

### M5. Feature de-sprawl (hide: marketplace, OAuth apps, video gen, agent chat, enterprise UI) — **Priority 8/10 · Complexity S**
- **Problem:** A confused trial is a dead trial. Maya opens the app and sees marketplace orders and OAuth app registration — none of it for her, all of it eroding the "built for agencies" claim.
- **Business impact:** Trial activation rate (the 48h→3-channels gate). Also cuts the support surface two founders must answer for.
- **Why now:** Feature flags, days of work. The cheapest activation win available. Nothing is deleted — just hidden until a segment earns it back.

### M6. Billing kindness pack (no-card trial, monthly default, self-serve cancel, sticker-price renewal promise) — **Priority 8/10 · Complexity S**
- **Problem:** Post-Later trauma (1.3/5 Trustpilot); Dana won't enter a card, Maya reads cancellation policies first.
- **Business impact:** Stated differentiator in the Positioning doc (§8) — must be literally true in the product before the copy ships.
- **Why now:** Stripe/Polar infra exists; this is configuration + a settings page + a promise kept.

### M7. Concierge migration kit (internal tooling) — **Priority 7/10 · Complexity S–M**
- **Problem:** "Migrating 40 channels is a week of pain" — the #1 closing objection. The founder does the migration, but needs: bulk channel-connect checklist, queued-post import (CSV/Buffer export), per-client setup templates.
- **Business impact:** Turns the parallel-run close (Playbook §10) from a promise into an afternoon. Internal-quality tooling is fine; it just has to make migrations take <3 hours.
- **Why now:** Every early sale passes through it. Scriptable with the existing public API — the rare place our API surface pays off immediately.

### Explicitly NOT in MVP (and why)
- **X/Twitter integration** — $200+/mo API cost before customer one; deferred until ~$5K MRR, then included in tiers (we publicly reject the Vista Social paid-add-on pattern). Honest "coming, here's why" note on the site.
- **Mobile app** — PWA/mobile-web polish for the approval link only. A native app is months of work answering an objection that "approvals work great on the phone" mostly dissolves.
- **Any new social integration, AI feature, or analytics work** — the inherited set exceeds MVP needs; hardening beats adding.

---

## 2. Next 3 Months (customers ~10–40) — earn the second sale

### N1. Approval workflow v2 (reminders, revision flow, approval history) — **Priority 9/10 · Complexity M**
- **Problem:** v1 creates a new pain: "my client doesn't open the link." Auto-reminders, comment→revise→re-approve loop, audit trail ("who approved what, when" — the agency's CYA record).
- **Impact:** Deepens the moat feature; the audit trail is a retention hook (leaving = losing the approval history).
- **Gate:** v1 used by ≥6 of first 10 customers (if not, the wedge thesis itself needs re-examination — stop and interview).

### N2. Per-client reports v1 (branded, shareable link/PDF) — **Priority 9/10 · Complexity L**
- **Problem:** "Reporting day is two days of copy-paste" — pain #2 in every interview. Analytics endpoints exist per-integration; nobody has composed them into a client-facing artifact.
- **Impact:** Completes the client-lifecycle story (plan → approve → publish → report) and justifies the agency tier price. Reports carry the agency's logo — our name spreads to *their* clients.
- **Why now (not MVP):** big surface (analytics coverage varies by provider — scope v1 to the 5–6 strongest channels, publish an honest coverage matrix). Needs real customer data shapes to design well.

### N3. Per-client team permissions (SMM sees only assigned clients) — **Priority 8/10 · Complexity L**
- **Problem:** Current roles are org-level; a 5-person agency assigns SMMs per client. Contractor access is a real fear ("my freelancer quit and could still see every client").
- **Impact:** Blocks agencies >~4 people from adopting at all; unlimited-seats pricing only matters if seats can be scoped.
- **Gate:** ≥5 requests or ≥2 lost deals citing it (expect this to trip fast).

### N4. In-product activation path (guided first-client setup replacing the concierge for Danas) — **Priority 8/10 · Complexity M**
- **Problem:** Concierge doesn't scale to $19–29 freelancers; Dana gives onboarding 20 minutes, once.
- **Impact:** Trial→paid on the self-serve tier — the funnel Phase-3 acquisition (PH launch, SEO traffic) dumps into.
- **Gate:** first meaningful self-serve trial volume (~week 8–10, post-Cost-Report/PH traffic).

### N5. PWA polish for daily engagement flows — **Priority 6/10 · Complexity M**
- **Problem:** "No mobile app?" — softened by approval-links-on-phone, but morning engagement rounds happen on phones.
- **Impact:** Removes the demo's weakest moment. A good PWA + honest answer beats a bad native app by months of saved work.

### N6. AGPL moat architecture decision (spike, not build) — **Priority 7/10 · Complexity S**
- One founder-week: design how approvals/reports/portal get extracted into a separate proprietary service (arm's-length API consumer of the fork). Decides the 6-month build. Legal hour included.

### NOT in this horizon
- **Referral software** (manual asks + credits ledger in a spreadsheet until ~40 customers — Playbook §13).
- **New channels, AI expansion, listening/inbox features** — the objection log hasn't earned them.

---

## 3. Next 6 Months (customers ~40–100) — moat and margin

### S1. Rebuild wedge features as the proprietary "Agency Layer" service — **Priority 8/10 · Complexity XL**
- **Problem (ours, not the customer's — say so honestly):** everything in the fork is source-available to any user on request, including competitors. Approvals/reports/portal are the moat; the moat shouldn't be a free download.
- **Impact:** Durable differentiation; also the codebase where enterprise-ish asks (SSO, audit) can later live without AGPL entanglement.
- **Gate:** wedge validated (approval-feature usage correlates with retention) AND ≥40 customers. Rebuilding an unvalidated wedge would be the classic engineering-founder mistake — the gate exists to stop us.

### S2. White-label client portal (agency logo/colors, custom domain) — **Priority 8/10 · Complexity L**
- **Problem:** "I want my client to see *my* brand, not my vendor's." The professional-dignity emotion (Positioning §7) taken to its conclusion.
- **Impact:** The anchor of a higher agency tier (~$129+); agencies actively shop "white label social media tool" (ICP keyword list). Strong expansion-revenue lever.
- **Gate:** ≥8 unprompted asks (white-label requests historically trip fast in this market — Metricool gates it to Custom tier for a reason).

### S3. X/Twitter integration turns on — **Priority 7/10 · Complexity M (money, mostly)**
- **Gate:** ~$5K MRR (API cost <5% of revenue). Included in tiers, loudly not an add-on — a public pricing-values moment we should market when it happens.

### S4. Integration quality matrix + top-8 channel hardening — **Priority 7/10 · Complexity L (ongoing)**
- **Problem:** 30+ inherited integrations of unverified quality; agencies advertise what we advertise, to their clients. One bad channel experience costs the whole account.
- **Impact:** "Advertise 8 bulletproof channels" beats "list 30 maybes" (ICP assumption #5). The public matrix is another honesty asset competitors won't copy.

### S5. Report scheduling + auto-send (monthly client emails) — **Priority 7/10 · Complexity M**
- Turns N2 from artifact into habit; recurring client-visible value = churn armor. Gate: N2 adoption ≥50% of agency customers.

### S6. Referral + affiliate mechanics in-product — **Priority 6/10 · Complexity M**
- Credits ledger, referral links, affiliate dashboard for the educator partnerships (Acquisition §8/§9). Gate: manual referral flow demonstrably converting (≥10% of new customers) and ≥1 educator deal signed.

---

## 4. Next 12 Months (customers ~100–300) — expand the account, not the surface

### T1. Client-voice AI (per-workspace brand voice, drafts in each client's tone) — **Priority 7/10 · Complexity L**
- **Problem:** Generic AI drafts need heavy editing (the Taplio complaint — 15–30 min/output). Agencies juggle *many* voices; per-client voice is the agency-shaped version of AI.
- **Impact:** The one AI investment aligned with positioning ("an assistant inside the workflow, not a gimmick beside it"); OpenAI/Mastra infra already exists.
- **Why not sooner:** AI is a checkbox until the workflow moat exists; this is the first AI feature that's *client-first* rather than content-first.

### T2. Multi-step approvals (client + internal review stages) — **Priority 6/10 · Complexity M**
- Slightly upmarket (10–20 person agencies, regulated clients). Gate: losing deals to Planable on approval depth.

### T3. Client-facing live analytics dashboards (portal expansion) — **Priority 6/10 · Complexity L**
- "My client asks for numbers between reports." Deepens portal stickiness; agency's clients become daily visitors of agency-branded surface.

### T4. Automation surface productization (n8n app listing, Zapier/Make listings, MCP hardening, API docs site) — **Priority 6/10 · Complexity M**
- The side-channel (ICP Part 3) earns real investment once the core motion is repeatable; also feeds SaaS-segment inbound. Strictly capped until then.

### T5. Evergreen recycling + content library per client — **Priority 5/10 · Complexity M**
- SocialBee's niche, agency-shaped. Gate: objection-log demand. Fast-follow feature, not a differentiator.

### T6. Agency operations reporting (margin view: revenue per client vs. time/channels) — **Priority 5/10 · Complexity M**
- First step beyond "social tool" toward "agency operating layer" — only if customer interviews at ~150 customers point here.

---

## 5. Long-Term Vision (12+ months — the earnable version of the original vision)

The PRODUCT_VISION "operating system for marketing teams" was rejected as a day-one claim (Business Understanding §3). It becomes legitimate **only** as concentric expansion from the agency beachhead, each ring gated on owning the previous one:

1. **Own the client workflow** (approvals → reports → portal → analytics) — this roadmap.
2. **Own the agency-client relationship:** client communication inside the portal (replacing the WhatsApp thread entirely), content-request intake, onboarding checklists per client. The portal becomes where the agency's clients *live*.
3. **Own the agency business:** retainer/margin analytics (T6 grown up), client billing pass-through, capacity planning. The Sales Playbook's "agency operating layer" — earned, by then, from hundreds of agencies' trust.
4. **Then and only then, horizontal AI:** campaign planning, multi-brand knowledge management, AI account-manager agents drafting a month per client for human approval — the inherited agent/Mastra infrastructure finally justified by a workflow that makes its output trustworthy (the approval layer is, conveniently, the human-in-the-loop AI needs).
5. **Optional ring, only with scale:** the dormant marketplace entities (agencies ↔ SMB matching) — a two-sided product that is fatal to attempt early and plausible at 1,000+ agency customers.

**Standing anti-roadmap (things we will not build before PMF, reaffirmed):** marketplace/orders, OAuth developer platform packaging, video-generation expansion, net-new social integrations beyond hardening, native mobile apps, enterprise SSO/procurement features, multi-workspace holding-company structures. Each exists in code or imagination already; each is frozen until a validation gate no one has tripped.

---

## 6. Operating the Roadmap

- **Input queue:** the Sales Playbook objection log. Three unprompted asks = backlog candidate; ten = gate review. Nothing enters engineering from founder imagination alone anymore.
- **Capacity truth:** ~1 founder on product (Growth founder is selling). Horizons assume ~4 productive weeks/month minus support/migrations. If a horizon looks thin, that's why — it's honest.
- **Kill review:** monthly, alongside the acquisition kill/scale review. Any in-flight feature that loses its evidence gets stopped mid-build. Sunk cost is not a roadmap input.
- **The PMF tripwire:** if at 25 customers the approval workflow isn't the retention driver the thesis predicts (usage-retention correlation), we stop this roadmap and go back to interviews — the wedge, not the roadmap, would be wrong, and no amount of building fixes a wrong wedge.
