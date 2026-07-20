# FlightWay — Full Polish & Legacy Integration Plan

**For:** Claude Code / agent execution on `Jacob_Work`  
**Prerequisite reading:** `docs/CONVERSATION_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`  
**Branch:** `Jacob_Work` → deploy `flightwayjacobprototype` via `npm run deploy:prototype`  
**Philosophy:** Research first. Fix root causes. Craftsmanship over churn. No drive-by refactors.

---

## Executive intent

FlightWay has migrated from a **40-career quiz hub** + monolithic `Flightway.html` to a **multi-page O*NET vector architecture** (~782 careers, 161-dimension personality/objective vectors). Many surfaces still blend **legacy industry scores**, **hardcoded career objects**, and **partial O*NET integration**. Recent session work fixed critical paths (vector persistence, roadmap timeouts, career switch confirmation, AI truncation) but a **systematic polish pass** is needed so every user-facing flow feels cohesive, correct, and fast.

This plan is **research-heavy by design**. Do not ship visual polish on top of broken data paths. Do not delete legacy code until O*NET replacements are verified.

---

## Non-negotiable constraints

| Rule | Detail |
|------|--------|
| Stack | Vanilla HTML/CSS/JS only — no React, no bundler |
| Verification | `npm run hub:verify` after data/touch changes; `node --check` on edited JS; **no browser MCP** for QA |
| Design | Read `/Users/jacobklugerman/.cursor/skills/web-design/SKILL.md` before UI work |
| Vectors | All user-info features must funnel through `FWOnetVectors.hydrateQuizVectors` → `persistQuizVectors` |
| O*NET scale | Levels are **0–100** in artifacts — never `(level/7)*100` again |
| Blend | `weightedUserComponent` = **0.75 × objective + 0.25 × personality** for match bars & skill pills |
| Deploy | Commit + push `Jacob_Work` when user expects it; bump HTML cache busters on touched assets |
| Scope | Minimal diffs per PR-sized chunk; one coherent phase at a time |

---

## Phase 0 — Codebase audit & research (NO implementation)

**Goal:** Produce a written **Audit Report** (`docs/AUDIT_REPORT.md`) cataloguing every bug, legacy path, UI defect, and integration gap. No code changes except optionally adding `scripts/audit-vectors.mjs` if useful.

**Duration estimate:** 1–2 focused sessions before any fixes.

### 0.1 Architecture map (confirm handoff accuracy)

Trace and diagram these end-to-end flows with file:line citations:

1. **Quiz → localStorage → D1 sync** (`quiz-app.js` → `fw_hub_quiz_v1` → `PUT /profile/quiz`)
2. **Vector hydration boot** (`onet-vectors.js` `bootHydrateQuizVectors`)
3. **Sharpen Matches** (`hub-refine.js` → `refine-map.js` → `persistQuizVectors`)
4. **Academic Profile** (`hub-academics.js` → `academics-map.js` → `persistQuizVectors`)
5. **Resume parse** (`portal-resume.js` / `resume-ingest.js` → `POST /resume-parse` → bleed + sync)
6. **Career Hub map fit** (`hub-onet-map.js` → cosine fit → orb colors)
7. **Deep dive** (`career-personalize.js` → `POST /career-analysis` → fit panel + AI profile)
8. **Target career** (`career-target.js` → `POST /career-focus` → roadmap retarget)
9. **Career Switch Advisor** (`portal-career-advisor.js` → `career-switch-chat.js` → O*NET confirm)
10. **Roadmap v2 tree** (`roadmap.js` → `career-roadmap.js` → `roadmap-generate.js` → skill-gap tracker)
11. **Marco coach** (`coach.js` → `chat.js` → personality patches)
12. **Profile building** (`profile-building.js` → `profile-building` function)

### 0.2 Legacy vs O*NET inventory

Search and document every usage of:

