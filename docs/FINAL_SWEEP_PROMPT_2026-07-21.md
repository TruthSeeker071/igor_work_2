# FlightWay — final sweep, audit, polish, deploy

You are finishing the FlightWay overhaul. The overhaul itself is **complete, audited, and
deployed** — do not re-open it. This session is the close-out: kill the one flaky gate,
verify the whole thing green end-to-end, do a last correctness + polish pass over the
surfaces nobody has looked at since they changed, and leave Jacob a short, honest,
human-gated punch list.

Repo root is `/Users/jacobklugerman/Flightway/flightway`. Branch `Jacob_Work` at
`44bc1f2`, clean, pushed, and **live and verified** at
https://flightwayjacobprototype.pages.dev (local and live agree on
`flightway-2.css?v=20260721m` across pricing/portal/roadmap).

---

## Read first, in this order — do not skip

1. `CLAUDE.md` — deploy + token rules. Binding.
2. `docs/OVERHAUL_MASTERPLAN_2026-07-20.md` **Part 0 only** (operating framework, load-bearing
   invariants). Parts 1–2 only if a task sends you there.
3. `docs/OVERHAUL_PROGRESS.md` — the last three sections: "Audit Phase 2", "Artifacts
   re-wire + final audit", "Overhaul close-out". That is the state of the world. Read the
   "Findings recorded, not fixed" and "Human-gated" lists in each.
4. `docs/CONVERSATION_HANDOFF.md` — the last two addenda only.
5. `git log --oneline -15`.

The ledger has been re-verified twice and is trustworthy on *claims*. **file:line
references still drift — re-grep before editing anything.**

---

## Ground rules (binding, all previously earned the hard way)

- **Deploy is `git push origin Jacob_Work` and nothing else.** Never `npm run
  deploy:prototype`. Never push `main` (it is ~300 commits stale by design).
