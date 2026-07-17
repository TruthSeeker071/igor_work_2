# Resume Builder v2 — Implementation Plan

**Audience:** the Opus 4.8 builder session that will implement this. Follow the
`flightway-fullstack-architect` skill for delegation/verification discipline.
**Repo:** `igor_work_2` (FlightWay 2.0). Delivery = git bundle in the folder root
(sandbox can't push — see `PUSH.md`).

---

## 0. Ground truth — current repo state (read before building)

1. **A resume builder v1 already exists** — Pillar D2, commit `cb73dfd`.
   `functions/resume-builder.js` (dossier + target-SOC top-10 O*NET dims →
   `callGeminiJson` bullets with validated dim tags + coverage meter; premium-gated
   via `requirePlan`, 7d KV cache `rbuild:{email}:{soc}`, daily cap 15, IP rate
   limit 20) and `assets/js/app/resume-builder.js` (portal-card panel, copy
   buttons). **v2 extends this — do not rebuild or duplicate it.** Back-compat:
   the existing `POST /resume-builder` contract keeps working.
2. **Runtime AI is Gemini, not a Claude proxy.** All generation goes through
   `functions/_lib/gemini-json.js` (`callGeminiJson`, thinkingBudget:0, fallback
   cascade, timeouts). Current models: gemini-3.1-flash-lite → gemini-3.5-flash
   (commit `fb00b76`). Free-tier limits are a known launch blocker → cache
   aggressively, cap daily usage, fallback on every call.
3. **Sim telemetry is NOT in D1.** It lives client-side only
   (`fw_sim_events_v1`, `fw_events_v1` ring buffer, max 500 events —
   `assets/js/shared/events.js`), by explicit privacy decision ("no server beacon
   in v1"). `POST /sim-mirror` is stateless: the client sends sanitized trials,
   gets a pattern readout, nothing persists. Therefore the telemetry→bullet
   pipeline must receive trials **in the request body at generation time**
   (sanitized exactly like `sanitizeTrials` in `functions/sim-mirror.js`) and
   persist **only the student-approved bullet text + provenance tag** — never raw
   telemetry rows in D1.
4. **What IS server-side and usable as evidence:** KV dossier
   (`loadDossier(env, userIdFromEmail(email))`), D1 `artifacts` (B3 portfolio
   evidence: id/email/waypoint_id/type/title/note), D1 `vector_snapshots` (A3
   weekly receipts), quiz/objective vectors, the O*NET store
   (`functions/_lib/onet/store.js`). Artifacts are a first-class bullet source —
   the server loads them itself; never trust client-supplied artifact claims.
5. **"No interview prep" non-goal:** interview prep already shipped (Pillar D1,
   `functions/interview-prep.js`). Leave it untouched.

Design pillars for this build: per-job tailored variants, strict two-layer split
(content generation vs ATS-safe rendering — a bug in one can't corrupt the
other), single-column ATS-safe template (multi-column layouts fail ATS parsers,
which read top-to-bottom and scramble columns), provenance on every bullet, no
fabricated content (a hallucinated accomplishment is worse than no suggestion),
no billing mechanics, and a `resume:ats-check` script joining the verify-script
family.

---

## 1. Product spec (v2)

Premium feature (`requirePlan('premium')`, FWEnt-gated client-side, ship-dark
like the rest of Pillar D — no new billing anywhere).

Student flow:

1. Portal card (existing) → opens **`resume.html`**, a new dedicated page.
2. **Base resume**: structured editor (contact, education, experience,
   projects, skills). Seeded from: parsed resume upload (existing
   `resume-parse.js` dossier), AI bullet candidates from `/resume-builder`, B3
   artifacts, and optional sim-trial evidence. Every AI bullet shows a
   provenance chip (`manual / dossier / resume / artifact / sim_trial`) and is
   editable — AI output is always a draft, never silently final.
3. **Per-job variants**: paste a job description → `POST /resume-tailor` returns
   a reordered/reworded variant + keyword-match score + gap list ("this posting
   wants X; nothing in your resume shows it"). Variants list under the base.
4. **Export**: PDF (print stylesheet → browser print dialog) and DOCX
   (client-side, vendored zip lib). Single-column, standard headers, contact in
   body. On-page ATS self-check score computed from the same rules the automated
   test asserts.

Explicit non-goals (v1 of this build): multi-column templates (even opt-in),
cover letters, LinkedIn tools, any billing/trial mechanics, server-side PDF
rendering, persisting raw telemetry.

---

## 2. Data model — `migrations/0011_resume_builder.sql`

Follow house style of `0007`/`0010` (email-keyed, TEXT ISO timestamps,
`IF NOT EXISTS`, indexed on email):

```sql
CREATE TABLE IF NOT EXISTS resumes (
  id          TEXT PRIMARY KEY,          -- crypto.randomUUID()
  email       TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'My resume',
  json        TEXT NOT NULL,             -- canonical resume object (schema §3)
  updated_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resumes_email ON resumes (email);

CREATE TABLE IF NOT EXISTS resume_versions (
  id          TEXT PRIMARY KEY,
  resume_id   TEXT NOT NULL,
  email       TEXT NOT NULL,             -- denormalized for auth checks
  job_title   TEXT,                      -- ≤120 chars
  job_text    TEXT,                      -- ≤6000 chars, the pasted posting
  json        TEXT NOT NULL,             -- tailored resume object
  score_json  TEXT,                      -- {match, matched:[], gaps:[]}
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resume_versions_email ON resume_versions (email);
CREATE INDEX IF NOT EXISTS idx_resume_versions_resume ON resume_versions (resume_id);
```

No separate `resume_bullets` table: bullets live inside the resume JSON with a
`src` field per bullet — provenance travels with the document, and there's no
cross-table sync to break.

Caps: 3 resumes and 20 versions per email (enforced in the endpoint, oldest
version evicted). Every query parameterized; every read/write scoped to the
session email (`WHERE email = ?` — cross-user isolation is a fragile boundary,
treat with auth-path care).

## 3. Canonical resume JSON (the contract between the two layers)

```json
{
  "v": 1,
  "contact": { "name": "", "email": "", "phone": "", "location": "", "links": [""] },
  "summary": "",
  "sections": [
    { "kind": "experience", "heading": "Work Experience",
      "items": [ { "org": "", "role": "", "start": "", "end": "",
                   "bullets": [ { "text": "", "src": "manual|dossier|resume|artifact|sim_trial", "dims": [""] } ] } ] },
    { "kind": "education", "heading": "Education", "items": [ { "org": "", "role": "", "start": "", "end": "", "bullets": [] } ] },
    { "kind": "projects",  "heading": "Projects",  "items": [] },
    { "kind": "skills",    "heading": "Skills",    "flat": [""] }
  ]
}
```

Headings are fixed ATS-standard strings per `kind` — the renderer refuses
unknown kinds rather than improvising. `dims` reuses exact O*NET dimension names
from the registry (`FWOnetVectors`/`FWOnetCatalog` mapping — **no second skill
taxonomy**, per repo convention).

---

## 4. Architecture — files to create/change

### Layer 2 first (zero AI, testable in isolation)

**`assets/js/shared/resume-render.js`** — IIFE exposing `window.FWResumeRender`
AND `module.exports` when `typeof module !== 'undefined'` (so the Node test
imports the exact shipped code). Pure functions, no DOM dependency:

- `toHtml(resume)` → single-column semantic HTML string (h1 name, contact line
  in body text, h2 standard headings, ul/li bullets). Hard bans enforced in
  code: no `<table>`, no CSS columns/floats/grid in the inline style block, no
  header/footer positioning, font stack `Arial, Helvetica, sans-serif`.
- `toPlainText(resume)` → the top-to-bottom text an ATS parser should extract.
  This is the oracle for the parse-order test.
- `toDocxXml(resume)` → `word/document.xml` body string (plain paragraphs +
  heading styles only).
- `atsCheck(resume)` → `{score, issues[]}`: missing contact fields, bullet >
  ~2 lines, non-standard heading, empty section, date-format problems. Shared by
  the on-page score and the test.

**`assets/vendor/fflate-lite.js`** — vendored minimal fflate (zip only, ~8KB
min). Needed solely for DOCX packaging client-side. No other new deps.

**`assets/js/app/resume-page.js`** — `resume.html` controller (IIFE,
`FWResumePage`): editor state (in-memory + `fw_resume_draft_v1` localStorage
autosave), `FWAuth.authFetch` for all API calls, provenance chips, variant list,
export buttons (print → `@media print` stylesheet; DOCX → `toDocxXml` + fflate
zip of static docx skeleton). **No sliders anywhere** (repo-wide ban).

**`resume.html`** — new page following any existing page's skeleton
(`portal.html` head/meta/auth-include pattern), print stylesheet inline.

### Layer 1 (server, Gemini)

**`functions/resume-builder.js`** — extend, keep back-compat. New optional body
fields: `simTrials` (sanitized with a copy of `sim-mirror.js`'s
`sanitizeTrials` — lift it into `functions/_lib/sim-sanitize.js` and import from
both, don't fork it) and `includeArtifacts: true` → server loads up to 10 rows
from `artifacts` by session email. Prompt gains one fenced block per source;
each returned bullet's `evidence` extends the existing `EVIDENCE` set with
`'sim_trial'`. Grounding rule stays: dims validated against the career's real
top-importance list; bullets referencing a sim must name the sim role from the
supplied trials (validate: reject bullets mentioning sims when no trials were
sent). Cache key becomes `rbuild2:{email}:{soc}:{hash(sources)}`.

**`functions/resume-doc.js`** — CRUD for base resumes.
`GET` → list `{id,title,updated_at}` + latest full doc; `POST {id?, title, json}`
→ validate against §3 schema (size cap 40KB, strip unknown keys), upsert;
`DELETE {id}`. Session-gated + premium + `checkRateLimit`. No AI.

**`functions/resume-tailor.js`** — `POST {resumeId, jobTitle?, jobText}` →
1. Load resume (owned by session email) + job text (cap 6000 chars).
2. **Fence job text as untrusted data** — mirror the sanitization pattern at
   `functions/career-roadmap.js:282` (strip prompt-control chars, delimit as a
   quoted data block, instruct the model to treat it as data, not instructions).
3. One `callGeminiJson` call: returns reordered section/bullet selection,
   reworded bullets (each must map back to an input bullet id — the response
   schema is `{picks:[{bulletRef, text}], summary, keywords:{matched:[],gaps:[]}}`;
   any pick whose `bulletRef` doesn't exist in the input is dropped → **the
   model cannot inject fabricated experience**), and keyword gap list.
4. Deterministic match score computed server-side (matched/total keywords), not
   model-asserted.
5. Persist as `resume_versions` row; return variant + score.
   Cache `rtailor:{email}:{hash(resumeId+jobText)}` 7d; daily cap 10
   (`rtailorday:` KV counter, same pattern as `dailyLimit` in resume-builder.js);
   `checkRateLimit` max 20/IP. Wall-clock: single Gemini call, `maxTokens`
   ≤ 2048, rely on gemini-json timeouts; client timeout 60s.

**Nothing in this feature writes to quiz/objective vectors, dossier, or the
O*NET store.** All vector reads go through the existing store helpers. This is
the fragile-subsystem boundary: resume generation is strictly read-only over
vector state. If you find yourself editing anything under `functions/_lib/onet/`,
stop — you've left the feature's footprint.

---

## 5. Verification (build these, don't hand-wave them)

**New script `scripts/test-resume-ats.cjs`** + package.json script
`"resume:ats-check": "node scripts/test-resume-ats.cjs"`. Loads
`assets/js/shared/resume-render.js` directly, feeds a fixed fixture
(`scripts/fixtures/resume-sample.json`), asserts:

1. `toPlainText` emits fields in exact top-to-bottom order (name → contact →
   summary → experience org/role/dates/bullets → education → projects → skills).
2. `toHtml` output contains no `<table`, `column`, `float:`, `position:` and
   contact info appears inside `<body>`-level content.
3. `toDocxXml` text nodes, extracted in order, match the same sequence.
4. `atsCheck(fixture)` scores 100 on the clean fixture and flags each seeded
   defect in a second intentionally-broken fixture.
5. Round-trip: `POST /resume-doc` validator accepts the fixture unchanged.

**Ship checklist:** `node --check` every touched JS · `resume:ats-check` ·
`test:vectors` (must stay green — proves the read-only invariant) ·
`test:entitlements` · `verify:ui` / `pages:smoke` for the new page (add
`resume.html` to the smoke list) · new `?v=YYYYMMDDx` busters on changed/new
client assets only, on every referencing page.

---

## 6. Phases (for the Opus 4.8 builder — delegation per architect skill)

Never spawn above your tier; Sonnet for bounded pieces, Haiku for mechanical
runs; fragile/architecture work inline. Batch the Sonnet briefs (each
self-contained, with acceptance criteria) before dispatching.

| # | Scope | Who | Acceptance |
|---|-------|-----|-----------|
| 0 | Migration 0011 + §3 schema validator (`functions/_lib/resume-schema.js`) — one-way doors | Inline (Opus) | Validator unit-checked in test-resume-ats fixture round-trip |
| 1 | `resume-render.js` + fixtures + `test-resume-ats.cjs` + npm script | Sonnet, bounded | `resume:ats-check` green; no DOM/global deps in render module |
| 2 | `resume-doc.js` CRUD + `resume.html` + `resume-page.js` editor (no AI yet) | Sonnet, bounded | Manual save/load via wrangler dev; caps + auth scoping verified |
| 3 | `resume-builder.js` extension (sim trials via shared sanitizer, artifacts from D1, new evidence values) | Inline (Opus) — touches prompt-injection + provenance invariants | Back-compat body still works; bullets w/ phantom sim refs rejected; `test:vectors` green |
| 4 | `resume-tailor.js` + variant UI + gap/score display | Inline endpoint (fencing + bulletRef validation), Sonnet for UI | Injection probe in job text does not alter instructions; fabricated pick dropped |
| 5 | Export: print stylesheet + DOCX (fflate vendored) + on-page atsCheck score | Sonnet, bounded | DOCX opens in Word/Google Docs; `resume:ats-check` §5.3 passes on shipped code |
| 6 | QA: full checklist §5, `pages:smoke` incl. resume.html, buster audit | Haiku runs scripts; Opus reviews diff before commit | All green, raw script output in handoff |

Phases 1 and 2 are disjoint file sets → dispatch in parallel. 3 blocks 4.

---

## 7. Igor's action items at ship time

1. Apply migration: `npx wrangler d1 execute flightway-db --remote --file=migrations/0011_resume_builder.sql`
2. Push from the bundle clone per `PUSH.md` (this deploys via Pages git build).
3. Smoke the live page logged in as a premium/beta-grant account.
