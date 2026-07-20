# Coordinate-Gap Opportunity Finder — Build Plan (v2, repo-verified)

**Status: IMPLEMENTED IN FULL — archived 2026-07-19.** Shipped `b497b62`, with
post-ship fixes in `4531f49` (grounded source URLs are opaque vertexaisearch
redirects, so origin-matching let wrong/404 links through — now resolved to
real destinations and exact-matched) and `ae2029c` (`school` promoted to a
single fact every AI surface reads, `functions/_lib/school.js`). Every §4 file
exists and is wired, `test:opportunities` + `smoke-opportunities-ui.mjs` are in
`package.json`, and both §8 Jacob-only steps (Gemini grounding billing,
`GROUNDING_ENABLED=true`) are done — the panel serves live matches. Kept for
the decision record in §2/§7; the repo, not this doc, is now the truth.

_Original status: approved by Jacob 2026-07-18; plan audited against the live
repo at commit `d2eb688` by a Fable planning session, every file path and
behavior claim grep-verified._

## 1. What this is

> AI surfaces courses, competitions, fellowships, and student organizations that
> specifically target the user's largest coordinate gaps relative to their target
> career vector. Each opportunity is labeled with which O\*NET dimensions it
> raises and by how much, so the list is ranked by gap-closing impact rather
> than general relevance. Includes a short "why this fits you" line tied to the
> specific gap it addresses.

This is a new consumer of existing infrastructure (skill-gap data + Pillar W
grounding), not a new subsystem.

## 2. Product decisions (binding — do not re-litigate these)

Jacob answered these explicitly; treat them as requirements, not options:

1. **Placement:** a new panel inside `roadmap.html`, next to the existing
   skill-gap readiness meter (`assets/js/app/skill-gap-tracker.js`,
   `assets/css/skill-gap-tracker.css`). No new page, no new portal card
   (portal.html is intentionally down to the Flight Plan card + compact
   readiness panel per the 2026-07-10 streamlining pass — do not add to it).
2. **Access tier:** premium ("Flight Plan") only, gated the same way as
   `mock-interview.js` / `resume-builder.js` / `resume-doc.js` / `resume-tailor.js`
   — `requirePlan(env, email, 'premium')` server-side, `FWEnt.gate()` client-side
   for the upgrade-CTA UX.
3. **Gap-impact labeling:** **qualitative tiers only** (e.g. "High/Medium/Low
   impact on Complex Problem Solving"), never an AI-claimed exact point delta
   (no "+12 points"). This mirrors why `enforceTraceableNumbers` exists in the
   resume builder (`functions/resume-builder.js`) — an AI inventing precise
   numbers for something it just found via search is a credibility risk, not a
   feature.
4. **Sourcing:** an opportunity may only appear if it came back from a live
   grounded search with a real source URL attached. If grounding is off, over
   budget, or returns nothing for a gap, that gap gets **no** opportunities
   shown (empty state), never an AI-imagined fallback program.
5. **Caching/freshness:** shared, career+gap-keyed caching for the underlying
   research (falls out of `researchWeb`'s existing query-text cache when
   queries are built career+gap-only, not per-user).
6. **Vector side-effects:** **none.** This is a read-only discovery surface.
   Do not touch `functions/_lib/gap-progress-sync.js` or write to
   `objectiveAiPatch`/`objectiveVector` from this feature. (That file is
   documented as fragile and single-writer — leave it alone.) A "log this as
   evidence" hook is an explicit non-goal for v1, not an oversight.
7. **Student orgs:** add an **optional** `school` field to the user's profile
   and personalize org matches when it's set, falling back to generic/national
   orgs when it isn't. See §6 for exactly where this goes — it's a JSON field,
   not a schema migration.
8. **Gap coverage:** cover **all** of the user's current skill gaps (up to
   `MAX_V3_GAPS = 6`, same set the readiness meter shows), each contributing
   opportunities to one overall ranked list.
9. **"Why this fits you" personalization:** full dossier-aware (resume,
   personality, activity — via `loadDossierWithCoordinates`), not generic
   career+gap boilerplate. See §4 for how to do this without blowing the
   shared grounding budget.
10. **List shape:** one flat list of the top 5-8 opportunities overall, sorted
    by gap-closing impact — not grouped into per-type or per-gap sections.
11. **UI label:** "Opportunities for you" (matches the Flight Plan card's
    existing "Opportunities checked as of..." copy in `portal-flightplan.js`).
