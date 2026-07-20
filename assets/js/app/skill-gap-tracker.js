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

  // ---- Evidence rules engine -------------------------------------------
  // Typed progress logs earn a bounded contribution toward closing the gap:
  // +2% base, +2% per gap keyword the note matches, +3% for artifact language
  // (built/shipped/scored/…), +1% for substantive length — capped at 12% per
  // log and 30% total per gap. The weight is computed ONCE when the log is
  // added and stored on the log (l.w), so recomputes never re-judge old notes.
  var ARTIFACT_RE = /\b(built|build|shipped|completed?|finished|published|presented|won|scored|passed|submitted|deployed|wrote|created|led|taught|intern(ed|ship)?|certificat\w*|competition|project|repo|portfolio)\b/i;

  function logEvidenceWeight(text, kwDelta) {
    var w = 2 + 2 * Math.max(0, kwDelta || 0);
    var t = String(text || '').trim();
    if (ARTIFACT_RE.test(t)) w += 3;
    if (t.length >= 80) w += 1;
    return Math.max(2, Math.min(12, w));
  }

  function gapEvidencePct(gap) {
    var logs = (gap && gap.logs) || [];
    if (!logs.length) return 0;
    var sum = 0;
    logs.forEach(function (l) { sum += (l && Number(l.w)) || 2; });
    return Math.min(30, Math.round(sum));
  }

  function syncV3Progress(gap) {
    var cl = checklistProgress(gap);
    var ev = gapEvidencePct(gap);
    var manual = gap.manualComplete ? 100 : 0;
    var progress = Math.min(100, Math.max(Math.min(100, cl + ev), manual));
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
      // Immutable first-seen user value — base for gap-progress vector patches.
      // Never refreshed on recompute (the live user value already includes the
      // patches, so re-basing on it would compound them).
      vBase: item.user,
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
        vBase: prev.vBase != null ? prev.vBase : prev.user,
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

  // A pin only holds within the active branch — a stale pin left from another
  // branch would lock the focus card off-path after a switch. Strict equality:
  // even a committed branch's nodes are NOT main-path pins, or "Main path"
  // could never leave a committed branch's waypoint.
  function pinMatchesActiveBranch(tree, pinned) {
    return branchKeyForNode(tree, pinned.id) === activeBranchKey(tree);
  }

  function branchFocusWaypoint(tree) {
    var key = activeBranchKey(tree);
    if (key === 'spine') {
      var ft = tree && tree.focusTracker;
      if (ft && ft.waypointId) {
        var pinned = waypointById(tree, ft.waypointId);
        if (pinned && pinMatchesActiveBranch(tree, pinned)) return pinned;
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
    // Re-pin to the target branch's own next waypoint — carrying the old pin
    // across a switch is what left the focus card stuck on the prior branch.
    var next = key === 'spine' ? nextWaypoint(tree) : immediateWaypointForBranch(tree, key);
    return Object.assign({}, tree, {
      focusTracker: Object.assign({}, tree.focusTracker, {
        activeBranchKey: key,
        waypointId: next ? next.id : tree.focusTracker.waypointId,
        needsRecompute: true,
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
      if (pinned && pinMatchesActiveBranch(tree, pinned)) return pinned;
    }
    // Use branch-aware focus waypoint (respects activeBranchKey)
    return branchFocusWaypoint(tree);
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
    const wp = waypoint || nextWaypoint(tree);
    // PRIORITY 1: Waypoint-specific addressedGaps (most relevant to this waypoint)
    if (wp && wp.addressedGaps) {
      wp.addressedGaps.slice(0, 4).forEach(function (g) { add(g, 'waypoint'); });
    }
    // PRIORITY 2: Branch-specific vector gaps (if this waypoint is on a branch, filter by branch)
    // For now, use global vector gaps but limit to make room for waypoint gaps
    const vectorGapNames = (fit.vectorGaps || []).map(g => g.name || g.label).filter(Boolean);
    vectorGapNames.slice(0, 4).forEach(function (g) { add(g, 'vector'); });
    // PRIORITY 3: Global top gaps (quiz-based)
    (fit.topGaps || []).slice(0, 4).forEach(function (g) { add(g, fit.vectorGaps && fit.vectorGaps.length ? 'vector' : 'quiz'); });
    // PRIORITY 4: Quiz fit breakdown gaps
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
      const branchChanged = !!(opts && opts.branchChanged);
      const advancedOrChanged = (opts && opts.advance) || existing.waypointId !== wp.id || branchChanged;
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
    const branchChanged = !!(opts && opts.branchChanged);
    const waypointChanged = !existing || existing.waypointId !== wp.id || branchChanged;
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
    const wp = waypointById(tree, tree.focusTracker.waypointId) || branchFocusWaypoint(tree);
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
      const kwBefore = (g.matchedKeywords || []).length;
      const withKw = applyLogKeywords(g, text, wp);
      const kwDelta = (withKw.matchedKeywords || []).length - kwBefore;
      // Stamp the just-added log (index 0 — appendLog unshifts) with its weight.
      const logs = (withKw.logs || []).map(function (l, i) {
        return i === 0 ? Object.assign({}, l, { w: logEvidenceWeight(text, kwDelta) }) : l;
      });
      return Object.assign({}, withKw, { logs: logs });
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

  // Report a gap's FULL checklist state to the server, which sets the dimension
  // to an absolute value computed from the gap's immutable vBase — idempotent
  // and order-independent, so check/uncheck in any order can never compound.
  // On success the local quiz blob absorbs the new vector + replayable patch so
  // the UI (and the next hydration) reflect it immediately.
  function sendGapProgress(gap, opts) {
    if (!gap || gap.dimIndex == null) return Promise.resolve(null);
    var checklist = gap.checklist || [];
    var doneCount = checklist.filter(function (c) { return c && c.done; }).length;
    var body = {
      action: 'gap-progress',
      dimIndex: gap.dimIndex,
      gapLabel: gap.label,
      base: gap.vBase != null ? gap.vBase : (gap.user || 0),
      target: gap.target || 0,
      doneCount: doneCount,
      totalCount: Math.max(1, checklist.length),
      manualComplete: !!gap.manualComplete,
      evidencePct: gapEvidencePct(gap),
    };
    return fetch('/career-roadmap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (result) {
      if (!result || !result.objectivePatched) return null;
      if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function' && typeof FWAuth.writeLocalQuiz === 'function') {
        var quiz = FWAuth.readLocalQuiz();
        if (quiz) {
          if (result.objectiveVector) quiz.objectiveVector = result.objectiveVector;
          if (result.objectiveAiPatch) quiz.objectiveAiPatch = result.objectiveAiPatch;
          quiz.objectiveSkipped = false;
          FWAuth.writeLocalQuiz(quiz);
        }
      }
      var from = Math.round(gap.user || 0);
      var delta = Math.round(result.value) - from;
      if (delta !== 0) {
        if (opts && typeof opts.onVectorChange === 'function') {
          opts.onVectorChange({ label: gap.label, delta: delta, value: result.value });
        } else if (global.FWFwToast && typeof FWFwToast.show === 'function') {
          FWFwToast.show((delta > 0 ? '+' : '') + delta + ' ' + displayGapLabel(gap.label) + ' — progress saved');
        }
      }
      return result;
    }).catch(function () { return null; });
  }

  // After any log change on a v3 coordinate gap, resend its full absolute state
  // to gap-progress so the objective vector moves (portal + focus share this).
  function syncGapVectorAfterLogChange(updatedTree, gapId, opts) {
    opts = opts || {};
    const gap = ((updatedTree && updatedTree.focusTracker || {}).skillGaps || [])
      .find(function (g) { return g && g.id === gapId; });
    if (gap && gap.dimIndex != null) {
      sendGapProgress(gap, { onVectorChange: opts.onVectorChange });
    }
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
          // Rebuild must not drop branch-focus fields — losing activeBranchKey
          // here silently kicks the user off their tracked branch.
          focusTracker: Object.assign({
            version: V3_VERSION,
            waypointId: wp.id,
            skillGaps: merged,
          }, branchFocusFields(tree, tree.focusTracker), {
            updatedAt: new Date().toISOString(),
          }),
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
    if (!gaps.length) return;
    var soc = tree.fitContext && tree.fitContext.targetSoc;
    if (!soc) {
      // Older roadmaps lack fitContext.targetSoc — resolve it instead of
      // silently never upgrading past the generic fast ladders.
      resolveTargetSocForTree(tree).then(function (resolved) {
        if (!resolved) return;
        var patched = Object.assign({}, tree, {
          fitContext: Object.assign({}, tree.fitContext || {}, { targetSoc: resolved }),
        });
        requestAiChecklists(patched, onPersist);
      });
      return;
    }
    var sig = 'sgt-aichk:' + gapSetSignature(tree);
    try {
      if (sessionStorage.getItem(sig)) return;
    } catch (_) { /* sessionStorage unavailable — proceed once */ }
    if (requestAiChecklists._inflight === sig) return;
    requestAiChecklists._inflight = sig;

    // Completed checklist items feed the server's "compounding" plan: the next
    // AI plan picks up where the user left off. Capped for a compact payload.
    var payloadGaps = gaps.slice(0, MAX_V3_GAPS).map(function (g) {
      var doneItems = (g.checklist || [])
        .filter(function (c) { return c && c.done; })
        .map(function (c) { return String(c.text || '').slice(0, 90); })
        .slice(0, 6);
      return {
        dimIndex: g.dimIndex,
        name: g.label,
        domain: g.domain,
        user: g.user,
        target: g.target,
        progress: g.progress || 0,
        doneItems: doneItems,
      };
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
      if (requestAiChecklists._inflight === sig) requestAiChecklists._inflight = null;
      var checklists = data && data.checklists;
      if (!checklists) return;
      var latest = typeof onPersist === 'function' && onPersist.getTree ? onPersist.getTree() : tree;
      var current = latest && isV3Tracker(latest.focusTracker) ? latest : tree;
      var changed = false;
      var missedAny = false;
      var skillGaps = (current.focusTracker.skillGaps || []).map(function (g) {
        if (g.checklistSource === 'ai') return g;
        var actions = checklists[g.dimIndex] || checklists[String(g.dimIndex)];
        if (!actions || !actions.length) { missedAny = true; return g; }
        changed = true;
        // Keep items the user already checked (their progress is real) and
        // fill the rest of the ladder with the specific AI actions — a gap
        // with any done item used to be skipped entirely, freezing it on the
        // generic fast ladder for good.
        var doneItems = (g.checklist || []).filter(function (c) { return c && c.done; });
        var doneTexts = {};
        doneItems.forEach(function (c) { doneTexts[String(c.text || '').toLowerCase()] = 1; });
        // 'a' id prefix: kept done items retain their fast 'c' ids, so AI ids
        // must not collide with them (toggle targets items by id).
        var aiItems = actions.slice(0, 6).map(function (a, i) {
          return { id: 'dim-' + g.dimIndex + '-a' + (i + 1), text: String(a.text || a).slice(0, 90), done: false };
        }).filter(function (c) { return !doneTexts[String(c.text).toLowerCase()]; });
        return syncV3Progress(Object.assign({}, g, {
          checklist: doneItems.concat(aiItems).slice(0, 6),
          checklistSource: 'ai',
        }));
      });
      // Stamp only on full coverage — a partial response (rate limit, model
      // hiccup) must not freeze the missed gaps on generic ladders all session.
      if (!missedAny) {
        try { sessionStorage.setItem(sig, '1'); } catch (_) { /* ignore */ }
      }
      if (!changed) return;
      var updated = Object.assign({}, current, {
        focusTracker: Object.assign({}, current.focusTracker, {
          skillGaps: skillGaps,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (typeof onPersist === 'function') onPersist(updated);
    }).catch(function () {
      if (requestAiChecklists._inflight === sig) requestAiChecklists._inflight = null;
      /* AI upgrade is best-effort */
    });
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
    try { yesBtn.focus({ preventScroll: true }); } catch (e) { yesBtn.focus(); }

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
    // No confirm friction and no per-step vector calls: the server recomputes
    // gap progress from FULL step state on every roadmap save (absolute values
    // from each gap's vBase), so toggling either way is exact and reversible.
    var updated = toggleWaypointStep(tree, wpId, stepId, wantDone);
    if (ctx.maybeAdvanceOnComplete) {
      ctx.maybeAdvanceOnComplete(updated);
    } else {
      ctx.onPersist(updated);
    }
  }

  function handleGapCheckboxChange(cb, ctx) {
    if (!cb || !ctx || !ctx.getTree || !ctx.onPersist) return;
    var tree = ctx.getTree();
    if (!tree || !tree.focusTracker) return;
    var gapId = cb.getAttribute('data-gap-id');
    var wantDone = cb.checked;

    if (!wantDone) {
      var reverted = toggleGapManualComplete(tree, gapId, false);
      var revGap = (reverted.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
      if (revGap && revGap.dimIndex != null) {
        sendGapProgress(revGap, { onVectorChange: ctx.onVectorChange });
      }
      if (ctx.maybeAdvanceOnComplete) {
        ctx.maybeAdvanceOnComplete(reverted);
      } else {
        ctx.onPersist(reverted);
      }
      return;
    }

    cb.checked = false;
    requestStepToggleConfirm({
      onConfirm: function () {
        var latest = ctx.getTree();
        var updated = toggleGapManualComplete(latest, gapId, true);

        var gap = (updated.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
        if (gap && gap.dimIndex != null) {
          sendGapProgress(gap, { onVectorChange: ctx.onVectorChange });
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

    // Either direction: report the gap's full checklist state; the server sets
    // the dimension to an absolute value from vBase (never an increment).
    {
      var gap = (updated.focusTracker.skillGaps || []).find(function (g) { return g.id === gapId; });
      if (gap && gap.dimIndex != null) {
        sendGapProgress(gap, { onVectorChange: ctx.onVectorChange }).catch(function () { /* ignore */ });
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
        const isArt = !!(l.artifactId || (l.id && String(l.id).indexOf('art-') === 0));
        return '<li class="sgt-log-item" data-log-id="' + escAttr(logId) + '">'
          + '<span class="sgt-log-text">' + esc(l.text) + '</span>'
          + (l.w ? '<span class="sgt-log-weight" title="Evidence contribution toward closing this gap">+' + l.w + '%</span>' : '')
          + (isArt ? '' : '<button type="button" class="sgt-log-promote" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" title="Save as portfolio artifact">↗</button>')
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
          const isArt = !!(l.artifactId || (l.id && String(l.id).indexOf('art-') === 0));
          return '<li class="sgt-log-item" data-log-id="' + escAttr(logId) + '">'
            + '<span class="sgt-log-text">' + esc(l.text) + '</span>'
          + (l.w ? '<span class="sgt-log-weight" title="Evidence contribution toward closing this gap">+' + l.w + '%</span>' : '')
            + (isArt ? '' : '<button type="button" class="sgt-log-promote" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" title="Save as portfolio artifact">↗</button>')
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

  const STEP_KIND_LABELS = {
    reading: 'Reading',
    course: 'Course',
    club: 'Club',
    deliverable: 'Deliverable',
    network: 'Network',
    milestone: 'Milestone',
  };

  function stepKindChip(kind) {
    if (!kind || !STEP_KIND_LABELS[kind]) return '';
    return '<span class="sgt-step-kind sgt-step-kind--' + escAttr(kind) + '">' + esc(STEP_KIND_LABELS[kind]) + '</span>';
  }

  function gapChecklistHtml(g) {
    const items = (g.checklist || []);
    if (!items.length) return '';
    return '<ul class="sgt-checklist">' + items.map(function (c) {
      return '<li class="sgt-checklist-item">'
        + '<label><input type="checkbox" class="sgt-checklist-check" data-gap-id="' + escAttr(g.id) + '" data-item-id="' + escAttr(c.id) + '"' + (c.done ? ' checked' : '') + '>'
        + '<span>' + esc(c.text) + '</span></label>'
        + '</li>';
    }).join('') + '</ul>';
  }

  function gapLogsHtml(g) {
    const logs = (g.logs || []).slice(0, 3);
    if (!logs.length) return '';
    return '<ul class="sgt-logs">' + logs.map(function (l, li) {
      const logId = l.id || ('log-legacy-' + g.id + '-' + li);
      const isArt = !!(l.artifactId || (l.id && String(l.id).indexOf('art-') === 0));
      return '<li class="sgt-log-item" data-log-id="' + escAttr(logId) + '">'
        + '<span class="sgt-log-text">' + esc(l.text) + '</span>'
          + (l.w ? '<span class="sgt-log-weight" title="Evidence contribution toward closing this gap">+' + l.w + '%</span>' : '')
        + (isArt ? '' : '<button type="button" class="sgt-log-promote" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" title="Save as portfolio artifact">↗</button>')
        + '<button type="button" class="sgt-log-remove" data-gap-id="' + escAttr(g.id) + '" data-log-id="' + escAttr(logId) + '" aria-label="Remove note">×</button>'
        + '</li>';
    }).join('') + '</ul>';
  }

  // Expanded content for a compact skill-gap row: v3 coordinate gaps get the
  // domain chip + You/Target bars + checklist; legacy gaps get a linked-step
  // count. Both get "Mark complete", existing logs, and the log-input controls
  // (this replaces the old separate "Log progress" section — logging now lives
  // inside the expanded row).
  function renderGapExpandBody(g) {
    const isV3 = g.source === COORDINATE_SOURCE;
    const userPct = Math.max(0, Math.min(100, g.user || 0));
    const targetPct = Math.max(0, Math.min(100, g.target || 0));
    const domainHtml = isV3 ? '<span class="sgt-gap-domain">' + esc(domainLabel(g.domain)) + '</span>' : '';
    const barsHtml = isV3
      ? '<div class="sgt-cmp-bars">'
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
        + '</div>'
      : '';
    const metaHtml = isV3
      ? '<div class="sgt-gap-meta">' + (g.progress || 0) + '% · gap of ' + (g.gap || 0) + '</div>'
      : '<div class="sgt-gap-meta">' + (g.progress || 0) + '% · ' + ((g.linkedStepIds || []).length) + ' linked steps</div>';
    const manualHtml = '<label class="sgt-gap-manual">'
      + '<input type="checkbox" class="sgt-gap-check" data-gap-id="' + escAttr(g.id) + '"'
      + (g.manualComplete ? ' checked' : '') + '>'
      + '<span>Mark complete</span></label>';
    return domainHtml
      + barsHtml
      + metaHtml
      + gapChecklistHtml(g)
      + manualHtml
      + gapLogsHtml(g)
      + renderLogControls(g.id);
  }

  function renderGapCollapsedRow(g, isOpen) {
    const status = g.status || 'open';
    const pct = g.progress || 0;
    const openCls = isOpen ? ' sgt-gap-row--open' : '';
    return '<div class="sgt-gap-row' + openCls + '" data-gap-id="' + escAttr(g.id) + '">'
      + '<button type="button" class="sgt-gap-row-head" data-gap-toggle="' + escAttr(g.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">'
      + '<span class="sgt-gap-row-label">' + esc(displayGapLabel(g.label)) + '</span>'
      + '<div class="sgt-bar-wrap sgt-bar-wrap--slim"><div class="sgt-bar" style="width:' + pct + '%"></div></div>'
      + '<span class="sgt-gap-row-pct">' + pct + '%</span>'
      + '<span class="sgt-gap-status sgt-gap-status--' + esc(status) + '">' + esc(statusLabel(g)) + '</span>'
      + '<span class="sgt-gap-chevron" aria-hidden="true">▾</span>'
      + '</button>'
      + '<div class="sgt-gap-expand"' + (isOpen ? '' : ' hidden') + '>' + renderGapExpandBody(g) + '</div>'
      + '</div>';
  }

  // Secondary, compact "Skill gaps" section for the focus view: each gap is a
  // single row (label + slim bar + percent + chevron); expanding a row reveals
  // its checklist, You/Target bars, logs, and log controls. Replaces the old
  // stack of full-size gap cards plus the separate duplicated log-progress list.
  // Readiness meter: gaps are pure MEASUREMENT now — You/Target bars that move
  // as waypoint steps get completed. No per-gap checklists, logs, or manual
  // toggles; the semester plan and steps column own the actions.
  function renderGapMeterRow(g) {
    const userPct = Math.max(0, Math.min(100, Math.round(g.user || 0)));
    const targetPct = Math.max(0, Math.min(100, Math.round(g.target || 0)));
    return '<div class="sgt-gap-meter" data-gap-id="' + escAttr(g.id) + '">'
      + '<div class="sgt-gap-meter-head">'
      + '<span class="sgt-gap-meter-label">' + esc(displayGapLabel(g.label)) + '</span>'
      + '<span class="sgt-gap-meter-status">' + esc(statusLabel(g)) + '</span>'
      + '</div>'
      + '<div class="sgt-cmp-bars">'
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
      + '</div>'
      + '</div>';
  }

  function renderGapSection(gaps, expandedId) {
    if (!gaps.length) return '';
    return '<h3 class="sgt-section-title sgt-section-title--gaps">Readiness</h3>'
      + '<p class="sgt-gaps-hint">These move on their own as you complete steps.</p>'
      + '<div class="sgt-gaps sgt-gaps--meter">'
      + gaps.map(renderGapMeterRow).join('')
      + '</div>';
  }

  function renderStepPreview(waypoint, skillGaps, editable, opts) {
    const wp = waypoint || {};
    const steps = (wp.steps || []).slice(0, editable ? 99 : 3);
    const gaps = skillGaps || [];
    if (!steps.length) return '';
    const gapByStep = {};
    gaps.forEach(function (g) {
      (g.linkedStepIds || []).forEach(function (sid) { gapByStep[sid] = displayGapLabel(g.label); });
    });
    const stepRows = steps.map(function (s) {
      return '<li class="sgt-step">'
        + '<label><input type="checkbox" class="sgt-step-check" data-step-id="' + escAttr(s.id) + '"' + (s.done ? ' checked' : '') + '>'
        + '<span class="sgt-step-tick" aria-hidden="true">✓</span>'
        + stepKindChip(s.kind)
        + '<span>' + esc(s.text) + '</span></label>'
        + (gapByStep[s.id] ? '<span class="sgt-step-gap">' + esc(gapByStep[s.id]) + '</span>' : '')
        + '</li>';
    }).join('');
    return '<ul class="sgt-steps">' + stepRows + '</ul>';
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
        const updated = removeLog(t, gapId, logId);
        onPersist(updated);
        syncGapVectorAfterLogChange(updated, gapId, opts);
      });
    });

    root.querySelectorAll('.sgt-log-promote').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const t = currentTree();
        const gapId = btn.getAttribute('data-gap-id');
        const logId = btn.getAttribute('data-log-id');
        if (!t || !gapId || !logId) return;
        const gap = ((t.focusTracker || {}).skillGaps || []).find(function (g) { return g && g.id === gapId; });
        if (!gap) return;
        const logs = gap.logs || [];
        let text = '';
        for (let i = 0; i < logs.length; i++) {
          const l = logs[i];
          const id = l.id || ('log-legacy-' + gapId + '-' + i);
          if (id === logId) { text = l.text || ''; break; }
        }
        if (global.FWArtifacts && typeof FWArtifacts.promoteFromNote === 'function') {
          FWArtifacts.promoteFromNote(gapId, text, gap.dimIndex, logId);
        }
      });
    });

    function persistWithLog(gapId, text) {
      const t = currentTree();
      if (!onPersist || !t || !gapId) return;
      const updated = persistLog(t, gapId, text);
      onPersist(updated);
      syncGapVectorAfterLogChange(updated, gapId, opts);
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

  // ---- Semester plan (waypoint-plan endpoint) ---------------------------
  // sessionStorage-cached per waypoint; one in-flight fetch per waypoint at a
  // time so re-renders during a slow generation don't pile up requests.
  const WP_PLAN_INFLIGHT = {};

  function wpPlanCacheKey(waypointId) {
    return 'sgt-wpplan:' + waypointId;
  }

  function readWpPlanCache(waypointId) {
    try {
      const raw = global.sessionStorage && sessionStorage.getItem(wpPlanCacheKey(waypointId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeWpPlanCache(waypointId, data) {
    try {
      if (global.sessionStorage) sessionStorage.setItem(wpPlanCacheKey(waypointId), JSON.stringify(data));
    } catch (e) { /* storage full/unavailable — ignore */ }
  }

  function fetchWaypointPlan(waypointId, onDone) {
    if (!waypointId) { onDone(null, 'no-waypoint'); return; }
    const cached = readWpPlanCache(waypointId);
    if (cached) { onDone(cached, null); return; }
    // The focus view fully re-renders on every persist, so a second caller can
    // arrive while the first request is in flight — queue every callback and
    // settle them all, or the fresh skeleton's container never gets painted
    // (the old callback targets a detached node → spinner stuck forever).
    if (Array.isArray(WP_PLAN_INFLIGHT[waypointId])) {
      WP_PLAN_INFLIGHT[waypointId].push(onDone);
      return;
    }
    WP_PLAN_INFLIGHT[waypointId] = [onDone];
    function settle(data, err) {
      const cbs = WP_PLAN_INFLIGHT[waypointId] || [];
      WP_PLAN_INFLIGHT[waypointId] = false;
      cbs.forEach(function (cb) {
        try { cb(data, err); } catch (_) { /* one bad container must not starve the rest */ }
      });
    }
    try {
      fetch('/career-roadmap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'waypoint-plan', nodeId: waypointId }),
      }).then(function (r) {
        if (!r.ok) return Promise.reject(new Error('status-' + r.status));
        return r.json();
      }).then(function (data) {
        if (data && data.plan) {
          writeWpPlanCache(waypointId, data);
          settle(data, null);
        } else {
          settle(null, 'empty');
        }
      }).catch(function (err) {
        settle(null, (err && err.message) || 'fetch-failed');
      });
    } catch (e) {
      settle(null, 'exception');
    }
  }

  function planItemHtml(item) {
    if (!item) return '';
    const chip = stepKindChip(item.kind);
    const marker = item.stepId
      ? '<button type="button" class="sgt-plan-item-track" data-track-step-id="' + escAttr(item.stepId) + '">↳ tracked step</button>'
      : '';
    return '<li class="sgt-plan-item">'
      + '<div class="sgt-plan-item-head">' + chip + '<span class="sgt-plan-item-text">' + esc(item.text || '') + '</span></div>'
      + (item.method ? '<p class="sgt-plan-item-how">' + esc(item.method) + '</p>' : '')
      + '<div class="sgt-plan-item-links">'
      + marker
      + '<button type="button" class="sgt-plan-item-deeper" data-item-text="' + escAttr(item.text || '') + '">Go deeper</button>'
      + '</div>'
      + '<div class="sgt-plan-item-detail" hidden></div>'
      + '</li>';
  }

  // "Go deeper" on a plan item: fetch a mentor-voice elaboration for that
  // exact item, then let the user ask follow-up questions about it inline.
  function bindPlanDeepDives(container, waypointId) {
    container.querySelectorAll('.sgt-plan-item-deeper').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const li = btn.closest('.sgt-plan-item');
        const detail = li && li.querySelector('.sgt-plan-item-detail');
        if (!detail) return;
        if (!detail.hidden) { detail.hidden = true; btn.textContent = 'Go deeper'; return; }
        detail.hidden = false;
        btn.textContent = 'Close';
        if (detail.getAttribute('data-loaded')) return;
        const itemText = btn.getAttribute('data-item-text') || '';
        detail.innerHTML = '<p class="sgt-elab-loading">Thinking about this one…</p>';
        fetchStepElaboration(waypointId, itemText, '', function (reply, err) {
          if (!detail.isConnected) return;
          if (!reply) {
            detail.innerHTML = '<p class="sgt-plan-error">Could not load — try again in a moment.</p>';
            detail.removeAttribute('data-loaded');
            return;
          }
          detail.setAttribute('data-loaded', '1');
          detail.innerHTML = '<p class="sgt-elab-text">' + esc(reply) + '</p>'
            + '<div class="sgt-elab-ask">'
            + '<input type="text" class="sgt-elab-input" maxlength="280" placeholder="Ask a follow-up about this…">'
            + '<button type="button" class="sgt-elab-send">Ask</button>'
            + '</div>'
            + '<div class="sgt-elab-thread"></div>';
          bindElabFollowUps(detail, waypointId, itemText);
        });
      });
    });
  }

  function bindElabFollowUps(detail, waypointId, itemText) {
    const input = detail.querySelector('.sgt-elab-input');
    const send = detail.querySelector('.sgt-elab-send');
    const thread = detail.querySelector('.sgt-elab-thread');
    if (!input || !send || !thread) return;
    function ask() {
      const q = String(input.value || '').trim();
      if (!q) return;
      input.value = '';
      const restoreSend = global.FWButtonBusy ? FWButtonBusy.start(send) : function () {};
      const qEl = document.createElement('p');
      qEl.className = 'sgt-elab-q';
      qEl.textContent = q;
      thread.appendChild(qEl);
      const aEl = document.createElement('p');
      aEl.className = 'sgt-elab-a sgt-elab-loading';
      aEl.textContent = '…';
      thread.appendChild(aEl);
      fetchStepElaboration(waypointId, itemText, q, function (reply) {
        restoreSend();
        if (!aEl.isConnected) return;
        aEl.classList.remove('sgt-elab-loading');
        aEl.textContent = reply || 'Could not answer right now — try again.';
      });
    }
    send.addEventListener('click', ask);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ask(); }
    });
  }

  function fetchStepElaboration(waypointId, itemText, question, onDone) {
    try {
      fetch('/career-roadmap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'step-elaborate',
          nodeId: waypointId || '',
          itemText: itemText,
          question: question || '',
        }),
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        onDone(data && data.reply ? data.reply : null);
      }).catch(function () { onDone(null); });
    } catch (e) { onDone(null); }
  }

  function planPhaseHtml(phase) {
    if (!phase) return '';
    const items = (phase.items || []).map(planItemHtml).join('');
    return '<div class="sgt-plan-phase">'
      + '<div class="sgt-plan-phase-head">'
      + (phase.weeks ? '<span class="sgt-plan-phase-weeks">' + esc(phase.weeks) + '</span>' : '')
      + '<h4 class="sgt-plan-phase-title">' + esc(phase.title || '') + '</h4>'
      + '</div>'
      + (phase.focus ? '<p class="sgt-plan-phase-focus">' + esc(phase.focus) + '</p>' : '')
      + (items ? '<ul class="sgt-plan-items">' + items + '</ul>' : '')
      + '</div>';
  }

  function planCadenceHtml(cadence) {
    if (!cadence || !cadence.length) return '';
    return '<div class="sgt-plan-cadence">' + cadence.map(function (c) {
      return '<span class="sgt-plan-cadence-pill">' + esc(c.label || '') + (c.freq ? ' · ' + esc(c.freq) : '') + '</span>';
    }).join('') + '</div>';
  }

  function planBodyHtml(plan) {
    if (!plan) return '';
    const phases = (plan.phases || []).map(planPhaseHtml).join('');
    return (plan.overview ? '<p class="sgt-plan-overview">' + esc(plan.overview) + '</p>' : '')
      + (phases ? '<div class="sgt-plan-timeline">' + phases + '</div>' : '')
      + planCadenceHtml(plan.cadence)
      + (plan.protocol ? '<div class="sgt-plan-protocol"><p class="sgt-plan-protocol-label">Rule of the road</p><p class="sgt-plan-protocol-text">' + esc(plan.protocol) + '</p></div>' : '')
      + ((plan.baseCase || plan.aspirational) ? '<div class="sgt-plan-targets">'
        + (plan.baseCase ? '<div class="sgt-plan-target"><p class="sgt-plan-target-label">Base case</p><p class="sgt-plan-target-text">' + esc(plan.baseCase) + '</p></div>' : '')
        + (plan.aspirational ? '<div class="sgt-plan-target sgt-plan-target--stretch"><p class="sgt-plan-target-label">Stretch</p><p class="sgt-plan-target-text">' + esc(plan.aspirational) + '</p></div>' : '')
        + '</div>' : '');
  }

  function renderPlanLoading() {
    return '<div class="sgt-plan-skeleton" role="status" aria-busy="true">'
      + '<p class="sgt-plan-skeleton-copy">Building your semester plan…</p>'
      + '<span class="fw-skeleton sgt-plan-skel-line" aria-hidden="true"></span>'
      + '<span class="fw-skeleton sgt-plan-skel-line" aria-hidden="true"></span>'
      + '<span class="fw-skeleton sgt-plan-skel-line sgt-plan-skel-line--short" aria-hidden="true"></span>'
      + '</div>';
  }

  function renderPlanError() {
    return '<p class="sgt-plan-error">Plan unavailable — <button type="button" class="sgt-plan-retry">retry</button></p>';
  }

  // Fetches (or reads cached) plan for the given waypoint and paints it into
  // the .sgt-plan container inside el. Fire-and-forget — never blocks or
  // throws into the caller; a failure just leaves a quiet retry link.
  function loadPlanInto(el, waypointId, waypoint) {
    const container = el.querySelector('.sgt-plan');
    if (!container || !waypointId) return;
    // Plans persist on the roadmap node itself — render instantly, no fetch.
    const nodePlan = waypoint && waypoint.semesterPlan && waypoint.semesterPlan.plan;
    if (nodePlan) {
      container.innerHTML = planBodyHtml(nodePlan);
      bindPlanTrackLinks(el, container);
      bindPlanDeepDives(container, waypointId);
      return;
    }
    container.innerHTML = renderPlanLoading();
    try {
      fetchWaypointPlan(waypointId, function (data, err) {
        // The panel may have re-rendered (different waypoint) by the time this
        // callback fires — bail if our container is no longer in the DOM.
        if (!container.isConnected) return;
        if (data && data.plan) {
          container.innerHTML = planBodyHtml(data.plan);
          bindPlanTrackLinks(el, container);
      bindPlanDeepDives(container, waypointId);
        } else {
          container.innerHTML = renderPlanError();
          const retryBtn = container.querySelector('.sgt-plan-retry');
          if (retryBtn) retryBtn.addEventListener('click', function () { loadPlanInto(el, waypointId); });
        }
      });
    } catch (e) {
      if (container.isConnected) container.innerHTML = renderPlanError();
    }
  }

  // Clicking a "tracked step" marker scrolls to and briefly flashes the
  // matching step checkbox in the steps column, if one exists. Pure UX
  // affordance — no-op (not an error) when no match is found.
  function bindPlanTrackLinks(el, container) {
    container.querySelectorAll('[data-track-step-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const stepId = btn.getAttribute('data-track-step-id');
        let target = stepId && el.querySelector('.sgt-step-check[data-step-id="' + CSS.escape(stepId) + '"]');
        if (!target) return;
        const row = target.closest('.sgt-step');
        if (row && row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (row) {
          row.classList.add('sgt-step--flash');
          setTimeout(function () { row.classList.remove('sgt-step--flash'); }, 1200);
        }
      });
    });
  }

  // ---- Inline Marco on the focus waypoint --------------------------------
  // A compact thread pinned to the current waypoint. Messages go through the
  // existing /career-roadmap chat action (which can patch the roadmap), with
  // the waypoint named so Marco's answer and any plan edits stay scoped to
  // it. Threads live for the session (module map) so the full re-render that
  // follows every persist doesn't eat the conversation.
  var MARCO_THREADS = {};

  function renderMarcoInline(wp) {
    var thread = MARCO_THREADS[wp.id] || [];
    var msgs = thread.map(function (m) {
      return '<p class="sgt-marco-msg sgt-marco-msg--' + (m.role === 'user' ? 'user' : 'marco') + '">' + esc(m.text) + '</p>';
    }).join('');
    return '<div class="sgt-marco">'
      + '<h3 class="sgt-section-title">Talk to Marco about this waypoint</h3>'
      + '<p class="sgt-marco-hint">Ask why it\'s here, swap a step, or tell him what changed — he can edit the plan.</p>'
      + '<div class="sgt-marco-thread">' + msgs + '</div>'
      + '<div class="sgt-marco-row">'
      + '<input type="text" class="sgt-marco-input" maxlength="500" placeholder="e.g. I already took this course — replace the step">'
      + '<button type="button" class="sgt-marco-send">Send</button>'
      + '</div>'
      + '</div>';
  }

  function bindMarcoInline(el, wp, opts) {
    var box = el.querySelector('.sgt-marco');
    if (!box) return;
    var input = box.querySelector('.sgt-marco-input');
    var send = box.querySelector('.sgt-marco-send');
    var threadEl = box.querySelector('.sgt-marco-thread');
    if (!input || !send || !threadEl) return;
    threadEl.scrollTop = threadEl.scrollHeight;

    function push(role, text) {
      var thread = MARCO_THREADS[wp.id] = MARCO_THREADS[wp.id] || [];
      thread.push({ role: role, text: String(text || '').slice(0, 900) });
      if (thread.length > 12) thread.splice(0, thread.length - 12);
      var p = document.createElement('p');
      p.className = 'sgt-marco-msg sgt-marco-msg--' + (role === 'user' ? 'user' : 'marco');
      p.textContent = text;
      threadEl.appendChild(p);
      threadEl.scrollTop = threadEl.scrollHeight;
      return p;
    }

    function sendMsg() {
      var msg = String(input.value || '').trim();
      if (!msg || send.disabled) return;
      input.value = '';
      var restoreSend = global.FWButtonBusy ? FWButtonBusy.start(send) : function () {};
      push('user', msg);
      var pending = push('marco', '…');
      pending.classList.add('sgt-marco-loading');
      var tree = opts.getTree ? opts.getTree() : null;
      fetch('/career-roadmap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          // /career-roadmap validates careerSlug/careerName before the chat
          // branch — omitting them is a guaranteed 400 ("Could not reach Marco").
          careerSlug: (tree && tree.targetCareerSlug) || '',
          careerName: (tree && tree.targetCareerName) || '',
          // Scoped surface: the server pins edits to THIS waypoint's own
          // content (steps + semester plan) — structure is out of bounds.
          scope: 'waypoint',
          waypointId: wp.id,
          userMessage: '[About my current waypoint "' + String(wp.title || wp.shortTitle || '').slice(0, 90) + '"] ' + msg,
          currentRoadmap: tree,
        }),
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          restoreSend();
          var reply = (res.d && res.d.reply) || (res.ok ? 'Done.' : 'Could not reach Marco — try again in a moment.');
          // Update the module thread's last entry, then repaint or re-render.
          var thread = MARCO_THREADS[wp.id] || [];
          if (thread.length) thread[thread.length - 1] = { role: 'marco', text: String(reply).slice(0, 900) };
          if (res.d && res.d.roadmap && typeof opts.onPersist === 'function') {
            // Persist triggers a full re-render; the thread map repaints it.
            opts.onPersist(res.d.roadmap);
            return;
          }
          if (pending.isConnected) {
            pending.classList.remove('sgt-marco-loading');
            pending.textContent = reply;
            threadEl.scrollTop = threadEl.scrollHeight;
          }
        })
        .catch(function () {
          restoreSend();
          var thread = MARCO_THREADS[wp.id] || [];
          if (thread.length) thread[thread.length - 1] = { role: 'marco', text: 'Could not reach Marco — try again in a moment.' };
          if (pending.isConnected) {
            pending.classList.remove('sgt-marco-loading');
            pending.textContent = 'Could not reach Marco — try again in a moment.';
          }
        });
    }

    send.addEventListener('click', sendMsg);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendMsg(); }
    });
  }

  function renderFocusView(el, tree, waypoint, opts) {
    if (!el) return;
    opts = opts || {};
    // Re-renders (after a checkbox/gap persist) must not yank the view back
    // to the top. The focus view is an INNER scroller (.roadmap-focus-view is
    // overflow-y:auto), so el.scrollTop is the scroll that matters — window
    // scroll is captured too for layouts where the page itself scrolls.
    // First render of the view (empty container) keeps default behavior.
    var restoreScrollY = el.childElementCount ? window.scrollY : null;
    var restorePanelScroll = el.childElementCount ? el.scrollTop : null;
    const activeKey = activeBranchKey(tree);
    // Branch-aware focus: on a secondary branch the card follows that branch's
    // next-undone waypoint, not the main pinned one.
    const branchWp = activeKey !== 'spine' ? immediateWaypointForBranch(tree, activeKey) : null;
    const wp = branchWp || waypoint || waypointById(tree, tree.focusTracker && tree.focusTracker.waypointId);
    const gaps = (tree.focusTracker && tree.focusTracker.skillGaps) || [];
    const editable = !!(opts.editable && wp);
    const switcherHtml = branchSwitcherHtml(tree);
    // Which gap row is expanded. Stored on the container element itself so it
    // survives the full innerHTML rebuild that follows every onPersist call.
    const expandedGapId = el._sgtExpandedGapId || (gaps[0] && gaps[0].id) || '';

    el.innerHTML = ''
      + '<div class="roadmap-focus-inner">'
      + '<div class="sgt-focus-head">'
      + '<button type="button" class="sgt-back-map">← Back to map</button>'
      + switcherHtml
      + '<p class="sgt-eyebrow">Current focus</p>'
      + '<h2 class="sgt-focus-title">' + esc(wp ? (wp.title || wp.shortTitle) : 'Your focus') + '</h2>'
      + (tree && tree.targetCareerName
        ? '<p class="sgt-focus-target">Toward <a href="career.html?slug=' + escAttr(tree.targetCareerSlug || '') + '">'
          + esc(tree.targetCareerName) + '</a>'
          + (tree.fitContext && tree.fitContext.preparedness != null
            ? ' · Readiness ' + esc(String(Math.round(tree.fitContext.preparedness))) + '%'
            : '')
          + '</p>'
        : '')
      + (wp && wp.whyItMatters ? '<p class="sgt-focus-why">' + esc(wp.whyItMatters) + '</p>' : '')
      + '</div>'
      + (wp ? '<div class="sgt-plan"></div>' : '')
      + '<div class="sgt-focus-layout">'
      + '<div class="sgt-focus-col sgt-focus-col--steps">'
      + '<h3 class="sgt-section-title">Waypoint steps</h3>'
      + (renderStepPreview(wp, gaps, editable) || '<p class="sgt-empty">No steps on this waypoint yet — ask Marco below to add some.</p>')
      + '</div>'
      + '<div class="sgt-focus-col sgt-focus-col--gaps">'
      + renderGapSection(gaps, expandedGapId)
      + '</div>'
      + '</div>'
      + (wp && editable ? renderMarcoInline(wp) : '')
      + '</div>';

    if (restoreScrollY !== null) window.scrollTo(0, restoreScrollY);
    if (restorePanelScroll !== null) el.scrollTop = restorePanelScroll;

    if (wp && wp.id && editable) bindMarcoInline(el, wp, opts);

    if (wp && wp.id) loadPlanInto(el, wp.id, wp);

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

    // Live coordinate recompute, off the render path so a slow vector fetch
    // never blocks the panel. (The per-gap AI-checklist upgrade is retired —
    // gaps are a readiness meter now; steps and the semester plan own actions.)
    if (opts.onPersist && global.FWOnetVectors
      && typeof FWOnetVectors.objectiveVsCareerDimensions === 'function') {
      const getTree = opts.getTree || function () { return tree; };
      const persist = function (t) { opts.onPersist(t); };
      persist.getTree = getTree;
      const needsRecompute = !isV3Tracker(tree.focusTracker)
        || (tree.focusTracker && tree.focusTracker.needsRecompute);
      if (needsRecompute) {
        recomputeCoordinateGaps(getTree(), {}).then(function (updated) {
          if (updated && isV3Tracker(updated.focusTracker) && updated !== getTree()) {
            persist(updated);
          }
        });
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
    syncGapVectorAfterLogChange: syncGapVectorAfterLogChange,
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
