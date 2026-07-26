# FlightWay V2 Overhaul — Masterplan (2026-07-23)

**Status:** APPROVED — decisions locked with Jacob 2026-07-23. Execution across ~20 sessions (Phases 0–6).
**Companion ledger:** `docs/V2_PROGRESS.md` (every session appends; read it FIRST in every implementing session).
**Read also, before any session:** `docs/CONVERSATION_HANDOFF.md` (latest addendum), `docs/BRANCH_AND_ENV_PROTOCOL.md`, `docs/ARCHITECTURE.md`. If this plan disagrees with the repo, the repo wins — note the drift in the ledger and adapt.

---

## 0. North star

FlightWay today is 70% "figure out what you might be" and 30% "we'll get you there" — in surfacing, IA, metering, and marketing (the feature inventory is already ~50/50). V2 flips the product to **30/70 development-first**: the thing a user opens weekly because it tells them *what to do this week*, chases what they committed to, warns them about real external deadlines, and accumulates proof they're progressing. Around that core, V2 closes every launch-blocking business gap found in the audits: zero analytics, dead legal pages, an account wall before any value, no email loop, no SEO surface, no sharing, and an upside-down free tier.

The one-line positioning V2 builds toward (landing rewrite, §5.6/S6-adjacent copy, digest voice):
> **"Most career tools tell you what you might be. FlightWay tells you what to do this week."**

V2 is deliberately NOT: a rewrite, a redesign of the hub's visual identity, a fit-math change, a pricing change (without explicit Jacob approval per item), or a forum build. See §9 Non-goals.

---

## 1. Decision log (LOCKED 2026-07-23 — do not re-litigate in implementing sessions)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Free-tier philosophy | **Hybrid**: the weekly loop (Flight Plan, deadlines, commitments, workable Marco cap, periodic roadmap regen) is free so the habit forms; execution tools are metered tastes. Cap table in §4. |
| D2 | Navigation | **Full 5-tab flip**: Home · Flight Plan · Roadmap · Marco · Explore. Hub + quiz + deep dives live under Explore. |
| D3 | Landing page | **Dev-first rewrite** — hero sells the ongoing relationship; quiz remains the CTA. |
| D4 | Growth bets | **SEO (759 career pages) + referral loop**, with a Jacob-side checklist to make referral mechanics legitimate (Stripe, env). |
| D5 | Post-quiz reveal | **Top 3 match cards visible + full "why" on #1**; matches 4–10 blurred; account gate = save/unlock. |
| D6 | SSO | **Add Google OAuth** alongside email+password. |
| D7 | Email verification | **Soft-verify**: app works immediately; banner + email-dependent features locked until verified; OAuth signups auto-verified; existing pre-V2 accounts grandfathered as verified. |
| D8 | Initial quiz | **Rework the 10 initial questions so ~8 carry scoring maps** (same length; name/school/grade move out of the scored set). |
| D9 | Free lifecycle emails | **Full**: welcome → day-3 → weekly digest for free AND paid. |
| D10 | Subscription model | **notify_optin defaults ON at signup** (disclosed at signup, one-click unsub, verified addresses only). Existing 11 users get an in-app prompt, not silent enrollment. |
| D11 | Newsletter mechanics | **Auto personal digest + admin broadcast composer** (segments, preview, test-send). |
| D12 | Deadline Radar | **Full build**: D1-persisted, weekly capped refresh for active users, T-14/T-3 email alerts, feeds Flight Plan + This Week. |
| D13 | Tier-2 features | ALL in: Commitments on steps, Marco follow-through memory, Application Tracker, Evidence Locker, Month in Review, Live-posting scorecard, Network mapper, Interview Season Mode. |
| D14 | Tier-3 bets | **Semester Loop: IN. Shareable career map: IN. Community forum: waitlist page ONLY this cycle. PWA: deferred.** |
| D15 | Research backend | **Keep Gemini grounding** (no Perplexity migration this cycle). |
| D16 | Packaging | Career-center B2B page: build. Pricing page re-led by $29 Sprint + $199 Founding-100. **Open to new product proposals** (each one Jacob-gated; see §5.19). No silent price changes. |
| D17 | Fit display | **Keep absolute tiers.** Percentile tiers explicitly declined this cycle (revisit trigger: tier-fairness complaints, per CONVERSATION_HANDOFF "known limit"). |
| D18 | Paywall UX | **Keep the four-upgrade-moment rule**; new features use inline locked states (blur + one-line value + unlock), never new interrupt modals; the email digest carries promotional load. |
| D19 | Analytics | **Self-hosted only**: D1 events + server beacon + admin dashboards. No external vendors. |
| D20 | SEO scope | **All three**: SSR career pages, llms.txt + AI-search optimization, guides content hub. Hidden keyword text REJECTED (Google spam-policy violation; would endanger the domain). |
| D21 | Legal text | **Claude drafts full Privacy/Terms/Security now** (student/minor-aware, marked for attorney review); Igor's drafts can replace later via file edit. |
| D22 | Support | **Contact form (D1 + Resend) + hello@flightway.ai mailbox**; Jacob confirms the alias receives mail. |
| D23 | Prototype domain | **Host-based noindex middleware**: any non-flightway.ai host gets X-Robots-Tag noindex + Disallow-all robots.txt, forever. |
| D24 | Referral mechanics | **Give a month, get a month**: referee = 1 free month via Stripe promotion code; referrer = 1-month credit (Stripe customer-balance credit) when referee first pays. |
| D25 | Cap table | Ship §4 as previewed (tunable in one file; rationale recorded per row). |
| D26 | Ship cadence | **Fast-track Phase 0 to main** as soon as green; **everything else soaks on Jacob_Work and merges to main ONCE at V2 end.** |
| D27 | Guides authorship | **AI-drafts all guides**; Jacob skims before merge. |
| D28 | Feedback | **NPS + testimonial flow IN** (consented quotes, admin review queue). |
| D29 | Timeline | No deadline; quality first. Sessions ordered purely by value/dependency. |

---

## 2. Verified current state (2026-07-23) — audit-claim reconciliation

Both product audits were re-verified against the repo (branch `Jacob_Work` @ 62207d2) and the live site. Implementing sessions should trust THIS table over the raw audit text.

**Confirmed and to be fixed by V2:**
- No analytics: `assets/js/shared/events.js` is localStorage-only ("No server beacon in v1"); 22 events exist (not 14 — includes `interview-mode.js` + `pricing.html` wrappers); `roadmap.js`, `roadmap-tree.js`, `skill-gap-tracker.js`, `opportunity-finder.js` log **zero** events. → S1.
- Footer: all six Company/Legal links `href="#"` (`index.html:378-388`); no privacy/terms/security pages anywhere; live `/privacy` `/terms` `/security` 404. → S2.
- `/.dev.vars.example` serves **200 on live flightway.ai**; `_redirects` and `.assetsignore` have no rule for it (names only, no secret values — still an enumeration gift). → S2.
- Meta: `og:image` and `twitter:card` on **zero** of 14 root pages; index+pricing have canonical/og basics; quiz.html has canonical+og:url only; 9 pages (404, Flightway, admin, auth, coach, portal, resume, roadmap, profile-build) have no meta at all. → S2.
- Prototype domain `flightwayjacobprototype.pages.dev` serves HTTP 200 with `Allow: /` robots — **fully indexable today**. → S2 (host-based noindex).
- Quiz gate: `qzFinishInitialQuiz()` (`quiz-app.js:1116`) → `qzShowGate()` (`:2359`) hides results entirely; gate copy "Create a free account to save your answers and unlock your full career report." Zero preview. → S6.
- Initial quiz: `QZ_INITIAL_IDS = [0,24,2,20,21,22,3,5,17,23]` (`quiz-app.js:576`); only ids 3, 5, 17, 22 carry `s:{}` scoring maps. → S6.
- Nav: labels are per-page static markup (all 14 pages, e.g. `career.html:30-35`), NOT in `app-nav.js` (it only maps URL→page key). Signed-out users see the full app nav (auth-nav.js only syncs the quiz tab + sign-in link). Mobile nav relies on horizontal scroll with edge fades. → S7 (+S6 for the public variant).
- Caps today (from `functions/_lib/plan-limits.js:18-47` + endpoint greps): marco-chat free 5/day; marco-thread free 1/day; roadmap-generate free 1 lifetime; mock-interview free 0 (premium 3/day); resume builder/tailor/ATS `requirePlan('premium')` binary; opportunities `requirePlan('premium')` binary; **career sims and deep dives fully ungated** (IP rate-limit only). `/config` serves `featureLimits` via `publicFeatureLimits()` (`functions/config.js:12,31`). → S8.
- Cron (`workers/cron/index.js`): Monday 14:00 UTC only; paid-only when paywall on (`:45-48`); `notify_optin=1` gate (`:37`, default 0, ~0 users opted in); `UNSUB_SECRET` falls back to `'flightway-unsub'` (`functions/_lib/notify-token.js:12-14`) → **live unsubscribe links will fail if the cron worker env lacks the real secret**; `MAILING_ADDRESS` falls back to `'FlightWay, Inc.'` (`:82`) — not a postal address (CAN-SPAM violation when volume starts). → S4/S11 + Jacob checklist.
- Deadlines: `functions/_lib/deadlines.js` is read-only over the Opportunity Finder KV cache; no D1 persistence; nothing schedules or notifies. → S9.
- No email verification (no column in any migration; register.js sends nothing), no welcome email, no OAuth of any kind. → S4/S5.
- `pricing.html:157` "Career-center pricing →" → `index.html#pricing`, an anchor that doesn't exist (0 occurrences). → S2 interim fix, S19 real page.
- career.html is an empty JS shell (`<div id="career-content">`), generic title, no SSR function exists; sitemap has 3 URLs. → S13.
- No referral/share/og-image code exists (the only "share" code is the live `sim-share.js` download/native-share, a good precedent to reuse). → S15.
- Resume entry: single inbound link (`portal.js:32`). Mock interview: self-mounting panel inside coach.html only. Opportunity Finder: roadmap.html panel only. Artifacts: modal launched from the Flight Plan card on **portal.html** (loaded `portal.html:114`; roadmap's `skill-gap-tracker.js:1744` guard is inert there since FWArtifacts isn't loaded on roadmap.html). Flight Plan: a portal section, not a destination. → S7/S8/S12.
- Highest migration: `0016_admin_console.sql`. Portal AREAS order confirmed: hub → profile-build → resume → refine → career-switch → advisor → roadmap last (`portal.js:9-71`).

