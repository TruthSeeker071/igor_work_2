# UI Polish Overhaul — Execution Plan (2026-07-20)

> **STATUS: EXECUTED 2026-07-20** (`d45334d` WS4 → `e7cd7bb` WS2 → `5d35df3`
> WS3 → `3126d57`/`49a9fe0`/`b5c82c9` WS1 slices). All pushed to `Jacob_Work`
> and live. Deliberate deviations, each argued in its commit message:
> 1. WS3 `fromResponse` prefers the call site's fallback on 401 (a 401 on the
>    sign-in form is bad credentials, not a stale session).
> 2. WS1 item 8 (coach ring) not converted — chat thinking is already the
>    `.coach-typing` dots; the remaining ring is a 16px one in a single-line
>    status strip, covered by the in-button exception.
> 3. WS2 skipped three listed `disabled = true` sites that are not busy states
>    (sim tier/option locks, resume-page "Added ✓", notify-optin checkbox).
> Deferred: the WS3 server-side dev-speak sweep in `functions/` (the client
> gate protects users; no user-triggerable string was found unguarded).

Four workstreams: (1) skeleton loaders replace spinner rings, (2) instant button
feedback everywhere, (3) no raw backend errors ever reach the UI, (4) sign-in
page redesign. All four are presentation-layer. **If any change seems to require
touching vector hydration/merge, accumulating fit math, or save/merge paths —
stop and flag it instead; those are fragile subsystems and out of scope here.**

## Ground rules (non-negotiable)

- Repo root: `Flightway/flightway`. Vanilla JS only. `Edit` diffs over rewrites.
  Match each file's existing idiom (see the "Size only — .fw-skeleton supplies
  the shimmer" comment convention already used in the CSS).
