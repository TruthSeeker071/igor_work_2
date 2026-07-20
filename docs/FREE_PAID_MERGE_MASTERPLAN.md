# Free/Paid Merge Master Plan — main becomes the one product

**Status: §7 PHASES 1–5 EXECUTED 2026-07-19/20 (`cd74d79..2a69ff6` on `Jacob_Work`). Steps 6–7 remain and are human-gated.**
Everything §2/§3/§3.5/§1/§4 describes is built, tested and pushed; `PAYWALL_ENABLED`
is still `false` and Stripe is still test-mode-only, exactly as §7 requires.
What is done:
- **§2 built** — `functions/_lib/plan-limits.js` (`FEATURE_LIMITS` + `checkFeatureLimit`
  + `remainingForUser`), `GET /auth/me` serves `remaining{}`, client `FWEnt` gained
  `remaining()`/`setRemaining()`/`refresh()`/`lock()`.
- **§3 built** — `functions/_lib/stripe.js` (raw fetch + Web Crypto, no SDK),
  `functions/stripe/{checkout,webhook,portal}.js`, migration `0015_stripe_billing.sql`
  **applied to remote D1**, `npm run stripe:check`.
- **§3.5 built** — `isDevTester` at all three chokepoints; dev traffic excluded from
  `pricing_intents`. Inert until `DEV_TEST_EMAILS` is populated in the Pages dashboard.
- **§1 wired** across chat, career-switch-chat, career-roadmap, derive-career,
  stretch-fits, weekly-plan, receipts, notify-prefs, the cron digest, the sim deep
  tier and the why-this-match explainer.
- **§4 done** — phase5 framing folded in on theme tokens; `pricing.html` copy now
  matches what actually ships.
- **§6 run** — every suite in the checklist passes (see the handoff addendum).
  **NOT done: the live test-mode purchase run** — Cloudflare's build queue stalled
  ("unable to submit build job" ×3), so the branch is pushed but not deployed, and
  the card-entry step needs Jacob regardless.
- **§5 `main` cutover — not done;** `main` remains far behind `Jacob_Work`, and the
  repo still has ZERO GitHub secrets, so push-to-main would not deploy.

