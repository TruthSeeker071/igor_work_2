# FlightWay — UI Polish, Macro Hub Rebuild & Product Audit (`Jacob_Work`)

**Date:** 2026-07-17 · **Base:** `d6628a6` (production launch review) → fixes through this report
**Scope:** the three work streams from the UI-polish/audit brief: (1) site-wide UI polish, (2) macro career-hub visual rebuild, (3) frontend product/logic/security audit. Backend/infra ground covered by `docs/PRODUCTION_LAUNCH_REVIEW.md` was treated as closed and not re-audited.
**Severity scale:** same as the prior report — P0 silent data loss / wrong persisted state / security hole · P1 user-visible incorrect behavior · P2 integration gap / degraded UX · P3 polish · P4 perf/cost.

Every fix was committed individually and pushed to `Jacob_Work` (the push is the deploy). Live verification after the final push: `pages:smoke` 5/5, live curls confirm the new `?v=20260717*` stamps and fix content.

---

## 1. Executive summary

**Stream 3 (audit) produced the two most important finds of the run, both fixed first:**

1. **P1 — runaway fetch loop: one open portal tab issued ~48,000 requests to `/onet/vectors` in 15 seconds** whenever that endpoint failed. Found by instrumenting a Playwright probe against a stubbed outage (the screenshot harness's portal captures were timing out with `ERR_INSUFFICIENT_RESOURCES` — ~340k requests in 30s). Root cause was a two-part cycle: `kickOnetRankRefresh` (career-target.js) re-rendered the portal on *every* rank-build settle including failures, and the re-render found the cache still empty and kicked a fresh full-catalog build (whose in-flight guard clears on settle); `rankFeaturedFromVectors` (onet-vectors.js) additionally had **no** in-flight guard at all, so each cycle also fired its own ~780-SOC batched fetch. In production, any `/onet/vectors` outage would have turned every open portal tab into a microtask-speed self-DDoS for the outage's duration. Fixed `a6cd8b3`: notify-only-on-data, in-flight dedupe mirroring the existing `rankedOnetPromise` pattern, shared 30s failure cooldown across both rank builders. Re-probe under the identical stubbed outage: **2 requests**. `test:vectors` 42 PASS.

2. **P1 — cross-user stored XSS surface: AI-derived career names/skills rendered unescaped at four sites.** `derived_careers` is a **global** D1 table (`SELECT row_json FROM derived_careers`, no user filter — `functions/_lib/onet/store.js:112`), so Gemini-generated titles/skills seeded by one user's resume render in *every* user's hub. Four `innerHTML` sinks interpolated that text raw: hub search suggestions (name/industry/id), hub panel skill pills, career-page skill pills, and the coach results card (signed-in email). Fixed `f896d06` with the modules' own `esc`/`escHtml`/`escAttr` helpers; all other name renderers already escaped (verified: compare view, panel chips, target switch, coach/advisor chat).

**Stream 1 (polish)** fixed six screenshot-verified issues across quiz, index, roadmap, pricing, and coach (`7bfbf0a`) — the standouts: a dev-only "Skip with random answers" button visible to every visitor on the public quiz page, pricing's plan cards pushed below the fold by a dead CSS class (`fw-hero--compact` was referenced but never implemented), and roadmap's no-data picker rendering a bare label + disabled button that read as broken.

**Stream 2 (hub rebuild)** replaced the macro view's execution end-to-end (`7abf372`, details in §2) and fixed a camera-fit unit bug that had the map hiding its top row under the fixed HUD on desktop and squashing to ~30% scale on phones. A follow-up (`704bfba`) closed the audit's a11y gap: Escape now closes the hub panel, pivot modal, and coach settings like every other drawer.

## 2. Macro hub rebuild — before/after and design reasoning

**Before** (baseline screenshots, both themes, desktop + mobile): every cluster was an isotropic wash whose "career orbs" were the rectangular world-tile layout scaled into a circle — so the dot fields read as *squares* with a hard rim arc where the clamp projected outliers. Density was arbitrary (Marketing's 8 careers made an empty fog blob; Trades' 67 made a dense square), size ignored career count (Healthcare 134 ≈ Cybersecurity 7), links were uniform hairlines crossing unrelated clusters, labels were bare text on a radial smudge, light theme was washed out to near-invisibility, the top tile row clipped under the fixed HUD, and **mobile was unusable** — all 18 labels overprinted into strings like "HEALFINEENGICREATIVE" on a map squashed into a corner.

**After — what changed and why:**

- **Silhouette & density:** orb positions now come from a per-zone seeded Vogel (sunflower) spiral — genuinely circular, center-dense, deterministic across frames, one dot per real career (capped at 130). Cluster radius scales with √(career count), so industry scale reads visually, not just in the caption.
- **Depth:** three depth bands (small/dim → large/bright, drawn back-to-front) plus up to six "core" orbs with radial-gradient halos and specular highlights. Light theme draws dots in each rarity tier's dark variant instead of its glow color — that was the washed-out culprit.
- **Links as data:** width, opacity, and a color gradient between the two clusters' rarity colors now scale with the real zone-cosine `score` already computed in `FWOnetHub.getZoneNeighborLinks` (min-max normalized across the link set). The web reads as meaningful, not decorative.
- **Labels:** canvas-drawn rounded plates matching the sector view's orb-label language (fill + 1px border, hover accent border), balanced two-line wrap instead of `…` truncation, font scaled with zoom, plates clamped on-screen, and **collision culling by career-count priority** — big sectors win when space runs out, which is what makes mobile readable (hovered zone's label always shows).
- **Motion:** hover now scales the cluster +5% and lifts it 4px with a stronger rim (rides the existing hoverA cache-key invalidation — same cost as the old rim-only glow). Idle: 7 twinkling front dots + 2 slow orbit motes per cluster, drawn per frame *over* the cached blit. Disabled entirely under `prefers-reduced-motion` (the loop parks exactly as before).
- **Camera:** `computeOverviewFitZoom` divided viewport px by world units — coincidentally ~1.0 at desktop widths (content flush to every edge, top row under the HUD) and ~0.29 on a 375px phone. `worldToScreen` is viewport-normalized, so the fit now works in viewport fractions, centers the map between the HUD and a 64px bottom band kept clear of the Marco FAB, centers X when the whole map fits, and pan clamps to that band.

