# FlightWay 2.0 — Week 1 build (Trust + Polish + Fake door)

This repo (`igor_work_2`) is a full copy of the FlightWay 1.0 codebase with the
plan's **Week 1** slice implemented on top: A1 why-this-match, A2 confidence
tiers, C2 sim share cards, the fake-door pricing page, and the `events.js` /
migration infra those depend on, plus the cheap E polish. Everything follows the
house patterns (`originFromEnv` + `checkRateLimit` + schema validation on the
server; `esc()` / `textContent` on render) and is additive — no 1.0 behavior was
changed, and the large Jacob-owned files were touched only with small guarded hooks.

## What shipped

### Shared infra (Week-1 dependencies)
- **`assets/js/shared/events.js`** — `FWEvents.log(type, data)` ring buffer (500)
  in `localStorage.fw_events_v1`, shape `{t, at, page, d}` (generalises the sim
  `fw_sim_events_v1` pattern). `?fw_debug_events=1` renders a floating panel for
  Leo's moderated sessions (wired through `flags.js` → `__FW_FLAGS.debugEvents`).
  Included with `defer` on index / quiz / portal / dashboard / career / simulation /
  profile-build / pricing.
- **`migrations/0006_v2_pricing.sql`** — additive `pricing_intents` table for the
  fake door. Apply with `wrangler d1 migrations apply flightway-db`.

### A1 — "Why this match"  (pure math, no AI, no cost)
- **`fitContributions(userVec, careerVec, k, labels)`** added to both
  `assets/js/shared/onet-math.js` (browser) and `functions/_lib/onet/math.js`
  (server mirror, so deep-dive narrative can cite the same numbers). Each
  dimension's `u·c / (|u||c|)` is its share of the cosine fit; returns the top-k
  contributors. Invariant **Σcontribution = cosine** is unit-tested.
- **`assets/js/shared/why-this-match.js`** (`FWWhyMatch`) — a tap-to-expand drawer
  built from the per-dimension comparison rows the deep dive already computes
  (no vector recompute). Hooked into `career-personalize.js` `hydrateUserOnetMatch`
  with one guarded block. Provenance chips reuse the A2 confidence tiers.

### A2 — Confidence tiers on the Dimension Viewer
- **`assets/js/shared/onet-dimension-viewer.js`** `renderDimensionBars` now reads
  the personality vector's existing `confidence[]` array and tags each bar
  `data-confidence="anchored|inferred|estimated"`, dims low-confidence fills, adds
  a legend and a **"Answer 3 more questions to firm up …"** CTA →
  `profile-build.html?dims=<ids>`. Backward-compatible: no confidence array →
  renders exactly as before.
- **`assets/js/quiz/onet-quiz-seed.js`** — static `DIM_QUESTION_MAP` + `questionsForDims()`.
- **`assets/js/profile/profile-building.js`** — reads `?dims=` and front-loads the
  matching prompts so the next 3 questions raise those estimated coordinates.
- Surfaces live on the **portal** (`portal.js` → `mountPortalViewer`).

### C2 — Sim → signal (share cards)
- **`assets/js/sim/sim-share.js`** (`FWSimShare`) — renders a 1200×630 canvas from
  a trial (career, tier, expected-vs-felt, one energizer), PII-stripped, via
  Web Share API or PNG download. Zero backend. Hooked into the sim **debrief** and
  **Mirror** in `sim-engine.js` (guarded one-liners).

### Fake-door pricing (validation before payments)
- **`pricing.html`** — on-brand "Flight Plan" page: Free / $9.99·mo or $59·yr /
  $199 lifetime / $29 Interview Sprint, monthly↔annual toggle. "Start free trial"
  logs `pricing_click` + POSTs intent immediately (the CTR metric), then offers
  optional email capture.
- **`functions/waitlist-intent.js`** — `POST {tier, source?, email?}` → `pricing_intents`
  (rate-limited per IP, peppered IP hash only, never a raw IP). Degrades to `ok`
  if the DB is unavailable so the fake door never hard-fails.
- The landing nav's two "Pricing" links now point to `pricing.html`.

### E — Polish debt (cheap items)
- `wrangler.toml` sets `ALLOWED_ORIGIN = "https://flightway.ai"` for production
  (previews fall back to `*`).
