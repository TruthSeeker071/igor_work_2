# Roadmap Overhaul — Pre-Release Plan (2026-07-21)

**For:** Opus, executing the macro-roadmap overhaul before full release.
**Author:** audit + planning session, 2026-07-21 (Jacob_Work).
**Effort ceiling:** bounded, direct depth. Trace each item's specific path, make
one targeted fix per confirmed cause, verify with the named script. No exhaustive
rewrite pass, no restyling code that works. This is the FlightWay codebase — read
and follow the `flightway-fullstack-architect` skill and `docs/CONVERSATION_HANDOFF.md`
before touching anything.

The roadmap has two layers. The **waypoint** layer (a node's steps, the focus
tracker, semester plans, gap progress) is already polished — do not churn it. The
**macro-roadmap** (the branching tree graph: spine + branches, decisions, preview/
commit/extend/track, the map canvas) is where the bugs are. Weight effort there.

### Execution priority (do the two root causes FIRST)

The sweep found that most of the visible branch breakage traces to **two** bugs.
Fix these before anything else, then re-test §2.1/§2.3 — several symptoms should
resolve at once:

1. **§3C.1** — branch-action server responses are discarded because `setRoadmap(_,false)`
   skips the local cache and `render()` reloads stale localStorage. Breaks extend
   (2.1), makes commit revert, and can durably overwrite personalization. **HIGH.**
2. **§3B.1** — `normalizeRoadmapTree` clobbers a branch re-choice back to the old
   option, desyncing decisions/activePath/focusTracker. Primary suspect for the
   "can't switch branches / back to spine" symptom (§2.3). **HIGH.**

Then the other HIGHs: §3A.1+§3A.2 (split false-success + rate-limit-without-refund,
together), §3C.2 (orphaned drawer on regen), §3C.3 (listener leak), §3B.2 (prune
drops branch roots). Then §4+§5 (pivot/rebuild metering). Then the mediums/lows and
the §2.2 preview redesign (design task).

---

## 0. Ground truth: the tree schema

```
roadmap = {
  version: 2, targetCareerSlug, targetCareerName, trunk,
  nodes: [{ id, parentId, depth, type, pathRole:'spine'|'branch',
            title, shortTitle, confidence, status, done,
            steps:[{id,text,done}], horizon, whyItMatters, addressedGaps }],
  decisions: [{ id, nodeId, options:[{id,label,childNodeId}], chosenOptionId }],
  activePath: ['trunk', ...nodeIds],
  focusTracker: { version:3, waypointId, skillGaps:[...],
                  branchFocuses:[{branchKey,waypointId}], activeBranchKey }
}
```

`pathRole:'spine'` = the committed main path. A `'branch'` forks off a spine node
via a decision option's `childNodeId`. `branchKey` is `'spine'` or a branch-root
node id. Node/decision counts are capped by `MAX_TREE_NODES`/`MAX_TREE_DECISIONS`
via `.slice()`. Server graph transforms live in `functions/_lib/roadmap-tree.js`;
the client tree module is `assets/js/app/roadmap-tree.js` (`FWRoadmapTree`); the
page controller is `assets/js/app/roadmap.js`; the focus tracker is
`assets/js/app/skill-gap-tracker.js`; the endpoint is `functions/career-roadmap.js`.

---

## 1. Already landed this session (do NOT redo — verify only)

These are committed/deployed in the same push that ships this plan:

- **Gemini timeout was silently dropped.** `callGeminiText` never accepted
  `timeoutMs`, so `dossier-update.js` (25s) and `career-roadmap.js` step-elaborate
  (20s) fell back to the 30s default. Fixed in `functions/_lib/gemini-json.js`
  (threaded `timeoutMs` → `generateOnce`).
- **v3 focusTracker wiped on same-career regeneration.** `normalizeRoadmapTree`
  only consulted `raw.focusTracker`, so a drift-refresh regen (raw has none, a v3
  `preserveFrom` does) rebuilt a fresh v1 tracker and dropped the user's `vBase`
  base + gap logs — durable, because the client `cacheRoadmap` overwrites local
  with the server tree. Fixed at `roadmap-tree.js:~1251` with a slug-guarded
  `carriedTracker`. Pinned by two new `test-vectors.cjs` assertions.