12. **Grounding flag:** Jacob wants this shipped with `GROUNDING_ENABLED`
    flipped on as part of this work. **You cannot actually do this** — it's a
    Cloudflare Pages *dashboard* environment variable, not anything in the
    repo. Build everything behind the flag exactly like the rest of Pillar W
    (byte-identical off-path), and tell Jacob explicitly, at the end of the
    build, the two things only he can do — see §8.

## 3. Verified ground truth (audited 2026-07-18 against commit d2eb688)

All confirmed by direct read; use these signatures as-is.

- **Gap data:** `roadmap.focusTracker.skillGaps` — array of up to
  `MAX_V3_GAPS = 6` ([skill-gap-tracker.js:17](../assets/js/app/skill-gap-tracker.js)),
  each entry (built by `buildV3Gap`, line 109):
  `{ id:'dim-<N>', dimIndex, label, domain, user, vBase, target, gap, source,
  checklist, checklistSource, logs, manualComplete, status, progress }`.
  `gap` is on the 0–100 O*NET level scale (target − user at first compute),
  sorted descending. `domain ∈ knowledge|skills|abilities|workActivities`.
  Server-side read: `loadRoadmap(env, email)` in `functions/_lib/auth.js:323`
  returns the parsed roadmap payload (or null); `roadmap.targetCareerName` /
  `targetCareerSlug` are top-level fields (used by `renderFocusView`).
- **Career focus:** `loadQuizProfile(env, email)` (`functions/_lib/auth.js:290`)
  → payload with `careerFocus: { name, soc, ... }` (exactly what
  `buildCoordinateLines` reads).
- **Dossier personalization:** `loadDossierWithCoordinates(env, email)` in
  `functions/_lib/dossier-coordinates.js:58` — returns the dossier text with a
  fenced `[[coordinates]]` block (target career, fits, top-6 gaps as
  "you X vs role Y"). Read-only; nothing persisted.
- **Grounding lib** (`functions/_lib/gemini-grounded.js`):
  - `researchWeb(env, { query, freshnessTtl, timeoutMs, maxSources, budgetKey })`
    → `{ brief, sources:[{title,url}], fetchedAt } | null`. KV-cached in
    `COACH_KV` under `gw:q:<sha256(normalized query)>` — **query text only, no
    user identity** → decision #5's sharing is automatic when queries are
    career+gap-only. Returns null when flag off / no KV / over budget / fetch
    failed. Default timeout 12s, retries once on 500/503.
  - `buildEvidenceBlock(researchOrArray)` → fenced evidence string ('' if none).
  - `sanitizeWebText` — already applied inside `researchWeb`; don't re-run.
  - `groundingEnabled(env)` — truthy check on `GROUNDING_ENABLED`.
  - `GROUNDING_TTL = { VOLATILE: 6h, SEMI_STABLE: 14d, STABLE: 30d }` — use
    VOLATILE (deadlines go stale).
  - Budget: `GROUNDING_USER_DAILY` default 25 / `GROUNDING_GLOBAL_DAILY`
    default 300, enforced inside `researchWeb` per query; spend happens even on
    failed fetches.
  - `groundedJson` exists but is **not** the right entry point here — see §4
    correction.
- **Endpoint house pattern** (mirror `functions/mock-interview.js:54-62`):
  `originFromEnv/jsonResponse/preflightResponse` from `../_lib.js`;
  `getSessionEmail, checkRateLimit, clientIp` from `./_lib/auth.js`;
  `requirePlan` from `./_lib/entitlements.js`. Gate: no session → 401
  `{error:'Not signed in.'}`; `!(await requirePlan(env,email,'premium')).ok` →
  402 `{error:'…a Flight Plan feature.', upgrade:true}`.
  `onRequestOptions` → `preflightResponse(originFromEnv(env, request))`.
- **Gemini JSON:** `callGeminiJson(env, { prompt, temperature, maxTokens,
  jsonMode:true, label, softFail:true, timeoutMs })` from
  `./_lib/gemini-json.js` (see weekly-plan-gen.js:125-146 for the exact
  option shape in a grounded caller).
- **Client entitlements:** `assets/js/shared/entitlements.js` — `FWEnt.boot()`
  (memoized), `FWEnt.has('premium')` (always true while paywall ships dark),
  `FWEnt.gate(el, key)` swaps in the upgrade CTA.
