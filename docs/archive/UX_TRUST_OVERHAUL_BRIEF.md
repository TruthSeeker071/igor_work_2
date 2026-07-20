# FlightWay Site-Wide UX Overhaul — Trust, Onboarding & Coherence Pass (for Fable)

Source: founder huddle, 2026-07-16 (Jacob, Leo, Igor — user-interview feedback + competitive audit). This brief translates that discussion into a scoped, gradeable body of work.

**Read `flightway-fullstack-architect` skill guidance and `CLAUDE.md` before starting.** This follows that skill's philosophy — trace causes fully, verify with project scripts, delegate mechanical sub-tasks below your tier, no exhaustive audits without a concrete lead. Also read `docs/CONVERSATION_HANDOFF.md`'s most recent entries and `docs/LAUNCH_POLISH_BRIEF.md` — the fit-score compression bug and the auth/security pass are **already fixed** (2026-07-13, commits `1ed1740`/`67dc067`). Don't re-derive or re-touch that work; build on top of it.

## Why this brief exists

Leo ran user interviews and pulled two outside opinions; Igor and Jacob triangulated the same conclusion from a different angle. The findings converge on one thesis:

> **The product has real technical depth (the O*NET vector pipeline) that competitors like APT (a GPT-wrapper requesting a raw API key from users) plainly don't have. But none of that depth is legible to a user in the UI.** Users see a flat wall of 5,000+ careers, an unexplained percentage, and no reason to trust it over a coin flip — so they bounce to "talk to a human" instead. Fix the *legibility and trust* of what already exists before adding anything new.

## Hard scope boundary — read this before writing any code

This is a **UI / UX / information-architecture / copy** pass. Per Igor's explicit closing instruction in the huddle ("we shouldn't be implementing any more features right now... the main problem is making the user interface good... we might have to draw wireframes") and Jacob's framing ("merge existing features into one comprehensive experience, don't build new ones"):

- **Do not** build a payment/paywall/billing/entitlement system. `pricing.html` stays exactly as-is, dark, unchanged (standing instruction, unchanged from the last brief).
- **Do not** build the analytics/data-warehouse architecture the affiliate-links / anonymized-data-sale revenue ideas would need. Jacob flagged this himself as a real but separate infra gap ("we need a really robust architecture to handle user data... which we don't have right now") — it's a backend/data-platform project, not a UI task. Out of scope here.
- **Do not** build career-center-facing dashboards or portals. Igor explicitly tabled this ("forget about career centers, we'll focus on that later").
- **Do not** add new backend features, new pages, or new data models. Every phase below should be achievable by restyling, recopy, reordering, and re-surfacing data that **already exists** in the pipeline.
- **Do not** re-touch `onet-math.js` / `functions/_lib/onet/math.js` cosine/tier logic or the auth hardening from `67dc067` unless you find a genuinely new bug — that work is done and verified.