| Legacy artifact | O*NET replacement | Files to grep |
|-----------------|-------------------|---------------|
| `FWHubCareers.careers` (40 hardcoded careers) | `FWOnetCatalog` + `hub-onet-map.js` | `hub-careers.js`, `skill-gap-tracker.js`, `app-pages.js`, `quiz-app.js` |
| `computeQuizFit` / industry `scores` only | Vector-ranked fit | `career-personalize.js`, `career-target.js` |
| `panel-fit-wrap--legacy` | `panel-dual-fit` | `dashboard.html`, `hub-dashboard.js` |
| `roadmap-stage--legacy` (v1 flat roadmap) | Tree v2 + focus tracker | `roadmap.js`, `roadmap-sync.js` |
| `app-pages.js` static `careers` object | `career-personalize.js` + O*NET | `app-pages.js`, `career-deep-dives.js` |
| `QZ_IND` industry keys (24) | Zone centroids + sector fit | `quiz-data.js`, `hub-refine.js`, `sector-fit-sheet.js` |
| `SLUG_ALIASES` / `getLegacySlugForSoc` | Canonical SOC-first slugs | `onet-catalog.js`, `roadmap-sync.js`, `career-target.js` |
| `extractCustomCareerTarget` (verbatim Gemini slugs) | O*NET lookup only (home advisor fixed; check coach/roadmap) | `roadmap.js`, `chat.js`, `career-roadmap.js` |
| `Flightway.html` hash routes | Dedicated HTML pages | `_redirects`, `page-boot.js` |

### 0.3 Bug hunt checklist

For each item, record **repro steps**, **root cause hypothesis**, **severity**, **owner file**:

**Data / vectors**
- [ ] Fit scores differ between Hub map, portal dropdown, deep dive, and roadmap for same career+user
- [ ] Navigating Hub → Portal → Roadmap resets or drifts vectors (post-`1052dd5` regression hunt)
- [ ] Resume upload updates objective but Hub map doesn't redraw until hard refresh
- [ ] Academics panel updates industry scores but not objective dimensions (or vice versa)
- [ ] `careerFocus` slug without valid SOC → "Fit details unavailable" on portal
- [ ] Cached D1 analysis/roadmap serves stale truncated AI text
- [ ] Double-scaling anywhere `(x/7)*100` on already 0–100 data

**AI / API**
- [ ] Marco chat doesn't return/apply `personalityVector` consistently
- [ ] Objective vector AI patches **not wired** (documented TODO in handoff)
- [ ] Coach career pivot still uses verbatim `extractCustomCareerTarget`?
- [ ] Roadmap chat pivot vs portal advisor pivot behavior inconsistent
- [ ] Gemini 503 without friendly fallback on any endpoint
- [ ] Rate limit error messages user-hostile

**Roadmap**
- [ ] v1 roadmaps stuck in legacy UI path — migration UX unclear
- [ ] Tree v2 `focusTracker` / skill-gap tracker desync after manual edits
- [ ] Background keyword enrichment (`enrichRoadmapFocusKeywords`) fails silently
- [ ] Regenerate confirm dialog vs advisor switch flow inconsistent
- [ ] Roadmap target career name doesn't match O*NET catalog title

**Marco (hub mascot + coach)**
- [ ] `marco.js` bubble: message quality, vector-ranked top careers vs legacy fallback
- [ ] Marco hidden when quiz exists but vectors not hydrated
- [ ] `fw_marco_starter` / `fw_marco_user_prompt` sessionStorage handoff from Hub → coach
- [ ] Coach nav missing from Hub top bar (by design?) — discoverability UX
- [ ] Coach dossier seed stale after refine/academics/resume updates

