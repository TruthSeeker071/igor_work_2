# FlightWay — Live Web Grounding + Resume Builder v3 + Mock Interview: Master Build Plan

**Audience:** the Claude **Fable** session that will implement this end-to-end.
**Branch / deploy target:** `Jacob_Work` (this `flightway` repo). Deploy = `git push origin Jacob_Work` (Cloudflare Pages auto-builds). `igor_work_2_repo/` is a **donor folder**, never the base.
**Discipline:** follow the `flightway-fullstack-architect` skill for delegation, verification, and token conservation. Effort ceiling on every subagent brief: *bounded, direct depth — trace the specific path, make the change, verify with the named script. No open-ended "audit everything" passes.*

This plan supersedes `igor_work_2_repo/docs/RESUME_BUILDER_V2_PLAN.md`. Read that too — it is the origin spec for the code you are merging — but where the two disagree, **this document wins**.

**Three workstreams, in this document:**
1. **Pillar W — Live Web Grounding (§3):** the flagship. Web access becomes a standard capability of the *entire* AI layer — Marco and every AI-dependent feature can pull current, sourced information from the web as part of its operating protocol. This is the product's core differentiator: an advisor that stays fully up to date, something a human advisor can't, at a fraction of the cost. Built once as a shared service, then adopted across the whole AI surface.
2. **Resume Builder v3 (§1):** merge the diverged resume code, make the wording substantive/quantified, tailor format to the student's industry.
3. **Mock Interview (§2):** rebuild interview prep into a stateful, resume-aware, adaptive mock interview.

Pillar W is foundational — the two features (and Marco) consume it — so its shared service is built first, then features and the rest of the AI surface adopt it.

---

## 0. Ground truth — what actually exists (verified 2026-07-17, read before building)

The two repos **diverged**; this is not "add a missing feature."

**A. Resume builder is ~90% built in the donor, against an older backend.** Igor completed phases 0–5 of the v2 plan. Net-new files that exist **only** in `igor_work_2_repo/` and must be brought over:
- `resume.html` (dedicated page, 236 lines) — multi-resume switcher, structured editor, live preview, ATS score box, job-tailor panel, print + .docx buttons.
- `assets/js/app/resume-page.js` (1008 lines) — page controller.
- `assets/js/shared/resume-render.js` (270) — pure render/ATS layer: `toHtml` / `toPlainText` / `toDocxXml` / `atsCheck`.
- `assets/vendor/fflate-lite.js` — client-side zip for .docx.
- `functions/resume-doc.js` (155) — resume CRUD.
- `functions/resume-tailor.js` (296) — paste-a-posting → tailored variant + keyword score + gap list.
- `functions/_lib/resume-schema.js`, `functions/_lib/sim-sanitize.js`.
- `migrations/0011_resume_builder.sql`.
- `scripts/test-resume-ats.cjs`, `scripts/test-resume-tailor.cjs`, `scripts/fixtures/resume-sample.json`, `scripts/fixtures/resume-broken.json`.
- `package.json` scripts: `resume:ats-check`, `resume:tailor-check`.

