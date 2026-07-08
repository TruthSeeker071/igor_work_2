# FlightWay — Conversation Handoff (Jacob_Work prototype)

**Generated:** 2026-07-02  
**Branch:** `Jacob_Work` (synced with `origin/Jacob_Work`)  
**Latest commit:** `980b1dd` — Require O*NET match confirmation before career switch advisor pivots  
**Deploy target:** `flightwayjacobprototype` via `npm run deploy:prototype`

Use this document to resume work in Claude Code (or any agent) with minimal context loss.

---

## 1. What FlightWay Is

FlightWay is a **vanilla HTML/CSS/JS** career exploration product (no React, no build step for the site itself). It runs on **Cloudflare Pages** with **Pages Functions** (`/functions/`) for API routes, **D1** for auth/profile persistence, and **KV** (`COACH_KV`) for dossier + chat history.

Core value prop:
- Short career **quiz** → industry/career fit scores
- **O*NET-backed** 161-dimension personality + objective vectors
- Interactive **Career Hub** map (canvas)
- **Career deep dives** with AI-generated analysis (Gemini)
- **Career roadmap** + skill-gap tracker
- **Marco** AI coach (full coaching chat)
- **Portal** home page with target career switching

---

## 2. Environments & Deploy

| Item | Value |
|------|-------|
| Production branch | `main` → Pages project `flightway` |
| **Prototype branch** | **`Jacob_Work`** → Pages project **`flightwayjacobprototype`** |
| Deploy command | `npm run deploy:prototype` |
| Local dev | `cp .dev.vars.example .dev.vars` then `npx wrangler pages dev .` |
| Verify | `npm run hub:verify` (data + LOD checks) |

**User convention:** After feature/fix work on prototype, **commit and push to `Jacob_Work`** (see `.cursor/rules/jacob-work-prototype.mdc`).

**Bindings** (`wrangler.toml`):
- `COACH_KV` — dossier, chat transcripts
- `DB` — D1 `flightway-db` (users, sessions, quiz_profiles, roadmaps, career_analyses)

**Secrets** (Pages → Variables): `GEMINI_API_KEY`, `RESEND_API_KEY`, optional `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `ALLOWED_ORIGIN`.

**Do not use browser MCP** for verification — use `npm run hub:verify`, `node --check`, curl. See agent-efficiency skill.

**Cache busters:** HTML pages append `?v=YYYYMMDDx` on CSS/JS imports. Bump when touching assets.

---

## 3. Directory Structure

```
flightway/
├── index.html              # Marketing landing
├── portal.html             # Signed-in home (target career, advisor, snapshot)
├── dashboard.html          # Career Hub canvas map
├── career.html             # Career deep dive (?slug= / ?soc=)
├── roadmap.html            # Roadmap + focus tracker (?focus=1)
├── coach.html              # Marco AI coach
├── quiz.html               # Initial 7-question quiz
├── auth.html               # Sign in / register / reset
├── profile-build.html      # "Know You Better" profile wizard
├── Flightway.html          # Legacy hash redirect shim
├── _redirects              # Cloudflare Pages static routes
├── wrangler.toml
├── package.json
│
├── assets/
│   ├── css/
│   │   ├── flightway-theme.css      # Design tokens, nav, brand
│   │   ├── flightway-pages.css      # Portal, career, roadmap, fit panels
│   │   ├── hub-dashboard.css        # Career Hub canvas UI
│   │   └── skill-gap-tracker.css
│   └── js/
│       ├── boot/theme-boot.js       # FOUC prevention (blocking in <head>)
│       ├── shared/                  # Cross-page modules (see §5)
│       ├── app/                     # Portal, roadmap, skill-gap, app-pages data
│       ├── hub/                     # Career Hub canvas + panels + deep dive
│       ├── coach/                   # Marco chat UI
│       ├── quiz/                    # Quiz engine + data
│       ├── profile/                 # Profile-building wizard
│       └── landing/                 # Marketing interactions
│
├── data/onet/
│   ├── artifacts/                   # ETL output (careers.json, vectors bin, layouts)
│   ├── dimension-registry-v1.json   # 161 O*NET dimension names/domains
│   └── hub-career-soc-map.json      # Legacy 40-career hub bridge → SOC codes
│
├── functions/                       # Cloudflare Pages Functions (API)
│   ├── _lib.js                      # CORS, KV, Gemini config, dossier
│   ├── _lib/
│   │   ├── auth.js                  # Sessions, D1, rate limits
│   │   ├── roadmap.js               # Roadmap schema, pivot rules, patches
│   │   ├── roadmap-generate.js      # Gemini roadmap tree generation
│   │   ├── roadmap-sync.js          # careerFocus, retarget, history
│   │   ├── gemini-json.js           # JSON-mode Gemini helper
│   │   ├── focus-keywords.js        # Skill-gap keyword enrichment
│   │   └── onet/                    # Server-side O*NET (store, vectors, maps)
│   ├── auth/                        # login, register, logout, me, forgot/reset
│   ├── profile/                     # quiz GET/PUT, roadmap GET/PUT
│   ├── career-analysis.js           # Deep dive AI analysis + chat patches
│   ├── career-roadmap.js            # Roadmap generate + chat
│   ├── career-switch-chat.js        # Portal career switch advisor
│   ├── career-focus.js              # POST target career change
│   ├── chat.js                      # Marco coach chat
│   ├── resume-parse.js              # Resume PDF → objective vector
│   ├── portal-snapshot.js           # Portal home data bundle
│   └── onet/                        # careers, vectors, similar APIs
│
├── scripts/
│   ├── onet-etl/build.mjs           # npm run onet:build
│   ├── verify-hub-data.mjs          # npm run hub:verify
│   ├── verify-hub-lod.mjs
│   └── pages-deploy.mjs             # Staged deploy excluding .onet-cache
│
├── migrations/                      # D1 schema SQL
└── docs/
    ├── ARCHITECTURE.md
    ├── SETUP.md
    └── CONVERSATION_HANDOFF.md      # (this file)
```

---

## 4. HTML Pages → JS Entry Points

| Page | Primary render | Auth gate |
|------|----------------|-----------|
| `portal.html` | `FWPortal.render()` | `FWPageBoot.requireAuth` |
| `dashboard.html` | Hub canvas (`hub-dashboard.js`, `hub-onet-map.js`) | Optional quiz token |
| `career.html` | `career-personalize.js` deep dive | Session for AI |
| `roadmap.html` | `roadmap.js` | `requireAuth` |
| `coach.html` | `coach.js` | `requireAuth` |
| `quiz.html` | `quiz-app.js` | None |
| `profile-build.html` | `profile-building.js` | `requireAuth` |

**Shared boot pattern:**
```html
<script src="assets/js/shared/page-boot.js"></script>
<script src="assets/js/shared/auth.js"></script>
<script>
  FWPageBoot.authBootThen(function () {
    if (!FWPageBoot.requireAuth('portal.html')) return;
    FWPortal.render();
  });
