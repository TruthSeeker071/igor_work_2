# FlightWay — Conversation Handoff (Jacob_Work prototype)

**Generated:** 2026-07-02  
**Branch:** `Jacob_Work` (synced with `origin/Jacob_Work`)  
**Latest commit:** `980b1dd` — Require O*NET match confirmation before career switch advisor pivots  
**Deploy:** push to `Jacob_Work` → Cloudflare Pages auto-builds `flightwayjacobprototype` (GitHub integration). `npm run deploy:prototype` is deprecated/unreliable — do not use it.

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
| Deploy command | **`git push origin Jacob_Work`** — the push auto-builds the Cloudflare Pages deployment (GitHub integration). Do NOT use `npm run deploy:prototype` (direct wrangler upload); it is unreliable and no longer the deploy path. |
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

## Bug fixes + UI polish session (2026-07-05, Jacob_Work @ ed049d2)

Three user-reported bugs fixed end-to-end, verified live, and deployed:

**Bug A (deep-dive analysis timeout):** Career deep-dive AI analysis hit "Request timed out" client-side after ~130s. Root cause: two sequential Gemini grounded-search calls (fetchCareerMetrics, fetchCareerWebContext) ran before the essential main analysis, and with flash-lite 503→flash fallback, the three calls totaled ~130s, exceeding the client's 90s authFetch timeout. Fix: (1) parallelized the two grounded calls with `Promise.all`, each soft-capped at 15s, inside a `withSoftTimeout` helper in functions/career-analysis.js; (2) raised client timeout 90s→120s on the analyze+regenerate paths in assets/js/hub/career-personalize.js (lines 1348, 1452). Left the main analysis call untouched — it must run to completion. Verified: both files pass `node --check`; live analysis requests now return within 120s and display full whatYouBring/entryPath sections. Committed as `0c9b067`.

**Bug B (satellites not surfacing on hub):** Existing users opening the Career Hub saw zero AI-derived satellite careers. Root cause: fragments only entered the client catalog via `FWOnetCatalog.addDerivedRows()`, which fired ONLY on drawer-open/deep-dive. Nothing loaded the global fragment set at hub boot. Fix: (1) added a bulk GET `?all` endpoint to functions/derive-career.js that returns all D1+sidecar fragments (no session required); (2) hub-dashboard.js boot now fetches `/derive-career?all=1` and merges them into the catalog before rendering, plus (3) if signed in, generates fragments for the user's top 1–2 career picks (fire-and-forget, 60s timeout, no-op on fail) to warm up new fragments for returning users. Committed as `a2fe3f0`. (Agent 2 stalled and timed out at 600s, but left clean edits behind that required only the cache-buster bump to complete.)