**B. `functions/resume-builder.js` exists in BOTH repos and evolved in incompatible directions — this is the one true merge conflict.**
- **`flightway` (base) added:** `freeText` user input, incremental regeneration (feeds the saved resume back as context), the `loadDossierWithCoordinates` helper (`functions/_lib/dossier-coordinates.js`), 180-day persistence, `experience` evidence value, per-Gemini-call `timeoutMs` + wall-clock budget with best-effort return.
- **`igor` added:** `simTrials` (sanitized via the shared `sim-sanitize.js`) + D1 `artifacts` as bullet sources, `sim_trial` evidence value, 7-day cache.
- **Neither is a superset.** The merge must **union both**: keep flightway's freeText/incremental/coordinate-helper/timeout/180d, add igor's simTrials + artifacts + `sim_trial`. `EVIDENCE = {resume, dossier, artifact, experience, sim_trial}`. Keep flightway's model config and its `dossier-coordinates.js` path; do **not** regress to igor's `loadDossier`-only sourcing.
- `functions/resume-parse.js` also diverged (flightway newer — keep flightway's). `assets/js/app/portal-resume.js` and `assets/js/app/resume-builder.js` diverged (see §4).

**C. The interview feature is byte-identical in both repos and untouched by Igor.** `assets/js/coach/interview-mode.js` is identical; flightway's `functions/interview-prep.js` is actually newer. **It is a flashcard tool, not a mock interview**: a 12-question bank per career, one independent question at a time, per-answer rubric feedback, **no conversation memory, no follow-ups, zero resume/qualification awareness.** The mock-interview feature in §2 is essentially a greenfield rebuild that reuses the endpoint's premium-gating / caps / Gemini plumbing.

**D. Runtime AI cannot browse the web today.** `functions/_lib/gemini-json.js` `buildBody` sends no `tools`; JSON mode (`responseMimeType: application/json` + `thinkingBudget: 0`) is incompatible with Google Search grounding in a single call. **~28 functions call Gemini and none are grounded** (surface listed in §3.2). Pillar W (§3) changes this platform-wide: it adds the web-access capability once, then routes the AI surface through it. Do not assume grounding exists in the current code — you are building it.

---

## 1. Product spec — Resume Builder v3

Premium (`requirePlan('premium')`, `FWEnt`-gated client-side, ship-dark — no new billing). Adopt Igor's **dedicated `resume.html`** as the home for the feature. The portal card becomes a launcher that links to it (see §4).

The north star (Jacob's words): **"a real resume with substantive wording, ready to present to a recruiter — not a jargony list of bullet points."** Every design choice below serves that.

### 1.1 Content model — seed from what's real, never fabricate
The resume is **seeded entirely from the student's real footprint**, then strengthened — never invented:
- their **uploaded resume** (parsed via existing `resume-parse.js` → dossier) — this is the profiling ingest; the builder is the *generator* that produces a **new, upgraded** resume after the student has gained experience through FlightWay,
- **dossier** details + **confirmed experiences**,
- **completed roadmap waypoints** + D1 `artifacts` (portfolio evidence),
- optional **sim-trial** evidence (sanitized, in-request per §0B),
- anything the student types directly.

**The builder actively interviews the student to fill gaps.** When a bullet is thin, the UI/AI asks the specific clarifying question needed to make it recruiter-grade — *"What organization was this internship with?"*, *"How many users did the app reach?"*, *"By what % did you improve it?"* — and **refuses to invent numbers.** This gap-questioning loop is the mechanism that turns raw inputs into substantive, quantified accomplishments. A hallucinated accomplishment is worse than no suggestion.

### 1.2 Wording quality (the core fix)
- Every bullet follows the researched formula **[strong action verb] + [what you did / scope] + [quantified result / impact]** (Harvard/Columbia standard — Appendix A).
- The generation prompt carries a **baked resume-quality rubric** (Appendix A): action-verb bank, quantification requirement, ban on filler/duty-listing, one accomplishment per bullet, ≤2 lines.
- After drafting, a **critique-and-tighten pass** rewrites weak bullets and, where a metric is missing, emits a **clarifying question** instead of a vague bullet.
- The **O*NET dimension tags stay internal** — used to steer which accomplishments to surface for the target career, **hidden from the user** (they were the "jargony" element). Provenance chips (`manual/dossier/resume/artifact/sim_trial/experience`) stay visible and editable; AI output is always a draft.

### 1.3 Industry-tailored format (auto-chosen, deeply customizable)
The resume format is **tailored to the student's target industry**, not one-size-fits-all:
- On open, the builder maps the target career (SOC → career family) to an **industry format profile** (length, single-vs-multi-column — ATS-safe single-column for v1, section order, tone, serif-vs-sans font class, what to emphasize) from the **baked format library** (Appendix A; Fable expands it via its own deep research per §3.0). Where currency matters (evolving industry norms, live postings), it may deepen this with Pillar W grounding (§3).
- The student is offered **several strong template variants appropriate to their industry** (e.g., a finance/quant **LaTeX one-page** variant, a tech project-forward variant, a general reverse-chronological variant) and picks one; the AI recommends a default. **Tailor to the user** — do not show a quant template to someone recruiting in healthcare.
- **Simplicity guard (Jacob's explicit constraint):** sensible AI-chosen defaults up front; **customization lives behind progressive disclosure** so the first screen is never overwhelming. Coherence over bloat.

### 1.4 Features to keep from the donor build
- **Job tailoring** (`resume-tailor.js`): paste a posting → reordered/reworded variant + deterministic keyword-match score + gap list. Keep. The `bulletRef`-must-exist rule (model can't inject fabricated experience) is load-bearing — preserve it.
- **Export:** PDF (print stylesheet), **DOCX** (client-side via fflate), and the new **LaTeX one-pager** for finance/technical families. Keep PDF+DOCX; add LaTeX as a template-driven export.
- **On-page ATS self-check** (`atsCheck`) sharing the same rules as `resume:ats-check`. Keep. ATS-safe single-column only for v1; visually-designed human-reviewer templates are an explicit **later** growth item, not this build.
- Caps: 3 base resumes, 20 tailored versions per email.

---

## 2. Product spec — Mock Interview (rebuild of interview prep)

Premium, ship-dark. Replaces the flashcard flow with a **continuous, stateful, multi-turn mock interview**.

### 2.1 Session shape
Runs start-to-finish like a real interview: **intro → warm-up/behavioral → technical → candidate-questions → close**, one interviewer persona, **8 questions, ~20 minutes, text-only.** Genuine conversational state: the interviewer **remembers earlier answers and follows up** ("You mentioned X a moment ago — walk me through the tradeoff") and **references the student's resume/qualifications** ("Your resume says you built a poker solver — hardest part?").

### 2.2 Adaptivity & realism
- **Adaptive difficulty:** ramps harder when the student does well, eases when they struggle. Difficulty level is carried in session state and adjusted from the running rubric of each answer.
- **Feedback is withheld until the end** — a single **end-of-session debrief** (Jacob's choice), to preserve realism. No per-answer scoring shown mid-interview.

### 2.3 Personas (two named) + optional company mode
- **Two personas the student selects:** a **friendly coach** and a **realistic-pressure interviewer**. Name them; keep tone distinct.
- **Company mode (opt-in, low-emphasis):** the student can enter **a specific company they're actually interviewing with**; the AI then runs a **firm-specific interview** (values, known process, question style). This is a *"preparing for a specific interview"* feature, presented small — not a headline. It is the primary consumer of Pillar W grounding (§3).

### 2.4 Technical questions — per target career, not quant-only
**Real technical questions for any target career** (Jacob: *"Not everyone wants to recruit for Quant. Remember that."*). The interview is tuned **as much as possible to the student's specific target career**:
- Baked **interview playbooks** per career family (Appendix B) carry the structure + **technical-question archetypes** for that family (SWE: coding/system-design; finance/quant: markets/mental-math/brainteasers; consulting: case/estimation; healthcare: clinical/licensure; design: portfolio critique; research/academia: methods; etc.).
- The specific SOC selects the family; **Pillar W grounding (§3) deepens** career-specific and company-specific technical content where baked guidance is thin.

### 2.5 Debrief + metric log over time
End-of-session **debrief report** (saved artifact) + a **metric log** so the student watches metrics improve across sessions. Metrics (Appendix B — behavioral-anchored 1–5, `N/A` allowed):
1. **Communication & Clarity**
2. **Structure** (STAR / logical framing)
3. **Specificity & Evidence** (concrete, quantified)
4. **Technical Accuracy** (only when technical questions were asked)
5. **Composure & Adaptability** (handling follow-ups, curveballs, pressure)
6. **Role/Company Fit** (alignment to target career/firm)
Plus a weighted **overall** score, a short narrative verdict, per-question highlights, and 2–3 concrete "next time" actions. Persist per session (D1, §5) so the metric-log chart is a straight query. Store the debrief + scores + date; storing the transcript is optional and user-owned — keep it lean.

**Cost:** cap **3 mock sessions/day/user**. A session is ~8 turn-calls + 1 debrief call, versus one call per old flashcard — daily cap + per-turn `maxTokens` ceiling + gemini-json timeouts are the guardrails.

---

## 3. Pillar W — Live Web Grounding (platform-wide AI-native freshness)

**This is the flagship of the build and the product's core differentiator** — not a helper for the two features. FlightWay's promise becomes: *Marco and every AI feature stay current with the live web — sourced, dated, up-to-date guidance a human advisor can't match, at a fraction of the cost.* Web access becomes a **standard capability of the entire AI layer**, adopted as operating protocol by every AI-dependent feature. Built once as a shared service (§3.1), then rolled out across the whole AI surface (§3.2). Full spec: [`docs/PILLAR_W_WEB_GROUNDING_DESIGN.md`](PILLAR_W_WEB_GROUNDING_DESIGN.md). Two layers work together: an always-on baked-knowledge floor (§3.0) and the live grounding layer on top of it.

### 3.0 Tier-1 baked knowledge — the always-on, zero-cost floor (ships first)
Fable does its own deep web-research pass at build time (seeded by Appendix A/B) and **hardcodes** reference data the runtime prompts consume, so features work with **zero runtime web calls** as a baseline:
- `functions/_lib/resume-formats.js` — career-family → format profile (length, layout, font class, section order, tone, emphasis, template-variant IDs incl. the LaTeX one-pager) + resume-quality rubric + action-verb bank.
- `functions/_lib/interview-playbooks.js` — career-family → interview structure, behavioral/technical mix, technical-question archetypes, evaluation emphasis, persona guidance.
- SOC → career-family mapping (reuse `FWOnetCatalog`; **no second taxonomy** — repo convention).
Evergreen norms stay baked forever; only genuinely *current* facts get grounded (below). This floor is also what every feature falls back to when grounding is off or over budget.

### 3.1 Design summary — full spec in [`docs/PILLAR_W_WEB_GROUNDING_DESIGN.md`](PILLAR_W_WEB_GROUNDING_DESIGN.md)
Build to the standalone design doc; it is authoritative for this layer. The essentials the rest of this plan depends on:
- **Shared service `functions/_lib/gemini-grounded.js`** — `researchWeb` (a grounded, non-JSON Gemini call, `tools:[{ googleSearch:{} }]`) + `groundedJson`/`groundedText`, which inject a fenced evidence brief then call the existing `callGeminiJson`/`callGeminiText`. Two-step because grounding ⊥ JSON in one call.
- **Wrap, don't modify.** `callGeminiJson`/`callGeminiText` signatures + JSON path stay untouched; grounding is opt-in per call site; every current caller keeps working.
- **Web text is untrusted (top security invariant).** Fence as data, sanitize, cap; never route to tool/DB/exec/auth decisions. Mirror `career-roadmap.js` fencing. Injection-in-evidence probe is required (§6).
- **Cost bounded hard.** Global (not per-user) KV query cache with freshness-tiered TTLs; per-user + global daily budgets; cache hits don't spend budget; ground only when current info actually helps.
- **Flag `GROUNDING_ENABLED`; off-path byte-identical to today.** Bounded degradation: a grounded call that times out / over-runs budget / returns empty falls back to the ungrounded answer, never a 5xx.
- **Provenance UX:** thread `{ sources[], fetchedAt }` to the client and display "as of <date>" + sources where user-facing (Marco especially) — the trust surface and the hallucination guard.

### 3.2 Rollout across the AI surface (~28 Gemini callers → grounding-capable)
Build the layer once, then migrate in priority tiers (adoption recipe in the design doc §7), each with identical fence/cache/budget/fallback discipline:
- **Tier A — migrate first (freshness-critical):** **Marco advisor** (`functions/chat.js`, `functions/career-switch-chat.js`; frontend `assets/js/app/portal-career-advisor.js`) — current role/market/firm/program info shown with sources + "as of <date>" (the flagship surface); **mock interview** (company mode + current technical norms); **resume builder** (industry-format currency + live postings).
- **Tier B — high value:** `functions/career-analysis.js`, `functions/_lib/roadmap-generate.js` / `roadmap.js`, `functions/stretch-fits.js`, `functions/_lib/sector-fit-sheet.js`, `functions/_lib/weekly-plan-gen.js`.
- **Tier C — capability adopted, default ungrounded:** `functions/quiz-enrich.js`, `functions/_lib/dossier-enrich.js`, `functions/sim-*`, `functions/_lib/onet/*-patch.js` — internal/deterministic; sim/vector paths stay read-only unless a specific current-fact need appears.

---

## 4. Merge / reconciliation task list (concrete)

1. **Bring donor files across** (list in §0A) into the base repo, then **reconcile each against current base state** — the donor was built before some of flightway's UI/nav/theme/entitlements work. Specifically:
   - `resume.html`: match flightway's **current** nav markup, brand, tab-bar, theme-boot, and entitlement includes (diff against a current page like `coach.html`/`portal.html`). Do not import igor's older nav verbatim.
   - `resume-page.js` / `resume-render.js`: verify against current `assets/js/shared/*` (auth, `authFetch`, toast, page-boot) APIs; fix any drift.
   - Confirm any `data-lucide` icons used by `resume.html` exist in `assets/vendor/lucide-lite.js`; add them there first if not.
2. **Union `functions/resume-builder.js`** per §0B — the one careful merge. Keep flightway's coordinate helper + freeText + incremental + timeouts + 180d; add igor's simTrials + artifacts + `sim_trial`. Union `EVIDENCE`. Keep flightway's Gemini model config (do **not** import igor's model changes blindly — verify current models in `functions/config.js`/`gemini-json.js`).
3. **Keep flightway's `resume-parse.js`** (newer). Discard igor's.
4. **Portal card → launcher:** update `assets/js/app/portal-resume.js` (and its `portal.html` wiring) so the card **links to `resume.html`** instead of rendering the old inline panel. Retire `assets/js/app/resume-builder.js`'s inline inject if it's now dead — but confirm nothing else references it before deleting.
5. **Extend, don't fork.** Resume-doc/tailor endpoints reuse existing `_lib` helpers (`authFetch`, `getSessionEmail`, `requirePlan`, `checkRateLimit`, `clientIp`, `originFromEnv(env, request)` — note flightway's 2-arg signature vs igor's 1-arg; use flightway's everywhere).
6. **Interview rebuild** extends `functions/interview-prep.js` (or a new `functions/mock-interview.js` if cleaner) reusing its premium-gating/caps/`dailyLimit` peek pattern. Stateless-per-turn, **client holds the transcript** and sends it back each turn (house "no server beacon" pattern, like `sim-mirror.js`), plus the active resume doc + career context; server fences resume/company text as untrusted data (mirror the fencing at `functions/career-roadmap.js` ~L282). Rebuild `assets/js/coach/interview-mode.js` into the multi-turn UI.
7. **No writes to quiz/objective vectors, dossier, or the O*NET store** from either feature — both are strictly **read-only over vector state** (fragile-subsystem boundary). If you're editing anything under `functions/_lib/onet/`, stop; you've left scope.

---

## 5. Data model (migrations — house style: email-keyed, TEXT ISO timestamps, `IF NOT EXISTS`, indexed on email; every query parameterized + `WHERE email = ?`)

- **`migrations/0011_resume_builder.sql`** — bring from donor as-is (`resumes`, `resume_versions`). Verify next-number isn't already taken in base `migrations/`; renumber if it is.
- **New `migrations/00NN_interview_sessions.sql`:**
```sql
CREATE TABLE IF NOT EXISTS interview_sessions (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  career      TEXT,
  soc         TEXT,
  persona     TEXT,            -- 'coach' | 'pressure'
  company     TEXT,            -- optional, opt-in company mode
  scores_json TEXT NOT NULL,   -- {communication,structure,specificity,technical,composure,fit,overall}
  debrief_json TEXT,           -- narrative verdict + highlights + next-time actions
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_email ON interview_sessions (email);
```
Cap history sensibly (e.g. keep latest ~50/email); the metric-log chart reads `scores_json + created_at` ordered by date.

---

## 6. Verification (build these; don't hand-wave)

- `node --check` on every touched JS.
- New **`grounding:check`** script (Pillar W — build this first): asserts (a) with `GROUNDING_ENABLED` off, `groundedJson`/`groundedText` output is byte-identical to the equivalent `callGeminiJson`/`callGeminiText` call (zero behavior change on the flag-off path); (b) an injection string inside a web-evidence block does not alter model instructions or output structure; (c) the global cache dedupes a repeated query (one fetch, not N); (d) over-budget requests fall back without a fetch.
- `npm run resume:ats-check` (donor test — must pass on the merged render module) + `resume:tailor-check`.
- **`npm run test:vectors` must stay green** — proves both features (and the Tier-C grounding migration) stayed read-only over vector state.
- New **`interview:check`** script: asserts (a) a scripted 8-turn transcript produces a debrief with all six metric axes, (b) `N/A` technical axis when no technical question was asked, (c) an injection probe in the resume/company text does not alter interviewer instructions, (d) difficulty state monotonic-ish under strong vs weak scripted answers.
- New **`resume:format-check`** (optional): asserts each career family resolves to a valid format profile + at least one template variant.
- `npm run pages:smoke` with **`resume.html` added to the smoke list** (and the interview page if separate) — real boot catches what `node --check` can't.
- `?v=YYYYMMDDx` busters on **changed/new client assets only**, on **every referencing page**.
- Live check after push: `curl -L` the pages.dev URLs for content + headers.

---

## 7. Phased build (delegation per architect skill; Fable is top tier — spawn Sonnet for bounded UI/research pieces, Haiku for mechanical runs; do fragile/architecture/merge work inline)

**Order (Jacob's choices):** Pillar W foundation first (everything consumes it) → Resume Builder fully done + verified → Mock Interview (depends on the resume doc). Marco's grounding (WA) is disjoint from the resume files and can run in parallel with the R-phases.

| # | Scope | Who | Acceptance |
|---|-------|-----|-----------|
| **W0** | **Pillar W foundation** (design doc §4–§9): `gemini-grounded.js` (`researchWeb` + `groundedJson`/`groundedText`), data-fencing of web evidence, global KV cache + per-user/global budgets, `GROUNDING_ENABLED` flag, `grounding:check` test | **Inline (Fable)** — security/fragile | `grounding:check` green; flag-off path byte-identical to today; injection-in-evidence contained; cache dedupes |
| **W1** | Tier-1 baked knowledge: `resume-formats.js` + `interview-playbooks.js` + SOC→family map (Fable's own deep research, Appendix A/B) | Sonnet (research) + inline review | `resume:format-check` green; families resolve; LaTeX variant present for finance/technical |
| R0 | Bring donor files across; reconcile `resume.html`/JS against current nav/theme/auth (§4.1) | Inline | Page boots via `pages:smoke`; no console errors |
| R1 | **Union `resume-builder.js`** (§0B) — the careful merge | **Inline (Fable)** | Both freeText and simTrial/artifact bodies work; `test:vectors` green; phantom-sim bullets rejected |
| R2 | Wording engine: bullet formula + critique-and-tighten pass + **gap-question loop** (consumes W1 rubric; optional grounding for currency) | Inline (prompt/provenance invariants) | Weak bullets rewritten; missing metrics emit a clarifying question, never invented |
| R3 | Industry template selection UI + progressive-disclosure customization + LaTeX export | Sonnet, bounded | Correct template set per family; first screen not overwhelming; `.docx`+PDF+LaTeX export open cleanly |
| R4 | Portal card → launcher; retire dead inline path (§4.4); ATS self-check wired | Sonnet + Haiku | Card opens `resume.html`; `resume:ats-check` green on shipped code |
| **WA** | **Marco advisor grounding** (`chat.js`, `career-switch-chat.js`) via `groundedJson` + sources/"as of" **provenance UX** (`portal-career-advisor.js`) — the flagship | **Inline** (endpoint) + Sonnet (UI) | Marco returns sourced, dated current info with flag on; flag-off falls back clean; injection contained |
| I0 | Interview data model migration + confirm `interview-playbooks.js` coverage (from W1) | Sonnet + inline review | Families map to playbooks; migration applies clean |
| I1 | **Stateful mock-interview endpoint** (client-transcript pattern, fencing, adaptive difficulty, 8-Q flow, resume-aware; company mode via `groundedJson`) | **Inline (Fable)** | `interview:check` green; injection probe contained; resume line-items referenced; company mode grounded |
| I2 | Multi-turn interview UI (two personas, opt-in low-emphasis company mode, intro→close) | Sonnet, bounded | Full session runs; personas distinct; company field low-emphasis |
| I3 | End debrief report + metric-log persistence + over-time chart | Sonnet + inline (scoring prompt) | Six axes + overall persisted; chart reads history |
| **WB** | Migrate **Tier-B** features (`career-analysis`, `roadmap-generate`/`roadmap`, `stretch-fits`, `sector-fit-sheet`, `weekly-plan-gen`) to grounding-capable | Sonnet per file + inline review | Each path still passes; grounded only where it improves output; `test:vectors` green |
| **WC** | Adopt grounding **capability** in **Tier-C** (`quiz-enrich`, `dossier-enrich`, `sim-*`, `onet/*-patch`) — default ungrounded; vector/sim paths stay read-only | Sonnet/Haiku + inline review of any vector-adjacent file | No behavior change with flag off; `test:vectors` green; vector paths untouched |
| QA | Full §6 checklist, buster audit, `pages:smoke`, live `curl -L` | Haiku runs scripts; Fable reviews diff | All green; raw output in handoff |

**Sequencing:** W0 → W1 first. Then R-phases (Resume) with WA (Marco) parallel — disjoint files. Resume fully done + verified before the I-phases (Interview). WB/WC (rest of the AI surface) after the features are stable. QA last. **W0's flag-off invariant is load-bearing for the whole build — nothing else may regress the current ungrounded behavior.**

---

## 8. Jacob's action items at ship time
1. Apply migrations against remote D1 (`npx wrangler d1 execute flightway-db --remote --file=migrations/0011_resume_builder.sql`, then the interview-sessions migration).
2. **Enable Pillar W grounding** when ready: (a) confirm the Gemini API key/project has **Grounding with Google Search** enabled — it is **billed/quota'd per grounded request beyond the free allotment**, so this is a real cost line, which is exactly why the design doc caches globally + caps daily (§6); (b) provision the KV namespace/prefix used for the grounding cache + budget counters (`gw:`); (c) set `GROUNDING_ENABLED=true`. Leaving the flag **off** ships the entire product on the Tier-1 baked floor with zero web cost and zero behavior change — grounding is purely additive.
3. Tune the per-user + global daily grounding budgets in config once you see real usage; start conservative.
4. Push `Jacob_Work`; smoke the live resume + interview pages and **Marco (sourced/dated answers)** logged in as a premium/beta-grant account.

---

## Appendix A — Resume research reference (starter; Fable expands via its own deep research in W1)

Distilled from current (2026) recruiter/university guidance (sources at end). This is the **seed** for `resume-formats.js` — Fable should verify and broaden it per industry.

**Universal rules (all industries):**
- Reverse-chronological is the most ATS-friendly and recruiter-preferred baseline; single-column for traditional industries.
- Recruiters spend ~7 seconds on first scan → lead with quantified accomplishments, not duties.
- **Bullet formula:** `[strong action verb] + [what you did/scope] + [quantified result]`. ≤2 lines each; one accomplishment per bullet.
- Action-verb bank (Harvard): Analyzed, Built, Conducted, Developed, Executed, Generated, Implemented, Led, Managed, Negotiated, Optimized, Presented, Reduced, Secured, Streamlined, Synthesized. Ban weak openers ("responsible for", "helped with", "worked on").
- Quantify everything possible (%, $, #, time). If a number is missing → **ask the student**, don't invent.
- Export as PDF; no tables/graphics/columns in ATS-safe variant; contact info in the body, not a header/footer.

**Industry / career-family format profiles (starter):**
| Family | Length | Font class | Emphasis | Notes |
|---|---|---|---|---|
| Finance / Quant / IB | 1 page (<7 yrs) | Serif (Georgia/Garamond/Cambria) | Quantified deal/market metrics, certifications (CFA), technical rigor | Offer **LaTeX one-page** variant; conservative design; distinct sub-paths (IB vs FP&A vs quant) differ in keywords/metrics |
| Software / Tech | 1–2 pages (student: 1) | Sans (Calibri/Roboto/Lato) | Project outcomes, technical stack, impact metrics | Project-forward; links to portfolio/GitHub |
| Consulting | 1 page | Serif/clean | Leadership, quantified impact, structured problem-solving | Case-ready framing |
| Healthcare | 2–3 pages | Clean serif/sans | Licenses, certifications, patient/compliance metrics | Credentials block prominent |
| Design / Creative | 1 page + portfolio link | Clean sans | Portfolio does heavy lifting; concise resume | Portfolio link mandatory |
| Research / Academia | CV, long | Serif | Publications, methods, grants | CV not resume — different object; flag if user targets this |
| General business / Sales / Ops / Marketing | 1–2 pages | Sans | Quantified outcomes (revenue, growth, efficiency) | Reverse-chron default |

**Template variants to offer** (student picks, AI recommends default per family): (1) Classic reverse-chronological single-column; (2) Tech/project-forward; (3) **Finance/technical LaTeX one-pager**. More (visually-designed, human-reviewer) are a later growth item.

## Appendix B — Interview playbook + metrics reference (starter; Fable expands in W1)

**Structure archetypes by family** (seed for `interview-playbooks.js`):
- **Behavioral (all families):** STAR (Situation/Task/Action/Result); a strong answer runs 60–90s with the Action carrying most weight; analytical roles weight the *diagnostic process* over the result.
- **Software:** coding problem, CS-concept discussion, system design, past-project deep-dive.
- **Finance / Quant:** markets/accounting fundamentals, valuation/"pitch a stock", **mental math + probability brainteasers**, market-making games (quant).
- **Consulting:** case interview (business scenario + estimation) + fit; some technical/domain.
- **Healthcare / clinical:** scenario + licensure/compliance + ethics.
- **Design:** portfolio critique + process walkthrough.
- **Research/academia:** methods, prior work, teaching.

**Scoring metrics (behavioral-anchored 1–5; the persisted set):**
1. Communication & Clarity — logical, articulate, well-paced.
2. Structure — STAR/framework discipline.
3. Specificity & Evidence — concrete, quantified, own contribution isolated.
4. Technical Accuracy — correctness on technical/case questions (`N/A` if none asked).
5. Composure & Adaptability — handling follow-ups, curveballs, pressure.
6. Role/Company Fit — alignment to target career (and firm, in company mode).
Overall = weighted composite (technical weighted up for technical roles). Anchor each level with an observable behavior in the prompt so scoring is calibrated, not vibes.

**Sources (my starter research, 2026):**
- [Harvard resume template — format, fonts, action verbs](https://resumeoptimizerpro.com/blog/harvard-resume-template)
- [Columbia — strong bullet points](https://www.careereducation.columbia.edu/resources/resumes-impact-creating-strong-bullet-points)
- [Monster — resume trends 2026](https://www.monster.com/career-advice/resume/resume-trends)
- [Resume length by industry](https://www.wobo.ai/blog/how-long-should-a-resume-be-2025/)
- [Duke — business/finance/consulting resume examples](https://careerhub.students.duke.edu/business-finance-consulting-resume-examples/)
- [financecv — LaTeX finance CV template](https://github.com/ArtemySazonov/financecv)
- [M&I — investment banking resume formula](https://mergersandinquisitions.com/free-investment-banking-resume-template/)
- [Karat — technical interview formats](https://karat.com/blog/post/what-are-technical-interviews/)
- [Duke — technical interviewing guide](https://careerhub.students.duke.edu/resources/technical-interviewing-guide/)
- [MIT — STAR method](https://capd.mit.edu/resources/the-star-method-for-behavioral-interviews/)
- [Tech Interview Handbook — coding interview rubrics](https://www.techinterviewhandbook.org/coding-interview-rubrics/)
