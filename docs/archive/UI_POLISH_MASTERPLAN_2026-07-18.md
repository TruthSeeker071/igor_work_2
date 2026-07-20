# FlightWay UI/UX Polish & Enhancement Masterplan

**Generated:** 2026-07-18 · **Branch:** `Jacob_Work` · **Status: IMPLEMENTED IN FULL** — all five §7 phases shipped; header corrected 2026-07-19 (it still read "PLAN ONLY — nothing implemented", which was true only at authoring time and misleading ever since). Phase 0 `f3250d3` (motion/elevation/status tokens, light-text fix, hub-token single-source) · Phase 1 `ac6920f` + `assets/js/shared/fw-toast.js` · Phase 2 veils now on portal/roadmap/coach **and** career/quiz · Phase 3 `2931148` CAM1, `0e3662f` CAM2, `9388f0f` CAM3+M5, `f7827c4` CAM4 · Phase 4 `ebb42e9`, `a0974ce`
**Implementer:** Opus 4.8 · **Scope:** polish pass + net-new motion/camera/color work across the whole app
**Prerequisite reading for the implementer:** `docs/CONVERSATION_HANDOFF.md`, `CLAUDE.md`, and the Risk Flags section at the bottom of this document. Vanilla JS, no build step, no new npm runtime deps without an explicit decision (see §7).

---

## 1. Scan findings — the systems that already exist (extend these, never fork them)

### 1.1 Entrance/animation conventions

There are **two deliberately separate entrance systems** with confusingly similar names. Do not merge or rename them.

**A. `FWPageVeil` (app pages)** — [page-veil.js](../assets/js/shared/page-veil.js) (105 lines, fully commented). Boot veil + one-shot entrance gate:
- Pages that re-render during boot keep an opaque `#fw-page-veil` up until renders go quiet (`QUIET_MS=280`), then add `body.fw-revealed`. Entrance keyframes are scoped to `body.fw-revealed:not(.fw-settled)` and play exactly once; `body.fw-settled` lands `ENTRANCE_MS=1200` later (or immediately if a re-render arrives) so later renders swap in place instead of replaying the stagger — that replay was a real flicker bug, which is why the gate exists.
- API: `notifyRender()` (call from every render path), `hold()`/`release()` (wrap async fetches whose results re-render — the veil becomes the loading screen), hard failsafe at 4s.
- Currently wired on: **portal, roadmap, coach, resume** (`grep -l page-veil *.html`). Entrance keyframe is `fw-rise-in` at [flightway-pages.css:3201](../assets/css/flightway-pages.css), with per-page selector lists at :3213 (portal) and :3273 (roadmap head/body, coach shell), each with a `prefers-reduced-motion` off-switch.
- **To extend:** add the new page's selectors to the scoped block, include `page-veil.js` + the veil element in the HTML, call `notifyRender()` from render paths. That's the whole recipe.

**B. `fw-reveal` scroll system (landing only)** — [reveal.js](../assets/js/landing/reveal.js): IntersectionObserver adds `.is-visible` to `.fw-reveal` / staggers `.fw-reveal-item` via `--fw-stagger`; reduced-motion short-circuits. Used only by `index.html`. Keep it landing-scoped.

**C. Quiz "juice" idiom** — the quiz results sequence has its own arcade-style keyframe family in flightway-pages.css (~:987–1072): `binderGlow`, `binderCharge`, `cardPunch`, `tierSlam`, `screenShake`, `sparklePop`, `raySpin`. This is an intentional tonal island (celebration moment). New quiz-flow motion should match this idiom, not the app-page rise-in idiom.

**Feedback primitives are minimal — the biggest motion gap:**
- [fw-toast.js](../assets/js/shared/fw-toast.js) (34 lines): a bare `<p>` toggled with `hidden`, no animation, no success/error variants, anchors only under `#portal-head`/`#roadmap-head`. Hub, career, coach, quiz have no toast at all.
- [fw-confirm.js](../assets/js/shared/fw-confirm.js) (88 lines): minimal confirm dialog.
- **Five independent spinner implementations**: `hub-spin`, `pb-spin`, `coach-spin`, `career-spin`, `fw-veil-spin` — plus four independent shimmer/skeleton patterns (`career-shimmer`, `roadmap-progress-shimmer`, `portal-dual-fit-shimmer`, `salBarIn`).

### 1.2 Hub camera/zoom system (understand before touching — this is the crown jewel)

