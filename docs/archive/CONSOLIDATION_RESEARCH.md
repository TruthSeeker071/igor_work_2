# FlightWay Consolidation & Modularization Research

**Date:** 2026-06-15  
**Status:** Phases 0–3 complete. Merged to `main`.  
**Repo:** `/Users/jacobklugerman/Python/flightway`

---

## Executive Summary

FlightWay is a small but **top-heavy** static site (~36 non-git files, ~10,300 lines) deployed on Cloudflare Pages with five Pages Functions. Nearly **60% of client-side code** lives in two HTML entry points: `Flightway.html` (4,180 lines) and `dashboard.html` (1,039 lines). Shared infrastructure already exists (`assets/theme.js`, `app-nav.js`, `functions/_lib.js`) but is underused — `brand.js` is never loaded, the theme FOUC boot snippet is copy-pasted three times, and career/industry data is split across three incompatible shapes.

The active branch `cursor/landing-hero-scale-align` made the **right first move**: extract hub catalog + quiz scoring into `assets/hub-careers.js` (−132 lines from `dashboard.html`). Consolidation should **continue that pattern** outward from `Flightway.html`, not reorganize the repo prematurely.

**Recommended sequence:** merge the in-flight branch → Phase 0 doc/hygiene → Phase 1 extract monolith blocks in place → Phase 2 data layer + folder normalization → Phase 3 scalability hooks. Estimated net reduction: **~2,500–3,200 lines** from HTML monoliths (mostly moves, not deletes), with clearer navigation and safer parallel feature work.

---

## Current State Metrics

### File inventory (excluding `.git/`, `.wrangler/`)

| Category | Files | Notes |
|----------|-------|-------|
| HTML entry points | 3 | `index.html` (227), `Flightway.html` (4,180), `dashboard.html` (1,039) |
| CSS | 2 | `flightway-theme.css` (1,915), `hub-dashboard.css` (269) |
| Client JS | 9 | `theme.js`, `app-nav.js`, `brand.js`, `data-field.js`, `landing.js`, `reveal.js`, `hub-careers.js`, + 2 inline monoliths |
| Pages Functions | 5 + `_lib.js` | ES modules, well-factored (~936 lines total) |
| Setup docs | 1 | `docs/SETUP.md` (merged from 3 SETUP_*.md) |
| Config/CI | 6 | `wrangler.toml`, `_redirects`, workflows, `package.json` |

### Largest files (lines)

| File | Lines | Composition |
|------|-------|-------------|
| `Flightway.html` | 4,180 | ~912 inline CSS, ~512 HTML, ~278 `df-script`, ~2,462 `qz-script` |
| `assets/flightway-theme.css` | 1,915 | Design system + quiz theme overrides |
| `dashboard.html` | 1,039 | ~320 inline CSS, ~613 inline JS (canvas map UI) |
| `functions/chat.js` | 403 | Largest function; imports `_lib.js` |
| `assets/hub-careers.js` | 213 | **New on branch** — hub data + scoring |

### Duplication hotspots

1. **Theme FOUC boot** — `assets/theme-boot.js` (was identical inline IIFE × 3 pages).
2. **Brand plane SVG** — `assets/brand.js` + `[data-fw-brand]` on all pages (was inlined × 3).
3. **Career/industry data (three schemas):**
   - `hub-careers.js`: 40 map careers + `careerToQuizKeys` + `subBranchNames`
   - `Flightway.html` `df-script`: 12 deep-dive careers (`careers` object) + `QZ_SALARY_TIERS` (24 industries)
   - `Flightway.html` `qz-script`: `QZ_IND` (24 industries), `QZ_SCHOOLS` (~50 schools × majors), `QZ_TO_CAREER` mapping
4. **Quiz industry keys** — 24 keys must stay in sync across hub scoring, quiz engine, and salary tiers.

### Dead / legacy paths

