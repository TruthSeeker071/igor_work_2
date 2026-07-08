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
