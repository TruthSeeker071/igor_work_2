# FlightWay architecture

Vanilla-JS multi-page app on Cloudflare Pages, with Pages Functions over **one
D1 database** (`flightway-db`, migrations `0001`–`0027`) and **one KV namespace**
(`COACH_KV`), plus a standalone cron Worker. No frameworks, no runtime npm
dependencies, no external analytics vendors (V2 D19). Rewritten at the V2 close
(2026-07-25, S20); the per-session detail lives in `docs/V2_PROGRESS.md`.

## The IA (V2 five-tab flip, D2)

Signed-in nav on every app page: **Home · Flight Plan · Roadmap · Marco ·
Explore**.

| Surface | File / route | Role |
|---|---|---|
| Home | `portal.html` | Signed-in home: action cards, plan panel, profile snapshot |
| Flight Plan | `flightplan.html` | The weekly loop: This Week, Deadline Radar, commitments, scorecard, network mapper, interview season, your-term panels |
| Roadmap | `roadmap.html` | Tree + multi-track focus, commitments on steps, Opportunity Finder |
| Marco | `coach.html` | AI advisor (threads, follow-through memory, mock-interview panel) |
| Explore | `dashboard.html` | Career Hub canvas map; quiz + deep dives live under it |
| — | `review.html` | Month in Review (email's CTA lands here) |
| — | `applications.html` | Application tracker + evidence locker |
| — | `resume.html`, `simulation.html`, `profile-build.html`, `quiz.html`, `career.html` (`?slug=`, noindex), `admin.html` (404s to non-admins) | Tools + funnel + console |

Public/marketing: `index.html` (dev-first landing), `pricing.html` (moment-led,
cap matrix slotted from `/config`), `auth.html`, `/career-centers` (B2B),
`/community` (waitlist), legal (`/privacy` `/terms` `/security`), `/contact`.

Server-rendered public SEO surface (all Functions): `/careers` +
`/careers/{slug}` (~780 pages, KV-cached, alias 301s), `/guides` +
`/guides/{slug}` (pure render, JSON-LD), `/llms.txt` + `/llms-full.txt`,
`/sitemap.xml` (KV-cached; key = career version + guides date + a djb2
fingerprint of the static URL set), per-host `/robots.txt` (canonical host gets
the allow-list; every other host gets `Disallow: /` + `X-Robots-Tag: noindex`
from `functions/_middleware.js`, host list in `functions/_lib/host.js`).
Share/referral: `/s/{id}` (public share page + OG image), `/r/{code}`
(HttpOnly-cookie bind), `/invite` (signed-in kit). `Flightway.html` is a legacy
hash-redirect shim (kept, noindex).

## Load-bearing invariants (bind every change)

- **User object**: all client user state goes through the `FWUser` facade
  (`fw_user_v1`); never create a user object client-side. New keys must be added
  to `KEY_MAP` in BOTH `assets/js/shared/user.js` and
  `functions/_lib/user-model.js` plus the user-sync registry — the `verify:user`
  gate guards this.
- **Caps**: every limit lives in `functions/_lib/plan-limits.js`
  (`FEATURE_LIMITS`) and is served via `/config` `featureLimits`. The client
  never hand-writes a cap number; pricing quotes them through `data-fw-limit`
  slots (`plan:ui-check` pins parity). Upgrade moments follow the
  four-moment rule (D18): inline locked states, never new interrupt modals.
- **Vectors** (fragile — full causal trace + `test:vectors` before editing):
  quiz → hydration → vector merge must stay idempotent; every mutation is an
  input replayed by BOTH client and server rebuilds; accumulating math stores
  absolute values keyed by source (the `bleedBase` pattern). Fit display math
  was deliberately untouched across all of V2 (`docs/FIT_MATH.md`).
- **School**: `school.js` owns it; every generation prompt includes
  `schoolPromptBlock()`; grounded prompts STATE the school (source URLs are
  opaque `vertexaisearch` redirects — never origin-check them).
- **Gemini**: every call carries `timeoutMs`; JSON mode sets
  `thinkingConfig:{thinkingBudget:0}`; cascades keep a wall-clock budget below
  the client timeout and prefer `softFail` + best-effort over hard failure
  (`functions/_lib/gemini-json.js`); grounded calls go through
  `gemini-grounded.js` under the `GROUNDING_USER_DAILY`/`GROUNDING_GLOBAL_DAILY`
  budget pair.
- **Immutable assets**: `/assets/*` ships `immutable, max-age=1y` — every
  changed asset gets its `?v=YYYYMMDDx` buster bumped on every referencing page
  (changed files only; a second change to the same file the same day takes the
  next letter). `verify:busters` guards it.
- **Analytics are self-hosted** (D19): client `FWEvents` → `POST /events`
  beacon (204) → D1 `events`; server-side writers for events only the server
  can observe. `docs/EVENTS.md` is the registry and `test:events` pins parity
  both ways. No PII in props; user linkage is the `user_id` column only.

## Backend layout

- `functions/_lib.js` + `functions/_lib/*` — shared CORS/auth/KV/D1 helpers;
  feature handlers import shared helpers only. Auth is HTTP-only session
  cookies (`getSessionEmail`); rate limiting via `checkRateLimit` (~35 call
  sites). D1 access is parameterized statements throughout.
- **Email**: Resend. `functions/_lib/emails.js` (+ `email-template.js`) renders
  verification, welcome, day-3, weekly digest, deadline alerts, Month in
  Review, term rituals, broadcasts — every marketing category carries a signed
  unsubscribe token (`UNSUB_SECRET`, byte-identical across all three config
  stores) and `MAILING_ADDRESS`.
- **Cron**: `workers/cron/` — a separate Worker (`flightway-cron`) with its own
  secrets; **only `npm run deploy:cron` deploys it** (no git push does).
  Monday digest, nightly deadline sweep + optional grounded radar refresh,
  Month in Review on the 1st, hourly broadcast queue, daily term rituals,
  quarterly scorecard sweep (grounding-gated).
- **Stripe**: SDK-free (`functions/_lib/stripe.js`); `priceIdFor()` picks
  `_TEST`/live price ids from the key's mode automatically; webhook grants in
  `functions/stripe/webhook.js`; referral credits ride
  `invoice.payment_succeeded` / paid sessions (D24).

## Deploy

Two Pages projects, one repo: `Jacob_Work` → `flightwayprototype`
(pages.dev, test Stripe) and `main` → `flightway` (**flightway.ai**, live
Stripe) — they share the one D1 and the one KV; there is no staging database.
`git push origin Jacob_Work` IS the prototype deploy; promotion is a
fast-forward `git push origin Jacob_Work:main` (Jacob only). The full protocol,
including the three config stores and every known gotcha, is
`docs/BRANCH_AND_ENV_PROTOCOL.md`; the V2 exit runbook is
`docs/MERGE_RUNBOOK_V2.md`.

Quality gates: `npm run gates` runs the whole suite in parallel
(`scripts/run-gates.mjs`; ~50 gates, one port per browser gate). `gates:unit`
is the offline subset for every commit. Per-gate logs land in `.gates/`.