</script>
```

**Nav:** `assets/js/shared/app-nav.js` + `brand.js` (`.fw-brand` = Inter via inherit).

---

## 5. Client-Side Global Modules (`window.FW*`)

| Global | File | Role |
|--------|------|------|
| `FWAuth` | `shared/auth.js` | Session cookies, quiz/roadmap sync, `authFetch`, `recordCareerFocus` |
| `FWOnetVectors` | `shared/onet-vectors.js` | **Canonical vector pipeline** — personality/objective 161-dim |
| `FWOnetCatalog` | `shared/onet-catalog.js` | Load `careers.json`, search by title, SOC/slug resolve |
| `FWOnetMath` | `shared/onet-math.js` | Cosine fit, vector math |
| `FWRefineMap` | `shared/refine-map.js` | Sharpen Matches → personality/objective rules |
| `FWAcademicsMap` | `shared/academics-map.js` | Academic profile → objective rules |
| `FWCareerTarget` | `shared/career-target.js` | Target career events, `FOCUS_EVENT` |
| `FWPortalCareerAdvisor` | `app/portal-career-advisor.js` | Career Switch Advisor UI |
| `FWHubCareers` | `hub/hub-careers.js` | Legacy 40-career hub bridge + industry scores |
| `FWPageBoot` | `shared/page-boot.js` | Auth boot, redirects |

---

## 6. localStorage / State Keys

| Key | Contents |
|-----|----------|
| `fw_hub_quiz_v1` | **Master quiz blob**: scores, personalityVector, objectiveVector, refine, academics, careerFocus, profile |
| `fw_hub_refine_v1` | Sharpen Matches answers |
| `fw_hub_academics_v1` | Academic panel answers |
| `fw_hub_base_scores_v1` | Pre-refine industry scores |
| `fw_roadmap_v1` | Cached roadmap JSON |
| `fw_career_analysis_cache` | Client-side deep dive analysis cache (6h TTL) |
| `flightway-theme` | light/dark |

**Server sync (logged in):** `PUT /profile/quiz`, `PUT /profile/roadmap`, `POST /career-focus`.

---

## 7. O*NET Vector Architecture (CRITICAL)

### Schema
- **161 dimensions** (`onet-lv-161-v1`), levels stored **0–100 scale** (ETL `lvTo100` in `scripts/onet-etl/build.mjs`)
- **Never** apply `(level/7)*100` again — data is already 0–100

### Two user vectors
1. **Personality vector** — seeded from quiz industry scores → zone centroids; refined by Sharpen Matches + profile-building patches
2. **Objective vector** — academics rules → refine rules → resume/transcript rules (+ Gemini objective patch on resume parse)

### Blend formula (current as of `2d8e7c0`)
```js
// weightedUserComponent — used for skill pills + O*NET match bars ("You" column)
user[i] = 0.75 * objective[i] + 0.25 * personality[i]

// Overall fit display (when both exist)
overall = 0.75 * personalityFit + 0.25 * objectiveFit  // hub explainer text

// Resume → personality bleed
personality[i] += 0.2 * (objectiveAfter[i] - objectiveBefore[i])
```

### Canonical persistence path (`1052dd5`)
**Always funnel vector updates through:**
```js
FWOnetVectors.hydrateQuizVectors(quiz)  // idempotent rebuild from inputs
FWOnetVectors.persistQuizVectors(quiz)  // localStorage + clear rank cache + D1 sync
```

**Rebuild order in `hydrateQuizVectors`:**
1. Personality: quiz seed → `FWRefineMap.refreshPersonalityFromRefine`
2. Objective: academics → refine → resume (with personality bleed)

**Boot:** `onet-vectors.js` runs `bootHydrateQuizVectors` on DOMContentLoaded when refine/academics/resume inputs exist.

**Features wired to persist:**
| Feature | Updates | Via |
|---------|---------|-----|
| Sharpen Matches (`hub-refine.js`) | personality + objective | `persistQuizVectors` |
| Academic Profile (`hub-academics.js`) | objective (+ industry scores) | `persistQuizVectors` |
| Resume parse | objective + bleed | `applyObjectiveFromResponse` |
| Profile-building | personality | `FWAuth.applyVectorsFromResponse` |
| Coach/career chat | personality patch | server returns `personalityVector` |

**Still TODO:** Objective vector AI patches from Gemini chat (personality only wired today).

---

## 8. Career Hub Workflows

### Map (`dashboard.html`)
1. Load O*NET careers + layout from `/data/onet/artifacts/`
2. `hub-onet-map.js` — canvas pan/zoom, sector drill-down, orb colors by fit rarity
3. Fit = cosine similarity personality + objective vs career vectors

### Sharpen Matches (`hub-refine.js`)
- Right panel: extra quiz-style questions
- Writes `fw_hub_refine_v1` + updates `fw_hub_quiz_v1.refine`
- Must call `persistQuizVectors` (fixed in `1052dd5`)

### Academic Profile (`hub-academics.js`)
- GPA, classes liked/disliked, major, transcript upload
- Writes `fw_hub_academics_v1` + mirrors to `fw_hub_quiz_v1.academics`
- Must call `persistQuizVectors` + server sync

### Career Deep Dive (`career.html` + `career-personalize.js`)
- URL: `career.html?slug=` or `?soc=`
- Sections: overview, skills (orange pills with weighted fill), O*NET match bars, AI Profile panel
- AI analysis: `POST /career-analysis` → cached in D1 + localStorage
- **Truncation fix (`99b6e65`):** `trimProse()` word-boundary caps in `normalizeAnalysis()` — summary 100 words, insights 40, considerations 35
- Fit panel: Personality / Objective / **Readiness** chips; gap cards grid; roadmap CTA button

---

## 9. Portal Home Workflows

### Target career row (`portal-target-switch.js`)
- Dropdown: top quiz matches + **catalog search** (`FWOnetCatalog.searchByTitle`) — added `d15afc1`
- Selecting career → `FWAuth.recordCareerFocus` source `home_dropdown` or `portal_pick`
- Dual fit bars: personality + objective via `/vector-fit`

### Career Switch Advisor (`portal-career-advisor.js` + `/career-switch-chat`)
**Scoped chat** — career switching only, not full Marco coaching.

**Flow after `980b1dd`:**
1. User: "I want to switch to Investment Banking Analyst"
2. Server: `proposeOnetCareersForMessage` → fuzzy O*NET search (NOT verbatim Gemini slug)
3. Reply proposes e.g. **Financial and Investment Analysts** (13-2051.00)
4. Returns `awaitingConfirmation: true`, `proposedFocus`, `pendingProposal`
5. User confirms ("yes" or **Yes, switch** button) → `validateOnetCareer` → `recordCareerFocus`
6. Client dispatches `FWCareerTarget.FOCUS_EVENT` → portal UI updates

**Never** auto-switch to non-O*NET titles. `extractCustomCareerTarget` (Gemini verbatim) is **not** used for home advisor.

**Key files:**
- `functions/_lib/onet/career-lookup.js` — fuzzy search, proposal, confirmation helpers
- `functions/career-switch-chat.js`
- `assets/js/app/portal-career-advisor.js` — `state.pendingProposal`

---

## 10. Roadmap Workflows

### Generation (`/career-roadmap` → `career-roadmap.js` + `roadmap-generate.js`)
- Tree v2 roadmap with phases, actions, skill gaps
- **Timeout fix (`cf917d1`):**
  - Client timeout 45s → **120s** (`assets/js/app/roadmap.js`)
  - Server: parallel loading, 2 tree retries, v1 fallback, `{ fast: true }` keywords (no per-gap Gemini during generate)
  - Background keyword enrichment via `enrichRoadmapFocusKeywords`

### Skill Gap Tracker (`skill-gap-tracker.js`)
- Tied to roadmap focus tracker waypoints
- Confirm modal before marking gaps done

### Career focus (`functions/_lib/roadmap-sync.js`)
- `recordCareerFocus(env, email, { slug, name, source, soc })`
- `FOCUS_WEIGHTS` — higher weight sources override lower (home_advisor: 85, portal_pick: 80, hub_view: 5)
- `careerFocusHistory` — last 20 switches, used for advisor prompts

---

## 11. AI / Gemini Configuration

**Defaults** (`functions/_lib.js`):
```js
DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite'
DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'  // on 503/429
```

`resolveGeminiModels(env)` dedupes and ensures distinct fallback. Deprecated `gemini-2.0-*` env overrides are sanitized/ignored.

**Endpoints using Gemini:**
| Endpoint | Purpose |
|----------|---------|
| `/chat` | Marco coach |
| `/career-analysis` | Deep dive analysis + chat patches |
| `/career-roadmap` | Roadmap generation + chat |
| `/career-switch-chat` | Switch advisor (exploratory replies only; switch is rules-based) |
| `/resume-parse` | PDF extraction + objective patch |
| `/profile-building` | Know You Better |
| `/quiz-enrich` | Post-quiz enrichment |

**Retry pattern:** 800ms, 2000ms backoff on 429/500/503; try fallback model.

---

## 12. API Routes (Pages Functions)

Functions map to URL paths by file location:
```
/functions/account.js           → POST /account
/functions/auth/login.js        → POST /auth/login
/functions/auth/register.js     → POST /auth/register
/functions/auth/logout.js       → POST /auth/logout
/functions/auth/me.js           → GET  /auth/me
/functions/chat.js              → POST /chat
/functions/dossier.js           → GET/PUT /dossier
/functions/profile/quiz.js      → GET/PUT /profile/quiz
/functions/profile/roadmap.js   → GET/PUT /profile/roadmap
/functions/career-focus.js      → POST /career-focus
/functions/career-analysis.js   → POST /career-analysis
/functions/career-roadmap.js    → POST /career-roadmap
/functions/career-switch-chat.js→ POST /career-switch-chat
/functions/resume-parse.js      → POST /resume-parse
/functions/portal-snapshot.js   → GET  /portal-snapshot
/functions/vector-fit.js        → POST /vector-fit
/functions/onet/careers.js      → GET  /onet/careers
/functions/onet/vectors.js      → GET  /onet/vectors
/functions/send-results.js      → POST /send-results
```

All authenticated routes use `requireSession` → HTTP-only `fw_session` cookie.

---

## 13. O*NET Data Pipeline

```bash
npm run onet:build    # Requires O*NET text DB in .onet-cache/db_30_3_text
npm run onet:test     # Math sanity checks
npm run hub:verify    # Verify deployed artifacts + hub LOD
```

**Outputs** (`data/onet/artifacts/`):
- `careers.json` — ~782 MVP careers with SOC, title, hubZone, layout coords
- `vectors-lv.f32.bin` — career vectors (Float32)
- `importance-im.f32.bin` — importance weights
- `layout-2d.json`, `zone-layout.json` — map positions
- `zone-centroids.json` — personality seeding

**Catalog search:** Client `FWOnetCatalog.searchByTitle`; server `searchOnetCareersByTitle` / `proposeOnetCareersForMessage`.

**Legacy bridge:** 40 hub careers in `hub-career-soc-map.json` map to SOC lists; `SLUG_ALIASES` in catalog + `roadmap-sync.js` (e.g. `investment-banking` → `investment-banker`).

---

## 14. Recent Session History (commits newest first)

| Commit | Summary |
|--------|---------|
| `980b1dd` | Career switch advisor: O*NET proposal + confirmation before pivot |
| `d877f0b` | Portal `.portal-title` font: Playfair → inherit (Inter brand) |
| `d15afc1` | Switch advisor timeout fix + dropdown catalog search |
| `cf917d1` | Roadmap generation timeout fix (client 120s, server optimizations) |
| `1052dd5` | **Global vector persistence** — `hydrateQuizVectors` / `persistQuizVectors` |
| `99b6e65` | AI Profile truncation fix (insights + considerations `trimProse`) |
| `4a4b7d8` | AI summary truncation fix |
| `2d8e7c0` | O*NET match bars: **0.75 objective + 0.25 personality**; resume bleed 0.2× |
| `b4562f1` | Fit panel UI: gap cards, Readiness label, roadmap button |
| `3bd98b4` | Gemini 503 fallback → `gemini-2.5-flash` |
| `098abcd` | Fix O*NET double-scaling (867/100 bug); orange skill pills |

---

## 15. Known Issues & Gotchas

1. **O*NET levels are 0–100** — never re-scale from 0–7 in display code; use `formatScale100` passthrough
2. **Cached analyses in KV/D1** may show old truncated text until user re-runs deep dive
3. **Cached roadmaps in D1** persist until regenerate — hard refresh + new generate after server changes
4. **Career titles are plural in O*NET** — e.g. "Financial Quantitative Analysts" not "Analyst"
5. **Invalid target careers** (verbatim non-O*NET names) break fit display — "Fit details unavailable"
6. **Logged-out users** — vectors only in localStorage; no cross-device until sign-in
7. **Cloudflare env:** If `GEMINI_FALLBACK_MODEL=gemini-2.0-flash` exists in Pages settings, delete it (code ignores deprecated models but stale env can confuse debugging)
8. **Do not edit** plan file `gemini_model_and_deep_dive_polish_f21ca07a.plan.md` if present — user rule
9. **Playfair Display** still loaded on some pages for decorative use — only `.portal-title` was fixed to inherit

---

## 16. Verification Checklist

```bash
# Before push
npm run hub:verify
npm run hub:verify:full   # adds hub:smoke + pages:smoke (real page boot; catches TDZ/runtime throws node --check can't)
node --check functions/career-switch-chat.js   # on touched files