Opus: run `npm run test:vectors` and confirm both pass before building on this.

---

## 2. Confirmed macro-roadmap bugs (root-caused; fix these)

### 2.1 — "Extend this branch with AI" spins forever  ·  HIGH  ·  client
**Root cause (two layers — the deep one was found in the sweep):** the DEEPER cause
is **§3C.1** — `extendBranch` (`roadmap.js:1503`) does `setRoadmap(data.roadmap, false)`
then `render()`, and `render()` reloads `state.roadmap` from stale localStorage, so
the extended tree is thrown away entirely (the new nodes never appear — matching your
report). The SHALLOWER cause is that `extendBranch`'s success path never refreshes
the drawer (unlike `commitBranch:1480`), so the "Extending…" busy button also never
clears. **Fix 3C.1 first** (persist the server response to the local cache so
`render()` shows it), THEN add the drawer refresh on the extended node
(`FWRoadmapTree.refreshDrawerForNode(state.roadmap, nodeId, {})`) as the finishing
touch. The server already returns 409 (node cap) / 502 (model fail) correctly — do
NOT change the server. This same 3C.1 mechanism also makes **commit** appear to
revert; fixing 3C.1 addresses both.

### 2.2 — "Preview this path" has no real payoff  ·  MED  ·  design + client
**Root cause / current behavior:** `startBranchPreview`
(`assets/js/app/roadmap.js:1372`) computes the path, highlights it
(`setPreviewPath` + `redrawTree`), mounts a Commit/Exit banner, and kicks off a
background `ensureBranchBuilt(nodeId)` that only surfaces via a toast + a drawer
refresh *if the drawer is still open on that node*. So from the user's seat,
preview = "the path lights up," nothing more — the branch's actual future content
(its waypoints/steps) is never shown in a preview surface, and the silent
background build is invisible.
**This is a design task, not a one-liner.** Decide what "preview" should DO:
recommended — while previewing, render the branch's waypoints/steps inline (a
preview drawer or a right-rail list) so the user can actually evaluate the path
before committing, and surface the "tailored to you" build state visibly (skeleton
→ content) instead of a toast. Keep Commit/Exit. Get product sign-off on the
surface before building. Root-cause pointer for Opus: the preview path already has
`computePreviewPath` + `ensureBranchBuilt`; the gap is a rendering surface for the
previewed branch's content, not new data plumbing.