**UI / UX**
- [ ] Playfair Display still used on headings outside portal (brand inconsistency)
- [ ] Hub detail panel toggles legacy vs dual fit bars (`hub-dashboard.js` lines ~724–736)
- [ ] Mobile: hub drawer, career chat drawer, portal target row overflow
- [ ] Loading states: hub boot, roadmap generate, deep dive AI, resume parse
- [ ] Error panels: raw errors ("signal timed out") anywhere remaining
- [ ] Focus trap / a11y on modals (advisor drawer, fit explainer, skill-gap confirm)
- [ ] Dark mode contrast on orange fit chips, rarity glows, skill pills
- [ ] Cache buster version drift across HTML pages (some `20260702j` vs `20260702u`)

### 0.4 Static analysis scripts

Run and capture output:

```bash
npm run hub:verify
npm run hub:verify:full   # if smoke acceptable
npm run onet:test
node --check functions/**/*.js  # sample key workers
```

Optional: author `scripts/audit-slug-soc.mjs` — flag `careerFocus` slugs in localStorage fixtures that don't resolve in `careers.json`.

### 0.5 Deliverable

**`docs/AUDIT_REPORT.md`** with:
- Executive summary (top 10 issues by user impact)
- Flow diagrams (mermaid) for vector persistence and target career
- Table: Issue | Severity | Files | Proposed fix phase
- Explicit **out of scope** list (avoid scope creep)

**Gate:** User or lead review of audit before Phase 1. Do not start fixes until audit is complete.

---

## Phase 1 — O*NET architecture alignment (correctness)

**Goal:** Every fit score, career identity, and vector mutation uses one canonical path. Legacy fallbacks only when O*NET data truly unavailable.

### 1.1 Canonical career identity

**Problem:** Slugs bounce between `slugify(title)`, legacy hub slugs (`investment-banker`), and SOC.

**Work:**
- Define single helper (client + server): `resolveCanonicalCareer({ slug, soc, name })` → `{ soc, name, slug, hubZone }` or null
- Use in: `recordCareerFocus`, portal target switch, deep dive URL boot, roadmap target header, skill-gap tracker
- Reject or re-resolve non-catalog focuses on portal load (offer switch advisor)

**Files:** `onet-catalog.js`, `career-lookup.js`, `career-target.js`, `roadmap-sync.js`, `portal-target-switch.js`

### 1.2 Unify fit score computation

**Problem:** `computeQuizFit`, `fitForSlugFromVectors`, `rankedOnetCache`, and hub `fitScore` may disagree.

**Work:**
- Document and enforce one function: `FWOnetVectors.fitForSlugOrSoc(slug, soc)` used everywhere
- Hub map: ensure `personalityFit`, `objectiveFit`, `fitScore` always set together (`hub-onet-map.js`)
- Deep dive: remove legacy `computeQuizFit` fallback when vectors exist
- Portal dropdown: show same % as hub for same career

**Files:** `onet-vectors.js`, `career-personalize.js`, `hub-onet-map.js`, `portal-target-switch.js`

### 1.3 Vector persistence audit

**Problem:** Handoff claims all features wired; audit may find stragglers.

**Work:**
- Grep for direct `localStorage.setItem('fw_hub_quiz_v1'` bypassing `persistQuizVectors`
- Grep for `personalityVector` / `objectiveVector` writes without hydrate
- Server: ensure `refreshFullObjective` in `user-vectors.js` includes refine map (fixed in `1052dd5` — verify)
- Wire **objective vector AI patches** from coach + career-analysis chat (personality already works)

**Files:** `auth.js`, `chat.js`, `career-analysis.js`, `coach.js`, all `hub-*.js`, `profile-building.js`

### 1.4 Remove or gate legacy fit UI

**Work:**
- When `panel-dual-fit` has data, never show `panel-fit-wrap--legacy` (delete legacy DOM/CSS if audit confirms safe)
- Hub tooltip: always show personality + objective rows when objective vector non-empty

### 1.5 Coach / roadmap pivot parity

**Work:**
- Apply same O*NET proposal + confirmation pattern as career-switch-chat OR clearly document why coach auto-pivots
- If coach pivots: must call `recordCareerFocus` with validated SOC
- Remove or restrict `extractCustomCareerTarget` for user-facing pivots