- **`dreamforce.html`** — file does not exist; `_redirects` 301 → `Flightway.html` (keep redirect, safe).
- **`df-script` id** — legacy Dreamforce naming; contains salary tiers, career deep-dives, and `showPage()` routing.
- **Netlify** — only in `.gitignore`; no `netlify.toml` in tree. SETUP docs still mention migration from `Leo_Working`.
- **`students` / `educators` / `career` pages** inside `Flightway.html` — active B2B deep-dive flows, not dead.

### Git branch clutter (note only — do not delete)

| Branch | Role |
|--------|------|
| `main` | Production (`flightway.pages.dev`) |
| `Jacob_Work` | Prototype branch + separate Pages project |
| `cursor/landing-hero-scale-align` | **In flight** — hero, quiz expansion, hub extraction, z-index, rules/skills |
| `remotes/origin/Leo_Working` | Legacy Netlify era |
| `remotes/origin/update_worker_name_to_flightwaylandingpage` | Stale worker rename |
| `remotes/upstream/main` | Upstream remote |

---

## Recommended Target Tree

Vanilla HTML/CSS/JS + Cloudflare Pages. **No bundler** unless import-graph complexity exceeds ~15 modules (not there yet). Prefer existing IIFE + `window.FW*` pattern; introduce `<script type="module">` only for new isolated features.

```
flightway/
├── index.html                      # landing shell
├── Flightway.html                  # quiz/coach/portal shell (thin)
├── dashboard.html                  # hub shell (thin)
├── _redirects
├── wrangler.toml
├── package.json
├── docs/
│   ├── SETUP.md                    # merged from 3 SETUP_*.md
│   └── CONSOLIDATION_RESEARCH.md
├── assets/
│   ├── css/
│   │   ├── flightway-theme.css     # design tokens + fw-/shared
│   │   ├── coach.css               # from Flightway inline
│   │   ├── quiz.css                # from Flightway inline + theme quiz blocks
│   │   └── hub-dashboard.css
│   ├── js/
│   │   ├── boot/
│   │   │   └── theme-boot.js       # FOUC preventer (or single shared inline)
│   │   ├── shared/
│   │   │   ├── theme.js
│   │   │   ├── brand.js
│   │   │   ├── app-nav.js
│   │   │   └── data-field.js
│   │   ├── landing/
│   │   │   ├── reveal.js
│   │   │   └── landing.js
│   │   ├── hub/
│   │   │   ├── hub-careers.js      # scoring API
│   │   │   └── hub-dashboard.js    # canvas map UI from dashboard.html
│   │   ├── quiz/
│   │   │   ├── quiz-data.js        # loads JSON or embeds constants
│   │   │   ├── quiz-engine.js
│   │   │   └── quiz-ui.js
│   │   ├── coach/
│   │   │   └── coach.js
│   │   └── app/
│   │       ├── router.js           # showPage, hash boot
│   │       └── careers-deep.js     # B2B deep-dive renderers
│   └── data/
│       ├── industries.json         # canonical 24 keys + display metadata
│       ├── careers-hub.json        # 40 map careers
│       ├── careers-deep.json       # 12 deep-dive profiles
│       ├── schools.json
│       └── salary-tiers.json
├── functions/                      # unchanged pattern
│   ├── _lib.js
│   ├── account.js
│   ├── chat.js
│   ├── dossier.js
│   └── send-results.js
```

**Mirror server-side pattern:** `functions/_lib.js` is the model — one shared module, feature files import it. Client side should get `assets/js/shared/` with the same discipline.

---

## Redundant Files Safe to Delete (Phase 0, post-merge)

| Item | Action | Rationale |
|------|--------|-----------|
| `SETUP_PROTOTYPE_JACOB_WORK.md` | **Done** — merged → `docs/SETUP.md` |
| `SETUP_PROTOTYPE_CLOUDFLARE.md` | **Done** — merged → `docs/SETUP.md` |
| `SETUP_AI_COACH_CLOUDFLARE.md` | **Done** — merged → `docs/SETUP.md` |
| `_redirects` `/dreamforce.html` | **Keep** | Legacy URL; zero cost |
| `assets/brand.js` | **Done** — loaded on all pages via `[data-fw-brand]` |
| `.wrangler/cache/` | Already gitignored | Local only |

