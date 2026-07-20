# FlightWay — Production Launch Review (`Jacob_Work`)

**Date:** 2026-07-16 · **Reviewed at:** `0ed948f` → fixes through `c434e5e`
**Scope:** `Jacob_Work` / `flightwayjacobprototype.pages.dev` as its own launchable product. `main` untouched per brief.
**Severity scale:** P0 silent data loss / wrong persisted state / security hole · P1 user-visible incorrect behavior · P2 integration gap / degraded UX · P3 polish · P4 perf/cost.

Every fix below was committed individually, pushed to `Jacob_Work` (the push is the deploy), and **verified against the live site** unless noted.

---

## 1. Executive summary — issues found this pass

### P0 — Internal repo files were publicly served, including a live credential
`pages_build_output_dir = "."` uploads the whole repo as the static site. Verified live before the fix: `docs/CONVERSATION_HANDOFF.md` (containing the probe account **password** removed in this pass), `wrangler.toml` (D1/KV ids), `package.json`, `package-lock.json`, `scripts/*`, `.github/workflows/*`, `.gitignore`, `CLAUDE.md`, root `HANDOFF_*.md`. (`functions/`, `migrations/`, `node_modules/` were already excluded by Pages.)
**Fixed `bf1244f`:** `_redirects` 302-blocks those paths (evaluated before static assets — verified live, all now 302); password stripped from the doc. **Residual, manual:** the probe account `fwpivotprobe716@gmail.com` must be deleted or its password rotated, and old per-deployment URLs (`<hash>.flightwayjacobprototype.pages.dev`) still serve historical snapshots of the doc — delete old deployments in the dashboard or accept the (unguessable-URL) exposure.

### P1 — Anonymous `/resume-parse` had no rate limit in front of Gemini
The endpoint is anonymous by design (quiz flow runs pre-signup) and fans out to multiple Gemini calls including extraction of up-to-4 MB uploads ([resume-parse.js](../functions/resume-parse.js)) — an open cost/abuse vector, the same class fixed for `/send-results` in `67dc067`. **Fixed `f3c6e24`:** per-IP 20/hour (campus-NAT tolerant).

### P1 — ~19 Gemini call sites had no timeout at all
`timeoutMs` was opt-in in `geminiGenerateContent` ([_lib.js:337](../functions/_lib.js)); every `callGeminiJson` site that omitted it (17 files: interview-prep, sim-feedback, stretch-fits, sim-mirror, resume-parse, portal-snapshot, profile-alignment, sector-fit-sheet, focus-keywords, `_lib/roadmap.js`, resume-extract, derive-career, objective/personality patches) **plus the custom callers in `chat.js` (Marco) and `career-analysis.js` (deep dive)** made unbounded upstream fetches — Workers `fetch` never times out, so one hung connection held the Function until the client gave up. **Fixed `a577426`:** 30s default inside the single funnel `geminiGenerateContent`; explicit timeouts/deadline budgets unchanged; aborts stay retryable-503 so fallback models still engage.

### P1 — Cache-buster mismatches were serving year-stale files to repeat visitors
Six shared assets carried different `?v=` stamps on different pages. Three were real staleness bugs given `/assets/*`'s 1-year immutable cache: `flightway-2.css` changed 07-16 but `pricing.html` was pinned at `20260713b`; `events.js` and `flags.js` changed 07-09 but several pages (e.g. `auth.html`'s `flags.js` at `20260703p`) carried pre-change stamps. **Fixed `810595c`:** all six unified to `?v=20260716h` on every referencing page (stamps-only diff, verified).

### P1 — Weekly nudge emails linked users to the wrong site
`workers/cron` had `SITE_URL = "https://flightway.ai"` (main production) while its D1 is the prototype's — every task link and unsubscribe link landed where the recipient has no account and `/unsubscribe` doesn't exist ([workers/cron/index.js:32](../workers/cron/index.js)). Same dead-host class as the pivot-analysis bug fixed in the 11-item pass. **Fixed `c434e5e`** in-repo; **requires `npm run deploy:cron` to take effect** (manual — worker deploys are separate from the Pages push).

