# FlightWay — Polish Phase Brief (post-audit)

The overhaul is complete and audited. The final audit (2026-07-21, `9b75497..8891115`)
verified the plan against the deployed product, fixed a two-day roadmap outage, closed the
refund gaps, and left a short, *specific* list of things it deliberately did not do.

**This session is that list.** It is not an audit — the auditing is done. Your job is to
land the recorded fixes, then do the Phase C polish the audit deferred, then close the
loop with a live pass. Everything is on `Jacob_Work` at `8891115` and live at
https://flightwayjacobprototype.pages.dev.

---

## Read before writing any code, in this order

1. `CLAUDE.md` — deploy and token rules. Short. Binding.
2. `docs/OVERHAUL_MASTERPLAN_2026-07-20.md` **Part 0** (operating framework — still binding).
   Skip Parts 1–2 unless a task below sends you there.
3. `docs/OVERHAUL_PROGRESS.md` — jump to the **"Final audit — 2026-07-21"** section at the
   end. That is the state of the world. Read its "Findings recorded, not fixed" and
   "Human-gated" lists carefully; the work below comes from them.
4. `docs/CONVERSATION_HANDOFF.md` — the last addendum only ("Final audit of the overhaul").
5. `git log --oneline -10`.

The ledger is trustworthy for this session in a way it was not for the last one: the audit
re-verified its claims. But **file:line references still drift — re-grep before editing.**

---

## Ground rules (binding)

- **Deploy is `git push origin Jacob_Work` and nothing else.** Never `npm run
  deploy:prototype`. Never push `main`.