No HTML pages are safe to delete without product confirmation.

---

## Modularization Priorities (ranked)

1. **Extract `qz-script` (~2,462 lines)** — highest ROI; quiz + coach logic. Split into `quiz-*.js` + `coach.js`. Risk: high (core product).
2. **Extract inline CSS from `Flightway.html` (~912 lines)** — move to `coach.css` + `quiz.css`; align with `flightway-theme.css` quiz section (some duplication today). Risk: medium (visual regressions, especially Safari `color-scheme`).
3. **Unify industry key registry** — single `industries.json` consumed by hub, quiz, salary tiers. Risk: medium (scoring bugs if keys drift).
4. **Extract `hub-dashboard.js` (~613 lines)** from `dashboard.html` — follow `hub-careers.js` precedent. Risk: medium (canvas performance).
5. **Extract `df-script` (~278 lines)** — router + deep-dive data → `app/router.js` + `data/careers-deep.json`. Risk: low-medium.
6. **Adopt `brand.js` + `theme-boot.js`** — quick DRY win (~30 lines saved, clarity gained). Risk: low.
7. **Consolidate SETUP docs** — **Done** (`docs/SETUP.md`).
8. ~~Deduplicate `.cursor/rules` ↔ skill~~ — **Removed from repo**; use personal `~/.cursor/skills/web-design` only.

---

## Phased Roadmap

### Gate: **Start Phase 0 only after `cursor/landing-hero-scale-align` → `main`**

That branch touches the exact files consolidation will refactor. Merging first avoids rebasing z-index fixes, 12→24 industry expansion, and the new `hub-careers.js` extraction.

---

### Phase 0 — Safe hygiene (no behavior change) — **partially complete**

| Work | Files | Status |
|------|-------|--------|
| Merge 3 SETUP docs → `docs/SETUP.md` | `SETUP_*.md` | Done |
| Add `theme-boot.js`; replace 3× inline copy | all HTML | Done |
| Wire `brand.js` on all pages; remove inline SVG | HTML, `brand.js` | Done |
| Rename `df-script` → `app-script` (id only) | `Flightway.html` | Done |

**Dependencies:** branch merge complete.

---

### Phase 1 — Extract without moving HTML entry points

| Work | Files | Est. Δ | Risk |
|------|-------|--------|------|
| Move coach JS → `assets/js/coach/coach.js` | `Flightway.html` | −620 lines HTML | High — API paths, KV flow |
| Move quiz engine → `assets/js/quiz/*` | `Flightway.html` | −1,400 lines HTML | High — 24-industry scoring |
| Move coach/quiz CSS → linked sheets | `Flightway.html`, new CSS | −900 lines HTML | Medium — theme specificity |
| Move hub canvas JS → `hub-dashboard.js` | `dashboard.html` | −613 lines HTML | Medium |

**Net HTML reduction:** ~2,500–3,100 lines moved to `assets/`.  
**Dependencies:** Phase 0; quiz industry keys frozen post-merge.

---

### Phase 2 — Structure + data layer

| Work | Files | Est. Δ | Risk |
|------|-------|--------|------|
| Introduce `assets/data/*.json` | new JSON, update loaders | −400 lines JS literals | Medium — fetch vs inline |
| Normalize `assets/css/`, `assets/js/` subdirs | moves + path updates | 0 lines | Low — broken `<link>`/`<script>` |
| Optional ES modules for quiz/coach only | `type="module"` | 0 | Medium — Safari OK on modern targets |
| Collapse duplicate quiz CSS in theme vs quiz.css | `flightway-theme.css` | −200 lines | Medium |