### P2 — Dead CI deploy job failed on every push
`deploy-jacob-work.yml`'s deploy job pushed to the defunct `flightwayprototype` project and failed every run (`CLOUDFLARE_API_TOKEN` repo secret unset; last ~5 runs all red). The real deploy is the Pages git integration. **Fixed `1c22c60`:** deploy job removed, verify job (hub:verify + live hub:smoke) kept. `deploy-igor-work.yml` (igor_work branch) and `deploy-pages.yml` (main) reference the same unset secrets — left alone (not this branch's deploy path).

### P2 — No 404 page; every bad URL served the landing page with HTTP 200
Pages' SPA fallback returned `index.html` for any unknown path. **Fixed `bf1244f`:** branded `404.html` (nothing client-routes; hash-only navigation). Verified live: unknown paths now 404.

### P2 — No security headers
`_headers` had only cache directives. **Fixed `f3c6e24`:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (nothing frames the app), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` site-wide; verified live. **Deliberately no CSP** — every page uses inline scripts/styles; a real policy needs its own tested pass.

### P2 — Unbounded authed write payloads
`PUT /profile/quiz` and `PUT /profile/roadmap` accepted arbitrarily large JSON into D1 rows. **Fixed `11a25ae`:** 1 MB / 2 MB caps (~10× realistic worst case). Dossier was already capped (4,000 chars in `saveDossier`).

### P2 — No favicon, robots.txt, sitemap, or meta descriptions; dead legal links
**Fixed `ef02cab`:** brand-orange SVG favicon on all 13 pages, `robots.txt` (+ sitemap pointer), minimal `sitemap.xml`, meta descriptions on quiz/hub. Verified live. **Still open:** `og:image` needs a real 1200×630 asset (manual), and footer **Privacy/Terms links point to `#` — no legal pages exist** (legal copy is a manual item; the app collects emails, passwords, and resumes).

### P3 — Repo hygiene
`node_modules/` (345 files, all devDependencies — nothing in `functions/`/`workers/` imports an npm package, CI runs `npm ci`, Pages never uploaded it) and 3 `.DS_Store` files were git-tracked; `docs/.Rhistory` was an empty stray R artifact. **Fixed `5bf3141`:** untracked/deleted + `.gitignore` extended.

### P4 — Noted, not fixed (deliberate)
- Assets ship **unminified** via the git build (the minifying `pages-deploy.mjs` path is dead by design). Largest hot files: `flightway-pages.css` 240 KB, `quiz-app.js` 192 KB, `careers.json` 336 KB — edge brotli mitigates; fine at launch traffic.
- `assets/js/app/artifacts.js` and the dead render helpers in `skill-gap-tracker.js` remain unreferenced code on disk (known deferred cleanup).
- The legacy `gap-progress` server action is still live **by design** for stale cached clients — its math is absolute-value with the immutable `vBase` pattern (verified, no compounding); `complete-step`/`revert-step` are superseded no-ops.

---

## 2. Full findings table

| # | Issue | Sev | Evidence | Status |
|---|-------|-----|----------|--------|
| 1 | docs/config/scripts/CI publicly served; live password in served doc | P0 | live 200s pre-fix; `docs/CONVERSATION_HANDOFF.md:897` | fixed & pushed `bf1244f`; account rotation + old-deployment cleanup manual |
| 2 | `/resume-parse` anonymous, unlimited, multi-Gemini | P1 | `functions/resume-parse.js` (no `checkRateLimit` pre-fix) | fixed & pushed `f3c6e24` |
| 3 | No default Gemini timeout; ~19 unbounded call sites | P1/P4 | `functions/_lib.js:337`; chat.js/career-analysis.js custom callers | fixed & pushed `a577426` |
| 4 | Buster mismatch → year-stale `flightway-2.css`/`events.js`/`flags.js` | P1 | stamps vs `git log -1 --format=%cs` per asset | fixed & pushed `810595c` |
| 5 | Cron emails link to flightway.ai (wrong host, no `/unsubscribe`) | P1 | `workers/cron/wrangler.toml`, `index.js:32` | fixed & pushed `c434e5e`; needs manual `deploy:cron` |
| 6 | CI deploy job fails every push (unset secret, dead project) | P2 | `gh run list` — all recent runs red | fixed & pushed `1c22c60` |
| 7 | No real 404 (SPA fallback, HTTP 200 for bad URLs) | P2 | live probe pre-fix | fixed & pushed `bf1244f` |
| 8 | No security headers | P2 | `_headers` pre-fix | fixed & pushed `f3c6e24` |
| 9 | Unbounded `PUT /profile/quiz` & `/profile/roadmap` bodies | P2 | handlers pre-fix | fixed & pushed `11a25ae` |
| 10 | No favicon/robots/sitemap/meta-desc | P2 | live probes pre-fix | fixed & pushed `ef02cab` |
| 11 | Privacy/Terms footer links are `href="#"`; no legal pages | P2 | `index.html:356`, `roadmap.html:57` | not fixed — legal copy is Jacob's call (manual) |
| 12 | `node_modules`/`.DS_Store` tracked; stray `.Rhistory` | P3 | `git ls-files` | fixed & pushed `5bf3141` |
| 13 | `og:image` missing | P3 | `index.html` head | not fixed — needs a real 1200×630 asset |
| 14 | Unminified assets via git build | P4 | dead minify path in `scripts/pages-deploy.mjs` | not fixed — edge brotli suffices at launch scale |
| 15 | Dead client files (`artifacts.js`, SGT dead helpers) | P4 | no page loads them | not fixed — known deferred cleanup, low value/risk |

