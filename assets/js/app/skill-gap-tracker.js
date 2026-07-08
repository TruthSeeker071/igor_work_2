/**
 * Skill Gap Tracker v0 — unified micro-focus for the immediate roadmap waypoint.
 * Progress from waypoint steps + keyword matches in logged progress.
 */
(function (global) {
  'use strict';

  const PRESET_LOGS = [
    'Finished online course',
    'Built a small project',
    'Had a coffee chat',
  ];

  const KEYWORD_PROGRESS_PER_MATCH = 8;

  const V3_VERSION = 3;
  const MAX_V3_GAPS = 6;
  const COORDINATE_SOURCE = 'coordinate';

  // Per-domain fast-checklist ladders (easiest → hardest). {dim} interpolates the
  // dimension name. These render instantly on the client; the server AI pass may
  // replace them later if the user hasn't checked anything yet.
  const FAST_CHECKLIST_TEMPLATES = {
    knowledge: [
      'Take an intro course covering {dim}',
      'Complete a structured unit or module on {dim}',
      'Apply {dim} in a small hands-on project',
      'Get feedback or take an assessment on {dim}',
    ],
    skills: [
      'Study one solid tutorial on {dim}',
      'Practice {dim} on 3-5 focused exercises',
      'Use {dim} in a real deliverable',
      'Have someone review your {dim} work',
    ],
    abilities: [
      'Warm up {dim} with short daily drills',
      'Do timed practice sets that stretch {dim}',
      'Apply {dim} under realistic conditions',
      'Track and review your {dim} progress',
    ],
    workActivities: [
      'Shadow or read how pros handle {dim}',
      'Do a low-stakes rep of {dim} yourself',
      'Own {dim} in a real project or role',
      'Debrief and refine your {dim} approach',
    ],
  };

  function fastChecklistForGap(dimIndex, domain, label) {
    var tpl = FAST_CHECKLIST_TEMPLATES[domain] || FAST_CHECKLIST_TEMPLATES.skills;
    var name = displayGapLabel(label) || 'this skill';
    return tpl.map(function (text, i) {
      return {
        id: 'dim-' + dimIndex + '-c' + (i + 1),
        text: text.replace(/\{dim\}/g, name),
        done: false,
      };
    });
  }

  function checklistProgress(gap) {
    var items = (gap && gap.checklist) || [];
    if (!items.length) return 0;
    var done = items.filter(function (c) { return c && c.done; }).length;
    return Math.round((done / items.length) * 100);
  }

  function gapIsTouched(gap) {
    if (!gap) return false;
    if (gap.manualComplete) return true;
    if ((gap.logs || []).length) return true;
    return ((gap.checklist || []).some(function (c) { return c && c.done; }));
  }

  function syncV3Progress(gap) {
    var cl = checklistProgress(gap);
    var manual = gap.manualComplete ? 100 : 0;
    var progress = Math.min(100, Math.max(cl, manual));
    var status = progress >= 100 ? 'closed' : progress > 0 ? 'in_progress' : 'open';
    return Object.assign({}, gap, { progress: progress, status: status });
  }

  function buildV3Gap(item) {
    var gap = {
      id: 'dim-' + item.index,
      dimIndex: item.index,
      label: item.name,
      domain: item.domain || 'unknown',
      user: item.user,
      target: item.target,
      gap: item.gap,
      source: COORDINATE_SOURCE,
      checklist: fastChecklistForGap(item.index, item.domain, item.name),
      checklistSource: 'fast',
      logs: [],
      manualComplete: false,
      status: 'open',
      progress: 0,
    };
    return syncV3Progress(gap);
  }

  function isV3Tracker(ft) {
    return !!(ft && ft.version === V3_VERSION && Array.isArray(ft.skillGaps)
      && ft.skillGaps.some(function (g) { return g && g.source === COORDINATE_SOURCE; }));
  }

  // Merge freshly-computed coordinate deltas into an existing v3 gap set by
  // dimIndex: preserve checklist done-states, logs, manualComplete; refresh the
  // user/target/gap numbers. A dim that falls out of the new top-6 is dropped
  // ONLY if it is untouched — touched gaps stay pinned until closed.
  function mergeV3Gaps(priorGaps, freshItems) {
    var priorByDim = {};
    (priorGaps || []).forEach(function (g) {
      if (g && g.dimIndex != null) priorByDim[g.dimIndex] = g;
    });
    var freshByDim = {};
    var merged = [];
    (freshItems || []).forEach(function (item) {
      freshByDim[item.index] = true;
      var prev = priorByDim[item.index];
      if (!prev) {
        merged.push(buildV3Gap(item));
        return;
      }
      var doneById = {};
      (prev.checklist || []).forEach(function (c) { if (c) doneById[c.id] = c.done; });
      var freshGap = buildV3Gap(item);
      var checklist = (freshGap.checklist || []).map(function (c) {
        return doneById[c.id] ? Object.assign({}, c, { done: true }) : c;
      });
      // Preserve an already-upgraded AI checklist verbatim (don't overwrite with fast).
      if (prev.checklistSource === 'ai' && (prev.checklist || []).length) {
        checklist = prev.checklist.slice();
      }
      merged.push(syncV3Progress(Object.assign({}, freshGap, {
        checklist: checklist,
        checklistSource: prev.checklistSource || 'fast',
        logs: (prev.logs || []).slice(0, 12),
        manualComplete: !!prev.manualComplete,
      })));
    });
    // Pin touched prior gaps that fell out of the fresh top set.
    (priorGaps || []).forEach(function (g) {
      if (g && g.dimIndex != null && !freshByDim[g.dimIndex] && gapIsTouched(g)) {
        merged.push(syncV3Progress(g));
      }
    });
    merged.sort(function (a, b) { return (b.gap || 0) - (a.gap || 0); });
    return merged.slice(0, MAX_V3_GAPS);
  }

  const STOP_WORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, for: 1, to: 1, of: 1, in: 1, on: 1,
    with: 1, your: 1, you: 1, this: 1, that: 1, from: 1, into: 1, about: 1,
    skills: 1, skill: 1, core: 1,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  function normalizeGapLabel(gap) {
    const s = String(gap || '').trim();
    if (!s) return '';
    return s.replace(/\s*\(\d+%\)\s*$/i, '').trim();
  }

  function displayGapLabel(label) {
    const norm = normalizeGapLabel(label);
    if (!norm) return '';
    if (global.FWCareerTarget && typeof FWCareerTarget.formatGapLabel === 'function') {
      return FWCareerTarget.formatGapLabel(norm);
    }
    return norm.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function slugFromGap(label) {
    return normalizeGapLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'gap';
  }

  function nextWaypoint(tree) {
    if (global.FWRoadmapTree && typeof FWRoadmapTree.nextWaypoint === 'function') {
      return FWRoadmapTree.nextWaypoint(tree);
    }
    return null;
  }

  function waypointById(tree, id) {
    return (tree.nodes || []).find(function (n) { return n.id === id; }) || null;
  }

  var MAX_BRANCH_FOCUSES = 2;

  // Branch-root id for the branch a node belongs to (WS6). Walk the parentId chain
  // to the first node that is a decision option's childNodeId; that is the branch
  // key. Returns 'spine' if the node is on the main path (no branch ancestor).
  function branchKeyForNode(tree, nodeId) {
    if (!tree || !nodeId || nodeId === 'trunk') return 'spine';
    var optionRoots = {};
    (tree.decisions || []).forEach(function (d) {
      (d.options || []).forEach(function (opt) {
        if (opt.childNodeId) optionRoots[opt.childNodeId] = true;
      });
    });
    var byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    var cur = nodeId;
    var guard = 0;
    var lastRoot = null;
    while (cur && cur !== 'trunk' && guard < 40) {
      guard += 1;
      if (optionRoots[cur]) lastRoot = cur;
      var n = byId[cur];
      if (!n) break;
      cur = n.parentId;
    }
    return lastRoot || 'spine';
  }

  // Next undone waypoint on a specific branch: walk trunk->branch tip via parentId
  // down the branch's chain, skipping done nodes. branchKey 'spine' walks the main
  // activePath. Falls back to the branch root if all are done.
  function branchTipNode(tree, branchKey) {
    if (branchKey === 'spine' || !branchKey) return null;
    var byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    var cur = byId[branchKey];
    if (!cur) return null;
    var guard = 0;
    while (guard < 40) {
      guard += 1;
      var kids = (tree.nodes || []).filter(function (n) {
        return n.parentId === cur.id && n.pathRole === 'branch';
      });
      if (!kids.length) break;
      kids.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      cur = kids[0];
    }
    return cur;
  }

  function branchChainNodes(tree, branchKey) {
    if (branchKey === 'spine' || !branchKey) return [];
    var tip = branchTipNode(tree, branchKey);
    if (!tip) return [];
    var byId = {};
    (tree.nodes || []).forEach(function (n) { byId[n.id] = n; });
    var chain = [];
    var cur = tip.id;
    var guard = 0;
    while (cur && cur !== 'trunk' && guard < 40) {
      guard += 1;
      var n = byId[cur];
      if (!n) break;
      chain.unshift(n);
      // Stop once we pass the branch root's parent (chain within the branch only).
      if (cur === branchKey) break;
      cur = n.parentId;
    }
    return chain;
  }

  function immediateWaypointForBranch(tree, branchKey) {
    if (!branchKey || branchKey === 'spine') return nextWaypoint(tree);
    var chain = branchChainNodes(tree, branchKey);
    for (var i = 0; i < chain.length; i += 1) {
      if (!chain[i].done) return chain[i];
    }
    return chain.length ? chain[chain.length - 1] : nextWaypoint(tree);
  }

  function activeBranchKey(tree) {
    var ft = tree && tree.focusTracker;
    if (ft && ft.activeBranchKey) return ft.activeBranchKey;
    return 'spine';
  }

  function branchFocusWaypoint(tree) {
    var key = activeBranchKey(tree);
    if (key === 'spine') {
      var ft = tree && tree.focusTracker;
      if (ft && ft.waypointId) {
        var pinned = waypointById(tree, ft.waypointId);
        if (pinned) return pinned;
      }
      return nextWaypoint(tree);
    }
    return immediateWaypointForBranch(tree, key);
  }

  // Whitelist the round-trippable per-branch focus fields off an existing tracker,
  // dropping any branchFocus whose branchKey/waypoint no longer resolves. Mirrors
  // the server's branchFocusFieldsFrom so neither side clobbers the other on save.
  function branchFocusFields(tree, existing) {
    var out = {};
    var nodeIds = {};
    (tree.nodes || []).forEach(function (n) { nodeIds[n.id] = true; });
    var seen = {};
    var list = [];
    ((existing && existing.branchFocuses) || []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var key = b.branchKey;
      if (!key || seen[key]) return;
      if (key !== 'spine' && !nodeIds[key]) return;
      if (b.waypointId && b.waypointId !== 'trunk' && !nodeIds[b.waypointId]) return;
      seen[key] = true;
      list.push({
        branchKey: key,
        waypointId: b.waypointId || null,
        updatedAt: b.updatedAt || new Date().toISOString(),
      });
      if (list.length >= MAX_BRANCH_FOCUSES) return;
    });
    if (list.length) out.branchFocuses = list;
    var akey = existing && existing.activeBranchKey;
    if (akey && (akey === 'spine' || nodeIds[akey])
      && (akey === 'spine' || list.some(function (b) { return b.branchKey === akey; }))) {
      out.activeBranchKey = akey;
    }
    return out;
  }

  // Add/switch the secondary branchFocus (WS6). Main path ('spine') is always
  // implicitly present; we track at most one secondary branch. Sets it active.
  function trackBranchFocus(tree, branchNodeId, quizScores) {
    if (!tree || !tree.focusTracker || !branchNodeId) return null;
    var key = branchKeyForNode(tree, branchNodeId);
    if (key === 'spine') {
      // Node is on the main path — just make main active.
      return Object.assign({}, tree, {
        focusTracker: Object.assign({}, tree.focusTracker, {
          activeBranchKey: 'spine',
          updatedAt: new Date().toISOString(),
        }),
      });
    }
    var wp = immediateWaypointForBranch(tree, key);
    var entry = {
      branchKey: key,
      waypointId: wp ? wp.id : null,
      updatedAt: new Date().toISOString(),
    };
    // Keep only the secondary slot (drop any prior secondary), main is implicit.
    var focuses = [entry];
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        branchFocuses: focuses,
        activeBranchKey: key,
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  function setActiveBranchKey(tree, branchKey) {
    if (!tree || !tree.focusTracker) return tree;
    var key = branchKey || 'spine';
    if (key !== 'spine') {
      var known = (tree.focusTracker.branchFocuses || []).some(function (b) { return b.branchKey === key; });
      if (!known) return tree;
    }
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        activeBranchKey: key,
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  function quizFitBreakdownForTree(tree, quizScores) {
    if (!quizScores || !tree || !tree.targetCareerSlug || !global.FWHubCareers) return null;
    if (typeof FWHubCareers.careerIdFromSlug !== 'function'
      || typeof FWHubCareers.getCareerFitBreakdown !== 'function') return null;
    const id = FWHubCareers.careerIdFromSlug(tree.targetCareerSlug);
    if (!id) return null;
    try {
      return FWHubCareers.getCareerFitBreakdown(id, quizScores);
    } catch (_) {
      return null;
    }
  }

  function buildFallbackKeywords(gap, waypoint) {
    const tokens = {};
    function addText(text) {
      String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .forEach(function (w) {
          if (w.length > 2 && !STOP_WORDS[w]) tokens[w] = true;
        });
    }
    addText(gap && gap.label);
    const stepMap = {};
    ((waypoint && waypoint.steps) || []).forEach(function (s) { stepMap[s.id] = s; });
    ((gap && gap.linkedStepIds) || []).forEach(function (sid) {
      if (stepMap[sid]) addText(stepMap[sid].text);
    });
    return Object.keys(tokens).slice(0, 18);
  }

  function ensureGapKeywords(gap, waypoint) {
    if (gap.keywords && gap.keywords.length) {
      return Object.assign({}, gap, {
        matchedKeywords: gap.matchedKeywords || [],
      });
    }
    return Object.assign({}, gap, {
      keywords: buildFallbackKeywords(gap, waypoint),
      matchedKeywords: gap.matchedKeywords || [],
    });
  }

  function applyLogKeywords(gap, text, waypoint) {
    const withKeys = ensureGapKeywords(gap, waypoint);
    const hay = String(text || '').toLowerCase();
    const matched = (withKeys.matchedKeywords || []).slice();
    (withKeys.keywords || []).forEach(function (kw) {
      const k = String(kw || '').toLowerCase().trim();
      if (!k || hay.indexOf(k) === -1) return;
      if (matched.indexOf(kw) === -1) matched.push(kw);
    });
    return Object.assign({}, withKeys, { matchedKeywords: matched });
  }

  function recomputeMatchedKeywords(gap, waypoint) {
    const withKeys = ensureGapKeywords(gap, waypoint);
    const matched = [];
    (withKeys.logs || []).forEach(function (log) {
      const hay = String(log && log.text || '').toLowerCase();
      (withKeys.keywords || []).forEach(function (kw) {
        const k = String(kw || '').toLowerCase().trim();
        if (!k || hay.indexOf(k) === -1) return;
        if (matched.indexOf(kw) === -1) matched.push(kw);
      });
    });
    return Object.assign({}, withKeys, { matchedKeywords: matched });
  }

  function resolveFocusWaypoint(tree, existing, opts) {
    if (opts && opts.advance) return nextWaypoint(tree);
    if (existing && existing.waypointId) {
      const pinned = waypointById(tree, existing.waypointId);
      if (pinned) return pinned;
    }
    return nextWaypoint(tree);
  }

  function isWaypointStepsComplete(waypoint) {
    const steps = (waypoint && waypoint.steps) || [];
    if (!steps.length) return !!(waypoint && waypoint.done);
    return steps.every(function (s) { return s.done; });
  }

  function shouldAdvanceFocus(tree) {
    if (!tree || !tree.focusTracker) return false;
    const wpId = tree.focusTracker.waypointId;
    const wp = waypointById(tree, wpId);
    if (!wp || !isWaypointStepsComplete(wp)) return false;
    const next = nextWaypoint(tree);
    return !!(next && next.id !== wpId);
  }

  function deriveGapEntries(tree, quizFitBreakdown, waypoint) {
    const entries = [];
    const seen = {};
    function add(label, source) {
      const norm = normalizeGapLabel(label);
      const key = norm.toLowerCase();
      if (!norm || seen[key]) return;
      seen[key] = true;
      entries.push({ label: displayGapLabel(norm), source: source || 'quiz' });
    }
    const fit = (tree && tree.fitContext) || {};
    (fit.vectorGaps || []).slice(0, 4).forEach(function (g) { add(g.name || g.label, 'vector'); });
    (fit.topGaps || []).slice(0, 4).forEach(function (g) { add(g, fit.vectorGaps && fit.vectorGaps.length ? 'vector' : 'quiz'); });
    const wp = waypoint || nextWaypoint(tree);
    if (wp && wp.addressedGaps) {
      wp.addressedGaps.slice(0, 2).forEach(function (g) { add(g, 'waypoint'); });
    }
    if (entries.length < 4 && !fit.targetSoc && quizFitBreakdown && quizFitBreakdown.gaps) {
      quizFitBreakdown.gaps.forEach(function (g) { add(g, 'quiz'); });
    }
    if (!entries.length) {
      add('Core skills for this waypoint', 'waypoint');
    }
    return entries.slice(0, 6);
  }

  function linkStepsToGaps(waypoint, entries, priorGaps) {
    const steps = (waypoint && waypoint.steps) || [];
    const priorByLabel = {};
    (priorGaps || []).forEach(function (g) {
      priorByLabel[normalizeGapLabel(g.label).toLowerCase()] = g;
    });
    const gaps = entries.map(function (entry, i) {
      const prev = priorByLabel[normalizeGapLabel(entry.label).toLowerCase()];
      return {
        id: (prev && prev.id) || ('sg-' + slugFromGap(entry.label) + '-' + i),
        label: entry.label,
        source: entry.source,
        status: 'open',
        progress: 0,
        linkedStepIds: [],
        logs: (prev && prev.logs) ? prev.logs.slice() : [],
        keywords: (prev && prev.keywords) ? prev.keywords.slice() : [],
        matchedKeywords: (prev && prev.matchedKeywords) ? prev.matchedKeywords.slice() : [],
        manualComplete: !!(prev && prev.manualComplete),
      };
    });
    const linkCount = Math.min(steps.length, gaps.length);
    for (let i = 0; i < linkCount; i += 1) {
      const gap = gaps[i];
      const step = steps[i];
      if (gap && step && gap.linkedStepIds.indexOf(step.id) === -1) {
        gap.linkedStepIds.push(step.id);
      }
    }
    return gaps.map(function (g) { return ensureGapKeywords(g, waypoint); });
  }

  function syncProgressForGaps(waypoint, skillGaps) {
    const stepMap = {};
    ((waypoint && waypoint.steps) || []).forEach(function (s) { stepMap[s.id] = s; });
    return (skillGaps || []).map(function (gap) {
      const linked = gap.linkedStepIds || [];
      const done = linked.filter(function (id) { return stepMap[id] && stepMap[id].done; }).length;
      const stepProgress = linked.length ? Math.round((done / linked.length) * 100) : 0;
      const keywordProgress = Math.min(100, (gap.matchedKeywords || []).length * KEYWORD_PROGRESS_PER_MATCH);
      const manualProgress = gap.manualComplete ? 100 : 0;
      const progress = Math.min(100, Math.max(stepProgress, keywordProgress, manualProgress));
      const status = progress >= 100 ? 'closed' : progress > 0 ? 'in_progress' : 'open';
      return Object.assign({}, gap, { progress: progress, status: status });
    });
  }

  function ensureFocusTracker(tree, quizScores, opts) {
    if (!tree || tree.version !== 2 || !Array.isArray(tree.nodes)) return tree;
    const existing = tree.focusTracker;
    const wp = resolveFocusWaypoint(tree, existing, opts);
    if (!wp) return tree;

    // A v3 (coordinate-delta) tracker is preserved synchronously — deltas need an
    // async vector fetch that this sync entry point can't do. We keep the existing
    // v3 gaps, re-pin to the current waypoint, and re-sync progress. The async
    // recompute (recomputeCoordinateGaps, driven by the focus panel) refreshes the
    // numbers. On advance/waypoint change we clear the pin so the panel rebuilds.
    if (isV3Tracker(existing)) {
      const advancedOrChanged = (opts && opts.advance) || existing.waypointId !== wp.id;
      const gaps = advancedOrChanged
        ? existing.skillGaps.filter(gapIsTouched).map(syncV3Progress)
        : existing.skillGaps.map(syncV3Progress);
      return Object.assign({}, tree, {
        focusTracker: Object.assign({
          version: V3_VERSION,
          waypointId: wp.id,
          skillGaps: gaps,
          needsRecompute: advancedOrChanged || !!existing.needsRecompute,
        }, branchFocusFields(tree, existing), {
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    const breakdown = quizFitBreakdownForTree(tree, quizScores);
    const waypointChanged = !existing || existing.waypointId !== wp.id;
    let skillGaps;

    if (waypointChanged || !existing || !existing.skillGaps || !existing.skillGaps.length) {
      const entries = deriveGapEntries(tree, breakdown, wp);
      const priorForLink = waypointChanged ? [] : ((existing && existing.skillGaps) || []);
      skillGaps = linkStepsToGaps(wp, entries, priorForLink);
    } else {
      const entries = existing.skillGaps.map(function (g) {
        return { label: g.label, source: g.source || 'quiz' };
      });
      skillGaps = linkStepsToGaps(wp, entries, existing.skillGaps);
    }
    skillGaps = syncProgressForGaps(wp, skillGaps);

    return Object.assign({}, tree, {
      focusTracker: Object.assign({
        version: 1,
        waypointId: wp.id,
        skillGaps: skillGaps,
      }, branchFocusFields(tree, existing), {
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  function advanceFocusWaypoint(tree, quizScores) {
    return ensureFocusTracker(tree, quizScores, { advance: true });
  }

  function resetFocusTrackerForWaypoint(tree, waypointId, quizScores) {
    if (!tree || !waypointId) return tree;
    const wp = waypointById(tree, waypointId);
    if (!wp) return tree;
    const breakdown = quizFitBreakdownForTree(tree, quizScores);
    const entries = deriveGapEntries(tree, breakdown, wp);
    const skillGaps = syncProgressForGaps(wp, linkStepsToGaps(wp, entries, []));
    return Object.assign({}, tree, {
      focusTracker: {
        version: 1,
        waypointId: waypointId,
        skillGaps: skillGaps,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  function syncProgress(tree) {
    if (!tree || !tree.focusTracker) return ensureFocusTracker(tree);
    const wp = waypointById(tree, tree.focusTracker.waypointId) || nextWaypoint(tree);
    if (!wp) return tree;
    if (isV3Tracker(tree.focusTracker)) {
      const gaps = (tree.focusTracker.skillGaps || []).map(syncV3Progress);
      return Object.assign({}, tree, {
        focusTracker: Object.assign({}, tree.focusTracker, {
          waypointId: wp.id,
          skillGaps: gaps,
          updatedAt: new Date().toISOString(),
        }),
      });
    }
    const skillGaps = syncProgressForGaps(wp, tree.focusTracker.skillGaps || []);
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        waypointId: wp.id,
        skillGaps: skillGaps,
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  function appendLog(tree, gapId, text) {
    const msg = String(text || '').trim();
    if (!tree || !tree.focusTracker || !msg) return tree;
    const log = {
      id: 'log-' + Date.now(),
      text: msg.slice(0, 280),
      at: new Date().toISOString(),
    };
    const skillGaps = (tree.focusTracker.skillGaps || []).map(function (g) {
      if (g.id !== gapId) return g;
      const logs = (g.logs || []).slice();
      logs.unshift(log);
      return Object.assign({}, g, { logs: logs.slice(0, 12) });
    });
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        skillGaps: skillGaps,
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  function persistLog(tree, gapId, text) {
    const wp = waypointById(tree, tree && tree.focusTracker && tree.focusTracker.waypointId);
    let updated = appendLog(tree, gapId, text);
    const skillGaps = (updated.focusTracker.skillGaps || []).map(function (g) {
      if (g.id !== gapId) return g;
      return applyLogKeywords(g, text, wp);
    });
    updated = Object.assign({}, updated, {
      focusTracker: Object.assign({}, updated.focusTracker, { skillGaps: skillGaps }),
    });
    return syncProgress(updated);
  }

  function removeLog(tree, gapId, logId) {
    if (!tree || !tree.focusTracker || !gapId || !logId) return tree;
    const wp = waypointById(tree, tree.focusTracker.waypointId);
    const skillGaps = (tree.focusTracker.skillGaps || []).map(function (g, gi) {
      if (g.id !== gapId) return g;
      const logs = (g.logs || []).filter(function (l, li) {
        const id = l.id || ('log-legacy-' + g.id + '-' + li);
        return id !== logId;
      });
      return recomputeMatchedKeywords(Object.assign({}, g, { logs: logs }), wp);
    });
    const updated = Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        skillGaps: skillGaps,
        updatedAt: new Date().toISOString(),
      }),
    });
    return syncProgress(updated);
  }

  function toggleWaypointStep(tree, waypointId, stepId, done) {
    if (!tree || !waypointId || !stepId) return tree;
    const nodes = (tree.nodes || []).map(function (n) {
      if (n.id !== waypointId) return n;
      const steps = (n.steps || []).map(function (s) {
        if (s.id !== stepId) return s;
        return Object.assign({}, s, { done: !!done });
      });
      const out = Object.assign({}, n, { steps: steps });
      if (global.FWRoadmapTree && FWRoadmapTree.syncNodeDoneFromSteps) {
        FWRoadmapTree.syncNodeDoneFromSteps(out);
      }
      return out;
    });
    const updated = Object.assign({}, tree, {
      nodes: nodes,
      updatedAt: new Date().toISOString(),
    });
    return syncProgress(updated);
  }

  function toggleGapManualComplete(tree, gapId, done) {
    if (!tree || !tree.focusTracker || !gapId) return tree;
    const v3 = isV3Tracker(tree.focusTracker);
    const wp = waypointById(tree, tree.focusTracker.waypointId);
    const skillGaps = (tree.focusTracker.skillGaps || []).map(function (g) {
      if (g.id !== gapId) return g;
      return Object.assign({}, g, { manualComplete: !!done });
    });
    const synced = v3 ? skillGaps.map(syncV3Progress) : syncProgressForGaps(wp, skillGaps);
    const updated = Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        skillGaps: synced,
        updatedAt: new Date().toISOString(),
      }),
    });
    return updated;
  }

  // Toggle a single v3 checklist item (no confirm modal — only manualComplete
  // needs the confirm). Recomputes checklistProgress → progress → status.
  function toggleChecklistItem(tree, gapId, itemId, done) {
    if (!tree || !tree.focusTracker || !gapId || !itemId) return tree;
    const skillGaps = (tree.focusTracker.skillGaps || []).map(function (g) {
      if (g.id !== gapId) return g;
      const checklist = (g.checklist || []).map(function (c) {
        if (c.id !== itemId) return c;
        return Object.assign({}, c, { done: !!done });
      });
      return syncV3Progress(Object.assign({}, g, { checklist: checklist }));
    });
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        skillGaps: skillGaps,
        updatedAt: new Date().toISOString(),
      }),
    });
  }

  // Call the complete-step endpoint to update objective vector
  function completeStep({ stepId, waypointId, gapLabel, dimIndex, currentValue, boost }) {
    return fetch('/career-roadmap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'complete-step',
        stepId,
        waypointId,
        gapLabel,
        dimIndex,
        currentValue,
        boost,
      }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Call the revert-step endpoint to revert objective vector
  function revertStep({ stepId, waypointId, gapLabel, dimIndex, currentValue, boost }) {
    return fetch('/career-roadmap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'revert-step',
        stepId,
        waypointId,
        gapLabel,
        dimIndex,
        currentValue,
        boost,
      }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function runFocusAdvance(opts) {
    opts = opts || {};
    if (opts.showLoading) opts.showLoading();
    setTimeout(function () {
      const tree = opts.getTree ? opts.getTree() : null;
      const advanced = advanceFocusWaypoint(tree, opts.quizScores);
      if (opts.onPersist) opts.onPersist(advanced);
      if (opts.hideLoading) opts.hideLoading();
    }, 650);
  }

  function maybeAdvanceOnComplete(updated, ctx) {
    const synced = syncProgress(updated);
    if (!ctx || typeof ctx.onPersist !== 'function') return synced;
    if (shouldAdvanceFocus(synced) && typeof ctx.runAdvance === 'function') {
      ctx.onPersist(synced);
      ctx.runAdvance(synced);
      return synced;
    }
    ctx.onPersist(synced);
    return synced;
  }

  function resolveTargetSocForTree(tree) {
    var fc = (tree && tree.fitContext) || {};
    if (fc.targetSoc) return Promise.resolve(fc.targetSoc);
    if (global.FWOnetVectors && typeof FWOnetVectors.resolveTargetSoc === 'function') {
      return FWOnetVectors.resolveTargetSoc(tree.targetCareerSlug, null).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function readVectorsForTracker() {
    if (!global.FWOnetVectors || typeof FWOnetVectors.readQuizVectors !== 'function') return null;
    try {
      return FWOnetVectors.readQuizVectors({ hydrate: true });
    } catch (_) {
      return null;
    }
  }

  // Async coordinate-delta recompute. Fetches the career vector, computes the
  // objective-vs-career deltas, builds/merges v3 gaps, and returns a Promise of
  // the updated tree. Resolves to the ORIGINAL tree (with legacy tracker intact)
  // when vectors/targetSoc are unavailable — never bricks the tracker.
  function recomputeCoordinateGaps(tree, opts) {
    opts = opts || {};
    if (!tree || tree.version !== 2 || !Array.isArray(tree.nodes)) return Promise.resolve(tree);
    if (!global.FWOnetVectors || typeof FWOnetVectors.objectiveVsCareerDimensions !== 'function') {
      return Promise.resolve(tree);
    }
    const wp = resolveFocusWaypoint(tree, tree.focusTracker, null);
    if (!wp) return Promise.resolve(tree);
    const vecs = readVectorsForTracker();
    const objValues = vecs && vecs.objective && vecs.objective.values ? vecs.objective.values : null;
    const persValues = vecs && vecs.personality && vecs.personality.values ? vecs.personality.values : null;
    if (!objValues && !persValues) return Promise.resolve(tree);

    return resolveTargetSocForTree(tree).then(function (soc) {
      if (!soc) return tree;
      return FWOnetVectors.objectiveVsCareerDimensions(soc, objValues, persValues).then(function (result) {
        if (!result || !result.gaps || !result.gaps.length) return tree;
        const freshItems = result.gaps.slice(0, MAX_V3_GAPS);
        const prior = isV3Tracker(tree.focusTracker) ? (tree.focusTracker.skillGaps || []) : [];
        const merged = mergeV3Gaps(prior, freshItems).map(syncV3Progress);
        return Object.assign({}, tree, {
          focusTracker: {
            version: V3_VERSION,
            waypointId: wp.id,
            skillGaps: merged,
            updatedAt: new Date().toISOString(),
          },
        });
      }).catch(function () { return tree; });
    }).catch(function () { return tree; });
  }

  function gapSetSignature(tree) {
    var soc = (tree && tree.fitContext && tree.fitContext.targetSoc) || (tree && tree.targetCareerSlug) || '';
    var dims = ((tree && tree.focusTracker && tree.focusTracker.skillGaps) || [])
      .map(function (g) { return g.dimIndex; }).sort(function (a, b) { return a - b; }).join(',');
    return soc + '|' + dims;
  }

  // Request AI checklists once per (soc + gap-set signature) per session. Replaces
  // a gap's fast checklist ONLY if the user hasn't checked anything on it yet.
  function requestAiChecklists(tree, onPersist) {
    if (!tree || !isV3Tracker(tree.focusTracker)) return;
    var gaps = tree.focusTracker.skillGaps || [];
    var soc = tree.fitContext && tree.fitContext.targetSoc;
    if (!soc || !gaps.length) return;
    var sig = 'sgt-aichk:' + gapSetSignature(tree);
    try {
      if (sessionStorage.getItem(sig)) return;
      sessionStorage.setItem(sig, '1');
    } catch (_) { /* sessionStorage unavailable — proceed once */ }

    var payloadGaps = gaps.slice(0, MAX_V3_GAPS).map(function (g) {
      return { dimIndex: g.dimIndex, name: g.label, domain: g.domain, user: g.user, target: g.target };
    });
    var body = {
      action: 'gap-checklists',
      soc: soc,
      careerName: tree.targetCareerName || '',
      gaps: payloadGaps,
    };

    fetch('/career-roadmap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      var checklists = data && data.checklists;
      if (!checklists) return;
      var latest = typeof onPersist === 'function' && onPersist.getTree ? onPersist.getTree() : tree;
      var current = latest && isV3Tracker(latest.focusTracker) ? latest : tree;
      var changed = false;
      var skillGaps = (current.focusTracker.skillGaps || []).map(function (g) {
        var actions = checklists[g.dimIndex] || checklists[String(g.dimIndex)];
        if (!actions || !actions.length) return g;
        if ((g.checklist || []).some(function (c) { return c && c.done; })) return g;
        changed = true;
        return syncV3Progress(Object.assign({}, g, {
          checklist: actions.slice(0, 6).map(function (a, i) {
            return { id: 'dim-' + g.dimIndex + '-c' + (i + 1), text: String(a.text || a).slice(0, 90), done: false };
          }),
          checklistSource: 'ai',
        }));
      });
      if (!changed) return;
      var updated = Object.assign({}, current, {
        focusTracker: Object.assign({}, current.focusTracker, {
          skillGaps: skillGaps,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (typeof onPersist === 'function') onPersist(updated);
    }).catch(function () { /* AI upgrade is best-effort */ });
  }

  var confirmModalBound = false;

  function ensureConfirmModal() {
    if (document.getElementById('sgt-confirm-overlay')) return;
    var shell = document.createElement('div');
    shell.innerHTML = ''
      + '<div class="sgt-confirm-overlay" id="sgt-confirm-overlay" hidden aria-hidden="true">'
      + '<div class="sgt-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="sgt-confirm-title">'
      + '<h3 class="sgt-confirm-title" id="sgt-confirm-title">Close this skill gap?</h3>'
      + '<p class="sgt-confirm-body">Are you sure? Have you closed this skill gap to a level you\'re satisfied with?</p>'
      + '<div class="sgt-confirm-actions">'
      + '<button type="button" class="cta-btn cta-btn-outline" id="sgt-confirm-cancel">Not yet</button>'
      + '<button type="button" class="cta-btn" id="sgt-confirm-yes">Yes, mark done</button>'
      + '</div></div></div>';
    document.body.appendChild(shell.firstElementChild);
  }

  function requestStepToggleConfirm(opts) {
    ensureConfirmModal();
    var overlay = document.getElementById('sgt-confirm-overlay');
    var cancelBtn = document.getElementById('sgt-confirm-cancel');
    var yesBtn = document.getElementById('sgt-confirm-yes');
    if (!overlay || !cancelBtn || !yesBtn) {
      if (opts && opts.onConfirm) opts.onConfirm();
      return;
    }
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    yesBtn.focus();

    function close(result) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      cancelBtn.removeEventListener('click', onCancel);
      yesBtn.removeEventListener('click', onYes);
      document.removeEventListener('keydown', onKey);
      if (result && opts && opts.onConfirm) opts.onConfirm();
      else if (!result && opts && opts.onCancel) opts.onCancel();
    }

    function onCancel() { close(false); }
    function onYes() { close(true); }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
    }

    cancelBtn.addEventListener('click', onCancel);
    yesBtn.addEventListener('click', onYes);
    document.addEventListener('keydown', onKey);
  }

  function handleStepCheckboxChange(cb, ctx) {
    if (!cb || !ctx || !ctx.getTree || !ctx.onPersist) return;
    var tree = ctx.getTree();
    if (!tree || !tree.focusTracker) return;
    var wpId = ctx.waypointId || tree.focusTracker.waypointId;
    var stepId = cb.getAttribute('data-step-id');
    var wantDone = cb.checked;

    if (!wantDone) {
      var unchecked = toggleWaypointStep(tree, wpId, stepId, false);

      // Revert objective vector for this step
      var waypoint = (tree.nodes || []).find(function (n) { return n.id === wpId; });
      var gapLabel = waypoint?.addressedGaps?.[0] || 'this waypoint';
      var dimIndex = waypoint?.addressedGaps?.length
        ? (tree.fitContext?.vectorGaps || []).findIndex(function (vg) { return vg.name === gapLabel; })
        : -1;
      var targetDimIndex = (dimIndex >= 0 && tree.fitContext?.vectorGaps?.[dimIndex]?.index)
        ? tree.fitContext.vectorGaps[dimIndex].index
        : null;

      if (targetDimIndex != null) {
        revertStep({
          stepId: stepId,
          waypointId: wpId,
          gapLabel: gapLabel,
          dimIndex: targetDimIndex,
          currentValue: tree.fitContext?.vectorGaps?.[dimIndex]?.user || 0,
          boost: 6,
        }).then(function (result) {
          if (result && result.objectivePatched) {
            console.log('[SGT] Objective vector reverted from step:', result.objectiveVector ? 'yes' : 'no');
          }
        }).catch(function () { /* ignore */ });
      }

      if (ctx.maybeAdvanceOnComplete) {
        ctx.maybeAdvanceOnComplete(unchecked);
      } else {
        ctx.onPersist(unchecked);
      }
      return;
    }

    cb.checked = false;
    requestStepToggleConfirm({
      onConfirm: function () {
        var latest = ctx.getTree();
        if (!latest || !latest.focusTracker) return;
        var confirmWpId = ctx.waypointId || latest.focusTracker.waypointId;
        var stepIdConfirm = cb.getAttribute('data-step-id');
        var updated = toggleWaypointStep(latest, confirmWpId, stepIdConfirm, true);

        // Update objective vector for this step
        // Find the waypoint to get its addressed gaps
        var waypoint = (latest.nodes || []).find(function (n) { return n.id === confirmWpId; });
        var gapLabel = waypoint?.addressedGaps?.[0] || 'this waypoint';
        var dimIndex = waypoint?.addressedGaps?.length
          ? (latest.fitContext?.vectorGaps || []).findIndex(function (vg) { return vg.name === gapLabel; })
          : -1;
        // If we can't find a matching vector gap, use a reasonable default
        var targetDimIndex = (dimIndex >= 0 && latest.fitContext?.vectorGaps?.[dimIndex]?.index)
          ? latest.fitContext.vectorGaps[dimIndex].index
          : null;

        if (targetDimIndex != null) {
          completeStep({
            stepId: stepIdConfirm,
            waypointId: confirmWpId,
            gapLabel: gapLabel,
            dimIndex: targetDimIndex,
            currentValue: latest.fitContext?.vectorGaps?.[dimIndex]?.user || 0,
            boost: 6,
          }).then(function (result) {
            if (result && result.objectivePatched) {
              console.log('[SGT] Objective vector updated from step:', result.objectiveVector ? 'yes' : 'no');
            }
          }).catch(function () { /* ignore */ });
        }

        if (ctx.maybeAdvanceOnComplete) {
          ctx.maybeAdvanceOnComplete(updated);
        } else {
          ctx.onPersist(updated);
        }
      },
      onCancel: function () {
        cb.checked = false;
      },
    });
  }

  function handleGapCheckboxChange(cb, ctx) {
    if (!cb || !ctx || !ctx.getTree || !ctx.onPersist) return;
    var tree = ctx.getTree();
    if (!tree || !tree.focusTracker) return;
    var gapId = cb.getAttribute('data-gap-id');
    var wantDone = cb.checked;

    if (!wantDone) {
      // Revert objective vector when unchecking manual gap completion
      var gap = (tree.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
      if (gap && gap.dimIndex != null) {
        revertStep({
          stepId: 'manual-' + gapId,
          waypointId: tree.focusTracker.waypointId,
          gapLabel: gap.label,
          dimIndex: gap.dimIndex,
          currentValue: gap.user || 0,
          boost: 8,
        }).then(function (result) {
          if (result && result.objectivePatched) {
            console.log('[SGT] Objective vector reverted from manual gap uncheck:', result.objectiveVector ? 'yes' : 'no');
          }
        }).catch(function () { /* ignore */ });
      }

      if (ctx.maybeAdvanceOnComplete) {
        ctx.maybeAdvanceOnComplete(toggleGapManualComplete(tree, gapId, false));
      } else {
        ctx.onPersist(toggleGapManualComplete(tree, gapId, false));
      }
      return;
    }

    cb.checked = false;
    requestStepToggleConfirm({
      onConfirm: function () {
        var latest = ctx.getTree();
        var updated = toggleGapManualComplete(latest, gapId, true);

        // Update objective vector for manual gap completion
        var gap = (latest.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
        if (gap && gap.dimIndex != null) {
          completeStep({
            stepId: 'manual-' + gapId,
            waypointId: latest.focusTracker.waypointId,
            gapLabel: gap.label,
            dimIndex: gap.dimIndex,
            currentValue: gap.user || 0,
            boost: 8, // Manual completion gets a bigger boost
          }).then(function (result) {
            if (result && result.objectivePatched) {
              console.log('[SGT] Objective vector updated from manual gap completion:', result.objectiveVector ? 'yes' : 'no');
            }
          }).catch(function () { /* ignore */ });
        }

        if (ctx.maybeAdvanceOnComplete) {
          ctx.maybeAdvanceOnComplete(updated);
        } else {
          ctx.onPersist(updated);
        }
      },
      onCancel: function () {
        cb.checked = false;
      },
    });
  }

  // Checklist items toggle instantly (no confirm) — only closing the whole gap
  // via manualComplete needs the confirm modal.
  function handleChecklistCheckboxChange(cb, ctx) {
    if (!cb || !ctx || !ctx.getTree || !ctx.onPersist) return;
    var tree = ctx.getTree();
    if (!tree || !tree.focusTracker) return;
    var gapId = cb.getAttribute('data-gap-id');
    var itemId = cb.getAttribute('data-item-id');
    var wantDone = cb.checked;
    var updated = toggleChecklistItem(tree, gapId, itemId, wantDone);
    ctx.onPersist(updated);

    // When checking a checklist item, update objective vector
    if (wantDone) {
      // Find the gap to get dimIndex and current value
      var gap = (tree.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
      if (gap && gap.dimIndex != null) {
        completeStep({
          stepId: itemId,
          waypointId: tree.focusTracker.waypointId,
          gapLabel: gap.label,
          dimIndex: gap.dimIndex,
          currentValue: gap.user || 0,
          boost: 6,
        }).then(function (result) {
          if (result && result.objectivePatched && ctx.onPersist) {
            // The server already saved the quiz profile, but we might need to
            // refresh the local quiz blob. For now, just log.
            console.log('[SGT] Objective vector updated from checklist:', result.objectiveVector ? 'yes' : 'no');
          }
        }).catch(function () { /* ignore */ });
      }
    } else {
      // When unchecking a checklist item, revert objective vector
      var gap = (tree.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
      if (gap && gap.dimIndex != null) {
        revertStep({
          stepId: itemId,
          waypointId: tree.focusTracker.waypointId,
          gapLabel: gap.label,
          dimIndex: gap.dimIndex,
          currentValue: gap.user || 0,
          boost: 6,
        }).then(function (result) {
          if (result && result.objectivePatched) {
            console.log('[SGT] Objective vector reverted from checklist:', result.objectiveVector ? 'yes' : 'no');
          }
        }).catch(function () { /* ignore */ });
      }
    }
  }

  function resolveLogGapId(row) {
    if (!row) return '';
    var select = row.querySelector('.sgt-log-gap-select');
    if (select && select.value) return select.value;
    return row.getAttribute('data-gap-id') || '';
  }

  function gapLabelsFromTracker(tree) {
    if (!tree || !tree.focusTracker || !tree.focusTracker.skillGaps) return [];
    return tree.focusTracker.skillGaps.map(function (g) { return g.label; }).filter(Boolean);
  }

  function summaryForCoach(tree) {
    if (!tree || !tree.focusTracker) return '';
    const wp = waypointById(tree, tree.focusTracker.waypointId);
    const lines = [];
    lines.push('Waypoint: ' + (wp ? (wp.title || wp.shortTitle || tree.focusTracker.waypointId) : tree.focusTracker.waypointId));
    (tree.focusTracker.skillGaps || []).forEach(function (g) {
      lines.push('- ' + displayGapLabel(g.label) + ' (' + (g.progress || 0) + '%, ' + g.status + ')');
    });
    const recent = [];
    (tree.focusTracker.skillGaps || []).forEach(function (g) {
      (g.logs || []).slice(0, 2).forEach(function (l) {
        recent.push(displayGapLabel(g.label) + ': ' + l.text);
      });
    });
    if (recent.length) {
      lines.push('Recent progress logs:');
      recent.slice(0, 5).forEach(function (r) { lines.push('- ' + r); });
    }
    return lines.join('\n');
  }

  function statusLabel(gap) {
    const progress = (gap && gap.progress) || 0;
    if (progress >= 100 || (gap && gap.status === 'closed')) return 'Closed';
    if (progress > 0) return progress + '% closed';
    return 'Open';
  }

  const DOMAIN_LABELS = {
    skills: 'Skill',
    knowledge: 'Knowledge',
    abilities: 'Ability',
    workActivities: 'Work activity',
  };

  function domainLabel(domain) {
    return DOMAIN_LABELS[domain] || 'Dimension';
  }

  // v3 coordinate-delta gap card: domain chip, You→Target paired mini-bars
  // (matching the app's "You / Role" bar language), ordered checklist with
  // checkboxes, and a checklistProgress bar. Largest gap renders first (sorted by
  // caller) so the user attacks in priority order.
  function renderV3GapCard(g, opts, index) {
    const compact = opts && opts.compact;
    const status = g.status || 'open';
    const primary = index === 0 ? ' sgt-gap--primary' : '';
    const userPct = Math.max(0, Math.min(100, g.user || 0));
    const targetPct = Math.max(0, Math.min(100, g.target || 0));
    const barsHtml = '<div class="sgt-cmp-bars">'
      + '<div class="sgt-cmp-line">'
      + '<span class="sgt-cmp-tag">You</span>'
      + '<div class="sgt-cmp-track"><div class="sgt-cmp-fill sgt-cmp-fill--you" style="width:' + userPct + '%"></div></div>'
      + '<span class="sgt-cmp-val">' + userPct + '</span>'
      + '</div>'
      + '<div class="sgt-cmp-line">'
      + '<span class="sgt-cmp-tag">Target</span>'
      + '<div class="sgt-cmp-track"><div class="sgt-cmp-fill sgt-cmp-fill--target" style="width:' + targetPct + '%"></div></div>'
      + '<span class="sgt-cmp-val">' + targetPct + '</span>'
      + '</div>'
      + '</div>';
    const items = (g.checklist || []);
    const checklistHtml = items.length
      ? '<ul class="sgt-checklist">' + items.map(function (c) {
        return '<li class="sgt-checklist-item">'
          + '<label><input type="checkbox" class="sgt-checklist-check" data-gap-id="' + escAttr(g.id) + '" data-item-id="' + escAttr(c.id) + '"' + (c.done ? ' checked' : '') + '>'
          + '<span>' + esc(c.text) + '</span></label>'
          + '</li>';
      }).join('') + '</ul>'
      : '';
    const logs = compact ? (g.logs || []).slice(0, 1) : (g.logs || []).slice(0, 3);
    const logHtml = logs.length
      ? '<ul class="sgt-logs">' + logs.map(function (l, li) {
        const logId = l.id || ('log-legacy-' + g.id + '-' + li);
        return '<li class="sgt-log-item" data-log-id="' + escAttr(logId) + '">'
          + '<span class="sgt-log-text">' + esc(l.text) + '</span>'
          + '<button type="button" class="sgt-log-remove" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" aria-label="Remove note">×</button>'
          + '</li>';
      }).join('') + '</ul>'
      : '';
    const manualHtml = compact ? '' : '<label class="sgt-gap-manual">'
      + '<input type="checkbox" class="sgt-gap-check" data-gap-id="' + escAttr(g.id) + '"'
      + (g.manualComplete ? ' checked' : '') + '>'
      + '<span>Mark complete</span></label>';
    return '<div class="sgt-gap sgt-gap--coord' + primary + '" data-gap-id="' + escAttr(g.id) + '">'
      + '<div class="sgt-gap-head">'
      + '<span class="sgt-gap-label">' + esc(displayGapLabel(g.label)) + '</span>'
      + '<span class="sgt-gap-status sgt-gap-status--' + esc(status) + '">' + esc(statusLabel(g)) + '</span>'
      + '</div>'
      + '<span class="sgt-gap-domain">' + esc(domainLabel(g.domain)) + '</span>'
      + barsHtml
      + '<div class="sgt-bar-wrap"><div class="sgt-bar" style="width:' + (g.progress || 0) + '%"></div></div>'
      + '<div class="sgt-gap-meta">' + (g.progress || 0) + '% · gap of ' + (g.gap || 0) + '</div>'
      + (compact ? '' : checklistHtml)
      + manualHtml
      + logHtml
      + '</div>';
  }

  function renderGapRows(skillGaps, opts) {
    const compact = opts && opts.compact;
    if ((skillGaps || []).some(function (g) { return g && g.source === COORDINATE_SOURCE; })) {
      return (skillGaps || []).map(function (g, i) {
        if (g && g.source === COORDINATE_SOURCE) return renderV3GapCard(g, opts, i);
        return '';
      }).join('');
    }
    return (skillGaps || []).map(function (g) {
      const logs = compact ? (g.logs || []).slice(0, 1) : (g.logs || []).slice(0, 3);
      const logHtml = logs.length
        ? '<ul class="sgt-logs">' + logs.map(function (l, li) {
          const logId = l.id || ('log-legacy-' + g.id + '-' + li);
          return '<li class="sgt-log-item" data-log-id="' + escAttr(logId) + '">'
            + '<span class="sgt-log-text">' + esc(l.text) + '</span>'
            + '<button type="button" class="sgt-log-remove" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" aria-label="Remove log">×</button>'
            + '</li>';
        }).join('') + '</ul>'
        : '';
      const status = g.status || 'open';
      return '<div class="sgt-gap" data-gap-id="' + escAttr(g.id) + '">'
        + '<div class="sgt-gap-head">'
        + '<span class="sgt-gap-label">' + esc(displayGapLabel(g.label)) + '</span>'
        + '<span class="sgt-gap-status sgt-gap-status--' + esc(status) + '">' + esc(statusLabel(g)) + '</span>'
        + '</div>'
        + '<div class="sgt-bar-wrap"><div class="sgt-bar" style="width:' + (g.progress || 0) + '%"></div></div>'
        + '<div class="sgt-gap-meta">' + (g.progress || 0) + '% · ' + ((g.linkedStepIds || []).length) + ' linked steps</div>'
        + logHtml
        + '</div>';
    }).join('');
  }

  function renderStepPreview(waypoint, skillGaps, editable, opts) {
    const wp = waypoint || {};
    const steps = (wp.steps || []).slice(0, editable ? 99 : 3);
    const gaps = skillGaps || [];
    // Coordinate (v3) gaps already carry their own "Mark complete" toggle inside
    // their gap card once it's rendered in full (non-compact) form — skip the
    // redundant orphan row here so the same control doesn't appear twice.
    const skipV3Orphans = !(opts && opts.compact);
    const orphanGaps = gaps.filter(function (g) {
      if ((g.linkedStepIds || []).length) return false;
      if (skipV3Orphans && g.source === COORDINATE_SOURCE) return false;
      return true;
    });
    if (!steps.length && !orphanGaps.length) return '';
    const gapByStep = {};
    gaps.forEach(function (g) {
      (g.linkedStepIds || []).forEach(function (sid) { gapByStep[sid] = displayGapLabel(g.label); });
    });
    const stepRows = steps.map(function (s) {
      return '<li class="sgt-step">'
        + '<label><input type="checkbox" class="sgt-step-check" data-step-id="' + escAttr(s.id) + '"' + (s.done ? ' checked' : '') + '>'
        + '<span>' + esc(s.text) + '</span></label>'
        + (gapByStep[s.id] ? '<span class="sgt-step-gap">' + esc(gapByStep[s.id]) + '</span>' : '')
        + '</li>';
    }).join('');
    const orphanRows = orphanGaps.map(function (g) {
      const label = displayGapLabel(g.label);
      return '<li class="sgt-step sgt-step--gap-only">'
        + '<label><input type="checkbox" class="sgt-gap-check" data-gap-id="' + escAttr(g.id) + '"'
        + (g.manualComplete ? ' checked' : '') + '>'
        + '<span>Mark ' + esc(label) + ' complete</span></label>'
        + '</li>';
    }).join('');
    return '<ul class="sgt-steps">' + stepRows + orphanRows + '</ul>';
  }

  function renderHomeLogControls(gaps) {
    if (!gaps || !gaps.length) return '';
    const options = gaps.map(function (g, i) {
      return '<option value="' + escAttr(g.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(displayGapLabel(g.label)) + '</option>';
    }).join('');
    return '<div class="sgt-log-row sgt-log-row--compact sgt-log-row--home" data-gap-id="' + escAttr(gaps[0].id) + '">'
      + '<label class="sgt-log-field-label" for="sgt-log-gap-select">Log for</label>'
      + '<select class="sgt-log-gap-select" id="sgt-log-gap-select" aria-label="Skill gap">' + options + '</select>'
      + '<div class="sgt-log-input-row">'
      + '<input type="text" class="sgt-log-input" placeholder="Log progress…" maxlength="280" aria-label="Log progress">'
      + '<button type="button" class="sgt-log-add">Log</button>'
      + '</div></div>';
  }

  function renderLogControls(gapId, opts) {
    const compact = opts && opts.compact;
    const presets = compact ? '' : PRESET_LOGS.map(function (p) {
      return '<button type="button" class="sgt-log-preset" data-gap-id="' + escAttr(gapId) + '" data-log-text="' + escAttr(p) + '">' + esc(p) + '</button>';
    }).join('');
    return '<div class="sgt-log-row' + (compact ? ' sgt-log-row--compact' : '') + '" data-gap-id="' + escAttr(gapId) + '">'
      + presets
      + '<input type="text" class="sgt-log-input" placeholder="Log progress…" data-gap-id="' + escAttr(gapId) + '" maxlength="280">'
      + '<button type="button" class="sgt-log-add" data-gap-id="' + escAttr(gapId) + '">Log</button>'
      + '</div>';
  }

  function bindTrackerEvents(root, opts) {
    if (!root) return;
    opts = opts || {};
    const onPersist = opts.onPersist;
    const getTree = opts.getTree;
    const tree = opts.tree;
    const waypointId = opts.waypointId;

    function currentTree() {
      if (getTree) return getTree();
      return tree;
    }

    const persistCtx = {
      getTree: currentTree,
      onPersist: onPersist,
      maybeAdvanceOnComplete: opts.maybeAdvanceOnComplete,
      runAdvance: opts.runAdvance,
      // Effective waypoint the panel is showing — on a secondary branch this is
      // the branch's waypoint, not the main pinned focusTracker.waypointId.
      waypointId: waypointId,
    };

    root.querySelectorAll('.sgt-step-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (waypointId && onPersist) {
          handleStepCheckboxChange(cb, persistCtx);
          return;
        }
        if (opts.onToggleStep) opts.onToggleStep(cb.getAttribute('data-step-id'));
      });
    });

    root.querySelectorAll('.sgt-gap-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (onPersist) handleGapCheckboxChange(cb, persistCtx);
      });
    });

    root.querySelectorAll('.sgt-checklist-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (onPersist) handleChecklistCheckboxChange(cb, persistCtx);
      });
    });

    root.querySelectorAll('.sgt-log-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const t = currentTree();
        const gapId = btn.getAttribute('data-gap-id');
        const logId = btn.getAttribute('data-log-id');
        if (!onPersist || !t || !gapId || !logId) return;
        onPersist(removeLog(t, gapId, logId));
      });
    });

    function persistWithLog(gapId, text) {
      const t = currentTree();
      if (!onPersist || !t || !gapId) return;
      onPersist(persistLog(t, gapId, text));
    }

    root.querySelectorAll('.sgt-log-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        persistWithLog(btn.getAttribute('data-gap-id'), btn.getAttribute('data-log-text'));
      });
    });

    root.querySelectorAll('.sgt-log-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const row = btn.closest('.sgt-log-row');
        const gapId = resolveLogGapId(row) || btn.getAttribute('data-gap-id');
        const input = row ? row.querySelector('.sgt-log-input') : null;
        const text = input ? input.value : '';
        if (!String(text || '').trim()) return;
        persistWithLog(gapId, text);
        if (input) input.value = '';
      });
    });

    root.querySelectorAll('.sgt-log-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const row = input.closest('.sgt-log-row');
        const gapId = resolveLogGapId(row) || input.getAttribute('data-gap-id');
        const text = input.value;
        if (!String(text || '').trim()) return;
        persistWithLog(gapId, text);
        input.value = '';
      });
    });
  }

  function renderHomePanel(el, tree, opts) {
    if (!el) return;
    opts = opts || {};
    if (!tree || tree.version !== 2 || !tree.focusTracker) {
      el.innerHTML = '<p class="sgt-empty">Build your career roadmap to unlock your current focus tracker.</p>';
      return;
    }
    const wp = waypointById(tree, tree.focusTracker.waypointId);
    const targetName = tree.targetCareerName || 'your target career';
    const wpTitle = wp ? (wp.shortTitle || wp.title || 'Current waypoint') : 'Current waypoint';
    const gaps = tree.focusTracker.skillGaps || [];

    // Render branch switcher if there are tracked secondary branches
    const switcherHtml = branchSwitcherHtml(tree);
    const hasBranchFocus = !!switcherHtml;

    el.innerHTML = ''
      + '<div class="sgt-home-head">'
      + '<p class="sgt-eyebrow">' + esc(targetName) + ' · ' + esc(wpTitle) + '</p>'
      + '<p class="sgt-home-sub">Micro-steps for your immediate waypoint — your long-term plan lives on the roadmap.</p>'
      + '</div>'
      + (hasBranchFocus
        ? '<div class="sgt-home-branch-note">Access branch focus menus from the <strong>Career Roadmap</strong> — click a branch waypoint to open its focus.</div>'
        : '')
      + switcherHtml
      + '<div class="sgt-gaps">' + renderGapRows(gaps, { compact: true }) + '</div>'
      + renderStepPreview(wp, gaps, true, { compact: true })
      + renderHomeLogControls(gaps)
      + '<div class="sgt-home-actions">'
      + '<button type="button" class="cta-btn sgt-open-focus">Open focus view</button>'
      + '<button type="button" class="cta-btn cta-btn-outline sgt-ask-marco">Ask Marco</button>'
      + '</div>';
  }

  // Compact branch switcher (WS6): chips for Main path + any tracked secondary
  // branch. Clicking a chip switches which branch's next-undone waypoint drives
  // the focused card. Rendered only when a secondary branch is actually tracked.
  function branchSwitcherHtml(tree) {
    var ft = tree && tree.focusTracker;
    var focuses = (ft && ft.branchFocuses) || [];
    if (!focuses.length) return '';
    var active = activeBranchKey(tree);
    var chips = [{ key: 'spine', label: 'Main path' }];
    focuses.forEach(function (b) {
      if (b.branchKey === 'spine') return;
      var root = waypointById(tree, b.branchKey);
      var label = root ? (root.shortTitle || root.title || 'Branch') : 'Branch';
      chips.push({ key: b.branchKey, label: label });
    });
    if (chips.length < 2) return '';
    return '<div class="sgt-branch-switcher" role="tablist" aria-label="Tracked branches">'
      + chips.map(function (c) {
        var on = c.key === active ? ' sgt-branch-chip--on' : '';
        return '<button type="button" class="sgt-branch-chip' + on + '" role="tab"'
          + ' aria-selected="' + (c.key === active ? 'true' : 'false') + '"'
          + ' data-branch-key="' + escAttr(c.key) + '">' + esc(c.label) + '</button>';
      }).join('')
      + '</div>';
  }

  function renderFocusView(el, tree, waypoint, opts) {
    if (!el) return;
    opts = opts || {};
    const activeKey = activeBranchKey(tree);
    // Branch-aware focus: on a secondary branch the card follows that branch's
    // next-undone waypoint, not the main pinned one.
    const branchWp = activeKey !== 'spine' ? immediateWaypointForBranch(tree, activeKey) : null;
    const wp = branchWp || waypoint || waypointById(tree, tree.focusTracker && tree.focusTracker.waypointId);
    const gaps = (tree.focusTracker && tree.focusTracker.skillGaps) || [];
    const editable = !!(opts.editable && wp);
    const switcherHtml = branchSwitcherHtml(tree);

    const logsHtml = gaps.length
      ? '<h3 class="sgt-section-title">Log progress</h3>'
        + gaps.map(function (g) {
          return '<div class="sgt-log-block"><span class="sgt-log-gap-label">' + esc(displayGapLabel(g.label)) + '</span>' + renderLogControls(g.id) + '</div>';
        }).join('')
      : '';

    el.innerHTML = ''
      + '<div class="roadmap-focus-inner">'
      + '<div class="sgt-focus-head">'
      + '<button type="button" class="sgt-back-map">← Back to map</button>'
      + switcherHtml
      + '<p class="sgt-eyebrow">Current focus</p>'
      + '<h2 class="sgt-focus-title">' + esc(wp ? (wp.title || wp.shortTitle) : 'Your focus') + '</h2>'
      + (wp && wp.whyItMatters ? '<p class="sgt-focus-why">' + esc(wp.whyItMatters) + '</p>' : '')
      + '</div>'
      + '<div class="sgt-focus-layout">'
      + '<div class="sgt-focus-col sgt-focus-col--gaps">'
      + '<div class="sgt-gaps">' + renderGapRows(gaps, { compact: false }) + '</div>'
      + '</div>'
      + '<div class="sgt-focus-col sgt-focus-col--steps">'
      + '<h3 class="sgt-section-title">Waypoint steps</h3>'
      + (renderStepPreview(wp, gaps, editable) || '<p class="sgt-empty">No waypoint steps yet — track progress with the checklist and notes on the left.</p>')
      + logsHtml
      + '</div>'
      + '</div>'
      + '</div>';

    const back = el.querySelector('.sgt-back-map');
    if (back && opts.onBack) back.addEventListener('click', opts.onBack);

    el.querySelectorAll('.sgt-branch-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const key = chip.getAttribute('data-branch-key');
        const getTree = opts.getTree || function () { return tree; };
        const cur = getTree();
        if (activeBranchKey(cur) === key) return;
        const updated = setActiveBranchKey(cur, key);
        if (opts.onPersist) opts.onPersist(updated);
      });
    });

    bindTrackerEvents(el, {
      getTree: opts.getTree || function () { return tree; },
      tree: tree,
      waypointId: wp ? wp.id : '',
      onPersist: opts.onPersist,
      maybeAdvanceOnComplete: opts.maybeAdvanceOnComplete,
      runAdvance: opts.runAdvance,
    });

    // Live coordinate recompute + AI checklist upgrade. Runs off the render path
    // so a slow vector fetch never blocks the panel. Persists via onPersist, which
    // re-renders through the panel controller.
    if (opts.onPersist && global.FWOnetVectors
      && typeof FWOnetVectors.objectiveVsCareerDimensions === 'function') {
      const getTree = opts.getTree || function () { return tree; };
      // onPersist carrying getTree lets requestAiChecklists read the freshest tree
      // when its network response lands, avoiding a stale-overwrite race.
      const persist = function (t) { opts.onPersist(t); };
      persist.getTree = getTree;

      const upgradeChecklists = function () {
        const cur = getTree();
        if (isV3Tracker(cur.focusTracker)) requestAiChecklists(cur, persist);
      };
      const needsRecompute = !isV3Tracker(tree.focusTracker)
        || (tree.focusTracker && tree.focusTracker.needsRecompute);

      if (needsRecompute) {
        recomputeCoordinateGaps(getTree(), {}).then(function (updated) {
          if (updated && isV3Tracker(updated.focusTracker) && updated !== getTree()) {
            persist(updated);
          }
          upgradeChecklists();
        });
      } else {
        upgradeChecklists();
      }
    }
  }

  global.FWSkillGapTracker = {
    PRESET_LOGS: PRESET_LOGS,
    KEYWORD_PROGRESS_PER_MATCH: KEYWORD_PROGRESS_PER_MATCH,
    ensureFocusTracker: ensureFocusTracker,
    advanceFocusWaypoint: advanceFocusWaypoint,
    resetFocusTrackerForWaypoint: resetFocusTrackerForWaypoint,
    syncProgress: syncProgress,
    appendLog: appendLog,
    persistLog: persistLog,
    removeLog: removeLog,
    toggleWaypointStep: toggleWaypointStep,
    toggleGapManualComplete: toggleGapManualComplete,
    toggleChecklistItem: toggleChecklistItem,
    recomputeCoordinateGaps: recomputeCoordinateGaps,
    requestAiChecklists: requestAiChecklists,
    handleStepCheckboxChange: handleStepCheckboxChange,
    handleGapCheckboxChange: handleGapCheckboxChange,
    handleChecklistCheckboxChange: handleChecklistCheckboxChange,
    requestStepToggleConfirm: requestStepToggleConfirm,
    resolveLogGapId: resolveLogGapId,
    buildFallbackKeywords: buildFallbackKeywords,
    gapLabelsFromTracker: gapLabelsFromTracker,
    summaryForCoach: summaryForCoach,
    deriveGapEntries: deriveGapEntries,
    isWaypointStepsComplete: isWaypointStepsComplete,
    shouldAdvanceFocus: shouldAdvanceFocus,
    maybeAdvanceOnComplete: maybeAdvanceOnComplete,
    runFocusAdvance: runFocusAdvance,
    renderHomePanel: renderHomePanel,
    renderFocusView: renderFocusView,
    trackBranchFocus: trackBranchFocus,
    setActiveBranchKey: setActiveBranchKey,
    activeBranchKey: activeBranchKey,
    branchFocusWaypoint: branchFocusWaypoint,
    immediateWaypointForBranch: immediateWaypointForBranch,
    branchKeyForNode: branchKeyForNode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