- Verify with project scripts, not a browser: `node --check` on every touched
  JS, `npm run pages:smoke` (catches boot failures static checks can't),
  `npm run hub:verify` if anything hub-side is touched.
- Cache busters: every changed `/assets/*` file needs its `?v=YYYYMMDDx` stamp
  bumped **on every page that references it**, changed files only, and the new
  stamp must differ from the current one (same-stamp bump = users keep stale
  files for up to a year).
- Deploy = `git push origin Jacob_Work` (Cloudflare Pages auto-builds). Never
  `npm run deploy:prototype`. After push: `curl -L` the live URL to confirm
  content + headers. Session cookies are per-deployment-subdomain — re-login
  after each deploy when testing live.
- New `data-lucide` icons must be added to `assets/vendor/lucide-lite.js` first;
  the full Lucide library is not loaded. Inline SVG is also acceptable.
- One commit per workstream (or per coherent slice of WS1). Re-run the
  inventory greps in each workstream before editing — this doc's line numbers
  were true at commit `2d9469a` and may drift.

## Existing primitives (reuse these, don't invent parallels)

- `.fw-skeleton` — canonical shimmer placeholder, `flightway-theme.css:2276`
  (reduced-motion: animation off). Per-screen classes add size only.
- `.fw-spinner` — canonical ring, `flightway-theme.css:2259`. Stays legitimate
  **inside buttons only** after this overhaul.
- `.fw-hoverable` — hover/active micro-state recipe, `flightway-theme.css:2290`
  (opt-in, mostly unadopted).
- Toast v2 — `fw-toast.js` + `.fw-toast--error/success/info`.
- Existing skeleton implementations to mirror: opportunity-finder
  (`opportunity-finder.css:146`), roadmap timeline
  (`flightway-pages.css:329-333`), skill pills (`flightway-pages.css:259`),
  portal dual-fit bars (`flightway-pages.css:1406`), SGT plan card
  (`skill-gap-tracker.css:885`).
- `FWPageVeil` (`assets/js/shared/page-veil.js`) — boot veil with quiet-window
  reveal, 4s hard deadline, `fw-revealed`/`fw-settled` entrance convention.
  Do not change its timing logic; only its visual contents.

---

## WS1 — Replace spinner rings with skeleton loaders

Principle: a skeleton must mirror the final layout's shape and approximate
dimensions (no layout shift on content arrival). Every skeleton container gets
`role="status"` + `aria-busy="true"` + a visually-hidden "Loading…" text node;
the skeleton bars themselves get `aria-hidden="true"`. `.fw-skeleton` already
handles reduced motion.

Conversion inventory (grep `fw-spinner|spinner` to re-verify before starting):

1. **Boot veil (7 pages)** — `fw-veil-spinner` in `admin.html:60`,
   `career.html:24`, `coach.html:24`, `portal.html:25`, `quiz.html:24`,
   `resume.html:111`, `roadmap.html:26`. One shared change: replace the ring
   inside `#fw-page-veil` with a generic page-skeleton composition (a nav-bar
   bar + 2–3 content-block bars built from `.fw-skeleton`, centered, subtle).
   Implement once in `flightway-theme.css` (e.g. `.fw-veil-skeleton` markup
   block pasted per page, or better: have `page-veil.js` inject it so the HTML
   edit is one line per page). Keep the veil's aria-busy handling
   (`page-veil.js:52`) working — it flips `aria-busy` on the veil element.
2. **Hub loading** — `dashboard.html:74` (`hub-loading-spinner`,
   `hub-dashboard.css:123`). Replace with a hub-shaped skeleton (map canvas
   rectangle + HUD strip bars). **Do not touch hub boot order** — the TDZ trap
   in `hub-dashboard.js` (declarations before ~line 240) means HTML/CSS-only
   changes here; verify with `pages:smoke` + `hub:verify`.
3. **Career personalize analysis** — `career-personalize.js:334` renders
   `career-loading-card` with a ring (`flightway-pages.css:382`). Replace with
   a skeleton card mirroring the analysis layout (title line, 3–4 text lines,
   pill row — skill-pill skeletons already exist at `flightway-pages.css:259`).
4. **Profile building** — `profile-building.js:228` (`pb-loading-spinner`,
   `profile-building.css:238`). Skeleton of the step card (heading bar + body
   lines + button-shaped bar). Note `profile-building.css:245`'s
   reduced-motion comment — preserve the intent (loading feedback survives
   reduced motion; `.fw-skeleton` goes static, which is acceptable, but keep
   the visually-hidden "Loading…" text).
5. **Simulation** — `simulation.html:46` (`fw-loading`) and
   `sim-engine.js:1478` (build message with ring). These are long AI
   generations with meaningful copy ("Building a realistic X simulation…").
   Hybrid: keep the copy line, replace the ring with a skeleton composition of
   the sim workspace (doc list bars + main panel block). `simulation.css:117`
   holds `.fw-loading`.
6. **Roadmap generation** — `roadmap.js:1711` (`roadmap-generating-spinner`,
   `flightway-pages.css:2532`). Replace with a skeleton roadmap: 3–4 timeline
   items using the existing `timeline-item--skeleton` pattern
   (`flightway-pages.css:329`), keeping the progress copy the generator
   already shows. The `roadmap-progress-shimmer` bar (`:2599`) stays.
7. **Skill-gap tracker plan** — `skill-gap-tracker.js:1948` renders
   `sgt-plan-skeleton` that *contains a ring* (`sgt-plan-spinner`,
   `skill-gap-tracker.css:896`). Drop the ring; make the skeleton card 2–3
   `.fw-skeleton` lines + keep the "Building your semester plan…" copy. Delete
   the now-dead `sgt-plan-spinner` CSS (incl. dark-theme override at `:1115`).
8. **Coach/Marco thinking** — `coach.html:66` (`coach-spinner`,
   `flightway-theme.css:1424`, sized at `flightway-pages.css:41`). Chat
   context: replace with a skeleton message bubble (2 short `.fw-skeleton`
   lines inside the assistant-bubble shell) or animated typing dots — pick
   whichever matches the existing chat DOM with the smaller diff; skeleton
   bubble preferred for consistency.

**Explicitly NOT converted:** in-button spinners (`roadmap-btn-spinner`
`flightway-pages.css:2737`, used at `roadmap-tree.js:1136`; and any WS2
in-button busy ring) — a skeleton inside a button is wrong; buttons keep small
rings. Toasts unchanged.

Cleanup: after all conversions, grep for now-unused spinner size classes and
delete dead CSS (`hub-loading-spinner`, `career-loading-spinner`,
`pb-loading-spinner`, `fw-veil-spinner`, `coach-spinner`, `sgt-plan-spinner`,
`roadmap-generating-spinner`) — but keep `.fw-spinner` itself (buttons use it).

---

## WS2 — Instant feedback on every button

Two layers: a universal CSS pressed-state, and a shared busy-state helper.

### 2a. Universal pressed/hover state (CSS only)

Enumerate the button classes (grep `btn` in the CSS files; known families:
`coach-primary-btn`, `roadmap-*-btn`, `sgt-*` buttons, admin console buttons,
portal CTAs). Add to `flightway-theme.css` a shared rule giving all of them:
`:active { transform: scale(0.985); }` + a fast transition, reduced-motion
guarded — i.e. generalize the `.fw-hoverable:active` recipe that already
exists at `flightway-theme.css:2290` to the button families (either by adding
the classes to a shared selector list or by applying `.fw-hoverable` in
markup; prefer the CSS selector list — no markup churn). Ensure
`:disabled`/`[aria-busy="true"]` styling exists globally: reduced opacity,
`cursor: default`, no hover lift.

### 2b. Shared busy helper `FWButtonBusy`

New tiny module `assets/js/shared/fw-busy.js` (mirror `fw-toast.js`'s
structure and size):

```js
// FWButtonBusy.start(btn, { label: 'Saving…' }) -> restore()
```

Behavior: synchronously (same tick, before any `await`) set `disabled`,
`aria-busy="true"`, add `.is-busy`, swap in `label` plus a small
`.fw-spinner`, and **freeze the button's current width** (`btn.style.minWidth
= btn.offsetWidth + 'px'`) so the label swap can't jump layout. `restore()`
reverses everything. Add `.is-busy` CSS (spinner sized ~14px, gap, keep
text visible) to `flightway-theme.css` next to the spinner block.

### 2c. Migration + gap sweep

Migrate the existing ad-hoc `disabled = true; textContent = '…'` sites to the
helper (grep `disabled = true` under `assets/js`; current list:
`auth-pages.js` ×4, `quiz-app.js:2623`, `coach.js` ×4, `artifacts.js:210`,
`admin-console.js` ×5, `skill-gap-tracker.js` ×2, `roadmap.js:1053`,
`portal-career-advisor.js:289`, `notify-optin.js:50`, `resume-page.js:586`,
`portal.js:1212`, `billing.js:132`, `profile-building.js:274`,
`career-personalize.js:1327`, `sim-engine.js:592`, `resume-ingest.js`).
Then sweep for async click handlers with **no** feedback at all: grep
`onclick=` in the HTML files and `addEventListener('click'` in `assets/js`;
for each handler that awaits a fetch/generation, confirm busy state is set
before the first `await`. Fix the gaps with the helper.

Chat inputs (coach, roadmap chat, SGT chat, career advisor) additionally keep
their existing input-disable behavior — the helper covers the button; don't
regress the input handling.

Load order: add `fw-busy.js` to every page whose JS uses it (with a fresh
buster), before the consuming scripts.

---

## WS3 — Never surface raw backend/internal errors

### The leak paths (all confirmed in-repo)

1. **Server dev-speak passes straight through** `data.error || fallback` →
   `err.message` → `errEl.textContent`. Dev-speak strings currently in
   `functions/`: `'Method not allowed'`, `'Invalid JSON body.'` (×31),
   `'Missing userMessage.'`, `'Missing branchNodeId.'`, `'socs required'`,
   `'invalid soc'`, `'Unknown action.'`, `'Missing or malformed soc.'`, etc.
2. **Client throw sites embedding internals**: `hub-onet-map.js:286`
   (`'HTTP ' + r.status + ' for ' + url`), `sim-engine.js:1522`
   (`'flights ' + r.status`), `onet-vectors.js:1449/1456`,
   `opportunity-finder.js:182/206` (`'… fetch failed'`).
3. **Browser-native errors**: network `TypeError` ("Failed to fetch") and any
   JSON-parse error reaching an `err.message` display site.
4. **Raw display sites** (`err.message` shown verbatim): `auth-pages.js`
   (66/110/148/185), `quiz-app.js:2683`, `coach.js` (423 — includes
   `String(err)` — 753/795/820), `roadmap.js` (44/1428/1450),
   `resume-ingest.js:371`, `profile-alignment.js`.
   Good existing patterns to mirror: `portal-career-advisor.js` `mapError()`
   and `career-personalize.js` `mapAnalysisError()`.

### The fix — explicit user-facing flag, not heuristics

New shared module `assets/js/shared/fw-errors.js` exposing `FWErr`:

- `FWErr.friendly(message)` → `Error` with `err.userFacing = true`.
- `FWErr.forUser(err, fallback)` → returns `err.message` **only if**
  `err.userFacing === true`, else `fallback` (default:
  `'Something went wrong. Please try again.'`). Never returns anything
  containing a status code, URL, "fetch", "JSON", or a stack.
- `FWErr.fromResponse(status, data, fallback)` → status-aware copy:
  401 → 'Please sign in again.'; 402/403 → prefer `data.error` (plan-gating
  strings are already user-written) else a generic gate message; 404 →
  fallback; 429 → 'FlightWay is busy right now — try again in a moment.';
  5xx → 'Something went wrong on our end. Please try again.'; returns a
  `friendly()` error. Only trust `data.error` when it reads as product copy —
  concretely: for 4xx statuses where the endpoint is known to emit
  user-written strings. When in doubt, use the fallback.

Migration:

- In `auth.js`, every `throw new Error(data.error || '…')` becomes
  `throw FWErr.fromResponse(resp.status, data, '…')` (the existing per-call
  fallbacks are already good copy — keep them). Verify `parseJson` swallows
  parse failures (returns `{}`); if not, make it.
- The timeout message in `authFetch` (`auth.js:53-58`) is already friendly —
  mark it `friendly()`.
- Every display site in leak-path 4 switches to
  `errEl.textContent = FWErr.forUser(err, '<contextual fallback>')`. Keep the
  existing contextual fallbacks — they're good.
- `mapError`/`mapAnalysisError` sites: leave the mapping, but route the final
  string through `friendly()` so downstream display is consistent.
- Client dev-throws (leak-path 2) stay as-is internally (fine for
  console/debugging) — the display gate makes them safe. But confirm each one
  is actually caught before a display site; any that surfaces gets a
  contextual fallback at its catch.
- Server sweep (secondary, do last): rewrite dev-speak strings in `functions/`
  **only where a normal user flow can trigger them** ('Invalid JSON body.',
  'Method not allowed' are programmer-error responses — leave them; the
  client gate protects users). Fix any like 'Missing userMessage.' that a UI
  race can trigger.

Load order: `fw-errors.js` before `auth.js` on every page (all pages load
`auth.js`), fresh buster everywhere it's added.

Acceptance: grep proves no `errEl.textContent = err.message`-shaped code
remains outside `FWErr.forUser`; manually curl a 405 and a bad-JSON POST and
confirm the UI shows friendly copy (test via the sign-in page + one roadmap
action against the live deploy).

---

## WS4 — Sign-in page redesign (`auth.html` + `auth-pages.css`)

Current state: four `section.auth-page` blocks; only `#signin` uses the
extracted classes — register/forgot/reset are inline-styled
(`auth.html:56-96`). The page is a bare hero: giant title, unlabeled floating
inputs, no card, no brand presence. That's the low-effort look in the
screenshot.

**Keep intact (mechanism, not looks):** all element IDs, the
`coach*FromPage()` global handlers, hash routing + `data-boot-page` anti-flash
CSS (`auth.html:15-16`), `autocomplete` attributes, Enter-key handoffs, the
signed-in redirect in `routeBoot()`, and the nav.

Redesign spec (all four sub-pages get the same treatment):

1. **Card layout.** Centered elevated card: `background: rgb(var(--surface))`,
   1px `--border` border, radius ~20px, `var(--elev-2)`, max-width 420px,
   generous padding (~40px/28px), page background unchanged behind it. On
   ≤480px the card goes near-edge-to-edge with lighter padding.
2. **Brand + hierarchy.** Small FlightWay brand mark at the top of the card
   (reuse the `fw-brand`/`brand.js` mark), then a card-scale heading
   (~1.4–1.6rem, `--font-display`) — "Welcome back" for sign-in, keep literal
   titles for the others — then one short sub-line (trim the current
   two-line paragraph).
3. **Labeled fields.** Visible `<label for>` above each input (Email,
   Password); keep placeholders as format hints only. Password field gets a
   show/hide toggle button (inline SVG eye or add the icon to
   `lucide-lite.js`), `aria-label`ed, `aria-pressed` toggled.
4. **Error/success states.** Restyle `.coach-error` within the card as an
   inline alert (err-token left border or tinted background, small icon,
   `role="alert"`); style the reset-flow success message
   (`#forgot-success`) as its green counterpart. Reserve vertical space or
   animate height so appearance doesn't jolt the card.
5. **Button.** Full-width primary stays; wire it to `FWButtonBusy` (WS2) —
   auth-pages.js already swaps labels, migrate to the helper. Add the WS2
   pressed state.
6. **De-inline register/forgot/reset.** Move every inline `style="…"` in
   `auth.html:56-96` into `auth-pages.css` classes (the file header already
   declares this purpose). Reuse the signin classes (`auth-field`,
   `auth-footnote`, …) instead of minting new ones.
7. **Theme + a11y.** Verify dark mode (tokens should just work — check the
   card border/elevation), focus-visible rings (global rule exists), and tab
   order including the new password toggle.
8. **Signed-out arrival (nice-to-have, only if cheap).** If
   `FWAuth.logout()`'s redirect carries a detectable signal (check how
   signout lands on `auth.html`), show a one-line "You've been signed out."
   info notice above the form. If there's no existing signal, skip — do not
   add query params to auth flows for this.

Busters: `auth-pages.css` (currently `?v=20260703p`) and `auth-pages.js` on
`auth.html`; any page that gains `fw-busy.js`/`fw-errors.js` gets those tags
added with a fresh stamp.

Verification: `pages:smoke`, then live: signed-out visit, bad-password error
render, forgot-password flow, register page, dark mode, 375px viewport.

---

## Execution order & shipping

1. **WS4** first (isolated, high visual payoff) — one commit.
2. **WS2** (fw-busy.js + CSS + migration sweep) — one commit. WS4's button
   wiring can land here if sequencing is easier.
3. **WS3** (fw-errors.js + display-site gate + auth.js mapping; server copy
   sweep as a follow-up commit).
4. **WS1** last (largest surface) — slice into commits: veil, hub, roadmap,
   career/profile, sim, coach/SGT. `pages:smoke` after each slice.

Per commit: `node --check` touched JS → `pages:smoke` → buster bumps (changed
files only, new stamp ≠ old stamp) → commit → `git push origin Jacob_Work` →
`curl -L` the live pages touched. `hub:verify` for the hub slice.

Out of scope: any refactor of working adjacent code, restyling screens beyond
the listed items, pricing page (stays dark), quiz internals, anything touching
vector math or save/merge paths.