# Deploy prototype
npm run deploy:prototype
git push origin Jacob_Work

# Manual smoke (hard refresh after deploy)
# 1. Portal → target dropdown search "financial quant"
# 2. Career Switch Advisor → propose + confirm switch
# 3. Career deep dive → AI summary not mid-word cut
# 4. Roadmap → new career generates in ~15–25s
# 5. Hub → Sharpen Matches / Academics → navigate away → vectors persist
```

---

## 17. Skills & Rules for Agents

| Resource | When to use |
|----------|-------------|
| `/Users/jacobklugerman/.cursor/skills/web-design/SKILL.md` | Any HTML/CSS/frontend edit |
| `.cursor/rules/jacob-work-prototype.mdc` | Push to Jacob_Work after work |
| `docs/ARCHITECTURE.md`, `docs/SETUP.md` | Deploy + infra |
| Agent-efficiency skill | No browser MCP for verification |

**Code principles:** Vanilla JS only, minimal scope, match existing patterns, reuse `FWOnetVectors` / `FWAuth` helpers, bump cache busters on HTML when touching assets.

---

## 18. File Quick-Reference (frequently touched)

```
Vector pipeline:     assets/js/shared/onet-vectors.js
                     functions/_lib/onet/user-vectors.js
Auth + sync:         assets/js/shared/auth.js
                     functions/_lib/auth.js
Career catalog:      assets/js/shared/onet-catalog.js
                     functions/_lib/onet/career-lookup.js
                     data/onet/artifacts/careers.json
Deep dive UI:        assets/js/hub/career-personalize.js
                     functions/career-analysis.js
Fit panel CSS:       assets/css/flightway-pages.css  (.fit-panel--ai, .fit-gap-card)
Portal target:       assets/js/app/portal-target-switch.js
Switch advisor:      assets/js/app/portal-career-advisor.js
                     functions/career-switch-chat.js
Roadmap:             assets/js/app/roadmap.js
                     functions/career-roadmap.js
                     functions/_lib/roadmap-generate.js
Hub panels:          assets/js/hub/hub-refine.js
                     assets/js/hub/hub-academics.js
Gemini config:       functions/_lib.js
Resume rules:        assets/js/shared/academics-map.js (client)
                     functions/_lib/onet/academics-map.js (server)
Refine rules:        assets/js/shared/refine-map.js
                     functions/_lib/onet/refine-map.js