**Stale audit claims (already fixed — do NOT redo):**
- robots.txt/sitemap.xml point at `https://flightway.ai` (not the prototype domain).
- `flightway.app` mailtos are gone; repo uses `hello@flightway.ai` everywhere (resume.html:296, simulation.html:70, portal.html:82). Whether the mailbox EXISTS is still a Jacob action.
- Rate limiting is NOT auth-only: `checkRateLimit` is used across ~25 function files (~35 call sites). V2 only needs limits on NEW endpoints + a gap audit, not a site-wide build.
- index/quiz/pricing already carry canonical + og basics (but no og:image/twitter:card, and quiz's set is partial).
- The uncommitted `career-roadmap.js` extend-guard failure from audit 2 predates the multi-track overhaul; gates were 33/33 green at the 2026-07-22 addendum. Always run `npm run gates` at session start to establish the real baseline.

**Environment facts:** `portal.html` = Home (signed-in). `dashboard.html` = Career Hub (macro map). Career catalog lives in D1 (audits variously said 759/782/"750+" — derive the true count from D1 at build time; landing copy says "750+" which stays safe). `Flightway.html` exists with bare title — investigate in S2 (likely legacy; check inbound links before touching).

---

## 3. Architecture ground rules (bind every session)

1. **Vanilla JS + Cloudflare Pages Functions + D1/KV only.** No frameworks, no runtime npm deps, no external analytics/vendors (D19). Extend existing modules (`FWOnetVectors`, `FWOnetCatalog`, `FWAuth`, `FWUser` facade, hub/roadmap/coach modules) — never parallel systems.
2. **Deploy = `git push origin Jacob_Work`.** Never `npm run deploy:prototype`. `main` is pushed only by Jacob (D26). Follow `docs/BRANCH_AND_ENV_PROTOCOL.md` for env/branch behavior — recent commits (34be6c4, 0bfacc7, d443add) added per-mode envs, refusal-to-serve on unconfigured env, and per-mode Stripe prices.
3. **Gates stay green, and grow.** `npm run gates` (36-ish, ~56s) at session start (baseline) and session end. Every new invariant gets a gate (§5 lists per-session gates). Never a serial bash loop of individual gates; use the npm aggregates. Long commands run backgrounded. Verify with `curl -L`, `node`, `npm run pages:smoke` / `hub:verify` — browser MCP only for genuine visual QA.
4. **Immutable assets:** every changed file under `/assets/*` needs its `?v=YYYYMMDDx` buster bumped on every referencing page — changed files only, never a blanket restamp, and never reuse the same day-stamp for a second change in one day (append letter).
5. **User object:** all client user state through the `FWUser` facade (`fw_user_v1`), never CREATE a user object client-side; new keys must be added to `KEY_MAP` in BOTH client and server copies + the user-sync registry; `verify:user` gate guards this.
6. **School single source of truth:** `school.js` owns it; every new advice/generation prompt must include `schoolPromptBlock()`; grounded prompts must STATE the school (grounding source URLs are opaque `vertexaisearch` redirects — never origin-check them).
7. **Gemini:** every call carries `timeoutMs`; JSON mode sets `thinkingConfig:{thinkingBudget:0}`; every cascade has a wall-clock budget below the client timeout; prefer `softFail` + best-effort results over hard failure. User-controlled text entering prompts gets the same fencing as `career-roadmap.js`.
8. **Fragile subsystems** (full causal trace before editing; `test:vectors` after): hydration→quiz-state→vector merge; any accumulating math; save/merge paths where partial updates touch shared records (roadmap save, `preserveV3FocusTracker` — note the trap: normalize `preserveFrom` can resurrect a cleared choice, use null); auth/session boundaries.
9. **New root files** (llms.txt, share pages, etc.): check `_redirects` and `.assetsignore` interactions; new `data-lucide` icons must be added to `assets/vendor/lucide-lite.js`; `defer` ordering matters (WS-D trap); `data-fw-intro` modals break Playwright-style harnesses (dismiss or stub in tests); port 8934 is the local harness port.
10. **UI conventions:** FWErr display gate for errors, FWButtonBusy for async buttons, FWFeatureIntro (`featureIntros` key) for new-surface intros, `fw-revealed`/`fw-settled` entrance convention + FWPageVeil for new pages, `--transition` token scope, dark-plate contrast (contrast:check gate exists — new dark surfaces must pass).
11. **Metering:** every cap lives in `plan-limits.js` and is served via `/config` `featureLimits` — the client NEVER hand-writes a limit number. Upgrade moments obey D18.
12. **Instrumentation is part of "done":** every session's features emit the §6 events; a feature that logs nothing is unfinished. Update `docs/EVENTS.md` (created in S1) whenever an event is added.
13. **Migrations:** numbers below are provisional; at execution time take the next free number (`ls migrations/`) and record the actual number in the ledger. Apply to remote D1 only per the branch/env protocol (Phase-0 migrations must be applied to the production D1 by Jacob at Phase-0 merge; list them in the merge runbook).
14. **Session hygiene:** each session starts by reading `docs/V2_PROGRESS.md` + `git log --oneline -10`; ends with gates green, ledger appended (scope done/deferred, migration numbers, busters bumped, Jacob actions raised), commits pushed to Jacob_Work.

---

## 4. The V2 cap table (D1, D25 — implemented in S8, referenced everywhere)

Philosophy: **the loop is free, the tools are metered.** Free users must be able to *live the weekly habit* (see the plan, see deadlines, commit, check off, get chased) — and must *feel the walls* exactly where the expensive, career-moving execution tools live.

| Feature | Free today | Free V2 | Premium | Rationale |
|---|---|---|---|---|
| Marco chat | 5/day | **10/day** | Unlimited | Coach = the relationship; 5 is too thin to form it. |
| Marco threads | 1/day | 2/day | Unlimited | Follow-through memory needs thread continuity. |
| Roadmap generate | 1 lifetime | **1 active + 1 regen/month** | Unlimited | Loop needs periodic regen (semester loop grants +1 at term end). |
| Weekly Flight Plan | Free | Free | Free | The core habit. Never meter it. |
| Deadline Radar | n/a | **View + alerts free; 1 grounded refresh/week** | Refresh on demand | External urgency = retention; refresh costs grounding calls. |
| Opportunity Finder | Premium-only | **Top 2 results visible, rest blurred; 1 search/week** | Unlimited + full lists | Preview creates the "what I'm missing" moment (D18 inline lock). |
| Resume builder | Premium-only | **Free build/edit + 1 ATS check/month** | Unlimited ATS | A resume they built here = switching cost + tracker fuel. |
| Resume AI tailor | Premium-only | 1 lifetime taste | Unlimited | Expensive, high-value, per-application — the natural meter. |
| Mock interview | 0 | **1 lifetime taste** | 3/day | Zero-free was a conversion dead-end; one taste sells the program. |
| Career sims | **Ungated** | **1/month** | Unlimited | Huddle's scarcity pick — currently unlimited AI spend for free users. |
| Deep dives / Hub / quiz / compare | Ungated | Unchanged (free) | — | Discovery is the funnel. |
| Commitments / Evidence Locker / Application Tracker (basic) | n/a | Free | — | Loop surfaces; they deepen the user graph (the real moat). |
| Network mapper drafts | n/a | 2/month | Unlimited | AI drafting cost; 2 keeps the habit alive. |
| Live-posting scorecard | n/a | 1 lifetime taste | Quarterly auto + on-demand | Heaviest grounding cost in the product. |
| Month in Review | n/a | Free | Free | It's a retention email; metering it would be self-harm. |
| Interview Season Mode | n/a | Locked (visible) | Full program | The premium job-moment product. |

Rules: all counts enforced server-side in `plan-limits.js` (`FEATURE_LIMITS`), surfaced via `/config`, rendered client-side from config only. Every newly-metered surface ships its inline locked state in the same session that meters it. `plan_cap_hit` events fire on every wall (they already exist — extend the `feature` values).

---

## 5. Workstreams and sessions

Phases run in order; sessions within a phase are ordered by dependency. Sizing: one focused working session each; adjacent small ones (marked ⊕) may be combined by the implementing model if the first finishes early — never split a session's "done criteria" across a merge to main.

**Dependency spine:** S1 → S2 → S3 (Phase 0, fast-track to main) → S4 → S5 → S6 (funnel) → S7 → S8 (IA) → S9…S12 (retention, S10 needs S9's tables for digest context; S11 needs S4's email infra; S12 independent after S7) → S13 → S14 → S15 (SEO/share; S15 needs S4 verification + S5 for referral identity) → S16…S18 (each independent, need S9–S12 surfaces) → S19 → S20.

---

### PHASE 0 — See clearly, stop the bleeding (S1–S3) — FAST-TRACK TO MAIN (D26)

Phase-0 exit: Jacob merges Jacob_Work → main (or cherry-picks the Phase-0 commits), applies Phase-0 migrations to prod D1, sets Phase-0 env vars (§7), verifies live per the S3 runbook. After this merge, Phase-0-touched files should be treated as "hot" — later sessions that must touch them note it in the ledger so the final V2 merge is clean.

#### S1 — Analytics engine (beacon + instrumentation)
**Goal:** end the era of running blind. Server-side event pipeline + full instrumentation of the funnel and the four uninstrumented development surfaces.

Build:
- **Migration 0017 (provisional) `analytics`:** `events` table — `id, ts, anon_id, user_id (nullable), name, path, props (JSON, ≤1KB), ref, utm_source, utm_medium, utm_campaign, ua_class (mobile/desktop/bot), day (generated or written)`. Indexes on `(name, ts)`, `(day, name)`, `(anon_id)`, `(user_id)`. Plus `events_daily` rollup table — `day, name, count, uniques_anon, uniques_user`.
- **`POST /events` Pages Function:** accepts batches (≤20 events, ≤8KB body), validates names against an allowlist prefix set, strips/truncates props, rejects bots by UA class, rate-limits per anon_id+IP (`checkRateLimit`, generous — e.g. 120/hr), never blocks the page (fire-and-forget contract). No cookies: `anon_id` is a client `crypto.randomUUID()` in `localStorage.fw_anon_v1`. Honor `navigator.doNotTrack === "1"` client-side (send nothing). On signup/login, client sends an `identify` event; server links `anon_id → user_id` from then on (store user_id on subsequent rows; do NOT retro-rewrite history).
- **events.js v2:** keep the `FWEvents.log(name, props)` API 100% source-compatible (22 existing call sites keep working); add an in-memory+localStorage queue, `sendBeacon` flush on `visibilitychange/pagehide`, interval flush (~15s), batching, and a kill switch honored from `/config` (`analyticsEnabled`). Keep the local mirror (last N events) for debugging.
- **Auto page context:** every page emits `page_view` (path, ref, utm) and a `session_start` when the anon session is new (30-min gap rule). Capture `utm_*` + `ref` on landing and persist first-touch attribution to localStorage; attach to `signup_complete` so Igor/Leo's LinkedIn/IG/WhatsApp outreach is measurable per channel.
- **Instrument the gaps** (see §6 taxonomy): quiz per-question funnel, gate views/clicks, roadmap generate/commit/extend, tree interactions, skill-gap views, opportunity finder searches/saves, flight plan (exists), paywall/cap hits (exists — extend feature values), pricing (exists), Stripe checkout start; add a server-side event write on Stripe webhook success (`checkout_success`, `plan_changed`) so revenue events don't depend on the client.
- **Rollup + retention:** daily cron step (see S11's cron restructure; until then a `scheduled` addition to the existing Monday worker running daily is acceptable — see note) aggregates yesterday into `events_daily` and prunes raw `events` older than 90 days. NOTE: the cron worker's schedule changes to daily in S11; in S1, add the rollup as a same-worker second cron trigger (`0 4 * * *`) so Phase 0 is self-sufficient.
- **`docs/EVENTS.md`:** create the living event registry (name, surface, props, added-in session).

Invariants/gotchas: events.js is on every page — bump its buster everywhere (blanket pages touch, single file change); beacon endpoint must never 500 into user-visible errors (all failures swallowed client-side); D1 write batching (one `batch()` insert per request); no PII in props (emails/names banned — lint it in the gate).
Gate: **`test:events`** — allowlist validation, batch limits, rollup math, PII-prop lint, DNT path. Extend `test:endpoints` with the new route (auth-optional).
Done: events flowing end-to-end locally (`npm run pages:smoke` + a node script asserting rows land), gates green, EVENTS.md complete.

#### S2 — Trust, compliance, meta, and lockdown sweep
**Goal:** the site stops being legally naked and search-hostile; the prototype disappears from crawlers forever.

Build:
- **Legal pages (D21):** `privacy.html`, `terms.html`, `security.html` — full drafted text (Claude-drafted, "reviewed by counsel: pending" note in page footer): data collected (account, quiz answers, school/GPA, resume, usage events), processors (Cloudflare, Google/Gemini, Stripe, Resend), AI-processing disclosure, self-hosted analytics disclosure (localStorage id, no cross-site tracking, DNT honored), retention + deletion (account deletion exists — document it), minors: 13+ only, no under-13 accounts (COPPA), student-data posture, CAN-SPAM contact, governing law placeholder for Jacob. Terms: subscription/billing/refund terms matching actual Stripe behavior + the 4-endpoint refund reality, acceptable use, UGC clause (future-proofs the forum), disclaimer that career guidance ≠ professional advice. Serve at clean URLs `/privacy` `/terms` `/security` (Pages already 308s `.html`→clean).
- **Footer rebuild on all pages:** real links (About → §: fold into index or a small about.html; Careers → mailto/short page; Contact → `/contact`; Privacy/Terms/Security → new pages). Fix `pricing.html:157` career-center link to point at `/career-centers` … which doesn't exist until S19 — interim: point it at `/contact?topic=career-center` so it's never dead again.
- **Contact (D22):** `contact.html` + **migration 0018 `contact_messages`** (`id, ts, email, topic, body, status`) + `POST /contact` (rate-limited, no auth required, optional Turnstile — see below) + Resend notification to hello@flightway.ai. Replace nothing else — mailtos stay as fallback.
- **Optional Turnstile:** if `TURNSTILE_SITE_KEY`/`SECRET` present in env, render CF Turnstile on register + contact + waitlist forms; degrade gracefully (skip) when unset. Complements soft-verify against fake signups (huddle ask) at zero vendor cost.
- **Meta everywhere:** every public page gets title, meta description, canonical (on flightway.ai), og:title/description/url/type, `og:image`, `twitter:card=summary_large_image`. Create the branded OG image set (`assets/og/og-default.png` 1200×630 + variants for quiz/pricing; design: dark FlightWay plate, wordmark, one-line promise — reuse the vector-mark identity from WS-B). App-shell pages (portal, dashboard, roadmap, coach, resume, career, profile-build, admin, auth, simulation when signed-in-only) get `<meta name="robots" content="noindex">` — they render empty shells to crawlers and would pollute the index.
- **Host lockdown (D23):** middleware (`functions/_middleware.js` — check existing middleware first and extend, never duplicate) — when `request.host !== 'flightway.ai'` (and not localhost), add `X-Robots-Tag: noindex, nofollow` to every response; serve `/robots.txt` dynamically: canonical host → current allow-list + explicit `User-agent: GPTBot|ClaudeBot|PerplexityBot|Google-Extended Allow: /` lines; any other host → `Disallow: /`. Delete the static robots.txt or make the function shadow it (verify precedence with curl).
- **`.dev.vars.example`:** add to `.assetsignore` (stop uploading it at all) AND a `_redirects` 302 rule as belt-and-braces; while in there, sweep for other servable repo files (`gates/`, `*.md` at root, `package.json` — several already covered; verify with curl after deploy).
- **`Flightway.html` investigation:** grep inbound links; if orphaned legacy, remove from deploy (assetsignore) or 301 it; record finding in ledger.
- **UNSUB/MAILING hardening:** `notify-token.js` and cron email footer — log a loud console.warn when falling back to defaults; surface both as env checklist items (§7). (Setting them is Jacob's action; code must stop hiding the misconfiguration.)

Gate: **`verify:meta`** — node script asserting every public page has the full meta set, every app page has noindex, no `href="#"` anywhere, no dead internal links (crawl the local file graph), `.dev.vars.example` not in build output. Extend `pages:smoke`.
Done: all pages pass verify:meta; curl checks green locally; legal text complete; ledger notes what Jacob must curl-verify after the Phase-0 merge (live 200s on /privacy /terms /security /contact, 40x/redirect on /.dev.vars.example, X-Robots-Tag present on pages.dev).

#### S3 — Admin analytics dashboard + error visibility
**Goal:** the huddle's "analytics dashboard similar to the admin page" — self-hosted answers to every question the audits said you couldn't answer.

Build (extends the existing admin console @0016, root-admin gated, 404-to-non-admins preserved):
- **Overview panel:** DAU/WAU/MAU (anon + signed-in), signups/day, activation rate (signup → roadmap generated or plan viewed within 48h), current MRR/paid count (from users.plan + Stripe fields already stored).
- **Funnel panel:** landing → quiz_start → quiz_complete → reveal_view → signup → activated, with per-stage conversion and day-range picker; a second funnel for paywall: cap_hit → upgrade_click → checkout_start → checkout_success, segmented by feature.
- **Retention panel:** weekly signup cohorts × weeks-since (classic triangle), plus "days since last action" distribution (the brainstorm's loop metric).
- **Feature usage panel:** events/uniques per feature per week, including a "zero-use features" callout list (the audit's maintaining-eight-for-free point, now measurable).
- **Sources panel:** first-touch utm/ref attribution → signups/activations per channel (LinkedIn vs IG vs WhatsApp vs organic vs referral).
- **Live tail:** last 100 events (name/path/anon short-id/ts), auto-refresh, for debugging instrumentation.
- **Error log:** tiny `server_errors` table (fold into migration 0017 in S1 if foreseen, else 0019 here): unhandled function errors logged via a shared `logServerError(env, route, err)` helper wired into the top catch of high-traffic functions; admin panel lists last 50 with route/count. (Self-hosted stand-in for Sentry.)
- All queries hit `events_daily` where possible; raw `events` only for tail + short ranges. Add missing indexes as discovered.

Gate: extend **`test:admin`** (dashboard endpoints: root-gated, correct aggregates on a seeded fixture). 
Done: dashboards render with seeded local data; gates green; **Phase-0 merge runbook written into the ledger** (ordered: Jacob merges → applies migrations 0017/0018(/0019) to prod D1 → sets §7 Phase-0 env vars → curl-verifies the S2 list → confirms events appear in admin within an hour of traffic).

---

### PHASE 1 — The funnel (S4–S6)

#### S4 — Email infrastructure: verification, welcome, prefs, templates ⊕(S5)
**Goal:** the huddle's verification mandate + the audit's "you're not using Resend for the 99%" — built once, shared by every later email.

Build:
- **Migration (provisional 0019/0020) `email_v2`:** users gain `verified_at (nullable)`, `verify_token_hash`, `verify_sent_at`; `notify_optin` default flips to 1 **for new rows only**; new `email_log` table (`id, ts, user_id, type, status, message_id`) so sends are idempotent and debuggable. **Grandfather:** backfill `verified_at = created_at` for all pre-migration accounts (D7 — the 11 are known-real).
- **Soft-verify flow (D7):** register issues a token (HMAC, 48h TTL), sends "verify your email"; app fully usable; a slim persistent banner (dismiss-per-session) until verified; server-side: email-dependent features (digest, deadline alerts, referral credit eligibility) check `verified_at`; resend endpoint (rate-limited 3/day); unverified accounts >30 days flagged for purge (report-only list in admin; actual purge is a Jacob-approved later action). Google-OAuth signups (S5) set `verified_at` immediately.
- **Signup disclosure (D10):** signup UI adds the line "We'll send you a weekly Flight Plan email — unsubscribe anytime." + link to prefs. Existing users: one-time in-app prompt (FWFeatureIntro pattern) offering the digest (writes notify_optin=1 on accept; never silent).
- **Shared email template system:** one `functions/_lib/email-template.js` — branded dark-compatible HTML (test both modes), header wordmark, footer with **postal address (env MAILING_ADDRESS), one-click unsubscribe link (fixed token using UNSUB_SECRET), prefs link, "why am I getting this"** — plus `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058; Gmail requires it for bulk senders). Refactor the three existing senders (forgot-password, send-results, cron nudge) onto it.
- **Welcome email:** on register (post-verify-send, immediate): what FlightWay does now (dev-first framing), your top match tease, one CTA (see your matches / build your roadmap).
- **Notification prefs center:** extend `notify-prefs.js` + account UI to categories: weekly digest, deadline alerts, monthly review, product updates (broadcast). Unsub page handles per-category and all-off; unsubscribe-all always one click.
- **Cron restructure begins:** switch the worker to a daily trigger (`0 14 * * *`) with an internal dispatcher: Monday→weekly digest (existing logic untouched this session), daily→day-3 welcome-follow-up ("your matches are waiting", exactly once per user, `email_log`-guarded), daily→rollup (from S1). T-alerts and monthly land in S9/S11.

Invariants: every send checks `verified_at` + category optin + `email_log` idempotency; all sends BCC nothing, log always; SITE_URL from env (already defaults to flightway.ai). Deliverability: volume is tiny (tens), no warmup needed, but SPF/DKIM for Resend on flightway.ai must be confirmed (Jacob checklist — likely already done since forgot-password works).
Gate: **`test:emails`** — template contract (address/unsub/prefs present in every rendered type), token round-trip, idempotency, category gating, grandfather backfill.
Done: register→verify→welcome→day-3 works against local D1; existing senders migrated; gates green.

#### S5 — Google OAuth ⊕(S4)
**Goal:** D6 — kill password-only signup before the reveal ships.

Build:
- `GET /auth/google/start` (state + PKCE, redirect to Google) and `GET /auth/google/callback` (code exchange via fetch — no SDK, mirroring the SDK-free Stripe discipline; verify `aud`, `iss`, `email_verified` on the ID token — fetch Google's JWKS with KV caching, or use the tokeninfo endpoint given low volume; document the choice), then: existing email → link (`users.google_sub` column, add in S4's migration) + session; new email → create user (`plan='free'`, `verified_at=now`, notify default per D10) + session. Deny linking when `email_verified=false`.
- Buttons: auth.html (sign in + sign up), the S6 gate card, pricing intent points. Standard "Continue with Google" branding rules.
- Config: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, allowed redirect hosts (flightway.ai + pages.dev + localhost for dev) — Jacob checklist (§7). Feature-flag: buttons render only when `/config` says `googleAuthEnabled` (so the branch works before Jacob creates credentials).
- Rate-limit callback; audit session-cookie parity with password login (same cookie attributes, same session store); `signup_complete` event carries `method: 'google'|'password'`.

Gate: extend `test:endpoints` (start redirects, callback rejects bad state/nonce, flag-off path); manual live test documented in ledger for post-merge (OAuth can't be fully exercised offline).
Done: full flow works locally with a test client (or mocked token path), flag-off degrades cleanly, gates green.

#### S6 — Quiz rework + the reveal (the highest-leverage session in V2)
**Goal:** D5 + D8 — value before the wall, real signal behind the value, honest nav for visitors.

Build:
- **Question rework (D8):** redesign the initial-10 set so ~8 carry `s:{}` scoring maps (keep total length ≈10 and the ~90s promise). Name/school/grade OUT of the scored flow — collected post-signup (profile moment or first portal visit; school flows through `school.js` single-source rules). Reuse strong scoring questions from the full bank where possible; write new ones only where a gap exists (each with a documented scoring map consistent with `FIT_MATH.md` factor semantics). **Fragile subsystem rules apply in full** (§3.8): quiz seeding → hydration → vector merge; scoring changes re-run `test:vectors` + the persona calibration harness (`docs/CAREER_TESTER.md` personas) and record before/after top-sector tables in the ledger — the audit's "generic profile scores 90+ against nine of ten sectors" is the number to move.
- **The reveal (D5):** after final answer, compute locally and render **match-card interstitial** (new section on quiz.html, not a new page — keep the funnel single-URL): top-3 career cards (name, sector, fit tier, 2-line why-you), full factor breakdown expanded for #1 (reuse `why-this-match.js`), cards 4–10 present but blurred (CSS blur + lock chip, real data NOT in DOM for the blurred set — render placeholders so devtools can't defeat the gate). Below: the gate card — "Create a free account to save your matches and unlock all 10" with **Continue with Google** (S5) + email form inline (no bounce to auth.html), then post-signup lands on portal with matches saved (existing quiz→account save path; verify the vector persistence chain end-to-end).
- **Public nav variant:** signed-out pages render marketing nav (How it works → index sections, Careers → /careers index once S13 lands; until then omit, Pricing, Community → waitlist page after S19; Sign in CTA) instead of the 5 app tabs; signed-in unchanged (full flip comes in S7 — build the variant switch now, flip labels then, to avoid touching 14 pages twice; implement as a small nav-render helper reading session state via auth-nav.js patterns, replacing the static markup on all pages ONCE here, with the S7 tab set behind a constant).
- **Mobile nav:** with the variant helper in place, fix the 343px overflow properly: ≤4 visible tabs signed-out; signed-in mobile uses the scroll rail with edge fades (existing) but verify no mid-word clipping at 320/343/375 via `layout:check` matrix additions.
- **Events:** quiz_start, quiz_q_view/answer (idx), quiz_complete, reveal_view, reveal_card_expand, gate_view, gate_google_click, gate_signup_click, signup_complete(method, source='quiz').
- **Copy:** gate + reveal copy per D5; keep the honest-data voice ("a data point you can judge — not a verdict").

Gates: `test:vectors`, persona calibration harness run recorded, new **`test:quiz-funnel`** (scoring-map coverage ≥8/10, reveal renders top-3 from a fixture, blurred set contains no real career data in DOM), `layout:check` new rows, `pages:smoke`.
Done: full signed-out quiz→reveal→signup→portal path works locally including vector persistence; calibration table in ledger; gates green.

---

### PHASE 2 — The IA flip (S7–S8)

#### S7 — Navigation flip + Flight Plan page + This Week
**Goal:** D2 + brainstorm Tier-1: the product's front doors say development first.

Build:
- **Nav (D2):** signed-in tabs become **Home (portal.html) · Flight Plan (flightplan.html, NEW) · Roadmap · Marco · Explore (dashboard.html retitled)**. Quiz tab removed signed-in (quiz reachable from Explore + Home cards). `app-nav.js` pageFromPath updated; `data-app-nav` keys: home/plan/roadmap/advisor/explore. Explore page (dashboard.html) gains a slim header row: "Explore careers" + doors to Quiz (retake/sharpen), Compare, Deep dives — hub canvas untouched below it.
- **flightplan.html (NEW page):** the doing surface. Layout: **This Week hero** (3 tasks from weekly plan w/ checkoffs, next deadline chip, one live opportunity tease), then modules: Weekly Flight Plan (move `portal-flightplan.js` here as the primary mount; portal keeps a compact mirror card linking over), Deadline Radar list (S9 fills it; ship the empty-state now: "no tracked deadlines yet — refresh runs after your roadmap"), Commitments due list (S10), doors row: Resume Builder · Opportunities · Mock Interview · Evidence Locker · Applications (locked/preview states per §4 where applicable). FWPageVeil + fw-revealed entrance, FWFeatureIntro for the new tab.
- **Portal (Home) reorder:** This-Week mirror card first, then `AREAS` reordered development-first: Roadmap → Flight Plan door → Marco → Resume → Hub/Explore → Sharpen → Career Switch (last two = discovery block). Artifacts modal mount moves with the flight-plan module (keep `FWArtifacts` loaded on BOTH portal and flightplan to avoid the roadmap inert-guard situation repeating).
- **Redirect/compat:** old bookmarks fine (no URLs removed); `dashboard.html` title/meta change to Explore; sitemap/meta rules from S2 applied to flightplan.html (noindex — app shell).
- **Buster sweep** for nav helper + moved modules across all pages.

Events: nav_click(tab), thisweek_task_done, plan tab views via page_view.
Gates: `layout:check` (new page added to the 270-cell matrix), `pages:smoke` (+flightplan boot), `verify:meta` (new page), contrast:check on new dark plates.
Done: flip live on Jacob_Work, all pages navigate coherently signed-in/out, gates green.

#### S8 — Cap re-tier + front-door locked states
**Goal:** D1/D25 implemented exactly per §4.

Build:
- `plan-limits.js`: encode §4 (new FEATURE_LIMITS entries: sims/month, opportunity search/week + partial-results rule, resume ATS/month, tailor lifetime taste, mock lifetime taste, roadmap regen/month, marco 10/day, network drafts/month, scorecard taste; keep server-enforced counting patterns; lifetime vs windowed semantics follow existing token/marker invariants — mind the buster same-stamp gotcha from the 07-18 memory when touching metering surfaces).
- Endpoint enforcement: `sim-generate.js` gains plan gating (was ungated); `opportunities.js` free path returns top-2 + `lockedCount` (server-truncated — blurred items never contain real payloads); resume builder endpoints split: build/edit free, ATS metered, tailor tasted; mock-interview free taste (lifetime marker); roadmap-generate regen window logic (respect existing refund invariants — 4-endpoint refunds from the final-audit memory).
- Client locked states: shared `fw-locks` pattern (blur + lock chip + one-line value + Unlock button → pricing with `source` param) applied at: opportunity list tail, tailor button, ATS after cap, mock after taste, sim after monthly, scorecard card, Interview Season card. All copy passes the four-moment rule (D18): these are inline, never modal.
- `/config` `featureLimits` extended; **client renders every number from config** (grep for hand-written limits and eliminate). `plan:ui-check` gate extended to the new rows. Cap-hit events per feature.
- Pricing-page feature matrix updated to match §4 exactly (it reads /config where dynamic; hand-written rows updated + gate-checked).

Gates: `plan:ui-check` (extended), `test:endpoints` (per-cap allow/deny/refund paths), `test:vectors` untouched-but-run.
Done: every §4 row enforced server-side + rendered client-side from config; free-account walkthrough recorded in ledger; gates green.

---

### PHASE 3 — The retention engine (S9–S12)

#### S9 — Deadline Radar (D12)
**Goal:** the single highest-value build in the brainstorm: externally-imposed urgency, persisted and chasing.

Build:
- **Migration `deadlines`:** `id, user_id, title, org, kind (internship/fellowship/competition/club/application-window), due_date, url, source ('grounded'|'manual'), career_slug, status ('tracked'|'dismissed'|'done'), created_at, refreshed_at` + unique dedupe key (user, normalized title+due window).
- **Extraction:** extend the Opportunity Finder grounding pipeline: a deadline-focused prompt variant (career + school + grad year STATED in prompt per §3.6) with strict JSON schema (thinkingBudget 0, timeoutMs, softFail); results upserted into D1 (dedupe; never duplicate on refresh); manual add form (title/date/url) — free.
- **Surfaces:** Radar module on flightplan.html (sorted by daysUntil, status chips, dismiss/done, add-manual), This Week hero next-deadline chip, portal mirror. `daysUntil` logic reused from `deadlines.js` (which now reads D1 first, KV cache as fallback during transition).
- **Refresh policy (D12 + §4):** on-visit refresh at most weekly per user (free) / on-demand (premium); **weekly cron refresh for users active in the last 21 days**, capped (e.g. ≤50 users/night, budget guard env `GROUNDING_DAILY_CAP` honored by a shared counter in KV) — cost stays bounded and visible.
- **Alerts:** daily cron step: T-14 and T-3 emails per tracked deadline (email_log idempotent, verified+optin+category gated, deep-link to flightplan), plus same-day chip. Events: deadline_saved/dismissed/done, deadline_alert_click (via utm on link), radar_refresh.

Gates: **`test:deadlines`** (extraction schema→upsert dedupe, daysUntil edges incl. timezones — store dates as YYYY-MM-DD, display in user-local; alert selection idempotency, cap enforcement).
Done: radar works end-to-end locally with grounding stub fixtures; cron steps dry-run clean; gates green.

#### S10 — Commitments + micro-steps + Marco follow-through memory
**Goal:** checkboxes become obligations; Marco becomes the person who remembers.

Build:
- **Commitments (schema-in-doc):** roadmap step objects gain optional `dueAt (YYYY-MM-DD)`, `effort ('S'|'M'|'L')`, `committedAt`. These live inside the roadmap JSON doc — no migration — but MUST be added to every normalize/merge/preserve path on BOTH client (`roadmap.js`/`skill-gap-tracker.js`) and server (`functions/_lib/roadmap-tree.js`, save path) mirrors: **§3.8 fragile rules in full force** (a no-op save must drop no dueAt; normalize must not resurrect cleared ones — mirror the `null` handling lesson from `preserveFrom`).
- **UI:** drawer step rows get "by when?" quick-picks (This week / Next week / Pick date) + effort chips; overdue styling; flightplan Commitments module lists due/overdue with done/reschedule (reschedule keeps history count for honesty: "moved 2×").
- **Micro-steps (huddle's granular-guidance item, Gemini not Perplexity per D15):** per-step "Break this down" action → small Gemini call returns 2–4 sub-steps (JSON mode, fenced input) appended as child steps (marked `aiBuilt`, exempt from prune per multi-track invariants); free within Marco/roadmap allowances (rate-limited per user/day).
- **Marco memory:** extend the dossier/coordinates digest with: last-thread topical summary (one line, generated at thread close or lazily), open commitments (top 3 by due), last week's completion. Marco's system prompt gains a follow-through preamble: open with a callback when context exists ("Last time you said you'd finish the DCF course module by Friday — did it land?") — tone rules per `marco-persona.js`; never scold, always next-step. `schoolPromptBlock()` verified present.
- **Digest hooks:** weekly digest (S11) consumes commitments due this week + overdue.
- Events: commitment_set/done/rescheduled, step_breakdown, marco_callback_shown.

Gates: `test:vectors` (merge safety), extend the roadmap save/merge test with dueAt no-op-save fixtures, `test:weekly` (unchanged but run), `test:marco-voice` (callback preamble contract).
Done: commit→chase loop demonstrable locally; fragile-path fixtures green; gates green.

#### S11 — Lifecycle completion: digest rebuild, Month in Review, broadcast composer
**Goal:** D9/D10/D11 fully live; the cron becomes a real notification engine.

Build:
- **Cron final form:** daily 14:00 UTC dispatcher (from S4) now routes: Mon → weekly digest; 1st of month → Month in Review; daily → day-3, T-14/T-3 (S9), rollup (S1), scheduled broadcasts. Every send: verified + category optin + email_log idempotent + paywall rule DELETED (free users get email per D9 — remove the `paywallEnabled` filter at `workers/cron/index.js:45-48`).
- **Weekly digest rebuild:** per-user compose: greeting w/ streak/completion nudge, this week's 3 tasks (from weekly plan; generate-on-send if stale, reusing `weekly-plan-gen.js` budget rules), deadlines within 21 days, open commitments, **one premium teaser slot** (free users: rotate locked-feature value props keyed to their behavior — cap_hit history picks the teaser; paid users: feature-discovery slot instead) — the huddle's "inline ads," done tastefully; one Marco line (cheap template + dossier fill, not a Gemini call per user — budget).
- **Month in Review (D13):** page (`/review` module on flightplan or own light page) + email on the 1st: vector deltas from `vector_snapshots` (what moved/stalled), evidence added, applications advanced, deadlines hit/missed, next month's one focus (from commitments/roadmap). Email links to the page; page renders full detail.
- **Broadcast composer (D11):** admin console: compose (subject/markdown body → template), segment (all/free/paid/school contains/active-in-30d), preview, test-send-to-self, schedule/send-now, log to `email_log` + a `broadcasts` table (this session's migration). Unsub category: product updates.
- Events: email_sent(type) server-side, email_unsub, digest link clicks via utm.

Gates: **`test:cron`** (dispatcher routing by date fixtures, idempotency, paywall-filter-gone assertion, digest compose contract with/without data), `test:emails` extended (digest/review/broadcast render the full CAN-SPAM footer).
Done: a seeded local user receives (dry-run render) all email types correctly; admin composer works; gates green.

#### S12 — Evidence Locker + Application Tracker
**Goal:** proof compounds (locker) and the find→tailor→practice→track pipeline exists (tracker).

Build:
- **Evidence Locker:** artifacts (migration 0010) get a first-class page/module reachable from Flight Plan doors + portal: grid of artifacts, each tagged to a skill gap, showing vector movement attribution ("moved Quantitative Analysis +2.1" — computed from the gap-progress-sync single-writer chain; READ-ONLY over vectors, never a new writer, per the 2026-07-10 invariant), add/edit flows reusing the existing modal, empty-state selling why proof matters. If schema needs columns (e.g. `title`, `link`), extend via this session's migration.
- **Application Tracker:** **migration `applications`:** `id, user_id, source ('finder'|'manual'), opportunity_ref, company, role, career_slug, status ('interested'|'applied'|'interviewing'|'offer'|'closed'), url, notes, deadline_id (nullable link), created_at, updated_at`. UI: board/list on flightplan door (statuses as columns on desktop, select on mobile); "Save" buttons on Opportunity Finder results (free can save — the LIST is metered, saving what you saw is not); per-application actions: **Tailor resume →** resume.html prefilled with role context (uses tailor allowance), **Practice →** mock interview with role context (uses taste/allowance), link to deadline if dated. Status changes emit events; weekly digest counts advances.
- Wire Opportunity Finder panel (still on roadmap) + new flightplan surface to shared tracker module.

Events: evidence_added/viewed, application_saved, application_stage_change, tracker_tailor_click, tracker_practice_click.
Gates: extend `test:endpoints` (applications CRUD authz — cross-user denial fixtures mandatory per §3.8 auth rules), locker vector-attribution read-only assertion in `test:vectors`.
Done: full pipeline demo: find (stub) → save → tailor-prefill → practice-prefill → stage change → digest mention; gates green.

---

### PHASE 4 — SEO + share (S13–S15)

#### S13 — Programmatic SEO: server-rendered career pages
**Goal:** D4/D20 — the zero-CAC compounding channel; 759-ish real pages Google and LLMs can read.

Build:
- **`functions/careers/[slug].js`:** server-render full HTML from the D1 catalog (source of truth; count derived at runtime): h1 + one-line hook, "what you'll actually do" (top tasks), "what it takes" (top skills/abilities/knowledge as human sentences — O*NET levels are already 0–100, never rescale), education path, salary band (assets/data/salary-tiers.json where mapped), work-context notes, sector + related careers (same zone, 6 links), honest-fit explainer ("how FlightWay scores your fit against this — factor by factor"), CTA block → quiz ("see your fit in ~90s"). JSON-LD: `Occupation` + `BreadcrumbList`; full meta set incl. og:image (default career OG variant; per-career dynamic images are OPTIONAL stretch, not required); canonical `https://flightway.ai/careers/{slug}`.
- **Caching:** render → KV cache (24h, key by slug+content-version) + `Cache-Control: public, s-maxage=86400, stale-while-revalidate`; purge hook = bump a version const. Perf target: TTFB < 200ms cached.
- **`/careers` index:** sector-grouped directory (server-rendered, links all slugs, search-by-name via existing catalog data client-side enhancement), linked from public nav + footer + index.
- **Dynamic sitemap:** `functions/sitemap.xml.js` — static pages + all career slugs + guides (S14) with lastmod; shadow/remove static sitemap.xml; verify robots.txt points at it (S2 middleware already host-aware).
- **Interlinking:** career.html (app) gains canonical → `/careers/{slug}` (public twin) while staying noindex itself; public pages deep-link INTO the app ("Open in FlightWay" for signed-in). SLUG parity: reuse the existing slug system (`verify:aliases` covers 4 files — extend to the SSR route so aliases 301 to canonical slugs).
- Events: server-side page_view lite for /careers/* (bot-filtered) so SEO traffic shows in the Sources panel.

Gates: **`seo:check`** — for a sample of N slugs + the index: 200, title/desc unique, JSON-LD parses, canonical exact, og:image present, internal links resolve, render under size budget; `verify:aliases` extended; perf spot-check documented.
Done: local render of 10 sample slugs perfect; sitemap validates; gates green. (Live indexing steps = Jacob checklist post-final-merge: Search Console verify + submit sitemap.)

#### S14 — llms.txt, AI-search optimization, guides hub ⊕(S13)
**Goal:** the "recommended by AI when people ask for a career quiz/advisor" goal from Jacob's notes — done the way AI crawlers actually work (D20; hidden keyword text permanently rejected).

Build:
- **`/llms.txt`:** product summary, what FlightWay is for (career quiz with explainable matches; weekly development plan), key URLs (careers index, guides, pricing, how-it-works), factual claims kept honest; **`/llms-full.txt`** concatenating guide content. Ensure robots explicitly allows GPTBot/ClaudeBot/PerplexityBot/Google-Extended on canonical host (S2).
- **Guides hub (D27 — AI-drafted, Jacob skims):** `/guides/` index + 6–8 pages targeting the head terms from Jacob's notes: e.g. "A career quiz that explains its answers" (product-led, targets *career quiz*), "How to choose a career in 2026 (a working method)", "Career advisor vs. career coach vs. AI — what students actually need" (targets *career advisor*), "What is career development in college?" (targets *career development*), "How to plan your semester around a career goal", "Do career tests work? What the data says" (honest, cites O*NET/DoL), "How to find internship deadlines before they pass", "Parents' guide to career prep help". Each: real informational content first (2/3), product tie-in last (1/3), FAQ block with `FAQPage` JSON-LD, full meta, interlinks to career pages + each other. Server-rendered or static HTML (static is fine — content is stable); added to sitemap.
- **Landing structured data:** `Organization` + `WebSite` (+ SearchAction optional) JSON-LD on index; FAQ JSON-LD for the landing FAQ section (add one if absent, aligned with the S6/S19 copy).
- Keyword placement done legitimately: page titles, h1s, descriptions, body copy — never hidden text, never stuffing.

Gates: `seo:check` extended to guides + llms.txt presence/format; `verify:meta`.
Done: guides read well (ledger flags them for Jacob's skim), structured data validates, gates green.

#### S15 — Shareable career map + referral system
**Goal:** D4/D24 — every proud user becomes distribution; the huddle's removed sharing features return properly.

Build:
- **Share card:** "Share my career map" action on portal/roadmap/reveal: client-side canvas render (sim-share.js precedent) of a beautiful card — user's top-3 matches + tier marks + FlightWay mark (no PII beyond first name, user previews before sharing); download PNG + native share. 
- **Public share page:** `functions/s/[id].js` — user-initiated "create link" stores a share doc (D1 table `shares`: id (unguessable), user_id, payload JSON, created_at, revoked) + client-uploaded PNG (base64 → KV, ≤300KB) served at `/s/img/{id}.png`; page renders the card + og:image = that PNG + CTA "Find your own path → quiz" + `?ref` attribution. Revocable from account page. NO share pages are created without explicit user action (privacy).
- **Referral (D24):** this session's migration: `users.referral_code` (short, unique), `referrals` table (referrer_id, referee_id, status: visited/signed_up/converted/credited, ts fields). `/r/{code}` → 302 to `/` with utm(source=referral) + localStorage stamp; signup binds `referred_by`; **credit flow:** Stripe webhook first-successful-payment for a referred user → issue referrer credit via Stripe customer-balance (negative balance credit = one month's price) + mark credited + email both sides; **referee side:** checkout session for referred users auto-applies promotion code (env `STRIPE_REFERRAL_PROMO_ID`). Guards: both emails verified, self-referral blocked (email + customer + IP heuristics), max 12 credits/user/year, admin referral panel (list, statuses, void button, fraud flags).
- **Invite surface:** account + flightplan card: your link, copy button, counter ("2 friends joined"), the value pitch; plus a small `/invite` page with copy-paste outreach blurbs (helps Igor/Leo's manual outreach — include UTM'd links per channel).
- Events: share_created, share_view (server), referral_visit/signup/converted.

Gates: **`test:referral`** (code uniqueness, bind-once, credit idempotency vs webhook replays, self-ref denial, cap), `test:endpoints` (share page authz + revocation), `verify:meta` (share pages' OG).
Jacob (see §7): create Stripe coupon "Referral — 1 month free" (duration: once) + promotion code template, put id in env; confirm webhook secret covers the new event path.
Done: full loop locally with Stripe test fixtures; share page OG validates; gates green.

---

### PHASE 5 — Deep loop bets (S16–S18) — each independent; order by appetite

#### S16 — Live-posting readiness scorecard
Grounded search pulls ~5 real current postings for the user's target role (+school region where sensible), extracts requirement lists (strict JSON, fenced, budgeted), scores resume (parsed) + vectors + evidence against them → **readiness report**: % ready, met/missing requirement table, "what would move it most" (3 actions — each one-click convertible into a commitment (S10) or tracker entry (S12)). Persist reports (migration: `scorecards`) for the trend line. Free: 1 lifetime taste; premium: quarterly auto (cron, capped) + on-demand. Global daily grounding budget shared with S9's `GROUNDING_DAILY_CAP`. Gates: **`test:scorecard`** (extraction schema, scoring determinism on fixtures, cap). Events: scorecard_run/viewed, scorecard_action_committed.

#### S17 — Network mapper
`kind:'network'` steps become actionable objects. Migration: `contacts` (user_id, label/role-archetype, org_type, name (optional, user-entered), status: suggested/drafted/sent/replied/met, notes, ts). Generator: from network steps + school + career → suggested contact archetypes ("a {school} alum 2–4 years into {career} — find via the LinkedIn alumni tool", "the professor who teaches {relevant course}") + **drafted outreach message** from dossier (short, specific, no cringe; user edits before sending anywhere — FlightWay never sends on their behalf and never scrapes LinkedIn; set that expectation in UI copy). Tracking: user marks sent/replied; digest nudges stale drafts. Free: 2 drafts/month (§4). Gates: extend endpoints + prompt-contract test. Events: outreach_draft/sent/replied.

#### S18 — Interview Season Mode + Semester Loop
- **Interview Season Mode (premium):** a 6-week program object keyed to the target role's actual format (derived from deep-dive + grounding once, cached): weekly schedule of mock sessions with focus areas, persisted rubric scores per session (migration: `mock_scores` if not already persisted), trend chart on the locker/progress surface, program card on flightplan. Uses existing mock-interview engine; program is scheduling + persistence + narrative. Locked-visible for free (D18 inline lock).
- **Semester Loop:** term setup on profile (system: semester/quarter + start/end dates — new `FWUser` keys via KEY_MAP both sides + user-sync registry): **start-of-term ritual** (wizard: pick 3 outcomes, map courses/clubs/one deliverable → seeds commitments + roadmap focus + locker goals) and **end-of-term review** (what moved: vectors/evidence/applications; grant +1 roadmap regen; prompt the ritual for next term). Digest becomes term-aware ("week 6 of 15"). Both ritual moments get FWFeatureIntro + email triggers (cron: term boundaries).
Gates: extend `test:weekly` (term-aware fixtures), `test:endpoints`, mock-score persistence test. Events: season_started, mock_completed(score), semester_setup, semester_review.

---

### PHASE 6 — Business surface + wrap (S19–S20)

#### S19 — Pricing re-led, career-center page, community waitlist, NPS/testimonials
- **Pricing page (D16):** re-led by moments — $29 Interview Sprint and $199 Founding-100 first (acute-moment + design-partner framing), $9.99/mo beneath as "the ongoing copilot"; feature matrix synced to §4 via /config; keep all four upgrade moments intact. **New-product proposals (Jacob-gated, build only the PAGE affordances now, wire Stripe only after Jacob approves + creates products):** (a) **Semester Pass** — one-time ~$24.99 covers a full term (matches student budgeting + Semester Loop; strong against subscription fatigue); (b) **Gift FlightWay** — parent-facing gift checkout of 3/6/12 months (the segment with budget). Ship both as design-complete cards behind config flags default-off; ledger lists exactly what Jacob must create in Stripe to flip each on.
- **Career-center page (D16):** `/career-centers` — the B2B door: pitch (cohort onboarding, counselor visibility, outcomes framing), "book a pilot" form (reuses contact/waitlist infra, topic=career-center), honest pilot-pricing placeholder ("pilot pricing — let's talk"), FAQ. Fix pricing.html link to point here. Feeds Leo/Igor's CUNY outreach.
- **Community waitlist (D14):** `/community` — "FlightWay Commons — coming soon": what it will be (peer advice by school/career), waitlist form (reuse `waitlist-intent.js`), seed-interest counter. Nav/footer link. NO forum build.
- **NPS + testimonials (D28):** dismissible 1-question NPS (0–10) at high moments (first flightplan_done, roadmap commit, month-review view; frequency-capped: once/30d/user, stored); score 9–10 → follow-up "mind if we quote you?" (name + school consent checkboxes) → `testimonials` table (this session's migration with nps_responses) → admin review queue (approve/feature) → approved quotes render on index + pricing (real proof replaces the audit's "no evidence" gap). Events: nps_shown/scored, testimonial_given.
- **Landing rewrite (D3) lands here in full** (it needed the V2 surfaces to be true): dev-first hero + "how your week works" section (This Week → chase → proof), explainability act (kept — it's the wedge), comparison vs coaches/LinkedIn (kept, sharpened), testimonials slot, guides/careers footer links, FAQ + JSON-LD. All claims must be TRUE at merge time (nothing promised that isn't shipped).

Gates: `verify:meta`, `plan:ui-check` (pricing matrix), `test:endpoints` (waitlist/nps), copy proofread pass logged.

#### S20 — Full QA + merge runbook (the V2 exit)
- `npm run gates` full suite green (target: everything added in S1–S19; keep total runtime bounded — parallelize or tier heavy gates behind `gates:full` if >120s).
- Cross-cutting sweeps: `verify:meta` on all pages; `seo:check` full-sample; contrast:check; layout:check matrix; a11y quick pass on new surfaces (focus order, labels, prefers-reduced-motion on new animations); kill dead code from moved modules; buster audit (every changed asset re-stamped once, no same-stamp collisions); `verify:user`/KEY_MAP parity; grep for hand-written cap numbers (must be zero).
- **Docs:** ARCHITECTURE.md + CONVERSATION_HANDOFF.md addendum (V2 summary), EVENTS.md final, FIT_MATH untouched-confirmed, V2_PROGRESS.md closed out.
- **Merge-to-main runbook (D26), written for Jacob:** ordered steps — freeze Jacob_Work; reconcile any main drift since Phase-0 merge (rebase/merge, re-run gates); list of ALL migrations to apply to prod D1 in order; §7 env vars diffed against `verify:env` per environment (Pages prod + cron worker); push main; post-deploy verification script (curl list: legal pages, /careers sample, sitemap, llms.txt, robots on both hosts, share page OG, /events beacon 204, admin dashboards populated; `pages:smoke` against flightway.ai; stalled-deploy check per deploy-diagnostics memory); rollback note (previous main SHA).
- **Launch-follow checklist for Jacob:** Search Console verify + submit sitemap; watch admin funnel daily for week 1; first broadcast draft; flip referral promo live; interview the first cohort (the audits' highest-information action — now with data to discuss).

---

## 6. Event taxonomy (authoritative at S1; EVENTS.md is the living copy)

Existing 22 keep their names (`artifact_modal`, `artifact_saved`, `nudge_optin`, `flightplan_done`, `flightplan_view`, `resume_tailor`, `resume_guided_build`, `plan_cap_hit`, `career_compare_open`, `why_match_open`, `ai_exposure_view`, `firmup_start`, `sim_share_download`, `sim_share_native`, `mockiv_start`, `mockiv_debrief`, `mockiv_open`, `pricing_view`, `pricing_period`, `pricing_checkout_error`, `pricing_click`, `pricing_intent_email`).

New (snake_case, props in parens): **Visit:** page_view(path, ref, utm_*), session_start, identify(user). **Quiz/funnel:** quiz_start, quiz_q_view(idx), quiz_q_answer(idx), quiz_complete(ms), reveal_view, reveal_card_expand(rank), gate_view, gate_google_click, gate_signup_click, signup_complete(method, source), login(method), verify_sent, verify_done. **Activation/loop:** roadmap_generated(kind), roadmap_committed, roadmap_extend, tree_interact(kind), deep_dive_open(slug), nav_click(tab), thisweek_task_done, step_done, step_breakdown, commitment_set(effort), commitment_done, commitment_rescheduled, deadline_saved(kind), deadline_dismissed, deadline_done, radar_refresh(source), evidence_added, evidence_viewed, application_saved(source), application_stage_change(from,to), tracker_tailor_click, tracker_practice_click, outreach_draft, outreach_sent, outreach_replied, scorecard_run, scorecard_viewed, scorecard_action_committed, season_started, mock_completed(score), semester_setup, semester_review, review_viewed, marco_msg, marco_callback_shown, opp_search(cap_state). **Monetization:** paywall_view(feature), plan_cap_hit(feature — existing, extend values), upgrade_click(source), checkout_start(price), checkout_success(price — server), plan_changed(from,to — server). **Email:** email_sent(type — server), email_unsub(category), (clicks via utm → page_view attribution). **Share/referral:** share_created(surface), share_view(id — server), referral_visit(code — server), referral_signup, referral_converted(— server). **Feedback:** nps_shown(moment), nps_scored(score), testimonial_given. **System:** server_error(route — server).

Rules: no PII in props (user linkage is the user_id column only); props ≤1KB; names validated server-side; every new feature PR adds its rows to EVENTS.md.

---

## 7. Jacob master checklist (everything only you can do)

**At Phase-0 merge (fast-track):**
1. Merge Phase-0 commits to `main`, push (deploy). Apply migrations (S1/S2/S3 list, in order) to production D1 (`wrangler d1 migrations apply` per SETUP.md).
2. Env (Pages production): `MAILING_ADDRESS` = real postal address (CAN-SPAM; a UPS-store box is fine); confirm `ROOT_ADMIN_EMAIL` set (admin-console memory says this was still pending!); optional `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (free, CF dashboard → Turnstile).
3. Env (cron worker `flightway-cron`): `UNSUB_SECRET` (generate a long random string; MUST match the Pages env's value), `MAILING_ADDRESS`, confirm `SITE_URL=https://flightway.ai`.
4. Verify live: the S2 curl list (legal 200s, `.dev.vars.example` blocked, `X-Robots-Tag: noindex` on `flightwayjacobprototype.pages.dev`, robots.txt correct per host); events appearing in the admin dashboard.
5. Optional hard lock: Cloudflare Access on `flightwayjacobprototype.pages.dev` (Zero Trust → Access → self-hosted app; allow only your emails).

**During Phase 1 (before S5 can go live):**
6. Google OAuth: Google Cloud Console → new project → OAuth consent screen (External, app name FlightWay, your support email) → Credentials → OAuth Client (Web): authorized origins `https://flightway.ai`, `https://flightwayjacobprototype.pages.dev`, `http://localhost:8934`; redirect URIs `<origin>/auth/google/callback` for each. Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in BOTH Pages envs per branch protocol.
7. Confirm `hello@flightway.ai` exists and is read (Google Workspace alias or group). Confirm Resend domain (SPF/DKIM) verified for flightway.ai (it likely is — password-reset works).

**During Phase 4 (referral legitimacy, D24):**
8. Stripe (live mode): Coupons → create "Referral month" (100% off, duration: once, applies to the $9.99 product) → create a Promotion Code from it (unrestricted, or new-customers-only) → put its `promo_...` id in env `STRIPE_REFERRAL_PROMO_ID` (both envs per mode — mind the per-mode price setup from d443add). Confirm the webhook endpoint + secret cover `invoice.payment_succeeded`/`checkout.session.completed` for the credit flow. Customer-balance credits need no product setup (API-issued).
9. Decide the Jacob-gated product proposals (S19): Semester Pass ($24.99 one-time?) and Gift (3/6/12 mo) — if yes, create products+prices in Stripe, hand me the price IDs, flip the config flags.

**At final V2 merge (S20 runbook has the full ordered version):**
10. Apply remaining migrations to prod D1; diff env per `verify:env`; push main; run the post-deploy verification list; **Search Console**: verify `flightway.ai` (DNS TXT at your registrar), submit `https://flightway.ai/sitemap.xml`; (optional) Bing Webmaster Tools import — Bing feeds several AI search stacks.
11. Week-1 follow: watch the admin funnel daily; send the first broadcast; start user interviews (all ~11 + new signups).

---

## 8. Success metrics (baseline = week 1 of Phase-0 data; targets directional)

Funnel: landing→quiz_start ≥ 30%; quiz_start→complete ≥ 60%; complete→signup ≥ 25% (the reveal is the lever); signup→activated (roadmap or flightplan within 48h) ≥ 50%. Loop: W1 return ≥ 30%; weekly task completion ≥ 25% of active users; digest CTR ≥ 8%; days-since-last-action median falling month-over-month. Monetization: cap_hit→upgrade_click ≥ 10%; free→paid ≥ 3% at 90 days; zero involuntary-churn surprises (webhook + refund paths tested). Growth: career-page impressions/clicks trending up weekly post-index (Search Console); ≥ 1 AI-search referral sighting (llms.txt goal is directional); referral K-factor ≥ 0.15 once ≥50 users. Proof: ≥ 5 consented testimonials in the queue by V2+30d.

## 9. Non-goals (explicit, decided)

Percentile fit tiers (D17 — revisit on tier-fairness complaints). PWA/native app ($99 App Store deferred with it). Forum build (waitlist only). Perplexity migration (D15). Any price/product change without Jacob's per-item go (D16). Open under-13 registration (Terms 13+). Email open-tracking pixels (privacy stance; clicks via UTM only). External analytics vendors (D19). Hidden-text SEO (rejected on policy grounds — permanent).

## 10. Risks and mitigations

D1 events growth → daily rollups + 90-day raw prune (S1). Email deliverability → verified-only sends, List-Unsubscribe headers, tiny volume ramps naturally. Gemini/grounding cost creep from S9/S16 → per-feature caps + shared `GROUNDING_DAILY_CAP` + admin cost-proxy panel (grounded-call counts in events). Long main↔Jacob_Work divergence (D26) → Phase-0 file "hot list" in ledger + S20 reconcile step. Referral fraud → verification+self-ref+cap+admin void. Quiz scoring rework destabilizing vectors → §3.8 discipline + persona calibration before/after (S6). Scope creep across 20 sessions → each session ends green + ledger'd; anything unfinished moves to the ledger's deferred list, never silently dropped. SEO pages thin-content risk → every career page carries real O*NET-derived substance + honest copy, no doorway-page patterns; guides are informational-first.

## 11. Coverage map (every source item → where it lands)

Huddle: match cards→S6; blurred partial→S6; free previews→§4/S8; newsletter+ads→S11; 30/70→S7/S8/S19; analytics dashboard→S1–S3; email verification→S4; rate limits→verified mostly-done + S1/S2 new-endpoint limits; legal pages→S2; micro-step guidance→S10 (Gemini per D15); forum→S19 waitlist (D14); Perplexity→declined (D15); sharing re-add→S15; mobile app→non-goal; VC/outreach items→supported by S3 sources panel, S15 /invite, S19 B2B page.
Brainstorm findings 1–9 → S7 (nav), S7/S12 (orphans), S7 (AREAS), S19 (landing), S4/S9/S11 (loop), S9 (deadlines object), S1 (instrumentation), §4/S8 (metering), S10 (commitments). Tier 1 (1–4) → S7/S7/S8/S19. Tier 2 (5–11) → S9/S10/S10/S12/S12/S11/S1. Tier 3 (12–15) → S18/S16/S17/S18.
Audit 1 defects 1–10 + minor → S1; S2; S13; S6; S5+S6; S11; S4+§7; S6; D17 (declined, recorded); S2; S19. "Missing" list → S1; S13; S6; D4; S19 (testimonials); S11.
Audit 2 defects a–g → S6; S1; S2 (+S13 og); stale-but-extended (S13 sitemap); S2; stale (mailbox check §7); S4/S11. Missing 1–9 → S1; S6; S2/§7; S2/S13; S4/S11; S13; S15; S19; §4+S19.
Jacob's notes: Google/AI visibility → S13/S14 + §7 Search Console; keyword idea → corrected to legitimate SEO (D20); prototype invisible forever → S2 middleware (D23); flightway.ai env changes → §7 (all his, enumerated).
Beyond the notes (additions): Turnstile option, server error log, UTM attribution, Stripe-webhook events, email_log idempotency, prefs categories, NPS/testimonials, /invite outreach kit, Month-in-Review page, micro-steps, admin broadcast scheduling, D1 retention policy, a11y pass, per-host robots, app-shell noindex.

---

## 12. Session scope lines (for the kickoff prompt's SCOPE: field — one per session)

- S1 — Phase 0: Analytics engine. Migration `analytics` (events + events_daily + server_errors if foreseen), POST /events beacon, events.js v2 (queue/sendBeacon/anon-id/DNT), page_view+session+UTM first-touch, instrument quiz/roadmap/tree/skill-gap/opp-finder/paywall/stripe-webhook, daily rollup+prune cron trigger, docs/EVENTS.md, gate test:events. See §5 S1.
- S2 — Phase 0: Trust/compliance/meta/lockdown. Privacy+Terms+Security full drafts, footer rebuild, /contact + contact_messages migration (+optional Turnstile), meta+og:image+twitter+canonical on all public pages, noindex on app shells, host-based noindex middleware + per-host robots.txt, block .dev.vars.example, Flightway.html investigation, UNSUB/MAILING loud-warn, gate verify:meta. See §5 S2.
- S3 — Phase 0: Admin analytics dashboards (overview/funnel/retention/features/sources/live-tail) + server error log panel, extend test:admin, write the Phase-0 merge runbook into the ledger. See §5 S3.
- S4 — Phase 1: Email infra. Migration email_v2 (verified_at/tokens/email_log, notify_optin default 1 new-rows, grandfather backfill), soft-verify flow + banner + resend, signup disclosure + existing-user prompt, shared email template (CAN-SPAM footer + List-Unsubscribe One-Click) refactoring the 3 existing senders, welcome + day-3 emails, prefs categories, cron→daily dispatcher, gate test:emails. See §5 S4.
- S5 — Phase 1: Google OAuth (SDK-free start/callback, PKCE+state, link-by-verified-email, google_sub column, auto-verified, config-flagged buttons on auth+gate), extend test:endpoints. See §5 S5.
- S6 — Phase 1: Quiz rework + reveal. Initial-10 rework to ~8 scoring maps (persona calibration before/after, test:vectors), top-3 reveal + full why on #1 + blurred-4-10 (no real data in DOM) + inline gate with Google, public-nav variant helper across all pages + mobile nav fix, funnel events, gate test:quiz-funnel. See §5 S6.
- S7 — Phase 2: IA flip. 5-tab nav (Home/Flight Plan/Roadmap/Marco/Explore) across all pages, NEW flightplan.html (This Week hero, weekly plan primary mount, radar/commitments empty-states, doors row), portal This-Week mirror + AREAS reorder dev-first, Explore header on dashboard.html, FWFeatureIntro, busters, layout/pages-smoke/meta gates. See §5 S7.
- S8 — Phase 2: Cap re-tier per §4. plan-limits encoding + server enforcement (sims gated, opp top-2+blur, resume split free-build/metered-ATS/tasted-tailor, mock taste, roadmap regen window, marco 10/day), shared inline locked states everywhere, /config + pricing matrix sync, plan:ui-check + test:endpoints extensions. See §5 S8 + §4.
- S9 — Phase 3: Deadline Radar. Migration deadlines, grounded deadline-extraction upsert w/ dedupe, radar UI on flightplan + This Week chip + manual add, refresh policy (visit-weekly free, cron for active users under GROUNDING_DAILY_CAP), T-14/T-3 alert cron steps, gate test:deadlines. See §5 S9.
- S10 — Phase 3: Commitments + micro-steps + Marco memory. dueAt/effort through every client+server normalize/merge path (fragile §3.8), drawer due-pickers + overdue UI + flightplan module, "break this down" Gemini micro-steps (aiBuilt), dossier digest + Marco follow-through opener, digest hooks, vectors/weekly/marco-voice gates. See §5 S10.
- S11 — Phase 3: Lifecycle completion. Cron daily dispatcher final (Mon digest/1st review/daily day-3+T-alerts+rollup+broadcasts), digest rebuild (tasks/deadlines/commitments/one-teaser-slot/Marco line, free+paid variants, paywall filter REMOVED), Month in Review page+email, admin broadcast composer (segments/preview/test-send/schedule, broadcasts migration), gate test:cron + test:emails extensions. See §5 S11.
- S12 — Phase 3: Evidence Locker + Application Tracker. Locker page w/ gap-linked vector-attribution (read-only over vectors), applications migration + board UI + finder save buttons + per-role tailor/practice prefill wiring, cross-user authz fixtures, events. See §5 S12.
- S13 — Phase 4: SSR career pages. functions/careers/[slug].js full HTML from D1 (+JSON-LD Occupation, canonical, og), KV render cache + s-maxage, /careers sector index, dynamic sitemap.xml function, career.html canonical→public twin, verify:aliases extension, gate seo:check. See §5 S13.
- S14 — Phase 4: llms.txt + llms-full.txt + AI-crawler allowances, guides hub (6–8 AI-drafted pages w/ FAQPage JSON-LD, flagged for Jacob skim), Organization/WebSite JSON-LD on index, sitemap additions, seo:check extension. See §5 S14.
- S15 — Phase 4: Share + referral. Canvas share card + download/native, shares migration + /s/[id] OG page w/ KV-stored PNG + revocation, referral_code + referrals migration, /r/{code} attribution → signup bind → Stripe promo (referee) + customer-balance credit on webhook (referrer), guards + admin panel, /invite page w/ outreach kit, gate test:referral. See §5 S15.
- S16 — Phase 5: Live-posting scorecard. Grounded 5-posting pull + requirement extraction + resume/vectors/evidence scoring → readiness report + persisted trend (scorecards migration), actions convert to commitments/tracker, taste/quarterly caps under GROUNDING_DAILY_CAP, gate test:scorecard. See §5 S16.
- S17 — Phase 5: Network mapper. contacts migration, archetype suggestions + dossier-drafted outreach (no scraping, user sends manually), sent/replied tracking + digest nudges, 2-drafts/month cap, prompt-contract test. See §5 S17.
- S18 — Phase 5: Interview Season Mode (6-week program keyed to role format, persisted rubric scores + trend, premium w/ locked-visible free) + Semester Loop (term dates via KEY_MAP both sides, start-of-term ritual wizard seeding commitments/focus, end-of-term review + bonus regen, term-aware digest + cron triggers). See §5 S18.
- S19 — Phase 6: Business surface. Pricing re-led by $29 Sprint + $199 Founding-100 (+ config-flagged Semester Pass & Gift proposals, Jacob-gated), /career-centers B2B page + pilot form, /community waitlist page, NPS + consented-testimonial flow + admin queue + landing/pricing quote slots, FULL dev-first landing rewrite w/ FAQ JSON-LD (claims true at merge), gates verify:meta/plan:ui-check/test:endpoints. See §5 S19.
- S20 — Phase 6: Final QA + merge prep. Full gate suite + cross-cutting sweeps (meta/seo/contrast/layout/a11y/busters/KEY_MAP/hand-written-caps grep), docs updates (ARCHITECTURE/HANDOFF addendum/EVENTS/ledger close), write Jacob's ordered merge-to-main runbook (migrations, env diff via verify:env, post-deploy curl list, pages:smoke vs flightway.ai, rollback SHA) + launch-follow checklist. See §5 S20.
