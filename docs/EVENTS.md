# FlightWay event registry

The living list of every analytics event FlightWay emits. Created in V2 **S1**;
**every session that adds an event adds its row here** (masterplan §3.12).

This file is not documentation-after-the-fact — it is **enforced**. The gate
`npm run test:events` asserts, in both directions, that this table and
`REGISTERED_EVENTS` in `functions/_lib/events.js` say the same thing, and that
every literal `FWEvents.log('name', …)` in the client passes the server's
allowlist and appears below. An event that is not here is an event the beacon
will treat as unregistered — and the beacon answers `204` either way, so this
table is the only place the mistake is visible.

## How the pipeline works

```
FWEvents.log(name, props)          assets/js/shared/events.js
   → local ring buffer             localStorage fw_events_v1  (debug, unchanged since v1)
   → durable queue                 localStorage fw_evq_v1
   → batched POST /events          functions/events.js        (sendBeacon on pagehide)
   → validate + scrub + stamp      functions/_lib/events.js
   → D1 `events`                   one batch() per request
   → nightly rollup 04:00 UTC      workers/cron/index.js → `events_daily`, 90-day prune
```

Server-written events (`checkout_success`, `plan_changed`) skip the client
entirely — they are written by `logServerEvent()` from the Stripe webhook, so
revenue numbers do not depend on a browser surviving a redirect.

## Rules

- **Names** are `snake_case`, stable forever once shipped (a rename orphans
  every historical row). Registered names are exact; an unregistered name is
  still accepted if it starts with a known surface prefix, so a future session
  that forgets this file loses a row of documentation, not the data.
- **Props are shape, never identity.** Ids, indices, counts, enums, booleans,
  short slugs. Banned by the server lint: emails and email-shaped values, names,
  school, GPA, tokens, free text, prose over 64 chars, nested objects, arrays.
  User linkage is the `user_id` column and nothing else.
- **`props` ≤ 1 KB**, **≤ 20 events per beacon**, **≤ 8 KB per request**.
- **Columns, not props:** `path`, `ref`, `utm_source`, `utm_medium`,
  `utm_campaign`, `ua_class`, `anon_id`, `user_id`, `ts`, `day` are stamped by
  the server — never put them in props.
- **Privacy:** no cookies (`anon_id` is a localStorage uuid), Do Not Track is
  honored client- and server-side, bots are dropped, and
  `ANALYTICS_ENABLED=false` switches the whole thing off from `/config`.

---

## Visit context

Emitted automatically by `events.js` on every page — no call site.

| Event | Surface | Props | Added |
|---|---|---|---|
| `page_view` | every page, on boot | — (path/ref/utm are columns) | S1 |
| `session_start` | every page, when the 30-min session gap is crossed | — | S1 |
| `identify` | after signup or login, to link `anon_id` → `user_id` | — | S1 |

## Quiz funnel

| Event | Surface | Props | Added |
|---|---|---|---|
| `quiz_start` | quiz.html `qzStart()` — the initial quiz begins | — (no resume path exists) | S1 |
| `quiz_q_view` | quiz.html — a question is shown | `{ idx, phase }` | S1 |
| `quiz_q_answer` | quiz.html — an answer is recorded (never the answer itself) | `{ idx }` | S1 |
| `quiz_complete` | quiz.html — the initial quiz finishes | `{ ms, n }` | S1 |
| `reveal_view` | quiz.html `qzShowReveal()` — the match-card reveal (top-3 + blurred 4–10) renders | — | S6 |
| `reveal_card_expand` | quiz.html — a match card's factor breakdown is expanded (`#1` opens by default and does not fire) | `{ rank }` | S6 |
| `gate_view` | quiz.html `qzShowReveal()` — the account gate is shown below the reveal (the `qzShowGate()` fallback fires its own) | — | S1 |
| `gate_signup_click` | quiz.html — either email gate exit (create account / sign in) | `{ cta: 'create'\|'signin' }` | S1 |
| `gate_google_click` | quiz.html — the reveal gate's "Continue with Google" (dark until `googleAuthEnabled`) | — | S6 |

**Dashboard caveat (S3, read before charting the quiz funnel):** `quiz_q_view`
and `quiz_q_answer` both re-fire on back-then-forward navigation — a student who
revisits question 3 produces a second row for `idx: 3`. Both are genuine user
actions, so neither is suppressed client-side. Per-question counts must dedupe
to the FIRST row per `(anon_id, session, idx)`. Likewise `quiz_complete.n` is the
run LENGTH, not a tally of answers given (`qzForceNext` can skip a question), so
do not reconcile it against a raw `quiz_q_answer` count.

## Account

