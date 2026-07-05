# Agency Layer Separation Plan
### How to build proprietary features next to an AGPL fork — without contaminating them

**Prepared:** July 2026
**Audience:** the two founders + any engineer who joins later. Written to be understood without a legal background.
**Status of legal claims:** this is the widely accepted industry reading of AGPL-3.0, and it is how companies in identical positions structure themselves. It is not settled case law. Spend one hour with a software-licensing lawyer before you rely on it commercially — this document will make that hour cheap and productive.

---

## Part 0 — The Logic, In Plain Words

### 0.1 What AGPL-3.0 actually obligates us to do

The engine (this repo) is a fork of Postiz, licensed AGPL-3.0. The license says, in effect:

> If people use your **modified version** of this program over a network, every one of those users has the right to receive the **complete source code of that modified version**.

Three things follow, and people constantly get them wrong in both directions:

1. **We do NOT have to publish our fork on GitHub.** The repo can stay private. The obligation is to *offer source to our users* (anyone using our hosted service) when asked — not to broadcast it to the world.
2. **We DO have to hand over every modification we make inside this repo** — the Polar integration, UI tweaks, new endpoints, everything in this codebase — to any user who requests it. And AGPL gives that person the right to republish it. So practically: **anything in this repo is "open by obligation." Assume competitors can read it.**
3. **The obligation stops at the boundary of "the program."** Code that is *not part of the modified program* — a separate program that merely talks to it — is not covered. This is the loophole-that-isn't-a-loophole we are using. It's not a trick; it's the explicit design of the license. The FSF itself distinguishes between one program (covered) and "two separate programs that communicate at arm's length" (not covered).

### 0.2 What makes something a "separate program" vs. a "derivative work"

There is no single statutory test, but there is a strong consensus checklist. Think of it as a scale — every item on the left adds separation, every item on the right adds contamination:

| Makes it SEPARATE (safe) | Makes it DERIVATIVE (AGPL spreads to it) |
|---|---|
| Runs as its **own process** | Loaded into the engine's process (imports, plugins, modules) |
| Lives in its **own repository** | Lives in this repo, built by this build |
| Communicates over a **network API** (HTTP/webhooks) | Linked at compile/runtime (shared classes, function calls) |
| Uses **generic, documented, public interfaces** that any third party could use | Uses private hooks that exist only for it |
| Has its **own database** | Reads/writes the engine's database directly |
| Contains **zero code copied from the fork** | Contains copied helpers, DTOs, snippets "just this once" |
| Could be pointed at a *stock upstream Postiz* and still mostly work | Only functions against our secret modified build |
| Exchanges **data** (JSON over HTTP) | Exchanges **internal data structures** (serialized objects, shared Prisma client) |

The single most persuasive fact you can create for yourselves: **make the Agency Layer consume the engine exactly the way an unrelated third-party developer would.** If a stranger with API docs could have built your service, no court and no upstream maintainer can plausibly call it a derivative work of the engine.

And here is the genuinely lucky part: **the fork already ships everything a third party would need** — a public REST API, API keys per organization, an OAuth-app system (register an app, authorize it, exchange tokens), outbound webhooks, and a DRAFT→QUEUE post lifecycle. You don't have to invent the arm's-length interface. Upstream already built it. You just have to have the discipline to stay on it.

### 0.3 The golden rule that decides where every line of code goes

> **Generic plumbing goes in the fork. Opinionated product goes in the Agency Layer.**

- *"Emit a webhook when a post changes status"* → generic plumbing. Any API consumer could want it. Goes **in the fork** (it's AGPL, sharable, maybe even a PR to upstream — more on why that's good below).
- *"Multi-step client approval chains with branded portal and audit trail"* → opinionated product. That's the moat. Goes **in the Agency Layer**, proprietary.

When you're unsure, ask: *"Would this feature make sense in stock Postiz, described without mentioning our product?"* Yes → fork. No → Agency Layer.

---

## Part 1 — Target Architecture

### 1.1 The picture