- **Client auth:** `FWAuth.authFetch(path, { timeoutMs, method, body })`
  (default timeout 30s — this endpoint needs an override, see §4);
  `FWAuth.readLocalQuiz()` / `FWAuth.writeLocalQuiz(profile)` are exported
  (auth.js:1026+).
- **Provenance copy:** `portal-flightplan.js:79-81` renders
  `"Opportunities checked as of {fetchedAt.slice(0,10)}"` with class
  `.fw-fp-asof`. That class lives in portal CSS **not loaded on roadmap.html**
  — copy the wording convention, define our own `.oppf-asof` class.
- **Panel mount point (correction to v1):** the readiness meter/gap tracker on
  the roadmap page is the **focus view**: `roadmap.js:858 renderFocusPanel()`
  → `FWSkillGapTracker.renderFocusView(panel, …)` into
  `#roadmap-focus-view`, which **rebuilds `panel.innerHTML` wholesale on every
  persist** (skill-gap-tracker.js:2115+, builds `.roadmap-focus-inner`).
  There is no static markup slot in roadmap.html (`#roadmap-body` is
  JS-rendered). So the new panel must be re-appended after every
  `renderFocusView` call and must cache its data in module state so
  re-renders don't refetch.
- **`quiz_profiles` writes:** `PUT /profile/quiz`
  (`functions/profile/quiz.js`) saves the client-sent profile wholesale (after
  an objectiveVector rebuild). The client's upload path
  (`uploadLocalQuizIfPresent`, auth.js:637-683) merges **with the SERVER copy
  as the base** — only five known sections (profileBuilding, sectorFitSheet,
  vector inputs, portalSnapshot, careerFocus) are folded in from local. **A
  key set only in localStorage is silently dropped on the next sync.** This
  drives the §6 design: `school` must be written server-side.
- Scripts that exist and matter: `npm run test:vectors`, `grounding:check`,
  `test:entitlements`, `pages:smoke` (defaults to LIVE pages.dev — set
  `SMOKE_BASE_URL`), `scripts/smoke-resume-ui.mjs` (Playwright probe pattern),
  `scripts/test-grounding.mjs` (mock-fetch + in-memory-KV unit-test pattern).

## 4. Architecture (resolved — no open questions)

### Endpoint: `functions/opportunities.js` → routes `/opportunities`

**`GET /opportunities`** (client calls with `authFetch('/opportunities',
{ timeoutMs: 60000 })` — worst case ≈ 3×8s research + 20s shaping exceeds the
30s authFetch default):

1. Gate exactly like mock-interview.js (`gate()` helper: session → 401,
   `requirePlan(env, email, 'premium')` → 402 with `upgrade:true`). Apply the
   house IP rate limit (`checkRateLimit`/`clientIp`) the same way
   mock-interview does.
2. `Promise.all([loadQuizProfile, loadRoadmap])`. Derive
   `career = { name: roadmap?.targetCareerName || quiz?.careerFocus?.name,
   slug: roadmap?.targetCareerSlug, soc: quiz?.careerFocus?.soc }` and
   `gaps = (roadmap?.focusTracker?.skillGaps || []).filter(g => g && g.label
   && g.dimIndex != null).slice(0, 6)`.
   No career or no gaps → `200 { opportunities: [], grounded: false,
   fetchedAt: null, sources: [], school, reason: 'no-gaps' }`.
3. `!groundingEnabled(env)` → same empty shape with `reason: 'grounding-off'`.
4. **Per-user KV cache** (COACH_KV):
   key `` `oppfind:v1:${email}:${career.soc || career.slug || ''}:${gaps.map(g => g.dimIndex).join('.')}:${normSchool}` ``
   (`normSchool` = lowercased/trimmed school or ''), TTL **86400** (1 day).
   Key changes automatically when career, gap set, or school changes — no
   explicit invalidation needed anywhere. Hit → return cached body.
