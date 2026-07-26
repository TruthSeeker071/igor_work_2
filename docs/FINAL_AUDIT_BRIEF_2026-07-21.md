# FlightWay — Final Audit & Polish Brief (2026-07-21)

You are closing out a mass overhaul. Seven researched fixes and eight workstreams (WS-A
through WS-H) shipped over roughly a week, plus a tail session that closed the deferred
follow-ups and a bug sweep that fixed a two-week production outage. Everything is on
`Jacob_Work` at `001e6e6` and live at https://flightwayjacobprototype.pages.dev.

**Your job is not to build. It is to verify, to break, and to finish.** Three phases:
confirm the plan actually landed, hunt bugs the gates structurally cannot see, then polish.

---

## Read before writing any code, in this order

1. `CLAUDE.md` — deploy and token rules. Short. Binding.
2. `docs/OVERHAUL_MASTERPLAN_2026-07-20.md` **Part 0 in full** (operating framework — still
   binding), then skim Parts 1–2 for what each fix and workstream was supposed to deliver.
   That document is the spec you are auditing against.
3. `docs/OVERHAUL_PROGRESS.md` — the ledger. Read the checkbox sections, then
   **"Deviations from the plan"**, **"Reported-bug sweep"**, **"Marco persona v2"** and
   **"Human-gated"** carefully. The deviations are where the plan and reality differ on
   purpose; you need to know which gaps are decisions and which are misses.
4. `docs/CONVERSATION_HANDOFF.md` — the last three addenda (WS-G+WS-H, the tail session,
   and anything after).
5. `git log --oneline -25`.

**Trust the ledger for narrative, not for truth.** It was written by the agents who did the
work, including about their own work. Every claim of "shipped" is a hypothesis to spot-check.
Where a ledger entry cites a file:line, re-grep it — the repo has moved since.

---

## Ground rules (binding — violating any of these fails the run)

- **Deploy is `git push origin Jacob_Work` and nothing else.** Never `npm run
  deploy:prototype`. Never push `main`. Cloudflare Pages auto-builds `flightwayprototype`.
