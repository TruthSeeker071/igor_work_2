# Branch & Environment Protocol

How to move code between `Jacob_Work` and `main`, and therefore between
`flightwayjacobprototype.pages.dev` and `flightway.ai`, without breaking either.

Read this before your first push. After that, `npm run env:status` tells you
everything on this page that is actually true right now.

---

## 1. The map

There are **two Cloudflare Pages projects** in one account. They are separate
projects with separate secrets, not two environments of one project.

| | PROTOTYPE | PRODUCTION |
|---|---|---|
| Git branch | `Jacob_Work` | `main` |
| Pages project | `flightwayprototype` | `flightway` |
| Public URL | flightwayjacobprototype.pages.dev | **flightway.ai** |
| Stripe key | test (`sk_test_…`) | live (`sk_live_…`) |
| Stripe prices used | `STRIPE_PRICE_*_TEST` | `STRIPE_PRICE_*` |
| Who sees it | just us | real students |

They **share** two things, and this matters more than anything else on this page:

- **One D1 database** — `flightway-db`. There is no staging database. Anything
  you write from the prototype lands in the same table a real user reads.
- **One KV namespace** — `COACH_KV`. Usage counters and caches are shared, so a
  cap you burn testing on the prototype is burnt for that user in production.

There is also a **third deploy target** that is not a Pages project at all:

| | CRON |
|---|---|
| What | `flightway-cron`, a standalone Worker |
| Deploy | `npm run deploy:cron` — **not** triggered by any git push |
| Config | `workers/cron/wrangler.toml` |
| Secrets | its own store, shared with neither Pages project |

Forgetting the cron is its own target is how it sat with zero secrets and
silently sent no email for two weeks.

---

## 2. The one rule

**Code flows `Jacob_Work` → `main`. Never the other way.**

`main` is a fast-forward of `Jacob_Work`. Nothing is authored on `main`, nothing
is hotfixed on `main`, nothing is merged into `main` from anywhere else. That
invariant is what makes promotion a one-line, zero-conflict operation and
rollback trivial.

`npm run env:status` prints `in main, not in Jacob_Work` — if that number is
ever above 0, the invariant is broken. Fix it before doing anything else
(§7 Recovery).

---

## 3. The daily loop

```bash
npm run env:status
```
Start here. Confirms your tree is clean, both sites are serving their branch
tip, and nothing is half-deployed from last time.

Work, then:

```bash
npm run gates:unit
```
~20s, 47 gates, offline. Every commit. If this is red, stop.

```bash
git push origin Jacob_Work
```
**This is the prototype deploy.** Cloudflare builds it automatically via the
GitHub integration. Do not run `npm run deploy:prototype` — the direct wrangler
upload path is unreliable and unused.

```bash
npm run env:status
```
Wait for `deployed` to match `origin/Jacob_Work`. A build takes 1–3 minutes. If
it stays behind for more than ~10 minutes the Cloudflare build queue has
stalled — see §8.

Then verify the actual change on the prototype URL before even thinking about
production.

---

## 4. Promoting to production

Do this deliberately, not reflexively. `main` is the live site for real users.

**Pre-flight — all five, no skipping:**

```bash
npm run gates
```
The full 50, ~80s. Adds the complete 330-cell `layout:check` and `perf:check`.
`gates:unit` is not sufficient for a production promotion.

**A green `gates` says nothing about flightway.ai.** The `pages:smoke` gate
inside it targets the PROTOTYPE: `scripts/smoke-pages.mjs` defaults to
`https://flightwayjacobprototype.pages.dev` and `scripts/run-gates.mjs` does not
override it. Smoke production explicitly — it is the only pre-flight step that
actually loads the live site:

```bash
SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke
```

```bash
npm run verify:env
```
Both projects and the cron Worker have every required secret.

```bash
npm run env:status
```
`in main, not in Jacob_Work` must read **0**. If it doesn't, §7.

Confirm the change works on flightwayjacobprototype.pages.dev with your own
eyes. The prototype exists for exactly this.

**Promote:**

```bash
git push origin Jacob_Work:main
```