5. Miss → **3 `researchWeb` calls in `Promise.all`** (career+gap-only text so
   the `gw:q:` cache is shared across users; `budgetKey: email`,
   `freshnessTtl: GROUNDING_TTL.VOLATILE`, `timeoutMs: 8000`):
   - q1 (courses/certs, gaps 1-3): `` `courses and certifications for students building ${labels(gaps[0..2])} skills toward a career as ${career.name}` ``
   - q2 (competitions/fellowships, gaps 4-6, falling back to 1-3 when fewer
     than 4 gaps): `` `student competitions and fellowships that strengthen ${labels(...)} for aspiring ${career.name}` ``
   - q3 (orgs): school set → `` `${school} student organizations and clubs for students pursuing ${career.name}` ``,
     else `` `national student organizations for students pursuing ${career.name}` ``.
   **Deliberate deviation from v1:** do NOT use `groundedJson`. Its fallback
   path runs an *ungrounded* `callGeminiJson` when research comes back empty —
   which decision #4 forces us to discard, i.e. a paid Gemini call producing
   nothing. Instead: if **all three** `researchWeb` results are null → return
   the empty shape (`reason: 'no-results'`) without any shaping call.
   (Precedent: `mock-interview.js companyResearch` also calls `researchWeb`
   directly.) The parallel calls can over/under-count the KV budget counter by
   ≤2 — benign, accepted.
6. ≥1 brief → one `callGeminiJson(env, { prompt, temperature: 0.4,
   maxTokens: 1400, jsonMode: true, label: 'opportunity-finder',
   softFail: true, timeoutMs: 20000 })` where prompt =
   `buildEvidenceBlock(briefs)` + the `[[coordinates]]`-bearing dossier from
   `loadDossierWithCoordinates(env, email)` + a gap table
   (label/domain per gap — no instruction to output numbers) + task
   instructions: return `{ opportunities: [{ type, title, org, url,
   deadline, gapLabel, directness, whyThisFits }] }`, URLs **only** from the
   evidence sources, `deadline` only if the evidence states one,
   `directness ∈ 'direct'|'related'` (how directly it trains the gap),
   `whyThisFits` 1-2 sentences tied to the named gap and the student's
   dossier. Never ask the model for a tier name or any number.