Split across [hub-dashboard.js](../assets/js/hub/hub-dashboard.js) (input + tweens), [hub-onet-map.js](../assets/js/hub/hub-onet-map.js) (world model, clamps, mode transitions), [hub-canvas.js](../assets/js/hub/hub-canvas.js) (rendering + layer cache).

- **State:** `{ zoom, panX, panY }` in viewport-normalized space. Cursor-anchored zoom identity: `panX = mx - (mx - panX) * (newZoom / zoom)` (hub-dashboard.js:707–710). All camera math flows through `updateViewport`, `clampPan` (overview vs sector variants), `evaluateModeTransition`.
- **Two modes** — overview and sector — with `evaluateModeTransition(zoom,panX,panY,viewW,viewH)` returning `{action:'enter'|'exit', camera}`; mode entry/exit **glides** via `animateCameraTo(target, ms, onDone, {locked})` (hub-dashboard.js:795). `FLY_TO_SECTOR_MS = FLY_TO_OVERVIEW_MS = 220` (:615–616). Locked flights ignore all input (`isCameraLocked()`, :785) — hover, click, wheel are all gated on it.
- **Wheel zoom glide:** wheel events bank log-zoom into an accumulator; the rAF loop drains `ZOOM_GLIDE = 0.38` of the bank per frame, capped at `ZOOM_PENDING_CAP = 2.0`. **Invariant: never glide across a mode transition** (`if (modeChanged) pendingZoomLog = 0`, :699). `applySectorZoomDelta` reconciles `sectorZoom` to the *actual* live camera zoom before applying deltas — a zoom landing mid-entry-tween must take over from the tween, not snap (hub-onet-map.js:1539–1560).
- **Label stability rules:** sector-label overlap solve is *deferred until zoom settles* (`lastZoomInputAt`, `maybeInvalidateSectorLabelCacheOnZoom`); label anchors deliberately exclude the zoom component (:205–212). Every completed camera flight calls `invalidateSectorLabelCache()` in its `onDone`.
- **Backdrop rule:** the dot-grid backdrop follows **drag-pans only**, never zoom (:19–22) — keeps the backdrop rock-still while zooming. Preserve this.
- **Render perf:** overview layer (gradient tiles + ~780 star dots + labels) renders to an offscreen canvas and blits; re-render happens only when `overviewLayerKey()` changes (zoom/pan/hover/theme/viewport/dataVersion — hub-canvas.js:750+). **Any new visual state that should trigger a canvas repaint must join this key, or it silently won't draw.**
- **Live zones (10):** `healthcare, engineering-science, business-finance, trades, government, education, creative-media, social, tech, law` (from `hub-zone-map.json`). Per-orb colors ship baked into `layout-2d.json` (`orbColor` per SOC).

### 1.3 Color/token system — current state and inconsistencies

Tokens live in [flightway-theme.css](../assets/css/flightway-theme.css) as space-separated RGB triplets (`--primary: 210 85 40` → ember orange), dark theme default + `[data-theme="light"]` override. Dark palette is coherent: warm charcoal neutrals (`--bg: 20 19 18`) + ember accent.

**Flagged inconsistencies (each is a Phase-0 work item):**

| # | Issue | Where |
|---|-------|-------|
| C1 | **Light theme sets global `--text: 210 85 40`** — body text becomes brand orange in light mode. Almost certainly a latent bug (dark theme uses near-white `245 238 233`). Verify visually in light mode, then fix to a warm near-black (e.g. `24 20 18`). | flightway-theme.css:73 |
| C2 | **`zone-colors.css` is stale**: declares 18 legacy zone ids (`--zone-finance`, `--zone-science`, `--zone-engineering`, `--zone-media`, `--zone-marketing`…) but the live hub has 10 merged zones (`business-finance`, `engineering-science`, `creative-media`…). Canvas colors actually come from `layout-2d.json` `orbColor`, so this file is at best partially dead. Reconcile to the 10 live ids (colors matching the baked orbColors: business-finance `#F59E0B`, creative-media `#EC4899`, engineering-science `#6366F1`, tech `#3B82F6`, …) and grep for consumers of the dead vars before deleting them. | assets/css/zone-colors.css |
| C3 | **`--hub-*` tokens declared twice** — hub-dashboard.css:5–30 AND flightway-pages.css:2243–2256, with slightly different light-mode values (`--hub-text: rgb(15 15 15)` hardcoded in both). Drift hazard. Single-source them in hub-dashboard.css; make the pages.css block reference, not redefine. | both files |
| C4 | **No motion tokens at all.** 20+ ad-hoc durations (0.15s–0.7s) and **10 distinct easing curves**, including the same curve spelled two ways (`cubic-bezier(0.22, 1, 0.36, 1)` ×11 and `cubic-bezier(.22, 1, .36, 1)` ×9 — this is the de-facto house ease). | all CSS |
| C5 | **`--fw2-*` mini-palette** in flightway-2.css (`--fw2-accent: #6ea8ff` cool blue vs house ember) — an island; decide whether the anchored/inferred/estimated semantic colors join the main token file. | flightway-2.css:7–10 |
| C6 | **Reduced-motion coverage gaps**: `auth-pages.css`, `profile-building.css`, `flightway-2.css`, `zone-colors.css` have zero `prefers-reduced-motion` guards; the 13 existing guards are scattered per-block. | grep counts above |
| C7 | **No elevation/shadow system** — shadows are ad hoc; in dark theme most are invisible anyway. No gradient tokens. | — |