- **Vanilla JS. Zero new runtime dependencies. No build step.** Extend the existing modules
  (`FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, `FWUser`, `FWPageBoot`, `FWPageVeil`, `FWErr`,
  `FWButtonBusy`, `FWEnt`, `FWPlanSurface`, `FWFeatureIntro`, `FWArtifacts`) — never a
  parallel system for something a module already owns.
- **Cache busters:** `/assets/*` is `immutable, max-age=1y`. Any changed asset needs a fresh
  `?v=YYYYMMDD<letter>` on **every** referencing page. Latest stamp in the tree is
  `20260721m`; use a new letter. `npm run verify:busters` is a gate — it requires one stamp
  per asset repo-wide and a stamp no older than the file's last git change.
- **One commit per slice.** Imperative subject. `npm run gates:unit` (~25s, 31 gates) before
  every commit; `npm run gates` (34 gates) before the push. `git add` with explicit paths,
  never `-A`. Backticks in `git commit -m` get shell-interpreted — use `-F` with a heredoc.
- **Never edit `*.plan.md`.**
- **Never stall on something only Jacob can do.** Record it in the ledger's Human-gated list
  and keep moving.
- Speed is a hard requirement: run long commands in the background, never a serial bash
  gate loop, verify with `hub:verify`/node/curl rather than a browser session.

---

## Task 1 — kill the `test:vectors` flake (do this first; it is the top follow-up)

This is the single biggest tax on the repo's gate loop and it is explicitly recorded as
"take it next session, ahead of feature work."

- Measured ~7.5% failure rate; **it reproduced on the very first `gates:unit` run of this
  handoff** (30/31, `FAIL test:vectors`), then ran green immediately after.
- Failing assertion: `scripts/test-vectors.cjs:146` —
  `'re-seed is one-time: the second boot leaves updatedAt alone'`, in the
  `personality seed generation` block. The second `hydrateQuizVectors` boot over a
  deep-cloned already-seeded quiz sometimes rewrites `updatedAt`.
- `test:vectors` sits in the `pure` lane, and `RETRYABLE` in `scripts/run-gates.mjs` is
  `{port, live, solo}` — so this gate gets **no retry** and reds the entire suite outright.
  **Do not "fix" it by widening `RETRYABLE`.** Fix the underlying `updatedAt` churn in
  `assets/js/shared/onet-vectors.js`.
- Method: failing test first. Loop it (`for i in $(seq 1 60); do node
  scripts/test-vectors.cjs; done`) to reproduce and to *prove* the fix — a single green run
  proves nothing against a 7.5% flake. Target 60+ consecutive clean runs.
- Watch the invariants: client/server math parity (`assets/js/shared/onet-math.js` ⇄
  `functions/_lib/onet/math.js`), `gap-progress-sync` is the only server-side vector writer,
  vector mutations replay in both rebuilds, and the `personalityReseedIsLossless` guard
  (which is deliberate — do not delete it; that is a Jacob-gated product decision).

---

## Task 2 — the honest full-suite baseline that has never been taken

The last recorded full `npm run gates` **did not complete** — it was SIGTERM'd
mid-`layout:check` (`GATES_EXIT=143`), `perf:check` never ran, and `test:vectors` was red.
There is currently **no green 34-gate baseline on record for `44bc1f2`.** Take one.

- `npm run gates` (parallel runner). Run it detached — it outlives a 120s tool timeout.
- **Grep the log for `FAIL` explicitly.** Do not conclude green from a `tail`: the last
  session missed a red because the `FAIL` line was 13 lines from the *top* of a 37-line log
  and `test:vectors`' own output ends in `PASS` lines.
- Record the result — gate count, wall clock, any `ok*` retries — in
  `docs/OVERHAUL_PROGRESS.md`.

---

## Task 3 — final correctness sweep on what the audits deliberately left

These are the live "recorded, not fixed" items. For each: decide, act or re-record with a
better reason, and **state the reason in the ledger.** Do not silently carry them forward a
fourth time.

- **`FWArtifacts.promoteFromNote` is unreachable** because the gap-log UI is gone. Whether to
  restore it is a product decision — if you conclude it needs Jacob, say so precisely (what
  the UI would be, where it would live) rather than leaving a one-liner. Note the deliberate
  trap: the missing `artifacts.js` tag on `roadmap.html` is **intentional** and the reasoning
  is pinned in that file's header comment. Do not "fix" it.
- **The pivot cap branch (`functions/career-roadmap.js`) has no test** because it is
  unreachable — `roadmap-generate` is `null` (unlimited) on premium and the pivot is
  premium-gated. That is correct and documented; confirm the reasoning still holds against
  the current `plan-limits.js` cap table and leave it, or bring the test with a cap change.
- **P2-d (`✓`/`○` typographic markers) and P5-d (30 bespoke box-shadows)** in
  `docs/POLISH_AUDIT_2026-07.md` have been deferred twice on unchanged reasons. Either do
  them or close them out explicitly as won't-do.
- Do a fresh grep-level pass for anything the sweeps could have missed in their own class:
  guarded calls to globals defined nowhere, endpoints with no try/catch, `innerHTML` with
  unescaped model/user text, Gemini JSON calls missing `thinkingBudget: 0` or `timeoutMs`,
  advice prompts missing `schoolPromptBlock()`, `data-lucide` icons absent from
  `lucide-lite.js`. Each of those classes has produced a real live defect in this repo.

---

## Task 4 — last polish pass (bounded — this is not a third WS-C)

Phase C already walked the five main surfaces (57 captures, zero page errors). Do **not**
restyle things that work. Confine yourself to:

- The surfaces touched by Tasks 1–3, if any.
- **Dark + light parity on any surface with a hardcoded background.** Three hardcoded-dark
  surfaces have each shipped an invisible-in-dark-mode contrast bug (`#fw-art-title`,
  `#fw-iv-title`, `#fw-intent-title`). The close-out claims the sweep is closed — re-run its
  own cross-check (`grep -rnE "background: *#(0e1730|0b1327|06122b)" assets/css/*.css`
  against every heading emitted into those containers) and confirm no fourth exists.
- `prefers-reduced-motion` parity, `fw-revealed`/`fw-settled` + `FWPageVeil` entrances,
  `FWErr` copy / `FWButtonBusy` / skeletons on empty-loading-error states, and focus-visible
  + labels on anything interactive you change.
- **Method: the Playwright/screenshot harnesses in `scripts/`, never a browser session.**
  `scripts/smoke-plan-ui.mjs` is the model for rendering an authed, paywalled surface
  headlessly (route-stubbed `/config` + `/auth/me`, seeded `localStorage` including
  `featureIntros` — a page with `data-fw-intro` will otherwise eat your clicks on the
  interstitial backdrop).

---

## Task 5 — ship and verify live

1. Full `npm run gates` green (grep for `FAIL`).
2. `git push origin Jacob_Work`.
3. Verify live: `curl -L` the **HTML** for the new buster stamps, then fetch the asset and
   grep its body. Take N consecutive clean samples — Cloudflare's prod alias lags the build
   and has flipped POP-by-POP.
4. Update `docs/OVERHAUL_PROGRESS.md` and add a `docs/CONVERSATION_HANDOFF.md` addendum.
5. **Finish with a single consolidated Human-gated punch list for Jacob** — one section, in
   priority order, each item saying exactly what to set/click and what it unblocks. Current
   contents (verify each against the deployed `/config` before restating it — as of this
   handoff it reports `paywallEnabled:false`, `stripeEnabled:false`):
   - `PAYWALL_ENABLED=true` — every free/paid surface is invisible until this flips.
   - Stripe price/product IDs + webhook secret — until set, every pricing CTA falls back to
     the fake-door intent modal.
   - `ROOT_ADMIN_EMAIL` (admin console), `DEV_TEST_EMAILS` (or Jacob's own account meets the
     free caps the day the paywall turns on), `GROUNDING_ENABLED` (Opportunity Finder +
     deadlines; the retired-model fix is invisible until it is on).
   - The AI-patched-account personality re-seed decision (a data/product call, not a bug).
   - Optional remote-D1 derived-zone backfill; the FW_UI chip-frequency conversation on the
     deployed site; `npm run test:marco-voice -- --live` (costs money); clear the local
     Safari favicon cache once.

---

## Traps that have each cost a previous session real time

- **`layout:check` binds port 8934** and a leaked background run holds it. `lsof -ti :8934 |
  xargs kill -9` first. `EADDRINUSE` exits non-zero and reads exactly like a real gate
  failure — it is not one.
- **`curl` a pages.dev page without `-L` returns a redirect body**, so greps come back empty
  and read as "stale deploy". Always `curl -L` for HTML.
- **Curling a busted asset URL proves nothing** — `?v=` is a query string; the file answers
  200 under any stamp. Poll the HTML for the stamp, then fetch and grep the asset body.
- **`grep` treats some scripts in this repo as binary** and returns nothing rather than an
  error. Use `grep -a` when a grep comes back suspiciously empty.
- **When mutation-testing uncommitted work, restore with an inverse `sed`, never
  `git checkout --`** — checkout discards the very fix under test.
- **`originFromEnv()` is a CORS allow-origin** (possibly `'*'`), never a base URL. Use
  `new URL(request.url).origin`.
- If a deploy stalls (subdomain 404), re-trigger with an empty commit.
  `wrangler pages deployment tail <id> --project-name flightwayprototype` is the fastest
  route to any production error.

---

## Do not regress

- `functions/chat.js` — `reqBody` (NOT `payload`) is the parsed body; the model cascade, its
  logging, the 429/503 mapping, and the refunds on failed turns.
- `functions/career-roadmap.js` — the `loadUserBlob` import (its absence was a two-day
  outage), the `genSpent` refund, and the rate-check-before-cap-check ordering.
- **Marco persona v2** (`functions/_lib/marco-persona.js`) — 16 assertions in
  `test:marco-voice` pin the balance between its anti-sycophancy and anti-contrarian halves.
  Keep both halves; refresh goldens with `-- --update` only when the change is intended.
- `perf:check` keeps its `solo` lane — never parallelize it; it asserts on wall-clock FCP and
  overlapping loads make the gate lie.
- The four upgrade moments in `plan-surface.js`'s header — no nag creep.
- Satellite orbs stay gone from the hub; AI-derived careers stay reachable via search and the
  parent panel's AI-specializations strip.
- `#page-roadmap.active` carries the nav clearance (not `#roadmap-body`). The portal rail is
  intentionally not `position: sticky`.

**Every new assertion gets mutation-validated red before you trust it.** That rule has caught
real defects in this repo every single session it was applied.