```

---

## 19. Suggested Next Work (if resuming)

- Wire **objective vector AI patches** from coach/career chat (personality already works)
- Audit any remaining features that mutate vectors without `persistQuizVectors`
- Roadmap **background keyword enrichment** reliability
- Profile page cache busters if `profile.html` is added outside repo
- Production env audit on `flightwayjacobprototype` for stale Gemini env vars

---

*End of handoff. Branch `Jacob_Work` @ `980b1dd`.*

---
## Phase 1 addendum (2026-07-02, Jacob_Work @ e6840dd)

Phase 0 audit: docs/AUDIT_REPORT.md (all findings with file:line). Phase 1 (O*NET correctness) landed in five commits:

- 8ae731c — Sync integrity. hydrateQuizVectors is idempotent (keeps stored vector objects/updatedAt when a rebuild is a value no-op — staleness hashes hold still across boots); refine tags now record pre-bump values ("refine:42") so strip is an exact inverse; resume personality bleed records a bleedBase restore map (was accumulating +0.2×delta every page load); uploadLocalQuizIfPresent merges vectors+focus like loadProfile; quizPayloadHash covers refine/academics/resume/vector timestamps/focus; server PUT /profile/quiz keeps the uploaded objective object on value no-ops.
- 4590342 — Pivot safety. resolveCareerTargetFromMessage only returns catalog careers (bestCatalogMatch with fuzzy confidence floor; verbatim Gemini slugs eliminated); server recordCareerFocus canonicalizes/rejects chat pivots (STRICT_CATALOG_SOURCES) and backfills SOC for UI sources; roadmap-chat pivots record focus and stop reusing the old career's fitContext.
- b31173b — Objective AI patch layer. quiz.objectiveAiPatch (absolute per-dim values, merged by index) replayed as the final step of BOTH rebuilds (client hydrateQuizVectors, server refreshFullObjective in resume-map.js). resume-parse persists+returns it; coach chat + deep-dive chat now generate objective patches (patchObjectiveFromLearning / maybePatchObjectiveForUser, dossier-updated trigger, sequential after sector patch). Closes the "objective AI patches not wired" TODO.
- ae95736 — Fit unification. fitForSlugOrSoc returns the blended overallFitScore (0.75p+0.25o) with components; deep dive no longer falls back to the legacy 40-career industry breakdown.
- e6840dd — Bypass writes routed through persistQuizVectors (writeQuizPersonalityVector, resume-ingest, portal-resume, markSkipped). quiz-app initial seed writes intentionally kept.

Offline test harness (browser-stubbed real modules): hydration idempotency, patch replay, event dispatch, payload-hash coverage, fit blend parity — currently in session scratchpad; consider promoting to scripts/test-vectors.mjs.

Cache busters now at v=20260702y for onet-vectors/resume-ingest/portal-resume, w for auth.js, x for career-personalize (auth.html/coach.html now HAVE busters — they previously had none).

Next (Phase 2 per plan + audit issues 10–15, 17–21): quiz→deep-dive legacy links, app-pages consolidation, Marco starter context server-side, SLUG_ALIASES dedup, typography/cache-buster hygiene, a11y.

## Phase 2 addendum (2026-07-03, Jacob_Work @ 35ec995)

Legacy integration landed in five commits (audit issues 10–15 closed; Phase 2 of the plan):

- 34c3409 — Quiz results career links were DEAD (showCareer + bare `careers`/`FWHubDeepDives` refs don't exist on quiz.html → ReferenceError killed the breakdown render). Now real hrefs to career.html?slug=… with typeof-guarded titles.
- (decision, no code) — app-pages.js careers{} stays: its 12 curated entries are the richest pre-AI shell on career.html (FWHubDeepDives only aliases generated profiles); quiz no longer routes into it; deleting would be the plan's forbidden big-bang rewrite. Audit issue 11 closed as "keep, documented".
- c184a3e — Marco's bubble opener now reaches /chat as starterContext and is seeded as the opening assistant turn; coach uses authFetch w/ 60s timeout (was raw fetch, could hang); alert() removed; marco.js no longer hard-bails without FWHubCareers; bubble respects prefers-reduced-motion. Also cleaned duplicate response keys chunk C left in chat.js.
- b2c2aee — Background Gemini keyword enrichment now actually runs (fast keywords are tagged keywordsSource:'fast' and an upgrade pass runs via ctx.waitUntil on the freshly-loaded roadmap; previously enrichRoadmapFocusKeywords had zero callers and fast keywords permanently blocked enrichment). Roadmap v1 fallback copy is a clear one-click upgrade.
- 35ec995 — SLUG_ALIASES: onet-catalog.js is documented canonical, hub-careers delegates at runtime, and `npm run verify:aliases` asserts all four copies identical. Vector invariants harness promoted to `npm run test:vectors` (23 assertions).

Verified already-correct (no changes needed): roadmap target-mismatch chip + focused empty state; profile-building vector/persist/snapshot flow (fixed by Phase 1 chunk E).

Remaining for Phase 3 (UI craftsmanship): Playfair→Inter sweep, cache-buster unification (auth/coach pages now versioned but drift remains), FWToast adoption, a11y (dialog semantics, aria-live), mobile spot-checks. Phase 4: portal-snapshot waterfall, fitForSlugFromVectors full-rank cost, RAF profiling.

## Phase 3 addendum (2026-07-03, Jacob_Work @ 984b6a5)

UI craftsmanship, with the Career Hub as the priority (user-directed; legacy main-branch hub used as the visual reference):

- bad30f2 — Career Hub restoration. The O*NET migration had flattened the macro view to plain translucent rectangles (legacy was a glowing 40-career constellation). Now: each zone tile contains a mini constellation of its real careers as rarity-colored stars at true layout positions (previews the sector layout; unfetched = neutral gray, colorizes as vector batches land); radial-gradient tile fills with rarity-glow hover halo/border; top-3 fit zones prefetch vectors at boot + hover prefetch per zone (FWOnetHub.prefetchZoneVectors now exported); dark-mode cursor spotlight restored in both views (motion-safe); sector background is a radial zone wash + edge vignette; orb specular restored to the legacy 3-stop metallic profile.
- 9839d8b — Playfair Display fully retired. --font-display token → Inter stack; all ~30 explicit Playfair declarations now use the token; Playfair dropped from every Google Fonts URL (one fewer webfont per page). All CSS links unified to a single ?v= cache buster.
- 984b6a5 — A11y: aria-labels on icon-only close/regenerate buttons; portal dual-fit is a polite live region. (Note: portal-target-switch.js was CRLF and got normalized to LF in this commit — content otherwise unchanged.) Verified already present: Escape handlers on all overlays, aria-modal dialogs, hub HUD live region, sector back affordance.

Deferred to manual browser QA / Phase 4: focus-trap on dialogs, dark-mode contrast measurement, 375px overflow checks, FWToast adoption beyond portal/roadmap, native confirm() → styled dialogs.

## Phase 4 addendum (2026-07-03, Jacob_Work @ 97e4e58)

Performance & reliability (plan Phase 4; audit issues 20, 21 closed):

- 97e4e58 — fitForSlugFromVectors fetches ONE vector via SOC resolution instead of ranking all 782 careers (~20 network batches) per lookup; hub search debounced 120ms (suggest dropdown stays immediate); deep-dive /career-analysis calls get explicit 90s timeouts (they were silently capped by authFetch's 30s default — a live truncation bug for slower Gemini generations); package.json is type:module (vector test harness → scripts/test-vectors.cjs); roadmap generations >30s log SOC+duration.

Verified already correct, no changes: hub RAF pauses on hidden tabs (visibilitychange); authFetch has a global 30s default timeout (AUTH_FETCH_TIMEOUT_MS) with per-endpoint overrides — policy now documented at the function; portal snapshot per-boot regeneration was fixed at the root by Phase 1's idempotent hydration.

Cache TTL reference (plan 4.1):
- Career analysis: server D1 ANALYSIS_FRESH_MS = 6h (functions/_lib/auth.js); client localStorage mirror 6h (career-personalize.js MAX_AGE), keyed by profile inputs hash + focus slug.
- Roadmap: fresh when roadmapMeta.inputsHash + focusSlug match; no-meta legacy fallback ROADMAP_FRESH_MS = 24h (functions/_lib/roadmap.js).
- Portal snapshot: regenerated only when computePortalInputsHash changes (vector updatedAt now stable across boots) or source='fallback'.
- Ranked fit caches (rankedCache/rankedOnetCache): in-memory per page load, cleared by persistQuizVectors only when vector values actually change.
- careers.json: HTTP-cached with its own ?v= buster inside onet-catalog.js (bump when artifacts change).

All four phases of docs/POLISH_AND_INTEGRATION_PLAN.md are now complete. Open follow-ups: manual browser QA (hub visuals in both themes, focus traps, contrast, 375px), KV/D1 one-time cleanup of pre-trimProse analyses (deployment console), Cloudflare env audit for stale GEMINI_* vars.

## Site-wide polish addendum (2026-07-03, Jacob_Work @ eda4c51)

User-directed pass after the four plan phases:

- 50d1fd2 — Hub zoom jank fixed (user-reported). Root causes: (1) the entire overview layer rendered inside ctx.scale(), so zooming scaled fonts/dots/strokes until the sector snap — all hub drawing is now screen-space with constant pixel sizes; (2) sector enter/exit/fly-to teleported the camera — now a 320–380ms eased tween (log-space zoom lerp; wheel/drag cancels; reduced-motion snaps) via animateCameraTo/stepCameraAnim in hub-dashboard.js; (3) sector labels re-solved anchors every 0.05 zoom step — anchors now stay stable during zoom and the overlap solve reruns 160ms after zoom settles (sectorLabelCacheKey no longer includes zoom).
- eda4c51 — FWConfirm shared styled confirm dialog (assets/js/shared/fw-confirm.js + flightway-pages.css block) replaces native confirm() on roadmap regenerate/retarget; promise-based, focus-managed, Escape/backdrop cancel, native fallback. Global :focus-visible baseline in flightway-theme.css.

Surveyed and left as-is (already good): portal snapshot loading/placeholder resolution, deep-dive loading card + skeleton pills + error mapping, skill-gap tracker styled modal, CSS transition coverage (~120 rules, hover lifts, shimmer sweeps). Marco polish landed in Phases 2–3.

## Performance addendum (2026-07-03, Jacob_Work @ d65cf24)

User-reported: macro-view frame drops when constellation dots lit up; dots only colorized on hover; slow site loads.

- d65cf24 — Macro constellation is now purely decorative (zone-tier color from local zone aggregates + deterministic jitter; NO per-career vector fetches in overview — boot/hover prefetches removed, sector entry still prefetches). Dots batched into 3 alpha-band fills per tile (was per-dot fills/gradients). Whole overview layer cached to an offscreen canvas keyed by camera/hover/theme/dataVersion — spotlight mouse-move frames blit instead of re-rendering ~800 ops. Hub boot: careers.json + artifacts fetch in parallel (was serialized); similarity index (~230KB) lazy-loads at first sector entry (ensureSimilarityIndex); dashboard.html preloads careers.json + zone-layout.json; fonts preconnect on all app pages.
- Invalidation contract: FWHubCanvasRender.invalidateOverviewLayer() must be called when zone fits change (wired in hub-dashboard onVectorsUpdated). Theme/camera/viewport changes invalidate via the cache key automatically.

## Load-time optimization addendum (2026-07-03, Jacob_Work @ 428e580)

User-directed pass: "site is slow to load, features have wait times — optimize everything without cutting scope." Five commits, all verified against the live deploy with curl.

- 3cac5ba — Network/render-blocking overhaul. NEW `_headers` file: /assets/* immutable 1y (safe because every HTML asset reference now carries a unified ?v= buster — **bump the stamp when you change a file**, the convention is now load-bearing); /data/* 1d + 7d stale-while-revalidate; HTML no-cache. All local scripts deferred (were ~96 synchronous tags site-wide; parse-blocking) except the three tiny anti-FOUC boot scripts; inline page boots wrapped in DOMContentLoaded (career.html's boot previously fell into a degraded no-auth path under defer timing). unpkg lucide@latest (third-party DNS+TLS+redirect every load, render-blocking in career.html's head) replaced by assets/vendor/lucide-lite.js — 3.3KB shim with the 8 icons the app actually renders, same createIcons() API. **Add icon markup to the shim before using a new data-lucide name.** Version stamps unified to 20260703p (pages previously pinned different versions of the same file).
- ea02e87 — pages-deploy.mjs minifies the staged /assets copy with esbuild (411KB removed pre-gzip; repo sources untouched; per-file failure ships original). esbuild is a devDependency.
- a327857 — careers.json descriptions split into career-descriptions.json (ETL emits both; committed artifacts regenerated). Hub boots on new FWOnetCatalog.loadCore() (48KB gz vs 106KB) while descriptions stream in and merge into rows in place; load() keeps its full contract (both fetched in parallel). hub-onet-map career objects expose description via a live getter. Server store.js re-merges descriptions (R2 full-format copies still work).
- c17f218 — Auth boot waterfall 4 serial round trips → 1-2: uploaded-quiz hash persists in sessionStorage (email-keyed; logout clears) so unchanged profiles skip the GET+PUT /profile/quiz pair per navigation; with a same-tab session hint and no pending upload, /profile prefetches in parallel with /auth/me (one-shot, race-safe: never prefetches when a PUT will run).
- 428e580 — _headers /data rules collapsed to one; overlapping Pages rules concatenate into a doubled ambiguous Cache-Control (caught live via curl -I).

Verified: hub:verify, onet:test, test:vectors, verify:aliases, node --check on all touched JS, a mocked-fetch loader harness (loadCore/load/merge race), and live-deploy curl checks (headers, minified bodies, artifact sizes, 401 from /auth/me). Deployed to flightwayjacobprototype.

Measured wins: hub boot catalog 106→48KB gz; pages CSS 30→23KB gz (163→~60KB raw); quiz-app 50KB gz; repeat visits serve ~all static bytes from browser cache; every page saves 2-3 serial API round trips per navigation.

## Workflow tooling addendum (2026-07-03, Jacob_Work @ 04c6d6e)

Not a code change — a Claude Code skill was drafted to govern how future sessions (any model) approach FlightWay work.

- **`flightway-fullstack-architect`** skill drafted and packaged (`~/Downloads/flightway-fullstack-architect.skill`, not yet installed/verified against real runs — user deferred the eval loop to conserve tokens, to be run later). Encodes: a model-delegation table (UI/CSS → Sonnet; backend bugs, security review, and correctness-sensitive perf work → Opus; mechanical perf/deploy/test work → Sonnet; codebase research routed Haiku/Sonnet/Opus by depth needed); a medium-effort ceiling enforced via explicit prompt instruction to subagents (no confirmed API-level effort parameter exists on the Agent tool — checked, not assumed); an "architect, not implementer" workflow for requests spanning multiple categories at once (plan + decompose + delegate + integrate, don't hand-implement); and token-conservation tactics (narrow reads, grep-before-read, batched tool calls, verify via project scripts/curl rather than browser MCP). Rationale for the model-routing logic: this project's actual bug history (hydration idempotency, refine-strip zeroing, resume-bleed compounding, upload-merge drops — all documented above) was consistently "small-looking symptom, multi-file root cause," which is why backend/vector/auth work is routed to Opus regardless of how minor the reported symptom looks.
- Separately confirmed via research (not assumed): Claude Code has no mechanism — hook, setting, or otherwise — to auto-switch the main session's model based on prompt content; `/model` is user-invoked only. Subagents spawned via the Agent tool *can* target a specific model (`model` param: sonnet/opus/haiku/fable-tier), and that subagent's usage is billed/limited at its own model's rate against the account's rolling usage window, not the parent's — so delegating a UI task to a Sonnet subagent genuinely saves both dollars and quota versus doing it on a pricier main model, modulo the coordination overhead of writing its brief and reading its result back.

Open: the skill is unvalidated (no with-skill/baseline comparison run yet) and not installed anywhere Claude Code will auto-discover it. Next session picking this up should either run the eval pass (4 draft test cases exist: UI polish, backend bug, shallow research, big-architecture-task — see this session's transcript) or just start using it manually and tune by feel.

## Three-features addendum (2026-07-03, Jacob_Work @ f475182)

User-directed feature build (orchestrated via flightway-fullstack-architect skill: Sonnet UI agent, Opus backend agents, Opus logic sweep + Sonnet UI sweep), verified live on flightwayjacobprototype:

- 6f13a19 — **O*NET Dimension Profile viewer** on portal.html (FWDimensionViewer, assets/js/app/dimension-viewer.js). Renders FWOnetVectors.userVsCareerDimensions() vs the target career: top-5 gaps + top-5 strengths as paired You/Target bars ("You 62 · Target 84"), lazily-populated domain-grouped expander for all 161 dims. Mounts after #portal-snapshot, re-renders on FWCareerTarget focus events, stale-render token guard. Distinct from the older shared/onet-dimension-viewer.js drawer (FWOnetDimensionViewer) — both exist on purpose.
- 4095b88 — **AI-derived careers**. Sidecar data/onet/artifacts/derived-careers.json holds full catalog-shaped rows (aiDerived:true, derivedFrom, inline 161-dim vector + importance, provenance) under synthetic 99-XXXX.00 SOCs; merged client-side in FWOnetCatalog.loadCore() and server-side in store.getCareers() (double-append guard); /onet/vectors serves derived SOCs inline (they're NOT in the .bin; vectorIndex:-1). Seeded: Quantitative Trader from Financial Quantitative Analysts (13-2099.01), 18 hand-authored adjustments with honest provenance (method manual-ai-seed). scripts/derive-career.mjs (npm run derive:career) regenerates via Gemini when GEMINI_API_KEY is available. Provenance shown in hub detail panel (#panel-ai-derived, previously a dead stub) and deep-dive hero (app-pages.js).
- 008dabf — **Objective-vector stretch surfacing**. Ranked entries now carry personalityFit/objectiveFit (additive; score/cache semantics unchanged). FWOnetVectors.stretchFitCandidates(): objectiveFit ≥ 72 AND ≥ personalityFit + 12 AND outside overall top-12, objective vector active, top-3 drivers by min(user,career). Hub overview shows dismissible "Non-obvious fits" card (#hub-stretch-fits, sessionStorage fw_stretch_dismissed_v1, hidden in sector view); instant driver-based explanation, upgraded via new POST /stretch-fits (requireSession, ≤4 items, one batched Gemini JSON call, COACH_KV cache 7d keyed stretch:{email}:{slug}:{hash}, 200+empty on AI failure, profile text fenced as data). test-vectors.cjs +9 assertions (31 total).
- f475182 — **Post-integration sweep** (Opus logic scan: zero confirmed bugs; Sonnet UI scan): showCareer() title/tagline now esc()'d before innerHTML — newly reachable with Gemini-generated derived-career text, real injection surface; stretch list <a> rows wrapped in <li>.

Flagged, deliberately not fixed: stretch scan slices ranked limit 782 of 783 rows (dropped entry is worst-ranked, can never qualify); /stretch-fits KV cache can serve a stale explanation ≤7d after profile edits when driver names don't change; .hub-stretch-fits top offset assumes 52px HUD height.

Session cache-buster stamp: 20260703q on every touched asset across all referencing pages. Live-verified via curl (NOTE: pages.dev now 308-redirects /page.html → pretty URL; use curl -L): derived vector round-trip, sidecar serving, /stretch-fits 401 gate, immutable headers, new markup present.

## Hub boot hotfix (2026-07-03, Jacob_Work @ 09bb043)

User reported the Career Hub stuck on "Loading career map…" forever (no error). Root cause: the stretch-fits commit (008dabf) inserted syncStretchFitsVisibility() into syncMapHud(), which runs during TOP-LEVEL boot via resize() — BEFORE the render section where `let stretchRendered`/`stretchRunToken` were declared. Reading a `let` in its temporal dead zone throws, aborting hub-dashboard.js before startHubBootWatchdog() AND FWOnetHub.init() ever registered → spinner forever, no watchdog fallback, catalog never loaded. node --check (syntax-only) and the non-executing logic scan both missed it.

- 95b7a16 — hoisted STRETCH_DISMISS_KEY/stretchRendered/stretchRunToken to the top of hub-dashboard.js (above all top-level boot calls). hub-dashboard.js buster q→r (broken q ships immutable 1y). LESSON: any `let`/`const` read by a function that can fire during top-level hub boot (resize→syncMapHud chain) MUST be declared before line ~240; declaring beside its render helpers lower in the file is a TDZ trap.
- 09bb043 — dashboard.html careers.json rel=preload stamp p→q to match onet-catalog CAREERS_URL (bumped to q in 4095b88); mismatched ?v = distinct cache keys = wasted preload + refetch.

Diagnosis method that worked when static analysis stalled: drove the deployed page with headless playwright-core (channel:'chrome') from repo root, captured pageerror + boot-state via page.evaluate (loadingVisible/catalogCount/onetReady). Browser MCP (claude-in-chrome) was disconnected; playwright-core is in node_modules. Re-verified fix live: catalogCount 783 (incl. derived), onetReady true, spinner gone.

## Next-up scoping (2026-07-03, no code yet)

- **AI-derived "fragment" careers** — plan written up in `docs/FRAGMENT_CAREERS_PLAN.md`: runtime (not build-time) generation of derived careers off any real O*NET career a user deep-dives on, targets, or mentions unprompted; shown as a scrollable fragment strip off the base career's hub drawer, mirroring the legacy main-branch fragment presentation. Interacting with an already-derived career must never spawn another one. Read that doc before starting — it lists open decisions (KV vs D1 storage, rate limits, per-user vs global fragments) that need resolving first.
- **Stretch-fit surfacing follow-up** (no doc yet, discussed in-session only) — current implementation is hub-overview-only (`#hub-stretch-fits`); biggest gap is it never surfaces on portal, which is the more habitual landing page. Also: dismissal is per-tab-session only (resurfaces every new session), card caps at 3 candidates with no "see more," and visiting a stretch career's deep dive doesn't feed anything back into ranking/dismiss state.

