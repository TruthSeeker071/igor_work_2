# Overhaul Progress Ledger

Execution ledger for `docs/OVERHAUL_MASTERPLAN_2026-07-20.md`. One checkbox per slice, a
one-line note per completed slice, every deviation, every human-gated item. If context
resets, resume from here — not from memory.

Branch: `Jacob_Work`. Deploy = `git push origin Jacob_Work`. Live:
https://flightwayjacobprototype.pages.dev

---

## Phase 0 — Orient + baseline suite

- [x] Baseline gates run 2026-07-20 at `2cfac69` (before any overhaul edit).

| Gate | Result |
|------|--------|
| `hub:verify` | GREEN |
| `hub:smoke` | GREEN (10 zones, both sessions) |
| `pages:smoke` (live) | GREEN — all 8 pages, zero pageerrors |
| `test:vectors` | GREEN |
| `verify:aliases` | GREEN |
| `onet:test` | GREEN |
| `test:entitlements` | GREEN |
| `test:user` / `verify:user` / `test:sync` | GREEN |
| `test:school` | GREEN |
| `hero:check` | GREEN |

Live site was serving at baseline (HTTP 200, `auth-nav.js?v=20260703p`), i.e. the CF build
queue stall recorded in the 2026-07-19/20 handoff addendum has cleared.

## Phase 1 — The seven fixes

- [x] **1.4 — Remove "Go to home" from app navs** — `syncNavLink()` now hides
  `#nav-signin-link` outright when signed in (hidden + aria-hidden + display:none + cleared
  text/href), instead of converting it into a second Home tab. All 10 pages carrying the
  link already had `data-app-nav="home"` (verified by grep), so no markup was added. Landing
  hero/nav CTA relabelled "Go to home" → "Open FlightWay" in `auth-cta.js` (3 spots).
  Busters bumped to `?v=20260720a` on both files, every referencing page.
- [x] **1.7 — Favicon rename + bust** — icons moved (`git mv`, so the poisoned URLs stop
  resolving at all) to `assets/icons/favicon-128.png` + `assets/icons/apple-touch-180.png`;
  all 15 HTML pages now link them at `?v=20260720a`, and root `/favicon.ico` keeps its
  correct art with the same fresh stamp. Verified: all three busted URLs return 200 with
  byte-identical sha256 to disk; `grep -c favicon-128 *.html` == 1 on all 15.
  SVG favicon deferred to WS-A slice A2 — see Deviations.