If a fix genuinely requires a small new field or endpoint to surface existing server-computed data to the client (e.g., threading a `tier`/confidence value that's computed but not returned), that's in scope — it's plumbing for a UI need, not a new feature.

## Working discipline (same as every FlightWay brief)

- Work in phases, in order. Don't skip Phase 0.
- Trace causes fully before editing (hydration/vector-merge and accumulating-math subsystems are fragile — see skill).
- One targeted change per confirmed item; match existing file idioms; no drive-by refactors.
- Verify with project scripts (`node --check`, `npm run test:vectors`, `npm run hub:verify`, `npm run verify:aliases`, `npm run pages:smoke`) — **and** because this is a UI-heavy brief, do real visual QA in a browser (light + dark theme, mobile width) for every phase before calling it done. Scripts don't catch a lopsided card or a CTA that reads as secondary.
- Bump cache-busters only on files actually changed, only on pages that reference them.
- Report outcome-first, proportional to what changed.
- For Phase 3 (Career Hub) and Phase 4 (Landing Page) specifically — the two areas with real structural/visual uncertainty — **produce a quick mockup or written description of 2–3 concrete directions and get Jacob's sign-off before wiring the real implementation.** Everything else can go straight to implementation.

---

## Phase 0 — Grounded inventory

Before touching code, re-walk the 9 in-scope entry points (`index.html`, `quiz.html`, `dashboard.html` hub, `career.html`, `portal.html`, `roadmap.html`, `coach.html`, `profile-build.html`, `auth.html`) with fresh eyes, specifically looking for:

- Every place a fit % / tier label ("Legendary Match," etc.) is shown **without** an adjacent "why" affordance.
- Every place algorithmic output is framed as a verdict rather than an input ("You are a 92% fit" vs. "Here's how you compare").
- Copy that could read as "disregard what you already think" rather than "here's what we noticed about you."
- Confirm current state of the two features referenced below (`why-this-match.js`, the Sharpen-Matches hub panel) hasn't drifted since this brief was written — grep them again, don't trust this doc blindly if it's been a while since 2026-07-16.

Write a short punch list, prioritized, before starting Phase 1.

---

## Phase 1 — Trust & Explainability Layer

**This is the single highest-leverage phase.** Both Leo's interviews and Igor's framing land on the same ask: *show the user which factors drove a match, so it reads as a data point they can evaluate, not an oracle.*

**Already built, under-deployed** — don't rebuild this, extend its reach:

- `assets/js/shared/why-this-match.js` already does almost exactly what was asked for in the huddle: it turns a fit % into a tap-to-expand explanation citing the specific O*NET coordinates driving it ("92% because: Investigation — you 88, role wants 90 → 21% of the match…"), with confidence-tier chips (`anchored` / `inferred` / `estimated`). It's currently mounted **only** inside `assets/js/hub/career-personalize.js` on the `career.html` deep dive — i.e., only visible after a user has already clicked into a specific career.
- Strawberry.me's audited standout feature (Leo's competitor writeup: "there's kind of a web for each job... how well it connects to your profile... problem solving, personality-based, critical thinking") is functionally the same idea FlightWay already built, just not surfaced as broadly. This is a real moat if it's visible earlier and more often.

**Concrete work:**