**Files:** `chat.js`, `career-roadmap.js`, `roadmap.js`, `_lib/roadmap.js`

### Phase 1 verification

- [ ] Same career shows same fit % on Hub, Portal, Deep Dive (±1% rounding)
- [ ] Sharpen + Academics + Resume → leave site → return → vectors unchanged
- [ ] Invalid target career cannot persist on portal
- [ ] `npm run hub:verify` passes

---

## Phase 2 — Legacy feature integration

**Goal:** Marco, roadmap, quiz results, and hub panels feel like one product on O*NET rails.

### 2.1 Marco (Hub bubble + Coach)

**Current state:** `marco.js` — hub mascot with rotating copy; opens `coach.html`. Uses `FWOnetHub` ranks with multi-level fallback to legacy.

**Work:**
- **Hub bubble:** Ensure messages use O*NET career names from vector ranks, not `FWHubCareers` static list
- **Starter context:** When Marco clicked, pass top gap / target career / recent refine via `sessionStorage` (`fw_marco_starter`) — verify coach reads and uses in first reply
- **Dossier freshness:** After `persistQuizVectors`, trigger dossier re-seed or patch summary on next coach open
- **Discoverability:** Consider Hub nav link to Marco (product call) or stronger bubble CTA
- **Visual polish:** Bubble animation, unread dot, reduced motion respect

**Files:** `marco.js`, `coach.js`, `chat.js`, `hub-dashboard.css`, `dashboard.html`

### 2.2 Roadmap v2 full integration

**Current state:** Tree v2 with skill-gap tracker; v1 legacy stage still rendered; client timeout 120s.

**Work:**
- **Migration UX:** On load, if v1 roadmap detected → one-click "Upgrade to career tree" with explain + backup
- **Target sync:** Roadmap header career always matches `careerFocus` SOC; link to portal switch
- **Focus tracker:** Skill-gap tracker only on v2; hide broken partial states
- **Keyword enrichment:** Surface loading/subtle progress when background Gemini enriches gaps
- **Chat edits:** Roadmap coach chat patch apply + save path — test mark-done deterministic patches
- **Empty states:** No roadmap → CTA tied to target career + O*NET validation

**Files:** `roadmap.js`, `roadmap-tree.js`, `skill-gap-tracker.js`, `career-roadmap.js`, `roadmap-generate.js`, `roadmap.html`

### 2.3 Quiz → Hub → Portal handoff

**Work:**
- Post-quiz redirect lands on portal or hub with vectors already hydrated
- Email results link (`#r=` token) still works with O*NET hub
- Quiz industry results page links to O*NET deep dives (`career.html?soc=`) not legacy `app-pages` slugs
- Sign-up during quiz syncs quiz blob before first portal paint

**Files:** `quiz-app.js`, `send-results.js`, `auth.js`, `page-boot.js`

### 2.4 Deep dive & `app-pages.js` consolidation

**Work:**
- Audit whether `app-pages.js` static career content still serves any route
- If `career.html` fully uses `career-personalize.js` + API: deprecate duplicate static narratives
- Ensure O*NET skills pills, match bars, AI profile, readiness chip consistent with portal fit panel language

**Files:** `app-pages.js`, `career-deep-dives.js`, `career-personalize.js`, `career.html`

### 2.5 Profile building & alignment

**Work:**
- "Know You Better" completion updates vectors + portal snapshot cards
- `profile-alignment.js` warnings surface on portal when target career misaligned with quiz
- Profile-building fallback JS on portal matches wizard behavior

**Files:** `profile-building.js`, `profile-alignment.js`, `portal.js`, `profile-build.html`

### Phase 2 verification

- [ ] Marco → Coach conversation references user's actual top O*NET match
- [ ] New user: quiz → hub → pick career → roadmap generates < 30s
- [ ] v1 roadmap users see clear upgrade path
- [ ] No user-facing route depends on 40-career `hub-careers.js` list for fit (static list OK for layout bridge only)

