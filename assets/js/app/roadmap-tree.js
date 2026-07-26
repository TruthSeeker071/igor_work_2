/**
 * Roadmap tree v2 — canvas renderer, layout, and client helpers.
 */
(function (global) {
  const TREE_VERSION = 2;
  // Guards the trunk->node ancestor walks (preview path, follow path, decision
  // lookup) and the v1 migration cap. Must stay >= the server's MAX_TREE_NODES
  // so a long committed+extended branch's chain is walked in full, not truncated.
  const MAX_NODES = 48;
  const TRUNK_SCREEN_Y = 0.88;

  let layoutCache = null;
  let viewState = { panX: 0, panY: 0, zoom: 1 };
  let dragState = null;
  let hoveredId = null;
  let callbacks = {};
  let viewW = 0;
  let viewH = 0;
  let viewFitted = false;
  let boundTreeKey = '';
  let displayPctByNode = {};
  let openDrawerNodeId = null;
  let drawerError = '';
  // Client-only preview of an alternate route (WS1). Never persisted — a set of
  // node ids trunk->target; when active the renderer accents these and dims the
  // committed activePath. Cleared on commit / exit / Escape.
  let previewPathIds = null;

  function nodeStepProgress(node) {
    const raw = node && node.raw ? node.raw : node;
    const steps = (raw && raw.steps) || [];
    if (!steps.length) {
      return { done: 0, total: 0, pct: raw && raw.done ? 100 : 0 };
    }
    const done = steps.filter(function (s) { return s.done; }).length;
    const total = steps.length;
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function syncNodeDoneFromSteps(node) {
    if (!node) return node;
    const prog = nodeStepProgress(node);
    if (prog.total > 0) {
      node.done = prog.done === prog.total;
      node.status = node.done ? 'completed' : 'active';
    }
    return node;
  }

  function careerValueLabel(value) {
    if (value === 'knowledge') return 'Builds knowledge';
    if (value === 'network') return 'Expands network';
    if (value === 'resume') return 'Resume deliverable';
    return 'Mixed career value';
  }

  function lerpDisplayPct(id, target) {
    const cur = displayPctByNode[id] != null ? displayPctByNode[id] : target;
    const next = cur + (target - cur) * 0.22;
    displayPctByNode[id] = Math.abs(next - target) < 0.5 ? target : next;
    return displayPctByNode[id];
  }

  function setDrawerOpen(open) {
    const panel = document.getElementById('roadmap-tree-detail');
    if (document.body) {
      document.body.classList.toggle('roadmap-drawer-open', !!open);
    }
    if (!panel) return;
    if (open) {
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('open'); });
    } else {
      panel.classList.remove('open');
    }
    if (global.FWRoadmap && typeof FWRoadmap.syncRefineFabVisibility === 'function') {
      FWRoadmap.syncRefineFabVisibility();
    }
  }

  function titleCaseGap(s) {
    if (global.FWHubCanvasBg && FWHubCanvasBg.titleCaseSkill) {
      return FWHubCanvasBg.titleCaseSkill(s);
    }
    return String(s || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function treeColors() {
    if (global.FWHubCanvasBg && FWHubCanvasBg.getRoadmapTreeColors) {
      return FWHubCanvasBg.getRoadmapTreeColors();
    }
    return {
      labelBg: 'rgba(10, 9, 8, 0.94)',
      labelBgMuted: 'rgba(10, 9, 8, 0.82)',
      labelText: '#ffffff',
      labelTextMuted: '#eef1f8',
      labelBorder: 'rgba(255, 255, 255, 0.28)',
      labelBorderMuted: 'rgba(255, 255, 255, 0.14)',
      nodeShell: 'rgba(16, 14, 12, 0.72)',
      nodeStroke: 'rgba(255, 255, 255, 0.35)',
      nodeStrokeHover: '#ffffff',
      trunkSubtext: 'rgba(255, 255, 255, 0.5)',
      pctText: 'rgba(255, 255, 255, 0.92)',
    };
  }

  function wrapDrawerContent(headHtml, bodyHtml, footHtml) {
    return '<div class="roadmap-detail-inner">'
      + '<div class="roadmap-detail-head">' + headHtml + '</div>'
      + '<div class="roadmap-detail-scroll">' + bodyHtml + '</div>'
      + (footHtml ? '<div class="roadmap-detail-foot">' + footHtml + '</div>' : '')
      + '</div>';
  }

  function shortTitleFromTitle(title) {
    const t = String(title || '').trim();
    if (t.length <= 36) return t;
    const cut = t.slice(0, 36);
    const lastSpace = cut.lastIndexOf(' ');
    return lastSpace > 16 ? cut.slice(0, lastSpace) : cut;
  }

  function isTruncatedShortTitle(shortTitle, fullTitle) {
    const s = String(shortTitle || '').trim();
    const f = String(fullTitle || '').trim();
    return !!(s && f && f.startsWith(s) && s.length < f.length);
  }

function canonicalBranchDisplayTitle(title) {
  const t = String(title || '').trim();
  if (/^explore depth:/i.test(t)) return 'Explore depth';
  if (/^alternative angle:/i.test(t)) return 'Alternative angle';
  if (/^build on/i.test(t)) return 'Further development';
  // New specific gap-based branch titles
  if (/^deepen /i.test(t)) return t.replace(/^deepen /i, 'Deepen ');
  if (/^alternative: /i.test(t)) return t.replace(/^alternative: /i, 'Alt: ');
  if (/^apply .+ in practice/i.test(t)) return 'Apply in practice';
  if (/^build .+ portfolio/i.test(t)) return 'Build portfolio';
  return '';
}

  function displayTitle(raw) {
    if (!raw) return '';
    const canon = canonicalBranchDisplayTitle(raw.title);
    if (canon) return canon;
    return raw.title || '';
  }

  function canvasLabel(raw) {
    if (!raw) return '';
    const canon = canonicalBranchDisplayTitle(raw.title);
    if (canon) return canon;
    const title = String(raw.title || '').trim();
    if (title.length <= 42) return title;
    const st = raw.shortTitle ? String(raw.shortTitle).trim() : '';
    if (st && st.length < title.length - 8 && !isTruncatedShortTitle(st, title)) return st;
    return shortTitleFromTitle(title);
  }

  function nodeConfidence(n) {
    if (!n) return 3;
    if (n.confidence != null) return Math.max(1, Math.min(5, n.confidence));
    if (n.certainty != null) return Math.max(1, Math.min(5, n.certainty));
    if (n.raw) return nodeConfidence(n.raw);
    return 3;
  }

  function pathRolePrefix(role) {
    if (role === 'branch') return '[Branch] ';
    if (role === 'spine') return '[Spine] ';
    if (role === 'alternate') return '[Branch] ';
    return '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // §3C.5: esc() alone leaves quotes intact, so a value with a " in an attribute
  // context (data-node-id, style="…") could break out. Use escAttr for attributes.
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function treeKey(tree) {
    const dec = (tree.decisions || []).map(function (d) {
      return d.id + ':' + (d.chosenOptionId || '');
    }).join('|');
    return (tree.targetCareerSlug || '') + ':' + ((tree.nodes || []).length) + ':' + dec;
  }

  function isTreeRoadmap(rm) {
    return !!(rm && rm.version === TREE_VERSION && rm.trunk && Array.isArray(rm.nodes) && rm.nodes.length);
  }

  function backfillWaypointStepsClient(node, fitContext) {
    const actionType = node.actionType || 'other';
    const templates = {
      class: ['Research course options for this goal', 'Enroll in the best-fit class', 'Complete coursework and record the outcome'],
      project: ['Define the project scope and deliverable', 'Build and iterate on the project', 'Publish results or add to your portfolio'],
      skill: ['Identify specific skills to practice', 'Complete focused practice sessions', 'Demonstrate the skill with a small deliverable'],
      network: ['List 5 people to reach out to', 'Send intros or schedule coffee chats', 'Follow up and document what you learned'],
      other: ['Clarify what done looks like for this step', 'Take the first concrete action', 'Document the outcome for your resume'],
    };
    const texts = templates[actionType] || templates.other;
    const gap = (fitContext && fitContext.topGaps && fitContext.topGaps[0]) || '';
    return {
      whyItMatters: gap
        ? ('This waypoint helps close your gap in ' + gap + ' and moves you toward your target career.')
        : ('This waypoint breaks a big goal into actions you can finish this semester.'),
      addressedGaps: gap ? [gap] : [],
      careerValue: 'mixed',
      steps: texts.map(function (text, i) {
        return { id: node.id + '-st' + (i + 1), text: text, done: false };
      }),
    };
  }

  function ensureWaypointContent(tree) {
    if (!isTreeRoadmap(tree)) return tree;
    let changed = false;
    const nodes = (tree.nodes || []).map(function (n) {
      if (nodeConfidence(n) <= 1) return n;
      if (n.steps && n.steps.length && n.whyItMatters) return n;
      changed = true;
      const backfill = backfillWaypointStepsClient(n, tree.fitContext);
      return Object.assign({}, n, {
        whyItMatters: n.whyItMatters || backfill.whyItMatters,
        addressedGaps: (n.addressedGaps && n.addressedGaps.length) ? n.addressedGaps : backfill.addressedGaps,
        careerValue: n.careerValue || backfill.careerValue,
        steps: (n.steps && n.steps.length) ? n.steps : backfill.steps,
      });
    });
    if (!changed) return tree;
    return Object.assign({}, tree, { nodes: nodes, updatedAt: new Date().toISOString() });
  }

  function migrateV1ToV2(v1) {
    if (!v1 || v1.version !== 1 || !Array.isArray(v1.phases)) return null;
    const nodes = [];
    let prevParent = 'trunk';
    let depth = 1;
    const horizonMap = { this_month: 'next_month', next_semester: 'next_semester', longer_term: 'longer_term' };
    v1.phases.forEach(function (phase) {
      (phase.actions || []).forEach(function (action) {
        if (nodes.length >= MAX_NODES) return;
        const id = action.id || ('n' + nodes.length);
        nodes.push({
          id: id,
          parentId: prevParent,
          depth: depth,
          type: 'waypoint',
          title: action.text,
          detail: '',
          actionType: action.type || 'other',
          status: action.done ? 'completed' : 'active',
          done: !!action.done,
          confidence: Math.max(4, 6 - depth),
          horizon: horizonMap[phase.key] || 'longer_term',
        });
        prevParent = id;
        depth = Math.min(5, depth + 1);
      });
    });
    const activePath = ['trunk'];
    nodes.forEach(function (n) { activePath.push(n.id); });
    return {
      version: TREE_VERSION,
      targetCareerSlug: v1.targetCareerSlug,
      targetCareerName: v1.targetCareerName,
      generatedAt: v1.generatedAt,
      summary: v1.summary,
      fitContext: v1.fitContext,
      trunk: { id: 'trunk', title: 'Path to ' + v1.targetCareerName, subtitle: 'Where you are now', confidence: 5 },
      nodes: nodes,
      decisions: [],
      activePath: activePath,
      roadmapMeta: v1.roadmapMeta,
      updatedAt: v1.updatedAt || new Date().toISOString(),
    };
  }

  function buildRenderContext(tree) {
    const activePathSet = new Set(tree.activePath || ['trunk']);
    const chosenChildIds = new Set();
    const unchosenChildIds = new Set();
    (tree.decisions || []).forEach(function (d) {
      if (!d.chosenOptionId) return;
      (d.options || []).forEach(function (opt) {
        if (opt.childNodeId) {
          if (opt.id === d.chosenOptionId) chosenChildIds.add(opt.childNodeId);
          else unchosenChildIds.add(opt.childNodeId);
        }
      });
    });

    function collectBranch(rootId, acc) {
      if (!rootId || acc.has(rootId)) return;
      acc.add(rootId);
      (tree.nodes || []).forEach(function (n) {
        if (n.parentId === rootId) collectBranch(n.id, acc);
      });
    }

    const chosenBranchIds = new Set();
    const unchosenBranchIds = new Set();
    chosenChildIds.forEach(function (id) { collectBranch(id, chosenBranchIds); });
    unchosenChildIds.forEach(function (id) { collectBranch(id, unchosenBranchIds); });

    const previewSet = previewPathIds && previewPathIds.length ? new Set(previewPathIds) : null;

    return {
      activePathSet: activePathSet,
      chosenBranchIds: chosenBranchIds,
      unchosenBranchIds: unchosenBranchIds,
      previewSet: previewSet,
    };
  }

  // Does the node (or an ancestor) sit under a decision option's childNodeId that
  // has NOT been chosen? Such a node is on an uncommitted/unchosen branch and gets
  // Preview/Commit affordances.
  function findDecisionForNode(tree, nodeId) {
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    const optionRoots = [];
    (tree.decisions || []).forEach(function (d) {
      (d.options || []).forEach(function (opt) {
        if (opt.childNodeId) optionRoots.push({ decision: d, option: opt });
      });
    });
    // Walk ancestor chain; the first option-root we hit identifies the branch.
    let cur = nodeId;
    let guard = 0;
    while (cur && cur !== 'trunk' && guard < MAX_NODES) {
      guard += 1;
      const hit = optionRoots.find(function (r) { return r.option.childNodeId === cur; });
      if (hit) return hit;
      const n = byId[cur];
      if (!n) break;
      cur = n.parentId;
    }
    return null;
  }

  // Branch-state flags for a node, used by the drawer to decide which branch
  // buttons to show. previewing = this node's path is the live client preview.
  function branchDrawerState(tree, nodeId) {
    const ctx = buildRenderContext(tree);
    const onActive = ctx.activePathSet.has(nodeId) || nodeId === 'trunk';
    const raw = (tree.nodes || []).find(function (n) { return n.id === nodeId; }) || {};
    const isBranch = (raw.pathRole === 'branch');
    const onChosenBranch = ctx.chosenBranchIds.has(nodeId);
    const onUnchosenBranch = ctx.unchosenBranchIds.has(nodeId)
      || (isBranch && !onActive && !onChosenBranch);
    const previewing = !!(previewPathIds && previewPathIds.indexOf(nodeId) >= 0);
    // Committed branch node = a branch-role node that is on the active path or
    // resolved as a chosen branch. Its deepest such node is the tip.
    const committedBranch = isBranch && (onActive || onChosenBranch);
    // Tip = a branch node with no branch child. Computed for ANY branch so the
    // Extend affordance works on tracked (not only structurally committed) tips.
    let isTip = false;
    if (isBranch) {
      const hasBranchChild = (tree.nodes || []).some(function (n) {
        return n.parentId === nodeId && n.pathRole === 'branch';
      });
      isTip = !hasBranchChild;
    }
    // WS-C2: reverse-a-commitment affordances. Available only on a committed
    // branch whose fork is still the user's current position (latest-completed
    // waypoint) — same guard the server enforces, so no wasted 409 round-trips.
    let canUncommit = false;
    let switchTarget = null;
    let decisionId = null;
    if (isBranch) {
      const hit = findDecisionForNode(tree, nodeId);
      if (hit) {
        decisionId = hit.decision.id;
        if (committedBranch) {
          canUncommit = latestCompletedWaypointId(tree) === hit.decision.nodeId;
          const chosen = hit.decision.chosenOptionId;
          const alt = (hit.decision.options || []).find(function (o) {
            return o.id !== chosen && o.childNodeId;
          });
          if (alt) {
            const altRoot = (tree.nodes || []).find(function (n) { return n.id === alt.childNodeId; });
            switchTarget = {
              optionId: alt.id,
              label: (altRoot && (altRoot.shortTitle || altRoot.title)) || alt.label || 'the other path',
            };
          }
        }
      }
    }
    return {
      onActive: onActive,
      onUnchosenBranch: onUnchosenBranch,
      committedBranch: committedBranch,
      isTip: isTip,
      previewing: previewing,
      canUncommit: canUncommit,
      switchTarget: switchTarget,
      decisionId: decisionId,
    };
  }

  function progressTree(tree) {
    if (!isTreeRoadmap(tree)) return { done: 0, total: 0, pct: 0 };
    const interactive = (tree.nodes || []).filter(function (n) { return nodeConfidence(n) > 1; });
    let done = 0;
    let total = 0;
    interactive.forEach(function (n) {
      const prog = nodeStepProgress(n);
      if (prog.total > 0) {
        done += prog.done;
        total += prog.total;
      } else {
        total += 1;
        if (n.done) done += 1;
      }
    });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function nextWaypoint(tree) {
    if (!isTreeRoadmap(tree)) return null;
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    for (let i = 0; i < (tree.activePath || []).length; i++) {
      const id = tree.activePath[i];
      if (id === 'trunk') continue;
      const n = byId[id];
      if (n && !n.done) return n;
    }
    return null;
  }

  function immediateWaypoint(tree) {
    return nextWaypoint(tree);
  }

  function canEditWaypoint(tree, nodeId) {
    const imm = immediateWaypoint(tree);
    if (imm && imm.id === nodeId) return true;
    if (canMarkWaypointUndone(tree, nodeId)) return true;
    if (tree && tree.focusTracker && tree.focusTracker.waypointId === nodeId) return true;
    // Branch frontier (WS-multi): a branch's next-undone waypoint is the user's live
    // frontier on that path and is editable, even though it is not on the spine
    // activePath. Tracking in the Flight Plan replaced the old structural branch
    // "commit", so a branch waypoint no longer needs a commit to be worked on. The
    // first-undone guard still prevents skipping ahead within the branch.
    const SGT = global.FWSkillGapTracker;
    if (SGT && typeof SGT.branchKeyForNode === 'function'
      && typeof SGT.immediateWaypointForBranch === 'function') {
      const key = SGT.branchKeyForNode(tree, nodeId);
      if (key && key !== 'spine') {
        const bimm = SGT.immediateWaypointForBranch(tree, key);
        if (bimm && bimm.id === nodeId) return true;
      }
    }
    return false;
  }

  function latestCompletedWaypointId(tree) {
    if (!tree) return null;
    const path = tree.activePath || [];
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const n = byId[path[i]];
      if (n && n.done) return n.id;
    }
    return null;
  }

  // A waypoint can be marked undone only when nothing built AFTER it is still done:
  // it is done, and no descendant waypoint is done — a descendant being either a
  // later spine waypoint (spine nodes chain by parentId from the trunk) or any branch
  // waypoint forked off it or off a later waypoint. This lets any completed leaf be
  // reverted — spine tip OR branch tip — while blocking revert of a waypoint whose
  // later waypoints are still complete (e.g. a spine waypoint with a completed branch
  // hanging off it). It replaces the old activePath-tip-only rule, which ignored
  // branches: it couldn't undo branch tips, yet wrongly let an earlier spine waypoint
  // be undone while its branches stayed done. "Nothing done after it" already enforces
  // spine order (a later spine waypoint is a descendant), so no separate ancestor
  // check is needed — and adding one would wrongly block undoing a branch waypoint
  // completed before its spine fork, which the editor explicitly allows.
  function canMarkWaypointUndone(tree, nodeId) {
    if (!tree || !nodeId) return false;
    const nodes = tree.nodes || [];
    const byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    const node = byId[nodeId];
    if (!node || !node.done) return false;
    const childrenByParent = {};
    nodes.forEach(function (n) {
      const p = n.parentId;
      if (p == null) return;
      (childrenByParent[p] || (childrenByParent[p] = [])).push(n);
    });
    const stack = (childrenByParent[nodeId] || []).slice();
    const seen = {};
    let guard = 0;
    while (stack.length && guard < MAX_NODES * 4) {
      guard += 1;
      const d = stack.pop();
      if (!d || seen[d.id]) continue;
      seen[d.id] = true;
      if (d.done) return false;
      const kids = childrenByParent[d.id];
      if (kids) for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
    }
    return true;
  }

  function drawerOptsForNode(tree, nodeId) {
    const opts = {};
    const imm = immediateWaypoint(tree);
    if (!imm) {
      if (!canMarkWaypointUndone(tree, nodeId)) opts.readOnly = true;
      return opts;
    }
    if (isFutureWaypoint(tree, nodeId)) opts.locked = true;
    else if (isPastWaypoint(tree, nodeId) && !canMarkWaypointUndone(tree, nodeId)) opts.readOnly = true;
    return opts;
  }

  function isFutureWaypoint(tree, nodeId) {
    if (!tree || !nodeId) return false;
    const path = tree.activePath || [];
    const imm = immediateWaypoint(tree);
    if (!imm) return false;
    const immIdx = path.indexOf(imm.id);
    const nodeIdx = path.indexOf(nodeId);
    return nodeIdx > immIdx && immIdx >= 0;
  }

  function isPastWaypoint(tree, nodeId) {
    if (!tree || !nodeId) return false;
    const path = tree.activePath || [];
    const imm = immediateWaypoint(tree);
    if (!imm) return false;
    const immIdx = path.indexOf(imm.id);
    const nodeIdx = path.indexOf(nodeId);
    return nodeIdx >= 0 && nodeIdx < immIdx;
  }

  function getSpineChain(tree) {
    const chain = [];
    let parentId = 'trunk';
    for (let i = 0; i < 6; i += 1) {
      const kids = (tree.nodes || []).filter(function (n) { return n.parentId === parentId; });
      if (!kids.length) break;
      let next = kids.find(function (k) { return k.pathRole === 'spine'; });
      if (!next) next = kids.find(function (k) { return (tree.activePath || []).indexOf(k.id) >= 0; });
      if (!next && kids.length === 1) next = kids[0];
      if (!next) {
        next = kids.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })[0];
      }
      if (!next) break;
      chain.push(next);
      parentId = next.id;
    }
    return chain;
  }

  function majorsFromSpine(spineChain) {
    const explicit = spineChain.filter(function (n) { return n.isMajor; });
    if (explicit.length === 2) return explicit;
    if (spineChain.length >= 4) {
      return [spineChain[1], spineChain[3]].filter(Boolean);
    }
    return explicit;
  }

  // Branch roots forked off any node via decisions[] (a spine major OR, for
  // deeper forks, a branch node). Excludes spine nodes and low-confidence nodes.
  function branchRootsForNode(tree, node, spineIds) {
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    const roots = [];
    const seen = {};
    (tree.decisions || []).forEach(function (d) {
      if (d.nodeId !== node.id) return;
      (d.options || []).forEach(function (opt) {
        if (!opt.childNodeId || seen[opt.childNodeId]) return;
        const kid = byId[opt.childNodeId];
        if (kid && !spineIds[kid.id] && nodeConfidence(kid) > 1) {
          seen[opt.childNodeId] = true;
          roots.push(kid);
        }
      });
    });
    return roots.slice(0, 2);
  }

  function branchRootsForMajor(tree, major, spineIds) {
    return branchRootsForNode(tree, major, spineIds);
  }

  function buildLayout(tree) {
    const spineChain = getSpineChain(tree);
    const spineIds = {};
    spineChain.forEach(function (n) { spineIds[n.id] = true; });

    const levelGap = 110;
    const branchGap = 72;
    const siblingGap = 130;
    const placedIds = { trunk: true };

    const nodes = [{
      id: 'trunk',
      title: (tree.trunk && tree.trunk.title) || 'Your starting point',
      depth: 0,
      confidence: 5,
      parentId: null,
      x: 0,
      y: 0,
      pathRole: 'spine',
      raw: tree.trunk || null,
      stepPct: 0,
    }];
    const posById = { trunk: { x: 0, y: 0 } };

    spineChain.forEach(function (kid, i) {
      if (nodeConfidence(kid) <= 1) return;
      const y = -(i + 1) * levelGap;
      nodes.push({
        id: kid.id,
        title: kid.title,
        depth: kid.depth || (i + 1),
        confidence: nodeConfidence(kid),
        parentId: i === 0 ? 'trunk' : spineChain[i - 1].id,
        done: !!kid.done,
        phaseColor: kid.phaseColor,
        pathRole: 'spine',
        x: 0,
        y: y,
        raw: kid,
        stepPct: nodeStepProgress(kid).pct,
      });
      placedIds[kid.id] = true;
      posById[kid.id] = { x: 0, y: y };
    });

    const spineTipY = spineChain.length ? -(spineChain.length) * levelGap : 0;
    const majorNodes = majorsFromSpine(spineChain);

    function addLayoutNode(entry) {
      if (placedIds[entry.id]) return false;
      placedIds[entry.id] = true;
      nodes.push(entry);
      posById[entry.id] = { x: entry.x, y: entry.y };
      return true;
    }

    // Collision-aware branch layout (WS-A1). Branches never overlap the spine,
    // each other, or their own nodes because each branch subtree owns a disjoint
    // band of vertical lanes: the spine holds lane 0 (x=0), left branches take
    // x<0, right branches x>0, and lanes are packed strictly outward so two
    // distinct branches can never share an x. A branch's linear continuation
    // runs straight up its inner lane (each hop -branchGap in y, so same-lane
    // nodes never share a y either); sub-forks claim additional outward lanes.
    // There is NO depth cap — a committed branch may run well past the spine tip,
    // which is the whole point of "model where they could get to".
    const nodeById = {};
    (tree.nodes || []).forEach(function (n) { nodeById[n.id] = n; });

    // The linear (straight-up) continuation of a node plus the sub-fork roots
    // that split off it. forkDepth mirrors the old placeBranch gate so the set
    // of nodes treated as forks is unchanged.
    function linearAndForks(node, forkDepth) {
      const forkRootIds = {};
      if (node && forkDepth < 2) {
        branchRootsForNode(tree, node, spineIds).forEach(function (r) { forkRootIds[r.id] = true; });
      }
      const kids = (tree.nodes || []).filter(function (n) {
        return n.parentId === node.id && !spineIds[n.id] && nodeConfidence(n) > 1;
      });
      return {
        linear: kids.find(function (k) { return !forkRootIds[k.id]; }) || null,
        forks: Object.keys(forkRootIds).map(function (id) { return nodeById[id]; }).filter(Boolean),
      };
    }

    // Branches grow SIDEWAYS as they climb (WS-multi): each hop drifts this many
    // lanes further from the spine, so a branch fans out at an angle instead of
    // stacking in a straight vertical column that the connectors then cross. The
    // drift stays inside the branch's reserved lane band (see leanLanes), so the
    // collision-free guarantee (disjoint x-bands, ≥1 lane = 130 world units apart)
    // is preserved — outward drift only ever increases |x|, never toward x=0.
    const BRANCH_LEAN = 0.34;

    function chainLength(rootId, forkDepth) {
      let cur = nodeById[rootId];
      let len = 0;
      let g = 0;
      while (cur && g < MAX_NODES) {
        g += 1; len += 1;
        cur = linearAndForks(cur, forkDepth).linear;
      }
      return len;
    }

    // Extra lanes a chain's outward lean sweeps across (hop 0 = 0 drift), rounded
    // up so the reserved band always fully contains the leaning chain.
    function leanLanes(rootId, forkDepth) {
      return Math.ceil(Math.max(0, chainLength(rootId, forkDepth) - 1) * BRANCH_LEAN);
    }

    // Lanes the subtree rooted at rootId needs to draw without internal overlap:
    // its own linear column (1) + the lean span that column sweeps + the width of
    // every sub-fork it spawns. Must stay in lockstep with placeBranchSubtree.
    function subtreeWidth(rootId, forkDepth) {
      let cur = nodeById[rootId];
      let width = 1 + leanLanes(rootId, forkDepth);
      let g = 0;
      while (cur && g < MAX_NODES) {
        g += 1;
        const lf = linearAndForks(cur, forkDepth);
        lf.forks.forEach(function (f) { width += subtreeWidth(f.id, forkDepth + 1); });
        cur = lf.linear;
      }
      return width;
    }

    // Place a branch subtree: its linear chain climbs at an outward angle from
    // `baseLane` (hop h sits at lane baseLane + h*BRANCH_LEAN); its sub-forks take
    // lanes strictly OUTSIDE that leaning chain's band. Returns lanes consumed.
    function placeBranchSubtree(rootId, parentLayoutId, side, baseLane, startY, forkDepth, depth) {
      let cur = nodeById[rootId];
      let parent = parentLayoutId;
      let y = startY;
      let d = depth;
      let h = 0; // hop index along this linear chain, drives the outward lean
      const chainLean = leanLanes(rootId, forkDepth);
      let width = 1 + chainLean;             // linear column + its lean span
      let forkLaneCursor = baseLane + width; // sub-forks start beyond the lean band
      let g = 0;
      while (cur && g < MAX_NODES) {
        g += 1;
        const added = addLayoutNode({
          id: cur.id,
          title: cur.title,
          depth: d,
          confidence: nodeConfidence(cur),
          parentId: parent,
          done: !!cur.done,
          phaseColor: cur.phaseColor,
          pathRole: cur.pathRole || 'branch',
          x: side * (baseLane + h * BRANCH_LEAN) * siblingGap,
          y: y,
          raw: cur,
          stepPct: nodeStepProgress(cur).pct,
        });
        if (!added) break;
        const lf = linearAndForks(cur, forkDepth);
        lf.forks.forEach(function (fork) {
          const used = placeBranchSubtree(fork.id, cur.id, side, forkLaneCursor, y - branchGap, forkDepth + 1, d + 1);
          forkLaneCursor += used;
          width += used;
        });
        parent = cur.id;
        cur = lf.linear;
        y -= branchGap;
        d += 1;
        h += 1;
      }
      return width;
    }

    // Top-level branches in deterministic (major, option) order. Each is packed
    // onto an alternating side, outward from the spine, so lane-bands never
    // collide — with the spine or with one another.
    let leftLane = 1;
    let rightLane = 1;
    let branchOrdinal = 0;
    majorNodes.forEach(function (major) {
      const majorPos = posById[major.id];
      if (!majorPos) return;
      branchRootsForMajor(tree, major, spineIds).forEach(function (root) {
        const side = branchOrdinal % 2 === 0 ? -1 : 1;
        branchOrdinal += 1;
        const baseLane = side < 0 ? leftLane : rightLane;
        const startY = majorPos.y - branchGap;
        const startDepth = (major.depth || 1) + 1;
        const used = placeBranchSubtree(root.id, major.id, side, baseLane, startY, 1, startDepth);
        if (side < 0) leftLane += used; else rightLane += used;
      });
    });

    const edges = [];
    nodes.forEach(function (n) {
      if (!n.parentId) return;
      const parent = nodes.find(function (p) { return p.id === n.parentId; });
      if (parent) edges.push({ from: parent, to: n });
    });

    return { nodes: nodes, edges: edges, spineTipY: spineTipY };
  }

  function worldToScreen(x, y) {
    const cx = viewW / 2 + viewState.panX;
    const cy = viewH * TRUNK_SCREEN_Y + viewState.panY;
    return {
      x: cx + x * viewState.zoom,
      y: cy + y * viewState.zoom,
    };
  }

  function nodeAlpha(n, ctx) {
    const c = nodeConfidence(n);
    const role = (n.raw && n.raw.pathRole) || n.pathRole;
    const onActive = ctx.activePathSet.has(n.id) || n.id === 'trunk';
    if (ctx.previewSet) {
      if (ctx.previewSet.has(n.id)) return 1;
      if (onActive) return 0.5;
    }
    if (ctx.unchosenBranchIds.has(n.id)) return 0.35;
    if (role === 'branch' && !onActive && !ctx.chosenBranchIds.has(n.id)) {
      const hoverBoost = n.id === hoveredId ? 0.15 : 0;
      return Math.min(0.7, 0.38 + 0.08 * c + hoverBoost);
    }
    if (onActive && n.depth <= 6) return Math.max(0.85, 0.4 + 0.11 * c);
    if (ctx.chosenBranchIds.has(n.id)) return Math.max(0.75, 0.35 + 0.12 * c);
    let a = 0.35 + 0.13 * c;
    if (n.depth >= 3) a *= 0.88;
    return Math.min(1, a);
  }

  function wrapLabel(text, maxLen, maxLines) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const next = line ? line + ' ' + word : word;
      if (next.length > maxLen && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    const cap = maxLines != null ? maxLines : 2;
    return lines.slice(0, cap);
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawNodeLabel(ctx, text, x, y, r, emphasized) {
    const colors = treeColors();
    const labelText = String(text || '');
    const maxLines = labelText.length <= 55 ? 3 : 2;
    const lines = wrapLabel(labelText, 28, maxLines);
    // §3C.6: an empty/whitespace title yields no lines; Math.max.apply(null, [])
    // is -Infinity → NaN coords → a bare circle. Skip the pill instead.
    if (!lines.length) return;
    const fontSize = emphasized ? 11 : 10;
    const lineH = fontSize + 3;
    const padX = 8;
    const padY = 5;
    const maxW = Math.min(160, viewW * 0.22);
    ctx.font = '600 ' + fontSize + 'px Inter, system-ui, sans-serif';
    const tw = Math.min(maxW, Math.max.apply(null, lines.map(function (ln) { return ctx.measureText(ln).width; })));
    const w = tw + padX * 2;
    const h = lines.length * lineH + padY * 2 - 3;
    const lx = x - w / 2;
    const ly = y - r - h - 8;
    roundRectPath(ctx, lx, ly, w, h, 6);
    ctx.fillStyle = emphasized ? colors.labelBg : colors.labelBgMuted;
    ctx.fill();
    ctx.strokeStyle = emphasized ? colors.labelBorder : colors.labelBorderMuted;
    ctx.lineWidth = 1;
    roundRectPath(ctx, lx, ly, w, h, 6);
    ctx.stroke();
    ctx.fillStyle = emphasized ? colors.labelText : colors.labelTextMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach(function (ln, i) {
      ctx.fillText(ln, x, ly + padY + lineH * i + fontSize / 2);
    });
  }

  function fitViewToLayout(layout) {
    if (!layout || !layout.nodes.length || !viewW || !viewH) return;
    const pad = 48;
    const labelPad = 80;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = labelPad;
    layout.nodes.forEach(function (n) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });
    const worldW = Math.max(120, maxX - minX + 120);
    const vertRoom = viewH * TRUNK_SCREEN_Y - pad;
    const zoomFromHeight = minY < 0 ? vertRoom / Math.abs(minY) : 1.2;
    const zoomFromWidth = worldW > 0 ? (viewW - pad * 2) / worldW : 1.2;
    viewState.zoom = Math.max(0.35, Math.min(1.2, Math.min(zoomFromHeight, zoomFromWidth)));
    const centerX = (minX + maxX) / 2;
    viewState.panX = -centerX * viewState.zoom;
    viewState.panY = 0;
  }

  function drawLiquidNode(ctx, x, y, r, pct, opts) {
    const colors = treeColors();
    const a = opts.alpha != null ? opts.alpha : 1;
    const hovered = !!opts.hovered;
    const phaseColor = opts.phaseColor;
    const done = pct >= 100;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors.nodeShell;
    ctx.fill();
    ctx.strokeStyle = hovered ? colors.nodeStrokeHover : colors.nodeStroke;
    ctx.lineWidth = hovered ? 2.5 : 1.5;
    ctx.stroke();

    if (done) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r - 1.5), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74, 222, 128, 0.92)';
      ctx.fill();
    } else if (pct > 0) {
      const fillH = (pct / 100) * (r * 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r - 1.5), 0, Math.PI * 2);
      ctx.clip();
      const base = phaseColor || 'rgba(196, 149, 106, 0.95)';
      const grad = ctx.createLinearGradient(x, y + r, x, y - r);
      grad.addColorStop(0, base);
      grad.addColorStop(1, 'rgba(130, 185, 225, 0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y + r - fillH, r * 2, fillH + 1);
      ctx.restore();
    }

    ctx.restore();

    if (opts.showLabel && pct > 0 && pct < 100) {
      ctx.save();
      ctx.fillStyle = colors.pctText;
      ctx.font = '600 ' + Math.max(8, Math.round(9 * viewState.zoom)) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(pct) + '%', x, y);
      ctx.restore();
    }
  }

  function drawTree(ctx, canvas, tree) {
    const renderCtx = buildRenderContext(tree);
    const colors = treeColors();
    layoutCache = buildLayout(tree);
    ctx.clearRect(0, 0, viewW, viewH);
    if (global.FWHubCanvasBg && FWHubCanvasBg.paintHubCanvasBackground) {
      FWHubCanvasBg.paintHubCanvasBackground(ctx, viewW, viewH, viewState.panX, viewState.panY);
    } else {
      ctx.fillStyle = '#080706';
      ctx.fillRect(0, 0, viewW, viewH);
    }

    if (!viewFitted) {
      fitViewToLayout(layoutCache);
      viewFitted = true;
    }

    const PREVIEW_ACCENT = 'rgba(130, 185, 225, 1)';
    layoutCache.edges.forEach(function (edge) {
      const a = nodeAlpha(edge.to, renderCtx);
      const role = (edge.to.raw && edge.to.raw.pathRole) || edge.to.pathRole;
      const onPreview = !!(renderCtx.previewSet && renderCtx.previewSet.has(edge.to.id)
        && renderCtx.previewSet.has(edge.from.id));
      const from = worldToScreen(edge.from.x, edge.from.y);
      const to = worldToScreen(edge.to.x, edge.to.y);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = onPreview ? PREVIEW_ACCENT : (edge.to.phaseColor || 'rgba(196, 149, 106, ' + a + ')');
      ctx.lineWidth = (onPreview ? Math.max(3, 5 - edge.to.depth * 0.4) : Math.max(2, 4 - edge.to.depth * 0.4)) * viewState.zoom;
      ctx.globalAlpha = onPreview ? 1 : a;
      const offPath = renderCtx.unchosenBranchIds.has(edge.to.id);
      if (onPreview) {
        ctx.setLineDash([]);
      } else if (offPath || role === 'branch' || nodeConfidence(edge.to) <= 2) {
        ctx.setLineDash([6, 6]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    layoutCache.nodes.forEach(function (n) {
      const pos = worldToScreen(n.x, n.y);
      const r = (n.id === 'trunk' ? 22 : 14) * viewState.zoom;
      const a = nodeAlpha(n, renderCtx);
      if (nodeConfidence(n) <= 1) return;

      if (n.id === 'trunk') {
        drawLiquidNode(ctx, pos.x, pos.y, r, 100, {
          alpha: a,
          hovered: n.id === hoveredId,
          phaseColor: 'rgba(196, 149, 106, 0.95)',
          showLabel: false,
        });
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = n.id === hoveredId ? colors.nodeStrokeHover : colors.nodeStroke;
        ctx.lineWidth = n.id === hoveredId ? 2.5 : 1.5;
        ctx.stroke();
      } else {
        const targetPct = n.stepPct != null ? n.stepPct : (n.done ? 100 : 0);
        const displayPct = lerpDisplayPct(n.id, targetPct);
        drawLiquidNode(ctx, pos.x, pos.y, r, displayPct, {
          alpha: a,
          hovered: n.id === hoveredId,
          phaseColor: n.phaseColor,
          showLabel: viewState.zoom >= 0.45,
        });
        if (renderCtx.previewSet && renderCtx.previewSet.has(n.id)) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r + 3.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(130, 185, 225, 0.95)';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      if (n.id !== 'trunk' && viewState.zoom >= 0.45) {
        const labelText = canvasLabel(n.raw) || n.title;
        drawNodeLabel(ctx, labelText, pos.x, pos.y, r, n.id === hoveredId);
      }
    });

    const trunkPos = worldToScreen(0, 0);
    const trunkData = tree.trunk || {};
    const trunkTitle = trunkData.title || tree.targetCareerName || 'Your starting point';
    const trunkSub = trunkData.subtitle || 'Where you are now';
    if (viewState.zoom >= 0.4) {
      drawNodeLabel(ctx, trunkTitle, trunkPos.x, trunkPos.y, 22 * viewState.zoom, hoveredId === 'trunk');
      ctx.fillStyle = colors.trunkSubtext;
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(trunkSub, trunkPos.x, trunkPos.y + 42 * viewState.zoom);
    }

    if (displayPctAnimating(tree)) {
      requestAnimationFrame(function () {
        const c = canvas.getContext('2d');
        drawTree(c, canvas, tree);
      });
    }
  }

  function hitTest(canvas, clientX, clientY) {
    if (!layoutCache) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best = null;
    let bestD = Infinity;
    layoutCache.nodes.forEach(function (n) {
      if (nodeConfidence(n) <= 1) return;
      const pos = worldToScreen(n.x, n.y);
      const r = (n.id === 'trunk' ? 22 : 14) * viewState.zoom;
      const d = Math.hypot(sx - pos.x, sy - pos.y);
      if (d <= r + 8 && d < bestD) {
        bestD = d;
        best = n;
      }
    });
    return best;
  }

  function displayPctAnimating(tree) {
    if (!layoutCache) return false;
    let animating = false;
    layoutCache.nodes.forEach(function (n) {
      if (n.id === 'trunk') return;
      const target = n.stepPct != null ? n.stepPct : (n.done ? 100 : 0);
      const cur = displayPctByNode[n.id] != null ? displayPctByNode[n.id] : target;
      if (Math.abs(cur - target) > 0.5) animating = true;
    });
    return animating;
  }

  function closeDrawer() {
    const panel = document.getElementById('roadmap-tree-detail');
    if (panel) {
      panel.classList.remove('open');
      panel.hidden = true;
    }
    openDrawerNodeId = null;
    drawerError = '';
    setDrawerOpen(false);
  }

  function renderTrunkPanel(tree) {
    const panel = document.getElementById('roadmap-tree-detail');
    if (!panel) return;
    openDrawerNodeId = 'trunk';
    const trunk = tree.trunk || {};
    const head = '<div><p class="roadmap-detail-eyebrow">Starting point</p>'
      + '<h3 class="roadmap-detail-title">' + esc(trunk.title || tree.targetCareerName || 'Your path begins here') + '</h3></div>'
      + '<button type="button" class="roadmap-detail-close" id="roadmap-detail-close" aria-label="Close">' + lucide.svg('x') + '</button>';
    let body = '';
    if (trunk.subtitle) {
      body += '<p class="roadmap-detail-subheading">' + esc(trunk.subtitle) + '</p>';
    }
    if (tree.summary) {
      body += '<p class="roadmap-detail-body">' + esc(tree.summary) + '</p>';
    }
    body += '<p class="roadmap-detail-meta">Tap any waypoint on the tree to see checklist steps and branch paths.</p>';
    panel.innerHTML = wrapDrawerContent(head, body, '');
    setDrawerOpen(true);
    const closeBtn = document.getElementById('roadmap-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  }

  // Commitments (V2 §5 S10) — due date + effort per step, plus the AI
  // "break this down" affordance. FWCommitments is the client mirror of the
  // server rule (functions/_lib/commitments.js); guarded because the drawer
  // must still render if the shared script hasn't loaded for some reason.
  function commitmentPickerHtml(FWC, nid, sid, c, editable) {
    const qd = FWC.quickDates();
    const dis = editable ? '' : ' disabled';
    const curDate = (c && c.dueAt) || '';
    const curEffort = (c && c.effort) || '';
    let html = '<div class="roadmap-commit-picker" data-node-id="' + nid + '" data-step-id="' + sid + '" hidden>';
    html += '<div class="roadmap-commit-picker-quick">';
    html += '<button type="button" class="roadmap-commit-quick-btn" data-date="' + escAttr(qd.thisWeek) + '"' + dis + '>This week</button>';
    html += '<button type="button" class="roadmap-commit-quick-btn" data-date="' + escAttr(qd.nextWeek) + '"' + dis + '>Next week</button>';
    html += '</div>';
    html += '<input type="date" class="roadmap-commit-date-input" min="' + escAttr(qd.today) + '" value="' + escAttr(curDate) + '"' + dis + '>';
    html += '<div class="roadmap-commit-effort-chips">';
    FWC.EFFORTS.forEach(function (e) {
      html += '<button type="button" class="roadmap-commit-effort-chip' + (e === curEffort ? ' is-active' : '') + '" data-effort="' + escAttr(e) + '"' + dis + '>' + esc(FWC.EFFORT_LABELS[e]) + '</button>';
    });
    html += '</div>';
    html += '<button type="button" class="roadmap-commit-save-btn"' + dis + '>Save</button>';
    html += '</div>';
    return html;
  }

  function commitmentControlsHtml(tree, nodeId, step, editable) {
    const FWC = global.FWCommitments;
    if (!FWC) return '';
    const nid = escAttr(nodeId);
    const sid = escAttr(step.id);
    const dis = editable ? '' : ' disabled';
    const c = FWC.forStep(tree, nodeId, step.id);
    let html = '<div class="roadmap-commit-wrap">';
    if (c) {
      const tier = FWC.urgencyTier(c);
      html += '<div class="roadmap-commit-row">';
      html += '<span class="roadmap-commit-chip roadmap-commit-chip--' + esc(tier) + '">' + esc(FWC.dueLabel(c)) + '</span>';
      if (c.effort) {
        html += '<span class="roadmap-commit-effort">' + esc(FWC.EFFORT_LABELS[c.effort] || '') + '</span>';
      }
      if (c.dueMoves > 0) {
        html += '<span class="roadmap-commit-moved">moved ' + esc(String(c.dueMoves)) + 'x</span>';
      }
      html += '<button type="button" class="roadmap-commit-change-btn" data-node-id="' + nid + '" data-step-id="' + sid + '"' + dis + '>Change</button>';
      html += '<button type="button" class="roadmap-commit-clear-btn" data-node-id="' + nid + '" data-step-id="' + sid + '"' + dis + '>Clear</button>';
      html += '</div>';
    } else {
      html += '<div class="roadmap-commit-row roadmap-commit-row--empty">';
      html += '<button type="button" class="roadmap-commit-add-btn" data-node-id="' + nid + '" data-step-id="' + sid + '"' + dis + '>by when?</button>';
      html += '</div>';
    }
    // A micro-step generated by a prior breakdown does not get broken down
    // again — aiBuilt is the simplest correct signal for "already granular".
    if (!step.aiBuilt) {
      html += '<button type="button" class="roadmap-commit-breakdown-btn" data-node-id="' + nid + '" data-step-id="' + sid + '"' + dis + '>Break this down</button>';
    }
    html += commitmentPickerHtml(FWC, nid, sid, c, editable);
    html += '</div>';
    return html;
  }

  function renderDetailPanel(tree, nodeLayout, opts) {
    const panel = document.getElementById('roadmap-tree-detail');
    if (!panel) return;
    if (!nodeLayout) {
      closeDrawer();
      return;
    }
    if (nodeLayout.id === 'trunk') {
      renderTrunkPanel(tree);
      return;
    }
    openDrawerNodeId = nodeLayout.id;
    drawerError = (opts && opts.error) || '';
    const raw = nodeLayout.raw || {};
    const roleLabel = raw.isMajor ? 'Major waypoint'
      : raw.pathRole === 'branch' ? 'Branch waypoint'
      : raw.pathRole === 'spine' ? 'Spine waypoint' : 'Waypoint';
    const prog = nodeStepProgress(raw);
    const steps = raw.steps || [];
    const pending = opts && opts.pending;
    const locked = !!(opts && opts.locked);
    const readOnly = !!(opts && opts.readOnly);
    const editable = !locked && !readOnly && !pending;
    const nid = escAttr(nodeLayout.id);

    // Multi-track focus state — one source of truth (FWSkillGapTracker). Drives
    // the "open focus?" tab and the Track / Uncommit (Flight Plan) controls. A
    // path is the spine or a branch root; tracking never rewires the tree.
    const SGT = global.FWSkillGapTracker;
    const focusPathKey = (SGT && SGT.branchKeyForNode && raw.type !== 'decision')
      ? SGT.branchKeyForNode(tree, nodeLayout.id) : null;
    const pathTracked = !!(focusPathKey && SGT && SGT.isPathTracked && SGT.isPathTracked(tree, focusPathKey));
    const trackedBranches = (SGT && SGT.trackedBranchCount) ? SGT.trackedBranchCount(tree) : 0;
    const maxBranches = (SGT && SGT.maxTrackedBranches) || 4;
    const isTrackedFocusWp = !!(focusPathKey && SGT && SGT.trackedPaths
      && (SGT.trackedPaths(tree) || []).some(function (p) { return p.waypointId === nodeLayout.id; }));

    const head = '<div><p class="roadmap-detail-eyebrow">' + esc(roleLabel) + '</p>'
      + '<h3 class="roadmap-detail-title">' + esc(displayTitle(raw) || nodeLayout.title) + '</h3></div>'
      + '<button type="button" class="roadmap-detail-close" id="roadmap-detail-close" aria-label="Close">' + lucide.svg('x') + '</button>';

    let body = '';
    if (isTrackedFocusWp && !pending) {
      // Overhead Y/N tab (WS-multi): this node is the live focus waypoint of a
      // tracked path, so offer to open its focus without leaving the drawer.
      body += '<div class="roadmap-focus-tab" role="group" aria-label="Open this focus">'
        + '<span class="roadmap-focus-tab-q">Open the focus for this waypoint?</span>'
        + '<span class="roadmap-focus-tab-actions">'
        + '<button type="button" class="cta-btn roadmap-focus-tab-yes" data-node-id="' + nid + '">Yes</button>'
        + '<button type="button" class="cta-btn cta-btn-outline roadmap-focus-tab-no">No</button>'
        + '</span></div>';
    }
    if (drawerError) {
      body += '<p class="roadmap-detail-error">' + esc(drawerError) + '</p>';
    }
    if (locked) {
      body += '<p class="roadmap-detail-locked">Finish your current focus waypoint before working on this one.</p>';
    } else if (readOnly) {
      body += '<p class="roadmap-detail-locked">Completed waypoint — review only.</p>';
    }
    if (raw.whyItMatters) {
      body += '<p class="roadmap-detail-subheading">' + esc(raw.whyItMatters) + '</p>';
    } else if (raw.detail) {
      body += '<p class="roadmap-detail-body">' + esc(raw.detail) + '</p>';
    }
    body += '<div class="roadmap-detail-meta-stack">';
    body += '<span class="roadmap-detail-meta">Confidence: ' + nodeConfidence(raw) + '/5</span>';
    if (raw.careerValue) {
      body += '<span class="roadmap-value-pill">' + esc(careerValueLabel(raw.careerValue)) + '</span>';
    }
    body += '</div>';
    if (raw.addressedGaps && raw.addressedGaps.length) {
      body += '<div class="roadmap-gap-chips">';
      raw.addressedGaps.forEach(function (g) {
        body += '<span class="roadmap-gap-chip">Closes: ' + esc(titleCaseGap(g)) + '</span>';
      });
      body += '</div>';
    }
    if (raw.phaseLabel) {
      body += '<p class="roadmap-detail-phase" style="border-left-color:' + escAttr(raw.phaseColor || '#c4956a') + '">' + esc(raw.phaseLabel);
      if (raw.phaseEndsAt) body += ' · until ' + esc(raw.phaseEndsAt);
      body += '</p>';
    }
    if (steps.length) {
      body += '<div class="roadmap-step-progress-wrap">';
      body += '<div class="roadmap-step-progress-label">' + prog.done + '/' + prog.total + ' steps · ' + prog.pct + '%</div>';
      body += '<div class="coach-progress-bar"><div class="coach-progress-fill" style="width:' + prog.pct + '%"></div></div>';
      body += '<ul class="roadmap-step-list">';
      steps.forEach(function (step) {
        body += '<li class="roadmap-step-item">'
          + '<label class="roadmap-step-label">'
          + '<input type="checkbox" class="roadmap-step-check" data-node-id="' + escAttr(nodeLayout.id) + '" data-step-id="' + escAttr(step.id) + '"' + (step.done ? ' checked' : '') + (editable ? '' : ' disabled') + '>'
          + '<span>' + esc(step.text) + '</span></label>'
          + commitmentControlsHtml(tree, nodeLayout.id, step, editable)
          + '</li>';
      });
      body += '</ul></div>';
    }
    if (raw.outcomes) {
      if (raw.outcomes.roles && raw.outcomes.roles.length) {
        body += '<div class="roadmap-detail-outcomes"><strong>Possible roles</strong><ul>';
        raw.outcomes.roles.forEach(function (r) {
          body += '<li>' + esc(r.title) + (r.probability ? ' (' + esc(r.probability) + ')' : '') + '</li>';
        });
        body += '</ul></div>';
      }
      if (raw.outcomes.firmTiers && raw.outcomes.firmTiers.length) {
        body += '<div class="roadmap-detail-outcomes"><strong>Firm tiers</strong><ul>';
        raw.outcomes.firmTiers.forEach(function (f) {
          body += '<li>' + esc(f.tier) + (f.probability ? ' (' + esc(f.probability) + ')' : '') + '</li>';
        });
        body += '</ul></div>';
      }
    }

    const branchState = branchDrawerState(tree, nodeLayout.id);
    const pendingBranch = !!(opts && opts.branchPending);
    const pendingExtend = pendingBranch && opts && opts.branchAction === 'extend';
    let foot = '';
    const extendBtnHtml = '<button type="button" class="cta-btn cta-btn-outline roadmap-extend-branch-btn' + (pendingExtend ? ' is-busy' : '') + '" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>'
      + (pendingExtend ? '<span class="roadmap-btn-spinner" aria-hidden="true"></span>Extending…' : 'Extend this branch with AI') + '</button>';

    // Branch affordances — rendered above the step done/undone control. There is
    // no structural "Commit to this branch" anymore: committing a branch IS
    // "Track in Flight Plan" (below), which is non-exclusive and never prunes a
    // sibling. Any branch tip can still be grown with AI.
    if (branchState.onUnchosenBranch) {
      if (branchState.previewing) {
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-exit-preview-btn"' + (pendingBranch ? ' disabled' : '') + '>Exit preview</button>';
      } else {
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-preview-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Preview this path</button>';
        if (branchState.isTip) foot += extendBtnHtml;
      }
    } else if (branchState.committedBranch) {
      if (branchState.isTip) foot += extendBtnHtml;
      // WS-C2: change your mind while standing at the fork (legacy committed paths).
      if (branchState.canUncommit) {
        if (branchState.switchTarget) {
          foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-switch-branch-btn" data-node-id="' + nid + '" data-option-id="' + escAttr(branchState.switchTarget.optionId) + '"' + (pendingBranch ? ' disabled' : '') + '>Switch to ' + esc(branchState.switchTarget.label) + '</button>';
        }
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-uncommit-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Return to main path</button>';
      }
    }

    // Focus tracking — the user's "commit / uncommit". Independent of the
    // structural branch commit above: tracking a path adds its live waypoint to
    // the Flight Plan and lets its focus be opened; it never rewires the tree.
    // Offered on spine AND branch waypoints so any tracked path can be untracked.
    if (focusPathKey && !branchState.previewing) {
      if (pathTracked) {
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-untrack-focus-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Uncommit from Flight Plan</button>';
      } else {
        const atCap = focusPathKey !== 'spine' && trackedBranches >= maxBranches;
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-track-focus-btn" data-node-id="' + nid + '"' + ((pendingBranch || atCap) ? ' disabled' : '') + (atCap ? ' aria-disabled="true"' : '') + '>Track in Flight Plan</button>';
      }
      foot += '<p class="roadmap-focus-cap-hint">Tracking ' + trackedBranches + ' of ' + maxBranches + ' branches'
        + (focusPathKey !== 'spine' && trackedBranches >= maxBranches && !pathTracked ? ' — uncommit one to add this' : '')
        + '</p>';
    }

    if (raw.done) {
      foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-mark-undone-btn" data-node-id="' + nid + '"' + (editable ? '' : ' disabled') + '>Mark undone</button>';
    } else {
      foot += '<button type="button" class="cta-btn roadmap-mark-done-btn" data-node-id="' + nid + '"' + (editable ? '' : ' disabled') + '>Mark all steps done</button>';
    }

    panel.innerHTML = wrapDrawerContent(head, body, foot);
    setDrawerOpen(true);

    function closePanel() {
      closeDrawer();
    }

    const closeBtn = document.getElementById('roadmap-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    panel.querySelectorAll('.roadmap-step-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (callbacks.onToggleStep) {
          callbacks.onToggleStep(cb.getAttribute('data-node-id'), cb.getAttribute('data-step-id'));
        }
      });
    });
    // Commitments (V2 §5 S10). The picker's open/closed state is plain DOM
    // (a `hidden` toggle scoped to this step's own wrap) rather than module
    // state — a drawer re-render collapses it back closed, which is fine.
    panel.querySelectorAll('.roadmap-commit-add-btn, .roadmap-commit-change-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const wrap = btn.closest('.roadmap-commit-wrap');
        const picker = wrap && wrap.querySelector('.roadmap-commit-picker');
        if (picker) picker.hidden = !picker.hidden;
      });
    });
    panel.querySelectorAll('.roadmap-commit-quick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const picker = btn.closest('.roadmap-commit-picker');
        const input = picker && picker.querySelector('.roadmap-commit-date-input');
        if (input) input.value = btn.getAttribute('data-date');
      });
    });
    panel.querySelectorAll('.roadmap-commit-effort-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const picker = btn.closest('.roadmap-commit-picker');
        if (!picker) return;
        const wasActive = btn.classList.contains('is-active');
        picker.querySelectorAll('.roadmap-commit-effort-chip').forEach(function (b) { b.classList.remove('is-active'); });
        if (!wasActive) btn.classList.add('is-active'); // effort is optional — a second click clears it
      });
    });
    panel.querySelectorAll('.roadmap-commit-save-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const picker = btn.closest('.roadmap-commit-picker');
        if (!picker) return;
        const dateInput = picker.querySelector('.roadmap-commit-date-input');
        const dueAt = dateInput ? dateInput.value : '';
        if (!dueAt) return;
        const activeChip = picker.querySelector('.roadmap-commit-effort-chip.is-active');
        const effort = activeChip ? activeChip.getAttribute('data-effort') : null;
        if (callbacks.onSetCommitment) {
          callbacks.onSetCommitment(picker.getAttribute('data-node-id'), picker.getAttribute('data-step-id'), dueAt, effort);
        }
      });
    });
    panel.querySelectorAll('.roadmap-commit-clear-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (callbacks.onClearCommitment) {
          callbacks.onClearCommitment(btn.getAttribute('data-node-id'), btn.getAttribute('data-step-id'));
        }
      });
    });
    panel.querySelectorAll('.roadmap-commit-breakdown-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (callbacks.onBreakDownStep) {
          callbacks.onBreakDownStep(btn.getAttribute('data-node-id'), btn.getAttribute('data-step-id'));
        }
      });
    });
    panel.querySelectorAll('.roadmap-mark-done-btn, .roadmap-mark-undone-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (callbacks.onMarkDone) callbacks.onMarkDone(btn.getAttribute('data-node-id'));
      });
    });

    const previewBtn = panel.querySelector('.roadmap-preview-branch-btn');
    if (previewBtn) previewBtn.addEventListener('click', function () {
      // Preview is ephemeral and client-only (computePreviewPath) — the server
      // never sees it, so this is the only signal for the preview -> track step.
      try { if (global.FWEvents) FWEvents.log('tree_interact', { kind: 'branch_preview' }); } catch (_) {}
      if (callbacks.onPreviewPath) callbacks.onPreviewPath(previewBtn.getAttribute('data-node-id'));
    });
    const exitPreviewBtn = panel.querySelector('.roadmap-exit-preview-btn');
    if (exitPreviewBtn) exitPreviewBtn.addEventListener('click', function () {
      if (callbacks.onExitPreview) callbacks.onExitPreview();
    });
    const extendBtn = panel.querySelector('.roadmap-extend-branch-btn');
    if (extendBtn) extendBtn.addEventListener('click', function () {
      // Attempt half of the pair with roadmap_extend (success): the delta is the
      // metered cap/failure rate, which the cap card renders without logging.
      try { if (global.FWEvents) FWEvents.log('tree_interact', { kind: 'branch_extend' }); } catch (_) {}
      if (callbacks.onExtendBranch) callbacks.onExtendBranch(extendBtn.getAttribute('data-node-id'));
    });
    const trackFocusBtn = panel.querySelector('.roadmap-track-focus-btn');
    if (trackFocusBtn) trackFocusBtn.addEventListener('click', function () {
      if (trackFocusBtn.getAttribute('aria-disabled') === 'true') return;
      if (callbacks.onTrackBranch) callbacks.onTrackBranch(trackFocusBtn.getAttribute('data-node-id'));
    });
    const untrackFocusBtn = panel.querySelector('.roadmap-untrack-focus-btn');
    if (untrackFocusBtn) untrackFocusBtn.addEventListener('click', function () {
      if (callbacks.onUntrackFocus) callbacks.onUntrackFocus(untrackFocusBtn.getAttribute('data-node-id'));
    });
    // roadmap_committed is deliberately NOT logged here. This drawer button is
    // only ONE of the two ways to track — the preview rail's "Track in Flight
    // Plan" is the other, and it is the flow the product actually leads with.
    // Both land in roadmap.js trackBranchInFocus/untrackFocusForNode, which
    // also know whether the cap refused the change, so the event lives there
    // and counts persisted state instead of clicks.
    const focusYesBtn = panel.querySelector('.roadmap-focus-tab-yes');
    if (focusYesBtn) focusYesBtn.addEventListener('click', function () {
      if (callbacks.onOpenFocusForNode) callbacks.onOpenFocusForNode(focusYesBtn.getAttribute('data-node-id'));
    });
    const focusNoBtn = panel.querySelector('.roadmap-focus-tab-no');
    if (focusNoBtn) focusNoBtn.addEventListener('click', function () {
      const tab = panel.querySelector('.roadmap-focus-tab');
      if (tab) tab.remove();
    });
    const uncommitBtn = panel.querySelector('.roadmap-uncommit-branch-btn');
    if (uncommitBtn) uncommitBtn.addEventListener('click', function () {
      if (callbacks.onUncommitBranch) callbacks.onUncommitBranch(uncommitBtn.getAttribute('data-node-id'));
    });
    const switchBtn = panel.querySelector('.roadmap-switch-branch-btn');
    if (switchBtn) switchBtn.addEventListener('click', function () {
      if (callbacks.onSwitchBranch) {
        callbacks.onSwitchBranch(switchBtn.getAttribute('data-node-id'), switchBtn.getAttribute('data-option-id'));
      }
    });
  }

  // Pure client compute of the trunk->target chain via parentId (WS1). Does NOT
  // touch the server — preview is ephemeral. Returns ['trunk', ...ids].
  function computePreviewPath(tree, targetNodeId) {
    if (!tree || !targetNodeId) return [];
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    const chain = [];
    let cur = targetNodeId;
    let guard = 0;
    while (cur && cur !== 'trunk' && guard < MAX_NODES) {
      guard += 1;
      if (!byId[cur]) break;
      chain.unshift(cur);
      cur = byId[cur].parentId;
    }
    return ['trunk'].concat(chain);
  }

  function setPreviewPath(ids) {
    previewPathIds = ids && ids.length ? ids.slice() : null;
  }

  function clearPreviewPath() {
    previewPathIds = null;
  }

  function getPreviewPath() {
    return previewPathIds ? previewPathIds.slice() : null;
  }

  function followPathToNode(tree, targetNodeId) {
    if (!tree || !targetNodeId) return tree;
    const byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    const chain = [];
    let cur = targetNodeId;
    let guard = 0;
    while (cur && cur !== 'trunk' && guard < MAX_NODES) {
      guard += 1;
      if (!byId[cur]) break;
      chain.unshift(cur);
      cur = byId[cur].parentId;
    }
    return Object.assign({}, tree, {
      activePath: ['trunk'].concat(chain),
      updatedAt: new Date().toISOString(),
    });
  }

  function bindCanvas(canvas, tree, cbs) {
    callbacks = cbs || {};
    if (!canvas || !tree) return;

    function currentTree() {
      return (callbacks.getTree && callbacks.getTree()) || tree;
    }

    const key = treeKey(currentTree());
    if (boundTreeKey !== key) {
      boundTreeKey = key;
      viewFitted = false;
    }

    function redraw() {
      const ctx = canvas.getContext('2d');
      drawTree(ctx, canvas, currentTree());
    }

    function resize() {
      const wrap = canvas.parentElement;
      if (!wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      viewW = wrap.clientWidth;
      viewH = Math.max(280, wrap.clientHeight || 0);
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      canvas.style.width = viewW + 'px';
      canvas.style.height = viewH + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      const hit = hitTest(canvas, clientX, clientY);
      if (hit) {
        e.preventDefault();
        const treeNow = currentTree();
        // onNodeSelect returns true when it CONSUMED the click — that is the
        // preview-mode jump along the previewed branch, which moves the preview
        // cursor and opens no drawer. Same click, different intent, so it gets
        // its own kind rather than inflating node_open. Only reachable on a real
        // node hit; pan, zoom and hover never get here.
        const handled = !!(callbacks.onNodeSelect && callbacks.onNodeSelect(hit, treeNow) === true);
        try {
          if (global.FWEvents) {
            FWEvents.log('tree_interact', {
              kind: handled ? 'preview_jump' : 'node_open',
              role: hit.id === 'trunk' ? 'trunk' : ((hit.raw && hit.raw.pathRole) || 'spine'),
            });
          }
        } catch (_) {}
        if (handled) return;
        const drawerOpts = drawerOptsForNode(treeNow, hit.id);
        renderDetailPanel(treeNow, hit, drawerOpts);
        return;
      }
      dragState = { x: clientX, y: clientY, panX: viewState.panX, panY: viewState.panY };
      canvas.style.cursor = 'grabbing';
    }

    function onPointerMove(e) {
      const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      if (dragState) {
        viewState.panX = dragState.panX + (clientX - dragState.x);
        viewState.panY = dragState.panY + (clientY - dragState.y);
        redraw();
        return;
      }
      const hit = hitTest(canvas, clientX, clientY);
      hoveredId = hit ? hit.id : null;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      redraw();
    }

    function onPointerUp() {
      dragState = null;
      canvas.style.cursor = 'grab';
    }

    // §3C.4: pointer events already cover mouse + touch. Binding the legacy on*
    // mouse handlers alongside them made every mouse action fire BOTH the mouse
    // and pointer event, so each handler ran twice — double pan/redraw per tick,
    // double node-select. Pointer events only; pointerleave replaces onmouseleave.
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', function () { dragState = null; hoveredId = null; redraw(); });

    canvas.onwheel = function (e) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      viewState.zoom = Math.max(0.45, Math.min(1.8, viewState.zoom * factor));
      redraw();
    };

    resize();
    window.addEventListener('resize', resize);
    let vvTimer = null;
    function onVisualViewportResize() {
      if (vvTimer) clearTimeout(vvTimer);
      vvTimer = setTimeout(function () { resize(); }, 80);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onVisualViewportResize);
    }
    // A pure DPR change (OS display scaling, or a monitor with a different
    // scale factor) does not resize the layout viewport, so no resize event
    // fires and the tree keeps rendering into a stale backing store. The query
    // pins one exact ratio, so it re-arms after every change.
    (function watchDpr() {
      if (!window.matchMedia) return;
      const mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      const once = function () {
        mq.removeEventListener('change', once);
        resize();
        watchDpr();
      };
      mq.addEventListener('change', once);
    })();
    function onThemeChange() { redraw(); }
    window.addEventListener('flightway-theme-change', onThemeChange);
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(function () { resize(); });
      resizeObserver.observe(canvas.parentElement);
    }
    return {
      resize: resize,
      redraw: redraw,
      destroy: function () {
        window.removeEventListener('resize', resize);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', onVisualViewportResize);
        }
        window.removeEventListener('flightway-theme-change', onThemeChange);
        if (resizeObserver) resizeObserver.disconnect();
      },
      resetView: function () {
        viewState = { panX: 0, panY: 0, zoom: 1 };
        viewFitted = false;
        resize();
      },
    };
  }

  function ensureFocusTracker(tree, quizScores) {
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.ensureFocusTracker === 'function') {
      return FWSkillGapTracker.ensureFocusTracker(tree, quizScores);
    }
    return tree;
  }

  global.FWRoadmapTree = {
    TREE_VERSION: TREE_VERSION,
    isTreeRoadmap: isTreeRoadmap,
    migrateV1ToV2: migrateV1ToV2,
    progressTree: progressTree,
    nextWaypoint: nextWaypoint,
    immediateWaypoint: immediateWaypoint,
    canEditWaypoint: canEditWaypoint,
    canMarkWaypointUndone: canMarkWaypointUndone,
    drawerOptsForNode: drawerOptsForNode,
    isFutureWaypoint: isFutureWaypoint,
    isPastWaypoint: isPastWaypoint,
    ensureFocusTracker: ensureFocusTracker,
    followPathToNode: followPathToNode,
    ensureWaypointContent: ensureWaypointContent,
    nodeStepProgress: nodeStepProgress,
    syncNodeDoneFromSteps: syncNodeDoneFromSteps,
    refreshDrawerForNode: function (tree, nodeId, opts) {
      if (!nodeId || openDrawerNodeId !== nodeId) return;
      const layout = buildLayout(tree);
      const nodeLayout = layout.nodes.find(function (n) { return n.id === nodeId; });
      if (!nodeLayout) return;
      const drawerOpts = Object.assign({}, drawerOptsForNode(tree, nodeId), opts || {});
      renderDetailPanel(tree, nodeLayout, drawerOpts);
    },
    getOpenDrawerNodeId: function () { return openDrawerNodeId; },
    closeDrawer: closeDrawer,
    setDrawerOpen: setDrawerOpen,
    computePreviewPath: computePreviewPath,
    setPreviewPath: setPreviewPath,
    clearPreviewPath: clearPreviewPath,
    getPreviewPath: getPreviewPath,
    findDecisionForNode: findDecisionForNode,
    branchDrawerState: branchDrawerState,
    shortTitleFromTitle: shortTitleFromTitle,
    renderDetailPanel: renderDetailPanel,
    bindCanvas: bindCanvas,
    drawTree: drawTree,
    buildLayout: buildLayout,
    resetViewFitted: function () { viewFitted = false; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