## Five-features addendum (2026-07-05, Jacob_Work @ e9363a6)

User-directed feature build (flightway-fullstack-architect skill orchestration: 3 Sonnet research agents, then Opus implementation agents for WS1-WS3 under the old table, Sonnet for WS4 under the revised table). All verified locally: test:vectors, hub:verify, verify:aliases, onet:test, node --check on all touched files.

- fa37970 — **Vector-informed deep dives**. Client sends `vectorDimensions` (top-5 strengths / top-6 gaps from userVsCareerDimensions; sanitized server-side as untrusted Gemini input). Analysis schema gained `whatYouBring` (strength-coordinate-anchored) + `entryPath` (steps each close a named gap); normalizeAnalysis trims both. D1-cached analyses regenerate when `entryPath` missing; client cache key bumped fw_career_analysis_v7. New sections injected by career-personalize.js (career.html is a shell; section DOM comes from app-pages.js). "You might also consider" already existed (renderRelatedCareers /onet/similar) — untouched.
- 398d00f — **Runtime fragment careers** (docs/FRAGMENT_CAREERS_PLAN.md, all three recommendations adopted: D1, synchronous, global). migrations/0005_derived_careers.sql (**NOT yet applied — see pending**). functions/_lib/derive-career.js + /derive-career endpoint: GET ?base= (fragment list) / ?soc= (single row), POST {baseSoc} generates 3 specializations in ONE batched Gemini call (absolute adjustments clamped onto base vector, importance inherited, 99-1XXX SOC range — 99-0XXX stays hand-authored sidecar). Idempotent (existing rows returned, never regenerated), INSERT OR IGNORE race-safe, RATE_LIMIT_DERIVE_MAX=8/hr. store.getCareers merge guard is now a SOC Set (warm-cache safe); D1 portion TTL-cached 60s; all D1 reads tolerate a missing table (deploy-before-migrate safe). Hub drawer #panel-fragments strip mirrors #panel-related. career-focus.js fires generation via waitUntil.
- 57d5a06 — **Gap tracker v3 (coordinate gaps)**. Gaps = objective-vs-career coordinate deltas (new objectiveVsCareerDimensions; blended fallback when objective inactive), capped 6, ordered by distance, You/Target paired bars. Fast per-domain checklist ladders instantly; 'gap-checklists' action on /career-roadmap upgrades via one batched Gemini call, KV-cached globally gapchk:{soc}:{dimIndex}:{band} 30d, RATE_LIMIT_GAP_CHECKLIST_MAX=15. mergeV3Gaps preserves checklist state/logs/manualComplete across vector recomputes; touched gaps pinned. **Load-bearing catch: server ensureFocusTrackerOnTree was REBUILDING every tracker as version:1 on save — would have silently wiped v3. Now preserves v3 (preserveV3FocusTracker).** focus-keywords skips source:'coordinate'.
- bcd731c — **Fragment triggers**. Deep-dive on a real career fires POST /derive-career warm-up (signed-in; response rows merge via FWOnetCatalog.addDerivedRows); deep dives ON a 99- career resolve their D1 row via ensureDerivedRow before the static fallback builds; switch-advisor proposals pre-warm via waitUntil. Verbatim-title derivation from chat deliberately NOT built — abuse surface the plan itself flags; derived rows fuzzy-match through the merged catalog anyway.
- 7207144 — **Roadmap branch decisions + multi-branch focus**. True client-only previewPath (never persisted — the server 'follow' action saves immediately and is NOT used for preview), banner + Escape exit; drawer Preview/Commit/Extend/Track buttons all wired (no dead buttons); commit resolves decision-option → action:'choose', else 'follow'. New server 'extend' action: mergeTreeExtend re-parents 1-2 Gemini nodes onto the branch tip, ≤1 deeper-fork decision, caps MAX_EXTEND_NODES=22 / MAX_TREE_DECISIONS=2 / maxBranchHops≤3. focusTracker gained branchFocuses[≤2] + activeBranchKey, round-tripped server-side (normalizeBranchFocuses spliced into v1+v3 preserve paths) and client-side; focus view has a Main/branch switcher; skillGaps stay career-scoped across branches.
- e9363a6 — cache-busters 20260705a on all 10 session-touched assets (client roadmap-sync.js intentionally NOT bumped — unchanged).