### 1.4 Screen traffic/priority map

**Tier 1 (core loop, polish here pays most):** `portal.html` (signed-in home), `dashboard.html` (hub — recently redesigned, treat as near-done, camera work only), `career.html` (deep dive/dossier), `roadmap.html`, `quiz.html` (the entire first-run funnel — first impression of the product).
**Tier 2:** `index.html` (landing — top of funnel, already has the best motion), `coach.html`, `resume.html`.
**Tier 3 (light touch only):** `auth.html`, `profile-build.html`, `simulation.html`, `pricing.html` — **pricing stays visually muted/dark per standing convention; do not brighten or add celebratory motion there.**

### 1.5 Performance constraints

- No build step, no bundler. All motion = CSS transitions/keyframes + rAF tweens + (optionally) the native Web Animations API — all free. **Vendoring any animation library (GSAP, motion-one) is a DECISION POINT for Jacob, not a default** — nothing in this plan requires one.
- The hub canvas is the perf-critical surface; its layer cache exists because unthrottled redraws tanked frame rate. New camera effects must ride the existing rAF loop and cache-key mechanism.
- The **View Transitions API** (cross-document) could give free page-to-page morphs but is Chromium-only; if used at all, it must be pure progressive enhancement. Flagged as optional in Phase 2.
- `/assets/*` is `immutable, max-age=1y`: **every changed asset needs its `?v=` buster bumped on every referencing page** — and a *new* stamp, not a re-used same-day stamp already present elsewhere on the page.
- New `data-lucide` icons must be added to `assets/vendor/lucide-lite.js` first.

---

## 2. Polish pass — concrete rough edges

| ID | Rough edge | Files | Fix sketch |
|----|-----------|-------|-----------|
| P1 | Light-mode orange body text (C1) | flightway-theme.css:73 | Correct `--text` / audit `--text-muted: 120 90 70` (muddy brown) alongside it |
| P2 | Toast is a dead `<p>` — appears/disappears with zero motion, no variants, missing on hub/career/coach/quiz | fw-toast.js, flightway-pages.css | Toast v2 (§3, M1) |
| P3 | Five spinner implementations, four shimmer patterns — loading feels different on every page | hub-dashboard.css:154, profile-building.css:247, simulation.css:41, flightway-pages.css:381,3198 | One `.fw-spinner` + one `.fw-skeleton` shimmer class; migrate call sites, delete dupes |
| P4 | `career.html` (Tier-1 dossier) has **no boot veil** — content pops/jitters in as fetches land, while portal/roadmap/coach get choreographed entrances | career.html, career-personalize.js, career-deep-dives.js | Wire FWPageVeil per the §1.1 recipe; wrap the analysis fetch in `hold()`/`release()` |
| P5 | `quiz.html` has no veil either; first-run users see the least polished boot | quiz.html, quiz-app.js | Same recipe; entrance idiom stays quiz-flavored |
| P6 | Duration/easing chaos (C4) — transitions of 0.15/0.16/0.18/0.2/0.22/0.25s coexist on sibling elements | all CSS | Motion tokens (§3, M0) + mechanical migration |
| P7 | Stale zone tokens (C2), duplicated hub tokens (C3) | zone-colors.css, hub-dashboard.css, flightway-pages.css | Reconcile/single-source |
| P8 | Reduced-motion gaps (C6) | auth-pages.css, profile-building.css, flightway-2.css | One consolidated guard per file |
| P9 | No consistent `:focus-visible` treatment; keyboard focus varies per page | flightway-theme.css | One tokenized focus ring (`outline` + offset, ember at reduced alpha) applied to shared controls |
| P10 | Card hover states inconsistent — some cards lift, some only recolor, some are inert | flightway-pages.css (portal/career/roadmap card blocks) | Shared `.fw-hoverable` recipe (§3, M2) |
| P11 | Dark-theme elevation illegible — panels distinguish themselves by border only (C7) | flightway-theme.css, flightway-pages.css | Elevation tokens (§5) |