- `npm run sim:pregen` script added for the pending pre-gen run (needs live D1/KV).
- Cache-busters bumped only on the assets actually changed, only on the pages
  that reference them.
- `/pricing.html` added to `scripts/smoke-pages.mjs`.

## Execution layer (Weeks 3–4 — added on top of Week 1)

### B1 — Weekly Flight Plan  (deterministic selection, zero new AI)
- **`functions/_lib/weekly-plan-core.js`** — pure, shared selection: `isoWeek()`,
  `selectWeeklyTasks(tree)` (earliest incomplete steps on the active roadmap path,
  same input → same 3 tasks), `applyDoneState()`, `markStepDone()`, `planProgress()`.
- **`functions/weekly-plan.js`** — `GET` returns the week's 3 tasks (stable per ISO
  week in KV, done-state live from the roadmap); `POST {taskId, done}` marks the
  underlying step done via `loadRoadmap → markStepDone → saveRoadmap` (single-sourced
  through the roadmap store). Session-gated, rate-limited.
- **`assets/js/app/portal-flightplan.js`** — top-slot portal card: 3 checkboxes, a
  progress ring, optimistic toggle → POST + `FWEvents.log('flightplan_done')`.
- Unit-tested: **`scripts/test-weekly-plan.mjs`** (`npm run test:weekly`) — order,
  determinism, limit, empty/all-done/no-path edges, done-state, completion sync.

### A3 — Receipts (progress deltas)
- **`migrations/0007_v2_execution.sql`** — `vector_snapshots(email, week, …)`.
- **`functions/receipts.js`** — `GET` writes this week's snapshot (idempotent
  upsert) then returns the last 8 weeks + the top coordinates that moved
  (earliest→latest delta) + a movement trend for the sparkline.
- **`assets/js/app/portal-receipts.js`** — "Your receipts" card: movers with
  up/down deltas, a canvas sparkline, labels mapped from the dimension registry,
  and a "first receipt lands next week" empty state.

Both cards are injected from the portal boot after `FWSimPortalCard.inject()`
(no edits to `portal.js`).

## Pillar C1 — AI-Exposure Score (the marketing wedge, productized)
- **`scripts/onet-etl/ai-exposure-weights.json`** — editorial 0–1 exposure weight
  per O*NET work activity (all 41), each with a rationale + sources. Reviewable
  and versioned.
- **`scripts/onet-etl/build-ai-exposure.mjs`** — computes a per-occupation score
  from the real level vectors (`vectors-lv.f32.bin`): importance-weighted average
  exposure, then **percentile-ranked** to 0–100 so it discriminates and reads as
  "more AI-exposed than N% of careers". Outputs **`data/ai-exposure.json`** (763
  occupations: `score`, `rawExposure`, `band`, `topExposed`, `topDurable`).
  Spot-checks are plausible — hairdresser 4, chief executive 28, nurse 53,
  accountant 93, software developer 100. `npm run onet:exposure` (also chained
  into `onet:build`).
- **`assets/js/hub/ai-exposure.js`** (`FWAiExposure`) — renders the "How AI hits
  this career" deep-dive section (score meter, what-AI-does / what-stays-human
  columns, estimate badge, method link, "AI-proof my plan" CTA). Hooked into
  `career-personalize.js` `hydrateUserOnetMatch` (career-level, shows even without
  user vectors).
- **`docs/AI_EXPOSURE_METHOD.md`** — honest self-assessment framing + the legal
  guardrail (no job-loss predictions).

## Entitlements (0.3) + Pillar D1 — Interview prep (premium)

### 0.3 Entitlements (ships dark)
- **`migrations/0008_v2_entitlements.sql`** — `users.plan`, `users.plan_expires_at`.
- **`functions/_lib/entitlements.js`** — `getPlan` / `requirePlan` +
  `planSatisfies` / `isPlanActive` / `effectivePlan` + `paywallEnabled`. Until the
  `PAYWALL_ENABLED` Pages var is `"true"`, everyone is treated as premium (beta);
  premium endpoints still call `requirePlan` so gating is enforced server-side.