### 2.3 — Can't get back to the spine after tracking a branch in Focus  ·  HIGH  ·  client
**Root cause (partially traced — Opus, finish the trace):** the capability exists —
`FWSkillGapTracker.setActiveBranchKey(tree, 'spine')`
(`skill-gap-tracker.js:399`) re-pins to the spine's next waypoint, and
`branchSwitcherHtml` (`skill-gap-tracker.js:1725`) renders a "Main path" chip. BUT
the switcher is gated: it returns `''` unless `focuses.length` AND `chips.length >= 2`
(lines 1728/1737), and `trackBranchFocus` (line 370) stores `branchFocuses:[entry]`
with only the *secondary* branch (spine is implicit). Trace whether, in the states
the user actually reaches, the switcher renders at all — and separately whether the
MAP side (the tree canvas / drawer) lets the user open spine-node drawers once
`activeBranchKey` is a branch (check `canEditWaypoint`/`isPastWaypoint`/the
drawer's read-only gating against a branch-active tree). The user reports both "can't
switch back to the spine" AND "can't properly access the spine's waypoints," which
suggests the failure is on the map/drawer side, not only the focus switcher. Likely
fix surface: guarantee a visible, always-available "Main path" affordance in BOTH
the focus view and the map when any branch is active, and ensure spine-node drawers
stay openable. Confirm the exact gate before editing.
**Cross-reference — likely primary cause:** §3B.1 (the `chosenOptionId` clobber in
`normalizeRoadmapTree`) leaves `decisions`/`activePath` disagreeing with
`focusTracker.activeBranchKey` after any branch re-choice, which is exactly the kind
of state-desync that strands a user on a branch. Fix 3B.1 and 3C.1 first, then
re-test §2.3 — part of it may already resolve.

### 2.4 — Duplicated branch-focus update logic  ·  LOW  ·  maintainability
`followTreePath` (1538), `chooseTreePath` (1608), `mergeTreeSplit` (1676) in
`functions/_lib/roadmap-tree.js` each carry a ~30-line near-identical
branchFocuses/activeBranchKey update block. Three copies WILL drift (one already
differs — `followTreePath` walks to find the branch root; the others use
`childNodeId` directly). Extract one helper
(`addBranchFocus(tree, branchRootId, waypointId)`), route all three through it.
Low risk, high leverage — do it while fixing the graph bugs in §3 so the fixes
land in one place, not three.

---

## 3. Swept bugs from the deep audit  ·  (FILLED FROM AGENT FINDINGS — see below)

> The three parallel audit slices (server graph math, client canvas/drawer, AI
> endpoints) report into this section. Each finding: file:line, one-sentence root
> cause, failure scenario, severity. Confidence tags: CONFIRMED = verified against
> the code this session; REPORTED = agent-found, Opus should re-verify before
> fixing. Fix confirmed high/med; batch the low ones.

### 3A — AI-action endpoints (`functions/career-roadmap.js`)

**3A.1 — `split` has no false-success guard  ·  HIGH  ·  CONFIRMED.**
`career-roadmap.js:294-303`. `handleTreeGraphAction` split calls `mergeTreeSplit`
then `saveRoadmap` + 200 unconditionally. Unlike `extend` (237-239: `if node count
unchanged → 409`), split never checks whether any node was actually added, and
`mergeTreeSplit` (`roadmap-tree.js:1652`) sets `chosenOptionId = optionId`
regardless. Failure: Gemini returns `{"nodes":[]}` (or every node is filtered as a
dup / rejected by `normalizeNode` for a missing title) — still a truthy object, so
the 502 guard at 291 misses. The decision is marked permanently "chosen" toward an
empty branch and the user gets 200 `"You're now on the '<opt>' path."`
**Fix:** mirror extend — compare `roadmap.nodes.length` to `currentRoadmap.nodes.length`
after `mergeTreeSplit`; if unchanged, refund the rate-limit slot (see 3A.2) and
return 409/502 instead of a false success. Add a `test-request-paths.mjs` case.

**3A.2 — six branch handlers spend the rate-limit but never refund on failure  ·  HIGH  ·  CONFIRMED.**
`career-roadmap.js:213`(extend)/`272`(split)/`441`(gap-checklists)/`666`(branch-build)/
`719`(step-elaborate)/`1013`(waypoint-plan) each `checkRateLimit`, but their failure
paths never `refundRateLimit` — verified: `refundRateLimit` appears ONLY at
1391/1465/1563/1603 (the `roadmap-gen` generate path). Worse: extend + split +
branch-build share the SAME key `roadmap-split:${email}` capped at
`RATE_LIMIT_SPLIT_MAX = 20`/rolling-hour. A run of transient Gemini 429/503s across
those three drains one shared, never-replenished pool → the user is locked out of
all three for up to an hour having received zero successful responses. This is the
"never let a model hiccup eat an allowance" invariant.
**Fix:** refund the rate-limit slot on every non-user-caused failure in these six
handlers (mirror the generate path). Where a shared key is used, be sure the refund
targets the same key. This pairs with 3A.1 and 3A.3 (a false/empty success should
also refund).

**3A.3 — `gap-checklists` returns 200 even when generation fully fails  ·  MED-HIGH  ·  REPORTED.**
`career-roadmap.js:493-524`. On `callGeminiJson` → null (soft-fail) the map is `{}`,
every gap sanitizes to `[]`, the catch at 518-521 only logs, and the handler returns
200 `{ checklists: {} }` — the client can't tell "nothing to generate" from "failed."
**Fix:** signal failure (or a partial flag) when the model produced nothing, and
refund per 3A.2.

**3A.4 — `follow` never validates `targetNodeId` exists → silently resets the path  ·  MED  ·  CONFIRMED.**
`career-roadmap.js:176-191` → `recomputeActivePathToNode` (`roadmap-tree.js:1514`).
`follow` only checks the id is a non-empty string (siblings extend/split/choose all
check their target resolves). If `targetNodeId` isn't in `nodes` (stale client cache,
bad id), `recomputeActivePathToNode` breaks on the first lookup miss and returns bare
`['trunk']`; `followTreePath` persists that as `activePath`, discarding the branch/
depth the user had committed to, and returns 200 `"Committed to that path."`
**Fix:** 400 if `targetNodeId` doesn't resolve in `currentRoadmap.nodes`, before any
save.

