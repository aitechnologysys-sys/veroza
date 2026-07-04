# Business Understanding Report

**Prepared:** July 2026
**Basis:** All ten documents in `/Fable-5`, plus direct inspection of the repository (license, git history, deployment state).
**Posture:** I was asked not to agree with you. I haven't.

---

## 1. Executive Summary

You are two technical founders building a bootstrapped SaaS on top of a fork of **Postiz**, an open-source social media scheduler licensed under **AGPL-3.0**. The inherited product is technically substantial — 30+ channel integrations, a public API, billing (Stripe + Polar), AI content features, Temporal-based scheduling, multi-tenant orgs — and is genuinely production-capable at its core.

Your stated vision is to become "the operating system for modern marketing teams." Your stated philosophy is "validate before building." **These two statements are in direct tension, and right now the vision is winning.** The documents describe a product with enormous surface area, no named customer, no named niche, no revenue, and no distribution plan.

The honest summary: **you have a strong engine and no vehicle.** The engineering risk of this business is near zero — Postiz already works. Every remaining risk is commercial: who buys it, why they'd pick you over Buffer/Metricool/Publer/hosted-Postiz-itself, and how they find you. None of the ten documents answers any of those three questions.

---

## 2. What Problem We Are Really Solving

The documents state the problem implicitly, never explicitly. Reconstructing it: _"People who manage social media across multiple platforms waste time posting manually and juggling native tools."_

Two hard truths about that problem:

1. **It is a solved problem.** Buffer, Hootsuite, Later, SocialBee, Publer, Metricool, Typefully, Hypefury, and the original hosted Postiz all solve it, several of them at $5–$30/month. The pain is real but the market has abundant, cheap, mature supply. You cannot win on "solves scheduling."
2. **The problem you _can_ own is narrower and unchosen.** Viable wedges hidden inside your own feature inventory: agency multi-client management (the Customer entity, per-client channel grouping already exist), API-first/automation-native scheduling (public API + SDK + webhooks + MCP is genuinely stronger than most incumbents), or AI-agent-driven content ops. Each of those is a _different business_ with a different buyer. You currently claim all of them, which means you own none.

**What problem you are really solving today, as positioned: none distinctly.** That's the core issue this report exists to surface.

---

## 3. What Product We Are Actually Building (vs. What We Think We're Building)

**What you think you're building:** an AI-powered marketing workspace — the future OS for marketing teams.

**What you are actually building:** a rebranded fork of an existing open-source scheduler, plus aspirations. The delta between your codebase and upstream Postiz right now is, per git history: deployment docs, Polar webhook fixes, and Docker configs. Your current proprietary value-add is approximately **zero product differentiation and some ops work**.

That's not an insult — forking a mature product is a legitimate, capital-efficient starting point. But be precise about what it means:

- Every feature in `FEATURE_INVENTORY.md` is also a feature of upstream Postiz and of anyone else who forks it. **The inventory is a description of the commons, not of your moat.**
- The "AI-first marketing workspace" exists today as: a copilot chat, post generation/splitting, image/video generation behind external API credits. That is table stakes in 2026 — Buffer and Canva ship the same. It does not yet constitute an "AI-first" product; it's a scheduler with AI garnish.
- The marketplace/agency entities, OAuth developer platform, and enterprise endpoints in the schema are upstream's ambitions, not yours. Inheriting their sprawl is not the same as having a roadmap.

**The product you should admit you're building for the next 6–12 months:** a hosted social media scheduler for one specific niche, where AI and automation are the differentiating wedge — not a marketing OS.

---

## 4. Current Strengths

1. **~2 years of engineering for free.** The fork gives you multi-tenant SaaS plumbing, billing, 30+ integrations, and durable scheduling (Temporal) on day one. Time-to-first-paying-customer is limited by marketing, not code. For two technical founders, this neutralizes your natural temptation (building) and forces you toward your weakness (selling) — which is actually healthy.
2. **Genuinely differentiated automation surface.** Public API + Node SDK + webhooks + OAuth apps + MCP/agent tooling is better than what Buffer or Later expose. If a niche of technical users or agencies-with-workflows exists in your network, this is your strongest real asset.
3. **Breadth of long-tail channels.** Bluesky, Mastodon, Farcaster, Nostr, Lemmy, Telegram, Discord, Skool, Whop — incumbents ignore most of these. Communities on those platforms are underserved and reachable.
4. **Two technical founders, low burn.** You can survive a long validation period that would kill a funded competitor's attention span. Your cost structure _is_ a strategy if you use the time correctly.
5. **Both billing rails already wired** (Stripe + Polar), so charging money — the single most important validation act — requires no engineering.

