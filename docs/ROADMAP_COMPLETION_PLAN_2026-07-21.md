# Roadmap Completion & Launch-Readiness Plan — 2026-07-21

**Status:** PLANNED (not started). This is the last feature work before MVP launch.
**Owner context:** the roadmap branch/preview/focus system is functionally wired but
does not yet match the product vision. This doc turns Jacob's spec into a scoped,
multi-session execution plan with verified root causes.

Consult the `flightway-fullstack-architect` skill before writing code (model
delegation, per-task depth). Deploy = push to `Jacob_Work`. Gate with
`npm run gates:unit` before every commit, `npm run gates` once before the push.
Keep a running ledger in this file's **Progress log** section at the bottom.

---

## The vision (what "done" means)

The roadmap's differentiator is: **take where the user is at any given waypoint and
model where they could get to** — multiple branches, each a full explorable
sub-path with slightly different endpoints, all inside the space of the user's goal
(some branches may even reconverge onto shared spine waypoints, because there is
more than one path to the same destination). To make that real and safe for launch:

1. "Extend this branch with AI" must actually build out a rich, multi-waypoint
   sub-roadmap off the branch, treating the branch root as a confidence-5 start.
2. Branch waypoints must **never** visually overlap or cross the spine, other
   branches, or other waypoints — the GUI needs collision-aware layout.
3. Preview mode must let the user step through a branch waypoint-by-waypoint and
   must lock out interaction with the rest of the roadmap while previewing.
4. Committing to a branch must be reversible: the user can uncommit and return to
   the spine or switch to a different branch, as long as they're standing on the
   waypoint the branches fork from.
5. Focus-on-one-branch stays the model (no parallel multi-branch focus), but is
   only viable because (3) + (4) let the user change their mind, and because the
   branch can be continuously extended when its certainty scores run out.
6. The whole roadmap + its integration with the user home is swept for bugs so the
   product is launch-ready the moment this lands.

---

## Verified root causes (do not re-derive — confirmed against the code 2026-07-21)