**3A.5 — merge/save uses the client-supplied `currentRoadmap` as the base → cross-tab revert  ·  MED  ·  REPORTED.**
`career-roadmap.js:174`: `payload.currentRoadmap || loadRoadmap(...)`. The client tree
(only shape-checked via `isValidRoadmapTree`, never diffed/timestamp-checked — the
imported `ROADMAP_FRESH_MS` is never used here) becomes the merge base and is written
back. Two tabs open; tab B extends a branch; tab A (holding an older snapshot) calls
`follow` → the server merges onto tab A's STALE tree and saves, silently reverting
tab B's persisted nodes. This is the save/merge no-op-losslessness invariant at the
endpoint layer.
**Fix (decide with Jacob):** prefer the server row as the merge base, or reconcile
via `updatedAt`/a freshness check before accepting a client tree; at minimum,
last-writer-wins should not silently drop already-persisted nodes.

**3A.6 — `careerName` + node/decision/option titles reach prompts raw + unfenced  ·  MED  ·  REPORTED.**
`career-roadmap.js:404/613/724/1021` and `roadmap-tree.js:1841-1842`(extend)/
`2113-2116`(split)/`1932-1938`(branch-build). `trim()`/`trimForPrompt()` only
whitespace-trim + length-cap; they don't strip prompt-control chars the way
`sanitizeUntrustedText` (345-351) does, and these values aren't wrapped in a
"treat as DATA" tag like the fenced `<dossier>`/`<gaps>`/`<plan_item>` are.
`targetCareerName` (120-char free text, no filter) is replayed unfenced into every
extend/split/branch-build/waypoint-plan/gap-checklist/step-elaborate/generate-questions
call for the roadmap's life; node titles are user-editable via waypoint chat. Blast
radius is the acting user's own output, but it's systemic vs the file's own
convention.
**Fix:** run these through `sanitizeUntrustedText` and fence them as data in every
builder, matching the existing pattern.