**Caching/frame-rate not regressed — verified:** the offscreen `overviewLayer` cache strategy is intact; the idle overlay never touches it (per-frame cost = one `drawImage` blit + ~160 tiny arcs). Probe on the working tree: **241 rAF frames in 2s** (no jank), and a byte-diff of two screenshots 900ms apart confirms the idle motion actually renders. Screenshot-verified at macro, mid-zoom, and sector dive, light + dark, 1280×800 + 375×812, before and after every iteration (three capture rounds; first-draft issues — edge-clipped GOVERNMENT plate, lopsided horizontal margins — found in round 2 screenshots and fixed before shipping). The sector view was left visually unchanged (its two-island layout for sparse sectors like Law is a world-position/layout trait, not a regression — flagged in §3 as a noted non-fix).

## 3. Findings table

| # | Issue | Sev | Evidence | Status |
|---|-------|-----|----------|--------|
| 1 | `/onet/vectors` outage → unbounded fetch loop from every open portal tab (~48k req/15s measured) | P1 | probe stacks: career-target.js:116→portal re-render→re-kick; onet-vectors.js:963 unguarded | fixed & pushed `a6cd8b3` |
| 2 | AI-derived (cross-user, Gemini-generated) career names/skills unescaped into `innerHTML` at 4 sites | P1 | hub-dashboard.js renderSuggest + panel skills; app-pages.js skill pills; coach.js results card; global table at store.js:112 | fixed & pushed `f896d06` |
| 3 | Macro hub read as low-effort: square orb fields, no size/density/depth cueing, decorative links, washed-out light theme | P2 | baseline screenshots §2 | fixed & pushed `7abf372` |
| 4 | Camera-fit unit bug: map top row under fixed HUD (desktop), map at ~30% scale (mobile) | P1 | computeOverviewFitZoom px÷world-units; baseline screenshots | fixed & pushed `7abf372` |
| 5 | Mobile macro labels: all 18 overprint into unreadable soup | P1 | baseline mobile screenshot | fixed & pushed `7abf372` (collision culling) |
| 6 | Dev "Skip with random answers (dev)" button public on quiz intro | P2 | quiz.html:56, ungated | fixed & pushed `7bfbf0a` (fw_debug_quiz=1 gate) |
| 7 | Pricing plan cards below the fold — `fw-hero--compact` class referenced but never defined (dead CSS) | P2 | pricing.html:41 vs flightway-theme.css | fixed & pushed `7bfbf0a` |
| 8 | Roadmap picker with no rank data: bare label + empty grid + dead disabled button | P2 | roadmap.js:1165 else-branch | fixed & pushed `7bfbf0a` |
| 9 | Roadmap mobile: heading clipped under two-row mobile nav (64px padding vs ~96px nav) | P2 | mobile screenshot; flightway-pages.css:2773 | fixed & pushed `7bfbf0a` (112px) |
| 10 | Hub career panel, pivot modal, coach settings: no Escape close (mouse-only) | P2 | grep: only search/profile-drawer/compare handled Esc | fixed & pushed `704bfba` |
| 11 | Index hero "Your  dream," double-wide word gap (whitespace + 0.28em mask margin stacking) | P3 | screenshot + flightway-theme.css:738 | fixed & pushed `7bfbf0a` |
| 12 | Coach progress line leaked dev jargon ("dossier + roadmap") | P3 | coach.html:53, coach.js:445 | fixed & pushed `7bfbf0a` |
| 13 | Hub canvas zones not keyboard-reachable (career search box is the only keyboard path into the map) | P2 | audit; canvas hit-testing is pointer-only | not fixed — needs a roving-tabindex/virtual-focus design; too architectural for an unsupervised pass. Search path mitigates |
| 14 | Sector view: sparse sectors (e.g. Law) split into two orb islands with a dead band between | P3 | sector screenshots | not fixed — layout comes from real world positions + 1.45× spread; changing it risks hit-test/label regressions out of proportion to the polish gain |
| 15 | Simulation cards: one card can lack the "Your Hub match" line siblings have | P4 | simulation.html screenshot (data-dependent) | not fixed — content/data availability, not a layout bug |
| 16 | Blue accent (`--fw2-accent`) vs orange brand accent split (profile-build flow, ~17 usages) | P3 | profile-build screenshots | not fixed — deliberately deferred in two prior passes as a known, larger design decision |
| 17 | Career deep-dive failure paths destroyed content: personalization skeleton overwrote the page's real static day-in-life schedule and never restored it; O*NET sections unhid before their fetch and stayed as empty frames on failure | P2 | career.html?slug=product-management under stubbed-404 APIs; career-personalize.js | fixed & pushed `807fe5d` |