- **RC-1 "Extend does nothing."** Two compounding causes:
  - **Layout length cap.** `assets/js/app/roadmap-tree.js` caps branch depth at
    `if (y < spineTipY - branchGap * 4) return;` in both `placeBranch` (~line 601)
    and the major-branch loop (~line 656). Nodes appended by extend land beyond
    that cutoff and are **never placed → never rendered**, so the tree looks
    unchanged even though the backend succeeds and the toast says "Added new steps
    to your branch." This is the primary reason "nothing happens."
  - **No collision-aware layout.** `placeBranch` walks a branch straight up
    (`y = startY - branchGap`) at a fixed lane `x = side * lane * siblingGap` with
    **zero overlap detection**. A long extended branch would collide with the spine
    and neighbouring branches even if the cap were lifted. See RC-2.
  - Backend `extend` (`functions/career-roadmap.js:198`) is gated on
    `isNodeOnChosenBranch(...)` and calls `buildExtendPrompt` → `mergeTreeExtend`,
    capping node count. The extend generation is small (`maxTokens: 3000`, "add
    steps"), **not** a full sub-roadmap build. Vision item (1) requires a richer
    generation that treats the branch root as a 5/5-confidence fresh start.
- **RC-2 Layout is depth-based, not collision-aware.** `buildLayout` in
  `assets/js/app/roadmap-tree.js` (~lines 540–673) assigns branch x by lane index
  and y by hop count; sub-branch forks nudge by `±0.55 * siblingGap`. Nothing
  checks whether two placed nodes occupy the same region. Extended/dense branches
  overlap. This is the core new engineering.
- **RC-3 Refine FAB overlaps the preview rail.** `syncRefineFabVisibility`
  (`assets/js/app/roadmap.js:1008`) hides the FAB when the chat, focus view, or a
  node drawer is open — but **not** when the preview rail is open
  (`state.previewNodeId`). So the "Refine plan" FAB (bottom-right) sits on top of
  the preview rail footer ("Commit to this path" / "Exit preview"). The rail is
  `z-index: 500` (`flightway-pages.css:3086`); the FAB is a `career-ask-fab` above
  it. Fix is small; see WS-B.
- **RC-4 Preview rail is whole-chain, not stepwise.** `renderPreviewRail`
  (`roadmap.js:1442`) dumps the entire branch chain into the rail at once. The spec
  wants: rail opens on the branch root's sample description; clicking the *next*
  branch waypoint advances the rail to that waypoint's sample; clicking anything
  *off* the previewed path shows an inline "you cannot interact with other parts of
  the roadmap in preview mode" message and opens nothing.
- **RC-5 No uncommit / switch-branch path.** There is `commitBranch` (choose/follow)
  and `trackBranchInFocus`, and `focusTracker.activeBranchKey` / `branchFocuses`
  (max 2) round-trip through `functions/_lib/roadmap-tree.js` (~lines 340–410), but
  there is **no action to un-choose a committed branch** and return `activeBranchKey`
  to `'spine'` or to a different branch. Spec item (4) requires this, gated on the
  fork waypoint being the user's most-recently-completed waypoint.

---

## Workstreams & session scope

The plan is scoped into **4 sessions**. Each session is independently shippable
(gate + push). Later sessions assume earlier ones landed. If a session runs long,
stop at a green gate and record where you paused in the Progress log.

### Session 1 — Branch layout engine + full-branch Extend (the structural core)
Everything else is cosmetic until branches can grow and not collide. Do this first.

- **WS-A1 Collision-aware branch layout (RC-1 cap, RC-2).**
  - Replace the hard `y < spineTipY - branchGap * 4` cutoff with a real bound that
    lets branches extend well past the spine tip (branches are allowed to be longer
    than the spine — that is the whole point of "model where they could get to").
  - Add an overlap-resolution pass to `buildLayout`: after tentative placement,
    detect node-box and edge collisions against (a) the spine column, (b) already-
    placed branch nodes, and (c) sibling branches, and push colliding branches
    outward (increase lane / x-offset) until clear. Keep it deterministic (stable
    given the same tree) so redraws don't jitter. A simple approach: reserve an
    x-interval per branch subtree (width = max lane depth of that subtree), assign
    non-overlapping intervals left/right of the spine, then place within the
    interval. Verify with a dense synthetic tree fixture.
  - Ensure edges (branch connectors) don't cross the spine or other branch edges;
    if a reconverging branch rejoins a spine node, route its edge cleanly.
  - Update `npm run layout:check` matrix expectations if node positions change.
    Add at least one fixture with a deeply-extended branch (8+ hops) and assert no
    two node boxes overlap.
- **WS-A2 Extend = build a real sub-roadmap (RC-1 backend).**
  - Rework the `extend` action (`functions/career-roadmap.js:198` +
    `buildExtendPrompt` in `functions/_lib/roadmap-generate.js` or wherever it
    lives) so it generates a **multi-waypoint** continuation (aim ~3–6 new
    waypoints with full steps), treating the branch root/tip as a **confidence-5
    fresh start** and decaying confidence along the new hops. Keep it inside the
    user's target-career goal space; endpoints may differ from the spine and may
    optionally reconverge on a spine waypoint.
  - Confirm the frontend `extendBranch` (`roadmap.js:1556`) surfaces the new nodes:
    after RC-1's layout fix the appended nodes must actually render; verify the
    drawer refresh (`refreshDrawerForNode`) and toast fire correctly.
  - Keep rate-limit/refund semantics (`roadmap-split:` bucket) and the node-cap
    "at its size limit" guard, but raise the cap enough to allow a genuinely long
    branch. Decide the new cap explicitly and record it.
  - **Continuous extension (vision 5):** the "Extend this branch with AI" CTA must
    remain available at the branch tip whenever the tip's confidence has decayed
    below the branch threshold, so a focused branch can always grow further.

### Session 2 — Preview mode rework (RC-3, RC-4)
- **WS-B1 Refine FAB vs preview rail (RC-3).** Add `!state.previewNodeId` (preview
  open) to the `show` condition in `syncRefineFabVisibility` (`roadmap.js:1008`),
  and call `syncRefineFabVisibility()` from `mountPreviewRail`/`unmountPreviewRail`
  so the FAB hides the instant preview opens and returns when it closes. Verify no
  z-index overlap remains at mobile + desktop widths.
- **WS-B2 Stepwise preview (RC-4).** Change the preview rail from whole-chain dump
  to a single-waypoint view starting at the branch root's sample description
  (matches the current first-waypoint screenshot). Clicking the **next** waypoint
  on the previewed branch advances the rail to that waypoint's sample description
  (load its steps like the first). Provide clear affordance for "next".
- **WS-B3 Preview-mode interaction lock (RC-4).** While the rail is open
  (`state.previewNodeId` set), a click on any node that is **not** the next-up
  waypoint on the previewed branch (and not on that branch at all) must open no
  drawer/interface and instead show a small inline message in the rail:
  "You cannot interact with other parts of the roadmap in preview mode." Route this
  through the tree's node-select handler (`onNodeSelect` / the canvas click path in
  `roadmap-tree.js`) so preview mode intercepts before any drawer opens.