**3A.7 — `handleStepElaborate` retry cascade has no wall-clock budget  ·  LOW-MED  ·  CONFIRMED.**
`career-roadmap.js:746-753` passes `timeoutMs:20000` (now honored after this
session's `callGeminiText` fix) but `callGeminiText` accepts no `deadlineAt`, so its
2-models × 3-attempts cascade can run ~125s vs the ~50s `deadlineAt` ceiling every
`callGeminiJson` sibling enforces — and stacks with 3A.2 (the spend at 719 isn't
refunded if it eventually fails).
**Fix:** give `callGeminiText` the same `deadlineAt` cascade budget as
`callGeminiJson`, or move step-elaborate onto a bounded path.

_Clean per this slice:_ auth gating (`requireSession` gates all actions),
session-scoped D1/KV keys, spend-before-guard ordering (input validated before
`checkRateLimit`), extend/branch-build/waypoint-plan false-success guards,
`saveRoadmap`'s re-normalize-or-throw safety net.

### 3B — Server graph math (`functions/_lib/roadmap-tree.js`)

**3B.1 — `normalizeRoadmapTree` reverts a branch RE-choice back to the old option  ·  HIGH  ·  CONFIRMED.**
`roadmap-tree.js:1161-1163`. The decision loop backfills `chosenOptionId` from
`preserveFrom` **unconditionally** — it only checks that `preserveFrom` HAD a value,
never that the fresh `raw` (`norm.chosenOptionId`) is already deliberately set:
```js
if (prev?.chosenOptionId) norm.chosenOptionId = prev.chosenOptionId; // clobbers
```
Verified: `normalizeDecision` DOES carry `chosenOptionId` from raw
(`chosenOptionId: raw.chosenOptionId ? trim(...) : null`), so a caller's new choice
is present in `norm` and then overwritten. Failure: user already chose option A of
decision D1; they preview + commit a *different* sibling option B →
`chooseTreePath` sets `chosenOptionId:'optB'`, recomputes activePath/activeBranchKey
to B, then calls `normalizeRoadmapTree(merged, current)` with `preserveFrom=current`
(still A). The loop reverts `chosenOptionId` to A, the final `computeActivePath`
(line 1227) reverts activePath to A's chain — but `focusTracker.activeBranchKey`/
`branchFocuses` (untouched by this loop) still point at B. Persisted roadmap has
decisions, activePath, and focusTracker disagreeing; the branch switch is silently
undone. Same clobber hits `mergeTreeSplit` and any `mergeTreePatch` that re-decides.
**This is very likely a primary cause of the "can't switch branches / can't get back
to spine" symptoms (§2.3).**
**Fix:** only backfill when `norm.chosenOptionId` is unset
(`if (!norm.chosenOptionId && prev?.chosenOptionId) norm.chosenOptionId = prev.chosenOptionId;`).
Add a `test-vectors.cjs` case: re-choosing D1 from A→B, normalize, assert
chosenOptionId===B and activePath follows B.

**3B.2 — a decision's branch-root node can be pruned with no exemption, dangling the decision  ·  HIGH (med in practice)  ·  CONFIRMED.**
`roadmap-tree.js:805-818` (the per-major subtree loop) removes any descendant with
`nodeConfidence(node) < 2` with **no `!branchRoots.has(id)` guard** — while the
generic loop three lines later (821-825) DOES exempt branch roots
(`nodeConfidence(n) < 2 && !branchRoots.has(n.id)`). Both add to the same `removeIds`
set and the per-major runs first, so a low-confidence branch root gets removed
regardless of the generic loop's protection. Compounding: `synthesizeMissingBranches`
(1208) validates decisions against the PRE-prune nodes (before 1209-1210 prune), and
nothing re-validates decisions after. Failure: AI emits a branch-root at
`confidence:1` under a major's decision option; `decisionHasValidBranches` passes,
prune deletes the root + subtree, `decisions[].options[].childNodeId` now dangles.
`computeActivePath`'s `byId.has` guard avoids a crash but silently serves a different
sibling branch than the one recorded as `chosenOptionId`.
**Fix:** add `!branchRoots.has(id)` to the per-major confidence check (mirror the
generic loop), and/or re-validate/repair decisions after pruning.

**3B.3 — `recomputeActivePathToNode` has no cycle guard (only an iteration cap)  ·  MED  ·  CONFIRMED.**
`roadmap-tree.js:1514-1527` walks `parentId` with `guard < MAX_TREE_NODES` but no
visited-set, unlike `computeActivePath` (957) which has one. `isValidRoadmapTree`
never checks for parentId cycles, and `career-roadmap.js:174` takes `currentRoadmap`
from the request body. A crafted tree with X.parentId=Y, Y.parentId=X →
`followTreePath('X')` produces `activePath=['trunk','Y','X','Y','X',…]` (30 entries),
persisted. Pairs with §3A.5 (client-supplied tree trust). **Fix:** add a visited-set;
bail on a repeat.

**3B.4 — new-node ingestion doesn't dedupe ids WITHIN one incoming batch  ·  MED-LOW  ·  REPORTED.**
`roadmap-tree.js:1150-1155` (core builder) and `mergeTreeExtend` (~1770) dedupe
against pre-existing ids but not against a repeat within the same subtree/batch, so
an LLM that reuses one fresh id twice yields two array entries sharing an id.
`Map`-based lookups resolve to the last, `.find()`-based to the first — different
pipeline stages disagree about which node is "X." **Fix:** dedupe incoming batches by
id (a seen-set), matching `mergeTreePatch`/`mergeTreeSplit`'s Map approach.

**3B.5 — 3× duplicated branch-focus block (same as §2.4)  ·  LOW  ·  CONFIRMED.**
`followTreePath`, `chooseTreePath`, `mergeTreeSplit`. Already diverging
(`followTreePath` walks to find the branch root; the others use `childNodeId`).
Extract one helper. Fix alongside 3B.1/3B.2 so the graph fixes land once.

_Clean per this slice:_ `normalizeNode`, `inferPathRoles`, `enforceSpineShape`,
`pruneExtraBranchRoots`, `assignConfidenceScores`, `computeActivePath`,
`canonicalizeBranchTitles`, `backfillWaypointSteps`, `mergeTreePatch` (aside from
inheriting 3B.1), the overall orchestration order.

### 3C — Client canvas / drawer (`roadmap-tree.js`, `roadmap.js`)

**3C.1 — branch-action server responses are discarded by `render()` reloading stale localStorage  ·  HIGH  ·  CONFIRMED  ·  THIS IS THE DEEPER CAUSE OF §2.1.**
`setRoadmap(rm, false)` (`roadmap.js:336-355`) sets `state.roadmap` in memory but
line 343 (`if (persist !== false && rm)`) **skips the localStorage write** when
`persist===false`. Then `render()` (line 1835: `state.roadmap = readRoadmap()`)
unconditionally reloads from `localStorage` (`FWAuth.readLocalRoadmap`, pure
`getItem('fw_roadmap_v1')` — `auth.js:759-777`), which still holds the PRE-action
snapshot. `commitBranch` (1474→1477), `extendBranch` (1503→1505), and
`ensureBranchBuilt` (1361→1362) all do `setRoadmap(data.roadmap, false)` then
`render()` → the fresh server tree is thrown away and the stale one reloaded.
Failures: extend's new nodes never appear (matches "never shows the extended
branch"); commit snaps back to "uncommitted" so the user re-clicks (re-sending a
stale `currentRoadmap`, feeding §3A.5); and worst — `trackBranchInFocus` (1516-1532)
runs `ensureBranchBuilt` (which reverts to the un-personalized template), then
`setRoadmap(updated, true)` (persist:TRUE, 1527) writes that stale template back to
the server via `PUT /profile/roadmap`, **durably overwriting the AI personalization
that had just succeeded.**
**Fix:** the `persist` flag conflates "write localStorage" and "re-save to server."
A server-returned roadmap is already saved server-side but must still update the
local cache so `render()` doesn't clobber it. Give these callers a mode that writes
localStorage (and notifies) WITHOUT a redundant server save — e.g. persist locally
via `FWRoadmapSync.publish` but skip `debouncedSave`, or split the flag into
`{persistLocal, persistServer}`. Then §2.1's drawer-refresh becomes the finishing
touch, not the fix. Verify: after extend/commit, `readRoadmap()` returns the new
tree and the canvas shows the new nodes.