- **`functions/config.js`** — `GET {paywallEnabled}`; `/auth/me` now returns `plan`.
- **`assets/js/shared/entitlements.js`** — `FWEnt.has()` / `FWEnt.gate()` (UX only).
- Unit-tested: **`scripts/test-entitlements.mjs`** (`npm run test:entitlements`) —
  plan ranking, expiry, flag, and `requirePlan` on/off (18/18).

### D1 Interview prep
- **`functions/interview-prep.js`** — `POST {careerName, stage:'question'|'feedback'}`.
  Question stage: a KV-cached 12-question bank per career (behavioral/role/curveball)
  with per-user "seen" tracking; feedback stage: a rubric
  `{structure, specificity, clarity}` (score + note each) + `verdict` + `model_moment`.
  `requirePlan('premium')`, hourly rate-limit + a 20/day cap, server-side prompts,
  all output length-capped.
- **`assets/js/coach/interview-mode.js`** — a self-mounting "Practice interview"
  panel on the coach page (question → answer → rubric feedback), premium-gated via
  `FWEnt`. Zero edits to `coach.js` — it injects its own launcher + overlay.

### D2 Resume builder
- **`functions/resume-builder.js`** — `POST {soc}` → the student's dossier
  translated into resume bullets, each tagged with the O*NET dimensions the target
  career weighs most (top-importance dims read server-side from `importance-im.f32.bin`).
  The AI can only tag dimensions from that real list — it can't invent coordinates —
  and returns a coverage figure. `requirePlan('premium')`, rate-limited + daily-capped,
  cached 7d per (email, soc).
- **`assets/js/app/resume-builder.js`** — a portal card opens a panel that reads the
  focused career, generates bullets, shows a coverage meter + dimension chips, and
  gives per-bullet copy buttons. Injected like the other portal cards (no `portal.js`
  edits); premium-gated via `FWEnt`.

## Pillar B2 — Weekly nudge emails (opt-in)
- **`migrations/0009_v2_notifications.sql`** — `users.notify_optin`, `notify_token_hash`.
- **`functions/_lib/notify-token.js`** — deterministic peppered unsubscribe token
  (Web Crypto), single-sourced across the endpoints and the worker; constant-time compare.
- **`functions/notify-prefs.js`** — `GET`/`POST` the opt-in (session-gated, rate-limited).
- **`functions/unsubscribe.js`** — one-click `GET`, token-verified, sets `notify_optin=0`,
  plain HTML page. No auth by design (email link); CAN-SPAM compliant.
- **`workers/cron/index.js`** + **`workers/cron/wrangler.toml`** — a standalone Worker
  (Pages Functions can't run cron). Mondays 14:00 UTC: opted-in users → the *same*
  `selectWeeklyTasks` selection → a Resend email with the 3 tasks, a one-click
  unsubscribe link, and a postal address; batched ≤50/min, failures logged to KV.
  Deploy: **`npm run deploy:cron`**.
- **`assets/js/app/notify-optin.js`** — a portal-footer toggle (cadence stated at opt-in).
- **Setup note:** set `UNSUB_SECRET` to the *same* value on both the Pages project and
  the cron worker so links verify; set `RESEND_API_KEY` / `FROM_EMAIL` / `MAILING_ADDRESS`
  on the worker.

## Verification (run offline here)
- `node --check` passes on every touched file.
- `npm run test:vectors` — green, including the new A1 `fitContributions` block
  (Σcontribution ≈ cosine, ordering, top-k, label threading, degenerate inputs).

Still requires a deploy: `npm run pages:smoke` (Playwright vs a live URL) and the
D1 migration apply. See `PUSH.md`.

## Not in this slice (later weeks per the plan)
B (weekly Flight Plan, receipts, nudges), C1 (AI-exposure ETL + deep-dive section),
D (interview prep, resume builder), full `0003_v2_core` migration, entitlements,
and Stripe. The fake door gates that Stripe work until ≥5% of actives click through.

## Open items needing a human
- **Igor**: create the GitHub repo + push (see `PUSH.md`); set `ALLOWED_ORIGIN` /
  Resend / (later) Stripe env vars in the Pages dashboard; approve pricing copy.
- **Jacob**: expose `vectorMeta`/`confidence` on the `/profile` payload if not
  already (A1 provenance + A2 tiers already read the personality `confidence[]`
  array that exists client-side; server exposure firms up the deep-dive narrative).