Verification for this pass: visual QA via the committed screenshot harness + `npm run pages:smoke`; `node --check` on touched JS.

---

## 3. Motion system — extending the conventions

All of this **extends** `FWPageVeil` + the scoped-entrance pattern; none of it replaces anything.

**M0 — Motion tokens (foundation, do first).** Add to flightway-theme.css `:root`:
```css
--fw-ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* house ease — already dominant */
--fw-ease-standard: cubic-bezier(0.4, 0, 0.2, 1); /* material standard — 2nd most used */
--fw-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot, for juice moments only */
--fw-dur-fast: 160ms;  --fw-dur-base: 240ms;  --fw-dur-slow: 450ms;
```
Migrate existing declarations mechanically (this is ideal below-tier/batched work). Net effect: everything eases the same way, and future tuning is one edit.

**M1 — Toast v2.** Rebuild `fw-toast.js` in place (same global name/API, add optional `show(message, {kind})`): fixed-position bottom-center, slide-up + fade via `--fw-ease-out`, `success | error | info` variants (ember / semantic red / neutral), `role="status"` preserved, stacking cap of 1 (replace, don't queue), works on **every** page. Then give hub/career/coach/quiz failure paths (Gemini timeouts, save errors) an actual visible voice — today most fail silently or with layout-shifting inline text.

**M2 — Interaction micro-states.** One shared recipe: `translateY(-2px)` + elevation-shadow bump on hover (`--fw-dur-fast`), `scale(0.985)` on `:active`, tokenized `:focus-visible` ring. Apply to portal cards, career panels, roadmap nodes, quiz choices, nav links. Reduced-motion: transforms off, color shifts stay.

**M3 — Entrance parity.** Wire FWPageVeil into `career.html` (P4) and `quiz.html` (P5), adding their selectors to the existing `body.fw-revealed:not(.fw-settled)` block — one block, per-page selector lists, exactly as portal/roadmap/coach do it today. Do **not** create per-page keyframe variants.

**M4 — State-change feedback.** (a) Readiness meter / fit bars animate width from 0 on first paint only (gate on `fw-settled` absence — the mechanism already exists); (b) primary buttons get a brief success morph (checkmark swap, ~600ms) after async saves; (c) skeleton class from P3 replaces bespoke shimmers.

**M5 — Cross-page departure fade (optional, small).** On internal nav clicks, add `body.fw-departing` (120ms opacity fade) before navigation; the destination's veil/entrance completes the illusion of one continuous app. Cap at 120ms so nav never feels laggy; skip for reduced motion. (A cross-document View Transitions version is the fancy alternative — Chromium-only, decision point, not required.)

---

## 4. Camera/zoom effects — building on the existing math

Every proposal below goes through `animateCameraTo` + the clamp/mode machinery. Hard rules inherited from the scan: locked flights already gate all input; never animate across a mode boundary except via `evaluateModeTransition`'s camera; every flight's `onDone` must `invalidateSectorLabelCache()`; new visual state that affects the canvas must join `overviewLayerKey()`; the dot-grid backdrop keeps ignoring zoom.

**CAM1 — Hub establishing shot (comprehension).** On first hub boot per session (sessionStorage flag), start the camera at ~1.12× the fitted zoom centered on the user's focus zone (or map center) and run one locked `animateCameraTo` glide (~650ms, house ease) down to the fitted overview. *Why:* the map currently just appears; a single pull-back shot teaches "this is a world you can move through" in under a second, which is the hub's whole navigational premise. Skip on reduced motion and on every subsequent visit. Risk note: runs after viewport fit; must respect `hubMinZoom()`/`hubMaxZoom()` and the degenerate-viewport re-fit path (hub-dashboard.js:260–266).

**CAM2 — Zone drill-in weight (comprehension).** `FLY_TO_SECTOR_MS`/`FLY_TO_OVERVIEW_MS` are 220ms — functional but weightless for what is the app's biggest spatial transition. Raise sector *entry* to ~360ms (keep exit fast at ~240ms — leaving should feel effortless), and sync the sub-area backdrop cross-fade to the flight duration so arrival and backdrop land together. *Why:* asymmetric timing (slower in, faster out) is what makes drilling feel like entering a place rather than a viewport jump. Two constants + one fade duration; the locked-flight machinery already handles input.

**CAM3 — Dossier push-in (continuity).** Clicking a career orb → `career.html` currently hard-navigates. Add a ~240ms locked push-in toward the orb (zoom ×~1.3 anchored on the orb via the existing cursor-anchor identity) simultaneous with the M5 departure fade, then navigate; career.html's new veil (P4) completes the handoff. *Why:* the orb-to-dossier jump is the moment the map metaphor pays off — "I flew into this career" — and it currently costs the metaphor entirely. Cap total pre-nav delay at 250ms; on reduced motion, navigate immediately.

**CAM4 — Fly-to-match spotlight (delight + orientation).** The fly-to plumbing exists (`flyToCareer` / search fly-to, hub-dashboard.js:1586–1589, 380ms). Add: on arrival (`onDone`), a one-shot ~900ms halo pulse on the target orb, drawn in the dynamic (non-cached) layer so the layer cache is untouched. Use it when arriving from portal deep links ("view on map") and from search. *Why:* after a flight the user's eye needs a landing beacon; today the camera stops and nothing says "here."

**Explicitly not proposed:** parallax layers on zoom (violates the backdrop rule), continuous ambient camera drift (fights the layer cache and user control), and any camera motion during quiz/coach flows (no spatial metaphor to serve — decoration).

---

## 5. Color/visual system refinement

Keep the identity: **warm charcoal + ember orange**. This is a refinement, not a rebrand.

1. **Fix the light theme** (P1/C1) so it is actually usable: near-black warm text, ember reserved for accents/links/CTAs.
2. **Elevation tokens** — `--elev-1/2/3` as paired surface-tint + shadow values. Dark theme: elevation = slightly lighter surface + faint top-edge highlight (`inset 0 1px 0 rgb(255 255 255 / 0.04)`) since drop shadows die on near-black; light theme: conventional soft shadows. Apply to panels, modals, toasts, hovered cards (M2).
3. **One gradient family** — ember→amber (`210 85 40 → 235 150 60`) as `--fw-grad-accent`, used sparingly: landing hero accents, primary CTA hover sheen, quiz completion moment, readiness meter fill. Nowhere else — scarcity is what keeps it special.
4. **Semantic status tokens** — `--ok / --warn / --err` triplets (success green already appears ad hoc as `74,222,128` in dot-pulse; formalize it). Toast v2 and form validation consume these.
5. **Zone color reconciliation** (C2): regenerate `zone-colors.css` from the live 10-zone set with colors matching `layout-2d.json` orbColors, syncing `data/onet/artifacts/zone-colors.json` if it still carries the 18-zone list. Grep for consumers of removed vars first.
6. **Pricing stays dark and muted** — inherits token fixes (text legibility, focus rings) but gets no gradients, no celebration motion, no brightening. Standing convention.

---

## 6. Simplification candidates

Verify each before cutting (grep for inbound links first) — the portal was already streamlined on 2026-07-10, so cut shallow, not deep:

1. **Feedback primitives: 5 spinners + 4 shimmers + 1 toast + 1 confirm → one small `fw-feedback` layer** (P2/P3). Pure consolidation, no UX change.
2. **`simulation.html` / `Flightway.html`** — check whether anything still links to them (`grep -rn "simulation.html\|Flightway.html" *.html assets/js`). Flightway.html is a documented legacy redirect shim (keep); if simulation is unreachable from the live nav, exclude it from the polish pass entirely rather than polishing a dead page.
3. **Career deep-dive panel density** — career.html stacks personalize + compare + deep-dives + AI-exposure modules (career-personalize.js alone is 1571 lines). Audit with the screenshot harness for above-the-fold clutter; likely fix is progressive disclosure (collapsed sections with clear affordances), **not** removing modules.
4. **Duplicate hub token block** in flightway-pages.css (C3) — delete after single-sourcing.
5. **Landing `fw-reveal` vs app `fw-revealed`** — do NOT rename (churn across HTML/CSS/JS for zero user value); instead add a 3-line comment at each definition site pointing at the other, so future agents stop confusing them.

---

## 7. Sequencing — independently shippable phases

Each phase: implement → `node --check` all touched JS → `npm run pages:smoke` → screenshot-harness diff → bump `?v=` busters **only on changed assets, on every referencing page, with a fresh stamp** → commit → `git push origin Jacob_Work` (that IS the deploy) → `curl -L` live check.

| Phase | Contents | Size | Risk |
|-------|----------|------|------|
| **0 — Tokens & hygiene** | M0 motion tokens; C1 light-text fix; C2 zone reconcile; C3 hub-token single-source; C6 reduced-motion sweep; P9 focus rings; §5 elevation/status/gradient tokens (defined, not yet widely applied) | S–M | Low; pure CSS. Zone reconcile needs the consumer grep |
| **1 — Feedback layer** | M1 toast v2 + failure-path wiring; P3 spinner/skeleton unification; M2 hover/active/focus micro-states; M4 button success morph | M | Low; JS is additive, same global APIs |
| **2 — Entrance parity** | M3 veil on career.html + quiz.html; M4 first-paint bar animations; M5 departure fade | M | Medium: career/quiz render-path audit needed for `notifyRender()` placement; veil must never trap users (4s failsafe is inherited) |
| **3 — Camera cinematics** | CAM1 establishing shot; CAM2 drill-in timing; CAM3 dossier push-in; CAM4 arrival halo | M | **Highest.** Hub-fragile; see risk flags. Ship each CAM as its own commit so any one can be reverted alone |
| **4 — Per-screen polish** | Tier-1 screens in order: quiz → portal → career → roadmap; then landing hero gradient touches, coach, resume; elevation rollout; §6.3 deep-dive disclosure | L (parallelizable per screen) | Low-medium per screen; quiz screen must not touch quiz *state* logic |

Phases 1–4 each depend only on Phase 0. Within Phase 4, screens are independent.

## 8. Risk flags (read before every phase)

- **Hub boot TDZ trap:** any new `let`/`const` in [hub-dashboard.js](../assets/js/hub/hub-dashboard.js) read by functions reachable from top-level boot (the resize→syncMapHud chain) must be declared before ~line 240. `node --check` cannot catch it; violation = infinite spinner with no error. Verify hub changes with `pages:smoke`/headless probe, not static reading.
- **Never glide across a mode transition** (`pendingZoomLog = 0` on mode change); CAM1/CAM3 must check `isCameraLocked()` interplay and not fight `evaluateModeTransition`. CAM2's timing change keeps the sectorZoom reconciliation in `applySectorZoomDelta` untouched.
- **Canvas layer cache:** CAM4's halo must live in the dynamic layer; anything meant to appear in the cached overview layer must join `overviewLayerKey()` or it will not repaint.
- **Recently redesigned macro hub zones:** the 10-zone merge, sub-area backdrops, bridge chain, and hubZone-as-display-field boundary are fresh (2026-07-18). Camera work must not touch zone membership, layout coords, or `hub-zone-map.json`. Zone-color reconcile (C2) changes CSS vars only, never the baked `orbColor`s in `layout-2d.json`.
- **This is a UI-only pass:** no writes to quiz state, hydration, vector merge, or save/merge endpoints. If a polish change seems to need touching `FWOnetVectors`, quiz seeding, or any `PUT` path — stop, it's out of scope, flag it. `npm run test:vectors` still runs after Phase 2/4 quiz-adjacent commits as a tripwire.
- **Veil discipline (M3):** every render path on a veiled page must `notifyRender()`; async content that re-renders must use `hold()`/`release()`; otherwise the veil either lifts early (jitter returns) or the 4s failsafe becomes the UX.
- **Buster gotcha:** a "bumped" stamp identical to one already on the page is a silent no-op; always use a fresh stamp. New root-level files need a `_redirects` rule (repo files were once publicly served).
- **Reduced motion is a hard requirement** on every new animation, including all CAM items (navigate/snap instantly).
- **Don't rename** `fw-reveal`/`fw-revealed`/`fw-settled` classes or the `FWToast`-equivalent globals; extend in place.