---

## Phase 3 — UI / UX / GUI craftsmanship

**Goal:** Visual and interaction polish consistent with FlightWay brand (Inter, orange primary, calm density). **Only after Phases 1–2 correctness gates pass.**

Read UI skill. Work page-by-page.

### 3.1 Design system pass

- Audit CSS variables in `flightway-theme.css` — remove unused, document tokens
- **Typography:** Inter for all UI headings (portal fix @ `d877f0b` — extend to career, roadmap, coach, quiz, hub)
- **Playfair:** Remove from pages or restrict to marketing quotes only
- **Spacing rhythm:** 4/8px grid on portal cards, hub drawer, fit panels
- **Button hierarchy:** Primary orange, outline secondary — consistent across roadmap CTA, advisor Send, hub actions

### 3.2 Page-by-page polish

| Page | Priority fixes |
|------|----------------|
| `portal.html` | Target row layout mobile; advisor drawer; snapshot cards loading skeletons; empty quiz state |
| `dashboard.html` | Hub boot error recovery; search suggest keyboard nav; sector back affordance; panel drawer scroll |
| `career.html` | Fit panel gap cards; AI profile spacing; O*NET match section labels; chat drawer |
| `roadmap.html` | Tree visual hierarchy; phase cards; regen loading; error friendly copy |
| `coach.html` | Message bubbles, typing indicator, dossier loading, exchange limit UX |
| `quiz.html` | Progress bar, results screen, signup friction |
| `auth.html` | Form validation messages, password strength |
| `profile-build.html` | Step progress, encouragement copy |
| `index.html` | Marketing alignment with app nav brand |

### 3.3 Interaction details

- Unified toast component (`FWFwToast`) vs ad-hoc alerts — use one
- Loading: skeleton placeholders not spinners-only for >300ms operations
- Optimistic UI only where rollback is safe (not career focus switch)
- `prefers-reduced-motion` for canvas, Marco bubble, fit bar animations
- Focus management on every dialog open/close

### 3.4 Accessibility

- Color contrast WCAG AA on rarity tiers and orange buttons (dark mode)
- All icon-only buttons have `aria-label`
- Live regions for fit updates and advisor replies
- Keyboard: hub search, portal dropdown, advisor confirm buttons

### Phase 3 verification

- [ ] Consistent fonts across all signed-in pages
- [ ] No horizontal scroll at 375px width on portal + career + roadmap
- [ ] axe or manual a11y spot-check on primary flows

---

## Phase 4 — Performance & reliability

**Goal:** Sub-30s roadmap, sub-5s deep dive cache hit, no client aborts.

### 4.1 Caching strategy

- Document TTLs: analysis 6h, roadmap freshness `ROADMAP_FRESH_MS`, ranked vector cache invalidation rules
- Portal snapshot: bundle vectors + focus + top matches in one `/portal-snapshot` call — reduce waterfall
- KV/D1: avoid serving truncated pre-`trimProse` analyses — optional one-time cache bust migration

### 4.2 Client network

- Standardize `authFetch` timeouts per endpoint (advisor 90s, roadmap 120s, analysis 60s, default 30s)
- Retry policy table in `auth.js` comments
- Offline/local-only signed-out graceful degradation messages

### 4.3 Hub canvas

- Profile RAF loop when tab hidden
- Lazy-load `vectors-lv.f32.bin` only when needed
- Search debounce on hub career search

### 4.4 Server

- Gemini: shared retry helper already in `_lib.js` — audit all callers use it
- Roadmap generate: keep fast keyword path; log slow requests with career SOC + duration

---

## Phase 5 — Verification, docs, ship

### 5.1 Test matrix (manual)