That syntax pushes the local `Jacob_Work` ref to the remote `main` branch
without checking out `main` at all. Since `main` is always an ancestor, it is
always a fast-forward.

**Post-flight:**

```bash
npm run env:status
```
Both rows should read `✓ serving the branch tip`, PRODUCTION in `LIVE` mode,
PROTOTYPE in `TEST`.

Then curl the thing you actually changed on flightway.ai. Not the homepage —
the thing you changed.

---

## 5. What differs per environment, and who handles it

You do **not** hand-flip any of this. That is the point.

**Stripe mode — automatic.** `priceIdFor()` in `functions/_lib/stripe.js` reads
`stripeTestMode(env)` and picks `STRIPE_PRICE_<TIER>_TEST` under a test key,
the unsuffixed var under a live key. Both sets live in `wrangler.toml`. The key
already installed on each project selects its own prices. Never delete one set
to "clean up" — that re-breaks checkout on the prototype.

**Secrets — set per project, once.** `wrangler.toml` `[vars]` are shared by both
projects because both build from this repo. Anything that must differ *and* is
sensitive is a secret, set on each project separately. `npm run verify:env`
lists what is missing where.

**`ALLOWED_ORIGIN`** covers both hosts, so CORS works on either without a flip.

**Canonical URLs are hardcoded to `flightway.ai`** in `index.html`, `quiz.html`
and `pricing.html` — deliberately absolute, not derived from `location.host`.
Both projects serve identical files, so without this the two hosts compete as
duplicate content. The prototype pointing at production is correct behaviour.

**`sitemap.xml`** likewise names `flightway.ai` on both hosts.

**`robots.txt` does NOT — and that is the point.** Since S2 it is served by
`functions/robots.txt.js`, not a static file, and it answers per host: the
canonical host gets the allow-list plus the sitemap line, every other host
(the prototype, every preview alias) gets `Disallow: /`. `functions/_middleware.js`
adds `X-Robots-Tag: noindex, nofollow` to every response on those same hosts.
The whitelist lives in `functions/_lib/host.js` — one definition, read by the
header, the robots body and the `verify:meta` gate. If you ever need to check
which side of the line a host falls on, curl `/robots.txt` on it.

---

## 6. The three config stores

Nothing here is reachable from the others. This is the single most common
source of "I set it and it didn't work".

```bash
npx wrangler pages secret list --project-name flightway
```
```bash
npx wrangler pages secret list --project-name flightwayprototype
```
```bash
npx wrangler secret list -c workers/cron/wrangler.toml
```

**Pages secrets bind at BUILD time.** Setting one does not affect the running
deployment — you must rebuild. `git commit --allow-empty` + push is the way.
**Worker secrets take effect immediately**, no redeploy.

`UNSUB_SECRET` must be **byte-identical in all three stores** or unsubscribe
links fail signature verification. `wrangler` can only list names, never
values, so no tool can check this for you. To force a match, rotate everywhere
at once:

```bash
U=$(openssl rand -hex 32) && printf '%s' "$U" | npx wrangler pages secret put UNSUB_SECRET --project-name flightway && printf '%s' "$U" | npx wrangler pages secret put UNSUB_SECRET --project-name flightwayprototype && printf '%s' "$U" | npx wrangler secret put UNSUB_SECRET -c workers/cron/wrangler.toml; unset U
```

Then rebuild both Pages projects.

Values that are **not** sensitive — `FROM_EMAIL`, `MAILING_ADDRESS`, `SITE_URL`
— belong in `wrangler.toml` as vars, never as secrets. A secret you cannot read
back is a value nobody can verify, which is how three environments silently
drifted to different sending identities. If a var and a secret both exist, the
**secret wins** — delete the secret to let the versioned value govern.

---

## 7. Recovery

**`in main, not in Jacob_Work` is above 0.** Someone committed to `main`
directly. Get those commits onto `Jacob_Work` first, then resume normal flow:

```bash
git checkout Jacob_Work && git merge origin/main && npm run gates && git push origin Jacob_Work
```