1. **Surface it at the Career Hub card/panel level** (`dashboard.html`, `assets/js/hub/hub-dashboard.js` panel + `hub-canvas.js` orb click), not just after opening the full deep dive — a compact version (top 2-3 contributors) at the point where a user is deciding *whether* to click into a career.
2. **Surface it at the very first quiz-result reveal** (`quiz-app.js`'s confetti/reveal moment) — this is the highest-trust-deficit moment per the interviews (first impression of "why should I trust this"). Reuse `fromComparisons()`/`drawerHtml()` from `why-this-match.js`; the reveal already has the comparison rows available (same shape `onet-dimension-viewer` consumes).
3. **Reframe copy everywhere a fit % appears** so it reads as a data point, not a verdict — audit hero language, tier names, and any hard "you are X% fit for this" phrasing found in Phase 0 for a softer, comparative framing ("this is how you compare," "here's a starting point"). Igor's exact language from the huddle is the target voice: *"we're not the final say... it's a data point in your decision making."*
4. **Honesty about confidence, not just contribution.** Where the objective vector is thin/empty (same all-zeros-seed condition already handled in `functions/_lib/onet/user-vectors.js:101` and the pivot-modal fix from the prior session), the "why" surface should say something like *"based mainly on your quiz answers so far"* rather than presenting a bare, confident-looking percentage. The `estimated`/`inferred`/`anchored` tier chips already exist for this — make sure they render wherever a % is shown, not only inside the why-drawer.

---

## Phase 2 — Onboarding & Reveal Sequencing

Leo's interview finding: **80–90% of users already have a career leaning, they just aren't certain** — and they want that leaning *acknowledged and validated*, not overridden. When an algorithmic suggestion contradicted their existing interest with no explanation, interview subjects got visibly upset ("the career they thought they wanted is blue or purple instead of gold").

Note: the "move Sharpen-Matches out of the upfront quiz" idea Jacob raised in the huddle is **already implemented** — `quiz-app.js:571` confirms the deeper questions already live in the post-signup Career Hub "Sharpen your matches" panel (`hub-refine.js`), not the initial gate. Don't rebuild that; this phase is about sequencing what remains, not re-architecting the quiz.

**Concrete work:**

1. **Capture existing career leaning early.** Add one input to the initial quiz gate (before the first reveal) — open text or a category picker — capturing what the user already thinks they're interested in. Store it alongside the existing quiz-answer state (same `fw_hub_quiz_v1` local shape / server quiz profile — this is a new field, not a new system).
2. **Acknowledge before suggesting.** At the first reveal moment, lead with the user's *stated* interest and how it scores, before or alongside any algorithmically-suggested alternative. When an alternative is shown, frame it with Leo's exact recommended structure: *"you mentioned X — here's a related path, Y, that might be an easier transition / build more directly on what you already have."* Never present an alternative as a flat replacement with no stated reason.
3. **Soften the first reveal's finality.** The current post-signup flow (confetti → reveal) reads as a final verdict at the moment of least available data (thinnest objective vector). Consider explicit "starter read" framing on this first reveal specifically, with a visible next step into Sharpen Matches — not a quiz redesign, a tone/copy/CTA change on the existing reveal screen.

---

## Phase 3 — Career Hub Legibility (reduce overwhelm, fix the granularity mismatch)

Leo's finding: users are "immediately overwhelmed and confused" on opening the hub and seeing 5,000+ careers, in both the current square layout and the older circular one. Separately, both Leo and Jacob independently flagged the same underlying issue: **the hub gives every career the same visual weight regardless of how much real depth sits underneath it** — "crossing guard" and "lawyer" both render as one orb, even though lawyer has a large number of AI-derived offshoot specializations (visible today only *after* a deep dive — "legal technology solutions architect," "regulatory compliance strategist," etc., generated via `generateFragmentsForBase`) and crossing guard genuinely doesn't.

This is a real information-architecture bug: the browse layer (`hub-canvas.js` zone tiles / sector orbs) doesn't communicate depth-of-field, so a career with a rich cluster of sub-paths and an atomic one look identical, and the *total count* feels flat and undifferentiated rather than structured.

**Concrete work (propose 2–3 directions with a quick mockup before implementing):**

1. **Surface a depth signal on hub orbs.** For careers with generated offshoot fragments already in the derived-careers store, render something that visually reads as "there's more here" — a sub-path count badge, a clustered/layered orb treatment, anything that differentiates "lawyer" from "crossing guard" at a glance, without requiring the user to click in first.
2. **Reduce first-glance overwhelm.** Default the hub to a filtered or ranked view (e.g., top-N matches visually dominant, long tail collapsed/searchable) rather than presenting the full unfiltered map immediately. The existing fit-score/percentile plumbing (`percentileRank()`, already used for individual career ranking) is available to drive this — it's a display/default-state change, not new math.
3. **Revisit the abandoned "zone clouds" concept, but only if it fits in scope.** Jacob mentioned an earlier attempt at colored zone clouds that didn't work out pre-Claude — worth a fresh, scoped visual pass now that the deep-dive page has hit a polish bar the hub hasn't, but don't let this balloon into a full re-architecture. If a cheaper visual fix (badges, sizing, grouping) solves the legibility problem, prefer it.

---

## Phase 4 — Landing Page Conversion Pass

Leo's finding: users scroll around instead of immediately starting the quiz; he referenced a competitor landing page (linked in the huddle thread) with one large CTA, a press/trust bar, and a clear "how it works" section as a positive reference point.

**Grounded current state** (already checked, don't re-derive): `index.html`'s hero (`fw-hero`) already has one large primary CTA ("Get started" → `quiz.html`) above the fold — so the problem isn't a missing CTA. Two concrete things stand out instead:

- A `fw-scroll-cue` element sits directly beneath the CTA, literally inviting the scroll behavior Leo flagged as the problem.
- The hero subhead centers "real coaching from your campus career center" — a B2B/career-center angle Igor explicitly tabled this same meeting ("forget about career centers, we'll focus on that later"). The primary hero message is diluted by a deprioritized value prop instead of centering the core match/roadmap experience.

**Concrete work (propose direction before implementing):**

1. Re-evaluate the `fw-scroll-cue` directly under the CTA — it may be actively working against the "start immediately" goal.
2. Rewrite the hero subhead to center the core value prop (matching + personalized roadmap) rather than the deprioritized career-center angle; move any career-center messaging further down the page, not the hero.
3. Add a short, honest "how it works" section (3–4 steps) if one doesn't already exist further down the page — check Phase 0 inventory first, this may partially exist.
4. Do **not** fabricate press logos, user counts, or testimonials to mimic the competitor's trust bar — if there's nothing legitimate yet to put there, leave it out rather than invent it.

---

## Phase 5 — Free vs. Paid Framing (copy/IA only — no gating logic)

Current architecture (confirmed, not proposed): the 40 hard-coded careers (`flightway.ai` / production `main`) are the free tier; the O*NET vector pipeline (this prototype, `Jacob_Work` → `flightwayjacobprototype`) is the paid tier. Leo's concern from the huddle: the free tier might not demonstrate enough value to convert anyone, calling it (per Jacob) close to "an art piece."

This phase is **presentation only** — no billing, no entitlement checks, no paywalls.

**Concrete work:**

1. Bring the free tier's card/copy polish up to the same bar the deep dive (`career.html`) has already reached — it shouldn't read as visibly lower-effort than the paid experience.
2. Give the free tier one honest, visible "there's more" moment — e.g., a teased/locked preview of a "why this match" breakdown or a coordinate count ("this match is driven by 12 factors we can show you in the full version") — a preview, not a functional unlock.
3. Do not build the entitlement/paywall logic to actually gate anything yet — that's explicitly a separate, later decision per standing instruction.

---

## Phase 6 — Site-Wide Copy & Personalization Pass

A prior session (2026-07-12, Phase 3) already did a jargon-strip pass: "objective vector" → "your background," "O*NET coordinates" → "strengths," etc., across several files (`portal-resume`, `skill-gap`, `resume-builder`, `career-compare`, `dimension-viewer`, `receipts`). Extend the same treatment, don't redo it.

**Concrete work:**

1. Sweep the pages *not* covered in that pass (landing page, quiz-result copy, hub empty states, auth screens) for the same class of clinical/jargon language.
2. Target voice, directly from Jacob's framing in the huddle: make the user feel like *"we hear you, we know what you're looking for, you don't need to worry"* — warm and specific, never a wall of feature-speak. Concretely avoid any copy that implies "disregard what you already think" (ties directly to Phase 1/2 framing — this is one coherent voice change, not a separate task).

---

## Phase 7 — Explicit non-fixes (don't spend time here)

- **Email validation.** Format validation already exists and is enforced server-side (`isValidEmail`, `functions/_lib.js:72`, `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, called from `functions/auth/register.js:45`). There is **no** send-a-verification-email step — and per this huddle, that's a **deliberate, already-made decision**: Leo explicitly said the old flow used to require checking an inbox and concluded it "creates too much friction that it's worth" (i.e., not worth it). What users can still do is register with a syntactically-valid but fake address (`asdf@gmail.com`) — that's the known, accepted trade-off, not a bug. No action needed. If the team ever wants a cheap partial mitigation, a disposable-email-domain denylist is the lowest-friction option — optional, not part of this brief.
- **Day-in-the-life sim.** Already shipped, well-received in the huddle ("looks pretty solid"). Light QA only if time remains at the end; not a redesign target.
- **GoZig/Strawberry.me/APT full competitive teardown.** Leo, Jacob, and Igor each independently audited one competitor as a same-day action item outside this brief — check `docs/CONVERSATION_HANDOFF.md` for a follow-up addendum with their findings before Phase 4, in case it sharpens the landing-page direction, but don't re-run the audits yourself.

---

## Verification checklist (every phase)

- `node --check` every touched JS file.
- `npm run test:vectors`, `npm run hub:verify`, `npm run verify:aliases`, `npm run pages:smoke`.
- Live browser QA: light + dark theme, mobile width, for every visual change — this brief is almost entirely UI, scripts alone will not catch it.
- Cache-buster bump only on changed files, only on referencing pages.
- `git push origin Jacob_Work` deploys (Cloudflare Pages auto-build) — `curl -L` the live URL after push to confirm.
- Report outcome-first: what changed, file:line, what you verified. Flag anything you decided to skip and why.