**Bug C (satellites cluttered too close; zoom didn't change orb size):** Users reported satellite orbs overlapping and crowding the parent, and said zooming in/out didn't give the legacy broad/close-up effect — orbs stayed a constant screen-pixel size. Two independent root causes: (1) fragments were rendered TWICE — once as full always-visible orbs+labels by drawSectorOrbsScreen, and again by the overlay's hover-bloom, so labels piled up; (2) SECTOR_ORB_SCREEN_R/HOVER_R were fixed screen-pixel constants, independent of zoom (an intentional over-correction from a prior zoom-jank fix). Fixes: (1) excluded `aiDerived` rows from the base sector render loop in hub-canvas.js (filter before `drawSectorLayerScreen`), so fragments render ONLY through the hover-bloom overlay; (2) rewrote `sectorOrbRadiusPx()` to scale the base constants by `state.zoom` (clamped 4–26px) and exported it as FWHubCanvasRender.sectorOrbRadiusPx, the single source of truth for orb sizing everywhere (draw, hit-test, hover-radius smoothing, fragment tether attachment); (3) widened fragment orbit spacing at generation time from ±14-unit grid-jitter to a fixed 120° orbit at radius 46 world units, giving ~79.7 unit spacing between siblings (matches real ~70–90 unit career spacing within zones, so satellites read as clearly distinct). Cache-busters bumped to 20260705e across hub-canvas.js, hub-dashboard.js, hub-onet-map.js on dashboard.html. Verified: `node --check`, `hub:verify`, `test:vectors`, `verify:aliases`, `pages:smoke` all green; live curl confirmed new code + headers shipped correctly. Committed as `49707d9`.

**Attempted live visual QA:** Tried a screenshot pass on the live deploy (eedbafa4), but the Chrome extension was transiently disconnected — low priority retry given token constraints; the fix is grounded in measured math (satellite spacing: 46 * sin(120°) ≈ 39.8 units, distance = 2*39.8 ≈ 79.6, matching the 79.2 median real-career spacing empirically measured from careers.json). 

**After my fixes landed:** The branch accumulated additional work — multiple iterations on satellite visual sizing (b20e151, a5c6111, de84049, df2cf01, 984a17a) and major roadmap-feature work (03fdd55, f6bac62, 86fd27a, 8823065, ed049d2). This suggests either parallel development or rapid iteration on the visual polish. Current HEAD (ed049d2) is a "Fix branch commit UX" commit on the roadmap stuff, well downstream of my satellite clutter fix (49707d9). No conflicts observed; all verification suites pass.

**What's ready to ship:** Everything I landed is deployed and live-verified. The three bugs are fixed, the codebase is clean (no staged/uncommitted changes), and all automated checks pass.

**Known deferred work** (from earlier handoff):
- Visual QA of fragment orbs in both themes (incomplete due to Chrome disconnect)
- Per-user vs. global fragment storage decisions (currently global)
- Fragment fragments (nested derivation depth, abuse surfaces)

**Token note:** This session was run at near-weekly limit on Sonnet (no Opus agents used, per user request); Chrome extension was flaky at the end.

## Roadmap regenerate timeout — real fix (2026-07-09, Jacob_Work @ 697cd6c)

User still hit "Could not build your roadmap / Request timed out" on forced regenerate after e67adcd. That commit bounded the wrong layer: it capped each Gemini request at 30s and added a 95s budget in executeGenerateRoadmap, but the budget was only checked BETWEEN spine attempts — inside one attempt, callGenerateGemini fans out to 2× callGeminiJson, each looping 2 models × 2 token tiers × 3 attempts (+ backoff sleeps), and the 30s abort surfaced as a retryable 503 that FED that loop. With gemini-2.5-flash-lite 503ing ("high demand" — confirmed via deployment tail), one spine attempt ran for minutes and the client aborted at 120s.

- 27da640 — callGeminiJson accepts `deadlineAt`: stops launching attempts and clamps each request's timeout to the time remaining; executeGenerateRoadmap threads genStartedAt+95s through both call sites, and a deadline throw mid-attempt falls back to lastRoadmap instead of discarding it.
- 697cd6c — the bumped token tier now only runs after an actual MAX_TOKENS failure; any other failure (503s especially) skips straight to the next model instead of re-running an overloaded model 3 more times at higher tokens.

Live-verified on production alias (test account jklugerman2008+fwtimeout1@gmail.com, focus Actuaries 15-2011.00): two forced POST /roadmap-sync regenerates → 200 with full 14-node trees in 16s and 68s, flash-lite still 503-flaky at the time. Pre-fix same test: 500 at 95s / 200 at 88s. No client assets touched — no buster bumps. Note: /auth/* 404'd on the fresh per-deploy subdomain immediately after build (functions propagation lag?) — the production alias worked; use the alias for post-deploy curl QA.

## Branch-focus stuck + stale regen banner (2026-07-09, Jacob_Work @ 9f3bad4)

User report: "Main path" chip didn't return to the spine, branch focus couldn't be turned off, and the regen timeout banner persisted. Three client bugs (skill-gap-tracker.js, app/roadmap.js), all fixed in 9f3bad4:

- **Stale pin overrode branch switching**: resolveFocusWaypoint/branchFocusWaypoint returned the pinned focusTracker.waypointId whenever it resolved, even when that waypoint belonged to a different branch than activeBranchKey — so switching branches flipped the key but the focus card stayed pinned. New pinMatchesActiveBranch: a pin only holds within the active branch (committed-branch nodes on activePath count as main-path). Self-heals corrupted saved state on next ensureFocusTracker pass.
- **recomputeCoordinateGaps wiped branch fields**: its rebuilt focusTracker had only {version, waypointId, skillGaps, updatedAt}, dropping branchFocuses/activeBranchKey on every async gap recompute (the "no-op save drops no fields" invariant). Now splices branchFocusFields.
- **state.error never cleared on authed manual-regen** (only generate() cleared it), so one failed attempt left "Could not build your roadmap" permanently — including over later SUCCESSFUL regens. The user's screenshot showed a live 36-step tree rendering under the stale banner. Cleared at regen start.

Busters skill-gap-tracker.js + app/roadmap.js → 20260709b (portal.html, roadmap.html). Verified: node --check, test:vectors (31 PASS), pages:smoke, live asset content on the new stamps, and two timed live forced regens (200, 14/12-node trees, 67s/61s — under the 120s client abort). Note: Pages alias + asset propagation after a push can lag ~2-4 min and serve mixed old/new content across probes — wait for a fresh-query probe to settle before judging a deploy broken. No true "un-choose a committed decision" action exists server-side; the Main path chip (now working) is the intended off-switch for a tracked branch focus.

## Roadmap overhaul + Gemini 2.x retirement (2026-07-09, Jacob_Work @ 7aa66c7+)

Multi-part user request (regen timeout persisting, Main path still stuck, oversized HUD, generic gap ladders drowning waypoint steps, extend "broken", waypoints too thin). Landed across b67d50b/f87cce0/7aa66c7 + prompt-firmness follow-up:

- **THE BIG ONE — Google hard-retired gemini-2.5-flash AND gemini-2.5-flash-lite mid-day** (generateContent → 404 "no longer available"; ListModels still lists them, misleadingly). This progressively broke ALL generation and is the likely true cause of the day's "regen timed out" reports (morning 503s → afternoon 404s). Diagnosed via a temporary /debug-models Pages Function (since removed) that listed models and test-fired our exact JSON-mode body. Defaults now `gemini-3.1-flash-lite` (verified 200 with thinkingBudget:0 JSON mode) → fallback `gemini-3.5-flash` (exists, 503-swamped on migration day, retryable). Sanitizer rejects ALL gemini-2.x env overrides. **Regen now 8.5s** (was 60-95s).
- **Main path switch, real fix** (1119592): pinMatchesActiveBranch strict key equality (the committed-branch/activePath exemption defeated the prior fix — committed branch nodes sat on activePath so the stale pin stayed "valid"); setActiveBranchKey re-pins waypointId to the target branch's next waypoint + needsRecompute.
- **Semester-scale typed waypoint steps**: steps carry kind (reading|course|club|deliverable|network|milestone) whitelisted in normalizeSteps; generate/extend prompts demand ≥5 mixed-kind steps per spine waypoint naming specific objects (real course codes/books/clubs), example JSON now shows 6 typed steps (it showed 3, anchoring thin outputs). MAX_TREE_NODES 30, MAX_STEPS_PER_NODE 8, MAX_EXTEND_NODES 22→28 (the old cap 409-ing larger trees is why extend read as "broken"; verified working live: choose 200, extend 200 in 4.3s w/ 6 typed steps). maxTokens 6000, per-call 40s, registry fetch 5s abort, roadmap-sync threads request origin as baseUrl, client manual-regen timeout 150s.
- **requestAiChecklists**: session signature now stamped only AFTER a successful upgrade (stamping pre-fetch froze the generic "Shadow or read how pros…" fast ladders for the whole session after one 503 — user-visible bug), in-flight dedupe, targetSoc fallback via resolveTargetSocForTree for older roadmaps.
- **Focus view redesign** (Sonnet agent): waypoint steps primary column (3fr/2fr) with per-kind chips both themes; gaps collapse to compact expandable rows (checklist + You/Target bars + logging inside); duplicated Log-progress section removed. Compact HUD (roadmap-hud--compact, from the parallel session): title+progress+focus on one line, fit bars mini inline.
- Busters 20260709d (skill-gap-tracker.js/css, app/roadmap.js, flightway-pages.css on all referencing pages). Verified: node --check, test:vectors 31 PASS, pages:smoke, live regen 200/8.5s with 47 steps + all six kinds, live extend, live asset content.
- **Gotchas learned**: Pages alias propagation after a push can lag 5-15 min and serve mixed old/new across probes; removed-route checks get 200 HTML fallbacks (not 404) — check content, not status. A parallel Claude session had landed WIP (compact HUD, caps, prompt rule) — reconcile `git status` before editing, adopt rather than redo.

## Focus build-out: semester plans + sound gap→vector + pre-commit branch focus (2026-07-09, Jacob_Work @ eabd9d5)

User asked for a genuine build-out of the waypoint focuses (modeled on his own summer_plan_v16_2026.md: phased sequencing, weekly cadence, working protocols, base/aspirational targets), gap checkboxes that actually move the objective vector, and reported committed-branch focus access broken.

- **'waypoint-plan' action** (career-roadmap.js): on-demand SEMESTER OPERATING PLAN per waypoint — 3-4 phases that SEQUENCE work (enroll ≠ excel), cadence blocks, one working protocol, base/stretch targets, items anchored to existing step ids, dossier-grounded. KV-cached wpplan:{email}:{nodeId}:{stepsHash} 90d. Live: 4.3s miss / 0.16s hit, output quality matches the reference (e.g. "Weeks 1-4 Integration & Foundation … Tue/Thu 90-min problem sets … cap stuck-time at 15 min").
- **Gap checklist → objective vector, rebuilt on sound math**: the OLD code already called complete-step/revert-step from checklist toggles but with the accumulating-math anti-pattern (boost +6 from live gap.user which already contained prior boosts → compounding; inexact revert) AND never refreshed the client's local quiz (looked like checkboxes did nothing). New 'gap-progress' action sets the dimension ABSOLUTELY: vBase + span*0.6*(done/total), manualComplete→90%; vBase = immutable first-seen user value (bleedBase), whitelisted through normalizeV3Gap + client mergeV3Gaps (test:vectors gained a vBase round-trip case). Client absorbs returned objectiveVector+objectiveAiPatch into the local quiz and toasts the delta. Live-verified: 2/5 done → 42, repeat → 42 (idempotent), uncheck-all → exact 30 base restore.
- **Branch focus "broken" root cause**: NOT a code regression — a Node harness on real committed-tree data showed track/switch working. His regenerated tree reset doneness+commitment; focus access was gated on commitment ("Track this branch in Focus" only on committedBranch) and commit is gated on completing the fork waypoint. Fix: "Explore this branch in Focus" button on UNCOMMITTED branches (same roadmap-track-branch-btn wiring) — exploring a focus is how you decide to commit.
- **Gap-checklists prompt**: 4-6 semester-sequenced actions, each yielding a third-party-verifiable artifact.
- **Focus view UI** (Sonnet): .sgt-plan timeline (phase cards w/ weeks badges, kind chips reused, method "how" lines, tracked-step scroll+flash links), cadence pills, protocol callout, Base/Stretch targets; sessionStorage cache + in-flight dedupe; failures never break the panel. Busters 20260709e (skill-gap-tracker.js/css, roadmap-tree.js on portal.html+roadmap.html).
- Verified: node --check all, test:vectors 34 PASS, pages:smoke, live plan+gap-progress semantics, harness on real tree data.

## Roadmap overhaul round 2 (2026-07-09, Jacob_Work @ 33c981c)

User-reported issues after the focus build-out, all fixed + features added (one commit, live-verified):

- **ROOT CAUSE of "roadmap randomly resets" + semester-plan regeneration burn**: computeRoadmapInputsHash includes objectiveVecAt + dossier fingerprint — closing a gap (gap-progress writes the vector) or any chat (dossier grows) made the next roadmap load "stale" and BOTH the generate path (career-roadmap.js) and roadmapIsFresh (roadmap-sync.js) silently regenerated, minting new node ids and invalidating every wpplan KV entry. Policy now: same slug + valid roadmap = kept, always; only explicit refresh/career change rebuilds (response carries staleInputs flag, unused so far).
- **Semester plans persist on the node**: node.semesterPlan {sig, plan, generatedAt} whitelisted in normalizeNode, written by handleWaypointPlan (+ KV backfill), preserved by a merge guard in PUT /profile/roadmap (client copies predating the plan write must not wipe it). Client renders wp.semesterPlan instantly, no fetch. test:vectors round-trips it (37 PASS).
- **Scroll reset on focus-view persist**: renderFocusView captures/restores window.scrollY on re-renders (el.childElementCount gate); confirm modal focuses with preventScroll.
- **Missing career info in HUD**: fit bars were gated on fitContext.targetSoc with no fallback; hydrateHudFit (roadmap.js) resolves SOC + live fit post-render, paints #roadmap-hud-fit-slot, folds values back into rm.fitContext. Focus view gained .sgt-focus-target line (career link + readiness).
- **Clarifying questions**: 'generate-questions' action (one Gemini call, FALLBACK_QUESTIONS static set on any failure — never blocks); client fw-qwiz MCQ wizard (one question at a time, "Something else…" typed answer, skip, Escape) runs in generate() AFTER the cached early-return; answers → body.customAnswers (prompt cap raised 4→6, labeled WEIGHT THESE HEAVILY). wireRegen now routes through generate(slug,name,true) — NOT FWAuth.syncRoadmap — so regens get the wizard too.
- **Branch build-out**: synthesizeMissingBranches marks nodes synthetic:true (whitelisted with aiBuilt in normalizeNode); 'branch-build' action + buildBranchBuildPrompt/applyBranchBuild (roadmap-tree.js) rewrite a branch chain's CONTENT in place — same ids, so decisions/done-state/preview paths stay valid; decision option labels re-synced; semesterPlan deleted on rewrite (steps changed). Client: ensureBranchBuilt fires on preview + explore-in-focus (branchRootFor walks to the branch root); toast while building.
- **Evidence rules engine**: logs get weight l.w (2 base, +2/matched keyword, +3 artifact verb regex, +1 length ≥80, cap 12) stamped once at add-time in persistLog; gapEvidencePct caps Σw at 30; syncV3Progress = min(100, checklist% + evidence) (manual→100); sendGapProgress sends evidencePct and log add/remove now triggers it (typed contributions actually move the vector — server: value = b + span*min(0.9, 0.6*done/total + evidencePct/100)); l.w whitelisted in normalizeV3Gap. +N% chip per log.
- **Pill steps UI** (Sonnet agent): .sgt-step labels are pills (checkbox sr-only, :has()-gated with graceful fallback), animated tick span + gradient strike-through; fw-qwiz modal CSS; .sgt-log-weight/.sgt-focus-target styles.
- Busters 20260709f (flightway-pages.css, skill-gap-tracker.css/js, app/roadmap.js on all referencing pages). Verified: node --check all, test:vectors 37 PASS, hub:verify, verify:aliases, pages:smoke, live curl (401 gates on both new actions, new content on f-stamps).
- NOTE: Bash cwd can silently reset to the repo PARENT (/Users/jacobklugerman/Flightway) between calls — a "npm enoent" or grep-count-0 against live assets may just be wrong cwd / alias propagation lag, not a broken deploy.
- Open: no live visual QA of the pill steps / qwiz modal / dark themes; branch-build not yet exercised on a real account (only 401 gate + unit-path checked); consider surfacing the staleInputs flag as a gentle "profile changed — regenerate?" chip.

## Roadmap round 3 (2026-07-10, Jacob_Work @ 8598417)

- **Scroll snap, TRUE root cause (third attempt, real fix)**: `.roadmap-focus-view` is an INNER scroller (overflow-y:auto, skill-gap-tracker.css ~459) — both prior fixes restored window.scrollY, which never moves on this layout. Every persist replaces the element, zeroing its scrollTop. Fixed: applyRoadmapFromTracker carries the old panel's scrollTop onto the NEW #roadmap-focus-view after render()+renderFocusPanel(); renderFocusView also restores el.scrollTop for same-element rebuilds; render() itself now preserves window scroll for every rebuild path. LESSON: before "restore scroll", identify WHICH element scrolls.
- **AI-checklist reversion root cause**: multi-writer clobber — portal/roadmap pages full-doc-save trees; a page holding a pre-upgrade copy (generic fast ladders) saved over 'ai' checklists another page earned. PUT /profile/roadmap now carries forward existing 'ai' checklists by dimIndex when the incoming gap is 'fast' with no done items (same guard class as semesterPlan). Also: gaps with done items now upgrade (keep done items, fill with AI actions under 'a'-prefixed ids to avoid id collisions with kept 'c' items), and a partial gap-checklists response no longer stamps the sessionStorage sig (missed gaps retry).
- **generate-questions**: 6-8 questions across distinct axes (timeline, hours, sub-field, existing assets, what they tried, learning style, worry, 2-year success), digs deeper into dossier hints instead of skipping them; maxTokens 1400; fallback set = 7 questions; client accepts 8.
- **'step-elaborate' action** + "Go deeper" on every semester-plan item: mentor-voice breakdown (what good looks like / first hour / the classic mistake), KV-cached `elab:{email}:{nodeId}:{hash}` 30d; free-form follow-up questions on the same item are live (not cached). Rate-limited with the gap-checklist bucket.
- **Inline Marco on the focus waypoint** (skill-gap-tracker.js renderMarcoInline/bindMarcoInline): compact thread under the focus layout; messages go through the existing action:'chat' (which can patch the roadmap) with the waypoint named in the message; MARCO_THREADS module map keeps the conversation across the full re-render each persist triggers.
- **PLAIN_STYLE_RULES** (exported from roadmap-tree.js): mentor voice + banned-jargon list (leverage/passionate/journey/delve/…) appended to generate-tree, branch-build, extend, waypoint-plan, gap-checklists, generate-questions, and step-elaborate prompts. NOTE: theme has NO --ink token — text/border tokens are `--text`, `--border`, `--border-light`, `--border-strong`, `--surface` (rgb triplets).
- Busters 20260710b (skill-gap-tracker.js/css portal+roadmap, app/roadmap.js roadmap.html). Verified: node --check all touched, test:vectors 37 PASS, verify:aliases, live curl + pages:smoke post-deploy.
- **igor_work_2 fork surveyed** (Sonnet agent; clone in session scratchpad, not committed): coworker fork adds career simulations (simulation.html + sim/* + 5 Functions), AI-exposure score, paywall/entitlements (+5 D1 migrations), interview prep, resume builder, weekly-plan cron worker, artifacts/receipts — PLUS large diffs to our actively-developed roadmap files (career-roadmap.js ~470 lines, skill-gap-tracker.js ~606, roadmap.js ~325). Merge decision questions were put to Jacob; roadmap files should stay ours (treat A as source of truth), fork features hand-ported. Answers pending.

## Igor FlightWay 2.0 port onto Jacob_Work (2026-07-10)

- Ported Career Tester (all tiers + Mirror; authored sims + /sim-generate long-tail), why-this-match, confidence tiers, AI-exposure, weekly Flight Plan, receipts, artifacts↔gap evidence mega-system, interview prep, resume builder, fake-door pricing, entitlements (paywall dark), events telemetry, cron nudge worker.
- Jacob roadmap/focus stack kept as source of truth. CORS allowlist via ALLOWED_ORIGIN comma-list in wrangler production vars.
- D1 migrations 0004–0010 applied remotely; 0003 seed chunk-applied (759 onet_careers). Cron Worker `flightway-cron` deployed (secrets still need RESEND_API_KEY / FROM_EMAIL / UNSUB_SECRET / MAILING_ADDRESS on the Worker).
- Portal FW2 cards mount into `#portal-fw2-stack` (Flight Plan → Receipts → Evidence → Notify); sim + resume stay in `#portal-actions`.

## Streamlining pass post-Igor-port (2026-07-10, Jacob_Work @ 6e81848)

User-directed product streamlining ("one progress surface per page"), all live-verified on flightwayjacobprototype:

- **Portal cuts** (bd4cfef): Receipts, Evidence/Artifacts, and Resume Builder cards + the portal Dimension Viewer card removed (files stay on disk unreferenced — portal-receipts.js, artifacts.js, dimension-viewer.js, resume-builder.js; endpoints/tables stay dark like pricing). Notify opt-in folded into the Flight Plan footer as an "Email me these every Monday" toggle (`#flightplan-notify-slot`). The full `#portal-skill-gap-tracker` on home replaced by a read-only Readiness panel (`readinessSummaryHtml` in portal.js — bars + one focus-view link). portal.html no longer loads skill-gap-tracker.js/css; roadmap.html no longer loads artifacts.js. `shared/onet-dimension-viewer.js` kept (profile drawer uses it).
- **Skill gaps = readiness meter**: focus-view gap column is You/Target bars + status only (`renderGapMeterRow`); per-gap AI checklists, log inputs, promote buttons, manual-complete rows, and the step confirm modal all removed. `requestAiChecklists` no longer invoked; the `gap-checklists`/`gap-progress`/`complete-step`/`revert-step` client flows are retired (complete/revert server handlers now no-op 200 "superseded" — their boost math compounded).
- **ONE vector writer for progress** — `functions/_lib/gap-progress-sync.js`: `computeGapProgressDims(tree)` derives each v3 gap's ABSOLUTE value from vBase + step done-ratio of addressing activePath waypoints (fallback: whole path), max()'d with legacy checklist credit, + evidence log weights (cap 30), manualComplete→90% of span; `syncGapProgressToQuiz` merges via objectiveAiPatch source `gap-progress-sync`, **skipping the save when values are unchanged** (no updatedAt churn). Runs on every PUT /profile/roadmap (response carries `objectiveSynced` + vector; client `saveRoadmap` in auth.js absorbs via `applyObjectiveFromResponse`) and weekly-plan POST. Live-verified: 1/6 steps → 36 from base 30 (exact formula), repeat save no-op, uncheck-all → exact 30 restore. 12 new invariants in `npm run test:weekly`.
- **Dossier ⇄ vectors** — `functions/_lib/dossier-coordinates.js`: `loadDossierWithCoordinates` appends a fenced `[[coordinates]]` block (target career, personality/objective fits, readiness, top gaps you-vs-role, quiz industries/archetype) composed at READ time from D1. Swapped into chat.js (Marco), career-roadmap resolveDossier, career-switch-chat, career-analysis, resume-builder. `saveDossier` strips the fence (`COORDINATES_BLOCK_RE` in _lib.js) so Gemini dossier merges can never persist a stale snapshot. **portal-snapshot deliberately NOT swapped** — its inputsHash fingerprints the dossier; a live digest would re-churn snapshot regens.
- **Flight Plan ↔ semester plans**: `selectWeeklyTasks` orders a waypoint's steps by its semesterPlan phase sequence and stamps `task.weeks` ("Weeks 1-4"); card shows the chip; cron worker inherits (same import). Card polish: week-of label, N-of-M chip, task text links to roadmap.html?focus=1.
- **Two roadmap bugs fixed** (user-reported): (1) inline Marco 400'd every message — `/career-roadmap` validates careerSlug/careerName BEFORE the chat branch and bindMarcoInline didn't send them (now does; contract same as the drawer chat). (2) "Building your semester plan…" stuck forever — `WP_PLAN_INFLIGHT` boolean dedupe dropped the re-render's callback while the response painted a detached node; now a callback queue (`settle()`). The "generic gap checklists" symptom is moot (checklists removed).
- Gotcha recorded: a failed BSD `sed -i` can leave `.!NNNNN!name.js` temp files next to the target — four got committed into functions/ (bd4cfef) and were removed in 6e81848; check `git status` for `!` files after any sed.
- Busters 20260710p (auth.js + flightway-pages.css site-wide; portal/roadmap-specific files on their pages). Verified: test:vectors 37, test:weekly 24, hub:verify, verify:aliases, pages:smoke, live QA on test account jklugerman2008+fwstreamline1@gmail.com (safe to delete).
- Deferred/open: visual QA of the readiness meter + slimmer focus view in both themes; deleting the now-unreferenced client files (portal-receipts.js, artifacts.js, dimension-viewer.js, resume-builder.js) and the dead render helpers in skill-gap-tracker.js (renderV3GapCard/renderGapCollapsedRow/log machinery — left in place this pass to avoid cross-edit breakage); interview prep stays (inside coach, premium-gated, dark).

## Flight Plan card restyle + readiness meter data bug (2026-07-10, Jacob_Work @ 8e1d1c7)

User-reported off a screenshot of the just-shipped streamlining pass: Flight Plan card didn't match the rest of the home page, and the Readiness panel looked like it was missing data. Both real bugs, not just polish requests.

- **Flight Plan card visual mismatch, root cause**: `.fw-flightplan-card` (`flightway-2.css`) was still on the old FW2 design system — flat `rgba(127,140,175,.06)` tint, no border/shadow — while every other portal card had already been converted to the `.portal-panel` treatment (solid surface, themed border, `box-shadow: var(--shadow-sm)`, top accent strip). It was the one card never migrated when the rest of the home page moved to that system, so it read as washed-out/blended into the background next to "Career Roadmap." Fixed by giving `.fw-flightplan-card` the same surface/border/shadow tokens plus a `::before` top accent strip (CSS-only, no markup change). Also swapped every `var(--fw2-accent)` (a leftover blue, `#6ea8ff`) inside Flight-Plan-owned rules — checkbox fill, focus outline, CTA link, the ring stroke (inline SVG in `portal-flightplan.js`), and the folded-in notify toggle — to `rgb(var(--primary))` (the site's orange) so it reads as one system. Left the ~17 other `var(--fw2-accent)` uses untouched (pricing, interview prep, AI-exposure, resume builder — different, out-of-scope features).
- **Readiness meter was actually broken, not just visually off**: `renderGapMeterRow`'s `portal-readiness-bar` overlaid the "You" and "Target" fills as two `position:absolute` spans in the *same* track (z-index 2 over 1), with **no numeric value displayed anywhere**. Early in any plan "You" is low (e.g. 13%), so that fill rendered as a near-invisible sliver with nothing — no number, no label — to confirm it wasn't just empty. Rewrote to two full-width tracks (You / Target), each with a visible number, matching the language the roadmap focus view's own gap meter already uses (`sgt-cmp-bars`). Also added a "+N more on the focus view" line when a career has more than the 3 gaps shown.
- Busters `20260710q`: `flightway-pages.css` (site-wide — readiness CSS is shared) and `flightway-2.css` (career/coach/portal/roadmap/pricing/simulation — the latter two were still pinned at a stale `20260708a`, now caught up); `portal.js` + `portal-flightplan.js` on portal.html only.
- Verified: `node --check`, `test:vectors` 37 PASS, `hub:verify`, `verify:aliases`, `pages:smoke`, live curl confirming both the new CSS strings and the new readiness markup are actually served on the `20260710q` stamps (not just committed).
- Open: no live visual QA yet in dark mode or on the Flight Plan card's hover/focus states; the ~17 remaining `--fw2-accent` blue usages elsewhere (pricing, interview prep, AI-exposure) are a known, deliberately out-of-scope inconsistency if a future pass wants full site-wide color unification.

---

## AI-derived careers overhaul + deep-dive page condense (2026-07-10, Jacob_Work @ d8a6513)

User-reported 5-part bug pass on AI-derived ("fragment") careers:

- **D1 reset**: all 46 runtime `derived_careers` rows deleted remotely (many legacy rows had no description). Static sidecar (data/onet/artifacts/derived-careers.json, 1 curated row w/ description) kept. Fragments regenerate on demand via POST /derive-career.
- **Satellite split-brain root cause**: server stores real world coords per fragment (offsetLayout), and careerAtScreen/tooltips hit-test those — but the hub-onet-map.js overlay drew orbs at its OWN screen-space orbit (baseR*3 around parent). Labels/tooltips appeared where no orb existed. Fixed: overlay now draws each fragment at careerWorldXY→worldToScreen (same coords as hit-test), tether guarded when parent absent.
- **Visibility**: rest-state fragment orbs were ~1px at alpha 0.07 (dark) — effectively invisible. Now always-visible: subR = max(2.5, baseR*(0.35+0.25*a)), alphaFloor 0.6 light / 0.4 dark.
- **Organic spacing**: offsetLayout (functions/_lib/derive-career.js) jitters angle ±25° and radius ±30% deterministically (hash of base SOC + seed) instead of a perfect 120° tripod. Applies to newly generated rows only (DB was reset anyway).
- **Label overlap**: overlay labels now go through a greedy collision pass (sorted by bloom strength, overlapping rects culled).
- **Derived deep dive was blank**: derived rows live only in D1, not careers.json, so career.html's showCareer() missed and rendered nothing. career.html boot now calls FWOnetCatalog.ensureDerivedRow(soc) first when soc starts with 99-.
- **Deep-dive page condensed** (Sonnet subagent): "AI & Automation Outlook / Chance of being replaced by AI" section (data-career-personal="aiReplacement") removed — redundant with ai-exposure.js's "How AI hits this career" (which anchors after matchSection, unchanged). Sections restructured into compact cards (#page-career overrides in flightway-pages.css: section-inner → career-card w/ accent strip, pair-grid for Skills+Related, compact CTAs). career-personalize.js unchanged (aiReplacement access already if-guarded). All other data-career-* hooks preserved.
- Busters 20260710r: hub-onet-map.js (dashboard.html), app-pages.js (career.html), flightway-pages.css (8 pages).
- Verified: node --check, test:vectors 37, hub:verify, verify:aliases, pages:smoke, live curl (new stamps + ensureDerivedRow served).
- Open: no live visual QA yet of satellite look post-regeneration (needs a signed-in user to trigger fragment generation for a base career); deep-dive dark-mode visual QA.

## Session timeline recap

**Agent 1 (timeout fix):** Concurrent Gemini calls. Added withSoftTimeout helper, parallelized grounded calls (15s each), raised client timeout 90s→120s.

**Agent 2 (satellites population):** Partial. Added ?all endpoint, hub-boot merge. Stalled at 600s watchdog. Left clean edits; only cache-buster bump remained.

**Me (satellites clutter):** Finished B (cache-buster bump), did C (fragment clutter + zoom scaling) end-to-end.

**Follow-on work (parallel or later):** Multiple rounds of satellite visual sizing, extensive roadmap-branch feature work.

## Three-feature build: waypoint Marco, AI Flight Plan, Career Tester v2 (2026-07-10, Jacob_Work @ 445df99)

- **F1 — inline waypoint Marco edits + dossier sync.** New `scope:'waypoint'` branch in `/career-roadmap` chat (`handleWaypointChat`): a dedicated Gemini call sees ONE node (steps + semesterPlan.plan) and returns `{reply, waypointPatch, dossierFact}`. Server pins structure (id/parentId/depth/pathRole, no summary/decisions/activePath) so blast radius is intra-waypoint only; edited plans get a fresh sig coupled to the edited steps (steps-only edits leave the old sig so the plan regenerates). Step done-changes run `syncGapProgressToQuiz`. Macro "refine plan" chat unchanged structurally but both surfaces now dossier-sync same-turn via `waitUntil`: shared merge lib `functions/_lib/dossier-update.js` (extracted from chat.js — chat.js now imports it; merge skips the save when Gemini returns the dossier unchanged). Gates: inline = Gemini's `dossierFact` flag; macro = `messageTouchesDossier` heuristic (durable-fact regex OR ≥5-char token overlap with dossier). Client: `bindMarcoInline` sends scope+waypointId.
- **F2 — AI weekly Flight Plan.** `/weekly-plan` GET now generates once per ISO week (`_lib/weekly-plan-gen.js`, KV `wkplan2:<email>:<week>`) from current waypoint + step fractions + last week's done/missed tasks + Marco-logged notes; falls back to old `selectWeeklyTasks` on Gemini failure. Progress rules engine `_lib/flightplan-progress.js` (KV `fpprog:<email>`): tasks carry `advance` (0.05–1); accrual to ≥0.999 flips the roadmap step done → vector via gap-progress-sync; un-checking reverses. Legacy `wp:st` taskIds still work. Marco logs progress notes (`appendProgressNote`) from both roadmap chat surfaces when a patch lands. Client card: `carried over` chip. **Cron worker NOT updated** — its Monday email still uses deterministic `selectWeeklyTasks` (worker deploy untouched; can diverge from the AI plan until `deploy:cron` is run with an updated worker).
- **F3 — Career Tester v2 gaps filled** (the Igor-ported system already had 3 tiers + /sim-generate + simulation.html for generated sims — NOT rebuilt): (1) generation now emits a branching `scenario` (4–6 decision nodes, branching `next` pointers, tone strong/workable/costly), sanitized in `validate()`; sim-engine adds a deep-tier-only "Crossroads" tab (replay chosen beats, decide live, re-run differently; state in `S.scenarioPath`, draft-persisted). Pre-existing KV sims lack scenario → tab simply absent. (2) Board discovery: `simv2-index` KV doc (cap 100) updated on each generation; GET `/sim-generate` returns it; board renders "Built by request" section (ALL filter only) opening via `openGenerated` (instant, cached).
- 16 new invariants in `npm run test:weekly` (40 total). Verified: test:vectors 37, hub:verify, verify:aliases, pages:smoke, node --check, live curls on 20260710v stamps (skill-gap-tracker roadmap.html, portal-flightplan portal.html, sim-engine simulation.html) + GET /sim-generate live `{"sims":[]}`.
- Open: no live end-to-end QA of the scoped waypoint chat or AI week generation with a signed-in user (needs a real Gemini turn); cron worker divergence above; critic prompt not extended to grade the scenario block.

## Three-feature build: career comparison, quantified pivots, resume builder v2 (2026-07-12, Jacob_Work, uncommitted)

- **F1 — Vector career comparison (Hub).** New `assets/js/hub/career-compare.js` (`FWCareerCompare.open({soc,name})`, self-injected CSS `fw-cmp-*`): side A = current focus, side B = panel career or `FWOnetCatalog.searchByTitle` picker. Client-side coordinate math via `FWOnetVectors.fetchVectorsBatched` + `loadDimensionRegistry`; per-career user fits via `fetchAuthenticatedVectorFit` with client fallback (same shape as portal-target-switch's `fetchPortalVectorFit`); loading/error mirrors the dual-fit skeleton pattern. Sections: shared strengths (both ≥70), top divergences (|Δ|≥8), plain-language trade-off line (objective fit = "closer to qualifying today", personality fit = "stronger long-term"). Entry: `#panel-compare` button in dashboard.html panel footer, wired in `hub-dashboard.js` `openPanel` (hidden when `career.soc` missing).
- **F2 — Quantified pivot support.** New `functions/_lib/onet/pivot-analysis.js` (`computePivotAnalysis`, `pivotSummaryLine`): career↔career cosine `transferPct`, user-objective↔target `objectiveOverlapPct`, per-coordinate `breakdown` (transfers ≤12 rawGap / partial ≤30 / new_gap, target-material dims ≥60 only, ordered largest weighted gap first via `computeGapVector`). Hooked into `recordCareerFocus` (roadmap-sync.js) — the convergence point for BOTH the explicit picker (`/career-focus`) and chat pivots (`confirmCareerSwitch`) — best-effort try/catch, returned as `pivot` in both endpoints' JSON. Dossier: `appendCareerSwitchToDossier` now takes `pivotLine` and appends the quantified sentence to the switch note (Marco sees it in future turns). Chat reply quotes the transfer line on confirmed switches; client toast in `career-target.js` shows it on picker switches. Roadmap ordering: branch-synth in `roadmap-tree.js` now sorts `vectorGaps` by gap desc and leads `allGaps` with them; `roadmap-generate.js` prompt states gaps are listed largest-first and orders gap-closing waypoints accordingly.
- **F3 — Resume builder v2** (extended the unwired Igor-port, not net-new; NOW WIRED into portal.html — script tag + `FWResumeBuilder.inject()` in boot and `reinjectPortalActionExtras`). Server `functions/resume-builder.js`: POST accepts fenced `freeText` (sanitizeUntrustedText mirror + `<experience>` DATA block), regenerates incrementally against the saved doc, unrelated-field reframing weighted to the career's top-importance dims; GET `?soc=` returns saved doc; PUT saves edited bullets. Persistence: KV `rbuildsaved:<email>:<soc>` versioned (`version`, `updatedAt`, 180d TTL) — replaced the old 7d `rbuild:` cache. Gemini: `timeoutMs` 20s + `deadlineAt` 40s wall budget, `softFail`; on empty generation returns the saved doc with `notice` instead of 5xx. Client: freeform textarea, contenteditable bullets + Save edits (PUT), coverage chips show covered ✓ vs missing ✕ dims + "still missing" note, Download .txt export. New CSS in flightway-2.css (`fw-rb-freetext/-dim--missing/-missing-note/-tools/-vers`).
- Busters: 20260712a on career-compare.js/hub-dashboard.js (dashboard.html), portal.js/resume-builder.js (portal.html), career-target.js (5 pages), flightway-2.css (6 pages).
- Verified: test:vectors 37 PASS, test:weekly 47 pass, onet:test, hub:verify, verify:aliases, node --check on all 12 touched JS. NOT yet: pages:smoke/live curls (not deployed — no push this session), live Gemini QA of resume generation or a real pivot turn.
- Open: comparison view has no dedicated test coverage (client-only math reuses tested primitives); pivot breakdown not yet rendered anywhere client-side beyond the toast/chat line (data is in both endpoint responses when UI wants it).

## Three-phase polish: match tiers, GPA recall, post-signup resume, pivot UI, jargon (2026-07-12, Jacob_Work @ 4891da6)
- **Phase 1 — three bug fixes (quiz-app.js @20260712b on quiz.html; profile-alignment.js server):**
  - *Match tier (Bug 3):* `qzTierFor` took `rank` and hardcoded #1 → LEGENDARY; combined with `hubPct1 = score/hubMax*100` (always 100% for the winner) every top career read "100% legendary". Now `qzTierFor(pct)` thresholds on the ABSOLUTE 0-100 fit (85 legendary / 70 epic / 55 great / else solid), and `hubPct1/2` use the raw `overallFitScore` (clamped), not a ratio-to-winner. `qzPlacementPct[rank]` bridges the pct into `qzRevealOne` for particle/impact. Verified live: qzTierFor(92)=legendary, (58)=great, (40)=solid.
  - *Coach GPA recall (Bug 2):* `buildProfileSignalsBlock` now emits `GPA:`/`Major:`/`Graduation year:` from `quiz.academics` (the Sharpen-Matches panel's canonical store, same field stretch-fits.js reads) so Marco stops re-asking for a GPA already on file.
  - *Post-signup resume (Bug 1):* resume upload moved OUT of the pre-gate quiz flow. `qzFinishInitialQuiz` → gate directly; after `authRegister`, `qzCreateAccount` awaits `qzConfettiDonePromise` (new — resolves when the 5s gate confetti ends), then `qzShowPostSignupResume()` ("One last thing" reframe of the `#qz-resume` step, promise-based continue/skip), applies resume rules, rebuilds the hub link with the resume-tuned objective, redirects.
- **Phase 2 — pivot breakdown now surfaces (career-target.js @20260712b, 5 pages).** New `FWCareerTarget.showPivotSummary(pivot, fromName, toName)`: self-injecting `fw-pv-*` modal (transition-in) rendering transfer% + objective-overlap stat tiles and Directly-transferable / Partially-transferable / New-strengths coordinate chip groups from `data.pivot.breakdown`. Wired into `switchTargetCareer` when a breakdown exists (else keeps the light toast). Server pipeline (cosine transferPct, dossier pivotLine, roadmap gap-sort at roadmap-tree.js:1018) was already complete — this closes the "not rendered client-side" open item.
- **Phase 3 — jargon strip (busters 20260712c).** "objective vector"→"your background" (portal-resume, skill-gap toast), "O*NET coordinates/dimensions"→"strengths" (resume-builder, career-compare, portal drawer, dimension-viewer, receipts), "quiz vector"→"quiz profile" (career-personalize, why-this-match). Kept "objective fit"/"personality fit" product terms. `dimension-viewer.js` + `portal-receipts.js` are dead (no page loads them) — copy improved, no buster. Files bumped: portal-resume/portal/resume-builder (portal.html), career-personalize/why-this-match (career.html), career-compare (dashboard.html), skill-gap-tracker (roadmap.html).
- Verified: test:vectors 37 PASS, hub:verify, verify:aliases, pages:smoke, node --check all touched JS; live curls confirm busters (quiz-app/career-target 712b, Phase-3 files 712c); live quiz.html boots clean (no console errors). NOT done: live end-to-end signup→resume→hub run or a real Gemini pivot turn (needs a signed-in session); dead-code files left unwired.

## Dynamic sync + profile math + Doom button + legacy migration + nav/staleness (2026-07-12, Jacob_Work @ 81341a2)
- **Flight Plan dynamic sync (weekly-plan.js).** The week doc was cached by ISO week ALONE, so a mid-week Semester Plan edit (a class change like STAT 24400 → MATH 16100) never regenerated it — the Flight Plan showed stale classes. Added `weeklyInputSig(tree)` = short hash of `currentWaypoint`'s id + step text + semester-plan phase titles/items; GET regenerates when `doc.sig !== sig`. Step DONE-toggles don't alter the sig (text unchanged) so they still route through `refreshDoneState`, not a wasteful regen. Legacy docs (no `sig`) regenerate once.
- **"Your strengths" math (onet-dimension-viewer.js `mountPortalViewer`).** Was rendering raw personality values. Now `blendStrengthsForDisplay` applies the standardized `0.75*personality + 0.25*objective` per dimension, but ONLY when `isObjectiveVectorActive` (mirrors `overallFitScore` null-handling → resume-less accounts still show raw personality, no 0.75x regression).
- **Account purge "Doom Button" (functions/account.js DELETE + portal.js + portal.html).** Repurposed the deprecated `account.js` stub: `onRequestDelete` auth-gates on `getSessionEmail`, then best-effort purges 9 per-user D1 tables (artifacts, career_analyses, password_reset_tokens, pricing_intents, quiz_profiles, roadmaps, sessions, vector_snapshots, users) + all per-user KV (10 exact `type:email` keys + 6 prefix families `type:email:*` via `list`+`delete`), `destroyAllSessions`, and clears the cookie. `derived_careers` (global) excluded. Client: a confirm-gated danger button under Sign Out in the portal footer → DELETE → `localStorage.clear()` → redirect to index; same email can re-register clean. Live: `DELETE /account` → 401 unauth (wired).
- **Legacy migration (onet-vectors.js `migrateLegacyQuizSchema`, called at top of `hydrateQuizVectors`).** ROOT CAUSE of the flat all-100 strengths: `basePersonalityFromQuiz` trusted ANY stored vector with `.values.length`, so a corrupt/legacy vector survived every hydration (never reseeded from scores). Migration now: inits newly-expected keys (`careerFocusHistory:[]`, `academics:{}`, `profile:{}`); drops any personality/objective vector that is wrong-length, wrong-`schemaId`, or (personality-only, when scores exist) degenerate (`personalityLooksCorrupt`: zero spread OR ≥50% saturated ≥99.5) → forces a clean reseed. Verified LIVE: injected all-100 vector reseeds (count100 161→0); +5 `test:vectors` cases (now **42**).
- **Career Hub nav (dashboard.html).** Added the `Marco` tab (`coach.html`, `data-app-nav="advisor"`) between Career Hub and Career Roadmap — the deliberate omission comment is gone; nav now matches Home/Roadmap/Marco. Live curl confirms order home·hub·advisor·roadmap·quiz.
- **Staleness sweep.** Deleted the two provably-dead client files the earlier Portal-cuts addendum flagged for deletion: `assets/js/app/portal-receipts.js` (FWReceiptsCard) and `assets/js/app/dimension-viewer.js` (FWDimensionViewer) — loaded by no page, globals referenced nowhere. KEPT `artifacts.js` (guarded live refs in skill-gap-tracker/portal-flightplan — larger call) and the since-re-wired `resume-builder.js`. `deploy:prototype` left as a documented do-not-use marker.
- Busters 20260712d: onet-vectors.js (career/dashboard/portal/profile-build/quiz/roadmap), onet-dimension-viewer.js (career/portal), portal.js (portal).
- Verified: test:vectors 42 PASS, hub:verify, verify:aliases, pages:smoke, node --check all touched JS; live — onet-vectors 712d + Marco nav + DELETE /account 401 + all-100 reseed. NOT done: signed-in end-to-end of Doom purge, a real mid-week Semester-Plan→Flight-Plan regen, and the strengths blend with a populated objective vector (need an authed session).

## Launch-polish pass: sector-fit fix + security + polish + engagement (2026-07-13, Jacob_Work @ ba0c5ec)

Four-phase pass off `docs/LAUNCH_POLISH_BRIEF.md`. Phase 0 punch list found the repo already far past `AUDIT_REPORT.md` (all 21 closed); scans were clean (no real TODOs, one console.log, icons all registered, fw_debug gated, SQL parameterized). Baseline was green before starting.

- **Phase 1 — aggregate fit compression (`1ed1740`).** ROOT CAUSE: `cosine` was raw/non-centered; O*NET vectors share a large positive "generic occupation" common-mode so any pair sat at ~0.70–0.85 → every score in one high band → "everything is gold." FIX: `cosine` now mean-centers each vector (Pearson) before the dot product, in BOTH `assets/js/shared/onet-math.js` and `functions/_lib/onet/math.js` (kept identical — parity invariant). Measured on real vectors: sector-fit spread widened from ~10pt to 20–29pt with rankings intact (tech→tech #1, creative→creative #1, trades/ops bottom). New canonical `FWOnetMath.FIT_TIERS` (mythic66/legendary56/epic46/rare34/uncommon20) + `fitTier()` is now the single tier source; retuned every consumer to it — `career-target.fitRarity`, `hub-canvas.rarityOf`/isGold(56)/isBest(66)/pairFit(56), `marco.isGold`(×4→56), `hub-dashboard.highFit`(56), `quiz-app.qzTierFor`(56/46/34), `onet-vectors` stretch cutoff (72→52). `onet:test` gained centered invariants (constant-offset→100%, inverted→0%). Fit is derived from persisted vectors each load, so existing users self-correct with NO migration. `computePreparedness` (readiness %) uses dot/dot projection, unchanged. Busters 20260713a on career/dashboard/portal/profile-build/quiz/roadmap.
- **Phase 4 — security (`67dc067`).** Full auth/data trace: foundation is strong (D1 fully parameterized; the only dynamic-table SQL is `account.js` over a hardcoded 9-table const with parameterized email; user data keyed by session email not request params → no IDOR; unsubscribe is peppered-token + timing-safe; HttpOnly+Secure+SameSite cookies; PBKDF2-100k timing-safe; logout + reset both invalidate server-side; coach AI text HTML-escaped before markdown; user→Gemini fenced via `sanitizeUntrustedText`; no client secrets). THREE fixes: (1) `login.js` skipped PBKDF2 on missing user → email enumeration by timing; now always verifies against `DUMMY_PASSWORD_HASH`. (2) `send-results.js` unauth Resend send had no rate limit (email-bomb/cost); added per-IP+per-recipient `checkRateLimit`. (3) `forgot-password.js` Resend fetch was unbounded and a send failure hit the 500 path (leaking existence via 500-vs-generic-200); now 8s-abort + swallowed so the response stays generic. Also fixed the stale `flightway-prototype.pages.dev` reset-fallback host (dead DNS) → `flightwayjacobprototype.pages.dev`.
- **Phase 2 — polish (`3f7a2ec`).** `roadmap.js` branch-commit warning's native `alert()` fallback → in-file `showRoadmapToast`; removed a leftover `[SGT]` console.log in `skill-gap-tracker.js`. Busters 20260713a (roadmap.js, skill-gap-tracker.js on roadmap.html).
- **Phase 3 — engagement (`ba0c5ec`).** Added a "Roadmap progress · done/total" line to the portal readiness card (`portal.js readinessSummaryHtml`) from `FWRoadmapTree.progressTree()` — same active-path count the roadmap HUD uses; reuses existing `.portal-readiness-*` classes (no CSS change), additive/read-only, absent when no progress. Buster 20260713a (portal.js on portal.html). The rest of Phase 3's goals (differentiated Marco/quiz, top-sector hooks, empty states, readiness) were already met by existing infra + the Phase 1 differentiation.
- Verified: node --check all touched, onet:test, test:vectors 42, test:weekly 47, verify:aliases, hub:verify, hub:smoke, pages:smoke; live curls confirmed all four commits' content on the 20260713a stamps + `/auth/login` 204.
- **Deliberately deferred:** dead render helpers in `skill-gap-tracker.js` (`renderV3GapCard`/`renderGapCollapsedRow`) left in place — removal in that 2000-line file is high-risk/low-value, not launch-blocking. ~17 `--fw2-accent` blue usages (interview-prep/AI-exposure/resume-builder) left as the known out-of-scope color inconsistency (pricing untouched per brief). No live visual QA in both themes/mobile of the new readiness progress line or the retuned tier colors (functionally verified; visual pass outstanding). `sessionPepper` still falls back to `GEMINI_API_KEY` then a dev constant — set `SESSION_PEPPER` in prod (env task, not code).

## UX trust overhaul: Phases 3-6 off UX_TRUST_OVERHAUL_BRIEF.md (2026-07-16, Jacob_Work @ 734a573+)

- **Phase 1/2 verified intact** (Leo's why-this-match + leaning commits 01617a5/dbe547b/0bf2409); local was 2 commits behind origin (Leo pushed fa577c3 Phase-3 badges + d77d7f3 Phase-4 landing mid-session) — pulled before building.
- **Phase 3 (734a573): unified satellite renderer.** hub-onet-map.js fragment overlay canvas REMOVED (~360 lines); satellites draw in hub-canvas.js's main sector pass. Layout: client-side deterministic orbit in `careerWorldXY` (`fragmentSectorXY`: even slots + hash jitter, SAT_RING_W 86 world units, elliptical) — render/hit-test/tethers/badges all read it. Badge + panel + layout all count via new `FWOnetHub.getFragmentCount` (built in buildZoneIndexes with state.bySoc/fragOrder) — fixes the badge≠visible mismatch. Satellite labels: 8px, same collision solver, yield to base careers, culled instead of leader-line fallback. Orbs smaller (SECTOR_ORB_SCREEN_R 5.6→5.0). **Macro view: full zone-cloud replacement** in drawFixedZoneTiles — base wash + 4 deterministic radial blobs per zone, label backplate, hover rim glow; fill rects sized to gradient extent (cropping leaves hard edges). **resize() re-clamps zoom** to [minZoom,maxZoom] — a degenerate-viewport boot previously left the map collapsed forever. **hub:smoke paint check rewritten** to grid variance (fixed thresholds false-positived pale rare-blue tiles as background). Busters 20260716c (hub-canvas/hub-dashboard/hub-onet-map, dashboard.html).
- **Phase 4: career-center marketing removed outright from index.html** (hero link → sign-in link, campus pricing grid deleted, features/footer copy student-first). pricing.html untouched per standing instruction. Leo's How-it-works + comparison sections kept.
- **Phase 5 on branch `phase5-free-tier-framing` off main (NOT merged — main deploy needs Jacob's explicit go).** Free-tier hub panel: "starting point, not a final verdict" fit note + locked "Why this match?" teaser card. Copy/IA only, no gating.
- **Phase 6:** hub fit explainer de-jargoned (cosine/vector/O*NET → plain language). Other pages were already clean from the 20260712 pass; index.html O*NET citations kept deliberately (credibility, Leo's comparison section).
- **Phase 7 skipped per brief (explicit non-fixes).**
- Verified per phase: node --check, test:vectors 42, hub:verify, verify:aliases, hub:smoke (local via http-server + live), pages:smoke, Playwright visual QA light/dark/mobile (overview clouds, sector satellites via injected fake fragments, landing, free-tier panel), live curls on 20260716c stamps.
- Open: live visual QA of satellites against real D1-generated fragments (needs a signed-in user to warm /derive-career); Phase 5 branch awaiting Jacob's merge decision; in-app browser pane reports 0×0 viewport to pages (canvas QA must go through Playwright probes, not the pane).

## 11-item fix/feature pass (2026-07-16 PM, Jacob_Work)

- **Pivot blurb ROOT CAUSE:** 4 files fell back to baseUrl `flightway.pages.dev` (main-branch site, NO onet artifacts — manifest.json is the HTML fallback) when SITE_URL unset → getVectorsForSocs silently failed in recordCareerFocus → pivot always null; also broke prior-SOC backfills + chat pivots. Fallback → flightwayjacobprototype.pages.dev (roadmap-sync/roadmap/roadmap-generate/career-switch-chat). LIVE-verified: switch returns transferPct 95 (probe acct fwpivotprobe716@gmail.com — password removed from this doc 2026-07-16 after it was found publicly served; the account should be deleted or its password rotated).
- **Resume Continue feedback:** post-signup continue now shows busy state through the up-to-45s parse ("Reading your resume…" → "Opening your Career Hub…"), skip disabled meanwhile (quiz-app.js).
- **Readiness "Target 0":** portal readiness rows without a real target (>0) are filtered from the metered display (portal.js readinessSummaryHtml).
- **Sharpen Matches moved into post-signup quiz:** hub-refine.js rewritten as embeddable (FWHubRefine.mount/commit + 3 new personality Qs: lead/risk/detail; same localStorage keys). New #qz-sharpen step (confetti → sharpen → resume → hub) + standalone quiz.html#sharpen (portal links retargeted). Drawer gone; hub-refine stays loaded on dashboard as a LIBRARY (hub-academics folds FWHubRefine.delta() into its recompute — removing it would drop the sharpen contribution). Academics now owns the topbar slot toggle.
- **Leaning → matches:** quiz resolves leaning text against catalog; +8 raw sector points in qzComputeScores (recomputed fresh, resume-boost idiom) + persisted quiz.careerLeaningSoc gives that soc +8 in rankOnetCareersFromVectors (read fresh per rank build).
- **Hub visuals:** macro = orb clusters (batched core orbs) + inter-cloud links (zone-aggregate cosine, ≤2/zone, long culled, exported FWOnetHub.getZoneNeighborLinks); sector positions spread 1.45x (spreadSectorCoord at mapOnetCareer); labels uncapped w/ balanced 2-line wrap + font ∝ zoom (clamp 6–15); satellites: only parent tether (aiDerived filtered from buildBalancedSectorLinks — its min-links backfill was the stray-links cause), rest alpha .18 no labels, cursor-proximity eased bloom (satAnim in hub-canvas; sector mode redraws every frame), bloom labels declutter vs _api.baseLabelRects; orbit variance widened (±45% slot, ring .68–1.43x, per-orb ellipse).
- **Depth pass:** flightway-pages.css entrance stagger/hover lift/readiness shimmer (reduced-motion guarded), busters 20260716f on 8 pages.
- Verified per batch: node --check, test:vectors 42, hub:verify, verify:aliases, hub:smoke (local+live), pages:smoke, Playwright visual QA (macro clusters/links, sector rest+bloom, sharpen step). NOT visually QA'd signed-in: portal entrance animations, live satellite bloom with real D1 fragments.

## Hub zoom feel + boot veils + Academic Profile → quiz + motion pass 2 (2026-07-17 PM, Jacob_Work)

- **Hub wheel zoom rebuilt (hub-dashboard.js).** The 4%-per-event cap (old ZOOM_STEP_CAP) made zoom feel stuck vs the legacy main-branch hub (10%/notch). Wheel events now bank log-zoom (ZOOM_SENSITIVITY 0.0008→0.0022, accumulator clamped ±2.0) and the rAF loop drains 38%/frame (`stepWheelZoom`) — hard spins land near-instantly, single notches glide smoothly; reduced-motion consumes the bank in one step. Overview→sector wheel-enter now eases via animateCameraTo(300ms) instead of teleporting; the accumulator is zeroed across mode transitions (never glide through enter/exit). `loop()` sets a `rafId=-1` sentinel for the frame — frame steps call requestHubRedraw, which invokes loop() synchronously when rafId is null and would otherwise recurse.
- **Zoom isolation.** The dot-grid backdrop was keyed to panX/panY, and cursor-anchored zoom mutates pan every tick — so the background visibly slid during zoom. It's now keyed to drag-only offsets `state.bgOffX/Y` (captured at pointerdown, advanced only in the drag path; hub-canvas.js paints from them): rock-still during zoom/fly-to, still follows drags. `#map-canvas` got `touch-action:none` + `overscroll-behavior:none` (no browser gesture fallthrough).
- **Hub loading gate.** `dismissHubLoadingOnce` fired on the FIRST rendered frame — which is legacy-fallback content until FWOnetHub.init lands, so users saw the placeholder→O*NET map swap. Now gated on `hubContentReady`, set in finishHubBootFromInit (ok AND fail paths) or immediately when FWOnetHub is absent (legacy is final). Watchdog/boot-errors bypass via hideHubLoading directly.
- **Load flicker ROOT CAUSE + boot veils.** Portal's fw-rise-in entrance (backwards fill + stagger delays up to .34s) replayed on EVERY boot re-render (hydration, snapshot fetch, zone-fits, career-focus events) — cards sat at opacity:0 through their re-started delay, i.e. the "bars flash on and off" bug. Entrance CSS is now scoped `body.fw-revealed:not(.fw-settled)`; new `shared/page-veil.js` (FWPageVeil) + opaque `#fw-page-veil` on portal/roadmap/coach: render paths call notifyRender (portal render/refreshPortalCareerUi/renderSnapshot/renderProfileEntry; roadmap render(); coachBootPage), veil reveals after a 280ms quiet window (min 120ms, max 2.5s, window-load+600ms failsafe, and a 6s pure-CSS failsafe animation in case the script 404s), entrance plays once at reveal, `fw-settled` lands 1.2s later — and any post-reveal render fast-forwards settle so fresh nodes never replay the stagger. Auth-gated redirects keep the veil up (no content flash before redirect).
- **Academic Profile moved hub → quiz flow.** hub-academics.js rewritten to the hub-refine embed pattern: FWHubAcademics.mount(container,{onProgress})/commit/answeredCount/total/isComplete (+ open/close no-ops); IDENTICAL answers/scoring/persistence (fw_hub_academics_v1, quiz.academics mirror, applyAndPersist → FWSectorFitSheet.recordLocalPatches + persistQuizVectors{sync} — the replayed-input invariant is untouched). New `#qz-academics` step (badge "Step 2 of 3"; sharpen now "Step 1 of 3", post-signup resume badge "Step 3 of 3 · Optional") runs after sharpen in BOTH the post-signup flow (`qzShowAcademicsStep` after qzShowSharpenStep) and the #sharpen standalone; new `quiz.html#academics` direct entry; portal's 'academics' action retargeted there (was dashboard.html?academics=open). hub-academics.js AND hub-refine.js removed from dashboard.html (refine's only dashboard consumer was academics' recompute; FWHubRefine.ensureEmbedCss now exported and academics injects supplemental `hra-embed-css` for textarea/GPA/upload widgets). The topbar `#hub-refine-slot` remains, empty.
- **Motion pass 2 (flightway-pages.css + hub-dashboard.css).** Roadmap `#roadmap-head`/`#roadmap-body` and `.coach-shell` get the same reveal-gated rise-in the portal has; tactile press feedback: `.qz-btn` hover lift/active squash + primary hover shadow, `.coach-send-btn`/`.app-nav-tab` active squash, `.hub-hud-btn` hover lift + active squash. All transform-only, all reduced-motion guarded.
- Busters 20260717d: flightway-pages.css (auth/career/coach/portal/profile-build/roadmap/simulation/quiz), hub-dashboard.css + hub-canvas.js + hub-dashboard.js (dashboard), portal.js + page-veil.js (portal), roadmap.js + page-veil.js (roadmap), coach.js + page-veil.js (coach), quiz-app.js + hub-refine.js + hub-academics.js + coach.js (quiz).
- Verified: node --check all touched JS; test:vectors PASS; hub:verify; pages:smoke + hub:smoke against a local http-server; 19-assert Playwright probe (portal/roadmap veil lifecycle incl. fw-settled, hub wheel-zoom repaint + hard zoom-out spin clean, quiz#academics mount/commit → fw_hub_academics_v1 + quiz.academics mirror + hub redirect, sharpen→academics chaining) — ALL PASS; academics step screenshot eyeballed.
- NOT done: signed-in live run of the full post-signup sharpen→academics→resume flow; hand-feel QA of the zoom constants (taste-tune ZOOM_SENSITIVITY 0.0022 / ZOOM_GLIDE 0.38 if Jacob wants it faster/slower).

## Pillar W web grounding + Resume Builder v3 + Mock Interview (2026-07-17 PM2, Jacob_Work)

Built per docs/RESUME_AND_INTERVIEW_MASTERPLAN.md + docs/PILLAR_W_WEB_GROUNDING_DESIGN.md (both committed).

- **W0 — `functions/_lib/gemini-grounded.js`:** `researchWeb` (grounded google_search call, primary model only, 12s timeout, 1 retry on 5xx) + `groundedJson`/`groundedText` wrappers that fence the brief as DATA and delegate to the UNTOUCHED `callGeminiJson`/`callGeminiText`. Global KV cache `gw:q:<sha256(query)>` (TTL tiers `GROUNDING_TTL`), daily budgets `gw:budget:global:<day>` + `gw:budget:user:<key>:<day>` (defaults 300/25, env `GROUNDING_USER_DAILY`/`GROUNDING_GLOBAL_DAILY`; cache hits spend nothing; live fetch spends BEFORE the call). `GROUNDING_ENABLED` flag: off/over-budget/empty-research paths pass the caller's original opts through byte-identically (asserted by test, not just claimed). Sanitizer strips code fences/`===` runs/role-markers/special tokens/control chars, caps 800-per-source-title/3000 aggregate. `npm run grounding:check` (scripts/test-grounding.mjs, mocked fetch+KV): byte-identical flag-off, injection containment, cache dedupe, budget stop, sanitizer, no-KV refusal — 9 asserts.
- **Ground truth correction vs master plan §0D:** chat.js and career-analysis.js ALREADY had bespoke google_search grounding (GEMINI_USE_SEARCH knob). Treated as legacy: flag OFF preserves it exactly; flag ON routes through the governed layer.
- **W1 — baked knowledge floor:** `functions/_lib/career-family.js` (14 families, `resolveCareerFamily` from slug sector-keys → SOC major group → name keywords), `resume-formats.js` (per-family profiles + template variants incl. `latex-onepager` for finance/software/engineering/consulting/research + `resumeRubricBlock` action-verb/quantify/never-invent rubric), `interview-playbooks.js` (per-family structure/mix/technical archetypes, 6 `INTERVIEW_METRICS` with 1/3/5 behavioral anchors, personas Maya-coach / Elliot-pressure). `npm run resume:format-check`.
- **Resume v3 (R0-R4):** donor files ported (resume.html + resume-page.js + resume-render.js + fflate-lite + resume-doc/resume-tailor/resume-schema/sim-sanitize + migration 0011 + ats/tailor tests) and reconciled to current base (2-arg originFromEnv, favicons/veil/page-veil, current busters, career-target wiring, no fw-tabbar). `functions/resume-builder.js` UNION merge per §0B: kept flightway freeText/incremental/dossier-coordinates/timeouts/180d saved-doc, added igor simTrials (shared `_lib/sim-sanitize.js`)/artifacts/`sim_trial` evidence + phantom-sim-role filter; EVIDENCE now {resume,dossier,artifact,experience,sim_trial} (schema + client SRC_VALUES extended). Igor's 7d generation cache deliberately NOT adopted (incompatible with incremental regeneration; saved-doc + 15/day cap is the cost control). R2 wording engine: rubric in draft prompt + best-effort critique-and-tighten second pass emitting `questions[]` (gap-question loop; never invents numbers) + optional grounded recruiter-emphasis brief (SEMI_STABLE, per-career global cache). All source blocks fenced (`fenceData` strips ===). Sonnet built: /resume-format endpoint, template picker behind <details>, project-forward variant, toLatex export, portal card → launcher (old inline resume-builder.js retired), suggest-panel facts box + questions + "as of" provenance.
- **WA — Marco:** chat.js needsWebSearch still gates; flag ON swaps single-call search → `researchWeb` (VOLATILE TTL, budgetKey=user) + fenced evidence appended to the system prompt + `grounded/groundedSources/groundedAt` in the payload; flag OFF byte-identical legacy. Same pattern in career-switch-chat.js via new shared `looksLikeCurrentFactQuery` heuristic (SEMI_STABLE). Provenance chips ("Current as of <date>" + links, DOM-built escaped) in coach.js + portal-career-advisor.js.
- **Mock interview (I0-I3):** migration 0012 interview_sessions (email-keyed, scores_json + debrief_json). `functions/_lib/interview-core.js` (pure, tested): 8-slot plan (intro → playbook behavioral/technical mix → candidate-questions), client-held transcript (sim-mirror pattern), `fenceText` on resume/company/transcript, deterministic `nextDifficulty` (±1 on ≥4/≤2, guarded against Number(null)=0), debrief `overall` computed server-side (technical ×1.25 when asked, forced 'N/A' otherwise). `functions/mock-interview.js`: premium gate, 3 sessions/day (spent on first turn only), 30/IP rate limit, turn ≤500 tokens 18s, debrief 25s, history capped 50 rows, company mode research via Pillar W (SEMI_STABLE — one fetch serves every student prepping that firm). `npm run interview:check` (7 asserts incl. injection probe + difficulty monotonicity). Sonnet rebuilt interview-mode.js: setup (persona cards, low-emphasis company <details>, resume auto-pull via /resume-doc + FWResumeRender.toPlainText) → chat interview → debrief meters + SVG metric-log chart from GET history.
- **WB:** career-analysis's two legacy grounded fetches now (flag ON) globally KV-cached per career (`gw:ca:metrics:` 7d / `gw:ca:context:` 14d) + spend the shared budget (new exports `groundingBudgetAllows/Spend`); roadmap-generate first attempt, weekly-plan-gen, stretch-fits adopt groundedJson (SEMI_STABLE, 6s research timeout, softFail preserved). **sector-fit-sheet.js deliberately NOT grounded** despite Tier-B listing: it patches sector vectors and web text must never steer a vector write (design doc §5 top invariant beats the tier table). **WC = no code change:** Tier C stays default-ungrounded, which per the opt-in architecture means zero call-site changes; sim/vector paths untouched.
- **Also:** `_redirects` + .gitignore now block igor_work_2_repo/ + the brief files; resume.html + coach.html added to pages:smoke; interview flashcard endpoint functions/interview-prep.js left in place (old UI gone; endpoint unused but harmless — candidate for later removal).
- **Jacob's ship-time actions (master plan §8):** (1) `npx wrangler d1 execute flightway-db --remote --file=migrations/0011_resume_builder.sql` then `--file=migrations/0012_interview_sessions.sql`; (2) to turn grounding ON: confirm the Gemini key has Grounding with Google Search billing enabled, then set `GROUNDING_ENABLED=true` (KV: reuses COACH_KV, prefix `gw:` — nothing to provision); budgets via `GROUNDING_USER_DAILY`/`GROUNDING_GLOBAL_DAILY` (defaults 25/300); (3) flag off = today's exact behavior (legacy chat/career-analysis search included), zero new web cost; (4) smoke resume.html + coach.html interview + Marco sourced answers as a premium account.

## Performance revamp + dead-weight cleanup (2026-07-18, Jacob_Work, code tip @ cff9f10)

Executed `docs/PERFORMANCE_REVAMP_MASTERPLAN.md` (now archived to `docs/archive/`) in one pass. Baseline was `c0fcc16` — exactly the commissioning commit, so no findings needed re-anchoring. Green baseline + 56-shot screenshot baseline captured before Phase 1; screenshot diff after each hub phase and a full 56-shot diff at the end — every page visually identical to baseline modulo twinkle/greeting animation noise. This was a when/how-often-things-compute pass only: no change to what any hub frame computes, to camera-math semantics, zone data, the vector pipeline, or any save/merge endpoint.

- **Phase 0 — `c3163d9`:** committed the pending `scripts/verify-hub-lod.mjs` sync (mirrors the landed overview bottom-safe-zone + 0.7×-fit zoom-floor + viewport-normalized fit math). Green: hub:verify, test:vectors, pages:smoke, hub:smoke.
- **Phase 1 — `190444e` (F5/F6/F8):** dashboard.html preload stamps for careers.json + zone-layout.json were `?v=…c` while runtime fetched `…f` (dead cache key → ~430KB wasted + refetched on the hub critical path) → aligned + lockstep comment. `hub-canvas-bg.js`: memoized the `getComputedStyle`-per-frame bg color (invalidated on the window `flightway-theme-change` event — dispatch is on window, not document) + draw the ~600-dot grid in one path/one fill. Hub window-resize routed through the existing 80ms visualViewport debounce. Live-verified (preload URLs 200, dot-batch pixel-identical).
- **Phase 2 — `e699a19`:** deleted dead `functions/simulation-generate.js` (inert stub) + `functions/quiz-enrich.js` (only the sector-fit-sheet display label survives); marked `functions/interview-prep.js` DEAD in-comment but KEPT (the free/paid merge inventory names it). `git mv`'d 16 completed-work docs into `docs/archive/` (living docs stay in `docs/`). Live: quiz-enrich POST 400→405, archived docs 302.
- **Phase 3 — `eabb8c5` (+ empty-commit re-trigger `3c26657`):** the #1 finding — sector mode rebuilt `buildBalancedSectorLinks` (O(n²) + degree maps + per-node distance sorts) EVERY frame. Cached the link graph keyed by `(activeZone, renderCareers.length)`, returning a STABLE array reference; invalidated on sector entry, overview reset, derived-row append (next to the existing overview-layer invalidation), and `notifyVectorsUpdated` (fit-band → edge colors). Canvas cluster-backdrop union-find membership cached on that array's reference identity; each edge's blended glow RGB memoized on the (stable) edge object (alpha/width still read fit live); mountedIds Set rebuilt only on set change. hub:verify `balanced links=159` unchanged; sector screenshot pixel-identical; satellite tether proven independent of `similarityLinks`. NB: the first Phase-3 build stalled on Cloudflare (its own deployment subdomain 404'd while esbuild-minify + node --check passed locally); an empty commit re-triggered a clean build in ~40s. Watch for this if a push's stamp doesn't go live within a couple minutes.
- **Phase 4 — `cff9f10` (F2, HIGH RISK):** sector mode kept the rAF loop alive unconditionally (a full 60fps scene repaint while idle). Gated the continuation on real liveness — hover-radius springs, gold shimmer, a satellite bloom mid-spring (new `FWHubCanvasRender.satBloomActive`, set from the existing 0.004 spring threshold), or pointer-on-canvas — and cleared `needsRedraw` in sector so the loop can park. Safe because every discrete sector-visible change already re-arms via `requestHubRedraw` (overview already parked, so those calls all exist; audited pointer/leave/wheel/camera/panel/lens/search/vectors/theme/resize). **Live-verified via instrumentation on flightwayjacobprototype.pages.dev:** sector renders 0 frames over 1.2s idle+pointer-off (vs ~72 before), re-arms on pointer-on-canvas (rAF +1176), and a `flightway-theme-change` event while parked triggers exactly 1 synchronous render then re-parks — no stale frame.
- **Phase 5 — SKIPPED (plan marks it optional/highest-complexity/revert-prone):** overview pan/zoom transform-blit (F4). Phases 1+3+4 already remove the worst costs and F6 batched the overview dot grid; the residual F4 cost is transient overview-motion only. Available as a future optimization if that motion cost is ever measured to matter — implement as a `setTransform` blit of the cached `overviewLayer` during motion with a crisp re-render on settle, and revert wholesale on any label-ghosting/seam/twinkle-misregistration artifact.
- **Phase 6 — F7 NOT SHIPPED; verification-only checks all clean (no commit).** The F7 finding (data-field.js "burns while scrolled out of view" → IntersectionObserver) is contradicted by the repo: `#fw-data-field` is `position: fixed; inset: 0` (full-viewport, never scrolls out) with `--canvas-opacity` always 1, so an IntersectionObserver on it always reports visible = a no-op. Implemented then reverted rather than ship a no-op plus 5 pointless cache-buster invalidations; the existing tab-visibility pause already covers backgrounded tabs. Verified clean: `interview-mode.js:402` + `sim-engine.js:797` setIntervals are cleared on teardown (`:406` / `:381`); `roadmap-tree.js` rAF parks on `!displayPctAnimating`; `quiz-app.js` particle rAF self-terminates (`alive`) + is cancelled at teardown; all other rAFs are one-shots/time-bounded. No ungated continuous loop remains besides the now-gated hub sector loop and the by-design budgeted overview twinkle.

**`pricing.html` intentionally untouched** (per merge-plan constraint): its `data-field.js` stamp stays `…703p` — unrelated to the reverted F7, just not bumped because I don't edit that file.

**Open manual items carried forward from `PRODUCTION_LAUNCH_REVIEW.md` (now archived — still Jacob's to do):**
- Probe account `fwpivotprobe716@gmail.com`: delete or rotate its password (was publicly readable); old per-deployment `<hash>.pages.dev` URLs still serve historical snapshots of the once-leaked doc.
- Cron `SITE_URL` fix (`c434e5e`) needs `npm run deploy:cron` to take effect + its secrets (RESEND_API_KEY, FROM_EMAIL, UNSUB_SECRET matching the Pages project, MAILING_ADDRESS).
- `og:image` needs a real 1200×630 asset; footer Privacy/Terms links point to `#` (no legal pages — the app collects emails/passwords/resumes).
- Cloudflare Pages env-vars to confirm/set: GEMINI_API_KEY, RESEND_API_KEY, SITE_URL, FROM_EMAIL (Resend-verified domain), UNSUB_SECRET, INTENT_PEPPER, MAILING_ADDRESS; PAYWALL_ENABLED stays unset/false.
- Confirm applied D1 migrations match the repo (through 0010, plus 0011_resume_builder + 0012_interview_sessions from the resume/interview build).

**REQUIRED:** The free/paid merge plan (`docs/FREE_PAID_MERGE_MASTERPLAN.md`) was written against a pre-revamp commit history — re-verify its repo-state claims against current `git log` before executing it.

## Coordinate-Gap Opportunity Finder (2026-07-18/19, Jacob_Work)

Built per `docs/OPPORTUNITY_FINDER_BUILD_PLAN.md` (v2, committed with this pass) — premium-only "Opportunities for you" panel in roadmap.html's focus view, next to the skill-gap tracker. Grounded (Pillar W) course/competition/fellowship/student-org matches for the top-6 O*NET gaps.

- **`functions/opportunities.js`:** GET = mock-interview-style gate (401 / 402+upgrade / 30-per-IP rate limit) → loadQuizProfile+loadRoadmap → gaps from `focusTracker.skillGaps` (≤6) → per-user KV cache `oppfind:v1:{email}:{soc||slug}:{dimIndexes}:{school}` TTL 86400 (key embeds career/gaps/school = automatic invalidation) → miss: 3 parallel `researchWeb` calls (career+gap-only query text → shared `gw:q:` cache; budgetKey=email, VOLATILE TTL, 8s) → all-null → empty shape with NO shaping call (`groundedJson` deliberately not used: its ungrounded fallback would be a paid call decision #4 discards) → else one `callGeminiJson` (softFail, 20s, label `opportunity-finder`) over evidence + `loadDossierWithCoordinates` + gap table. POST `{school}` = server-side read-modify-write via `saveQuizProfile` (client sync merges with the SERVER copy as base and drops local-only keys, so a localStorage-only school would be wiped; §3 of the plan). `shape-failed` responses are NOT cached (research already in gw:q:, retry is cheap).
- **`functions/_lib/opportunity-core.js`** (pure, unit-tested): url must be https AND origin ∈ research sources else dropped (decision #4 enforced in code); `impactTier` deterministic (model supplies only directness: direct&&gap≥18→high, either→medium, else low — decision #3, no numbers anywhere); deadline ISO YYYY-MM-DD or null, never invented; gapLabel must match a real gap; rank tier→gap-desc, cap 8.
- **Client `assets/js/app/opportunity-finder.js` + `assets/css/opportunity-finder.css`:** `FWOppFinder.mount(panel, tree)` called from roadmap.js `renderFocusPanel()` right after `renderFocusView` — which rebuilds the focus view's innerHTML on EVERY persist, so mount is idempotent-by-reappend into `.roadmap-focus-inner` and re-renders from module-state cache (one fetch per career key; the UI probe asserts exactly 1 GET across re-renders). `authFetch` with `timeoutMs: 60000` (30s default < worst-case 3×8s research + 20s shaping). States: skeleton → list / clean empty ("No live opportunity matches right now") / gate. On 402 with `FWEnt.gate()` no-opping (paywall dark), the same `.fw-ent-gate` CTA markup is rendered directly. All text through `esc()`; https re-checked before href; `target=_blank rel=noopener`. `.oppf-asof` "Opportunities checked as of {date}" (own CSS class — portal's `.fw-fp-asof` isn't loaded on roadmap). School input in the panel footer: POST → mirror `FWAuth.writeLocalQuiz` → re-GET (school-bearing KV key = true miss). Entrance via `body.fw-revealed:not(.fw-settled)` convention.
- **Zero vector side-effects:** never touches `gap-progress-sync.js` / `objectiveVector` / `objectiveAiPatch`; `test:vectors` green with zero diffs. `skill-gap-tracker.js`, portal files, wrangler.toml, migrations untouched. `school` is a JSON key in the quiz payload — NO migration.
- **Touched:** roadmap.js (one mount line, buster →20260718c), roadmap.html (two new asset tags @20260718a), package.json (`test:opportunities`). New scripts: `scripts/test-opportunities.mjs` (14 asserts: origin-match, tier math incl. gap=18 boundary, deadline/gapLabel/type validation, dedupe, rank+cap, school hygiene, prompt shape) + `scripts/smoke-opportunities-ui.mjs` (Playwright: list/tier-chips/as-of/school-save-repersonalize/402-gate/empty-state, zero pageerrors).
- **Verified:** node --check all touched JS; test:opportunities PASS; grounding:check PASS; test:entitlements PASS; test:vectors zero failures; pages:smoke green against local http-server; handler-level grounding-off smoke (mocked D1): clean `{opportunities:[], grounded:false, reason:'grounding-off'}` + 401 unauthenticated + POST school preserves other profile keys.
- **Jacob's two ship-time actions (only he can do these):** (1) enable "Grounding with Google Search" billing on the Gemini API key (Google AI Studio / Cloud billing); (2) set `GROUNDING_ENABLED=true` in the Cloudflare Pages dashboard env vars for `flightwayjacobprototype` (not in wrangler.toml, cannot be set from code). Flipping it activates grounding for EVERY Pillar W caller (chat, weekly-plan, career-analysis, resume, mock-interview), not just this panel. Until then the panel shows its empty state — correct behavior, not a bug.

## Canonical User Object — Phases 0+1 SHIPPED (2026-07-19, Jacob_Work)

Executing `docs/USER_OBJECT_MASTERPLAN.md`. Phases 0+1 landed together in `fa182c0` (the test needs the model, so one commit).

- **Phase 0 inventory (grep-derived, authoritative):** the v1 blob has 26 root keys + nested `profile` — name, school (root, canonical — written by school.js), scores, scoresRaw, resumeSummary/resumeBoosts/resumeText, objectiveSkipped, characterSummary, customAnswers, enrichBoosts, traits, profile{year,gpa,school,schoolCity,subjects,careerLeaning}, careerLeaningSoc, sectorFitSheet, vectorSchemaId, personalityVector, objectiveVector, objectiveAiPatch, personalityPatchFailed, profileBuilding, careerFocus, careerFocusHistory, academics, academicsTranscript, refine, portalSnapshot. `vectorFit`/`vectorFitPercent`/`personalityPatch`/`objectiveSynced` are request/response-only fields, NOT blob fields (verified against writers).
- **`functions/_lib/user-model.js`** — pure; `KEY_MAP` is the v1↔v2 spec. School's two v1 homes (root beats `profile.school`) coalesce on normalize; denormalize mirrors a non-empty school to BOTH homes (the one deliberate round-trip asymmetry — an addition, never a loss). Unknown root keys pass through; unknown `profile.*` keys ride in identity; group-name collisions park under `_legacy`.
- **`functions/_lib/user.js`** — `loadUser(env,email,{quiz})`/`saveUser`/`updateUser`/`userPromptContext` (includes `schoolPromptBlock`); lazy `auth.js` import (cycle-free).
- **`assets/js/shared/user.js`** — `FWUser` IIFE; KEY_MAP + normalize/denormalize duplicated VERBATIM from user-model.js (repo has no client/server sharing mechanism; test:user diffs both maps AND normalize outputs, so drift fails CI-style). `FWUser.update()` writes via `FWAuth.writeLocalQuiz` + fires `uploadLocalQuizIfPresent` (hash-guarded GET-merge-PUT keeps field-preservation semantics). Script tag (`?v=20260719a`, defer, right after auth.js) on all 10 auth-loading pages.
- **`npm run test:user`** (`scripts/test-user-model.mjs`, 17 asserts) + 3 fixtures `scripts/fixtures/user-v1-{fresh,resume,tenured}.json`. Verified: test:user PASS, node --check ×3, live curl (asset 200, dashboard references stamp), pages:smoke green post-deploy.
- **Next:** Phase 2 Wave A (school+identity consumers). Storage untouched so far — no consumer migrated yet, facades are load-only.

## Canonical User Object — Phase 2 (Waves A–F) SHIPPED (2026-07-19, Jacob_Work)

All ~40 consumers migrated in six verified waves: A `ab66e03` (school+identity), B `3e67adb` (vectors — fragile), C `ef7384f` (assessment/fit), D `6b0a4d2` (focus/roadmap), E `de3d1a1` (long tail + v2 emission), F (guard, this commit). Every wave: suites green pre-push, deployed via Jacob_Work, live-curled + pages:smoke + hub:smoke.

**The architecture that emerged (two doors, one owner):**
- Consumers with *localized* field reads use the v2 shape (`user.identity.school`, `user.vectors.objective` via `FWUser.get()`/`loadUser`).
- Transformer-heavy modules (onet-vectors hydration, sector-fit-sheet, the patch modules, resume-parse chain, profile-alignment) keep their v1 *working shape* but get storage ONLY through the blob view: client `FWUser.getBlob()/putBlob()`, server `loadUserBlob()/saveUserBlob()`. Phase 4 flips storage inside those four functions; no consumer changes.
- `FWAuth.readLocalQuiz/writeLocalQuiz` now delegate to FWUser (scores-check + ensureSectorFitSheet preserved on top); `FWAuth.HUB_QUIZ_KEY` export dropped.
- **Deviation from plan (repo won):** `qzBuildHubPayload` keeps its v1 internal shape — the quiz's transformer chain (`ensureSectorFitSheet`, `attachVectorsToPayload`) contracts on it. v2 crosses at the *emission boundaries*: the `#r=` dashboard token and the register slim payload are normalized to v2 at send; `readQuizStateFromUrl` + `auth/register.js` + `PUT /profile/quiz` + `vector-fit` accept both shapes.
- **Inventory fix found mid-flight:** `profileAlignment` (written by `ensureProfileAlignmentMeta`) was missing from Phase 0's census → added to both KEY_MAPs (`journey.profileAlignment`) + tenured fixture.
- **Wave F guard:** `npm run verify:user` fails on any `fw_hub_quiz_v1`/`HUB_QUIZ_KEY`/`loadQuizProfile`/`saveQuizProfile` in `assets/` or `functions/` outside the 4-file facade layer (user.js client+server, user-model.js, auth.js). Stricter than planned: quiz-app needed no exemption. `scripts/`+`docs/` exempt (harnesses seed storage).
- Load-order traps fixed on quiz.html (its script order differs from every other page): user.js must precede hub-refine/hub-academics (their seed IIFEs read identity at execution time). Order is now user → refine → academics; hub-careers earlier is safe (its storage reads run at init-call time, not exec).
- Run `verify:user` in the same breath as `test:vectors` from now on.

## Canonical User Object — Phase 3 SHIPPED (2026-07-19, Jacob_Work): generalized dossier↔user sync

`functions/_lib/user-sync.js` — the school.js two-store model generalized to a FIELD registry: `identity.school→school:`, `identity.year→year:`, `identity.gpa→gpa:`, `identity.subjects→subjects_major:`, `identity.careerLeaning→career_leaning:`. One sync direction each, per field: dossier→user ONLY via `syncUserFromDossier` (called from `saveDossier`, best-effort, ONE profile save for all changed fields); user→dossier ONLY via `setUserField` (writes store first, mirrors line; the mirror's saveDossier re-enters the sync which no-ops — the no-bounce pattern). Placeholders never overwrite real values. Per-field sanitizers (`cleanYearValue` w/ first-year→freshman aliases, `cleanGpaValue` 0–4.33 Number, `cleanSubjectsValue` 8×60 list, `cleanLeaningValue`) all build on `sanitizeSchoolName` — these values reach Gemini prompts as data.

- **school.js keeps its exports, now delegates:** `setSchool` → `setUserField('identity.school')`, `syncSchoolFromDossier` → `syncUserFromDossier({only:[school]})`. `resolveSchool` keeps its dossier-fallback-adopt logic. test-school 13/13 still green.
- **Pipeline edits for the new lines:** `buildSeedDossier` emits `year:`/`subjects_major:`/`career_leaning:` (and `quizProfileToSeed` now supplies gpa/year/subjects/careerLeaning from the normalized identity — seed gpa was '(unknown)' before on the quizProfile path); `FIELD_PREFIXES` in dossier-parse.js gained the three lines; the dossier-merge prompt's rule 6 (school) now also names year/subjects_major/gpa/career_leaning with "add the missing line above recent:" — old dossiers gain lines when a fact is stated, new ones carry them from seed.
- **Prompt audit conclusion:** every dossier-reading surface (chat, roadmap chats, career-switch, coordinates digest consumers) inherits the new identity lines automatically via the dossier text — no per-prompt wiring needed. `userPromptContext(user)` (in _lib/user.js since Phase 1) remains for non-dossier prompts; `schoolPromptBlock` unchanged (it is a constraint, not just a fact).
- **`npm run test:sync`** (scripts/test-user-sync.mjs, 12 asserts): per-field hygiene, seed/parser line parity, "I'm a junior now" lands in identity.year, placeholder-never-overwrites, one-save multi-field sync, no-op on agreement, setUserField mirror + re-entrant no-bounce, full saveDossier chain.
- Known pre-existing quirk (out of scope, noted): `identity.gpa` is quiz-time static while `focus.academics.gpa` is the living value from the academics panel — two gpa homes predate this work; the registry syncs the identity one.

## Canonical User Object — Phase 4 SHIPPED (2026-07-19, Jacob_Work): storage migration. PLAN COMPLETE.

**D1:** migration `0013_user_profiles.sql` applied to remote `flightway-db` (email PK, payload, updated_at; `INSERT OR IGNORE...SELECT` backfill — plain `INSERT...SELECT ... ON CONFLICT` is a SQLite parse error, the OR IGNORE form isn't). Backfill verified 37/37 rows. **The 0011/0012 pending-migrations trap was REAL** — both were still unapplied on remote; applied together with 0013 (pure CREATE IF NOT EXISTS, safe; this also closes the launch-review "confirm migrations" manual item). `quiz_profiles` stays frozen one release as rollback; a later `0014` drops it.
- `auth.js` now owns `loadUserRow`/`saveUserRow` (user_profiles; loadUserRow falls back to quiz_profiles for rows written between backfill and deploy). `loadQuizProfile`/`saveQuizProfile` are deprecated v1-view aliases over the NEW table (denorm(norm) on read, norm on write) — internal callers (saveQuizPortalSnapshot) keep working; verify:user bans new external callers. `saveUser` writes **v2 natively**; rows upgrade lazily on next save; `loadUser` normalizes v1 rows forever.
**Client:** storage key is `fw_user_v1` holding the v2 user. One-time boot migration in user.js (runs at script execution, before any consumer): fw_user_v1 absent + fw_hub_quiz_v1 present → normalize → write. Old key left in place one release; a later commit deletes it on boot. getBlob/putBlob keep their v1-view contracts (conversion inside the facade — no consumer changed); FWUser.update writes v2 directly.
**Test doubles updated for the new shape:** test-school/test-user-sync fakeEnv captures `INSERT INTO (user_profiles|quiz_profiles)` and assertions read stored rows through a `v1View()` (denorm∘norm) helper; test-vectors seeds/reads via FWUser.putBlob/getBlob; test-user-model gained a boot-migration test (seed legacy → facade promotes → legacy kept for rollback).
**Follow-ups deliberately left:** (1) a later `0014_drop_quiz_profiles.sql` after one clean release; (2) a later client commit deleting fw_hub_quiz_v1 on boot; (3) old-tab divergence during rollout is reconciled by the server GET-merge-PUT path (by design).

## User-object deferred cleanup LANDED (2026-07-19, Jacob_Work @ 4a67613 + 2b1e15a) — masterplan fully closed

All three "follow-ups deliberately left" from Phase 4 are now resolved (item 3 was by-design, no action).

**D1 (`4a67613`):** `0014_drop_quiz_profiles.sql` applied to remote. Pre-drop verification: no pending migrations ahead of 0014; 37/37 rows in both tables, 0 emails missing from user_profiles, 0 rows with newer updated_at in quiz_profiles — the frozen table held no unique data, so the drop lost nothing. `loadUserRow`'s transition-window fallback read and the `loadQuizProfile`/`saveQuizProfile` aliases are gone; `saveQuizPortalSnapshot` now works in v2 space (`setPath('journey.portalSnapshot')`). **Bug found in passing and fixed:** `account.js` USER_TABLES still listed quiz_profiles and never gained user_profiles — account deletion was leaving the canonical profile row behind since Phase 4 (and would have 500'd on the dropped table). verify:user ALLOWED is trimmed to `assets/js/shared/user.js` + `user-model.js`; auth.js and the server facade are now under the guard.

**Client (`2b1e15a`):** boot migration deletes `fw_hub_quiz_v1` after successful promotion, and clears an orphaned legacy copy when `fw_user_v1` already exists. The legacy key survives only when it is the sole copy and promotion failed (corrupt JSON / full storage). Buster `shared/user.js?v=20260719f` on all 10 referencing pages. test-user-model asserts the key is GONE in both paths (promotion + orphan-clear with existing v2 untouched).

Verified: test:user, test:vectors, verify:user, test:school, test:sync, pages:smoke, hub:smoke all green; live curl confirms 20260719f served.

## Two-GPA quirk CLOSED (2026-07-19, Jacob_Work) — one GPA, two v1 homes

Closes the Phase 3 "known pre-existing quirk": `identity.gpa` (quiz-time, written once at `quiz-app.js` completion) vs `focus.academics.gpa` (what the academics panel edits and what the vector GPA boost reads). They were two live fields — the dossier sync registry wrote the first, the panel wrote the second, and neither told the other.

**Resolution — the school two-homes pattern, applied to GPA (`user-model.js` + the verbatim client copy in `shared/user.js`):** `identity.gpa` is the single v2 field. New KEY_MAP row `['academics.gpa','identity.gpa']` listed BEFORE `['profile.gpa','identity.gpa']`, so a panel-edited GPA wins and the onboarding value fills in only when the panel never set one; `normalizeUser` then strips the academics copy (v2 holds exactly one GPA); `denormalizeUser` writes the canonical value back to BOTH v1 homes. Two deliberate round-trip asymmetries now (school, gpa) — `withMirrors()` in test-user-model encodes both.

- **Pre-merge v2 rows migrate on read:** `normalizeUser(v2)` adopts a leftover `focus.academics.gpa` into `identity.gpa` and drops the key (idempotent). Without this, the first read after deploy would have overwritten every existing user's panel GPA with their onboarding value.
- **Blank GPAs are never fabricated:** `gpaTierBoost` reads `Number(null) === 0` as a real GPA and boosts +2, so the mirror only creates an academics object when the GPA is non-blank.
- **Behavior change, deliberate:** a student who never opened the academics panel now gets the GPA tier boost in their objective vector (their quiz GPA finally reaches `applyAcademicsToObjective`). Client and server rebuilds take the same coalesced input, so the two stay in agreement; the boost is recomputed from inputs, never accumulated.
- **New writer, and why it is required:** the panel edits the GPA through `PUT /profile/quiz`, not an explicit set — so a dossier line still holding the onboarding value would be synced back over the edit on the *next dossier write* (any chat message). `mirrorFieldsToDossier(env, email, user, {only:['identity.gpa']})` in user-sync.js is the dossier half of `setUserField`, callable alone; the PUT handler runs it via `context.waitUntil` (best-effort, never fails the save). GPA is the only registry field that needs it — every other identity field comes back from the server on the client's GET-merge-PUT, so a client blob cannot change it.
- `profile-alignment.js`'s ad hoc "prefer academics.gpa, fall back to profile.gpa" patch is deleted — in any v1 view the two homes are now equal by construction.
- Readers confirmed unchanged and now live: `stretch-fits.js:64`, `onet-vectors.js:1650` + `resume-map.js:274` (the boost), `auth.js` `quizProfileToSeed`, `user.js` `userPromptContext` (still uncalled — kept for non-dossier prompts), `hub-academics.js` seed prefill.

Verified: test:user (6 new GPA cases), test:sync (3 new — incl. "a panel-edited GPA survives the next dossier write"), test:vectors, test:school, verify:user, pages:smoke, `node --check` on every touched file. Buster `shared/user.js?v=20260719g` on all 10 referencing pages.

---

## 2026-07-19/20 — Free/paid merge, §7 phases 1–5 (`cd74d79..2a69ff6`, `Jacob_Work`)

`docs/FREE_PAID_MERGE_MASTERPLAN.md` phases 1–5 executed straight through. `PAYWALL_ENABLED` stayed `false` and Stripe stayed test-mode-only for the whole run, per §7. Steps 6–7 (paywall flip, beta grandfathering, `main` cutover) are untouched and still need Jacob live.

- **New primitives.** `functions/_lib/plan-limits.js` holds one `FEATURE_LIMITS` table (`marco-chat` 5/day free, `roadmap-generate` 1/lifetime free, `mock-interview` 0 free / 3 per day paid) and `checkFeatureLimit()`, the generalized form of the atomic `COACH_KV` counter `mock-interview.js` pioneered. **The `mockivday` key prefix is load-bearing** — renaming a live prefix hands every existing user a fresh allowance. `checkFeatureLimit` fails **open** when `COACH_KV` is unbound, and resolves the plan through `resolveEntitlement`, so with the paywall dark everyone is `premium` and the only counter that touches KV at all is the mock-interview one (zero added cost today).
- **`isDevTester(env, email)`** is wired at exactly three chokepoints — `resolveEntitlement`, `requirePlan`, `checkFeatureLimit` — each ahead of any D1/KV read, and `requirePlan`'s check sits **before** the paywall flag so `dev:true` is marked even while dark (`waitlist-intent.js` depends on that to keep dev clicks out of `pricing_intents`). Inert until `DEV_TEST_EMAILS` is set per-environment in the Pages dashboard; never committed.
- **Stripe, no SDK.** `functions/_lib/stripe.js` is raw `fetch` + `crypto.subtle` HMAC, pinned to `Stripe-Version: 2024-06-20` — **do not bump that pin casually**: `current_period_end` moved off the subscription root in later API versions and `subscriptionGrant()` reads it. Every "what does this payment grant" decision is a pure function (`lifetimeGrant`/`sprintGrant`/`subscriptionGrant`) so `stripe:check` proves the money paths with no network and no D1. `past_due` deliberately does **not** downgrade; expiry carries a 3-day `RENEWAL_GRACE_DAYS` so a dropped renewal webhook degrades instead of locking out a payer. The webhook **claims** an event id in `stripe_events` before handling and **deletes it again if the handler throws**, so duplicates no-op but genuine failures still retry.
- **Migration `0015_stripe_billing.sql` is APPLIED to remote D1** (`users.stripe_customer_id` + `stripe_events`). Additive and inert for `main`, which shares the same database.
- **Gate placement that matters.** In `career-roadmap.js` the one-free-generation meter sits *after* the cached-roadmap early return, so re-opening a roadmap never spends the allowance. In `chat.js` the sidecar's premium gate sits *after* `tryDeterministicRoadmapPatch`, so checking a step off stays free while AI rewrites do not. The sim deep tier is a **client-only** gate (`deepTierEntitled()`) — there is no per-tier server endpoint to enforce on; the Gemini surfaces it uses are per-user rate-limited already.
- **`FWEnt.lock()` vs `FWEnt.gate()`:** `gate()` re-checks `has()` locally; `lock()` renders unconditionally. Use `lock()` whenever the **server** already answered with `upgrade:true` — a local re-check there just races the entitlements boot. One lock style everywhere (`.fw-ent-gate`, plus `.fw-why-locked` for the why-this-match teaser).
- **Deferred-script trap, hit for real:** `pricing.html`'s inline script runs at parse time, *before* deferred `billing.js`. Resolving `window.FWBilling` there silently made every CTA fall back to the fake door. Fixed by resolving at `DOMContentLoaded` (`3efed1c`). Any future inline script on that page must do the same.
- **The weekly cron** now filters recipients with `effectivePlan` (not raw SQL), because `notify_optin` rows predating the gate would otherwise still be mailed after the flip.

Verified: `test:entitlements` (now 47 assertions incl. dev-allowlist + every feature-limit case), new `stripe:check` (40 assertions incl. forged/tampered/stale/rolled signatures and a mocked webhook run per SKU), `test:vectors`, `verify:user`, `test:user`, `test:school`, `test:sync`, `test:opportunities`, `test:weekly`, `hub:verify`, `verify:aliases`, `onet:test`, `grounding:check`, `interview:check`, `resume:format-check`, `resume:ats-check`, `resume:tailor-check`, `node --check` on every touched file. `pages:smoke` (all 7 pages) and `hub:smoke` were run against a **local `wrangler pages dev`** build of this tree, not the live URL — see the blocker below.

**Open / blocked, for whoever picks this up:**
1. **Cloudflare's build queue stalled mid-run.** Deploys `8d35718`, `1712d11`, `89d07c1` and `5a77e666` all failed with Cloudflare's own `Failed: unable to submit build job`, and later pushes sat at `queued:active` with `initialize:idle`. This is CF-side: `npx wrangler pages functions build` compiles this tree clean, and `cd74d79` built fine 30 minutes earlier. **The branch is pushed but `flightwayjacobprototype.pages.dev` is still serving `cd74d79`.** Re-check `npx wrangler pages deployment list --project-name flightwayprototype`; re-trigger with an empty commit once CF recovers. Do **not** reach for `deploy:prototype`.
2. **The live test-mode purchase run did not happen** — partly (1), and partly because completing Stripe Checkout means typing a card number and needs a registered test account. Both are Jacob's to do. Everything up to the hosted card form is covered by `stripe:check` and by local endpoint curls (401 unauthenticated on checkout/portal, 503 when unconfigured). **Nobody has yet confirmed the `STRIPE_*` Pages vars are actually set on the prototype** — `GET /config` reports `stripeEnabled`/`stripeTestMode` and will answer that the moment a build lands.
3. Artifacts/portfolio resurfacing left dark (§9's default: fast-follow).
4. Every §1 number is a named constant in `plan-limits.js` — retuning is a one-file change.