**3C.2 — the drawer is orphaned on any full roadmap replacement (regenerate/pivot)  ·  HIGH  ·  CONFIRMED.**
The drawer `<aside id="roadmap-tree-detail">` is a sibling of `#roadmap-head/#body`
(`roadmap.html:54-60`), so `render()`'s innerHTML rebuild never touches it, and
`render()` only calls `FWRoadmapTree.closeDrawer()` when navigating OFF the page
(1827-1829), never on a same-page data swap. `generate()`/`wireRegen`, the
career-focus-change handler, and the `FWRoadmapSync.subscribe` handler all replace
`state.roadmap` wholesale without closing/refreshing the drawer;
`refreshDrawerForNode` silently returns if the held node id is gone from the new
tree. Failure: user regenerates with a drawer open; the tree rebuilds with fresh
node ids but the drawer shows the OLD waypoint; toggling a step calls
`toggleStep`/`toggleNodeDone` with a stale id → `canEditWaypoint` false → a confusing
"Only the most recently completed waypoint can be edited" toast on a waypoint that
looks current. **Fix:** on any full-tree replacement, close (or hard-refresh) the
drawer.

**3C.3 — `bindTreeCanvas` leaks listeners + a ResizeObserver on every re-render  ·  HIGH (perf)  ·  CONFIRMED.**
`roadmap.js:1539-1546` overwrites `state.treeController` on every `renderActive()`
(≈ every action) without calling the previous controller's `destroy()`; grep confirms
`.destroy(` is never called anywhere. Each `FWRoadmapTree.bindCanvas`
(`roadmap-tree.js:1241-1378`) registers window-resize, visualViewport-resize,
theme-change, a self-re-arming matchMedia DPR watcher, and a ResizeObserver — the
returned `destroy()` (1364) is dropped. Over a session, dozens accumulate on
window/document, each redrawing a detached zombie canvas on every resize/theme
toggle, and holding closures that prevent GC. **Fix:** capture the prior controller
and call `destroy()` before rebinding (or bind once and update in place).