**Import strategy:** stay with `<script src>` + IIFE for shared globals (`FWHubCareers`, `FWAppNav`) unless module count grows. JSON via `fetch('/assets/data/industries.json')` with inline fallback for offline dev.

---

### Phase 3 — Scalability hooks

| Work | Purpose |
|------|---------|
| `assets/data/schema/` JSON Schema for industries, careers | Validate data PRs |
| `window.__FW_FLAGS` or URL param flags | Toggle experimental quiz steps |
| Minimal Playwright or Vitest + static server | Smoke: theme boot, quiz start, `/chat` OPTIONS |
| `docs/ARCHITECTURE.md` | Onboarding map (optional, when asked) |

---

## What NOT to Do Yet

### Files changed on `cursor/landing-hero-scale-align` (vs `main`)

Consolidation must **not** conflict with these until merged:

- `Flightway.html` — z-index tier badges, 12→24 industries, salary tier expansion (+180 lines)
- `assets/flightway-theme.css` — hero/quiz tweaks
- `assets/hub-careers.js` — **new file** (catalog + scoring)
- `dashboard.html` — delegates data to `hub-careers.js` (−132 lines inline)
- `index.html` — hero wrapper structure for scale alignment

### Likely merge conflicts if consolidation starts early

| Area | Why |
|------|-----|
| `Flightway.html` inline CSS (`#page-quiz` z-index) | Branch edited same block Phase 1 would move |
| `Flightway.html` `qz-script` industry constants | Branch added 12 industries + tiers |
| `dashboard.html` + `hub-careers.js` | Branch just created extraction; redo would collide |
| `flightway-theme.css` `#page-quiz` section | Parallel edits |

**Rule:** treat `hub-careers.js` as the hub data owner going forward; extend it, do not re-inline.

---

## Risks & Tradeoffs

| Topic | Consideration |
|-------|---------------|
| **Safari theme** | FOUC boot must stay synchronous in `<head>` before CSS. External `theme-boot.js` is fine if not `defer`/`async`. Test `color-scheme` + `data-theme` on iOS. |
| **Cloudflare Pages static deploy** | No bundler = paths must match repo layout. Subfolder moves require updating all HTML refs + `_redirects` if URLs change. Functions unaffected. |
| **No bundler** | Pros: zero build step, matches current CI. Cons: no tree-shaking, manual load order. Revisit only if >15 scripts per page. |
| **JSON fetch** | Adds latency on first quiz load; mitigate with `<link rel="preload">` or keep critical data inlined in `quiz-data.js`. |
| **Lucide CDN** | `unpkg.com/lucide@latest` is unpinned; consolidation should pin version when touching `Flightway.html`. |
| **Shared KV on prototype** | Doc issue, not code — `SETUP_PROTOTYPE_*` warns prototype shares prod KV. |

---

## Functions: Patterns to Mirror Client-Side

The edge layer is already modular:

- `_lib.js` — CORS, KV, dossier schema, `buildSeedDossier(quizResults)`
- Feature files import shared helpers; no duplication of `jsonResponse` or email validation
- Quiz → coach handoff uses dossier field names (`top_industries`, `archetype`, …) — **client data extracts must preserve this contract**

When extracting quiz results code, colocate constants that map to `buildSeedDossier()` expectations.

---

## Summary Checklist

- [ ] Merge `cursor/landing-hero-scale-align` to `main`
- [x] Phase 0: docs merge, `theme-boot.js`, adopt `brand.js`
- [x] Phase 1: extract `Flightway.html` / `dashboard.html` inline JS/CSS
- [x] Phase 2: `assets/data/` JSON + `assets/css|js/` normalization
- [x] Phase 3: schemas, flags, smoke tests, `docs/ARCHITECTURE.md`
- [ ] Do not delete `dreamforce` redirect or B2B career pages without product sign-off
- [ ] Do not add React/Vite unless module graph forces it