| # | Flow | Expected |
|---|------|----------|
| 1 | Fresh quiz → hub | Orbs colored by vector fit |
| 2 | Sharpen matches → portal | Fit % matches hub |
| 3 | Academics + transcript | Objective bars move |
| 4 | Resume upload | Portal dual fit updates |
| 5 | Deep dive AI | No mid-word truncation |
| 6 | Switch advisor | O*NET confirm → valid fit |
| 7 | Roadmap generate | Completes < 120s |
| 8 | Marco → coach | Contextual first message |
| 9 | Sign out/in | Vectors restore from D1 |
| 10 | Dark mode | Readable fit panels |

### 5.2 Automated

```bash
npm run hub:verify
npm run onet:test
# Add scripts/verify-vector-persistence.mjs if valuable
```

### 5.3 Documentation updates

- Update `CONVERSATION_HANDOFF.md` after each phase
- Close items in `AUDIT_REPORT.md` as fixed
- Update `ARCHITECTURE.md` if legacy sections removed

### 5.4 Ship

```bash
git push origin Jacob_Work
npm run deploy:prototype
```

Post-deploy: hard-refresh checklist for cache busters.

---

## Suggested execution order (PR-sized chunks)

| Order | Chunk | Phase | Est. risk |
|-------|-------|-------|-----------|
| 1 | Write `AUDIT_REPORT.md` only | 0 | None |
| 2 | Canonical career resolver + invalid focus cleanup | 1.1 | Medium |
| 3 | Unify `fitForSlugOrSoc` consumers | 1.2 | Medium |
| 4 | Vector persistence stragglers + objective AI patches | 1.3 | High |
| 5 | Coach/roadmap pivot parity with O*NET | 1.5 | High |
| 6 | Remove legacy hub fit panel | 1.4 | Low |
| 7 | Marco context + dossier freshness | 2.1 | Medium |
| 8 | Roadmap v1→v2 migration UX | 2.2 | Medium |
| 9 | Quiz handoff + app-pages deprecation | 2.3–2.4 | Medium |
| 10 | Typography + portal/hub polish | 3 | Low |
| 11 | Career + roadmap + coach polish | 3 | Low |
| 12 | Performance pass | 4 | Medium |
| 13 | Final verify + docs | 5 | Low |

---

## Known starting points (from recent work)

Do not re-litigate these unless audit finds regressions:

- Vector persistence: `hydrateQuizVectors` / `persistQuizVectors` (`1052dd5`)
- O*NET match blend 0.75O + 0.25P + bleed 0.2 (`2d8e7c0`)
- AI `trimProse` truncation (`99b6e65`)
- Roadmap timeout fixes (`cf917d1`)
- Career switch O*NET confirmation (`980b1dd`)
- Portal title Inter font (`d877f0b`)
- Gemini fallback `gemini-2.5-flash` (`3bd98b4`)

---

## Anti-patterns to avoid

1. **Polish before correctness** — fixing border-radius while fit scores disagree
2. **New abstractions** — prefer extending `FWOnetVectors` / `FWAuth` over new globals
3. **Big-bang rewrite** of `hub-careers.js` — bridge gradually via SOC
4. **Browser MCP verification** — use scripts and curl
5. **Editing plan files** user marked read-only
6. **Force-push** `main` or skip hooks
7. **Committing** `.env`, `.dev.vars`, `node_modules`

---

## Success criteria (definition of done)

- [ ] Audit report exists and all P0/P1 issues closed
- [ ] Zero user flows depend on verbatim non-O*NET career slugs
- [ ] Fit scores consistent across Hub, Portal, Deep Dive for same SOC
- [ ] Marco + Coach + Roadmap + Advisor feel integrated, not bolted on
- [ ] No raw timeout errors in UI
- [ ] Typography and spacing consistent with brand
- [ ] `npm run hub:verify` green on `Jacob_Work`
- [ ] `CONVERSATION_HANDOFF.md` reflects final state

---

*Plan version 1.0 — 2026-07-02 — branch `Jacob_Work` @ `980b1dd`*