Also checked and found clean: no dead local links/assets anywhere (script sweep across all 13 pages); canvas double-click/rapid-click races (mode flips synchronously, pointerdown cancels camera animation, `openPanel` idempotent); resize mid-interaction (re-clamp + cache invalidation from the prior pass still sound, and now includes the new pan band); portal profile drawer focus trap + restore + listener cleanup (the model pattern the new Esc handlers follow); coach/advisor chat and compare/panel-chip renderers all escape; `renderSuggest` keyboard flow (Esc already handled); portal snapshot degrades softly from saved data when the fetch fails.

## 4. Manual-only items

Nothing new for Jacob beyond the prior report's checklist (`docs/PRODUCTION_LAUNCH_REVIEW.md` §3 still stands: Cloudflare secrets, probe-account rotation, legal pages, `og:image`, `deploy:cron`). One note from this pass: the fetch-loop fix (`a6cd8b3`) means a future `/onet/vectors` incident degrades to one bounded retry per 30s per tab — no dashboard action needed.

## 5. Commit log (this run, in order)

1. `a6cd8b3` — Fix unbounded portal fetch loop when the vector endpoint fails
2. `f896d06` — Escape AI-derived career names/skills at four HTML render sites
3. `7bfbf0a` — UI polish: gate dev quiz-skip, fix hero gap, roadmap empty/mobile states, pricing hero, coach copy
4. `7abf372` — Rebuild macro hub: real cluster silhouettes, depth, weighted links, plate labels, idle motion
5. `704bfba` — A11y: Escape closes the hub career panel, pivot modal, and coach settings
6. `807fe5d` — Career page: stop losing content on failed personalization fetches
7. *(this report + screenshot harness)* — docs/UI_POLISH_AND_AUDIT_REVIEW.md; scripts/ui-screenshots.mjs committed for future visual passes (serves the working tree, stubs `/auth/me`, captures every page × theme × viewport + hub at 3 zoom levels)

**Verification per commit:** `node --check` on every touched JS; `test:vectors` (42), `hub:verify`, `verify:aliases` (12/4), `onet:test`, `test:weekly` (47), `test:entitlements` all PASS post-changes; Playwright screenshot rounds before/after each visual change (both themes, desktop + mobile); frame-rate probe for the hub; live post-deploy: `pages:smoke` 5/5, curls confirm `20260717*` stamps and the loop fix in the served file.

**Judgment calls made without consultation (per brief):** chose a 30s failure cooldown for rank rebuilds (bounded degradation over hard retry-or-never); treated derived-career text as untrusted at render time rather than sanitizing at generation time (renders fix all historical rows; generation-side cleaning can't); replaced the orb-position source entirely (decorative-only by the code's own contract) instead of patching the square-crop clamp; culled colliding labels by career count rather than shrinking text further (legibility over completeness at 375px); kept the sector view untouched; capped idle motion at twinkle+motes rather than cluster drift (drift would either invalidate the cached layer per frame or desync hit-testing).
