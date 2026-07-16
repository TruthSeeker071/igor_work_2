# UI Overhaul — Session Handoff (2026-07-16)

**Repo:** `igor_work_2_repo`, branch `igor_work_2` · **Wireframes:** `docs/WIREFRAMES.dc.html` (Claude Design export, all annotations honored or explicitly deviated below) · **Plan:** `UI_OVERHAUL_PLAN.md` (project root)

## Commits this session

| Commit | Phase |
|---|---|
| `a231ab4` | 0 — audit baseline (`docs/UI_AUDIT_BASELINE.md`) + wireframes archived |
| `2081930` | 1 — token consolidation, light-mode text fix, `verify:ui` ratchet |
| `a7c34dd` | 2 — FWTabbar mobile bottom bar (wireframe 1h) |
| `d232d3b` | 3a — quiz (1a/1b) |
| `f008862` | 3b — portal (1c/1d) |
| `7433d43` | 3c — career deep dive (1e/1f) |
| `4672dd4` | 4 — hub ranked list view (1g) |
| `9b8fd39` | 5 — fonts dedupe, dvh sweep, aria landmarks |
| (this commit) | handoff doc |

## To get these commits onto GitHub (from your Mac)

```bash
cd ~/Claude/Projects/FlightWay\ CTO/igor_work_2_repo
rm -f .git/HEAD.lock .git/objects/maintenance.lock   # stray locks from sandbox session
git fetch ../igor_work_2_ui_overhaul.git.bundle igor_work_2:refs/heads/ui-overhaul-incoming
git merge ui-overhaul-incoming                        # fast-forward expected
git push origin igor_work_2                           # this deploys via Pages
npm run pages:smoke                                   # after deploy
```
The working tree in your folder already has every file change (the bundle carries the same
content as commits). If `git status` shows the files as modified and the merge complains,
`git stash` first — tree and commits are identical.

## New shared pieces (use these, don't reinvent)

- **Tokens** (`flightway-theme.css`): `--conf-anchored/-inferred/-estimated`, `--info-accent`
  (text-safe) vs `--info-accent-fill`/`--conf-inferred-fill` (fill-safe, pair with `#06122b` text),
  `--text-3xl/4xl/display`, `--dur-fast/base/slow`, `--ease-out/spring`.
- **`FWTabbar`** (`shared/fw-tabbar.js`): mobile bottom bar on the 5 signed-in pages.
  `FWTabbar.setAction(node)` stacks a page CTA above the tabs (career page uses it);
  `FWTabbar.hide(bool)` for full-screen sheets.
- **`FWHubListView`** (`hub/hub-list-view.js`): ranked list on dashboard; list is default ≤768px.
  State in URL (`?view/q/zone/sort`).
- **`npm run verify:ui`** — token-discipline ratchet (hex/`!important`/`100vh`/px font-size
  counts per CSS file may only fall; baseline in `scripts/ui-baseline.json`,
  `--update` after intentional reductions). Run it in CI alongside `hub:verify`.

## Deliberate deviations from wireframes (with reasons)

1. **No per-question quiz Skip** (1a) — every answer seeds the 161-dim vector; skip would
   silently degrade fit quality. Revisit only with a "answer later" queue design.
2. **Hub list rows show sector + education, not salary/growth** (1g) — per-career BLS medians
   aren't in the client catalog. Follow-up: add median wage + growth to `careers.json` via
   `onet:build`, then swap the sub-line in `hub-list-view.js` `rowHtml()`.
3. **Deep-dive desktop right rail deferred** (1f) — career page is a long single-column section
   flow generated in `app-pages.js`; a 2-col re-architecture risks the personalize/hydrate flow.
   Suggested approach: wrap sections 4+ (Marco's take onward) in a grid container at render time.
4. **Portal roadmap-progress mini-card + recents row deferred** (1c) — portal doesn't load
   roadmap step-completion accounting; no view-history tracking exists. Recents is a natural
   `events.js` consumer (`career_view` events already logged).
5. **Bottom bar included on coach.html** (1h says bar hides in chat) — coach IS a page, not a
   sheet; without the bar mobile users lose navigation. If chat becomes a sheet later, use
   `FWTabbar.hide(true)` inside it.

## Follow-ups queued (priority order)

1. Self-host Inter woff2 (4 weights) in `assets/vendor/fonts/` + preload — sandbox couldn't
   reach the font CDN. ~10 min on a normal network.
2. Per-career salary/growth into catalog (unblocks wireframe-exact hub rows + deep-dive stats line).
3. White-on-orange button contrast (4.14:1, AA-large only) — brand decision documented in
   `docs/UI_AUDIT_BASELINE.md`.
4. `!important` reduction via `@layer` (289 in theme at baseline; ratchet holds the line, layering
   removes the need) — do with screenshot QA against a live deploy.
5. Skip canvas boot entirely when `?view=list` on mobile (saves ~1MB of artifact fetches on the
   default mobile path).

## Verification status

`verify:ui` ✓ · `test:vectors` ✓ · `verify:aliases` ✓ · `hub:verify` ✓ · `node --check` on every
touched JS ✓ · `pages:smoke` **pending** (needs live deploy — run after push). No vector math,
hydration, save/merge, or auth code was touched anywhere in this session.