### Session 3 — Commit / uncommit / switch + focus lifecycle (RC-5, vision 4–5)
- **WS-C1 Uncommit backend (RC-5).** Add an `uncommit` (or `reset-path`) action to
  `functions/career-roadmap.js` that clears the chosen option on the relevant
  decision, restores `activePath` to the default spine (or to a different chosen
  branch), and resets `focusTracker.activeBranchKey` to `'spine'`. Reuse the
  existing branch-focus normalization in `functions/_lib/roadmap-tree.js`
  (~340–410). Guard it: only allowed when the fork waypoint (the branch's parent
  major spine node) is the user's **most-recently-completed** waypoint, so the user
  can't rewrite deep history. Persist + return the updated roadmap.
- **WS-C2 Uncommit / switch UI.** In the waypoint drawer (and/or the focus view),
  when the user is committed to a branch that forks off their current position,
  surface controls to: (a) uncommit and return focus to the spine, (b) switch to a
  different branch off the same fork. Wire to WS-C1. Update the focus HUD/chips so
  the current focus target reflects the change (see `roadmap.js:822`, `:1584`).
- **WS-C3 Focus-only-on-branch viability check.** Confirm the end-to-end loop the
  vision requires works: commit to a branch → focus on it → reach its end → extend
  it with AI (WS-A2 continuous extension) → or change your mind and uncommit back to
  spine (WS-C1). Keep the single-active-focus model (no parallel branch focus).

### Session 4 — Full roadmap + home integration bug sweep + launch readiness (vision 6)
- **WS-D1 Roadmap surface sweep.** Exercise every roadmap interaction after
  sessions 1–3 land: generate, commit, preview (stepwise + lock), extend (long
  branch, cap), uncommit/switch, focus enter/exit, mark done/undone, refine chat.
  Look for regressions from the layout rewrite in particular (edge routing,
  reconverging branches, drawer refresh, cache-busters on changed assets).
- **WS-D2 Home / dashboard integration sweep.** Verify the roadmap's touchpoints on
  the user home (`dashboard.html` / `portal.html` / wherever the roadmap card,
  readiness meter, and "current focus" surface) reflect branch commit/uncommit and
  extension correctly — no stale focus labels, no broken deep-links into the
  roadmap, readiness meter consistent with roadmap state.
- **WS-D3 Final launch-readiness sweep.** Run full `npm run gates`. Confirm all
  feature flags gating paywall/grounding are in their intended launch state. Record
  a go/no-go for MVP launch.

---

## Guardrails (apply in every session)
- One targeted fix per confirmed bug; don't restyle/refactor working code.
- Bump `?v=` cache-busters only on files actually changed, only on referencing pages.
- Verify with project scripts + `curl` + headless probes, not browser MCP, except
  when diagnosing a live boot/console bug.
- `npm run gates:unit` before every commit; `npm run gates` once before the push;
  `npm run layout:check` (full 270-cell) whenever branch layout math changed.
- Keep responses proportional; keep the Progress log below current.

---

## Progress log
_(append one dated entry per session: what shipped, commit hash, what's deferred,
any new traps discovered.)_

