# FlightWay Overhaul Masterplan — 2026-07-20

This is the single execution document for (1) seven researched fixes and (2) the full product
overhaul: brand/typography, site-wide fluid layout, polish sweep, Marco product + persona
overhaul, feature onboarding / contextual guidance, free-tier activation, and performance.
Every root cause below was verified against the repo on 2026-07-20 (HEAD `2cfac69`). File:line
references are real — re-verify with a grep before editing if the file has since changed.

**Read first, in order:** `CLAUDE.md` → `docs/CONVERSATION_HANDOFF.md` (newest addendum) →
`git log --oneline -10` → this document, fully, before writing any code.

---

## Part 0 — Operating framework (binding for the executing agent)

### 0.1 Ground rules
1. **Deploy = `git push origin Jacob_Work`.** Cloudflare Pages auto-builds project
   `flightwayjacobprototype`. NEVER run `npm run deploy:prototype` or push `main`.
2. **Vanilla JS only. Zero new npm runtime dependencies. No frameworks, no build step.**
   Extend existing modules (`FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, `FWPageBoot`,
   `FWPageVeil`, `FWErr`, `FWButtonBusy`) — never add a parallel system for something a
   module already owns.
3. **Cache busters:** `/assets/*` ships `immutable, max-age=1y` (`_headers`). Every changed
   asset needs a FRESH `?v=YYYYMMDD<letter>` stamp on every page referencing it — changed
   files only, never a blanket re-stamp, and never reuse a stamp that already shipped today
   with different file content (that exact mistake caused the favicon bug — see Fix 7).
4. **Verification is scripts, not re-reading:** `npm run test:vectors`, `hub:verify`,
   `hub:smoke`, `pages:smoke`, `onet:test`, `verify:aliases`, `test:entitlements`,
   `test:user`, `verify:user`, `test:sync`, `hero:check`, `node --check` on every touched JS.
   Extend these suites when you add invariants; a new invariant without a script is unfinished.
5. **One commit per slice** (slices defined below), imperative message, verification gate run
   before each commit. Push at the end of each phase, then verify live:
   `curl -L https://flightwayjacobprototype.pages.dev/<page>` + `npm run pages:smoke`.
   If the deploy stalls (subdomain 404), re-trigger with an empty commit.
6. **Progress ledger:** maintain `docs/OVERHAUL_PROGRESS.md` — a checkbox per slice, updated
   as you go, with a one-line note per completed slice and any deviation. If your context
   resets, resume from the ledger, not from memory.
7. **Handoff:** append an addendum to `docs/CONVERSATION_HANDOFF.md` at the end of each phase.

### 0.2 Load-bearing invariants (violating any of these is a failed run)
- **Vector rebuild idempotence:** every personality/objective vector mutation must be an
  input replayed by BOTH the client rebuild (`FWOnetVectors.hydrateQuizVectors`) and the
  server rebuild. Anything applied outside the replay is silently wiped on next hydration.
- **Client/server math parity:** `assets/js/shared/onet-math.js` `cosine()` must stay
  identical to `functions/_lib/onet/math.js`. Any scoring change lands in both, same commit.
- **Single vector writer server-side:** `gap-progress-sync` is the one server-side vector
  writer. Do not add a second.
- **KEY_MAP duplication:** the v2 user-object KEY_MAP exists in BOTH client facade and
  server; any new persisted user key is added to both + the user-sync registry, verified by
  `verify:user` / `test:user` / `test:sync`.
- **School single source of truth:** `school.js` owns school; every advice prompt includes
  `schoolPromptBlock()`. New prompts too.
- **Hub boot TDZ trap:** any `let`/`const` read by functions reachable from top-level boot in
  `hub-dashboard.js` must be declared before ~line 240. `node --check` can't catch it;
  violation = infinite spinner. `pages:smoke` / `hub:smoke` after every hub-boot-path edit.
- **Gemini JSON mode:** always `thinkingConfig: { thinkingBudget: 0 }`; every upstream call
  carries `timeoutMs`; every retry cascade has a wall-clock budget below the client timeout;
  best-effort results returned, never discarded. Normalize model-mangled keys before lookup.
- **Grounding:** sources are opaque `vertexaisearch` redirect URLs — origin checks are
  worthless; never show raw grounding URLs as if they were the publisher.
- **User text into prompts:** fence as data (mirror the fencing in `career-roadmap.js`).
- **No `innerHTML` with unescaped user/model input.** Reuse the existing `esc`/`escAttr`
  helpers per file.
- **New `data-lucide` icons must be added to `assets/vendor/lucide-lite.js` first.**
- **O*NET levels are already 0–100** — never rescale from 0–7 in display code.
- **Never edit `*.plan.md` files.**

### 0.3 Working style
- Bounded, direct depth: trace the specific path a change touches; no open-ended
  rule-out-everything passes. Grep before reading; read with offset/limit.
- Match each file's existing idiom exactly (var vs const, IIFE modules, comment density).
- Comments only for constraints the code can't show.
- Prefer `Edit` diffs over rewrites, except where a slice explicitly says "rebuild".
- If blocked on something only Jacob can do (secrets, Stripe, remote D1 apply, flag flips):
  record it in the ledger under "Human-gated", skip forward, keep building. Never stall.
- Dark mode + `prefers-reduced-motion` parity on every surface you touch. Entrances use the
  `fw-revealed` / `fw-settled` convention with `FWPageVeil`.

### 0.4 Decisions already made — do not relitigate
- Display font: **Space Grotesk** (500/600/700). Body font: **Inter**, self-hosted. No
  external font requests anywhere.
- Wordmark becomes an SVG lockup (bird + set type), rendered by `brand.js`.
- Marco chat transport stays JSON request/response in slice D3, upgraded to SSE streaming in
  slice D6 (both fully specified below — do both).
- Satellite fix is BOTH server re-key at read time AND client hardening (defense in depth).
- Sector fit becomes a representativeness-weighted centroid computed in the ETL, consumed by
  client and server (spec in Fix 3).
- Feature-intro persistence lives in the v2 user object (`featureIntros` key) with a
  localStorage fallback for signed-out users.
- Pricing page stays dark-themed.
- The free tier gets the full overhaul; caps surface elegantly (meters + upgrade moments),
  never as broken-feeling walls.

---

## Part 1 — Phase 1: The seven fixes

Order: 1.4 → 1.7 → 1.5 → 1.2 → 1.1 → 1.3 (trivial → deepest; 1.6 is absorbed into WS-B).
One commit each. Gate listed per fix.

### Fix 1.4 — Remove "Go to home" from app navs
**Root cause:** `assets/js/shared/auth-nav.js:36-53` — `syncNavLink()` converts the nav's
sign-in link into a "Go to home" tab when signed in. Every app page already has a Home tab
(`data-app-nav="home"`), so signed-in users see both.
**Change:**
- In `syncNavLink()`: when signed in, hide the link entirely (`link.hidden = true`,
  `aria-hidden="true"`, and clear text/href) instead of converting it. Signed-out behavior
  (Sign in) unchanged. Keep `syncQuizTab()` as is.
- Verify every page that carries `nav-signin-link` also has the Home tab: `simulation.html`,
  `resume.html`, `admin.html`, `career.html`, `coach.html`, `auth.html`, `roadmap.html`,
  `quiz.html`, `portal.html`, `profile-build.html` (grep `data-app-nav="home"` in each; add
  the tab where missing, matching `portal.html:33` markup).
- Landing page (`index.html`) uses `assets/js/landing/auth-cta.js`, which swaps hero CTAs to
  "Go to home" — that is a hero CTA, not a nav tab. Keep the swap but rename its label to
  "Open FlightWay" (three occurrences, lines ~10-32).
**Gate:** `node --check` on auth-nav.js + `pages:smoke`. Manual: signed-in portal shows one
Home affordance; signed-out shows Sign in.
**Buster:** bump `auth-nav.js` and `auth-cta.js` stamps on every page referencing them.

### Fix 1.7 — Favicon shows the old arrow
**Root cause (verified):** all 15 HTML pages reference identical icon links at
`?v=20260717h`, and all three icon files on disk ARE the current eagle (extracted the .ico
frames to confirm). The icon files were swapped the same day the `20260717h` stamp was
minted (file mtimes Jul 17 10:23–10:27) — the classic same-stamp gotcha: browsers that
fetched the OLD arrow under the SAME URL cached it, and `/assets/favicon.png` sits under the
`_headers` `/assets/* immutable, max-age=1y` rule, pinning the arrow for up to a year.
Safari's separate favicon store makes it stickier still.
**Change (rename to defeat every cache layer):**
- Move icons to new paths: `assets/icons/favicon-128.png`, `assets/icons/apple-touch-180.png`
  (copy existing correct art). Add an SVG favicon `assets/icons/favicon.svg` built from the
  bird mark (crisp at all sizes; do this now if WS-A's SVG exists, else after WS-A slice A2
  — then this fix just pre-bumps the PNG links).
- Update the three `<link rel=...>` tags on ALL 15 pages to the new paths with a fresh stamp
  (e.g. `?v=20260721a`), adding `<link rel="icon" type="image/svg+xml" ...>` first.
- Replace root `/favicon.ico` content in place (it already has correct art; keep it for
  legacy auto-requests) and bump its `?v=` in the link tags.
**Gate:** `curl -sL` each new busted URL returns 200 with correct bytes;
`grep -c 'favicon-128' *.html` == 15. Note in the final report that Jacob's own Safari may
need its favicon cache cleared once; new users are fixed regardless.

### Fix 1.5 — Portal uses the whole window
**Root cause:** `assets/css/flightway-pages.css:1311` — `.portal-wrap { max-width: 1040px;
margin: 0 auto; }` centers a fixed column, leaving huge dead margins on wide screens.
**Change (this is WS-B slice B0, executed in Phase 1):**
- `.portal-wrap` → `width: min(1760px, 94vw); margin-inline: auto;` and becomes a 12-column
  grid at ≥1280px: `portal-head` spans 12; the target-career card (`#portal-actions`
  contents) spans 8, setup checklist + snapshot rail spans 4 (sticky at ≥1440px); the tool
  cards (`#portal-fw2-stack`) become `grid-template-columns: repeat(auto-fit,
  minmax(320px, 1fr))` spanning 12. Below 1280px, single column exactly as today.
- Check `assets/js/app/portal.js` render functions only for wrappers that hard-assume one
  column (grep `portal-fw2-stack`, `portal-actions` class usage); add grid-area classes to
  the containers rather than restructuring JS-generated markup where possible.
- Welcome type scales: `clamp(2.2rem, 1.5rem + 2.2vw, 3.6rem)` on the portal H1.
- `#page-roadmap .portal-wrap` override at `flightway-pages.css:2310` gets the same fluid
  treatment (verify visually via screenshot harness).
**Gate:** `pages:smoke`; screenshot portal at 1280 / 1680 / 2560 wide — no dead gutter
beyond the 94vw frame, no card stretched past ~640px text measure.
**Buster:** flightway-pages.css stamp on portal.html + roadmap.html (and any page sharing it).

### Fix 1.2 — AI-derived satellites missing from the hub
**Root cause (verified end-to-end):** derived "fragment" careers snapshot their parent's
display fields into D1 at generation time — `functions/_lib/derive-career.js:116`
(`hubZone: baseRow.hubZone`) and `:109` (`offsetLayout(baseRow)` sector coords) are frozen
into `row_json` (`migrations/0005_derived_careers.sql`). The 2026-07-18 macro-hub rezone
renamed/merged zones (current canon in `data/onet/artifacts/zone-layout.json`: `tech,
healthcare, engineering-science, creative-media, business-finance, education, law, social,
government, trades`). Every fragment generated before the rezone carries a dead `hubZone`.
The client buckets rows by `hubZone` verbatim (`hub-onet-map.js:495-503` via
`mapOnetCareer` ~:986) and sector mode renders only `state.careersByZone[state.activeZone]`
(`updateViewport`, :1420-1428) — rows in dead buckets render NOWHERE (overview draws zone
tiles only). Stale snapshot coords also poison the fallback position path when
`fragmentSectorXY` (:1657) can't find the parent.
**Change:**
1. **Server re-key at read time** (`functions/_lib/derive-career.js`): in
   `getAllDerivedRows` (~:180) and the per-base SELECT (~:409), after `JSON.parse`, resolve
   the CURRENT base row (the store already loads careers artifacts — see
   `functions/_lib/onet/store.js`) and overwrite `hubZone`, `orbColor`, `jobZone`,
   `collarCategory` from it; recompute `offsetLayout` coords from the current base row. If
   the base SOC no longer exists or is excluded → drop the row from the response (orphan
   policy: satellites without a live parent are never served). Do the artifact lookup once
   per request, not per row.
2. **Client hardening** (`hub-onet-map.js` `mapRowsToCareers` ~:1017): for `aiDerived` rows,
   resolve the parent in the live catalog by `derivedFrom.soc`; if found, force `hubZone`
   and `orbColor` from the parent; if not found, skip the row (don't push orphans into
   `state.all`). This makes the hub robust to ANY future rezone regardless of server state.
3. **Backfill script** `scripts/backfill-derived-zones.mjs`: reads current careers.json,
   emits the `wrangler d1 execute` statements (or a `--apply` mode) rewriting stale
   `row_json` fields; test locally against a fixture. Mark actual remote-D1 run as
   **Human-gated** in the ledger (belt-and-braces; the read-time re-key already fixes serving).
4. **Regression guard:** extend `scripts/verify-hub-data.mjs` (`hub:verify`): every derived
   row served by a fixture pass of the re-key function has `hubZone` ∈ zone-layout keys and
   a live parent; add a stale-row fixture unit test for the re-key path.
**Gate:** `hub:verify` + `hub:smoke` + new fixture test green; live after push:
`curl -s 'https://flightwayjacobprototype.pages.dev/derive-career?all=1'` — every fragment's
`hubZone` is a current zone.

### Fix 1.1 — Career hub open lag
**Verified contributors:**
- `dashboard.html:26` — render-blocking Google Fonts stylesheet (fixed for good by WS-A
  self-hosting; do not band-aid here).
- `hub-dashboard.js:1791` — `warmHubFragments()` fires during boot: a `/derive-career?all=1`
  D1 scan plus (signed-in) a `POST /derive-career` with `timeoutMs: 60000`, contending with
  the `careers.json` (347KB) + `zone-layout.json` critical fetches.
- ~400KB of hub JS parsed at boot; `career-personalize.js` (65KB), `hub-academics.js`
  (27KB), `career-compare.js` (16KB), `career-deep-dives.js` (10KB) are all deferred
  scripts but none is needed for first paint.
- Canvas overview layer: per-frame glow/sparkle work in `hub-canvas.js` (sparkles ~:374-399,
  idle overlay ~:463); `shadowBlur` on canvas is notoriously slow if used per-orb per-frame.
**Change (in this order, measuring as you go):**
1. **Instrument first:** add `performance.mark`/`measure` around boot stages in
   `hub-dashboard.js` (script-eval end → `loadCore` resolved → `buildZoneIndexes` done →
   first canvas paint → veil release) emitting ONE `[fw-perf]` console line. Keep it
   permanently. Record before/after numbers in the ledger.
2. **Defer fragment warming:** wrap the `warmHubFragments()` call (:1791) in
   `requestIdleCallback` (fallback `setTimeout` 1500ms) after first paint. `syncDerivedRows`
   already folds rows in whenever they arrive (:1039); nothing else changes.
3. **Lazy-load panel-only modules:** remove `career-personalize.js`, `hub-academics.js`,
   `career-compare.js`, `career-deep-dives.js` `<script>` tags from `dashboard.html`; inject
   them (with their current busters) on first panel open OR on idle, whichever comes first,
   via one small loader in `hub-dashboard.js`. FIRST grep every `window.FW*` reference to
   these modules in the hub files and confirm each call site is existence-guarded (add
   guards where missing). Injection must be idempotent.
4. **Canvas paint audit (only if step 1 shows paint cost > ~4ms/frame at overview):**
   pre-render orb sprites (zone color × 3 radii, normal+glow variants) to offscreen canvases
   once per DPR change, `drawImage` per orb; eliminate per-frame `shadowBlur`.
5. Confirm `career-descriptions.json` (185KB) stays lazy (loaded via `descPromise`,
   `onet-catalog.js:106` — verify its trigger is drawer/panel, not boot).
**Acceptance:** repeat-visit dashboard first-paint ≤ 600ms and no post-paint long task
> 120ms on a mid-tier laptop; cold ≤ 2.5s. fw-perf line proves it.
**Gate:** `hub:verify:full` (hub:verify + hub:smoke + pages:smoke). TDZ rule 0.2 applies.

### Fix 1.3 — Personality-vector distinctness + weighted sector fit
This is the deepest fix. It changes scoring; every change must be replay-idempotent (0.2)
and land client+server in the same commit.

**Current behavior (verified):**
- Quiz seed (`onet-vectors.js:842-899` `seedPersonalityFromQuiz`): blends top-3 sector
  centroids with weights `(score/100)^2`, expands contrast ×1.6 around 50, zeroes dims
  within ±10 of 50. Blending three broadly-similar centroids yields a mushy direction →
  moderate cosine to nearly everything.
- Sharpen matches (`refine-map.js`, applied via `refreshPersonalityFromRefine` :227) and
  know-you-better / resume themes (`onet-vectors.js:1380-1610`: `PROFILE_BOOST_SCALE = 10`,
  `MAX_THEME_DELTA = 15`, `MAX_RULES_LAYER = 25`, `NON_DOMINANT_ATTENUATION = 0.08`) add
  positive mass across many dims — each source smears the direction further.
- Sector fit (`hub-zone-fit.js:95` `computeZoneFitsMap`): centered cosine against the zone's
  UNWEIGHTED career-mean (`lvMean` from `zone-aggregate-vectors.json`, folded 18→display by
  count-weighted average in `mergeToDisplayZones` :38). Outlier careers dilute the centroid.
- Display: `cosinePercent = round(cos × 100)` clamped at 0 (`onet-math.js:51`), cosine is
  mean-centered Pearson-style (:37). Server parity file: `functions/_lib/onet/math.js`.

**Target behavior:** onboarding (quiz + sharpen + know-you) produces a vector with ONE clear
direction: cosine spread across careers is wide (some high, some near/below zero), the
user's declared interest area dominates, and sector fit reflects each zone's REPRESENTATIVE
careers, not its outliers.

**Change spec:**
1. **Seed gain restructure** (`seedPersonalityFromQuiz`):
   - Weight exponent 2 → 4: `w = (score/100)^4` (90-vs-60 sector goes from 2.25:1 to ~5:1).
   - **Interest-area amplification:** after blending, amplify dims where the TOP sector's
     centroid agrees in direction: with `d_i = values_i − 50` and `t_i = topCentroid_i − 50`,
     when `sign(d_i) == sign(t_i)` and `|t_i| ≥ 8`, use gain `G_hi` (start 1.9); otherwise
     `G_lo` (start 1.25). Replaces the flat ×1.6. Keep the ±10 zeroing after amplification.
2. **Per-source contribution budgets + directional gating** (sharpen + know-you + resume):
   - Each source's pending deltas pass a direction gate before application: deltas that push
     a dim FURTHER from 50 in the direction the current vector already points apply at 1.0×;
     deltas that open a currently-zeroed/estimated dim apply at 0.5×; deltas that FIGHT the
     existing direction apply at 0.25× (new information may still move it, slowly).
   - Add an L1 budget per source layer: total |delta| applied per source capped (start:
     refine 120, profile/know-you 150, resume 150 vector-points); scale down
     proportionally when exceeded. Keep existing per-dim caps.
   - Implement inside the existing replay path (the same functions `hydrateQuizVectors`
     re-runs) so rebuilds stay idempotent — grep the hydration call graph and confirm every
     new constant lives where BOTH client and server rebuilds read it.
3. **Weighted sector centroid (ETL):** in `scripts/onet-etl/` (the step that writes
   `zone-aggregate-vectors.json`; check `build.mjs` and `rezone-hub.mjs` for the writer):
   per zone compute `c0` = unweighted mean; per career `rep_j = max(0, cosine(v_j, c0))`
   (centered cosine, same math module); weight `w_j = rep_j^3`; store `lvMeanW` =
   `Σ w_j v_j / Σ w_j` and `repWeightSum` alongside the existing `lvMean` (schema stays
   backward compatible). `mergeToDisplayZones` (`hub-zone-fit.js:38`) folds `lvMeanW` using
   `repWeightSum` as the fold weight. `computeZoneFitsMap` and the server consumers
   (`functions/_lib/onet/store.js:298`, `functions/_lib/onet/zone-profiles-fallback.js`)
   read `lvMeanW` with `lvMean` fallback. Rebuild artifacts via `npm run onet:build`; the
   `/data/*` cache rule is 1-day max-age, no busters needed, but bump the artifact
   `?v=` stamps that DO appear in fetch URLs (`AGGREGATES_URL` etc. — grep for them).
4. **Tuning harness (build BEFORE tuning, tune until green):** extend
   `scripts/test-vectors.cjs` with four fixture personas (quant-finance-leaning,
   healthcare-leaning, creative-leaning, trades-leaning; each = quiz scores + a sharpen
   answer set + a know-you text). For each persona assert:
   - p90 − p10 of personality-fit across all careers ≥ 35 points;
   - mean fit of the persona's expected top-decile careers ≥ 55;
   - mean fit of the opposite persona's top careers ≤ 20;
   - re-hydration idempotence: hydrate twice → identical vector (byte-equal);
   - weighted sector fit: persona's home zone ranks #1 and beats the median zone by ≥ 15.
   Tune `G_hi`, `G_lo`, exponent, budgets ONLY until all four personas pass; record final
   constants in the ledger. Do not chase perfection past the assertions.
5. **Calibration check:** after tuning, the portal target-career card and hub top matches
   for a decided persona should read ~70–90%, unrelated careers ≤ 20%. The
   `tradeOffLabel` thresholds (`hub-onet-map.js:1064` area) still make sense — eyeball, and
   adjust the gap thresholds only if labels became nonsensical.
**Gate:** `test:vectors` (extended) + `onet:test` + `hub:verify` green; parity grep proving
client/server constants match; one commit for seed+gates, one for ETL+sector fit.

### Fix 1.6 — Zoom-proofing
Absorbed into Workstream B (below) — B0 (portal) ships in Phase 1 as Fix 1.5; the site-wide
system lands as WS-B proper. Do not do piecemeal px edits in Phase 1.

---

## Part 2 — The overhaul workstreams

Execute in order: WS-A → WS-B → WS-C → WS-D → WS-E → WS-F → WS-G → WS-H.
(A and B are foundations everything later sits on; C polishes the existing product; D/E/F
are the product overhaul; G activates monetization surfaces; H closes with performance+QA.)

### WS-A — Brand & typography system
Goal: nothing about the type or the mark reads default/lazy. No external font requests.

- **A1 Self-hosted fonts.** Add `assets/fonts/` with committed woff2 subsets:
  Space Grotesk 500/600/700 and Inter 400/500/600/700 (latin subset; woff2 only). Declare
  `@font-face` (with `font-display: swap`) in `flightway-theme.css`; define/confirm tokens
  `--font-display` (Space Grotesk) and `--font-body` (Inter) at `:root` (grep current token
  names first — `coach-title` already uses `var(--font-display)`). Add
  `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the two workhorse
  weights on every page. DELETE every `fonts.googleapis.com` link + preconnect from all 15
  pages. Tabular numerals (`font-variant-numeric: tabular-nums`) on all metric/score
  readouts (fit bars, readiness meter, usage meters).
- **A2 Wordmark lockup.** Build `assets/icons/flightway-lockup.svg`: the existing bird mark
  + "FlightWay" set in Space Grotesk 700 with tightened tracking (convert text to paths so
  it renders identically everywhere), orange gradient consistent with the bird. `brand.js`
  (currently PNG + text, `BIRD_SRC` :6) renders the inline SVG (fetch-once, cache in module;
  or inline the SVG string in brand.js) sized for nav/footer/auth variants; color adapts to
  theme via CSS custom properties on the SVG. Derive `assets/icons/favicon.svg` from the
  bird alone and finish Fix 1.7's SVG favicon line.
- **A3 Type scale.** Fluid scale tokens in `:root`: `--fs-hero`, `--fs-h1`, `--fs-h2`,
  `--fs-body`, `--fs-small` using `clamp()` (e.g. hero `clamp(2.4rem, 1.6rem + 2.6vw,
  4.2rem)`). Apply to landing hero (re-run `npm run hero:check` — the hero 'g' clipping is a
  `background-clip:text` paint-box trap, not overflow), portal welcome, page titles, card
  titles. Kill any remaining hardcoded heading px sizes in the four main CSS files.
- **Gate:** zero requests to external hosts on any page (grep all HTML for `https://fonts`);
  `hero:check`, `pages:smoke`; screenshot pass of landing + portal + coach in light/dark.

### WS-B — Site-wide fluid layout (zoom-proofing)
Goal: every page grows into the space it's given — window size, browser zoom, and OS
scaling all just work. Rule: page-level containers and grids must be fluid; component-level
paddings/borders/radii may stay px; type flows through the WS-A scale.

- **B1 Layout tokens.** `:root`: `--page-max: 1760px`, `--page-pad: clamp(16px, 3vw, 48px)`,
  `--rail-w: clamp(280px, 24vw, 380px)`, gap scale `--gap-1..4`. One shared
  `.fw-page-frame` pattern: `width: min(var(--page-max), 100% - 2*var(--page-pad))`.
- **B2 Per-page conversion.** Convert each page's top container to the frame pattern +
  grid where multi-column makes sense. Known fixed-width offenders (verified): `.portal-wrap`
  1040px (`flightway-pages.css:1311`, done in Phase 1), `.coach-shell` 820px
  (`flightway-pages.css:7` — becomes the WS-D two-pane frame), `flightway-theme.css:443`
  1200px (identify which container this is and convert), roadmap override
  (`flightway-pages.css:2310`), resume builder, quiz shell, career.html article (42-48rem
  text measures are CORRECT for prose — keep reading columns capped, widen the page frame
  around them), simulation, profile-build, pricing, admin. Audit protocol: `grep -n
  "max-width" assets/css/*.css`, classify each hit (page container → convert; modal → keep;
  prose measure → keep; media query breakpoint → keep), convert all "page container" hits.
- **B3 Overflow discipline.** Any wide content (tables, code, chip rows) scrolls inside its
  own `overflow-x: auto` container; body never scrolls horizontally at any width ≥ 360px.
- **B4 Canvas pages.** Hub + any canvas math is already viewport-normalized; verify DPR
  changes (zoom) re-rasterize crisply (resize observer → re-init backing store) rather than
  scaling blurry.
- **Gate:** screenshot matrix via the committed screenshot harness (find it: `ls scripts/
  | grep -i shot\|screen`; it exists per repo history) at widths 1024/1280/1440/1920/2560 ×
  zoom 67%/100%/150%, light+dark, for: landing, portal, dashboard, coach, roadmap, resume,
  quiz, career, pricing. Zero horizontal body scroll, zero clipped controls, no dead
  gutters beyond the frame. `pages:smoke` green.

### WS-C — Polish sweep ("nothing looks cheap")
Goal: find and fix everything low-effort-looking. This is an audit-then-fix workstream:
first produce the list, then burn it down. Keep Fix-scope discipline: polish ≠ rewrite.

- **C1 Audit.** Walk every page (both themes, plus mobile width) with the screenshot harness
  and record findings in `docs/POLISH_AUDIT_2026-07.md` (file:line per item). Checklist to
  audit against — known seed items already found:
  - Text-glyph icons: coach settings gear `⚙` (`coach.html:52`), `×` close buttons
    (multiple) → replace with lucide icons (add to `lucide-lite.js` FIRST).
  - Inline styles in markup (e.g. coach signup modal `style="margin-top:10px"`,
    `coach-progress-fill` inline width is fine — it's dynamic) → move static ones to CSS.
  - Empty states: every async pane has a designed empty/skeleton state (skeletons shipped
    2026-07-20 for hub/roadmap/analysis/profile/sim — verify coverage for: resume list,
    opportunities panel, coach history, portal snapshot, admin tables).
  - Buttons: every async action uses `FWButtonBusy`; every error surfaces through the
    `FWErr` display gate — grep for raw `alert(`, bare `catch (e) {}` swallowing UI feedback.
  - Consistency: radii/shadows/borders from theme tokens only (grep rogue `box-shadow:`
    literals); focus-visible rings on ALL interactive elements (the ring-survives-only-in-
    buttons convention from 2026-07-20 — extend, don't fight it); hover transitions
    120–180ms; scrollbar styling inside cards; selection color.
  - Copy: sentence-case headings everywhere, no lorem, no "TODO", no dev-speak strings in
    UI (grep `console.log` leaking into visible DOM, `alert(`, "undefined", "null" renders).
  - Motion: entrances follow `fw-revealed`/`fw-settled`; nothing animates under
    reduced-motion; no layout-shifting entrances.
  - Imagery: no stretched/blurry PNGs at 2x (the SVG lockup from WS-A fixes the worst one).
- **C2 Fix pass.** Burn down the audit list, batched by file. Anything ambiguous → note in
  ledger, choose the conservative fix.
- **Gate:** audit doc checked off; `pages:smoke`; re-screenshot the worst five findings
  before/after and reference them in the ledger.

### WS-D — Marco product overhaul (UI + differentiators)
Goal: Marco stops being a wrapped LLM in a beige box. The chat becomes the most designed
surface in the product, and Marco does things no plain chat can: structured guidance,
proactive discovery, deadlines, and deep links into the product.

- **D1 Coach page rebuild** (`coach.html`, `assets/js/coach/coach.js`, coach CSS blocks in
  `flightway-pages.css`/`flightway-theme.css`):
  - Two-pane layout ≥1200px inside the WS-B frame: conversation (fluid, max text measure
    ~72ch) + context rail (`--rail-w`): dossier summary chips (source: existing dossier
    fetch), current focus career + fit% (existing career-focus read), "Next deadlines" list
    (D4), suggested topics (D3). Rail collapses under 1200px into a top strip.
  - Message design: Marco messages carry a small bird-mark avatar; user messages
    right-aligned; day dividers; hover timestamps; markdown-lite renderer for bold/italic/
    lists ONLY (matches the prompt contract at `chat.js:221-224`) built on the existing esc
    helpers — no innerHTML of raw model text.
  - Composer: auto-grow textarea (exists) + Enter=send/Shift+Enter=newline, char counter
    near limit, free-plan usage meter chip ("3 of 5 today" — data from the existing
    plan-limits response fields), disabled state while in flight (FWButtonBusy).
  - Empty state = teacher (WS-F pattern): what Marco knows about you already (3 chips),
    3 starter prompts as tappable chips, one-line "how to think about Marco".
  - Keep: dossier settings modal (restyle), 5-exchange dossier-update progress (restyle as
    a subtle ring, not a full-width bar), signup overlay (restyle; also gets WS-A type).
- **D2 Structured reply contract.** Extend `chatResponsePayload` (`functions/chat.js:244`)
  with `ui: { suggestions: string[] (≤3, each ≤48 chars), cards: Card[], thread: Thread|null }`.
  `Card = { type: 'career'|'roadmap-step'|'deadline'|'link', title, subtitle?, soc?, href?,
  date?, meta? }`. Server: instruct Gemini (chat surface layer, WS-E) to append a fenced
  block `<<<FW_UI ... >>>` containing that JSON after the prose; parse+strip server-side
  (mirror `gemini-json.js` salvage patterns; `thinkingBudget: 0`); validate strictly
  (whitelist types, clamp lengths); on any parse failure, omit `ui` — the reply must never
  break. Client renders suggestion chips (tap = send that text), and cards as compact rows
  with deep links: career card → `dashboard.html` focused on the SOC (grep the hub's
  existing focus/open URL param before wiring), roadmap-step → `roadmap.html`, deadline →
  D4 rail. Add `scripts/test-marco-ui-contract.mjs`: fixture Gemini outputs (clean, mangled,
  missing block) → parsed payload asserts.
- **D3 Proactive threads ("unknown unknowns").** After Marco answers, the server MAY attach
  `ui.thread = { title, hook }` — a new-topic proposal rendered as a visually distinct
  "Marco spotted something" card (NOT auto-sent). Accept → sends a seeded message; dismiss →
  suppressed client-side for the session. Server-side selection is deterministic priority,
  max one per response, only when `exchangeCount ≥ 2`: (1) an opportunity/deadline within
  30 days the user hasn't discussed; (2) a dossier gap that blocks advice quality (no
  school, no target career, empty know-you); (3) a top-5-fit career absent from the dossier
  conversation history; (4) an unused feature relevant to their last question (reads WS-F
  `featureIntros` flags). Free tier: max 1 thread card/day (reuse plan-limits `resetPeriod:
  'day'` mechanics with a new feature key `marco-thread`, limits `{free: 1, premium: null,
  lifetime: null}` — add to `FEATURE_LIMITS` and `test:entitlements` fixtures).
- **D4 Internships & deadlines.** Reuse the opportunities pipeline (`functions/
  opportunities.js`, `GROUNDING_ENABLED` flag, school stated in prompts — invariants 0.2):
  add deadline extraction to the opportunities schema (a `deadline` ISO date where the
  grounded result states one; absent otherwise — never invent dates); coach rail lists the
  next 3 by date with "closes in N days" chips; Marco's chat context gains a compact
  `upcoming_deadlines` block (title + date only) so replies can reference them; weekly-plan
  (`functions/weekly-plan.js`) mentions at most one urgent deadline. Respect the panel's
  existing "empty until flag flips" behavior — when `GROUNDING_ENABLED` is off everything
  degrades to hidden, not broken (that emptiness is correct, not a bug).
- **D5 Marco everywhere touchpoints.** The hub's Marco chip (`assets/js/hub/marco.js`) and
  any other Marco entry points get the same visual identity (avatar, tone of microcopy) so
  Marco feels like one continuous character across the product.
- **D6 SSE streaming.** New `functions/chat-stream.js`: same auth/limits/prompt as chat.js,
  calls Gemini `streamGenerateContent`, re-emits text deltas as SSE (`data:` frames),
  finishes with one `event: control` frame carrying the full existing JSON payload (dossier
  flags, `ui`, meters) computed after stream end. Client: progressive render into the
  Marco bubble with a blinking caret; on `control`, swap in final parsed markdown + chips.
  Fallback: if EventSource/fetch-stream fails or the endpoint 404s (pre-deploy), fall back
  to the existing `/chat` JSON path transparently. Wall-clock budget below client timeout;
  `timeoutMs` on the upstream fetch (Workers fetch has no default timeout). Ship AFTER
  D1–D5 are verified — streaming must not block the rest of the overhaul.
- **Gate per slice:** `node --check`, `pages:smoke`, `test:entitlements` (D3),
  `test:marco-ui-contract` (D2+), `grounding:check` + `test:opportunities` (D4),
  `test:weekly` (D4), manual smoke of a full conversation on the deployed preview.

### WS-E — Marco persona & prompt system (every surface)
Goal: one Marco character — smarter, warmer, never robotic — across every prompt in the
product, maintainable from one place.

- **E1 Persona core.** New `functions/_lib/marco-persona.js` exporting:
  - `PERSONA_CORE`: identity (Marco: sharp, warm, direct; a coach who has actually read
    your file), voice rules (answer first; mirror the user's energy; concrete numbers,
    names, dates over abstractions; one vivid specific per substantive reply; callbacks to
    dossier facts by name; vary sentence openings; at most one follow-up question and only
    when it advances things).
  - `BANNED`: "Great question", "I'd be happy to", "As an AI", "It's important to note",
    "delve", hedge-stacks ("may potentially"), bullet-dumps for conversational questions,
    thanking users for corrections, motivational filler.
  - `buildSurfacePrompt(surface, ctx)` composing core + surface layer + context blocks
    (dossier, `schoolPromptBlock()`, roadmap, grounding fencing per `career-roadmap.js`).
- **E2 Surface refactors.** Rebuild each prompt from the composer, preserving each
  surface's hard constraints (formatting contract, JSON contracts, rate/length rules):
  `functions/chat.js` (`chatSystemPrompt` :186 — the current prompt is decent; port its
  reasoning protocol + honesty rules INTO the core so all surfaces inherit them),
  `career-switch-chat.js`, `mock-interview.js`, `sim-colleague.js`, `sim-feedback.js`,
  `sim-mirror.js`, `weekly-plan.js`, `opportunities.js`, `career-roadmap.js` advice blocks.
  Every advice surface includes `schoolPromptBlock()` (grep to confirm none is missed).
  The chat surface layer adds the D2 `<<<FW_UI` contract and D3 thread instructions.
- **E3 Smarter Marco.** Context upgrades that make replies materially better: include the
  user's top-5 fit careers w/ scores, readiness meter state, last roadmap step completed,
  and `upcoming_deadlines` (D4) in the chat context (all data already server-fetchable —
  extend the existing context assembly in chat.js, keep the token budget sane: cap each
  block, ~2k chars total added). Update the dossier-merge prompt (find it via grep
  `dossier` in `functions/_lib/dossier-update.js`) to keep dossiers dense and factual.
- **E4 Voice eval harness.** `scripts/test-marco-voice.mjs`, deterministic (no API cost):
  asserts every surface's built prompt contains the persona core marker, `schoolPromptBlock`
  output slot, its surface constraints, and NONE of the banned phrases as instructions-to-
  use; asserts `thinkingBudget: 0` in every JSON-mode caller; snapshot-tests
  `buildSurfacePrompt` output per surface (committed goldens). Optional `--live` mode
  behind `GEMINI_API_KEY`: run 3 fixture conversations, assert reply < 180 words and zero
  banned phrases in output.
- **Gate:** `test-marco-voice` green; `interview:check`, `test:weekly`, `grounding:check`
  green (they exercise the refactored prompts); one manual conversation on preview reading
  noticeably less canned (record a before/after transcript pair in the ledger).

### WS-F — Feature onboarding + persistent contextual guidance
Goal: no feature is ever encountered cold. Each gets a value-prop interstitial on first
entry, and each keeps teaching inside via empty states + a dismissable hint ribbon.

- **F1 Engine.** `assets/js/shared/feature-intro.js` (`FWFeatureIntro`) +
  `assets/css/feature-intro.css`. Manifest of features, each: `{ key, eyebrow, headline
  (the OUTCOME, not the tool — "A resume built from what we already know about you", never
  "Resume Builder"), benefits: [3 × {icon (lucide), text}], visual (inline SVG scene or
  styled composition — no stock imagery), cta, skipLabel, route }`. Features: `hub`,
  `marco`, `roadmap`, `resume`, `sharpen`, `know-you`, `simulation`, `opportunities`,
  `mock-interview`.
  - Behavior: on page enter (after `FWPageVeil` settles), if flag unseen → full-screen
    interstitial (own veil layer, `fw-revealed` entrance, reduced-motion = static). Primary
    CTA proceeds and marks seen; "Skip" marks seen too (never show twice). ESC = skip.
    Never shown mid-task, never on returning users, never stacked with another modal.
  - Persistence: signed-in → new `featureIntros` object on the v2 user object through the
    facade — add the key to BOTH client and server KEY_MAP + the user-sync registry, run
    `verify:user`/`test:user`/`test:sync` (invariant 0.2). Signed-out → localStorage
    fallback, migrated into the user object on sign-in (extend the existing local→account
    merge path — grep for where quiz results migrate on auth).
  - Seeding for existing users: on first boot with the new code, mark features the user has
    demonstrably used as seen (has roadmap → roadmap; has resume doc → resume; has coach
    history → marco; etc. — cheap client-side heuristics from data already loaded).
- **F2 Interstitial content.** Write all nine interstitials' copy (headline ≤ 9 words,
  outcome-framed; benefits concrete: "Marco reads your quiz, your roadmap, and your school
  before every reply", not "AI-powered advice"). Locked features on free (mock-interview,
  free limit 0) get the SAME hype interstitial with the plan gate as the CTA ("Part of
  Flight Plan →") — the interstitial IS the upsell surface.
- **F3 Empty states as teachers.** Rewrite every feature's empty state to: one line of
  what-this-does, one line of how-to-think-about-it, one concrete starter action (chip or
  prefilled example). Inventory (verified locations): coach empty (`coach.html:60`),
  portal empty-quiz block, hub panel empty, roadmap no-plan, resume list empty, sharpen
  intro, know-you (`profile-build.html`) intro, simulation empty, opportunities
  empty-until-flag (keep the flag-off behavior hidden-not-broken).
- **F4 Hint ribbons.** One-line dismissable ribbon inside each feature (rotates ≤3 tips,
  e.g. hub: "Click any orb — Marco can deep-dive it for you"). Dismissal persists in the
  same `featureIntros` object (`{seen, ribbonDismissed}` per feature). Quiet styling —
  never competes with content.
- **F5 Measurement (lightweight).** Count interstitial shown/completed/skipped and
  ribbon-dismiss through the existing events module (`assets/js/shared/events.js` — grep
  its sink; if it's local-only, keep counts local and note real analytics as Human-gated).
- **Gate:** `verify:user` + `test:user` + `test:sync` (KEY_MAP change), `pages:smoke`,
  manual: fresh-profile walkthrough hits every interstitial exactly once; second visit
  hits zero.

### WS-G — Free/paid activation
Goal: the free product feels complete and glorious; the caps are visible, fair, and are
themselves the marketing for Flight Plan. (Free/paid infra shipped 2026-07-19: plan-limits,
SDK-free Stripe, tiering. This workstream makes it FELT.)

- **G1 Plan surfaces.** Portal: plan badge + subtle usage summary. Coach: composer meter
  (D1) + cap-hit inline upgrade card (reuse `plan-limits` copy: "Flight Plan lifts the
  cap"). Roadmap: generations-remaining chip. Locked features: F2 interstitial treatment.
- **G2 Upgrade moments inventory.** Exactly these, styled consistently: cap hit (marco
  daily, roadmap lifetime), locked feature entry (mock-interview), interstitial CTA on
  locked features, pricing nav item. No other nags — zero interruption of paid-path users.
- **G3 Pricing page polish.** `pricing.html` stays dark; align to WS-A/B (type, frame,
  lockup); feature table mirrors `FEATURE_LIMITS` truthfully (grep the live limits; don't
  hand-write numbers that will drift).
- **G4 Human-gated items** (list in ledger for Jacob): live Stripe price/product IDs +
  webhook secret if unset; `ROOT_ADMIN_EMAIL` env var (admin console, still unset);
  `GROUNDING_ENABLED` flip for opportunities/deadlines; remote D1 backfill run (Fix 1.2).
- **Gate:** `test:entitlements` + `stripe:check` green; manual free-account walkthrough:
  every cap discoverable before it's hit, every upgrade moment renders, nothing dead-ends.

### WS-H — Performance & final hardening
- **H1** Re-run the Fix 1.1 fw-perf measurement on every page (not just hub); budget: first
  paint ≤ 1.0s repeat / 2.5s cold per page; fix stragglers found (usual suspects: unused
  CSS on light pages, missed `defer`, oversized images).
- **H2** Full suite: every script in `package.json` `scripts` that applies, green. Fix what
  isn't. `node --check` across all touched JS.
- **H3** Full screenshot matrix re-run (WS-B gate) on the DEPLOYED preview, both themes.
- **H4** Update `docs/CONVERSATION_HANDOFF.md` with a complete addendum: what shipped,
  constants chosen (Fix 1.3), new modules, new invariants, human-gated list.
- **H5** Final report to Jacob: outcome-first summary, before/after fw-perf numbers, the
  before/after Marco transcript pair, screenshot references, human-gated checklist.

---

## Part 3 — Execution order, commits, and QA matrix

Phases: **P0 orient** (read docs, `git log`, run baseline suite, record green/red in
ledger) → **P1 fixes** (1.4, 1.7, 1.5, 1.2, 1.1, 1.3 — commit each, push, live-verify) →
**WS-A** → **WS-B** → **WS-C** → **WS-D** (D1→D5, then D6) → **WS-E** → **WS-F** → **WS-G**
→ **WS-H**. Push + live-verify at the end of every workstream minimum; more often is fine.

Buster discipline every push: changed assets only, fresh stamp, every referencing page.

QA matrix (run at WS-B gate and again at H3): pages {landing, portal, dashboard, coach,
roadmap, resume, quiz, career, pricing} × widths {1024, 1280, 1440, 1920, 2560} × zoom
{67%, 100%, 150%} × themes {light, dark}. Assert: no horizontal body scroll, no clipped
controls, no unreadable type, frames fill available space.

Definition of done: all seven fixes verified live; all workstream gates green; ledger
complete; handoff addendum written; human-gated list delivered; final report sent.