- **Vanilla JS. Zero new runtime dependencies. No build step, no frameworks.** Extend the
  existing modules (`FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, `FWUser`, `FWPageBoot`,
  `FWPageVeil`, `FWErr`, `FWButtonBusy`, `FWEnt`, `FWPlanSurface`) — never add a parallel
  system for something a module already owns.
- **Cache busters.** `/assets/*` ships `immutable, max-age=1y`. Every changed asset needs a
  FRESH `?v=YYYYMMDD<letter>` on **every page referencing it** — changed files only, never a
  blanket re-stamp, and never reuse a stamp that already shipped with different bytes. Today's
  latest is `20260721h`; use a new letter.
- **One commit per slice**, imperative subject, gate run before each commit. Use `git add`
  with explicit paths — a previous session used `git add -A` and swept four unrelated fixes
  into a commit whose message described only one of them.
- **Load-bearing invariants** (full list in Part 0 §0.2). The ones most likely to bite:
  - Client/server math parity: `assets/js/shared/onet-math.js` `cosine()` must stay identical
    to `functions/_lib/onet/math.js`. Any scoring change lands in both, same commit.
  - `gap-progress-sync` is the ONLY server-side vector writer. Do not add a second.
  - Vector mutations must be replayed by BOTH `FWOnetVectors.hydrateQuizVectors` and the
    server rebuild, and stay idempotent. Anything applied outside the replay is wiped.
  - KEY_MAP lives in BOTH `assets/js/shared/user.js` and `functions/_lib/user-model.js`; a new
    persisted key needs both plus the user-sync registry (`verify:user`, `test:user`,
    `test:sync`).
  - Every AI advice prompt includes `schoolPromptBlock()` — it reaches most surfaces through
    `buildSurfacePrompt` in `functions/_lib/marco-persona.js`.
  - Gemini JSON calls set `thinkingConfig: { thinkingBudget: 0 }`, carry `timeoutMs`, and
    every retry cascade has a wall-clock budget under the client timeout.
  - No `innerHTML` with unescaped user or model text. Reuse each file's `esc`/`escAttr`.
  - New `data-lucide` icons must be added to `assets/vendor/lucide-lite.js` first.
  - O*NET levels are already 0–100. Never rescale from 0–7 in display code.
- **Never edit `*.plan.md` files.**
- **Anything only Jacob can do goes in the ledger's Human-gated list.** Record it, skip
  forward, keep working. Never stall.

---

## Phase A — did the plan actually land?

Walk the masterplan's seven fixes and eight workstreams against the running product. For each,
answer one question: **is the thing the plan describes actually true of the deployed site?**

This is not a re-read of the ledger. Verify from the artifact:

- **Client behaviour** — the repo's Playwright harnesses are the tool. `scripts/verify-fluid-layout.mjs`
  (`layout:check`, and it takes `--base=<origin>` to run against production),
  `scripts/smoke-pages.mjs` (`pages:smoke`), `scripts/smoke-plan-ui.mjs` (`plan:ui-check`),
  `scripts/smoke-hub-load.mjs` (`hub:smoke`), `scripts/measure-page-perf.mjs` (`perf:check`).
  Copy their setup (route-stubbed `/auth/me`, seeded `localStorage`) when you need a signed-in
  page — that pattern is the fastest way to render any authed surface headlessly.
- **Server behaviour** — `curl -L` against the live origin for anything unauthenticated
  (`/config` is a good probe: it now reports `paywallEnabled`, `stripeEnabled`, `aiEnabled`,
  `aiModels` and the whole `featureLimits` table).
- **Anything you cannot verify** — say so explicitly in the ledger rather than marking it
  green. "Not verifiable without X" is a finding.

Pay particular attention to these, because they are the most likely to have drifted or to have
been marked done on thin evidence:

1. **Fix 1.2's derived-zone re-key** — serving is correct without the D1 backfill, which is
   still human-gated. Confirm the serving path really is correct rather than assuming.
2. **WS-D D2/D6 — the `<<<FW_UI …>>>` contract.** Carried forward twice as unresolved: *does
   Gemini actually emit the block often enough for the suggestion chips and cards to feel
   present?* Deterministic tests cover the parser, not the frequency. This needs a real
   conversation on the deployed site.
3. **WS-F onboarding.** `FWFeatureIntro` + the `featureIntros` key. Check the interstitials
   fire once and stay dismissed across a reload and across sign-out/in.
4. **WS-G free/paid.** Every surface is invisible until `PAYWALL_ENABLED=true` (human-gated).
   `plan:ui-check` is what proves them in the meantime — run it and read what it actually
   asserts before trusting it.
5. **The tail session's four items** — composer-built roadmap prompts, the KV-cached career
   ranker, the personality re-seed, and the two closed checkboxes. The ranker in particular
   has **never run in production**: its first turn is a deliberate cache miss and the fill
   happens in `context.waitUntil`, so nothing has ever confirmed the cached path works. That
   is a real unknown, not a formality.

---

## Phase B — the deep bug scan

### B1. The structural blind spot (highest value — start here)

**No test in this repo executes a Pages Function request path except `test:chat-turn`.**

That gap hid a total Marco outage for two weeks with every gate green: `runChatTurn` read
`payload.starterContext` where the parsed body is `reqBody`, so every request threw
`ReferenceError: payload is not defined` before any model call, and the outer handler turned
it into a bare 500. `node --check` only parses; a scope error is a runtime error. Prompt
suites, contract suites and SSE suites all tested pieces, and none ever called the endpoint.

There are **36 modules in `functions/`** and exactly one of them has an executing test.
`scripts/test-chat-turn.mjs` is the pattern: a fake D1 whose session lookup returns a live
row, a fake KV, a stubbed `globalThis.fetch` for the upstream, and assertions that the handler
**runs** — no ReferenceError/TypeError from our own code, a real payload on the happy path,
and correct behaviour on the failure path.

Extend it. Priority order by blast radius:
`career-roadmap.js`, `weekly-plan.js`, `opportunities.js`, `mock-interview.js`,
`portal-snapshot.js`, `resume-parse.js` / `resume-builder.js` / `resume-tailor.js`,
`sim-generate.js` / `sim-colleague.js` / `sim-feedback.js` / `sim-mirror.js`,
`profile/*`, `career-analysis.js`, `derive-career.js`, `stretch-fits.js`, `admin/*`.

**Validate each new test against a real defect before trusting it** — reintroduce a plausible
bug and confirm the test goes red. A test that has never failed has proven nothing. (The
`payload`→`reqBody` typo turns five `test:chat-turn` assertions red; that is the standard.)

A previous attempt at a *static* undefined-identifier scanner was thrown away at 271 false
positives. Do not rebuild it. Executing the path is the sound version of that idea.

### B2. Guarded globals hiding missing script tags

`roadmap.html` had never loaded `entitlements.js`, and because the call site reads
`global.FWEnt && FWEnt.gate(...)`, the gate was silently unreachable rather than throwing.
The guard turned a missing dependency into a no-op.

Sweep every `global.FWx &&` / `window.FWx &&` guard, resolve which pages reach that code, and
confirm the `<script>` tag exists on each. Also confirm **load order** — everything is
`defer`, so document order is execution order, and `plan-surface.js` before `entitlements.js`
silently renders nothing.

### B3. Cache-buster drift

`quiz.html` once carried `coach.js?v=20260720c` while `coach.html` had `l` — two pages serving
different bytes for the same module, invisible until it misbehaved. Check every asset:
`grep -oh "<file>?v=[0-9a-z]*" *.html | sort -u` should return exactly one stamp per file.
**Worth turning into a script** (`verify:busters`) so it becomes a standing gate.

### B4. Failure paths, not just happy paths

The bug that made a broken Marco into a *locked-out* Marco was this: `checkRateLimit` and
`checkFeatureLimit` spend the user's budget up front (correct for abuse control) and nothing
refunded when the turn then failed server-side. Every retry against the crash burned an
attempt. `refundRateLimit` / `refundFeatureUse` now fix that for `/chat` only.

**Audit every other metered endpoint for the same shape**: does a 5xx leave the user charged?
`roadmap-generate` is the sharpest case — it is a *lifetime* limit of 1 on the free plan, so a
single server-side failure could permanently consume a user's only AI roadmap.

Related: `functions/chat.js` `CASCADE_STATUS` now advances the model cascade on 400/404 rather
than aborting. Check whether `_lib/gemini-json.js` and `_lib/gemini-grounded.js` have the same
abort-on-404 flaw — a retired model there would take down every JSON surface the same way.

### B5. Data mutation safety

`assets/js/shared/onet-vectors.js` re-seeds a stored `personalityVector` when its `seedGen` is
older than current, gated on the re-seed being **provably lossless** (it refuses when
`source` is `gemini-patch` / `profile-building` / `resume-gemini`, because those server
patches have no replay record). This mutates real accounts on their next page load.

Re-derive that safety argument yourself. Specifically: is the source field genuinely preserved
through every layer that rewrites the vector object (`refresh*FromRefine`,
`bleedPersonalityFromObjectiveDelta`)? If any path drops or overwrites `source`, the
fail-closed guard silently opens and real user data is destroyed. This is the single highest
consequence bug class in the repo.

### B6. Security and correctness sweep

XSS via `innerHTML` with model or user text; prompt injection through dossier/resume text
(the fencing pattern lives in `career-roadmap.js`); auth on every endpoint that touches user
data; admin routes returning 404 rather than 403 to non-admins; grounding sources (they are
opaque `vertexaisearch` redirects — origin checks are worthless and raw URLs must never be
shown as if they were the publisher).

---

## Phase C — final polish

Only after A and B. Bounded, and do not restyle things that already work.

- Dark mode + `prefers-reduced-motion` parity on every surface you touch.
- Entrances use the `fw-revealed` / `fw-settled` convention with `FWPageVeil`.
- Empty, loading and error states on every async surface — `FWErr` for copy, `FWButtonBusy`
  for in-flight buttons, skeletons where a spinner would be vaguer.
- Keyboard and screen-reader basics on anything interactive you add or change.
- `layout:check` (270 cells) and `perf:check` are the standing gates; both accept a deployed
  origin.

---

## Do not regress these — all fixed in the last 24 hours

- `functions/chat.js` — `reqBody` (NOT `payload`) is the parsed body.
- The Gemini model cascade, its logging, and the 429/503 mapping. User-facing copy stays
  friendly (`fw-errors.js` collapses 5xx into one line **on purpose** — do not "improve" it
  into leaking server detail); the *server* logs carry the diagnosis.
- Rate-limit and feature-use refunds on failed chat turns.
- **Marco persona v2** (`functions/_lib/marco-persona.js`). v1 read as adversarial because
  five rules pointed the same way and the per-reply self-check asked "am I being too soft?"
  three times with nothing asking the reverse. v2 keeps every anti-sycophancy rule and adds
  the counterweight to each. **16 assertions in `test:marco-voice` pin the shape of that
  balance** — if you edit the persona, keep both halves. Goldens are pinned at
  `PERSONA_VERSION = 'v2'`; refresh with `npm run test:marco-voice -- --update` only when the
  change is intended.
- Satellite orbs are deliberately gone from the hub. AI-derived careers and the per-parent
  count badges stay. **Open question worth closing:** confirm a user can still actually *reach*
  an AI-derived career in the UI now that the orbs are not clickable — via the side panel,
  search, or the badge. If there is no path, that is a real regression and needs one.
- Portal rail is intentionally not `position: sticky`.
- `#page-roadmap.active` carries the nav clearance (not `#roadmap-body`) — check mobile at
  ≤768px too, where the nav wraps to two rows.

---

## Traps that have cost previous sessions real time

- **`layout:check` binds port 8934** and a leaked background run holds it. `lsof -ti :8934 |
  xargs kill -9` first. An `EADDRINUSE` crash is not a code failure.
- **Curling a busted asset URL proves nothing.** `?v=` is a query string; the file answers 200
  under any stamp. Poll the **HTML** for the new stamp, then fetch the asset and grep its
  body for the change.
- **Cloudflare's prod alias lags the build** by a few minutes. If a deploy stalls (subdomain
  404), re-trigger with an empty commit.
- **`wrangler pages deployment tail <id> --project-name flightwayprototype` is the fastest
  route to any production error** and it is what found the outage. It needs a deployment id
  (`wrangler pages deployment list`), and it fails with "does not have a Pages Function" if
  the deployment is still building — wait and retry.
- **Backticks in `git commit -m` get shell-interpreted.** Use `-F` with a heredoc.
- **`git add -A` will sweep unrelated work into your commit.** Stage explicit paths.

---

## Human-gated — record, skip, never stall

`PAYWALL_ENABLED`, Stripe price/product IDs + webhook secret, `ROOT_ADMIN_EMAIL`,
`DEV_TEST_EMAILS`, `GROUNDING_ENABLED`, the optional remote-D1 derived-zone backfill, and the
decision about re-seeding personality vectors for accounts carrying a server AI patch. Full
detail in the ledger's Human-gated section. If your audit finds more, add them there.

---

## Protocol

1. Run the full gate suite first and record the baseline (green/red) in
   `docs/OVERHAUL_PROGRESS.md`. The suite:
   `test:vectors`, `onet:test`, `hub:verify`, `hub:smoke`, `pages:smoke`, `layout:check`,
   `hero:check`, `perf:check`, `verify:aliases`, `verify:user`, `test:user`, `test:sync`,
   `test:school`, `test:entitlements`, `test:admin`, `test:marco-voice`, `test:marco-ui`,
   `test:marco-stream`, `test:chat-turn`, `test:intro`, `test:weekly`, `grounding:check`,
   `test:opportunities`, `interview:check`, `plan:ui-check`, `opportunities:ui-check`,
   `resume:ats-check`, `resume:format-check`, `resume:ui-check`, `resume:tailor-check`,
   `stripe:check`.
2. Work in slices. One commit each, gate before each commit.
3. Push at the end of each phase, then verify live with `curl -L` + `pages:smoke`.
4. Keep `docs/OVERHAUL_PROGRESS.md` current: one line per slice, every deviation, every
   human-gated item, and **every audit finding you could not verify**.
5. Append one addendum to `docs/CONVERSATION_HANDOFF.md` covering this session only.
6. Final report: what you verified, what you fixed, what you could not verify and why, and
   the exact scope line for any follow-up.

**A finding you cannot fix is still a deliverable.** Record it precisely — file, line, how to
reproduce, what you tried — rather than leaving it or papering over it. And if a piece of the
plan turns out to have been a bad idea on contact with the code, say so and argue it from the
code; that is a legitimate outcome, and this project has recorded several.