```
                    ┌─────────────────────────────┐
                    │   marketing site (Next.js)   │  proprietary · already separate ✔
                    │        www.domain.com        │
                    └──────────────┬──────────────┘
                                   │ links to
        ┌──────────────────────────┴───────────────────────────┐
        │                                                      │
┌───────▼────────────────────┐   HTTP (public API, API key /  ┌▼──────────────────────────────┐
│  ENGINE (this repo)        │   OAuth app token)             │  AGENCY LAYER (new repo)       │
│  AGPL-3.0 fork of Postiz   │◄───────────────────────────────│  Proprietary                   │
│                            │                                │                                │
│  • channels & publishing   │   webhooks (post events)       │  • client approval workflows   │
│  • scheduling (Temporal)   │───────────────────────────────►│  • client-facing portal        │
│  • orgs, users, auth       │                                │  • white-label reports         │
│  • media, AI, public API   │                                │  • approval audit trail        │
│  • billing (Stripe+Polar)  │                                │  • (later) agency analytics    │
│                            │                                │                                │
│  Postgres A (engine data)  │      NO shared code            │  Postgres B (approval data)    │
│  app.domain.com            │      NO shared database        │  portal.domain.com             │
└────────────────────────────┘      NO shared process         └────────────────────────────────┘
```

Both services can run on the **same Oracle VM** — separation is about process, codebase, and interface, not hardware. Two docker-compose projects on one box is legally identical to two continents.

### 1.2 Who owns what

| Concern | Owner | Why |
|---|---|---|
| Users, organizations, login | **Engine** | It already has multi-auth + orgs. The Agency Layer never stores passwords. |
| Social channels, tokens, publishing | **Engine** | The whole point of the fork. |
| Post content & schedule state | **Engine** | Posts live in engine DB; the Agency Layer references them **by ID only**. |
| Approval requests, decisions, comments, audit log | **Agency Layer** | The moat. Engine never knows *why* a post moved from DRAFT to QUEUE — only that an authorized API client moved it. |
| Client contacts (the people who approve) | **Agency Layer** | They are not engine users; they're the agency's clients. Magic-link auth, no engine account. |
| Portal branding / white-label config | **Agency Layer** | Pure product. |
| Report definitions & rendered reports | **Agency Layer** | Reads analytics **via the engine's public analytics API**, composes and brands them itself. |
| Billing | **Engine** (see Part 4) | Already built, not a moat. |

### 1.3 How the two services talk (the contract)

**Agency Layer → Engine** (REST, authenticated as an OAuth app / org API key):
- `GET /public/v1/integrations` — list a workspace's channels
- `GET /public/v1/posts`, `GET /public/v1/posts/:id` — read post content for display in the portal
- `PUT /public/v1/posts/:id/status` — the crucial one: flip an approved post from `DRAFT` to `QUEUE` (the public API already exposes post-status changes; verify the exact route and extend generically if needed)
- `GET /public/v1/analytics/...` — feed white-label reports
- media URLs for thumbnails in the approval view

