# Post-Ship Fix Plan — Pillar W + Resume Builder v3 + Mock Interview

**Audience:** the Claude Fable session implementing these fixes.
**Branch / deploy:** `Jacob_Work`. Deploy = `git push origin Jacob_Work` (Cloudflare Pages auto-builds).
**Origin:** a full read-only audit (2026-07-18) of the shipped build (commits `c2a64be`..`44d62af`) against `docs/RESUME_AND_INTERVIEW_MASTERPLAN.md` and `docs/PILLAR_W_WEB_GROUNDING_DESIGN.md`. All three workstreams were verified green at ship time (`grounding:check`, `interview:check`, `resume:ats-check`, `resume:tailor-check`, `resume:format-check`, `test:vectors` 42/42, `pages:smoke`, live curls). Everything below is a correctness/completeness gap found on top of a working build — not a regression to a broken one. Read this doc fully before touching code; it is self-contained (does not assume you have the audit conversation).

**Jacob's scoping decisions (binding, already made — do not re-litigate):**
1. Fix everything in this doc — full pass, not a subset.
2. **Phase H ships first, alone**, as a hotfix — it is a live cost-exposure bug (unlimited mock-interview debrief calls).
3. Wire up the dead interview-playbook career-tuning fields (Phase 2) — core to the product's "not everyone wants quant" promise, worth the prompt-engineering depth.
4. Delete the dead `assets/js/app/resume-builder.js` client file AND fix the live bug in its still-reachable server endpoint (Phase 4).
5. **Phase R (added 2026-07-18 from Jacob's direct product feedback after using the live resume builder):** deep resume-builder pass — the AI-led build flow is the centerpiece, plus the specific UI bugs he hit. This is as important as Phase 1; do it with full attention, not as polish. "Polish all UI" is a standing directive for every surface this plan touches.

**Discipline:** follow the `flightway-fullstack-architect` skill. Auth/session-boundary work (Phase H) and anything touching Gemini prompt construction or the web-text fencing boundary is fragile — trace fully, full attention, no shortcuts. UI-only items (Phase 3) are fine to delegate at bounded depth once you're operating. Effort ceiling on every subagent brief: bounded, direct depth — trace the specific path, make the change, verify with the named script.

---

## Phase H — HOTFIX: mock-interview daily-cap bypass (ship alone, first)

**File:** `functions/mock-interview.js`

**Bug:** The 3-sessions/day cap (`dailyLimit()`) is only checked/spent inside `action === 'turn'` (line ~137, spent once at `isSessionStart`, peeked on later turns). The `action === 'debrief'` branch (line ~202-227) never calls `dailyLimit` at all and only requires a transcript of ≥4 client-supplied entries. A client can skip the entire turn flow and POST `action:'debrief'` directly with a self-authored transcript, repeatedly, with the only remaining brake being a generic 30-req/hour **per-IP** rate limit (`checkRateLimit(env,'mockiv:'+ip,{max:30})`) — far weaker than the stated cap, and account- not IP-scoped is the wrong axis anyway. Each call also does a best-effort D1 write to `interview_sessions`.

**Constraint:** Do not change the spend semantics at turn-start (that's the correct, sole "this session consumed today's slot" event — do NOT add a second spend at debrief time, or a legitimate session will burn 2 of the 3 daily slots).

**Fix direction:** Require proof that a debrief follows a session that actually went through the turn flow, using a stateless, tamper-evident session token — consistent with this endpoint's existing "client holds the transcript, no server-side per-turn state" architecture (mirrors `functions/sim-mirror.js`'s no-server-beacon pattern, referenced in the master plan).

- On the first turn (`isSessionStart`, where the daily spend already happens today), mint a token: reuse the existing `sessionPepper(env)` + `sha256Hex` primitives already in `functions/_lib/auth.js` (same pattern `functions/_lib/notify-token.js` uses for unsub tokens) — e.g. `sha256Hex(sessionPepper(env) + ':' + email + ':' + sessionStartTs)`, where `sessionStartTs` is a server-generated timestamp (not client-supplied). Return `{ sessionToken, sessionStartTs }` alongside the normal turn response.
- The client resends `sessionToken` + `sessionStartTs` on every subsequent turn and on the debrief call (small addition to the existing request/response shape and to `interview-mode.js`'s client state).
- Server verifies on **every** turn after the first, and on debrief: recompute the hash from `email` + `sessionStartTs` and compare (constant-time compare, mirror the pattern already used for other tokens in `auth.js`); also reject if `Date.now() - sessionStartTs` exceeds a generous session-length ceiling (~40 min, covers the ~20 min target session + buffer). A debrief request with a missing/invalid/expired token is rejected (400/401), not silently accepted.
- No new D1/KV writes per turn — the token is self-contained and stateless, so this doesn't add cost or violate the "server is stateless per-turn" invariant.

**Acceptance criteria:**
- A debrief call with no prior valid turn (no token, or a token that doesn't verify) is rejected.
- A normal session (turn → turn → ... → debrief) still spends exactly 1 of the 3 daily slots, as today.
- `npm run interview:check` gains a new assert: a debrief-only request (skip straight to `action:'debrief'` with a fabricated transcript, no session token) is rejected, not persisted.
- `node --check functions/mock-interview.js`, live curl: unauthenticated → 401 as before; with a valid session but no token on debrief → confirm rejection.

**Ship this alone**: commit + push + verify before starting Phase 1. This is the one item Jacob wants live ahead of everything else.

---

## Phase 1 — Critical (integrity / security, bundle together)

### 1.1 Adaptive difficulty is fully client-trusted
**File:** `functions/mock-interview.js:68-70` (`parseContext`), `functions/_lib/interview-core.js:84-92` (`nextDifficulty`).
**Bug:** `difficulty` is read verbatim from the request body (clamped 1-5); the server never re-derives a trajectory from the transcript itself. A client can pin `difficulty:1` on every turn.
**Fix direction:** The server already re-scores each new answer via Gemini's `raw.assessment` on every turn. Have the server derive the *current* difficulty by replaying `nextDifficulty` over the assessments implied by the transcript so far, rather than trusting the client-supplied number as the seed for the next step. Since no per-turn state is persisted, the practical approach is: embed a per-turn difficulty marker in the transcript entry the server itself writes when it generates each interviewer turn (a short signed/checksummed tag using the same `sessionPepper` primitive as Phase H, appended to that turn's text or a sibling field), and on each subsequent turn recompute difficulty by reading back the *server's own* prior markers from the resent transcript rather than the client's separate `difficulty` field. If a marker is missing or fails verification, fall back to a conservative mid-difficulty default rather than trusting an unverified client value.
**Acceptance:** A scripted test that resends a transcript with a tampered/missing difficulty marker does not get to force difficulty down; `interview:check`'s existing difficulty-monotonicity assert still passes and gains a tamper case.

### 1.2 Malformed debrief silently becomes a fake passing grade
**File:** `functions/_lib/interview-core.js:187-201` (`sanitizeDebrief`).
**Bug:** Every non-technical axis defaults to `3` when the model's JSON is missing/malformed, so `scores.overall` is always ≥3 and the intended "could not build debrief" fallback (checked via `!debrief.verdict && !debrief.scores.overall`) can never actually fire. A broken/empty model response returns as a normal 200 with a flat "3/5, no verdict" debrief instead of a real error.
**Fix direction:** Distinguish "the model legitimately scored a 3" from "the model response was empty/malformed" — check for the raw material (e.g. `raw.verdict` string non-empty, or a minimum number of axes actually present in the model's JSON) *before* defaulting, and if that check fails, return an honest error response (e.g. 502 with a "please try again" message) instead of a synthesized flat debrief. Do not persist a synthesized-default debrief to `interview_sessions`.
**Acceptance:** A mocked empty/malformed Gemini response in `interview:check` now produces a rejected/error response, not a persisted flat-3 debrief.

### 1.3 `career-analysis.js` skips the web-text fencing entirely
**File:** `functions/career-analysis.js:266-317` (`governedCareerFetch`, `fetchCareerWebContext`/`liveFetch`).
**Bug:** These legacy grounded fetches gained shared budget/cache discipline in the WB rollout but never route through `researchWeb`/`sanitizeWebText`/`buildEvidenceBlock` from `functions/_lib/gemini-grounded.js` — live `google_search` output is merged straight into `analysis.summary`/`analysis.metrics`. This is the one Tier B call site where the design doc's top invariant (untrusted web text must be fenced as data, never merged raw) is not applied, despite `career-analysis.js` being an explicit Tier B rollout target.
**Fix direction:** Route these two fetches through `researchWeb` (or at minimum apply `sanitizeWebText`/`buildEvidenceBlock` to their output before it reaches `analysis.summary`/`metrics`) so this call site gets the same fencing discipline as every other Pillar W caller. Preserve the existing budget/cache behavior already added in WB.
**Acceptance:** An injection string in a mocked `career-analysis.js` web response is neutralized before reaching `analysis.summary`, mirroring the existing `grounding:check` injection-containment assert. Add a case to `grounding:check` or a targeted script covering this specific call site.

### 1.4 Resume generation's 15/day cap has a TOCTOU race
**File:** `functions/resume-builder.js:135-143,266,380` (`dailyLimit`, peek-then-increment).
**Bug:** The cap is peeked before generation, then incremented after — concurrent requests can both pass the peek before either increments, exceeding 15/day.
**Fix direction:** Make the check-and-spend atomic against the same KV/D1 primitive used elsewhere in the codebase for counters (check how `functions/mock-interview.js`'s `dailyLimit` or similar counters elsewhere handle this — if there's already an atomic increment-with-ceiling pattern in `_lib`, reuse it rather than inventing a new one). If KV's eventual consistency makes a hard atomic guarantee impractical, at minimum move the spend to *before* generation starts (spend-then-generate, refund on failure) rather than peek-then-spend-after, which closes the highest-value race window.
**Acceptance:** Two concurrent generation requests near the cap boundary don't both succeed when only one slot remains (verify by a scripted concurrent-call test if the harness supports it, otherwise document as best-effort-narrowed and note in the commit).

---

## Phase R — Resume Builder deep pass (Jacob's direct product feedback — treat as co-equal with Phase 1)

Jacob used the live resume builder and gave direct feedback. Some root causes below are already traced (marked VERIFIED); others need live reproduction. The centerpiece (R.5) is a real feature build, not a fix — give it architecture-level attention.

### R.1 Kill the portal launcher drawer — navigate directly (VERIFIED)
**Files:** `assets/js/app/portal-resume.js` (whole module), portal card wiring in `assets/js/app/portal.js` / `portal.html`.
**Issue:** Clicking the resume card on the user home opens an interstitial drawer ("Build your resume" pitch + an "Open Resume Builder" link). Jacob explicitly does not want this — the card should take the user straight to `resume.html`.
**Fix direction:** Make the portal card navigate directly (`location.href` or make the card itself an `<a>`), matching however other portal cards that link out behave. Retire the drawer: gut `portal-resume.js` to a plain navigation handler or delete it and re-point the card's action wiring — grep for `FWPortalResume`/`portal-resume` references (portal.js action dispatch, any CSS in `assets/css/` for `.portal-resume-drawer*`/`.portal-resume-backdrop`) and remove dead CSS with it.
**Acceptance:** Clicking the card lands on resume.html with no intermediate panel; no orphaned drawer CSS/JS references remain; buster bumped on portal.js (and portal.html's reference) if changed.

### R.2 Stale brand.js buster — plane logo instead of the orange bird (VERIFIED root cause)
**File:** `resume.html:256` — loads `assets/js/shared/brand.js?v=20260703p`; every other page (e.g. `portal.html:107`) was bumped to `?v=20260717g` by the bird-logo commit (`483bfc1`). `/assets/*` ships `immutable, max-age=1y`, so resume.html serves a year-cacheable stale plane-logo brand script.
**Fix direction:** Bump resume.html's brand.js buster to the current stamp. Then audit EVERY shared-asset buster in resume.html against a current page like portal.html (theme-boot, global-shim, app-nav, theme.js, lucide-lite, auth, entitlements, events, flags…) — the donor page was stamped at port time and may have other stale references; bump only genuinely stale ones (never a blanket re-stamp).
**Acceptance:** Live curl of resume.html shows brand.js at the current stamp; visual check (screenshot harness) shows the orange FlightWay bird in nav + footer.

### R.3 Work/Education/Projects editor boxes overlap (VERIFIED root cause)
**Files:** `resume.html` (in-page `<style>` block), `assets/js/app/resume-page.js:703+` (`itemCard`).
**Issue:** `itemCard()` builds `<div class="resume-item-fields">` (4 text inputs: org/role/start/end) and `<div class="resume-bullets-wrap">` — but **no CSS rule for either class exists anywhere** (donor CSS lost in the port), and `.resume-app input[type="text"]` has no `width`/`box-sizing` constraint. Four default-width inputs overflow the half-width dashed `.resume-item-card`, colliding with card borders — the overlap Jacob sees.
**Fix direction:** Add proper rules: `.resume-item-fields` as a responsive grid (e.g. `grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))` mirroring `.resume-contact-fields`), `box-sizing: border-box; width: 100%; min-width: 0` on the inputs, sensible spacing for `.resume-bullets-wrap`. Verify visually (screenshot harness, both themes, desktop + mobile) — and while there, check the whole two-column `.resume-page-wrap` collapses to one column on mobile (no `@media` rule exists for it in the current style block).
**Acceptance:** No border/input overlap at desktop or mobile widths in either theme; editor fields fill their cards cleanly.

### R.4 Skills section reported completely broken (needs live repro)
**Files:** `assets/js/app/resume-page.js:1109-1121` (`bindSkillInput`), `:771-790` (`renderSkills`), `resume.html:215-218`.
**Issue:** Jacob reports the skills section "doesn't work at all." Static wiring looks complete (Enter-keydown handler bound at init, tag render with remove buttons, preview + render-layer support for `flat` skills) — so the failure is a runtime issue: suspects include a boot-time error upstream killing init before `bindSkillInput`, the FWEnt premium gate overlaying/blocking input, or an event/focus conflict. Do NOT guess — reproduce on the live page (Playwright probe or signed-in session), read the console, trace the actual cause, then fix it.
**Fix direction:** Whatever the traced cause is — one targeted fix. Additionally (see R.5/R.6): the AI suggest flow never proposes skills at all (`resume-builder.js` returns only bullets), so even when working, skills are 100% manual — fold skill suggestions into the AI draft.
**Acceptance:** Typing a skill + Enter renders a removable tag, shows in preview, survives save/reload; a Playwright/smoke assertion covers add-skill → tag + preview.

### R.5 AI-led resume building — the centerpiece (feature build)
**Files:** `functions/resume-builder.js`, `assets/js/app/resume-page.js`, `resume.html`; reuse the pop-up question UI pattern from the Roadmap (find it in `assets/js/app/roadmap.js` / the roadmap question-modal flow — mirror its UX, don't invent a new pattern).
**Issue:** Jacob's vision (and the master plan's §1.1-1.2 intent): the AI should **actually build the resume** — seeded from everything FlightWay already knows (parsed uploaded resume → dossier, confirmed experiences, completed roadmap waypoints, D1 artifacts, sim trials, freeText) and driven by **interactive pop-up clarifying questions like the Roadmap uses**. The user may be shy/insecure and not know how to sell themselves — the AI carries that burden and produces a recruiter-ready resume. What shipped instead: a manual editor with an "AI bullet suggestions" side panel that only drafts bullets, plus gap questions rendered as a passive static list pointing at a shared free-text box. That is editor-first with AI assist, not AI-first.
**Fix direction:**
- **Server:** extend `functions/resume-builder.js` (POST, new mode or richer response) to draft the FULL resume document — summary, experience/education/projects items with bullets, skills list, and a recommended template — not bullets alone. Same evidence discipline as today: every generated element carries provenance, all sources fenced, never fabricate (unanswered gaps produce conservative phrasing or omission plus a question — never an invented number; note Phase 2.2's enforcement backstop applies here too). Reuse the existing draft + critique-pass plumbing and the W1 format library; keep the existing per-call timeouts/wall-clock budget and the daily cap.
- **Client:** a prominent guided mode — "Build my resume with AI" as the primary CTA on first open (and re-runnable) — that walks the user through the AI's clarifying questions **one at a time in a pop-up/modal Q&A** (Roadmap's pattern), folds each typed answer back into the generation context, then lands the completed draft in the editor for manual refinement. Template preference is asked as part of the flow (per Jacob's Q&A A9: the AI asks which of several industry-appropriate templates the user prefers, with its recommendation marked). The manual editor stays, but becomes the *refinement* surface behind the guided flow — progressive disclosure, guided-first (Jacob's simplicity constraint: sensible AI defaults up front, depth behind disclosure).
- **Persistence:** pending questions + partial answers survive reload (this supersedes/absorbs Phase 2.3 — implement them together so the guided flow's state lives in the saved doc, not just the suggest panel's).
**Acceptance:** A fresh premium user with a dossier can open resume.html, click the guided CTA, answer pop-up questions, and receive a complete, substantive, quantified, industry-formatted resume without ever touching the manual editor; reloading mid-flow resumes the question state; `resume:ats-check`/`resume:format-check`/`test:vectors` stay green; no vector/dossier writes (read-only invariant).

### R.6 Q&A feature-list gap closure
Jacob re-checked the shipped build against his original Q&A spec (preserved in the master plan). Gap-check result — most items ARE present (dedicated page, job tailoring, PDF/DOCX/LaTeX, 3/20 caps, ATS-safe single column, hidden O*NET tags, personas, company deep-research mode, single debrief, 6-axis metric log, 3/day cap). The confirmed misses, beyond R.5:
- **Skills never AI-populated** (A2 "seeded from everything") — covered in R.5's full-document draft.
- **Template-choice-as-a-question** (A9: "AI should ask the user which template they'd prefer") — currently a collapsed `<details>` picker the user must discover; covered by R.5's guided flow. Keep the `<details>` picker as the post-hoc customization surface.
- **Interview career-tuning depth** (B15 "tune AS MUCH AS POSSIBLE to the target career") — that's Phase 2.1; treat 2.1's acceptance criteria as also satisfying this Q&A item.
- **Gap-question interactivity + persistence** (A2/A4 "asks ANY necessary clarifying questions… VERY MUCH SO" on quantification coaching) — covered by R.5 + 2.2.
If while implementing you find any other Q&A item silently unimplemented, add it to this phase rather than dropping it.

### R.7 General resume UI polish sweep
After R.1-R.5 land: one bounded polish pass over resume.html — visual hierarchy of section cards, spacing rhythm, empty states (a brand-new doc should look inviting, not a wall of empty inputs — the guided CTA from R.5 is the hero of the empty state), preview-pane typography, button consistency with the rest of the app (`.fw-iv-btn` / house styles), entrance treatment consistent with the `fw-revealed`/`FWPageVeil` convention other pages use (check whether resume.html even has the veil — portal/roadmap/coach do), and mobile layout. Verify with the committed Playwright screenshot harness in light + dark + mobile. Bounded depth — this is polish, not redesign.

---

## Phase 2 — Significant (product substance matches the spec)

### 2.1 Interview career-tuning is mostly dead code — wire it up (Jacob: do this now)
**Files:** `functions/_lib/interview-playbooks.js` (source of truth), `functions/_lib/interview-core.js:110-150` (`buildTurnPrompt`), `:153-179` (`buildDebriefPrompt`), `:198` (`metricsPromptBlock`).
**Bug:** `interview-playbooks.js` defines rich per-family `behavioralFocus`, `personaNotes`, `sampleTechnicalQuestions`, and `structure` fields. `buildTurnPrompt` only ever reads `playbook.technicalArchetypes` and `playbook.evaluationEmphasis` — the rest is defined but never referenced anywhere in `interview-core.js` or `mock-interview.js`. `phaseNotes.behavioral` is one fully generic string used for every family, so families that are behavioral-heavy in their `mix` (healthcare/education/public_service run 4-of-6 flexible questions as behavioral) get an almost entirely generic, non-career-tuned interview. Separately, `buildDebriefPrompt` accepts a `playbook` param but never uses it (only the fixed generic `metricsPromptBlock()`), so `evaluationEmphasis` never reaches scoring, and `sanitizeDebrief`'s technical weight is a flat `1.25` for every family regardless of how technical-heavy that family's `mix` actually is (same weight for healthcare `mix.technical:2` as for software `mix.technical:4`) — the claimed graduated, career-aware weighting doesn't exist.
**Fix direction:**
- In `buildTurnPrompt`, thread `playbook.behavioralFocus`, `playbook.personaNotes`, and `playbook.sampleTechnicalQuestions` into the prompt alongside the existing `technicalArchetypes`/`evaluationEmphasis` — behavioral question generation should draw from `behavioralFocus` the same way technical questions already draw from `technicalArchetypes`; persona tone should draw from `personaNotes` in addition to the generic Maya/Elliot descriptions.
- In `buildDebriefPrompt`, actually use the `playbook` parameter — pass `evaluationEmphasis` into the scoring prompt so the model's narrative verdict and per-axis reasoning reflect the family's real priorities (e.g. consulting's MECE structure, finance's quantitative speed).
- Replace the flat `w = axis==='technical' ? 1.25 : 1` in `sanitizeDebrief`'s overall computation with a weight derived from the family's actual `mix.technical` proportion (e.g. scale between ~1.0 and ~1.5 based on how technical-heavy the family's mix is, keeping N/A families untouched), so "graduated by family" becomes real rather than binary asked/N-A.
**Acceptance:** `interview:check` gains assertions that (a) a healthcare-family session's behavioral prompt differs from a software-family session's (not the same generic string), (b) the debrief prompt for a technical-heavy family includes that family's `evaluationEmphasis` text, (c) overall-score technical weighting differs measurably between a `mix.technical:2` and `mix.technical:4` family on matching input scores.

### 2.2 "Never invent a number" has no server-side enforcement (resume builder)
**File:** `functions/resume-builder.js:75-93` (`sanitizeBullets`).
**Bug:** The rule is prompt-only (draft prompt + critique prompt); nothing checks that a bullet's number/stat is actually traceable to the supplied dossier/artifact/trial/freeText source. Contrast with `resume-tailor.js`'s real `bulletRef`-existence check, which is enforced in code.
**Fix direction:** Add a lightweight server-side check in `sanitizeBullets` (or a new pass before it): extract numeric tokens (%, $, counts) from each drafted bullet and verify at least a loose match exists somewhere in the source evidence text supplied for that bullet's `evidence` type; if a bullet contains a number with no traceable source, either strip the number (fall back to a qualitative phrasing) or route it into the gap-question flow instead of shipping it silently. Doesn't need to be perfect — the goal is a real backstop, not just a prompt instruction, matching the rigor `resume-tailor.js` already has.
**Acceptance:** A scripted test where the draft prompt's evidence contains no numbers but the mocked model output includes a fabricated stat results in that stat being stripped or converted into a clarifying question, not shipped verbatim. Add to `resume:ats-check` or a new targeted assert.

### 2.3 Gap-question loop state is lost on page reload (ABSORBED INTO R.5 — implement there)
**Files:** `functions/resume-builder.js:159-166` (`onRequestGet`, unused by the client), `assets/js/app/resume-page.js` (only calls `apiSuggest`/POST and `/resume-doc` GET, never GET `/resume-builder`).
**Bug:** `onRequestGet` returns the KV-persisted `saved` doc including `questions`, but `resume-page.js` never calls it. A student mid-way through answering a clarifying question loses that state on any reload and must regenerate (possibly getting a different set of questions).
**Fix direction:** On page load, after the existing `/resume-doc` fetch, also call GET `/resume-builder` and if it returns pending `questions`, restore them into the same UI path `renderSuggestQuestions` already renders into — so a reload resumes the gap-question state instead of discarding it.
**Acceptance:** A manual/live check: generate bullets that produce clarifying questions, reload the page, confirm the same questions reappear (not silently dropped, not a fresh regeneration).

### 2.4 `sim_trial` bullets silently dropped on save (dead-but-live endpoint bug)
**File:** `functions/resume-builder.js:90-91,178` (`onRequestPut`, called with `sanitizeBullets(body?.bullets, targetDims, null)`).
**Verified:** `resume-page.js` never calls PUT `/resume-builder` (only POST for suggestions and `/resume-doc` for save/load) — so this bug is **not currently hit by the live UI**, but the endpoint remains reachable (used to be called by the now-dead `assets/js/app/resume-builder.js`, and is fixed alongside its removal per Phase 4). `trialRolesLc = null` makes `Array.isArray(trialRolesLc)` false, so the filter predicate `b.evidence !== 'sim_trial' || (Array.isArray(trialRolesLc) && …)` evaluates false for every `sim_trial`-evidenced bullet, stripping all of them — contradicting the adjacent comment that saved bullets already passed the generation-time guard and should be kept.
**Fix direction:** Pass the actual `trialRolesLc` (same value computed/used in the POST path) into `sanitizeBullets` inside `onRequestPut`, so previously-validated `sim_trial` bullets survive a save instead of being silently stripped.
**Acceptance:** A direct PUT to `/resume-builder` with a `sim_trial`-evidenced bullet round-trips it unchanged. Cover in `resume:ats-check` or a small new assert.

### 2.5 Tier B grounded callers discard provenance entirely
**Files:** `functions/_lib/roadmap-generate.js:213-214`, `functions/_lib/weekly-plan-gen.js:145`, `functions/stretch-fits.js:195-212` — all call `groundedJson` but only destructure `result`/`raw`, dropping `sources`/`fetchedAt`/`grounded`. Confirmed no `assets/js` consumer for roadmap/weekly-plan/stretch-fits ever reads `grounded`/`groundedSources`/`groundedAt`.
**Bug:** Budget is spent and web evidence is fenced into these prompts, but the user never sees a source or "as of" date for weekly-plan tasks, stretch-fit explanations, or roadmap steps — unmet against the design's explicit rollout requirement to thread provenance to the client wherever user-facing.
**Fix direction:** Thread `{ sources, fetchedAt, grounded }` through each of these three functions' return payloads to their respective client consumers, and add a minimal provenance indicator in the UI (doesn't need the full chip treatment Marco gets — a small "as of <date>" note near the grounded content is sufficient given these are lower-emphasis surfaces than Marco).
**Acceptance:** Each of the three endpoints' response payload includes provenance fields when grounded; the corresponding page renders at least a minimal "as of" indicator when present.

### 2.6 Marco's degraded grounding path is a hallucination risk
**File:** `functions/chat.js:202-207` (system prompt, unconditional "You have Google Search available"), `:585` (`useSearch: wantsCurrent && !groundingEnabled(env)` — unconditionally disables the legacy search fallback whenever the flag is on, even if `researchWeb` returns nothing).
**Bug:** When grounding is on and `researchWeb` fails/times out/is over budget, the model still believes (per its system prompt) that it has live search, but gets neither the tool nor fenced evidence — worse than pre-Pillar-W behavior, which had the legacy search fallback available.
**Fix direction:** Either (a) make the system-prompt "you have search" claim conditional on grounding actually having produced evidence this turn (state it dynamically, not as a baked-in unconditional line), or (b) when `researchWeb` returns null/empty, fall back to the legacy `useSearch:true` single-call path instead of disabling it outright — preserving the "graceful fallback to baked/parametric knowledge" invariant the design doc requires, rather than landing on a worse-than-before state.
**Acceptance:** A mocked over-budget/timeout `researchWeb` call in a chat.js-focused test results in either a legacy-search fallback or a system prompt that doesn't falsely claim live search access; add this case to `grounding:check`.

### 2.7 `weekly-plan-gen`'s "upcoming deadlines" query cached too long
**File:** `functions/_lib/weekly-plan-gen.js:123-127`.
**Bug:** The query (`"programs, competitions and opportunities with upcoming deadlines for students pursuing X"`) is cached under `GROUNDING_TTL.SEMI_STABLE` (14 days) instead of `VOLATILE` — a lapsed deadline can keep being served for up to two weeks on the one caller where freshness matters most.
**Fix direction:** Change this specific query's TTL tier to `VOLATILE` (or whatever the shortest tier is per `gemini-grounded.js`'s `GROUNDING_TTL`).
**Acceptance:** Confirm via `grounding:check` or a direct read that this call site now uses the volatile tier.

---

## Phase 3 — Polish (UI/UX)

Bounded-depth work — fine to delegate to Sonnet once you're driving, batched into one brief per file group.

1. **Persona cards visually identical.** `assets/js/coach/interview-mode.js:33-36` + `assets/css/flightway-2.css:308-312` — Maya (coach) and Elliot (pressure) share identical card styling; only `.is-active` (selection state) differs. Give each persona a distinct accent (color/icon) so the choice reads as two different interviewers, not two buttons with different labels.
2. **Empty answer silently no-ops.** `assets/js/coach/interview-mode.js:267-272` — `sendAnswer` on an empty/whitespace answer just refocuses the textarea with no visible feedback. Add a brief inline hint/shake so it doesn't look broken.
3. **Provenance chip inconsistency.** `assets/js/coach/coach.js:573-598` vs `assets/js/app/portal-career-advisor.js:195-223` — divergent DOM placement and hardcoded inline styles (`opacity:.7`, fixed `11px`) instead of the app's CSS-variable theme tokens; no `.coach-msg-sources`/`.career-chat-sources` rules exist in `assets/css/`. Unify into a shared small helper (or at least shared CSS classes using theme tokens) so both surfaces render provenance the same way and pick up dark/light theming. Also: when `grounded:true` but `sources:[]`, don't show a bare "Current as of <date>" chip with nothing under it — either suppress the chip or add a short "no citable source found" note.
4. **LaTeX export can hard-break on pasted multi-line text.** `assets/js/shared/resume-render.js:253,256,259,267` (`toLatex`) — appends `\\[Npt]`/`\\` directly after `escLatex(text)` with no stripping of embedded blank lines; a summary/bullet pasted with a trailing blank line (common from Word/Docs) produces a LaTeX compile error. Strip/collapse blank lines from free-text fields before emitting line-break commands.
5. **Tailored resumes can silently drop a whole experience item.** `functions/resume-tailor.js:74-107` (`rebuildFromPicks`) drops an entire experience entry when the model excludes all of its bullets, with no surfacing in `resume-page.js`'s `renderVariants()`. Add a visible note ("1 role omitted from this tailored version — its bullets didn't match this posting") so a student doesn't submit a resume with an unexplained gap without knowing.
6. **Gap-question copy mismatch.** `resume.html:192` says "answer these in the box above and regenerate" but the control is labeled "Suggest bullets," never "Regenerate." Align the copy with the actual button label.

---

## Phase 4 — Cleanup (Jacob: do both, in this pass)

**Delete** `assets/js/app/resume-builder.js` — confirmed dead (no HTML page includes it; `grep -rln "resume-builder.js" *.html` returns nothing). Before deleting, grep once more for any other reference (dynamic import, docs) to be safe, per the "confirm nothing else references it" note in the master plan.

**Fix the live endpoint bug it leaves behind** — this is the same fix as Phase 2.4 (`trialRolesLc` null bug in `functions/resume-builder.js`'s `onRequestPut`); do it as part of this cleanup pass if not already done in Phase 2. The endpoint itself (`onRequestGet`/`onRequestPut` in `functions/resume-builder.js`) stays — it's used by Phase 2.3's fix (GET, for gap-question recovery) and remains a reasonable API surface even with the old client gone.

---

## Verification checklist (run in full before pushing; don't hand-wave)

- `node --check` on every touched JS.
- `npm run grounding:check` — must gain the new asserts from 1.3 and 2.6; must stay green on everything existing (flag-off byte-identical invariant is still load-bearing).
- `npm run interview:check` — must gain the new asserts from Phase H, 1.1, 1.2, 2.1.
- `npm run resume:ats-check` + `resume:tailor-check` + `resume:format-check` — must gain coverage for 2.2 and 2.4 where noted.
- `npm run test:vectors` — must stay green (nothing here should touch vector state, but confirm).
- `npm run pages:smoke` — resume.html + coach.html still boot clean after the resume-builder.js deletion and interview-mode.js changes.
- Live `curl -L` against the pages.dev URLs after push: confirm `/mock-interview` still 401s unauthenticated, confirm resume.html no longer references `resume-builder.js` in any script tag it never had, confirm busters bumped on every changed client asset on every referencing page.
- **Phase H specifically:** live-test the debrief-bypass closure with an authenticated test account if feasible (POST `action:'debrief'` with no prior turn → confirm rejection), not just the mocked `interview:check` case.

## Sequencing

Phase H alone, first — commit, push, verify live, *then* proceed. Phase 1 (bundle) next. **Phase R next** — do the quick verified fixes (R.1-R.3) early since they're user-visible embarrassments, then R.4's live repro, then R.5 (the feature build — the single largest item in this plan; architecture inline, bounded UI pieces delegable), then R.6/R.7. Phase 2 after R (2.1 career-tuning is the highest-value non-resume item; 2.3 is absorbed into R.5). Phase 3 can run in parallel with Phase 2 once R lands (disjoint files, mostly interview/Marco surfaces). Phase 4 last (depends on Phase 2.4's fix existing). Full verification checklist at the end, then push.

Additional verification for Phase R: live curl confirms resume.html's brand.js at the current stamp; Playwright screenshot pass (light/dark/mobile) for R.3/R.7; a scripted or live guided-flow run for R.5 (questions → answers → complete draft → reload resumes state); skills add/remove/persist assertion for R.4.