**PENDING (blocked by power outage — no wrangler/network this session):**
1. Apply D1 migration remote (+ local for dev): `npx wrangler d1 execute flightway-db --remote --file=migrations/0005_derived_careers.sql`. Code degrades gracefully without it (empty fragments), so deploy order is not fragile — but fragments won't persist until applied.
2. `npm run deploy:prototype`, then live curl QA (use curl -L; pages.dev 308-redirects pretty URLs): /derive-career 401 gate on POST + 200 GET, #panel-fragments markup, whatYouBring/entryPath in a FRESH analysis (old D1 rows regenerate on entryPath check), branch preview/commit round-trip, immutable headers on 20260705a assets.
3. pages:smoke (hits the live deploy) once deployed.
4. Optional manual visual QA: branch preview accenting both themes, fragment strip, v3 gap cards (note: gap manualComplete affordance also renders in the waypoint-steps column — flagged by the WS3 agent as a consolidation candidate if it reads cluttered).

Session note: the 5-hour/spend limit hit mid-WS4; the resumed context lagged the real repo state (7207144/e9363a6 had already landed via a continuation). On any resume, reconcile `git log` against the addendum before assuming state.

## Fragment fix + orb VFX + polish addendum (2026-07-05, Jacob_Work @ 0819596)

Bug sweep + UI polish pass, focused on the runtime-fragment feature. OFFLINE session (outage: no wrangler/deploy/pages:smoke — all verification local node). Three background subagents were dispatched (Opus fragment-fix, Sonnet VFX, Sonnet polish) but ALL THREE died on the flaky connection (one dropped mid-response, two stalled on the 600s watchdog); the fragment fix was finished inline (Edit persists immediately = drop-resilient), and the two Sonnet agents' partial edits were reviewed, verified, and kept.

