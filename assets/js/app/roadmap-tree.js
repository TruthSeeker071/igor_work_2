/**
 * Roadmap tree v2 — canvas renderer, layout, and client helpers.
 */
(function (global) {
  const TREE_VERSION = 2;
  const MAX_NODES = 24;
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
    let isTip = false;
    if (committedBranch) {
      const hasBranchChild = (tree.nodes || []).some(function (n) {
        return n.parentId === nodeId && n.pathRole === 'branch';
      });
      isTip = !hasBranchChild;
    }
    // Determine if the branch choice waypoint (major spine node) is completed
    // This is the major spine node that has the decision for this branch
    let branchChoiceCompleted = false;
    if (isBranch) {
      const hit = findDecisionForNode(tree, nodeId);
      if (hit) {
        const majorNode = (tree.nodes || []).find(function (n) { return n.id === hit.decision.nodeId; });
        if (majorNode) {
          branchChoiceCompleted = !!majorNode.done;
        }
      }
    }
    return {
      onActive: onActive,
      onUnchosenBranch: onUnchosenBranch,
      committedBranch: committedBranch,
      isTip: isTip,
      previewing: previewing,
      branchChoiceCompleted: branchChoiceCompleted,
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
    return !!(tree && tree.focusTracker && tree.focusTracker.waypointId === nodeId);
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

  function canMarkWaypointUndone(tree, nodeId) {
    return !!(nodeId && latestCompletedWaypointId(tree) === nodeId);
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

    function placeBranch(parentLayoutId, parentId, startX, startY, side, depth, forkDepth) {
      forkDepth = forkDepth || 0;
      const parentNode = (tree.nodes || []).find(function (n) { return n.id === parentId; });
      // Sub-branches this node forks into via a decision (deeper fork, WS5). These
      // are laid out off to the side; the linear branch child continues straight.
      const forkRootIds = {};
      if (parentNode && forkDepth < 2) {
        branchRootsForNode(tree, parentNode, spineIds).forEach(function (r) { forkRootIds[r.id] = true; });
      }
      const kids = (tree.nodes || []).filter(function (n) {
        return n.parentId === parentId && !spineIds[n.id] && nodeConfidence(n) > 1;
      });
      // The straight continuation is the first non-fork child.
      const linear = kids.find(function (k) { return !forkRootIds[k.id]; });
      const y = startY - branchGap;
      if (y < spineTipY - branchGap * 4) return;

      if (linear) {
        const x = depth <= 1 ? startX + side * 0.35 * siblingGap : startX;
        const added = addLayoutNode({
          id: linear.id,
          title: linear.title,
          depth: linear.depth || depth + 1,
          confidence: nodeConfidence(linear),
          parentId: parentLayoutId,
          done: !!linear.done,
          phaseColor: linear.phaseColor,
          pathRole: linear.pathRole || 'branch',
          x: x,
          y: y,
          raw: linear,
          stepPct: nodeStepProgress(linear).pct,
        });
        if (added) placeBranch(linear.id, linear.id, x, y, side, depth + 1, forkDepth);
      }

      // Deeper forks: sub-branch roots off this node, nudged further to the side
      // with a reduced offset so they read as secondary to the trunk fork.
      Object.keys(forkRootIds).forEach(function (rootId, fi) {
        const root = (tree.nodes || []).find(function (n) { return n.id === rootId; });
        if (!root) return;
        const subSide = fi % 2 === 0 ? side : -side;
        const subX = startX + subSide * (0.55 * siblingGap);
        const added = addLayoutNode({
          id: root.id,
          title: root.title,
          depth: root.depth || depth + 1,
          confidence: nodeConfidence(root),
          parentId: parentLayoutId,
          done: !!root.done,
          phaseColor: root.phaseColor,
          pathRole: root.pathRole || 'branch',
          x: subX,
          y: y,
          raw: root,
          stepPct: nodeStepProgress(root).pct,
        });
        if (added) placeBranch(root.id, root.id, subX, y, subSide, depth + 1, forkDepth + 1);
      });
    }

    majorNodes.forEach(function (major) {
      const majorPos = posById[major.id];
      if (!majorPos) return;
      const branchRoots = branchRootsForMajor(tree, major, spineIds);
      branchRoots.forEach(function (root, bi) {
        const side = bi % 2 === 0 ? -1 : 1;
        const lane = Math.floor(bi / 2) + 1;
        const x = side * lane * siblingGap;
        const y = majorPos.y - branchGap;
        if (y < spineTipY - branchGap * 4) return;
        const added = addLayoutNode({
          id: root.id,
          title: root.title,
          depth: root.depth || major.depth + 1,
          confidence: nodeConfidence(root),
          parentId: major.id,
          done: !!root.done,
          phaseColor: root.phaseColor,
          pathRole: root.pathRole || 'branch',
          x: x,
          y: y,
          raw: root,
          stepPct: nodeStepProgress(root).pct,
        });
        if (added) placeBranch(root.id, root.id, x, y, side, 2);
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
      + '<button type="button" class="roadmap-detail-close" id="roadmap-detail-close" aria-label="Close">×</button>';
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

    const head = '<div><p class="roadmap-detail-eyebrow">' + esc(roleLabel) + '</p>'
      + '<h3 class="roadmap-detail-title">' + esc(displayTitle(raw) || nodeLayout.title) + '</h3></div>'
      + '<button type="button" class="roadmap-detail-close" id="roadmap-detail-close" aria-label="Close">×</button>';

    let body = '';
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
      body += '<p class="roadmap-detail-phase" style="border-left-color:' + esc(raw.phaseColor || '#c4956a') + '">' + esc(raw.phaseLabel);
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
          + '<input type="checkbox" class="roadmap-step-check" data-node-id="' + esc(nodeLayout.id) + '" data-step-id="' + esc(step.id) + '"' + (step.done ? ' checked' : '') + (editable ? '' : ' disabled') + '>'
          + '<span>' + esc(step.text) + '</span></label></li>';
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
    const nid = esc(nodeLayout.id);
    let foot = '';

    // Branch affordances (WS2) — rendered above the step done/undone control.
    if (branchState.onUnchosenBranch) {
      if (branchState.previewing) {
        if (!branchState.branchChoiceCompleted) {
          foot += '<button type="button" class="cta-btn roadmap-commit-branch-btn" data-node-id="' + nid + '" disabled aria-disabled="true">Complete branch choice waypoint first</button>';
          foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-exit-preview-btn"' + (pendingBranch ? ' disabled' : '') + '>Exit preview</button>';
        } else {
          foot += '<button type="button" class="cta-btn roadmap-commit-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Commit to this branch</button>';
          foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-exit-preview-btn"' + (pendingBranch ? ' disabled' : '') + '>Exit preview</button>';
        }
      } else {
        if (!branchState.branchChoiceCompleted) {
          foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-preview-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Preview this path</button>';
          foot += '<button type="button" class="cta-btn roadmap-commit-branch-btn" data-node-id="' + nid + '" disabled aria-disabled="true">Complete branch choice waypoint first</button>';
        } else {
          foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-preview-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Preview this path</button>';
          foot += '<button type="button" class="cta-btn roadmap-commit-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Commit to this branch</button>';
        }
      }
    } else if (branchState.committedBranch) {
      if (branchState.isTip) {
        foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-extend-branch-btn' + (pendingExtend ? ' is-busy' : '') + '" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>'
          + (pendingExtend ? '<span class="roadmap-btn-spinner" aria-hidden="true"></span>Extending…' : 'Extend this branch with AI') + '</button>';
      }
      foot += '<button type="button" class="cta-btn cta-btn-outline roadmap-track-branch-btn" data-node-id="' + nid + '"' + (pendingBranch ? ' disabled' : '') + '>Track this branch in Focus</button>';
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
    panel.querySelectorAll('.roadmap-mark-done-btn, .roadmap-mark-undone-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (callbacks.onMarkDone) callbacks.onMarkDone(btn.getAttribute('data-node-id'));
      });
    });

    const previewBtn = panel.querySelector('.roadmap-preview-branch-btn');
    if (previewBtn) previewBtn.addEventListener('click', function () {
      if (callbacks.onPreviewPath) callbacks.onPreviewPath(previewBtn.getAttribute('data-node-id'));
    });
    const exitPreviewBtn = panel.querySelector('.roadmap-exit-preview-btn');
    if (exitPreviewBtn) exitPreviewBtn.addEventListener('click', function () {
      if (callbacks.onExitPreview) callbacks.onExitPreview();
    });
    const commitBtn = panel.querySelector('.roadmap-commit-branch-btn');
    if (commitBtn) commitBtn.addEventListener('click', function () {
      if (callbacks.onCommitBranch) callbacks.onCommitBranch(commitBtn.getAttribute('data-node-id'));
    });
    const extendBtn = panel.querySelector('.roadmap-extend-branch-btn');
    if (extendBtn) extendBtn.addEventListener('click', function () {
      if (callbacks.onExtendBranch) callbacks.onExtendBranch(extendBtn.getAttribute('data-node-id'));
    });
    const trackBtn = panel.querySelector('.roadmap-track-branch-btn');
    if (trackBtn) trackBtn.addEventListener('click', function () {
      if (callbacks.onTrackBranch) callbacks.onTrackBranch(trackBtn.getAttribute('data-node-id'));
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
        if (callbacks.onNodeSelect && callbacks.onNodeSelect(hit, treeNow) === true) {
          return;
        }
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

    canvas.onmousedown = onPointerDown;
    canvas.onmousemove = onPointerMove;
    canvas.onmouseup = onPointerUp;
    canvas.onmouseleave = function () { dragState = null; hoveredId = null; };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

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