**3C.4 — tree pointer handlers appear double-bound (legacy `on*` + `addEventListener`)  ·  MED  ·  REPORTED.**
Agent reports `roadmap-tree.js:1314-1321` sets both `canvas.onmousedown = onPointerDown`
and `canvas.addEventListener('pointerdown', onPointerDown)` (same for move/up), so a
mouse action fires both `mousedown` and `pointerdown` → handlers run twice (double
`buildLayout`+redraw per pan tick; double `openFocusView` on a node click, currently
masked by a timer guard). Opus: confirm the `onmousedown` assignments exist (my spot
check only saw the `addEventListener` lines) — if so, drop the legacy `on*` set.

**3C.5 — `esc()` in `roadmap-tree.js` doesn't escape quotes but is used in attributes  ·  MED  ·  REPORTED.**
`roadmap-tree.js:172-175` `esc()` handles only `&<>`; it's used in attribute contexts
(`data-node-id`, `data-step-id` at ~1083; `style="border-left-color:…"` at ~1071).
There is no `escAttr` in this file (skill-gap-tracker.js:195 has the correct one). A
`"` in an interpolated field breaks out of the attribute. `phaseColor` is
regex-validated server-side (not exploitable today); node/step ids have no such check
in this module — defense-in-depth gap. Same quote-unsafe pattern in `roadmap.js`
~1206/1243 (`data-slug`/`data-name`/`data-soc`). **Fix:** add/adopt `escAttr` for
attribute interpolations.

**3C.6 — empty/whitespace title → NaN canvas coords → no label pill  ·  LOW  ·  REPORTED.**
`wrapLabel` (708-724) returns `[]` for empty text; `drawNodeLabel` (737-766) then does
`Math.max.apply(null, [])` = `-Infinity` → `NaN` in `roundRectPath` (no-op'd by
Canvas). A titleless waypoint renders as a bare circle with no label. Narrow
(degenerate data), soft-fails. **Fix:** guard empty labels.

**3C.7 — dead param `committedBranchRoot`  ·  LOW  ·  CONFIRMED.**
`roadmap.js:1480-1483` passes `{committedBranchRoot: hit.option.childNodeId}` to
`refreshDrawerForNode`, but `renderDetailPanel` never reads it (comment claims it
"shows the branch focus option"). Inert / unimplemented intent — decide whether to
wire it or drop it.