## 3. Manual-only checklist for Jacob (genuinely outside repo reach)

**Cloudflare Pages dashboard — `flightwayjacobprototype` project:**
1. **`SESSION_PEPPER`**: set as a real secret. Today it falls back to `GEMINI_API_KEY`, then the constant `'flightway-dev-pepper'` (`functions/_lib/auth.js:56`). ⚠️ Setting it invalidates every existing session hash — all users re-login; do it at a quiet moment.
2. Confirm/set: `GEMINI_API_KEY` (secret), `RESEND_API_KEY` (secret), `SITE_URL=https://flightwayjacobprototype.pages.dev` (was observed unset 07-16; code falls back correctly but set it explicitly), `FROM_EMAIL` on a **Resend-verified domain** (code default is `Flightway <hello@flightway.ai>` — verify flightway.ai in Resend or production sends will fail), `UNSUB_SECRET` and `INTENT_PEPPER` (both currently fall back to guessable constants), `MAILING_ADDRESS` (CAN-SPAM), `PAYWALL_ENABLED` stays unset/false until pricing launches. Optional: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_RESUME_MODEL`, `GEMINI_USE_SEARCH`.
3. **`ALLOWED_ORIGIN`**: live behavior is already correct (hostile-origin preflight gets the allowlist's first entry back, verified). Confirm whether it comes from the dashboard or `wrangler.toml [env.production.vars]` so it doesn't silently change when that file moves.
4. **Delete old deployments** (or accept unguessable-URL exposure of pre-`bf1244f` snapshots that still serve `docs/` etc.).
5. **Probe account** `fwpivotprobe716@gmail.com`: delete it (portal → Doom button after login, or D1) or rotate its password — the old password was publicly readable.

**D1 (remote `flightway-db`, id `e9aa71fb-dbf8-482d-ba86-5c941cdedee0`):**
6. Confirm applied migrations match the repo, in order: `0001_auth`, `0002_career_analyses`, `0003_onet_careers`, `0003_onet_careers_seed` (note: two 0003 files; the seed was chunk-applied manually per the 07-10 handoff — 759 `onet_careers` rows expected), `0004_onet_collar_scope`, `0005_derived_careers`, `0006_v2_pricing`, `0007_v2_execution`, `0008_v2_entitlements`, `0009_v2_notifications`, `0010_v2_artifacts`.

**Cron worker (`flightway-cron`):**
7. Run `npm run deploy:cron` to pick up the SITE_URL fix (`c434e5e`), and set its secrets: `RESEND_API_KEY`, `FROM_EMAIL`, `UNSUB_SECRET` (must match the Pages project's), `MAILING_ADDRESS`.

**Legal / content:**
8. Privacy policy + Terms pages (footer links are dead `#` today). The app stores emails, password hashes, resumes, and AI-generated profiles — don't launch publicly without at least a privacy policy.
9. `og:image` (1200×630) for link sharing.
10. When a custom domain lands: update `robots.txt` + `sitemap.xml` hosts, `ALLOWED_ORIGIN`, `SITE_URL` (Pages + cron worker), and re-verify Resend domain alignment.

