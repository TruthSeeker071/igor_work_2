# FlightWay Launch-Readiness Polish Brief (for Opus)

**Read `flightway-fullstack-architect` skill guidance and `CLAUDE.md` before starting.** This brief follows that skill's philosophy — trace causes fully, verify with project scripts, delegate mechanical work below your tier, no exhaustive audits without a concrete lead. Do not skip that skill.

## Goal

Bring FlightWay from prototype to paid-launch quality. Scope is a full site-wide pass: fix stale/broken features, fix UI issues across every page, fix the fit-score bug below, harden auth/data-storage security, and make the product meaningfully more engaging. **Do not build or wire any payment system** — `pricing.html` stays a static/dark page exactly as it is now. Everything else is in scope.

Work in phases. Do not skip Phase 0 — it's what keeps the rest of this from becoming an unbounded audit.

---

## Phase 0 — Grounded inventory (do this before fixing anything)

Produce a written punch list before touching code. For each of the 10 entry points (`index.html`, `portal.html`, `dashboard.html` hub, `quiz.html`, `roadmap.html`, `coach.html`, `profile-build.html`, `career.html`, `auth.html`, `pricing.html` — read-only, no changes), identify:
- Dead/stale features: things that reference removed data, dead endpoints, TODO/FIXME markers, disabled buttons, half-wired UI (a control that exists but does nothing).
- UI issues: layout breaks, inconsistent spacing/typography/color vs. `flightway-theme.css` design tokens, missing responsive behavior, icons missing from `assets/vendor/lucide-lite.js`, broken empty/loading/error states.
- Functional bugs: anything that errors in console, any flow a user can get stuck in.

Grep for `TODO`, `FIXME`, `XXX`, `console.log` debug leftovers, and any `?fw_debug` flag-gated code that shipped un-gated. Check `docs/CONVERSATION_HANDOFF.md` and `docs/AUDIT_REPORT.md` for previously-known issues that may not have been closed out.

Prioritize the punch list: launch-blocking bugs first, then engagement/polish, then nice-to-haves. Report the list before starting Phase 1 fixes so priority order can be confirmed.

---

## Phase 1 — Fix the known critical bug: aggregate sector fit compression

**Confirmed root cause, already traced (two passes, client-code-grounded) — implement the fix, don't re-derive it:**