_Clean per this slice:_ lucide usage (only `x`, registered); Marco/refine-chat
rendering (uses `textContent`); `toggleNodeDone`/`toggleStep`/`updateTreeNodes` (all
`setRoadmap(_, true)`, so not hit by 3C.1); camera/layout math on empty/single-node/
deep/cyclic trees (bounded, no NaN in the camera transform); the all-done focus
fallback; plain-text drawer fields (correctly `esc()`'d in text-node contexts).

---

## 4. Pivot / rebuild metering — DECISION MADE: option C

**Decision (Jacob, 2026-07-21):** when a user switches target careers through a
conversational pivot, **let the switch happen, but a capped free user cannot
rebuild the roadmap** — the roadmap keeps reflecting their INITIAL target career,
and they are told so.

**Current state (the leak):** four user-initiated retarget→rebuild surfaces exist.
`/career-focus` and `/career-roadmap` action:'chat' pivot BOTH meter the
`roadmap-generate` lifetime allowance. But **`chat.js:487` (Marco coach `coach_pivot`,
`force:true`) and `career-analysis.js:996` (`deep_dive_pivot`) call
`maybeSyncRoadmap` WITHOUT `meter:true`** — so a capped free user pivots via chat
and gets a full fresh roadmap for free.

**What Opus must build:**
1. Route the `coach_pivot` (`chat.js`) and `deep_dive_pivot` (`career-analysis.js`)
   sync calls through `maybeSyncRoadmap({ ..., meter:true })` (the opt-in flag added
   this session in `functions/_lib/roadmap-sync.js` — a capped call returns
   `{ capped:true, roadmap:null }` and never regenerates).
2. **Surface the capped state to the user.** The consuming code today only handles
   the success case (`if (syncResult?.roadmap && !syncResult.cached)`). Add a
   `capped` branch: the chat/deep-dive reply must say, in Marco's voice, something
   like "I've switched your target to {newCareer}, but rebuilding your full roadmap
   is a Flight Plan feature — your roadmap still reflects {initialCareer}. Upgrade to
   rebuild it around {newCareer}." Include the upgrade affordance the rest of the app
   uses for a 402/cap.
3. **The career switch itself still happens** (`recordCareerFocus` runs) — only the
   rebuild is gated. Design caveat Opus must resolve coherently: after this, the
   stored *focus* points at the new career while the stored *roadmap* still targets
   the old one. Make sure any surface that reads focus vs roadmap presents this
   without looking broken (the cap message is the anchor — lean on it). If the
   divergence proves too confusing, the fallback is to also gate the focus switch
   behind the cap; confirm the intended behavior with Jacob if it's not obvious in
   build.
4. A paid user's pivot rebuilds as today. Non-capped free users spend their one
   allowance (same as the primary flow).

**Verify:** extend `scripts/test-request-paths.mjs` with cases pinning: capped
free user coach_pivot → focus updated, roadmap NOT regenerated, `roadmap-generate`
spend unchanged, response carries the cap message; non-capped → spends once; failed
generation refunds (mirror the career-focus cases already added this session).

## 5. Deep-dive roadmap build must match the primary build UX

**Requirement (Jacob):** triggering a roadmap build from the deep-dive must give
the SAME initial experience as the primary build — the question wizard — AND the
generation must count against the free-tier limit.

**Current state:** the primary build (roadmap page / `career-focus`) runs the
question wizard (`action:'generate-questions'` → the `fw-qwiz` overlay in
`roadmap.js:477`) before a metered generate. The deep-dive pivot
(`career-analysis.js:989`) instead calls `recordCareerFocus` + `maybeSyncRoadmap`
**silently server-side** — no wizard, no metering.

**What Opus must build:** make the deep-dive "build/rebuild my roadmap for {career}"
action hand off to the SAME client flow the primary build uses — open the question
wizard, then run the metered generate — rather than silently regenerating on the
server. Concretely: the deep-dive pivot should stop calling `maybeSyncRoadmap`
directly for the build; instead signal the client (in the deep-dive response) to
launch the roadmap build flow (wizard → `action:'generate'`, which already meters
via `checkFeatureLimit`). A capped user hits the same §4 cap message. Trace the
primary flow's wizard→generate wiring in `roadmap.js` and reuse it — do NOT build a
parallel wizard.

**This unifies with §4:** §4 and §5 are the same subsystem (conversational pivot →
rebuild). Build them together: one coherent "pivot wants a rebuild" path that (a)
runs the wizard for the full UX, (b) meters, (c) shows the cap message when capped.

---

## 6. Verification (run before calling any workstream done)

- `npm run test:vectors` — any graph/merge/focusTracker/vector change.
- `npm run test:endpoints` — any request-path spend/refund/metering change; extend
  `scripts/test-request-paths.mjs` with the §4 cases.
- `npm run test:weekly`, `hub:verify`, `verify:aliases` — as touched.
- `node --check` on every touched JS.
- `npm run gates:unit` (~16s, 32 offline gates) before every commit; `npm run gates`
  (35, ~60s) once before the push.
- Client asset changed → bump its `?v=YYYYMMDD<letter>` buster on every page that
  references it (changed files only) and confirm `verify:busters` passes.
- Extend the test suites for every NEW invariant (don't rely on one-off checks).

## 7. Constraints

- Vanilla JS only. Extend existing modules (`FWRoadmapTree`, `FWSkillGapTracker`,
  `FWOnetVectors`), never add a parallel system.
- One targeted fix per confirmed cause; match each file's idiom; prefer `Edit` over
  rewrite. Don't restyle the waypoint layer.
- New `data-lucide` icons must be added to `assets/vendor/lucide-lite.js` first.
- Fragile subsystems (trace fully, verify with `test:vectors`): hydration→vector
  merge, accumulating math (vBase/fit), save/merge no-op losslessness, auth/session
  boundaries, Gemini retry/fallback cascades. Every new upstream call needs a
  `timeoutMs`; every cascade a wall-clock budget below the client timeout; degrade
  or refund on failure, never a bare throw that eats an allowance.
- Deploy = `git push origin Jacob_Work` (Jacob does this, not the agent).