**Engine → Agency Layer** (outbound webhooks, which the fork already supports):
- `post.created` / `post.updated` (draft saved → approval request should exist)
- `post.published` / `post.failed` (portal shows live status; audit trail completes)
- If an event you need doesn't exist yet, **add it to the fork's generic webhook system** (goes in the fork, AGPL, useful to everyone — that's the golden rule working as intended).

**The approval flow, end to end:**

```
1. Agency SMM writes a post in the engine UI, saves as DRAFT
2. Engine fires webhook `post.created (status: DRAFT)` ──► Agency Layer
3. Agency Layer creates an ApprovalRequest, notifies the client
   (email/WhatsApp link: portal.domain.com/a/<token>)
4. Client opens the link — Agency Layer renders the post
   (content fetched live from engine via GET /posts/:id)
5. Client taps Approve  ──►  Agency Layer records decision + audit event
6. Agency Layer calls engine: PUT /posts/:id/status → QUEUE
7. Engine's Temporal workflow publishes at the scheduled time
8. Engine fires `post.published` ──► Agency Layer completes the audit trail
```

Notice: the engine never learned what an "approval" is. It saw a draft, and later an authorized API call that promoted it. That's what arm's length looks like.

### 1.4 The two places people accidentally break the separation — and the pre-decided answers

**(a) "Can the Agency Layer just read the engine's Postgres? It's right there."**
No. Never. Direct DB access (i) couples you to the engine's schema so every upstream migration can break you, and (ii) is exactly the kind of intimate coupling that erodes the "separate programs" argument. API only. If the API is missing data you need, extend the API generically in the fork.

**(b) "Can we add approval buttons inside the fork's frontend?"**
Careful — the fork's frontend is AGPL too. The rules:
- **Plain links** from the engine UI to `portal.domain.com` (e.g., a nav item "Approvals ↗") — fine. A hyperlink is not a derivative work. The one-line patches that add those links are fork modifications (AGPL, trivially sharable, zero secrets leaked).
- **Building the approval management UI as React components inside `apps/frontend`** — that code becomes AGPL. Don't put moat UI there.
- Decision: **all approval/portal/report UI lives in the Agency Layer's own web app.** Agency-side screens and client-side screens are both pages of that app. The engine UI gets links only.

**(c) Bonus trap — the SDK:** the fork ships an npm SDK package. Before importing it into the Agency Layer, **check its license**. If it's MIT/Apache — fine, use it. If it's AGPL (or unlicensed, which inherits the repo default), do NOT import it; write your own thin HTTP client (it's a day of work — the API is REST+JSON). Copying nothing is the discipline that keeps the proprietary repo clean.

---

## Part 2 — The Step-by-Step Plan

Assumes ~1 founder on product (the other is selling), building on the roadmap's sequence: wedge validated in-fork first (v1), extracted to the Agency Layer once proven (this plan is roadmap item S1).

### Phase 0 — Ground rules & prep *(2–3 days · Difficulty: easy)*
1. Create the new private repo: `agency-layer` (or the product name). **From day one, nothing in it may be copied from the fork** — not a DTO, not a regex, not a docker-compose stanza. Re-type what you must; import nothing.
2. Write a `PROVENANCE.md` in the new repo stating exactly that rule. It's your evidence trail.
3. Book the one-hour lawyer review of this document (before the extraction, not after).
4. Compliance kit for the fork (an afternoon): a `SOURCE.md`/web page stating "this service runs a modified Postiz; users may request the modified source at <email>", and a tagged branch that *is* the clean answer to such a request. That's the entire AGPL compliance bar — cheap, do it now.

### Phase 1 — Define the contract *(3–5 days · Difficulty: easy, mostly reading)*
1. Inventory the engine's **public API** and **webhook events** against the flow in §1.3. Produce a two-column list: *have* / *missing*.
2. Expected gaps (verify): a webhook event on draft creation; a clean public endpoint for DRAFT→QUEUE transition; per-post media thumbnail access with an API key.
3. Write `CONTRACT.md` in the Agency Layer repo: every endpoint and event it consumes, with request/response shapes. This doc is both your integration spec and — not incidentally — standing proof that the integration surface is generic and documented.

### Phase 2 — Fill the gaps in the fork, generically *(1–2 weeks · Difficulty: moderate)*
1. Implement the missing webhook events / API endpoints **in the fork**, written as if for any third-party developer: named generically (`post.status.changed`, not `approval.needed`), documented in the public API docs.
2. Follow the repo's Controller → Service → Repository pattern; these land in `apps/backend/src/public-api/` and `libraries/nestjs-libraries/`.
3. **Consider PRing the generic pieces to upstream Postiz.** Sounds counterintuitive — help the competitor? — but: (i) you must share this code with any user who asks anyway, (ii) every patch upstream accepts is a merge conflict you never have again, and (iii) goodwill with upstream is cheap insurance for the day you want a commercial-license conversation.

### Phase 3 — Scaffold the Agency Layer *(1 week · Difficulty: easy-moderate)*
1. Stack: honestly, whatever you're fastest in — a single **Next.js app (portal UI + API routes) or NestJS API + small Next.js front**. Own `Postgres B`. Own Prisma schema. Own repo, own compose file, same VM is fine.
2. Register it in the engine as an **OAuth app** (the fork has this!) or per-org API keys to start. OAuth-app mode is the end state: each agency "connects" the Agency Layer to their engine org exactly like connecting any third-party tool.
3. Webhook receiver endpoint + signature verification + an idempotency table (webhooks WILL be delivered twice; design for it on day one).
4. Data model v1: `AgencyAccount` (links to engine org ID), `ClientContact`, `ApprovalRequest`, `ApprovalItem` (references engine post IDs), `Decision`, `AuditEvent`, `PortalBranding`.

### Phase 4 — Build approval v2 in the Agency Layer *(3–4 weeks · Difficulty: the real work)*
1. The client portal: magic-link auth for `ClientContact` (no engine accounts), mobile-first approve/comment screens, per-client scoping.
2. The agency-side screens: pending approvals across all clients, reminders, audit trail view.
3. The two API integrations from §1.3 (read post → display; approve → flip status).
4. Eventual-consistency handling: post edited in engine *after* approval requested → webhook `post.updated` → mark approval stale, re-request. This is the trickiest product logic in the whole plan; think it through on a whiteboard before coding.
5. Failure UX: engine unreachable → portal shows cached content with a "live status unavailable" badge; approval decisions queue locally and sync. Never lose a client's tap on "Approve."

### Phase 5 — Cutover from in-fork v1 *(1 week · Difficulty: easy-moderate)*
1. Migrate v1 approval history (export from fork DB → import into Postgres B; a one-off script — this script may read the fork's DB, it's yours and it runs once).
2. Feature-flag: orgs switch to Agency-Layer approvals cohort by cohort; design partners first.
3. Delete (or flag off) the v1 approval code paths in the fork. The less moat logic in the AGPL repo, the better you sleep.

### Phase 6 — Repeat the pattern for the next moat features *(ongoing)*
White-label reports, then client-facing analytics dashboards, then agency margin analytics — each one: consume engine's public API, store own data, render own UI. The pattern established in Phases 1–5 is reusable; each subsequent feature is cheaper than the last.

### Standing hygiene rules (print these)
1. **No code crosses the boundary. Ever.** Not even "just this interface."
2. **No shared npm package** between the two repos (a shared internal lib is exactly the linkage that erodes separation — and it's also just bad coupling).
3. Engine talks to Agency Layer only via webhooks; Agency Layer talks to engine only via the public API. If you're tempted to add a "private" endpoint in the fork that only your service knows about — stop, make it public and documented instead. Secret handshakes are both a legal smell and a design smell.
4. New feature? Apply the golden rule (§0.3) *before* the first line of code.
5. Dependency licenses in the Agency Layer: anything goes except AGPL/GPL libraries. Add a license checker to CI (`license-checker` or similar) — 30 minutes, permanent peace of mind.

---

## Part 3 — How Difficult Is This, Honestly?

**Overall: moderate. 6–9 weeks of one founder's product time for the approval extraction, on top of infrastructure you mostly already have.** For two technical founders this is squarely within reach — the risk isn't ability, it's discipline (the hygiene rules) and sequencing (don't extract before the wedge is validated, per the roadmap's S1 gate).

| Piece | Difficulty | Why |
|---|---|---|
| Understanding/keeping the legal boundary | **Easy** | The rules fit on one page (§0.2, hygiene list). The hard part is not cheating under deadline pressure. |
| API/webhook gap-filling in the fork | **Moderate** | You know this codebase; NestJS patterns are established. Risk: scope creep into "while I'm here…" |
| Scaffolding the second service | **Easy** | Greenfield Node/Next with its own Postgres. You've done this many times. |
| The approval product itself | **Moderate-hard** | Not because of separation — because approval workflows have genuinely tricky state (staleness, re-approval, offline clients). You'd face this even in a monolith. |
| Distributed-systems tax | **Moderate, permanent** | Webhook retries, idempotency, eventual consistency, two DBs, two deploys, cross-service debugging. This is the real price of the architecture — roughly +20% ongoing overhead vs. a monolith. |
| Ops on the Oracle VM | **Easy-moderate** | Second compose project, second backup job, second log stream. Same box. |

**What you get for that price:** your moat features are legally yours; upstream merges stop touching your product code (the fork stays close to stock + generic patches, so `git merge upstream/main` gets dramatically easier over time); and the Agency Layer could someday even work against *other* engines. **What you pay:** two systems to operate, and every moat feature costs slightly more to build than it would in-fork. The roadmap already prices this in — that's why v1 ships in-fork (fast validation, accepted AGPL exposure) and only *proven* features earn extraction.

---

## Part 4 — The Polar Question, Answered Properly

> *"We integrated Polar (upstream only has Stripe). Should billing also be separated out?"*

**No. Leave Polar in the fork. Extracting it would cost real effort and buy you nothing.** Here's the full reasoning, because the *why* matters more than the answer:

**1. Understand what state the Polar code is already in.** It lives in this repo, therefore it is a *modification of the AGPL program*, therefore it is already "open by obligation" — any user of your hosted service can request it, and you must provide it (and they may republish it). **Separating it now would NOT undo that.** Code doesn't become proprietary retroactively by moving it; the versions you already ran for users remain requestable. So the question is never "how do we make Polar private?" — that ship has sailed and was never worth catching. The question is only "is there future value in a proprietary billing service?"

**2. There isn't, because billing is not a moat.** Ask the golden-rule question: does "Polar as a payment provider" make sense in stock Postiz, described without mentioning your product? Obviously yes — it's exactly the kind of generic provider integration the codebase is full of (Stripe/Polar, Resend/SMTP, R2/local storage…). Nobody chooses your product because of which payment processor charges their card. Sharing this code with a requester costs you zero competitive position.

**3. Extraction would be expensive precisely where it's least rewarding.** Billing isn't a leaf feature — subscription state gates channel limits, AI credits, team seats, and feature access throughout the engine. Ripping it into a separate service means re-plumbing entitlement checks across the whole app: weeks of risky work on a production-money code path, to protect code with no secret in it. Worst trade on the whole board.

**4. The actually-smart move: PR it to upstream.** Your Polar integration is (a) already effectively open, (b) generic, (c) useful to every self-hoster who prefers Polar's merchant-of-record model. Contributing it upstream means: every future `git merge upstream` no longer conflicts with your billing patches (this is a *forever* tax you'd be deleting), you gain contributor standing in the upstream community (worth real money if you ever negotiate a commercial license or need a maintainer's goodwill), and you lose nothing you hadn't already lost by writing it in the fork. The only reason not to: if upstream has since added their own Polar support, in which case *adopt theirs* and delete yours at the next merge — even better.

**5. The general principle this illustrates** — worth internalizing because you'll face it again:

> Separation is a tool for protecting **moats**, not a tax applied to all custom code. Most of what you'll ever change in the fork (billing providers, bug fixes, deployment configs, generic API additions) *should* stay in the fork, openly and cheaply. Only the features customers choose you for — approvals, portal, white-label, agency analytics — earn the extraction cost.

A one-line test for every future change: **"Would I mind if my competitor read this diff?"** Polar webhook fix → don't care → fork. Approval-chain logic → care a lot → Agency Layer.

---

## Appendix — Decision Log (fill in as you go)

| Date | Decision | Rationale |
|---|---|---|
| 2026-07 | Billing (incl. Polar) stays in fork; consider upstream PR | Part 4 |
| 2026-07 | Approval v1 ships in-fork; extraction gated on validation (roadmap S1) | Speed > purity pre-PMF |
| — | Auth mechanism for Agency Layer: OAuth app vs API keys | Start API keys, graduate to OAuth app |
| — | SDK license verified: (record result) | §1.4(c) |
| — | Lawyer review completed: (date, name) | §0 status note |