- 2026-07-21 — Plan authored. Nothing executed yet.
- 2026-07-21 — **Session 1 SHIPPED (WS-A1 + WS-A2).** The structural core is in.
  - **WS-A1 collision-aware layout** (`assets/js/app/roadmap-tree.js`): `buildLayout`
    rewritten. The two hard depth cutoffs (`y < spineTipY - branchGap*4`) are gone,
    so a committed branch may run arbitrarily far past the spine tip. Placement now
    reserves disjoint vertical lane-bands per branch subtree (`subtreeWidth` +
    `placeBranchSubtree`): the spine holds lane 0 (x=0), left branches x<0, right
    x>0, packed strictly outward, so no two branches ever share an x. Linear
    continuations run straight up their inner lane (hops -branchGap in y, so same-
    lane nodes never share a y either); sub-forks claim outward lanes. Deterministic
    (no rng). Client `MAX_NODES` 24→48 so long-branch ancestor walks don't truncate.
  - **WS-A2 full-branch extend** (`functions/_lib/roadmap-tree.js`,
    `functions/career-roadmap.js`): `buildExtendPrompt` now asks for a 3-6 waypoint
    sub-roadmap (was "1-2 nodes"), framing the branch tip as a fresh confidence-5
    start that decays along the new hops; extend action `maxTokens` 3000→5200,
    timeout 30s→40s. `mergeTreeExtend` gained a per-call cap (`MAX_EXTEND_PER_CALL=6`)
    on top of the raised tree ceiling.
  - **Cap changes (recorded):** `MAX_TREE_NODES` 30→**48**, `MAX_EXTEND_NODES`
    28→**46**, new `MAX_EXTEND_PER_CALL` = **6**, `ROADMAP_TREE_MAX_CHARS`
    48000→**90000**. `MAX_TREE_DEPTH` left at 6 (normalizeNode clamps depth, so it
    never fails validation; layout/prune/confidence all use hop-count, not node.depth).
  - **Three compounding root causes of "extend does nothing" fixed, not just the
    layout cap the plan named:** (RC-1) the client depth cap; PLUS (2) the server
    `pruneBranchNodes` mirror that deleted any branch node past the spine-tip depth —
    now the **committed** branch (chosen decision-option descendants ∪ activePath) is
    exempt from length/depth/pre-floor-confidence pruning; PLUS (3)
    `assignConfidenceScores` decayed branch confidence at 1/hop with a floor of **1**,
    and the renderer/layout/step-backfill all skip confidence-≤1 nodes — so deep
    extended nodes were generated then rendered invisible. Now `forkBase =
    nodeConfidence(major)`, decay 0.5/hop, **floor 2**.
  - **Ordering trap discovered:** `pruneBranchNodes` runs BEFORE
    `assignConfidenceScores`, so it prunes on the raw AI confidence, not the floored
    one. That's why the committed-branch prune exemption had to cover the confidence
    prune too, not only the length prune — otherwise a just-extended conf-1 waypoint
    is deleted the instant it lands, before the floor can save it.
  - **Test/gate:** new `scripts/test-roadmap-layout.mjs` (`npm run roadmap:layout`,
    registered in run-gates pure lane). Loads the real client module in a vm sandbox
    and asserts no-overlap / no-spine-cross / determinism on a base tree, an 8+ hop
    (12) extended branch, and a sub-fork tree; drives the real server
    `normalizeRoadmapTree`/`mergeTreeExtend` to prove a committed branch grows by a
    6-waypoint chunk twice, past the spine-tip depth, all nodes floored ≥2, while an
    uncommitted sibling stays capped. Note: `layout:check` is canvas-opaque (DOM/CSS
    only) so it can't see node positions — this is the right home for the overlap
    assertion, not the layout matrix.
  - **Not touched (later sessions):** preview stepwise/lock (S2), uncommit/switch
    (S3), home-integration + launch sweep (S4). The extend CTA already re-appears on
    each new tip via `branchDrawerState.isTip` — continuous extension works with no
    frontend change once the branch actually grows.
  - Commit: `d94e01c`.