7. **Server-side sanitize/validate** (in `functions/_lib/opportunity-core.js`
   so it's unit-testable without D1 — pure functions):
   - `type` coerced to `course|competition|fellowship|student_org` else drop.
   - `title` (≤120) / `org` (≤80) / `whyThisFits` (≤240): trim, strip control
     chars and `<>` (client also escapes on render).
   - **`url` must be `https://` AND its origin must match a `sources[].url`
     origin from the merged research results — else drop the item** (decision
     #4 enforced in code, not in the prompt).
   - `deadline`: must parse as an ISO-ish date, else `null`. Never invented.
   - `gapLabel` matched case-insensitively to a real gap → sets
     `gapDimIndex`; no match → drop.
   - `impactTier` computed deterministically, never model-supplied:
     `direct && gap ≥ 18 → 'high'`; `direct || gap ≥ 18 → 'medium'`;
     else `'low'` (gap = that gap's `gap` field, 0-100 scale).
   - `id` = `'op-' + <djb2 hash of url + type>`.
   - Rank: tier (high>medium>low), then the gap's `gap` desc. Cap at 8.
8. Write result to the per-user KV key; return
   `200 { opportunities, grounded: true, fetchedAt, sources, school }`
   (`fetchedAt` = newest brief's; `sources` = merged deduped `{title,url}`).

**`POST /opportunities`** body `{ school }` — sets the school field (decision
#7). Same gate. `school` sanitized (trim, strip `<>&"'`, cap 80; empty string
clears). Server-side read-modify-write: `profile = await loadQuizProfile`;
`profile.school = school` (delete when cleared); `saveQuizProfile`. Returns
`{ ok: true, school }`. Server-side because of the §3 merge-base finding: a
localStorage-only key is dropped by the next `uploadLocalQuizIfPresent` (its
merge base is the server copy). The client additionally mirrors it into
`FWAuth.writeLocalQuiz({...readLocalQuiz(), school})` so the local copy
matches. Known benign race flagged in §7-doubts.

### Client: `assets/js/app/opportunity-finder.js` (+ `assets/css/opportunity-finder.css`)

Vanilla IIFE exposing `global.FWOppFinder = { mount }`, mirroring
skill-gap-tracker's idiom.

- **Hook:** one-line touch in `roadmap.js renderFocusPanel()` (after the
  `FWSkillGapTracker.renderFocusView(...)` call, ~line 874):
  `if (global.FWOppFinder) FWOppFinder.mount(panel, state.roadmap);`
- `mount(panel, tree)`: appends `<section class="oppf" id="oppf-panel">` to
  `panel.querySelector('.roadmap-focus-inner')` (renderFocusView wipes it on
  every persist, so mount is idempotent-by-reappend). Module-level state
  caches the last response keyed by `targetCareerSlug` — re-mounts re-render
  from cache instantly, no refetch. Signed-out (no FWAuth session) → render
  nothing.
- **Gating UX:** after `FWEnt.boot()`, if `!FWEnt.has('premium')` →
  `FWEnt.gate(sectionEl, 'opportunities')` and skip the fetch. Also render the
  gate on a 402 response (server is the real enforcement). While the paywall
  ships dark this path never fires — fine.
- **States:** loading skeleton (instant) → list | empty | gated. Empty state
  (grounding off / no results / no gaps): heading + one line "No live
  opportunity matches right now — check back soon." — never an error, never a
  fake list (decision #4).
- **List markup** (all dynamic text through an `esc()` helper; `url`
  re-checked `https://` before becoming an `href`): heading
  `<h3>Opportunities for you</h3>` (decision #11); per item: type chip,
  `<a target="_blank" rel="noopener">` title, org, impact chip
  `"High impact · {gapLabel}"` (tiers only, decision #3), optional
  `Deadline {date}`, and the whyThisFits line. Footer:
  `<p class="oppf-asof">Opportunities checked as of {fetchedAt.slice(0,10)}</p>`
  when grounded (portal-flightplan copy convention, own CSS class).
- **School control** (decision #7): compact footer row — when no school set:
  text input + "Save" ("Add your school to personalize org matches");
  `POST /opportunities`, mirror into local quiz payload, then re-`GET` (the
  KV key includes school, so the refetch is a true miss). When set: show it
  with a "change" affordance. Never blocks the rest of the panel.
- **Entrance:** follow the `fw-revealed`/`fw-settled` convention (see
  `assets/js/shared/page-veil.js` and how sibling panels in the 2026-07-17
  pass use it) rather than a hand-rolled fade.
- **CSS:** new `assets/css/opportunity-finder.css` (`.oppf*` namespace),
  visually consistent with `skill-gap-tracker.css`.

### File list

New: `functions/opportunities.js`, `functions/_lib/opportunity-core.js`,
`assets/js/app/opportunity-finder.js`, `assets/css/opportunity-finder.css`,
`scripts/test-opportunities.mjs` (+ `test:opportunities` npm script),
`scripts/smoke-opportunities-ui.mjs` (Playwright probe).
Touched: `assets/js/app/roadmap.js` (one mount line), `roadmap.html` (two new
tags with fresh `?v=` stamps + bump `roadmap.js`'s stamp only),
`package.json` (one script line), `docs/CONVERSATION_HANDOFF.md` (addendum).
Nothing else. Explicitly untouched: `skill-gap-tracker.js`,
`gap-progress-sync.js`, `portal.html`/portal JS, `wrangler.toml`, migrations.

## 5. Ranking

Primary `impactTier` (high > medium > low), secondary the gap's `gap` value
descending. No numeric composite score anywhere (decision #3). Tier is
deterministic server math (§4 step 7), so re-ranking is stable across renders.

## 6. The `school` field (decision #7)

`quiz_profiles` is a single JSON `payload` column — no migration. New optional
top-level key `school` in the quiz-profile payload, written **server-side**
via `POST /opportunities` (see §4 — the client sync's server-base merge makes
a localStorage-only write unsafe), mirrored to `FWAuth.writeLocalQuiz` for
consistency. The input lives in the opportunity panel itself (the only place
the value is used) — not in profile-build.html, whose builder is a
free-text Q&A flow feeding the dossier, not structured fields. Genuinely
optional: absent → the national-orgs query.

## 7. Non-negotiable invariants + flagged doubts

Invariants (unchanged from v1, all still correct):

- Never write to `objectiveVector`/`objectiveAiPatch`/`gap-progress-sync.js`
  from this feature (decision #6).
- Never show an opportunity without a real `https://` source URL, enforced by
  the origin-match check in code (decision #4).
- Never show a numeric point-delta for O*NET impact — tiers only (decision #3).
- Never invent a deadline — ISO-parseable from sourced text or `null`.
- Grounding-off → clean empty state; never an error, never an ungrounded list,
  and (new) **never a wasted shaping call** when research is empty.
- Respect the shared grounding budget: exactly 3 `researchWeb` queries per
  cache miss, per-user result cached 24h, research shared via the `gw:q:`
  query-text cache.
- Repo conventions: vanilla JS, extend existing modules, `?v=` bumps only on
  changed assets referenced by `roadmap.html`, deploy =
  `git push origin Jacob_Work` (never `npm run deploy:prototype`).

Flagged doubts (resolved, but Jacob should know):

1. **Tier semantics are "gap size × directness", not measured efficacy.** A
   real per-opportunity impact measurement doesn't exist; the deterministic
   mapping is honest but coarse — every direct-hit on a big gap reads "High".
   Accepted as the least-fake option consistent with decision #3.
2. **Panel visibility = focus view only.** The readiness meter lives in the
   focus view (`?focus=1` / "current focus"), not on the default roadmap
   canvas — so "next to the meter" (decision #1) means the panel only shows
   there. If Jacob expected it on the map view too, that's a v1.1 placement
   tweak, not an architecture change.
3. **School save race:** a full client profile upload that fetched its
   server-base *before* the school POST can overwrite `school` once. Rare
   (uploads run on auth boot), self-healing (local mirror + next POST), and
   not worth a second writer protocol. Flagged, accepted.
4. **Gap-type pairing is coarse:** gaps 1-3 drive the courses query, 4-6 the
   competitions query — not every gap × every opportunity type. That's the
   3-query budget ceiling talking; acceptable for v1.
5. **Research cache sharing is partial:** query text embeds the top gap
   labels, so only users with the same career + same leading gaps share a
   `gw:q:` entry. Still career-shaped, never user-identifiable.

## 8. Steps only Jacob can do (state at the end of the build; do not attempt)

1. **Enable "Grounding with Google Search" billing on the Gemini API key** —
   Google Cloud/AI Studio billing setting, not a repo change.
2. **Set `GROUNDING_ENABLED=true`** in the Cloudflare Pages dashboard env vars
   for the `flightwayjacobprototype` project (Settings → Environment
   variables) — absent from `wrangler.toml` (verified: it only sets
   `ALLOWED_ORIGIN`), cannot be set from code. Flipping it affects **every**
   Pillar W caller (chat, weekly-plan, career-analysis, resume,
   mock-interview), not just this feature.

## 9. Verification checklist

- `node --check` on every new/touched `.js` file.
- **New `scripts/test-opportunities.mjs`** (npm `test:opportunities`), pattern
  = `scripts/test-grounding.mjs` (pure imports, no D1): unit-test
  `opportunity-core.js` — URL-origin-not-in-sources dropped; non-https
  dropped; unparseable deadline → null; tier mapping (direct+big→high etc.);
  gapLabel mismatch dropped; rank order; caps applied.
- `npm run test:vectors` — must stay green with zero assertion diffs (feature
  is read-only over vectors).
- `npm run grounding:check` — still green (we only consume the lib).
- `npm run test:entitlements` — as-is (lib-level; the endpoint reuses
  `requirePlan` untouched).
- Grounding-off smoke: invoke the GET handler (or curl a local
  `wrangler pages dev`) with `GROUNDING_ENABLED` unset → clean
  `{ opportunities: [], grounded: false, reason: 'grounding-off' }`, not an
  error.
- `npm run pages:smoke` with `SMOKE_BASE_URL=http://127.0.0.1:<port>` against
  a local `npx http-server -s .` — **the default target is the LIVE site**.
- **New `scripts/smoke-opportunities-ui.mjs`** (pattern:
  `scripts/smoke-resume-ui.mjs`): load `roadmap.html` with stubbed
  `/auth/me` + stubbed `/opportunities`, open the focus view, assert the
  panel renders the list + as-of line; stub a 402 and assert the
  `FWEnt.gate` CTA renders.
- Confirm `?v=` bumps: the two new asset tags get today's stamp,
  `roadmap.js`'s stamp bumped, nothing else re-stamped.
- Post-deploy (`git push origin Jacob_Work`): `curl -L` the live
  `roadmap.html` for the new script tag; `curl` `/opportunities`
  unauthenticated → 401 JSON.

## 10. Explicit non-goals for v1

- No bookmarking/saving/dismissing opportunities (no new persisted state
  beyond the `school` field and the KV response cache).
- No feeding into `gap-progress-sync` or any vector (decision #6).
- No campus-specific org matching beyond the optional `school` query term —
  no scraping campus club directories.
- No numeric O*NET point-delta claims anywhere in UI or API.
- No panel on the roadmap map/canvas view or portal (focus view only, v1).
- No per-gap daily refresh button; freshness = 24h user cache + 6h research
  TTL.
