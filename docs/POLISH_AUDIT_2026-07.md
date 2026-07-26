# Polish Audit — WS-C, 2026-07-20

Audit produced for `docs/OVERHAUL_MASTERPLAN_2026-07-20.md` slice C1, burned down in C2.
Method: the committed screenshot harness (`node scripts/ui-screenshots.mjs
.screenshots/polish-before`) across 13 pages × {light,dark} × {desktop,mobile} plus the hub
at three zoom levels (57 captures, `errors.log` empty), cross-checked with targeted greps for
each line of the C1 checklist.

Every item carries a `file:line` and a verdict. `FIX` = burn down this session.
`DEFER` = explicitly out of scope with a reason (the masterplan allows this; each one names
the workstream that owns it).

Scoring note: **polish ≠ rewrite.** Where a finding could only be resolved by redesigning a
surface another workstream already owns (coach → WS-D, payload → WS-H), it is deferred and
said so.

---

## P1 — Visibly broken

- [x] **P1-a — The "Test-drive a career" portal card renders with no icon.**
  `assets/js/sim/sim-portal-card.js:48` emits `<i data-lucide="plane-takeoff">`, but
  `plane-takeoff` is not in the `ICONS` map in `assets/vendor/lucide-lite.js:8-21`.
  `createIcons()` `continue`s on an unknown name, so the `<i>` is left in the DOM as an
  empty inline element. Every other portal card has a 40px orange glyph; this one has a
  blank slot and its title sits ~40px left of its siblings' optical alignment.
  Visible in `portal-light-desktop.png` and `portal-dark-desktop.png`.
  **FIX** — add the icon to `lucide-lite.js` (masterplan 0.2: "new `data-lucide` icons must
  be added to `lucide-lite.js` FIRST").

- [x] **P1-b — The delete-account button is unstyled-by-CSS and breaks dark mode.**
  `portal.html:62-63` carries the entire button appearance in a `style="…"` attribute with
  hardcoded light-theme hex (`background:#fdecea; color:#a5281b; border:2px solid #c0392b`).
  There is **no `.portal-doom-btn` rule anywhere in `assets/css/`** (grepped). In dark mode
  it renders as a near-white pink slab — the single brightest object on the page. It is also
  the only emoji-glyph button in the product (`⚠️`), and the benign "Sign out" directly above
  it is a *stronger* red (solid fill) than the destructive action below it, inverting the
  risk hierarchy. `portal.html:65` has the same problem at lower stakes (the note paragraph
  is fully inline-styled).
  **FIX** — real CSS rules, theme tokens, lucide `triangle-alert`, and a quiet/destructive
  hierarchy that reads correctly against Sign out.

## P2 — Text-glyph icons (C1 seed items)

The convention is lucide via `data-lucide`; these render as font glyphs instead, so they
inherit text metrics, sit off-centre in their circles, and change shape per platform.

- [x] **P2-a — Coach settings gear `⚙`.** `coach.html:52`. Named explicitly in the plan.
  Renders as a ~10px glyph floating high in a 38px circle (`coach-light-desktop.png`).
  **FIX** — lucide `settings`.
- [x] **P2-b — Close buttons `×` / `✕`, 16 sites.** `coach.html:78`, `coach.html:102`,
  `quiz.html:158`, `dashboard.html:113`, `dashboard.html:140`,
  `assets/js/app/resume-page.js:996`, `:1089`, `assets/js/app/portal.js:334`, `:615`,
  `assets/js/app/roadmap.js:995`, `assets/js/app/roadmap-tree.js:1000`, `:1041`,
  `assets/js/app/skill-gap-tracker.js:1330`, `:1371`, `:1423`,
  `assets/js/app/portal-career-advisor.js:117`, `assets/js/hub/career-personalize.js:361`,
  `assets/js/sim/sim-engine.js:302`. Three different glyphs (`×`, `✕`, `✕` at different
  font-sizes) for one action.
  **FIX** — one inline `x` SVG helper; `lucide.createIcons()` is not called on most of these
  surfaces, so the fix is a shared SVG string rather than a `data-lucide` attribute (see
  Deviations in the ledger).
- [x] **P2-c — Disclosure chevrons `▾`.** `assets/js/app/portal-target-switch.js:126`,
  `assets/js/app/skill-gap-tracker.js:1478`.
  **FIX** — shared chevron SVG, same helper as P2-b.
- [x] **P2-d — Checkmark glyphs `✓`.** `assets/js/app/portal.js:317` (setup checklist),
  `assets/js/app/portal-target-switch.js:261`, `assets/js/app/skill-gap-tracker.js:1535`,
  `assets/js/app/resume-page.js:592`, `pricing.html:146`.
  **DEFER** — `✓`/`○` in the portal checklist read as *typographic list markers*, not as
  icon buttons; they are correctly weighted and aligned in both themes (verified in the
  screenshots). Swapping them buys nothing and risks the checklist's baseline alignment.
  Revisit only if WS-F redesigns the checklist.
- [x] **P2-e — Quiz subject/interest emoji.** `assets/js/quiz/quiz-app.js:512`, `:523`
  (~40 emoji), `quiz.html:60` (`🎲`, dev-only skip control, `hidden`).
  **DEFER** — deliberate content, not chrome: the quiz's playful register is the product
  decision, and these are card *contents* rather than controls.

## P3 — Inline styles in markup

Static appearance in `style=""` cannot be themed, cannot be overridden by a media query, and
inflates every HTML payload. Dynamic values (progress-bar widths, animation-sequencing
custom properties) are correct as inline styles and are listed here only to record that they
were classified and kept.

- [x] **P3-a — `portal.html:62`, `:65`** — the doom button + note (covered by P1-b). **FIX**
- [x] **P3-b — `admin.html:101` `style="margin-top:14px"`, `admin.html:193`
  `style="margin-top:10px"`.** **FIX** — move to `assets/css/flightway-pages.css` admin block.
- [x] **P3-c — `coach.html:107`, `:108`, `quiz.html:163`, `:164`
  `style="margin-top:10px"`** on the sign-up password inputs, and `quiz.html:131`
  `style="margin-top:16px"` on a label. **FIX** — one `.coach-email-input + .coach-email-input`
  / utility rule.
- [x] **P3-d — `pricing.html:79`, `:97`, `:112`, `index.html:174` `style="width:100%"`.**
  **FIX** — a `.fw-btn--block` modifier in the theme (the buttons already use `.fw-btn`).
- [x] **P3-e — `quiz.html:58` `style="margin-top:14px;"`** on the dev-skip wrapper. **FIX**
  with P3-c.
- [x] **P3-f — kept (dynamic).** `coach.html:56` `style="width:0%"`, `quiz.html:78`
  `style="width:12%"` (progress fills, written by JS); `index.html:190/196/199/202/205`
  `--fw-delay` / `--fw-i` (per-element animation sequencing — a CSS custom property set on
  the element is the correct mechanism). **DEFER — intentional.**

## P4 — Empty and loading states

- [x] **P4-a — The resume ATS panel reads as debug output.**
  `assets/js/app/resume-page.js:302-330` renders `35 / 100` as bare text over an unstyled
  `<ul>` of machine strings: "Missing contact name", "Empty section: Work Experience",
  "Empty section: Education"… On a fresh resume that is seven identical-looking lines of
  dev-speak, which is exactly the C1 "no dev-speak strings in UI" item.
  **FIX** — score gets the tabular-numeral meter treatment; issues get human copy and a
  designed list.
- [x] **P4-b — `renderSwitcher()` has no empty state.** `assets/js/app/resume-page.js:1112`
  loops `state.resumes` into `els.switcher`; with zero saved resumes the rail is a blank
  16px gap under the toolbar. **FIX** — one-line empty line of copy.
- [x] **P4-c — Coach's empty conversation is one centred grey sentence.** `coach.html`,
  `assets/js/coach/coach.js:68`. No avatar, no suggested openers, and the 0/5 exchange bar
  is a flat grey rule (`coach-light-desktop.png`).
  **DEFER to WS-D** — slice D1 rebuilds `coach.html` and its CSS wholesale into a two-pane
  frame; designing an empty state here would be thrown away next workstream.
- [x] **P4-d — verified present, no action.** Opportunities panel
  (`assets/js/app/opportunity-finder.js:115-117` skeleton, `:218` empty), admin tables
  (`assets/js/app/admin-console.js:115`, `:208`, `:281` — each has an `*-empty` node),
  skill-gap steps (`skill-gap-tracker.js:2163`), sector history
  (`sector-fit-sheet.js:204`), portal snapshot (covered by the hub/portal skeletons shipped
  2026-07-20). **No finding.**

## P5 — Consistency

- [x] **P5-a — Hover transitions run at 300ms.** `assets/css/flightway-theme.css:136`
  defines `--transition: 0.3s var(--fw-ease-standard)`, consumed by 32 rules — all of them
  hover/focus micro-states (`.coach-gear`, `.role-card`, `.feature-card`, `.career-chip`,
  `.cta-btn`, `.nav-cta`, `.skill-pill`, `.metric-card`, footer links…). C1 specifies
  120–180ms for hover. 300ms reads as lag on a pointer.
  **FIX** — retune the token to 0.18s. One line; every consumer is a micro-state, so nothing
  that should be slow is affected (page/entrance motion uses its own 0.35–0.75s durations).
- [x] **P5-b — Default UA disclosure triangle on the resume format panel.**
  `resume.html:196` `<details class="resume-format-details">` renders `▶ Format & template`.
  The repo already hides this marker on its two other disclosures
  (`flightway-pages.css:526` `.career-disclosure-summary::-webkit-details-marker`,
  `:2563` `.roadmap-alt-picker-summary`), so this is an inconsistency, not a style choice.
  **FIX** — same treatment + a rotating chevron.
- [x] **P5-c — The portal's top-level "Help us know you better →" is styled as a raw
  underlined link.** `assets/js/app/portal.js:259` → `.portal-pb-tertiary`
  (`flightway-pages.css:1355`): permanent `text-decoration: underline` in the sky hint colour,
  directly under the H1. Reads as an unstyled anchor rather than a control.
  **FIX (conservative)** — keep the sky colour: `--hint-dot` (`flightway-theme.css:47`, `:86`)
  is the deliberate "something new here" signal, also used by `.portal-card--accent-sky` and
  the new-dot on the matching card. Only move the underline to `:hover`/`:focus-visible` and
  give it a hit area. Do **not** recolour to orange — that would erase the hint semantics.
- [x] **P5-d — 30 non-token `box-shadow` literals** across `flightway-pages.css`,
  `hub-dashboard.css`, `flightway-theme.css`, `flightway-2.css` (e.g. `pages:1170`,
  `hub:1182`, `theme:1877`).
  **DEFER** — classified by hand: all 30 are bespoke elevations (drawer edge glows, canvas
  plate shadows, keyframe pulse rings) with per-surface offsets and per-theme alphas. There
  is no repeated literal that a token would collapse, so tokenizing means inventing a
  6-shadow scale and re-tuning 30 surfaces with no gate to catch a regression — a rewrite,
  which C1 forbids. Recorded for WS-H if a shadow scale is ever wanted.
- [x] **P5-e — focus-visible coverage: verified complete, no action.** The zero counts in
  `auth-pages.css` / `opportunity-finder.css` / `profile-building.css` are not gaps —
  `flightway-theme.css:2258-2266` rings `button`/`a`/`input`/`select`/`textarea`/
  `[role=button]` globally by element, and `:295-308` adds the bespoke component ring.
  **No finding.**
- [x] **P5-f — scrollbar + selection styling: verified present.** `::selection`
  (`flightway-theme.css:483`), card scrollbars (`hub-dashboard.css:802-806`), nav rail
  (`hub-dashboard.css:30-38`). **No finding.**

## P6 — Copy and typography

- [x] **P6-a — Straight apostrophes in visible page copy.** 24 occurrences across
  `404.html:59`, `pricing.html:11,51,54,85,99,140,141`, `dashboard.html:94,95,96,241`,
  `index.html:238,259,292,309,344`, `quiz.html:49,85,86,99,116`. Now that the product ships
  a real type system (WS-A), `don't` next to Space Grotesk display type is the most visible
  remaining "default" tell.
  **FIX** — `’` in text nodes only. Must not touch `'` inside inline `<script>`/attribute
  values; verified per-line before editing.
- [x] **P6-b — `...` instead of `…` in placeholders.**
  `assets/js/quiz/quiz-app.js:513`, `:774`. **FIX**
  *(Corrected during C2: the resume and coach placeholders that looked like three
  dots in the screenshots are already real `…` — verified with `cat -v`
  (`M-bM-^@M-&`). Only the two quiz strings were literal dots.)*
- [x] **P6-c — `404.html` carries no brand lockup and no nav.** A bare card on an empty
  field (`404-dark-desktop.png`). It is on-brand-coloured but anonymous.
  **FIX** — add the `brand.js` lockup above the card. *(promoted to FIX; small and
  self-contained.)*
- [x] **P6-d — no lorem / TODO / FIXME / `alert(` / leaked `console.log` in any UI string.**
  Grepped `*.html`, `assets/css/`, `assets/js/`. `alert(` count is zero — every error path
  already goes through `FWErr`. **No finding.**

## P7 — Motion, imagery, carried-over

- [x] **P7-a — The app-nav scroll rail has no overflow affordance.** Carried over from the
  WS-B ledger ("Open follow-ups"): `.hub-app-nav` (`hub-dashboard.css:22-38`) scrolls on x
  with `scrollbar-width: none`, so at 1024px (and 1440 @150%) it cuts a tab mid-pill with
  nothing indicating more tabs exist.
  **FIX** — edge `mask-image` fade applied only while the rail actually overflows.
- [x] **P7-b — Two dead PNGs still shipped.** `assets/logo.png` (146KB) and
  `assets/logo-bird.png` (131KB) — 277KB total. After WS-A slice A2, `brand.js` inlines the
  SVG mark and the only remaining mention is a source-of-truth comment
  (`assets/js/shared/brand.js:3`). Grepped `*.html`, `assets/`, `functions/`: zero runtime
  references.
  **FIX** — keep `logo-bird.png` (it *is* the artwork the SVG was traced from and the
  comment says so); delete `assets/logo.png`, which nothing references and nothing traced.
- [x] **P7-c — Motion conventions: verified.** `fw-revealed`/`fw-settled` are owned by
  `assets/js/shared/page-veil.js` and consumed by `flightway-pages.css` /
  `opportunity-finder.css`; 25 `prefers-reduced-motion` blocks across 9 of 10 stylesheets
  (`zone-colors.css` has no animation). **No finding.**
- [x] **P7-d — No stretched or blurry raster imagery.** Zero `<img>` tags in any of the 15
  pages; the only rasters left are the two favicons at their native sizes. **No finding.**

---

## Burn-down order (C2)

Batched by file so each commit touches one coherent area:

1. **Icons** — `lucide-lite.js` + shared `x`/`chevron` SVG helper → P1-a, P2-a, P2-b, P2-c.
2. **Portal delete-account** — `portal.html` + CSS → P1-b, P3-a.
3. **Inline-style sweep** — `admin.html`, `coach.html`, `quiz.html`, `pricing.html`,
   `index.html` + CSS → P3-b … P3-e.
4. **Resume polish** — `resume-page.js`, `resume.html` + CSS → P4-a, P4-b, P5-b, P6-b (resume).
5. **Micro-state + affordance CSS** — `flightway-theme.css`, `hub-dashboard.css`,
   `flightway-pages.css` → P5-a, P5-c, P7-a.
6. **Copy/typography + dead asset** — 5 HTML pages, `quiz-app.js`, `coach.html`,
   `404.html`, `assets/logo.png` → P6-a, P6-b, P6-c, P7-b.

**Deferred with reason:** P2-d, P2-e, P3-f, P4-c (→ WS-D), P5-d (→ WS-H).
**Verified clean, no action:** P4-d, P5-e, P5-f, P6-d, P7-c, P7-d.


---

## C2 result — 2026-07-20

All 31 items resolved: 21 fixed across six commits (`9550ea5`, `8d8f2f3`,
`28a90f1`, `cc3332f`, `e03927a`, `0a71efe`), 5 deferred with the reasons recorded
above, 6 verified clean with no action needed. Slice-level notes, deviations and
gate results are in `docs/OVERHAUL_PROGRESS.md`.