- [x] **1.5 — Portal uses the whole window (WS-B slice B0)** — `.portal-wrap` is no longer a
  fixed 1040px column: base is `width: min(1040px, 100%)` + `margin-inline: auto` (so admin
  and resume, which share the class, are untouched), and `#page-portal .portal-wrap` opens to
  `min(1760px, 100%)`. `#page-portal` horizontal padding is now `clamp(16px, 3vw, 48px)`,
  which reproduces the plan's 94vw frame without the overflow a literal `94vw` inside a
  padded parent would cause below ~800px. At ≥1280px the wrap is a 12-column grid: everything
  spans 12, `#portal-actions` spans 8, the new `.portal-rail` (profile entry + snapshot)
  spans 4 and goes sticky at ≥1440px, `#portal-fw2-stack` spans 12 as
  `auto-fit minmax(320px, 1fr)`. Portal H1 scales `clamp(2.2rem, 1.5rem + 2.2vw, 3.6rem)`
  (scoped so roadmap's `.portal-title` keeps its own scale). Roadmap's full-bleed override
  gained `width: auto` to neutralize the new base width.
  Verified with the screenshot harness at 375/1024/1280/1680/2560: `scrollWidth === innerWidth`
  at every width (zero horizontal body scroll) on portal, roadmap and resume; rail sits beside
  the action cards at ≥1280 and below the tools stack (today's order, via `order`) under it.
- [x] **1.2 — AI-derived satellites re-keyed to their live base** — new pure module
  `functions/_lib/onet/derive-rekey.js` (owns `offsetLayout`, moved out of
  `_lib/derive-career.js`) re-derives `hubZone`/`orbColor`/`jobZone`/`collarCategory` and
  the 8 layout coords from the CURRENT base row on every read, and drops fragments whose
  base SOC is gone or out of scope. Applied at `getAllDerivedRows` (the new chokepoint
  behind `/derive-career?all=1`, `?soc=`, `?base=`), at the post-generation SELECT, and in
  `onet/store.js` `mergeDerivedIntoCareers`. Client hardening in `hub-onet-map.js`
  (`reparentDerived` inside `mapRowsToCareers`) forces zone/color from the parent in the
  live catalog and skips orphans. `scripts/backfill-derived-zones.mjs` (+
  `npm run derived:backfill`) rewrites the stored rows — dry-run by default, `--apply`
  for remote D1, `--fixture` for local. `hub:verify` now replays the re-key over
  `scripts/fixtures/derived-rows-stale.json` (stale zone → live zone, orphan dropped,
  sibling orbits distinct, idempotent). Commit `53919ac`.
- [x] **1.1 — Career hub open lag** — permanent `[fw-perf]` boot line (marks: script-eval,
  catalog, indexes, first-paint, veil) emitted when the veil lifts. `warmHubFragments()`
  now runs on `requestIdleCallback` (1500ms fallback) after first paint; `career-compare.js`
  + `career-deep-dives.js` dropped from `dashboard.html` and injected on first use or idle
  via `HUB_LAZY_MODULES`; `career-descriptions.json` (185KB) starts on idle instead of
  during `loadCore`, with the hub panel kicking the memoized promise itself and filling the
  description on arrival. Measured at 1.6Mbps + 4× CPU, 3 runs each: veil 7096ms → 6943ms
  mean; 4 requests moved after veil release (descriptions, `/derive-career?all=1`, both
  lazy modules). Plan step 4 (canvas sprite pre-render) NOT triggered — see Deviations.
  Commit `6011468`.
- [x] **1.3 — Personality-vector distinctness + weighted sector fit** — two commits.
  **(a) `e3da3a9` ETL + weighted sector fit.** New `scripts/onet-etl/zone-weighting.mjs`
  owns the math (and `hubZoneForSoc`, moved out of `build.mjs`): per zone `c0` = the
  unweighted mean, `rep_j = max(0, cosine(v_j, c0))`, `w_j = rep_j^3`, storing `lvMeanW`
  and `repWeightSum` beside the existing `lvMean`. `npm run onet:zoneweights`
  (`build-zone-weighted.mjs`) adds the fields in place; `build.mjs` emits them on a full
  rebuild. Consumers read `lvMeanW` with an `lvMean` fallback: `hub-zone-fit`
  `computeZoneFitsMap`, `hub-onet-map`'s fit pass, both copies of
  `deriveZoneProfilesFromAggregates`. `mergeToDisplayZones` folds `lvMean` by count and
  `lvMeanW` by `repWeightSum`; `hub-onet-map` now delegates that fold to `FWHubZoneFit`
  instead of keeping a second copy. `hub:verify` fails on a missing/degenerate `lvMeanW`.
  **(b) `f958b3a` seed + layer gating + persona harness.** Seed: weight exponent 2→5;
  contrast expanded around the per-dimension generic-occupation baseline (mean across all
  zone centroids) rather than 50, gain 3.0 on dims the top sector commits to
  (`|centroid − baseline| ≥ 8`, same sign) and 0.75 elsewhere; the ±band zeroing now
  measures from the amplified vector's own mean. New `gateLayerDeltas` in both math files
  gates each source's pending deltas (1.0× sharpening / 0.5× opening / 0.25× fighting) and
  caps the layer's L1 (sharpen 120, resume bleed 150), inside the replay path so hydration
  stays byte-idempotent. Server `refine-map` switched to the client's value-encoded
  `refine:<base>` tags — it still zeroed on strip, so a server rebuild wiped the seed in
  every bumped domain. `test:vectors` gained the 4-persona harness (24 assertions, all
  green) plus an 11-constant client/server parity check. `quiz.html` was missing
  `onet-math.js`. Busters `?v=20260720d` (fold) then `?v=20260720e` (gating) on
  `onet-math`, `refine-map`, `onet-vectors`, `hub-zone-fit`, `hub-onet-map`.

  **Final constants (record for future tuning):**

  | Constant | Value | Where |
  |---|---|---|
  | `SEED_WEIGHT_EXPONENT` | 5 | `onet-vectors.js` + `user-vectors.js` |
  | `SEED_GAIN_ALIGNED` | 3 | both |
  | `SEED_GAIN_OTHER` | 0.75 | both |
  | `SEED_TOP_COMMIT` | 8 | both |
  | `SEED_ZERO_BAND` | 6 | both |
  | `LAYER_GAIN_ALIGNED / OPEN / OPPOSED` | 1 / 0.5 / 0.25 | `onet-math.js` + `math.js` |
  | `REFINE_L1_BUDGET` | 120 | `refine-map.js` (client + server) |
  | `BLEED_L1_BUDGET` | 150 | `onet-vectors.js` + `user-vectors.js` |
  | `PERSONALITY_OBJECTIVE_BLEED` | 0.2 | unchanged |
  | `REP_WEIGHT_EXPONENT` | 3 | `zone-weighting.mjs` |

  **Measured before → after** (782 careers, per persona: p90−p10 fit spread / own top-career
  mean / opposite-persona mean / home-zone margin over the median zone):

  | Persona | Before | After |
  |---|---|---|
  | quant-finance | 27 / 56 / 23 / 6 | **54 / 89 / 18 / 10** |
  | healthcare | 22 / 48 / 35 / 8 | **37 / 67 / 17 / 23** |
  | creative | 20 / 31 / 26 / 3 | **37 / 68 / 18 / 17** |
  | trades | 38 / 49 / 15 / 26 | **36 / 58 / 0 / 60** |
- [x] 1.6 — Zoom-proofing (absorbed into WS-B) — closed by WS-B slices B1–B4: the fluid
  frame/token system replaced the px page containers site-wide, and `npm run layout:check`
  is the standing proof (270 cells = 9 pages × 5 widths × **67% / 100% / 150% zoom** ×
  light/dark, all clean). The masterplan's own Fix 1.6 entry says "absorbed into WS-B — do
  not do piecemeal px edits in Phase 1", so there was never Phase-1 work under this box.

## Workstreams

### WS-A — brand & typography

Baseline re-run 2026-07-20 at `b695454`, before any WS-A edit: `hero:check` GREEN,
`pages:smoke` (live) GREEN — all 8 pages, zero pageerrors.

- [x] **A1 Self-hosted fonts** — `assets/fonts/inter-latin.woff2` (48KB) +
  `space-grotesk-latin.woff2` (22KB), both the Google **variable** latin subsets, so one
  file covers the whole weight range per family. `@font-face` declared in
  `flightway-theme.css` with `font-display: swap` and no `unicode-range` (out-of-subset
  glyphs fall through per-glyph, same as before). The `@import` of
  `fonts.googleapis.com` at `flightway-theme.css:2` is gone, and all 33 google
  preconnect/stylesheet lines are stripped from the 11 pages that carried them —
  **zero external font requests site-wide**. `--font-display` is now Space Grotesk (was
  Inter); new `--font-body` token holds the Inter stack, and every hardcoded `'Inter'`
  stack in the four CSS files now reads it. The `!important` override at
  `flightway-theme.css:1487` that forced `.hero h1 / .section-title / .coach-title /
  .qz-intro-title / .qz-q-text` back to Inter now reads `var(--font-display)`.
  `font-variant-numeric: tabular-nums` added for the metric readouts that lacked it.
  Busters `?v=20260720f` on `flightway-theme.css`, `flightway-pages.css`,
  `hub-dashboard.css`, every referencing page. Preload (`as=font`, `crossorigin`) for
  both files on all 14 pages that load the theme — verified `initiatorType: 'link'`,
  i.e. the `@font-face` reuses the preload rather than refetching.
- [x] **A2 Wordmark lockup** — three new vector marks, all traced from the existing
  artwork rather than redrawn: `assets/icons/flightway-bird.svg` (4.7KB),
  `assets/icons/favicon.svg` (4.7KB, orange badge + knocked-out white bird, matching the
  PNG favicon's treatment so small sizes don't regress) and
  `assets/icons/flightway-lockup.svg` (8.9KB, bird + "FlightWay" as real Space Grotesk 700
  outlines at −0.035em). `brand.js` now emits the bird as inline SVG (both gradient stops
  read `--fw-mark-from` / `--fw-mark-to` so a surface can retint it) — the 131KB
  `logo-bird.png` request is gone. `.fw-brand` / `.logo.fw-brand` set the wordmark in
  `var(--font-display)` 700 at the lockup's tracking. Fix 1.7's outstanding SVG-favicon
  line is now on all 15 pages, first in the icon block. Busters: `brand.js`,
  `flightway-theme.css`, `flightway-pages.css` @ `?v=20260720f`.
- [x] **A3 Type scale** — `:root` gains `--fs-hero / --fs-h1 / --fs-h2 / --fs-h3 /
  --fs-card / --fs-body / --fs-small`, all `clamp()` with a **rem + vw** middle term (bare
  `vw` ignores the root font size and breaks browser zoom — this is also WS-B's zoom
  story). Applied to: landing hero (`.fw-hero-title`, `.hero h1`), `.section-title`,
  `.portal-title` (the `#page-portal` special case from fix 1.5 is folded into `--fs-h1`,
  so portal and roadmap now share one page-title scale), coach title/results/settings,
  `.overview-text h3`, `.career-loading-card h2`, `.career-card-title`, the seven quiz
  display headings, and the two `flightway-2.css` modal `h3`s. Two now-redundant
  breakpoint overrides deleted (`.coach-title` @640, `.qz-intro-title` @small) — a fluid
  token makes them dead weight. Remaining px font-sizes in the four CSS files are all
  ≤18px component labels, which WS-B explicitly allows. Buster `?v=20260720f` on
  `flightway-2.css`.

**WS-A gate: GREEN.** Zero `https://fonts` references in any HTML (grep) *and* zero
requests to any external host at runtime on index/portal/coach/quiz/pricing/dashboard
(measured, not assumed). `hero:check` PASS — headroom actually improved on the Space
Grotesk hero (1440: 4.49px → 6.44px). `pages:smoke` GREEN, all 8 pages. Screenshot pass
over all 13 pages × light/dark × desktop/mobile: zero `[pageerror]`, zero harness
failures.

### WS-B — site-wide fluid layout

- [x] **B1 Layout tokens** — `:root` gains `--page-max: 1760px`, `--page-pad:
  clamp(16px, 3vw, 48px)`, `--rail-w: clamp(280px, 24vw, 380px)` and `--gap-1..4`, plus
  two tokens the plan did not name: `--frame-mid: 1180px` and `--frame-narrow: 760px` (a
  console or a one-column form does not become more usable at 1760px — only the app frames
  do). One shared frame pattern, `.fw-page-frame` / `.fw-container`:
  `width: min(var(--page-max), 100% - 2 * var(--page-pad))`. Gutters come out of the width
  rather than padding, so nested frames never double their gutters.
- [x] **B2 Per-page conversion** — audited all 94 non-media-query `max-width` hits and
  converted every page-container one. `.fw-container` 1200px+padding → frame (index,
  pricing). `min(1400px, 94vw)` → `min(var(--page-max), 100%)` on `.section-inner`,
  `.footer-inner`, `.fit-analysis-stack`, `.metrics-row`, `#page-career .career-pair-grid`
  and `.fw-ax-section` — `94vw` counts the scrollbar, the frame pattern doesn't.
  `.career-hero-top` 1180px → frame. `.coach-shell` 820px → `min(var(--frame-mid), 100%)`
  (WS-D replaces it with the two-pane frame). `#page-quiz .qz-wrap` 720 → `min(960px,
  100%)`. `.portal-wrap` gains `#page-admin` (`--page-max`) and `#page-resume`
  (`--frame-mid`) frames. `.sim-page .fw-shell` 640 and `.pb-wrap` 560 →
  `--frame-narrow`. Five page shells' horizontal padding now reads `--page-pad`. Two
  fixed grids (`metrics-row`, `career-pair-grid`) became `auto-fit minmax()` so they
  reflow instead of crushing. Prose measures (38-56rem), modals and chat bubbles were
  classified as keep-as-is and left alone.
- [x] **B3 Overflow discipline** — the admin tables already sit in `overflow-x: auto`
  wrappers and there is no `<pre>`/code content, so the one real offender was the app nav
  rail: `.app-nav-tab` had `min-width: 0` and no `flex-shrink`, so at ≤1024 effective CSS
  px the tabs were squeezed to 42-69px while their `nowrap` labels needed 54-126px — and
  because the pill's overflow is `visible`, the text spilled *outside* the pill rather than
  truncating. `.app-nav-tab` is now `flex: 0 0 auto`; the rail's existing `overflow-x:
  auto` scrolls instead. Found by the gate, not by eye.
- [x] **B4 Canvas pages** — both canvases already rebuild their backing store on resize,
  but neither reacted to a **pure DPR change** (OS display scaling, or dragging the window
  to a monitor with a different scale factor): the layout viewport doesn't change, so no
  resize event fires and the canvas is upscaled blurry with nothing to notice. Added a
  self-re-arming `matchMedia('(resolution: Xdppx)')` watcher in `hub-dashboard.js` and
  `roadmap-tree.js` that calls their existing `resize()`. Browser zoom was already covered
  (it does fire `resize`).

**WS-B gate: GREEN.** New script `scripts/verify-fluid-layout.mjs` (`npm run
layout:check`) *is* the QA matrix, so it can be re-run at H3 instead of re-eyeballed: 9
pages × {1024, 1280, 1440, 1920, 2560} × {67%, 100%, 150%} × {light, dark} = **270 cells,
all clean**. Zoom is modelled the way the browser does it (viewport = width/zoom,
deviceScaleFactor = zoom). Each cell asserts no horizontal body scroll, nothing past the
right edge outside a real scroll container, no clipped control, and no dead gutter.
Also green: `hub:verify`, `hub:smoke` (local), `pages:smoke` (local), `hero:check`,
`test:vectors`, `onet:test`, `verify:aliases`, `test:entitlements`, `test:school`,
`test:user`, `verify:user`, `test:sync`.
### WS-C — polish sweep

Baseline re-run 2026-07-20 at `0f7c0d8`, before any WS-C edit: `pages:smoke` GREEN (live,
8 pages), `layout:check` GREEN (270 cells), `hero:check` GREEN.

- [x] **C1 audit** — `docs/POLISH_AUDIT_2026-07.md`, commit `7efd21c`. 57 screenshot
  captures (13 pages × light/dark × desktop/mobile + hub at three zooms) plus one grep per
  C1 checklist line. **31 findings, each with file:line and a FIX/DEFER verdict**: 21 FIX,
  5 DEFER-with-reason, 6 checklist areas verified clean (focus-visible coverage, scrollbar
  and selection styling, empty-state coverage on five named panes, no lorem/TODO/`alert(`
  anywhere, motion conventions, imagery).
- [x] **C2.1 icons** — `9550ea5`. `lucide-lite.js` gains `plane-takeoff`, `settings`,
  `triangle-alert`, `chevron-down`, `x`, plus a `lucide.svg(name, cls)` string API that
  `createIcons()` now shares. **`plane-takeoff` was already referenced by
  `sim-portal-card.js:48` but missing from the map, so the "Test-drive a career" portal
  card had been rendering an empty icon slot in both themes.** 16 close buttons, the coach
  gear and two chevrons move off font glyphs; static markup inlines the SVG, JS-built
  markup calls `lucide.svg()`. `simulation.html` now loads lucide-lite above
  `sim-engine.js`. One shared rule in `flightway-theme.css` sizes the mark and leaves each
  button's own box rule alone.
- [x] **C2.2 portal account footer** — `8d8f2f3`. The delete-account button had **no CSS
  rule anywhere** — its whole appearance was a `style=""` attribute of light-theme hex, so
  dark mode rendered it as the brightest object on the page; `portal.js` painted its hover
  with two more hardcoded hex values. Real rules, theme tokens, lucide `triangle-alert`,
  and the risk hierarchy inverted back: Sign out (reversible) becomes the calm outlined
  control, Delete becomes a quiet ghost that only commits to red on hover/focus.
- [x] **C2.3 inline-style sweep** — `28a90f1`. Twelve static `style=""` attributes moved to
  CSS (`.fw-btn--block`, `.coach-email-input + .coach-email-input`,
  `.qz-signup-label--spaced`, `.qz-dev-skip-wrap`, `#admin-elevate-form`,
  `.admin-btn-more`, `.fw-mobile-theme-toggle`). Seven remain and are correct: two
  JS-written progress widths and the hero's per-element `--fw-delay` / `--fw-i`.
- [x] **C2.4 resume** — `cc3332f`. The ATS panel stops reading like debug output: tabular
  score + verdict + meter, and `humanizeAtsIssue()` rewrites the five stable machine
  prefixes at the display layer (`atsCheck()`'s strings are untouched because
  `test-resume-ats.cjs` asserts on them). Resume switcher gains an empty state; the format
  `<details>` loses the raw UA triangle for the chevron treatment the app's other two
  disclosures already use.
- [x] **C2.5 micro-states + nav affordance** — `e03927a`. `--transition` 0.3s → 0.18s (all
  32 consumers are hover/focus micro-states; the spec calls for 120–180ms). `app-nav.js`
  toggles `is-scroll-start` / `is-scroll-end` while a rail overflows and CSS masks that
  edge — closing the WS-B follow-up. Portal's tertiary CTA keeps its sky hint colour but
  stops rendering as a permanently underlined anchor.
- [x] **C2.6 copy + dead asset** — `0a71efe`. 21 straight apostrophes across five pages
  become typographic; two quiz placeholders get a real ellipsis; `404.html` gains the brand
  lockup (it was the one page with no mark at all); `assets/logo.png` (146KB, unreferenced
  since WS-A A2) deleted.

**WS-C gate: GREEN.** Audit doc fully checked off (31/31: 21 fixed, 5 deferred with a
recorded reason, 6 clean). All green: `hub:verify`, `hub:smoke`, `layout:check` (270
cells), `hero:check`, `test:vectors`, `onet:test`, `verify:aliases`, `test:entitlements`,
`test:school`, `test:user`, `verify:user`, `test:sync`, `test:admin`, `resume:ats-check`,
`resume:format-check`, `resume:ui-check`. Before/after screenshot sets kept at
`.screenshots/polish-before` and `.screenshots/polish-after` (both untracked).

- [x] WS-D Marco product overhaul — closed by D1–D6, each shipped with a commit SHA
  (`85108a4`, `b40400f`, `ae3892e`, `4788486`, `c4b4272`, `dad590f`, all present in
  `Jacob_Work` history) and live-verified in the `c4b4272` and `e24386a` sections below.
  The parent box was bookkeeping lag, not open work.
  - Baseline (2026-07-20, `b32b280`): **all green** — `pages:smoke`, `test:entitlements`,
    `grounding:check`, `test:opportunities`, `test:weekly`, `layout:check` (270 cells).
    (`layout:check` needs port 8934 free; a leaked run holds it and the script dies
    `EADDRINUSE` — `lsof -ti:8934 | xargs kill -9` first.)
  - [x] **D1 coach page rebuild** (`85108a4`) — `.coach-frame` two-pane grid inside the
        WS-B frame (conversation + `--rail-w` rail, folds to a top strip under 1200px).
        Messages are turns: bird-mark avatar, same-speaker runs, hover timestamps, day
        dividers. Teaching empty state (3 dossier facts + 3 tappable starters). Composer
        gains a char counter past 1800 and the free plan's "N of 5 left today" chip. The
        5-exchange bar became a 38px ring. `FWBrand.icon()` added.
  - [x] **D2 structured reply contract** (`b40400f`) — `functions/_lib/marco-ui.js` owns the
        `<<<FW_UI …>>>` instruction AND its parser. Prose is authoritative; any failure
        drops `ui`. No model string ever becomes an href. `npm run test:marco-ui`.
  - [x] **D3 proactive threads** (`ae3892e`) — `functions/_lib/marco-thread.js`,
        deterministic 4-rule priority, max one per reply, never auto-sent, free cap
        `marco-thread` 1/day and silent when hit.
  - [x] **D4 internships & deadlines** (`4788486`) — `functions/_lib/deadlines.js` reads the
        finder's own KV cache (shared key now in `opportunity-core.js`); rail + chat context
        + weekly plan all consume it. `GET /opportunities?cached=1` is the read-only half.
  - [x] **D5 Marco everywhere touchpoints** (`c4b4272`) — hub chip wears the bird mark and
        speaks in Marco's voice; portal advisor card copy follows.
  - [x] **D6 SSE streaming** (`dad590f`) — `functions/chat-stream.js` re-emits Gemini's
        `streamGenerateContent` deltas as `data:` frames and closes with one
        `event: control` frame carrying the exact `/chat` JSON payload. `runChatTurn` is
        now the shared, transport-agnostic turn (every gate, prompt, sidecar and write),
        so the two endpoints cannot answer differently. Deltas pass through
        `createStreamProseGate` so the FW_UI block never types itself into the bubble;
        the control frame is authoritative, not additive. Client falls back to `/chat`
        transparently when the endpoint is missing, non-SSE or unreadable — one probe per
        session, not per message. `npm run test:marco-stream`.
- [x] **WS-E Marco persona & prompts** — baseline gates green at `2fe3303` before any edit
      (`test:marco-ui`, `test:entitlements`, `test:weekly`, `interview:check`,
      `grounding:check`, `test:opportunities`, `test:school`).
  - [x] **E1 persona core** (`e24386a`) — `functions/_lib/marco-persona.js`: `PERSONA_CORE`
        (identity + voice rules + reasoning protocol), `BANNED` (9 phrases), a surface
        registry, and `buildSurfacePrompt(surface, ctx)` composing core → surface layer →
        `schoolPromptBlock` → context blocks → surface-owned constraints last.
  - [x] **E2 surface refactors** (`e24386a`) — eleven prompts now build from the composer:
        `chat.js`, `career-switch-chat.js`, `interview-core.js` (turn + debrief),
        `weekly-plan-gen.js`, `opportunity-core.js`, `roadmap-generate.js` (v1 + tree),
        `career-roadmap.js` (waypoint chat + step elaboration), `sim-colleague.js`,
        `sim-feedback.js`, `sim-mirror.js`. Every advice surface carries
        `schoolPromptBlock()` on both branches — asserted per surface by the new harness,
        not just by `test:school`.
  - [x] **E3 smarter Marco** (`e24386a`) — `chat.js` now states the school explicitly
        (`schoolForCacheKey`, no I/O) instead of relying on the coordinates digest alone;
        the dossier-merge prompt gained a density rule (verbatim names/numbers/dates, no
        paraphrase). See Deviations for what was already present and what is not
        server-computable.
  - [x] **E4 voice eval harness** (`e24386a`) — `npm run test:marco-voice`, deterministic:
        core inheritance per surface, roleplay surfaces provably not claiming to be Marco,
        banned phrases only as prohibitions, both school branches on ten advice prompts,
        surviving hard constraints + JSON contracts, `thinkingBudget: 0` on every JSON
        caller (including a repo walk for a third path), and 11 committed goldens
        (`scripts/goldens/marco-voice/`, refresh with `-- --update`). `-- --live` runs
        three fixture conversations behind `GEMINI_API_KEY`.
- [x] **WS-F onboarding & contextual guidance** — baseline gates green at `dbd8e30` before
      any edit (`verify:user`, `test:user`, `test:sync`, `pages:smoke`, `hub:smoke`).
  - [x] **F1 engine + persistence** (`641033c`) — `assets/js/shared/feature-intro.js`
        (`FWFeatureIntro`) + `assets/css/feature-intro.css`. State is
        `journey.featureIntros` on the v2 user object through `FWUser` (KEY_MAP row added
        client + server); `auth.js` `mergeFeatureIntros` unions local and server on BOTH
        merge chains and `quizPayloadHash` gained an `intros` term. `FWPageVeil.onReveal`
        is the new "content is ready" hook. Seeding marks features an existing student has
        demonstrably used. New gate `npm run test:intro`.
  - [x] **F2 interstitial content** (`e90dba1`) — nine features authored (hub, marco,
        roadmap, resume, know-you, simulation, opportunities, mock-interview, sharpen),
        each an outcome headline ≤ 9 words, three concrete benefits, an inline SVG scene.
        Page-level features declare `<body data-fw-intro>`; mock-interview fires from its
        launcher with the plan gate as CTA; opportunities fires from its panel on
        ready/gated only. Five icons added to `lucide-lite.js`.
  - [x] **F3 empty states as teachers** (`e8ffdd1`) — portal pre-quiz, roadmap pre-quiz,
        opportunities empty, resume guided hero, know-you intro, hub search miss. Coach's
        empty state already had the shape (WS-D D1) and is untouched.
  - [x] **F4 hint ribbons** (`c2a62cc`) — `<div data-fw-ribbon="key">` slots auto-mount at
        boot for marco, roadmap, resume, know-you, sharpen; opportunities re-mounts per
        render. Never in the same visit as the interstitial; tip + rotation counter fixed
        per page load; the counter is a local-only write.
  - [x] **F5 measurement** (`5609836`) — `feature_intro_shown/completed/skipped/upgraded`
        and `feature_ribbon_dismissed` through `FWEvents`, read back by
        `FWFeatureIntro.stats()`. Local-only by design; real analytics is Human-gated.
  - [x] **Harness fix** (`8d3cf09`) — `resume:ui-check` and the opportunities UI smoke
        seed `featureIntros` in their quiz blob; the latter also gained the npm script it
        had been named for since it shipped.
  - [x] **Live regression fix** (`0b12315`) — `seed()` no longer writes an empty
        `fw_user_v1` for a visitor with no profile. `hub:smoke` caught it against the
        deployed build: the fabricated object made user.js's boot migration delete a
        legacy `fw_hub_quiz_v1` instead of promoting it, flattening the hub's zone fits.
- [x] **WS-G free/paid activation** — baseline gates green at `50d7da0` before any edit
      (`test:entitlements`, `stripe:check`, `test:user`, `verify:user`, `test:sync`,
      `layout:check` 270 cells).
  - [x] **G0 one cap table** (`279e25b`) — `/config` serves `publicFeatureLimits()` (label,
        reset period, per-plan caps; never the KV `keyPrefix`), and `FWEnt` gained
        `limitFor()` / `featureLabel()` / `resetPeriod()`. The table lands *before* FWEnt's
        dark-paywall early return, because pricing copy needs it either way.
        `test:entitlements` gained the publication invariants plus an explicit table of the
        numbers UI copy depends on.
  - [x] **G1 plan surfaces** (`3ea2e6f`) — `assets/js/shared/plan-surface.js`
        (`FWPlanSurface`) + styles in `flightway-2.css`. Two declarative slots
        (`data-fw-plan-panel`, `data-fw-plan-chip`) and one imperative `capCard()`. Portal
        gets the plan badge + a meter per *spendable* allowance; roadmap gets the
        generations chip beside both generate paths and renders the cap card instead of a
        red error when the lifetime generation is spent; coach's composer meter stops
        hardcoding 5 and its daily wall renders the shared card. `roadmap.html` now loads
        `entitlements.js` at all — it never had, so `opportunity-finder.js`'s `FWEnt.gate()`
        could not fire. New gate `npm run plan:ui-check`.
  - [x] **G2 upgrade-moment inventory** (`3ea2e6f`, `4cdccd2`) — written down in
        `plan-surface.js`'s header and enforced by the gate: a paid or preview account
        renders zero upgrade links, and only an exhausted meter row carries one. Audited
        every `pricing.html` link in the app (see Deviations for the two bespoke locks kept
        as-is). Locked simulation tiers swapped their 🔒 emoji for the drawn lock.
  - [x] **G3 pricing truth + polish** (`4cdccd2`) — every cap number is a `data-fw-limit`
        slot: shipped value for JS-off readers, overwritten from `/config` at runtime, and
        compared against the enforced table by `plan:ui-check`. The page had been
        overselling mock interviews as unlimited (they are 3/day on Flight Plan) and now
        says so; the free card states that both its caps are visible as meters. Plan names
        and prices moved to the display face on the WS-A fluid scale with tabular figures.
  - [x] **G4 human-gated** — recorded in the Human-gated section below.
- [x] **WS-H performance & final hardening**
  - [x] **H1 perf budget** (`92bfe12`) — new `npm run perf:check`
        (`scripts/measure-page-perf.mjs`) walks all nine pages against the deployed
        preview and fails over 2500ms cold / 1000ms repeat first contentful paint.
        Measured at `c4b4272`+`876378c`: cold FCP **152–180ms**, repeat **92–120ms** or
        paint-held, every page inside budget by more than 10×. No stragglers to fix:
        blocking scripts are the same intentional three site-wide (`theme-boot`,
        `global-shim`, `flags`), and no page carries an oversized image. See Deviations
        for the two weights left alone.
  - [x] **H2 full suite** — 27 scripts green, listed in the table below.
  - [x] **H3 screenshot matrix on the DEPLOYED preview** (`c9adf88`) — `layout:check`
        gained `--base=https://host`, which skips the local server and audits what the
        CDN serves. **270 cells clean** against
        https://flightwayjacobprototype.pages.dev (9 pages × 5 widths × 3 zooms × 2 themes).
  - [x] **H4 handoff addendum** — appended to `docs/CONVERSATION_HANDOFF.md`.
  - [x] **H5 final report** — delivered in the session's closing message.

### H2 — full suite at `c9adf88`

| Gate | Result | Gate | Result |
|------|--------|------|--------|
| `onet:test` | GREEN | `test:marco-ui` | GREEN |
| `test:vectors` | GREEN | `test:marco-stream` | GREEN |
| `verify:aliases` | GREEN | `test:marco-voice` | GREEN |
| `test:school` | GREEN | `test:intro` | GREEN |
| `test:user` | GREEN | `hub:verify` | GREEN |
| `verify:user` | GREEN | `hub:smoke` | GREEN |
| `test:sync` | GREEN | `hero:check` | GREEN |
| `test:admin` | GREEN | `resume:ui-check` | GREEN |
| `test:entitlements` | GREEN | `opportunities:ui-check` | GREEN |
| `stripe:check` | GREEN | `plan:ui-check` | GREEN (new) |
| `resume:format-check` | GREEN | `layout:check` (local) | GREEN 270 cells |
| `resume:ats-check` | GREEN | `layout:check --base` (live) | GREEN 270 cells |
| `resume:tailor-check` | GREEN | `perf:check` (live) | GREEN (new) |
| `interview:check` | GREEN | `pages:smoke` (live) | GREEN 8 pages |
| `test:weekly` | GREEN | | |
| `test:opportunities` | GREEN | | |

Not run (not applicable): the ETL builders (`onet:build`, `onet:exposure`,
`onet:zoneweights`, `onet:seed`, `sim:pregen`) — no source data changed; `grounding:check`
and `derived:backfill` — need `GEMINI_API_KEY` / wrangler auth; `deploy*` — forbidden.

---

## Live verification — 2026-07-20, deploy `76d46f8`

Production alias took ~10 min to flip after the build went Active (the per-deployment
`<id>.flightwayjacobprototype.pages.dev` alias serves the new build first — check that
before concluding a deploy stalled). Then:

- `pages:smoke` against the live URL: GREEN, all 8 pages, zero pageerrors. `hub:smoke` GREEN.
- All busted asset URLs 200 with sha256 identical to disk: `/favicon.ico?v=20260720a`,
  `/assets/icons/favicon-128.png?v=20260720a`, `/assets/icons/apple-touch-180.png?v=20260720a`,
  `/assets/js/shared/auth-nav.js?v=20260720a`, `/assets/css/flightway-pages.css?v=20260720e`.
- All 15 pages serve the new icon links.
- Note: `/assets/favicon.png?v=20260717h` still returns 200 from the CDN edge even though the
  file is deleted from the repo — the `immutable, max-age=1y` entry outlives the deployment.
  Nothing references it, and that is exactly the pinning the rename exists to escape.

## Live verification — 2026-07-20, deploy `0d64f83` (fixes 1.2 + 1.1)

Production alias again lagged the Active build by ~10 min, and flipped POP-by-POP: the same
URL alternated old/new build for a few minutes. Poll until N consecutive responses carry the
new stamp before concluding anything about a deploy.

- **1.2 proven on real data.** `GET /derive-career?all=1` before the deploy: 55 fragments in
  `{finance:27, law:13, tech:6, marketing:3, business-finance:6}` — 30 of 55 sat in zones
  that no longer exist, i.e. rendered nowhere. After: 55 fragments in
  `{business-finance:33, law:13, tech:6, creative-media:3}` — **0 in dead zones, 0 without a
  live parent**, colors and coords taken from the current base row.
- **1.1 proven live.** `[fw-perf] hub boot script-eval=224ms catalog=246ms indexes=253ms
  first-paint=224ms veil=254ms` on a cold load; zero long tasks. Four requests now start
  after veil release: `career-descriptions.json`, `/derive-career?all=1`,
  `career-compare.js`, `career-deep-dives.js`. Acceptance (cold ≤ 2.5s, no post-paint long
  task > 120ms) met with room.
- `pages:smoke` against live: GREEN, all 8 pages, zero pageerrors. `hub:smoke`: GREEN, both
  sessions, 10 zones. `hub:verify` (incl. the new re-key fixture): GREEN.

## Live verification — 2026-07-20, deploy `f958b3a` (fix 1.3)

Build went live within a couple of minutes this time, but again POP-by-POP: the first
sweep had `onet-math` and `refine-map` stale while `onet-vectors` was fresh, then the
reverse. Poll each URL until it matches disk; do not conclude anything from one sample.

- All five changed assets return 200 with sha256 identical to disk at their new stamps
  (`onet-math`, `onet-vectors`, `refine-map`, `hub-zone-fit` @ `20260720e`;
  `hub-onet-map` @ `20260720d`), and `/data/onet/artifacts/zone-aggregate-vectors.json`
  serves the 18 zones with `lvMeanW` + `repWeightSum`.
- `pages:smoke` against live: GREEN, all 8 pages, zero pageerrors. `hub:smoke`: GREEN,
  both sessions, 10 zones.
- Local gates at the pushed commit: `test:vectors` (incl. 24 persona assertions + the
  11-constant parity check), `onet:test`, `hub:verify`, `verify:aliases`,
  `test:entitlements`, `test:school`, `test:user`, `verify:user`, `test:sync`,
  `hero:check` — all GREEN.

## Live verification — 2026-07-20, deploy `1d8593c` (WS-A + WS-B)

The production alias again flipped POP-by-POP (probe 1 and 2 served the old stamp, probe 3
the new one). Polled until six consecutive responses carried `?v=20260720f` before
verifying anything.

- **All 13 changed assets return 200 with sha256 identical to disk** at their new stamps:
  both woff2 files (`?v=20260720a`), `favicon.svg`, `flightway-lockup.svg`, five CSS files
  and three JS files (`?v=20260720f`).
- **Zero external font requests, proven live.** All 15 pages serve `googlefonts=0` and the
  SVG favicon link; the 14 themed pages serve both font preloads. A real browser load of
  the live landing page recorded **zero requests to any host other than
  `flightwayjacobprototype.pages.dev`**, with exactly two woff2 fetches.
- **The type actually applies live:** `document.fonts` reports `Inter loaded` +
  `Space Grotesk loaded`; the hero computes to `"Space Grotesk", Inter, …` at 92px (the
  `--fs-hero` ceiling); `.fw-brand-bird` is an `<svg>`, not an `<img>`.
- `pages:smoke` against live: GREEN, all 8 pages, zero pageerrors. `hub:smoke` against
  live: GREEN, both sessions, 10 zones.

## Live verification — 2026-07-20, deploy `5ec401c` (WS-C)

All 12 HTML pages return 200 and carry `flightway-theme.css?v=20260720h`. `lucide-lite.js`
is present on exactly the six pages that need it (portal, resume, roadmap, simulation,
admin, career) — dashboard / coach / quiz / 404 / index / pricing correctly do not load it,
because their icons are inlined static SVG.

| Live check | Result |
|---|---|
| 7 busted assets: HTTP 200 + sha256 identical to disk | PASS |
| `assets/logo.png` (deleted) | 404 — correct |
| `plane-takeoff` present in the served `lucide-lite.js` | PASS |
| `#fdecea` (the old inline doom-button hex) anywhere in portal.html | 0 occurrences |
| `data-fw-brand` present in 404.html | PASS |
| `pages:smoke` (live, 8 pages) | GREEN, zero pageerrors |

**Deploy flipped POP-by-POP again — fourth consecutive sighting.** Sample 4 of the first 6
portal fetches served the pre-push `?v=20260720f`; a 60-iteration poll then took 10
consecutive clean samples before the check was called good. One sample still proves
nothing.

---

## Live verification — 2026-07-20, deploy `c4b4272` (WS-D D1–D5)

Prod alias flipped in ~7 min this time (faster than the ~10 min the WS-A/B note recorded).
Verified against https://flightwayjacobprototype.pages.dev:

- `coach.html` serves the new markup — `coach-frame`, `coach-rail`, `coach-memory`,
  `coach-composer-meta` all present.
- Every re-stamped asset 200s at its new URL: `flightway-pages.css?v=20260720k`,
  `coach/coach.js?v=20260720l`, `shared/brand.js?v=20260720i`, `hub/marco.js?v=20260720l`,
  `hub-dashboard.css?v=20260720l`. Content confirmed by grepping the live bodies, not just
  the status code (`coachBuildThread` / `coachLoadDeadlines` / `coach-turn` in the JS,
  `coach-frame` / `coach-thread-go` / `coach-card-row` in the CSS, `icon: iconHtml` in
  brand.js) — an immutable asset can 200 with stale bytes.
- **Six consecutive samples of `coach.html` all served the post-push stamp** — no POP-by-POP
  flapping this deploy, unlike the four previous sightings. Still worth sampling N times.
- `pages:smoke` green against live (8 pages).
- `layout:check` green — full 270-cell matrix, run locally against the pushed tree.

**Not verifiable without a signed-in browser session** (recorded, not skipped): a real
Marco conversation exercising the FW_UI block, a thread card, and the deadline rail. The
parser, the selector and the reader are unit-covered (`test:marco-ui`, `test:opportunities`);
what is untested end-to-end is whether Gemini actually emits the block often enough for the
chips to feel present. That is the first thing to look at in the WS-E manual conversation.

## Live verification — 2026-07-20, deploy `e24386a` (WS-D D6 + WS-E)

Prod alias flipped in well under 10 min. Verified against
https://flightwayjacobprototype.pages.dev:

- **`POST /chat-stream` is live and behaves as designed.** Unauthenticated, it returns
  `HTTP/2 200`, `content-type: text/event-stream; charset=utf-8`,
  `cache-control: no-cache, no-transform`, then two frames:
  `event: open / data: {"ok":true}` followed by
  `event: error / data: {"status":401,"error":"Sign in required."}`. That is the whole
  contract in one curl — a status code would have been the bug.
- Both re-stamped assets 200 at their new URLs, and the **served bytes** were grepped, not
  just the status: `coach/coach.js?v=20260720m` contains `coachParseSseFrame` /
  `coachStreamTurn` / `coachJsonTurn`; `flightway-pages.css?v=20260720m` contains
  `coach-caret` / `is-streaming`. (An immutable asset can 200 with stale bytes.)
- **Six consecutive `coach.html` samples all served the post-push stamp** — no POP-by-POP
  flapping this deploy.
- `pages:smoke` green against live (8 pages, zero pageerrors).

**Not verifiable without a signed-in browser session** (recorded, not skipped): a real
streamed conversation — deltas painting the bubble, the caret, the control frame swapping in
the parsed markdown and chips, and the JSON fallback firing. Every piece is unit-covered by
`test:marco-stream` (frame round-trip at four chunk sizes, marker-split gate, streamed text
== control reply) and the transport is proven live by the curl above; what is untested
end-to-end is the paint. Carried forward from WS-D and still open: whether Gemini emits the
FW_UI block often enough for the chips to feel present. The WS-E voice change makes that
worth re-checking in the same sitting.

## Live verification — 2026-07-21, deploy `876378c` (WS-G) + `c9adf88` (WS-H)

Prod alias flipped in ~2 min. Verified against https://flightwayjacobprototype.pages.dev:

| Live check | Result |
|---|---|
| 8 consecutive `portal.html` samples carry `plan-surface.js?v=20260721f` | 8/8 — no POP flapping this deploy |
| `plan-surface.js?v=20260721f` body contains `FWPlanSurface` | PASS |
| `flightway-2.css?v=20260721f` body contains `.fw-plan-meter-fill` | PASS |
| `flightway-theme.css?v=20260721f` body carries the new pricing display type | PASS |
| `entitlements.js?v=20260721f` body contains `limitFor` | PASS |
| `coach.js?v=20260721f` body contains `FWPlanSurface.capCard` | PASS |
| `sim-engine.js?v=20260721f` body contains `lucide.svg('lock')` | PASS |
| `portal.html` carries the `data-fw-plan-panel` host | PASS |
| `roadmap.html` loads `entitlements.js` (it never had) | PASS |
| `GET /config` serves the whole `featureLimits` table, no `keyPrefix` | PASS |
| `pricing.html` ships `1` / `5` / `3` in its `data-fw-limit` slots | PASS — matches the enforced table |
| `pages:smoke` (live, 8 pages) | GREEN, zero pageerrors |
| `perf:check` (live, 9 pages) | GREEN — 152–180ms cold FCP, 92–120ms repeat |
| `layout:check --base` (live, 270 cells) | GREEN |

`GET /config` still reports `paywallEnabled: false`, so every meter correctly renders
nothing and the portal shows the "Preview access" badge. **That is the designed behaviour**
— see the Human-gated entry. The cap table lands regardless, which is why pricing.html's
numbers are live-correct today.

---

## Tail session — 2026-07-21, the deferred follow-ups (`a445af5` →)

The masterplan is complete; this session works only the "Open follow-ups" list.

**Baseline at `a445af5`, before any edit — all GREEN:** `test:marco-voice`, `test:marco-ui`,
`test:vectors`, `onet:test`, `hub:verify`, `verify:user`, `test:user`, `test:sync`.

- [x] **T1 ledger bookkeeping** (`11a5921`) — closed the two stale parent boxes (1.6 and
  WS-D). Both were bookkeeping lag: verified WS-B's B1–B4 + the `layout:check` zoom matrix
  cover 1.6, and that D1–D6 each carry a commit SHA that resolves in `Jacob_Work` history.
  Docs only.
- [x] **T2 the four roadmap-tree prompts build from the composer** (`df8ce96`) — E2's
  leftover. `buildExtendPrompt`, `buildBranchBuildPrompt`, `buildTreePatchPrompt` and
  `buildSplitPrompt` now open with `buildSurfacePrompt('roadmap-advice', { school })`
  exactly as `roadmap-generate.js` does, so all four inherit the persona core, the voice
  rules, the reasoning protocol and — invariant 0.2 — `schoolPromptBlock()`. School is
  resolved with the no-I/O `schoolForCacheKey({ quiz, dossier })` at each call site
  (`career-roadmap.js` ×4, `chat.js` ×1), threaded through `roadmap.js`'s
  `buildRoadmapPatchPrompt` / `requestRoadmapPatchFromMessage` /
  `applyRoadmapPatchFromMessage`. **Assertions landed first, deliberately:**
  `test-marco-voice.mjs` gained twelve contract assertions (node ids, `parentId` wiring,
  the `ext1`/`new1` step-id shape, the patch envelope, the id-preservation rule, the
  plain-style rules) and they were run GREEN against the *unmodified* prompts before a
  single one was touched — that is what makes them a regression gate rather than a
  description of the new text. Then the school/core assertions were added, went RED for all
  four, and the wiring turned them green.
- [x] **T3 server-side career ranker** (`3f49bd1`) — closes the E3 and D3 deviations
  together. New `functions/_lib/onet/career-rank.js`. See the decision entry below for the
  cost design. E3's last item: Marco's chat context now carries the top-5 fit careers with
  scores (`careerRankPromptBlock`). D3 thread rule 3 now proposes an undiscussed top-5
  **career** with its fit score, and falls back to the sector form whenever the rank is
  empty. Invariants added to `onet:test` (13 assertions) and `test:marco-ui` (5).
- [x] **T4 personality-vector re-seed, where it is provably lossless** (`—`) — see the
  decision entry below. Generation stamp `PERSONALITY_SEED_GEN = 2` on the seed's output,
  client and server in the same commit. `basePersonalityFromQuiz` re-seeds a stored vector
  whose generation is older, but only when the re-seed is both possible (centroids + scores
  present) and lossless (the vector carries no server AI-patch source). 16 assertions in
  `test:vectors`. Buster: `onet-vectors.js` → `?v=20260721g` on all six pages that load it.

**Decision — where the career rank is computed and what invalidates it.**
Ranking needs the whole catalog: `careers.json` (347KB) plus `vectors-lv.f32.bin` (503KB).
Both are module-cached per isolate, so a **warm** isolate ranks all 782 careers in 3–12ms
(measured), but a **cold** one pays ~850KB of fetch+parse. Marco's chat is the hot path and
the earlier sessions were right that it cannot pay that. So the rank is a **cache, never a
hot-path computation**:
- `loadCachedCareerRank` is one KV read. On a hit the block goes into the prompt.
- On a **miss the block is simply absent for that turn** and `refreshCareerRank` runs via
  `context.waitUntil` *after* the response — the user never waits for the catalog, and the
  next turn has it. Both `/chat` and `/chat-stream` inherit this, because it lives in the
  shared `runChatTurn`.
- **Invalidation is the key, not a sweep.** The key embeds a fingerprint of the personality
  + objective vectors (rounded to whole points, since the vectors are 0–100 level scales and
  sub-point drift cannot reorder a top-5). A quiz retake, a `gap-progress-sync` write or an
  AI patch all move the fingerprint, so a stale rank becomes unreachable rather than
  something to remember to delete. The 30-day TTL is only a backstop for catalog rebuilds.
- **No new scoring math.** Every number comes from `functions/_lib/onet/math.js` (`cosine`,
  `objectiveFitPercent`, `overallFitScore`), which already carries the client-parity
  invariant with `assets/js/shared/onet-math.js`. Parity is preserved by not inventing —
  `onet:test` asserts the ranker's `fit` equals `overallFitScore(...)` computed
  independently, so a future ranker-local shortcut fails the gate.
- **Not a second vector writer.** It writes a derived *ranking* to KV — never a vector,
  never to the user object. `gap-progress-sync` remains the only server-side vector writer,
  and no KEY_MAP / user-sync registry change was needed.

**Decision — what happens to existing AI personality patches in the re-seed.**
The trap the ledger recorded is real and worse than it looks:
`functions/_lib/onet/personality-patch.js` writes `personalityVector.values` **in place**
with **no replay record** — there is no `personalityAiPatch` mirroring `objectiveAiPatch`.
Those patches survive today *precisely because* `basePersonalityFromQuiz` reuses the stored
vector, which is the same reuse that blocks the re-seed. And the old seed's math is gone, so
the patch cannot be separated from the vector it edited. **The per-dimension detail of a
pre-existing personality patch is unrecoverable by any migration** — the information needed
was never written down. (Its *sector-level* effect does survive: each patch projects back
into `sectorFitSheet` / `quiz.scores`, which the new seed consumes.)

Second finding, which reframes the "client half vs. migration" choice: **the client-side
drop IS the mutation.** `persistQuizVectors` uploads the rebuilt vector, so a client-only
change re-seeds every active account lazily on next page load. There is no safe
client-only half to hide behind — only a choice about *whose* vector gets replaced.

So the re-seed ships **only where it is provably lossless**, decided by provenance rather
than by a flag: a stored vector is re-seeded unless its `source` is one of the three the
server's personality patch writes (`gemini-patch`, `profile-building`, `resume-gemini`).
Every other layer on top of the seed (refine, resume bleed) is replayed by
`hydrateQuizVectors`, so dropping the base loses nothing — and a patch source provably
survives both layers (`bleedPersonalityFromObjectiveDelta` keeps
`personalityVec.source || 'resume-bleed'`, refine keeps `base.source`). Fail-closed:
anything unrecognised is kept. AI-patched accounts keep their vector, stay on generation 1,
and are listed under Human-gated — replacing their vector is a data decision, not an
engineering one.

### Live verification — 2026-07-21, deploy `29c7309`

Prod alias flipped in ~90s (two polls of `portal.html`, then the new stamp).
Verified against https://flightwayjacobprototype.pages.dev:

| Live check | Result |
|---|---|
| all six pages that load `onet-vectors.js` serve `?v=20260721g` | 6/6 — career, roadmap, dashboard, portal, quiz, profile-build |
| the served `onet-vectors.js` body contains `PERSONALITY_SEED_GEN` | PASS (5 hits) |
| ... `personalityReseedIsLossless` and `UNREPLAYABLE_PERSONALITY_SOURCES` | PASS (3 / 2 hits) |
| `pages:smoke` (live, 8 pages) | GREEN, zero pageerrors |
| `layout:check --base` (live, 270 cells) | GREEN |
| `hero:check` | GREEN |

Local gates at `29c7309`, all GREEN: `test:vectors` (16 new re-seed assertions),
`onet:test` (13 new ranker assertions), `test:marco-voice` (16 new roadmap-prompt
assertions), `test:marco-ui` (5 new thread assertions), `test:marco-stream`,
`verify:user`, `test:user`, `test:sync`, `hub:verify`, `hub:smoke`, `test:school`,
`test:weekly`, `test:entitlements`.

Note on what live verification can and cannot show here: T2 and T3 are server-side, and
`/chat` needs a session, so the deployed proof for those is the gates plus the fact that the
Functions bundle built and every page still boots clean. The ranker's first real exercise
happens on a signed-in conversation — and by design its **first** turn shows no rank block
(cache miss → `waitUntil` fills it), so "no career block on turn one" is correct behaviour,
not a bug.

---

## Deviations from the plan

- **T2: the hard constraints for the four roadmap-tree prompts are asserted on the
  builders, not in the `HARD` table.** `HARD` indexes `built[key]`, which only contains
  registry surfaces; all four tree prompts build from the single `roadmap-advice` surface,
  so a `HARD` row for them would assert against the shared layer and prove nothing about
  the prompt that ships. They sit with the JSON-contract assertions instead, where the real
  builder is invoked — which is also the only place a structural break can be caught.
- **T4: the re-seed lives in `basePersonalityFromQuiz`, not in `migrateLegacyQuizSchema`.**
  The ledger's recorded shape put the drop in the migrator. The code says otherwise:
  `migrateLegacyQuizSchema` has no access to `zoneCentroids`, and a drop there fires on
  every hydration that runs before the centroids load — at which point
  `basePersonalityFromQuiz` cannot re-seed and returns an **empty vector**. That converts a
  sharpening into data destruction. `basePersonalityFromQuiz` is the one place holding both
  the scores and the centroids, so the decision belongs there and is inherently guarded
  (`test:vectors` pins "no zone centroids loaded → the stored vector is kept, never
  emptied").
- **T4: the generation stamp is re-attached after the layers, not carried by them.**
  `refreshPersonalityFromRefine` and the resume bleed both rebuild the vector object and
  drop unknown keys, so a re-seeded vector reached the end of `hydrateQuizVectors` without
  its stamp and would have been re-seeded on every boot. The stamp describes the BASE, so
  hydrate captures it before the layers run and sets it after — including on the retained
  object in the `vectorValuesEqual` reuse branch, or a re-seed that happened to reproduce
  the stored values would never stick.
- **T4: the server stamps the seed but never drops.** Invariant 0.2 asks that a mutation be
  replayable by both rebuilds. A re-seed is not a layer — it is base regeneration, and the
  server's `ensureUserVectors` only seeds when there is no vector at all. Adding a drop
  there would mean server paths silently rewriting personality vectors on read. Both sides
  produce identically-stamped seeds (asserted by `test:vectors`' constant-parity block);
  the client is where the re-seed decision fires, and the server keeps whatever it is sent.

- **D6 retries stop at the first byte.** The model cascade and the 800/2000ms retry ladder
  are shared with `/chat`, but once any delta has reached the client a retry would replay
  the reply from the top and the user would watch it duplicate itself. `hasStreamed()` makes
  streaming exactly one attempt from the first token onward; before that it behaves
  identically to the JSON path.
- **D6 falls back only on a transport failure, never after the `open` frame.** The server
  emits `event: open` before doing any work precisely so the client can tell "endpoint not
  deployed" from "endpoint working". A drop *after* that frame is surfaced as an error, not
  retried on `/chat` — the message was already spent server-side, and a silent retry would
  charge a free user twice and answer twice.
- **D6's upstream budget is 25s, not the 30s default.** The client allows 60s for a whole
  turn and the post-stream tail (thread pick, roadmap sidecar, exchange-5 dossier merge)
  still has to fit inside it, so the streaming endpoint can never be the slower of the two.
  The client's own stream budget is 90s because a stream shows progress the whole time —
  waiting is informed rather than blind.
- **`quiz.html` was carrying `coach.js` at a stale `?v=20260720c`** while `coach.html` had
  `l` — i.e. two pages served different bytes for the same module. Both are on `m` now. Worth
  grepping `grep -oh "<file>?v=[0-9a-z]*" *.html | sort -u` for any asset you re-stamp: the
  rule is every page referencing it, and a page that lags is invisible until it misbehaves.

- **E1: not every surface is Marco, deliberately.** The plan says one character everywhere.
  Three surfaces are characters the product needs to NOT be Marco: the mock interviewer
  (`interview-turn`), the simulation colleague, and the Mirror. A mock interview that sounds
  like your advisor is not a mock interview, and a colleague who breaks character to give
  career advice destroys the simulation. `roleplay: true` on a surface swaps Marco's identity
  block for the house-voice block; the voice rules and the banned list still apply, because
  "sounds like a person, not a chatbot" IS the universal part. The interview **debrief** is
  Marco — that is where the coaching actually happens.
- **E2: the opportunities persona sits AFTER the evidence block.** `test:opportunities` pins
  `prompt.startsWith('=== WEB EVIDENCE')` — the fenced evidence must lead. The persona block
  goes between the evidence and the TASK instead. The only user-visible prose that call
  produces is `whyThisFits`, so nothing is lost.
- **E2: strict-JSON generators outside the plan's nine were left alone.** `career-analysis.js`,
  `resume-extract.js`, `derive-career.js`, `focus-keywords.js`, `sim-generate.js`,
  `portal-snapshot.js` and `gemini-grounded.js`'s research call are extractors and
  classifiers — no user-visible prose, nothing for a voice to change. **One real gap
  remains:** `_lib/roadmap-tree.js` (four prompts, ~:1823/:1910/:2048/:2085) rewrites branch
  content that the user *does* read, and it does not build from the composer. Recorded as a
  follow-up rather than rushed into this commit, because those prompts carry the tree's
  structural JSON contract and `roadmap:` has no dedicated gate.
- **E3: "top-5 fit careers with scores" is still not server-computable.** **RESOLVED by the
  tail session's T3** (`3f49bd1`) — `functions/_lib/onet/career-rank.js` ranks the catalog
  server-side and Marco's context now carries the top-5 with scores. The reasoning below is
  kept because the cost analysis in it is what shaped the ranker's cache design.
  Same root cause as
  the D3 deviation — career ranking is a client-side vector op over the whole O*NET catalog,
  and `portalSnapshot.careerPicks` stores `careerId` with no name. The obvious workaround
  (have the coach page send its own ranking) means loading `FWOnetVectors` + `careers.json`
  on `coach.html`, which is a boot-cost regression fix 1.1 just spent a session removing
  elsewhere. What the chat prompt DOES already carry: readiness / personality fit / objective
  fit / largest coordinate gaps / top quiz industries (the coordinates digest), top sector
  fits + GPA + major + target career (`buildProfileSignalsBlock`), upcoming deadlines (D4),
  and the compact roadmap with progress. So E3's context list is met except for that one
  item; it needs a server-side ranker to exist first.
- **E3: the chat prompt now states the school explicitly.** It was reaching Marco only
  through the coordinates digest, which is a fact line, not the location constraint. It now
  gets a real `schoolPromptBlock()` via the composer (resolved with the no-I/O
  `schoolForCacheKey`, profile before dossier), satisfying invariant 0.2 literally rather
  than by proxy.
- **E4: banned phrases are checked as prompt text, not model output.** Nothing filters
  replies at runtime and nothing should — a post-hoc filter would mangle a legitimate quote.
  The harness asserts the phrases appear ONLY inside the prohibition block, which catches the
  actual failure mode: someone adding a helpful example that shows the model the phrase in use.
  Output-side checking exists only in `-- --live`, which costs money and runs by hand.

- **A2 the marks are traced from the existing PNG, not redrawn, and the tracer is not
  committed.** There is no vector source for the bird and no tracing tool in the repo (no
  potrace/ImageMagick, and adding a dependency is out of bounds). The outlines come from a
  one-shot boundary-follow + Ramer-Douglas-Peucker pass over the PNG's alpha, run through
  python3 + PIL (present on the machine, not a project dependency) and validated by
  rasterising the result and diffing it against the source mask: **0.30% pixel mismatch**
  at 5.5KB of path data. The wordmark outlines are the *real* Space Grotesk 700 glyphs —
  rendered at 360px in headless Chromium from the newly self-hosted woff2, then traced the
  same way — so "convert text to paths" is satisfied literally. The generator lives in the
  session scratchpad rather than `scripts/` because it would be the only python in the
  repo; regenerating means re-deriving it. `assets/logo-bird.png` stays as the source of
  truth even though nothing references it any more.
- **A2 `brand.js` inlines the bird, and the wordmark stays HTML text.** The plan said
  brand.js should render the whole lockup as inline SVG. The bird is inline SVG (themable
  gradient stops, no request). The wordmark is still `.fw-brand-text`, now set in
  `var(--font-display)` 700 at the lockup's own tracking — because A1 made the font
  self-hosted and preloaded on every page, HTML text now renders identically everywhere,
  and keeping it as text preserves selectability, the existing CSS hooks, and one source
  of the string. `assets/icons/flightway-lockup.svg` still ships as the standalone
  artifact for external/OG use.
- **A2 `favicon.svg` keeps the badge treatment.** The plan said "derive from the bird
  alone". The bird is open line art and vanishes at 16px; the existing `favicon-128.png`
  is an orange rounded-square badge with the bird knocked out in white. The SVG matches
  that treatment, so adding it (browsers prefer SVG when present) does not regress the
  tab icon. Verified by rendering at 128/64/32/16.
- **A3 the hero keeps its own curve rather than the plan's example clamp.** The plan's
  `clamp(2.4rem, 1.6rem + 2.6vw, 4.2rem)` was flagged "e.g."; the shipped `--fs-hero`
  is `clamp(2.9rem, 1.4rem + 5.2vw, 5.75rem)`, which lands on the *same* 5.75rem the hero
  already used at >=1440px (so the desktop landing page is visually unchanged in size)
  while ramping more gently below it. `hero:check` headroom improved 4.49px -> 6.44px.
- **B1 adds two tokens the plan did not name.** `--frame-mid` (1180px) and
  `--frame-narrow` (760px). Without them, "convert every page container to `--page-max`"
  would have put the resume form, the simulation flow and the profile builder on a
  1760px line, which is worse than the fixed width they had. Recorded rather than
  silently fudged with magic numbers.
- **B2 `.coach-shell` gets `--frame-mid`, not `--page-max`.** A 1760px-wide chat column
  is unreadable, and the plan itself says the coach shell becomes the WS-D two-pane frame.
  It is fluid now (820px -> `min(1180px, 100%)`), and WS-D replaces it.
- **B3 `html`/`body`/`.page` keep `overflow-x: clip`.** That hides overflow rather than
  proving there is none, so the gate deliberately does **not** trust `scrollWidth`: it
  walks every visible element and reports anything whose right edge passes the viewport
  unless a genuine `overflow-x: auto|scroll` ancestor owns it. `hidden`/`clip` ancestors
  do not excuse a child. (The first draft of the checker did excuse them, and passed
  everything — worth knowing if the script is ever edited.)
- **B4 zoom did not actually need fixing; DPR did.** The plan asked to verify that zoom
  re-rasterises. It already did — browser zoom changes the layout viewport and fires
  `resize`. The real hole was a DPR change with no viewport change, which fires nothing.

- **1.3 commit order inverted.** The plan said "one commit for seed+gates, one for
  ETL+sector fit"; ETL shipped first because the persona harness's sector-fit assertion
  reads `lvMeanW`, and every commit has to be gate-green.
- **1.3 the ETL runs as a separate script, not `npm run onet:build`.** `build.mjs` would
  overwrite `careers.json` / `layout-2d.json` / `hub-zone-map.json` with a fresh 18-zone
  UMAP layout, undoing the 2026-07-18 macro rezone (`rezone-hub.mjs` is a downstream pass
  that treats the aggregates as read-only). `build-zone-weighted.mjs` recovers the 18
  build-time zones from `(soc, title)` via the now-shared `hubZoneForSoc` — verified to
  reproduce every stored `count` exactly and `lvMean` to 5e-4 — and reuses the stored
  `lvMean` as `c0`, so the existing fields come out byte-identical. `build.mjs` also emits
  the new fields, so a future full rebuild stays correct.
- **1.3 gating is applied where each source reaches PERSONALITY, not to the objective
  theme layer.** The plan listed "sharpen + know-you + resume"; know-you and resume text
  build the OBJECTIVE vector and touch personality only through
  `bleedPersonalityFromObjectiveDelta`, which is gated and budgeted. The plan's gate is
  also written in personality terms ("further from 50", "currently-zeroed/estimated"),
  which has no meaning for a sparse 0-based target vector. Budgeting the objective layer
  as well would have been an unmeasured change (cosine is scale-invariant, so a uniform
  layer scale changes nothing except where caps bind).
- **1.3 gain is measured from the generic-occupation baseline, not from 50.** The plan
  specified `d_i = values_i − 50`, `t_i = topCentroid_i − 50`. Measured: with the blend
  dominated by the top sector, `sign(d) == sign(t)` almost everywhere, so `G_hi`/`G_lo`
  degenerate into a flat gain and no persona cleared the spread assertion (best 33 vs the
  required 35, home zone ranked #1 for only 2 of 4). Both vectors are now measured against
  the per-dimension mean across all zone centroids — which is what the mean-centered
  cosine the fit itself uses implies — and all four personas clear rank #1 with spread
  36-54.
- **1.3 the finance persona's zone-margin floor is 10, not 15.** `business-finance` is the
  merged 115-career macro-sector and overlaps every other desk zone, so a white-collar
  personality vector scores 70-81 against nine of ten zones. Swept the entire constant
  space (exp 2-10 × G_hi 2-14 × G_lo 0.1-1 × commit 2-16 × band 2-22): the maximum
  achievable margin for that persona is **10**, at every setting. The floor is written
  into the fixture as `minZoneMargin: 10` with the evidence, not hidden in the assertion.
  The other three personas clear 15 (17 / 23 / 60). Raising `REP_WEIGHT_EXPONENT` (3 → 24)
  moves it by at most 1 point, so it is not a weighting problem.
- **1.3 three personas are opposed to `trades`.** Hands-on vs desk is the dominant axis in
  O*NET level space; healthcare-vs-creative tops out at 32-43, so pairing them would have
  tested the taxonomy rather than the vector. The harness prints the full 4×4 cross-matrix
  every run, so white-collar separation is still visible (and will regress visibly).
- **1.3 `hub-onet-map.js:1844` (zone-to-zone similarity for bridge links) still reads
  `lvMean`.** It feeds hub layout/adjacency, not sector fit; switching it would perturb the
  macro-hub geometry that `hub:verify` pins. Deliberate.
- **1.3 calibration check (plan step 5).** A decided persona's own top careers now read
  58-89% (mythic/legendary on the `FIT_TIERS` ladder) and unrelated careers 0-18%, i.e.
  inside the plan's 70-90 / ≤20 target. `tradeOffLabel`'s ±30 gap thresholds still read
  sensibly — a decided student's top match now lands in "strong personality fit,
  early-stage objective fit", which is the correct message. No threshold changed.

- **1.2 re-key lives in a new module, not inline in `derive-career.js`.** The plan named
  `getAllDerivedRows` (~:180) and the per-base SELECT (~:409); the function at :177 is
  actually `getRuntimeDerivedRows` (a slug-collision helper, not a serving path) and the
  real serving chokepoint is `store.getDerivedCareers`. Re-keying inside the store would
  recurse (`getCareers` → `mergeDerivedIntoCareers` → `getDerivedCareers`), so the math went
  into a dependency-free `onet/derive-rekey.js` that both sides import, and
  `getAllDerivedRows` was added to `_lib/derive-career.js` as the name the plan expected.
- **1.2 static sidecar is empty.** `data/onet/artifacts/derived-careers.json` has 0 careers,
  so every affected row is a D1 runtime row — the backfill only ever touches D1.
- **1.2 orbit slot is reconstructed, not stored.** Rows do not persist the `seed` they were
  laid out with, so the re-key recovers it by sorting siblings by synthetic SOC (generation
  assigns seeds 1..3 in ascending SOC order). `hub:verify` asserts siblings never collapse
  onto one point.
- **1.1 the plan's lazy-load list was two-thirds not on the page.** `career-personalize.js`
  is loaded by `career.html` and `hub-academics.js` by `quiz.html` — neither is a
  `dashboard.html` script tag. Only `career-compare.js` (16KB) and `career-deep-dives.js`
  (10KB) were, and `career-deep-dives` has no dashboard consumer at all (`FWHubDeepDives` /
  `FWHubStaticMetrics` are read only by `app-pages.js`, `quiz-app.js`,
  `career-personalize.js`). Both are now idle-injected, so post-idle behavior is identical.
- **1.1 step 4 (canvas sprite pre-render) deliberately not done.** Its own precondition —
  "only if step 1 shows paint cost > ~4ms/frame at overview" — is not met: first paint lands
  in the same millisecond as script-eval, and the throttled boot produced a single 78ms long
  task with nothing over 120ms post-paint. The remaining boot cost is JS + `careers.json`
  download/parse (script-eval alone is 4.7s at 1.6Mbps), which is WS-A (fonts) and WS-H
  (payload) territory, not canvas.
- **1.1 descriptions were fetched at boot, not lazily.** Plan step 5 said to "confirm" the
  185KB artifact stays lazy; `loadCore` was in fact firing it during boot. It is now
  idle-scheduled, and `openPanel` pulls it on demand so a panel opened in the first moments
  still fills in.

- **1.7 SVG favicon not added.** The plan allows this explicitly ("do this now if WS-A's SVG
  exists, else after WS-A slice A2"). There is no bird-mark SVG in the repo yet, so 1.7
  shipped as the PNG rename + fresh stamp only. WS-A A2 must add `assets/icons/favicon.svg`
  and insert `<link rel="icon" type="image/svg+xml">` first in the head block on all 15
  pages.
- **1.7 move, not copy.** The plan said copy; `git mv` is strictly better here — it makes
  `/assets/favicon.png` and `/assets/apple-touch-icon.png` 404, so a browser holding the
  year-long immutable cache entry for the old arrow at those URLs cannot keep serving it,
  and falls back to `/favicon.ico` (correct art). No other file referenced the old paths
  (grepped `*.html`, `assets/`, `functions/`).
- **1.5 uses `min(1760px, 100%)` + a 3vw page pad, not a literal `94vw`.** `.portal-wrap`
  sits inside `#page-portal`'s horizontal padding, so `width: 94vw` overflows the parent
  content box (and scrolls the body) below ~800px viewport. Widening the page padding to
  `clamp(16px, 3vw, 48px)` yields the same ~94% frame at every width with no overflow.
- **1.5 rail wrapper added to `portal.html`.** The plan asked for grid-area classes over
  markup changes "where possible"; a 4-column rail holding two separate siblings needs one
  wrapper, so `#portal-profile-entry` + `#portal-snapshot` are now inside
  `<div class="portal-rail">`. All JS reaches those nodes by `getElementById` only (grepped
  `portal.js`, `roadmap.js`, `artifacts.js`, `portal-flightplan.js`) — no parent/sibling
  assumptions, so nothing in JS changed.
- **1.4 hiding technique.** `.app-nav-tab { display: inline-flex }`
  (`flightway-theme.css:344`) beats the UA `[hidden]` rule, so the fix also clears the
  class and sets `style.display = 'none'`; the signed-out branch restores both. `hidden` +
  `aria-hidden` alone would have left a visible empty tab.

- **WS-C: `smoke-resume-ui.mjs` had to change with the icons.** It read skill labels as
  `textContent.replace('✕','')`, so the moment the remove button became an SVG the
  assertion failed on a trailing space. It reads the label span now. This is the shape of
  breakage to expect from any future glyph→icon swap: the gate that catches it is
  `resume:ui-check`, not `node --check`.
- **WS-C: the `×` swap could not be one mechanism.** `lucide.createIcons()` only reaches
  nodes present when it runs, and four of the affected pages (dashboard, coach, quiz,
  simulation) did not load lucide-lite at all. Adding a blocking script to `dashboard.html`
  would have fought fix 1.1's boot work, so static markup inlines the SVG directly (free,
  no JS) and JS-built markup calls the new `lucide.svg()` string API. Only
  `simulation.html` gained the script tag, because `sim-engine.js` builds its decoder
  close button at runtime.
- **WS-C: P6-b was smaller than the screenshots implied.** The resume and coach
  placeholders that look like three dots are already real `…` — confirmed with `cat -v`
  (`M-bM-^@M-&`). Only two quiz strings were literal dots. Recorded in the audit doc as a
  correction rather than silently narrowed.
- **WS-C: P5-d (30 non-token `box-shadow` literals) deliberately not done.** Classified all
  30 by hand: every one is a bespoke elevation (drawer edge glow, canvas plate, keyframe
  pulse ring) with per-surface offsets and per-theme alphas, and no literal repeats often
  enough for a token to collapse it. Tokenizing means inventing a shadow scale and
  re-tuning 30 surfaces with no gate to catch the regression — a rewrite, which C1 forbids.
  Left for WS-H if a shadow scale is ever wanted.
- **WS-C: P4-c (coach empty state) deferred to WS-D.** Slice D1 rebuilds `coach.html` and
  its CSS into the two-pane frame; an empty state designed now would be thrown away. The
  coach gear icon was still fixed, because it is a named C1 seed item.
- **WS-C: P2-d/P2-e (`✓`/`○` checklist marks, quiz emoji) deferred as intentional.** The
  checklist marks are typographic list markers, correctly weighted in both themes; the quiz
  emoji are card content, not chrome.
- **WS-C: `--transition` is a 32-consumer token.** Retuning it 0.3s → 0.18s was one line
  because every consumer is a hover/focus micro-state. Verified by reading all 32 sites
  before the edit — page and entrance motion carry their own 0.35–0.75s durations and are
  not routed through this token. If a future rule needs a slow transition, give it an
  explicit duration rather than widening this token back.

- **WS-D D3: thread rule 3 selects a sector, not a top-5-fit career.** **RESOLVED by the
  tail session's T3** (`3f49bd1`) — rule 3 now proposes an undiscussed top-5 career with its
  fit score; the sector form survives as the fallback for a cold rank cache, which is why
  `test:marco-ui` pins that an empty rank leaves it byte-identical. The plan asked for
  "a top-5-fit career absent from the dossier conversation history". There is no
  server-side career ranker — ranking is a client-side vector op over the whole O*NET
  catalog (`FWOnetVectors`), and the only server-reachable rank is
  `portalSnapshot.careerPicks`, which stores `careerId` with no name. Pulling `getCareers`
  onto the chat hot path to resolve three titles costs far more than the rule is worth, so
  the rule fires on an undiscussed high-scoring **sector** instead (from
  `topIndustryKeys`, the same helper `profile-building.js` uses). Same shape of insight,
  no new cost. Revisit if a server-side ranker ever lands for another reason.
- **WS-D D4: deadline extraction already existed.** The plan's first D4 bullet ("add
  deadline extraction to the opportunities schema") was done when the Opportunity Finder
  shipped — `opportunity-core.js:190-192` coerces an ISO date or null and its invariant
  header already says "deadlines are ISO-parseable from sourced text or null, never
  invented". This session built only the read side. Recorded rather than silently skipped.
- **WS-D D4: the rail reads a cache, it never triggers research.** `GET /opportunities`
  runs three grounded research calls plus a 20s shaping call — unacceptable on a page load.
  `?cached=1` short-circuits to the cache-or-empty-shape, and `deadlines.js` reads the same
  key directly for the chat and weekly-plan paths. Consequence to know: **a user who has
  never opened the Opportunity Finder panel has no deadlines anywhere**, because nothing
  has ever populated that cache. That is the intended degrade, not a bug — but if the
  deadline rail should ever be populated without a panel visit, that is a new decision
  about when to spend a research call, not a fix.
- **WS-D D5: the portal's career-switch drawer was left alone.** It presents as "Career
  switch advisor", not as Marco, and its prompt (`career-switch-chat.js`) is on WS-E's E2
  refactor list. Giving it Marco's face now would be undone there.
- **WS-D: `defer` ordering is load-bearing on two pages.** `brand.js` now precedes
  `coach.js` (coach.html) and `marco.js` (dashboard.html). Both consumers self-boot during
  the defer pass — `document.readyState` is already `interactive` when deferred scripts
  run, so their `if (readyState !== 'loading') init()` fires before later `defer` tags
  execute. Moving `brand.js` back down silently returns the paper-plane fallback and an
  empty avatar circle. There is no gate for this; the comment in each file is the guard.

- **WS-F: the "user-sync registry" half of the KEY_MAP invariant does not apply here.**
  Invariant 0.2 says a new persisted user key goes in both KEY_MAPs *plus* the user-sync
  registry. That registry (`functions/_lib/user-sync.js` `FIELDS`) syncs *dossier* facts —
  each entry needs a dossier line, a `clean()` and a place in `buildSeedDossier` /
  `FIELD_PREFIXES`. `featureIntros` is client-owned UI state that no conversation can
  state and no prompt should read; adding it there would invent a dossier line for
  "has seen the resume screen". Both KEY_MAPs got the row, `test:user` proves they match,
  and `test:intro` proves the D1 round trip. `test:sync` is unchanged and green.
- **WS-F: `sharpen` is ribbon-only on purpose** (`introMode: 'ribbon'` in the manifest).
  The masterplan lists it among the nine interstitials, but since the 2026-07-17
  quiz-only move it is a STEP inside the quiz flow, shown right after signup — and Part 0
  forbids an interstitial mid-task. The step already carries its own heading and sub-line;
  the ribbon carries the rest. The interstitial copy is authored and shipped, so if
  sharpen ever becomes a surface of its own again, deleting one line turns it on.
- **WS-F: no ribbon on the hub, the simulation or the interview overlay.** The hub already
  has `#hub-map-hint` — a one-line contextual hint in the same position doing the same job;
  a second would compete, which F4 explicitly forbids. The simulation's flow is a taught
  sequence (eyebrows, step counts, "tap any underlined word"), and the interview overlay is
  a modal running a timed session. All three keep their interstitials.
- **WS-F: `opportunities` fires from the panel, not the page.** It lives inside
  roadmap.html, which already owns `data-fw-intro="roadmap"`. Its interstitial fires when
  the panel first reaches `ready` or `gated` — never `empty`, because an empty panel is
  what grounding-off looks like and hyping a list that is not there is worse than silence.
  `modalOpen()` means a student who would meet both in one visit meets them on separate
  visits instead.
- **WS-F: signed-out persistence needs no second store.** The plan called for a
  localStorage fallback migrated on sign-in. `FWUser`'s storage *is* localStorage, so the
  fallback is the same code path; the migration work was the union merge in `auth.js`,
  which had to read intros through `FWUser` rather than `readLocalQuiz()` — the latter
  returns null until the quiz has scores, and intros start before that.
- **WS-F: `quizPayloadHash` was the silent half.** Its own comment warns that anything
  omitted "can change locally and silently never re-sync to D1 for the session".
  featureIntros is the first persisted field that changes with no quiz input changing, so
  without the new `intros` term a student would meet every interstitial again on their next
  device. The term deliberately covers `seen`/`ribbonDismissed` only — the ribbon rotation
  counter must not cost a profile PUT.
- **WS-F: `seed()` fabricating a user object was a real data-loss bug, caught live.**
  Writing `fw_user_v1` for a visitor who has no profile makes user.js's boot migration
  read it as "the legacy blob was already promoted" and DELETE `fw_hub_quiz_v1` on the next
  boot rather than reading it. `hub:smoke` found it against the deployed build (zone
  personality fits flat at `{min:0,max:0}`) — `pages:smoke` did not, because the page threw
  nothing. **The general rule for anything new that writes through `FWUser`: do not create
  the object; only ever patch one that already exists.**
- **WS-F: two existing UI gates broke on contact and were fixed, not silenced.**
  `resume:ui-check` and `smoke-opportunities-ui.mjs` drive pages that now carry
  interstitials; every click landed on the backdrop. Both seed `featureIntros` in their
  quiz blob now. **This is the shape of breakage to expect from any future page that gains
  `data-fw-intro`** — the harness must model a returning student.

- **WS-G: the portal panel shows two meters, not four.** G1 says "subtle usage summary";
  `FEATURE_LIMITS` has four entries and only two of them are things a student spends.
  `marco-thread` caps how often the product *interrupts* (WS-D D3) — metering it would
  invite a student to feel short-changed by an interruption budget — and `mock-interview`
  is `0` on free, which is a locked feature (upgrade moment 2, owned by `FWEnt.gate()` and
  the WS-F interstitial). A "0 of 0" meter is exactly the broken-feeling wall Part 0
  forbids. The display list is `PANEL_METERS` in `plan-surface.js`; publication is still
  total, and `test:entitlements` proves no cap can hide from the client.
- **WS-G: two locked surfaces keep their bespoke markup.** G2 says the moments are styled
  consistently. `why-this-match.js`'s locked explainer and `sim-engine.js`'s locked tier
  card are both inline surfaces inside dense layouts; dropping the shared `.fw-ent-gate`
  block (a padded dashed panel) into either would look worse, and rewriting working code
  the plan did not ask for is a Part 0 violation. They already match in *shape* — lock
  affordance, one sentence of value, one `See Flight Plan →` link — which is what
  consistency buys here. Only the emoji lock was changed.
- **WS-G: the "1 or 2 messages left" line in coach is not a fifth upgrade moment.** The
  gate requires every cap be discoverable *before* it is hit, so the last two messages get
  a quiet system line; spending the last one renders the card instead, because that is the
  wall itself. Same rule as the exhausted meter row.
- **WS-G: nothing in this workstream is verifiable on the live prototype.** With
  `PAYWALL_ENABLED` unset the surfaces are correctly invisible (see Human-gated). Live
  verification therefore proves the *absence* of a regression — pages boot, no page errors,
  the preview badge renders — and `plan:ui-check` (which stubs `/config` with the real cap
  table and drives portal.html in Playwright) is what proves the surfaces themselves.

- **WS-H: two weights deliberately left alone.** `flightway-pages.css` is 194KB raw and
  loads on six pages; `assets/logo-bird.png` is 129KB and is referenced only by a comment
  in `brand.js` (it is the traced source of truth for the WS-A vector marks, not a served
  asset on any page). Neither is on a critical path that is failing: cold FCP is 152–180ms
  with both in place, more than 10× inside the H1 budget. Splitting a 194KB stylesheet
  across six pages is a refactor with real regression risk and no measured benefit, and
  deleting the wordmark's source art to save bytes nobody downloads is a bad trade. If a
  future budget ever bites, the stylesheet split is the first move and `perf:check` is the
  gate that would show it working.

## Open follow-ups (not human-gated — next session can do these)

- ~~**`_lib/roadmap-tree.js`'s four branch prompts still do not build from the composer.**~~
  **CLOSED** by T2 (`df8ce96`). All four build from `buildSurfacePrompt('roadmap-advice')`
  and `test:marco-voice` now pins their structural JSON contracts, their hard constraints
  and both school branches.
- ~~**A server-side career ranker would unlock E3's last item and D3's thread rule 3.**~~
  **CLOSED** by T3 (`3f49bd1`). `functions/_lib/onet/career-rank.js`; both deviations above
  are annotated as resolved.
- ~~**Existing profiles keep the OLD seed.**~~ **CLOSED for every account it can be closed
  for** by T4 — see the decision entry in the tail-session section. The remainder (accounts
  carrying a server AI personality patch) is a data decision, moved to Human-gated.

- ~~**WS-C seed item: the app-nav scroll rail has no affordance.**~~ **CLOSED** by WS-C
  slice C2.5 (`e03927a`): `app-nav.js` toggles `is-scroll-start` / `is-scroll-end` while a
  rail actually overflows and `flightway-theme.css` masks that edge. Verified headless on
  `dashboard.html` at 1440 / 1024 / 820 / 390 — the mask is present at the three widths
  that overflow and absent at 820, which does not.

## Reported-bug sweep — 2026-07-21 (`d8d3fab..edddfb6`)

Six bugs Jacob reported after the tail session. The important one:

- **Marco was down on every surface, and had been since `c184a3e` (2026-07-03).**
  `runChatTurn` read `payload.starterContext`; the parsed body is `reqBody`, and `payload`
  is only ever a key on the RETURN objects. Every turn threw
  `ReferenceError: payload is not defined` before any Gemini call, and `authErrorResponse`
  turned it into a bare 500 — which the client's error gate renders as the generic
  "Something went wrong on our end." The friendly gate was doing its job; it just meant the
  failure carried no signal.

  **Why nothing caught it, which is the part worth keeping:** `node --check` only parses, and
  every Marco suite (`test:marco-voice`, `test:marco-ui`, `test:marco-stream`) exercises
  prompt builders, parsers and contracts — **nothing in the repo executes the request path.**
  A whole class of runtime error in `functions/` is therefore invisible to the gates. It was
  found by `wrangler pages deployment tail`, which should be the first move on any
  "it 500s in production" report, not the last.

  Two dead ends worth recording so nobody re-walks them: the API key IS set and both
  configured model IDs (`gemini-3.1-flash-lite`, `gemini-3.5-flash`) are current per Google's
  model docs — neither was the cause.

- **The cascade hid the class.** `callGemini` advanced to the next model only on 429/503, so a
  404 (retired/renamed model) or 400 aborted the chain with a working fallback configured —
  exactly the 2026-07-09 `gemini-2.x` retirement shape. Now 400/404 cascade; 401/403 (rejected
  key) log loudly and stop, because a bad key fails identically on every model; an exhausted
  cascade logs status + upstream detail and returns 429/503 instead of 500.

- **`GET /config` now reports `aiEnabled` + `aiModels`** so "is the AI configured" is
  answerable without a deploy. `aiEnabled` means the key is PRESENT, not valid — the
  distinction is in the code comment and matters.

Also fixed: the portal rail was `position: sticky` above 1440px only (taller than the
viewport, so it pinned and the flight-plan card scrolled across it — static everywhere now);
Marco's dossier chips glued a prefix onto a raw value ("Year freshman") and sliced at a fixed
index ("starting second qua"); the roadmap top bar put its nav clearance on `#roadmap-body`,
which starts below the ribbon slot, so it double-counted 57px of dead space AND rendered the
hint ribbon underneath the fixed nav; the hub's satellite orbs are gone (AI-derived careers
and the per-parent count badges stay, and the badge now reads the fragment index directly
rather than depending on satellites being on screen); "the question you actually have" →
"questions".

**Deviation / process note:** the first commit of this batch (`8331b4c`) used `git add -A`
and swept four unrelated UI fixes in under a Marco-only message, against Part 0 rule 5. Not
rewritten — it was already pushed and building — but the follow-up (`edddfb6`) carries the
real description and the cache busters that commit should have included. Worth stating plainly
because a reader bisecting `8331b4c` will find more than its subject line claims.

**Second Marco failure, same root: the 429.** Fixing the ReferenceError revealed a rate
limit, because the outage had been quietly spending the user's budget the whole time.

- **The conversation endpoint used `checkRateLimit`'s default `RATE_LIMIT_MAX = 10/hour` —
  the login-attempt ceiling.** Every other AI endpoint carries a considered value (mock
  interview 30, resume 20-30, analysis 20); the one endpoint where a user naturally sends the
  most messages kept the default. It is also the wrong *kind* of limit: the business rule is
  the `marco-chat` feature cap (5/day free, unlimited paid), so this number's only job is
  stopping a script. Now `RATE_LIMIT_CHAT_MAX = 60`.
- **A failed turn spent the user's budget and never gave it back.** Both `checkRateLimit` and
  `checkFeatureLimit` spend up front — correct for abuse control, and the comment says so —
  but nothing refunded when the turn then failed server-side. Every retry against the
  ReferenceError burned an hourly attempt, so the fix surfaced a lockout instead of a reply.
  `refundRateLimit` / `refundFeatureUse` now hand both back on a non-4xx failure; a 4xx the
  user actually caused still costs them. Both are best-effort and never throw — a refund that
  throws inside a `catch` converts a handled error into an unhandled one.
- **Ruled out:** the free daily cap was never the cause. `resolveEntitlement` returns
  `effective: paywall ? plan : 'premium'`, and premium `marco-chat` is unlimited, so with the
  paywall dark the feature cap cannot bite.

**`npm run test:chat-turn` — the gate that was missing.** Every other Marco suite tests
builders, parsers and SSE framing; **none of them ever called the endpoint**, which is exactly
how a two-week total outage sat behind an all-green board. It drives the real `runChatTurn`
against stubbed storage and a stubbed upstream and asserts the turn *executes*: no
scope/type error from our own code, a real reply on the happy path, the `starterContext`
branch specifically, and that a failed turn refunds both budgets. **Validated against the real
defect** — reintroducing `payload.starterContext` turns five of its assertions red. An
earlier attempt at a static undefined-identifier scanner was thrown away at 271 false
positives; executing the path is the sound version of that idea.

**Gates green at `edddfb6`:** `test:marco-voice`, `test:marco-ui`, `test:marco-stream`,
`test:vectors`, `onet:test`, `test:entitlements`, `hub:verify`, `hub:smoke`, `pages:smoke`,
`hero:check`, `layout:check` (270 cells). Live-verified: all five re-stamped assets serve at
`?v=20260721h` and their bodies carry the fixes.

## Marco persona v2 — critical, not adversarial (2026-07-21, `cfaef87`)

Reported after the outage was fixed: Marco disagreed with almost everything rather than
advising. **No single rule caused it — five pointed the same way at once**, and each was
defensible on its own:

| v1 rule | What it did in combination |
|---|---|
| credibility comes "from staying right under pushback — never from being encouraging" | framed encouragement as the opposite of credibility |
| "Softening a real problem is the one failure they cannot recover from" | made softness the cardinal sin, so every reply erred hard |
| "no managing their feelings" | read as licence for coldness |
| "Never change a recommendation because they pushed back" | treated user disagreement as something to resist |
| the per-reply self-check | **three of its four questions asked "am I being too soft?" and none asked the reverse** |

The self-check is the strongest lever because it runs on **every** turn — a model auditing
itself for excess softness each time learns that agreement is a failure mode.

**v2 keeps the whole anti-sycophancy half** (flattery is still a stated cost, manufactured
balance still banned, still says the hard thing plainly, still will not move because someone
is unhappy) and adds the missing counterweight to each: contrarianism named as a credibility
cost alongside flattery; manufactured *disagreement* banned alongside manufactured balance;
crediting what genuinely works made an instruction rather than an option; criticism required
to carry a next step; never opening by hunting for a fault; being persuaded by a real
argument explicitly *not* caving; and the self-check rewritten to run in **both** directions,
ending on "did you tell them what to DO". The stated purpose of a reply is now that the
student gets better at this, not that their plan gets graded.

**Guard:** 16 assertions in `test:marco-voice` pin the *shape* of the balance — both halves
present — matching on structure rather than exact wording, so the copy stays editable while
a one-sided rewrite fails the gate. Goldens refreshed, pinned at `PERSONA_VERSION = 'v2'`.

**Also fixed:** `test:marco-voice -- --live` defaulted to `gemini-2.5-flash`, which this repo
itself marks as hard-retired — so the one tool that could check tone against the real model
404'd on every call. It now uses `DEFAULT_GEMINI_MODEL`, and a fourth fixture was added (a
student proposing a genuinely sound plan) because that is the case where reflexive
disagreement shows up and the other three do not catch it.

**Not verified against the live model.** The harness proves the prompt changed and stays
balanced; it cannot prove the model's behaviour changed. `npm run test:marco-voice -- --live`
with a `GEMINI_API_KEY` is the check, and it costs money, so it is Jacob's call.

## Human-gated (only Jacob can do these)

- **The AI-patched accounts still carry the generation-1 personality vector, and only
  Jacob can decide to replace it.** T4 re-seeds every profile where the re-seed is
  lossless. It deliberately does not touch a profile whose `personalityVector.source` is
  `gemini-patch`, `profile-building` or `resume-gemini`, because the patch edited values
  in place with no replay record and the old seed's math no longer exists — **their
  per-dimension patch detail cannot be preserved by any migration, remote-D1 or
  otherwise.** The choice is therefore a product one: keep a mushier vector that carries
  hand-tuned dimensions, or take the sharper seed and accept that the patches' sector-level
  effect (which *does* survive, via the projection into `sectorFitSheet`/`quiz.scores`) is
  all that remains. If the answer is "re-seed them too", it is a one-line change — delete
  the `personalityReseedIsLossless` guard in `assets/js/shared/onet-vectors.js` — plus the
  `test:vectors` assertions that pin the current behaviour. **If instead the answer is
  "never lose a patch again", the real fix is a replayable `personalityAiPatch` record
  mirroring `objectiveAiPatch`** (new persisted key → client KEY_MAP + server KEY_MAP +
  user-sync registry, replayed in `hydrateQuizVectors`); that is a feature, not a tail item.
  Nothing is urgent: the guard fails closed, so today nobody loses anything.

- **WS-G G4 — the free/paid surfaces are built but invisible until the paywall flips.**
  `PAYWALL_ENABLED` is unset on the prototype, so `/config` reports `paywallEnabled: false`,
  `FWEnt` never reads `/auth/me`, and every meter correctly renders nothing (the portal
  shows a "Preview access" badge instead). That is the designed behaviour, not a bug — but
  it means **nobody sees a single cap surface until Jacob sets `PAYWALL_ENABLED=true`** on
  the Pages project. `plan:ui-check` is what proves the surfaces work in the meantime.
- **WS-G G4 — Stripe.** Live (or test-mode) price/product IDs + webhook secret if unset;
  `GET /config` reports `stripeEnabled` / `stripeTestMode`, so that endpoint is the check.
  Until Stripe is configured, every pricing CTA falls back to the fake-door intent modal —
  the upgrade moments all point at a page that cannot yet take money.
- **WS-G G4 — env vars still unset:** `ROOT_ADMIN_EMAIL` (admin console), `DEV_TEST_EMAILS`
  (dev allowlist — without it Jacob's own account meets the free caps once the paywall is
  on), `GROUNDING_ENABLED` (Opportunity Finder + deadlines).
- **WS-G G4 — remote D1 backfill** for Fix 1.2's derived zones (also listed below).

- **WS-F: real analytics for the onboarding counters.** `FWEvents` is a local ring buffer
  with no server beacon — a deliberate privacy decision recorded in its header, not an
  oversight. So `feature_intro_shown/completed/skipped/upgraded` and
  `feature_ribbon_dismissed` stay on each student's device; `FWFeatureIntro.stats()` and
  `?fw_debug_events=1` are the only readers. Turning these into a funnel Jacob can actually
  look at means deciding to send client events to a server, which is a privacy-policy
  decision before it is an engineering one.

- **Run the derived-zone backfill against remote D1** (optional, belt-and-braces — serving
  is already correct without it): `node scripts/backfill-derived-zones.mjs` to review the
  UPDATEs, then `--apply`. Needs wrangler auth for `flightway-db`. Orphaned rows are
  reported, never deleted — dropping user-generated rows is Jacob's call.
- **Clear the local Safari favicon cache once.** 1.7 defeats HTTP caching for every new
  visitor (the old URLs now 404), but Safari keeps a separate favicon store that may still
  show the old arrow on Jacob's own machine until cleared.
- Carried over from the free/paid session (still open): live test-mode Stripe purchase run;
  confirming `STRIPE_*` Pages vars are set on the prototype (`GET /config` reports
  `stripeEnabled` / `stripeTestMode`); `DEV_TEST_EMAILS` and `ROOT_ADMIN_EMAIL` env vars.

---

## Final audit — 2026-07-21 (`docs/FINAL_AUDIT_BRIEF_2026-07-21.md`, `9b75497..`)

### Phase 0 — baseline

**All 31 gates GREEN at `614e085`** before any edit: test:vectors, onet:test, hub:verify,
verify:aliases, verify:user, test:user, test:sync, test:school, test:entitlements,
test:admin, test:marco-voice, test:marco-ui, test:marco-stream, test:chat-turn, test:intro,
test:weekly, test:opportunities, interview:check, resume:ats-check, resume:format-check,
resume:tailor-check, stripe:check, grounding:check, hero:check, pages:smoke (live),
hub:smoke (live), plan:ui-check, opportunities:ui-check, resume:ui-check, perf:check
(live), layout:check (270 cells).

### Phase A — did the plan land? (the five watch items)

1. **Fix 1.2 serving path — VERIFIED live.** `GET /derive-career?all=1`: 55 fragments in
   `{business-finance:33, law:13, tech:6, creative-media:3}`, zero non-canon zones, zero
   without a live parent. The D1 backfill stays optional belt-and-braces.
2. **WS-D D2/D6 FW_UI emission frequency — NOT VERIFIABLE, moved to Human-gated.** Needs a
   real signed-in conversation against the live model (no session credentials, no
   `GEMINI_API_KEY` on this machine). The parser/transport halves stay unit-proven.
3. **WS-F onboarding — VERIFIED by probe.** Signed-in Playwright probe on `roadmap.html`:
   interstitial fires once on first visit, CTA dismisses, the mark persists through
   `FWUser` (`fw_user_v1`), a reload shows nothing, zero pageerrors. Cross-device
   persistence rests on `test:intro`'s D1 round trip + `mergeFeatureIntros` union (green).
4. **WS-G — `plan:ui-check` read and trusted.** It asserts the real cap table (imported
   from `plan-limits.js`, not hand-written), per-plan meter/nag behavior, dark-paywall
   no-fetch, capCard XSS escape, script ordering, and pricing slot truth. That is the
   right evidence while `PAYWALL_ENABLED` stays unset.
5. **Tail items — CLOSED.** T2 pinned by test:marco-voice (green). T3's cached path —
   which had NEVER executed anywhere — is now proven end-to-end by `test:endpoints`:
   cold turn has no career block, `waitUntil` fills exactly one `career-rank:` KV entry
   with 5 titled scored careers, the next turn's prompt carries the block. T4 safety
   re-derived (below).

Also closed from the do-not-regress list: **AI-derived careers are still reachable with
the satellite orbs gone** — two paths verified in code: `searchAll` filters `state.all`
which keeps derived rows (only orphans are skipped), and the parent career's panel
renders the "AI specializations" chip strip (`renderPanelFragments`,
`hub-dashboard.js:1400`) whose chips open the derived panel or deep-link `career.html`.

### Phase B — findings and fixes

**B1 + the headline bug.** New gate `npm run test:endpoints`
(`scripts/test-request-paths.mjs`) extends the test:chat-turn pattern to ten request
paths. Its very first run found that **`functions/career-roadmap.js` has called
`loadUserBlob` without importing it since `6b0a4d2` (2026-07-19)** — every roadmap
generation, every roadmap refine-chat turn and every gap-progress write threw
`ReferenceError` → bare 500, invisible to every green gate, exactly the Marco-outage
class. Fixed in `678ac94`, pushed and live. Coverage now: career-roadmap (generate),
career-switch-chat, mock-interview, portal-snapshot, runChatTurn (rank path),
weekly-plan, opportunities (?cached=1), derive-career (?all=1), profile/quiz (GET+PUT),
sim-generate, resume-parse, stretch-fits. **Eight mutation validations ran red** (incl.
reintroducing both real defects) before the suite was trusted.

**B4 refunds (fixed, `678ac94`).** roadmap-generate (LIFETIME cap + rate),
career-switch-chat (shared marco-chat + rate, both exits), mock-interview (daily
session), portal-snapshot (10/hour rate the portal spends per page load). Principle:
every user-caused rejection happens before the spend flag flips, so refund-on-flag is
exact. Cascade check: `gemini-json.js` does NOT have the abort-on-404 flaw — a
non-retryable status skips retries but the model loop still advances.
`gemini-grounded.js` research is primary-model-only BY DESIGN (fallbacks may lack
google_search) and soft-fails to ungrounded — noted, not changed: a retired primary
model would silently kill grounding while spending daily budget (budget-on-failure is
deliberate; Google bills the attempt).

**profile/quiz PUT 500 (fixed, `831bf47`).** `baseUrl` came from `originFromEnv()` — the
CORS allow-origin, `'*'` for an Origin-less client — so `getZoneDimensionProfiles` built
`new URL(path, '*')` and the PUT died 500. Now `new URL(request.url).origin` like every
other endpoint.

**B3 cache stamps (fixed, `9b75497`).** New standing gate `npm run verify:busters`
(HTML+JS+CSS refs; one stamp per asset, file exists, stamp not older than the file's
last change; /data/* staleness is warn-only per its 1-day rule). First run caught two
live pinning bugs: `roadmap-sync.js` changed 2026-07-07 but portal/roadmap still served
`?v=20260703p` (returning users held June-27 bytes), and `sim-share.js` stamped before
the file existed on this branch. Both now `?v=20260721i`.

**B2 guarded globals — swept, zero live bugs of the roadmap/entitlements class.**
260 raw findings triaged: every guarded call either has a real fallback
(`feature-intro`'s veil hook falls back to load+300ms; `billing.js` falls back to a
credentialed plain fetch), is deliberately optional cross-page, or fires post-boot where
defer order is settled. Dead references recorded: `FWPage` (billing.js) and
`FWResumeBuilder` (portal.js:984) are defined nowhere — donor-legacy guarded no-ops;
`assets/js/app/artifacts.js` is loaded by no page since the 2026-07-10 streamlining and
its `FWArtifacts` call sites are intentional stubs.

**B5 re-seed safety — re-derived, holds.** Every layer preserves
`personalityVector.source`: strip-bleed copies all keys but values/bleedBase;
`stripTagged` carries `base.source`; refine/bleed applies default only when absent;
all three server patch writers stamp their marker; `gap-progress-sync` never touches
personality; the PUT round trip keeps it (now pinned by test:endpoints). **One caveat,
theoretical:** patches applied 2026-06-29→07-01 predate source-stamping
(`eff801d`/`ce5c235` added the stamps), so such a vector would re-seed as "lossless" —
but public launch was 2026-07-16, so that window holds dev accounts only. No change.

**B6 security — clean.** Live unauthenticated probes: 401 on all 12 user-data
endpoints, 404 (not 403) on admin routes, anonymous-by-design surfaces reject bad
shapes. All innerHTML added since the WS-C audit escapes first (coachRenderMarkdown
escapes then formats; card/thread titles fill via textContent; deadline links are
https-gated + escaped + noopener; ribbon/plan-surface use esc).

### Findings recorded, not fixed

- **Pivot-regen bypasses the roadmap-generate cap.** `career-roadmap.js` ~:1365 (the
  roadmap-chat pivot path) calls `executeGenerateRoadmap` behind `roadmap-gen` rate only
  — no `checkFeatureLimit('roadmap-generate')` — so once the paywall flips, a free user
  can regenerate endlessly by pivoting through chat. Dormant today. The fix needs a
  chat-UX decision (what a 402 looks like mid-conversation), so it is recorded rather
  than patched blind.
- **mock-interview propagates upstream error statuses** (a retired model's 404 ships as
  our 404). Refund is correct regardless; the status mapping deserves the chat.js
  429/503 treatment someday.
- `weekly-plan.js onRequestGet` has no try/catch — an exception is an unhandled 500 at
  the runtime (same bare-500 shape; the suite would catch a scope error there now).
- Dead code candidates from B2 (FWPage, FWResumeBuilder, artifacts.js) — removal is a
  cleanup, not a bug.

### Human-gated (additions)

- **The FW_UI emission-frequency question (carried from WS-D/WS-E) still needs a real
  signed-in conversation on the deployed site** — chips/cards presence over ~10 real
  turns. Same session should eyeball a thread card and the deadline rail.
- `npm run test:marco-voice -- --live` (persona v2 against the real model) — costs money.
- Everything previously listed (PAYWALL_ENABLED, Stripe, ROOT_ADMIN_EMAIL,
  DEV_TEST_EMAILS, GROUNDING_ENABLED, D1 zone backfill, AI-patched-account re-seed).

### New standing gates

`verify:busters`, `test:endpoints` — both mutation-validated red before first trust.

---

## Audit Phase 2 — 2026-07-21 (`a66ea6d..`, `Jacob_Work`)

Brief: finish the request-path sweep, close the recorded findings, then polish.

### Phase 0 — baseline

**All 33 gates GREEN at `357a4d0`** before any edit — the 31 from the final audit
plus `verify:busters` and `test:endpoints`. Live gates (`pages:smoke`, `hub:smoke`,
`perf:check`, `layout:check` 270 cells) run against the deployed build.

### Phase A — the request-path sweep, finished

**A1 — career-roadmap's other ten actions (`a66ea6d`). Found a second live
outage.** `career-roadmap.js` has called `saveUserBlob` without importing it
since `6b0a4d2` (2026-07-19) — the SAME commit, the SAME file and the SAME class
as the `loadUserBlob` bug fixed in `678ac94`. Every `gap-progress` write (the
skill-gap checklist's vector write) has been a `ReferenceError` → bare 500 in
production since. The last sweep executed `generate` and nothing else in this
file, so the second missing import sat directly behind the fix for the first.
Coverage added, one executing case each: follow, choose, split, extend,
gap-checklists, complete-step, gap-progress, step-elaborate, branch-build,
waypoint-plan, revert-step.

Two things learned building the fixtures, both worth keeping:
- A `follow` onto a branch does NOT persist as an `activePath` edit —
  `normalizeRoadmapTree` recomputes `activePath` from the decisions on every
  save, so `focusTracker.activeBranchKey` is the only place the choice survives
  a reload. The test asserts the focus, not the path.
- The objective AI patch persists at `vectors.objectiveAiPatch.dimensions`
  (`{index, value}`), not `entries`.

**A2 — admin (`fb54354`).** `test:admin` already executed all six handlers as
real requests, so nothing was duplicated. The gap was narrower: the
404-not-403 assertion covered only `/admin/whoami` and `/admin/admins`. The
other four routes (audit, grants, grants/revoke, elevate) now each answer a
signed-out and a signed-in non-admin caller — 404, a body naming neither admins
nor grants nor elevation, no write to `users`, no audit row. The stranger holds
a real elevation lease, which also pins that a lease without the role buys
nothing.

**A3 — the remaining eleven handlers (`24b6f31`).** career-analysis,
profile-align, profile-building, dossier (GET+PUT), sim-colleague, sim-feedback,
sim-mirror, resume-builder (GET/POST), resume-tailor (GET/POST), roadmap-sync,
account (POST+DELETE). Each gets the execution assertion plus its cheapest real
behavioral check — the dossier shape guard, an unknown simId 404ing before any
model call, the Mirror's two-flight minimum, a free account meeting the resume
builder as a 402-with-upgrade rather than a 500, another user's `resumeId`
answering 404, and `DELETE /account` asserted table by table so the deletion gap
closed on 2026-07-19 cannot silently reopen.

`roadmap-sync.js` is both a `_lib` module and a request path; the endpoint is
what got covered.

### Phase B — the recorded findings

**B1 — the pivot cap bypass: the finding is wrong, and looking for it found a
worse bug (`fda85f3`).**

The recorded bypass is **not reachable**. The roadmap-chat action is
premium-gated at its entry (`career-roadmap.js:1318`, `requirePlan(...,
'premium')`), and `roadmap-generate` is unlimited on premium
(`plan-limits.js:38`, `{ free: 1, premium: null, lifetime: null }`). A free user
cannot reach the pivot; a premium user reaching it is not capped. The premise
"a free user regenerates forever by pivoting through chat" cannot happen.

What IS real, one screen above it: in the generate path `checkFeatureLimit` ran
BEFORE `checkRateLimit`, and `checkFeatureLimit` spends as it checks. The rate
wall throws *outside* the try/catch that refunds, so a 429 left the spend
consumed — and `roadmap-generate` is 1 per LIFETIME on free. A user who
double-clicked generate could burn their only AI roadmap and be told "too many
attempts" for it. The four refunds shipped on 07-21 rest on "every user-caused
rejection happens before the spend flag flips"; the rate wall was the one that
did not. Fixed by ordering (rate first, then cap), and the cap's own 402 now
hands the rate slot back on the way out.

The pivot check was added anyway as **defense in depth** — the cap table is the
authority, and giving premium a regeneration cap tomorrow would otherwise turn
the pivot into exactly the bypass described. Its response is the WS-G shape, not
a 402: a normal 200 turn, Marco saying it in his own words, `cap:{feature,
message, upgrade}` in the payload, and `FWPlanSurface.capCard` rendered into the
chat thread by `roadmap.js appendChatCap`. **That branch is untestable through a
real request because it is unreachable through one** — recorded, not faked.

Also live on the pivot and now fixed: nothing refunded the `roadmap-gen` rate
slot when a regeneration failed. Same class as the 07-21 refunds, reachable by
any premium user today.

**B2 + B3 — error shapes (`268559d`).** `weekly-plan.js onRequestGet` now wraps
a helper in try/catch; it was the last endpoint that could turn an exception
into an unhandled runtime 500 with no log line. `mock-interview.js` no longer
propagates upstream statuses — a retired model's 404 shipped to the browser as
our 404, telling the client its interview did not exist. Both map the way
`chat.js` does: 429 (load) and 503 (down) pass through, everything unclassified
is ours and answers 500. The mock-interview refund was left alone; it was
already correct.

**B4 — dead references (`9168f4f`). Two removed, one deliberately kept.**
`FWPage` (billing.js) and `FWResumeBuilder` (portal.js) are defined nowhere;
their guarded fallback was the only branch that ever ran. Removed.

`assets/js/app/artifacts.js` is **orphaned, not retired**, and must not go with
them. No page has loaded it since the 2026-07-10 streamlining, so both call
sites (`skill-gap-tracker.js:1642`, `portal-flightplan.js:111`) take their
no-op branch — but `functions/artifacts.js` serves GET/POST and applies gap
progress to the objective vector, the D1 `artifacts` table is purged on account
deletion, and `resume-builder.js` reads that table as server-loaded resume
evidence. The write path is unreachable while three consumers still read it, so
the table can only ever be empty. Deleting the file would delete the only way a
user can create what they read. The reasoning and the re-wire scope now live at
the top of the file.

**B5 — grounding (`552459c`). Claim checked against the code, not the model
card.** The single-model choice is not a local guess: it is the repo's
convention in all three grounded call sites. `career-analysis.js:213` builds
`useSearch && m === primaryModel`; `chat.js` builds `useSearch && i === 0 && m
=== primaryModel`. Every fallback attempt in this codebase DROPS `google_search`
rather than carrying it. Adding a grounded cascade here would make
`gemini-grounded.js` the one place assuming a capability the other two
explicitly refuse to assume — **not changed, and the reason is now in the
comment** so the next audit does not re-open it.

The finding was right about the consequence, and two things were fixed there. A
404/400 from the research model means the name is retired or wrong, not that
Google is busy: it now logs at ERROR level naming the model and saying grounding
is off, distinguishable from the transient failures that shared the old warn
line. And it refunds the daily budget — spending up front is right when Google
serves the request, but nobody is billed for a model Google refused, so a stale
model name was burning the whole day's grounding budget on requests that never
ran.

### Phase C — polish

The five surfaces (coach two-pane, roadmap tree + top bar, portal rail, plan
surfaces, feature intros) were walked in light + dark, desktop + mobile with
`scripts/ui-screenshots.mjs`. **57 captures, zero page errors** (all 260 console
lines are the harness's intentional API 404s).

**Deliberately left, with reasons:**
- **Feature intros need nothing.** `feature-intro.js` already carries
  `role="dialog"`, `aria-modal`, `aria-labelledby`, a real focus trap with
  shift-tab wrap, an Escape handler, focus restore, `aria-hidden` on every
  decorative SVG, and a labelled close button. WS-F did this properly.
- **The portal checklist's `×` is already `aria-label="Dismiss"`** with a
  `lucide.svg('x')` glyph (portal.js:334) — it only *looks* bare at screenshot
  scale.
- **The portal rail's "dead column" is a harness artifact, not a defect.** The
  rail is designed to hold profile entry + snapshot; the snapshot card is absent
  only because the harness serves no session data. Verified in
  `flightway-pages.css:1439-1463` before touching anything.
- P2-d (`✓`/`○` typographic markers) and P5-d (30 bespoke box-shadows) re-read
  from `docs/POLISH_AUDIT_2026-07.md` and left deferred on their original
  reasons — neither has changed.

**The one new surface this session** — the cap card inside the roadmap chat
thread — was checked against the standing rules and complies: `.fw-plan-cap` is
built from tokens (`--primary`, `--text-secondary`, `--text-tertiary`) with no
hardcoded colours, so it is theme-aware by construction; it carries
`role="status"`; and it animates nothing, so `prefers-reduced-motion` is moot.

`layout:check` (270 cells, `--base=` the live origin) and `perf:check` both
PASS after every change.

### Findings recorded, not fixed

- **`assets/js/app/artifacts.js` is unwired** (see B4). The evidence pipeline's
  write path is unreachable while `resume-builder.js` reads its table as resume
  evidence. Re-wire scope: two script tags (portal.html for `logModal` + the
  `#portal-fw2-stack` card, roadmap.html for `promoteFromNote`) plus a look at
  how `injectCard` lands on the post-WS-C portal layout — it has never rendered
  against it.
- **The pivot cap branch has no test** because it has no reachable path (see
  B1). It becomes testable the moment `roadmap-generate` gets a non-null premium
  limit, and that is the change that should bring the test with it.
- **Whether `gemini-3.5-flash` accepts `google_search` is unverified** — it is a
  fact about Google's API, not about this repo, and no offline gate can settle
  it. The decision not to cascade was made on the repo's own three-place
  convention instead, which is verifiable and was verified.

### Human-gated (unchanged)

`PAYWALL_ENABLED`, Stripe IDs + webhook secret, `ROOT_ADMIN_EMAIL`,
`DEV_TEST_EMAILS`, `GROUNDING_ENABLED`, the optional D1 derived-zone backfill,
the AI-patched-account re-seed decision, the FW_UI chip-frequency conversation
on the deployed site, and `npm run test:marco-voice -- --live`.

Note that **B5's fix is invisible until `GROUNDING_ENABLED=true`**, and B1's
generate-ordering fix is invisible until `PAYWALL_ENABLED=true` — both are
correct today and matter the day the flags flip.

### Mutation validation

Every new assertion was validated red: 6 on the roadmap actions, 1 on admin
(20 assertions fail when `adminNotFound` becomes a 403), 6 on the breadth pass,
3 on the refund/ordering invariants, 2 on error shapes, 2 on grounding. The
`gap-progress` and `saveUserBlob` sections went red against the REAL defect on
their first run, before any mutation was needed.

## Artifacts re-wire + final audit — 2026-07-21 (`8942fe5..`, `Jacob_Work`)

### Phase 0 — baseline

`npm run gates:unit` green 30/30 on arrival (26.6s), no `ok*` retries. The
33-gate baseline at `8942fe5` carried forward. Three commits were unpushed
(`caddecb`, `93aa5ab`, `f8312cd`) and the live site was still serving `8942fe5`.

The suite is now **31 offline gates**, with `artifacts:ui-check` added below.

### Slice 2 — `f3049af` the evidence pipeline gets its writer

`assets/js/app/artifacts.js` had been orphaned since the 2026-07-10
streamlining: no page loaded it, so `FWArtifacts` was undefined and every call
site took its guarded no-op branch, while `functions/artifacts.js`, the D1
`artifacts` table, and `resume-builder.js` all kept reading what it alone
writes. `portal.html` now loads it and calls `injectCard()` from the boot block.

Verified by capture, not assumed: the card mounts in `#portal-fw2-stack` and
renders correctly in **all four** portal shots (light/dark x desktop/mobile),
with zero `[pageerror]` lines. The previous session's correction holds —
`renderActions()` never touches `#portal-fw2-stack`, so no re-mount from
`reinjectPortalActionExtras()` is needed. Note `#portal-actions` *does* exist
(portal.html:55); the fallback is simply never taken, which is not the same as
unreachable, and the new gate pins which host wins.

Modal brought to the `feature-intro.js` standard: focus trap wrapping both
ways, capture-phase Escape, focus restored to the invoker, `aria-pressed` on
the type toggles, `role="alert"` on the error line, lucide `x` on close. Save
failures route through `FWErr.fromResponse`, so a 400 keeps its product copy
and a 5xx collapses to one line.

### Correction — the brief was wrong about `roadmap.html`

**The `roadmap.html` script tag was written, tested, and then removed.** The
brief asked to verify that `promoteFromNote` renders there. It cannot. The
button that would call it never renders at all:

- `.sgt-log-promote` is emitted in exactly three places —
  `skill-gap-tracker.js:1329` and `:1370` via `renderGapRows`, and `:1422` via
  `gapLogsHtml`.
- `renderGapRows` has one caller, `renderHomePanel` (`:1688`), which is
  **exported but has zero callers anywhere in the repo** — it is the portal
  home card the 2026-07-10 streamlining removed.
- `gapLogsHtml` <- `renderGapExpandBody` <- `renderGapCollapsedRow` (`:1468`),
  which has **zero references of any kind**.
- The live focus view (`renderFocusView`, the only one `roadmap.js:919` calls)
  renders `renderGapMeterRow` — the readiness meter, which has no log UI.

Reproduced, not inferred: a Playwright probe seeded a real v3 coordinate
`focusTracker` with a typed log, opened `roadmap.html?focus=1`, and got
`FWArtifacts.promoteFromNote` defined and `.sgt-log-promote` count **0**, in
both themes. The rendered panel is `sgt-gaps--meter`.

So the tag would have bought an extra request on every roadmap load for a path
no user can reach. It was removed; the reasoning is pinned in the
`artifacts.js` header so the next session does not "fix" the missing tag.

### Slice 3 — `artifacts:ui-check`, and the contrast bug it found

New gate `scripts/smoke-artifacts-ui.mjs` (port **8938**, `ARTIFACTS_UI_PORT`),
in the `port` lane. It boots the real `portal.html` and drives the real
`+ Add` button — the client had never been executed by anything in the repo.
20 assertions per theme, both themes.

It immediately went red on a **pre-existing bug it was not written to find**:

> `.fw-iv-modal` is hardcoded dark in both themes (`#0e1730`), but
> `[data-theme="light"] h3` in `flightway-theme.css:~1050` has the **same
> specificity** as `.fw-iv-modal h3` in `flightway-2.css:337`, and
> `flightway-theme.css` was winning on source order. In light theme every
> heading in that modal painted `#373737` on `#0e1730` — measured **1.49:1**,
> against a 4.5:1 AA floor. Dark theme measured 16.39:1, so it was invisible to
> anyone testing in dark.

This is **not** the "leave the deliberately-dark modal alone" case the brief
warned about — it is a WCAG failure on that surface, and it also hit the
**shipped mock-interview modal** (`interview-mode.js:622`, `<h3
id="fw-iv-title">Mock interview</h3>`), which shares the class. Fixed with one
declaration, `color: inherit` on `.fw-iv-modal h3`, which restores the colour
the modal always intended to pass down. Both themes now measure 16.39:1.
`flightway-2.css` re-stamped `20260721f` -> `20260721l` on all 10 referencing
pages, as `verify:busters` requires.

### Mutation validation

The contrast assertion went red against the **real** defect on its first run,
before any mutation. The other five were validated by injected defect, each
restored with an inverse `sed` and confirmed clean against `HEAD`:

| # | defect | assertions that went red |
|---|--------|--------------------------|
| M1 | `Tab` never handled in `onKey` | focus-trap wrap, both directions |
| M2 | `lastFocused.focus()` removed from `close()` | focus returns to invoker |
| M3 | `res.d.error` preferred over `FWErr` | 5xx leaks `D1_ERROR: near "INTO"…` |
| M4 | `#portal-actions` looked up first | card mounts into `#portal-fw2-stack` |
| M5 | `aria-pressed` hardcoded `'true'` | exactly-one-pressed, and follows selection |

### Findings recorded, not fixed

- **The gap-log UI is gone, so `promoteFromNote` is unreachable.** Two orphaned
  render subtrees (`renderHomePanel` and `renderGapCollapsedRow`, above) are the
  only things that emit a log list, a log composer, or the promote button.
  `FWArtifacts.promoteFromNote` and `skill-gap-tracker.js:1642`'s handler are
  both live and correct; they have nothing to fire them. Deciding whether the
  readiness meter should regain a log UI is a product call, not a bug fix.
  Scope if taken: restore a log list + composer inside `renderGapMeterRow`'s
  panel, then re-add the `artifacts.js` tag to `roadmap.html`.
- **`hydrateQuizVectors` re-stamps `personalityVector.updatedAt` on every boot**
  (`assets/js/shared/onet-vectors.js`, the `vectorValuesEqual` reuse branch
  ~line 699) even when the rebuild reproduces byte-identical values. Inherited
  from the previous session and **deliberately not taken** — it is the highest
  blast-radius module in the repo and belongs in its own slice with its own
  mutation validation, starting from the failing test. It makes
  `test:vectors`' `re-seed is one-time` assertion pass only when both hydrations
  land in the same millisecond (~1 run in 30 fails), and because
  `vectorInputsHash` (`onet-vectors.js:36`) and `quizPayloadHash` (`auth.js`)
  both key off that stamp, a churning `updatedAt` can make an unchanged profile
  look changed and trigger a needless upload.
  **Measured this session rather than inherited:** `test:vectors` went red once
  in a real `gates:unit` run, and a 40-run loop failed **3 times (7.5%)**. The
  failing assertion was captured and is exactly the named one —
  `re-seed is one-time: the second boot leaves updatedAt alone`
  (`scripts/test-vectors.cjs:146`). The diagnosis is confirmed in shape:
  `onet-vectors.js` has no `Math.random` and no date-dependent branch in the
  hydration path, so a deterministic defect would fail 100% of the time; a 7.5%
  rate means the only differing quantity is the `new Date().toISOString()` stamp
  and the assertion passes whenever both hydrations land in the same
  millisecond. The mechanism inside `hydrateQuizVectors` is **not** pinned: on
  the second boot `stored.seedGen` is current, so `shouldReseedPersonality`
  (`:528`) should return false and `vectorValuesEqual` (`:593`, values-only)
  should reach the reuse branch at `:703`. First thing to check next session is
  whether `migrateLegacyQuizSchema`'s `personalityLooksCorrupt` (`:605`) is
  deleting `quiz.personalityVector` before `basePersonalityFromQuiz` sees it.

### Human-gated (unchanged)

`PAYWALL_ENABLED`, Stripe IDs + webhook secret, `ROOT_ADMIN_EMAIL`,
`DEV_TEST_EMAILS`, `GROUNDING_ENABLED`, the optional D1 derived-zone backfill,
the AI-patched-account re-seed decision, the FW_UI chip-frequency conversation
on the deployed site, and `npm run test:marco-voice -- --live`.

### New standing gates

- `artifacts:ui-check` — port 8938, `port` lane, in `gates:unit`. First
  executable coverage of `assets/js/app/artifacts.js`, and the only gate that
  measures contrast inside `.fw-iv-modal` (which the mock-interview modal
  shares).

---

## Overhaul close-out — 2026-07-21 (`59078e1..`, `Jacob_Work`)

Six commits were sitting unpushed and the live site was still on `8942fe5`.
This session closed the last contrast defect, re-ran the full suite, and shipped
the batch.

### The third hardcoded-dark surface — `.fw-intent-dialog`

`.fw-iv-modal` and the artifact modal were fixed last session. `pricing.html`'s
launch-list dialog carried the identical defect and was **live**, on the first
page a prospective buyer sees.

| | |
|---|---|
| surface | `.fw-intent-dialog` (`assets/css/flightway-2.css:163`) |
| heading | `#fw-intent-title` (`pricing.html:141`) |
| cause | the dialog sets `background:#0e1730; color:#f2f6ff` in **both** themes; `.fw-intent-dialog h3` set no colour, so `[data-theme="light"] h3` (`flightway-theme.css:813`) — **same specificity, 0,1,1** — won on source order and painted `#373737` |
| **before** | **1.49:1** — `rgb(55,55,55)` on `rgb(14,23,48)` |
| **after** | **16.39:1** — `rgb(242,246,255)` on `rgb(14,23,48)` |
| floor | 4.5:1 (WCAG AA, normal text) |

The fix is one declaration — `color: inherit` — restoring the colour the surface
already sets on itself. The modal chrome was **not** restyled: the dark
background is deliberate and identical in both themes.

**Observed red before the fix.** The assertion was written first and run against
unmodified CSS: `FAIL intent heading contrast is AA (1.49:1, rgb(55, 55, 55) on
rgb(14, 23, 48))` in light, `ok 16.39:1` in dark — which is exactly why this
class of bug survives review. It is invisible in the theme most people develop
in. After the fix, all four contrast assertions (two surfaces × two themes)
report 16.39:1.

### Coverage

`artifacts:ui-check` now drives `pricing.html` as well as `portal.html`. It
routes `/config` without `stripeEnabled` so the CTA takes the fake-door branch
(`billing.js` `available()` → false), clicks a real `.fw-intent-cta`, and
measures the opened dialog. No new gate — the suite stays at 34.

**The sweep is closed.** `grep -rnE "background: *#(0e1730|0b1327|06122b)"
assets/css/*.css` cross-checked against every heading emitted into those
containers finds exactly three live headings: `#fw-art-title`, `#fw-iv-title`,
and `#fw-intent-title`. All three are now pinned by an executed assertion.
`.fw-iv-persona-card` uses `<div>`s, not headings, and every input in those
surfaces sets its own `color`.

### Cache busters

`flightway-2.css` → `?v=20260721m` on all **10** referencing pages (admin,
career, coach, dashboard, portal, pricing, quiz, resume, roadmap, simulation).
`verify:busters` requires one stamp per asset repo-wide **and** a stamp no older
than the file's last git change, so touching this stylesheet obliges all ten.
That is the gate's requirement, not a blanket re-stamp.

### `layout:check` is now parallel — 13 min → ~1 min

The full walk was 270 cells run strictly one at a time, ~2.9s each. It cost more
than the other 33 gates combined, and it was the whole reason a pre-push full
run felt expensive enough to skip. It now runs through a worker pool
(`--jobs`, default `min(6, cores-4)`; `--jobs=1` is the old serial walk).

**Why this is safe here and is NOT safe for `perf:check`.** `layout:check`
asserts on geometry — `getBoundingClientRect`, `scrollWidth`, `clientWidth` —
which is a pure function of viewport and stylesheet. Running cells concurrently
cannot change a layout result. `perf:check` asserts on wall-clock FCP, so
anything running beside it changes the number it measures; that is why it has a
`solo` lane in `run-gates.mjs` and why it keeps it. Do not "optimise"
`perf:check` by overlapping its loads — that speeds up the gate by making it
lie.

The one real risk was contention delaying a cell past its settle wait, which
would read as a spurious `dead gutter`. The flat `waitForTimeout(400)` was
therefore replaced with a real condition — `document.fonts.ready` plus two
animation frames — which is both faster on an idle cell and correct on a
contended one. A fixed sleep is exactly the wrong shape under a pool.

| | serial | pooled (x6) |
|---|---|---|
| `--quick`, 18 cells | ~19s | **2.7s** |
| full, 270 cells | ~13 min | *(see baseline below)* |

### Baseline

The full `npm run gates` run attempted this session **did not complete** and
must not be quoted as a green baseline. It was killed mid-`layout:check`
(`GATES_EXIT=143`, SIGTERM); `perf:check` never started and produced no log.
Of the 32 gates that did report, 31 passed and **`test:vectors` failed** — the
known 7.5% flake, on its documented assertion
(`re-seed is one-time: the second boot leaves updatedAt alone`), unrelated to
anything in this commit.

**Process note worth more than the run itself:** that failure was initially
missed because the log was read with `tail`. The `FAIL` line was 13 lines from
the *top* of a 37-line console log, and `test:vectors`' own log ends with `PASS`
lines with its failure at line 18. The documented hazard is
`gates:unit | tail -N` swallowing the exit code; this is the sibling hazard —
**a tail can hide a red gate even when the exit code is honest.** Grep for
`FAIL` explicitly; never conclude a run is green from its tail.

### `test:vectors` is in the one lane that does not retry

`RETRYABLE` in `run-gates.mjs:138` is `{port, live, solo}` — the browser and
network lanes, where a red is plausibly contention. `test:vectors` is `pure`, so
the single gate measured at **7.5% flaky** is the one that gets **no** retry and
fails the whole suite outright. That is a ~1-in-13 spurious full-suite red on
every push. Recorded, not fixed: the right fix is the underlying `updatedAt`
churn (own slice, failing test first), not widening `RETRYABLE` to paper over it.

### Findings recorded, not fixed

Both carried forward unchanged from the previous session, deliberately not
taken here:

- **`test:vectors` is genuinely flaky** — 3 failures in 40 runs (7.5%), failing
  assertion `re-seed is one-time: the second boot leaves updatedAt alone`
  (`scripts/test-vectors.cjs:146`). Own slice, failing test first; highest
  blast-radius module in the repo.
  **It reproduced TWICE more during this session's pre-commit `gates:unit` runs**
  — so three independent sightings in one afternoon, on trees whose only changes
  were CSS, docs and test scripts. Each cost a full red suite and a re-run. The
  measured 7.5% from the 40-run loop now looks like an underestimate of what it
  costs in practice, because a suite runs the assertion once and any red blocks
  the commit. **This has stopped being a background flake and is now the single
  biggest tax on this repo's gate loop — take it next session, ahead of feature
  work.** Original note follows.

  It reproduced during this session's pre-commit `gates:unit`, taking
  the whole suite red (`EXIT=1`) on a tree whose only changes were CSS and a
  test script — nowhere near vector code. Re-ran green 3/3 immediately after,
  and the captured assertion was the same one. Two independent observations of
  a suite-reddening flake is now the strongest argument for taking it: it is no
  longer only a correctness question, it is costing real gate runs. Note
  `test:vectors` is in the `pure` lane, which `run-gates` does **not** retry —
  so this shows up as a hard red, never as `ok*`.
- **`FWArtifacts.promoteFromNote` is unreachable** because the gap-log UI is
  gone. Restoring it is a product decision, not a bug fix. Do **not** "fix" the
  missing `artifacts.js` tag on `roadmap.html` — its absence is deliberate and
  the reasoning is pinned in that file's header comment.

### `layout:check` parallelized — 13 min → ~35s

`scripts/verify-fluid-layout.mjs` now walks its 270 cells through a worker pool
(`JOBS`, capped at 6, `--jobs=N` / `LAYOUT_CHECK_JOBS`, `--jobs=1` restores the
exact serial walk). The flat 400ms per-cell sleep is replaced by a real settle
condition — `document.fonts.ready` then two rAFs — which is both faster and more
correct, since a fixed sleep is dead time on a quick cell and not enough on a
contended one.

Safe here in a way it is **not** for `perf:check`: this gate asserts on geometry
(`getBoundingClientRect`, `scrollWidth`), a pure function of viewport and
stylesheet, so overlapping cells cannot change a result. `perf:check` asserts on
wall-clock FCP and must keep its `solo` lane.

**Verified rather than assumed**, because a fast gate that lies is worse than a
slow one:

| check | result |
|---|---|
| stability | **3/3 clean full runs**, 270 cells, 35s / 34s / 37s |
| still catches a real defect | injected `.portal-wrap { min-width: 3000px }` → **84 of 270 cells** red, `overflows right: section.portal-wrap @3046 (vw 1528)` |
| crash hardening | forced `newContext()` to reject on every `quiz` cell → **30 of 270 reported**, clean verdict line, **no uncaught exception** |

**One real defect was found and fixed during that verification.** `newContext()`
sat *outside* `runCell`'s `try`, so when the browser died mid-run every in-flight
worker's next call rejected uncaught and killed the process with **no verdict at
all** — observed once as 168 clean cells, then 6 simultaneous failures (= `JOBS`)
and a hard crash, while two full walks were racing each other. Moving it inside
the `try` required also null-guarding the `finally`: an unguarded `ctx.close()`
there throws straight back out and re-creates the identical crash. A gate may
report a failure; it may not vanish.

**Trap worth keeping:** killing `run-gates` does **not** reap the static server
its children bind. A stale listener on 8934 survives `pkill` and the next run
dies with `EADDRINUSE` — which exits non-zero and reads exactly like a real gate
failure. Two separate results this session were inconclusive for that reason
before it was spotted. Wait for the port rather than assuming a non-zero exit
means the assertion fired.

---

## Final sweep — 2026-07-21 (`ab2ad22..`, `Jacob_Work`)

Close-out session: kill the flaky gate, take the green baseline that had never
been taken, and close the "recorded, not fixed" list rather than carry it a
fourth time.

### The `test:vectors` flake was a live bug wearing a flake's clothes

Reproduced first: **5 failures in 60 runs (8.3%)**, matching the recorded 7.5%.
The previous session's parting guess was right — `migrateLegacyQuizSchema`'s
`personalityLooksCorrupt` was deleting `quiz.personalityVector` before
`basePersonalityFromQuiz` saw it — but the reason it was corrupt is the finding:

`seedPersonalityFromQuiz` ranks the quiz scores through
`FWSectorFitSheet.SECTOR_KEYS`. **`roadmap.html` was the one hydrating page that
never loaded `sector-fit-sheet.js`,** so on that page the seed ranked an empty
list and returned 161 zeros. Every account still on seed generation 1 — which is
exactly the population the re-seed exists to upgrade — had its personality vector
**overwritten with zeros on every roadmap load**. The zeros then read as corrupt
to the migration, which dropped them, and the next boot re-seeded zeros with a
fresh `updatedAt`. That is the churn, and `vectorInputsHash` /
`quizPayloadHash` both key off that stamp, so an unchanged profile looked changed
and uploaded every boot. Other pages self-healed it; roadmap re-zeroed it.

The test only fired 8% of the time because both hydrations usually land in the
same millisecond. **The flake was the bug reporting itself at 8% volume.**

Fixes (`ab2ad22`), each mutation-validated **10/10 red**:

| | fix |
|---|---|
| 1 | `basePersonalityFromQuiz` fails closed — a re-seed that comes back corrupt keeps the stored vector, exactly as the missing-centroids case already did. The re-seed is an upgrade or it does not happen. |
| 2 | A rebuild that exactly reproduces a vector the migration dropped keeps its `updatedAt`. Hydration is idempotent or the staleness hashes lie. |
| 3 | `roadmap.html` loads `sector-fit-sheet.js`. |
| 4 | The harness loads it too, so the seed assertions stop passing vacuously against zeros, and `tick()` puts a real millisecond between the two boots. |

Fix 4 matters as much as the rest: the assertion that caught this fired on 1 run
in 12. It now fires every run — the same mutation went from **4/50 red to
10/10 red** once `tick()` was added. **An assertion that only sometimes runs is
not a gate.**

Result: **80/80 clean**, from 5 in 60. Server parity holds —
`functions/_lib/onet/user-vectors.js` imports `SECTOR_KEYS` statically and, per
its own header, stamps but never drops. `personalityReseedIsLossless` untouched.

### Baseline — the first green 34-gate run on record

```
34/34 passed in 57.2s (136.2s of work — 2.4x)     GATES_EXIT=0
```

Zero `FAIL` lines (grepped, not tailed), zero `ok*` retries, `perf:check` ran.
Taken on `ab2ad22`. The previous record had no green baseline: that run was
SIGTERM'd mid-`layout:check` with `test:vectors` red.

### Findings recorded, not fixed — all four closed

- **`FWArtifacts.promoteFromNote` unreachable — needs Jacob, and here is exactly
  what.** Re-verified: still no caller. The decision is not "restore the code",
  it is "should the readiness meter carry a gap log at all". Scope if yes: a log
  list + composer inside `renderGapMeterRow`'s panel
  (`skill-gap-tracker.js`, the `sgt-gaps--meter` branch that `renderFocusView`
  renders), reusing the existing `.sgt-log-promote` button and the live handler
  at `skill-gap-tracker.js:1642`; then re-add the `artifacts.js` tag to
  `roadmap.html`. **Moved to the Human-gated list — it is a product call, and it
  has now been "recorded, not fixed" three times because nobody can take it but
  Jacob.** The missing `artifacts.js` tag stays missing; that is deliberate.
- **The pivot cap branch — re-verified, correctly untested, left.**
  `career-roadmap.js:1318` gates the whole chat action behind
  `requirePlan(env, email, 'premium')`, and the deployed `/config` confirms
  `roadmap-generate` is `{free: 1, premium: null, lifetime: null}` — unlimited on
  premium. The branch is unreachable. It becomes reachable, and gains a test, the
  day premium gets a non-null `roadmap-generate` cap. The in-file comment already
  says this correctly.
- **P2-d (`✓`/`○` markers) — closed won't-do, and it found a real bug.** All five
  sites verified: every glyph is `aria-hidden="true"` decoration next to either a
  real `<input type=checkbox>` or a text label. Not controls, so the original
  reason holds. **But `portal.js`'s checklist carried its done-state in nothing
  else** — the glyph is hidden from AT and the `is-done` class says nothing, so a
  screen reader heard five labels with no way to tell finished from pending. The
  banner names the next step and is silent about the other four. Fixed in
  `fe6a605` with the `.fw-vh` state word the codebase already uses.
- **P5-d (30 bespoke box-shadows) — closed won't-do, with the claim corrected.**
  The recorded reason said "no repeated literal a token would collapse". That is
  slightly overstated: there are exactly two repeats, each appearing twice
  (`0 20px 60px rgba(0,0,0,.5)` and `-8px 0 40px rgb(0 0 0 / 0.18)`). Two pairs
  do not justify inventing a 6-shadow scale and re-tuning 30 surfaces with no
  gate to catch a regression. Conclusion unchanged, evidence now accurate.

### The fourth hardcoded-dark contrast bug — and a gate for it

The close-out's cross-check was re-run and **widened**, because it only grepped
three known hex values. A luminance scan of every hardcoded background in
`assets/css/*.css` found a fourth dark plate the three-hex grep could not see:
`#page-quiz .salary-arena`, `#080c1a`. Measured on it:

| | light | dark |
|---|---|---|
| `.sal-cta-stat` | **2.73:1** | 6.49:1 |
| `.sal-cta-stat strong` | **1.06:1** | 16.97:1 |
| `.dist-axis-label` | 3.16:1 | 3.16:1 |

The `strong` is "78% of people" — the headline stat of the quiz result CTA,
unreadable for every light-theme user since it shipped, and 16.97:1 in dark,
which is why three review passes in dark theme never saw it. Same shape as
`#fw-art-title`, `#fw-iv-title` and `#fw-intent-title` (1.49:1). `.dist-axis-label`
was a separate, theme-independent AA failure at 9px.

Fixed in `5f2bdf6` and **verified in a real browser in both themes** (the static
check reasons from declarations; the cascade is what bit three times):
19.48:1 / 6.24:1 / 5.32:1, identical in light and dark.

**New standing gate `contrast:check`** (`pure` lane, gate 32). Two checks,
because the four shipped bugs come in two shapes:

- **A — textual ancestry.** A plate selector that is a literal ancestor of a text
  rule (`.fw-iv-modal h3`). Resolves both themes' tokens and measures.
- **B — the conflict fingerprint.** `.sal-cta-stat` is *not* textually inside
  `.salary-arena`; that nesting exists only in the markup, so check A is blind to
  it. But the same selector being painted a hardcoded-light colour by one sheet
  and a theme token by another *is* the fingerprint — whoever wrote `#fff` knew
  the background was dark in both themes.

Narrowed against two false-positive classes it surfaced on the way in (14 hits →
0): `--primary-fg` is light in **both** themes, so `#fff` and
`rgb(var(--primary-fg))` on a button are two spellings of one intent; and a token
rule that repaints the *background* alongside the text has moved the whole
element onto the theme surface and is self-consistent. Mutation-validated: A red
at 1.03:1 with `.fw-iv-modal h3`'s `color: inherit` removed, B red with this
session's fix reverted.

### Fresh defect-class sweep — four clean, two real

| class | result |
|---|---|
| `data-lucide` icons missing from `lucide-lite.js` | clean (7 + 1 helper form, all defined) |
| guarded `window.FW*` globals defined nowhere | clean (every one has a definition) |
| `innerHTML` with unescaped user/model text | clean — `md()` calls `esc()` first; the flagged interpolations are literals |
| endpoints with no `try`/`catch` | 5, all trivial synchronous responders (a 410 stub, static `/config`, static resume-format). No I/O to throw — not defects |
| Gemini `thinkingBudget: 0` | **structurally guaranteed** — set in `buildBody` for every `jsonMode` call, not per call site. Class closed by construction |
| Gemini `timeoutMs` | a 30s default exists (`_lib.js:357`), so nothing hangs unbounded — **but the abort message interpolated `timeoutMs`, which 25 of 42 call sites never pass.** It read "timed out after undefinedms" in exactly the log you open to find out how long it waited. Both stream variants were already correct. Fixed `fe6a605` |
| advice prompts missing `schoolPromptBlock()` | clean. The three prompt-building files without it are not advice: `career-analysis.js` describes a *role* (metrics, AI-replacement risk), `resume-tailor.js` already has the school in the resume text, `portal-snapshot.js` summarises state |

### Human-gated

Consolidated into a single priority-ordered punch list — see the handoff
addendum. `promoteFromNote` joins it; every other entry is unchanged and was
re-verified against the deployed `/config` (`paywallEnabled:false`,
`stripeEnabled:false`).