| Event | Surface | Props | Added |
|---|---|---|---|
| `signup_complete` | auth.html — registration succeeded; or the OAuth landing page (S5) when the callback creates a new account | `{ method: 'password' \| 'google', source? }` — `source: 'quiz'` when created from the reveal gate (S6) | S1 |
| `login` | auth.html — sign-in succeeded; or the OAuth landing page (S5) when the callback links an existing account | `{ method: 'password' \| 'google' }` | S1 |
| `verify_sent` | **server** — a verification email was sent (register or the resend endpoint) | `{ reason }` | S4 |
| `verify_done` | **server** — `GET /verify` consumed a valid token and set `verified_at` (idempotent re-clicks don't re-fire) | — | S4 |

## The development loop

| Event | Surface | Props | Added |
|---|---|---|---|
| `roadmap_generated` | roadmap.js `generate()` — a generation returned, success only | `{ kind: 'initial'\|'regen', career, nodes }` | S1 |
| `roadmap_committed` | roadmap tree — a path is tracked/untracked (focus track, not the structural choice) | `{ kind: 'track'\|'untrack', spine }` | S1 |
| `roadmap_extend` | roadmap.js `extendBranch()` — the extend SUCCEEDED | `{ nodeId, nodes }` | S1 |
| `tree_interact` | roadmap tree — a deliberate interaction (never pan/zoom/hover) | `{ kind: 'node_open'\|'preview_jump'\|'branch_preview'\|'branch_extend', role }` | S1 |
| `step_done` | roadmap drawer AND the Focus view (two separate handlers — the Focus path never reaches the drawer's) | `{ done }` | S1 |
| `skill_gap_view` | roadmap Focus view opened, de-duped per waypoint+branch | `{ n }` | S1 |
| `opp_search` | Opportunity Finder — a search runs, once per career | `{ cap_state: 'ok'\|'capped' }` — `'capped'` = the free plan's one search this week is already spent. **`'locked'` was retired in S8**: §4 replaced the binary premium gate with a preview, so there is no longer a state where the student is refused the feature outright | S1 (`'capped'` S8) |
| `nav_click` | every page — a primary nav tab (the stable `data-app-nav` key, never the label) | `{ tab: 'home'\|'plan'\|'roadmap'\|'advisor'\|'explore' }` | S1 |
| `flightplan_view` | the weekly Flight Plan card rendered | `{ n, surface: 'hero'\|'mirror' }` | pre-S1 (`surface` S7) |
| `flightplan_done` | a weekly task checked off | `{ id, done, surface: 'hero'\|'mirror' }` | pre-S1 (`surface` S7) |
| `deadline_saved` | Deadline Radar — a deadline the student typed in by hand | `{ kind, source: 'manual' }` | S9 |
| `deadline_dismissed` | Deadline Radar — dismissed (the row stays in D1 so a refresh cannot resurrect it) | `{ kind }` | S9 |
| `deadline_done` | Deadline Radar — marked done | `{ kind }` | S9 |
| `radar_refresh` | a grounded Deadline Radar refresh completed. `source:'manual'` is client-written on the button; `source:'cron'` is **server**-written by the nightly sweep, so an unattended refresh is still counted | `{ source: 'manual'\|'cron', added, updated, reason }` — `reason` is `'ok'` or one of `capped\|grounding-off\|no-career\|no-results\|shape-failed` | S9 |
| `commitment_set` | a due date was put on (or moved to) a roadmap step — drawer or Flight Plan | `{ effort: 'S'\|'M'\|'L'\|'none', days, moved }` — `days` = whole days from today to the date (negative is allowed: back-dating is legal), `moved` = the reschedule count BEFORE this change | S10 |
| `commitment_cleared` | the date was taken off a step entirely | `{}` | S10 |
| `commitment_done` | a dated step was ticked off from the Flight Plan Commitments module | `{ overdue, days }` — `overdue` is whether it was late when completed, which is the only version of this number worth having | S10 |
| `commitment_rescheduled` | a dated step was pushed to a LATER date — drawer or Flight Plan, both surfaces split it the same way | `{ moves }` — the new cumulative count. Pulling a date **earlier** is not a slip and emits `commitment_set` instead, so a reschedule rate is one query rather than a join | S10 |
| `step_breakdown` | "Break this down" turned one roadmap step into AI micro-steps | `{ added }` — 0 means the waypoint was already at its 8-step ceiling and the call was refused before Gemini | S10 |
| `marco_callback_shown` | **server**-written. Marco opened a conversation holding follow-through context — open commitments and/or a last-conversation marker | `{ open, overdue, topic }` — counts of open/overdue commitments and whether a last-topic block was present. See the note below | S10 |
| `artifact_modal` | Evidence/artifact modal opened | `{ waypoint, gap }` | pre-S1 |
| `artifact_saved` | an artifact was saved | `{ type, gap }` | pre-S1 |
| `firmup_start` | profile-build.html — a firm-up run begins | `{ dims }` | pre-S1 |
| `nudge_optin` | notification opt-in toggled | `{ optin }` | pre-S1 |

## Feature intros

`feature-intro.js` composes four of these as `'feature_intro_' + outcome`, which
is why a literal grep never found them and the §2 audit undercounted the pre-S1
set at 22. The real pre-S1 total is 27.

| Event | Surface | Props | Added |
|---|---|---|---|
| `feature_intro_shown` | any new-surface intro modal opened | `{ feature }` | pre-S1 |
| `feature_intro_completed` | intro finished | `{ feature }` | pre-S1 |
| `feature_intro_skipped` | intro dismissed | `{ feature }` | pre-S1 |
| `feature_intro_upgraded` | intro converted to an upgrade | `{ feature }` | pre-S1 |
| `feature_ribbon_dismissed` | the new-feature ribbon dismissed | `{ feature }` | pre-S1 |

## Discovery

| Event | Surface | Props | Added |
|---|---|---|---|
| `career_compare_open` | hub — the compare drawer | `{ a, b }` | pre-S1 |
| `why_match_open` | "why this match" expander | `{ n }` | pre-S1 |
| `ai_exposure_view` | hub — AI-exposure panel | `{ soc, score, band }` | pre-S1 |
| `sim_share_download` | simulation.html — share image downloaded | `{ tier }` | pre-S1 |
| `sim_share_native` | simulation.html — native share sheet | `{ tier }` | pre-S1 |

## Execution tools

| Event | Surface | Props | Added |
|---|---|---|---|
| `resume_tailor` | resume.html — AI tailor run | `{ resumeId }` | pre-S1 |
| `resume_guided_build` | resume.html — guided build completed | `{ soc, answered }` | pre-S1 |
| `mockiv_open` | coach.html — mock interview panel opened | — | pre-S1 |
| `mockiv_start` | coach.html — a mock interview started | — | pre-S1 |
| `mockiv_debrief` | coach.html — the debrief rendered | — | pre-S1 |

## Monetization

| Event | Surface | Props | Added |
|---|---|---|---|
| `paywall_view` | entitlements.js `lock()` — a locked state the student can actually SEE (`getClientRects()` non-empty), once per feature per page. A surface gated while hidden logs nothing until it is revealed. S8 adds the inline locked PREVIEW (`FWPlanSurface.lockedTail()`), which is a paywall the student saw just as much as a full gate is. **S8 removed the mock-interview producer**: §4 gives free a lifetime taste, so that overlay is metered, not locked — an exhausted student now emits `plan_cap_hit`, which is the accurate moment | `{ feature }` | S1 |
| `plan_cap_hit` | a server cap was hit and surfaced — plan-surface `capCard()` and (S1) roadmap.js's own cap card | `{ feature }` | pre-S1 |

**`feature` values (S8 / masterplan §4).** Both events key on the `FEATURE_LIMITS`
slug, so the funnel splits by the wall that was actually enforced: `marco-chat`,
`marco-thread`, `roadmap-generate`, `mock-interview`, `career-sim`,
`opportunity-search`, `resume-draft`, `resume-tailor`. `weekly-plan` and
`receipts` were retired from this list in S8 — §4 makes the weekly loop free
forever, so neither can produce a wall any more. A `feature` value outside the
cap table means a surface is naming a wall the server does not enforce.
| `upgrade_click` | any `pricing.html` **anchor**, on pages that load plan-surface.js; plus (S3) the two sim CTAs that navigate via a JS `location.href` and so miss the delegated anchor listener (`sim-engine.js` locked-tier card + gated "go deeper" button) | `{ source: 'cap:<f>'\|'gate:<f>'\|'meter'\|'portal_billing'\|'nav'\|'sim:tier'\|'sim:deep' }` | S1 |
| `checkout_start` | billing.js `checkout()` — requested, BEFORE the 401 sign-in detour | `{ price: tier key }` | S1 |
| `checkout_success` | **server** — Stripe webhook confirmed payment | `{ mode, price }` | S1 |
| `plan_changed` | **server** — a plan column was rewritten | `{ from, to, source }` | S1 |
| `pricing_view` | pricing.html rendered | — | pre-S1 |
| `pricing_period` | pricing.html — billing period toggled | `{ period }` | pre-S1 |
| `pricing_click` | pricing.html — a plan CTA | `{ tier }` | pre-S1 |
| `pricing_checkout_error` | pricing.html — checkout failed client-side | `{ tier }` | pre-S1 |
| `pricing_intent_email` | pricing.html — fake-door intent captured | `{ tier }` | pre-S1 |

## Trust surfaces

| Event | Surface | Props | Added |
|---|---|---|---|
| `contact_submitted` | **server** — `POST /contact` accepted a message and wrote the `contact_messages` row. Written server-side for the same reason as the Stripe events: the count must not depend on a browser surviving the success screen. `notified` is whether Resend accepted the notification, which is how a dead `hello@flightway.ai` alias becomes visible instead of silent | `{ topic, notified, signedIn }` | S2 |

Note there is no `contact_view` — `page_view` on `/contact` already measures it,
and `contact_` is deliberately **not** an allowlisted prefix: one event does not
justify opening a namespace.

---

## Email (S4)

| Event | Surface | Props | Added |
|---|---|---|---|
| `email_sent` | **server** — the shared `sendMail` chokepoint (`functions/_lib/email-template.js`) logged a successful send. One row per delivered email of any `type` (verify, welcome, day3, weekly_digest, password_reset, quiz_results, deadline_t3/t14, `month_review:<YYYY-MM>`, broadcast, broadcast_test). A parallel `email_log` D1 row records failed/skipped sends too — this event fires only on success | `{ type }` | S4 |
| `email_unsub` | **server** — `GET`/`POST /unsubscribe` verified the token and turned a category (or `all`) off | `{ category }` | S4 |

**The `month_review` type is month-suffixed** (`month_review:2026-07`, built by
`monthReviewType()`). `alreadySent` matches on `(user_id, type)`, so a static
name would make the review exactly-once per ACCOUNT rather than per month —
every student would receive exactly one review email, ever. Dashboards that
group by `type` should prefix-match `month_review:`.

---

## Lifecycle completion (S11)

| Event | Surface | Props | Added |
|---|---|---|---|
| `review_viewed` | client — `review.html` rendered a Month in Review. Once per month rendered, not per fetch (switching months in the picker is a new view; re-rendering the same month is not) | `{ month }` | S11 |

Three things S11 deliberately does NOT emit, so a later session does not "fix"
them back:

- **No `digest_sent`.** The shared `sendMail` chokepoint already writes
  `email_sent{type:'weekly_digest'}` server-side, plus an `email_log` row that
  also records the failures the event cannot see. A second name would be the
  same fact counted twice, and the two would eventually disagree.
- **No `broadcast_queued` / `broadcast_sent` events.** Queueing is an ADMIN
  action, not product behaviour: it belongs in `admin_audit_log` (which is where
  `broadcast_queue`, `broadcast_cancel` and `broadcast_test` are written) and in
  the `broadcasts` row's own counters. Mixing staff actions into the student
  funnel would inflate every per-user metric that groups by event name.
- **No digest/teaser click event.** Every CTA in the digest and the review
  carries `utm_source=email` with a per-slot `utm_campaign` (`weekly`,
  `teaser_<feature>`, `discovery_<feature>`, `monthly`), so a click arrives as an
  attributed `page_view`. Measuring it inside the mail client needs a tracking
  pixel, an explicit §9 non-goal.

The in-app notification toggle emits the pre-existing `nudge_optin` (client), not
`email_unsub`; `email_unsub` is specifically the email-link/one-click path. Email
clicks are attributed through `utm_*` on the landing `page_view`, not a pixel —
FlightWay does not open-track (privacy stance, non-goal §9).

---

## Evidence Locker + Application Tracker (S12)

| Event | Surface | Props | Added |
|---|---|---|---|
| `evidence_viewed` | client — the Evidence Locker grid rendered on flightplan.html. Once per mount that renders, not per re-render | `{ count, linked }` | S12 |
| `evidence_edited` | client — an artifact's metadata was successfully updated | `{ type }` | S12 |
| `evidence_deleted` | client — an artifact was successfully removed | `{}` | S12 |
| `application_saved` | client — a row entered the tracker, from the Opportunity Finder's Save button or the manual form | `{ source: 'finder'\|'manual', duplicate }` | S12 |
| `application_stage_change` | client — a row moved along the ladder. Only fires when the status actually CHANGED | `{ from, to, advanced }` | S12 |
| `application_removed` | client — a row was deleted from the tracker | `{}` | S12 |
| `tracker_tailor_click` | client — "Tailor resume" opened from an application card | `{ status }` | S12 |
| `tracker_practice_click` | client — "Practice" opened from an application card | `{ status }` | S12 |

`advanced` is true only when the status index went UP the ladder
(`interested → applied → interviewing → offer → closed`), computed by
`isAdvance()` in `functions/_lib/application-core.js`. A move backwards is still
a `application_stage_change`, with `advanced:false` — a withdrawal is a real
event and hiding it would make the funnel look better than it is.

`tracker_*_click` counts the INTENT to use a tool from a specific application.
The tool's own start event (`resume_tailor`, `mockiv_start`) still counts the
run, so the drop-off between "opened the tailor from an application" and
"actually tailored" is one join rather than a guess.

Two things S12 deliberately does NOT emit:

- **No `evidence_added`.** §6 names it, but `artifact_saved` has counted every
  add since before S1 and the locker's own "+ Add" goes through the same modal
  and the same POST. A second name for one click would split the funnel across
  two metrics that immediately disagree — the same call S7 made for
  `thisweek_task_done`.
- **No `application_viewed` / board-view event.** `page_view` on
  `/applications.html` already measures it exactly, and `application_` is a
  registered prefix, so there is no reason to open a second name for the same
  page load.

---

## Public career pages (S13)

| Event | Surface | Props | Added |
|---|---|---|---|
| `career_cta_click` | client — a call-to-action on a server-rendered `/careers` page was clicked | `{ placement: 'hero'\|'app'\|'index', slug }` | S13 |
| `career_index_search` | client — someone typed in the directory's filter box. Once per page, not per keystroke | `{ has_query: 1 }` | S13 |

`career_cta_click` is the number the whole SEO channel is judged on: it is the
step from "a stranger arrived from Google" to "a stranger started the quiz."
`placement` separates the two buttons on a career page (`hero` = take the quiz,
`app` = open the deep dive in the product) from the directory's single CTA
(`index`).

`career_index_search` carries `has_query` rather than the query itself. The
search string is a career someone is considering — closer to a wish than a
click — and `q`/`query`/`text` are banned prop keys anyway
(`functions/_lib/events.js` `BANNED_KEYS`). Counting that the box was used at
all answers the only question the number would change: does the directory need
a better default ordering?

**S13 deliberately does NOT write a server-side `page_view` for `/careers/*`,**
which masterplan §5 S13 asks for. `logServerEvent()` stamps every row
`anon_id: 'server'` with a null `ref` and null `utm_*`, and the admin Sources
panel is built on exactly those three columns
(`functions/_lib/analytics.js:460` groups by `anon_id` and classifies on
`utm_source`/`ref`; `:245` counts `COUNT(DISTINCT anon_id)`). A server-written
`page_view` would therefore land as ONE fake visitor from no channel and would
degrade the panel it was meant to feed. The pages carry the ordinary
`events.js` beacon instead — same script as every other page — so an arrival
from Google is a real `page_view` with real first-touch attribution.

---

## Guides hub (S14)

| Event | Surface | Props | Added |
|---|---|---|---|
| `guide_cta_click` | client — a call-to-action on `/guides` or `/guides/<slug>` was clicked | `{ placement: 'end'\|'index', slug }` | S14 |

The guides' counterpart to `career_cta_click`, and it answers a narrower
question: **does informational content convert at all?** The career pages catch
someone searching for a job title, which is close to intent. A guide catches
someone searching "how to choose a career", which is not — so the ratio of
`guide_cta_click` to `page_view` on `/guides/*` is the number that says whether
the content hub earns its place or is a traffic vanity metric.

`placement` is `end` (the CTA at the foot of a guide, the only pitch on the
page) or `index` (the hub's own CTA). `slug` is the guide, or the literal
`index`. There is deliberately no mid-article CTA and therefore no third
placement value: masterplan §5 S14 requires the informational two thirds to come
first, and `seo:check` asserts no guide even names FlightWay in its first
section.

Like the two S13 events, this one is logged from an **inline script inside
server-rendered HTML** (`functions/_lib/guides.js`), so its call site is not
under `assets/js` and `test:events`' literal-name lint cannot see it. It is
registered explicitly in `REGISTERED_EVENTS` for that reason.

**No server-side `page_view` for `/guides/*`**, for exactly the reason recorded
under S13 above: `logServerEvent()` writes `anon_id: 'server'` with null `ref`
and null `utm_*`, which the admin Sources panel would classify as one fake
visitor from no channel. The guides carry the ordinary `events.js` beacon, so an
arrival from a search engine or an AI answer is a real `page_view` with real
first-touch attribution.

There is **no event for `/llms.txt` or `/llms-full.txt`**, and there cannot
usefully be one: they are fetched by crawlers, and `functions/events.js` drops
bot user-agents by design. Whether an AI answer engine actually cites FlightWay
shows up as ordinary referral traffic in the Sources panel, not as a hit on the
text file.

---

## Share + referral (S15)

| Event | Surface | Props | Added |
|---|---|---|---|
| `share_created` | client — a public share link was created from a card the user previewed | `{ surface: 'portal'\|'roadmap'\|'reveal' }` | S15 |
| `share_view` | **server** — `GET /s/<id>` rendered a live share page | `{ id }` | S15 |
| `referral_visit` | **server** — `GET /r/<code>` resolved to a real account | `{ code, to }` | S15 |
| `referral_signup` | client — registration bound this browser's `fw_ref` cookie | `{}` | S15 |
| `referral_converted` | **server** — the Stripe webhook moved a referral forward | `{ stage: 'converted'\|'credited', cents? }` | S15 |
| `referral_copy` | client — an invite link or blurb was copied on `/invite` | `{ channel }` | S15 |

**Why three of these are server-written.** `share_view` has no choice: the
viewer of a share page is a stranger with no FlightWay session, arriving from a
group chat, and the page render is the only witness there is. `referral_visit`
is the same shape one step earlier. `referral_converted` is written from the
Stripe webhook for the reason `checkout_success` is: the fact it records is a
payment, and a payment must not be counted by a browser that may never come
back from the redirect.

**`referral_converted` fires twice per referral, on purpose.** Once with
`stage: 'converted'` (the referee paid) and once with `stage: 'credited'` (the
referrer's Stripe balance credit actually landed). The gap between those two
counts is the most operationally useful number in this whole loop: every
referral sitting at `converted` is one a fraud guard held, and the commonest
hold by far is a referrer who has not confirmed their own email address. Both
rows carry `userId` = the **referrer**, so the funnel reads from the earner's
side.

**`share_view` is bot-filtered, and that filter is load-bearing.** A share link
pasted into Slack or iMessage is fetched immediately by an unfurler, so counting
crawlers would make every share look roughly twice as successful as it was.
`functions/s/[id].js` reuses `classifyUa()` — the same predicate
`functions/events.js` applies to the beacon — and skips both the event and the
`shares.views` counter for anything it calls a bot. The same applies to
`/r/<code>`.

**`referral_signup` is client-written even though the bind is not.** The
`referrals` row is written server-side at registration, from the `fw_ref`
cookie, precisely so a client cannot choose its own referrer. The browser
therefore has no way to know a bind happened — so `POST /auth/register` returns
`referred: true` and `assets/js/shared/auth.js` logs the event off that flag.
The Google path carries the same signal as `&referred=1` on its callback
redirect.

**No `share_download` / `share_native` events.** `sim_share_download` and
`sim_share_native` already exist from the Career Tester card and are emitted by
the same two code paths in the shared canvas module, so the download and native
share of a career-map card are counted under those names rather than under two
near-duplicates. `share_created` is reserved for the one action that has a
privacy consequence — publishing a page — which is the action worth its own
name.

`referral_copy`'s call site is an **inline script inside server-rendered HTML**
(`functions/invite.js`), so, like the S13 and S14 events above, `test:events`'
literal-name lint cannot see it and it is registered explicitly.

---

## Server errors (a separate channel, not an event)

S3 added `logServerError(env, route, err)` (`functions/_lib/events.js`), wired into
the top catch of the high-traffic functions. It writes to the **`server_errors`
D1 table** — NOT to `events` and NOT through the beacon. So it is deliberately
absent from the table above: it is operational telemetry (route + message + a
stack head, emails redacted), read only by the admin Errors panel
(`GET /admin/analytics?panel=errors`), and it stays on even when
`ANALYTICS_ENABLED=false` — an error log you switch off is worthless exactly
when you need it. The masterplan §6 `server_error` *event* name remains
**reserved and unused**; the table, not an event, is how server errors surface.

---

## Reserved for later sessions

The taxonomy in masterplan §6 names events that do not exist yet
(`server_error`,
…). They are deliberately **not** registered here: a row in this table means
"something emits this today". Each one gets added by the session that ships it,
together with its `REGISTERED_EVENTS` entry. Until then their surface prefixes
are already allowlisted, so an early emit is stored rather than dropped.

## S10 — what `marco_callback_shown` does and does not measure

It counts the callback **opportunity**: at the opening turn of a conversation the
server assembled a follow-through block (open commitments, a last-conversation
marker, or both) and handed it to the model. It is **not** evidence that Marco's
reply used it — the server knows exactly what it sent and nothing about what came
back, and grepping a reply for a commitment title would be a heuristic dressed up
as a metric. Read it as the denominator ("how often is there something to chase?"),
not the numerator.

The same honesty applies to `lastTopic`: it is the **first user message** of the
previous conversation, captured verbatim when that transcript is discarded, not a
generated summary. A per-conversation Gemini call would be recurring spend for a
line that cannot be more truthful than the sentence it compresses — and could
invent a topic that was never discussed. Marco's prompt says so out loud, so he
never claims to remember more of it than the one line he was given.

## S9 — a note on `deadline_alert_click`

Masterplan §6 names `deadline_alert_click`. It is deliberately **not**
registered. The T-3/T-14 alert emails link to
`/flightplan.html?utm_source=email&utm_medium=deadline&utm_campaign=t3|t14#deadlines`,
so a click already arrives as a `page_view` carrying first-touch UTM — the
click is measured, by the mechanism this product already uses for every other
email link. The only way to record the click *inside the mail client* would be a
tracking pixel, which is an explicit §9 non-goal.

## S7 — a note on `thisweek_task_done`

The V2 plan's §5 S7 event list names `thisweek_task_done`. It was deliberately
**not** registered. The This Week hero and Home's mirror are the same card
rendered by the same module against the same `/weekly-plan` write path, so a
second event name for the same check-off would have double-counted the one
action the loop metric depends on. `flightplan_done` instead carries
`surface: 'hero' | 'mirror'`, which answers the same question (which surface
does the habit actually happen on?) without inflating the total.

---

## S16 — the live-posting readiness scorecard

| Event | Writer | Props | Added |
|---|---|---|---|
| `scorecard_run` | **server** (`functions/scorecard.js`, `workers/cron/index.js`) | `source` (`manual`\|`auto`), `band`, `requirements`, `postings`, `downgraded` | S16 |
| `scorecard_viewed` | client (`assets/js/app/scorecard-panel.js`) | `band` | S16 |
| `scorecard_action_committed` | client (same) | `dated` (bool — did they put a date on it?) | S16 |

**Why `scorecard_run` is written server-side.** The quarterly premium run happens
inside the cron Worker, where there is no browser and no beacon. A client-side
event would therefore count only the runs somebody sat and watched — and since
the automatic runs are the ones the product pays for without being asked, the
metric that matters most for cost would be the one silently missing. `source`
separates the two populations.

**`downgraded` is the honesty metric, and it is the one to watch.** It counts
requirements where the shaping call claimed the student already had something and
cited an evidence id that does not exist in the corpus we built for it — an
invented "you have this". `sanitizeScorecard` turns every one of those into
`missing`, so a high number never reaches a student as a false claim; it reaches
*us* as a signal that the prompt or the model has drifted. A run where
`downgraded` approaches `requirements` means the readiness numbers going out that
week are systematically pessimistic and the prompt needs looking at. There is no
counter for the opposite error (a real capability the model failed to spot),
because nothing in the system knows about it — an asymmetry worth remembering
when reading these.

**`scorecard_action_committed` is the conversion this feature exists for.** A
readiness percentage nobody acts on is a horoscope. The ratio of
`scorecard_action_committed` to `scorecard_viewed` is the only number that says
whether the report changed what a student did, and `dated` splits "added it to my
roadmap" from "promised to do it by a date" — S10's evidence that a date is what
turns a step into an obligation applies here too.

**No `scorecard_posting_tracked`.** Saving one of the five postings to the
Application Tracker already emits `application_saved` with `source: 'finder'`,
from the shared `assets/js/shared/applications.js` path — the same call site the
Opportunity Finder uses. A second name for the same action would double-count
saves in the one funnel S12 built to measure them.

---

## S17 — the network mapper

| Event | Writer | Props | Added |
|---|---|---|---|
| `outreach_draft` | **server** (`functions/outreach.js`) | `archetype` (or `manual`), `channel`, `words`, `cited`, `repairs`, `named` | S17 |
| `outreach_sent` | client (`assets/js/app/network-panel.js`) | `archetype`, `from` (the status it moved off) | S17 |
| `outreach_replied` | client (same) | `status` (`replied`\|`met`), `archetype` | S17 |

**One of the three is an observation; the other two are reports, and the split is
the whole point.** FlightWay drafts the message and never sends it — there is no
send path in `functions/outreach.js` and no mail provider imported. So
`outreach_draft` is something this product *did* and can count exactly, while
"sent" and "replied" are things the student tells us happened in their own inbox.
That makes the draft→sent ratio the single most important number this feature
produces: it is the gap between a product that writes messages and a student who
sends them, and no amount of better drafting closes it if that ratio stays low.

**`repairs` is the honesty metric here, the way `downgraded` is for the
scorecard.** It counts how many times `sanitizeOutreachDraft` had to correct the
model before a student saw the draft — an invented recipient name in the greeting,
a fabricated URL or email address, a template sentence dropped whole. Every one of
those is silently fixed rather than shown, which is correct for the student and
dangerous for us: a rising `repairs` average means the prompt is drifting and
nobody is complaining, because the repair is invisible. Watch it as a rate per
draft, not a total. Note the asymmetry, same as S16: there is no counter for a
draft that was subtly wrong in a way the contract cannot check (a claim about the
student that cites a real id but misreads it), because nothing in the system knows
about that one.

**`cited` and `words` are the specificity pair.** `cited` is how many lines of the
student's own record the draft actually drew on, after intersecting the model's
claimed ids with the corpus we built — a draft citing zero is refused outright as
`generic`, so every logged value is at least 1, and the distribution says whether
drafts are genuinely personal or scraping by on one detail. `words` catches the
other failure direction: drafts creeping toward the 140-word ceiling are drafts
nobody finishes reading.

**`named` says whether the student had filled in a name yet** (0/1). It is worth a
prop because it changes what the draft can be: with no name the greeting is the
literal `[name]` placeholder, and a student who sends that as-is has sent a
message with a visible merge field in it. A high `named: 0` rate alongside a high
`outreach_sent` rate is the warning sign for exactly that.

**No `outreach_met`.** Meeting someone is a stronger outcome than a reply, not a
different funnel, so 'met' rides `outreach_replied` with `status: 'met'`. A fourth
name would split the one conversion this feature is judged on across two counters
and make both of them look half as good as they are.

**No `outreach_added` and no `outreach_suggested`.** Keeping an archetype card
costs nothing, is unmetered on every plan, and tells us almost nothing on its own —
the funnel that matters starts at the draft. If the question later becomes "do
students accept the suggestions we make?", the answer is already derivable:
`outreach_draft`'s `archetype` prop names which category each drafted message was
for, and `manual` marks the ones the student found themselves.

---

## S18 — Interview Season Mode + the Semester Loop

| Event | Surface | Props | Added |
|---|---|---|---|
| `season_started` | **server** (`functions/interview-season.js`, `{action:'start'}`) | `family`, `formatSource` (`playbook`\|`web`), `rounds` | S18 |
| `mock_completed` | **server** (`functions/mock-interview.js`, on a debrief that scored) | `score`, `persona`, `technical` (0/1), `company` (0/1), `season` (0/1), `week` | S18 |
| `semester_setup` | client — the start-of-term ritual completed | `system`, `outcomes`, `seeded`, `weeks` | S18 |
| `semester_review` | client — the end-of-term review opened | `granted` (0/1), `weeks`, `kept`, `evidence` | S18 |

**`formatSource` is this feature's honesty metric, the way `repairs` is S17's and
`downgraded` is S16's.** A season's six weeks are built deterministically from the
career family's playbook; the one thing grounding adds is the role's real-world
round list ("phone screen → technical screen → superday"). `formatSource: 'web'`
means the student is reading a process someone actually published;
`formatSource: 'playbook'` means they are reading this repo's own model of the
field, which is a good product and a different one. Nothing else in the funnel can
tell those apart, and with `GROUNDING_ENABLED` off on both Pages projects today
the honest expectation is that every row says `playbook` until Jacob flips it.

**`mock_completed` is server-written although §6 lists it under the client
taxonomy.** The overall score is a weighted composite computed in
`sanitizeDebrief` and never returned by the model — the technical axis is weighted
by the family's own question mix and dropped entirely when no technical question
was asked. A client-side event would either re-derive a number it does not own or
log the model's per-axis scores as if they were the composite. The server is the
only place this can be counted correctly, and it is also the only place that knows
the season stamp.

**`week` and `season` are what make the program measurable at all.** Every mock
interview emits this event; `season: 1` marks the ones that happened inside a
scheduled program. The comparison the whole feature rests on — does a student who
runs six scheduled sessions improve more than one who runs six ad-hoc ones — is a
single query only because both halves are on the same event name. Splitting
scheduled sessions onto their own event would have made it a join, and made the
ad-hoc number look smaller than it is.

**`semester_setup` carries BOTH `outcomes` and `seeded`, and the gap between them
is the point.** `outcomes` is how many the student picked; `seeded` is how many
actually became dated roadmap steps. They disagree exactly when the current
waypoint is already at its eight-step ceiling, which is a real wall the student
meets as a sentence and which nothing else in the funnel would show. A rising gap
means the ritual is being run by students whose roadmaps have no room in them.

**`semester_review`'s `granted` fires at most once per term**, because the +1
roadmap regeneration is claimed through a single conditional D1 update
(`terms.regen_granted_at`). A student who opens their review five times produces
five events and one `granted: 1`. That asymmetry is deliberate: re-reads of a
retrospective are worth counting, and a second grant would be a bug.

**No `season_week_done` and no `semester_outcome_done`.** A season week is "done"
when a `mock_completed` carries that week number, and a term outcome is a roadmap
step whose completion already emits `step_done` / `commitment_done`. Both would be
second counters for a thing the loop already counts, and the second counter is
always the one that drifts.

---

## S19 — the business surface

| Event | Writer | Props | Added |
|---|---|---|---|
| `nps_shown` | client (`assets/js/shared/nps.js`) | `moment` | S19 |
| `nps_scored` | **server** (`functions/nps.js`) | `moment`, `status` (`scored`\|`dismissed`), `score` (null on a dismissal) | S19 |
| `testimonial_given` | **server** (`functions/testimonials.js`) | `named` (bool), `schooled` (bool) | S19 |
| `pilot_requested` | client (`career-centers.html`) | `students` (cohort-size band) | S19 |
| `waitlist_joined` | client (`community.html`) | `list` (`community`) | S19 |

**`nps_scored` counts DISMISSALS, and that is the whole design.** The card is
raised at three product moments and the frequency cap is one ask per 30 days, so
closing it without answering has to spend the cap — otherwise the survey nags
exactly the people least interested in it. That makes `status` the denominator:
`scored / (scored + dismissed)` is the response rate, and an NPS computed without
it is a number about the people who like you enough to answer. `functions/_lib/
feedback-core.js`'s `npsSummary` returns `asked`, `scored` and `dismissed`
separately for the same reason, and returns `nps: null` — never `0` — when nobody
has scored yet.

**It is server-written although §6 lists it under the client taxonomy.** The
`nps_responses` row is already durable by the time `POST /nps` returns, and the
card's whole purpose is to be dismissed and navigated away from — a client beacon
queued behind that navigation would leave the D1 table and the funnel disagreeing
about the same event. Same call `contact.js` makes for `contact_submitted` and
S18 makes for `mock_completed`.

**`nps_shown` is client-written and cannot be anything else.** Only the browser
knows the card actually rendered — the server knows only that somebody asked
whether it was allowed to. The gap between `nps_shown` and `nps_scored + `
dismissals is the number that says whether the card is being ignored rather than
declined, which is a different problem with a different fix.

**`testimonial_given`'s two props are the consent rate, not the content.**
`named` and `schooled` say whether the student ticked each box. A queue full of
anonymous sentences is a queue that produces no usable proof, and the only way to
see that coming is to watch these two. Neither the quote nor any identifier is in
the props — the quote is in `testimonials`, where a human reads it.

**There is no `testimonial_approved` event.** Approval is an admin action, and
admin actions are recorded in `admin_audit_log` (`testimonial_approve`,
`testimonial_feature`, `testimonial_unfeature`, `testimonial_reject`) where the
actor is recorded with them. Putting a staff action into the student-behaviour
funnel would inflate exactly the surface it sits on.

**There is no `career_centers_view` or `community_view`.** `page_view` on
`/career-centers` and `/community` already measures it, and `pilot_requested` /
`waitlist_joined` are the conversions those pages exist for. Neither name opens a
new prefix: both are registered explicitly in `REGISTERED_EVENTS`, which is what
lets `pilot_` and `waitlist_` stay out of `ALLOWED_PREFIXES` — one event does not
justify a namespace (the same call `contact_submitted` made in S2).
