# FlightWay V2 — Progress Ledger

Plan: `docs/V2_MASTERPLAN_2026-07-23.md` (decisions in §1 are LOCKED — do not re-litigate).
Every implementing session APPENDS a section here at session end. Read this whole file at session start, plus `git log --oneline -10`, before doing anything.

Per-session entry format:

```
## Sx — <title> (<date>, <branch@sha range>)
- DONE: <scope items completed, with file:line anchors for the load-bearing bits>
- MIGRATIONS: <actual numbers applied locally (provisional numbers in the plan may shift — record reality)>
- BUSTERS: <assets restamped>
- GATES: <suite result, new/extended gates>
- DEFERRED: <anything from the session scope not finished — never silently dropped>
- DRIFT: <places the repo disagreed with the plan and what was done about it>
- JACOB ACTIONS RAISED: <env vars, Stripe, DNS, merges — mirror into §7 checklist status below>
- HOT FILES: <Phase-0-merged files touched after the Phase-0 merge (final-merge reconciliation list)>
```

## Jacob checklist status (mirror of plan §7 — update as items complete)

> **S20 verification note (2026-07-25):** every "apply migration" item below is
> DONE — `d1_migrations` on the shared remote D1 carries `0001`–`0027`
> (verified directly, `wrangler d1 execute … --remote`). `npm run verify:env`
> passes 28/28. The remaining OPEN items are consolidated, ordered and
> explained in **`docs/MERGE_RUNBOOK_V2.md`** (§7, the launch-follow
> checklist) — that file is now the authoritative to-do; the entries below are
> kept as the historical record.
- [~] Phase-0 merge to main + prod migrations  (**Phase 0 = S1+S2+S3 is now CODE-COMPLETE and green on Jacob_Work.** Migration 0017 APPLIED to prod D1 2026-07-24; migration 0018 still pending. The main merge itself is Jacob's — the ordered runbook is in the S3 entry below.)
- [ ] (optional) `MRR_MONTHLY_CENTS` on the production Pages project — the premium monthly price in cents (e.g. `1200`). Unset → the admin Overview shows paid-count + plan breakdown but the MRR tile reads "—" instead of an estimate (never a fabricated number).
- [ ] MAILING_ADDRESS (Pages + cron worker)
- [x] UNSUB_SECRET (cron worker, matching Pages value) — SET in all three stores
      (verify:env, 2026-07-25/S20). Byte-equality is unverifiable by tooling; if
      unsubscribe links ever fail signature checks, the rotate-everywhere block
      is in the runbook/protocol.
- [x] ROOT_ADMIN_EMAIL confirmed set — verified on BOTH Pages projects (verify:env, 2026-07-25/S20)
- [ ] Optional: Turnstile keys
- [ ] Optional: CF Access on flightwayjacobprototype.pages.dev
- [ ] Google OAuth client + GOOGLE_CLIENT_ID/SECRET (both envs) — **S5 code SHIPPED to Jacob_Work @00bc72c, flag-dark.** Prereq: apply migration 0019 first (createGoogleUser needs google_sub/verified_at). Buttons hidden + endpoints inert until both env vars are set. See S5 entry's Jacob actions for the console setup + redirect URIs.
- [ ] hello@flightway.ai alias confirmed receiving
- [ ] Resend SPF/DKIM on flightway.ai confirmed
- [ ] Stripe referral coupon + promotion code → STRIPE_REFERRAL_PROMO_ID — **S15 shipped the
      code that reads it.** Unset is a legitimate state: the referrer still earns their credit,
      the referee just does not get a free month, and every invite surface says so instead of
      promising one. Two Stripe modes = two coupons (test for the prototype, live for prod);
      `priceIdFor()`-style mode switching does NOT apply here, so set the var per project.
- [ ] **Add `invoice.payment_succeeded` to the Stripe webhook endpoint's event list** (both
      modes) — S15. It is the ONLY event that proves a subscription referee actually paid, and
      the referrer's credit hangs off it. Without it, subscription referrals sit at `signed_up`
      forever and no credit is ever issued. One-time (Lifetime/Sprint) referrals credit off
      `checkout.session.completed` and are unaffected.
- [x] **Apply migration 0023 (`shares`, `users.referral_code`, `referrals`) to the shared
      remote D1** — S15. Until then: the share card still renders and still downloads (that
      path is pure client canvas), but "create a public link" reports link sharing is off,
      `/s/<id>` 404s, `/r/<code>` redirects without binding, and the invite card says so out
      loud. All by design; none of it an error.
- [x] **Apply migration 0024 (`scorecards`) to the shared remote D1** — S16. Until then the
      Readiness Scorecard panel on the Flight Plan says "not switched on yet" in a sentence and
      a run is refused *before the meter is touched*, so no free account can lose its one
      lifetime taste to a pending migration. All by design; none of it an error.
- [x] **Apply migration 0025 (`contacts`) to the shared remote D1** — S17. Until then the
      Network mapper panel on the Flight Plan says "The network mapper is not switched on
      yet." in a sentence, every write is refused the same readable way, and a draft is
      refused *before* the meter is touched — so no free account can lose one of its two
      monthly drafts to a pending migration. All by design; none of it an error. **This
      feature needs NO new env var and no grounding**: it makes zero web calls, so unlike
      S9/S16 it adds no per-night cost and does not care whether `GROUNDING_ENABLED` is set.
- [x] **Apply migration 0026 (`interview_seasons`, `terms`, + two `interview_sessions`
      columns) to the shared remote D1** — S18. Until then the Interview Season and
      Your-term panels on the Flight Plan both say "not switched on yet" in a sentence,
      every write is refused the same readable way, and no end-of-term bonus can be
      granted. The mock-interview debrief is unaffected: `seasonStampFor` probes for the
      table and the two ALTERed columns ship in the same migration, so one null keeps the
      legacy INSERT correct. All by design; none of it an error. **No new env var and no
      new cron cost**: the season's one grounded call happens on a Pages Function when a
      student starts a season, is cached per career slug for a month, and degrades to the
      built-in playbook when `GROUNDING_ENABLED` is off.
- [ ] (optional) **`SCORECARD_AUTO_DAILY_CAP` on `flightway-cron`** — accounts per night for the
      S16 quarterly readiness sweep (default 20). Only bites once the cron's
      `GROUNDING_ENABLED` + `GEMINI_API_KEY` pair is set. **Note the cost coupling: flipping
      that pair for S9's nightly Deadline Radar now also switches on this second, more expensive
      consumer** — one scorecard is three live web calls plus a 2,200-token shaping call.
      `npm run verify:env` prints both per-night caps whenever the flag is on.
- [x] **Apply migration 0027 (`nps_responses`, `testimonials`) to the shared remote D1** — S19.
      Until then the NPS card is never raised (the eligibility read answers `ready:false`, so
      nothing renders), every write is refused readably, and the quote slot on the landing and
      pricing pages stays hidden — which is identical to its correct state before the first
      approval, so nothing looks broken. All by design; none of it an error. **No new env var,
      no cron change, no grounding cost**: the card makes no model calls at all.
- [ ] **Approve the first testimonials in the admin console** — S19. Nothing publishes itself:
      quotes land `pending` and appear on the homepage and pricing page only after a human
      approves one, and the mutation needs console elevation (like grants). A student's name
      and school are stored ONLY if they ticked the box for each, so an approved quote can
      legitimately be anonymous.
- [ ] **Skim `/career-centers` and `/community` copy before the final merge** — S19. They are the
      first pages on this site aimed at somebody who can write a purchase order. Career-centers
      makes four narrow claims and states pilot pricing as negotiated with no number; community
      promises a forum with no date.
- [ ] Decision: Semester Pass / Gift products (Jacob-gated proposals) — **S19 shipped both as
      design-complete cards behind `SEMESTER_PASS_ENABLED` / `GIFT_ENABLED` (plain env booleans,
      default off).** Setting one to `true` reveals a card whose button captures interest and
      nothing more — that part is an env flip. Making either CHARGE is a follow-up code change:
      a Stripe product + price **per mode** (test for the prototype, live for prod), a `SKUS`
      entry in `functions/_lib/stripe.js`, a grant branch in `functions/stripe/webhook.js`, and
      for Gift a redemption subsystem that does not exist. Semester Pass is the cheap one — it is
      `sprintGrant` with a different day count. Deliberately not written: §5 S19 says wire Stripe
      only after your go, and D16 says no silent price changes.
- [~] Final V2 merge runbook — WRITTEN by S20 (`docs/MERGE_RUNBOOK_V2.md`);
      what remains of this item is the execution itself, which is yours (D26)
- [ ] Search Console verified + sitemap submitted — **S13 gave this something to submit:
      `https://flightway.ai/sitemap.xml` is now generated and carries 790 URLs (7 static
      pages + the `/careers` directory + ~780 server-rendered career pages). Do it AFTER
      the final V2 merge, not before — on production today every one of those career URLs
      still 404s, and handing Google 780 dead links is worse than submitting nothing.**
- [ ] (Optional) Bing Webmaster Tools
- [x] **Apply migration 0018 (`contact_messages`) to prod D1** — S2, at the Phase-0 merge
- [x] **Apply migration 0020 (`deadlines`) to the shared remote D1** — S9. Until then the
      Deadline Radar is empty, the T-3/T-14 alert emails send nothing, and the deadline read
      path silently falls back to the old KV cache. All by design; none of it an error.
- [ ] **`npm run deploy:cron` — now load-bearing, not optional.** S9 added the deadline alerts +
      the nightly radar refresh; S10 added a commitments block to the Monday digest; **S12
      added an application-moves line to the digest and the evidence/applications sections
      to the Month in Review**; **S17 added the stale-outreach-draft nudge to the digest**;
      **S18 added a daily term-boundary step (`runTermRituals`, the two Semester Loop
      emails) and the "week 6 of 15" line to the digest**; **S11
      rewrote the dispatcher entirely** (paywall filter deleted so free users are mailed at all,
      rebuilt digest, Month in Review on the 1st, scheduled broadcasts) **and added a third
      trigger, `0 * * * *`, which only a deploy registers.** No git push deploys the standalone
      Worker, so until you run this the cron keeps sending exactly what it sends today: a
      paid-only Monday digest, no review, no broadcasts. One run covers all three sessions.
- [x] **Apply migration 0021 (`broadcasts`) to the shared remote D1** — S11. Until then the
      admin composer can draft, preview and test-send but cannot queue (the panel says so
      out loud), and the cron's broadcast step finds no table and returns. All by design.
- [x] **Apply migration 0022 (`applications` + artifact link columns) to the shared remote
      D1** — S12. Until then the Applications tab renders an explicit "not switched on yet"
      notice, the Opportunity Finder's Save button reports the same sentence, and artifacts
      save without their new link column. All by design; none of it an error.
- [ ] **`MAILING_ADDRESS` + `UNSUB_SECRET` are now blocking.** S11 is the session that starts
      sending free users real volume (weekly digest + monthly review + broadcasts). Without
      the first, every one of them prints "FlightWay, Inc." where CAN-SPAM requires a physical
      address; without a matching second value on the cron Worker AND both Pages projects,
      every unsubscribe link in all of them fails. `npm run verify:env` prints the rotation.
- [ ] (optional) **Nightly Deadline Radar refresh** — needs BOTH on `flightway-cron`:
      `GROUNDING_ENABLED = "true"` (uncomment in `workers/cron/wrangler.toml`) and a
      `GEMINI_API_KEY` secret. Optional `DEADLINE_REFRESH_DAILY_CAP` (default 50/night).
      `npm run verify:env` warns on the half-configured pair. Alerts do NOT need either.
- [ ] **Legal review of privacy/terms/security by an attorney** (D21 — the pages say so out loud)
- [ ] **Decide: state of incorporation + venue** for the Terms governing-law clause (S2 refused to guess)
- [x] ~~**Decision (S7 found it, S8 executes it): the Weekly Flight Plan is premium-gated
      on BOTH live sites right now.**~~ **DONE in S8.** Both `requirePlan` calls are gone
      from `functions/weekly-plan.js`, and `functions/receipts.js` followed it (receipts
      are the Flight Plan's own progress evidence — a free loop with a locked evidence
      panel is a wall in the middle of the thing §4 says never to meter). The cost shape
      turned out mild: `/weekly-plan` generates once per user per WEEK, which is the
      cheapest recurring Gemini call in the product. **Deliberately left unmetered** —
      no `FEATURE_LIMITS` row — because §4 says "the core habit, never meter it."

## Sessions

## S1 — Analytics engine (beacon + instrumentation) (2026-07-23, Jacob_Work@62207d2..5d6389e)

- DONE:
  - **Migration `0017_analytics.sql`** — `events` (13 cols + 5 indexes), `events_daily`
    (PK `(day,name)`), and `server_errors`. The third table is S3's, created now because
    §5 S3 says "fold into 0017 if foreseen" and Phase 0 should ship ONE migration.
    Nothing reads or writes `server_errors` yet. `user_id` holds the normalized email,
    consistent with every other table in this schema (`users.email` is the PK) — a hash
    would have cost S3 every dashboard join and bought nothing, since the row is
    account-linked by definition. Privacy sits one level up instead (no PII in props,
    identity never taken from the request body).
  - **`functions/_lib/events.js`** — the shared contract: `REGISTERED_EVENTS` (51 exact
    names) + `ALLOWED_PREFIXES` two-tier allowlist, `scrubProps()` PII lint,
    `sanitizeBatch()`, `writeEvents()` (one `batch()` per request), `logServerEvent()`,
    `rollupDay()`/`pruneEvents()`, `classifyUa()`, `analyticsEnabled()`.
  - **`functions/events.js`** — `POST /events`. 204 to everything including every
    rejection; all work inside `waitUntil` so the browser never waits; DNT header,
    bot UA, over-size body, malformed JSON and the kill switch each drop silently;
    `checkRateLimit` 120/hr per anon+IP; `user_id` read from the session cookie and
    **never** from the body (`functions/events.js:96`).
  - **`assets/js/shared/events.js` v2** — `FWEvents.log(name, props)` API unchanged
    (all pre-S1 call sites keep working). Adds `fw_anon_v1` uuid, `fw_anon_sess_v1`
    (30-min gap → `session_start`), `fw_attr_v1` first-touch utm/ref written once and
    never overwritten, `fw_evq_v1` durable queue, size-aware batching, `sendBeacon` on
    `pagehide`/`visibilitychange`, 15s interval flush, `fetch(keepalive)` fallback, DNT,
    `/config` kill switch. **Arms at parse time, not DOMContentLoaded**
    (`events.js:410`) — deferred scripts all run before that event, so waiting would
    have silently dropped the beacon for anything logged during another module's init.
  - **`/config` serves `analyticsEnabled`** (`functions/config.js:45`), default true.
  - **Instrumented 26 new client call sites** across quiz-app, roadmap, roadmap-tree,
    skill-gap-tracker, opportunity-finder, auth, app-nav, billing, entitlements,
    plan-surface — quiz funnel, gate, roadmap generate/commit/extend, tree, step
    check-off, skill-gap, opp search, signup/login/identify, nav, paywall, upgrade,
    checkout start. Every one is guarded against re-render double-fire; the two
    load-bearing guards are `qzLastViewedIdx` (`quiz-app.js:654` — `qzRenderQ` re-runs
    on every keystroke in the school field) and `lastGapViewSig`
    (`skill-gap-tracker.js:2131`).
  - **`roadmap_committed` lives at the chokepoints**, not the buttons
    (`roadmap.js:1750`, `roadmap.js:1799`): there are TWO track entry points (drawer
    button and the preview rail's "Track in Flight Plan"), and only the chokepoints
    know whether the 4-branch cap refused the change. It counts persisted state.
  - **Server-side revenue events** — `checkout_success` and `plan_changed` written from
    `functions/stripe/webhook.js` (`:97`, `:150`, `:199`) so the numbers that pay for
    the product do not depend on a browser surviving the Stripe redirect. Routed
    through `applyGrant`'s new `prevPlan` param so `plan_changed` carries a real
    from→to; refund revocation logs too, guarded on `revoked`.
  - **Daily rollup + 90-day prune** — second cron trigger `0 4 * * *`
    (`workers/cron/wrangler.toml:13`) dispatched on exact `event.cron`
    (`workers/cron/index.js:22`). Idempotent: `rollupDay` deletes the day before
    re-inserting, so a retry can never double-count. Rolls up YESTERDAY, so no
    dashboard shows a fake dip at the right edge.
  - **`docs/EVENTS.md`** — the living registry, 51 events, with the pipeline diagram,
    the props rules, and an explicit S3 dashboard caveat about quiz back-navigation.
  - **`.assetsignore`/`_redirects` checked** — `docs/*` is already 302'd, so EVENTS.md
    is not publicly served; `/events` collides with nothing.
  - **Adversarial review pass over the instrumentation diff** (correctness / frequency /
    privacy lenses per file) found and fixed five real defects that the gates could not
    have caught, because a miscounted event still logs, still returns 204, and still
    looks healthy:
    1. `paywall_view{mock-interview}` fired on EVERY coach.html load for free users —
       `interview-mode.js` pre-gates the body of a hidden overlay at build time. Worse,
       the once-per-page dedupe then suppressed the two real views. Now `lock()` only
       counts a surface the student can actually see (`getClientRects()`), and
       `openPanel()` calls the new `FWEnt.notePaywallView()` at the reveal
       (`entitlements.js:79`, `interview-mode.js:716`).
    2. `roadmap_committed{track}` missed the preview rail entirely — the flow the
       product leads with. Moved to the chokepoints (see above).
    3. `tree_interact{node_open}` counted preview-mode canvas taps, which open nothing
       and are unboundedly repeatable. Now a distinct `preview_jump` kind
       (`roadmap-tree.js:1479`).
    4. `opp_search` missed the school-change re-search — a different server cache key,
       so a genuinely new search (`opportunity-finder.js:334`).
    5. `skill_gap_view`'s de-dupe signature went stale on two of the three panel-close
       paths, swallowing a genuine re-open. Added `resetGapViewSig()`
       (`skill-gap-tracker.js:2352`) wired into both.
    One finding was accepted rather than fixed: `quiz_q_answer` legitimately re-fires
    on back-then-forward, so it is a documented dashboard caveat in EVENTS.md, not a
    client-side suppression.
- MIGRATIONS: **0017** (`migrations/0017_analytics.sql`) — **APPLIED to the shared remote
  D1 on 2026-07-24 at Jacob's instruction.** `wrangler d1 migrations list` showed exactly
  one pending migration beforehand (checked first, because `apply` runs everything
  pending and 0014 is a `DROP TABLE`), 12 commands executed, and `list` now reports
  none pending. 3 tables + 8 indexes verified present via `sqlite_master`.
  **Note the invocation: `--env production` is REQUIRED.** The D1 binding lives under
  `[env.production]` in `wrangler.toml` (the top-level block deliberately has no D1
  binding — see 0bfacc7), so the bare `wrangler d1 migrations apply flightway-db
  --remote` from SETUP.md fails with "Couldn't find a D1 DB with the name or binding".
  The working command, for the S20 runbook:
  `npx wrangler d1 migrations apply flightway-db --remote --env production`
- BUSTERS: `?v=20260724a` on all 12 changed assets across every referencing page
  (events, feature-intro, auth, app-nav, billing, entitlements, plan-surface, quiz-app,
  roadmap, roadmap-tree, skill-gap-tracker, opportunity-finder). NOTE the stamp is the
  **UTC** date — `verify-busters.mjs` derives a dirty file's date from
  `new Date().toISOString()`, which was already 07-24 while local time was 07-23.
  `events.js` was newly added to `auth.html` and `404.html`, which had no telemetry at
  all — auth.html being the primary conversion page.
- GATES: **37/37 green in 58.8s** (baseline at session start was 36/36 in 59.7s).
  - NEW **`test:events`** — allowlist + prefix tiers, EVENTS.md↔code parity in BOTH
    directions, a lint over every literal `FWEvents.log` name in the client, the PII
    scrub, batch/body caps, the endpoint executing against fake D1/KV, identity being
    server-derived, DNT/bot/kill-switch/malformed silent-drop paths, rate limiting,
    rollup math + idempotency + prune cutoff, client↔server constant drift, **and a
    section that runs every real SQL statement against the real migration in
    `node:sqlite`** (the stub only pattern-matches SQL — a column typo would otherwise
    have shipped green).
  - EXTENDED **`test:endpoints`** with `POST /events` (executes clean, 204, auth-OPTIONAL
    both signed-in and signed-out). While there, `fakeDb` gained a real `batch()` and
    `bind()` now returns a fresh statement, matching D1's actual semantics.
  - CLAUDE.md gate counts updated 33→34 offline, 36→37 total.
  - LIVE on the prototype @b8f9d61, curl-verified after the deploy landed:
    `POST /events` → **204** (real UA and `DNT: 1` alike), `/config` carries
    `analyticsEnabled: true`, and the served `events.js` is the v2 file.
    NOTE for future sessions: `npm run env:status` reported "serving the branch tip"
    while the FUNCTIONS bundle was still the old one (`/config` had no
    `analyticsEnabled`, `POST /events` 405'd for ~40s after the push). The static
    asset check is worthless here on its own — `/assets/...?v=<new>` returns 200
    regardless, because the stamp is a cache-buster, not a route. Curl a FUNCTION
    to prove a deploy.
- DEFERRED (nothing silently dropped):
  - `upgrade_click` only fires on pages that load `plan-surface.js`; `index.html` links
    to pricing without it. Not a real hole — that step is already measurable as
    `page_view` on /pricing.html plus `pricing_view` — but the four upgrade MOMENTS
    (D18) are all on plan-surface pages, so leaving it is deliberate.
  - Two sim CTAs navigate via `location.href = 'pricing.html'`
    (`sim-engine.js:601,1263`) rather than an anchor, so the delegated listener misses
    them. Small, known under-count.
  - `plan_cap_hit` now covers marco-chat and roadmap-generate; other endpoints that can
    402 do not all render a logged cap card. A full sweep belongs with S8's metering work.
  - `server_errors` is a table with no writer. S3 adds `logServerError()` + the panel.
  - `pages:smoke` deliberately does NOT assert a live `/events` 204 — the route does not
    exist until this deploys, so the assertion would make the suite red before the push.
    Post-deploy curl is in the Jacob list instead.
  - `Flightway.html` left uninstrumented: it is a redirect shim whose head script always
    ends in `location.replace()`, so a deferred tag would either not run or emit a
    phantom `page_view` that double-counts the destination. S2 investigates the file.
- DRIFT (repo disagreed with the plan; repo wins):
  - **Plan §2 says 22 pre-S1 events. There are 27.** `feature-intro.js` emits
    `feature_intro_shown/completed/skipped/upgraded` and `feature_ribbon_dismissed`;
    four are built by string concat (`'feature_intro_' + outcome`), which is why a grep
    for literals never found them. All five are now registered and documented, and the
    gate's call-site lint skips concat fragments explicitly.
  - **Adding `page_view` to the local ring buffer silently changed product behaviour.**
    `feature-intro.js visitedPage()` treated ANY ring entry for a page as "the student
    did something there"; an automatic `page_view` would have flipped that to "loaded
    once" and suppressed the Marco intro on the very first visit to coach.html. Fixed by
    filtering the automatic events (`feature-intro.js:399`). This was not in the plan.
  - Plan §5 S1 asks for `gate_view` and `reveal_view`. `gate_view` shipped;
    `reveal_view` does not exist yet — the post-quiz reveal is S6's build.
  - Plan lists `identify` as linking anon→user server-side. Implemented with no mapping
    table: `user_id` comes from the session cookie on EVERY row, so `identify` is purely
    the marker event. History is never retro-rewritten, exactly as specified.
  - `opp_search` can only ever emit `cap_state: 'ok'|'locked'` — `/opportunities` is a
    binary `requirePlan('premium')` gate with no counter in `FEATURE_LIMITS`, so there is
    no `'capped'` state to observe.
- JACOB ACTIONS RAISED:
  1. ~~Apply migration 0017 to the shared remote D1~~ — **DONE 2026-07-24** (Jacob said
     "apply the migration and deploy"). See MIGRATIONS above.
  2. ~~`npm run deploy:cron`~~ — **DONE 2026-07-24.** `flightway-cron` version
     `6b74a49a-05a4-43a9-87f6-a077e2380eda`, both triggers registered: `0 14 * * 1`
     (weekly digest, logic untouched) and `0 4 * * *` (the new rollup). The first rollup
     fires 04:00 UTC and will summarize the day before.
  3. **END-TO-END VERIFIED IN PRODUCTION.** A live beacon to the prototype returned 204
     and 3 of 4 posted events landed in `events`, each transformation confirmed by
     reading the row back: the unregistered name was rejected; `?secret=…` was stripped
     from `path`; an `email` prop was scrubbed while `{idx, phase}` survived; the
     referrer was reduced to `www.linkedin.com`; `utm_source` landed as a column;
     `ua_class` was classified `mobile` from the UA; `user_id` was NULL for the
     anonymous caller. The rollup's `GROUP BY` was then run read-only against the real
     table and returned correct counts/uniques. **The 3 probe rows were deleted
     afterwards** (`DELETE ... WHERE anon_id IN ('s1-deploy-probe','deploy-probe-1')`,
     3 changes) so the week-1 baseline starts from a genuinely empty table — `events`
     is at 0 rows.
  4. Optional env `ANALYTICS_ENABLED` — leave UNSET. It defaults to on; set it to
     `false` on either Pages project only to kill the beacon everywhere without a deploy.
  5. **STILL OPEN, pre-existing, NOT caused by S1:** `verify:env` fails on
     `flightway-cron` missing `UNSUB_SECRET`. The cron then falls back to the committed
     constant `'flightway-unsub'` while Pages falls back to `SESSION_PEPPER`, so the two
     disagree and **every unsubscribe link in the weekly digest will fail**. Redeploying
     the cron did not change this either way. It needs the same value in all three
     targets plus a redeploy of both Pages projects — the rotation one-liner is printed
     by `npm run verify:env`. Generating and installing a shared secret is Jacob's to
     run. `MAILING_ADDRESS` is still unset too (CAN-SPAM, blocks the first real send).
- HOT FILES: n/a — S1 is pre-Phase-0-merge, so every file here is part of the Phase-0
  merge itself rather than a post-merge touch.

## S2 — Trust, compliance, meta, lockdown (2026-07-24, Jacob_Work@36b021e..ffae02a)

- DONE:
  - **Legal pages (D21)** — `privacy.html` (16 sections), `terms.html` (18), `security.html`
    (10), all served at clean URLs `/privacy` `/terms` `/security`. Every factual claim was
    written against a cited file:line inventory of the real data flows and then adversarially
    re-checked against the code, because a privacy policy that describes a product we do not
    have is worse than none. Each carries a **`.fw-doc-review` notice** that names the two
    genuinely unresolved items out loud (postal address, governing law) rather than a generic
    disclaimer — and `verify:meta` asserts the notice is still there, so a later copy edit
    cannot quietly drop it.
  - **Governing law was deliberately NOT guessed.** We do not know FlightWay, Inc.'s state of
    incorporation. Naming one would have put a false fact on a live legal page, so the clause
    reads "the laws of the state in which FlightWay, Inc. is incorporated" and the decision is
    on Jacob's list.
  - **`contact.html` + `POST /contact` + migration `0018_contact.sql`** (D22). The D1 row is the
    record and the email is only a notification: a failed Resend still returns 200 (the message
    is already durable), a failed insert returns an honest 500 telling the student to email
    hello@flightway.ai instead. Rate-limited 5/IP/hr, allowlisted topic enum (client `<select>`
    and server list are gate-checked for drift), body truncated server-side, IP stored as a
    peppered hash. `?topic=` is deep-linkable so every "career-center pricing" link in the
    product lands on a pre-filled form.
  - **Optional Turnstile.** Off unless BOTH `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are
    set — the site key is served on `/config` so the client never hard-codes it, and with no key
    the page makes **zero** external requests (the WS-A property holds). Verification fails
    OPEN when Cloudflare is unreachable: a spam wave is recoverable, a silently dead contact
    form is not.
  - **Footer rebuild across 14 pages.** Three variants, chosen by which stylesheet each page
    already loads, so **no shared CSS changed and no page needed a new stylesheet link**:
    `.fw-footer` grid (index, pricing + the four new pages), the existing
    `footer/.footer-inner/.footer-links` (admin, auth, career, coach, portal, profile-build,
    quiz, resume, roadmap, simulation), and a page-local one for 404.html (which loads only
    theme.css). Every `href="#"` in the repo is gone — 6 on index, 3 on roadmap, plus the two
    JS-handled ones on auth/quiz which now carry a real fallback path.
  - **`pricing.html:157`'s dead career-center link** (`index.html#pricing` — an anchor with 0
    occurrences) now points at `/contact?topic=career-center`, so it is never dead again.
  - **Full meta on every public page** — title, description, canonical, og:site_name/url/title/
    description/type/image(+width/height/alt), twitter:card=summary_large_image/title/
    description/image. **noindex on all 11 non-indexable pages** (9 app shells + 404 + the
    Flightway.html shim), each with a comment stating the page-specific reason.
  - **Branded OG cards, generated not exported.** `npm run og:build`
    (`scripts/build-og-images.mjs`) renders 1200×630 PNGs with Playwright from the site's own
    palette and — importantly — **parses the bird path out of `assets/js/shared/brand.js`**, so
    the share cards cannot drift away from the mark the way a one-off design export would.
    og:image is the one asset nobody on the team ever sees; `verify:meta` reads the PNG IHDR and
    asserts 1200×630 so a corrupt render fails the suite.
  - **Host lockdown (D23).** `functions/_middleware.js` extended (not duplicated) to add
    `X-Robots-Tag: noindex, nofollow` on every response from every non-canonical host, and the
    static `robots.txt` **deleted** in favour of `functions/robots.txt.js`, which serves an
    allow-list + explicit AI-crawler grants + the sitemap on flightway.ai and `Disallow: /`
    everywhere else. A static file cannot know which host fetched it, so there was no version
    of it that said "index the real site, ignore the clones".
    - The whitelist lives in **`functions/_lib/host.js`** so the header, robots.txt and the gate
      read one definition. It fails CLOSED: an unparseable host is tagged.
    - App shells are deliberately **not** Disallowed in robots.txt — a crawler has to be allowed
      to fetch a page to see its noindex; disallowing would strand the URLs in the index.
  - **UNSUB_SECRET / MAILING_ADDRESS now warn loudly** (`functions/_lib/notify-token.js`,
    `workers/cron/index.js`), once per isolate because both sit inside per-recipient loops.
    `verify:env` gained a half-configured-pair check for the Turnstile keys.
  - **`docs/EVENTS.md` + `REGISTERED_EVENTS`** gained `contact_submitted` (server-written,
    props `{topic, notified, signedIn}`). `notified` is what makes a dead
    hello@flightway.ai alias visible instead of silent.
  - **`sitemap.xml`** gained the four new pages, and `verify:meta` now asserts the sitemap and
    the `public` rows of its classification table are the same set **in both directions**.
- MIGRATIONS: **0018** (`migrations/0018_contact.sql`, `contact_messages` + 2 indexes).
  **NOT applied to remote D1** — that is Jacob's, at the Phase-0 merge. The invocation that
  works (per the S1 note) is
  `npx wrangler d1 migrations apply flightway-db --remote --env production`.
- BUSTERS: no existing `/assets/*` file changed, so **nothing was re-stamped**. The two new
  assets ship at `?v=20260724a`: `assets/css/flightway-legal.css` and `assets/og/*.png`.
  `verify:busters` was taught to dereference same-origin ABSOLUTE urls — og:image has to be
  absolute for scrapers, and REF_RE's character class stops at the `:`, so the stamped card was
  arriving as `//flightway.ai/assets/...` and resolving to nothing.
- GATES: **38/38 green** (baseline at session start was 37/37 in 58.1s).
  - NEW **`verify:meta`** (pure lane) — the durable guard for everything above.
    Its first assertion is a **classification contract**: every root `.html` must appear in the
    table at the top of `scripts/verify-meta.mjs`, so a page nobody classified fails the suite
    rather than shipping with neither meta nor a noindex. Then: the full meta set on public
    pages, `noindex` (and NO canonical — a noindexed self-canonical is a contradiction) on the
    rest, og PNGs read at the byte level for 1200×630, **the entire internal link graph**
    (every `href`, including cross-page `#fragment`s resolved against the target page's ids —
    this is what makes `index.html#pricing` impossible to reintroduce), footer legal-link
    coverage with an explicit exemption list, sitemap↔classification parity both ways, the
    counsel-review notice, TOC↔`<h2 id>` parity on all three legal pages, the `_redirects`
    lockdown rules, the contact topic enum client↔server, and the host predicates + the robots
    handler **executed** rather than pattern-matched.
  - EXTENDED **`test:endpoints`** with `POST /contact` (happy path, dead-Resend-still-200,
    dead-D1-honest-500, every validation branch, rate limiting + refund, all four Turnstile
    states) and with **`_middleware`** driven against the response shapes that would break a
    naive `new Response(res.body, res)`: 101/websocket, 204, 304, and an immutable-cached asset
    whose existing headers must survive.
  - EXTENDED **`pages:smoke`** with an HTTP half that reads only FUNCTION responses (the S1
    lesson: a stamped asset returns 200 whether or not the build landed). It asserts the legal
    URLs, per-host robots.txt, the X-Robots-Tag polarity for the host it is pointed at, the
    blocked repo files, and `turnstileSiteKey` on `/config` as proof the functions bundle is
    current.
  - EXTENDED **`verify:busters`** (same-origin absolute urls), **`layout:check`**
    (privacy + contact added — 270 → 330 cells) and **`verify:env`** (half-configured
    optional-key pairs).
  - **`layout:check`'s frame heuristic was wrong, and this session's pages exposed it.** It
    scored a "dead gutter" at 2560px@67% on privacy and contact. The pages are fine: their
    `<header>` and `<footer>` are 3805px of painted, edge-to-edge bar. The rule counted a box as
    a page frame only if it had >1 child — a proxy for "chrome, not a spacer" that misses the
    commonest shape of chrome there is, a full-bleed bar wrapping one centred container. It now
    also counts a box that spans the viewport AND paints it. This does not soften the check: a
    real dead gutter is a narrow card on the body's own background, where nothing under
    `body *` is both full-bleed and painted. 330/330 cells clean after.
  - CLAUDE.md gate counts updated 35 offline / 38 total.
- DEFERRED (nothing silently dropped):
  - **Turnstile ships unproven end-to-end.** No deployment has the keys, so the render path and
    a real siteverify round-trip have never executed against Cloudflare. The offline gate covers
    every branch with a stubbed upstream; the live path is one of Jacob's optional items.
  - **`POST /contact` is inert until migration 0018 is applied.** Verified live on the
    prototype: it 400s correctly on validation and returns the honest 500 with the
    email-us-instead message on a valid submission, because the table does not exist yet. That
    is the designed failure, not a bug — but the migration MUST be applied at or before the
    Phase-0 merge or the contact form is dead on arrival on flightway.ai.
  - **`pages:smoke`'s host assertions are polarity-aware, not host-agnostic.** Pointed at
    flightway.ai it asserts the opposite of what it asserts against the prototype. Correct, but
    it means a green `gates` still proves nothing about production (protocol §4).
  - **No `contact_view` event.** `page_view` on `/contact` already measures it and `contact_` is
    not an allowlisted prefix on purpose.
  - **The og cards are not regenerated in CI.** `npm run og:build` is manual and the PNGs are
    committed. If the mark or the palette changes, someone has to re-run it — `verify:meta`
    catches a missing or wrong-sized card, not a stale one.
  - **`sitemap.xml` is still static.** S13 makes it a function; the four new URLs were added by
    hand and the gate now enforces parity with the classification table.
- DRIFT (the repo disagreed with the plan or with itself; the repo wins):
  - **`.assetsignore` does not work on this project.** The plan says to add `.dev.vars.example`
    to it "AND a `_redirects` 302 rule as belt-and-braces". It is not belt-and-braces — it is
    braces only. `.cursor/` has been listed in `.assetsignore` since June and
    `https://flightway.ai/.cursor/rules/jacob-work-prototype.mdc` still answered **200** when
    checked this session. That file is honoured by direct `wrangler pages deploy` uploads; this
    project is built by the GitHub integration. `_redirects` is the only mechanism that works,
    every entry now has a rule there, and `.assetsignore`'s header says so in case someone
    reaches for it again.
  - **The plan's app-shell list says "simulation when signed-in-only".** It is not signed-in
    only — `simulation.html:92` says "Anonymous users welcome". It is still `noindex`, for the
    other reason the plan gives: `#fw-root` holds a loading skeleton until JS runs, so a crawler
    reads an empty page. Same for `career.html` and `dashboard.html`, which are also not
    auth-gated. Each page's comment states its own real reason rather than the generic one.
  - **The plan says the footer rebuild covers "all pages".** 14 of 15 have one. `dashboard.html`
    does not: it is a full-viewport canvas map with `position:fixed` chrome and no scrolling
    document body, so a document-flow footer would be markup below a fold that does not exist.
    Recorded as a named exemption in `verify:meta`'s `NO_FOOTER` map with the reason, so it is a
    decision rather than an omission.
  - **`Flightway.html` is orphaned but was NOT removed from the deploy.** Nothing in the shipped
    code links to it (`page-boot.js:15`'s `legacy` map entry has zero consumers), but
    `_redirects` still 301s `/dreamforce.html` here, and deleting the target would turn a
    working legacy redirect into a 404 for zero benefit. It got `noindex` and a real title
    instead. Live behaviour worth knowing: `/Flightway.html` **308s to `/Flightway`** — Pages'
    automatic clean-URL redirect fires ahead of the explicit `200` passthrough rule in
    `_redirects`, so several of those rules may be inert.
  - **The plan asks for og:image "variants for quiz/pricing".** Shipped as three cards; the four
    document pages share `og-default` deliberately — a distinct share card for a privacy policy
    is cost with no reader.
- JACOB ACTIONS RAISED:
  1. **Apply migration 0018 to the shared remote D1.** Until you do, `POST /contact` returns the
     honest 500 and no message is stored. Additive (`CREATE TABLE IF NOT EXISTS` + 2 indexes),
     nothing dropped. Check first, because `apply` runs everything pending:
     `npx wrangler d1 migrations list flightway-db --remote --env production`, then
     `npx wrangler d1 migrations apply flightway-db --remote --env production`.
  2. **Legal review.** privacy/terms/security are drafted in-house and say so on their own faces.
     Every factual claim was written against the code and then adversarially re-checked against
     it, so an attorney is reviewing *positions*, not *facts*. Two items are genuinely open and
     named in the review notice on each page: the registered postal address, and governing law
     and venue. I refused to guess the state of incorporation — a false fact on a live legal page
     is worse than an obviously unfinished one.
  3. **You are now publicly committed to a 3-business-day acknowledgement** on security reports
     (security.html, "What we commit to"), once this merges to main. It is a normal commitment
     and worth keeping; flagging it because it is a promise, not a description.
  4. **`hello@flightway.ai` must actually receive.** It is now printed on four pages, is the
     `to:` of every contact-form notification, and is the vulnerability-disclosure channel. Still
     an open item on this checklist. `contact_submitted` carries `notified`, so once traffic
     exists the admin dashboard will show a dead alias rather than hiding it.
  5. **Optional Turnstile.** Set `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (free, Cloudflare
     dashboard → Turnstile) on a Pages project to switch the contact-form challenge on. Both or
     neither — `verify:env` now warns on a half-configured pair, because a site key with no
     secret renders a challenge nobody can pass.
  6. **Still open, pre-existing, not caused by S2:** `UNSUB_SECRET` and `MAILING_ADDRESS`. Both
     now `console.warn` instead of failing silently, but the code cannot set them. Same status as
     the S1 entry.
  7. **Live-verified on the prototype after this push** (a3c0390): `/privacy` `/terms`
     `/security` `/contact` all 200 at their clean URLs; `/privacy.html` 308s to `/privacy`;
     `X-Robots-Tag: noindex, nofollow` present on HTML, on `/config` and on a static asset;
     `/robots.txt` served by the Function with `Disallow: /` and `no-store` — **which settles the
     open question of whether a Pages Function shadows a static asset at the same path: it does**;
     `.dev.vars.example` and `.cursor/rules/...` now 302 where they were 200. Production
     (flightway.ai, `main`) is untouched and still serves the old static robots.txt, as expected.
  8. After the Phase-0 merge, re-run the same curl list against `https://flightway.ai` — the
     polarity flips: robots.txt should ALLOW and there should be **no** `X-Robots-Tag` at all.
     `SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke` does exactly this.
- HOT FILES: n/a — S2 is pre-Phase-0-merge, so every file here is part of the Phase-0 merge
  itself. For the S20 reconciliation, the Phase-0 surface is now: all 19 root `.html`,
  `functions/_middleware.js`, `functions/_lib/host.js`, `functions/robots.txt.js`,
  `functions/contact.js`, `functions/config.js`, `functions/account.js`,
  `functions/_lib/events.js`, `functions/_lib/notify-token.js`, `workers/cron/index.js`,
  `_redirects`, `.assetsignore`, `sitemap.xml` (robots.txt DELETED), `assets/css/flightway-legal.css`,
  `assets/og/*`, and the gate scripts.
- ADVERSARIAL REVIEW (nine lenses over the diff — middleware risk, endpoint security, factual
  accuracy of each legal page against the code, SEO, markup integrity, gate strength, scope
  completeness — each finding then independently refuted before being accepted). It found seven
  real defects that no gate could have caught, because a false sentence in a privacy policy
  renders exactly like a true one:
  1. **"We never store your raw IP address" was FALSE.** `checkRateLimit` builds a KV key as
     `auth_rate:<key>` and PUTs it, and almost every caller passes the raw IP as part of `key`
     (`functions/events.js:90`, login, register, send-results, waitlist-intent). So the raw IP
     is written into KV — as a counter NAME, for one hour, never into D1. `functions/contact.js`
     now hashes the IP *before* it becomes a rate-limit key, so this endpoint puts an IP nowhere;
     the privacy page describes the rest exactly as it is; the site-wide fix is a spawned task.
  2. **The Resend row was falsified by this session's own contact form** — the full free-text
     message body is emailed. Row corrected, and the "no resume text, GPA or dossier in an email
     body" sentence narrowed to what remains true.
  3. **`contact_messages` survived account deletion.** Added to `USER_TABLES`
     (`functions/account.js:14`), so it goes with the account rather than becoming a third
     caveat.
  4. **contact.html promised deletion removes "your resume"** while privacy.html said the
     opposite in the same commit. The two now agree, and privacy.html additionally names the
     five per-user KV caches that also survive, with their TTLs.
  5. **The Turnstile fail-open was reachable on demand.** The token was unbounded and forwarded
     to `siteverify`, and every error there — including the 6s timeout an attacker can cause by
     posting a megabyte — became a pass. Capped at 2048 before the fetch; the gate asserts the
     upstream is never even reached for an oversized token.
  6. **`verify:meta`'s own fragment check silently skipped `/#frag`** — the exact link form the
     new footers use everywhere. `pathPart` was `/`, the strip produced `""`, the target became
     the literal `".html"`, and the loop `continue`d. Fixed, then proven to bite by renaming
     `id="how-it-works"` and watching four assertions fail.
  7. **Two scratch harnesses (`.tmp-classcheck.mjs`, `.tmp-render.mjs`) were committed at the
     repo root by the lockdown commit itself.** A subagent left them and `git add -A` swept them
     in. Removed, `.tmp-*` gitignored, and a `_redirects` rule added — the same belt-and-braces
     the rest of that block exists for.
     **Exposure, stated exactly:** a verifier fetched
     `https://flightwayjacobprototype.pages.dev/.tmp-classcheck.mjs` and got **200** with the
     full source, which hard-codes an absolute home directory path. So they WERE publicly served,
     on the prototype, for the ~40 minutes between a3c0390 deploying and ffae02a replacing it.
     They were never on production — `main` never reached a3c0390, and both paths return 404
     there. Both now return 302 on the prototype and are absent from the tree. Nothing in them
     was secret; the disclosure was a local filesystem path. Recorded because "we blocked it"
     and "it was never reachable" are different statements and only the first is true.
  Also fixed from the same pass: an unbounded `email` (the one user string reaching D1 with no
  cap), the rate-limit attempt not being refunded on a refused challenge or a server-side
  failure, `name` being concatenated onto `body` and re-truncated (it now has its own column in
  0018, so it can no longer eat the tail of a message), the Gemini feature list being incomplete,
  the client-side "props are scrubbed" claim (the client only caps size), and security.html's
  "an automated gate suite runs against every deploy" — nothing in the deploy path runs it, and
  it was offered as the compensating control for having no penetration test.
  Findings that did NOT survive refutation were dropped, including a claimed comp-restoration
  bug that a verifier disproved by executing the real handlers.

### S2 postscript — a regression I shipped, and what it changes

`d730085` was labelled a docs-only ledger edit. It also deleted the 18-line
`SESSION_PEPPER` guard from `functions/_middleware.js`: an unreviewed working-tree
modification that `git add -A` swept in. HEAD — and therefore the deployed prototype —
was missing it for about six minutes, until `cf1e74a` restored it verbatim.

Why that guard matters is in the comment block it sits under (34be6c4): the production
Pages project publishes a public preview of `Jacob_Work` at
`jacob-work.flightway.pages.dev`, that host inherits the PRODUCTION D1 binding and the
binding cannot be revoked from inside this repo, and it receives none of the secrets.
Without `SESSION_PEPPER` every session token there is hashed with a constant committed to
this repo; with `PAYWALL_ENABLED` unset every account resolves to premium. The 503 is the
only thing standing in front of live user data on that host.

Two things worth carrying forward, because neither is about this guard specifically:

1. **Both gates that cover it were already green and would have caught it.**
   `verify:meta` asserts the middleware still refuses an unconfigured environment;
   `test:endpoints` executes it and asserts the 503. Neither ran, because a "docs-only"
   commit did not seem to need them. The rule that actually holds is: **run the gates
   against what you are committing, not against what you think you changed.** `git add -A`
   is what makes those two different things.
2. **This is the second time in one session that `git add -A` committed something nobody
   looked at** — the first was the two `.tmp-*` scratch harnesses, which reached a live
   200. Same mechanism, different payload. A future session that wants to be safe here
   should `git add` explicit paths, or read `git diff --cached` before committing, rather
   than trusting that the working tree contains only its own edits. Subagents write files
   at the repo root.

### S2 follow-up — account deletion made complete (2026-07-24)

The S2 review found `contact_messages` surviving account deletion. Chasing that
turned up that the purge had drifted much further than one table.

- **Five tables were silently surviving**: `resumes`, `resume_versions`
  (the resume the student wrote — the most personal free text in the product),
  `interview_sessions` (mock-interview transcripts and scores), `comp_grants`,
  and `admin_roles`. All now purged. Two of those were more than a privacy gap:
  a `comp_grants` row keyed to an address means re-registering it silently
  inherits someone else's plan, and an `admin_roles` row means **deleting your
  account and re-registering the same address gets your admin back**.
- **`events` is anonymized, not deleted** — `user_id` set to NULL, row kept.
  Props are already PII-scrubbed server-side and no IP is stored, so `user_id`
  is the only link to a person; severing it is what the request actually asks
  for. Deleting the rows would silently rewrite every funnel and cohort for
  everyone else, which is a bad trade for one person's deletion.
- **`admin_audit_log` is deliberately kept**, with the reason recorded in code
  and disclosed on the privacy page: an audit trail a subject can erase by
  deleting their own account is worthless in the one case it exists for.
- **The KV lists were wrong in three ways at once**, none visible from reading
  them: `stretch:v4:<email>` and `oppfind:v2:<email>` put a version segment
  BEFORE the email so a `<type>:<email>:` prefix matched nothing;
  `checkRateLimit` stores under `auth_rate:<key>` so every entry naming a bare
  rate-limit type matched nothing; and nine namespaces written since the lists
  were last touched had never been added.
  **So the enumeration was replaced with a sweep**: list the namespace and
  delete every key carrying the email as a colon-delimited SEGMENT. Segment
  equality, not substring — `a@b.com` must never match `xa@b.com`, and the gate
  seeds both. One namespace still has to be named, `career-rank:v4:<hash(email)>`,
  because it hashes the address and the sweep is structurally blind to it.
- **New gate `test:purge`** (`scripts/test-account-purge.mjs`). It parses
  `migrations/` and fails if any table with an identity column is not classified
  as purge / anonymize / excluded-with-a-reason, in both directions — so a future
  migration carrying an `email` column cannot merge until someone decides what
  deletion does with it. It also executes the real handler, seeds a fake KV with
  every real key shape in the codebase (each cited to the line that builds it)
  plus another user's keys and the global caches, and asserts exactly the
  caller's keys are removed. Verified to bite: removing `resumes` from the list
  and adding a probe migration each turn it red.
- **privacy.html / contact.html updated.** The old text said resume documents and
  mock-interview results were not covered; they are now. The page says the
  correction out loud rather than quietly editing it away, and the caveat list is
  down to the two real ones (anonymized analytics, retained audit log).
- Gates: **39/39** (36 offline). CLAUDE.md counts updated.

### S2 follow-up — raw IPs out of rate-limit KV keys (2026-07-24)

The S2 review's blocker finding was that `checkRateLimit` stores its argument as
part of a KV key NAME (`auth_rate:<key>`), and ~25 call sites passed
`clientIp(request)` directly — so the visitor's raw IP sat in KV for the length
of the window. `contact.js` (S2) already hashed first; this generalizes that.

- **New helper `hashedIpKey(env, request)`** (`functions/_lib/auth.js`) — returns
  `sha256Hex('ip:' + sessionPepper + ip).slice(0,32)`. Peppered with the SAME
  secret session tokens use (one secret to rotate, not two), so a KV listing plus
  the 4-billion-IPv4 rainbow table still can't reverse it. 128 bits is
  collision-safe for a counter bucket; unknown-IP requests share one bucket
  exactly as they shared `prefix:unknown` before.
- **Routed every IP-keyed rate limit through it** — 28 call sites across 26 files.
  The key PREFIXES are unchanged, so per-endpoint limits stay separate; only the
  IP segment is now a hash. `career-analysis.js` computes the hash once
  (`anonIpKey`) and reuses it for both its anonymous rate bucket and its anonymous
  grounding-budget key, which was the other place a raw IP reached KV.
- **Left alone, on purpose:** `contact.js` (already hashed), `waitlist-intent.js`'s
  and the pricing-form's stored `ip_hash` columns (already hashed, separate
  concern), and `admin/elevate.js:45`, which logs an *administrator's own* IP into
  `admin_audit_log` on a failed elevation — an admin-only security record already
  disclosed under the retained-audit-log exception, out of scope here.
- **`test:endpoints` extended two ways.** A SOURCE lint over all of `functions/`
  fails if any line pairs `checkRateLimit`/`refundRateLimit` with
  `clientIp(request)` — the anti-drift guarantee, so a new endpoint reaching for
  the old pattern goes red instead of shipping the leak. Plus a RUNTIME pass that
  drives `/events`, `/contact`, `/waitlist-intent` and `/auth/login` with a known
  `CF-Connecting-IP` (203.0.113.99, TEST-NET-3) and asserts no `auth_rate:` key
  matches an IPv4/IPv6 shape or contains that address. Verified to bite: the lint
  goes red the moment the old pattern is reintroduced.
- **privacy.html corrected.** It said the raw IP appeared in "about forty percent"
  of rate-limit counters — true when written, false now. The IP row now says we
  do not store the raw address anywhere (only a peppered hash, only where needed),
  and says the correction out loud rather than editing it away.
- **Migration effect (harmless):** the key shape changed, so every in-flight
  rate-limit counter resets once on deploy. A counter is a per-window integer, so
  the worst case is a caller who had spent some of an hourly budget gets it back
  once. Not preserved on purpose.
- Gates: **39/39** (36 offline).

### S2.5 — copy pass: de-slop the user-facing docs (2026-07-24)

A words-only pass over everything S2 shipped: rewrite the rendered text to be tight and
plainly human, cut the AI-slop mannerisms, **drop no verified disclosure and break no gate.**
No CSS, structure, scripts, migrations or endpoints touched — only prose inside existing
markup. Every `<h2 id>`, TOC entry, footer link, meta tag, contact `<option value>` and
`<a>` target is byte-identical to before, so `verify:meta` had nothing to catch.

- **Files changed: `privacy.html`, `terms.html`, `security.html`.** `contact.html` and
  `404.html` were read line-by-line and left **unchanged** — already tight, no
  meta-commentary or padding, so editing them would have been churn. Meta descriptions:
  `index`/`quiz`/`pricing` are already clean (left as-is); the only meta edit was dropping
  "honestly" from `security.html`'s `<meta name="description">`.
- **What was cut** (the six tells, all eliminated across the three docs):
  1. *Self-referential meta-commentary* — every "an earlier version of this page said…",
     "we corrected this rather than quietly editing it away", "we'd rather tell you than hide
     it behind 'certain information'", "because a deletion promise is worthless if it is not
     exact". The edit-history lives here in the ledger, not on the live page.
  2. *Performative "what we do / don't do" framing* — collapsed. Privacy keeps the single
     "What we do not do" list (each line earns its place); security keeps "What we don't have
     yet" (that one is substantive disclosure — SOC 2 / pen-test / CSP / 2FA gaps — not a
     performative frame).
  3. *Over-explaining mechanism* — the rainbow-table lecture on IP hashing, the "second tier
     exists so…" on event prefixes, the "we cannot audit it for you" on at-rest encryption:
     reduced to the outcome plus at most one clause of why.
  4. *Em-dash/parenthetical pile-ups and "not just X — Y" cadence* — split into short
     sentences ("That prompt is built from your real profile, not a vague summary.").
  5. *Prose that wanted a list/table* — privacy already had the collect/retention/provider
     tables; nothing new to convert.
  6. *Hedging/reassurance padding* — "genuinely", "honestly", "the honest version/part/shape
     of", "worth knowing up front", "we want to hear it — genuinely", "two honest caveats",
     "That is the whole deal".
- **Two stale FACTS the copy pass caught and corrected** (both pre-existing drift from
  earlier S2 follow-ups — the follow-up fixed the code and one cross-reference but missed
  another; neither was introduced by this rewording):
  1. **privacy Security section** said your IP is stored as a hash *"apart from the one-hour
     abuse counters"* — but the S2 IP-hash follow-up (`hashedIpKey`) made those counters key
     on a hash too. Directly contradicted the corrected What-we-collect row. Fixed to
     *"including in the one-hour abuse counters."*
  2. **privacy retention table** said the one-click account delete *"does not currently
     reach"* saved resumes / tailored versions / mock-interview results — the S2
     account-deletion follow-up added `resumes`, `resume_versions`, `interview_sessions` to
     `USER_TABLES`, so deletion **does** reach them, and the page's own deletion section
     already said so. Fixed to *"removed when you delete your account."*
- **Where brevity would have cost accuracy, the longer wording stayed** (verbatim):
  the what-we-collect / retention / service-provider / plans-billing tables; the account-
  deletion enumeration; the three refund-behaviour bullets (full refund clears **all**
  `plan_source='stripe'` access incl. the Sprint-downgrades-subscription edge; partial refund
  removes nothing; comp untouched but a purchase overwrites it with no auto-return); the
  AI-processing feature list that names every Gemini call; the PBKDF2 / session-pepper /
  webhook-signature technical paras. These are disclosure, not prose.
- **`security.html` "about 38 automated checks":** the real count is **39** (`run-gates.mjs`).
  Left as-is — "about 38" is an accurate approximation (within one), and precisely re-counting
  a number is a fact edit outside a tone pass. Flagged here rather than silently bumped.
- **No gate assertion had to be gamed.** `verify:meta`'s counsel-notice check asserts only
  presence (`fw-doc-review` + counsel/attorney/lawyer + "Last updated") and TOC↔`<h2 id>`
  parity — **no minimum word count** — so I trimmed each review notice ~40% while keeping the
  genuinely-open items named out loud (privacy/security: postal address + governing law &
  venue; terms: postal address + governing law + venue).
- **Facts re-verified** — adversarial workflow, 3 Opus agents (one per legal page), each read
  the page + cited `functions/`/`migrations/`/`assets/js/` at file:line. **Every disclosure
  ACCURATE against the code** except the two stale rows above (now fixed): data collected
  (contact 4000-char body cap, UA→200 chars, PBKDF2$100000), peppered IP hash
  (`hashedIpKey`, 3600s TTL, contact + pricing forms store the hash), analytics scrub
  (`BANNED_KEYS`, >64-char + email-like + nested dropped, DNT drop, 90-day prune,
  allowlist + ~43 prefixes), Gemini-only + identity block (name/year/GPA/subjects/leaning/
  school, **no email**) + uploaded-file bytes + web grounding, four providers (Stripe never
  sees a card; Resend emails the full contact body), single `fw_session` cookie
  (HttpOnly/Secure/SameSite=Lax/Path=/, 30d server-enforced), retention TTLs
  (1d/1w/3w/1mo/3mo/6mo), account deletion (`USER_TABLES` incl. resumes/resume_versions/
  interview_sessions/comp_grants/admin_roles; events anonymized `user_id=NULL`;
  `admin_audit_log` kept), minors (no dob/age field anywhere in signup), CAN-SPAM
  (`MAILING_ADDRESS` warns), every refund branch, rate-limit numbers (10/30/20/60/5), admin
  console (`ROOT_ADMIN_EMAIL` env, 404-to-non-admins, 15-min password-gated elevation,
  append-only audit).
- **Rendered word count** (`<main>`, and prose-only excluding the disclosure tables + TOC):
  - `privacy.html`  4902 → 4293 main (−12%); **3619 → 3090 prose (−15%)**
  - `terms.html`    4761 → 4535 main (−5%);  4408 → 4182 prose (−5%)
  - `security.html` 3978 → 3797 main (−5%);  3850 → 3669 prose (−5%)
  - `contact.html` / `404.html` unchanged.
  The third-to-a-half aim was met only on privacy's prose (which carried the bulk of the
  performative candor). Terms and security are dominated by necessary legal/technical
  disclosure with little slop — the S2 review had already tightened them — so honest
  de-slopping there lands at ~5%. Accuracy outranked brevity, as instructed.
- BUSTERS: none — no `/assets/*` file changed.
- GATES: **39/39 green** (verify:meta, test:purge, contrast:check, layout:check, pages:smoke
  all green). No new or modified gate.

### S2.6 — formal-legalese re-presentation of the legal pages (2026-07-24)

This session deliberately **reverses S2.5's presentation goal**. S2.5 rewrote privacy/terms/security to
be plainly human and skimmable by a student; Jacob wants the opposite emphasis — legal robustness first,
and no prose that does not serve it. **Facts stay frozen**; this is a register + structure pass over the
rendered text of `privacy.html`, `terms.html`, `security.html` only. `contact.html` and `404.html` untouched
(a support page and an error page are not legal instruments). No `<head>`, CSS, asset, migration, `functions/`,
or gate-script change; no cache-buster work.

- **Two decisions confirmed with Jacob first** (one `AskUserQuestion`, per the kickoff — not guessed):
  1. **Register: full formal**, not a hybrid with plain-language summary boxes. Coaching second-person,
     analogies, reassurance, and "read-this-even-if…" signposts are cut. The one place clarity is itself a
     compliance point — the COPPA/minors notice — is kept legally plain within the formal frame.
  2. **Structure: full conventional legal outline** — recitals + a dedicated Definitions section + renumbered
     operative sections, on all three.
- **Structure changes:**
  - Each doc opens with a formal **recital preamble** (in `.fw-doc-head`) and a **strengthened counsel
    notice** — lead now reads `NOTICE — DRAFT PENDING LEGAL REVIEW` (made *more* prominent, as flagged, not
    weakened). The genuinely-open items still named out loud: privacy/security — registered postal address +
    governing law & venue; terms — postal address + governing law + venue.
  - **New Definitions section on each** (privacy §1, terms §2, security §1), all `id="definitions"` — the only
    new id. Defined terms are descriptive of what already exists (Service, Account, User, Personal Data,
    Service Provider, AI Provider = Google LLC, Content/Your Content, Paid Plan/Flight Plan, O\*NET,
    Vulnerability). **No legal substance invented** — no arbitration clause, no class-action waiver, no named
    state/venue, no postal address, no retention period, no warranty, no GDPR "legal basis" analysis the code
    doesn't support.
  - **All operative sections numbered.** privacy/security were unnumbered (now §1–§17 and §1–§11); terms was
    already §1–§18, now §1–§19 with Definitions inserted at §2. Sub-clauses numbered `N.M` where a section had
    multiple `<h3>`s. Loose enumerations converted to `<ol>` where numbering aids precision.
  - **Every existing `<h2 id>` preserved** — only `#definitions` is new — so all in-prose fragments and the
    one cross-page fragment (`contact.html` → `/privacy#your-choices`, confirmed by grep) stay valid. Visible
    titles + TOC text were re-worded/renumbered freely because `verify:meta` matches on the id, not the text.
    TOC↔`<h2 id>` parity green both ways: privacy 17, terms 19, security 11 entries.
- **Register: what was cut** (prose that served tone, not robustness) — the "written to be read by the
  students who use it, not only by lawyers" line; "use it the way you'd use a very well-read friend…"; "this
  is the most important section, read it even if you skip the rest"; "Most accounts that get broken into are
  not broken into. They are logged into"; "Marco is a career coach, not a vault"; "an email that starts 'hey,
  this looks wrong'"; "expecting a cheque"; "no retention gauntlet". Replaced with operative verbs (*You
  agree / We may / We will / We do not*), defined terms, and numbered clauses.
- **Where cutting prose would have dropped a required disclosure, the longer wording stayed (verbatim in
  meaning)** — these are disclosure, not prose:
  - the what-we-collect / retention / service-provider / plans-billing **tables** (kept intact);
  - the **account-deletion enumeration** + its two caveats (analytics anonymized `user_id=NULL`;
    `admin_audit_log` retained);
  - the **three refund behaviours** (full refund clears *all* `plan_source='stripe'` access incl. the
    Sprint-downgrades-subscription edge; partial removes nothing; comp untouched but a purchase overwrites it,
    no auto-return);
  - the full **Gemini feature list** (privacy §5.2) and the **web-grounding** disclosure;
  - the **peppered-IP-hash** claim *including* the one-hour abuse counters;
  - **PBKDF2 / session-pepper / webhook-signature** technical paragraphs;
  - **minors 13+/COPPA** and "no age-verification step in signup";
  - **CAN-SPAM / `MAILING_ADDRESS` pending**.
- **One deliberate generalization, flagged:** security's "about 38 automated checks" → "a suite of automated
  checks … run manually before every push." An approximate, volatile integer (S2 said 38, real count is 39)
  on a formal instrument is a staleness trap; the substantive disclosure (manual, **not** pipeline-enforced,
  **not** equivalent to an external test) is preserved. This drops a volatile number, not a disclosure.
- **Also:** security `<h1>` "How we protect your data" → "Security" (now matches its unchanged `<title>`).
  `<head>` meta/canonical/og/twitter/busters byte-preserved on all three (verified: 0 head/footer signature
  lines removed in the diff).
- **Word count** (main / prose-only; before = committed S2.5 version via `git show HEAD:`):
  - `privacy.html`  main 4232 → 4333 (**+2%**); prose 3046 → 3179 (+4%)
  - `terms.html`    main 4456 → 4723 (**+6%**); prose 4109 → 4361 (+6%)
  - `security.html` main 3759 → 3835 (**+2%**); prose 3632 → 3702 (+2%)
  - Counts **rose** despite cutting coaching prose: the new Definitions sections, defined-term repetition, and
    numbered sub-clauses add more than the analogies/reassurance removed. **Brevity was not a goal this pass**
    — it reverses S2.5's aim — legal robustness was. Word count is a diagnostic here, not a target.
- **Facts re-verified against the code** (constraint A — every wording change re-checked, not trusted):
  PBKDF2 100,000 iters / 16-byte salt / 256-bit key (`functions/_lib/auth.js:34,50,59`); `fw_session`
  HttpOnly + SameSite=Lax + Max-Age 2592000 (`auth.js:10,169-178`); `hashedIpKey` = `sha256Hex('ip:'+pepper+ip).slice(0,32)`
  (`auth.js:268-269`); `USER_TABLES` incl. resumes / resume_versions / interview_sessions / comp_grants /
  admin_roles / contact_messages (`functions/account.js`); contact `MAX_BODY` 4000 + Turnstile token cap 2048
  (`functions/contact.js:36,57`); Stripe webhook replay tolerance 300s / five minutes
  (`functions/_lib/stripe.js:198`); `FROM_EMAIL` default = `careers@flightway.ai` (`functions/_lib.js:230`,
  `workers/cron/wrangler.toml:45`). The S2.5 same-day adversarial re-verification of the remaining disclosures
  stands, since each was preserved verbatim in meaning.
- BUSTERS: none — no `/assets/*` file changed.
- GATES: **39/39 green** in 66s (verify:meta, contrast:check, layout:check full 330-cell, pages:smoke all
  green). No new or modified gate.

## S3 — Admin analytics dashboards + server error log (2026-07-24, Jacob_Work@7490f7e..ca23a22)

Phase 0's third and final session: the self-hosted answers to every question the audits said
we couldn't answer. Extends the existing admin console (@0016) — same 404-to-non-admins gate,
reads need no elevation — with six analytics panels + a server error log, all reading the S1
pipeline. **This completes Phase 0 (S1+S2+S3); the Phase-0 merge runbook is at the bottom of
this entry.**

- DONE:
  - **`functions/_lib/analytics.js`** (NEW) — the pure, testable read layer. Seven exported
    aggregators over a D1-shaped `db`, no clock except the `today`/`nowIso` the caller passes,
    so the gate seeds a real SQLite from migration 0017 and asserts each number to the row:
    - `overviewMetrics` (`:137`) — DAU/WAU/MAU (anon + signed-in, three bounded distinct-count
      queries), a 14-day signups trend + 7/30-day windows, the **48h activation rate**
      (a `julianday(a.ts) <= julianday(s.ts)+2.0` EXISTS self-join on `anon_id`, so the window is
      correct across the ISO/UTC timestamps regardless of offset), and revenue (active paid
      accounts by plan; **MRR is an estimate = active-premium × `MRR_MONTHLY_CENTS`, and `null`
      when that env is unset — never a fabricated number**, since the real prices live in Stripe
      as price IDs, not cents in the repo).
    - `funnelMetrics` (`:238`) — the discovery funnel (distinct visitors per stage + per-stage
      conversion; `landing` is a path-filtered `page_view`, `reveal_view` is present and flagged
      `pending:true` reading 0 until S6 ships it) and the paywall funnel (stage totals +
      plan_cap_hit-by-feature; deliberately NOT one joined per-feature waterfall because each
      stage keys its feature under a different prop — documented in the file).
    - `retentionMetrics` (`:298`) — weekly signup cohorts × weeks-since (the classic triangle,
      ISO-Monday `weekStart` keying) + a days-since-last-action distribution (the loop metric).
    - `featureUsage` (`:375`) — events per watched feature per week **from `events_daily`** (the
      one panel that reads the rollup, per §5 S3: additive counts, cheap, survives the 90-day
      prune) + the **zero-use callout** (WATCHED_FEATURES with 0 events in range). `uniqueDays`
      is labelled honestly as sum-of-daily-uniques (an upper bound), not a fake weekly unique.
    - `sourceAttribution` (`:446`) — first-touch channel → visitors/signups/activations, channel
      read from each anon's earliest row (`classifyChannel`: utm_source wins, then ref host).
    - `liveTail` (`:487`) — last N events, newest-first, **anon id truncated to 8 chars and NO
      user_id/email** (the tail is a firehose an admin watches; the anon short-id is enough).
    - `recentServerErrors` (`:511`) — last 50 + a route→count rollup.
    - Rule honoured throughout (§5 S3): `events_daily` for additive per-day counts (features);
      raw `events` only where distinctness / per-identity correlation / path filters are needed,
      every such query bounded to ≤ the 90-day retention window so it is never a growing scan.
  - **`logServerError(env, route, err)`** (`functions/_lib/events.js:386`) — the Sentry stand-in
    write path, sitting with `logServerEvent`. Best-effort by construction (swallows its own
    failure, returns a bool) so wiring it into a catch can never turn a handled 500 into an
    unhandled crash. **`redactEmails`** (`:373`) strips email-shaped substrings from the message
    AND the stack head before storing — an error log must never become a PII store. Deliberately
    does **not** consult `analyticsEnabled`: an operational error log carries no identity and must
    stay on exactly when you switch the beacon off to debug. Writes the `server_errors` table
    that S1 pre-created in 0017.
  - **`GET /admin/analytics?panel=…`** (`functions/admin/analytics.js`) — ONE route, `adminGate`
    → 404 to everyone who is not an admin (`:36`), then a `PANELS` map (`:22`) dispatches
    overview/funnel/retention/features/sources/tail/errors. Reads require no elevation (there are
    no mutations; the console must render before you unlock it, exactly as `/admin/grants` and
    `/admin/audit` already do). Unknown panel → 400 (not 500); an empty DB binding → 200 with
    `data:null`; a query throw is caught, **dogfooded through `logServerError(…'admin/analytics')`**
    (`:52`), and returned as a generic 500.
  - **Admin UI** — `admin.html` gains an `#admin-analytics` section (`:147`) with a 7-tab bar
    (`:151`) and a lazy-loading panel host, plus a scoped S3 CSS block (stat tiles, tabs, funnel
    bars, sparkline, cohort table). `assets/js/app/admin-console.js` gains the analytics module
    (renderers + `loadPanel` `:702` + `RENDERERS` `:687` + `initAnalytics` `:723`, wired into
    boot at `:773`). **Every cell is createElement + textContent** — event props, paths, error
    messages, routes and channel labels are all data from the wild, so there is no `innerHTML`
    anywhere near them, matching the file's existing discipline. Panels load lazily on tab
    switch and cache; the live tail has an opt-in 5s auto-refresh whose interval is cleared on
    tab leave; bar widths/spark heights are clamped so bad data can't break layout.
  - **`logServerError` wired into the top catch of 4 high-traffic functions** —
    `career-analysis.js`, `career-roadmap.js`, `opportunities.js`, `contact.js` (import +
    one `await logServerError(env, '<route>', err)` as the first line of the outermost
    handler catch that returns a 5xx; additive-only, 8 insertions + 1 import-line extension,
    diff reviewed). Each with `env` confirmed in scope.
  - **`docs/EVENTS.md`** — a "Server errors" note: the `server_errors` table is a separate
    channel (not the beacon, not an event), read only by the admin Errors panel, on even when
    the beacon is off; the §6 `server_error` *event* name stays reserved/unused.
  - **S1 deferred `upgrade_click` under-count CLOSED** — the two sim CTAs that navigate via a JS
    `location.href = 'pricing.html'` (a locked-tier upgrade card and the gated "go deeper"
    button, `assets/js/sim/sim-engine.js`) now emit `FWEvents.log('upgrade_click', …)` before
    navigating. They are `<button>`/card `onclick` handlers, not anchors, so the plan-surface
    delegated listener — which matches `a[href^="pricing.html"]` (`plan-surface.js:255`) — never
    saw them; there is therefore **no double-count**. New `source` values `sim:tier` / `sim:deep`
    added to the `upgrade_click` row in EVENTS.md. `simulation.html` already loads both
    `events.js` (the beacon) and `plan-surface.js`, so `FWEvents` is present. The sim-local
    `logEvent('tier_upgrade_click', …)` next to the second CTA is untouched — it is a
    localStorage ring buffer for Leo's user-testing week, never the funnel beacon.
  - **Full S1/S2 deferred sweep** — every item in the S1 and S2 DEFERRED lists was re-examined and
    given an explicit disposition (table in this entry's DEFERRED section below). The only item
    that was both actionable-now and not already assigned to a specific later session (S6/S8/S13)
    or gated on Jacob was the sim `upgrade_click` gap above; it is closed. Nothing was silently
    dropped.
- MIGRATIONS: **NONE new.** `server_errors` was folded into `0017_analytics.sql` back in S1
  exactly so Phase 0 ships one migration; S3 only adds the reader + writer. So the Phase-0
  migration set is precisely **0017 (analytics — already applied to prod D1 2026-07-24) + 0018
  (contact_messages — still pending)**. There is no 0019.
- BUSTERS: **`?v=20260724a` on TWO changed assets**, each on its one referencing page:
  - `assets/js/app/admin-console.js` (its first change today; was `20260720b`) → `admin.html`.
  - `assets/js/sim/sim-engine.js` (the S1-deferred `upgrade_click` fix; was `20260721f`) →
    `simulation.html`.
  No other `/assets/*` file changed — the new analytics CSS lives in admin.html's inline
  `<style>`, and `analytics.js` / `events.js` / the endpoint are `functions/*`, not assets.
  (UTC date 20260724 confirmed via `date -u`, per the S1/S2 buster note. The
  `.claude/worktrees/...` copy of `simulation.html` is a git worktree, not part of the deploy —
  deliberately left unstamped.)
- GATES: **39/39 green in 65.2s** (baseline at session start was 39/39 in 66.6s — no gate added
  or removed; the count is unchanged, so no CLAUDE.md/security.html count edit). Re-run after the
  adversarial fixes below; `test:admin`, `test:events`, `contrast:check`, `layout:check` and
  `pages:smoke` all green.
  - **`test:admin` extended** (`scripts/test-admin.mjs`): (1) the `/admin/analytics` route added
    to the "every admin route 404s a stranger" loop (+ an admin-gets-200 and unknown-panel-400
    check); (2) a new **`node:sqlite` section that loads the real migration 0017**, seeds a
    deterministic fixture (today=2026-07-24, anon1..anon4, a full funnel, paywall stages,
    events_daily rows, server_errors) and asserts **every aggregate to the row** — DAU/WAU/MAU
    3/3/4, signed-in uniques 2, activation 1/2=50%, paid=2 (expired premium excluded), MRR
    estimate vs null, the funnel counts + conversion, cohort week-0 retained=2, recency 3/1,
    feature totals from events_daily, zero-use membership, per-channel attribution, the tail's
    8-char anon + no-user-id guarantee, and `logServerError` write→read→redaction. The same-day
    pattern-matching fakeDb proves the endpoint's authorization; the real SQLite proves the
    numbers — the only thing that catches a wrong GROUP BY or a broken julianday window.
    (3) **The adversarial review added its own locking assertions**: `classifyChannel` boundary
    cases (t.co→twitter, bare x/ig/fb, a full host still maps, and the `xyz.com`≠twitter
    false-match guard), the 4xx drop (`logServerError` on a 429 writes no row), and PII
    redaction of an IPv4 address and a long hex token, not just an email.
  - Also green with the diff: `test:events` (events.js changed), `contrast:check` + `layout:check`
    (admin.html CSS), `pages:smoke`.
- ADVERSARIAL REVIEW (three parallel agents — individual agents, NOT a workflow, per
  this session's constraint — each a bounded lens over the S3 diff: SQL/aggregation
  correctness, auth+PII+XSS, and error-wiring+endpoint robustness; every finding
  independently refuted before acceptance). **Three real defects, none gate-visible, all
  fixed + gate-locked;** everything else survived refutation:
  1. **[MED] `classifyChannel` dropped Twitter/X and bare utm tokens into their own
     channel rows.** The twitter regex `/(^|\.)(t\.co|twitter|x)\./i` carried a trailing
     `\.` that the whatsapp/youtube entries omit, so `t.co` — the canonical Twitter/X web
     referrer host — plus bare `x`/`ig`/`fb` utm_source tokens fell through to
     `host.slice()`/`src.slice()` instead of the canonical channel. That silently defeats
     the Sources panel's entire purpose (per-channel outreach attribution — the LinkedIn
     vs IG vs Twitter split Igor/Leo need). Fixed by bounding each token on BOTH sides —
     `(^|\.)`…`(\.|$)` — so the one list matches a full host, a bare utm token, and an
     apex shortener uniformly (`functions/_lib/analytics.js` `CHANNEL_HOSTS`). **NOT** the
     reviewer's suggested `\.?`, which would let the single-letter `x` token false-match
     `xyz.com`. Six new `test:admin` assertions lock it (t.co→twitter, bare x/ig/fb, full
     host still maps, and the `xyz.com`≠twitter guard).
  2. **[LOW] User-caused 429s were written to `server_errors` as if they were crashes.**
     `career-roadmap.js` / `career-analysis.js` throw a `{status:429}` rate-limit into
     their outer catch, which logged it before returning the correct 429 — so the
     Sentry-stand-in fills with throttle noise exactly during an abuse wave, the one
     moment the Errors panel most needs to stay readable. Fixed once, uniformly, INSIDE
     `logServerError` (`functions/_lib/events.js`): a 4xx `status` guard drops user-caused
     throws (the 429, and any future 4xx) while still logging 5xx and the
     unclassified/502 upstream failures. `test:admin` now asserts a 429 writes no row.
     (402 cap-walls and 400 bad-slug are `return`s, not throws, so they never reached
     these catches — confirmed, not a finding.)
  3. **[LOW / defense-in-depth] `redactEmails` masked only emails.** Renamed to
     `redactPii` and extended to also mask IPv4 addresses and long hex / base64url runs
     (session tokens, ids, hashes) before a row is stored, so the file's own "an error
     log must never become a PII store" invariant holds for the non-email case too — an
     ops log is the last place a leaked secret should settle, even behind the admin gate.
     `test:admin` asserts an IP and a hex token are both masked. The current five callers
     put no secret in a message; this hardens the log against a future one that does.
  REFUTED and dropped (checked, then discarded): the **auth boundary** (adminGate→**404**
  to signed-out AND non-admin, reads correctly un-elevated matching `/admin/grants` +
  `/admin/audit`, static catch text — no internal leak, safe empty-DB 200); `logServerError`
  as an unhandled-crash vector (fully self-guarded, never rejects, never mutates `err`, so
  the added `await` cannot turn a handled 500 into a crash); **every contract of the four
  wired catches** (`env` in scope at each; contact's 200-on-dead-Resend / honest
  500-on-dead-D1 intact; career-roadmap's `err.status` path intact; no double-logging);
  param coercion + the MRR guard (no NaN reaches SQL; `undefined`/`''`/`'abc'`/`'0'`/`'-5'`
  all → `null` MRR, never fabricated); the **client renderers** (zero innerHTML; every wild
  value via textContent/createTextNode; clamped style widths/heights; `.title` set as a
  property not HTML); the **retention triangle for offset>0** (a reviewer built a
  multi-cohort skip-a-week SQLite scenario and matched the output exactly), the DAU/WAU/MAU
  1/7/30-day windows, the 48h `julianday` activation window (both sides carry the same `Z`,
  so any parse quirk cancels in the difference), the funnel/paywall counts, and the
  unbounded recency `MAX(ts)` scan (bounded in practice by the 90-day prune). `liveTail`
  confirmed to never select `user_id`/email; the residual that already-scrubbed props are
  shown to admins is the documented write-side tradeoff, not a new leak.
- DEFERRED (nothing silently dropped):
  - **Disposition of every S1/S2 deferred item** (the "finish everything deferred from S1 and S2"
    directive). Each was re-checked against the current tree:
    - S1 · *sim `upgrade_click` under-count* → **CLOSED this session** (see DONE above).
    - S1 · *`server_errors` table has no writer* → **CLOSED this session** — that WAS S3's scope
      (`logServerError` + the Errors panel).
    - S1 · *`Flightway.html` uninstrumented* → already **CLOSED by S2** (investigated: orphaned
      redirect shim, kept + `noindex`; a deferred tag would emit a phantom `page_view`).
    - S1 · *`upgrade_click` absent on `index.html`'s pricing nav link* → **LEFT, deliberate.** The
      four upgrade MOMENTS (D18) are all on plan-surface pages; a top-of-nav "curious click" is
      not an in-product upgrade intent and is already measurable as `page_view` on `/pricing` +
      `pricing_view`. Conflating them would dirty the paywall funnel.
    - S1 · *`plan_cap_hit` full endpoint sweep* → **LEFT, assigned to S8** (metering work) by the
      S1 entry; not re-scoped here.
    - S1 · *`pages:smoke` doesn't assert a live `/events` 204* → **LEFT, deliberate.** The route is
      live now, but a POST on every gate run would write a probe row into the shared `events`
      table each time; the Phase-0 runbook curls it once instead. Pollution > value.
    - S2 · *`sitemap.xml` still static* → **LEFT, assigned to S13** (sitemap-as-function).
    - S2 · *no `contact_view` event* → **LEFT, deliberate** (`contact_` is not an allowlisted
      prefix on purpose; `page_view` on `/contact` covers it).
    - S2 · *Turnstile unproven e2e; `POST /contact` inert until 0018; og cards not regenerated in
      CI; `pages:smoke` host assertions polarity-aware* → **LEFT, Jacob-gated / by-design** (keys,
      the migration apply in the runbook, a manual `og:build`, and correct per-host polarity).
  - **`career-roadmap.js` per-action error coverage.** That file's single `onRequest` is a big
    action dispatcher (`follow`/`choose`/`split`/`extend`/`uncommit`/`gap-*`/`complete-step`/…),
    and each branch has its OWN try/catch returning a 5xx before the outermost catch. Only the
    outermost catch (the default generate/chat path — where the expensive Gemini 500s actually
    live) is wired. Errors thrown inside the sub-action branches are still handled (their own
    500) but not logged. A follow-up can instrument those branches; left out here to keep the
    edit to the fragile roadmap dispatcher minimal and one-catch-per-file.
  - **Auth + payment endpoints not wired.** `logServerError` was deliberately NOT added to
    `auth/*` or `stripe/webhook.js` this session — the fragile boundaries (§3.8) deserve their
    own careful pass, and most real 500s originate in the AI endpoints that ARE covered.
  - **MRR is estimate-only.** No repo-side price in cents exists; the tile shows paid-count +
    plan breakdown reliably and an MRR estimate only when `MRR_MONTHLY_CENTS` is set. Lifetime is
    excluded from MRR by definition (still counted in `paidCount`).
  - **`reveal_view` funnel stage reads 0** — correct: the event doesn't exist until S6. It is
    present-and-flagged-`pending` so the funnel has its real shape now rather than a missing row.
  - **The `features` panel's weekly `uniqueDays` is an upper bound** (sum of daily uniques from
    events_daily), not a true weekly distinct — events_daily physically cannot give the latter.
    Labelled as such; a true weekly-unique would need a raw-events pass (deferred, not worth it).
  - **Dashboards are near-empty on the prototype until traffic accrues** — `events` was emptied
    after S1's probe (0 rows) and `events_daily` fills only at the 04:00 UTC rollup. This is
    correct, not a bug: the panels render their empty states, and the gate's seeded fixture is
    what proves the math. Same shape as the Opportunity Finder panel being empty until grounding
    is flipped.
- DRIFT (repo vs plan; repo wins):
  - **Plan §5 S3 says "fold server_errors into 0017 if foreseen, else 0019 here."** S1 foresaw it
    and created the table in 0017, so S3 adds **no migration** — the `(/0019)` in the plan's
    runbook is inert. Recorded so the merge runbook lists 0017+0018 only.
  - **Analytics is visible to ALL admins (root + sub-admin), not root-only.** The plan header
    says "root-admin gated"; I read that as "behind the console's existing `adminGate`", the same
    gate that already lets sub-admins read the audit log and grant lifetime comps. Making revenue
    root-only would be inconsistent with sub-admins already seeing who-comped-whom. `adminGate`
    delivers the actual security property (404-to-non-admins). Decision recorded here rather than
    guessed silently.
  - **The funnel's paywall stage is stage-totals + caps-by-feature, not a per-feature waterfall.**
    The plan asks for "segmented by feature"; the clean per-feature segmentation available is
    plan_cap_hit-by-feature (the one stage with a stable `feature` prop). A joined waterfall would
    look more precise than the prop shapes support. Documented in `funnelMetrics`.
- JACOB ACTIONS RAISED:
  1. **Execute the Phase-0 merge runbook below** (S1+S2+S3 are code-complete and green). This is
     the D26 fast-track: Phase 0 → main now, everything else soaks on Jacob_Work.
  2. **(optional) Set `MRR_MONTHLY_CENTS`** on the production Pages project (premium monthly price
     in cents, e.g. `1200`) to light up the MRR estimate tile. Unset is fine — paid-count + plan
     breakdown still show.
  3. **Confirm `ROOT_ADMIN_EMAIL` is set on the production Pages project** — without it nobody is
     an admin and `/admin` + every analytics panel 404s. (Already on the checklist; it is the gate
     for these dashboards being reachable at all.)
  4. Pre-existing, not caused by S3: cron `UNSUB_SECRET`/`MAILING_ADDRESS` (S1/S2), migration 0018
     apply (S2) — all in the runbook below.
- HOT FILES: n/a — S3 is pre-Phase-0-merge, so every file here is part of the Phase-0 merge
  itself. For the S20 final reconciliation, S3 adds to the Phase-0 surface:
  `functions/_lib/analytics.js`, `functions/admin/analytics.js`, `functions/_lib/events.js`
  (logServerError), `admin.html`, `assets/js/app/admin-console.js`, and the four wired functions
  (`career-analysis.js`, `career-roadmap.js`, `opportunities.js`, `contact.js`).

### Phase-0 merge runbook (S3 deliverable — Jacob executes; NEVER autonomous)

Phase 0 (S1 analytics engine + S2 trust/legal/lockdown + S3 dashboards) is code-complete and
`npm run gates` is 39/39 green on Jacob_Work. Ordered steps to promote it to production
(flightway.ai). Steps 1–3 are the deploy; 4–6 are verification. Each command is copy-pasteable.

0. **Pre-flight (on Jacob_Work):** `npm run gates` → 39/39 green. `npm run env:status` → confirm
   the branch tip is what you intend to ship and note the current `main` sha (for rollback).

1. **Merge Jacob_Work → main** (fast-forward; deploys `main` → the `flightway` project →
   flightway.ai with the LIVE Stripe key):

   ```
   git push origin Jacob_Work:main
   ```

   Rollback if needed: `git push origin <old-main-sha>:main --force-with-lease`.

2. **Apply the pending migration to the shared prod D1.** `--env production` is REQUIRED (the D1
   binding lives under `[env.production]`; the bare command fails "Couldn't find a D1 DB"). Check
   first — `apply` runs everything pending and 0014 is a DROP:

   ```
   npx wrangler d1 migrations list flightway-db --remote --env production
   ```

   Expect **only `0018_contact.sql` pending** (0017 was applied 2026-07-24). Then:

   ```
   npx wrangler d1 migrations apply flightway-db --remote --env production
   ```

   There is no 0019 — `server_errors` shipped inside 0017. After this, `POST /contact` stops
   returning its honest 500 and starts storing messages.

3. **Env vars on the `flightway` (production) Pages project** — Cloudflare dashboard → the
   `flightway` project → Settings → Environment variables:
   - **`ROOT_ADMIN_EMAIL`** — MUST be set (a registered account's email) or `/admin` and every
     analytics panel 404s for everyone. This is the gate for the dashboards existing at all.
   - Leave **`ANALYTICS_ENABLED` UNSET** (defaults on; set to `false` only to kill the beacon
     everywhere without a deploy).
   - **(optional) `MRR_MONTHLY_CENTS`** — premium monthly price in cents for the MRR estimate.
   - **(pre-existing, blocks the FIRST email send, not analytics/legal)** the standalone
     `flightway-cron` worker still needs **`UNSUB_SECRET`** (same value as Pages) +
     **`MAILING_ADDRESS`**; `npm run verify:env` prints the rotation one-liner. Not a Phase-0
     blocker for what S1–S3 ship, but on the list.
   - No cron redeploy needed for analytics: the daily rollup trigger (`0 4 * * *`) is already live
     on `flightway-cron` (deployed 2026-07-24) and writes the shared D1; `events_daily` fills for
     prod traffic automatically. The dashboards read live raw `events` immediately regardless.

4. **Verify the deploy landed (curl a FUNCTION, not an asset — S1 lesson):**

   ```
   SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke
   ```

   On production this asserts the flipped polarity: robots.txt **ALLOW**, **no** `X-Robots-Tag`,
   legal URLs 200. Then spot-check the S2 list + the beacon:

   ```
   for p in /privacy /terms /security /contact; do curl -sS -o /dev/null -w "%{http_code} $p\n" -L "https://flightway.ai$p"; done
   curl -sS -o /dev/null -w "%{http_code} dev.vars\n" -L "https://flightway.ai/.dev.vars.example"   # want 30x/40x
   curl -sS "https://flightway.ai/config" | grep -o '"analyticsEnabled":[^,}]*'                     # proves the functions bundle is current
   curl -sS -X POST "https://flightway.ai/events" -H 'content-type: application/json' -d '{"anon":"merge-probe","events":[{"n":"page_view"}],"path":"/"}' -w ' -> %{http_code}\n'   # want 204
   ```

   (Optionally delete the `merge-probe` row afterward for a clean baseline, per S1's probe note.)

5. **Verify the admin dashboards live:** sign in on flightway.ai as `ROOT_ADMIN_EMAIL`, open
   `/admin`. The Analytics section should render (Overview tiles; each tab loads on click). Direct
   check: `GET /admin/analytics?panel=overview` → 200 for the signed-in admin, **404 signed-out**
   (open it in a private window to confirm the 404). Sessions are per-deployment-subdomain, so
   re-login after the deploy.

6. **Confirm the loop closes:** within ~an hour of real traffic, Overview shows a non-zero DAU
   and the Live tail lists recent events; the next 04:00 UTC rollup then populates `events_daily`
   for the Features panel. If the Errors panel ever fills, it is doing its job — `logServerError`
   is wired into the AI endpoints' top catches.

### Phase-0 merge — EXECUTED (2026-07-24, main@34be6c4..f8485c7)

Phase 0 (S1 analytics + S2 trust/legal/lockdown + S3 admin dashboards) promoted to production
per the runbook above, with Jacob's explicit go for this specific promotion.

- **Merge:** `git push origin Jacob_Work:main` → fast-forward `34be6c4..f8485c7` (19 commits, all
  Phase-0 + the one `62207d2` auto-push process-docs commit). Rollback target recorded before the
  push: `34be6c4`. Reverse delta was 0; post-flight both deltas are 0, tree clean, PRODUCTION
  serving `f8485c7` in LIVE mode, PROTOTYPE `f8485c7` in TEST.
- **Migration 0018:** NO-OP. The runbook expected `0018_contact.sql` pending, but the shared
  remote prod D1 reported "No migrations to apply" — 0018 was already applied (shared-DB reality).
  Verified directly that `contact_messages`, `events`, `events_daily`, `server_errors` all exist
  on the remote prod D1. Nothing applied; nothing unexpected pending.
- **Live verification (all PASS on https://flightway.ai):**
  - Bundle landed ~30s after push; `/config` → `analyticsEnabled:true` (proves functions bundle current).
  - `SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke` → PASS (flipped polarity: robots.txt
    ALLOW + sitemap, canonical host untagged, internal files 302-blocked).
  - /privacy /terms /security /contact → 200; /.dev.vars.example → 302; no `X-Robots-Tag` header.
  - `POST /events` → 204. (The `merge-probe` anon_id left no persisted row — beacon write is
    async/buffered; cleanup DELETE matched 0.)
  - Admin gate: `OPTIONS /admin/analytics?panel=overview` → 204 (function routed); signed-out
    `GET` → 404 `{"error":"Not found."}` (the 404-not-403 gate holds).
- **Still on Jacob (dashboard-only, cannot be set from the repo):** confirm **`ROOT_ADMIN_EMAIL`**
  is set on the `flightway` (production) Pages project — until then `/admin` and every analytics
  panel 404 for everyone, so the signed-in admin verification (runbook step 5) is pending that.
  Optional `MRR_MONTHLY_CENTS` for the MRR tile. Pre-existing cron `UNSUB_SECRET`/`MAILING_ADDRESS`
  still gate the first email send (not a Phase-0 blocker).

## S4 — Email infrastructure: verification, welcome, prefs, templates (2026-07-24, Jacob_Work@62eb2d6..5409abc)

Phase 1's first session. The huddle's verification mandate + the audit's "you're not using Resend
for the 99%": one branded email system, soft-verify, lifecycle mail, and a real prefs center — built
once and shared by every later email. **The bulk of this build was already present in the working tree
as an uncommitted prior-session effort;** this session reconciled it against the §5 S4 spec, found the
gaps that had left `verify:meta` red, fixed them, and shipped it green. See DRIFT.

- DONE:
  - **Migration `0019_email_v2.sql`** — `users` gains `verified_at` / `verify_token_hash` /
    `verify_sent_at` (soft-verify), `google_sub` (lands here so S5 needs no second migration; nothing
    reads it yet), and three notification-category columns `notify_deadlines` / `notify_review` /
    `notify_product` (all `DEFAULT 0`, so the ~11 pre-V2 accounts are NOT silently enrolled — D10).
    **Grandfather:** `UPDATE users SET verified_at = created_at WHERE verified_at IS NULL` marks every
    pre-migration account verified. New `email_log` table (`id,ts,user_id,type,status,message_id` +
    2 indexes) makes sends idempotent + debuggable; `user_id` is the normalized email, consistent with
    `events`.
  - **Soft-verify flow (D7).** `createVerifyToken`/`consumeVerifyToken`/`isEmailVerified` in
    `functions/_lib/auth.js:493` — a one-time random token (SHA-256 stored, cleared on use, 48h TTL via
    `verify_sent_at`), mirroring the password-reset recipe so a used/expired link can't be replayed and
    a resend invalidates the prior link. `consumeVerifyToken` returns `{email, already}` (an idempotent
    re-click is a success, not an error). **`isEmailVerified` fails OPEN** (`auth.js:530`): a pre-0019
    schema reads verified, so the app never nags about a dark feature. `functions/verify.js` = the
    `GET /verify` landing (no auth — the token is the credential). `functions/auth/resend-verification.js`
    = session-gated resend, **3/day per account** via a new optional `windowSec` on `checkRateLimit`
    (`auth.js:277`, additive — no existing caller passes it). `GET /auth/me` now returns `verified`
    (fail-open) for the banner. `functions/admin/unverified.js` = report-only admin list of accounts
    >30d unverified (D7 flags for a later Jacob-approved purge; nothing is deleted).
  - **Client soft-verify banner (D7)** — `auth-nav.js` `syncVerifyBanner()`: shows only when signed in
    AND `FWAuth.isVerified() === false` (defaults true when unknown, so a pre-migration account never
    sees it), self-contained dark plate, **Resend** button (FWButtonBusy + 429 handling), per-session
    dismiss (sessionStorage). `auth.js` captures `verified` from `/auth/me` **before** `setSessionEmail`'s
    synchronous `fw-auth-change` dispatch so the banner's listener reads the fresh value.
  - **Shared email system** — `functions/_lib/email-template.js`: `renderEmail()` (branded dark shell,
    wordmark, preheader, CTA), `marketingFooter()` (CAN-SPAM postal address from `MAILING_ADDRESS`,
    one-click unsubscribe with the fixed `UNSUB_SECRET` token + a per-category `cat=`, prefs link, "why
    am I getting this", and the `List-Unsubscribe` value), `transactionalFooter()` (no unsub — you can't
    unsubscribe from a password reset), and **`sendMail()` — the single send chokepoint that NEVER
    throws**: logs exactly one `email_log` row (sent|failed|skipped), emits `email_sent` on success, sets
    the RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers Gmail
    requires, 8s AbortSignal timeout, forwards an idempotency key. `alreadySent()` makes welcome/day-3
    exactly-once. Pure (Web Crypto + fetch) so the standalone cron imports it.
  - **Lifecycle content** — `functions/_lib/emails.js`: `verifyEmail` (transactional), `welcomeEmail` +
    `day3Email` (marketing footer, honest tease — no fabricated match; S6's reveal owns those),
    `weeklyDigestEmail` (the Monday nudge, now on the shared shell). **Three existing senders refactored
    onto the chokepoint:** `forgot-password.js`, `send-results.js`, and the cron nudge — the last three
    bespoke Resend `fetch`es and hand-rolled HTML shells are gone.
  - **Welcome (S4) + verify on register** — `register.js` fires both in `context.waitUntil` so signup
    returns instantly; entirely best-effort (a mail failure or a pre-0019 schema never fails/slows
    account creation). `createUser` writes `notify_optin/deadlines/review/product = 1` for new rows in a
    separate best-effort UPDATE (D10 "defaults ON at signup"; disclosed, one-click unsub, verified-only
    send), `verified_at` left NULL until the link is clicked.
  - **Notification prefs center (D9/D10)** — `notify-prefs.js` rebuilt to four categories with **partial
    no-clobber** updates (a single-category toggle drops nothing — fragile save-path rule) + pre-0019
    fallbacks; **premium gate removed** (D9 makes the weekly digest free; inert while the paywall is dark,
    forward-correct after). `notify-optin.js` renders four labeled toggles into the Flight Plan card slot
    as `#notifications` (the anchor every email + the signup disclosure deep-links to) and, when `weekly`
    is still off, fires a one-time **`FWFeatureIntro` `weekly-digest`** prompt (D10 existing-user opt-in,
    never silent). `unsubscribe.js` handles **per-category + all-off**, adds the **RFC 8058 one-click
    `POST`** endpoint Gmail/Yahoo call, emits `email_unsub`. Signup disclosure line added to `auth.html`.
  - **Cron → daily lifecycle dispatcher** — `workers/cron/index.js` now dispatches on `event.cron`:
    **14:00 daily** = `runDaily` (day-3 follow-up **every** day, weekly digest only on Mondays), **04:00**
    = the S1 rollup. Day-3 targets accounts 3–7 days old, verified + opted-in, `email_log`-guarded — the
    `[now-7d, now-3d]` window is what stops the first post-deploy run from emailing every older account at
    once. Digest is verified-only (`verified_at IS NOT NULL`), plan-filtered only when the paywall is on.
    `wrangler.toml` crons `0 14 * * 1` → `0 14 * * *`.
  - **This session's three fixes to the inherited build** (each caught a real gap, none cosmetic):
    1. **portal.html did not load `feature-intro.js`.** The D10 existing-user weekly-digest prompt is
       triggered from `notify-optin.js` (portal-only) via `FWFeatureIntro.maybeShow('weekly-digest')`,
       but `FWFeatureIntro` was undefined on portal — the guard made it fail *silently*, so the prompt
       **never showed on the one page it's wired to.** Added the module (portal has no `data-fw-intro`/
       `data-fw-ribbon`, so nothing else auto-fires; `user.js` dep already present).
    2. **`verify:meta` MAILING_ADDRESS assertion pointed at the old location.** The refactor moved the
       CAN-SPAM warning out of `workers/cron/index.js` into `email-template.js` (which the cron *and*
       every Pages sender import), so the single warning now guards **every** marketing send path — the
       gate assertion was updated to match (strictly stronger than before).
    3. **`portal.html#notifications` is a JS-rendered anchor** (built at runtime by `notify-optin.js`),
       invisible to `verify:meta`'s static link-graph — the same legitimate class as `HASH_ROUTED`, so
       added a **precise per-fragment exemption** (not a blanket page exemption). And nothing scrolled to
       it (native fragment scroll fires before the panel mounts), so the advertised deep link landed on
       Home without revealing the toggles — added a `scrollIntoView` on inject when `location.hash ===
       '#notifications'`, so the link every email footer points at actually works.
  - **`docs/EVENTS.md`** — `verify_sent` / `verify_done` / `email_sent` / `email_unsub` registered +
    documented (all server-written); `test:events` asserts EVENTS.md↔code parity both ways (green).
  - **Account deletion** — `email_log` added to `USER_ID_TABLES` (`account.js:53`); it's the first
    `user_id`-only purge table, so `test:purge`'s classified set now counts `USER_ID_TABLES` too.
- MIGRATIONS: **0019** (`migrations/0019_email_v2.sql`) — **NOT applied to remote D1.** Additive
  (5 `ADD COLUMN` + a grandfather `UPDATE` + `CREATE TABLE IF NOT EXISTS`). Applying it is Jacob's, at
  the S5+ / next-merge point. **Until applied the whole subsystem degrades gracefully** — every
  new-column read/write is wrapped so signup still works and verification/banner/prefs stay inert. The
  invocation (per the S1 note): `npx wrangler d1 migrations apply flightway-db --remote --env production`.
- BUSTERS: `?v=20260724b` on `auth.js`, `notify-optin.js` (I bumped a→b for the scroll fix),
  `feature-intro.js`, `admin-console.js`; `?v=20260724a` on `auth-nav.js` (its first change today) —
  each across every page that references it (auth.js/auth-nav.js on all 11 app shells; feature-intro.js
  on 7 + newly portal.html; notify-optin.js on portal only). No new `/assets/*` files (all new code is
  `functions/*` + `migrations/*` + `scripts/*`).
- GATES: **40/40 green** (baseline at session start was 39/40 — the inherited tree had `verify:meta`
  red on 2 counts, both fixed above). NEW **`test:emails`** (`scripts/test-emails.mjs`) — loads the real
  migrations into `node:sqlite` and exercises the whole server surface: grandfather backfill + new-row
  defaults, verify-token round-trip (fresh/used/expired/already), the `sendMail` chokepoint (email_log +
  email_sent + List-Unsubscribe + idempotency + failed/skipped/timeout branches), day-3 idempotency,
  per-category + all-off unsubscribe (GET page + RFC 8058 POST), and the partial no-clobber notify-prefs
  update through the real handler. EXTENDED **`verify:meta`** (MAILING_ADDRESS location + the JS-rendered
  fragment exemption) and **`test:purge`** (`USER_ID_TABLES` in the classified set). CLAUDE.md counts
  updated 37 offline / 40 total.
- DEFERRED (nothing silently dropped):
  - **Migration 0019 unapplied** → verification/banner/prefs are inert on both live deployments until
    Jacob applies it (Jacob action). By design, not a bug — the code fails open.
  - **Turnstile / SPF-DKIM / hello@ alias** — unchanged Jacob items; email deliverability rides on the
    same Resend config `forgot-password` already uses.
  - **`google_sub` column ships unused** — S5's OAuth flow reads it; folded here per the plan to avoid a
    second migration.
  - **Welcome sends to an unverified brand-new signup** (immediate, per spec) — only the digest/day-3 are
    `verified_at`-gated. Deliberate: the address was just typed at signup.
  - **`alreadySent` treats a `failed` send as "already sent"** (status `!= 'skipped'`) — welcome/day-3
    won't retry a hard failure. Deliberate: never risk a duplicate lifecycle email; a `skipped` (no API
    key) row stays retryable.
- DRIFT (repo vs plan / repo vs itself; repo wins):
  - **The S4 build arrived as an uncommitted working tree, not a clean start.** `git status` at session
    start showed the full email subsystem already written but never committed and — critically —
    `verify:meta` **red** (2 failures). Treated per the "repo wins, record the drift" rule: reconciled
    every file against the §5 S4 spec, verified the fragile boundaries (token crypto, save/merge in
    notify-prefs, the register waitUntil path, cron idempotency) by trace + `test:emails`, fixed the two
    gate failures + the silent portal `feature-intro.js` gap, and shipped green. The build itself is
    sound; the prior session simply stopped before gates were green and before the ledger was written.
  - **Plan says migration "provisional 0019/0020".** Actual = **0019** (next free number; 0018 was the
    last).
  - **Plan: existing users get the digest opt-in prompt.** Implemented as a `FWFeatureIntro`
    `weekly-digest` intro fired from `notify-optin.js` — which is portal-only, and portal wasn't loading
    the intro module (fixed). The prompt is genuinely one-time (FWUser `featureIntros`) and writes
    `notify_optin=1` only on accept.
- JACOB ACTIONS RAISED:
  1. **Apply migration 0019 to the shared remote D1** — additive; until then verification/banner/prefs
     are inert (code degrades gracefully). `npx wrangler d1 migrations apply flightway-db --remote --env
     production` (check `migrations list` first — `apply` runs everything pending).
  2. **Redeploy the cron** (`npm run deploy:cron`) so the 14:00 trigger becomes daily (`0 14 * * *`) and
     the day-3 follow-up runs. No git push deploys the standalone cron Worker.
  3. **`UNSUB_SECRET` + `MAILING_ADDRESS`** — STILL the pre-existing blocker for the *first real send*:
     the cron falls back to a committed constant for the unsub secret (every unsubscribe link 403s if it
     disagrees with Pages) and to a company name for the CAN-SPAM address (not a valid postal address).
     Both must be set on the cron Worker AND both Pages projects; `npm run verify:env` prints the one-liner.
  4. **SPF/DKIM for Resend on flightway.ai + the `hello@`/`careers@` sending domain** — confirm, since S4
     turns tens of emails/week on where there were ~none.
  5. NOT promoted to production — S4 is Phase 1, soaking on Jacob_Work per D26 (single final merge at V2
     end). Pushed to Jacob_Work only.
- HOT FILES (touched here, will need reconciliation at the S20 final merge): `functions/_lib/auth.js`,
  `functions/_lib/events.js`, `functions/account.js`, `functions/auth/register.js`,
  `functions/auth/forgot-password.js`, `functions/auth/me.js`, `functions/send-results.js`,
  `functions/notify-prefs.js`, `functions/unsubscribe.js`, `workers/cron/index.js`,
  `assets/js/shared/auth.js`, `assets/js/shared/auth-nav.js`, `assets/js/shared/feature-intro.js`,
  `assets/js/app/notify-optin.js`, `assets/js/app/admin-console.js`, `admin.html`, `portal.html`,
  `auth.html`, `docs/EVENTS.md`, and the gate scripts (`verify-meta.mjs`, `test-account-purge.mjs`,
  `run-gates.mjs`). NEW (no merge conflict surface): `functions/verify.js`,
  `functions/auth/resend-verification.js`, `functions/admin/unverified.js`,
  `functions/_lib/email-template.js`, `functions/_lib/emails.js`, `migrations/0019_email_v2.sql`,
  `scripts/test-emails.mjs`.

## S5 — Google OAuth (SDK-free start/callback, PKCE+state, link-by-verified-email) (2026-07-24, Jacob_Work@bff7059..00bc72c)

Phase 1's second session (D6): kill password-only signup before the reveal (S6) ships.
SDK-free Authorization-Code + PKCE, mirroring the SDK-free Stripe discipline. Ships behind a
`/config.googleAuthEnabled` flag so the whole subsystem is invisible until Jacob creates an
OAuth client — no dead button, no half-flow. **No new migration:** `google_sub` was folded
into 0019 by S4 exactly for this.

- DONE:
  - **`functions/_lib/google-oauth.js`** (NEW) — the whole SDK-free layer. `beginTransaction`
    mints a random `state` (CSRF), `nonce` (id-token binding) and PKCE `code_verifier`, derives
    the S256 `code_challenge`, and seals all of it plus the return path into an **HMAC-signed,
    HttpOnly transaction cookie** (`fw_goauth`, Path=/auth/google, SameSite=Lax, 10-min TTL) so a
    client cannot forge it (`sealTxn`/`openTxn`, peppered with `SESSION_PEPPER`). `buildAuthUrl`,
    `exchangeCode` (POST `oauth2.googleapis.com/token`, **8s AbortSignal timeout** — Workers fetch
    has none, §3.7), `decodeIdToken`, `validateIdClaims` (iss ∈ google set, aud === client id, exp,
    nonce), `emailVerified`, `safeReturnPath` (same-origin relative only — closes the open-redirect
    on the `return` param).
  - **ID-TOKEN VERIFICATION — the documented choice (plan §5 S5).** The id_token arrives DIRECTLY
    from Google's token endpoint over the server-to-server TLS back-channel, in response to our
    authenticated code exchange (client_id + secret + PKCE). Per Google's own guidance a token
    obtained this way needs no signature check — there is no browser injection point, and we never
    accept an id_token from the redirect. So we **decode + validate claims, but do not fetch JWKS
    or verify RS256.** This deliberately avoids a JWKS-fetch + KV-cache + crypto-verify path whose
    only job would be to re-check what TLS already guarantees. The header comment says: if a future
    flow ever takes an id_token from an untrusted channel, this must gain signature verification.
  - **`functions/auth/google/start.js`** (`GET /auth/google/start`) — flag-gated, IP-rate-limited
    (30/hr, no refund — not a user budget), derives `redirect_uri` from the REAL request origin
    (`${url.origin}/auth/google/callback`) so prototype/prod/localhost each send their own
    registered value, sets the txn cookie, 302s to Google. Flag-off or throttled → bounces to
    `/auth.html#signin`, never to Google.
  - **`functions/auth/google/callback.js`** (`GET /auth/google/callback`) — flag-gated,
    rate-limited, quiet return on user-dismissed consent (`?error`), **CSRF check** (echoed `state`
    must equal the sealed one), code→id_token exchange, claim+nonce validation, **`email_verified`
    required** (denied otherwise — an unverified Google email is not ownership proof, so linking it
    would be a takeover vector). Then: existing email → `linkGoogleAccount` (a LOGIN); new email →
    `createGoogleUser` + `consumePendingGrant` (a SIGNUP). **Session parity:** same `createSession`
    + `sessionCookieHeader` as password login — the `fw_session` cookie is byte-identical
    (HttpOnly/Secure/SameSite=Lax/30d). 302s to the return path with `?fw_oauth=google&created=…`.
  - **`functions/_lib/auth.js`** — `OAUTH_ONLY_PASSWORD = 'google-oauth'` sentinel (users.password_hash
    is NOT NULL, 0001; the sentinel splits into <4 `$`-parts so `verifyPassword` rejects it — a
    Google-only account correctly cannot password-login, and forgot-password can still set a real
    hash later). `createGoogleUser` (verified_at=now per D7, google_sub, plan defaults 'free' via
    0008, notify defaults ON per D10 best-effort) and `linkGoogleAccount` (sets google_sub, promotes
    to verified via `COALESCE(verified_at, now)` — a verified Google email clears a prior account's
    verify banner).
  - **`functions/config.js`** — serves `googleAuthEnabled: googleAuthConfigured(env)` (true only
    when BOTH `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). Boolean only, no key material.
  - **`assets/js/shared/google-auth.js`** (NEW client module) — three page-agnostic jobs:
    `mount()` reveals + wires any `[data-google-auth]` button ONLY when `/config.googleAuthEnabled`
    (ships hidden → flag-off shows a plain email form, never a dead button); `landing()` fires
    `signup_complete`/`login` (method `'google'`, chosen by `created=1|0`) + `identify` when the
    callback redirect lands with `?fw_oauth=google`, then strips the one-shot params so a refresh
    can't re-fire — **client-side, matching the password path in auth.js, so the funnel is counted
    once with the anon_id present** (server does NOT log these, avoiding a double-count); `error()`
    shows one friendly line on `?goauth_err=`. Exposes `FWGoogleAuth.startUrl(ret)` for **S6 to
    drop the same button on the reveal gate card** with zero duplication.
  - **`auth.html`** — "Continue with Google" button + "OR" divider on BOTH the sign-in and register
    cards (hidden by default; scoped `#fw-oauth-css` block, white brand button per Google guidelines
    + theme-token divider); loads `google-auth.js`. **`portal.html`** — loads `google-auth.js` (the
    default return, so the landing event fires there). Verified in the preview pane: button renders
    (4-color G, 44px, #fff/#1f1f1f, "OR" divider).
  - **`docs/EVENTS.md`** — `signup_complete`/`login` props documented as
    `{ method: 'password' | 'google' }` and the OAuth-landing surface noted (names unchanged, so
    `test:events` parity is untouched).
- MIGRATIONS: **NONE.** `google_sub` (+ `verified_at`) shipped in `0019_email_v2.sql` (S4). **0019
  MUST be applied to the shared remote D1 before OAuth is enabled** — a Google account cannot exist
  without those columns (unlike the notify defaults, `createGoogleUser` does not degrade to a
  pre-0019 schema). The flag gate guarantees the endpoints are inert until Jacob sets the
  credentials, and 0019 + the credentials are the same §7 checklist step, so they land together.
- BUSTERS: **one NEW asset, `assets/js/shared/google-auth.js` @`?v=20260724a`**, referenced on
  `auth.html` and `portal.html`. **No existing `/assets/*` file changed** — the button styles are a
  page-local `<style>` in auth.html (not an asset), so no restamp. (auth.js CLIENT was NOT touched:
  the landing event lives in the new module, avoiding a wide auth.js buster bump across 11 shells.)
- GATES: **40/40 green in 65.7s** (baseline at session start was 40/40 in ~60s; no gate added or
  removed, so no CLAUDE.md/security.html count edit).
  - **EXTENDED `test:endpoints`** (`scripts/test-request-paths.mjs`, +24 assertions) — drives BOTH
    functions directly and stubs Google's token endpoint (OAuth can't hit real Google offline):
    start's 302 + PKCE-S256 + state + nonce + client_id + origin-derived redirect_uri + sealed
    HttpOnly cookie; the flag-off start bounce; the full sealed-transaction round-trip for **new
    user** (created=1, session-cookie parity asserted attribute-by-attribute, txn cleared,
    google_sub + sentinel + verified_at stored), **existing user** (created=0, link, signed in),
    **unverified email denied** (no session), **CSRF state mismatch** (no session), **missing txn
    cookie**, **token-exchange failure** (error not crash, no session), and the **flag-off callback**.
  - **EXTENDED `verify:env`** — `['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']` added to
    `PAGES_OPTIONAL_PAIRS` so a half-configured Google (id without secret — a button whose flow
    would 500 at the exchange) is surfaced the same way a half-set Turnstile is.
- DEFERRED (nothing silently dropped):
  - **The quiz-gate "Continue with Google" button is S6's** — the reveal gate card doesn't exist
    yet (S6 builds it). The client helper (`FWGoogleAuth.startUrl`) and the flag plumbing are in
    place so S6 drops a `[data-google-auth]` button and loads `google-auth.js`; nothing here needs
    revisiting. Pricing intent-point buttons similarly deferred (low value; auth.html is the concrete
    S5 surface, and the scope line reads "auth + gate").
  - **`gate_google_click` (plan §5 S6) not emitted** — it belongs to the S6 gate card, not the
    auth-page buttons (which, like the password buttons, fire no click event). `method:'google'` on
    `signup_complete`/`login` — the S5-scoped event work — IS shipped.
  - **No live end-to-end OAuth test** — impossible offline (needs Jacob's real client). The gate
    covers every branch with a stubbed token endpoint. **Manual post-merge test (plan requirement):**
    with the credentials set and 0019 applied, on the prototype → click "Continue with Google" on
    /auth#signin → Google consent → returns to /portal signed in; confirm `fw_session` set, a new
    address creates a `verified_at`-set free row with `google_sub`, an existing address links + logs
    in, and the admin funnel shows `signup_complete{method:google}`. Re-run the same on flightway.ai
    after the final V2 merge (redirect_uri differs per host — both are registered in §7).
- DRIFT (repo vs plan; repo wins):
  - **Plan §5 S5 says "`users.google_sub` column, add in S4's migration."** Done — S4 already added it
    to 0019, so S5 adds **no migration**. Recorded so the final-merge runbook lists no S5 migration.
  - **Buttons on auth.html only this session** (plan lists "auth + gate + pricing intent points"):
    the gate is S6's build, so its button ships with it; pricing is deferred. Not a scope cut — the
    reusable helper makes S6's addition a one-liner.
  - **ID-token: claim-validation, not signature-verification** — the plan offered "JWKS with KV
    caching, OR tokeninfo, document the choice." Chose neither: the back-channel TLS delivery makes
    both redundant (documented above + in the file header). Simpler and fewer moving parts.
- JACOB ACTIONS RAISED:
  1. **Create the Google OAuth client + set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on BOTH Pages
     projects** (§7 step 6). Google Cloud Console → OAuth consent screen (External, app "FlightWay") →
     Credentials → OAuth Client (Web): authorized origins `https://flightway.ai`,
     `https://flightwayjacobprototype.pages.dev`, `http://localhost:8934`; **redirect URIs
     `<origin>/auth/google/callback` for each origin** (the callback derives redirect_uri from the
     request host, so each must be registered exactly). Until both env vars are set, the buttons stay
     hidden and the endpoints bounce to sign-in — the branch is safe to deploy dark.
  2. **Apply migration 0019 to the shared remote D1 BEFORE enabling the credentials** (already on the
     checklist for S4). `createGoogleUser` needs `google_sub` + `verified_at`. Check first:
     `npx wrangler d1 migrations list flightway-db --remote --env production`, then `… apply …`.
  3. **Confirm `SESSION_PEPPER` is set on both Pages projects** (it is — the middleware 503s without
     it) — the OAuth transaction cookie is HMAC-sealed with it.
  4. NOT promoted to production — Phase 1, soaking on Jacob_Work per D26. Pushed to Jacob_Work only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge): `functions/config.js`
  (Phase 0), `functions/_lib/auth.js` (also S4-hot), `auth.html` (Phase 0), `portal.html` (Phase 0),
  `docs/EVENTS.md` (also S4-hot), `scripts/verify-env.mjs`, `scripts/test-request-paths.mjs`. NEW (no
  merge-conflict surface): `functions/_lib/google-oauth.js`, `functions/auth/google/start.js`,
  `functions/auth/google/callback.js`, `assets/js/shared/google-auth.js`.

## S6 — Phase 1: Quiz rework + the reveal (2026-07-24, Jacob_Work@9d963d6..1d12d1e)

The highest-leverage session: value BEFORE the wall (D5), real signal behind the value (D8),
honest nav for visitors. All shipped and 41/41 gates green.

- DONE:
  - **Question rework (D8).** `QZ_INITIAL_IDS` `[0,24,2,20,21,22,3,5,17,23]` →
    **`[24,1,18,3,5,6,22,16,17,21]`** (`quiz-app.js:585`). Scoring-map coverage **4/10 → 8/10**
    (the 8 scored ids are 1,18,3,5,6,22,16,17). Leaning (24) opens and feeds a zone-score boost
    but carries no `s:`; goals2 (21) closes for personalization. Grade(0)/school(2)/name(23) are
    OUT of the scored flow. Everything downstream degrades gracefully when they're absent
    (verified by test:vectors/test:user/test:school green): `qzBuildHubPayload` falls back
    (name→'Student', year/school→null), academics uses its `_default` major copy, `qzSchoolBlurb`
    returns ''.
  - **Name/school/grade relocation.** **Name** → an optional "First name" field on the gate
    (`qzCreateAccount` reads `#qz-su-name` → `qzName`, `quiz-app.js`). **Year + school** → a compact
    **"About you" block** added to the post-signup Academic Profile step (`hub-academics.js`:
    `aboutYouHtml()` + year/school handlers + persist). Written through the SAME v1
    `profile.{year,school}` paths `qzBuildHubPayload` uses, so KEY_MAP normalizes them to
    `identity.{year,school}` — no bespoke identity write, school single source intact. The academics
    commit gate widened (`FWHubAcademics.hasAboutYou()`) so year/school persist even with zero
    scored academic answers.
  - **The reveal (D5).** `qzShowReveal()` replaces the bare `qzShowGate()` call
    (`qzFinishInitialQuiz`). Reuses the dormant `qzShowResults` ranking chain
    (`rankOnetCareersFromVectors` → `rankFeaturedFromVectors` → `FWHubCareers.rankCareersFromQuizScores`,
    `qzRankCareersForReveal`). Renders **top-3 real match cards** (name, sector, absolute fit % + tier,
    2-line "what it is"), **full factor breakdown on #1** via `FWWhyMatch` (`qzInjectRevealWhyFor`,
    #1 expanded by default; #2/#3 have a "Why this fits" toggle → `reveal_card_expand`), and **7
    blurred placeholders (ranks 4–10) with NO real career data in the DOM** (`qzRevealBlurredHtml` —
    placeholders only, so devtools cannot defeat the gate). New `#qz-reveal` section + scoped reveal/
    OAuth CSS in `quiz.html` (page-local — no shared-CSS bump for the reveal styles). Local persist
    (`qzPersistHubQuiz`, local-only pre-signup) seeds the personality vector so `readQuizVectors`
    backs the "why". Verified live: Software Engineer → **Technology & Software** (see the sector fix),
    3 real + 7 locked, gate below, correct light-mode render.
  - **Sector-derivation fix (bug the reveal exposed).** O*NET-ranked careers carry a synthetic id
    (`'soc:15-1252.00'`), so `FWHubCareers.careerToQuizKeys[career.id]` missed and EVERY
    reveal/results card fell back to `'business'` (a Software Engineer shown as "Business &
    Entrepreneurship" with a business portrait). Added `qzIndustryKeyForCareer()` + `SOC_MAJOR_TO_QZ`
    (SOC major group → quiz industry key) and routed `qzResolveHubCareer` through it. Fixes the reveal
    AND the emailed `qzShowResults` screen (strict improvement — correct sectors + portraits). Live-
    confirmed: 15xx→tech, 27xx→creative, 13xx→finance, 29xx→healthcare.
  - **Inline gate with Google (no bounce to auth.html).** Enhanced `#qz-gate` IN PLACE: a
    "Continue with Google" block (`data-google-auth`, `data-return="/portal.html"`, dark until
    `googleAuthEnabled` — the S5 flag) above the email/name/password form. `google-auth.js` loaded on
    quiz.html; its own load-time `mount()` wires the button (no double-wire). **A Google signup from
    the quiz preserves the just-taken matches**: the reveal's local `qzPersistHubQuiz` writes the blob,
    and the portal-boot `syncQuizProfile`→`uploadLocalQuizIfPresent` pushes it server-side. `signup_complete`
    now carries `source:'quiz'` via a new backward-compatible `opts` arg on `authRegister` (`auth.js`).
  - **Public nav variant + mobile fix** (delegated to a Sonnet agent, reviewed + verified). Runtime
    `applyNavVariant()` in `auth-nav.js`: signed-out → marketing nav (How it works, Pricing, Sign in,
    Get started CTA) on the EXISTING markup — no per-page HTML edits, so S7 flips one `PUBLIC_TABS`/
    `APP_TABS` constant, not 14 pages. Idempotent (caches the app tabs, guards on
    `data-fw-nav-variant`), preserves the sign-in link + theme toggle. Mobile: a `flightway-pages.css`
    rule wraps the ≤4 public items (no horizontal scroll at 320/343/375, agent-verified via
    Playwright); signed-in scroll rail untouched. Live-confirmed on the reveal screenshot.
  - **Events.** `reveal_view`, `reveal_card_expand`, `gate_google_click` registered
    (`functions/_lib/events.js` REGISTERED_EVENTS + `docs/EVENTS.md`, test:events green in both
    directions); `signup_complete.source` documented; `gate_view` now fires in `qzShowReveal`.
  - **Calibration.** New committed instrument **`scripts/quiz-calibrate.mjs`** (`npm run quiz:calibrate`)
    — extracts the REAL scoring maps + initial set from `quiz-app.js` (eval of the literals, no
    duplication → no drift) and runs 4 personas over the OLD vs NEW initial set. Before/after:

    | Persona | OLD (4 scored): #1↔2 gap · top-3 | NEW (8 scored): #1↔2 gap · top-3 |
    |---|---|---|
    | STEM / builder | **12** · finance 100, creative 88, tech 81 | **43** · **tech 100**, science 57, engineering 57 |
    | Humanities / social | 32 · social 100, education 68, healthcare 50 | 2 · social 100, education 98, healthcare 67 |
    | Business / finance | 14 · finance 100, business 86, law 83 | 13 · **business 100**, finance 87, law 69 |
    | Generic / undecided | 17 · creative 100, business 83, education 67 | 8 · education 100, business 92, creative 75 |

    **Headline:** the OLD 4-question set MIS-RANKED the STEM persona as *finance* #1; the NEW 8-question
    set correctly puts *tech* #1 with a **43-point** separation (vs 12). Business also flips finance→
    business #1 (more correct for the lean). The rework's win is correctness + separation on leaning
    personas, which propagates to the reveal's vector-cosine career ranking.
- MIGRATIONS: **none.**
- BUSTERS: **`?v=20260724c`** on the 5 changed assets — `quiz-app.js` (quiz.html), `auth.js` (11
  pages), `hub-academics.js` (quiz.html), `auth-nav.js` (11 pages), `flightway-pages.css` (10 pages).
  `google-auth.js` got a NEW reference on quiz.html at its existing `?v=20260724a` (file unchanged).
  `verify:busters` PASS (the sed sweep was path-qualified — `shared/auth.js` did not touch
  `shared/google-auth.js`).
- GATES: **41/41 green in 63.8s** (baseline was 40/40 at S5). NEW **`test:quiz-funnel`** (Playwright,
  `port` tier, **port 8939** — 8938 was already `artifacts:ui-check`): scoring-map coverage ≥8/10;
  reveal renders top-3 from a stubbed 10-career fixture (3 real cards, names in order, `#qz-reveal`
  visible, `reveal_view`+`gate_view` logged); blurred set = exactly 7 `.qz-match-card--locked` with
  NONE of ranks-4–10's names in the reveal `innerHTML`/`innerText`; zero page errors. `gates:unit`
  37→38.
- DEFERRED (nothing silently dropped):
  - **`source:'quiz'` is on the PASSWORD `signup_complete` only.** The Google path's `signup_complete`
    (fired on portal by `google-auth.js landing()`) doesn't carry source — that would need source
    encoded through the OAuth `return`/state and read back in landing(). `gate_google_click` (the
    quiz-funnel event the plan lists) IS fired. The whole Google button is dark until Jacob sets creds.
  - **Academics "About you" button label** stays "Continue →" (not "Save & continue →") when ONLY
    year/school is filled with no scored academic answer — cosmetic; the commit still fires (data
    persists, gated on `hasAboutYou()`).
  - **layout:check matrix rows for the reveal/mobile widths NOT added.** `verify-fluid-layout.mjs`'s
    `WIDTHS` is global across all matrix pages, so adding 320/343/375 risks unrelated failures; and the
    reveal only renders after quiz completion (the matrix loads pages in their default state). Coverage
    is instead the new `test:quiz-funnel` (renders + inspects the reveal) + the nav agent's direct
    Playwright pass at 320/343/375. Documented deviation, not a gap.
- DRIFT (plan vs repo; repo wins):
  - **Plan §5 S6 says re-run "the persona calibration harness (docs/CAREER_TESTER.md personas)".**
    `CAREER_TESTER.md` is the career-SIMULATION feature, not a quiz-scoring harness — no such harness
    existed. Built `scripts/quiz-calibrate.mjs` instead.
  - **The audit's "generic profile scores 90+ against nine of ten sectors"** is a career-fit-DISPLAY
    metric (vector cosine over the full 750-career catalog), not a sector-score-normalization artifact,
    so the sector-layer calibration harness does not reproduce that exact number. What it shows is the
    more fundamental fix (mis-ranking → correct ranking + separation). Honest, not a miss.
  - **`qzShowResults` (the emailed #r= results screen) shared the always-'business' sector bug** — fixed
    for it too as a side effect (it's the same `qzResolveHubCareer`).
- JACOB ACTIONS RAISED (no NEW blockers):
  1. The reveal + gate work today with EMAIL signup — nothing to do for that path.
  2. The gate's **"Continue with Google" stays hidden until `GOOGLE_CLIENT_ID`/`SECRET` are set + migration
     0019 applied** — already on the checklist from S5. When you run the post-S5 manual OAuth test, also
     confirm a Google signup FROM THE QUIZ lands on /portal with the matches saved (portal-boot
     `syncQuizProfile` pushes the reveal's local blob).
  3. Not promoted to production — Phase 1, soaking on Jacob_Work per D26. Pushed to Jacob_Work only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge): `quiz.html`
  (Phase 0 meta), `functions/_lib/events.js` (S1), `docs/EVENTS.md` (S1/S4), `assets/js/shared/auth.js`
  (S1-instrumented, also S4/S5-hot), `assets/js/shared/auth-nav.js`, `assets/css/flightway-pages.css`,
  and every root `.html` (auth.js/auth-nav.js buster bumps). NEW (no merge-conflict surface):
  `scripts/quiz-calibrate.mjs`, `scripts/test-quiz-funnel.mjs`. Also touched: `assets/js/quiz/quiz-app.js`,
  `assets/js/hub/hub-academics.js`, `package.json`, `scripts/run-gates.mjs`.

## S7 — Phase 2: the IA flip (2026-07-24, Jacob_Work@e45c865..5b35417)

D2 executed: the product's front doors now say development first. Five tabs, a new
primary destination that answers "what do I do this week", Home reordered behind it,
and the hub retitled to the discovery surface it actually is.

- DONE:
  - **5-tab nav on all 12 app shells (D2).** `Home · Flight Plan · Roadmap · Marco ·
    Explore`, keys `home/plan/roadmap/advisor/explore`. The Quiz tab is **gone**
    signed-in (it was already hidden by `syncQuizTab()`; that function is deleted with
    it) and the quiz is reachable from Home's Sharpen card and the new Explore doors.
    Static markup on every page, not JS-built: the nav must paint before scripts run.
    `app-nav.js` gained `flightplan.html → 'plan'` (`:5`) and `hub-page → 'explore'`
    (`:19`).
  - **`applyNavVariant()`'s selector widened `.nav-links.app-nav` → `.app-nav`**
    (`auth-nav.js:62`). dashboard.html carries `.app-nav.hub-app-nav` inside its fixed
    topbar, so S6's narrower selector silently skipped the ONE app page a signed-out
    visitor is meant to browse — five signed-in-only tabs, each bouncing to /auth, with
    no sign-in affordance. Verified: signed-out dashboard now renders
    `[How it works][Pricing][Get started]` with `data-fw-nav-variant="public"`.
  - **`flightplan.html` (NEW).** This Week hero → Deadline Radar + Commitments empty
    states → Evidence Locker → doors row. `FWPageVeil`, `data-fw-intro="flightplan"`,
    noindex + description + footer, classified `shell` in `verify:meta`.
  - **ONE Flight Plan module, two surfaces.** `portal-flightplan.js` `resolveHost()`
    (`:170`) picks `#flightplan-hero` → hero mode, else `#portal-thisweek` → mirror
    mode, else the legacy portal hosts. Deliberately not a second module: the check-off
    POST writes the roadmap tree AND merges `objectiveVector`/`objectiveAiPatch` back
    into local quiz state — the hydration→vector-merge path (§3.8). It gets exactly one
    writer. The hero also refuses to remove itself on a 402 or a network failure
    (`:196`, `:205`): on the page the tab is named after, a blank body or a permanent
    "Loading…" is worse than a locked card or an honest error line.
  - **Next-deadline chip, without a hot-path cost.** `/weekly-plan` already loads
    `loadUpcomingDeadlines` on the once-a-week regeneration path, so the record is
    **stored into the week doc** there (`functions/weekly-plan.js:154`) and re-dated at
    response time by `freshDeadline()` (`:194`) — `daysOut` is never persisted, so a doc
    written on Monday still says the right number on Friday, and a lapsed date returns
    `null` instead of "closes in -3 days". Reading it per GET would have added a D1 blob
    read plus a KV get to a page that is now hit on every visit. Verified
    `refreshDoneState()` mutates `doc.tasks` in place and preserves the new field.
  - **The chip IS the "live opportunity tease".** In today's data model they are the
    same record: the Opportunity Finder's grounded results are the only place a real
    date comes from (`_lib/deadlines.js:78`). Two elements would have meant inventing a
    second one.
  - **Home (portal.html) reordered development-first.** `AREAS` is now Roadmap →
    Flight Plan → Marco → Resume → Help-us-know-you → **discovery block** (Explore
    careers, Sharpen, Career Switch) (`portal.js:9`). "Career Hub" is relabelled
    "Explore careers" to match the tab. The **This-Week mirror** mounts into a new
    `#portal-thisweek` (`portal.html:58`) placed ABOVE the action grid and OUTSIDE
    `#portal-actions`, which `renderActions()` wipes on every re-render; it carries the
    same check-offs plus an "Open my Flight Plan →" link.
  - **Notification prefs moved to flightplan.html.** The weekly-email toggle is about
    the weekly Flight Plan, so `notify-optin.js` + `feature-intro.js` now load there and
    not on portal, and the four `#notifications` deep links moved with it
    (`_lib/email-template.js:68`, `unsubscribe.js:86`, `auth.html:128`, plus the
    `test:emails` and `verify:meta` assertions). Two copies of a toggle bound to one
    prefs record would have been two sources of truth.
  - **Explore header on dashboard.html.** Title/description → "Explore careers", and a
    fixed top-right pill row (`#hub-explore-doors`) with *Retake the quiz* and *Sharpen
    matches*. **Deliberately `position: fixed`, not a header row in flow:** the map is a
    full-viewport `<canvas>` whose camera math is normalized against the viewport box,
    so anything in flow above it silently re-frames the whole map. Measured live at
    right:20 / top:76 with **no overlap** against `#hub-map-hud` (which is top-LEFT).
  - **Working doors, not decorative ones.** Mock Interview → `coach.html#practice` +
    a 6-line `openFromHash()` in `interview-mode.js:748` that routes through `open()`
    so the first-run interstitial (and its free-plan upsell) still fires; Evidence
    Locker → `#evidence`, a static section on the same page that `artifacts.js` now
    also mounts into (`artifacts.js:107`); Opportunities → `roadmap.html?focus=1`,
    where the finder actually lives; Applications is a non-link "Coming soon" card
    (S12). One new lucide icon (`clipboard-list`) added to `lucide-lite.js` first, per
    the icon rule; every other icon reuses the existing 23.
  - **`FWFeatureIntro` `flightplan` entry** (`feature-intro.js:265`) — no
    `entitlement`, because §4 makes the weekly loop free forever, so it is orientation
    and never an upsell.
- MIGRATIONS: **none.**
- BUSTERS: **`?v=20260724d`** on the 10 changed assets, across every referencing page —
  `flightway-2.css` (11 refs), `hub-dashboard.css` (1), `artifacts.js` (2),
  `portal-flightplan.js` (2), `portal.js` (1), `interview-mode.js` (1), `app-nav.js`
  (12), `auth-nav.js` (12), `feature-intro.js` (8), `lucide-lite.js` (11). Swept with a
  path-qualified matcher so `shared/auth-nav.js` never touched `shared/auth.js` (the S6
  sed trap). New page references `flightway-pages.css` at its EXISTING `20260724c` — a
  new page is not a change to an old asset.
- GATES: **41/41 green in 70.1s** (baseline at session start was 41/41 in 66.4s — no gate
  added or removed, so no CLAUDE.md/security.html count edit; `layout:check` grew 330 →
  **360 cells** and still passes clean, 42.9s → 47.1s). Run AFTER the push, because
  `pages:smoke` reads the live deployment and `/flightplan.html` cannot 200 until it is
  deployed — the same ordering S1 hit with `POST /events`. Confirmed in the log:
  `OK /flightplan.html`.
  - EXTENDED **`verify:meta`**: flightplan.html classified `shell`; a new precise
    `HASH_ROUTE_FRAGMENTS` set for `quiz.html#sharpen` and `coach.html#practice` — hash
    ROUTES on pages that are otherwise ordinary documents, so `HASH_ROUTED` (whole-page)
    was too blunt. The exemption is **not** a rubber stamp: a new assertion greps
    `assets/js` for the quoted fragment and fails if the handler is gone. **Proven to
    bite** — renaming `'#practice'` in `interview-mode.js` turns it red.
  - EXTENDED **`layout:check`** (flightplan added: 330 → 360 cells) and
    **`pages:smoke`** (`/flightplan.html` — a boot error on a nav tab is a dead primary
    destination).
  - `contrast:check` needed no page list (it scans all CSS); the new plates are theme
    tokens, not literal dark hexes, and it is green.
- DEFERRED (nothing silently dropped):
  - **`/weekly-plan` is still `requirePlan(env, email, 'premium')`**
    (`functions/weekly-plan.js:121`), while §4 says the Weekly Flight Plan is **free
    forever**. Left to S8, which owns the cap table — but this is now a **primary nav
    tab**, so it is the single highest-priority row in S8's re-tier.
    **And it is NOT hypothetical: `/config` on the prototype returns
    `paywallEnabled: true` today** (checked live this session — the "ships dark" note in
    `entitlements.js:3` is stale as a description of the running environment). So a
    free-plan account already gets a LOCKED Flight Plan tab. Not a regression — the same
    card carried the same gate on Home before this session — but the IA flip makes it
    the front door, which is the opposite of D1.
    **Deliberately not fixed here.** It is a two-line edit, but it is an entitlement
    change that also opens a Gemini generation path to free accounts, which is a cost
    decision S8 (and Jacob) should make as part of §4 rather than a side effect of a nav
    session — the CLAUDE.md "hold and ask" carve-out. What S7 does do is make the
    failure honest: the hero renders a proper `FWEnt.lock` surface and refuses to remove
    itself (`portal-flightplan.js:196`), so the tab reads as locked rather than blank.
  - **Deadline Radar and Commitments ship as empty states only** — that is the scope
    (S9 and S10 fill them). The copy states when dates appear rather than implying a
    feature that is not there.
  - **The doors row has no per-tier locked states.** §5 S8 owns the shared `fw-locks`
    pattern; adding a half-version here would have to be redone.
  - **Opportunities has no true deep link.** The finder mounts inside the roadmap's
    focus panel (`opportunity-finder.js:81` needs `.roadmap-focus-inner`), so the door
    goes to `roadmap.html?focus=1`. A real `#opportunities` route means opening the
    focus drawer from a hash — roadmap-internal, not S7.
  - **flightplan.html uses the shared 1040px `.portal-wrap`, not Home's 1760px
    `--page-max` grid.** Home is a two-column dashboard; the Flight Plan is a single
    column of things to do. `layout:check` is green at 2560 (nav + footer are the
    full-bleed painted frame, per the S2 heuristic fix).
- DRIFT (plan vs repo; repo wins):
  - **`thisweek_task_done` was deliberately NOT registered.** The hero and the mirror
    are the same card, the same module and the same POST, so a second event name for one
    check-off would double-count the metric the whole loop is measured by.
    `flightplan_done` and `flightplan_view` carry `surface: 'hero'|'mirror'` instead,
    which answers the same question. Recorded in `docs/EVENTS.md` under its own heading
    so a later session does not "fix" it back.
  - **The plan's Explore doors are "Quiz (retake/sharpen), Compare, Deep dives".
    Compare and Deep dives are not destinations** — they are buttons inside a career's
    panel (`dashboard.html:207` `#panel-compare`; `career-compare.js`/
    `career-deep-dives.js` are panel-only), reachable only after picking a career from
    the map or the search box. Shipping doors for them would have meant inventing pages.
    The header ships the two real ones and the map's own search remains the route to a
    career panel.
  - **The plan says "move `portal-flightplan.js` here as the primary mount".** The mount
    moved; the FILENAME did not. Renaming would churn the buster across two pages and
    the ledger's file trail for zero behavioural gain — the header comment says so.
  - **The plan's portal `AREAS` order omits `profile-build`.** It is kept, placed after
    Resume (it deepens the profile the development tools read), rather than dropped.
  - **A real bug the build surfaced:** `section { padding: 120px 40px }` is a GLOBAL
    element rule in `flightway-pages.css:279` (it exists for the marketing pages). Every
    `.fp-module` overrode it with its own card padding; `.fp-doors` did not, and pasted
    240px of dead space into the middle of the page. Caught by measuring the DOM, not by
    reading the CSS — `.fp-doors { padding: 0 }`.
- VERIFIED (headless, before the push; the probe is in the session scratchpad, not
  committed): flightplan.html boots with **zero page errors** in light and dark, renders
  3 tasks + the "Closes in 21 days · Summer Analyst Program · Bain" chip + 5 doors + 3
  modules + 8 lucide icons, active tab "Flight Plan", **no horizontal scroll at 1280 or
  375**; portal renders the mirror inside `#portal-thisweek` with an
  `href="flightplan.html"` CTA, the AREAS order reads Career Roadmap → Flight Plan →
  Marco → …, and the notify panel is gone from it; dashboard shows the Explore doors
  clear of the HUD with the Explore tab active and the new title; signed-out dashboard
  flips to the public nav.
- JACOB ACTIONS RAISED: **none new.** S7 adds no env var, no migration, no Stripe
  object. Not promoted to production — Phase 2, soaking on Jacob_Work per D26; pushed to
  Jacob_Work only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  every root `.html` that carries the nav (admin, auth, career, coach, dashboard,
  portal, profile-build, quiz, resume, roadmap, simulation) plus `pricing.html` (buster
  only), `functions/weekly-plan.js`, `functions/_lib/email-template.js`,
  `functions/unsubscribe.js`, `docs/EVENTS.md` (S1/S4/S6-hot),
  `assets/js/shared/auth-nav.js` (S6-hot), `assets/js/shared/app-nav.js`,
  `assets/js/shared/feature-intro.js` (S4-hot), `assets/js/app/portal.js`,
  `assets/js/app/portal-flightplan.js`, `assets/js/app/artifacts.js`,
  `assets/js/coach/interview-mode.js`, `assets/vendor/lucide-lite.js`,
  `assets/css/flightway-2.css`, `assets/css/hub-dashboard.css`, `_redirects`, and the
  gate scripts (`verify-meta.mjs`, `verify-fluid-layout.mjs`, `smoke-pages.mjs`,
  `test-emails.mjs`). NEW (no merge-conflict surface): `flightplan.html`.

## S8 — Phase 2: cap re-tier + front-door locked states (2026-07-24, Jacob_Work@0b968c4..883b558)

§4 implemented. The loop is free, the tools are metered tastes. **Most of this session
is a LOOSENING** — the weekly plan, receipts and the whole resume builder came out from
behind the paywall, the Opportunity Finder became a preview instead of a wall, mock
interviews went from 0-on-free to a taste, and Marco went 5→10. The one tightening is
career sims (ungated → 1/month), which was the huddle's scarcity pick.

- DONE:
  - **`plan-limits.js` grew two windows and a per-plan window.** `resetPeriod` was
    `'day'|'lifetime'`; it is now `'day'|'week'|'month'|'lifetime'` **or a per-PLAN map**
    (`plan-limits.js:29`). §4's mock-interview row is the only thing that needs the map —
    a lifetime taste on free, 3/day on premium — and it could not be expressed any other
    way without a second feature key.
    - `resetPeriodFor(feature, plan)` (`:129`) resolves it; `periodSegment()` (`:143`)
      builds the key window; `featureKvKey()` (`:214`) gained an optional `plan`.
    - **Weeks key on the UTC MONDAY's date, not an ISO week NUMBER** — a week is then one
      unambiguous string that cannot straddle a year boundary.
    - TTLs per window (`:106`): day 26h (unchanged), week 8d, month 32d — each the
      shortest value that still outlives the longest window its segment can cover.
    - **`one`, a singular label** (`:15`). Every §4 taste is a cap of 1, and the wall copy
      is `${limit} free ${label}` — without it, eight of the new walls would have read
      "1 free career simulations".
  - **The §4 table itself** (`plan-limits.js:38-127`): marco-chat 5→**10**/day,
    marco-thread 1→**2**/day, roadmap-generate lifetime→**month**, mock-interview free
    0→**1 lifetime**, plus four new rows — `career-sim` (1/month), `opportunity-search`
    (1/week), `resume-draft` (1/month), `resume-tailor` (1 lifetime).
  - **Two key SHAPES deliberately change, handing existing users a fresh allowance.**
    `roadmapgen:<e>` → `roadmapgen:<e>:<YYYY-MM>`, and mock-interview's free tier starts
    using the undated `mockivday:<e>`. Both are the intended loosening, not the prefix-rename
    mistake the file warns about — and premium's live `mockivday:<e>:<date>` counters are
    untouched, because the two shapes cannot collide.
  - **Server enforcement, endpoint by endpoint:**
    - `weekly-plan.js` — **both** `requirePlan` calls removed (§4 D1, and S7's top-priority
      deferral). `receipts.js` followed it: receipts ship with the plan they belong to.
    - `opportunities.js` — binary `requirePlan` → `resolveEntitlement` + a **server-side
      truncation** (`shapeForPlan`, `:60`): free gets the top 2 plus a `lockedCount`. The
      locked items are **never serialized**, so no devtools work reveals what a CSS blur
      would have hidden. The per-user cache still stores the FULL list and truncation
      happens on the way out, so upgrading reveals the rest **without re-spending a
      grounded search**. The weekly meter is spent past the cache and past the cheap
      `?cached=1` read — re-reading a result you already searched for costs nothing.
    - `mock-interview.js` — the binary `requirePlan` sat ABOVE the counter, so it refused
      the free session before `checkFeatureLimit` could count it. Replaced with
      `resolveEntitlement`; the table now decides.
    - `sim-generate.js` — cap inserted **after** the IP rate wall (a 429 must never cost a
      month) and **after** the existing cache read. That ordering is the whole design: the
      shared `simv2:<slug>` blob is served to everyone including anonymous visitors, so a
      cache hit costs nothing and metering it would wall off the discovery funnel §4
      protects. Only a genuine Gemini burn is metered.
    - `resume-doc.js` (3 sites), `resume-builder.js` gate — `requirePlan` removed. Building,
      editing, the live ATS box and DOCX export are free.
    - `resume-builder.js draftDocMode` — metered `resume-draft`; `resume-tailor.js` POST —
      metered `resume-tailor`, its GET un-gated (reading versions you already made is free).
  - **Refunds on every new meter** (the 4-endpoint refund invariant): sims refund on a
    null generation, a failed validation and the outer catch; opportunities refund on
    `no-results`, `shape-failed` and the catch; the resume draft refunds both its abuse
    unit and its plan unit. In each the abuse wall runs FIRST and, where the plan wall then
    refuses, the abuse unit is handed straight back — nothing was generated.
  - **`no-results` refunds on purpose.** `!briefs.length` means all three `researchWeb`
    calls returned falsy, which in practice is an exhausted grounding budget or three
    timeouts — not "the web has nothing". A search that returned the student nothing must
    not cost them their week.
  - **Client: one shared lock, two shapes.** `FWPlanSurface.lockedTail()` /
    `lockedTailHtml()` (`plan-surface.js:139`) is §5 S8's `fw-locks` pattern — N empty
    placeholder rows behind a blur, a Locked chip, one line of value, one Unlock link,
    `data-fw-gated` so `upgradeSource()` attributes the click. `capCard()` (pre-existing)
    stays the cap-HIT moment. Both inline, never modal (D18). CSS at
    `flightway-2.css:337` — **in flow under the blur, not an absolute scrim**, because an
    overlay needs an opaque page colour and this component ships on light and dark plates.
  - **`FWEnt.resetPeriod(feature, plan)`** now resolves the per-plan map, and
    `FWEnt.featureLabel(feature, count)` returns the singular. `PANEL_METERS` grew from 2
    to 5 (marco-chat, roadmap-generate, career-sim, opportunity-search, resume-draft);
    meter copy is window-aware — "left today" / "left this week" / "left this month".
    The lifetime tastes stay OFF the panel: a 1-of-1 lifetime meter is noise, and those are
    moment-2 surfaces.
  - **`portal-flightplan.js:189`** no longer renders `FWEnt.lock(card, 'weekly-plan')` on a
    402. §4 makes that feature free forever, so a paywall there would now be a *bug* and a
    `paywall_view{weekly-plan}` would be a lie in the funnel. It renders an honest error.
  - **`/config` + pricing matrix.** `publicFeatureLimits()` serves the per-plan map as a map
    (flattening it would promise a free student their lifetime taste "comes back tomorrow")
    and ships `one`. `pricing.html`'s Free column now leads with the Weekly Flight Plan and
    binds **seven** numbers via `data-fw-limit`, up from two; the premium column dropped the
    weekly plan (it is free now) and gained the uncapped rows. `plan:ui-check` asserts every
    one of those spans equals the enforced cap, so pricing cannot drift from the table.
  - **`docs/EVENTS.md`** — `opp_search.cap_state` gained `'capped'` (S1 recorded this state
    as unobservable; the weekly meter makes it real), `paywall_view` documents the new
    locked-preview surface, and the `feature` value list for `paywall_view`/`plan_cap_hit`
    is now written down with `weekly-plan`/`receipts` explicitly **retired**.
- MIGRATIONS: **none.** Every cap is a KV counter; no schema touches this.
- BUSTERS: **`?v=20260724e`** on the 7 changed assets across every referencing page —
  `plan-surface.js` (9 refs), `entitlements.js` (9), `flightway-2.css` (11),
  `portal-flightplan.js` (2), plus `opportunity-finder.js`, `resume-page.js`,
  `interview-mode.js`, `sim-engine.js`. **`e`, not `a`** — 20260724a–d were all used
  earlier today (S1/S4/S6/S7), and the same-day stamp must never be reused. Swept with
  path-qualified matchers so `shared/entitlements.js` never touched
  `_lib/entitlements.js` (the S6 sed trap).
- GATES: baseline at session start **41/41 green in 70.0s**; session end **41/41** (no gate
  added or removed, so no CLAUDE.md/security.html count edit).
  - EXTENDED **`test:entitlements`**: the whole §4 table row by row; the week/month/lifetime
    key shapes including a **Sunday** (the hard case — it belongs to the Monday six days
    back); the per-plan window resolving to two non-colliding keys; the monthly allowance
    **reopening next month** (the assertion the whole re-tier exists for) and the lifetime
    taste **never** reopening, not even a year later; the weekly refund; per-window TTLs;
    and that a cap of 1 states the singular.
  - EXTENDED **`test:endpoints`** with a §4 section that **executes** the handlers: free is
    never 402'd off weekly-plan / receipts / mock-interview / opportunities; `shapeForPlan`
    truncates to 2 + `lockedCount` and the locked titles are **absent from the serialized
    payload**; a cached sim is served and spends nothing; a spent month refuses 429 +
    `upgrade`; a dead upstream refunds the month.
  - EXTENDED **`test:admin`** — it keeps its OWN copy of the free-tier caps (the "honest
    free account" walkthrough and the expired-comp degradation), so the §4 numbers had to
    move there too. That duplication is deliberate rather than a smell: it proves an
    admin-granted comp lapses back to exactly the caps the table enforces, which is a
    different claim from `test:entitlements`'.
  - EXTENDED **`plan:ui-check`**: the panel's window-aware copy, the five meters, the new
    locked-tail contract (empty placeholders, one CTA, attributable), and resume.html +
    simulation.html added to the "every page with a cap loads plan-surface.js" list.
  - `verify:meta`, `contrast:check`, `test:vectors`, `test:events`, `test:opportunities`,
    `interview:check`, `resume:ui-check`, `resume:tailor-check`, `test:weekly` all green.
- FREE-ACCOUNT WALKTHROUGH (§5 S8's "Done" criterion — executed against the real module,
  not asserted from the plan). One free student, every row spent to exhaustion:

  | Row | Cap | Window | Wall copy | Upgrade CTA |
  |---|---|---|---|---|
  | Marco chat | 10 | a day | "You've used your 10 free Marco messages — Flight Plan lifts the cap." | yes |
  | Marco topic cards | 2 | a day | same shape — but **suppressed**: `chat.js:361` discards the message and just omits the card | n/a (silent) |
  | Roadmap generate | 1 | a month | "…your 1 free AI roadmap generation…" | yes |
  | Career sim (cache MISS only) | 1 | a month | "…your 1 free career simulation…" | yes |
  | Opportunity search | 1 | a week | "…your 1 free opportunity search…" | yes |
  | AI whole-resume draft | 1 | a month | "…your 1 free AI resume draft…" | yes |
  | AI resume tailor | 1 | ever | "…your 1 free resume tailoring…" | yes |
  | Mock interview | 1 | ever | "…your 1 free mock interview…" | yes |

  Unmetered on free and verified as such: weekly plan, receipts, resume build/edit/export,
  the ATS box, Evidence Locker, deep dives, quiz, compare. After upgrading, every row above
  is unlimited except mock-interview's pre-existing 3/day.
- DEFERRED (nothing silently dropped):
  - **§4 rows whose feature does not exist yet — no table entry added.** Deadline Radar's
    "1 grounded refresh/week" (S9), Network mapper drafts 2/month (S17), Live-posting
    scorecard taste (S16), Month in Review (S11), Interview Season Mode locked-visible
    (S18). §5 S8's build list names some of them, but a cap in `FEATURE_LIMITS` with no
    enforcement point would be **served on `/config` and rendered in pricing copy as a
    promise the server does not keep** — and §3's rule that a newly-metered surface ships
    its locked state in the same session cannot be met for a surface that has no UI. Each
    lands with its own session.
  - **§4's "1 ATS check/month" is not implemented as written** — see DRIFT. The AI
    whole-resume draft carries the resume meter instead, on Jacob's explicit call.
  - **`derive-career.js:79`, `stretch-fits.js:114` and `chat.js:516,658` stay binary
    `requirePlan('premium')`.** All four are Gemini generation surfaces (AI-derived
    fragment careers, grounded stretch-fit suggestions, and Marco's inline roadmap
    plan-editing) that §4's table **does not name**. Leaving them is the status quo, not a
    decision — flagged here because if Jacob wants them tiered rather than walled, that is
    a §4 amendment, not a bug fix.
  - **S7's "the doors row has no per-tier locked states" is CLOSED as a no-op, deliberately.**
    Under §4 **no door on flightplan.html is locked for a free account**: Resume Builder is
    free, Opportunities is a preview, Mock Interview has a taste, Evidence Locker is free,
    Applications is S12's "Coming soon". That is the re-tier working — the front door is
    open. A per-door allowance meter was considered and rejected: the four upgrade moments
    (D18/WS-G G2) are a closed inventory, and a nav surface that counts down at you is
    exactly the nagging D18 forbids.
  - **`remainingForUser` now does up to 8 parallel KV reads per `/auth/me`** for a free
    account (4 before). They are parallel and premium short-circuits to zero reads
    (every limit is `null`), so this was accepted rather than trimmed — but it is the
    hot path, and it is the thing to look at first if `/auth/me` latency regresses.
- DRIFT (repo vs plan; repo wins):
  - **§4's "1 ATS check/month" describes a feature that does not exist server-side.**
    Plan §2 recorded the resume builder/tailor/ATS as `requirePlan('premium')` binary; the
    builder and tailor are, but the ATS check is `FWResumeRender.atsCheck()` — a
    deterministic **client-side** function with no endpoint, no AI cost, recomputed on
    every keystroke behind a 400ms debounce (`resume-page.js:328`). Metering it would have
    meant inventing an endpoint whose only job is to count a local computation, and
    breaking the live preview. **Asked Jacob rather than guessing** (it changes what the
    free tier is): the meter moved to `mode='draft-doc'`, the whole-resume AI draft —
    "free build/edit" stays literally true (manual editing AND AI bullet help are free)
    and the wall sits on the single most expensive call on the page. The ATS box is free
    and unmetered.
  - **Plan §2's "career sims and deep dives fully ungated (IP rate-limit only)" is stale.**
    `sim-generate.js:326` already required a signed-in session on a cache miss ("Gemini
    burn requires a signed-in session"); anonymous visitors only ever get cached sims.
    So §4's sim cap needed **no** funnel change and no anonymous-access decision — it is
    one `checkFeatureLimit` on a path that was already authenticated.
  - **§4 lists `Deadline Radar | n/a | View + alerts free…`** — `_lib/deadlines.js` is
    read-only over the Opportunity Finder's KV cache and nothing schedules or notifies, so
    there is nothing to meter until S9 builds it.
  - **The plan says "`plan_cap_hit` events fire on every wall (they already exist — extend
    the `feature` values)".** The values are not enumerated anywhere in code — the event
    just carries whatever slug the caller passes. Rather than add a runtime allowlist for
    a prop that `scrubProps` already bounds, the list is now written down in EVENTS.md
    with the two retired values called out, so a future session can see when a surface is
    naming a wall the server does not enforce.
- JACOB ACTIONS RAISED:
  1. **No env var, no migration, no Stripe object.** S8 adds none of the three.
  2. **These caps go LIVE the moment this deploys, because `paywallEnabled` is already
     `true` on both projects** (S7 checked it; the "ships dark" comment in
     `entitlements.js:3` is stale as a description of the running environment). On the
     prototype that is fine — it is us. **The thing to know before the final V2 merge:**
     for existing free accounts on flightway.ai this is a net loosening on six rows and a
     tightening on exactly one — **career sims go from unlimited to 1/month.** That is
     §4/D25 as approved; flagged so it is a decision you remember making, not a surprise
     in a support email.
  3. **The pricing page now makes seven specific promises to free users** (weekly plan
     free forever, 10 Marco/day, 1 roadmap+monthly rebuild, free resume builder + 1 AI
     draft/month, 1 sim/month, 1 search/week, 1 mock interview + 1 tailor). Every number
     is bound to the enforced table and gate-checked, so they cannot drift — but the
     *sentences* around them are a marketing commitment worth reading once.
  4. Not promoted to production — Phase 2, soaking on Jacob_Work per D26. Pushed to
     Jacob_Work only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `pricing.html` (Phase 0 meta + matrix), `docs/EVENTS.md` (S1/S4/S6/S7-hot),
  `functions/weekly-plan.js` (S7-hot), `functions/config.js` behaviour via
  `publicFeatureLimits()`, `assets/css/flightway-2.css` (S7-hot),
  `assets/js/app/portal-flightplan.js` (S7-hot), `assets/js/coach/interview-mode.js`
  (S7-hot), `assets/js/sim/sim-engine.js` (S3-hot), and every root `.html` carrying the
  restamped busters. Also touched (not Phase-0): `functions/_lib/plan-limits.js`,
  `functions/opportunities.js`, `functions/mock-interview.js`, `functions/receipts.js`,
  `functions/resume-doc.js`, `functions/resume-builder.js`, `functions/resume-tailor.js`,
  `functions/sim-generate.js`, `assets/js/shared/plan-surface.js`,
  `assets/js/shared/entitlements.js`, `assets/js/app/opportunity-finder.js`,
  `assets/js/app/resume-page.js`, and the gate scripts (`test-entitlements.mjs`,
  `test-request-paths.mjs`, `smoke-plan-ui.mjs`).
- CLIENT LOCKED-STATE SWEEP (delegated to one Sonnet agent — an individual agent, NOT a
  workflow, per this session's constraint — with the server contracts and the two shared
  primitives specified up front; diff reviewed line by line here). It found **two real
  defects my brief did not anticipate**, both of which would have shipped the re-tier
  broken:
  1. **`opportunity-finder.js mount()` short-circuited every free user client-side**
     (`if (!FWEnt.has('premium')) { state.status = 'gated'; return null; }`) **before ever
     calling the server.** With `paywallEnabled` true on both projects, that one line would
     have sent every free student to the old binary gate screen and made the entire top-2
     preview, the locked tail and the weekly meter **unreachable in production** — the
     server work would have been invisible. Removed; `mount()` now always fetches and the
     server decides. This is the single most important line in the client diff.
  2. **`sim-engine.js fwApi()` discarded the parsed error body** — only `.message` and
     `.status` survived onto the thrown `Error`, so `upgrade`/`feature` could never be read
     by any caller. A 429 cap would have rendered the generic "that one isn't ready yet"
     failure instead of a cap card. Fixed additively (`data: data` on the throw).
  Also removed by the sweep: the boot-time `FWEnt.gate()` pre-locks on the mock-interview
  overlay and the whole resume page (both wrong now — those features are metered, not
  locked), and the `notePaywallView` call that only ever fired *because* of the
  mock-interview pre-lock.
  Reviewed and corrected after the handoff: a **hand-written cap in fallback copy**
  (`interview-mode.js:277` said "your 3 mock interviews for today" — wrong for a free
  account, whose cap is 1 ever) and a now-dead `FWEnt.gate(gateHost, 'resume-builder')`
  in `runSuggest()` that would have walled the entire builder over a free feature.
- KNOWN BEHAVIOUR, recorded not fixed: **the free weekly opportunity search is spent by
  OPENING the panel, not by pressing a Search button.** The finder mounts inside the
  roadmap focus drawer, so opening it is a deliberate act ("show me opportunities") and
  `loggedSearchCareer` + the server's 1-day per-user cache stop a re-open from spending
  again — but there is no explicit "use my search" affordance. If free users report
  surprise, the fix is a `?cached=1` mount plus a button, which is a UI addition rather
  than a metering change.
- LIVE-VERIFIED on the prototype after the push (@c3863f8):
  - `/config` serves **all 8 rows** with the right windows, and — the assertion that
    mattered — **the per-plan map survives the trip intact**
    (`mock-interview.resetPeriod = {free:'lifetime', premium:'day', lifetime:'day'}`).
    A flattened value there would have promised a free student their lifetime taste
    "comes back tomorrow".
  - The S1 deploy trap repeated exactly as documented: `npm run env:status` reported
    "serving the branch tip" while `/config` was still answering with the OLD 4-row table.
    The functions bundle landed ~30s later. **Curl a FUNCTION, not an asset.**
  - `/pricing` serves all 7 free-column caps + the premium one from the enforced table
    (10 / 1 / 1 / 1 / 1 / 1 / 1, premium mock 3).
  - `/weekly-plan` and `/opportunities` both answer **401** signed-out (not 402) — the
    plan wall is gone from the request path; only the session check remains.
  - **A verification trap worth carrying forward:** `curl … | grep -c renderCapped`
    returned **0** for a file that demonstrably contains it twice, while the same pipe
    matched a different string in the same file. `grep` on stdin gave a false negative
    here. The trustworthy check was hashing: the served bytes are `shasum` and
    byte-for-byte identical to the local file. **Compare bytes, not greps, when deciding
    whether a deploy landed** — a false negative sends you chasing a phantom regression,
    which is worse than no check at all.

## S9 — Phase 3: Deadline Radar (2026-07-24, Jacob_Work@dc2b9ca..e48055c)

D12, and the highest-value build in the brainstorm: externally-imposed urgency, persisted
and chasing. Before this session the only "deadline" in the product was whatever the
Opportunity Finder happened to have left in a KV cache — read-only, per-career, evicted
after a day, invisible to the cron, and impossible for a student to add to. It is now a
durable per-user table that survives a cache eviction, a career change and a roadmap
rebuild, that the student can write to, and that a scheduled Worker can email about.

- DONE:
  - **Migration `0020_deadlines.sql`** — `deadlines` (15 cols + 4 indexes). `user_id` is the
    normalized email, consistent with `events` and `email_log`. Dates are bare `YYYY-MM-DD`
    and every comparison is UTC-anchored: a deadline is a **calendar day**, and storing a
    timestamp would make "closes in 3 days" flip depending on where the reader sits.
    Two dedupe guards, because a weekly refresh re-asks the web the same question forever:
    `title_key` (normalized title) for the **±31-day near-window merge** that actually
    prevents duplicates, and `dedupe_key = title_key|YYYY-MM` under a UNIQUE index as the
    concurrency backstop. `alerted_t14`/`alerted_t3` are per-row exactly-once markers.
  - **`functions/_lib/deadline-core.js`** (NEW, pure) — the whole validation surface, so the
    gate executes it directly: `sanitizeDeadlines` (a grounded item ships ONLY with the exact
    https URL of one of the research sources, a parseable future date inside an 18-month
    horizon, and a kind from a closed set of five — anything else is **dropped, never coerced
    to a catch-all**), `sanitizeManualDeadline` (the one path where an empty URL is allowed —
    the student *is* the source), `normalizeTitleKey` (deliberately conservative: over-merging
    two real programs hides one of them entirely, which is worse than a duplicate),
    `buildDeadlineQueries`/`buildDeadlinePrompt`, `daysUntil`, `ALERT_TIERS`.
  - **`functions/_lib/deadline-store.js`** (NEW) — every D1 read and write, so the dedupe rule
    has exactly one implementation. **An upsert never changes `status`**: a row the student
    dismissed stays dismissed no matter how many times the web hands it back. Without that,
    "dismiss" would mean "hide until Tuesday" and the radar would nag until they abandoned it.
  - **`functions/_lib/deadline-refresh.js`** (NEW) — one grounded pipeline, two callers (the
    student's Refresh button and the nightly cron), so the prompt cannot drift between them.
    Meter-free by design: the caller owns spend/refund. Degrades to a `reason` string —
    `grounding-off` / `no-career` / `no-results` / `shape-failed` — never an exception.
  - **`GET|POST /deadlines`** (`functions/deadlines.js`) — session-gated, IP rate-limited,
    four actions (`refresh` metered, `add` / `status` free). GET ships the cap object with the
    list so the client never hand-writes a limit, and ships `grounded` separately from
    `canRefresh` because "there is nothing to refresh from" and "you have used your one this
    week" are different sentences and a silent dead button is worse than either.
  - **`_lib/deadlines.js` reads D1 FIRST**, KV cache as the transition fallback (§5 S9). One
    read path means Marco's rail, his chat context, the weekly plan and the This Week chip can
    never quote different dates at the same student. Tracked rows only — a deadline marked
    done or dismissed must not come back out of Marco's mouth.
  - **`/weekly-plan` GET now sources the hero chip from D1** (`nextTracked`, one indexed
    `LIMIT 1` on a page that already loads the roadmap blob), falling back to the week doc's
    snapshot. S7 deliberately avoided a per-GET lookup; that reasoning was about a D1 blob read
    plus a KV get, and this is neither. It is what stops the chip and the radar list directly
    beneath it from disagreeing. The **portal mirror needed no change** — it renders the same
    `nextDeadline` from the same payload.
  - **§4's Deadline Radar row, now that the feature exists** — `deadline-refresh`, 1/week free,
    unlimited paid, in `plan-limits.js` with its refund wired on both no-fault failures. S8
    deliberately left this row out because a cap with no enforcement point is a promise the
    server does not keep. Added to `PANEL_METERS` (appended last, so `plan:ui-check`'s
    index-based assertions keep pointing at the same features) + `CAP_COPY`.
  - **Cron: two new steps** (`workers/cron/index.js`). `runDeadlineAlerts` sends ONE email per
    user per tier per night listing all of their deadlines in that window — three separate
    "a deadline is coming" mails in one evening is how a useful warning becomes something
    people filter. The verified + `notify_deadlines` gate is **in the SQL**, so an unsubscribed
    account is never even loaded. `runRadarRefresh` scans recently-active accounts (21 days,
    from `events`) behind **three independent brakes**: the flag, the shared daily grounding
    budget (re-checked so the loop stops rather than grinding through users who will all get
    null), and `DEADLINE_REFRESH_DAILY_CAP` (default 50). Runs LAST in the dispatcher — it is
    the only step that spends money and the only one that is fine to lose.
  - **`deadlineAlertEmail`** (`_lib/emails.js`) on the shared shell, category `deadlines` (the
    column already existed from 0019), CTA carrying UTM and deep-linking `#deadlines`.
  - **Radar UI** (`assets/js/app/deadline-radar.js`, NEW + a page-local `<style>` block on
    flightplan.html) — urgency-tiered list, done/dismiss/undo, a metered Refresh, and an inline
    manual-add form whose `<select>` is built from the server's own `kinds` array.
    **Every row is createElement + textContent**: deadline titles, orgs and URLs are extracted
    from arbitrary web pages, so they are exactly as untrusted as the analytics rows
    `admin-console.js` treats the same way.
- **A BUG THIS SESSION FOUND AND FIXED, not introduced.** The old local
  `daysUntil(iso, now)` measured from the caller's exact INSTANT to the target's UTC midnight
  and rounded. Both callers filter on `daysOut >= 0`, so **after ~12:00 UTC a deadline closing
  TODAY computed to -1 and vanished** from Marco's rail and the This Week chip — on the one day
  it mattered most — while one closing tomorrow read "closes today". The replacement anchors
  both sides to UTC midnight. `test:deadlines` opens with that case at 23:59 UTC.
- MIGRATIONS: **0020** (`migrations/0020_deadlines.sql`). **NOT applied to remote D1** — Jacob's,
  see below. Additive (`CREATE TABLE IF NOT EXISTS` + 4 indexes), nothing dropped. Until it is
  applied the whole subsystem degrades: `listUpcoming` catches and returns `[]`, so
  `_lib/deadlines.js` falls through to the KV path exactly as before, `GET /deadlines` renders
  an empty radar, and `selectAlertBatch` skips the tier rather than emailing anyone.
- BUSTERS: **`?v=20260724f`** — `plan-surface.js` (the one changed asset, 9 referencing pages,
  swept path-qualified so `shared/plan-surface.js` never touched anything else) and the NEW
  `assets/js/app/deadline-radar.js` on flightplan.html. `f`, not `a`: 20260724a–e were all
  used earlier today (S1/S4/S6/S7/S8) and a same-day stamp must never be reused.
- GATES: baseline at session start **41/41 green in 69.1s**; session end **42/42**.
  - NEW **`test:deadlines`** (pure lane) — three layers, because three classes of bug can ship
    here and only one is visible in a code review. (1) PURE: extraction against a hostile model
    answer (a URL nobody fetched, last year's date, a wrong-decade date, an unknown kind, http,
    an in-batch duplicate — 2 of 10 survive), plus the UTC date arithmetic. (2) REAL SQLITE
    loaded from migration 0020: the near-window merge across a month boundary, the same program
    a season later correctly being a SECOND deadline, **a dismissed row surviving a refresh**,
    the alert selection with its verified/opted-in SQL gate, marking, and the account ceiling.
    (3) THE REAL HANDLERS: 401, cross-user authz (B gets **404**, not 403, on A's row),
    validation copy, the weekly meter + refund, and a **full grounded refresh end to end against
    a stubbed Gemini** — research → shape → sanitize → upsert, then a second run that updates
    rather than duplicates and spends no new research.
  - EXTENDED **`contrast:check`** two ways, both prompted by a real defect this session shipped
    (see the review note below). It now (a) scans **page-local `<style>` blocks in every root
    `.html`**, not just `assets/css/*.css` — S5's OAuth button, S6's quiz reveal and S9's radar
    all ship CSS inline on purpose, so "the CSS the gate can see" and "the CSS the product
    ships" had quietly stopped being the same set; and (b) fails any **status token
    (`--ok`/`--warn`/`--err`) used as a `color:`**. That is a zero-instance invariant — every
    existing use in the repo is a border or a tint with the text left on `--text` — and the
    three tokens measure 1.75 / 2.09 / 3.99 :1 on the light theme's own surface. 3509 rules
    scanned, up from CSS-only. **Proven to bite**: reintroducing the defect names the file and
    line inside the HTML.
  - EXTENDED **`pages:smoke`** (`GET /deadlines` → **401** is the PASS: it proves the Function
    is routed without writing anything), **`plan:ui-check`** (6 meters, the 6th weekly),
    **`verify:env`** (a cron `GROUNDING_ENABLED`-without-`GEMINI_API_KEY` half-pair warns —
    that combination marks every user refreshed for a week and returns nothing).
  - CLAUDE.md gate counts updated **39 offline / 42 total**.
- VERIFIED (headless probe, in the session scratchpad, not committed — no gate renders the radar
  signed-in with rows): 3 rows render in light and dark, urgency chips tier correctly, a `done`
  row offers only Undo, an `https` url becomes a link and a `javascript:` url does **not**,
  a title containing `<img src=x onerror=...>` renders as TEXT with **zero** injected nodes in
  the DOM, the cap note reads "1 refresh left this week" straight off the server object, a spent
  allowance disables the button and says "No refreshes left this week — resets Monday", the kind
  `<select>` is built from the server list, and no horizontal overflow at 1280 or 375.
  (Trap re-confirmed: `data-fw-intro` mounts a modal that intercepts every click — the WS-F
  note — so the probe removes `.fw-intro-root` before interacting.)
- DEFERRED (nothing silently dropped):
  - **The nightly cron refresh is inert until Jacob sets `GROUNDING_ENABLED` + `GEMINI_API_KEY`
    on the `flightway-cron` Worker.** That is the intended default, documented in
    `workers/cron/wrangler.toml` and warned about by `verify:env`. The **alert emails need
    neither** — they read rows that already exist, so they work as soon as 0020 is applied.
  - **Alerts and the radar are both empty until 0020 is applied**, and the grounded refresh is
    additionally dark until `GROUNDING_ENABLED` flips on Pages (the same state the Opportunity
    Finder has been in since S-Pillar-W). Correct, not a bug — the manual-add path works today.
  - **Past deadlines drop out of the radar** rather than showing "you missed it". The rows stay
    in D1 (they are the dedupe memory, and S11's Month in Review will want them); the list
    answers "what is coming at me". A missed-deadline view is a product decision, not a gap.
  - **No `deadline_alert_click` event.** The CTA carries UTM, so a click already arrives as an
    attributed `page_view`; recording it inside the mail client needs a tracking pixel, an
    explicit §9 non-goal. Written down in EVENTS.md under its own heading so a later session
    does not "fix" it back.
  - **`remainingForUser` now does up to 9 parallel KV reads per `/auth/me`** for a free account
    (8 after S8). Same accepted tradeoff, one row larger; still the first thing to look at if
    `/auth/me` latency regresses.
  - **`contrast:check` still skips at-rule-wrapped bodies** (`@media`, `@supports`) — a
    pre-existing scope note in the file, unchanged here.
  - The digest/Month-in-Review consumption of deadlines is **S11's**, per the plan.
- DRIFT (plan vs repo; repo wins):
  - **`GROUNDING_DAILY_CAP` does not exist.** §5 S9 names it as the budget guard env. The real
    mechanism is `GROUNDING_GLOBAL_DAILY` (300) + `GROUNDING_USER_DAILY` (25) inside
    `gemini-grounded.js`, already enforced on **every** `researchWeb` call including this one.
    Inventing a second env name would have created a budget that agrees with the real one only
    by luck. The cron re-checks the existing global counter to break its loop early, and adds
    `DEADLINE_REFRESH_DAILY_CAP` for the per-night USER cap the plan also asks for.
  - **T-14/T-3 are day RANGES (8–14 and 1–7), not exact days.** An exact-day trigger is wrong
    for a radar that refreshes weekly: most deadlines are DISCOVERED in the middle of their
    window and would sail past the one day the query looked at without ever generating an alert.
    Ranges also make a failed send retryable, since the marker is written only on success. The
    two are disjoint and together cover 1..14 days, so nothing inside a fortnight is skipped —
    `test:deadlines` asserts exactly that, day by day.
  - **"On-visit refresh at most weekly per user" is an explicit Refresh BUTTON**, metered 1/week,
    not a silent auto-refresh on page load. S8 recorded the opposite shape as a known surprise
    risk (the free weekly opportunity search is spent by OPENING a panel); repeating it on a page
    that is now a primary nav tab would have spent a student's week on a page view.
  - **A `capped` refresh answers 200 with `reason:'capped'` + the cap object**, not 402/429 —
    mirroring `opportunities.js`, because the radar must still render the list it already has.
  - **Five kinds, exactly as §5 S9 lists them.** `scholarship` and `grant` map onto `fellowship`
    as aliases rather than becoming a sixth chip.
- ADVERSARIAL REVIEW of the delegated client build (one Sonnet agent — an individual agent, NOT
  a workflow, per this session's constraint; the server contract was fixed before it started and
  its diff was read line by line here). The XSS discipline held under a hostile-payload probe.
  **One real defect, invisible to every gate that existed:** the agent painted the urgency chips,
  the "Done" button and the form error with `color: rgb(var(--ok|warn|err))`. Those tokens are
  tuned as accents on a surface, not as type — `--ok` is `74 222 128`, which on the light theme's
  own `--surface` measures **1.74:1**: a button label nobody can read. **Nowhere else in the repo
  is a status token used as a text colour** (both existing uses are `border-left-color`), so this
  was a house-pattern break with a real consequence. Fixed to hue-on-border/tint with the text on
  `rgb(var(--text))`, and — because `contrast:check` scanned only `assets/css/*.css` and this CSS
  is page-local by design — the gate was extended in both directions so the same defect cannot
  ship again from any page-local block.
- JACOB ACTIONS RAISED:
  1. **Apply migration 0020 to the shared remote D1.** Until you do, the radar is empty, alerts
     send nothing, and `_lib/deadlines.js` silently falls back to the old KV path — all by
     design, none of it an error. Additive; nothing dropped. Check first, because `apply` runs
     everything pending: `npx wrangler d1 migrations list flightway-db --remote --env production`,
     then `npx wrangler d1 migrations apply flightway-db --remote --env production`.
     Expect **0020 only** to be pending (0019 was applied at the S4/S5 checklist step).
  2. **`npm run deploy:cron`** — no git push deploys the standalone Worker, so the alert step and
     the nightly refresh do not exist on it until you run this. The 14:00 trigger is unchanged.
  3. **(optional) Turn the nightly radar refresh on.** It needs BOTH on `flightway-cron`:
     uncomment `GROUNDING_ENABLED = "true"` in `workers/cron/wrangler.toml` **and**
     `npx wrangler secret put GEMINI_API_KEY -c workers/cron/wrangler.toml` (same key as Pages),
     then redeploy. Optional third: `DEADLINE_REFRESH_DAILY_CAP` (default 50 users/night). With
     the flag on and no key the loop marks every user refreshed for a week and returns nothing —
     `npm run verify:env` now warns about exactly that pair.
  4. **The student-facing grounded Refresh button is dark on both Pages projects** until
     `GROUNDING_ENABLED` is set there too (unchanged, pre-existing). Manual add works regardless.
  5. Not promoted to production — Phase 3, soaking on Jacob_Work per D26. Pushed to Jacob_Work only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6-hot), `functions/account.js` (S2/S4-hot), `docs/EVENTS.md`
  (S1/S4/S6/S7/S8-hot), `CLAUDE.md`, and the buster-restamped root `.html` (flightplan, portal,
  roadmap, coach, quiz, resume, career, dashboard, simulation). Also touched (not Phase-0):
  `functions/weekly-plan.js` (S7/S8-hot), `functions/_lib/deadlines.js`,
  `functions/_lib/emails.js` (S4-hot), `functions/_lib/email-template.js` (S4/S7-hot),
  `functions/_lib/plan-limits.js` (S8-hot), `assets/js/shared/plan-surface.js` (S8-hot),
  `workers/cron/index.js` (S1/S4-hot), `workers/cron/wrangler.toml`, and the gate scripts
  (`run-gates.mjs`, `smoke-pages.mjs`, `smoke-plan-ui.mjs`, `verify-env.mjs`,
  `verify-dark-plate-contrast.mjs`), `package.json`. NEW (no merge-conflict surface):
  `migrations/0020_deadlines.sql`, `functions/deadlines.js`, `functions/_lib/deadline-core.js`,
  `functions/_lib/deadline-store.js`, `functions/_lib/deadline-refresh.js`,
  `assets/js/app/deadline-radar.js`, `scripts/test-deadlines.mjs`.

## S10 — Phase 3: Commitments + micro-steps + Marco follow-through memory (2026-07-24, Jacob_Work@9e4583c..HEAD)

S9 gave the product externally-imposed urgency. S10 gives it the internal kind: a checkbox
becomes an obligation the moment a date goes on it, and Marco becomes someone who remembers
the date. Before this session nothing in FlightWay could answer "what did you say you would
do, and did it happen?" — steps had a `done` boolean and nothing else, and every AI surface
met the student as a set of capabilities rather than as someone mid-promise.

- DONE:
  - **Schema-in-doc, no migration** (§5 S10). A roadmap step gains four optional fields:
    `dueAt` (bare `YYYY-MM-DD`), `effort` (`S|M|L`), `committedAt` (ISO), `dueMoves` (int).
    A commitment is a **calendar day**, not an instant — the same call S9 made for deadlines,
    for the same reason: "due in 2 days" must not flip with the reader's timezone or the hour
    of the afternoon. `isIsoDate` is **imported from `deadline-core.js`, not re-written**
    (`roadmap-tree.js:9`) — a commitment date and a deadline date are the same kind of thing,
    and two copies of that predicate is exactly how they drift apart.
  - **The fragile path, which is the whole session** (§3.8 in full force).
    `saveRoadmap` AND `loadRoadmap` both run `normalizeRoadmap(x, x)`
    (`functions/_lib/auth.js:416,450`), and `normalizeSteps` rebuilt every step as
    `{id,text,done,kind}`. A field it does not know about is not ignored — it is **deleted on
    the very next save**. So:
    - **`collectStepMetaMap`** (`roadmap-tree.js:175`), keyed `<nodeId>:<stepId>` exactly like
      `collectStepDoneMap` so the two travel together.
    - **`resolveStepMeta`** (`roadmap-tree.js:231`) — the rule, and the reason it is a
      function: **an own property on the raw step always wins, including an explicit `null`.**
      `dueAt: null` is a tombstone meaning "the user cleared this" and it must beat the
      preserved value.
    - **The meta map is built from `preserveFrom` ONLY** (`roadmap-tree.js:1345`) — NOT
      `{...preserveFrom, ...raw}` the way `stepDoneMap` is. That spread is the documented
      `preserveFrom` resurrection trap: a cleared step emits no entry, so the preserved value
      would win and "remove date" would silently mean "hide it until Tuesday". Reading raw
      directly makes "cleared" and "never had one" the same correct answer.
    - Threaded through **every** call site: `normalizeNode` (`:686`), `normalizeRoadmapTree`
      (`:1357`), `sanitizeTreePatch` (`:1709` — Marco's inline waypoint edits replace a node's
      whole `steps` array), and the branch-build content rewrite (`:2175`). `mergeTreeSplit`
      and `mergeTreeExtend` were left alone on purpose: both only normalize genuinely NEW
      nodes, filtered against existing ids, so there is no prior meta to preserve.
    - **A defect caught by the fixtures, not by review:** `isIsoDate` slices to 10 chars
      *before* validating, so a full ISO instant passes it — and the first cut stored the
      instant. A timestamp sitting in a field that every downstream comparison treats as a
      bare day with `<` sorts wrong and renders raw to the student. Now truncated at the
      normalize boundary (`roadmap-tree.js:238`) and in both `collectCommitments` copies.
  - **`functions/_lib/commitments.js`** (NEW, pure — no D1, no KV, no fetch, so the gate drives
    it directly): `collectCommitments` (`:62`, one sort order used by every surface — overdue
    first, then soonest, then a stable id tiebreak so two things due the same day never swap
    between renders), `commitmentBuckets`, `recentCompletion` (`:122` — derived from the steps
    themselves, so there is no second record to fall out of sync and a date moved forward
    correctly stops counting against them), `commitmentsPromptBlock` (`:152`),
    `applyCommitment` (`:193` — the one mutation, returning the same reference on a no-op so
    callers can skip the save and the vector re-sync).
  - **`assets/js/shared/commitments.js`** (NEW) — the client mirror, because two surfaces need
    the rule with no round trip (the roadmap drawer mutates locally and lets `FWRoadmapSync`
    save; the Flight Plan module renders what the server sent). It is a MIRROR, not a variant:
    `test:vectors` now runs **both copies over the same fixtures** and fails on any
    disagreement, the same discipline as the client/server KEY_MAP pair. Dates are parsed by
    regex, never `new Date(iso)` — constructing a Date from a date-only string and reading it
    back in local time is how a Friday deadline renders as Thursday west of UTC (S9's idiom).
  - **Drawer UI** (`assets/js/app/roadmap-tree.js:1167,1296` + handlers at
    `assets/js/app/roadmap.js:954,991,1021`): per-step due chip with urgency tier, effort
    label, `moved Nx`, Change/Clear, and an inline picker (This week / Next week / a native
    date input + S·M·L chips). Every control respects the same `canEditWaypoint` guard the
    step checkbox does, and a blocked action logs nothing. Both surfaces split the events the
    same way — pushing a date LATER is `commitment_rescheduled`, everything else is
    `commitment_set` — so a reschedule rate is one query rather than a join.
  - **Flight Plan Commitments module** (`assets/js/app/commitments-panel.js`, mounted at
    `flightplan.html`): the S7 placeholder is now live — Overdue / This week / Later groups,
    Done and Reschedule (+1 week from the row's OWN due date, not from today: they are
    rescheduling a specific promise), inline per-row errors, and **every row built with
    `createElement` + `textContent`** because commitment text comes out of AI-generated
    roadmap content and is exactly as untrusted as S9's deadline titles.
  - **`POST /weekly-plan { commitment: {...} }`** (`functions/weekly-plan.js:241`) — the write
    path, on the endpoint that already holds the loaded tree, the save and the vector re-sync
    rather than a new one. **Authorization is structural, not a check**: the tree is loaded BY
    EMAIL from the session, so another user's step id simply is not in it. The vector re-sync
    runs **only when the done state actually moved** — `syncGapProgressToQuiz` is the single
    writer for the objective vector, and calling it on a date-picker click would churn vector
    timestamps for a change that moved no progress.
  - **`GET /weekly-plan` ships `commitments`** (`:203`) off the tree it already loaded — zero
    extra reads, recomputed per GET so `daysOut`/`overdue` are never a stale snapshot.
  - **"Break this down" → micro-steps** (`functions/career-roadmap.js:890`). 2–4 sub-steps from
    one JSON Gemini call, inserted immediately after their parent and marked `aiBuilt`. Free
    and bounded by an hourly rate limit rather than a `FEATURE_LIMITS` row — a plan-limits
    entry would add a **tenth** parallel KV read to every `/auth/me` for a free account (S8 and
    S9 both flagged `remainingForUser` growing) to police a call far cheaper than a roadmap
    generation. **The 8-step ceiling is refused BEFORE Gemini is called**: `normalizeSteps`
    silently slices past `MAX_STEPS_PER_NODE`, so without that check the generated sub-steps
    would be paid for and then vanish on save.
  - **Marco memory, three parts:**
    1. **Dossier digest** (`functions/_lib/dossier-coordinates.js:67`) — open commitments with
       how late/soon each is, plus the last-7-days completion ratio, composed into the fenced
       `[[coordinates]]` block. One composition point, regenerated per request, impossible to
       go stale — and it reaches **every** AI surface that reads the dossier, not just chat.
    2. **Last-conversation marker** (`functions/_lib.js:170`, consumed at `chat.js:272`) —
       the FIRST user message of the previous conversation, captured verbatim at the moment
       the transcript is discarded. Whitelisted through `saveChat` AND `persistChatState`
       (which decides the whole persisted shape, so a field it does not name is dropped on
       every turn, not just at reset).
    3. **The follow-through preamble** (`marco-persona.js:160`) — open with ONE named
       callback, one per conversation, **never scold and never moralise**, answer a slipped
       date with the smallest version they could finish this week and an offer to move it,
       and never invent a commitment or a past conversation.
  - **Digest hook, wired rather than deferred** (`workers/cron/index.js:276`,
    `functions/_lib/emails.js:91,131`): the Monday digest gains a "You said you would" block,
    read off the **same parsed tree** the tasks come from — no extra query, and it cannot
    disagree with what the Flight Plan page shows the same student the same morning. Overdue
    and due-this-week only. Copy is deliberately neutral (`3 days late`, not `you're 3 days
    late`): an email is the one place nobody can reply to explain.
  - **Six events registered + documented** — `commitment_set`, `commitment_cleared`,
    `commitment_done`, `commitment_rescheduled`, `step_breakdown` (client) and
    `marco_callback_shown` (server, `chat.js:699`).
- MIGRATIONS: **none, by design.** §5 S10 specifies the commitment fields live inside the
  roadmap JSON doc. Highest migration is still **0020**.
- BUSTERS: **`?v=20260724g`** — `assets/css/flightway-pages.css` (11 referencing pages),
  `assets/js/app/roadmap-tree.js` + `assets/js/app/roadmap.js` (roadmap.html; roadmap-tree
  also on portal.html), and the two NEW assets `assets/js/shared/commitments.js` +
  `assets/js/app/commitments-panel.js`. `g`, not a reuse: `a`–`f` were spent earlier today by
  S1/S4/S6/S7/S8/S9.
  **The mirror had to be added to `roadmap.html` as well as flightplan.html** — the drawer
  reads `global.FWCommitments`, and `defer` preserves document order, so the tag goes ahead of
  `roadmap-tree.js` (`roadmap.html:97`). portal.html loads `roadmap-tree.js` but has no drawer;
  `commitmentControlsHtml` returns `''` when the mirror is absent, so it degrades rather than
  breaking, and the page was deliberately not given a script it does not need.
- GATES: baseline at session start **42/42 green in 67.8s**; session end **42/42**. No new gate
  script — the invariants went into the suites that already own them, which is cheaper and
  keeps the coverage next to the thing it guards:
  - EXTENDED **`test:vectors`** (the fragile-path gate, §3.8) with the section that decides
    whether this feature works at all: the no-op save, idempotence over repeated normalizes,
    a Gemini regeneration keeping a commitment on a surviving step id, **a cleared date NOT
    being resurrected from `preserveFrom`**, five garbage inputs (2026-02-31, free text, an
    ISO instant, an unknown effort, meta with no date) each dropped rather than coerced,
    `mergeTreePatch` keeping a commitment through a Marco content rewrite, and a **client↔
    server parity block** that loads `assets/js/shared/commitments.js` in a bare sandbox and
    asserts both copies agree field-for-field, in order, and bucket identically — including a
    step due TODAY reading 0 days out at **23:59 UTC** (the exact shape of the arithmetic bug
    S9 found).
  - EXTENDED **`test:marco-voice`** with the follow-through contract. The golden alone would
    not have protected it: a later session can delete "never scold" and re-run `--update`, and
    the suite goes green on the deletion. Seven explicit assertions now pin the rules, plus
    seven on the commitments prompt block itself (names the overdue item, says "due TODAY"
    not "0 days", excludes a completed commitment, **emits nothing at all when there is
    nothing to chase** — the guard against an invented callback).
  - EXTENDED **`test:emails`** with the digest hook: an overdue commitment appears in BOTH the
    html and the text part, done/far-future ones are left out, an empty list renders no empty
    heading, and the copy is asserted NOT to scold.
  - EXTENDED **`test:endpoints`** with both new write paths, **259 → 305 assertions**. The
    weekly-plan half proves the write really lands (it reads the roadmap handed to D1, not just
    the response body), that an invalid calendar date is a 200 no-op with **zero** writes, and
    that **an id absent from the session-loaded tree is a 404 — which IS the authorization
    check**, since there is no id space in which one user can name another's step. The
    step-breakdown half proves bad ids are refused before any model call, that the
    `MAX_STEPS_PER_NODE` ceiling refuses with **Gemini never invoked and nothing persisted**
    (imported, never hardcoded), that micro-steps graft immediately after their parent with the
    parent's own `dueAt`/`effort` untouched, and that a dead upstream 502s and hands back the
    rate slot it took.
  - CLAUDE.md gate counts unchanged (39 offline / 42 total) — nothing was added, four suites
    grew.
- VERIFIED (headless probe, session scratchpad, **not committed** — no gate renders these two
  surfaces signed-in with real rows): 31/31. On flightplan.html the three groups render in
  order with three rows; the overdue row reads "3 days overdue" and carries the overdue tier
  class; the due-today row reads "Due today"; `moved 2x` and the effort label render; a step
  title of `<img src=x onerror=...>` renders as **TEXT** with **zero** injected `<img>` nodes
  and nothing executed; no horizontal overflow at 1280 or 375, no row overflowing its own box
  at 375, and the chip text is not a status token. On roadmap.html the drawer shows a chip on
  the two dated steps and none on the undated ones, offers "by when?" twice and Change+Clear
  twice, **withholds "Break this down" from the `aiBuilt` micro-step**, opens a visible picker
  on click, and boots with zero page errors.
  Worth recording because it cost time: the probe's FIRST run reported `Unexpected token ':'`
  on roadmap.html. It was the **probe's own** over-broad Playwright route — `**/profile*`
  matches `assets/js/shared/profile-alignment.js`, so the harness served a JS request a JSON
  body. Re-checked with no routes at all: zero page errors. A stub glob that swallows a real
  asset looks exactly like a product bug.
- DEFERRED (nothing silently dropped):
  - **A student with commitments but NO generated weekly tasks is still not emailed.** The
    digest loop keeps its `if (!tasks.length) continue`. Removing it would widen the recipient
    population, and who receives the digest is S11's decision (it rewrites the dispatcher), not
    a side effect of adding a section to the body.
  - **Commitments are deliberately NOT in the weekly-plan generation prompt.** They would have
    to enter `weeklyInputSig`, and then every date change would burn a Gemini regeneration of a
    week the student is already living in. They ride in the GET payload instead, recomputed per
    request. If S11 wants the generator to respect them, that is a cost decision to take
    knowingly.
  - **No `commitment_` events from Marco's side.** Marco can talk about a commitment but cannot
    create or move one; the drawer and the Flight Plan module are the only writers.
  - **`lastTopic` is one line and only at a conversation OPEN.** Mid-conversation it would read
    as Marco losing a thread he is already holding.
  - **Reschedule history is a COUNT, not a log.** "moved 2x" is the honesty; the previous dates
    are not kept. Clearing a date and setting a new one resets the count to 0 — a new promise,
    not a moved one. Both are deliberate; a per-move audit trail on every step is doc weight
    for a number nobody would read.
  - **Past commitments drop out of the Flight Plan module once done**, and the module shows no
    "you missed this" history. S11's Month in Review is where a retrospective belongs.
  - **The micro-step prompt is not cached.** `step-elaborate` next door caches to KV because its
    answer is the same prose every time; a breakdown WRITES to the tree, so a cache hit would
    mean silently re-adding steps the student may have deleted.
- DRIFT (plan vs repo; repo wins):
  - **§5 S10 says the Marco memory includes a "last-thread topical summary (one line, generated
    at thread close or lazily)". It is DERIVED, not generated.** No Gemini call. It stores the
    first user message of the previous conversation, verbatim. Reasons, in order: a per-close
    call for every user is recurring spend for a line that cannot be more truthful than the
    sentence it compresses; a generated summary can invent a topic that was never discussed,
    and a coach who misremembers is worse than one who does not remember; and the half of the
    memory that carries the plan's own example — *"you said you'd finish the DCF module by
    Friday"* — is the COMMITMENTS block, which is exact by construction. Marco's prompt says
    out loud that the line is an opening quote rather than a summary, so he never claims more.
  - **§5 S10 says micro-steps are "free within Marco/roadmap allowances (rate-limited per
    user/day)". Implemented as an hourly IP-keyed `checkRateLimit`, with no `FEATURE_LIMITS`
    row.** A plan-limits row is served on `/config` and read per `/auth/me`; S8 and S9 both
    recorded `remainingForUser` growing toward 9 parallel KV reads for a free account. Adding a
    tenth to police a small JSON call was the wrong trade.
  - **No `test:commitments` gate script.** §5 S10's gate line names `test:vectors`,
    `test:weekly` and `test:marco-voice`, and every invariant landed in a suite that already
    owns that kind of claim (fragile paths → `test:vectors`; prompt contracts →
    `test:marco-voice`; rendered email → `test:emails`; handlers → `test:endpoints`). A new
    script would have meant a fifth place to look for "is this covered".
  - **The plan's UI line says "flightplan Commitments module lists due/overdue".** It lists
    Overdue / This week / Later — the third group exists because without it a date more than a
    week out is invisible the moment it is set, which makes the picker feel broken.
- JACOB ACTIONS RAISED:
  1. **`npm run deploy:cron`** — the Monday digest now carries a "You said you would" block, and
     no git push deploys the standalone Worker. This is additive to the S9 item already on your
     list; running it once covers both. Nothing breaks if you do not: the digest simply keeps
     sending exactly what it sends today.
  2. **No migration, no env var, nothing to configure.** Commitments live inside the roadmap
     JSON doc, so this ships fully live on the prototype the moment it deploys — the only
     session in Phase 3 with no infrastructure prerequisite.
  3. Not promoted to production — Phase 3, soaking on `Jacob_Work` per D26. Pushed to
     `Jacob_Work` only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9-hot), `docs/EVENTS.md` (S1/S4/S6/S7/S8/S9-hot),
  `functions/_lib.js`, `functions/chat.js`, and the buster-restamped root `.html`
  (all 11 that load `flightway-pages.css`, plus roadmap.html/portal.html for the app modules).
  Also touched (not Phase-0): `functions/_lib/roadmap-tree.js`, `functions/weekly-plan.js`
  (S7/S8/S9-hot), `functions/career-roadmap.js`, `functions/_lib/dossier-coordinates.js`,
  `functions/_lib/marco-persona.js`, `functions/_lib/emails.js` (S4/S9-hot),
  `workers/cron/index.js` (S1/S4/S9-hot), `assets/js/app/roadmap.js`,
  `assets/js/app/roadmap-tree.js`, `assets/css/flightway-pages.css`, and the gate scripts
  (`test-vectors.cjs`, `test-marco-voice.mjs`, `test-emails.mjs`, `test-request-paths.mjs`,
  `goldens/marco-voice/chat.txt`). NEW (no merge-conflict surface):
  `functions/_lib/commitments.js`, `assets/js/shared/commitments.js`,
  `assets/js/app/commitments-panel.js`.

## S11 — Phase 3: Lifecycle completion (2026-07-24, Jacob_Work@581f6de..HEAD)

S9 gave the product externally-imposed urgency and S10 the internal kind. S11 makes the
product **speak first**. Before this session the cron was a Monday task list that, with the
paywall on, went to paying accounts only — which is to say, to almost nobody, since the free
tier is the whole retention story. It is now a notification engine: a rebuilt weekly digest,
a Month in Review page and email, an admin broadcast composer, and one dispatcher that knows
what day it is.

- DONE:
  - **The paywall filter is DELETED (D9).** `filterByPlan` and the `paywallEnabled` /
    `isDevTester` imports are gone from `workers/cron/index.js`; recipients are chosen by
    `verified_at IS NOT NULL AND <category> = 1` and nothing else. `plan` still comes back
    from the query because the digest's teaser slot needs to know whether it is selling or
    recommending — but it never decides who receives. `test:cron` seeds a FREE account with
    `PAYWALL_ENABLED=true` and asserts it is mailed, and lints the source for a
    `paywallEnabled(` call so the filter cannot come back by accident.
  - **The digest is now a composed model, not a template with holes**
    (`functions/_lib/digest.js`, NEW, pure): how last week went → this week's 3 tasks →
    deadlines inside 21 days → the student's own open commitments → ONE teaser → one Marco
    line. Three files, three questions: `digest.js` decides content and order, `emails.js`
    decides how it looks, the cron decides who gets one. A copy change can never become a
    recipient change.
    - **`hasContent` is the send decision and it lives with the composition** — and it
      deliberately does NOT count the teaser (`digest.js:composeDigest`). An email whose only
      substance is an upgrade pitch is an ad; D9 promised a digest.
    - **S10's deferred question, answered:** the old rule was `if (!tasks.length) continue`,
      which silently excluded every student who had dated a step but not yet generated a
      plan — exactly the people most worth chasing. Commitments alone, or deadlines alone,
      now make a digest sendable.
    - **The teaser is keyed to the wall they actually hit.** One query per RUN (not per user)
      aggregates 30 days of `plan_cap_hit` into a most-hit-first list per user
      (`workers/cron/index.js` `capHitsByUser`); a free reader who ran out of mock interviews
      is sold mock interviews. No cap hits → a week-rotated pitch. **Paying readers get a
      DISCOVERY slot instead** and are never linked to /pricing — a subscriber reading an
      upgrade ad is the fastest way to make an email feel like spam.
    - **The Marco line is a template with real fill, never a per-user Gemini call** (§5 S11's
      budget note). Every branch is a fact the digest already holds, ordered the way Marco
      would raise them in person: an overdue promise outranks a closing deadline outranks a
      good week. It never scolds — the same rule his chat preamble runs on.
  - **Generate-on-send, without paying twice.** The week doc's key, TTL, signature and
    done-state refresh moved to `functions/_lib/weekly-plan-store.js` (NEW) because there are
    now two writers. The Monday digest runs BEFORE the student's first visit of the week, so
    it generates and persists the week under the **same key and the same `sig`** the page
    checks — otherwise the page would regenerate (and re-pay for) the week the digest just
    built. Bounded by `DIGEST_GENERATE_CAP` (default 25/run); past it the email falls back to
    the deterministic `selectWeeklyTasks` and **deliberately does not persist**, so the real
    generation still happens on the student's next visit.
  - **Month in Review (D13)** — `functions/_lib/month-review.js` (NEW: pure composer +
    `gatherMonthReview`'s three D1 reads), `GET /month-review?m=YYYY-MM`
    (`functions/month-review.js`), `review.html` + `assets/js/app/month-review.js`, and the
    1st-of-month email. Every line is a fact the student can check:
    - activity from `events` (the only per-user timestamped record we have), deadlines
      hit/missed from `deadlines`, commitments kept/slipped from steps whose `dueAt` fell in
      the month, coordinates from `vector_snapshots`.
    - **The 161 vector dimensions have no human-readable label anywhere on the server**, so
      the review reports MOVEMENT ("moved on 5 dimensions, 4 up, 1 down, across 4 weekly
      snapshots") and invents no names. An unlabelled honest number beats a labelled guess.
      Only |Δ| ≥ 1 counts — the vectors carry fractional re-merge noise, and "158 of your 161
      coordinates moved" every month is reporting rounding.
    - **`vector_snapshots` is keyed by ISO WEEK**, which does not compare against a
      `YYYY-MM-DD` bound at all. The range is converted to week keys first; zero-padded ISO
      weeks sort lexicographically, which is what makes the SQL `BETWEEN` correct. The window
      reaches one snapshot BEFORE the month, or a student whose only July snapshot is the one
      written on the 3rd would be told there is "not enough history" despite having a year.
    - **`hasContent` gates the send here too.** A review email that says "you did nothing" is
      the most effective unsubscribe prompt available. The quiet-month headline neither
      congratulates nor scolds.
    - **Exactly-once is a MONTH-SUFFIXED `email_log` type** (`month_review:2026-07`). A
      static type would make `alreadySent` fire once per ACCOUNT, so every student would
      receive exactly one review email ever. `test:cron` asserts both directions.
  - **Broadcast composer (D11)** — migration `0021_broadcasts.sql`,
    `functions/_lib/broadcast.js`, `functions/admin/broadcasts.js`, and the panel in
    `admin.html` + `assets/js/app/admin-console.js`. Three rules the code enforces:
    1. **ONE SENDER.** The endpoint queues; the cron sends. "Send now" writes
       `scheduled_at = now` and a new **hourly** trigger picks it up (≤1h), so nothing walks
       a recipient list inside a Pages Function. `claimBroadcast` is an atomic
       `scheduled → sending` UPDATE, which is what makes the hourly and daily dispatchers
       safe to overlap. `test:endpoints` asserts the endpoint mails **nobody**.
    2. **NEVER TO SOMEONE WHO DID NOT ASK.** `verified_at IS NOT NULL AND notify_product = 1`
       is in the SQL of every segment branch, not applied afterwards. `paid`/`free` read
       `effectivePlan`, so a lapsed subscriber is correctly free.
    3. **THE BODY IS ESCAPED BEFORE ANY TAG IS EMITTED.** "The author is an admin" is not a
       security model — a pasted angle bracket reaches a hundred inboxes the same way a
       crafted one does. Links are https-only.
    - Mutations require elevation (like grants); preview does not, because it is a read.
      Preview renders in a **sandboxed iframe with no `allow-scripts`**.
  - **The dispatcher's final form** (`workers/cron/index.js`): daily 14:00 → day-3 →
    T-14/T-3 alerts → digest **if Monday** → review **if the 1st** → due broadcasts → radar
    refresh last (the only step that spends money, and the only one that is fine to lose).
    Hourly → broadcasts. 04:00 → rollup. Monday-and-the-1st are two independent `if`s, not a
    chain — `test:cron` drives 2026-06-01 (a Monday that IS the 1st) and asserts BOTH send.
- MIGRATIONS: **0021** (`migrations/0021_broadcasts.sql`, `broadcasts` + 2 indexes).
  **NOT applied to remote D1** — Jacob's, below. Additive. Until it is applied the composer
  degrades rather than breaking: the admin panel renders with an explicit "migration 0021 has
  not been applied" note (not an error card — those two states look identical from outside
  and only one is actionable), and the cron's broadcast step finds no table and returns.
  `broadcasts.actor_email` is named for the `test:purge` identity regex ON PURPOSE, so the
  table could not enter the schema without someone deciding what account deletion does with
  it; it is classified `EXCLUDED_TABLES` with the same reasoning as `admin_audit_log`.
- BUSTERS: **`?v=20260724h`** — `assets/js/app/admin-console.js` (admin.html, the only page
  that loads it) and the NEW `assets/js/app/month-review.js` on review.html. `h`, not a
  reuse: `a`–`g` were spent earlier today by S1/S4/S6/S7/S8/S9/S10. No other `/assets/*` file
  changed; `flightplan.html` and `admin.html` gained page-local CSS, which carries no stamp.
- GATES: baseline at session start **42/42 green in 69.3s**; session end **43/43**.
  - NEW **`test:cron`** (pure lane) — three layers, because three classes of bug ship here
    and only one is visible in review. (1) PURE: the digest's send decision (tasks-only,
    commitments-only, deadlines-only, teaser-only-is-NOT-content), the 21-day horizon with
    dismissed/done/past rows excluded, teaser selection for free vs paid, **that the UTM
    query always precedes a fragment** (a `#deadlines` path would otherwise bury the whole
    utm in the hash — the link still works, so nobody notices the attribution is gone),
    anti-drift that every teaser names a real `plan-limits` feature, month keys/bounds/labels,
    vector movement, and the review composer's month window. (2) REAL SQLITE from ten
    migrations: recipients with no plan filter, per-category columns, cap-hit ranking off real
    `events` rows (including a malformed `props` row being skipped rather than fatal), segment
    resolution incl. a lapsed subscriber and BOTH stored `user_profiles` payload shapes (v1
    root and v2 `identity`), and the atomic broadcast claim. (3) THE REAL DISPATCHER against
    date fixtures and a stubbed Resend: Wednesday/Monday/the-1st/Monday-that-is-the-1st,
    review idempotency across a same-day rerun, the month suffix being load-bearing, a full
    broadcast send with its recorded counters, and a student with no roadmap getting **no
    email at all**.
  - EXTENDED **`test:emails`** with the S11 senders driven through the REAL composers (so the
    two cannot drift): the digest's streak line and deadlines in both MIME parts, deadlines
    ordered before commitments, a paying reader never linked to /pricing, the review's
    month-named subject + `cat=review` unsub + **empty sections skipped rather than rendered
    as zeroes**, and the broadcast's `cat=product` unsub with an escaped `<script>`.
  - EXTENDED **`test:endpoints`** with `GET /month-review` (free, 401 signed out, a
    well-formed out-of-window month 400s while a malformed one falls back) and
    `POST /admin/broadcasts` (404 to non-admins, preview needs no elevation **and sends
    nothing**, queue without elevation 403s with `elevate:true`, an elevated queue writes a
    `scheduled` row and still mails nobody, cancel on a claimed row is 409).
  - EXTENDED **`pages:smoke`** (`GET /month-review` → 401 proves the route without writing
    anything; `/review` 200), **`layout:check`** (review.html added, 330 → 360 cells),
    **`verify:meta`** (review.html classified `shell`).
  - CLAUDE.md gate counts updated **40 offline / 43 total**.
- VERIFIED (headless probe, session scratchpad, **not committed** — no gate renders either
  surface signed-in with rows): **54/54.** review.html renders all six sections in order in
  light and dark; a deadline title of `<img src=x onerror=…>` renders as **TEXT** with zero
  injected nodes and nothing executed; the S12 sections render nothing; a `hasContent:false`
  month renders one honest empty state rather than a stack of blank headings; no horizontal
  overflow at 375 or 1280 with a deliberately long title. On admin.html the composer's
  segment select is built from the server list, the preview iframe is sandboxed **without**
  `allow-scripts`, the recipient count is shown before anything is queued, and a hostile
  broadcast subject injects zero nodes.
  - **The probe found one real defect: `.admin-field { display: flex }` beats the user-agent's
    `[hidden] { display: none }`, so the composer's school input rendered for EVERY segment** —
    which reads as "we are about to mail one school" when the segment says everyone. Fixed
    with an explicit `.admin-field[hidden]` rule covering every field on the page, not just
    this one.
  - **The S10 route-glob trap reproduced exactly, and cost time again.** The probe's first run
    reported `Unexpected token ':'` and a blank review page. `**/month-review*` also matches
    `/assets/js/app/month-review.js`, so the harness served the module a JSON body. Matching
    on an exact pathname fixed it. Likewise a `SecurityError: … lacks the 'allow-same-origin'
    flag` was the probe's own init script running inside the sandboxed preview iframe. **Two
    of the three "bugs" the first run reported were the harness.** A stub that swallows a real
    asset, and an init script that runs in every frame, both look exactly like product bugs.
- DEFERRED (nothing silently dropped):
  - **Evidence and applications are absent from the review, not faked.** `composeMonthReview`
    returns them as present-and-empty arrays and both renderers skip empty sections, so S12
    wires them in without touching the shape or the gate.
  - **The rollup stayed on its own 04:00 trigger.** §5 S11 lists it under the daily 14:00
    dispatcher; moving it would make every rollup 10 hours later for no gain, and 04:00-UTC
    summarising yesterday is what keeps the dashboards' right edge honest. Recorded as drift.
  - **No `digest_sent` / `broadcast_queued` / teaser-click events.** Each is either already
    counted (`email_sent` from the shared chokepoint, `admin_audit_log` for staff actions,
    UTM-attributed `page_view` for clicks) or needs a tracking pixel (§9 non-goal). Written
    into EVENTS.md under its own heading so a later session does not "fix" them back.
  - **The `school` segment cannot be a pure SQL predicate** — school lives inside the
    `user_profiles` JSON blob. It LIKEs nothing and filters in JS through the user facade,
    bounded by `MAX_RECIPIENTS` (5000). Fine at this scale; it is the first thing to revisit
    if the user base grows two orders of magnitude.
  - **A broadcast that dies mid-send stays `sending`.** It needs a human to read `email_log`
    and decide; silently retrying a partial send to a segment is how people receive the same
    announcement twice.
  - **`review.html` is in `layout:check` for its FRAME only.** `/month-review` 404s in that
    harness by design, so the section rows never render there — they are covered by the probe
    above instead, the same split S9's radar and S10's commitments module already use.
  - **Turnstile, `MAILING_ADDRESS`, `UNSUB_SECRET`** — unchanged, still Jacob's. S11 makes
    the last two matter more: this is the session that starts sending real volume.
- DRIFT (plan vs repo; repo wins):
  - **A THIRD cron trigger exists** (`0 * * * *`). §5 S11 puts broadcasts on the daily pass;
    a broadcast an admin queues at 15:00 UTC would then wait 23 hours, which makes "send now"
    a lie. The daily dispatcher still sweeps them as a backstop and the atomic claim makes the
    overlap safe. `test:cron` asserts every schedule the code dispatches on is actually
    registered in `wrangler.toml` — a branch keyed to an unregistered cron is dead code nobody
    would notice for months.
  - **The digest generates on send under a CAP**, not unconditionally. §5 S11 says "generate
    on send if stale, reusing weekly-plan-gen budget rules"; the budget rule that module has
    is a per-call timeout, not a per-run ceiling, and a Monday run over a large opted-in
    population is a burst of sequential Gemini calls inside one scheduled invocation.
  - **`weeklyInputSig` / `loadWeekDoc` / `saveWeekDoc` / `refreshDoneState` moved out of
    `functions/weekly-plan.js`** into a shared store. Not in the plan; unavoidable once the
    cron became a second writer of the same doc.
  - **§5 S11 says the review page is "a `/review` module on flightplan or its own light
    page".** Own page, at the clean URL `/review`, because the email links to it and a
    retrospective is not this week's business. The endpoint is `/month-review`, not `/review`,
    because S2 proved a Pages Function SHADOWS a static asset at the same path — `/review`
    had to stay the page.
  - **The page needed an in-app entry point.** The email links to `/review`, but a page
    reachable only from an email is half a feature; `flightplan.html`'s header now carries a
    "Month in Review" link.
- JACOB ACTIONS RAISED:
  1. **Apply migration 0021 to the shared remote D1.** Until you do, the broadcast composer
     can draft, preview and test-send but cannot queue (the panel says so out loud). Additive;
     nothing dropped. Check first, because `apply` runs everything pending:
     `npx wrangler d1 migrations list flightway-db --remote --env production`, then
     `npx wrangler d1 migrations apply flightway-db --remote --env production`.
     Expect **0020 and 0021** to be pending unless you have since applied 0020.
  2. **`npm run deploy:cron` — this one is not optional any more.** No git push deploys the
     standalone Worker, so until you run it the cron keeps doing exactly what it does today:
     a paid-only Monday digest with no review, no broadcasts, and no hourly trigger. The
     deploy also **registers the new `0 * * * *` schedule**. This supersedes the same item on
     the S9 and S10 lists — running it once covers all three.
  3. **`MAILING_ADDRESS` and `UNSUB_SECRET` are now blocking, not theoretical.** S11 is the
     session that starts sending free users real volume: a weekly digest, a monthly review and
     broadcasts. Without `MAILING_ADDRESS` every one of them carries "FlightWay, Inc." where
     CAN-SPAM requires a physical address; without a matching `UNSUB_SECRET` on the cron Worker
     AND both Pages projects, every unsubscribe link in all of them fails. `npm run verify:env`
     prints the rotation one-liner.
  4. **Before the first broadcast, send yourself a test.** The composer's "Send test to me"
     goes out immediately through the same builder and the same chokepoint as the real thing,
     and is logged as `broadcast_test` so it can never be confused with the send.
  5. Not promoted to production — Phase 3, soaking on `Jacob_Work` per D26. Pushed to
     `Jacob_Work` only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9/S10-hot), `docs/EVENTS.md` (S1/S4/S6/S7/S8/S9/S11-hot),
  `functions/account.js` (S2/S4/S9-hot), `admin.html`, `flightplan.html`, `CLAUDE.md`.
  Also touched (not Phase-0): `functions/weekly-plan.js` (S7/S8/S9/S10-hot),
  `functions/_lib/emails.js` (S4/S9/S10-hot), `functions/_lib/email-template.js` (S4/S7/S9-hot),
  `workers/cron/index.js` (S1/S4/S9/S10-hot), `workers/cron/wrangler.toml`,
  `assets/js/app/admin-console.js` (S3-hot), and the gate scripts (`run-gates.mjs`,
  `smoke-pages.mjs`, `verify-meta.mjs`, `verify-fluid-layout.mjs`, `test-emails.mjs`,
  `test-request-paths.mjs`), `package.json`. NEW (no merge-conflict surface):
  `migrations/0021_broadcasts.sql`, `functions/_lib/digest.js`,
  `functions/_lib/month-review.js`, `functions/_lib/broadcast.js`,
  `functions/_lib/weekly-plan-store.js`, `functions/month-review.js`,
  `functions/admin/broadcasts.js`, `review.html`, `assets/js/app/month-review.js`,
  `scripts/test-cron.mjs`.

## S12 — Phase 3: Evidence Locker + Application Tracker (2026-07-24, Jacob_Work@3ae4ceb..3a75a2a)

Phase 3's last session, and the one that closes the loop the other three opened. S9 gave
the product externally-imposed urgency, S10 the internal kind, S11 the voice that chases
both. S12 gives it the two things a student can point at afterwards: **proof that
compounds** (the Evidence Locker) and **a pipeline that remembers** (the Application
Tracker). Before this session an artifact was a row in a table with a card on Home, and
"applications" was a Coming-soon tile on the Flight Plan.

- DONE:
  - **`functions/_lib/evidence-locker.js` (NEW, pure) — attribution that cannot lie.**
    The locker's whole claim is "this artifact moved Quantitative Analysis +5", and there
    were three ways to compute that number. Two of them are wrong:
    - Re-deriving the formula would drift the moment `gap-progress-sync.js` changed.
    - Reporting the artifact's raw evidence weight ignores the 30-point evidence cap and
      the 90% progress cap, so anyone with several artifacts on one gap would be told
      each of them moved something when the last three moved nothing.
    - What ships instead: run **`computeGapProgressDims` — the single writer's own pure
      function — TWICE**, once on the real tree and once on a counterfactual tree with
      that one evidence log removed, and report the difference (`:88`). The number on a
      card is therefore, by construction, exactly what deleting that piece of proof would
      cost the student. A delta of 0 is a real answer and the card says
      "Filed under <gap>" rather than "+0".
    - **READ-ONLY, and gated as such.** No env, no D1, no KV, no fetch, no mutation — the
      counterfactual is built by spreading (`:56`), so the caller's tree comes back
      byte-identical. `test:vectors` asserts the byte-identity AND lints the source for
      `saveUser`/`saveRoadmap`/`saveUserBlob`/`mergeObjectiveAiPatch`/`applyObjectiveAiPatch`/
      `env.DB`/`COACH_KV`/`fetch(`, because every numeric assertion in that block would
      still pass if a later session quietly added a writer here.
  - **`GET /artifacts?attribution=1`** (`functions/artifacts.js:180`) serves it. The
    portal's compact mirror deliberately does **not** ask, so Home never pays a roadmap
    read for a card that shows three titles.
  - **The locker is a MODULE on flightplan.html, not a new page** — `artifacts.js`
    resolves its host (`:319`) exactly the way `portal-flightplan.js:170` does: the static
    `#evidence` section S7 built is the locker (full grid + attribution), `#portal-fw2-stack`
    stays the compact mirror. See DRIFT — the plan says "page/module" and the door already
    resolved to `#evidence`.
  - **Add / edit / delete.** Edit is metadata only (`handleArtifactUpdate`): re-pointing
    evidence at a different skill is a vector write dressed as a text edit, so the gap
    select is hidden in edit mode and changing what a piece of proof proves is a
    delete-and-re-add. **Delete strips the gap's evidence log and re-syncs through
    `syncGapProgressToQuiz`** (`handleArtifactDelete`) — the canonical single writer,
    recomputing absolute values from the tree, never an inverse patch. Deleting the proof
    takes the credit with it, which is the only behaviour that keeps the attribution line
    honest.
  - **Migration `0022_applications.sql`** — `applications` (14 cols, 3 indexes incl. a
    partial UNIQUE on `(user_id, opportunity_ref)`) plus `url` + `updated_at` on
    `artifacts` (§5 S12: "if schema needs columns … extend via this session's migration").
    `user_id` is the normalized email, consistent with `events`, `email_log` and
    `deadlines`. **0022 ALTERs `artifacts`, so it has a real ordering dependency on 0010**
    — `test:endpoints` loads both and is the only place that proves it.
  - **`status_at` is a second timestamp column, and it earns its place.** It is written
    ONLY on a real stage change and is **NULL at creation**. `updated_at` moves on a notes
    edit and on the save itself, so a digest that counted moves off it would tell a
    student who saved three things and fixed one typo that they "moved 4 applications
    this week". Both directions are asserted.
  - **The endpoint is `/tracker`, NOT `/applications`, and that is load-bearing.** S2
    established that a Pages Function shadows a static asset at the same path (it is how
    `functions/robots.txt.js` beat the old static `robots.txt`), and Pages 308s
    `/applications.html` → `/applications`. A Function at `/applications` would have made
    the new page answer 401 JSON — the page would simply not exist. S11 hit the identical
    trap and resolved it the same way round: the PAGE keeps the natural name, the ENDPOINT
    is qualified. **This was caught by reasoning about the route, not by a failing test,
    and `pages:smoke` now asserts both halves** (`/tracker` 401 AND `/applications`
    answering `text/html`), because a future rename would break the page silently.
  - **Authorization is structural.** Every write in `application-store.js` is scoped
    `WHERE id = ? AND user_id = ?`, and a miss is **404, not 403** — telling an attacker
    that a row exists but is not theirs is itself a disclosure (S9's radar made the same
    call). Ids are random tokens, but "unguessable" is a property of the id generator and
    "impossible" is a property of the query; only the second survives someone changing the
    generator.
  - **`applications.html` + `applications-board.js` + `shared/applications.js`.** Five
    columns on desktop built from the server's own `statuses` array (never a hardcoded
    ladder), collapsing to a stacked list below 900px; per-card status `<select>` (not
    drag-and-drop, which is inaccessible and a much larger build), notes, https-only link,
    inline second-click Remove, and an add-manually form. Every row is `createElement` +
    `textContent`: a role name can arrive straight off a grounded web result via the
    Finder's Save button, so it is exactly as untrusted as S9's deadline titles.
  - **Save buttons on Opportunity Finder results** (`opportunity-finder.js:166`). Free on
    every plan — §4 meters the LIST, and saving something the student has already been
    shown costs nothing. The "already saved" state matches on the **URL**, not on a
    client-side copy of the server's ref hash: the server derives the ref FROM the url, so
    the two agree by construction and there is no second hash to drift.
  - **A dated result also lands on the Deadline Radar** (`tracker.js` `linkDeadline`), via
    S9's `insertManual`, which merges rather than duplicating. Best-effort in both
    directions: a date the radar refuses (past, or beyond its 18-month horizon) leaves the
    application perfectly usable.
  - **Per-role prefill, both tools.**
    - `resume.html?tailorRole=…&tailorCompany=…` fills the job title and puts the cursor
      in the posting box (`resume-page.js applyTailorPrefill`). It deliberately does NOT
      invent posting text: the tailor's whole anti-fabrication design rests on matching
      against a real posting, and a fabricated one would produce a confident variant tuned
      to nothing.
    - `coach.html?ivRole=…&ivCompany=…#practice` prefills the career and company
      (`interview-mode.js applyPendingPrefill`). The prefill is HELD rather than applied at
      read time, because `open()` may route through the first-run interstitial and the
      panel does not exist until the student comes back from it. `state.soc` is cleared
      with it — a specific posting is a job title, not an O*NET career.
  - **Lifecycle wiring, so the two new surfaces are not write-only.**
    - The weekly digest gains one line, last in the body, only when non-zero. It is a
      "how last week went" fact in the same class as the streak line and **deliberately
      does not count toward `hasContent`**: a digest is a forward-looking prompt, and an
      email whose entire substance is "you moved two applications last week" tells the
      student what they already know and asks nothing of them.
    - The count is **one aggregate query per RUN** (`countMovedByUser`), the
      `capHitsByUser` shape S11 established, not a read per recipient.
    - **Month in Review fills the two sections S11 shipped present-and-empty** — evidence
      added and applications moved, in both the page and the email, both skipping
      themselves when empty. `reviewHeadline` counts them too: a student who logged three
      artifacts and moved two applications did not have "a quiet month", and telling them
      they did is the kind of wrong number that ends a subscription.
  - **The Applications door on flightplan.html is a real link.** S7 shipped it as a
    non-link "Coming soon" card; that markup is gone.
  - **With 0022 unapplied the board says so out loud.** `GET /tracker` ships
    `available:false` and a save is refused **503 with a sentence the student can read**,
    rather than an empty board that silently rejects every save — S11 made the same call
    for the broadcast composer while 0021 was pending, for the same reason: "not switched
    on yet" and "your save failed" look identical from outside and only one is actionable.
- MIGRATIONS: **0022** (`migrations/0022_applications.sql`). **NOT applied to remote D1** —
  Jacob's, below. Additive (`CREATE TABLE IF NOT EXISTS` + 3 indexes + 2 `ALTER TABLE ADD
  COLUMN`), nothing dropped. Every read path degrades rather than breaking while it is
  pending: `listArtifacts` falls back to the pre-0022 column list, the artifact INSERT
  falls back to the 9-column form (the link is the only thing missing), `listApplications`
  returns `[]`, and the board renders the notice above.
- BUSTERS: **`?v=20260724i`** — `a`–`h` were spent earlier today by S1/S4/S6/S7/S8/S9/S10/S11
  and a same-day stamp must never be reused. Restamped, path-qualified, on every
  referencing page: `flightway-pages.css` (13 pages), `feature-intro.js` (10),
  `artifacts.js` (2), `opportunity-finder.js` + `opportunity-finder.css` (roadmap),
  `resume-page.js` (resume), `interview-mode.js` (coach), `month-review.js` (review).
  NEW at the same stamp: `assets/js/shared/applications.js` (applications.html +
  roadmap.html — the Finder reads `FWApplications`) and
  `assets/js/app/applications-board.js`. `applications.html` is a new page, so every
  pre-existing asset it references carries that asset's CURRENT stamp — a new page is not
  a change to an old asset.
- GATES: baseline at session start **43/43 green in 72.6s**; session end **43/43**. No new
  gate script — every invariant went into the suite that already owns that kind of claim,
  which is the S10 discipline and keeps "where is this covered" a one-file answer.
  - EXTENDED **`test:endpoints`** with the applications section §5 S12 makes mandatory,
    driven against **REAL SQLITE loaded from migration 0022**, not the regex D1 stub the
    rest of that file uses. That is the whole point: an ownership bug lives in a WHERE
    clause, and a stub that pattern-matches SQL cannot tell `WHERE id = ?` from
    `WHERE id = ? AND user_id = ?`. It covers 401 on both verbs, the finder-save dedupe
    (twice = one row, `duplicate:true`) versus two identical MANUAL rows staying two rows,
    hostile input (angle brackets stripped from the row, a `javascript:` url stored as
    NULL), the ladder including a no-op and a backwards move, **`status_at` untouched by a
    notes edit**, the migration-pending 200/`available:false` + 503 pair, and
    **cross-user denial on all three write actions with A's row read back byte-identical
    afterwards**, plus B's board never containing A's rows.
  - EXTENDED **`test:vectors`** with the locker attribution block: the counterfactual
    delta against a hand-computed fixture (base 40 + span 50 × 10% = 45, artifact worth 5),
    a fourth artifact on a gap already at the 30-point cap credited **zero**, an unlinked
    artifact claiming nothing, no-roadmap degrading rather than throwing, the
    tree-is-unmutated assertion, and the source lint described above. 21 assertions.
  - EXTENDED **`test:cron`** (the digest's send decision with application moves — they
    render but never make an email sendable; the review's two new sections including a
    row with no title being dropped rather than rendered blank, and the headline no longer
    calling that month quiet), **`test:emails`** (both MIME parts for the digest line and
    both review sections, plus the empty-month skip), **`test:events`** + **`docs/EVENTS.md`**
    (eight names), **`verify:meta`** (applications.html classified `shell`),
    **`layout:check`** (applications.html added), **`pages:smoke`** (`/tracker` 401 AND
    `/applications` serving HTML), **`test:purge`** (`applications` in `USER_ID_TABLES` —
    the table names every place a student applied and whether they were rejected, which is
    the most sensitive table in the schema after the resume).
  - CLAUDE.md gate counts unchanged (40 offline / 43 total) — nothing added, six suites grew.
- VERIFIED (headless probe, session scratchpad, **not committed** — no gate renders these
  surfaces signed-in with rows): **28/28**, the §5 S12 "Done" pipeline demo end to end.
  The board renders five columns in ladder order; a role of `<img src=x onerror=…>` renders
  as TEXT with **zero** injected nodes and nothing executed; a `javascript:` url is never a
  link; the tailor and practice hrefs are byte-exact; changing the select posts the stage
  change; no horizontal scroll at 1280 or 375. `resume.html?tailorRole=…` prefills
  "Summer Analyst — Goldman Sachs" and strips its params; `coach.html?ivRole=…#practice`
  prefills both fields and drops the params with the hash. The locker renders
  "Moved Quantitative Analysis +5" for the linked artifact and nothing for the
  portfolio-only one, and the Applications door is a real link.
  - **The probe's first run reported two failures that were the probe, not the product.**
    `featureIntros` lives at `journey.featureIntros` on the canonical user object, not at
    the root, so seeding it at the root left the mock-interview interstitial up — and
    `open()` shows the interstitial INSTEAD of the panel, so the prefill never ran. Third
    session running in which a harness bug looked exactly like a product bug (S10's route
    glob, S11's init script in a sandboxed iframe). Worth stating as a rule: **when a
    signed-in probe reports a missing UI, suspect the seed before the code.**
- DEFERRED (nothing silently dropped):
  - **`promoteFromNote()` still passes no `url`.** Its call sites are text-only and the
    gap-log UI that reaches it is documented as unreachable in `artifacts.js`'s own header.
    Left alone rather than half-wired.
  - **An artifact's evidence-log TEXT is not rewritten when its title or note is edited.**
    The log embeds `[artifact:<type>] <title> — <note>` at stamp time. Nothing renders that
    string today (the gap-log UI is orphaned), so rewriting it would mean a tree write and
    a vector re-sync for a string nobody reads. Recorded because it IS a real
    inconsistency, just an invisible one.
  - ~~**`POST /artifacts` still writes the objective vector with its own inline formula**~~
    — **CLOSED the same day, at Jacob's instruction. See the follow-up below.**
  - **No drag-and-drop on the board.** A `<select>` per card is keyboard- and
    screen-reader-accessible and a fraction of the build; drag-and-drop would need a
    parallel keyboard path anyway.
  - **The tracker has no cap and no `FEATURE_LIMITS` row** — §4 puts it on the free tier
    outright. `MAX_APPLICATIONS` (200) is an abuse ceiling enforced in the store, not a
    plan limit, so it never reaches `/config` and never becomes a ninth parallel KV read on
    `/auth/me` (S8/S9 both flagged that growth).
  - **`.fp-door--soon` / `.fp-door-soon` CSS is now unused.** Left in place: removing it
    would restamp `flightway-2.css` across 11 pages to delete four lines, and the next
    Coming-soon door will want them.
- DRIFT (plan vs repo; repo wins):
  - **§5 S12 says the endpoint is `/applications`; it is `/tracker`.** Forced, not
    preferred — see DONE. The plan could not have known, because the shadowing rule was
    discovered in S2 and the collision only exists once a page wants the same name.
  - **§5 S12 says the locker gets "a first-class page/module". It is a MODULE**, on
    flightplan.html at `#evidence`, not a new page. S7 had already built that section and
    pointed the Evidence door at `#evidence`; a new page would have meant a new meta
    classification, new layout cells, a new footer, and a moved door, to relocate a
    surface that belongs on the doing page. The Application Tracker got the new page
    instead, because a five-column pipeline board genuinely needs the width and a
    retrospective list does not. Both remain reachable from the doors row and from portal.
  - **§6 names `evidence_added`; it is NOT registered.** `artifact_saved` has counted every
    add since before S1 and the locker's own "+ Add" goes through the same modal and the
    same POST. A second name for one click splits the funnel across two metrics that
    immediately disagree — the same call S7 made for `thisweek_task_done`, and it is written
    into EVENTS.md under its own heading so a later session does not "fix" it back.
  - **§5 S12's `opportunity_ref` is described as a reference; it is a HASH of the URL**
    (`opportunityRefFor`), and it is `''` for manual entries. A grounded result carries no
    stable id, and a student typing the same role twice is allowed to — they may well be
    applying to two of them.
  - **The plan says "weekly digest counts advances"; the digest counts stage MOVES.**
    "Advanced" (a forward step on the ladder) exists and is what `application_stage_change`
    carries, but `status_at` records that a move happened, not its direction, and a second
    column recording direction would be a schema row for one adjective. The copy says what
    the data supports: "2 applications moved stage last week."
- JACOB ACTIONS RAISED:
  1. **Apply migration 0022 to the shared remote D1.** Until you do, the Applications tab
     renders the "not switched on yet" notice, the Finder's Save button reports the same
     sentence, and artifacts save without their new link column — all by design, none of it
     an error. Additive; nothing dropped. Check first, because `apply` runs everything
     pending:
     `npx wrangler d1 migrations list flightway-db --remote --env production`, then
     `npx wrangler d1 migrations apply flightway-db --remote --env production`.
     Expect **0020, 0021 and 0022** to be pending unless you have since applied the first two.
  2. **`npm run deploy:cron`** — the weekly digest now carries an application-moves line and
     the Month in Review carries the evidence and application sections. No git push deploys
     the standalone Worker. This is additive to the item already on your list from S9/S10/S11;
     running it once covers all four. Nothing breaks if you do not — those two lines simply
     do not appear.
  3. **No new env var, no Stripe object.** S12 adds neither.
  4. Not promoted to production — Phase 3, soaking on `Jacob_Work` per D26. Pushed to
     `Jacob_Work` only.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9/S10-hot), `docs/EVENTS.md`
  (S1/S4/S6/S7/S8/S9/S11-hot), `functions/account.js` (S2/S4/S9-hot), `functions/artifacts.js`,
  `flightplan.html`, and the buster-restamped root `.html` (admin, auth, career, coach,
  dashboard, portal, profile-build, quiz, resume, review, roadmap, simulation).
  Also touched (not Phase-0): `functions/_lib/emails.js` (S4/S9/S10/S11-hot),
  `functions/_lib/digest.js` (S11-hot), `functions/_lib/month-review.js` (S11-hot),
  `workers/cron/index.js` (S1/S4/S9/S10/S11-hot), `assets/js/app/artifacts.js`,
  `assets/js/app/opportunity-finder.js`, `assets/js/app/resume-page.js`,
  `assets/js/app/month-review.js`, `assets/js/coach/interview-mode.js`,
  `assets/js/shared/feature-intro.js` (S4/S7-hot), `assets/css/flightway-pages.css`
  (S10-hot), `assets/css/opportunity-finder.css`, and the gate scripts
  (`test-request-paths.mjs`, `test-vectors.cjs`, `test-cron.mjs`, `test-emails.mjs`,
  `verify-meta.mjs`, `verify-fluid-layout.mjs`, `smoke-pages.mjs`).
  NEW (no merge-conflict surface): `migrations/0022_applications.sql`,
  `functions/tracker.js`, `functions/_lib/application-core.js`,
  `functions/_lib/application-store.js`, `functions/_lib/evidence-locker.js`,
  `applications.html`, `assets/js/shared/applications.js`,
  `assets/js/app/applications-board.js`.
- DELEGATION: two Sonnet agents (individual agents, NOT a workflow, per this session's
  constraint), both with the server contract fixed before they started and both diffs read
  line by line here — the board page + shared client API, and the locker UI. Two things
  they got right that are worth carrying: the locker's client `attributionPhrase()` mirrors
  the server's word for word rather than inventing display copy, and both grids are
  `createElement`-only. Two corrections made here afterwards: a **failed delete restored the
  button and said nothing**, which is the silently-dead-button failure S9 called out on the
  radar's Refresh (now an inline `.fw-locker-err` line through `FWErr`), and
  `applications.html` was loading `commitments.js`, a module nothing on that page uses.
  The endpoint rename landed mid-flight and was handed to the board agent as a correction.

### S12 follow-up — the artifact path stops carrying its own copy of the formula (2026-07-24)

S12's deferred item, closed at Jacob's instruction rather than left for a later session.

`stampGapEvidence()` in `functions/artifacts.js` computed the objective vector itself, and
it computed a **different** number from the canonical single writer:

| | step contribution | fallback when nothing addresses the gap |
|---|---|---|
| `stampGapEvidence` (old) | `0.6 × checklistDone / checklistTotal` | none — an empty checklist scored 0 |
| `computeGapProgressDims` | `0.6 × max(stepRatio, checklistRatio)` | whole-active-path completion |

So logging an artifact wrote value A and the next roadmap or weekly-plan save converged the
same dimension to value B. Nothing was ever corrupted — absolute recomputation is
self-healing, which is exactly why this could sit here unnoticed since the 2026-07-10
streamlining — but a student could watch a coordinate they had just been shown change a
minute later for no reason visible to them. The canonical formula is a superset (it takes
the `max` of the two ratios), so the old path could only ever **under**-credit.

- **The fix is a deletion.** `stampGapEvidence` now mutates the tree, saves it, and hands it
  to `syncGapProgressToQuiz(env, email, updated)` — the same three lines
  `handleArtifactDelete` already used, and the same pattern `weekly-plan.js`,
  `career-roadmap.js` and `profile/roadmap.js` have always used. The inline formula, the
  `mergeObjectiveAiPatch`/`applyObjectiveAiPatch` calls and the `loadUserBlob`/`saveUserBlob`
  round trip are all gone; so are their imports, which is what makes the property checkable
  by reading the top of the file.
- **`value` in the response is now read back from `computeGapProgressDims`**, so the number
  the endpoint reports and the number in the database come from one pure function and cannot
  disagree — which was the defect.
- **Two intended consequences**, both now pinned by the gate:
  1. **A redundant write is a no-op.** `syncGapProgressToQuiz` returns null when every
     dimension already holds its computed value, so replaying the same evidence (or logging
     against a gap already at the 30-point evidence cap) writes the roadmap and *nothing
     else* — no vector row, no churned timestamp, and no vectors handed back to the client
     to merge. The Evidence Locker's attribution line already says such an artifact moved
     nothing, so the two now agree.
  2. **Every gap's dimension converges, not just the stamped one.** That is what all four
     other callers do on every save; the artifact path simply stopped being the exception.
- **Traced before editing** (§3.8), and two things the trace settled that a diff would not
  have shown:
  - `saveUserBlob` → `saveUser(normalizeUser(blob))` and `loadUserBlob` →
    `denormalizeUser(loadUser(...))`, so the two facades are v1/v2 views of the **same
    record**. Switching writers does not move where the vector is stored.
  - The patch `source` string changes `'artifact-evidence'` → `'gap-progress-sync'`.
    Grepped: `source` is written by `mergeObjectiveAiPatch` and read by nothing, so this is
    inert.
- **The pinned fixture value did not move.** `test:endpoints` has asserted
  `gapStamp.value === 56` since before S12 (b=40, span=40, 1 of 2 checklist items, one
  w=10 artifact). Under the canonical formula the fixture's nodes carry no `addressedGaps`,
  so the step ratio falls back to 0/3 and `max(0, 0.5)` restores the same 0.5 — 56 either
  way. That the number is unchanged on the fixture while the divergence is real elsewhere is
  precisely why this needed a trace rather than a test run.
- GATES: **40/40 offline**, 43/43 full.
  - EXTENDED **`test:endpoints`**: an idempotent replay writes **zero** user saves and hands
    back no vectors, and the value in the response is asserted equal to the value persisted
    in `objectiveAiPatch.dimensions`.
  - EXTENDED **`test:vectors`** with a source lint over `functions/artifacts.js` — no
    `mergeObjectiveAiPatch`, no `applyObjectiveAiPatch`, no `saveUserBlob`, and
    `syncGapProgressToQuiz` present. **Proven to bite**: re-adding the
    `mergeObjectiveAiPatch` import turns it red.
  - **The lint's first version tripped on its own explanatory comment**, which named the
    forbidden symbols in prose. Fixed by stripping comments before matching, for both this
    lint and the evidence-locker one next to it: a presence-lint that a COMMENT can trip is
    a lint a future session satisfies by rewording rather than by fixing the code.
- STILL OPEN, deliberately: the local `syncGapProgress()` helper in the same file computes a
  gap's `progress`/`status` **display percentage** from `checklist + evidence`. That is a
  different quantity from a vector dimension and has no canonical twin, so it stays.
- JACOB ACTIONS RAISED: **none.** No migration, no env var, no cron redeploy — the change is
  a deletion behind an endpoint that already existed.

## S13 — Phase 4: server-rendered public career pages (2026-07-24, Jacob_Work@4c4a69c..96a795b)

The first session that builds something for people who have never heard of FlightWay.
Everything before this was product; this is ~780 public URLs that answer a question a
stranger typed into Google, and hand them the quiz at the bottom. `career.html` — the
app's deep dive — is untouched and stays `noindex`, because it is an empty JS shell to a
crawler and always was.

- DONE:
  - **`functions/_lib/career-page.js` (NEW, pure) — the renderer.** No env, no fetch, no
    D1, no KV: it takes catalog rows and O*NET numbers the route already loaded and
    returns HTML strings. That is what lets `seo:check` render all 782 pages **offline in
    ~90ms** and assert against every one of them rather than a sample.
  - **`functions/_lib/career-catalog.js` (NEW)** — the env-touching half: one cached
    routing index, the per-career dimension slice, similarity neighbours, salary tiers.
    The detail page, the directory and the sitemap all resolve slugs through ONE index.
  - **`functions/careers/[slug].js`** — 200 on a canonical slug, **301 on an alias**, 404
    on anything else, KV-cached 24h with `X-FW-Cache: hit|miss` so the cache is provable
    rather than assumed, `Cache-Control: public, max-age=0, s-maxage=86400,
    stale-while-revalidate=604800`. `max-age=0` is deliberate: the browser cache is the
    one cache with no bust path.
  - **`functions/careers/index.js`** — the sector directory. All 782 careers are real
    `<a href>`s in the HTML; the search box is progressive enhancement that hides nothing
    until someone types, because a crawler with JS off must not read an empty directory.
  - **`functions/sitemap.xml.js`** — 790 URLs, generated. The static `sitemap.xml` is
    **DELETED**; a Function shadows a static asset at the same path (S2 proved it with
    robots.txt) and two sources of truth for one URL is the drift this replaces. Every
    `<loc>` is `https://flightway.ai/...` whatever host served it, same reasoning as
    index.html's hardcoded canonical. **It degrades rather than 500s**: an unreachable
    artifact store yields the static pages only, because a 500 at this URL is a Search
    Console error against the whole property.
  - **Purging is a version bump.** `CAREER_PAGE_VERSION` is a segment of every KV key, so
    changing the template orphans all ~780 cached pages at once. There is no purge API
    call and nothing to remember to run.
  - **Content, all of it computed from real numbers** — top work activities, skills,
    knowledge and abilities with their O*NET level AND importance (already 0–100 in the
    artifacts; the registry's `lvMax: 7` describes O*NET's own scale, not the buffers),
    the Job Zone education/experience/training triple, a sector salary band, "how the work
    tends to run" (deterministic rules that each **name the activity rating they came
    from**, so a reader can disagree with them), similarity-ranked related careers, the
    honest-fit explainer written against `docs/FIT_MATH.md`, and the quiz CTA.
  - **`Occupation` + `BreadcrumbList` JSON-LD** on every page, `CollectionPage` +
    `BreadcrumbList` on the directory, full meta set, canonical, `og-careers.png` (new
    card, generated by the existing `npm run og:build` — one entry added to its list).
  - **Inbound links** so the directory is discoverable: index.html nav, mobile menu and
    footer; pricing.html footer. No asset changed, so nothing was restamped.
  - **THE BUG THE NEW GATE FOUND, which is the reason to write gates before believing
    the code.** The canonical slug mirrors `onet-catalog.js`'s "legacy hub slug wins over
    the O*NET title" rule. That rule maps **every** SOC a hub card touches, first hub id
    winning — and five SOCs are named by more than one card. So 15-1252.00 was claimed by
    `software-engineer`, `product-manager` AND `devops-engineer`, and four more had two
    claimants each. The losers became **neither a page nor an alias**:
    `/careers/financial-analyst`, `/careers/operations-manager`, `/careers/copywriter`,
    `/careers/hotel-manager` and three `SLUG_ALIASES` entries pointing at them all 404'd.
    Two changes fixed it, and both are load-bearing:
    1. **A hub card's slug belongs to its PRIMARY soc (`socs[0]`) only.** A secondary is
       registered as an alias, never as a canonical URL — that alone resolves the
       three-way fight over 15-1252.00.
    2. **A legacy slug is canonical only when it is the SOLE name for that occupation.**
       The four genuine ties fall back to the O*NET title, which is what the page's own
       `<h1>` says: `/careers/financial-and-investment-analysts`, with `investment-banker`
       AND `financial-analyst` 301'ing to it. Picking one by hub id would have been
       arbitrary and would have left the other dead.
    `SLUG_ALIASES` entries are now resolved **through** the alias map last, so
    `investment-banking → investment-banker → financial-and-investment-analysts` lands on
    a real page instead of pointing a redirect at a 404. And a career can no longer be
    dropped for wanting a taken URL: title slug, then a SOC-suffixed slug, never `continue`.
  - **A second content defect the gate now pins:** `career-descriptions.json` clips O*NET's
    text at 500 characters, so **32 of 782 descriptions end mid-clause** ("…May maintain
    databases within an application area, working"). Invisible inside the app where the
    paragraph is one of many; unmissable on a public page whose entire claim is that the
    data is real. `cleanDescription()` cuts back to the last complete sentence.
- MIGRATIONS: **none.** S13 adds no table, no column and no D1 read.
- BUSTERS: **no existing `/assets/*` file changed, so nothing was restamped.** One new
  asset, `assets/og/og-careers.png`, ships at `?v=20260724j` (`a`–`i` were spent earlier
  today by S1/S4/S6/S7/S8/S9/S10/S11/S12; a same-day stamp is never reused). The three
  pre-existing OG cards were regenerated by the same `og:build` run and came back
  **byte-identical**, so they keep their stamps — checked with `git status`, not assumed.
- GATES: baseline at session start **43/43 green in 76.1s**; session end **44** with the
  new gate, **41/41 offline in 16.9s**.
  - NEW **`seo:check`** (`scripts/seo-check.mjs`, pure lane) — 68 assertions. It stubs
    `fetch` to read the artifacts off disk and then **executes the real handlers**,
    including the KV path against a fake KV, rather than pattern-matching their source.
    Whole-catalog sweep (not a sample — all 782 render in ~90ms, and a sample is exactly
    how the one occupation with a pathological title ships broken): unique title and
    description on every page, titles that fit a search result **or are the occupation's
    own name** (46 O*NET titles are longer than 62 characters on their own, and inventing
    a shorter name for a federal occupation title would be worse than a clipped SERP
    line), descriptions 70–158 chars cut at a word boundary, exactly one self-referential
    canonical and no robots meta, one `<h1>`, og:image absolute **and present on disk**,
    both JSON-LD blocks parsing and pointing at their own page, every internal link
    resolving to a career page that exists, a 60KB page budget, and no severed sentence.
    Then the routes: cache miss→hit with a byte-identical body, the version in the KV key,
    alias 301, uppercase and `.html` suffix normalising, 404 that is `noindex` with no
    canonical, 405 on POST, HEAD with no body. Then the sitemap: exact URL count, no
    duplicates, canonical host only, **no career URL that is an alias** (it would 301),
    no unescaped ampersand, `lastmod` on career URLs and **none** on the static ones (a
    fabricated lastmod teaches Google to ignore all of them). Then escaping, against a
    hostile row whose title is `<img src=x onerror=…>` and whose description is
    `</script><script>`. Then degradation, driven by making `fetch` throw.
  - EXTENDED **`verify:aliases`** — `career-page.js` is the fifth copy of the alias table,
    and a new section builds the REAL routing index and asserts alias behaviour:
    every `SLUG_ALIASES` key resolves to a slug that exists, `bySlug`/`aliasTo` are
    disjoint, and for every row both `slugify(title)` and `truncatedSlug(title)` resolve
    back to **that row's own** canonical slug — never to a different career. **This is the
    assertion that found the bug above**, before a single page was deployed.
  - EXTENDED **`verify:busters`** to walk `functions/**/*.js`. HTML is now emitted from
    Functions too, so their `?v=` stamps were invisible to a `*.html` walk and could drift
    from the rest of the site silently. 115 stamped assets, no mismatch — `career-page.js`
    and index.html agree on all six shared stamps.
  - EXTENDED **`verify:meta`**: the sitemap parity assertion now runs against the
    function's own `STATIC_URLS` + `buildSitemap()` in both directions instead of reading
    a file that no longer exists, and the internal-link resolver learned `/careers`.
    While there it fixed a **latent** defect: the dynamic-route fallback matched on
    segment COUNT alone, which was accidentally harmless only because the repo had zero
    bracket routes until this session — any 2-segment dead link would have resolved. It
    now matches segment-by-segment with a slug shape.
  - EXTENDED **`pages:smoke`** with the live half: `/careers` 200 + ≥100 career links,
    `/careers/software-engineer` 200 + exact canonical + `Occupation` JSON-LD +
    `X-FW-Cache`, the alias 301 with an exact `Location`, the 404 being `noindex`, and
    `/sitemap.xml` serving >700 `<loc>`s — which is **also the proof that the Function
    shadows the deleted static file** on a real deployment.
  - CLAUDE.md gate counts updated 40→41 offline, 43→44 total.
- VERIFIED IN THE REAL RUNTIME, not just offline: `npx wrangler pages dev` on port 8939,
  because Pages Functions ROUTING is the one thing no unit test can answer and getting it
  wrong ships a dead session. `/careers` → 200 html, `/careers/software-engineer` → 200,
  `/careers/software-developers` → **301** to the canonical, `/careers/financial-analyst`
  → **301** to `/careers/financial-and-investment-analysts` (the fix, live),
  `/careers/nope-not-real` → 404, `/sitemap.xml` → 200 `application/xml` with **790**
  `<loc>` entries, `Cache-Control` and `X-FW-Cache` exactly as designed, and
  `/robots.txt` correctly advertising **no** sitemap on a non-canonical host (D23).
  Also screenshotted at 1280 and 390 (headless, scratchpad, not committed): no horizontal
  overflow at either width, the brand mark renders, and the shared nav — which collapses
  into a JS hamburger below 768px and these pages deliberately do not load `landing.js`
  for — is overridden to wrap instead.
- DEFERRED (nothing silently dropped):
  - **The ETL's 500-char description clip is worked around, not fixed.** 32 rows in
    `career-descriptions.json` genuinely end mid-clause. Fixing it means regenerating and
    committing a 185KB artifact for 32 rows; `cleanDescription()` handles it at render for
    now, and `seo:check` fails if a severed sentence ever reaches a page again.
  - **No per-career OG images.** §5 S13 calls them an optional stretch. One shared card;
    the occupation's name is already in the share preview's title and description.
  - **The directory is 136KB uncompressed** (782 links). Well inside every limit and it
    gzips to a fraction, but it is the page to watch if the catalog doubles.
  - **AI-derived careers (`aiDerived`, the 99-xxxx range) get no public page.** They are
    generated on demand for one student out of an adjacent base career, they appear and
    disappear as people reset their targets, and their text is model output rather than
    O*NET data. A public URL that exists because one student once typed a job title is the
    thin, unstable page Google penalizes a domain for. Fully available inside the app.
  - **`.claude/worktrees/frosty-bartik-cb888f/` is a stray git worktree in the repo** — a
    whole second copy of the tree, carrying its own `robots.txt`. It is not served
    (`_redirects` 302s `/.claude/*`, added in S2) and it is not this session's to clean,
    but it is sitting in the working directory.
  - S14 adds the guides to `STATIC_URLS`; the sitemap function is where they go.
- DRIFT (plan vs repo; repo wins):
  - **§5 S13 says "server-render full HTML from the D1 catalog". The catalog is not in
    D1.** `onet_careers` exists as a table (migration 0003) and **nothing reads it** —
    `functions/_lib/onet/store.js` serves `/data/onet/artifacts/careers.json` with an
    optional R2 override, and D1 holds only `derived_careers`, the AI fragments this
    session excludes. Rendered from the artifact store. The count IS derived at runtime as
    the plan asks (782 today), it just comes from the artifact.
  - **§5 S13 asks for "top tasks". There is no O*NET tasks artifact** — the ETL never
    imported them. Used the 41 **work activities**, which are the closest thing the data
    has and are rated for both importance and level.
  - **§5 S13 says `career.html` gains a canonical to its public twin. It does not, and
    should not.** Three reasons, any one sufficient: `career.html` resolves its career
    from `?slug=` at runtime, so a static canonical is impossible; Google's own guidance
    is not to combine `noindex` with a canonical; and `verify:meta` encodes exactly that
    rule (S2: "a noindexed self-canonical is a contradiction"). The intent — stop the app
    shell competing with the public page — is already served more strongly by the
    `noindex` it has carried since S2. The public page links INTO the app instead
    ("Open in FlightWay"), which is the half of that bullet that was actually a good idea.
  - **§5 S13 asks for a server-side `page_view` for `/careers/*`. Rejected, and the reason
    is specific.** `logServerEvent()` stamps every row `anon_id: 'server'` with null `ref`
    and null `utm_*`, and the admin Sources panel is built on precisely those columns
    (`analytics.js:460` groups by `anon_id` and classifies on `utm_source`/`ref`; `:245`
    counts `COUNT(DISTINCT anon_id)`). A server-written `page_view` would land as ONE fake
    visitor from no channel and would **degrade the panel it was meant to feed**. The
    pages carry the ordinary `events.js` beacon instead — the same script as every other
    page — so an arrival from Google is a real `page_view` with real first-touch
    attribution. Recorded in `docs/EVENTS.md` under its own heading so a later session
    does not "fix" it back.
  - **§5 S13's gate asks for "a sample of N slugs". It runs all 782.** They render in
    ~90ms offline; sampling is how the one pathological title ships broken.
  - The endpoint/page collision trap S11 and S12 both hit does **not** apply here: there
    is no `careers.html`, so `functions/careers/index.js` and `functions/careers/[slug].js`
    own `/careers` and `/careers/:slug` outright. Verified against the real runtime rather
    than reasoned about, because this is the repo's first dynamic route.
- INSTRUMENTATION: two new registered events, `career_cta_click`
  (`{placement: 'hero'|'app'|'index', slug}` — the SEO channel's only conversion number:
  stranger arrives from search → stranger starts the quiz) and `career_index_search`
  (`{has_query: 1}` — the query itself is a career someone is considering, closer to a
  wish than a click, and `q`/`query`/`text` are banned prop keys anyway). Both are written
  from inline scripts in the rendered HTML, so their call sites are **not** under
  `assets/js` and `test:events`' literal-name lint cannot see them — noted in
  `REGISTERED_EVENTS` next to the names. `docs/EVENTS.md` has the section.
- JACOB ACTIONS RAISED:
  1. **Nothing is required for this to work.** No migration, no env var, no Stripe object,
     no `deploy:cron`. It is three new routes and a deleted file.
  2. **This is invisible on flightway.ai until the final V2 merge** (D26 — Phase 4 soaks
     on `Jacob_Work`). Until then `/careers` exists only on the prototype, where
     `robots.txt` says `Disallow: /` and every response is `X-Robots-Tag: noindex` — which
     is correct and is the whole point of D23, not a problem to fix.
  3. **`sitemap.xml` was deleted from the repo** and is now served by
     `functions/sitemap.xml.js`. Verified in a real `wrangler pages dev` run that the
     Function answers at that path, and `pages:smoke` asserts it on every future run. Worth
     knowing because it is the one file this session removed rather than added.
  4. **Search Console** (already on your checklist, now with something to submit): verify
     `flightway.ai` and submit `https://flightway.ai/sitemap.xml` **after** the final
     merge. Submitting before it would hand Google 790 URLs that 404 on production.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `index.html`, `pricing.html`, `functions/_lib/events.js` (S1/S6/S9/S10/S12-hot),
  `docs/EVENTS.md` (S1/S4/S6/S7/S8/S9/S11/S12-hot), and **`sitemap.xml` (DELETED)** — it
  was part of S2's Phase-0 surface, so the final merge must not resurrect it. Gate scripts
  touched: `verify-meta.mjs`, `verify-busters.mjs`, `verify-slug-aliases.mjs`,
  `smoke-pages.mjs`, `run-gates.mjs`, `build-og-images.mjs`, plus `package.json`,
  `CLAUDE.md` and `docs/ARCHITECTURE.md`.
  NEW (no merge-conflict surface): `functions/_lib/career-page.js`,
  `functions/_lib/career-catalog.js`, `functions/careers/[slug].js`,
  `functions/careers/index.js`, `functions/sitemap.xml.js`, `scripts/seo-check.mjs`,
  `assets/og/og-careers.png`.
- DELEGATION: two Sonnet agents (individual agents, not a workflow, per this session's
  constraint), on files this session's author was not touching, both diffs read line by
  line here. One returned the finding that made the session: it ran the new
  `verify:aliases` section, got a red, correctly refused to weaken the assertion to force
  a pass, and reported the four dead slugs with the root cause. That is the outcome the
  "report it, do not fix it in a file that is not yours" instruction exists for.

### S13 follow-up — two facts pinned, one hop removed (@96a795b)

Post-deploy pass over the first commit, all three items found by re-reading the rendered
page rather than the diff:

- **`ONET_RELEASE` and `ONET_DIMENSIONS` are constants, asserted by `seo:check` against
  `dimension-registry-v1.json` and `onet/constants.js`.** They were inline literals in
  prose — `O*NET 30.3 Database`, `161 O*NET dimensions` — on ~780 public pages. An ETL
  rebuild that moves the release would have left a false citation on every one of them,
  and there is no reading of one page that would catch it.
- **"Open in FlightWay" links `/career?slug=`, not `/career.html?slug=`.** Pages 308s the
  `.html` form (curl-confirmed on the prototype), and that redirect sat on the single link
  that hands a public reader to the product.
- **`CAREER_PAGE_VERSION` `s13a` → `s13b`.** The rendered output changed, so the version
  bump is the purge — and this is the first time the hook was used in anger rather than
  described. The prototype's KV was holding the old body under `s13a` within a minute of
  the first push.

One observed behaviour worth writing down before someone reports it as a bug: **a slug
nobody has fetched answers `X-FW-Cache: miss` more than once.** KV is eventually
consistent — the write happens in `waitUntil` and Cloudflare documents up to ~60s to
propagate — so a cold career page went `miss → miss → hit` over about forty seconds on the
live prototype. Nothing is wrong: the render is pure string work over an already-cached
catalog, so the cost of re-rendering during that window is negligible, and the alternative
(blocking the response on a KV write) would be strictly worse.

LIVE-VERIFIED on the prototype after each push: `/careers` 200, `/careers/software-engineer`
200 with the canonical pointing at **flightway.ai** (not the host that served it),
`/careers/financial-analyst` 301 → `/careers/financial-and-investment-analysts` (the slug
fix, in production), `/careers/software-developers` 301, an unknown slug 404,
`/sitemap.xml` 790 `<loc>`s, `X-FW-Cache: hit`, the og card 200 at its stamped URL, both
JSON-LD blocks parsed out of the live bytes, and `X-Robots-Tag: noindex, nofollow` plus a
`Disallow: /` robots.txt over all of it — which is D23 working, not a problem.

## S14 — Phase 4: llms.txt, llms-full.txt and the guides hub (2026-07-24, Jacob_Work@e89cb45..2d6bd2b)

S13 built ~780 pages that answer "what does a software developer actually do". S14
builds eight that answer "how do I choose a career at all" — the question people type
first, and the one an AI assistant is most often asked to answer on someone's behalf.
Plus the two files that tell a model reading the site what it is looking at.

- DONE:
  - **`functions/_lib/guides.js` (NEW, pure) — eight guides as constants, plus the
    renderer.** No env, no fetch, no D1, no KV, and deliberately **no catalog read**: a
    guide cannot 500 because the O*NET artifact store had a bad minute, and `seo:check`
    renders all eight offline in milliseconds. 7,729 words of prose across the eight,
    26.9–28.9KB rendered each (budget 60KB).
  - **Deliberately NO KV cache**, unlike `functions/careers/[slug].js`. That route caches
    because building a page means loading the catalog artifact and slicing 161 dimensions;
    this one is string concatenation over a constant. A KV round trip would cost more than
    the work it skips *and* would introduce a staleness bug the surface cannot otherwise
    have. `Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate` still
    puts them in Cloudflare's edge cache — same header as the career pages.
  - **`functions/guides/index.js` + `functions/guides/[slug].js`.** Hub grouped into four
    sections (Start here · Judging the tools · Doing the work · For parents). Per-guide:
    200 on a known slug, uppercase and `.html` suffixes normalise, a **real 404** that is
    `noindex`, carries no canonical and is `no-store`, 405 on POST, HEAD with no body.
    **No alias table, on purpose** — the career slugs needed one because five legacy
    naming schemes already pointed at them; these URLs were minted this session and
    nothing links at an older form.
  - **`functions/llms.txt.js` + `functions/llms-full.txt.js`** over `functions/_lib/llms.js`
    (also pure). 6.8KB and 68KB. The content decision that matters: **what earns an
    accurate citation from an answer engine is specificity and stated limits, not
    keywords.** So `/llms.txt` states the real method (mean-centered correlation, 161
    O*NET dimensions, readiness scored separately) and carries a **"What FlightWay does
    not do"** section — six lines naming the things the product is repeatedly assumed to
    do and does not. A model that reads "the best career platform for students" has been
    handed nothing it can repeat without lying.
  - **`/llms-full.txt` appends every guide's plain text and stops there.** The 780+ career
    pages are NOT inlined: they change with the catalog, they would push the file into the
    megabytes, and they are already enumerated in `/sitemap.xml`, which the text points at.
    A file too large to be read is worse than a short one that says where to look.
  - **`Organization` + `WebSite` + `FAQPage` JSON-LD on `index.html`,** with a real,
    visible seven-question FAQ section (`#faq`) behind the FAQPage. **No `SearchAction`:**
    it declares a URL template that runs a site search, and this site has no search
    endpoint — `/careers` filters an already-rendered list client-side. The plan marked it
    optional; declaring one would be a structured-data claim that 404s.
  - **Sitemap → 799 URLs** (7 static + `/guides` + 8 guides + `/careers` + 782 careers),
    with `GUIDES_CONTENT_DATE` as the guides' `lastmod`. The KV key now carries **both**
    content dates (`cgsitemap:<careerVersion>:<guidesDate>`) so a guides-only edit is not
    invisible for 24h.
  - **`CAREER_PAGE_VERSION` `s13b` → `s14a`** — the nav and footer on ~780 career pages
    gained a Guides link, so the rendered output changed and the version bump is the purge.
  - **Nav and footer wiring:** `/guides` in index.html's nav, mobile menu and footer, in
    pricing.html's footer, and in the shared server-rendered nav/footer. Both footers'
    `/careers` label changed "Career guides" → "All careers" — with a guides hub in the
    same column, the old label was actively confusing.
  - **New asset `assets/og/og-guides.png`** at `?v=20260725a` (see BUSTERS). The four
    pre-existing cards were regenerated by the same `og:build` run and came back
    **byte-identical** — checked with `git status`, not assumed.
- CONTENT RULES, enforced rather than intended (this is the part that keeps the hub from
  being a doorway-page problem, plan §10):
  - **Informational first.** `seo:check` asserts **no guide even names FlightWay in its
    first section**, and that a tie-in exists in the last section or the CTA. There is
    deliberately no mid-article CTA and therefore no third `placement` value.
  - **No prices anywhere,** in the guides or in llms.txt, and the gate asserts it for
    llms.txt. S19 re-leads pricing with a $29 Sprint and a $199 Founding-100; any number
    written today would be false at the merge.
  - **No statistic that cannot be checked from this repo.** Two claims were written and
    then removed on exactly this ground: "the U.S. Department of Labor catalogues over
    nine hundred occupations" appeared twice and is a fact about the O*NET-SOC taxonomy
    that **nothing in this repo can verify** (`data/onet/artifacts/careers.json` has 782
    rows, not ~900). Replaced with "describes hundreds more" and the gate-asserted 780+.
  - **`CAREER_COUNT_CLAIM = 780` is asserted as a FLOOR against the live catalog** — same
    discipline `ONET_RELEASE` got in S13. If the catalog ever shrinks below it, the suite
    goes red rather than eight public pages carrying an overstatement.
  - **`CAREER_TITLES`** holds the anchor text for the twelve career pages the guides link
    at, and `seo:check` asserts every entry equals that slug's **real O*NET title in the
    live catalog**. A renamed occupation is a red gate, not eight pages using a dead name.
  - **Inline markup is a four-tag allowlist** (`<strong>`, `<em>`, `<a href>` and closers).
    `inline()` re-escapes anything else at render time *and* the gate asserts the source
    only ever uses those four — so a typo'd tag is a red gate rather than a silently
    stripped word.
- MIGRATIONS: **none.** S14 adds no table, no column, no D1 read and no env var.
- BUSTERS: **no existing `/assets/*` file changed, so nothing was restamped.** One new
  asset, `assets/og/og-guides.png`, ships at **`?v=20260725a` — not `20260724l`**, and the
  reason is worth knowing: `verify:busters` dates an uncommitted file with
  `new Date().toISOString()`, i.e. **UTC**, and the file was written at 19:57 EDT = 00:57
  UTC. The gate went red demanding a 20260725 stamp. The letter sequence `a`–`k` spent on
  2026-07-24 by S1–S13 does not apply to it. Content dates (`GUIDES_CONTENT_DATE`,
  `CAREER_CONTENT_DATE`) stay **2026-07-24**, matching the session and every other artifact
  today — a cache-buster and a content date are different things and there is no
  inconsistency in them disagreeing across a midnight-UTC boundary.
- GATES: baseline at session start **44/44 green in 74.4s**; session end **44/44**,
  **41/41 offline in 17.0s**. No new gate script — the scope's invariants belong to gates
  that already exist.
  - **`seo:check` 68 → 159 assertions.** New: guide slugs unique and url-safe; every group
    is one the hub renders; unique titles that fit a SERP *and* carry the brand suffix;
    descriptions 70–158 ending in a full stop; one self-referential canonical and no robots
    meta; one `<h1>`; og:image absolute and present on disk; **three** JSON-LD blocks
    (`Article` + `FAQPage` + `BreadcrumbList`) parsing, with `Article.headline` equal to the
    title and `dateModified` equal to the content date; **the FAQPage `mainEntity` asserted
    equal, entry by entry, to the Q&A the page actually renders**; every internal link
    resolving (career slugs against the live catalog, guide slugs against the set);
    external links restricted to O*NET/BLS/DOL; 60KB page budget; **≥600 words of prose**
    (the thin-content risk the plan names by hand); ≥4 sections, 3–6 FAQ entries each ≥60
    chars and ending in punctuation; the informational-first rule; the inline-tag
    allowlist; `after[]` only where a list exists; and `inline()` itself driven with a
    hostile string.
  - Plus: the hub links every guide and no ghost; all four guide routes executed
    (200/normalise/404-noindex/405/HEAD); `/llms.txt` opening `# FlightWay`, carrying the
    blockquote summary and the "does not do" section, stating the method, quoting no price,
    linking only URLs that resolve, under 20KB; `/llms-full.txt` beginning with the whole of
    llms.txt, containing **every guide's last FAQ question** (the assertion that catches a
    truncated concatenation), carrying no HTML tags or entities, under 200KB.
  - **`index.html`'s three JSON-LD blocks are parsed and type-checked**, the Organization
    logo is asserted to exist on disk at its stamped path, `WebSite` is asserted to have
    **no** `potentialAction`, and the landing FAQPage is held to the same visible-text rule
    as the guides.
  - EXTENDED **`verify:meta`**: `/guides`, `/llms.txt`, `/llms-full.txt` mounted as
    Functions; the dynamic guide route resolving; index.html linking the hub (an unlinked
    hub is an orphan in the crawl graph); guide URLs present in `buildSitemap()` output and
    **disjoint from `STATIC_URLS`**; and — the small one that closes an S2 loose end —
    robots.txt has pointed AI crawlers at `/llms.txt` since S2 when no such file existed,
    so the gate now asserts the route exists whenever robots names it.
  - EXTENDED **`pages:smoke`**: `/guides` 200 with ≥6 guide links, `/guides/career-quiz`
    200 with an exact canonical + `Article` + `FAQPage`, the guide 404 being noindex,
    `/llms.txt` 200 `text/plain` starting `# FlightWay` and listing the guides,
    `/llms-full.txt` 200 with the full guide text.
- THE GATE THAT EARNED ITS KEEP: **`layout:check` went red on a nav item.** Adding
  "Guides" made five links in index.html's desktop nav, and at **1280px @150% zoom (853px
  effective)** `#fw-nav-actions` and the primary CTA overflowed the right edge — 2 of 420
  cells. **Features** came out rather than Guides: it is an in-page anchor that "How it
  works" already introduces, it survives in the mobile menu and both footers, and the
  result is byte-for-byte the same four-item nav every server-rendered `/careers` and
  `/guides` page shows. Fixing it in `flightway-theme.css` instead would have meant
  restamping the shared stylesheet across ~20 pages for a nav item.
- VERIFIED IN THE REAL RUNTIME (`npx wrangler pages dev` on port 8940, a fresh port per the
  one-port-per-harness rule): `/guides` 200, `/guides/career-quiz` 200 with the canonical
  pointing at **flightway.ai**, `/guides/CAREER-QUIZ` and `/guides/career-quiz.html` both
  200, `/guides/nope-xyz` **404 with `noindex, follow` and no canonical**, `/llms.txt` and
  `/llms-full.txt` **200 `text/plain`**, `/sitemap.xml` 200 XML, `robots.txt` correct on a
  `Host: flightway.ai` request, and `Article`/`FAQPage`/`BreadcrumbList`/6×`Question`
  present in the live bytes. **This is the check no offline test can make**:
  `functions/llms.txt.js` answering at `/llms.txt` is a claim about how Pages derives a
  route from a filename with two dots in it. Screenshotted at 1280 (guide page: nav, hero,
  TOC and typography correct).
  - One dev-server quirk recorded so it is not mistaken for a bug later: **`wrangler pages
    dev` did not hot-reload `sitemap.xml.js`'s view of `_lib/guides.js`** — it kept serving
    797 `<loc>`s (6 guides) after the last two were spliced in, while the routes themselves
    reloaded fine and the offline builder returned the correct 799. A stale module graph in
    the dev server, not a code path. The deployed build is the authority.
  - **`wrangler pages dev` needs `SESSION_PEPPER`** or `_middleware.js` returns
    `unconfigured_environment` (503 JSON) for *every* route including static ones — which
    is the guard working, not a failure. A one-line, gitignored `.dev.vars` was written for
    the run and deleted afterwards.
- INSTRUMENTATION: one new registered event, **`guide_cta_click`**
  (`{ placement: 'end'|'index', slug }`), the guides' counterpart to `career_cta_click`.
  Written from an inline script in the rendered HTML, so like the two S13 events its call
  site is not under `assets/js` and `test:events`' literal-name lint cannot see it — hence
  the explicit `REGISTERED_EVENTS` entry. `docs/EVENTS.md` has the section, including why
  there is **no server-side `page_view` for `/guides/*`** (identical reasoning to S13: a
  `logServerEvent` row lands as one fake visitor from no channel and degrades the Sources
  panel) and why **`/llms.txt` gets no event at all** (it is fetched by crawlers, and
  `functions/events.js` drops bot user-agents by design — an AI answer engine actually
  citing FlightWay shows up as ordinary referral traffic, not as a hit on the text file).
- DEFERRED (nothing silently dropped):
  - **The eight guides are AI-drafted and want Jacob's skim before the final merge** (D27
    says exactly this). Four were written in-session; four were drafted by Sonnet subagents
    against a fact sheet and read line by line here. They are honest and gate-checked, but
    they are marketing copy on a public domain and a human should read them once.
  - **No per-guide OG image.** One shared card, same call S13 made for the career pages —
    the guide's title and description already carry the specifics into the share preview.
  - **The landing FAQ is S14's, and S19 rewrites the landing.** The seven questions were
    written to survive that rewrite (they are about the method and the data, not the
    positioning), but S19 owns reconciling them with the new copy, and the FAQPage markup
    has to move with them — `seo:check` will go red if only one is edited.
  - **Guides are not linked from privacy/terms/security/contact/quiz footers**, only from
    index.html and pricing.html. Same scope S13 used for `/careers`. Not an orphan (the
    landing page is the strongest possible internal link) but worth doing in the S20 sweep.
  - Re-checked S13's deferred list: the **500-char ETL description clip** (still worked
    around at render, `seo:check` still pins it), **no per-career OG images**, the **136KB
    directory**, and **no public pages for AI-derived careers** all stand as recorded, none
    of them S14's to close. **`.claude/worktrees/frosty-bartik-cb888f/` is still a stray git
    worktree in the working directory** — not served (`_redirects` 302s `/.claude/*`) and
    deleting a whole second checkout is a hold-and-ask action, not a session cleanup.
  - S13's one S14-addressed item — *"S14 adds the guides to `STATIC_URLS`"* — is **DONE but
    not where it said** (see DRIFT).
- DRIFT (plan vs repo; repo wins):
  - **The guides went into a new `GUIDE_URLS` export, not `STATIC_URLS`.** `verify:meta`
    asserts `STATIC_URLS` equals the `public` rows of its classification table in **both**
    directions, and that table is keyed on root `.html` files. A guide is a Function route
    with no file to classify, so adding it to `STATIC_URLS` would have turned the gate red.
    Same treatment `/careers` already had (`INDEX_URL`).
  - **§5 S14 titles a guide "Do career tests work? What the data says". It ships as "Do
    career tests work? An honest answer".** The plan's list is prefixed "e.g.", and the
    original title promises statistics this session refuses to fabricate. The guide names
    real instruments and frameworks (the DOL's own interest inventory, the six-area
    interest model, the everyone-agrees-with-a-vague-description effect) without asserting
    a single number.
  - **§5 S14 says the guides may be "server-rendered or static HTML (static is fine)".
    Server-rendered.** Static HTML would have meant maintaining the guide text twice — once
    as markup and once inside `llms-full.txt` — which is precisely the two-sources-of-truth
    drift S13 deleted the static `sitemap.xml` to avoid.
  - **§5 S14 asks for "6–8" guides. Eight**, one per head term in the plan's list.
  - The plan's `Organization`/`WebSite` bullet marks SearchAction "optional"; it is **off**,
    with the reason written into index.html so a later session does not add it back.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `index.html` (nav, mobile menu, footer, a new `#faq` section, three JSON-LD blocks, new
  CSS in the landing `<style>` block — the largest S14 change to a Phase-0 file),
  `pricing.html` (footer only), `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13-hot),
  `docs/EVENTS.md` (S1/S4/S6/S7/S8/S9/S11/S12/S13-hot). Gate scripts touched:
  `seo-check.mjs`, `verify-meta.mjs`, `smoke-pages.mjs`, `build-og-images.mjs`, plus
  `docs/ARCHITECTURE.md`. Also modified: `functions/_lib/career-page.js` (S13; `shell` is
  now exported and takes a `css` param, nav/footer gained Guides, version → `s14a`) and
  `functions/sitemap.xml.js` (S13).
  NEW (no merge-conflict surface): `functions/_lib/guides.js`, `functions/_lib/llms.js`,
  `functions/guides/index.js`, `functions/guides/[slug].js`, `functions/llms.txt.js`,
  `functions/llms-full.txt.js`, `assets/og/og-guides.png`.
- JACOB ACTIONS RAISED:
  1. **Nothing is required for this to work.** No migration, no env var, no Stripe object,
     no `deploy:cron`. Six new routes and one new image.
  2. **Skim the eight guides before the final merge** (D27). `/guides` on the prototype, or
     `curl -L https://flightwayjacobprototype.pages.dev/llms-full.txt` for all 7,729 words
     as plain text in one fetch. Flag anything that overstates what the product does — the
     gates check structure and internal consistency, not taste.
  3. **This is invisible on flightway.ai until the final V2 merge** (D26). On the prototype
     `robots.txt` says `Disallow: /` and every response is `X-Robots-Tag: noindex` — D23
     working, not a problem.
  4. **Search Console** (already on the checklist, now with more to submit): the sitemap is
     **799 URLs**, up from 790. Still submit it **after** the final merge, not before.
- DELEGATION: two Sonnet agents (individual agents, not a workflow, per this session's
  constraint), each drafting two guides against a fact sheet of permitted claims, an
  explicit banned list (prices, statistics, unshipped features, outcome promises, named
  employers), a verified career-slug list with the exact anchor text, and a voice sample
  from the live site. Neither was allowed to read the repo, which is what kept invented
  product claims out. Both returned clean, parsing files; every line was read here. Three
  edits were needed and all three were things the brief did not cover, not errors: product
  names in lower case, British spellings (the site is US-English throughout), and three
  sections where a colon introduced a list with commentary meant to follow it — which is
  what the renderer's new `after[]` field exists for.


## S15 — Share + referral (2026-07-24/25, Jacob_Work@cd9683d..1b5dc6c)

- DONE:
  - **Share card (client canvas, zero server).** `assets/js/shared/share-card.js` renders a
    1200×630 card from the user's top three matches — download PNG and native share both work
    with no account, no D1 and no migration applied, the same way `sim-share.js` does. Mounted
    on three surfaces via a static `[data-fw-share-host]` div, one per surface, so the
    `share_created` prop says WHERE pride converts into distribution: `quiz.html:204` (the
    reveal, the peak-pride moment), `portal.html` (the rail, a sibling of `#portal-snapshot`
    rather than inside it — portal.js rewrites that node's innerHTML on every render) and
    `roadmap.html:57` (below the ribbon rather than injected into `.roadmap-hud-actions`,
    which `roadmap.js` rebuilds from a template string).
  - **Tier vocabulary is shared, not duplicated.** `tierFor()` (`share-card.js:35`) reads
    `FWOnetMath.FIT_TIERS` — the same thresholds `qzTierFor()` uses — and sends the server a
    KEY, never a label. `TIER_LABELS` in `functions/_lib/share.js:38` owns the words. The fit
    math itself is untouched.
  - **`POST /share` never trusts a career title.** The client sends `{soc, score, tier}`;
    `resolveCareerTitles()` (`functions/_lib/share.js:120`) resolves titles from `onet_careers`
    and then `derived_careers`. That is the whole defence for a public page on the marketing
    domain: the only free text a user controls is their own first name, which is
    character-classed to letters/marks/hyphen/apostrophe and capped at 24
    (`sanitizeFirstName`, `share.js:82`). A SOC with no catalog row cannot be published.
  - **`GET /s/<id>`** (`functions/s/[id].js`) renders the STORED snapshot — never live account
    data, because a link pasted in January must not silently change what it says in March.
    Revoked and never-existed return the byte-identical 404, so a live link cannot be found by
    probing. `noindex` in both the meta tag and `X-Robots-Tag`, and asserted absent from the
    sitemap: these are user-generated pages on flightway.ai and indexing them would be a
    privacy failure dressed as an SEO win. Unfurlers read OG tags without needing the page
    indexed, which is the entire job.
  - **`GET /s/img/<id>.png`** (`functions/s/img/[id].js`) serves the PNG from KV, resolving the
    D1 row FIRST. That ordering is what lets the KV key carry the owner's email as a segment
    (`shareimg:<email>:<id>`) — so `functions/account.js`'s existing KV sweep deletes share
    images on account purge with no second list to keep in sync. A revoked share's image 404s
    immediately; an image that outlives its page is a revocation that revoked nothing.
  - **`GET /r/<code>`** (`functions/r/[code].js`) stamps an HttpOnly `fw_ref` cookie and 302s
    to an allowlisted destination with referral UTM. `?to=` is allowlisted (`/`, `/quiz`,
    `/pricing`) so the route is never an open redirect; `?c=<channel>` becomes `utm_content`
    under a strict shape check. Bot-filtered with the beacon's own `classifyUa`.
  - **Bind at registration, server-side.** `functions/auth/register.js:99` and the Google
    callback (`functions/auth/google/callback.js:107`, new accounts only) read the cookie and
    call `bindReferral()`. Bind-once is the UNIQUE index `idx_referrals_referee`, not a read,
    so two tabs finishing signup cannot make two rows. Self-referral is refused before the
    insert. Every path returns instead of throwing — a referral must never fail a signup.
  - **The credit (D24).** `creditReferrer()` (`functions/_lib/referral.js:392`): claim
    `signed_up → converted` with a conditional UPDATE **before any Stripe call**, run the
    guards, read one month's price, ensure a Stripe customer (creating one if the referrer has
    never paid — otherwise the credit has nowhere to sit), post a negative
    `balance_transactions` entry under idempotency key `fwrefcredit:<id>`, mark `credited`,
    mail both sides.
  - **Guards** are one pure function (`referralFlags`, `referral.js:186`): self-referral by
    email / by Stripe customer / by signup-IP hash, both sides email-verified, and 12 credits
    per rolling year. A shared campus IP is a WARNING, not a block. A blocked referral holds at
    `converted` with its flags on the row so an admin can look — never silently discarded.
  - **`STRIPE_REFERRAL_PROMO_ID`** attaches the referee's free month at checkout, subscriptions
    only (`functions/stripe/checkout.js:82`) — a one-month coupon on a one-time Lifetime or
    Sprint purchase discounts something with no month to give.
  - **Admin panel** `functions/admin/referrals.js` + a Referrals card in `admin.html:332` /
    `assets/js/app/admin-console.js:499`: list, filter by status, void (reason required, goes
    to the audit log), and **retry** — because the commonest hold is `referrer_unverified`,
    which resolves itself the moment they click their verify link, and without a retry the
    credit they earned would never be issued.
  - **`GET /referral`** is the single read behind every invite surface, so none of them
    hard-writes a link, a count or the yearly ceiling (§3 rule 11). Invite cards on
    `flightplan.html:243` (its own `fp-module`) and in the `portal.html` account footer, plus
    the share-link manager (`[data-fw-shares]`) on Home — revoking is an account action and it
    sits next to the delete button for the same reason.
  - **`/invite`** (`functions/invite.js`) — the outreach kit: the user's link, the counter, and
    six paste-ready blurbs (DM, group chat, story caption, email, club channel, career-centre
    outreach), each carrying its own `?c=<channel>` tag so a group-chat paste is
    distinguishable from an Instagram bio. Server-rendered through the same `shell()` the
    `/careers` and `/guides` pages use, `noindex`.
  - Instrumentation: six registered events (below) and a `docs/EVENTS.md` section.
- MIGRATIONS: **`0023_share_referral.sql`** — `shares`, `users.referral_code` + a UNIQUE index,
  `referrals`. NOT applied to the shared remote D1 (Jacob action 1). Every S15 surface degrades
  to an explicit, honest "not switched on yet" until it is; the download/native-share half of
  the feature needs no database at all and works today.
- BUSTERS: **`?v=20260725b`** on `assets/js/shared/auth.js` (14 pages),
  `assets/js/shared/google-auth.js` (5), `assets/js/app/admin-console.js` (1), and the three new
  files (`assets/js/shared/share-card.js`, `assets/js/app/invite-panel.js`,
  `assets/css/share.css`). **20260725, not 20260724** — the same UTC boundary S14 hit: work at
  20:22 EDT is already 00:22 UTC the next day, and `verify:busters` dates uncommitted files with
  `new Date().toISOString()`. `20260725a` was S14's `og-guides.png`, hence `b`.
  - New surfaces got their own **`assets/css/share.css`** rather than rules in
    `flightway-2.css`, which 13 pages link — one rule there is a 13-page restamp. Same reasoning
    that produced `opportunity-finder.css` and `feature-intro.css`.
- GATES: baseline at session start **44/44 green in 77.0s**; session end **45/45 in 75.8s**.
  - **NEW: `test:referral`** (`scripts/test-referral.mjs`, pure lane, 0.6s, ~110 assertions).
    It exists because this is the only path in the product where a bug MOVES MONEY, and that
    failure is silent. The four it asserts hardest: a mistyped code never resolves to a
    different real user (no look-alike "repair" — 0/1/I/L/O are excluded from the alphabet, so
    a code containing one is a typo and is rejected outright); bind-once; **credit idempotency
    against a webhook replay, counted at the fetch boundary — exactly one balance transaction,
    with the D1 claim proven to land BEFORE the Stripe call**; and each guard holding the money
    rather than paying. Plus the share sanitizer driven with hostile input, a hostile stored
    payload proven unable to inject markup into the public page, and all six routes executed.
  - EXTENDED **`verify:meta`**: the six S15 route modules are imported and their handlers
    type-checked (importing is the only thing that proves `functions/s/img/[id].js` is even
    loadable); the share page is asserted `noindex` with **no** canonical, an absolute
    `og:image` at 1200×630, and `summary_large_image`; and `/s/`, `/s/img/`, `/r/`, `/invite`
    are asserted **absent** from both the sitemap and `STATIC_URLS` — the exact opposite of the
    assertion S14 added for the guides, and for the opposite reason.
  - EXTENDED **`test:purge`**: `IDENTITY_COLUMNS` now includes `referrer_id|referee_id`. Without
    that, `referrals` would have carried two real email addresses straight past a gate whose
    entire job is noticing exactly that.
  - EXTENDED **`test:events`**: six new registered names (parity with EVENTS.md, both ways).
  - EXTENDED **`verify:env`** (not a gate — needs network + auth): `STRIPE_REFERRAL_PROMO_ID`
    and `REFERRAL_CREDIT_CENTS` are reported as optional singles on Stripe-carrying targets, so
    "the referee's free month is not configured" is visible rather than assumed.
- VERIFIED IN THE REAL RUNTIME (`npx wrangler pages dev` on port **8941**, a fresh port per the
  one-port-per-harness rule — this is the check no offline test can make, because
  `functions/s/img/[id].js` answering at `/s/img/<id>.png` is a claim about how Pages derives a
  route from a nested `[param]` file with an extension on the request):
  `/invite` **200 text/html** carrying `noindex`, `Up to 12 credited invites a year` (generated
  from the constant, not typed), `data-inv-channel="groupchat"` and six placeholder links;
  `/s/<22-char id>` **404 text/html** whose body is FlightWay's own "This link is no longer
  available" page, not the static 404 — which is what proves the Function ran;
  `/s/img/<id>.png` **404 text/plain**; `/r/ABC2345` **302** to `/?utm_source=referral&…`;
  `/r/ABC2345?to=quiz&c=dm` **302** to `/quiz?…&utm_content=dm`; `/referral` and `POST /share`
  **401**; `/s/short` (a malformed id) 404 without reaching D1. `.dev.vars` with a
  `SESSION_PEPPER` was written for the run and deleted after (the S14 trap: without it
  `_middleware.js` returns `unconfigured_environment` for every route, which is the guard
  working, not a failure).
- VISUAL QA (the one place browser tooling is the right tool — the card IS a picture): the
  canvas was rendered headless across three cases (typical, over-long O*NET titles with no
  saved first name, single match). **It caught one real defect**: at the obvious 288/96 row
  geometry the third row's plate ran straight through the footer rule. Now 276/90, which puts
  the last row's bottom edge 12px clear (`share-card.js:125`). Long titles ellipsize correctly.
- INSTRUMENTATION: six registered events — `share_created` (client, `{surface}`), `share_view`
  (server), `referral_visit` (server), `referral_signup` (client), `referral_converted`
  (server), `referral_copy` (client). `docs/EVENTS.md` has the section, including why
  `referral_converted` deliberately fires **twice** per referral (`converted` then `credited` —
  the gap between those two counts is every referral a guard is holding, and it is the most
  operationally useful number in the loop), why `share_view` and `referral_visit` are
  bot-filtered (a link pasted into Slack is fetched by an unfurler immediately, so counting
  crawlers would make every share look twice as good as it was), and why **no**
  `share_download`/`share_native` were added (`sim_share_download` / `sim_share_native` already
  exist and are emitted by the same two code paths in the shared canvas module).
- DEFERRED (nothing silently dropped):
  - **No end-to-end run against real Stripe test fixtures.** `test:referral` fakes Stripe at the
    `fetch` boundary, which is enough to prove idempotency, the amount, the sign and the
    idempotency key — but not that Stripe accepts the call shape. That needs Jacob's test-mode
    keys, a test coupon and a webhook forwarder, and it is the first thing to do after the
    migration lands. The plan's "full loop locally with Stripe test fixtures" is therefore
    **partially** met: the loop runs locally, the fixtures are ours rather than Stripe's.
  - **The referee stacks the 14-day trial with the referral month.** `subscription_data.
    trial_period_days` and the promotion code are both attached, so a referred subscriber gets
    ~6 weeks before paying. Deliberate (D24 says the referee gets a free month; the trial is
    existing live copy this session did not touch), but Jacob should decide whether he wants
    both — dropping the trial for referred checkouts is a two-line change if not.
  - **`/invite` is not in the nav or the footer.** Reachable from the two invite cards and both
    referral emails, which is where the intent actually is. Worth revisiting in the S20 sweep.
  - **No share entry point on flightplan.html** — it carries the invite card instead. The card
    is about matches, and the Flight Plan is deliberately not a matches surface.
  - **`referrals` rows are anonymized, not deleted, on account purge.** Recorded here because it
    is a real (defensible) choice, not an oversight: see the DRIFT note below.
- DRIFT (plan vs repo; repo wins):
  - **No `visited` referral status; a visit is an EVENT.** §5 S15 lists `status:
    visited/signed_up/converted/credited`, but a row at visit time has no referee to key on and
    would be unbounded free writes for anyone with a terminal — `/r/<code>` is public. The visit
    is `referral_visit` in `events`, which is where a count belongs.
  - **A cookie, not a localStorage stamp.** §5 S15 says "localStorage stamp". localStorage is
    unreadable by the server at registration, so binding from it would mean the CLIENT sends the
    referrer code — and a client-supplied referrer is a client-chosen referrer, i.e. the whole
    credit path becomes forgeable from a console. `fw_ref` is HttpOnly/SameSite=Lax/Secure and
    read server-side. The browser learns a bind happened from `referred: true` on the register
    response (and `&referred=1` on the Google callback), which is what fires the client-side
    `referral_signup` §6 asks for.
  - **The credit fires on a real payment, not on `checkout.session.completed`.** §5 S15 says
    "first-successful-payment", and this is the strict reading: subscriptions credit off
    `invoice.payment_succeeded` with `amount_paid > 0` (a new event on the webhook — Jacob action
    2), one-time purchases off a `paid` session. Crediting at trial start, or on a first invoice
    the referral coupon zeroed, would make the loop farmable: twelve throwaway accounts, twelve
    free months redeemed, twelve months of credit issued against zero revenue.
  - **Share pages and `/invite` are `noindex` and absent from the sitemap.** The plan does not
    say either way. They are user-generated content and a personal link on the marketing domain.
  - **Career titles are resolved server-side from SOC codes.** The plan's payload sketch does not
    say where titles come from; taking them from the request would let a crafted POST put
    arbitrary text on a FlightWay-branded public page.
  - **`referrals` is classified ANONYMIZE (both id columns), not delete.** The row is a
    relationship between two accounts and, once credited, the only record that money moved —
    deleting it on one party's request erases the other party's evidence. Nulling the departing
    side severs the link completely, which is what the request actually asks for.
    `idx_referrals_referee` is UNIQUE over a NULLable column precisely so several anonymized
    rows coexist.
  - **The plan's `test:endpoints` line (share page authz + revocation) landed in
    `test:referral`.** All the fixtures for it live there; duplicating them into
    `test-request-paths.mjs` would have meant a second in-memory `shares` table to keep in sync.
    Covered: unauthenticated create is 401, another account cannot revoke your share, a second
    revoke is a 404 not a second success, and the KV image goes with the revoke.
  - **One event beyond §6: `referral_copy`.** Which channel someone actually copied on `/invite`
    is the only number that makes manual outreach improvable, and Igor and Leo's outreach is
    named in the plan as the reason `/invite` exists.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `assets/js/shared/auth.js` (S1/S4/S5/S6-hot; one event call), `assets/js/shared/google-auth.js`
  (S5), `functions/auth/register.js` (S1/S4/S5-hot), `functions/auth/google/callback.js` (S5),
  `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13/S14-hot), `docs/EVENTS.md` (same),
  `functions/account.js` (S1/S9/S12-hot), `functions/stripe/webhook.js`,
  `functions/stripe/checkout.js`, `functions/_lib/email-template.js` (S4/S11-hot),
  `functions/_lib/emails.js` (S4/S9/S11-hot), `admin.html` + `assets/js/app/admin-console.js`
  (S3/S11-hot), `portal.html`, `roadmap.html`, `quiz.html`, `flightplan.html` (S7-hot), plus the
  10 root pages that only carry the `auth.js` buster bump. Gate scripts touched:
  `verify-meta.mjs`, `test-account-purge.mjs`, `verify-env.mjs`, `run-gates.mjs`, `package.json`.
  NEW (no merge-conflict surface): `migrations/0023_share_referral.sql`,
  `functions/_lib/referral.js`, `functions/_lib/share.js`, `functions/share.js`,
  `functions/referral.js`, `functions/invite.js`, `functions/s/[id].js`,
  `functions/s/img/[id].js`, `functions/r/[code].js`, `functions/admin/referrals.js`,
  `assets/js/shared/share-card.js`, `assets/js/app/invite-panel.js`, `assets/css/share.css`,
  `scripts/test-referral.mjs`.
- JACOB ACTIONS RAISED:
  1. **Apply migration 0023 to the shared remote D1.** Until then: the share button still
     renders and still downloads a PNG, but "create a public link" reports link sharing is off,
     `/s/<id>` 404s, `/r/<code>` redirects without binding, and the invite card and admin panel
     both say so out loud. None of that is an error.
  2. **Add `invoice.payment_succeeded` to the Stripe webhook endpoint's selected events, in
     BOTH modes.** This is the blocking one for the referrer half: it is the only event that
     proves a subscription referee actually paid. Without it, subscription referrals never leave
     `signed_up` and no credit is ever issued (one-time Lifetime/Sprint referrals are
     unaffected). The signing secret does not change.
  3. **Create the coupon + promotion code** — "Referral — 1 month free", `duration: once` — and
     set `STRIPE_REFERRAL_PROMO_ID` on **each Pages project separately** (test coupon on
     `flightwayprototype`, live on `flightway`; the `_TEST` price-suffix trick does not apply to
     promotion codes). Unset is a legitimate state: the referrer still earns their credit and
     every invite surface drops the free-month promise rather than making one we cannot keep.
  4. **Decide on the trial + coupon stack** (see DEFERRED): a referred subscriber currently gets
     14 trial days *and* the free month.
  5. Optional: `REFERRAL_CREDIT_CENTS` to pin the credit to a fixed amount. Unset, the credit is
     read from the live monthly price in Stripe and cached in KV for a day; if neither that nor
     `MRR_MONTHLY_CENTS` resolves, no credit is issued at all rather than one of a guessed size.
  6. **Invisible on flightway.ai until the final V2 merge** (D26), as with every session since
     Phase 0.
- DELEGATION: one Sonnet agent, front-end only — the admin Referrals card in `admin.html` +
  `admin-console.js`, against a written contract for an endpoint that was already finished, with
  the no-`innerHTML`-on-server-data rule and the "do not hand-write a limit" rule stated
  explicitly. Its output was read line by line here; `handleRefusal` was re-checked to confirm a
  409 from the retry path surfaces the server's message rather than falling through to a success
  line. Everything money-adjacent — the migration, both libs, all six routes, the webhook wiring
  and the gate — was written inline.

## S16 — Live-posting readiness scorecard (2026-07-25, Jacob_Work@0fd64a9..6608114)

- DONE:
  - **The one design decision the whole feature follows from: the model reports evidence, this
    repo computes the number** (`functions/_lib/scorecard-core.js:10`). A readiness percentage is
    the most quotable thing FlightWay will ever put in front of a student, so asking a language
    model for it would make it unreproducible (the same resume against the same postings reads
    58% on Tuesday and 71% on Wednesday) and unfalsifiable. The shaping call returns exactly
    three kinds of fact — which postings exist, what they require, and which of the student's own
    evidence lines back each requirement — and `scoreRequirements()`
    (`scorecard-core.js:449`) turns that into a percentage with arithmetic. `core:3 / preferred:1`
    weights, `met:1 / partial:0.5 / missing:0` credit. Same inputs, same score, forever.
  - **The evidence corpus is what makes "you already have this" checkable**
    (`buildEvidenceCorpus`, `scorecard-core.js:182`). Every line of the student's own record the
    model may cite gets a short stable id — `R*` resume, `S*` skills, `C*` roadmap coordinates,
    `E*` filed evidence — capped at 40 entries, resume first so a huge locker never evicts it.
    The model cites ids; `sanitizeScorecard` intersects them with the set we built
    (`scorecard-core.js:389`); **a cited id that is not in the corpus is not a near-miss to
    repair, it is an invention, and the requirement is downgraded to `missing`**
    (`:393`). Erring toward "you still need this" is the only safe direction — an unearned "met"
    sends a student into an interview unprepared, which is the worst thing this report can do.
    Quote-matching was the alternative and it fails on paraphrase, silently downgrading TRUE
    claims, which is the same error in the other direction.
  - **A posting ships only with the exact https URL of a real grounded source**
    (`sanitizeScorecard`, `:355`), matched through `urlMatchKey` — the same
    absorb-the-model's-URL-drift-but-nothing-that-changes-the-page normalizer
    `opportunity-core` and `deadline-core` each keep their own copy of. A dead job link costs the
    student the role, not just the click.
  - **An action must name a requirement that is actually unmet, verbatim** (`:412`), so the
    three "what would move it most" items can never advise something they already have.
  - **`functions/_lib/scorecard-run.js`** — one grounded pipeline, two callers (the endpoint and
    the cron), because splitting it would mean two prompts drifting apart and the prompt is where
    every anti-hallucination rule lives. Three research queries about the ROLE and never about
    the student (`buildPostingQueries`, `scorecard-core.js:250` — the query text is the key of
    `researchWeb`'s cross-user brief cache, so anything personal in it would both leak across the
    cache and destroy its hit rate). Deliberately meter-free: the caller owns
    `checkFeatureLimit`/`refundFeatureUse`. Degrades to one of seven reason strings, never an
    exception, and every one of them is a legitimate state of the product with its own sentence
    (`REASON_COPY`, `functions/scorecard.js:48`).
  - **It refuses before spending, twice.** No target career → `no-career` (every query would be
    about "this career", generic enough that the answers are noise, and it would still cost
    grounding). Nothing on record → `no-resume` (`scorecard-run.js:102`) — with an empty corpus
    every requirement resolves to `missing` and the report is a 0% that says more about the empty
    profile than about the student. A run that survives validation with no requirements left is
    the same refusal after the fact (`:145`), because publishing its 0% would be the single most
    damaging number this feature can show.
  - **`GET/POST /scorecard`** (`functions/scorecard.js`) — session-gated, IP rate-limited,
    §4-metered. The meter is spent as late as possible and **refunded on every failure the
    student did not cause**, including the two profile refusals (`:167`): charging someone for
    being told to build their roadmap first would be indefensible, and a free account's single
    lifetime taste must not be burned by a Gemini timeout.
  - **`{action:'commit'}` — the step text comes from the STORED report, never from the request
    body** (`functions/scorecard.js:217`). That is the whole authorization story for a path that
    writes into the roadmap doc: the client sends an id, the server looks up what that id means
    in a row it already owns, and no shape of request can put arbitrary text on someone's
    roadmap. `aiBuilt: true` matters beyond provenance — the multi-track invariant exempts
    aiBuilt steps from `pruneBranchNodes`, so a committed action cannot be quietly removed by the
    next tree normalize. A full waypoint **refuses** rather than accepting a step
    `normalizeSteps` would silently slice (`:243`), and a double-click reports the step it
    already added instead of adding a second copy (`:238`).
  - **Migration 0024 — one row per RUN, never one per user** (`migrations/0024_scorecards.sql`).
    The trend line is the product; a table that overwrote the newest row could not draw one.
    Append-only, pruned from the OLDEST at 12 rows (`scorecard-store.js:25`), every read and
    write scoped `WHERE user_id = ?` — ids are unguessable, but "unguessable" is a property of
    the id generator and "impossible" is a property of the query.
  - **The quarterly auto-run is enforced by the DATA, not the schedule**
    (`workers/cron/index.js:130`). `selectQuarterlyBatch` returns only accounts whose newest
    report is older than 85 days, so the sweep runs every night, does nothing on almost all of
    them, and spreads a cohort's anniversaries naturally instead of stacking every premium
    account onto the 1st. Three brakes, same as S9's radar: `GROUNDING_ENABLED` (unset on the
    cron Worker, so it is inert until Jacob turns it on), the SHARED daily grounding budget
    re-checked between users, and `SCORECARD_AUTO_DAILY_CAP` (default 20). It spends **no**
    allowance — the student did not ask for this run. Entitlement is resolved per candidate via
    `effectivePlan` rather than filtered in SQL, because a hand-written `plan IN (...)` would be a
    second copy of the comp-grant/expiry/dev-allowlist rule drifting quietly out of date.
  - **Client panel** (`assets/js/app/scorecard-panel.js`, `assets/css/scorecard.css`) on
    `flightplan.html:250` — score + band, a sparkline once there is a second read, the
    requirement checklist, up to 3 actions that become dated roadmap steps, up to 5 postings with
    a save-to-tracker button. Cap numbers are never computed there: `FWPlanSurface` (backed by
    `/config`) owns every "N left" and the cap-hit card (§3 rule 11). Its own 60s run timeout
    (`:56`) is the most important number in the file — `authFetch` defaults to 30s, one run is
    three 8s research calls plus a 25s shaping call, and the allowance is spent server-side
    BEFORE the model work starts, so a default-timeout abort would cost a free student their one
    lifetime run for a report that was written, saved, and never seen.
  - Instrumentation: `scorecard_run` (**server**, from the endpoint AND the cron — `source` says
    which, because a client-side event would count only the runs somebody sat and watched, and
    the automatic runs are the ones the product pays for without being asked), `scorecard_viewed`,
    `scorecard_action_committed` (`dated` splits "added it to my roadmap" from "promised to do it
    by a date"). `docs/EVENTS.md` has the section, including why `downgraded` is the honesty
    metric to watch and why there is deliberately **no** `scorecard_posting_tracked` (the shared
    `applications.js` path already emits `application_saved`; a second name would double-count
    the one funnel S12 built to measure saves).
- MIGRATIONS: **`0024_scorecards.sql`** — `scorecards` + two indexes. Next free number at
  execution time, as §3 rule 13 requires. **NOT applied to the shared remote D1 (Jacob action).**
  Until it is, `GET /scorecard` answers `ready:false` and the panel says "The readiness scorecard
  is not switched on yet." in a sentence, and a run is refused *before the meter is touched*
  (`functions/scorecard.js:140`). Both states are asserted by `test:endpoints`.
- BUSTERS: **`?v=20260725c`** — `assets/js/shared/plan-surface.js` (all **10** referencing pages
  restamped, none left on the old stamp) plus the two new files
  (`assets/js/app/scorecard-panel.js`, `assets/css/scorecard.css`). **`c`, not `a`/`b`**: the
  same UTC-boundary trap S14 and S15 each hit — work at 21:40 EDT is already 01:40 UTC the next
  day and `verify:busters` dates uncommitted files with `new Date().toISOString()`. `20260725a`
  was S14's `og-guides.png` and `20260725b` was S15's, hence `c`.
  - New surface got its own `assets/css/scorecard.css` rather than rules in `flightway-2.css`,
    which 13 pages link — one rule there is a 13-page restamp. Same reasoning that produced
    `opportunity-finder.css`, `feature-intro.css` and S15's `share.css`.
- GATES: baseline at session start **46/46 green in 73.6s**; session end **46/46 in 75.5s**.
  - **NEW: `test:scorecard`** (`scripts/test-scorecard.mjs`, pure lane, 0.5s, **151 checks**).
    It exists because this feature produces the most quotable number in the product out of the
    least trustworthy input. The three failures it asserts hardest are each silent and each worse
    than showing nothing: a score that is not reproducible (which would make the trend line, the
    whole feature, meaningless); an unearned "met"; and a fabricated posting URL. Also pins the
    scoring arithmetic on fixtures, the cap shape, the corpus cap and eviction order, and that
    the pipeline is read-only over the vector chain.
  - EXTENDED **`test:endpoints`**: the scorecard endpoint against **real SQLite** (the regex D1
    stub cannot answer this one) — a stored report is reachable only by the account that owns it,
    naming someone else's row is indistinguishable from naming one that does not exist, and a run
    refused before it starts never costs a free account its lifetime taste. The cross-account 404
    is paired with an assertion that the OWNER gets a 409 instead, so the 404 is proven to be
    about ownership rather than a shared failure mode masking it.
  - EXTENDED **`test:school`**: the scorecard prompt joins the school-block surface list — "could
    this student actually apply to this?" is a school question before it is a scoring one, and a
    posting they are ineligible for would drag the number down for a gap that does not exist.
  - EXTENDED **`plan:ui-check`** (`smoke-plan-ui.mjs`): 6 meters → 7, and the new one asserts the
    wording of the product's **only lifetime allowance** — "1 of 1 left" with no window word,
    because a "this week"/"this month" suffix would promise a second free run §4 never grants.
  - EXTENDED **`test:events`** / **`test:marco-voice`** / **`test:purge`**: three new registered
    names with EVENTS.md parity both ways; the `scorecard` persona golden is picked up
    automatically by the registry-driven golden loop; `scorecards` joins `USER_ID_TABLES`
    (`functions/account.js:74`) so a stored judgement about one named person's preparedness goes
    with the account.
  - EXTENDED **`verify:env`** (not a gate — needs network + auth): `SCORECARD_AUTO_DAILY_CAP` is
    reported beside `DEADLINE_REFRESH_DAILY_CAP` as a rider on the cron's
    `GROUNDING_ENABLED`+`GEMINI_API_KEY` pair, so the cost of flipping that flag is visible at
    the moment it is flipped rather than discovered in a bill.
- VERIFIED IN THE REAL RUNTIME (`npx wrangler pages dev` on port **8942**, a fresh port per the
  one-port-per-harness rule): `GET /scorecard` and `POST /scorecard {action:'run'}` both **401**
  signed-out; `/flightplan.html` **308**s to `/flightplan` (the pretty-URL redirect — `curl -L`
  or you are testing nothing) and the followed body carries both
  `scorecard-panel.js?v=20260725c` and `id="flightplan-scorecard"`. `.dev.vars` with a
  `SESSION_PEPPER` was written for the run and deleted after (the S14 trap: without it
  `_middleware.js` returns `unconfigured_environment` for every route, which is the guard
  working, not a failure).
- UI QA (headless Playwright against the working tree on port **8943**, a throwaway probe, not a
  committed gate — §5 S16 specifies `test:scorecard` only). This is the half no offline test can
  reach, and **it caught the one real defect this session fixed**: the panel rendered a bare
  **`63`** beside a band chip, with nothing on the surface establishing it as a percentage — it
  reads as a count of something (requirements? postings?). §5 S16's own wording is "**% ready**".
  Fixed at `scorecard-panel.js:165`, using the `N + '%'` inline idiom `career-target.js:82`,
  `roadmap.js:211` and `skill-gap-tracker.js:1578` all already use for a score. The rest of the
  probe: panel mounts, 3 requirement rows / 2 action cards / 2 postings render, the sparkline
  draws with "+22 since April 2026", every external posting link carries
  `rel="noopener noreferrer"`, the allowance line reads "1 of 1 left" **from `/config`**, and —
  the assertion that matters most for a shared `DOMContentLoaded` handler — `FWAppNav.sync` and
  `FWPageVeil.notifyRender` both still ran, proving a throw inside `FWScorecard.mount()` is not
  silently killing everything mounted after it. Zero page errors, zero console errors.
- DEFERRED (nothing silently dropped):
  - **No end-to-end run against live grounding.** Every path is proven on fixtures and against
    real SQLite, but no scorecard has been generated from an actual Gemini grounded search,
    because `GROUNDING_ENABLED` is off on both Pages projects. The first real run is the thing to
    watch: specifically the `downgraded` count in `scorecard_run`, which is the honesty metric.
  - **No scorecard UI gate.** The Playwright probe above was run and discarded rather than
    committed as `scorecard:ui-check`, because §5 S16 specifies `test:scorecard` and the S20
    sweep explicitly has a runtime budget concern for the gate suite. Worth reconsidering in S20:
    it is the only new V2 surface of this size with no committed browser gate.
  - **The Month in Review does not yet mention readiness.** §5 S16 asks for the trend to be
    persisted (done) but the plan's Month-in-Review section (S11) predates it. A "your readiness
    moved from X to Y this quarter" line is a natural S18/S20 addition; not in this scope.
- DRIFT (plan vs repo; repo wins):
  - **`GROUNDING_DAILY_CAP` does not exist.** §5 S16 and §8 both name it; the repo's actual
    shared budget is the pair `GROUNDING_USER_DAILY` (default 25/user/day) and
    `GROUNDING_GLOBAL_DAILY` (default 300/day), both read by `groundingConfig`
    (`functions/_lib/gemini-grounded.js:62`) and both checked by `budgetAllows` on every
    `researchWeb` call. The plan's REQUIREMENT is met exactly — the scorecard's three research
    calls share one budget with S9's radar and every other grounded surface — under names the
    plan got wrong. Nothing was renamed to match the plan.
  - **The score is not stored as a percentage of a fixed denominator.** §5 S16 says "% ready"
    and that is what is displayed, but the persisted `report` carries the full requirement list
    and the scalar columns beside it are denormalized copies, never a source of truth — nothing
    ever recomputes a score from the columns (`migrations/0024_scorecards.sql:8`). A report read
    back in six months renders exactly as it did the day it ran, even if the weights or the copy
    have changed since.
  - **"Actions convert to commitments/tracker entries" splits into two different mechanisms.**
    The three ACTIONS become dated roadmap steps via `applyCommitment` (S10's single
    implementation of what a commitment is); the POSTINGS become Application Tracker rows via the
    shared `FWApplications.save` (S12's path, which emits `application_saved` itself). The plan's
    sentence reads as one affordance; they are two, on two different objects, because an action
    is a thing to DO and a posting is a thing to APPLY TO.
  - **`scorecard-run` sits on the plan panel even though it is a lifetime taste**, unlike
    `mock-interview` which is excluded (`assets/js/shared/plan-surface.js:35`). Free is 1 rather
    than 0, so there is a real allowance to spend and "1 left" is information — not a 0-of-0 wall
    wearing a meter's clothes.
- JACOB ACTIONS RAISED:
  1. **Apply migration `0024_scorecards.sql` to the shared remote D1.** Until then the panel says
     "not switched on yet" out loud and no run is possible. By design; not an error.
  2. **(Optional) `SCORECARD_AUTO_DAILY_CAP` on `flightway-cron`** — accounts per night for the
     quarterly sweep, default 20. Only matters once grounding is on for the cron.
  3. **Note the cost coupling:** the cron's existing `GROUNDING_ENABLED` + `GEMINI_API_KEY` pair
     (already on the checklist for S9's nightly radar) now switches on a **second and more
     expensive** consumer. One scorecard is three live web calls plus a 2,200-token shaping call.
     `npm run verify:env` now prints both per-night caps whenever that flag is on.
  4. **No new Stripe, DNS or auth work.** Nothing in S16 touches the payment path.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13/S14/S15-hot), `docs/EVENTS.md` (same),
  `functions/account.js` (S1/S9/S12/S15-hot), `functions/_lib/plan-limits.js` (S8/S9-hot),
  `functions/_lib/marco-persona.js`, `assets/js/shared/plan-surface.js` (S8-hot, and the 10 pages
  that link it), `flightplan.html` (S7/S9/S10/S12/S15-hot), `workers/cron/index.js`
  (S9/S10/S11/S12-hot), `scripts/test-request-paths.mjs`, `scripts/smoke-plan-ui.mjs`,
  `scripts/test-school.mjs`, `scripts/verify-env.mjs`, `scripts/run-gates.mjs`, `package.json`.
- SESSION NOTE: the S16 implementation was found **already written and uncommitted** in the
  working tree at session start (~2,900 new lines, mtimes 21:23–21:44 the same evening), from a
  prior run that ended before it could commit. It was not taken on trust: the baseline `npm run
  gates` was run against it first (46/46), then every file was read, the pipeline traced end to
  end, the endpoint exercised in a real workerd runtime and the panel driven headless — which is
  where the missing `%` was found. Recorded here so a future session reading `git log` does not
  conclude this landed in one commit because it was written in one pass.

## S17 — Phase 5: Network mapper (2026-07-25, Jacob_Work@8bc0701..da45731)

Phase 5's second session, and the one that makes the least actionable line in the product
actionable. Before this, a `kind:'network'` roadmap step said "List 5 people to reach out
to" and named no person, no channel and no first sentence — the one step where the product
told a student to do something and then left them alone with the hard part.

- DONE:
  - **The design decision the whole feature follows from: this repo decides WHO, the model
    writes the SENTENCE.** `buildSuggestions` (`functions/_lib/contact-core.js:296`) is
    deterministic template rendering over seven archetypes; no model is involved and no
    allowance is spent. An archetype is a *category* ("a {school} alum now working as a
    {career}, two to four years in"), and a language model asked for categories fills them
    with specific invented people. The model's job is the one thing it is actually good at
    and this repo is not: writing a short message that sounds like a person. §4 meters
    exactly that half.
  - **The contract is enforced before a draft is ever shown, and every failure refunds**
    (`sanitizeOutreachDraft`, `contact-core.js:546`). Every other AI surface here writes
    something a student reads and can ignore. This one writes something they **send**, to a
    stranger, under their own name — so a defect is not a degraded experience, it is a
    contact they cannot get back. Four rules earn their place:
    1. **A greeting can never carry a name we do not have** (`enforceGreeting`, `:490`).
       "Hi Sarah," to someone not named Sarah proves the student did not write it, and it is
       the single most damaging thing this feature could produce. The first line's greeting
       is *rewritten* to the literal `[name]` placeholder rather than trusted — and the same
       repair runs in reverse when we DO have a name and the model addressed someone else.
    2. **No URLs, email addresses or phone numbers.** The model has never seen this person's
       inbox, so anything of that shape in the body was fabricated by definition.
    3. **No template sentence survives** (`dropTemplateSentences`, `:478`). 23 banned
       phrases, dropped a sentence at a time rather than rejecting the draft — this is the
       plan's "no cringe" made checkable.
    4. **It must cite the student's own record by id**, reusing S16's `buildEvidenceCorpus`
       rather than growing a second copy of "the student's citable record". Zero valid
       citations is `generic` and the draft is thrown away, not shown: a message any student
       could have sent is the one thing outreach cannot be.
    Plus an ask (no `?` → `no-ask`; a networking note with no question is a monologue) and
    a word floor/ceiling checked AFTER the repairs, so a draft that only cleared the floor
    on the strength of its filler is correctly judged too thin.
  - **It refuses before spending, twice**, in the `scorecard.js` ordering: no target career
    → `no-career`; nothing on record → `no-record` (`functions/outreach.js:271`), because
    with an empty corpus every sentence about the student would have to be invented and the
    contract would reject the result anyway. Charging a free account one of two monthly
    drafts to be told to add a resume would be indefensible.
  - **Every contract failure is a refund**, and `REFUNDABLE_DRAFT_REASONS`
    (`contact-core.js:83`) is the assertion that this stays true when a reason is added. The
    bias is deliberate: an allowance is cheap and a bad first message is not.
  - **`GET/POST /outreach`** — session-gated, IP rate-limited, §4-metered. Six actions
    (`add`/`draft`/`status`/`update`/`delete` + the read). **The route is `/outreach` and the
    surface is called the Network mapper**, which is the S11/S12 rule applied on purpose: a
    Function at `/network` would make a future `network.html` answer JSON instead of
    existing. The page name stays free; the endpoint takes the action name, which is also
    the vocabulary the events already use.
  - **The row a suggestion becomes is built server-side from the archetype KEY**
    (`suggestionForKey`, `contact-core.js:352`), never from the request body — the same
    authorization story as S16's commit path. A stale key is refused rather than turned into
    a row with a hole in its sentence. A MANUAL row is the opposite case and is treated as
    such: the student's own text, sanitized as untrusted, stored with no archetype so it
    suppresses no card.
  - **Migration 0025 — `contacts`.** `status_at` is NULL at creation and moves ONLY on a real
    status change, exactly as `applications.status_at` does (0022), because `updated_at`
    moves on a notes edit and the stale-draft nudge reads the former. There is **no send
    column and no provider id**: FlightWay never sends any of this, and the schema says so
    rather than leaving room for it. `contacts` also joins `USER_ID_TABLES`
    (`functions/account.js:80`) — it is the only table in the schema holding personal data
    about **third parties** who never signed up for FlightWay, so it cannot outlive the
    account it hangs off.
  - **`openNetworkSteps` uses two selectors, and the second is load-bearing**
    (`contact-core.js:156`). §5 S17 says "`kind:'network'` steps" and steps do carry a
    `kind` — but `backfillWaypointSteps` generates a network waypoint's three steps with
    **no kind at all**, so the literal reading finds nothing for exactly the students with
    the most obvious networking work in front of them. A step under a waypoint whose
    `actionType` is 'network' counts too.
  - **The digest nudges stale drafts without ever being the reason to send one.**
    `staleDraftsByUser` is one grouped query per cron run (`contact-store.js:238` — the
    `capHitsByUser`/`countMovedByUser` shape), the line renders in both MIME parts above the
    applications line (it *asks* for something where that one only reports), and it gets a
    `digestMarcoLine` branch below overdue commitments and closing deadlines. It is
    deliberately **not** part of `hasContent`, and the reason is sharper than S12's: a stale
    draft is ONE item with no dismiss button, so an email whose entire substance was "send
    that message" would arrive every Monday until the student sent it or unsubscribed.
    Nudging inside a digest they were already getting is a nudge; generating the digest in
    order to nudge is a nag.
  - **Client panel** (`assets/js/app/network-panel.js`, `assets/css/network.css`) on
    `flightplan.html` `#network` + a door. Suggestion cards with how-to-find, the list with a
    per-row status `<select>` built from the server's own ladder, the draft in a wrapping
    `<pre>` with copy/rewrite, second-click Remove. **The standing promise renders next to
    the drafts, not in a footnote** — §5 S17 requires the expectation in UI copy, and a
    product that writes a message is one a student can reasonably assume sends it.
  - Instrumentation: `outreach_draft` (**server** — the only one of the three FlightWay
    actually observes), `outreach_sent` / `outreach_replied` (client; they are the student's
    own report of what happened in their own inbox). `docs/EVENTS.md` has the section,
    including why `repairs` is this feature's honesty metric the way `downgraded` is S16's,
    and why there is deliberately **no** `outreach_met` (a stronger outcome on the same
    funnel, not a second funnel) and no `outreach_added`.
- MIGRATIONS: **`0025_contacts.sql`** — `contacts` + two indexes. Next free number at
  execution time, as §3 rule 13 requires. **NOT applied to the shared remote D1 (Jacob
  action).** Until it is, `GET /outreach` answers `ready:false`, the panel says "The network
  mapper is not switched on yet." in a sentence, and every write — including the draft,
  before the meter is touched — is refused the same readable way. All four states are
  asserted by `test:endpoints`.
- BUSTERS: **`?v=20260725d`** — `assets/js/shared/plan-surface.js` (all **10** referencing
  pages restamped, none left behind) plus the two new files
  (`assets/js/app/network-panel.js`, `assets/css/network.css`). **`d`, not `a`/`b`/`c`**:
  `a` was S14's, `b` S15's and `c` S16's, all on the same UTC day — work at 22:40 EDT is
  already 02:40 UTC the next day and `verify:busters` dates uncommitted files from
  `new Date().toISOString()`.
  - The new surface got its own `assets/css/network.css` rather than rules in
    `flightway-2.css`, which 13 pages link — one rule there is a 13-page restamp. Same
    reasoning that produced `opportunity-finder.css`, `share.css` and `scorecard.css`.
- GATES: baseline at session start **46/46 green in 76.8s**; session end **47/47**.
  - **NEW: `test:outreach`** (`scripts/test-outreach.mjs`, pure lane, **177 checks**). It
    exists because this is the only surface in the product whose output the student
    *transmits*. The four failures it asserts hardest are each silent and each
    unrecoverable: an invented recipient name, a fabricated link, a template, and a draft
    with nothing real in it. Also pins archetype determinism (the cards are re-offered every
    visit; a list that reshuffled would make the student re-read all six instead of working
    down them), that the suggestion path cannot be driven from the request body, the §4 cap
    shape, and the `status_at`-not-`updated_at` staleness rule.
  - EXTENDED **`test:endpoints`** with **48 assertions** against **real SQLite** loaded from
    0025 — the regex D1 stub cannot tell `WHERE id = ?` from `WHERE id = ? AND user_id = ?`,
    and this table names third parties, which makes a cross-account read the worst possible
    defect in it. Covers 401 on all three verbs, hostile input stripped from a stored name,
    the ladder including a no-op and a backwards move, **`status_at` untouched by a notes
    edit**, cross-user denial on all four write actions with A's row read back intact
    afterwards, the stale sweep finding exactly one row and losing it when the student marks
    it sent, and the 0025-pending refusals never costing an allowance.
  - EXTENDED **`test:school`** (the outreach prompt joins the school-block surface list —
    five of the seven archetypes name the student's own school in their label, so a draft
    pointing them at another university's trading team is advice they cannot act on),
    **`test:cron`** + **`test:emails`** (the nudge in both MIME parts, its position above the
    retrospective line, the UTM-before-fragment rule, and the zero case rendering nothing),
    **`test:events`** + **`docs/EVENTS.md`** (three names, parity both ways),
    **`test:purge`** (`contacts` in `USER_ID_TABLES`), **`test:marco-voice`** (the `outreach`
    persona golden is picked up automatically by the registry-driven loop),
    **`plan:ui-check`** (7 meters → 8, and the new one is the first row whose free allowance
    is more than one, so it is the only place the plural label — "2 of 2 left this month" —
    is exercised end to end).
- VERIFIED IN THE REAL RUNTIME (`npx wrangler pages dev` on port **8944**, a fresh port per
  the one-port-per-harness rule): `GET /outreach` and `POST /outreach {action:'draft'}` both
  **401** signed-out; `/flightplan.html` **308**s to `/flightplan` (the pretty-URL redirect —
  `curl -L` or you are testing nothing) and the followed body carries
  `network-panel.js?v=20260725d`, `network.css?v=20260725d`, `id="flightplan-network"`,
  `id="network"` and the `FWNetwork.mount()` call. A `.dev.vars` with a `SESSION_PEPPER` was
  written for the run and deleted after (the S14 trap: without it `_middleware.js` returns
  `unconfigured_environment` for every route, which is the guard working, not a failure).
- UI QA (headless Playwright against the working tree on port **8945**, a throwaway probe,
  not a committed gate — §5 S17 specifies the prompt-contract test only): **25/25**. The
  panel mounts and marks itself mounted; the standing promise renders **on the list**; the
  roadmap step is named as the reason the section exists; the suggestion card renders with
  its how-to-find; a drafted message renders with its subject and **its paragraph breaks
  intact**; a label of `<img src=x onerror=…>` and a name of `Priya <b>Raman</b>` both render
  as TEXT with zero injected nodes and nothing executed; every row's `<select>` carries all
  five rungs and reflects its own row; the allowance line reads "1 of 2 left this month"
  **from `/config`**; changing the select posts `action:'status'` and the draft button posts
  `action:'draft'`; an empty manual add is refused with a sentence; no horizontal scroll at
  1280 or 375; zero page errors, zero console errors. And — the assertion that matters most
  on a shared `DOMContentLoaded` handler — `FWAppNav.sync` and `FWPageVeil.notifyRender` both
  still ran, proving a throw inside `FWNetwork.mount()` is not silently killing everything
  mounted after it.
  - **The probe's first run reported two failures that were the probe, not the product**, and
    both are worth writing down. (1) `featureIntros` values are OBJECTS (`{seen:true}`), not
    truthy scalars — `feature-intro.js` reads `stateFor(key).seen`, so seeding `1` left every
    intro modal open and its backdrop swallowed every click. That is the *fourth* consecutive
    session where a harness bug looked exactly like a product bug, and it is a refinement of
    S12's own note: knowing the key lives at `journey.featureIntros` is not enough, the VALUE
    shape matters too. (2) `.nw-draft-key` is `text-transform: uppercase`, so `innerText`
    reports `SUBJECT` and a case-sensitive assertion fails on a correct panel.
- DEFERRED (nothing silently dropped):
  - **No end-to-end draft against live Gemini.** Every contract rule is proven on fixtures
    and the endpoint is exercised against real SQLite, but no message has been generated by
    an actual model, because no `GEMINI_API_KEY` is set locally. The first real draft is the
    thing to watch, specifically the `repairs` count in `outreach_draft`: it is the honesty
    metric, and unlike a wrong answer it is invisible to the student by design.
  - **Marking a contact 'sent' does NOT check off the linked network step.** `step_id` is
    recorded on every row so the wiring is possible, and it is the obvious next move — but a
    step going `done` changes `node.done`, which feeds the gap-progress chain, which is a
    §3.8 fragile subsystem needing a full causal trace and a `test:vectors` pass. That is its
    own slice, not a rider on this one.
  - **No `network:ui-check` gate.** The Playwright probe above was run and discarded rather
    than committed, matching the S16 decision and for the same reason: §5 S17 specifies the
    prompt-contract test, and the S20 sweep has an explicit runtime budget concern. This is
    now the *second* new V2 surface of this size with no committed browser gate — worth
    reconsidering in S20 as a pair with `scorecard:ui-check`, not separately.
  - **The Month in Review says nothing about outreach.** Same shape as S16's deferred item:
    S11 built that email before either feature existed. "You sent four messages and heard
    back from one" is a natural S18/S20 addition; not in this scope.
- DRIFT (plan vs repo; repo wins):
  - **§5 S17's `contacts` column list is a subset of what shipped.** The plan names
    `user_id, label/role-archetype, org_type, name, status, notes, ts`. Shipped adds
    `archetype` as a separate machine key beside the rendered `label` (the key dedupes a
    suggestion the student already has; regenerating the label from the key later would
    silently rewrite a row if their school or target career changed since), `how_to_find`,
    `channel`, `draft_subject`/`draft_body`, `career_slug`, `step_id`, and the
    `created_at`/`updated_at`/`status_at` trio instead of one `ts`. Every addition is load-
    bearing for something the plan asks for in the same sentence — the plan asks for a
    persisted drafted message and does not give it a column.
  - **Archetype suggestions are NOT AI-generated.** §5 S17 says "Generator: from network
    steps + school + career → suggested contact archetypes", and gives two examples that are
    literally templates. Shipped as deterministic template rendering with no model call and
    no meter, for the reason in the DONE section. The plan's requirement is met exactly; the
    implicit assumption that it needed a model is what changed. The consequence is a good
    one: the WHO half is free on every plan and reproducible forever.
  - **The route is `/outreach`, not `/network`.** The plan names no route. Chosen per the
    S11/S12 shadowing rule so a future `network.html` can exist; recorded because the
    surface's NAME is the Network mapper and the mismatch is deliberate.
  - **`outreach_draft` is server-written; the plan's event list implies neither.** §6 lists
    all three under the client taxonomy. Only the draft is something FlightWay does, so only
    it can be observed rather than reported — and it is the one carrying the cost signal.
  - **There is no fourth event for 'met'.** The status ladder has five rungs and the plan
    names three events; `met` rides `outreach_replied` with a `status` prop rather than
    splitting the one conversion this feature is judged on.
- JACOB ACTIONS RAISED:
  1. **Apply migration `0025_contacts.sql` to the shared remote D1.** Until then the panel
     says "The network mapper is not switched on yet." out loud, every write is refused with
     a readable sentence, and the draft is refused *before* the meter is touched. By design;
     not an error. The working invocation (`--env production` is REQUIRED, per S1):
     `npx wrangler d1 migrations apply flightway-db --remote --env production`
  2. **`npm run deploy:cron` — the stale-draft nudge is a cron change.** No git push deploys
     the standalone Worker. Without it the Monday digest keeps sending exactly what it sends
     today and the nudge never goes out. This joins the same already-listed deploy:cron item
     from S9–S12/S16; one run still covers everything.
  3. **No new env var, no Stripe work, no DNS.** The feature needs `GEMINI_API_KEY` (already
     set on both Pages projects) and nothing else — it does **not** need `GROUNDING_ENABLED`,
     because it makes no web calls. Worth stating plainly given S9/S16: this is the first
     Phase 5 feature that adds no grounding cost at all.
  4. **Nothing touches the payment or auth path.**
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13/S14/S15/S16-hot), `docs/EVENTS.md` (same),
  `functions/account.js` (S1/S9/S12/S15/S16-hot), `functions/_lib/plan-limits.js`
  (S8/S9/S16-hot), `functions/_lib/marco-persona.js` (S16-hot),
  `assets/js/shared/plan-surface.js` (S8/S16-hot, and the 10 pages that link it),
  `flightplan.html` (S7/S9/S10/S12/S15/S16-hot), `workers/cron/index.js`
  (S9/S10/S11/S12/S16-hot), `functions/_lib/digest.js` (S11/S12-hot),
  `functions/_lib/emails.js` (S4/S11/S12-hot), `scripts/test-request-paths.mjs`,
  `scripts/smoke-plan-ui.mjs`, `scripts/test-school.mjs`, `scripts/test-cron.mjs`,
  `scripts/test-emails.mjs`, `scripts/run-gates.mjs`, `package.json`.

## S18 — Phase 5: Interview Season Mode + the Semester Loop (2026-07-25, Jacob_Work@15cec16..9b770b6)

Phase 5's last session, and the one where two features that look unrelated turn
out to answer the same question from opposite ends: *when*. Everything the
product had built until now knew what to do and had no idea when the student
would have time to do it.

- DONE:
  - **The `mock_scores` table §5 S18 asks for does not exist, and should not.**
    The plan says "persisted rubric scores per session (migration: `mock_scores`
    **if not already persisted**)". They already are: `0012_interview_sessions.sql`
    created the table and `functions/mock-interview.js` has been writing a 6-axis
    `scores_json` to it since the mock-interview ship. What the season actually
    needed was the LINK — two columns (`season_id`, `season_week`) on the table
    that already holds the score. A second copy of a rubric score is a second
    thing to disagree with the first. `test:season` asserts 0026 creates no such
    table (`scripts/test-season.mjs:414`).
  - **The design decision the season follows from: the repo decides the ARC, the
    web only fills in the round names.** S17's call, made again for the same
    reason. `buildProgram` (`functions/_lib/season-core.js:210`) is deterministic
    template rendering over the career family's playbook — asked to invent six
    weeks of interview prep, a model produces six plausible weeks that differ
    every time it is asked, and a program whose week 3 changes between two page
    loads is not a program. Grounding supplies exactly one thing the playbook
    cannot know: the role's real-world round list. `formatSource` says which one
    the student is reading, and with `GROUNDING_ENABLED` off on both projects the
    honest expectation is `playbook` on every row.
  - **The six weeks are an argument, not a schedule.** Cold baseline → stories →
    the technical core → pressure (the *other* persona, because composure is the
    axis comfortable practice never touches) → the specific firm → the full loop,
    cold again, against week 1 (`season-core.js:60`). Each week draws its focus
    areas from a different slice of the family playbook, so a healthcare week 3
    and a software week 3 are genuinely different weeks.
  - **`test:season` caught a real defect in that rotation before it shipped.**
    Consulting's `behavioralFocus` and `evaluationEmphasis` each have exactly
    three entries, and a three-item slice of a three-item list is the whole list —
    so weeks 2 and 4 printed the same three lines and read as a copy-paste. Fixed
    at `season-core.js:135` with two rules: the offset steps per DRAW (not per
    week — two weeks drawing the same list can be an even distance apart, and the
    offset then lands on the same window), and the slice is one shorter than a
    short list. Asserted across all nine families, not just the one that failed.
  - **`GET/POST /interview-season`** — session-gated, IP rate-limited, premium
    per §4, and **locked-VISIBLE for free in a way that is worth the words**: the
    server builds the arc for the student's own career family either way and
    truncates weeks 2–6 *before serialization* (`previewProgram`,
    `functions/interview-season.js:172`). `lockedWeeks` counts things genuinely
    absent from the payload — §5 S8's lock-tail contract — so a free student sees
    their real six-week arc with five weeks' detail missing, not a stock
    description of somebody else's program. A season started on premium keeps
    running if the plan lapses; the meter §4 actually names is on the mock
    interviews, and it is still there doing its job.
  - **The week a session belongs to is stamped by the SERVER** (`seasonStampFor`,
    `functions/_lib/season-store.js:196`), from the season row and the clock. The
    request body carries nothing about it. A session run three weeks after the
    program ended gets NO stamp rather than "week 9 of a six-week program" —
    inventing a number there would put a point on the trend the program never
    scheduled.
  - **`/semester`: the term is one fact with two homes and one writer each.**
    `school.js`'s rule, generalized by `user-sync.js`, applied again. The `terms`
    D1 row is the record of the RITUAL; `identity.termSystem`/`termStart`/`termEnd`
    on the user object are the readable mirror, written by the ritual through
    `setUserField` and learned from conversation through `syncUserFromDossier`.
    `resolveTerm` (`functions/_lib/term-store.js:126`) is the single reader and
    prefers the row — so a student who only ever told Marco "my quarter ends
    March 20" still gets a term-aware digest without being made to fill in a
    wizard first.
  - **The +1 roadmap regeneration is an entitlement, and both halves of that are
    load-bearing.** The guard is `terms.regen_granted_at`, written in the same
    conditional UPDATE that checks it (`claimTermRegen`, `term-store.js:281`) —
    a D1 column rather than a flag in the client-writable user blob, because a
    student who could edit it could grant themselves an unlimited supply. And the
    grant itself is a new `grantFeatureBonus` (`functions/_lib/plan-limits.js:290`),
    **not** `refundFeatureUse`: a refund returns early when `used <= 0`, so at the
    end of a term — when most students have not spent the month's generation —
    it would do nothing at all while reporting success. A bonus is its own
    unwindowed counter that `checkFeatureLimit` adds to the limit and consumes
    only once the ordinary allowance is gone, so it survives the month boundary
    and is spent exactly once.
  - **Nothing the ritual seeds ever lands in the past.** A student can run this in
    week 12 of 15, and `seedSchedule` (`functions/_lib/term-core.js:213`) clamps
    both ends: nothing before today+3 (a promise due yesterday is not a promise),
    nothing past the last day. Outcomes are spread across the term rather than
    stacked at the end, because the whole argument for a start-of-term ritual is
    that a student who dates everything for finals week has not planned anything.
  - **The seeding takes `scorecard.js`'s exact shape** (§3.8 — the roadmap doc is
    a fragile save/merge path): build the steps into an in-memory tree, apply
    every date through `applyCommitment` (S10's single implementation of what a
    commitment IS), then ONE `saveRoadmap`. `normalizeSteps` silently slices past
    `MAX_STEPS_PER_NODE`, so the seeding stops at the ceiling and REPORTS what did
    not fit. Nothing touches objectiveVector, objectiveAiPatch or the
    gap-progress-sync chain, so no re-sync is owed — and `test:weekly` proves the
    composition from the other end: seeded outcomes are picked up by
    `selectWeeklyTasks`, which is what makes the ritual feed the loop rather than
    write to a place nothing reads.
  - **"What moved" has one implementation.** The end-of-term review is
    `month-review.js` run over the term's window: `composeMonthReview` gained an
    optional `bounds` override and `gatherMonthReview` is now a thin wrapper over
    a new `gatherReviewForBounds` (`functions/_lib/month-review.js:398`). A second
    definition of what moved would be a second set of numbers to disagree with the
    first.
  - **The digest is term-aware without ever being sent because of it.** `termLine`
    ("Week 6 of 15 · Fall 2026") renders above the streak line in both MIME parts,
    because it FRAMES the three tasks rather than joining them. Like
    `applicationsMoved` and `staleDrafts` it does not count toward `hasContent`.
    Marco gets one term branch, and it fires ONLY in the closing fortnight —
    below every urgency somebody actually set, and above every "how it went"
    branch, because the end of a term is a deadline nobody sent them. A countdown
    that runs for four months is a nag.
  - **`runTermRituals`** (`workers/cron/index.js:613`) — a daily step, because a
    quarter ending on a Thursday is a Thursday email or a stale one. It resolves
    recipients the other way round from every other step here: ask D1 which TERMS
    are at a boundary, then intersect with the opt-in lists. Two mails on two
    categories on purpose — `review` for the retrospective (alongside Month in
    Review) and `product` for the setup prompt, because a student who
    unsubscribed from retrospectives did not ask to stop being offered features.
    Both bounded on BOTH sides, so a term that ended eight months ago is never
    mailed about; exactly-once is `email_log` on a TERM-suffixed type, so the next
    term still gets its own pair.
  - **Client:** `assets/js/app/season-panel.js` (`#season`), `assets/js/app/term-panel.js`
    (`#semester`), one shared `assets/css/season.css`, two new doors, two
    `FWFeatureIntro` entries fired at the moment of entry (a panel's moment of
    entry is the first press of its button, not the page load that included it).
  - Instrumentation: `season_started` and `mock_completed` (**server** — the
    overall score is a weighted composite computed in `sanitizeDebrief` and never
    returned by the model, so a client event would either re-derive a number it
    does not own or log the model's), `semester_setup` and `semester_review`
    (client). `docs/EVENTS.md` has the section, including why `formatSource` is
    this feature's honesty metric and why `semester_setup` carries both
    `outcomes` and `seeded` — they disagree exactly when the current waypoint is
    at its step ceiling, which is a real wall nothing else in the funnel shows.
- MIGRATIONS: **`0026_season_term.sql`** — `interview_seasons` (+ a partial UNIQUE
  index making "one active season" true rather than intended), `terms` (+ 2
  indexes), and the two `ALTER TABLE interview_sessions` columns. Next free number
  at execution time, as §3 rule 13 requires. **NOT applied to the shared remote D1
  (Jacob action).** Until it is, both panels say "not switched on yet" in a
  sentence, every write is refused the same readable way, no bonus can be handed
  out, and `seasonStampFor` answers null — which is what keeps the debrief's
  legacy INSERT correct, since the table and its two new columns ship in the same
  migration and one probe covers both. All asserted by `test:endpoints`.
- BUSTERS: **`?v=20260725e`** — `assets/js/shared/user.js` (13 pages),
  `assets/js/shared/plan-surface.js` (10), `assets/js/shared/feature-intro.js`
  (10), `assets/js/coach/interview-mode.js` (coach.html), plus the three new files
  (`season-panel.js`, `term-panel.js`, `season.css`) on flightplan.html.
  **`e`, not `d`**: `d` was S17's, on the same UTC day.
  - The two new surfaces share ONE `assets/css/season.css` rather than adding
    rules to `flightway-2.css`, which 13 pages link — one rule there is a 13-page
    restamp. Same reasoning that produced `opportunity-finder.css`, `share.css`,
    `scorecard.css` and `network.css`.
- GATES: baseline at session start **47/47 green in 75.6s**; session end **48/48**.
  - **NEW: `test:season`** (`scripts/test-season.mjs`, pure lane, **160 checks**).
    Four things it asserts hardest, each silent when it goes wrong: the program is
    byte-identical on a rebuild; "week 16 of 15" never happens (checked on every
    day of a real 11-week quarter); nothing is ever seeded into the past; and the
    bonus regeneration is granted once AND consumed once — a bonus never consumed
    hands out a free generation every month forever.
  - EXTENDED **`test:endpoints`** with a season/semester block against **real
    SQLite loaded from 0026**: the regex D1 stub cannot count changed rows, and
    `meta.changes` on a conditional UPDATE is the entire once-only guard. Covers
    401 on all four verbs, the free lock (six weeks visible, five truncated
    server-side), the premium start, the one-active UNIQUE index driven directly
    with a hand-written INSERT, `seasonStampFor` returning null outside the six
    weeks, every `validateTerm` refusal, the identity mirror, re-running the
    ritual rewriting rather than stacking, the grant firing once across two
    reviews, cross-account denial on `getTerm`/`claimTermRegen`, and the whole
    0026-pending set.
  - EXTENDED **`test:weekly`** (term-aware fixtures, which §5 S18 names this gate
    for): the ritual's seeded steps are picked up by `selectWeeklyTasks`, and —
    the one worth writing down — `node.semesterPlan` and the S18 term are
    DIFFERENT things that share a word. A waypoint's `semesterPlan` is a
    pre-existing per-waypoint phase sequence; neither may become the other's
    fallback.
  - EXTENDED **`test:cron`** (the two boundary mails, their categories, the
    both-sides window, once-per-TERM, and the digest term line sourced from the
    grouped query), **`test:emails`** (the term line in both MIME parts and its
    position above everything; both new templates, their unsub categories, the
    UTM-before-fragment rule, and that the review mail quotes NO counts — a
    figure the page then recomputes can be wrong by the time it is read),
    **`test:events`** + **`docs/EVENTS.md`** (four names, parity both ways),
    **`test:purge`** (`interview_seasons` + `terms` — the gate derives its table
    list from `migrations/`, so it extended itself), **`test:user`** /
    **`verify:user`** / **`test:sync`** (three KEY_MAP rows both sides, three
    registry FIELDS, three dossier lines).
- VERIFIED IN THE REAL RUNTIME (`npx wrangler pages dev` on port **8946**, a fresh
  port per the one-port-per-harness rule): `GET`/`POST /interview-season` and
  `GET`/`POST /semester` all **401** signed-out; **`/terms` still serves the legal
  page 200** (the reason the route is `/semester` and not `/term`); the followed
  `/flightplan.html` body carries `season-panel.js?v=20260725e`,
  `term-panel.js?v=20260725e`, `season.css?v=20260725e`, `id="flightplan-season"`,
  `id="flightplan-term"`, `id="season"`, `id="semester"` and both mount calls. A
  `.dev.vars` with a `SESSION_PEPPER` was written for the run and deleted after
  (the S14 trap: without it `_middleware.js` returns `unconfigured_environment`
  for every route, which is the guard working, not a failure).
- UI QA (headless Playwright against the working tree on port **8947**, a
  throwaway probe, not a committed gate — §5 S18 specifies the weekly/endpoint/
  mock-score tests): **44/44**, and it found the two real defects below.
  - **The week's deep link would not have opened the panel at all.** The first
    draft linked to `coach.html#practice&persona=pressure`, and
    `interview-mode.js` `openFromHash` matches `location.hash` **exactly** — so
    the link would have looked broken with nothing in the console to say why.
    Fixed by taking S12's own shape: `?ivPersona=…#practice`, read and then
    stripped alongside `ivRole`/`ivCompany`, with the persona card selected on
    open (`interview-mode.js:722`). Pinned from both ends in `test:season`,
    because the two files have to agree and neither can see the other.
  - **The term card never showed the name the student gave their term.** The
    label reached the digest and both emails and not the card it was typed into,
    so a student would read "Fall 2026 in review" in their inbox and find nothing
    called Fall 2026 in the product. Fixed at `term-panel.js:262`.
  - The rest: both panels mount and mark themselves mounted; the locked season
    renders six weeks with five locked shells and the shared lock tail reading
    the server's own count; the trend sparkline draws and states "+0.8 overall";
    a week run twice reports its BEST score and says so; the weeks behave as an
    accordion; a term label of `<img src=x onerror=…>` and an outcome of `<b>`
    both render as TEXT with zero injected nodes; an empty date is refused
    client-side without a POST and the typed outcomes survive the error; no
    horizontal scroll at 1280 or 375; and — the assertion that matters most on a
    shared `DOMContentLoaded` handler — `FWAppNav.sync` and
    `FWPageVeil.notifyRender` both still ran, proving a throw inside either
    `mount()` is not silently killing everything after it.
  - **The probe's first two runs failed on the harness, not the product**, and it
    is the same trap for the third consecutive session in a third new form.
    S17 recorded that `featureIntros` values are OBJECTS; this time the shape was
    right and the KEY SET was not — `flightplan.html` declares
    `data-fw-intro="flightplan"`, and one unseeded manifest key leaves a modal
    whose backdrop swallows every click, which looks exactly like a dead panel.
    Seeding through the legacy `fw_hub_quiz_v1` blob with `_seeded: true` and
    every key present is the shape that works (`smoke-plan-ui.mjs` already did
    it). Third variant, same lesson: when a panel probe "cannot click", check for
    an open interstitial before reading a line of product code.
- DEFERRED (nothing silently dropped):
  - **No end-to-end season start against live grounding.** The round list is the
    one grounded half and `GROUNDING_ENABLED` is off on both Pages projects, so
    every season built today is `formatSource: 'playbook'` — which is a complete
    program, not a degraded one. The first real run is the thing to watch, and
    the metric is the `formatSource` split in `season_started`.
  - **Marking a season week done does not check off anything on the roadmap.**
    The session is scored and stamped, but nothing links a completed week to a
    roadmap step. Same shape as S17's deferred `step_id` item and deferred for
    the same reason: a step going `done` changes `node.done`, which feeds the
    gap-progress chain, which is a §3.8 fragile subsystem needing its own slice.
  - **`node.semesterPlan` was NOT unified with the term.** The roadmap's
    per-waypoint "semester plan" predates this session and sequences steps inside
    one waypoint; the S18 term is the student's calendar. Making the first read
    the second is a real improvement and a roadmap-generation change, not a rider
    on this one. `test:weekly` pins them apart so a future session cannot merge
    them by accident.
  - **The Month in Review still says nothing about seasons or terms.** Third
    session running (S16 and S17 logged the same for their features). S11 built
    that email before any of them existed, and it is now three lines behind. Worth
    doing as one job in S20 rather than a fourth deferred item.
  - **No `season:ui-check` gate.** The probe above was run and discarded, matching
    S16 and S17. That makes **three** new V2 surfaces of this size with no
    committed browser gate — and the S18 probe found two real defects, which is
    the strongest argument yet for reconsidering all three together in S20 rather
    than separately.
- DRIFT (plan vs repo; repo wins):
  - **No `mock_scores` migration.** §5 S18's own "if not already persisted" is the
    condition, and it is already met. See DONE.
  - **The trend chart is on the season card, not "the locker/progress surface".**
    §5 S18 names the locker; the trend is a property of the PROGRAM (six weeks
    against their own baseline), and putting it under the Evidence Locker would
    separate the number from the thing that produced it. The Flight Plan is the
    progress surface and the card lives on it.
  - **`mock_completed` is server-written; §6 lists it under the client taxonomy.**
    The composite score is computed server-side and never returned by the model.
    Same call S17 made for `outreach_draft`, for the same reason.
  - **The route is `/semester`, not `/term`.** The plan names no route. Chosen for
    S17's shadowing rule and because `/term` sits one keystroke from the `/terms`
    legal page, which is a real file — a mistyped link there is confusing in a way
    a 404 is not.
  - **"Seeds commitments + roadmap focus + locker goals" shipped as commitments
    only.** Commitments are real and are S10's single implementation. "Roadmap
    focus" would mean writing the multi-track focus state, which is §3.8 fragile
    and would make the ritual able to re-point a student's whole tree. "Locker
    goals" is a concept the Evidence Locker does not have (S12 built it read-only
    over vectors), and inventing one here would be a new subsystem inside another
    session's scope. The term's deliverable is carried as the term's own goal on
    the card instead.
  - **`grantFeatureBonus` is a new concept in `plan-limits.js`.** §4's roadmap row
    already promised it ("the semester loop grants +1 at term end") and there was
    no mechanism. It is deliberately opt-in per row (`bonusable`), so the extra KV
    read happens on exactly one feature and `/auth/me` still peeks at the other
    nine at the old cost. `publicFeatureLimits` does not expose the flag — a KV
    detail is not the client's business (§3 rule 11).
  - **The wall message now quotes `used`, not the cap.** Without a bonus the two
    are the same number; with one they differ, and by the time a student hits the
    wall the bonus is already consumed — so quoting the cap would tell someone who
    generated twice this month that they used their "1 free generation".
    `allowanceText` gained a matching branch: an over-allowance drops the
    denominator rather than rendering "2 of 1 left".
- JACOB ACTIONS RAISED:
  1. **Apply migration `0026_season_term.sql` to the shared remote D1.** Until
     then both panels say "not switched on yet" out loud, every write is refused
     with a readable sentence, and no bonus can be granted. By design; not an
     error. The working invocation (`--env production` is REQUIRED, per S1):
     `npx wrangler d1 migrations apply flightway-db --remote --env production`
  2. **`npm run deploy:cron` — the term-boundary emails are a cron change.** No
     git push deploys the standalone Worker, and `runTermRituals` is a new daily
     step. This joins the already-listed `deploy:cron` item from S9–S12/S16/S17;
     one run still covers everything.
  3. **No new env var, no Stripe work, no DNS, and no new grounding cost on the
     cron.** The season's one grounded call happens on a Pages Function when a
     student starts a season, is cached per career slug for a month, and degrades
     to the playbook when `GROUNDING_ENABLED` is off. The cron gained no grounded
     consumer.
  4. **Nothing touches the payment or auth path.** The one entitlement change is
     additive and guarded by a D1 column.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13/S14/S15/S16/S17-hot),
  `docs/EVENTS.md` (same), `functions/account.js` (S1/S9/S12/S15/S16/S17-hot),
  `functions/_lib/plan-limits.js` (S8/S9/S16/S17-hot), `functions/_lib/user-model.js`
  + `assets/js/shared/user.js` + `functions/_lib/user-sync.js` +
  `functions/_lib/dossier-parse.js` + `functions/_lib.js` (the KEY_MAP/registry set),
  `assets/js/shared/plan-surface.js` (S8/S16/S17-hot, and the 10 pages that link it),
  `assets/js/shared/feature-intro.js` (and the 10 pages that link it),
  `flightplan.html` (S7/S9/S10/S12/S15/S16/S17-hot), `workers/cron/index.js`
  (S9/S10/S11/S12/S16/S17-hot), `functions/_lib/digest.js` (S11/S12/S17-hot),
  `functions/_lib/emails.js` (S4/S11/S12-hot), `functions/_lib/email-template.js`
  (S4/S11-hot), `functions/_lib/month-review.js` (S11/S12-hot),
  `functions/mock-interview.js`, `scripts/test-request-paths.mjs`,
  `scripts/test-cron.mjs`, `scripts/test-emails.mjs`, `scripts/test-weekly-plan.mjs`,
  `scripts/run-gates.mjs`, `package.json`.
## S19 — Phase 6: Business surface (2026-07-25, Jacob_Work@0cefacf..1ea1aeb)

Phase 6's first session, and the one where the product has to say out loud what
it has spent eighteen sessions becoming. Almost nothing here is a new capability:
it is the landing page, the pricing page and two new doors finally describing the
weekly loop that S7–S18 built, plus the one mechanism that replaces invented
proof with real proof.

- DONE:
  - **The landing rewrite is a reordering, not a redecoration.** `index.html`'s
    old first act was "take a quiz, see 750+ careers, get a roadmap" — the
    discovery pitch V2 §0 exists to flip. `#how-it-works` keeps its id (it is
    linked from the nav and footer of every page on the site, and from both new
    pages) and now describes **the week**: Monday, three named things; all week,
    it chases; every month, the proof. The explainability act moved to its own
    `#explain` section rather than being deleted — it is the wedge, and the
    label-and-stop tools structurally cannot do it — and the comparison gained a
    third column for job boards and LinkedIn, whose specific failure is that they
    assume you already know what to apply for.
  - **The landing FAQ's JSON-LD is generated FROM the visible copy**, not typed
    beside it. Google requires the marked-up text to be the text a reader sees,
    and two hand-maintained copies of nine question-and-answer pairs drift on the
    first edit. The block in `<head>` was produced by parsing the nine
    `.fw-faq-item` elements, so the two are byte-identical by construction as of
    this commit. Two new questions lead it: what you actually get each week, and
    whether you need to know what you want first.
  - **Pricing is re-led by moments** (`pricing.html`, D16). The $29 Interview
    Sprint and the $199 Founding 100 are the first thing on the page, side by
    side, each with the moment it is FOR stated above the price — "for the next
    three weeks", "for the whole degree". The subscription and the free tier sit
    beneath under "Or keep it running". Nothing about the SKUs changed: same four
    `data-tier` values, same checkout, same fake-door fallback where Stripe is
    unconfigured.
  - **The feature matrix is 17 rows and quotes 11 enforced caps.** Every number
    in it is a `data-fw-limit` slot, so `plan:ui-check` compares it against
    `FEATURE_LIMITS` directly and `/config` overwrites it at runtime — the page
    physically cannot sell a cap the server does not enforce (§3 rule 11). It
    scrolls inside its own box below 520px; the page body never scrolls sideways.
  - **The two Jacob-gated proposals ship design-complete and dark, and they are
    NOT Stripe SKUs.** `semesterPassEnabled` and `giftEnabled` are plain env
    booleans on `/config`, and the cards' CTAs use a separate `.fw-proposal-cta`
    class that goes to interest capture and never consults `billingReady`. §5 S19
    says "build only the PAGE affordances now, wire Stripe only after Jacob
    approves + creates products", and D16 says no silent price changes — deriving
    the flag from a price id the way `stripeEnabled` does would have made both
    buyable the moment an env var appeared, which is the opposite of Jacob-gated.
    The checkout-resume path now reads a separate `BUYABLE` map rather than the
    label map, so a `?tier=semester` in the URL bar cannot reach
    `FWBilling.checkout()` either. `test:nps` pins both halves.
  - **`/career-centers`** — the B2B door, and the first FlightWay page written
    for somebody who is not a student. Four claims, each narrow enough to be
    literally true today: cohort onboarding, counselor visibility (students
    arrive at an appointment with a written roadmap, so the hour is spent on
    judgement rather than intake), outcomes framing, and an explicit "it does not
    replace you". Pilot pricing is stated as negotiated per institution with no
    number, because there isn't one. The pilot form posts to the S2 contact
    endpoint with `topic: 'career-center'` — the D1 row is the record and the
    email is the notification, unchanged.
    - **It carries the Turnstile wiring, and that is not optional.**
      `functions/contact.js` REJECTS a missing token whenever both Turnstile keys
      are set, and those keys are an open item on Jacob's checklist. A pilot form
      that never rendered the challenge would work perfectly until the day he
      configured it and then refuse every submission with a message about a
      verification nobody saw.
  - **`/community`** — "FlightWay Commons", a waitlist for something that does
    not exist, and honesty is the entire design brief: the lede says there is no
    launch date, and a section says what it deliberately will not be (not a job
    board, not anonymous, not a replacement for a career center). It reuses
    `waitlist-intent.js` rather than growing a second table with the same three
    columns and the same IP-hash discipline.
    - **The seed counter renders nothing rather than "0".** `GET
      /waitlist-intent?tier=community` answers `count: null` — never `0` — when
      the count could not be read, and the page renders the number only when it
      is a real one, "Be the first." at zero, and *nothing at all* on null. A
      page that says "0 students" because D1 hiccuped tells a visitor the exact
      opposite of the truth.
    - **Only waitlist tiers have a public count.** `PRICING_TIERS` and
      `WAITLIST_TIERS` are separate exported lists: how many people clicked
      "Claim a founding seat" is a business number, and a `GET` for one is a 400.
  - **NPS + testimonials (D28) — three surfaces and one privacy invariant.**
    `FWNps.maybeAsk(moment)` is called at the three product moments §5 S19 names
    and **never on page load**: the eligibility read costs one indexed row, and
    paying for it on every render of four pages to ask a question once a month
    would be a bad trade. Score 9–10 opens the quote step.
    - **Consent redaction happens at WRITE time** (`redactConsent`,
      `functions/_lib/feedback-core.js:145`). An unticked box means the name is
      *not in the row*, not merely not rendered — so no later bug in the public
      read path can leak it, because there is nothing to leak. Both directions
      are pinned: a ticked box with nothing behind it also yields empty rather
      than a placeholder, because consent is a permission and never a promise
      that a value exists. `test:endpoints` asserts it on the stored ROW, against
      real SQLite, which is the only place the assertion means anything.
    - **The student is shown the exact attribution before consenting to it.**
      `POST /nps` returns the name and school we would print, read server-side.
      Reading somebody's own identity back to their own session is not a leak;
      printing it on the homepage without this step would be.
    - **A dismissal spends the 30-day cap.** The card is raised at three moments
      and a student can hit two in one sitting, so "closed it without answering"
      writes a real row (`status: 'dismissed'`, `score` NULL) — otherwise the
      survey nags exactly the people least interested in it. That makes `status`
      the response-rate denominator, and it is why every average over this table
      MUST filter on `status='scored'`.
    - **The cap is re-checked on the WRITE path**, not just advised by the GET.
      A client that skips the GET, or two tabs that both passed it, still writes
      one row. Pinned end to end.
    - **`nps: null` is not `nps: 0`.** A zero Net Promoter Score is a real and
      very bad number; a survey nobody has answered has no number, and printing
      0 for it on an admin dashboard is a fabricated result somebody would make a
      decision from. `npsSummary` returns null, and the console renders `—`.
    - **Nothing publishes without a human.** `POST /testimonials` creates
      `status: 'pending'` and there is no auto-approve path at any score. The
      admin queue's mutations all require **elevation**, like grants and
      broadcasts: approving a quote puts a named student's words on flightway.ai.
      Approval busts the public KV cache immediately, because a quote invisible
      for ten minutes after approval reads as a button that did not work.
    - **The public read filters status in SQL** and projects through
      `publicQuote`, which copies four named fields — so adding a column to
      `testimonials` cannot start serving it.
  - **The quote slot renders nothing until there is something real.** Both
    `#quotes` sections ship `hidden`; `quotes.js` reveals them only on a
    non-empty approved list. No skeleton, no placeholder, no "trusted by students
    everywhere" — inventing proof is the exact gap this feature replaces.
  - **`privacy.html` gained a row and a paragraph**, because a feature that
    publishes a student's name on a marketing page and does not appear in the
    privacy policy is a policy that is now wrong. The row states the
    tick-the-box-or-it-is-never-written rule in those words; the paragraph in §7
    is the only disclosure on that page that exists because the person asked for
    it, and it says how to pull a quote back.
  - Instrumentation: `nps_shown` (client — only the browser knows the card
    rendered), `nps_scored` and `testimonial_given` (**server**), `pilot_requested`
    and `waitlist_joined` (client). `docs/EVENTS.md` has the section, including
    why the gap between `nps_shown` and the responses is the number that says
    whether the card is being ignored rather than declined, and why there is no
    `testimonial_approved` event (it is an admin action and lives in
    `admin_audit_log`, where the actor is recorded with it).
  - **The live check found a real defect that every gate had passed: the sitemap
    is KV-cached, and its key did not depend on the static URL set.** Adding
    `/career-centers` and `/community` to `STATIC_URLS` moved neither
    `CAREER_PAGE_VERSION` nor `GUIDES_CONTENT_DATE`, so the deployed
    `/sitemap.xml` went on serving the previous build's body — 200, well-formed,
    and missing both new pages, for as long as the TTL had left. The documented
    purge hook was "bump `CAREER_PAGE_VERSION`", which would have thrown away
    ~780 cached career renders to publish two `<loc>` lines. Fixed with
    `staticSetTag()` (`functions/sitemap.xml.js:54`), a djb2 fingerprint of the
    non-career URL set folded into the key — **derived rather than declared**,
    because a bump-me constant is only correct while somebody remembers it and
    its failure mode is a 200 nobody reads. `seo:check` now pins both the key
    shape and the fact that the fingerprint comes from `STATIC_URLS`.
- MIGRATIONS: **`0027_feedback.sql`** — `nps_responses` (2 indexes) and
  `testimonials` (2 indexes). Next free number at execution time, as §3 rule 13
  requires. **NOT applied to the shared remote D1 (Jacob action).** Until it is,
  the card is never raised at all (`ready:false` → no render), every write is
  refused readably, and the public quote read returns an empty list — which is
  exactly what the marketing pages render for zero approved quotes anyway, so
  the two pending-migration paths are visually identical to the correct
  steady state. All asserted by `test:endpoints`.
- BUSTERS: **`?v=20260725f`** — `assets/js/app/portal-flightplan.js` (portal.html,
  flightplan.html), `assets/js/app/roadmap.js` (roadmap.html),
  `assets/js/app/month-review.js` (review.html),
  `assets/js/app/admin-console.js` (admin.html), plus the four new files
  (`nps.js` + `nps.css` on the four trigger pages, `quotes.js` + `quotes.css` on
  index and pricing). **`f`, not `e`**: `e` was S18's, on the same UTC day.
  - `nps.css` and `quotes.css` are their own files rather than rules in
    `flightway-2.css` / `flightway-theme.css`, which thirteen and eleven pages
    link respectively — one rule there is a thirteen-page restamp. Same reasoning
    that produced `opportunity-finder.css`, `share.css`, `scorecard.css`,
    `network.css` and `season.css`.
- GATES: baseline at session start **48/48 green in 74.6s**; session end
  **49/49**.
  - **NEW: `test:nps`** (`scripts/test-nps.mjs`, pure lane, **81 checks**). Four
    things it asserts hardest, each silent when it goes wrong: consent redaction
    in both directions (including that `consentName: 'yes'` is a truthy STRING
    and not consent); the 30-day cap, including that 29.9 days floors DOWN and
    that a corrupt timestamp fails CLOSED; that a blank score is refused rather
    than coerced (`Number('')` is 0, the angriest possible answer, from somebody
    who answered nothing); and that `nps: null` never renders as 0.
  - EXTENDED **`test:endpoints`** with an NPS/testimonial block against **real
    SQLite loaded from 0027** — the regex D1 stub cannot answer "what did that
    INSERT actually store", and the stored row is the entire consent question.
    Covers 401 on every write, the public GET needing no session, the write-path
    cap, the dismissal row, a client-supplied `displayName` being ignored in
    favour of the session identity, the queue 404ing to a non-admin (with 0016
    loaded, so the 404 is a real refusal and not a missing table answering the
    same way), approval reporting its changed-row count, the public projection
    carrying only the consented field, the waitlist counter, a pricing tier
    having NO public count, and the whole 0027-pending set.
  - EXTENDED **`verify:meta`** (both new pages classified `public`),
    **`functions/sitemap.xml.js`** (`STATIC_URLS` → 9, which `seo:check` derives
    its expected count from), **`layout:check`** (`career-centers` added to the
    matrix), **`test:events`** + **`docs/EVENTS.md`** (five names, parity both
    ways), **`test:purge`** (`nps_responses` + `testimonials` — the gate derives
    its table list from `migrations/`, so it extended itself),
    **`plan:ui-check`** (the 11 cap slots in the new matrix), and **`seo:check`**
    (161 assertions — two new ones pinning the sitemap cache key, see DONE).
- DEFERRED (nothing silently dropped):
  - **Gift FlightWay has no redemption path, and the card says so.** Gifting
    months to another person needs codes, a recipient flow and an entitlement
    grant to an account that may not exist yet — a subsystem, not a card. The
    affordance is interest capture and its fine print reads "Registers your
    interest. Nothing is charged and nothing is reserved."
  - **Semester Pass has no SKU either**, for the reason in DONE. Turning either
    proposal into something that CHARGES is a follow-up code change, not an env
    flip — see Jacob actions 2.
  - **No committed browser gate for the NPS card or the new landing.** Fourth
    session running (S16, S17, S18 logged the same). `plan:ui-check`,
    `layout:check`, `verify:meta` and `contrast:check` cover the frames and the
    numbers; nothing walks the card's two-step flow in a browser. Worth
    reconsidering all four together in S20 rather than a fifth deferred item.
  - **`.fw-sprint-card` in `flightway-2.css` is now dead** — `pricing.html` was
    its only consumer and the Sprint is a full card now. Deleting it is a
    thirteen-page restamp for zero user-visible change, so it belongs in S20's
    dead-code sweep, not here.
  - **The frequency cap is per USER, not per moment.** A student capped by a
    dismissal after checking off a task is also capped for their month review.
    Deliberate — the cap exists to stop nagging, and three independent 30-day
    clocks would ask up to three times a month.
  - **The Month in Review still says nothing about S16–S19 features.** Fourth
    session logging this. S11 built that email before any of them existed.
  - **No admin export of NPS comments.** The console shows the last 20; there is
    no CSV. Fine at this volume.
- DRIFT (plan vs repo; repo wins):
  - **`nps_scored` and `testimonial_given` are server-written; §6 lists both
    under the client taxonomy.** The D1 row is durable by the time the response
    returns, and the card's whole purpose is to be dismissed and navigated away
    from — a client beacon queued behind that navigation would leave the table
    and the funnel disagreeing about the same event. Same call `contact.js` made
    in S2 and S18 made for `mock_completed`.
  - **The proposals are env booleans, not Stripe-derived flags.** §7 item 9 reads
    as though flipping them on is an env action; making them CHARGE is not. See
    DONE and Jacob actions 2.
  - **`#how-it-works` now describes the week, not the onboarding.** The id is
    load-bearing (nav + footer of every page, plus both new pages), and the plan
    asks for a dev-first landing — so the section keeps the name and changes what
    it is about. The old "quiz → matches → roadmap" three-step became a closing
    `#start` card, which is also the closing CTA the page never had.
  - **`community` is not in the `layout:check` matrix; `career-centers` is.**
    The file's own documented rule (terms/security are omitted as structural
    duplicates of privacy): community's card grid and single input are a strict
    subset of career-centers' shapes, and walking it would cost 30 cells to
    re-prove the same stylesheet.
  - **No `career_centers_view` / `community_view` events.** `page_view` on those
    paths already measures it, and neither `pilot_` nor `waitlist_` opens a new
    `ALLOWED_PREFIXES` namespace — both names are registered explicitly. Same
    call `contact_submitted` made in S2: one event does not justify a namespace.
  - **`pricing.html`'s nav went from two links to four**, matching index.html and
    every server-rendered page. Four and not five for the S14 reason
    `layout:check` now pins: a fifth item pushes `#fw-nav-actions` past the right
    edge at 1280px @150% zoom.
  - **The pilot form posts to `/contact`, not to a new endpoint.** §5 S19 says
    "reuses contact/waitlist infra"; `topic: 'career-center'` was already in
    `CONTACT_TOPICS` from S2, and the composed body (institution, cohort size,
    free text) always clears the server's 10-character floor on its own, so an
    empty message field can never fail that check.
- JACOB ACTIONS RAISED:
  1. **Apply migration `0027_feedback.sql` to the shared remote D1.** Until then
     the NPS card is never raised, every write is refused readably, and the quote
     slot stays hidden — which is identical to its correct steady state before
     the first approval, so nothing looks broken. By design; not an error. The
     working invocation (`--env production` is REQUIRED, per S1):
     `npx wrangler d1 migrations apply flightway-db --remote --env production`
  2. **Decide the two product proposals (plan §7 item 9), and know what "yes"
     costs.** Setting `SEMESTER_PASS_ENABLED=true` / `GIFT_ENABLED=true` reveals
     a design-complete card whose button captures interest — that part is an env
     flip and nothing more. Making either one CHARGE needs, per proposal: a
     Stripe product + price (both modes — a test price for the prototype and a
     live one for production, since `priceIdFor()` picks by key mode), a `SKUS`
     entry in `functions/_lib/stripe.js`, a grant branch in
     `functions/stripe/webhook.js`, and — for Gift only — a redemption
     subsystem that does not exist. Semester Pass is the cheap one: it is
     `sprintGrant` with a different day count. **I did not write either**, because
     §5 S19 says to build the page affordance and wire Stripe only after your go,
     and D16 says no silent price changes.
  3. **Skim the two new pages before the final merge** (D27's rule, applied to
     marketing copy): `/career-centers` makes four claims about what a career
     centre gets and states pilot pricing as negotiated with no number;
     `/community` promises a forum with no date. Both are deliberately narrow —
     but they are the first pages on this site aimed at somebody who can write a
     purchase order, so they are yours to sign off.
  4. **Nothing publishes itself.** Once 0027 is applied, quotes accumulate as
     `pending` in the admin console and appear on the homepage and the pricing
     page only after you approve one there. The console needs elevation for it,
     like grants.
  5. **No new env var is required, no cron change, no DNS, no Stripe work, and
     the payment and auth paths are untouched.** The NPS card makes no Gemini
     calls and no grounded calls, so it adds no per-night cost.
- HOT FILES (Phase-0-merged files touched here — reconcile at the S20 final merge):
  `index.html` (S2/S14-hot — the landing rewrite is the largest single change to
  it in V2), `pricing.html` (S2/S8-hot), `privacy.html` (S2-hot),
  `functions/_lib/events.js` (S1/S6/S9/S10/S12/S13/S14/S15/S16/S17/S18-hot),
  `docs/EVENTS.md` (same), `functions/account.js`
  (S1/S9/S12/S15/S16/S17/S18-hot), `functions/config.js` (S1/S2/S5/S8-hot),
  `functions/waitlist-intent.js`, `functions/sitemap.xml.js` (S13/S14-hot),
  `admin.html` + `assets/js/app/admin-console.js` (S3/S11/S15-hot),
  `scripts/verify-meta.mjs` (S2-hot), `scripts/test-request-paths.mjs`,
  `scripts/verify-fluid-layout.mjs`, `scripts/run-gates.mjs`, `package.json`,
  `assets/js/app/portal-flightplan.js`, `assets/js/app/roadmap.js`,
  `assets/js/app/month-review.js`.

## S20 — Phase 6: Final QA + merge prep (2026-07-25, Jacob_Work@f31bdef..83f70ce)

The V2 exit. Almost everything here is verification, closure of the ledger's
own deferred tail, and the two documents Jacob executes from — the deliberate
opposite of a feature session.

- DONE:
  - **The runbook exists: `docs/MERGE_RUNBOOK_V2.md`.** Ordered pre-flight →
    promote (fast-forward, verified: `main`@62eb2d6 is a clean ancestor, 39
    commits ahead, 0 the other way) → the REQUIRED `npm run deploy:cron` (S9–S18
    rewired the Worker and no git push deploys it; the hourly broadcast trigger
    only exists after one run) → a 12-row post-deploy curl table with expected
    outputs → rollback (CF dashboard first, `62eb2d6` recorded, revert-forward
    rule) → a 9-item launch-follow checklist that consolidates every open §7
    item with its cost and its watch-metric.
  - **The ledger's stalest fact was corrected against the live account: all 27
    migrations are ALREADY APPLIED to the shared remote D1.** Verified twice —
    `wrangler d1 migrations list` ("No migrations to apply!") and reading
    `d1_migrations` rows directly. Every "apply migration 00xx" Jacob-action
    from S2–S19 was executed between sessions; the checklist mirror above now
    says so and the runbook's migration step is verify-only.
  - **`npm run verify:env` was CRASHED and is now fixed + green (28 checks).**
    `scripts/verify-env.mjs:213` called `workerSecrets().includes(...)` — the
    helper returns `{names, error}` for the report printer, so the grounding-pair
    check added in S16 threw a TypeError after the three store reports printed.
    It had evidently never been re-run end-to-end since. One hoisted call now
    feeds both consumers (`scripts/verify-env.mjs:192,215`). Result: every
    required secret present in all three stores; warnings only for cron
    `MAILING_ADDRESS` (first-send blocker, in the runbook) and prototype
    `INTENT_PEPPER` fallback (by design).
  - **The Month in Review finally reports S16–S18 (+S19's mocks) — the item
    three sessions deferred "as one job in S20".** `functions/_lib/month-review.js`
    gains three pure composers + three degrading reads (readiness trend off
    `scorecards` with the reach-one-before-the-window baseline rule
    reviewSnapshots established; outreach advances off `contacts.status_at`
    grouped by rung, 'suggested' excluded because the only move TO it is a
    reset; term position measured at the window's LAST instant, with
    ended-inside-the-month reported and ended-before not). `mock_completed`
    joined `REVIEW_ACTIVITY`, which is a zero-query change because it is an
    events row (S18 wrote it server-side). Renders in the email
    (`functions/_lib/emails.js:319-346`, same skip-when-empty rule as every
    section) and on review.html (`assets/js/app/month-review.js`, three new
    sections in the same order; icons users/briefcase/graduation-cap all
    pre-existing in lucide-lite). Two invariants pinned by tests: outreach
    alone makes a month reviewable (headline branch extended, so it can never
    say "a quiet month" over an outreach section), and a term POSITION alone
    never does — ambient state is not something the student did.
  - **The four-surface browser-gate question (S16/S17/S18/S19 each punted it
    here) is answered: built, once, combined.** NEW gate `flightplan:ui-check`
    (`scripts/smoke-flightplan-ui.mjs`, port lane, port 8940, 7.0s): boots
    flightplan.html under a stubbed persona with a generic empty-JSON catch-all
    for extensionless routes + real fixtures for the four panel GETs, asserts
    zero pageerrors/console errors, all four S16–S18 panel hosts mount their
    no-data sentences, walks the NPS card's two-step flow (score 9 → consent
    step → POST body carries 9), and pins the static wiring (modules busted,
    hosts present). This is exactly the render-layer defect class the three
    discarded probes kept finding (the missing %, the `[hidden]` trap). The
    landing page deliberately got no browser walk: seo:check's 161 assertions +
    layout:check + contrast:check already pin it and it has no stateful flow.
  - **Dead code:** the `.fw-sprint-*` family (S19's flagged leftover — card,
    h3/p, price, and its whole 560px media block) is gone from
    `assets/css/flightway-2.css`; repo-wide grep proves zero remaining
    consumers. The orphan scan over every assets/js + assets/css file found
    exactly one zero-referenced candidate — `zone-colors.css` — which turned
    out to be LIVE via `@import` inside flightway-theme.css (the scan greps
    html/functions/workers; CSS-internal imports are invisible to it). Nothing
    else to kill.
  - **A11y quick pass (§5 S20: focus order, labels, reduced motion):** every
    animated stylesheet already carries `prefers-reduced-motion` guards; the
    ONE gap in the whole product was review.html's inline `mr-pulse` skeleton
    (the only inline `@keyframes` on any page) — guarded now. Both S19 forms
    fully labelled (career-centers 5 inputs/8 label-or-aria, community 1/4).
    The NPS card was verified semantically right: real `<button type=button>`
    elements, `role=dialog` + label, `role=group` scale with `aria-pressed`
    state, `aria-live` messages — keyboard order follows DOM order.
  - **Hand-written-caps grep: zero**, on two patterns (N free X / N per
    day|week|month families) across all HTML + client JS. The only shipped cap
    numbers are pricing.html's `data-fw-limit` slots, which plan:ui-check pins
    against `FEATURE_LIMITS` and `/config` overwrites at runtime.
  - **`/invite` discoverability (S15's deferred "revisit in S20"):** added to
    the footer of the eight signed-in app pages (portal, flightplan, roadmap,
    coach, review, applications, resume, simulation) — and deliberately NOT to
    the marketing footer: the page is a signed-in, noindex tool
    (`functions/invite.js:219`), and a public-footer link would walk visitors
    into a sign-in wall.
  - **Docs closed out:** `docs/ARCHITECTURE.md` rewritten (it still said "five
    Functions" and predated the whole of V2); CONVERSATION_HANDOFF.md got the
    V2-COMPLETE addendum (orientation + close state + what did not change);
    EVENTS.md needed NO change (S20 emits nothing new; test:events pins parity);
    FIT_MATH confirmed untouched by construction — empty
    `git diff 62207d2..HEAD` over onet-math.js, career-target.js,
    portal-target-switch.js and FIT_MATH.md itself; stale gate counts fixed in
    CLAUDE.md and BRANCH_AND_ENV_PROTOCOL.md (§3/§4/§9: 33/36-era numbers →
    47 unit / 50 full).
  - Repo hygiene: three long-dead worktree records pruned (`git worktree
    prune` — the deleted igor/leo donor checkouts and a stale scratchpad).
- MIGRATIONS: none — S20 adds no schema. (Remote D1 verified at 0027, see DONE.)
- BUSTERS: **`?v=20260725g`** — `assets/css/flightway-2.css` (all 15 referencing
  pages, forced by the sprint-card deletion) and `assets/js/app/month-review.js`
  (review.html). `g`, not `f`: `f` was S19's stamp on the same UTC day.
- GATES: baseline at session start **49/49 green in 77.8s**; session end
  **50/50** — NEW `flightplan:ui-check` (six checks, port 8940, 7.0s, port lane
  so it rides inside layout:check's shadow and adds ~0 wall-clock), plus
  EXTENDED `test:cron` (+19 asserts: the three pure composers' window/baseline/
  exclusion rules, compose integration, the two hasContent invariants) and
  `test:emails` (+4: all three sections render in both MIME parts and all three
  skip themselves on a quiet month). Unit tier is now 47 gates.
- DEFERRED (nothing silently dropped — each has a standing reason):
  - **'sent'-marks-the-network-step / season-week-marks-the-roadmap-step**
    (S17+S18): still its own slice — `node.done` feeds the gap-progress chain,
    §3.8 fragile, needs its own causal trace + test:vectors session.
  - **`node.semesterPlan` ∕ term unification** (S18): still a roadmap-generation
    change; `test:weekly` still pins them apart on purpose.
  - **End-to-end referral against real Stripe test fixtures** (S15): needs
    Jacob's Stripe side; now step 7.4 of the runbook rather than a floating item.
  - **First live grounded runs** (S16/S17/S18 watch-metrics): impossible until
    Jacob flips the grounding pair; the three honesty metrics are named in
    runbook §7.2 so they get watched rather than remembered.
  - **NPS CSV export** (S19): still fine at this volume.
  - **The term review's own client panel does not render the three new review
    sections** (it renders its stored `review_json` selectively; review.html
    and the email do). Harmless asymmetry, noted for whoever next touches the
    semester panel.
- DRIFT (plan/ledger vs reality; reality won):
  - **The ledger said ten migrations were pending Jacob actions; the database
    said zero.** Recorded prominently in DONE — future sessions should treat
    per-session "pending" Jacob-actions as snapshots, and re-verify against the
    account before building runbooks on them.
  - **CLAUDE.md/protocol gate counts had drifted three sessions stale** (33/36
    vs actual 49) — a reminder that "load-bearing" docs drift exactly like any
    other copy; fixed as part of this session's docs mandate.
  - **The one-port-per-gate registry in my own session brief was stale too**:
    8938/8939 were already taken (artifacts:ui-check, test:quiz-funnel);
    the new gate took 8940. The PORTS map in run-gates.mjs is the truth.
  - **§5 S20 says "kill dead code from moved modules" plural; the sweep found
    exactly one dead family** (.fw-sprint-*) and one false positive. V2's
    sessions cleaned up after themselves better than the plan assumed.
- JACOB ACTIONS RAISED (all consolidated in `docs/MERGE_RUNBOOK_V2.md` — that
  file is now the single list; headline items):
  1. **Execute the runbook** when ready: pre-flight → `git push origin
     Jacob_Work:main` → **`npm run deploy:cron`** (the one step with no
     substitute) → the curl table → keep `62eb2d6` as the rollback SHA.
  2. **Search Console AFTER the merge** (sitemap's ~780 career URLs 404 on
     prod until then), then the week-1 funnel watch + first broadcast.
  3. **Referral legitimacy pair** when you want D24 real: promo id env +
     `invoice.payment_succeeded` on the webhook (both modes) + the trial-stack
     decision.
  4. **MAILING_ADDRESS before the first real send** (cron toml + both Pages
     projects + rebuilds).
  5. Parked decisions unchanged: OAuth env pair, Semester Pass/Gift, attorney
     review, governing law, Turnstile, CF Access, MRR_MONTHLY_CENTS.
- HOT FILES (Phase-0-merged files touched here — this list closes with the
  merge itself): `functions/_lib/emails.js` (S4/S11/S12-hot),
  `functions/_lib/month-review.js` (S11/S12/S18-hot), `review.html` (S11-hot),
  `assets/js/app/month-review.js` (S11/S12/S19-hot),
  `assets/css/flightway-2.css` (WS-era-hot, 15 pages restamped),
  `scripts/verify-env.mjs` (S16-hot), `scripts/test-cron.mjs`,
  `scripts/test-emails.mjs`, `scripts/run-gates.mjs`, `package.json`,
  `CLAUDE.md`, `docs/BRANCH_AND_ENV_PROTOCOL.md`, `docs/ARCHITECTURE.md`,
  `docs/CONVERSATION_HANDOFF.md`, plus footers of the eight app pages.

---

## MERGE — V2 promoted to production (2026-07-25, `main` 62eb2d6 → f002f67)

Execution of `docs/MERGE_RUNBOOK_V2.md`, start to finish, in one session. Not a
development session: one commit of config, one of docs, and the runbook's own
verification. The full record with every number is the dated addendum at the end
of `docs/CONVERSATION_HANDOFF.md`; this is the ledger stub.

- **Pre-flight:** `env:status` clean (prototype serving `b608dca`, delta 41/**0**),
  `npm run gates` **50/50 in 80.5s**, `verify:env` **PASS 28**, migrations
  **"No migrations to apply!"** (nothing applied — the S20 finding held).
  Baseline production smoke before the merge: **14 OK / 14 FAIL**, every FAIL a
  route living only in the unpromoted commits. Jacob waived the §1 copy sign-off
  by commissioning the run.
- **The one code change (`f002f67`):** `MAILING_ADDRESS = "FlightWay, Inc"` as a
  **var** in `wrangler.toml` `[env.production.vars]` (one block serves BOTH Pages
  projects) and `workers/cron/wrangler.toml` `[vars]` — protocol §6, not a secret.
  **The CAN-SPAM item is NOT closed:** the value is a company name, not a postal
  address, and setting it silenced the runtime warning in
  `functions/_lib/email-template.js:66-77` AND the `verify:env` warning that used
  to carry the reminder. Both toml comment blocks now carry it instead. That is
  the only remaining tripwire — see the runbook §7.3.
- **Promotion:** fast-forward `62eb2d6..f002f67`, ancestry re-checked immediately
  before the push. Production built in <1 min (no stall, no re-trigger):
  `aba15ac8` on `main`. Prototype rebuilt to `5ed17c92`. Both now
  `✓ serving the branch tip`, delta 0/0.
- **`npm run deploy:cron` ran** — version `da125af9-754f-4049-91b3-b92c71297e49`,
  all three triggers registered (`0 14 * * *`, **`0 * * * *`**, `0 4 * * *`) and
  `env.MAILING_ADDRESS ("FlightWay, Inc")` on the printed binding list.
- **Verification:** whole curl table green; post-deploy production smoke
  **36 OK / 0 FAIL**; post-merge `verify:env` **PASS 28** (MAILING_ADDRESS warning
  now absent, INTENT_PEPPER the only one left). 782 career links on `/careers`,
  801 `<loc>` in the sitemap with `/career-centers` + `/community` both present,
  `/llms.txt` + `/llms-full.txt` live, robots split correct (canonical allows;
  prototype `x-robots-tag: noindex, nofollow` + `Disallow: /`), `/events` 204.
- **Two runbook/tooling defects found by executing them, both fixed here:**
  1. The §5 "repo hygiene" row used `curl -sL`, which **follows the 302 block to
     the homepage and reports 200** — the row could never pass while the block
     worked. Verified properly (`302 -> https://flightway.ai/`, body is homepage
     HTML) and the row rewritten with the trap spelled out.
  2. `scripts/env-status.mjs` `deployedSha()` omitted `--environment production`,
     so the `flightway` project's page-1 of Jacob_Work PREVIEW builds hid every
     Production row and PRODUCTION read "unknown (wrangler not authenticated?)"
     while wrangler was authenticated — wrong on the one line that mattered most.
     One-flag fix, verified.
- **Not done, by instruction** (needs Jacob's login, accounts, or spend): the two
  browser checks (admin dashboard, share-page OG), Search Console, the grounding
  flip, anything Stripe, DNS/Turnstile/CF Access. Carried into the runbook §7 list.
- Incidental: the `flightway` project still builds `Jacob_Work` previews (the
  concern documented in `wrangler.toml`'s header), but they answer **503
  `unconfigured_environment`** — inert in practice, not a live exposure.