- 2026-07-21 — **Session 2 SHIPPED (WS-B1 + WS-B2 + WS-B3).** Preview mode reworked
  entirely in `assets/js/app/roadmap.js` + `assets/css/flightway-pages.css`
  (roadmap-tree.js untouched — the click-intercept point already existed).
  - **WS-B1 FAB hidden while previewing.** `syncRefineFabVisibility` gained
    `&& !state.previewNodeId`; `mountPreviewRail`/`unmountPreviewRail` now call it,
    so the Refine FAB (z-index 8500, was sitting over the rail's Commit/Exit footer
    at z-index 500) disappears the instant preview opens and returns on exit.
  - **WS-B2 stepwise rail.** `renderPreviewRail` no longer dumps the whole chain —
    it renders ONE waypoint (`state.previewStep`, starts at 0 = branch root) with a
    "Waypoint N of M" counter, a "Next: <title> →" button, a "← Back" button past
    step 0, and a per-step hint. New `previewBranchNodes()` derives the ordered
    list from the SAME `computePreviewPath(previewNodeId)` chain that lights the
    canvas (branch-role suffix; falls back to full chain when untagged) so rail /
    highlight / lock all agree on one path. `advancePreview(±1)` clamps + re-renders.
    Signature dropped its `nodeId` arg (reads `state.previewNodeId`); all 4 callers
    updated. Commit semantics unchanged — the footer still commits the whole
    previewed path via `previewNodeId`, regardless of the step you're viewing.
  - **WS-B3 interaction lock.** `onNodeSelect` (in `bindTreeCanvas`) now intercepts
    every node click first when `state.previewNodeId` is set, routing to
    `handlePreviewNodeClick`: clicking the next-up waypoint advances the rail;
    clicking the waypoint you're viewing is a silent no-op; ANY other node opens
    nothing and flashes an inline rail message "You cannot interact with other
    parts of the roadmap in preview mode." It always returns `true`, so
    `onPointerDown` never opens a drawer in preview mode (trunk included). The
    message element lives in the rail's static structure (not the re-rendered body),
    `role="alert"`, auto-hides after 3.4s, cleared on a real advance.
  - **Deliberate scope calls:** (a) previewed branch = root→target ancestor chain
    only, no descendant/tip walk — keeps the rail list, canvas highlight, and lock
    perfectly consistent and avoids guessing at sub-forks; the tested entry point is
    a deep/tip node so root→target already spans the branch (matches the S-log's
    "rail opens on the branch root" screenshot note). (b) On mobile the rail is
    full-screen so canvas-tap-to-advance isn't reachable there — the Next button is
    the primary affordance, canvas-tap is the desktop bonus. (c) CSS is a shared
    file: `verify:busters` requires one stamp repo-wide, so the `flightway-pages.css`
    buster went `20260722a→b` on all 10 referencing pages (not a blanket re-stamp —
    the file changed); `roadmap.js` `20260722c→d` on roadmap.html only.
  - **Verify:** `node --check` + full `npm run gates:unit` green (33/33, incl.
    verify:busters + roadmap:layout). No layout math changed → quick layout mode is
    correct; full `layout:check` not required this session.
  - **Not touched (later sessions):** uncommit/switch + focus lifecycle (S3), full
    roadmap + home bug sweep (S4). Full end-to-end interaction QA of preview is
    explicitly S4/WS-D1.
  - Commit: the Session-2 `feat(roadmap): stepwise preview mode…` commit (see `git log`).
