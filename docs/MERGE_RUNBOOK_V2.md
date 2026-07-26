# FlightWay V2 — Merge-to-main runbook (S20, the V2 exit)

> **EXECUTED 2026-07-25** — §1–§5 and §7's Cloudflare-side items were run in one
> session; `main` went `62eb2d6 → f002f67`. The record of that run (pre-flight
> numbers, the curl table's actual results, what was skipped and why) is the
> dated addendum at the end of `docs/CONVERSATION_HANDOFF.md`. §7's remaining
> items are Jacob's and still open. Keep this file as the procedure — it is the
> rollback reference too.

Written 2026-07-25 for Jacob. Every fact below was verified against the live
account on that date, not copied from the ledger — where the two disagreed the
live account won (most notably: **all 27 migrations are already applied**).

**The shape of the promotion:** `main` is at `62eb2d6` (Phase-0 + the S2
security commit) and is a clean ancestor of `Jacob_Work` — 39 commits to
promote, zero drift the other way, so the push is a fast-forward and nothing
needs rebasing or reconciling. D1 and KV are shared between both sites, so
**nothing about data changes at merge time** — this promotion changes only
which code flightway.ai serves.

Run the steps in order. Total active time ≈ 20 minutes plus the build wait.

---

## 1. Pre-flight (on `Jacob_Work`, before touching main)

```bash
npm run env:status
```
Expect: tree clean, PROTOTYPE serving the `Jacob_Work` tip, `in main, not in
Jacob_Work: 0`. If that last number is not 0, stop — protocol §7.

```bash
npm run gates
```
Expect all green (50 gates as of S20 close). This is the full suite including
the 270-cell layout walk; `gates:unit` is not sufficient for a promotion.

```bash
SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke
```
Smokes the CURRENT production before you change it — a baseline, so a post-merge
failure is attributable to the merge and not to something already broken.

```bash
npm run verify:env
```
Expect `PASS — 28 checks` (that was the 2026-07-25 result). The two standing
warnings are known and acceptable for merge day:
- `flightway-cron: MAILING_ADDRESS unset` — blocks nothing today; it is a
  CAN-SPAM blocker **the day the first real email volume sends** (§8.3 below).
- `flightwayprototype: INTENT_PEPPER unset` — falls back to SESSION_PEPPER by
  design.

**Copy sign-off (D27):** skim `/career-centers` and `/community` on the
prototype one last time — they are the first pages aimed at somebody who can
write a purchase order, and they go public with this push.

**Freeze:** from here until §5 is done, nothing else lands on `Jacob_Work`.

## 2. Migrations — verify, don't apply

Every migration through `0027_feedback.sql` was **already applied to the shared
remote D1** (verified 2026-07-25 against `d1_migrations`; the ledger's per-session
"pending migration" Jacob-actions are all satisfied). There is one database for
both sites, so there is no separate "prod migration" step at this merge. Confirm:

```bash
npx wrangler d1 migrations list flightway-db --remote --env production
```
Expect: `No migrations to apply!`. Anything listed = a session landed a new
migration after this runbook was written — apply it with the standard invocation
(`--env production` is REQUIRED):

```bash
npx wrangler d1 migrations apply flightway-db --remote --env production
```

## 3. Promote

```bash
git push origin Jacob_Work:main
```

```bash
npm run env:status
```
Re-run until PRODUCTION reads `✓ serving the branch tip` (builds take 1–3 min).
**Stalled-build check:** if it sits behind for ~10 minutes, the Cloudflare build
queue has stalled — re-trigger with
`git commit --allow-empty -m "chore: retrigger" && git push origin Jacob_Work:main`
(protocol §8). Never conclude a deploy from a `?v=`-busted asset URL — those are
cached forever by design; check an HTML page.

## 4. Deploy the cron Worker — REQUIRED, not optional

```bash
npm run deploy:cron
```

No git push ever deploys `flightway-cron`, and S9–S18 rewrote it: deadline
T-14/T-3 alerts, the rebuilt weekly digest (free users included, commitments +
applications + stale-draft + "week N of M" lines), Month in Review on the 1st
(now with the S20 readiness/outreach/term sections), scheduled broadcasts,
`runTermRituals`, **and a third trigger (`0 * * * *`) that only a deploy
registers**. Until this one command runs, production email stays exactly what it
is today: a paid-only Monday digest. One run covers all of it. Worker secrets
take effect immediately (no rebuild needed); its `RESEND_API_KEY`/`UNSUB_SECRET`
are already set.

## 5. Post-deploy verification (the curl list)

`curl -L` throughout — pages.dev and flightway.ai 308-redirect pretty URLs.

| Check | Command | Expect |
|---|---|---|
| Legal pages | `curl -sL -o /dev/null -w '%{http_code}' https://flightway.ai/privacy` (repeat `/terms` `/security`) | `200` each |
| Repo hygiene — **no `-L`** | `curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://flightway.ai/.dev.vars.example` (repeat `/wrangler.toml`, `/CLAUDE.md`, `/package.json`) | `302 -> https://flightway.ai/`. Do NOT add `-L` (as this row originally did): the block IS a redirect, so following it lands on the homepage and reports `200` — the row then looks failed while the block is working. Confirm the body too: `curl -sL .../wrangler.toml \| head -c 60` must be homepage HTML, not TOML. |
| Career directory | `curl -sL https://flightway.ai/careers \| grep -c 'href="/careers/'` | hundreds of links |
| One career page | `curl -sL https://flightway.ai/careers/actuary \| grep -o '<title>[^<]*'` | a real title, not the shell |
| Sitemap (S19 fix proves itself) | `curl -sL https://flightway.ai/sitemap.xml \| grep -cE 'career-centers\|community'` | `2` |
| llms.txt | `curl -sL https://flightway.ai/llms.txt \| head -3` | product summary text |
| robots, canonical host | `curl -sL https://flightway.ai/robots.txt` | allow-list + `Sitemap:` line |
| robots, prototype | `curl -sIL https://flightwayjacobprototype.pages.dev/robots.txt \| grep -i x-robots-tag` and body | `noindex, nofollow`; body `Disallow: /` |
| New B2B/community doors | `curl -sL -o /dev/null -w '%{http_code}' https://flightway.ai/career-centers` (and `/community`) | `200` each |
| Events beacon — **204 does not mean ingested** | `curl -s -o /dev/null -w '%{http_code}' -X POST https://flightway.ai/events -H 'content-type: application/json' -d '{"events":[{"name":"page_view","props":{"path":"/runbook-check"}}]}'` | `204` — but `noContent()` is ALSO the reply to a bot UA, `DNT: 1`, an oversize body and malformed JSON, so this proves reachability only. A bare `curl` is dropped on purpose: `curl/` is in `BOT_RE` (`functions/_lib/events.js:297`) and an empty UA classifies as `bot` too (`:302`). To prove ingestion, add `-A` with a browser UA and then confirm the row: `npx wrangler d1 execute flightway-db --remote --env production --command "SELECT path, COUNT(*) FROM events WHERE path='/runbook-check' GROUP BY path"`. |
| Page-boot smoke | `SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke` | green |

Then two things a curl can't prove, in a browser:
1. **Admin dashboards populated** — open `https://flightway.ai/admin.html` as
   the root admin; Overview tiles and the funnel should be live (events beacon
   above will already be in there).
2. **A share page** — create a share link from your own account, open
   `https://flightway.ai/s/<id>`, confirm the OG image renders (paste the URL
   into a Slack/iMessage preview to see the card).

## 6. Rollback

- **Fastest (site is broken):** Cloudflare dashboard → Pages → `flightway` →
  Deployments → last good build → "Rollback to this deployment". No git
  involved; fix forward afterwards.
- **Git-level:** previous `main` SHA to return to is **`62eb2d6`** — this is the
  *observed* pre-merge tip, not just the writing-time note: confirmed at
  execution on 2026-07-25 from `origin/main` AND from the Cloudflare Production
  deployment row for the `flightway` project (`8039c927…`, branch `main`,
  source `62eb2d6`), immediately before the fast-forward to `f002f67`. Never
  force-push main; revert forward on `Jacob_Work` and re-promote (protocol §7).
- The cron Worker is versioned separately — `npm run deploy:cron` from the
  rolled-back checkout restores its previous behavior.

---

## 7. Same-week follow-ups (the launch-follow checklist)

In rough priority order; none block the merge itself.

1. **Search Console** — verify `flightway.ai` (DNS TXT), submit
   `https://flightway.ai/sitemap.xml`. Deliberately AFTER the merge: before it,
   ~780 career URLs in that sitemap 404 on production, and handing Google 780
   dead links is worse than submitting nothing. (Optional: Bing Webmaster
   Tools import — Bing feeds several AI search stacks.)
2. **Watch the admin funnel daily for week 1** — the S3 dashboards are the
   whole reason Phase 0 shipped first. The specific first-real-run honesty
   metrics to watch as features get their first live use:
   - `scorecard_run` → `downgraded` count (S16: grounding quietly degrading),
   - `outreach_draft` → `repairs` count (S17: drafts needing contract repair),
   - `season_started` → `formatSource` split (S18: web vs playbook),
   - `nps_shown` vs `nps_scored`/`nps_dismissed` gap (S19: ignored vs declined).
3. **Before the first real email volume** (first Monday after merge): set
   `MAILING_ADDRESS` (a real postal address; UPS box fine) in
   `workers/cron/wrangler.toml` vars + both Pages projects' envs, then
   `npm run deploy:cron` + an empty-commit rebuild of both Pages projects.
   Confirm `hello@flightway.ai` receives mail and Resend SPF/DKIM still verify.
4. **Referral legitimacy (D24)** — the code is live but two Stripe-side pieces
   are yours: (a) create the "referral month" coupon + promotion code in BOTH
   modes and set `STRIPE_PRICE`-style per-project `STRIPE_REFERRAL_PROMO_ID`
   (until then the referee simply isn't promised a free month — copy already
   adapts); (b) **add `invoice.payment_succeeded` to the webhook endpoint's
   event list in both modes** — it is the only event that proves a subscription
   referee paid, and the referrer's credit hangs off it. Then run one
   end-to-end referral against test-mode Stripe on the prototype (the S15
   deferred item), and decide whether a referred subscriber should stack the
   14-day trial with the referral month (~6 weeks free today; dropping the
   trial for referred checkouts is a two-line change).
5. **First broadcast** — draft in the admin composer (preview + test-send to
   yourself), then queue. 0021 is applied; the cron's hourly trigger (from §4)
   is what sends it.
6. **Flip grounding when you accept the nightly cost**: uncomment
   `GROUNDING_ENABLED` in `workers/cron/wrangler.toml` and
   `npx wrangler secret put GEMINI_API_KEY -c workers/cron/wrangler.toml`, then
   `npm run deploy:cron`. Note the coupling: this switches on BOTH the nightly
   Deadline Radar refresh (default cap 50/night) and the quarterly scorecard
   sweep (default cap 20/night; one scorecard ≈ three live web calls + a
   2,200-token shaping call). `npm run verify:env` prints both caps while on.
7. **Approve the first testimonials** once NPS answers arrive (admin console,
   needs elevation). Nothing publishes without you; the homepage/pricing quote
   slots stay hidden until the first approval.
8. **Decisions still parked with you** (no code blocked on them): Google OAuth
   env pair (S5 code is live-dark; console setup in plan §7.6), Semester
   Pass / Gift proposals (S19 — env flip reveals interest-capture cards;
   charging needs Stripe products + a `SKUS` entry + a webhook grant branch),
   attorney review of privacy/terms/security (D21), state of
   incorporation/venue for the Terms clause, optional Turnstile keys, optional
   CF Access on the prototype, optional `MRR_MONTHLY_CENTS` for the admin MRR
   tile.
9. **Interview the first cohort** — all ~11 existing users plus week-1 signups.
   The audits called this the highest-information action available, and the
   funnel dashboards now give you the questions to ask.