---

## 5. Current Weaknesses

1. **No differentiation you own.** See §3. Anyone can fork the same repo tomorrow. Your only durable assets will be brand, niche ownership, distribution, and proprietary features you build _after_ the fork point. All four are currently at zero.
2. **No identified customer.** Ten documents; not one names an ICP, a customer interview, a waitlist, or a single user. "Freelancers to agencies to growing businesses" is everyone, i.e., no one.
3. **No distribution asset.** Upstream Postiz grew via its founder's large open-source/dev audience. You inherit his code but not his audience. Nothing in the documents describes how customer #1 finds you.
4. **Brand aspiration vs. reality gap.** You want Linear/Stripe/Vercel feel; you inherit Postiz's existing UI (Mantine + custom components, utilitarian). Closing that gap is months of design work — and honestly, at your stage, _premium feel_ is a distraction from _anyone paying at all_.
5. **Heavy infra for a bootstrapper.** Temporal + its own Postgres + Elasticsearch + Redis + app Postgres is a lot of machinery to run reliably for (currently) zero customers. Also flagged in your own docs: no production migration discipline (`db push` patterns), no data retention policies, per-provider secret sprawl.
6. **Integration quality is unverified.** 30+ providers "exist" but your own `CURRENT_PRODUCT_STATE.md` admits nobody knows which are solid. Each one you advertise is a support liability you haven't priced.

---

## 6. Biggest Risks

Ranked by expected damage:

1. **The commodity-market risk (most likely killer).** You enter the most crowded segment of SaaS with no wedge. Default outcome: 18 months of building, a trickle of $19/mo signups from strangers, churn, quiet death. This kills more scheduler startups than anything technical.
2. **AGPL-3.0 obligations and upstream conflict.** The code is AGPL. Running it as a hosted SaaS means **any modifications you make must be offered as source to your users** (AGPL §13). Your proprietary differentiation _cannot live in the forked codebase_ unless you're comfortable open-sourcing it — competitors included. You also cannot use the Postiz name/brand. And you will be competing directly against upstream's own hosted offering, run by the person who wrote the code and owns the community. **This is the single most under-acknowledged fact in all ten documents — it's mentioned nowhere.** You need a deliberate answer (e.g., proprietary features live in separate, non-derivative services; or you embrace open-core honestly).
3. **Platform API dependency and cost.** The fork does not include API access. You must obtain your own Meta app review, TikTok audit, X API tier (paid, and X's pricing is hostile), YouTube quota, LinkedIn approval — each takes weeks-to-months, some require a published privacy policy, demo videos, and business verification. Some incumbents' biggest moat is simply _having these approvals_. Budget real calendar time for this; it gates your launch, not your code.
4. **Vision-driven sprawl.** Twelve expansion areas in `PRODUCT_VISION.md` for a two-person team. Sprawl is already the top risk named in your own product-state doc — and the vision doc doubles down on it. "Validate before building" is stated but nothing in the documents shows validation activity.
5. **Two technical founders, zero marketing muscle.** The company's success is ~90% dependent on the skill neither founder has demonstrated. This isn't fixable by strategy documents; it's fixable only by one founder committing the majority of their time to distribution.

---

## 7. Biggest Opportunities

1. **The agency wedge (strongest evidence in your own schema).** Customer entities, per-client channel grouping, team roles, approval-workflow ambitions, white-label potential. Small social media agencies (1–10 people) pay reliably ($50–$300/mo), churn less, need multi-client management that Buffer prices punitively (per-channel pricing hurts agencies badly). This is the most credible "easy for freelancers, scales to agencies" interpretation of your vision.
2. **API/automation-first positioning.** "The scheduler that's actually built for automation" — n8n/Make/Zapier users, indie SaaS founders auto-posting product content, AI-agent builders (MCP support is early-mover territory in 2026). Small but growing, technical, reachable through channels two technical founders can authentically use (dev content, communities, integrations marketplaces).
3. **Long-tail/decentralized platform coverage.** Creators on Bluesky/Farcaster/Mastodon/Nostr + community operators on Discord/Telegram/Skool/Whop. Underserved, passionate, concentrated in findable communities. Niche enough to win, real enough to pay.
4. **Underpriced incumbent pain: per-channel pricing.** Buffer charges per channel; agencies with 40 channels bleed. Flat-ish pricing with generous channel limits is a genuine switching trigger you can afford because your marginal cost per channel is ~zero.
5. **Pick one of these, win it, then the "workspace" vision becomes earnable** — expansion from a beachhead, not a day-one claim.

**Explicitly unnecessary for your stage** (you asked me to say so): the marketplace/agency-order flows, OAuth developer platform packaging, video generation providers, multi-brand management, enterprise endpoints, and the Linear-grade brand polish. Deprioritize or hide all of them.

---

## 8. Assumptions That Should Be Validated

Each stated as the falsifiable bet you're currently making without evidence:

1. **"People will pay _us_ rather than Buffer/Metricool/hosted Postiz."** Validate with 10 strangers paying real money, not friends, not free users.
2. **"AI features drive purchase decisions in this category."** Possibly false — AI content generation may be a checkbox, not a wedge. Ask churned users of competitors what they actually miss.
3. **"The 'marketing OS' expansion is what customers want next."** Untested. Customers may want a better scheduler, not a bigger surface.
4. **"Freelancers→agencies is one market with one product."** Usually false; agencies need approvals/white-label/client reporting, freelancers need cheap and simple. Pick.
5. **"Broad integration coverage is a selling point."** May be inverted: 30 half-verified integrations sell worse than 6 bulletproof ones. Verify quality of your top 6 before advertising 30.
6. **"We can operate this stack reliably solo."** Run it under synthetic load for a month before taking money for it; a scheduler that misses scheduled posts is dead on arrival, and Temporal+ES is nontrivial ops.
7. **"AGPL doesn't constrain our business model."** It does, materially, unless architected around deliberately. Validate with an actual reading of §13, ideally an hour of a lawyer's time.
8. **"We can get our own platform API approvals in reasonable time."** Start Meta/TikTok/X applications _now_, in parallel with everything else — this is likely your longest pole.

---

## 9. Questions I Would Ask Before Spending a Single Marketing Dollar

1. Who is customer #1 — a real, nameable person or company in your network — and have you spoken to them?
2. Which single niche are you willing to say **no** to everyone else for, for the next 12 months?
3. What is your relationship with upstream Postiz — silent fork, contributing fork, or open competitor? (This determines legal posture, community optics, and whether upstream's community is a channel or an enemy.)
4. Where does your proprietary code live, given AGPL? What is the moat plan in one sentence?
5. Which distribution channel can you personally execute weekly for a year — SEO/content, communities, cold outreach, integration marketplaces, open-source funnel? (Pick by founder temperament, not by what worked for others.)
6. What does each founder spend their week on? If the answer is "both mostly code," the plan fails regardless of strategy.
7. What is your monthly personal runway and the revenue number at which this becomes sustainable? ($1M ARR is a slogan; "what pays rent by when" is a plan.)
8. Have you obtained, or applied for, your own developer API access on Meta, X, TikTok, LinkedIn, and Google? What did X's API tier quote you?
9. What happens when upstream ships a feature you charge for, free?
10. Why did the last three people you described this product to _not_ sign up? (If you can't answer, you haven't pitched it enough times.)

---

## 10. What Information Is Still Missing

The ten documents describe the **code** thoroughly and the **business** almost not at all. Missing entirely:

- **Any customer evidence:** interviews, waitlist, beta users, usage data, willingness-to-pay signals. (Most important gap; everything else is downstream of it.)
- **ICP definition:** even a hypothesis document naming segment, size, budget, watering holes.
- **Competitive analysis with numbers:** competitor pricing tiers, per-channel costs, G2/Reddit churn complaints. (The pricing doc explicitly defers this — fine, but it must exist before pricing or positioning work.)
- **Founder context:** skills split, network, audience, hours available, runway, geography/target market (pricing for Dhaka-area SMBs vs. US agencies are different businesses).
- **Relationship & legal posture toward upstream Postiz:** fork status, trademark plan, AGPL compliance plan.
- **Platform API access status:** which developer apps are approved, applied-for, or not started.
- **Operational baseline:** current hosting cost, uptime history of the Oracle VM deployment, whether scheduled posts have ever run reliably for a week under real use.
- **A name.** You cannot ship under "Postiz" — it's their trademark. Branding direction exists; a brand does not.

---

## Bottom Line

You are not early on product; you are early on _everything else_. The fork bought you the right to skip 18 months of engineering — do not spend that dividend building more features. Spend it answering one question: **which specific group of people will pay this month for what already works?**

My recommendation for the immediate next step (when you're ready to go beyond this report): choose between the **agency wedge** and the **automation/API wedge**, then run a 30-day validation sprint — 20 conversations, 1 landing page, prices displayed, aiming for 3 paying commitments — before writing another line of product code.

Per your instructions, I'm stopping here.

Two direct answers first: no, you cannot change the license, and yes, you can get Meta/TikTok approval — my point was about calendar time and prerequisites, not feasibility. Details on both:

The AGPL question

Only the copyright holder can relicense code. The Postiz copyright belongs to Gitroom Holdings and its contributors — cloning it into your own repo and renaming it transfers zero rights. Removing or changing the license header would be straightforward copyright infringement, and it's the kind that open-source maintainers actively enforce (and that shows up publicly when discovered — a bad look for a new brand).

What AGPL-3.0 actually requires of you, precisely:

- You CAN keep your repo private. AGPL doesn't force you to publish on GitHub.
- But Section 13 is the catch: anyone who uses your SaaS over the network has the right to request the complete source of your modified version. You must provide it. And once they have it, the license grants them the right to redistribute it. So "private" only holds until one curious user (or competitor who signs up for a $19 plan) asks.
- This applies to the forked codebase and anything that's a derivative work of it — meaning your proprietary features can't live inside the Postiz code.

Your realistic options, in order of practicality:

1. Architectural separation (what most companies in your spot do). Keep the AGPL fork as the "engine," and build your differentiating features as separate services that talk to it over its API — separate process, separate codebase, no shared code. Independent services communicating at arm's length are generally not derivative works, so they can stay proprietary. Yally well-suited to this.
2. Buy a commercial license from Gitroom. Dual-licensing is exactly why companies choose AGPL — it pushes commercial users to pay for an exception. Postiz's
   docs/site mention commercial arrangements; an email costs you nntire constraint. Given you're bootstrapped, it may or may notbe affordable, but you should know the number.
3. Accept open-core honestly. Run the fork as-is, comply with sn hosting quality, niche focus, and distribution rather thansecret code. Plenty of viable businesses do this — your moat just can't be the code.

What is not an option: keeping modifications to the forked codebase closed while running it as a SaaS. That's the one path that's both non-compliant and
discoverable.

One hour with a lawyer before launch is worth it here, but the reading of AGPL §13.

Meta review and TikTok audit

I'm saying approval is a gated, weeks-long process with prerequreach. Small companies get approved constantly. What itconcretely involves:

Meta (Facebook Pages, Instagram, Threads): To publish on behalf of users you need a Meta developer app with Advanced Access to permissions like
instagram_content_publish and pages_manage_posts. That requires

- App Review — a screencast demonstrating exactly how your app uses each permission, with a working product to record. Rejections over unclear videos are
  routine; expect 1–3 rounds, each taking days to a couple of wee
- Business Verification — a legally registered business with documents (registration, address proof). This is often the long pole for solo founders; you
  need an actual legal entity.
- A live privacy policy, terms of service, and data-deletion instructions at public URLs.
- Note also: Instagram publishing via API only works for users s, which shapes who your product can serve.

TikTok: The Content Posting API has a two-stage gate. You can gaudited apps can only post in "private/self-only" visibility —invisible to the creator's audience, which makes an unaudited scheduler useless. Public posting requires passing TikTok's audit: demo video, privacy policy,
ToS, and a review that typically takes weeks.

While you're at it, the neighbors:

- X: no review gate, but a paywall — the Basic API tier is roughly $200/month (Pro is ~$5k/month) with post-volume caps. As a bootstrapper, this is a rerecurring cost per month from day one, before your first custom
- LinkedIn: "Share on LinkedIn" (w_member_social) is relatively easy to request; organization-page posting and anything under the Community Management Aneeds a partnership-style approval.
- YouTube: OAuth verification for sensitive scopes, plus a default quota of 10,000 units/day — a video upload costs 1,600 units, so ~6 uploads/day platform-wide until you pass a quota-increase audit.
  The practical takeaway: every one of these wants a registered bt with a privacy policy, and demo evidence — so the sequencematters. Get the entity and a deployed, working app up first (even pre-revenue), then file Meta Business Verification and the TikTok audit immediately, because those weeks run in parallel with your validation work b. Upstream Postiz's approvals don't transfer; these must all beunder your own developer accounts.