- **Vanilla JS. Zero new runtime dependencies. No build step.** Extend the existing modules
  (`FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, `FWUser`, `FWPageBoot`, `FWPageVeil`,
  `FWErr`, `FWButtonBusy`, `FWEnt`, `FWPlanSurface`, `FWFeatureIntro`) — never a parallel
  system for something a module owns.
- **Cache busters:** `/assets/*` is `immutable, max-age=1y`. Every changed asset needs a
  fresh `?v=YYYYMMDD<letter>` on every referencing page. **`npm run verify:busters` is now
  a gate — run it before every commit.** Today's latest stamp is `20260721i`; use a new one.
- **One commit per slice**, imperative subject, `npm run gates:unit` (~25s) before each
  commit and `npm run gates` before the push, `git add` with
  explicit paths (never `-A`).
- **Load-bearing invariants** (full list in masterplan Part 0 §0.2). Most likely to bite here:
  client/server math parity (`onet-math.js` ⇄ `_lib/onet/math.js`); `gap-progress-sync` is
  the only server-side vector writer; vector mutations replay in both rebuilds; KEY_MAP
  lives in two files plus the sync registry; every advice prompt carries
  `schoolPromptBlock()`; Gemini JSON calls set `thinkingBudget: 0` and carry `timeoutMs`;
  no `innerHTML` with unescaped user/model text; new `data-lucide` icons go into
  `lucide-lite.js` first; O*NET levels are already 0–100.
- **Never edit `*.plan.md`.**
- **Anything only Jacob can do goes in the ledger's Human-gated list.** Record, skip, keep
  moving. Never stall.

---

## Task 1 — the cap bypass (highest value; do this first)

**`functions/career-roadmap.js`, the roadmap-chat pivot-regeneration path (~:1365).**
It calls `executeGenerateRoadmap` behind the `roadmap-gen` rate limit only — there is no
`checkFeatureLimit(env, email, 'roadmap-generate')`. The main generate path at ~:1506 has
one. So once `PAYWALL_ENABLED` is set, a free user regenerates their roadmap without limit
by pivoting careers through the roadmap chat, while the honest path is capped at one for
life. Dormant today (the paywall is dark), which is exactly why it is cheap to fix now.

This was recorded rather than patched because **the fix needs a product decision you should
make and state, not avoid**: what does hitting the cap look like *mid-conversation*? The
generate path returns a 402 the client renders as `FWPlanSurface.capCard`. In chat, a bare
error would read as Marco breaking. Recommended shape (argue against it if the code
disagrees): the turn still answers — Marco explains the pivot in prose and says the plan
itself needs Flight Plan to rebuild — and the payload carries the cap fields
(`upgrade: true`, `feature: 'roadmap-generate'`) so the client renders the cap card under
the reply instead of a red error. Precedent: WS-G's "a cap is not an error" decision, and
roadmap's own switch from red error to cap card.

Whatever you choose: the spend must be **refunded** if generation then fails (the pattern
is now in this file — `genSpent`), and `npm run test:endpoints` must gain an assertion that
a capped free user's pivot does not regenerate. Extend `test:entitlements` too if the cap
surface changes.

**Gate:** `test:endpoints`, `test:entitlements`, `plan:ui-check`, `node --check`.

---

## Task 2 — the smaller recorded findings

Each is small and independent. One commit each, or one commit for 2b+2c together.

- **2a. `mock-interview.js` propagates upstream error statuses.** A retired model's 404
  becomes our 404, and an upstream 400 becomes our 400 — telling the client the *user* erred
  when the upstream did. Give it the treatment `functions/chat.js` already has
  (`CASCADE_STATUS` and its 429/503 mapping): map upstream failures onto a status that
  describes *our* availability, log the upstream detail server-side. Do not change the
  refund behaviour, and do not leak upstream text into user-facing copy (`fw-errors.js`
  collapsing 5xx into one friendly line is deliberate).
- **2b. `functions/weekly-plan.js` `onRequestGet` has no try/catch.** Any exception is an
  unhandled runtime 500 — the same bare-500 shape that hid two outages. Wrap it to match the
  file's POST handler. `test:endpoints` already executes this path; add the failure-path
  assertion.
- **2c. Dead references.** `FWPage` (`assets/js/shared/billing.js:39`) and
  `FWResumeBuilder` (`assets/js/app/portal.js:984`) are guarded calls to globals **defined
  nowhere in the repo** — donor-legacy no-ops. `assets/js/app/artifacts.js` is loaded by no
  page since the 2026-07-10 streamlining, yet `FWArtifacts` call sites remain in
  `skill-gap-tracker.js:1642` and `portal-flightplan.js:111`. Decide per case: delete the
  dead branch, or wire the module back if the feature is wanted. **Read what the call site
  would have done before deleting it** — a guarded call to a missing module is how a whole
  feature goes silently missing (that is exactly how `roadmap.html` lost its entitlements
  gate). If any of these turns out to be a feature that *should* work, that is a finding,
  not a deletion.

**Gate per slice:** `node --check`, `test:endpoints`, `pages:smoke`, plus `resume:ui-check`
if you touch portal/resume JS.

---

## Task 3 — Phase C polish (the audit deferred this wholesale)

The audit spent its budget on correctness and never got to polish. Bounded, and **do not
restyle things that already work** — this is not a second WS-C.

Walk the surfaces that changed most since the WS-C sweep (`5ec401c`) and were never
re-audited visually: the **coach two-pane frame** (WS-D rebuilt it after WS-C ran), the
**plan surfaces** (WS-G, invisible on the live prototype so nobody has ever *looked* at
them — drive them via `plan:ui-check`'s stub pattern, paywall on), the **feature
interstitials and hint ribbons** (WS-F), and the **roadmap top bar at ≤768px** where the nav
wraps to two rows.

For each surface you touch:
- Dark mode + `prefers-reduced-motion` parity.
- Entrances use `fw-revealed` / `fw-settled` with `FWPageVeil`.
- Empty, loading and error states: `FWErr` for copy, `FWButtonBusy` for in-flight buttons,
  skeletons where a spinner would be vaguer.
- Keyboard and screen-reader basics on anything interactive you change: focus-visible ring
  (the ring-survives-only-in-buttons convention — extend it, don't fight it), sensible tab
  order, labels on icon-only controls.

**Method:** the screenshot/Playwright harnesses in `scripts/`, not a browser session.
`scripts/smoke-plan-ui.mjs` is the model for rendering an authed, paywalled surface
headlessly (route-stubbed `/config` + `/auth/me`, seeded `localStorage` including
`featureIntros` — a page with `data-fw-intro` will otherwise eat your clicks on the
interstitial backdrop).

**Gate:** `layout:check` (270 cells) and `perf:check`, both of which take `--base=<origin>`;
`pages:smoke`; plus the UI smoke for any page you touch.

---

## Traps that have cost previous sessions real time

- **`layout:check` binds port 8934** and a leaked background run holds it. `lsof -ti :8934 |
  xargs kill -9` first. `EADDRINUSE` is not a code failure. The full run outlives a 120s
  tool timeout — run it detached or filtered.
- **`curl` a pages.dev page without `-L` and you get a redirect body**, so greps come back
  empty and read as "stale deploy". Always `curl -L` for HTML.
- **Curling a busted asset URL proves nothing** — `?v=` is a query string and the file
  answers 200 under any stamp. Poll the **HTML** for the new stamp, then fetch the asset and
  grep its body.
- **Cloudflare's prod alias lags the build** and has flipped POP-by-POP; take N consecutive
  clean samples. If a deploy stalls (subdomain 404), re-trigger with an empty commit.
- **`wrangler pages deployment tail <id> --project-name flightwayprototype`** is the fastest
  route to any production error. Needs a full deployment id from `wrangler pages deployment
  list`; fails with "does not have a Pages Function" while the build is still running.
- **When mutation-testing uncommitted work, restore with an inverse `sed`, never
  `git checkout --`** — checkout discards the very fix under test. This cost the last
  session a full re-apply.
- **`originFromEnv()` is a CORS allow-origin** (possibly `'*'`), never a base URL. Use
  `new URL(request.url).origin` — that exact confusion was a live 500 on `profile/quiz` PUT.
- **Backticks in `git commit -m` get shell-interpreted.** Use `-F` with a heredoc.
- **`grep` treats some scripts in this repo as binary** and returns nothing rather than an
  error. Use `grep -a` when a grep comes back suspiciously empty.

---

## Do not regress

- `functions/chat.js` — `reqBody` (NOT `payload`) is the parsed body; the model cascade,
  its logging and the 429/503 mapping; the refunds on failed turns.
- `functions/career-roadmap.js` — the `loadUserBlob` import (its absence was a two-day
  outage) and the `genSpent` refund.
- **Marco persona v2** (`functions/_lib/marco-persona.js`) — 16 assertions in
  `test:marco-voice` pin the balance between its anti-sycophancy and anti-contrarian
  halves. If you edit the persona, keep both halves; refresh goldens with
  `-- --update` only when the change is intended.
- The four upgrade moments in `plan-surface.js`'s header — no nag creep.
- Satellite orbs stay gone from the hub; AI-derived careers stay reachable via search and
  the parent panel's AI-specializations strip.
- `#page-roadmap.active` carries the nav clearance (not `#roadmap-body`).
- Portal rail is intentionally not `position: sticky`.

---

## Protocol

1. Run the full gate suite first and record the baseline in `docs/OVERHAUL_PROGRESS.md`.
   It is 33 gates now — the audit's two additions are `verify:busters` and `test:endpoints`.
   **Use `npm run gates`** (parallel, `scripts/run-gates.mjs`), not a hand-rolled bash
   loop over the gate names: same 33 gates, ~15 min instead of a serial run where
   `layout:check`'s 270 cells alone cost more than the other 32 combined.
   Per-slice, use **`npm run gates:unit`** — 30 offline gates in ~25s, with
   `layout:check` in its 18-cell `--quick` mode. Save the full run for the push.
2. Work in slices, one commit each, gate before each commit.
3. Push at the end of each task, then verify live (`curl -L` + `pages:smoke`).
4. Keep `docs/OVERHAUL_PROGRESS.md` current: one line per slice, every deviation, every
   human-gated item, and every finding you could not verify.
5. Append one addendum to `docs/CONVERSATION_HANDOFF.md` covering this session only.
6. Final report: what you fixed, what you decided (Task 1's UX call, stated and argued),
   what you could not verify and why, and the exact scope line for any follow-up.

**A finding you cannot fix is still a deliverable** — record it with file, line, repro, and
what you tried. And if one of these tasks turns out to be a bad idea on contact with the
code, say so and argue it from the code; this project has recorded several, and they were
right.

---

## Human-gated — record, skip, never stall

Unchanged and still Jacob's: `PAYWALL_ENABLED`, Stripe price/product IDs + webhook secret,
`ROOT_ADMIN_EMAIL`, `DEV_TEST_EMAILS`, `GROUNDING_ENABLED`, the optional remote-D1
derived-zone backfill, the re-seed decision for accounts carrying a server AI personality
patch, and the two live checks that need a real session or a paid API call: the
`<<<FW_UI>>>` chip-frequency conversation on the deployed site, and
`npm run test:marco-voice -- --live`.