- `assets/js/shared/onet-math.js:22-31` — `cosine(a,b)` is raw, non-centered cosine similarity (`dot(a,b)/(|a|·|b|)`); `cosinePercent(cos)` linearly maps it to 0–100 with no rescaling. Identical logic is duplicated server-side at `functions/_lib/onet/math.js:20-35` — any fix must be applied to both and kept in sync (there's an explicit client/server parity invariant here).
- Aggregate score blend: `assets/js/shared/onet-vectors.js:887-890` — `overallFitScore = round(0.75*personalityFit + 0.25*objectiveFit)`, used for both career-level and sector/aggregate scores (`onet-vectors.js:983-989`, `assets/js/shared/hub-zone-fit.js:83`). The 0.75/0.25 blend doesn't correct the compression because `objectiveFit` is computed with the same non-centered cosine.
- Personality vector construction (`onet-vectors.js:827-882`, `seedPersonalityFromQuiz`) blends zone centroids weighted by `(sectorScore/100)^2`, then rescales every dimension via `values[i] = clamp100(50 + (values[i]-50)*1.6)` (line 866) and **zeros out any dimension whose deviation from 50 is < 10** (lines 867-871) — collapsing most of the 161 dims to 0 and leaving only a sparse amplified subset as signal. This further narrows what's actually discriminating between sectors.
- **Actual mechanism:** O*NET importance vectors are almost entirely positive and share a large common-mode "generic occupation" baseline (attention-to-detail, conscientiousness, teamwork score moderately-high for nearly every occupation). Raw cosine similarity never removes that shared baseline before the dot product, so cosine between *any* two occupation-derived vectors — related or not — sits naturally around 0.70–0.85. `cosinePercent` maps that straight through, so nearly every score lands in the same narrow high band regardless of true fit.
- **Gold-tier thresholds are independently duplicated in three places**, all calibrated as if scores spanned the full 0–100 range instead of the ~70–85 band that's actually produced: `assets/js/shared/career-target.js:23-31` (`fitRarity`: `>=76` legendary/gold, `>=90` mythic, etc.), `assets/js/hub/marco.js:58,70,82,92` (`isGold: score >= 76`), and `assets/js/hub/hub-canvas.js:843` (`isGold = sectorFit >= 70`). All three sit squarely inside the natural clustering band — that's why "everything is gold."
- The codebase **already has** a `percentileRank()` helper (`onet-math.js:37-40`, re-exported in `onet-vectors.js:408,1726`) used for *individual career* ranking (`onet-vectors.js:1001`, `percentileRankForSlug` at 1714) but **not** applied to aggregate sector/industry fit. The likely fix shape: either (a) mean-center vectors before the cosine dot product to strip the common-mode baseline so the *raw* score actually spreads out, and/or (b) convert the sector-level score shown to the user into a percentile/rank relative to the user's own set of sector scores, so sectors differentiate from each other regardless of the raw formula. Evaluate both — a mean-centering fix corrects the score itself (better long-term, affects every consumer of `computeFitPercent`); a percentile-only fix just changes display and leaves the underlying number still compressed. Prefer fixing the formula if it doesn't destabilize other callers; fall back to percentile display if a formula change is too risky pre-launch. Whichever is chosen, update all three duplicated tier thresholds to match the new distribution, and consider consolidating them to one shared source instead of three independently-tuned copies.
- Trace every caller of `computeFitPercent`/`objectiveFitPercent`/`overallFitScore` before changing anything (`hub-canvas.js`, `hub-dashboard.js`, `marco.js`, `sector-fit-sheet.js`, `hub-zone-fit.js`, and the server-side mirror in `functions/_lib/onet/math.js`) so the fix lands consistently everywhere, not just in one file.
- This sits inside the **hydration → quiz-state → vector merge** and **accumulating math** fragile subsystems called out in the architect skill — trace the full path from quiz answers through `hydrateQuizVectors`/`persistQuizVectors` to the sector score before changing the formula, and verify server (`functions/_lib/onet/math.js`) and client (`onet-math.js`) stay aligned (there is an explicit invariant that these two must match).
- Verify with `npm run onet:test` (vector math) and `npm run test:vectors` (merge/hydration), then a manual check: run the quiz twice with deliberately different answer profiles and confirm sector fit *scores* now spread out and the *ranking* (which sector is #1 vs #5) still matches intuition — not just that the number changed.
- This is the single most important fix in this brief. Do it first, verify it thoroughly, and don't let later polish work touch this file again without re-running the verification above.

---

## Phase 2 — Site-wide feature + UI polish

Work through the Phase 0 punch list, launch-blockers first. Rules that apply throughout:

- Match each page's existing idiom (vanilla JS, existing CSS design tokens in `flightway-theme.css`) — no new frameworks, no parallel systems. Extend `FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, hub/roadmap/coach modules as documented in `docs/ARCHITECTURE.md`.
- Any feature that's stale because the data/flow behind it no longer exists: either finish wiring it properly or remove it cleanly (no dead buttons, no silent no-ops). Use judgment — if it's a half-built feature worth keeping for launch, finish it; if it's vestigial, cut it and say so in the report.
- UI consistency pass: spacing, type scale, color usage, empty states, loading states, and error states should feel like one product across all 10 pages, not like they were built in different sessions (which — per the handoff docs — they were).
- Mobile/responsive check on every page you touch — this product needs to work on a phone at launch.
- O*NET levels are already 0–100 — never rescale from 0–7 in any display code you touch.

---

## Phase 3 — Engagement improvements

The goal is to make the product pull users back and make progress legible, not to add gimmicks. Concretely look at:
- Whether the hub map, roadmap, and dashboard make forward progress *visible* (streaks, completed steps, newly-unlocked content) using state that already exists — don't invent new backend state unless it's clearly needed.
- Whether Marco (the coach) and quiz results feel personalized and specific rather than generic, now that sector fit actually differentiates (Phase 1 fix makes this land much better).
- Copy and empty-state moments: a first-time user with no data yet should see something that invites action, not a blank page.
- Anything that currently requires the user to re-do work they already did (re-answering the quiz, re-entering profile info) that could instead read from existing saved state — this is a common source of "stale" complaints.

Keep every engagement change reversible and additive to existing state — don't restructure `fw_hub_quiz_v1` / `fw_roadmap_v1` schemas without a clear migration path, since other code reads them directly.

---

## Phase 4 — Security hardening: auth + data storage

Full review, not a guess-and-patch pass:

- **Auth boundaries.** Trace every authenticated Function in `functions/` — confirm session cookies are validated on every protected route, confirm `FWPageBoot.requireAuth()` actually gates every protected page client-side *and* the server independently enforces it (client-side gating alone is not security). Check for IDOR: can a user's session ID be used to read/write another user's D1/KV rows by changing an ID in a request? Check password reset and registration flows in `auth.html` for standard issues (rate limiting, timing attacks on user-existence checks, session fixation).
- **Data storage.** Grep every D1 query for string-concatenated SQL vs. parameterized queries — flag and fix any unparameterized query. Check KV/D1 writes for cross-user data leakage in shared/merge paths (`PUT /profile/quiz`, roadmap save, `preserveV3FocusTracker` — per the architect skill's fragile-subsystem list, confirm a no-op save drops no fields *and* can't be pointed at another user's record).
- **XSS/injection.** Grep for `innerHTML` assignments with any user-controlled or Gemini-generated text and confirm proper escaping/sanitization. Any path where user text reaches a Gemini prompt (coach chat, resume upload, quiz free-text if any) must be fenced as data the way `career-roadmap.js` already does it — mirror that pattern, don't invent a new one.
- **Secrets.** Confirm no API keys or secrets are present in client-shipped JS (`assets/js/**`) — they must live only in Functions/environment bindings.
- **Session handling.** Confirm cookies are HTTP-only, appropriately scoped, and that logout actually invalidates server-side session state (not just clearing a client cookie).
- Report every finding with file:line, severity, and what was changed — this is the one area where a slightly longer report is worth it, since Jacob will want to know exactly what was exposed before launch.

---

## Process requirements (apply throughout, not just at the end)

- Delegate mechanical, fully-specified sub-tasks (buster bumps across N pages, running verification scripts, a single isolated CSS fix, grepping for a pattern across files) to Sonnet/Haiku per the architect skill's tiering rules — batch them into single briefs. Do the fragile-subsystem work (Phase 1, Phase 4 auth/data paths) yourself, inline, with full tracing.
- After every meaningful change: `node --check` the touched files, then run the relevant project script(s) — `npm run test:vectors`, `npm run onet:test`, `npm run hub:verify`, `npm run verify:aliases`, `npm run pages:smoke` — not a browser session, except for genuine visual QA on the UI polish pass.
- Bump `?v=` cache-busters only on assets you actually changed, only on the pages that reference them.
- Commit logically (don't bundle the security fixes with UI polish in one commit), push to `Jacob_Work` (`git push origin Jacob_Work` — this is the deploy), and `curl -L` the live pages.dev URL to confirm each batch of changes actually shipped.
- Final report: a prioritized summary — what was launch-blocking and is now fixed, what was polish, what security findings were found and fixed, and anything you deliberately deferred with a one-line reason why. No speculative follow-on work beyond what's in this brief.