**A bad commit reached production.** Do not force-push `main`. Revert forward on
`Jacob_Work`, then promote — history stays linear and the prototype stays ahead:

```bash
git revert <sha> && npm run gates && git push origin Jacob_Work && git push origin Jacob_Work:main
```

**Instant rollback.** In the Cloudflare dashboard, Pages → `flightway` →
Deployments → the last good one → "Rollback to this deployment". That is
faster than any git operation and does not touch the repo. Use it first if the
live site is broken, then fix forward in git.

**Syncing production → prototype.** Normally impossible-by-construction:
`main` is an ancestor of `Jacob_Work`, so the prototype already contains
everything production has. `npm run env:status` proves it — `in main, not in
Jacob_Work: 0`. If that number is non-zero, you are in the first recovery case
above, not doing a sync.

---

## 8. Gotchas, each one learned the hard way

**Deployed ≠ pushed.** A green `git push` means GitHub accepted it, not that
Cloudflare built it. Always confirm with `npm run env:status`. If a build
stalls (`Failed: unable to submit build job`, or stuck at `queued:active`),
re-trigger with `git commit --allow-empty -m "chore: retrigger" && git push`.

**`robots.txt` used to be edge-cached for 4 hours** and could serve an old body
after a deploy while everything else was new. It is a Function now and sets its
own `Cache-Control`: one hour on the canonical host, `no-store` everywhere else,
precisely so a stale *allow* can never sit in a cache in front of a host that
should be disallowed. Still worth checking `cf-cache-status` before concluding a
build was partial.

**A Pages Function shadows a static asset at the same path.** Verified live on
2026-07-24: `functions/robots.txt.js` answers `/robots.txt` even when a
`robots.txt` also exists in the repo. S2 deleted the static file anyway so there
is only one source, but the precedence is now a known fact rather than a guess —
which is what makes S13's `functions/sitemap.xml.js` and S14's `llms.txt` safe to
build the same way. Note that filenames containing a dot route fine
(`robots.txt.js` → `/robots.txt`).

**flightway.ai rewrites `mailto:` links.** It is a full Cloudflare zone with
Email Address Obfuscation on, so `mailto:x@y.com` becomes
`/cdn-cgi/l/email-protection#<hex>`. The pages.dev host does not do this, so
grepping for an email address finds it on the prototype and "loses" it on
production. The link is fine.

**Immutable asset URLs.** Never curl a `?v=` busted asset URL to prove a
deploy — that URL is cached forever by design. Check an HTML file instead.

**The repo root is publicly served.** `pages_build_output_dir = "."` uploads the
whole tree, so any new file at the root is reachable at
`https://flightway.ai/<name>`. Add a `302` rule to `_redirects` for anything
that is not meant to be public. `docs/`, `scripts/`, `migrations/`, `workers/`
are already blocked.

**Your shell's cwd resets between commands.** A backgrounded `npm run gates`
launched from the wrong directory fails with `ENOENT: package.json` and can
still look like it exited 0 if you only read the tail. Use absolute paths or
`cd` inside the command.

**One D1, no staging.** Testing account flows on the prototype writes real rows
that production reads. Prefix throwaway test accounts so they are identifiable,
and remember that deleting one is a production data change.

**The cron is not deployed by git.** `npm run deploy:cron`, always, separately.

---

## 9. Command reference

| Command | What it tells you / does |
|---|---|
| `npm run env:status` | branch tips, deployed shas, Stripe mode, branch delta, tree state |
| `npm run verify:env` | every required secret across all three config stores |
| `npm run gates:unit` | 47 offline gates, ~20s — every commit |
| `npm run gates` | all 50 incl. full layout, ~80s — before promotion. Its `pages:smoke` hits the PROTOTYPE, not flightway.ai (§4) |
| `git push origin Jacob_Work` | deploy the prototype |
| `git push origin Jacob_Work:main` | promote to production |
| `npm run deploy:cron` | deploy the nudge Worker (nothing else does this) |
| `npm run pages:smoke` | Playwright page-load smoke; `SMOKE_BASE_URL=…` to retarget |