**Audience:** the Claude Fable session executing this (Ultracode effort).
**Branch / deploy:** continue on `Jacob_Work` (`git push origin Jacob_Work` auto-deploys `flightwayjacobprototype.pages.dev` via Cloudflare Pages' GitHub integration — unchanged). The `main` cutover (§5) is a separate, explicitly-confirmed final step — pushing to `main` triggers a production deploy to `flightway.ai` via `.github/workflows/deploy-pages.yml` (`wrangler pages deploy . --project-name=flightway --branch=main`) — **but note the workflow's repo secrets are currently UNSET (§0 CI bullet), so that deploy will fail until Jacob creates them.** Never push to `main` autonomously; it needs Jacob's explicit go each time, same as any other hard-to-reverse production action.
**Origin:** commissioned 2026-07-17 by Jacob to make `flightway-ai/flightway`'s `main` branch — currently the public GitHub default — the foundation of a coherent free + paid product, with `Jacob_Work`'s feature set becoming a paywalled tier rather than a separate prototype. Written after a full repo audit (git history/diff, entitlements code, migrations, CI workflows, pricing page, CONVERSATION_HANDOFF.md).

**Precondition — MET (verified 2026-07-18):** `docs/POST_SHIP_FIX_PLAN.md` (the 38-item Pillar W / Resume Builder v3 / Mock Interview post-ship audit) was fully executed (commits b4de7ba..5602a48) and the doc is archived at `docs/archive/POST_SHIP_FIX_PLAN.md`. The performance revamp masterplan also executed and archived after it. This plan is clear to start.

---

## Binding scoping decisions (already made by Jacob — do not re-litigate)

1. **Foundation strategy:** replace `main`'s stale pre-hub codebase with a paywall-gated version of the current (post-fix-plan) `Jacob_Work` tree. One codebase going forward. Old `main`'s simpler architecture is retired, not forward-ported to or reconciled with.
2. **Payments:** build real Stripe billing in this pass — not a fake-door extension. `pricing.html`'s existing CTAs currently only write to `pricing_intents` (click-intent capture, no charge); that becomes real checkout.
3. **Sequencing:** after the 38-item fix plan, not interleaved with it (see Precondition above).
4. **Production risk:** `flightway.ai` (main's live deploy) has no real users today — safe to treat as fully replaceable, no user-data continuity concerns.
5. **Feature tiering direction:** approved starting matrix is §1 below — free tier keeps the full Hub map/matching experience (the funnel), paid tier is Marco unlimited + AI-cost surfaces + the named "Flight Plan" delivery mechanics + resume/interview tools.
6. **Collaborators:** Leo and Igor (`TruthSeeker071`) do not need to be looped in — this is solely Jacob's call to make and ship.
7. **Timeline:** exploratory, no hard date — prioritize correctness over speed. Still sequence Phase H-style safety items first within this plan where relevant.
8. **`main` cutover mechanics:** clean tree replacement (not a history-preserving merge/rebase reconciling main's old commits). Fold in the dormant `phase5-free-tier-framing` branch's copy (the "why this match" locked-teaser framing on `dashboard.html`) as part of this work — it's copy/IA-only and already on-theme with §1's gating.

---

## §0 — Ground truth (re-verified 2026-07-19 at `aae9d15`; re-verify before relying on specifics, this repo moves fast)

- `main` (`d1da042`, unmoved) vs `Jacob_Work`: **332 files changed, ~79,245 insertions, 325 commits**. `main` predates the O*NET hub/vector map, portal, Marco advisor grounding, resume builder, mock interview, Career Tester sims, the Opportunity Finder, the user-object storage, and all pricing/entitlements scaffolding. Live-confirmed 2026-07-19: `flightway.ai` is serving that stale pre-hub build (zero hub/Marco mentions on its landing page; its `/dashboard` lacks the hub markers the prototype serves) while the prototype is current. Do not attempt a feature-by-feature diff-merge against it — treat `main`'s current tree as disposable per decision #1.
- **`main` and `Jacob_Work` share the exact same D1 database and KV namespace** (`wrangler.toml`: `database_id = e9aa71fb-dbf8-482d-ba86-5c941cdedee0`, `COACH_KV` id `90baa154928941c3b45ff0ecb4894f05`, identical in both `[[d1_databases]]`/`[[kv_namespaces]]` and `[env.production]`; re-verified identical in both branches 2026-07-19). This is a code-and-Functions cutover, not a data migration — nothing to backfill or reconcile at the data layer. Note the profile store inside that shared DB has since moved to `user_profiles` (see the user-object bullet below); `users` and its `plan`/`plan_expires_at` columns are untouched.
- **Entitlements already exist, ship dark:** `functions/_lib/entitlements.js` (`PLAN_RANK = {free:0, premium:1, lifetime:2}`, `requirePlan(env, email, need)`, `paywallEnabled(env)` reads Pages var `PAYWALL_ENABLED`) + client mirror `assets/js/shared/entitlements.js` (`FWEnt.has()`/`FWEnt.gate()`, boots off `GET /config`). Already wired with `requirePlan('premium')` in: `mock-interview.js`, `resume-doc.js`, `resume-builder.js`, `resume-tailor.js`, and `opportunities.js` (the Opportunity Finder, landed 2026-07-19 after earlier revisions of this doc) — plus `interview-prep.js`, which is now **DEAD (no callers; header says delete after this merge)**: delete it in this pass rather than gating it. `users` table already has `plan` (`free|premium|lifetime`) and `plan_expires_at` columns (migration `0008_v2_entitlements.sql`).
- **`GET /config` currently returns only `{ paywallEnabled }`** (`functions/config.js`) — an anonymous, global flag. **Correction (2026-07-19) to this doc's earlier claim that "nothing serves" the per-user entitlement: it IS served.** `GET /auth/me` returns `{ email, plan: ent.effective, planRaw, paywall }` from `resolveEntitlement()` (`functions/auth/me.js:24-26`), and client `FWEnt` already fetches `/auth/me` for the plan whenever `/config` reports the paywall on (`assets/js/shared/entitlements.js:28`). What nothing serves is **per-feature usage counters** — §2's job shrinks to adding `remaining: {...}` to that existing flow so `FWEnt` can show "3 of 5 left" UI, not building per-user plan awareness from scratch.
- **A daily-cap primitive now exists — generalize it, don't invent one.** The post-ship fix plan landed it: `mock-interview.js` spends a 3-sessions/day cap via an atomic `COACH_KV` counter (26h `expirationTtl`), backed by a stateless peppered session token (`functions/_lib/interview-token.js`, SHA-256 of pepper+email+timestamp, `SESSION_PEPPER` env var) that closes replay/bypass holes without per-session storage. §2's `checkFeatureLimit` should be this exact pattern extracted into `entitlements.js`/`plan-limits.js` with a per-feature key.
- **`pricing.html` is fake-door only, but its copy has firmed up (re-verified live 2026-07-19):** Flight Plan Monthly ($9.99/mo, "Start free trial" CTA — note: a *free trial* is promised; §3 must either honor it via Stripe `trial_period_days` or change the copy), Flight Plan Annual ($59/yr, toggle), **Lifetime $199 "Founding 100"** (price is now present — the old open item is resolved), Interview Sprint ($29 one-time). **Sprint's live copy says "Two weeks of premium + focused interview prep … No subscription"** — i.e. a time-boxed full-premium pass, *not* the mock-interview-only scoping §1 originally assumed; see the revised Sprint paragraph in §1/§3. All four CTAs still just POST to `pricing_intents` via `functions/waitlist-intent.js` (migration `0006_v2_pricing.sql`); the Annual SKU is real — the billing toggle rewrites the monthly CTA's `data-tier` to `annual` (`pricing.html:177`), so the SKU set remains `monthly`/`annual`/`lifetime`/`sprint`. New fine print since last check: "Under LinkedIn's $14.99 student price" under the monthly CTA. **No Stripe code exists anywhere** (re-verified 2026-07-19: only string matches in `waitlist-intent.js` comments and migrations 0006/0008, not real integration).
- **Zero runtime npm dependencies** (`package.json` has `devDependencies` only: esbuild, playwright, umap-js). This is a deliberate vanilla-JS/no-build-step architecture (see `CLAUDE.md`). **Do not add the `stripe` npm package.** Build Stripe integration the same way Gemini calls are already built in this codebase (`functions/_lib/gemini-json.js`): raw `fetch()` against Stripe's REST API, webhook signature verification via Web Crypto (`crypto.subtle` HMAC-SHA256 — Stripe's documented `Stripe-Signature` scheme is directly reproducible without their SDK).
- **CI/CD — the main-deploy secrets are confirmed MISSING (2026-07-19):** `.github/workflows/deploy-pages.yml` still deploys `main` → the `flightway` project on every push to `main`, using `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets — but `gh secret list -R flightway-ai/flightway` returns **zero repo secrets**, so a push to `main` today would NOT deploy. (Same root cause as the deploy job removed from `deploy-jacob-work.yml` on 2026-07-16 — that workflow is now verification-only: `hub:verify` + a live `hub:smoke` against the prototype.) Jacob must create both secrets before the §5 cutover; re-run `gh secret list` and a harmless dry-run as the §5 preflight.
- `phase5-free-tier-framing` branch (off `main`, unmerged): a 47-line, copy/IA-only diff to `dashboard.html` — adds a `.panel-fit-note` ("A starting point from your quiz answers — not a final verdict") and a locked `.panel-why-teaser` card ("Why this match?" + lock icon + upsell copy). No gating logic, pure UI. Superseded in spirit by §1's real gating but the copy itself is reusable almost verbatim.
- `_redirects` already blocks `/docs/*`, `/scripts/*`, `/migrations/*`, `/wrangler.toml`, `/package.json`, `.github/*`, etc. from public serving (fixed 2026-07-16 after they were found publicly reachable). **Any new root-level file this plan adds (new migration, new doc, new config) needs a matching `_redirects` rule** if it shouldn't be publicly fetchable.
- Latest migration is `0014_drop_quiz_profiles.sql` (`0013` = `user_profiles`, `0014` = the drop of the old `quiz_profiles`) — **so Stripe's migration is `0015`**, not `0013` as this plan originally numbered it. Remote state re-verified 2026-07-19: `npx wrangler d1 migrations list flightway-db --remote` → "No migrations to apply" — everything through 0014 is applied; the old 0011/0012 pending-migrations trap is closed.
- **The canonical user object is live (landed 2026-07-19, after this plan's earlier revisions).** Server profile store is the `user_profiles` table (v2 payloads); client key is `fw_user_v1`; `quiz_profiles` is DROPPED. All profile access goes through facades — server `loadUser`/`saveUser` (`functions/_lib/user.js`), client `FWUser` (`assets/js/shared/user.js`) — and `npm run verify:user` fails on any `fw_hub_quiz_v1`/`loadQuizProfile`/`saveQuizProfile` reference outside the facade layer. Any code this plan adds that reads profile data (school, gaps, focus) must use these facades; run `verify:user` alongside `test:vectors`. Separately, `GROUNDING_ENABLED = "true"` is now committed in `wrangler.toml:41` (production vars) — grounded Pillar W surfaces (chat, weekly plan, opportunities, resume, interview) are live-cost Gemini-with-grounding calls, which reinforces §1's cost-boundary tiering.

---

## §1 — Feature tiering matrix (approved direction; exact caps below are tunable defaults, not final)

Keep every cap/threshold as a single named constant (new `functions/_lib/plan-limits.js` or extend `entitlements.js`) — not scattered magic numbers per file — so Jacob can retune without a redeploy-worthy code change, and so §2's generalized limit-checking has one source of truth.

**FREE (the funnel — must feel complete, not stale):**
- Quiz (`quiz.html`), full post-signup flow (Sharpen Matches, Academics refine) — unchanged, unlimited. This builds the personality/objective vectors; don't gate the core matching inputs.
- Career Hub map (`dashboard.html`) — full O*NET matching visualization, full career detail pages (`career.html`), career comparison tool (`assets/js/hub/career-compare.js`), quantified pivot breakdown on career switch. These are cheap (client-side vector math, no per-use Gemini call) and are the product's core hook.
- Roadmap (`roadmap.html`) — free to view, check off steps, see the semester plan. **One free AI-generated roadmap** (first generation via `career-roadmap.js`) — regeneration and inline Marco waypoint-chat edits become premium (§ below).
- Marco chat (`chat.js`, `career-switch-chat.js`) — capped, default **5 messages/day** free.
- Career Tester sims (`simulation.html`) — `taxi` ("Quick look") and `flight` ("Test flight") tiers free; `deep` ("Deep dive" + Crossroads branching tab) is premium.
- Portal home / readiness meter — free (basic account surface).

**PREMIUM — "Flight Plan" ($9.99/mo · $59/yr · lifetime):**
- Weekly Flight Plan + Receipts + weekly email digest (notify-prefs, cron worker) — the tier's namesake feature.
- Unlimited Marco chat.
- Full AI roadmap regeneration + inline Marco waypoint edits (beyond the one free generation).
- `deep` Career Tester tier + Crossroads scenario replay.
- AI-derived ("fragment") careers (`/derive-career` — costs a live Gemini call per generation, a natural cost boundary) + the full dimension-by-dimension "Why this match?" explainer (currently teased-and-locked on the `phase5` branch — fold that copy in here, backed by real gating instead of pure IA).
- Stretch-fits / growth-path suggestions (already a Tier-B grounded, Gemini-cost surface).
- Artifacts / portfolio evidence log (table + endpoints already exist, UI was portal-cut earlier — consider resurrecting as a premium differentiator rather than leaving fully dark; Jacob's call if this is in scope now or a fast-follow).
- Resume Builder, Mock Interview, and the **Opportunity Finder** panel (`functions/opportunities.js` + `assets/js/app/opportunity-finder.js`, in roadmap.html's focus view — shipped 2026-07-19, after this plan was first written) — all already gated with `requirePlan('premium')`, unchanged.

**Interview Sprint ($29 one-time, a-la-carte):** the live `pricing.html` copy (verified 2026-07-18) defines Sprint as **"Two weeks of premium"** — a time-boxed full-premium pass, not a mock-interview-only unlock as this plan originally assumed. Take the copy's definition: it's already public, and it's *simpler* — Sprint becomes `plan='premium', plan_expires_at = now + 14 days` using the **existing** schema, no new entitlement dimension, no `sprint_expires_at` column, and `effectivePlan()`'s expiry logic already handles the lapse back to free. Confirm this reading with Jacob before building (§9), but default to it.

---

## §2 — Entitlements architecture generalization

The current system is a good foundation (`requirePlan('premium')`, ship-dark via `PAYWALL_ENABLED`) but was built for one binary gate (resume/interview = premium-or-not). §1 needs: per-feature daily/lifetime counters (Marco messages, the one free roadmap regen), and a non-`plan` entitlement (Sprint). Extend, don't replace:

- Add a small **feature-limit table** (`plan-limits.js` or inline in `entitlements.js`) mapping a feature key → `{ free: <limit or null>, resetPeriod: 'day'|'lifetime'|null }`. A `checkFeatureLimit(env, email, featureKey)` helper generalizes the counter pattern that now exists in `mock-interview.js` (atomic `COACH_KV` daily counter, 26h `expirationTtl`, keyed per user+day) — extract it with a per-feature key segment; don't invent a second counter pattern. Where a flow spans multiple calls (like the interview turn→debrief chain), reuse the stateless peppered-token recipe in `functions/_lib/interview-token.js` rather than adding session storage.
- Serve the **feature counters** to the client: the per-user *plan* half of this is already DONE — `GET /auth/me` returns `{ plan, planRaw, paywall }` from `resolveEntitlement()`, and `FWEnt` already boots `/config` then falls back to `/auth/me` for the plan when the paywall is on (§0). What's missing is `remaining: {...}` from the feature counters — add it to that existing `/auth/me` response (or `/config`) so the UI can show "3 of 5 left".
- Marco's 5/day free cap and the roadmap's one-free-generation cap both route through this, alongside the existing `requirePlan` checks for the fully-locked surfaces.
- Client-side `FWEnt` needs a parallel `remaining(featureKey)` or similar so the UI can show "3 of 5 messages today" rather than just a hard block — free tier should degrade gracefully (soft nudges toward upgrade), not slam a wall mid-conversation. Follow the existing `FWEnt.gate()` upgrade-CTA pattern for the hard stops (deep sim tier, AI fragments, Why-this-match, resume/interview).

---

## §3 — Stripe billing build

**No SDK — raw fetch + Web Crypto**, per §0. New files, roughly:
- `functions/_lib/stripe.js` — thin fetch wrapper (`createCheckoutSession`, `createPortalSession`, `verifyWebhookSignature`).
- `functions/stripe/checkout.js` — `POST`, session-gated, creates a Stripe Checkout Session for one of the four SKUs (map `data-tier` values from `pricing.html` — `monthly`/`annual`/`lifetime`/`sprint` — to Stripe Price IDs via env vars, e.g. `STRIPE_PRICE_MONTHLY`), `customer_email` prefilled from the session, `client_reference_id` = user email (or store `stripe_customer_id` once known and reuse it).
- `functions/stripe/webhook.js` — verifies `Stripe-Signature` manually, handles `checkout.session.completed` (mode `subscription` → monthly/annual; mode `payment` → lifetime or sprint, distinguished by the Price ID / a metadata field set at Checkout creation), `customer.subscription.updated`/`.deleted` (sync `plan`/`plan_expires_at`), `invoice.payment_failed` (don't downgrade immediately — Stripe's own retry/dunning handles that; only act on the subscription's actual status transition). **Idempotency:** persist processed Stripe event IDs (new small table) and no-op on replay — webhooks are at-least-once delivery.
- **Schema (migration `0015` — `0013`/`0014` are taken by the user-object storage work; additive only, mirror the style of 0006–0014):** `users.stripe_customer_id` + the webhook-idempotency event-ID table. Sprint needs **no schema of its own** under the two-weeks-of-premium reading (§1): the webhook sets `plan='premium', plan_expires_at = now + 14d`. One rule to encode: a Sprint purchase must never *shorten* an existing entitlement (skip the write if the user is already `lifetime` or has a later `plan_expires_at`).
- Monthly's CTA promises a **free trial** — pass `subscription_data.trial_period_days` at Checkout creation (pick the length with Jacob, §9) or change the CTA copy; don't ship a "Start free trial" button that charges immediately.
- Self-serve cancel/upgrade via a Stripe-hosted **Customer Portal** session (`functions/stripe/portal.js`) linked from the account/portal page — don't hand-build subscription management UI.
- Keep `pricing_intents` capture running alongside real checkout (still useful funnel analytics — CTA click vs. actual purchase).
- **Stripe test mode first.** Wire everything against Stripe test keys, validate a full purchase → webhook → `plan` flip → gated feature unlocks end-to-end on `flightwayjacobprototype.pages.dev` before touching live keys or `PAYWALL_ENABLED=true` in production.
- Existing beta users on `Jacob_Work` who currently see everything unlocked (paywall-dark beta): decide with Jacob whether they're grandfathered a `lifetime`/`premium` grant before `PAYWALL_ENABLED` flips true in production, or reset to `free` and expected to pay. Flag this explicitly rather than assuming.

---

## §3.5 — Developer/tester full access (no payment required)

Developers need the full product — every premium gate open, every cap lifted — without buying a plan, on both the prototype and (post-cutover) production. Mechanism: an **env-var email allowlist**, not a shared test account and not a hardcoded flag.

- **`DEV_TEST_EMAILS`** — a comma-separated Pages env var (set in the Cloudflare dashboard per project/environment, **never committed to the repo**). New helper in `entitlements.js`:
  ```js
  export function isDevTester(env, email) {
    if (!email || !env || !env.DEV_TEST_EMAILS) return false;
    return String(env.DEV_TEST_EMAILS).toLowerCase().split(',')
      .map(s => s.trim()).filter(Boolean).includes(String(email).toLowerCase().trim());
  }
  ```
- **Wire it at the three chokepoints only** — `resolveEntitlement()`, `requirePlan()`, and §2's `checkFeatureLimit()` — each short-circuiting to `{ ok:true, plan:'lifetime', dev:true }` / unlimited before touching D1/KV. Because every gate in the product routes through these, no per-endpoint changes are needed, and the client picks it up for free via `/auth/me`'s resolved entitlement (which already calls `resolveEntitlement`). Chokepoint completeness re-confirmed 2026-07-19: all premium endpoints — including `opportunities.js`, added after this plan was first written — route through `requirePlan`; the only existing usage cap is `mock-interview.js`'s inline KV counter (`mock-interview.js:47-52`), which §2 extracts into `checkFeatureLimit`. No gating path bypasses the three.
- **Why this over a seeded test account:** the D1 database is shared between the prototype and production (§0), so a `plan='lifetime'` row planted for testing would be a real live grant in prod tied to a shareable password. The allowlist instead rides on each dev's **own authenticated login** (emails are session-verified, so the var is inert for anyone who can't actually log in as that address), is revocable instantly without a DB write, and can differ per environment (e.g. populated on `flightwayjacobprototype`, empty or Jacob-only on `flightway.ai`).
- **Keep gating tests honest:** the `dev:true` marker must be carried through so (a) dev accounts are excluded from `pricing_intents`/funnel analytics, and (b) §6's free-tier and Stripe-purchase verification runs use **non-allowlisted** accounts — a dev-overridden account can't tell you whether a gate actually works.
- One-off manual grants remain possible without any of this (`npx wrangler d1 execute` … `UPDATE users SET plan='lifetime' WHERE email=?`) — fine for a single collaborator, but the allowlist is the standing mechanism.
- Cover `isDevTester` + the three short-circuits in `scripts/test-entitlements.mjs` (allowlisted email passes every gate with paywall on; non-listed email still blocked; empty/missing var is a global no-op).

---

## §4 — UI/product coherency normalization pass

The user's explicit goal is one coherent product at two depths, not a free "lite" bolt-on. Once §1's gates are wired:

- Audit every surface this plan touches against the house conventions already established (`CLAUDE.md`, memory): `fw-revealed`/`fw-settled` entrance + `FWPageVeil`, shared nav (`app-nav`), theme tokens (no ad hoc colors — the ~17 known `--fw2-accent` leftovers are a pre-existing, separately-tracked inconsistency, don't scope-creep into fixing those here unless trivial), cache-buster bumps on every touched asset on every referencing page, `data-lucide` icons registered in `lucide-lite.js`.
- Every new gated UI (Marco cap indicator, roadmap regen lock, sim deep-tier lock, fragment/why-this-match lock, artifacts resurrection if in scope) should reuse `FWEnt.gate()`'s existing visual language, not invent a new lock-card style per surface.
- `index.html` and `pricing.html`: once §1 is final, audit copy for accuracy against the actual shipped split (what's free, what's Flight Plan, what's Sprint) — this is inherited automatically once `main` becomes `Jacob_Work`'s tree (§5), so this is a copy-accuracy pass, not a rebuild.
- Fold in `phase5-free-tier-framing`'s copy (§0) as the real, gated version of the "why this match" lock rather than reimplementing similar copy from scratch.

---

## §5 — `main` cutover mechanics

Clean tree replacement (decision #8), executed only after everything above is built, verified, and live-validated on `flightwayjacobprototype.pages.dev` with a real Stripe test-mode purchase run end-to-end.

1. Before touching anything: `git tag legacy-main-pre-merge origin/main && git push origin legacy-main-pre-merge` — cheap insurance, not a hedge against the decision itself.
2. **Create** the `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets — `gh secret list` confirmed the repo has ZERO secrets as of 2026-07-19 (§0), so push-to-main currently does not deploy at all. Jacob sets them (only he can); then verify with `gh secret list` + a harmless dry-run before relying on the mechanism.
3. Confirm `env.production.vars.ALLOWED_ORIGIN` in `wrangler.toml` still covers whatever domains need it post-launch (currently `flightwayjacobprototype.pages.dev,flightway.ai` — fine as-is; trimming the prototype origin out of production is optional cleanup, not required).
4. Get Jacob's **explicit, in-the-moment go-ahead** before the actual `git push origin main` — this is a real production launch, not a reversible local action, regardless of what was pre-approved in this planning doc.
5. Mechanically: replace `main`'s tree with the finished branch's tree (e.g. push the finished branch's commit as `main`'s new tip, or an equivalent clean-replace approach) rather than a history-preserving merge — Jacob does not need old `main`'s commit ancestry retained (decision #8).
6. Immediately after push: live-verify `flightway.ai` the same way `pages:smoke`/live curls verify `flightwayjacobprototype.pages.dev` today (§6) — don't assume the CI deploy succeeded silently.

---

## §6 — Verification checklist

Run the full existing suite (all script names re-verified against `package.json` 2026-07-19; nothing here should regress it): `hub:verify`, `hub:verify:full`, `test:vectors`, `test:weekly`, `test:entitlements`, `grounding:check`, `interview:check`, `resume:*-check`, `verify:aliases`, `onet:test`, `pages:smoke` — plus the suites added since this plan was first written: `verify:user` + `test:user` (run alongside `test:vectors`, standing convention), `test:school`, `test:sync`, `test:opportunities` — against **both** `flightwayjacobprototype.pages.dev` and (post-cutover) `flightway.ai`.

New coverage this plan needs:
- Extend `scripts/test-entitlements.mjs` for the new feature-limit checks (Marco daily cap, one-free-roadmap-regen, Sprint's expiring-premium behavior) and the generalized limit helper from §2, plus the §3.5 dev-tester override cases. All accounts used to *prove gates hold* must be non-allowlisted (§3.5).
- A new `stripe:check` script: mocked webhook signature verification (valid/invalid/replayed), mocked event handling for each of the four SKUs correctly setting `plan`/`plan_expires_at` (no `sprint_expires_at` — §9 resolved Sprint to the existing columns), idempotent replay no-op.
- A live (test-mode) Stripe purchase run for at least one recurring SKU and the one-time Sprint SKU, confirming the webhook actually flips the DB and the gated UI actually unlocks — don't rely on mocks alone for the money path.
- Playwright pass (light/dark/mobile) with a free test account and a premium test account, confirming §1's gates render correctly on both and nothing that should stay free got accidentally locked (the failure mode this whole project is trying to avoid: the free tier reading as `broken` rather than `intentionally lighter`).
- `node --check` on every touched file; live curls confirming cache-busters bumped on every changed asset on every referencing page (standing convention).

---

## §7 — Sequencing

Precondition is MET (§ header). Phases 1–5 run **autonomously, straight through** — all their decisions are resolved in §9. `PAYWALL_ENABLED` stays **false** in production for the entire autonomous run; Stripe stays in **test mode** throughout. The only human-gated steps are 6–7.

1. §2 entitlements generalization (small, everything else depends on it) + §3.5 dev-tester allowlist (a few lines inside the same files — land them together). Delete the dead `functions/interview-prep.js` here too (§0).
2. §3 Stripe build (test-mode keys pre-set by Jacob, §9), validated end-to-end incl. a live test-mode purchase run, `PAYWALL_ENABLED` still false in production throughout.
3. §1 tiering wired across every listed surface using §2's primitives (build to the §9-resolved Sprint / trial semantics).
4. §4 coherency/copy pass.
5. §6 full verification, including the live test-mode purchase runs. **End the autonomous run here** and report outcome-first: what shipped per phase (file:line), test results, and anything from §9's still-open items you hit.
--- HUMAN-GATED FROM HERE (needs Jacob present; do NOT do autonomously) ---
6. Jacob's go — grandfather beta users (§9: premium + 90d), flip `PAYWALL_ENABLED` true on `flightwayjacobprototype`, live-verify real gating end-to-end as a premium, free, AND dev-allowlisted account, and switch Stripe to live keys.
7. §5 `main` cutover, only after 6 is clean and Jacob explicitly says go for production.

---

## §8 — Explicitly out of scope for this pass

- Looping in Leo/Igor (decision #6).
- Preserving `main`'s old commit history (decision #8).
- Any work already covered by `docs/POST_SHIP_FIX_PLAN.md` — assume it's done; if you find it isn't, stop rather than redo/duplicate it here.
- The ~17 known `--fw2-accent` color inconsistencies and other previously-logged, separately-tracked polish debt — don't scope-creep into unrelated cleanup.

## §9 — Decisions (RESOLVED 2026-07-18 — build to these, do not re-litigate)

- **Lifetime price:** $199 one-time, "Founding 100" (live on `pricing.html`).
- **Interview Sprint:** **two weeks of full premium** — `plan='premium'`, `plan_expires_at = now + 14d`, existing schema, no new column/side-table. A Sprint purchase must **never shorten** an existing longer entitlement (skip the write if the user is `lifetime` or already has a later `plan_expires_at`).
- **Flight Plan Monthly free trial:** **14 days** — pass `subscription_data.trial_period_days = 14` at Checkout creation. Keep the "Start free trial" CTA copy.
- **`DEV_TEST_EMAILS` (§3.5):** on the **prototype** (`flightwayjacobprototype`), populate with `jklugerman2008@gmail.com,igorkallash3@gmail.com,leo.j.ferris@gmail.com`. On **production** (`flightway.ai`), leave the var **empty at launch** (no overrides live in prod — Jacob adds later via the dashboard if needed). These are Cloudflare Pages env vars, set in the dashboard, **never committed**. The executor may not know Jacob has set them yet — build the `isDevTester` code path regardless; it's inert when the var is empty/unset.
- **Beta-user grandfathering at paywall flip:** grant existing users **premium with a 3-month runway** — one-time D1 `UPDATE users SET plan='premium', plan_expires_at = <flip date + 90d> WHERE plan='free' AND ...` (scope to real accounts; don't clobber anyone already `lifetime`/`premium` with a later expiry). This is part of §5/§7 step 6 (the paywall flip), executed with Jacob present, not autonomously.
- **Stripe test keys/env vars:** Jacob pre-sets `STRIPE_SECRET_KEY` (test), the webhook signing secret, and `STRIPE_PRICE_*` IDs as Pages env vars on the prototype before the run. The executor therefore **does** run the live test-mode purchase run in §6, in addition to the mocked `stripe:check`.

Still genuinely open (use judgment, flag in report, don't block):
- Whether Artifacts/portfolio resurfacing is in-scope now or a fast-follow (currently dark, table+endpoints alive) — default: fast-follow, leave dark.
- Final tuning of every numeric default in §1 (5 msgs/day, 1 free roadmap regen, deep-sim gating, etc.) — ship the §1 defaults as single named constants (§2), flag them as adjustable.