- daabe65 — **Fragment strip was broken by a reverse-lookup bug** (not just the un-applied migration). getFragmentsForSoc + getRuntimeDerivedBySoc queried the D1 derived_careers table ONLY, so the build-time seeded fragment (Quantitative Trader ← Financial Quantitative Analysts 13-2099.01, which lives in the static sidecar, not D1) never surfaced in the hub drawer strip. Both now route through store.getDerivedCareers (already unions static+D1, dedupes by soc); signatures gained baseUrl (threaded from the endpoint). The seeded fragment now shows with NO D1. Verified via stubbed harness (7/7): static surfaces without D1, D1 rows union+dedupe, vectors stripped, single-row resolves static socs. The client strip wiring (renderPanelFragments in hub-dashboard.js) was already correct — guards derived/synthetic/no-soc, escapes via escHtml/escAttr — no change needed there.
- 51edbca — **Fragment-orb VFX** on the hub map (hub-onet-map.js). AI-derived careers now render as smaller accent orbs with a tether filament to their parent (matched by derivedFrom.soc), on a SEPARATE sector-mode overlay canvas (#fw-fragment-overlay). Design chosen for low regression risk: pointer-events:none (never steals clicks — existing #map-canvas hit-testing unchanged), separate layer (the cached overview render is untouched, no perf regression, no new vector fetches), rAF loop pauses on document.hidden + respects prefers-reduced-motion, sector-mode-gated. Boot-safety confirmed statically (the catastrophic axis, since node --check can't catch a runtime throw and pages:smoke needs the live deploy): startFragmentOverlay/stopFragmentOverlay are only called inside enterSectorMode/exitSectorMode (post-boot user actions), no top-level calls, so `var fragOverlay` is always initialized before any runtime call. **PENDING: pixel-level visual QA (orb positions/alignment/aesthetics, both themes) — could not be done offline. Verify when back online.**
- 0819596 — **Gap-tracker de-clutter** (skill-gap-tracker.js/css) — the WS3-flagged issue: the v3 coordinate gap card and the waypoint-steps column each rendered a "Mark complete" control for the same gap. The card now owns its toggle; the redundant orphan row is skipped for source==='coordinate' gaps (COORDINATE_SOURCE, defined line 18); added an empty-state line for stepless waypoints. Render-only, escaped, coordinate math untouched.
- Cache-busters 20260705b on the three touched client assets only: hub-onet-map.js (dashboard.html — was stale at 20260703q since it wasn't in the 5-features session), skill-gap-tracker.js/css (portal.html + roadmap.html).

Verified: node --check on all touched JS, npm run test:vectors, hub:verify, verify:aliases; a stubbed fragment harness; security grep over the diff (innerHTML sites all empty/static-literal, no D1 concat, canvas has no text-XSS surface).

DEFERRED (connection killed the agents before this landed — NOT done): the broader UI polish pass Agent B was assigned — deep-dive whatYouBring/entryPath section CSS refinement and roadmap branch-decision visual polish (preview banner, drawer buttons, unchosen-branch dimming, focus-view branch switcher). These surfaces are functional and already token-CSS'd; polish is optional. Resume via a Sonnet agent when the connection is stable, or inline.

STILL PENDING from the prior addendum (unchanged, needs connectivity): apply migration 0005_derived_careers.sql (`npx wrangler d1 execute flightway-db --remote --file=migrations/0005_derived_careers.sql`) — required for RUNTIME (D1) fragments to persist; the seeded static fragment now works without it. Then deploy:prototype + the curl QA list. Also: visual QA of the new fragment-orbs (this addendum).

## Connection-restored completion addendum (2026-07-05, Jacob_Work @ 69a7ce2)

Finished the two items the outage-session agents never completed (connection stable; Cloudflare still down — migration/deploy remain pending):

- 80b2217 — Deferred polish: entry-path steps as cards w/ numbered badges + gap-tag chips; bring-chip hover/dark contrast; preview banner as backdrop-blur pill (Commit primary / Exit ghost, reduced-motion-safe entrance) + REAL FIX: .roadmap-tree-panel lacked position:relative so the absolute banner anchored to a distant ancestor; drawer branch buttons unified + :disabled states + "Extending…" spinner (roadmap.js passes branchAction:'extend', renderDetailPanel reads it). Branch switcher chips + nodeAlpha dimming inspected, already good, untouched.
- 69a7ce2 — Fragment-orb VFX reworked to the TRUE legacy reference (found via origin/main hub-dashboard.js:361-429 — the "sub-branch spotlight reveal"; the term "fragment" appears nowhere on main, which is why earlier greps missed it): proximity bloom (SPOT_R 140, smoothstep, lerp 0.2, subR 1.4+5.4a, alpha floors 0.07/0.35 dark/light), tether from parent edge (0.1+0.5a alpha, 0.8+1.3a width), bloom gradient >0.04, specular >0.1, label fade >0.4/emphasis >0.75. Overlay canvas architecture kept (pointer-events:none, sector-gated); pointer via passive window listeners constrained to #map-canvas rect; rAF sleeps at rest, wakes on pointermove/sector-enter; reduced-motion snaps anim. Rarity color via render.rarityOf (typeof-guarded fallback).
- Busters 20260705c on hub-onet-map.js, flightway-pages.css, app/roadmap.js, roadmap-tree.js across all referencing pages.

Verified: node --check all touched, test:vectors, hub:verify, verify:aliases green. STILL PENDING (Cloudflare): migration 0005, deploy:prototype, live curl QA, pages:smoke, and visual QA of the spotlight-bloom in both themes.

## Online verification addendum (2026-07-05, connection restored)

- 0005 migration applied (local + remote); deployed twice; pages:smoke green against live.
- Live curl gates verified: /derive-career 400/401, union fix (static Quantitative Trader serves for base 13-2099.01), derived vectors inline, immutable headers on 20260705c stamps.
- **Stress test found + fixed a real generation bug**: Gemini 2.5 counts internal thinking toward maxOutputTokens in JSON mode, so derive-fragments at 3072 tokens truncated mid-adjustments; gemini-json's salvage parser (lastIndexOf('}')) then yielded fragments with EMPTY adjustments → base-identical vectors persisted globally. Fix: MAX_OUTPUT_TOKENS_CAP 4096→8192, derive call requests 8192, applyAdjustments accepts array-shaped adjustments, and fragments with zero applied adjustments are never persisted (undifferentiated-row guard). Bad rows purged from remote D1.
- End-to-end confirmed on live: POST generates 3 fragments w/ 21-23 adjustments (~35s incl. flash-lite 503 → flash fallback), 21 dims differ from base, idempotent GET, ?soc= resolve, fragment deep-dive 200. Test account jklugerman2008+fwstress@gmail.com created for authed stress tests (harmless, can be deleted).

## Warm-up verification + flash-fallback fragment fix (2026-07-05, Jacob_Work @ c1839c1)

Picked up the "verify live + commit" handoff. All three pending items landed:

- 983c72e — thinking-budget fix committed (both JSON-mode Gemini body builders set thinkingConfig {thinkingBudget:0}; career-analysis cap 1800→4096). Verified live end-to-end first: fresh authed /career-analysis returned valid JSON with whatYouBring(2)/entryPath(2) in 130s.
- 830613e — portal warm-up committed after live verification: /portal-snapshot (cached AND fresh paths) background-generates fragments for the focus SOC + top-2 careerPool picks (resolved via bestCatalogMatch). Proven live: a careerPool-only career (Logisticians 13-1081.00) got fragments with no deep-dive/focus trigger. NOTE: careerPool entries need a numeric careerId to survive normalizeCareerPool — payloads without it silently warm nothing.
- c1839c1 — **real bug found during verification**: whenever flash-lite 503s and derivation falls back to gemini-2.5-flash, that model copies the prompt's dimension decorations into adjustment keys ("Science [skills]"), applyAdjustments matched 0 dims, and the zero-adjustment guard rejected all fragments — so bases derived during flash-lite outages NEVER got fragments (deterministic, e.g. Actuaries 15-2011.00 failed 4/4). Fixed by stripping [domain]/(base N) suffixes before nameToIndex lookup. Same commit: generateFragmentsForBase's internal idempotency pre-check passed (env, soc) to the (env, baseUrl, baseSoc) signature (guard always saw []); and the all-fragments-rejected case now console.warns shape diagnostics (this log is what cracked the bug — keep it).
- Diagnosis method: `npx wrangler pages deployment tail <full-deploy-id> --project-name flightwayjacobprototype --format json` while curling the endpoint. Partial deploy IDs error as "static site"; get the full ID from `wrangler pages deployment list`. Session cookies are per-deployment-subdomain — re-login after every deploy.
- **Discovered: pushing to Jacob_Work auto-builds a Pages deployment from git** (project has GitHub integration), separate from deploy:prototype direct uploads. Latest of either wins the production alias — don't assume the live alias matches your last direct upload after a push.
- No client assets touched — no cache-buster bumps. Verified: test:vectors, verify:aliases, hub:verify, pages:smoke, node --check.
- Test data left in place: accounts jklugerman2008+fwstress@ / +fwwarm1@gmail.com; global fragments now exist for 15-2031.00, 13-1081.00, 15-2011.00 (all legit content, generated via real paths).

## Deep-dive timeout + hub satellite surfacing (2026-07-05, Jacob_Work @ a2fe3f0)

Two user-reported bugs on the fragment feature; both fixed, deployed, live-verified. Orchestrated per flightway-fullstack-architect (2 Sonnet agents, disjoint files; one stalled on the flaky connection mid-cache-buster and was finished inline).

- **Deep-dive AI "Request timed out"** (commit before a2fe3f0's pair — see git): the analyze path ran THREE sequential Gemini calls on a cache miss — fetchCareerMetrics + fetchCareerWebContext (both google_search-grounded, slow, 503-prone) then the essential 4096-token analysis. flash-lite 503 → flash fallback pushed the total to ~130s, past the client's 90s authFetch timeout. Fix: the two grounded enrichment calls (independent, already null-on-failure) now run concurrently via Promise.all, each wrapped in new withSoftTimeout(p, 15000, null) in functions/career-analysis.js; main analysis untouched. Client analyze+regenerate timeout 90s→120s (career-personalize.js 1348/1452; fragment POST left 60s). **Live: fresh uncached analysis 21.7s (was ~130s).**
- **Existing user sees no hub satellites**: runtime fragments only reached the client catalog on drawer-open/deep-dive; nothing loaded the global set at hub boot or generated for a hub-first user. Fix: (B1) new GET /derive-career?all=1 (no session, getDerivedCareers union, stripVectors, cap 500); hub warmHubFragments() fetches it once at boot and addDerivedRows → requestHubRedraw (the map's per-frame syncDerivedRows poll folds new rows into state.all — there is NO explicit catalog→map push, redraw is the trigger). (B2) signed-in users also POST-generate for their careerFocus SOC (FWAuth.readCareerFocus). **Key gotcha the Sonnet agent got wrong and I fixed: it ranked by c.fitScore, but the hub overview computes NO per-career fits at boot (d65cf24 perf design) — fitScore is null there, so that ranking is dead. Also FWOnetHub.getAllCareers() doesn't exist. Focus SOC is the correct cheap always-available base.** dashboard.html hub-dashboard.js buster a→20260705d. **Live: ?all=1 → 23 fragments no-session; focus POST → 3 fresh fragments.**
- Verified: node --check all touched, hub:verify, test:vectors, verify:aliases green; deployed 9e12d7bc + git-push auto-build. Test account +fwwarm1@; global fragments now also exist for 13-2051.00.