**GitHub repo settings (only if ever reviving wrangler-action deploys):** `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets are unset; `deploy-pages.yml` (main) and `deploy-igor-work.yml` still reference them.

## 4. Checked and found clean

- **All six test suites pass** post-fixes: `test:vectors` (42), `onet:test`, `verify:aliases` (12/4 files), `hub:verify`, `test:weekly` (47), `test:entitlements`. `node --check` clean on all 181 JS files. `pages:smoke` 5/5 against the live site.
- **The prior audit's 21 issues have NOT regressed** across the 237 commits since `980b1dd` — specifically re-verified: upload merge includes `mergeVectorInputs`/`mergeCareerFocus`; `quizPayloadHash` covers vectors/refine/academics/resume/focus/patch timestamps; hydration idempotency has dedicated passing tests; all chat pivots write strict sources (`coach_pivot`/`deep_dive_pivot`) that `recordCareerFocus` catalog-validates or rejects (the Gemini-verbatim fallback can no longer persist junk); `gap-progress-sync` is the single vector-progress writer (3 trigger sites, one writer; `complete-step`/`revert-step` no-op'd); full-catalog-scan-per-lookup is gone (`singleSocFit`).
- **Auth foundation:** PBKDF2-100k + timing-safe compare + dummy-hash on unknown user; reset tokens hashed at rest, single-use, 1h TTL, sessions destroyed on reset; cookies `HttpOnly; Secure; SameSite=Lax`; D1 fully parameterized (the one dynamic table name is a hardcoded const list in `account.js`); rate limiting broad across auth/AI endpoints.
- **XSS:** coach markdown escapes `&<>` before formatting; advisor chat uses `textContent`; user text is fenced before Gemini prompts.
- **Secrets:** tree + full git history clean (Google/Resend/OpenAI/GitHub key shapes, private keys); `.dev.vars` never committed; `.dev.vars.example` has empty keys.
- **CORS:** allowlist verified active on the live deployment (no `*`, no echo of hostile origins).
- **Pricing/entitlements ship dark correctly:** `PAYWALL_ENABLED` unset → server reports everyone premium, gates never render; pricing.html is the deliberate fake-door with intent capture; footer/nav links to it are intentional.
- **Cache TTLs** sane (assets 1y immutable + buster convention, data 1d + SWR week, HTML no-cache). No real `TODO`/`FIXME` anywhere (all grep hits are `99-0XXX` SOC-range comments). `aria-live` present on the key dynamic surfaces (portal fit, quiz, hub, sims).

## 5. Commit log (this review, in order)

1. `bf1244f` — Block publicly served internal repo files; add real 404 page
2. `5bf3141` — Untrack node_modules and .DS_Store; gitignore them plus .Rhistory
3. `1c22c60` — CI: drop the dead deploy job that failed on every Jacob_Work push
4. `f3c6e24` — Security: rate-limit anonymous /resume-parse; add baseline security headers
5. `11a25ae` — Security: cap PUT /profile/quiz and /profile/roadmap payload sizes
6. `a577426` — Bound every Gemini call: default 30s timeout in geminiGenerateContent
7. `810595c` — Unify per-asset cache-buster stamps site-wide (?v=20260716h)
8. `ef02cab` — Production basics: favicon, robots.txt, sitemap.xml, meta descriptions
9. `c434e5e` — Cron worker: point nudge-email links at the host its users live on
10. *(this report)* — docs/PRODUCTION_LAUNCH_REVIEW.md

**Judgment calls made without consultation (per brief):** blocked internal paths via `_redirects` 302→/ rather than Functions middleware (zero runtime cost, verifiable immediately); kept the CI verify job while deleting only the dead deploy job; chose 20/hr/IP for resume-parse (campus NAT tolerance); 30s Gemini default rather than per-site values (single funnel, explicit values preserved); unified all six mismatched busters rather than only the three provably stale (the mismatch itself is the hazard); did **not** delete the leaked-password probe account myself (live-data deletion left to Jacob); left pricing links live (fake-door is deliberate and ships dark).