- 2026-07-21 — **Session 3 SHIPPED (WS-C1 + WS-C2 + WS-C3).** Commit/uncommit/switch
  is now a reversible loop, gated so it can never rewrite progress history.
  - **WS-C1 uncommit backend** (`functions/_lib/roadmap-tree.js`,
    `functions/career-roadmap.js`): new `uncommitTreePath(current, decisionId,
    switchOptionId)` — `null` un-chooses the decision (activePath falls back to the
    default spine, `focusTracker.activeBranchKey → 'spine'`); a sibling `optionId`
    re-chooses it (switch branches off the same fork, focus → the new root, exactly
    like `chooseTreePath`). New exported `latestCompletedWaypointId(tree)` mirrors
    the client helper (deepest done node on activePath = the user's frontier). New
    `uncommit` action in `handleTreeGraphAction` (added to the graph-action dispatch
    list): validates the decision has a committed option, validates any switch
    target, then applies the **guard** — `latestCompletedWaypointId(currentRoadmap)
    === decision.nodeId` (the fork must still be the frontier). Past that → 409 with
    a plain-language message; the client also hides the controls, so the 409 is
    defense-in-depth, not the primary wall.
  - **WS-C2 UI** (`assets/js/app/roadmap-tree.js`, `roadmap.js`): `branchDrawerState`
    now exposes `canUncommit` (committed branch AND fork is the frontier) + a
    `switchTarget` (the sibling option's root + label). The committed-branch drawer
    block gained "Switch to <label>" and "Return to main path" buttons (only when
    `canUncommit`), wired through new `onUncommitBranch`/`onSwitchBranch` canvas
    callbacks to `changeBranchCommit(nodeId, targetOptionId)` in roadmap.js — one
    handler for both, FWConfirm dialog + guarded `uncommit` POST, adopts the saved
    tree (`setRoadmap(..,'local')`), closes the drawer, re-renders. The focus
    HUD/chips reflect the change automatically (they read `activeBranchKey`/
    `branchFocuses` off the adopted tree). **Also closed the pre-existing ungated
    switch hole:** clicking "Commit to this branch" on a *sibling* of an
    already-committed fork used to call the ungated `choose`; `commitBranch` now
    detects that case (decision already committed to a different option) and reroutes
    it through the guarded `uncommit`+optionId path. Initial commit (no prior choice)
    is untouched.
  - **WS-C3 loop viability:** the `roadmap:layout` gate's new WS-C section drives the
    real server helpers to prove commit-at-fork → uncommit-to-spine and → switch-to-
    sibling both rewire commit + focus, and that once any branch waypoint is done the
    frontier moves past the fork so the guard blocks the change. Continuous extension
    (WS-A2) + single-active-focus (`activeBranchKey` is single-valued) are unchanged.
  - **Two traps discovered/fixed while wiring it:**
    (1) `normalizeRoadmapTree(merged, current)` backfills a decision's prior
    `chosenOptionId` from `preserveFrom` when raw carries none (the regenerate-path
    "don't revert a re-choice" logic, roadmap-tree.js:1263) — which **resurrected the
    very choice uncommit had just cleared.** Fix: `uncommitTreePath` passes
    `preserveFrom=null`; `merged` already carries its own `focusTracker`, so the v3
    tracker is not lost. (Switch was unaffected — its choice is non-null.)
    (2) A waypoint is "done" only when its **steps** are done — `syncNodeDoneFromSteps`
    in normalize derives `node.done` from steps, so a test/fixture that sets
    `node.done` alone is wiped on the round-trip. The layout test's `markDone` now
    marks steps too (mirrors the app's `toggleNodeDone`).
  - **Deliberate scope call:** an un-started AI *extension* on a branch you uncommit/
    switch away from is not preserved — once uncommitted the branch loses S1's
    committed-branch prune exemption and reverts to its within-budget form. The guard
    means this only ever hits a branch with zero completed waypoints, and extensions
    are regenerable, so it's an acceptable abandon-cost, not silent progress loss.
  - **Cache-busters:** `roadmap-tree.js` `20260722c→d` (portal.html + roadmap.html),
    `roadmap.js` `20260722d→e` (roadmap.html only). `skill-gap-tracker.js` untouched
    (focus HUD updates fall out of the adopted tree; no focus-view control added).
  - **Not touched (Session 4):** full roadmap + home-integration bug sweep, launch
    readiness. Live end-to-end interaction QA of uncommit/switch is S4/WS-D1.
  - Commit: `bb41185`.
- 2026-07-21 — **Session 4 SHIPPED (WS-D1 + WS-D2 + WS-D3) — MVP launch: GO.**
  Bug sweep + launch-readiness. **Zero code changes** — the sweep confirmed the
  S1–S3 composition is sound; editing working code the night before launch would
  only add regression risk. Findings below.
  - **Baseline `npm run gates`: 36/36 green in 56.7s** against the deployed state
    (full `layout:check` 35.9s, `pages:smoke` 27.3s, `roadmap:layout` 1.1s). No
    code changed all session, so this baseline IS the final pre-launch gate run.
  - **WS-D1 roadmap surface — no launch-blocking bugs.** Traced the S1×S2×S3
    composition the gates can't see (each gate verifies one session in isolation
    and none can drive canvas clicks):
    - Interaction lock (S2) × drawer: `onPointerDown` (roadmap-tree.js:1350) returns
      before `renderDetailPanel` when `onNodeSelect` returns `true`, so
      `handlePreviewNodeClick` genuinely blocks every drawer while previewing.
    - `pathRole` (S2's `previewBranchNodes` filter) is server-assigned in normalize
      and carried through S1's rewritten `buildLayout` (line 677) — topology-derived,
      not position-derived, so the layout rewrite can't break preview-path derivation.
    - Adopt-and-rerender (S1 extend, S3 uncommit/switch) both go through
      `setRoadmap(data.roadmap,'local')` + full `render()`; the canvas rebuilds from
      the adopted tree each time → no incremental-mutation stale-edge risk.
    - S1 collision-avoidance holds: disjoint lane-bands per subtree (linear inner /
      sub-forks outward); the `subtreeWidth`↔`placeBranchSubtree` lockstep is
      conservative under reconvergence (over-reserves → gap, never overlap).
    - Server (career-roadmap.js): `uncommit` is in the dispatch allow-list (1236),
      validates every input (no 500 on bad decisionId), applies the fork-frontier
      409 guard; `extend` refunds the `roadmap-split:` slot on both failure paths and
      keeps timeouts (40s/60s) under the 120s client abort; uncommit consumes no rate
      slot (nothing to refund).
  - **WS-D2 home integration — no stale labels, no data loss.**
    - dashboard.html: roadmap card is a pure deep-link (`roadmap.html?career=`), the
      readiness meter is fit-derived (`career.preparedness`) — neither mirrors roadmap
      tree state, so branch commit/uncommit/extend can't make it stale by construction.
    - portal.html ("Your home") DOES render a readiness panel from
      `focusTracker.skillGaps` (portal.js:844). It stays fresh because every adopt runs
      `setRoadmap`→`withFocusTracker` (roadmap.js:327), which detects `branchChanged`
      by comparing `activeBranchKey` before/after and calls
      `ensureFocusTracker(…,{branchChanged})` to regenerate gaps for the new branch's
      waypoint, then publishes to storage + `notifyPortalRoadmapChanged`. Same
      mechanism commit uses — symmetric, no S3 regression.
    - Deep-link data safety: `render()` routes to `renderActive` whenever a valid
      roadmap exists (roadmap.js:2097); `renderEmpty`'s pending-career auto-generate
      (1316) only fires in the no-roadmap branch, so the dashboard link can never
      silently overwrite a committed roadmap. Retarget still requires the mismatch-chip
      confirm dialog. Orphaned-drawer-after-tree-swap is covered by the §3C.2 chokepoint
      (render 2080-2089).
  - **Live deploy verified fresh:** live roadmap.html serves the repo stamps
    (roadmap.js@20260722e, roadmap-tree.js@20260722d, css@20260722b); both assets 200
    and contain the S1–S3 symbols; `pages:smoke` boots /roadmap.html + /portal.html with
    zero pageerrors, so the deployed code boots clean.
  - **WS-D3 flag posture (all correct for MVP at env-unset defaults):**
    `PAYWALL_ENABLED` unset→false (paywall dark), `GROUNDING_ENABLED` unset→false
    (Opportunity Finder search off), `ROOT_ADMIN_EMAIL` unset→admin 404s. **No flag
    gates the roadmap branch/preview/uncommit features — S1–S3 is always-on and reachable
    by every user at launch.** The three env vars are Jacob's deploy-time choices (flip in
    the CF dashboard when monetizing / enabling live search / granting admin); none block
    the core product.
  - **Known non-blocking limitations (post-launch polish; deliberately NOT fixed
    pre-launch):** (a) `commitBranch`'s `follow` ternary branch (1634) is unreachable
    (`hit` always truthy past the 1602 early-return) — harmless dead defensiveness.
    (b) A branch SWITCH closes the drawer rather than reopening on the new branch root;
    the switch still lands (toast + re-render). (c) Branch→spine reconvergence edges
    aren't routed, but no generator produces that parentId shape today (line 634 filters
    spine from branch walks) — a future capability, not a live gap.
  - **Verdict: GO for MVP launch** on the roadmap + home surface. Gates green, deploy
    live and fresh, flags in intended state, no launch-blocking bugs found.
  - Commit: this Session-4 ledger entry (see `git log`).
