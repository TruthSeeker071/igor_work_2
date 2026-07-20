# FlightWay Performance Revamp & Dead-Weight Cleanup — Masterplan

**Commissioned:** 2026-07-18 by Jacob, written by a Fable 5 audit session against `Jacob_Work` @ `c0fcc16`.
**Executor:** a fresh Opus 4.8 Ultracode session with ZERO other context. This document is self-contained: everything you need is here plus the two living docs named below. Execute in one pass, phase by phase, in order.
**Branch:** `Jacob_Work` only. Pushing to `Jacob_Work` IS the deploy (Cloudflare Pages auto-builds `flightwayjacobprototype.pages.dev`). **Never touch `main`** — it auto-deploys to production `flightway.ai`.

## 0. Read-first, non-negotiable ground rules

1. **Before any edit:** read `docs/CONVERSATION_HANDOFF.md` (skim §1–19, read every addendum from "Macro hub redesign" 2026-07-18 onward) and reconcile against `git log --oneline -25`. If the repo has moved past `c0fcc16`, re-verify each finding below (file:line anchors may have shifted) before acting on it.
2. **`docs/FREE_PAID_MERGE_MASTERPLAN.md` is ACTIVE and NOT yet executed.** Do not edit it, do not delete/restructure anything it depends on: `functions/_lib/entitlements.js`, `assets/js/shared/entitlements.js`, `pricing.html`, `pricing_intents` flow, `functions/receipts.js`, the D1/KV binding structure, migrations, and the dark pricing/entitlements code paths. It also names `functions/interview-prep.js` in its entitlements inventory and flags "artifacts resurrection if in scope" — see §3 for how that constrains cleanup.
3. **Pricing/entitlements stay dark.** Do not surface them anywhere.
4. **Vanilla JS, zero runtime npm deps, no build step for sources.** Deploys minify `/assets` via esbuild in `scripts/pages-deploy.mjs`; never hand-minify repo sources. Never add an npm import to `functions/` or client JS.
5. **Never edit any `*.plan.md` file** (Jacob's personal planning artifacts).
6. **Cache-buster discipline is load-bearing.** `_headers` serves `/assets/*` and `/data/*` with long immutable/SWR caching. Every JS/CSS/data file you change needs a **fresh** `?v=YYYYMMDDx` stamp on **every page that references it** (changed files only — never a blanket re-stamp). A "bumped" stamp identical to one already on the page is a silent no-op. Two production incidents have already come from missed/same-stamp bumps.
7. **Smoke-is-live gotcha:** `npm run pages:smoke` and `npm run hub:smoke` hit the LIVE pages.dev by default. To test pre-push, set `SMOKE_BASE_URL` / `SMOKE_HUB_URL` to a local server. The normal loop per phase is: verify statically → commit → push (deploy) → smoke live.
8. **Hub boot TDZ trap:** any new `let`/`const` in `assets/js/hub/hub-dashboard.js` read by functions reachable from top-level boot (the resize→syncMapHud chain) must be declared before ~line 240. `node --check` cannot catch a violation; the symptom is an infinite spinner with no error. Verify hub boot with `pages:smoke`, not static reading.
9. **Working-tree state at time of writing:** `scripts/verify-hub-lod.mjs` has uncommitted edits (a legitimate sync of the verify script to the landed 2026-07-18 pan-clamp/zoom-floor hub changes), and `docs/FABLE_MACROHUB_BRIEF.md` + `docs/POST_SHIP_FIX_PLAN.md` are untracked. Phase 0 handles all three.
10. **CSS conventions if you touch styles:** entrance animations on re-renderable content must be scoped `body.fw-revealed:not(.fw-settled)` or they replay on every innerHTML rebuild. Pages with `#fw-page-veil` must call `FWPageVeil.notifyRender()` on every render entry point. Don't rename `fw-reveal`/`fw-revealed`/`fw-settled` or global APIs like `FWToast`.
11. **`derived_careers` D1 rows are global cross-user text** — any renderer of derived titles/skills you touch must keep escaping them.
12. **New `data-lucide` icon names** require adding the SVG to `assets/vendor/lucide-lite.js` (full Lucide is not loaded). You should not need any.

### Hub invariants (your primary work area — memorize these)

- **Camera math is viewport-normalized:** `worldToScreen` maps world → full viewport at zoom=1 on both axes. All fit/pan work operates in viewport fractions. Do not change the math's semantics — this plan only changes *when* and *how often* things are computed/drawn, never *what* is computed.
- **Macro overview renders via `overviewLayer`** (offscreen cache in `assets/js/hub/hub-canvas.js:746-802`) plus a per-frame `drawOverviewIdleLayer` twinkle overlay reading `overviewGeoCache` (built by `drawFixedZoneTiles`). New richness belongs in the cached layer; anything added to it must join `overviewLayerKey()` or it won't repaint.
- **Zoom is a banked glide:** `ZOOM_SENSITIVITY` / `ZOOM_GLIDE` in `hub-dashboard.js` accumulate log-zoom; rAF drains it (`stepWheelZoom`). The dot-grid backdrop moves only on drag offsets (`bgOffX/Y`), never on zoom/fly-to — deliberate; keep it.
- **Sector-zoom invariant:** `state.sectorZoom` and `state.zoom` must stay reconciled (`applySectorZoomDelta` reconciles from live world zoom first). A live camera tween mid-wheel-zoom is the classic regression. Never glide across a mode transition (`pendingZoomLog = 0` on mode change).
- **Click-to-fly lock:** `animateCameraTo(..., {locked:true})` sets `camAnim.locked`; every input handler checks `isCameraLocked()` and no-ops during a locked flight. Manual pan/zoom stays interruptible; only discrete click-teleports lock.
- **Zone data boundary:** `careers.json`'s `hubZone` is the *display* zone (post-merge, 10 zones). `zone-centroids.json` and `zone-aggregate-vectors.json` keep the ORIGINAL 18-zone keys and are never rewritten — quiz vector seeding depends on that. Any code reading those files' keys directly needs merge-aware treatment; do not "fix" this asymmetry.
- **Rank-builder guards in `assets/js/shared/onet-vectors.js`** (`rankBuildFailedAt` 30s cooldown at line ~16/978, `rankedFeaturedPromise`/`rankedOnetPromise` in-flight guards) are each a leg of a real fetch-storm fix (~48k requests/15s measured). Never remove while "simplifying."
- **Hub canvas is ALWAYS dark in both site themes** (`isHubLightTheme` hard-forced false in `hub-canvas.js:14`); page chrome around it stays theme-aware. Preserve the split.
- **Vector pipeline is out of scope.** Nothing in this plan touches `FWOnetVectors.hydrateQuizVectors`/`persistQuizVectors`, quiz seeding, `functions/_lib/gap-progress-sync.js`, or any save/merge endpoint. If a change seems to need it — stop, flag it, skip it.

### Verification toolbox (referenced by each phase)

- `node --check <file>` — syntax, every touched JS.
- `npm run hub:verify` — hub data + LOD invariants (`scripts/verify-hub-data.mjs`, `scripts/verify-hub-lod.mjs`).
- `npm run test:vectors` — vector/merge invariants (run as a tripwire after any hub phase even though vectors are out of scope).
- `npm run verify:aliases`, `npm run onet:test` — run in the final phase.
- `npm run pages:smoke` — real page boot against live (or `SMOKE_BASE_URL`); catches TDZ/boot failures.
- `npm run hub:smoke` — hub load probe against live (or `SMOKE_HUB_URL`).
- `node scripts/ui-screenshots.mjs` — committed Playwright harness; stubs `/auth/me`, captures every page × theme × viewport + hub at macro/mid/sector zoom. Capture a **baseline before Phase 1** and diff after every hub-touching phase; renders must be visually identical except where a finding explicitly says otherwise.
- `curl -L` the live URL post-push (pages.dev 308-redirects pretty URLs).

---

## 1. Findings — performance audit (ranked by impact)

All structurally reasoned from the render/data paths (no in-browser profile was taken this session); each is anchored to code so you can re-confirm in minutes. Line numbers are against `c0fcc16`.

### F1 — Sector mode rebuilds the similarity-link graph EVERY FRAME (highest impact)

`hub-dashboard.js` `loop()` calls `FWOnetHub.updateViewport(...)` every frame (line 921). In sector mode `updateViewport` → `refreshSimilarityLinks(lod)` (`hub-onet-map.js:1404` → `:1276`) → `getSimilarityLinks(state.renderCareers)` (`:1272`) → `buildBalancedSectorLinks(...)` — which allocates edge objects, builds degree maps, and for every under-degree node maps over **all** other nodes computing `Math.hypot` distances and **sorts** the result (`hub-onet-map.js:1247-1267`). With 50–150 careers per sector this is O(n²)+n·sorts of garbage-generating work per frame — and sector mode runs the rAF loop unconditionally (F2), so it burns continuously the entire time a user sits in any sector. The link graph depends **only on the career set**, not the camera.

**Fix:** cache the built edge list keyed by `(activeZone, state.renderCareers.length, lens state if it filters the set — it doesn't, lens only dims)`. Invalidate in exactly three places: sector entry (`enterSectorByZone`/mode change), `syncDerivedRows()` when it appends rows (`hub-onet-map.js:1046-1052`, where it already calls `invalidateOverviewLayer`), and vector refreshes that reorder nothing (fit updates don't change the set — no invalidation needed, but `drawSectorLinksScreen` reads live `fitScore` per frame so colors stay fresh automatically).

### F2 — Sector mode runs an unconditional 60fps full-scene redraw, even fully idle

`hub-dashboard.js:959`: `rafId = (needsRedraw || inSector || ...) ? requestAnimationFrame(loop) : null;` — the bare `inSector` term means the loop never parks in sector mode, and `render()` only clears `needsRedraw` in non-sector modes (`hub-canvas.js:1535-1537`), so every frame is a full repaint: background + dot grid + sector wash gradients + cluster backdrop + links + orbs + label pass. Overview mode already parks correctly (except the deliberate, budgeted idle twinkle). Time-driven visuals that genuinely need continuous frames in sector: gold-orb shimmer (`isGoldShimmerActive`, hover/select-gated), satellite bloom springs (`satAnim` in-flight), hover radius lerps (`sectorAnimating`), camera/zoom anims, and the cursor-proximity glow (mouse-driven — `hubPointerMove` already calls `requestHubRedraw` per move at `hub-dashboard.js:1456-1463`).

**Fix (Phase 4, own commit, heavily verified):** replace the bare `inSector` continuation term with sector-specific liveness: `inSector && (sectorAnimating || isGoldShimmerActive() || satBloomInFlight || state.mouseOn)` — conservative first cut keeps `state.mouseOn` so any frame with the pointer over the canvas still animates (proximity glow + blooms are all cursor-coupled); the loop parks only when the pointer leaves and nothing is mid-animation. `pointerleave` already fires `requestHubRedraw` so re-entry re-arms. `satBloomInFlight` needs a cheap flag: set true in `drawSectorOrbsScreen` when any `|target−prev| ≥ 0.004` (it already computes exactly this at `hub-canvas.js:1231`), surfaced via `_api`.

### F3 — Per-frame allocation churn in the sector draw path (GC pressure → frame spikes)

All in `hub-canvas.js`, all recomputed every frame at 60fps:

- `drawSectorClusterBackdrop` (`:1084-1142`): full union-find over careers+edges, fresh `parent`/`groups` objects, double projection pass per member. Group membership is static per career set — cache `{members, …}` alongside the F1 link cache; only the screen projection/centroid needs per-frame work (it must track the camera).
- `drawSectorLinksScreen` (`:1144-1187`): per edge per frame, `orbPalette` twice plus `glow.split(',').map(parseInt)` **string parsing** (`:1163-1164`). Precompute each edge's blended glow RGB once at link-build time (F1 cache) and store it on the edge.
- `drawSectorOrbsScreen` (`:1189-1350`): 2–3 `createRadialGradient` per orb per frame (glow `:1281`, body `:1300`, specular `:1322`). The body+specular gradients depend only on (palette, r, specular offset) — r is stable per orb outside hover lerps. Full gradient caching is fiddly; the cheap 80% win is skipping the glow gradient when `glowStrength` rounds to 0 (already done) and quantizing `r` to 0.25px for a keyed gradient cache `Map` capped at a few hundred entries. Treat this sub-item as optional — do it only if it stays small; the orb count (≤ ~150) makes this third-order next to F1/F2.
- `updateViewport` allocates `visible.map(...)` + `new Set` every frame (`hub-onet-map.js:1393`). Rebuild `mountedIds` only when the career set version changes (same invalidation points as F1).

### F4 — Overview pan/zoom re-renders the entire cached tile layer every frame

`overviewLayerKey()` includes `zoom.toFixed(4)` and rounded pan (`hub-canvas.js:759-770`), so during any drag/glide/fly-to the "cache" misses every frame and `drawFixedZoneTiles` re-renders: 10 zone clusters × (radial wash + blob + rim gradients) + up to 130 dots/zone + the zone-label placement solve. That's the correct design for *idle* (cache hit) but the most expensive possible path for *motion* — exactly when frame budget matters most.

**Fix (Phase 5, optional/stretch — highest complexity in this plan):** during camera motion, blit the last-rendered layer canvas with a transform (`ctx.setTransform` scale/translate derived from the delta between the cached layer's camera key and the live camera), accepting slightly soft labels mid-motion; do a crisp re-render on settle (one frame after `camAnim`/`pendingZoomLog`/drag all go quiet). The twinkle overlay (`drawOverviewIdleLayer`) reads screen-space `overviewGeoCache` — during transformed blits either skip it (motion masks the twinkle) or apply the same transform. **If any visual artifact survives verification, revert this phase entirely and ship without it** — Phases 1–4 already remove the worst costs.

### F5 — Stale preload stamps: dashboard downloads careers.json (340KB) and zone-layout.json twice, every visit

`dashboard.html:20-21` preloads `careers.json?v=20260718c` and `zone-layout.json?v=20260718c`, but runtime fetches use `?v=20260718f` (`assets/js/shared/onet-catalog.js:8`, `hub-onet-map.js:1330`). Different query string = different cache key = the preloads are pure waste AND the real fetches can't use them: ~430KB of duplicate transfer on the hub's critical path. This is the known buster-mismatch incident class. **Fix:** align the preload stamps to the runtime stamps (and add a one-line comment in `dashboard.html` that these must move in lockstep with `CAREERS_URL` / the `hub-onet-map.js` fetch stamps). Check `zone-colors.json` too (fetched with `20260718f`, not preloaded — fine).

### F6 — Per-frame `getComputedStyle` + 600-arc dot grid in the shared canvas background

`assets/js/shared/hub-canvas-bg.js`: `paintHubCanvasBackground` (called every rendered frame by hub and roadmap-tree) calls `getHubCanvasBg()` → `getComputedStyle` (`:7`, style resolution per frame), then draws ~600+ dots each as its own `beginPath/arc/fill` (`:73-78`).

**Fix:** (a) cache the resolved bg color; invalidate on the existing `flightway-theme-change` event (listener already exists in `hub-dashboard.js:1713`; roadmap-tree needs the same invalidation hook — a module-level cache with a `document`-level theme-change listener inside hub-canvas-bg.js itself covers both consumers without touching them). (b) draw all dots in ONE path: single `beginPath()`, per dot `moveTo(x+r, y); arc(...)`, one `fill()`. Identical pixels, one rasterizer pass. Bump busters on every page referencing `hub-canvas-bg.js` (`dashboard.html`, `roadmap.html`).

### F7 — `data-field.js` ambient canvas: continuous rAF with O(n²) neighbor-line pass, no viewport gating

`assets/js/shared/data-field.js` runs a rAF loop with an all-pairs distance/line pass plus per-dot draws. It pauses on `visibilitychange` (`:140`) and respects reduced-motion, but keeps burning when the canvas is scrolled out of view. Loaded on `index.html`, `pricing.html`, `portal.html`, `resume.html`, `roadmap.html` (it only runs where its canvas exists — verify which pages actually mount one before touching). **Fix:** wrap the loop in an `IntersectionObserver` on its canvas (pause when < ~1% visible), mirroring the existing `running` flag mechanics. Low risk, pure addition.

### F8 — Un-debounced window resize on the hub

`hub-dashboard.js:287` binds `resize` directly (the visualViewport path at `:291-294` IS debounced 80ms). Desktop window-drag resizing re-runs canvas reallocation + `overviewLayer` invalidation per event. **Fix:** route the window `resize` listener through the same 80ms timer the visualViewport handler uses. Trivial; verify no boot-order change (TDZ rule §0.8).

### Verified healthy (do NOT "fix" these — each was checked this session)

- Sector label layout is already cached and keyed (`buildSectorLabelLayout` + `sectorLabelCacheKey`, `hub-canvas.js:1002-1058`).
- `syncDerivedRows` early-returns on a cheap row-count compare per frame (`hub-onet-map.js:1037`) — fine.
- Overview idle twinkle is budgeted (~160 dots + 20 motes) and parks under reduced motion — by design; the only allowed change is F6's dot-grid batching underneath it. (A half-rate/delta-timed idle tick was considered and rejected: visible cadence change for ~1ms/frame of savings.)
- Rank-builder fetch-storm guards in `onet-vectors.js` — present and load-bearing (see invariants).
- Catalog + artifact bundle load in parallel; the similarity index (~230KB) lazy-loads on first sector entry (`hub-onet-map.js:1313-1335`) — good.
- Hover hit-testing is a linear scan per pointermove at sector scale (≤ ~150) — fine.
- `hoverRadii`/`satAnim`/`sectorHoverRadii` maps are bounded by catalog size — no leak.
- Script loading: dashboard's ~31 scripts are deferred; consolidation/bundling is a non-goal (§5).
- Panel/suggest DOM rebuilds via innerHTML drop their listeners with the nodes — no accumulation found.
- `functions/` sweep: Gemini calls funnel through `geminiGenerateContent`/`gemini-json.js` with timeouts; no new unbounded upstream call found. No perf work needed server-side in this pass.

---

## 2. Findings — dead code

| Item | Verdict | Evidence |
|---|---|---|
| `functions/simulation-generate.js` | **DELETE** | Zero references anywhere; superseded by `functions/sim-generate.js` (called from `sim-engine.js:1458,1486`, `scripts/pregen-sims.mjs:65`). |
| `functions/quiz-enrich.js` | **DELETE** | Zero callers (client, workers, scripts). The `'quiz-enrich': 'Quiz answers'` string in `sector-fit-sheet.js:194` is a display label for historic dossier provenance rows — keep the label, delete the endpoint. |
| `functions/interview-prep.js` | **KEEP for now — delete after the free/paid merge** | Zero client callers (only a comment mention in `mock-interview.js:2`), but `FREE_PAID_MERGE_MASTERPLAN.md` explicitly lists it in its `requirePlan('premium')` entitlements inventory. Deleting it now silently invalidates that plan's stated facts. Leave a `// DEAD: no callers; delete after free/paid merge (see PERFORMANCE_REVAMP_MASTERPLAN §2)` comment at the top instead. |
| `assets/js/app/artifacts.js` + `functions/artifacts.js` | **KEEP** | Client file is loaded by no HTML page, but the merge plan flags "artifacts resurrection if in scope." Not yours to remove. |
| `Flightway.html` (root) | **KEEP** | Not dead — it's a 1.8KB hash-router redirect shim for legacy links; `_redirects` routes `/dreamforce.html → /Flightway.html`. |
| `assets/js/app/resume-builder.js` | Already gone | Confirmed absent; `resume-page.js` is the live page module. |
| `data/onet/artifacts/careers-excluded.json` (52KB) | **KEEP** | ETL/verify-script input (`verify-hub-data.mjs`, `onet-etl/build.mjs`); never fetched by clients, so no runtime cost. |
| `functions/receipts.js` | **KEEP** | Live: called via `portal-flightplan.js`, `entitlements.js`, `pricing.html`. |
| `igor_work_2_repo/` | Local-only | Untracked donor folder, gitignored. Nothing to do in the repo; optionally tell Jacob it can be moved out of the checkout. |

Deleting the two dead endpoints removes their routes from the deployed Functions bundle. After deploy, `curl -X POST https://flightwayjacobprototype.pages.dev/simulation-generate` (and `/quiz-enrich`) should return the static-404 behavior, and `npm run pages:smoke` must stay green.

## 3. Findings — doc cleanup

**Mechanism:** `git mv` into `docs/archive/` (create it). `/docs/*` is already blocked from public serving by `_redirects`, so the archive is covered. Never delete outright — the move is one commit, fully reversible, and keeps everything greppable. Leave `_redirects` itself untouched (its stale-looking rules are harmless defense-in-depth).

**KEEP in place (living/active):**
- `docs/CONVERSATION_HANDOFF.md` — canonical session handoff. You will APPEND an addendum in the final phase.
- `docs/FREE_PAID_MERGE_MASTERPLAN.md` — active, unexecuted. Untouchable.
- `docs/ARCHITECTURE.md`, `docs/SETUP.md` — living infra reference.
- `docs/AI_EXPOSURE_METHOD.md`, `docs/CAREER_TESTER.md` — small living method/feature references.
- `docs/PERFORMANCE_REVAMP_MASTERPLAN.md` — this file; archive it yourself in the final phase once executed.

**ARCHIVE (each documents completed, shipped work; one-line reason):**
- `AUDIT_REPORT.md` — Phase-0 audit; every issue closed via the Phase 1–4 addenda in the handoff.
- `CONSOLIDATION_RESEARCH.md` — June research pre-dating the O*NET architecture.
- `FLIGHTWAY_2.0_WEEK1.md` — executed build log.
- `FRAGMENT_CAREERS_PLAN.md` — fragments/satellites shipped (live in hub sector view).
- `LAUNCH_POLISH_BRIEF.md` — executed 2026-07-16.
- `PILLAR_W_WEB_GROUNDING_DESIGN.md` — shipped 2026-07-17 (grounding lives behind `GROUNDING_ENABLED`, currently off; runtime knowledge is in the handoff).
- `POLISH_AND_INTEGRATION_PLAN.md` — executed (Phases 1–4 addenda).
- `PRODUCTION_LAUNCH_REVIEW.md` — executed 2026-07-16. **Before archiving, re-read its open manual-action items** (env-var audits etc.); anything still undone gets one line in your final handoff addendum so it isn't lost.
- `RESUME_AND_INTERVIEW_MASTERPLAN.md` — executed 2026-07-17 PM2.
- `SESSION_KICKOFF.md` — stale session bootstrap.
- `UI_POLISH_AND_AUDIT_REVIEW.md` — executed 2026-07-17.
- `UX_TRUST_OVERHAUL_BRIEF.md` — executed 2026-07-16.
- `UI_POLISH_MASTERPLAN_2026-07-18.md` — Phases 0–4 landed 2026-07-18 (`f3250d3`..`c0fcc16`). **Verify completion against `git log` first** (Phase 4 lists per-screen items); if any screen is clearly unexecuted, note it in the handoff addendum, archive anyway.
- `FABLE_MACROHUB_BRIEF.md` (currently untracked) — macro-hub redesign shipped (`2626361`..`ac3c4d7`). `git add` directly into `docs/archive/`.
- `POST_SHIP_FIX_PLAN.md` (currently untracked) — executed in full (`b4de7ba`..`5602a48`). `git add` directly into `docs/archive/`.
- Root `HANDOFF_20260710_exposure_and_overview.md` — completed handoff (says so in its own header); move to `docs/archive/` (also removes a stray root file from the public upload set; its `_redirects` block rule can stay).

**Local-only (untracked, gitignored — no commit involved):** root `FLIGHTWAY_LAUNCH_REVIEW_BRIEF.md` and `FLIGHTWAY_UI_POLISH_AND_AUDIT_BRIEF.md` are historical briefs excluded from git and from upload; leave them (or tell Jacob they're safe to delete locally).

---

## 4. Phased execution plan

Sequence: cheap/safe wins → cleanup → sector efficiency → loop gating → optional overview blit → app sweep → final. Each phase = its own commit(s) + push + live verification before the next. If a phase fails verification and the fix isn't obvious within one targeted attempt, **revert that phase** and continue — later phases don't depend on earlier optional ones (only Phase 4 builds on Phase 3's cache flags, noted there).

### Phase 0 — Preflight & baseline (no behavior change)

1. Reconcile handoff vs `git log` (§0.1).
2. Commit the pending `scripts/verify-hub-lod.mjs` sync as its own commit (it mirrors landed hub pan-clamp/zoom-floor changes) — first confirm `npm run hub:verify` passes with it.
3. Run and record green: `npm run hub:verify`, `npm run test:vectors`, `npm run pages:smoke`, `npm run hub:smoke`.
4. Capture the screenshot baseline: `node scripts/ui-screenshots.mjs` — keep the output dir for diffing.

**Gate:** all four commands green. If anything is already red, stop and fix/report before proceeding — do not optimize on a red baseline.

### Phase 1 — Quick wins (F5, F6, F8) — low risk, high value

1. **F5:** align `dashboard.html:20-21` preload stamps to `20260718f` (re-verify the live runtime stamps first) + lockstep comment.
2. **F6:** color cache + single-path dot batch in `hub-canvas-bg.js`. Fresh buster on `dashboard.html` and `roadmap.html` references.
3. **F8:** debounce the hub window-resize through the existing 80ms timer pattern. Buster bump `hub-dashboard.js` on `dashboard.html`.

**Invariants in play:** dot grid stays drag-offset-keyed; always-dark canvas; TDZ rule for any new top-of-file state in hub-dashboard.js.
**Verify:** `node --check` on touched JS → commit/push → `pages:smoke`, `hub:smoke`, screenshot diff vs baseline (hub macro/mid/sector must be pixel-identical), DevTools-free sanity: `curl -sI` the two preloaded artifact URLs with the new stamp return 200.

### Phase 2 — Dead code + doc archive (zero runtime risk by construction)

1. Delete `functions/simulation-generate.js` and `functions/quiz-enrich.js`. Re-grep for references first (`grep -rn "simulation-generate\|quiz-enrich" assets functions workers scripts *.html` — expect only the sector-fit-sheet label line).
2. Add the `// DEAD: …` comment to `functions/interview-prep.js` (§2). Do not delete it.
3. Create `docs/archive/`, `git mv` every doc in §3's archive list; `git add` the two untracked docs directly into it.
4. Nothing else in this phase touches `assets/` — no busters needed.

**Verify:** commit/push → `pages:smoke` green; `curl -X POST` the two deleted endpoints (expect no function response); spot-`curl -L https://flightwayjacobprototype.pages.dev/docs/archive/AUDIT_REPORT.md` redirects away (302 → `/`).

### Phase 3 — Sector render efficiency (F1 + F3) — the core payoff

Tightly scoped to caching what is already computed; **zero changes to what gets drawn or where.**

1. **F1 link cache:** in `hub-onet-map.js`, cache `buildBalancedSectorLinks` output keyed by `(state.activeZone, state.renderCareers.length)`; module-level, cleared on mode change to overview. Invalidate in `syncDerivedRows`'s append branch (next to the existing `invalidateOverviewLayer` call) and on sector entry.
2. **F3 backdrop cache:** cache the union-find group *membership* with the same key/invalidation; keep per-frame screen projection of centroids/radii.
3. **F3 edge color precompute:** at link-build time, store each edge's blended glow `r,g,b` ints; `drawSectorLinksScreen` drops `orbPalette`+`split(',').map(parseInt)` per frame. NOTE: current code reads **live** `fitScore` per frame for alpha/width — keep reading fit live (it changes when vector batches land); only the *palette parse* moves to build time, and rarity palettes are fit-banded, so re-check: if an orb's fit crosses a rarity band after a vector batch lands, edge colors must refresh → simplest correct answer: also invalidate this cache in the vectors-updated path (`notifyVectorsUpdated` / `applyGlobalCosineFits` call sites), which already triggers redraws.
4. **F3 `mountedIds`:** rebuild the Set only when the career-set version changes.
5. Skip the orb gradient cache (optional sub-item) unless steps 1–4 land clean and trivially; it's third-order.

**Invariants in play:** sector-zoom reconciliation and camera lock untouched (you're not in that code); satellites/fragments render identically; `derived_careers` text stays escaped in any tooltip/label path you touch (you shouldn't touch any).
**Verify:** `node --check` all touched → `npm run hub:verify` → `npm run test:vectors` (tripwire) → commit/push → `hub:smoke`, `pages:smoke` → screenshot diff: sector-zoom captures must be visually identical (same links, same colors, same labels). Then a manual live check: enter a sector, confirm links/backdrop present, open a career panel, use Career Tester derive if quick (derived satellite must appear WITH its tether — that's the `syncDerivedRows` invalidation path proving out).

### Phase 4 — Sector frame-loop gating (F2) — HIGH RISK, own phase, own commit

Depends on Phase 3 only for the `satBloomInFlight` flag plumbing (add it here if you skipped nothing).

1. Add `_api.satBloomActive` set inside `drawSectorOrbsScreen`'s bloom step when any satellite is mid-spring.
2. Change `hub-dashboard.js:959`'s continuation: `inSector` → `(inSector && (sectorAnimating || isGoldShimmerActive() || (window.FWHubCanvasRender && FWHubCanvasRender.satBloomActive) || state.mouseOn))` (exact wiring per the module's `_api` idiom — hub-canvas exposes via `FWHubCanvasRender`). Also ensure sector `needsRedraw` isn't permanently truthy: mirror the overview behavior by clearing `needsRedraw` at the end of `render()` for sector too **only if** every dynamic trigger above re-arms via `requestHubRedraw` (pointermove does: `hub-dashboard.js:1456-1463`; wheel/camera/flights do via their step functions; panel open/close and lens toggle call `requestHubRedraw` — grep-verify each before flipping).
3. Reduced-motion path must behave exactly as before (loop parks; no shimmer/bloom anyway).

**The known failure mode:** a stale frame — some state change (tooltip, lens toggle, fit-vector batch landing, satellite appearing, theme change) that previously relied on the free-running loop now needs an explicit `requestHubRedraw`. Grep every writer of sector-visible state and confirm each has one.
**Verify (heaviest of the plan):** `node --check` → commit/push → `pages:smoke` + `hub:smoke` → screenshot harness sector captures identical → live manual pass: hover orbs (proximity glow follows cursor), hover a gold orb ≥70 fit (shimmer pulses), approach a satellite (bloom springs out and label fades in), toggle the lens, open/close the panel, wheel-zoom in/out (glide smooth, no snap), click-fly to a career and back, switch theme, leave the pointer off-canvas 10s then re-enter (frame must be current, not stale). If ANY stale frame appears and the missing redraw isn't found in one targeted fix: `git revert` this commit and move on — Phases 1+3 already deliver the bulk of the win.

### Phase 5 — OPTIONAL: overview pan/zoom transform-blit (F4) — highest complexity, skip-friendly

Only attempt if Phases 3–4 verified clean and you judge the remaining pan/zoom cost worth it (a quick heuristic: on the live site, macro-view drag on a laptop-class machine — if it's already fluid, skip and note the option in the addendum).

- Blit `overviewLayer.canvas` with a derived transform during camera motion; crisp re-render on settle; twinkle overlay skipped (or transformed) during motion frames.
- **Invariants:** viewport-normalized camera math untouched — the transform is derived FROM the existing pan/zoom values, never fed back into them. Dot-grid stays screen-fixed during zoom (it's drawn by `paintHubCanvasBackground` under the layer, keyed to drag offsets — do not transform it).
- **Verify:** screenshot diff at macro + mid zoom (idle frames must be pixel-identical; motion frames may soften), full manual pan/zoom/fly-to pass, `hub:smoke`, `pages:smoke`. Revert wholesale on any artifact (label ghosting, seams, twinkle misregistration).

### Phase 6 — Rest-of-app sweep (F7 + verification-only checks)

1. **F7:** IntersectionObserver gating in `data-field.js`; verify first which pages actually mount its canvas; buster bump on each referencing page. Reduced-motion single-frame path must still paint.
2. Verification-only (no code unless a real violation surfaces): confirm `sim-engine.js:797` and `interview-mode.js:402` `setInterval`s are cleared on teardown/navigation; confirm `roadmap-tree.js` has no free-running rAF (audit found none); confirm no other page hosts a continuous animation loop (`grep -rn "requestAnimationFrame" assets/js` and check each loop's park condition).

**Verify:** `node --check` → commit/push → `pages:smoke` → screenshot diff on landing/pricing/portal/resume/roadmap.

### Phase 7 — Final verification, handoff, ship

1. Full suite: `npm run hub:verify`, `npm run test:vectors`, `npm run verify:aliases`, `npm run onet:test`, `npm run pages:smoke`, `npm run hub:smoke`, full `node scripts/ui-screenshots.mjs` diff vs the Phase-0 baseline.
2. Append a dated addendum to `docs/CONVERSATION_HANDOFF.md`: what landed per phase (with commit hashes), what was skipped/reverted and why, any open items mined from `PRODUCTION_LAUNCH_REVIEW.md`, and **this required line: "The free/paid merge plan (`docs/FREE_PAID_MERGE_MASTERPLAN.md`) was written against a pre-revamp commit history — re-verify its repo-state claims against current `git log` before executing it."**
3. `git mv` this file to `docs/archive/`.
4. Final commit/push; `curl -L` the live dashboard + one deep career URL; confirm headers still show the immutable caching on a bumped asset.

---

## 5. Non-goals / do-not-touch (human-decision-only or explicitly out of scope)

- `main` branch, production `flightway.ai` — never.
- `docs/FREE_PAID_MERGE_MASTERPLAN.md` and everything §0.2 lists it depending on. This plan was checked against it and requires **no change to its assumptions**.
- Pricing/entitlements surfacing, Stripe, plan gating — dark, stays dark.
- Any `*.plan.md` file.
- Vector pipeline writes, quiz state, hydration, `gap-progress-sync`, any `PUT`/save-merge endpoint.
- Hub camera *semantics*: zoom glide feel (`ZOOM_SENSITIVITY`/`ZOOM_GLIDE` values), fly-to timings, lock behavior, zone membership/layout coords, `hub-zone-map.json`, the 18-zone keys in `zone-centroids.json`/`zone-aggregate-vectors.json`.
- Script-tag consolidation/bundling, source minification, framework/build-step introduction, npm runtime deps.
- `functions/interview-prep.js`, `functions/artifacts.js`, `assets/js/app/artifacts.js` deletion (deferred past the merge).
- Deleting anything from `_redirects`.
- ETL artifact regeneration (`/data/*` contents unchanged ⇒ no `?v=` churn on data files except the Phase-1 preload alignment, which changes HTML only).

## 6. Risk register (read before the phase it names)

| Risk | Phase | Mitigation |
|---|---|---|
| Stale-frame regressions from loop gating | 4 | Own commit; exhaustive manual trigger list in-phase; revert wholesale on any miss. |
| Link/backdrop cache serving a stale career set (derived career lands, no tether) | 3 | Invalidate exactly where `syncDerivedRows` already invalidates the overview layer; live derive-career check in-phase. |
| Edge colors stale after a fit-band crossing | 3 | Invalidate the color precompute on the vectors-updated path; screenshot + live check. |
| Overview blit visual artifacts (label ghosting, twinkle misregistration) | 5 | Optional phase; pixel-diff gates; revert wholesale. |
| TDZ boot failure from any new hub-dashboard top-level state | 1,4 | Declare before ~line 240; `pages:smoke` after every hub commit. |
| Missed/same-stamp buster pinning users to stale JS | 1,3,4,6 | Fresh stamp per changed file per referencing page; `curl -sI` the new URLs live. |
| Deleting an endpoint something secretly calls | 2 | Zero-ref greps re-run at execution time; smoke + live curl after deploy. |
| Doc archive losing a live open item | 2 | Mine `PRODUCTION_LAUNCH_REVIEW.md` open items into the handoff addendum before archiving. |
| Screenshot harness false-positives (twinkle/anim frames) | all | Diff idle-state captures; the harness already snapshots deterministic states — compare like-for-like zoom tiers. |

*End of plan. Written 2026-07-18 against `Jacob_Work` @ `c0fcc16`.*
