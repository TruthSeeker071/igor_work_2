/**
 * Roadmap tree v2 — graph schema, migration, and tree-specific helpers.
 */

export const ROADMAP_TREE_VERSION = 2;
export const MAX_TREE_NODES = 24;
export const MAX_TREE_DECISIONS = 2;
export const MAX_TREE_DEPTH = 6;
export const ROADMAP_TREE_MAX_CHARS = 48000;
export const SPINE_WAYPOINT_COUNT = 6;
export const MAJOR_WAYPOINT_COUNT = 2;
export const MAX_STEPS_PER_NODE = 5;
export const MAX_STEP_TEXT = 100;

const CAREER_VALUES = new Set(['knowledge', 'network', 'resume', 'mixed']);

const PHASE_DEFS = [
  { key: 'this_month', label: 'This month' },
  { key: 'next_semester', label: 'Next semester' },
  { key: 'longer_term', label: 'Longer term' },
];

const ACTION_TYPES = new Set(['class', 'project', 'skill', 'network', 'other']);
const NODE_TYPES = new Set(['waypoint', 'decision', 'milestone', 'outcome']);
const PATH_ROLES = new Set(['spine', 'alternate', 'branch']);
const HORIZONS = new Set(['next_month', 'next_semester', 'longer_term']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let nodeIdCounter = 0;

function trim(s, max) {
  return String(s || '').trim().slice(0, max || 280);
}

function nextNodeId(prefix) {
  nodeIdCounter += 1;
  return `${prefix || 'n'}${Date.now().toString(36)}${nodeIdCounter}`;
}

function clampConfidence(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(5, v));
}

function readConfidence(raw) {
  if (raw == null || typeof raw !== 'object') return 3;
  if (raw.confidence != null) return clampConfidence(raw.confidence);
  if (raw.certainty != null) return clampConfidence(raw.certainty);
  return 3;
}

export function nodeConfidence(n) {
  if (!n) return 3;
  if (n.confidence != null) return clampConfidence(n.confidence);
  if (n.certainty != null) return clampConfidence(n.certainty);
  return 3;
}

function maxBranchHops(spineIndex) {
  const i = Math.max(1, Math.min(SPINE_WAYPOINT_COUNT, Number(spineIndex) || 1));
  return Math.max(0, Math.min(3, SPINE_WAYPOINT_COUNT - i));
}

function childrenOf(nodes, parentId) {
  return (nodes || []).filter((n) => n.parentId === parentId);
}

function normalizeActionType(type) {
  const t = String(type || 'other').toLowerCase();
  return ACTION_TYPES.has(t) ? t : 'other';
}

function normalizeOutcomes(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const roles = Array.isArray(raw.roles)
    ? raw.roles.slice(0, 4).map((r) => ({
      title: trim(r.title, 80),
      probability: trim(r.probability, 40),
    })).filter((r) => r.title)
    : [];
  const firmTiers = Array.isArray(raw.firmTiers)
    ? raw.firmTiers.slice(0, 4).map((f) => ({
      tier: trim(f.tier, 80),
      probability: trim(f.probability, 40),
    })).filter((f) => f.tier)
    : [];
  if (!roles.length && !firmTiers.length) return null;
  return { roles, firmTiers };
}

export function collectTreeDoneMap(nodes) {
  const map = {};
  (nodes || []).forEach((n) => {
    if (n && n.id) map[n.id] = !!n.done;
  });
  return map;
}

export function collectStepDoneMap(nodes) {
  const map = {};
  (nodes || []).forEach((n) => {
    if (!n?.id || !Array.isArray(n.steps)) return;
    n.steps.forEach((s) => {
      if (s?.id) map[`${n.id}:${s.id}`] = !!s.done;
    });
  });
  return map;
}

export function nodeStepProgress(node) {
  const steps = node?.steps || [];
  if (!steps.length) {
    return { done: 0, total: 0, pct: node?.done ? 100 : 0 };
  }
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function syncNodeDoneFromSteps(node) {
  if (!node) return node;
  const { done, total } = nodeStepProgress(node);
  if (total > 0) {
    node.done = done === total;
    node.status = node.done ? 'completed' : 'active';
  }
  return node;
}

function normalizeCareerValue(raw) {
  const v = String(raw || 'mixed').toLowerCase();
  return CAREER_VALUES.has(v) ? v : 'mixed';
}

function normalizeSteps(rawSteps, nodeId, stepDoneMap) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.slice(0, MAX_STEPS_PER_NODE).map((s, idx) => {
    const id = trim(s?.id, 48) || `${nodeId}-st${idx + 1}`;
    const key = `${nodeId}:${id}`;
    const done = stepDoneMap && stepDoneMap[key] !== undefined ? !!stepDoneMap[key] : !!s?.done;
    const text = trim(s?.text, MAX_STEP_TEXT);
    if (!text) return null;
    return { id, text, done };
  }).filter(Boolean);
}

export function backfillWaypointSteps(node, fitContext) {
  const actionType = normalizeActionType(node?.actionType);
  const templates = {
    class: ['Research course options for this goal', 'Enroll in the best-fit class', 'Complete coursework and record the outcome'],
    project: ['Define the project scope and deliverable', 'Build and iterate on the project', 'Publish results or add to your portfolio'],
    skill: ['Identify specific skills to practice', 'Complete focused practice sessions', 'Demonstrate the skill with a small deliverable'],
    network: ['List 5 people to reach out to', 'Send intros or schedule coffee chats', 'Follow up and document what you learned'],
    other: ['Clarify what done looks like for this step', 'Take the first concrete action', 'Document the outcome for your resume'],
  };
  const texts = templates[actionType] || templates.other;
  const gap = (fitContext?.topGaps || [])[0];
  const whyItMatters = gap
    ? `This waypoint moves you toward your target career and helps close your gap in ${gap}.`
    : `This waypoint breaks a big goal into actions you can finish this semester.`;
  return {
    whyItMatters,
    addressedGaps: gap ? [trim(gap, 120)] : [],
    careerValue: 'mixed',
    steps: texts.map((text, i) => ({
      id: `${node.id}-st${i + 1}`,
      text,
      done: false,
    })),
  };
}

function normalizeGapLabel(gap) {
  const s = trim(gap, 120);
  if (!s) return '';
  return s.replace(/\s*\(\d+%\)\s*$/i, '').trim();
}

function slugFromGapLabel(label) {
  return normalizeGapLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'gap';
}

function deriveSkillGapEntries(tree, waypoint) {
  const entries = [];
  const seen = new Set();
  const add = (label, source) => {
    const norm = normalizeGapLabel(label);
    const key = norm.toLowerCase();
    if (!norm || seen.has(key)) return;
    seen.add(key);
    entries.push({ label: norm, source: source || 'quiz' });
  };
  const fit = tree?.fitContext || {};
  (fit.vectorGaps || []).slice(0, 4).forEach((g) => add(g.name || g.label, 'vector'));
  (fit.topGaps || []).slice(0, 4).forEach((g) => add(g, fit.vectorGaps?.length ? 'vector' : 'quiz'));
  (waypoint?.addressedGaps || []).slice(0, 2).forEach((g) => add(g, 'waypoint'));
  if (!entries.length) add('Core skills for this waypoint', 'waypoint');
  return entries.slice(0, 6);
}

function linkSkillGapsToSteps(waypoint, entries, priorGaps = []) {
  const steps = waypoint?.steps || [];
  const priorByLabel = new Map(
    (priorGaps || []).map((g) => [normalizeGapLabel(g.label).toLowerCase(), g]),
  );
  const gaps = entries.map((entry, i) => {
    const prev = priorByLabel.get(normalizeGapLabel(entry.label).toLowerCase());
    return {
      id: prev?.id || `sg-${slugFromGapLabel(entry.label)}-${i}`,
      label: entry.label,
      source: entry.source,
      status: 'open',
      progress: 0,
      linkedStepIds: [],
      logs: Array.isArray(prev?.logs) ? prev.logs.slice(0, 12) : [],
      keywords: Array.isArray(prev?.keywords) ? prev.keywords.slice() : [],
      matchedKeywords: Array.isArray(prev?.matchedKeywords) ? prev.matchedKeywords.slice() : [],
      manualComplete: !!prev?.manualComplete,
    };
  });
  const linkCount = Math.min(steps.length, gaps.length);
  for (let i = 0; i < linkCount; i += 1) {
    const gap = gaps[i];
    const step = steps[i];
    if (gap && step && !gap.linkedStepIds.includes(step.id)) {
      gap.linkedStepIds.push(step.id);
    }
  }
  return gaps;
}

const KEYWORD_PROGRESS_PER_MATCH = 8;

function syncSkillGapProgress(waypoint, skillGaps) {
  const stepMap = new Map((waypoint?.steps || []).map((s) => [s.id, s]));
  return (skillGaps || []).map((gap) => {
    const linked = gap.linkedStepIds || [];
    const done = linked.filter((id) => stepMap.get(id)?.done).length;
    const stepProgress = linked.length ? Math.round((done / linked.length) * 100) : 0;
    const keywordProgress = Math.min(100, (gap.matchedKeywords || []).length * KEYWORD_PROGRESS_PER_MATCH);
    const manualProgress = gap.manualComplete ? 100 : 0;
    const progress = Math.min(100, Math.max(stepProgress, keywordProgress, manualProgress));
    const status = progress >= 100 ? 'closed' : progress > 0 ? 'in_progress' : 'open';
    return { ...gap, progress, status };
  });
}

const MAX_CHECKLIST_ITEMS = 6;
const MAX_CHECKLIST_TEXT = 90;
const MAX_V3_GAPS = 6;
const COORDINATE_GAP_SOURCE = 'coordinate';

function normalizeChecklistItem(raw, gapId, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const text = trim(raw.text, MAX_CHECKLIST_TEXT);
  if (!text) return null;
  const id = trim(raw.id, 40) || `${gapId}-c${idx + 1}`;
  return { id, text, done: !!raw.done };
}

// A client-built v3 (coordinate-delta) gap is round-tripped, not rebuilt — the
// server has no vectors to recompute deltas. We whitelist the compact v3 fields
// so the 48KB cap holds and no unexpected long strings survive.
function normalizeV3Gap(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dimIndex = Number(raw.dimIndex);
  if (!Number.isInteger(dimIndex) || dimIndex < 0 || dimIndex > 1000) return null;
  const label = trim(raw.label, 90);
  if (!label) return null;
  const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const checklist = (Array.isArray(raw.checklist) ? raw.checklist : [])
    .slice(0, MAX_CHECKLIST_ITEMS)
    .map((c, i) => normalizeChecklistItem(c, `dim-${dimIndex}`, i))
    .filter(Boolean);
  const logs = (Array.isArray(raw.logs) ? raw.logs : []).slice(0, 12).map((l, i) => ({
    id: trim(l?.id, 40) || `log-${dimIndex}-${i}`,
    text: trim(l?.text, 280),
    at: trim(l?.at, 40),
  })).filter((l) => l.text);
  const progress = clampScore(raw.progress);
  const status = ['open', 'in_progress', 'closed'].includes(raw.status)
    ? raw.status
    : (progress >= 100 ? 'closed' : progress > 0 ? 'in_progress' : 'open');
  return {
    id: trim(raw.id, 48) || `dim-${dimIndex}`,
    dimIndex,
    label,
    domain: trim(raw.domain, 32) || 'unknown',
    user: clampScore(raw.user),
    target: clampScore(raw.target),
    gap: clampScore(raw.gap),
    source: COORDINATE_GAP_SOURCE,
    checklist,
    checklistSource: raw.checklistSource === 'ai' ? 'ai' : 'fast',
    logs,
    manualComplete: !!raw.manualComplete,
    status,
    progress,
  };
}

function isV3FocusTracker(ft) {
  return !!(ft && ft.version === 3 && Array.isArray(ft.skillGaps)
    && ft.skillGaps.some((g) => g && g.source === COORDINATE_GAP_SOURCE));
}

const MAX_BRANCH_FOCUSES = 2;

// Round-trip the per-branch focus state (WS6). branchKey is 'spine' (main path)
// or a branch-root node id; waypointId must be a real node. Any unknown key/node
// is dropped so a stale save cannot resurrect a deleted branch. Both fields are
// whitelisted here AND in the client so neither side clobbers the other on save.
function normalizeBranchFocuses(rawList, nodeIds) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const branchKey = trim(raw.branchKey, 48);
    if (!branchKey || seen.has(branchKey)) continue;
    if (branchKey !== 'spine' && !nodeIds.has(branchKey)) continue;
    const waypointId = trim(raw.waypointId, 48);
    if (waypointId && waypointId !== 'trunk' && !nodeIds.has(waypointId)) continue;
    seen.add(branchKey);
    out.push({
      branchKey,
      waypointId: waypointId || null,
      updatedAt: trim(raw.updatedAt, 40) || new Date().toISOString(),
    });
    if (out.length >= MAX_BRANCH_FOCUSES) break;
  }
  return out;
}

function branchFocusFieldsFrom(existing, nodeIds) {
  const out = {};
  const branchFocuses = normalizeBranchFocuses(existing?.branchFocuses, nodeIds);
  if (branchFocuses.length) out.branchFocuses = branchFocuses;
  const activeBranchKey = trim(existing?.activeBranchKey, 48);
  if (activeBranchKey
    && (activeBranchKey === 'spine' || nodeIds.has(activeBranchKey))
    && (branchFocuses.some((b) => b.branchKey === activeBranchKey) || activeBranchKey === 'spine')) {
    out.activeBranchKey = activeBranchKey;
  }
  return out;
}

function preserveV3FocusTracker(tree, waypoint) {
  const existing = tree.focusTracker;
  const skillGaps = (existing.skillGaps || [])
    .map(normalizeV3Gap)
    .filter(Boolean)
    .slice(0, MAX_V3_GAPS);
  if (!skillGaps.length) return null;
  const nodeIds = new Set((tree.nodes || []).map((n) => n.id));
  return {
    ...tree,
    focusTracker: {
      version: 3,
      waypointId: waypoint.id,
      skillGaps,
      ...branchFocusFieldsFrom(existing, nodeIds),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function ensureFocusTrackerOnTree(tree) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return tree;
  const waypoint = nextWaypointOnPath(tree);
  if (!waypoint) return tree;

  // v3 (coordinate-delta) trackers are client-built from vectors the server
  // lacks — round-trip them instead of rebuilding, or the save path silently
  // downgrades every user back to waypoint-derived v1 gaps.
  if (isV3FocusTracker(tree.focusTracker)) {
    const preserved = preserveV3FocusTracker(tree, waypoint);
    if (preserved) return preserved;
  }

  const existing = tree.focusTracker;
  const waypointChanged = !existing || existing.waypointId !== waypoint.id;
  let skillGaps;

  if (waypointChanged || !existing?.skillGaps?.length) {
    const entries = deriveSkillGapEntries(tree, waypoint);
    const priorForLink = waypointChanged ? [] : (existing?.skillGaps || []);
    skillGaps = linkSkillGapsToSteps(waypoint, entries, priorForLink);
  } else {
    const entries = existing.skillGaps.map((g) => ({
      label: g.label,
      source: g.source || 'quiz',
    }));
    skillGaps = linkSkillGapsToSteps(waypoint, entries, existing.skillGaps);
  }
  skillGaps = syncSkillGapProgress(waypoint, skillGaps);

  const nodeIds = new Set((tree.nodes || []).map((n) => n.id));
  return {
    ...tree,
    focusTracker: {
      version: 1,
      waypointId: waypoint.id,
      skillGaps,
      ...branchFocusFieldsFrom(existing, nodeIds),
      updatedAt: new Date().toISOString(),
    },
  };
}

function shortTitleFromTitle(title) {
  const t = trim(title, 120);
  if (t.length <= 36) return t;
  const cut = t.slice(0, 36);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 16 ? cut.slice(0, lastSpace) : cut;
}

function isTruncatedShortTitle(shortTitle, fullTitle) {
  const s = trim(shortTitle, 120);
  const f = trim(fullTitle, 120);
  return !!(s && f && f.startsWith(s) && s.length < f.length);
}

function repairShortTitle(node) {
  if (!node || !node.title) return;
  const title = node.title;
  const st = node.shortTitle ? trim(node.shortTitle, 48) : '';
  if (!st || isTruncatedShortTitle(st, title)) {
    node.shortTitle = title.length <= 42 ? title : shortTitleFromTitle(title);
    return;
  }
  node.shortTitle = st;
}

function canonicalBranchDisplayTitle(title) {
  const t = trim(title, 120);
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

function canonicalizeBranchTitles(nodes) {
  (nodes || []).forEach((n) => {
    if (n.pathRole !== 'branch') return;
    const canon = canonicalBranchDisplayTitle(n.title);
    if (canon) {
      n.title = canon;
      n.shortTitle = canon;
    }
  });
}

function normalizePathRole(role) {
  const r = String(role || '').toLowerCase();
  return PATH_ROLES.has(r) ? r : null;
}

function inferPathRoles(nodes, activePath, decisions) {
  const pathSet = new Set(activePath || ['trunk']);
  const branchRoots = new Set();
  (decisions || []).forEach((d) => {
    (d.options || []).forEach((o) => {
      if (o.childNodeId) branchRoots.add(o.childNodeId);
    });
  });
  const branchIds = new Set();
  function collectBranch(rootId) {
    if (!rootId || branchIds.has(rootId)) return;
    branchIds.add(rootId);
    (nodes || []).filter((n) => n.parentId === rootId).forEach((n) => collectBranch(n.id));
  }
  branchRoots.forEach((id) => collectBranch(id));
  (nodes || []).forEach((n) => {
    if (n.branchId) branchIds.add(n.id);
  });

  (nodes || []).forEach((n) => {
    const explicit = normalizePathRole(n.pathRole);
    if (explicit === 'alternate') {
      n.pathRole = 'branch';
      return;
    }
    if (explicit) {
      n.pathRole = explicit;
      return;
    }
    if (branchIds.has(n.id)) {
      n.pathRole = 'branch';
    } else if (pathSet.has(n.id) || n.spineIndex) {
      n.pathRole = 'spine';
    } else if (branchRoots.has(n.id)) {
      n.pathRole = 'branch';
    } else {
      n.pathRole = 'branch';
    }
  });
}

function normalizeNode(raw, doneById, stepDoneMap, parentId, depth) {
  if (!raw || typeof raw !== 'object') return null;
  const title = trim(raw.title, 90);
  if (!title) return null;
  const id = trim(raw.id, 48) || nextNodeId('n');
  const d = Math.min(MAX_TREE_DEPTH, Math.max(1, Number(raw.depth) || depth || 1));
  const type = NODE_TYPES.has(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase()
    : 'waypoint';
  const done = doneById && doneById[id] !== undefined ? !!doneById[id] : !!raw.done;
  const node = {
    id,
    parentId: trim(raw.parentId, 48) || parentId || 'trunk',
    depth: d,
    type,
    title,
    shortTitle: trim(raw.shortTitle, 48) || shortTitleFromTitle(title),
    detail: trim(raw.detail, 400),
    whyItMatters: trim(raw.whyItMatters, 320),
    actionType: normalizeActionType(raw.actionType),
    status: ['active', 'completed', 'skipped', 'future'].includes(raw.status) ? raw.status : (done ? 'completed' : 'active'),
    done,
    confidence: readConfidence(raw),
    horizon: HORIZONS.has(raw.horizon) ? raw.horizon : (d <= 2 ? 'next_month' : d <= 3 ? 'next_semester' : 'longer_term'),
  };
  if (Array.isArray(raw.addressedGaps)) {
    node.addressedGaps = raw.addressedGaps.map((g) => trim(g, 120)).filter(Boolean).slice(0, 3);
  }
  if (raw.careerValue) node.careerValue = normalizeCareerValue(raw.careerValue);
  const steps = normalizeSteps(raw.steps, id, stepDoneMap);
  if (steps.length) node.steps = steps;
  if (raw.isMajor) node.isMajor = !!raw.isMajor;
  if (raw.spineIndex != null) node.spineIndex = Math.max(1, Math.min(SPINE_WAYPOINT_COUNT, Number(raw.spineIndex) || 1));
  if (raw.forkSpineIndex != null) node.forkSpineIndex = Math.max(1, Math.min(SPINE_WAYPOINT_COUNT, Number(raw.forkSpineIndex) || 1));
  if (raw.phaseId) node.phaseId = trim(raw.phaseId, 32);
  if (raw.phaseLabel) node.phaseLabel = trim(raw.phaseLabel, 60);
  if (raw.phaseColor && /^#[0-9a-fA-F]{3,8}$/.test(String(raw.phaseColor))) {
    node.phaseColor = String(raw.phaseColor).slice(0, 8);
  }
  if (raw.phaseEndsAt) node.phaseEndsAt = trim(raw.phaseEndsAt, 24);
  if (raw.branchId) node.branchId = trim(raw.branchId, 32);
  const pathRole = normalizePathRole(raw.pathRole);
  if (pathRole) node.pathRole = pathRole;
  const outcomes = normalizeOutcomes(raw.outcomes);
  if (outcomes && d <= 2) node.outcomes = outcomes;
  repairShortTitle(node);
  syncNodeDoneFromSteps(node);
  return node;
}

function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = trim(raw.id, 48) || nextNodeId('d');
  const nodeId = trim(raw.nodeId, 48);
  const prompt = trim(raw.prompt, 200);
  if (!nodeId || !prompt) return null;
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, 4).map((o) => ({
      id: trim(o.id, 48) || nextNodeId('opt'),
      label: trim(o.label, 80),
      childNodeId: trim(o.childNodeId, 48) || null,
    })).filter((o) => o.label)
    : [];
  if (options.length < 2) return null;
  return {
    id,
    nodeId,
    prompt,
    options,
    chosenOptionId: raw.chosenOptionId ? trim(raw.chosenOptionId, 48) : null,
  };
}

function normalizeTrunk(raw, careerName) {
  return {
    id: 'trunk',
    title: trim(raw?.title, 120) || `Working toward ${careerName || 'your target career'}`,
    subtitle: trim(raw?.subtitle, 120) || 'Where you are now',
    confidence: 5,
  };
}

export function extractSpineChain(nodes, activePath) {
  const pathOrder = (activePath || []).filter((id) => id !== 'trunk');
  const chain = [];
  let parentId = 'trunk';
  const used = new Set();

  for (let i = 0; i < SPINE_WAYPOINT_COUNT; i += 1) {
    const kids = childrenOf(nodes, parentId).filter((n) => !used.has(n.id));
    if (!kids.length) break;

    let next = kids.find((c) => c.pathRole === 'spine' && pathOrder.includes(c.id));
    if (!next) next = kids.find((c) => c.pathRole === 'spine');
    if (!next) next = kids.find((c) => pathOrder.includes(c.id));
    if (!next && kids.length === 1) next = kids[0];
    if (!next) {
      const sorted = kids.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      next = sorted[0];
    }
    if (!next) break;

    chain.push(next);
    used.add(next.id);
    parentId = next.id;
  }

  return chain;
}

function enforceSpineShape(nodes, decisions, activePath) {
  const trunkChildren = childrenOf(nodes, 'trunk');
  let spine = extractSpineChain(nodes, activePath);

  if (trunkChildren.length > 1) {
    const pathOrder = (activePath || []).filter((id) => id !== 'trunk');
    const used = new Set();
    const ordered = [];

    let s1 = spine[0]
      || trunkChildren.find((n) => n.id === pathOrder[0])
      || trunkChildren.find((n) => n.pathRole === 'spine')
      || trunkChildren.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];

    if (s1) {
      ordered.push(s1);
      used.add(s1.id);
    }

    const remainingTrunk = trunkChildren
      .filter((n) => !used.has(n.id))
      .sort((a, b) => {
        const ai = pathOrder.indexOf(a.id);
        const bi = pathOrder.indexOf(b.id);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return String(a.id).localeCompare(String(b.id));
      });

    while (ordered.length < SPINE_WAYPOINT_COUNT && remainingTrunk.length) {
      ordered.push(remainingTrunk.shift());
      used.add(ordered[ordered.length - 1].id);
    }

    let tail = ordered[ordered.length - 1];
    while (ordered.length < SPINE_WAYPOINT_COUNT && tail) {
      const kids = childrenOf(nodes, tail.id).filter((n) => !used.has(n.id) && n.pathRole !== 'branch');
      if (!kids.length) break;
      const next = kids.find((n) => n.pathRole === 'spine')
        || kids.find((n) => pathOrder.includes(n.id))
        || kids[0];
      ordered.push(next);
      used.add(next.id);
      tail = next;
    }

    spine = ordered.slice(0, SPINE_WAYPOINT_COUNT);
  }

  spine = spine.slice(0, SPINE_WAYPOINT_COUNT);

  let prevId = 'trunk';
  spine.forEach((node, idx) => {
    node.parentId = prevId;
    node.pathRole = 'spine';
    node.spineIndex = idx + 1;
    node.depth = idx + 1;
    prevId = node.id;
  });

  const explicitMajors = spine.filter((n) => n.isMajor);
  if (explicitMajors.length === MAJOR_WAYPOINT_COUNT) {
    spine.forEach((n) => { n.isMajor = explicitMajors.some((m) => m.id === n.id); });
  } else {
    spine.forEach((n, idx) => { n.isMajor = idx + 1 === 2 || idx + 1 === 4; });
  }

  const spineIds = new Set(spine.map((n) => n.id));
  const majorIds = new Set(spine.filter((n) => n.isMajor).map((n) => n.id));
  const branchRoots = new Set();
  (decisions || []).forEach((d) => {
    (d.options || []).forEach((o) => {
      if (o.childNodeId) branchRoots.add(o.childNodeId);
    });
  });

  const s1 = spine[0];
  (nodes || []).forEach((n) => {
    if (n.parentId === 'trunk' && n.id !== s1?.id) {
      if (spineIds.has(n.id)) return;
      const attach = spine[Math.min(spine.length - 1, 1)] || s1;
      n.parentId = attach ? attach.id : 'trunk';
      if (!n.pathRole || n.pathRole === 'spine') n.pathRole = 'branch';
    }
    if (spineIds.has(n.id)) return;
    if (branchRoots.has(n.id)) {
      n.pathRole = 'branch';
      const parent = nodes.find((p) => p.id === n.parentId);
      if (parent?.spineIndex) n.forkSpineIndex = parent.spineIndex;
      else if (parent?.isMajor) {
        const majorSpine = spine.find((s) => s.id === parent.id);
        if (majorSpine) n.forkSpineIndex = majorSpine.spineIndex;
      }
      return;
    }
    const parent = nodes.find((p) => p.id === n.parentId);
    if (parent && !majorIds.has(parent.id) && !branchRoots.has(n.id)) {
      const nearestMajor = spine.find((s) => s.isMajor) || spine[spine.length - 1];
      if (nearestMajor && n.parentId !== nearestMajor.id) {
        const onBranchChain = (() => {
          let cur = n.parentId;
          let guard = 0;
          while (cur && cur !== 'trunk' && guard < MAX_TREE_NODES) {
            guard += 1;
            if (branchRoots.has(cur) || majorIds.has(cur)) return true;
            const p = nodes.find((x) => x.id === cur);
            cur = p?.parentId;
          }
          return false;
        })();
        if (!onBranchChain && nearestMajor) {
          n.parentId = nearestMajor.id;
          n.pathRole = 'branch';
          n.forkSpineIndex = nearestMajor.spineIndex;
        }
      }
    }
  });

  return spine;
}

function pruneBranchNodes(nodes, spineChain, decisions) {
  const spineIds = new Set((spineChain || []).map((n) => n.id));
  const spineTipIndex = (spineChain || []).length;
  const majorById = new Map((spineChain || []).filter((n) => n.isMajor).map((n) => [n.id, n]));
  const branchRoots = new Set();
  (decisions || []).forEach((d) => {
    (d.options || []).forEach((o) => {
      if (o.childNodeId) branchRoots.add(o.childNodeId);
    });
  });

  const removeIds = new Set();

  function branchDepthFromRoot(nodeId, rootId) {
    let depth = 0;
    let cur = nodeId;
    let guard = 0;
    while (cur && cur !== rootId && guard < MAX_TREE_NODES) {
      guard += 1;
      const n = nodes.find((x) => x.id === cur);
      if (!n) break;
      depth += 1;
      cur = n.parentId;
    }
    return depth;
  }

  function collectDescendants(rootId, acc) {
    childrenOf(nodes, rootId).forEach((child) => {
      if (spineIds.has(child.id)) return;
      acc.add(child.id);
      collectDescendants(child.id, acc);
    });
  }

  majorById.forEach((major) => {
    const budget = maxBranchHops(major.spineIndex);
    const subtreeIds = new Set();
    collectDescendants(major.id, subtreeIds);

    subtreeIds.forEach((id) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const hops = branchDepthFromRoot(id, major.id);
      const worldDepth = (major.spineIndex || 1) + hops;
      if (hops > budget || worldDepth > SPINE_WAYPOINT_COUNT || nodeConfidence(node) < 2) {
        removeIds.add(id);
      }
    });
  });

  (nodes || []).forEach((n) => {
    if (spineIds.has(n.id)) return;
    if (n.parentId === 'trunk') removeIds.add(n.id);
    if (nodeConfidence(n) < 2 && !branchRoots.has(n.id)) removeIds.add(n.id);
  });

  let pruned = nodes.filter((n) => !removeIds.has(n.id));
  let changed = true;
  while (changed) {
    changed = false;
    pruned = pruned.filter((n) => {
      if (n.parentId === 'trunk' || spineIds.has(n.id)) return true;
      const parentExists = pruned.some((p) => p.id === n.parentId) || n.parentId === 'trunk';
      if (!parentExists) {
        changed = true;
        return false;
      }
      return true;
    });
  }

  return pruned;
}

function pruneExtraBranchRoots(nodes, spineChain, decisions) {
  const spineIds = new Set((spineChain || []).map((n) => n.id));
  const majors = (spineChain || []).filter((n) => n.isMajor);
  const removeIds = new Set();

  function collectDescendants(rootId, acc) {
    childrenOf(nodes, rootId).forEach((child) => {
      if (spineIds.has(child.id) || acc.has(child.id)) return;
      acc.add(child.id);
      collectDescendants(child.id, acc);
    });
  }

  majors.forEach((major) => {
    const allowedRoots = new Set();
    (decisions || [])
      .filter((d) => d.nodeId === major.id)
      .slice(0, 2)
      .forEach((d) => {
        (d.options || []).slice(0, 2).forEach((opt) => {
          if (opt.childNodeId) allowedRoots.add(opt.childNodeId);
        });
      });

    (nodes || []).forEach((n) => {
      if (n.parentId === major.id && !spineIds.has(n.id) && !allowedRoots.has(n.id)) {
        removeIds.add(n.id);
        collectDescendants(n.id, removeIds);
      }
    });

    allowedRoots.forEach((rootId) => {
      const kids = childrenOf(nodes, rootId)
        .filter((n) => !spineIds.has(n.id))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      kids.slice(1).forEach((k) => {
        removeIds.add(k.id);
        collectDescendants(k.id, removeIds);
      });
    });
  });

  let pruned = (nodes || []).filter((n) => !removeIds.has(n.id));
  let changed = true;
  while (changed) {
    changed = false;
    pruned = pruned.filter((n) => {
      if (n.parentId === 'trunk' || spineIds.has(n.id)) return true;
      const parentExists = pruned.some((p) => p.id === n.parentId) || n.parentId === 'trunk';
      if (!parentExists) {
        changed = true;
        return false;
      }
      return true;
    });
  }
  return pruned;
}

function assignConfidenceScores(nodes, spineChain) {
  const spineIds = new Set((spineChain || []).map((n) => n.id));

  (spineChain || []).forEach((node, idx) => {
    const score = Math.max(3, 5 - idx * 0.5);
    node.confidence = clampConfidence(score);
    delete node.certainty;
  });

  const majorNodes = (spineChain || []).filter((n) => n.isMajor);
  majorNodes.forEach((major) => {
    const forkBase = Math.max(2, nodeConfidence(major) - 1);
    const visited = new Set();
    function walkBranch(parentId, hop) {
      childrenOf(nodes, parentId).forEach((child) => {
        if (spineIds.has(child.id) || visited.has(child.id)) return;
        visited.add(child.id);
        const score = Math.max(1, forkBase - hop);
        child.confidence = clampConfidence(score);
        child.forkSpineIndex = major.spineIndex;
        child.pathRole = 'branch';
        delete child.certainty;
        walkBranch(child.id, hop + 1);
      });
    }
    walkBranch(major.id, 1);
  });

  (nodes || []).forEach((n) => {
    if (spineIds.has(n.id)) return;
    if (n.confidence == null && n.certainty != null) {
      n.confidence = clampConfidence(n.certainty);
    }
    if (n.confidence == null) n.confidence = 2;
    delete n.certainty;
  });
}

export function hasValidSpineShape(tree) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return false;
  const spine = extractSpineChain(tree.nodes || [], tree.activePath);
  if (spine.length !== SPINE_WAYPOINT_COUNT) return false;
  const trunkKids = childrenOf(tree.nodes, 'trunk');
  if (trunkKids.length !== 1) return false;
  const majors = spine.filter((n) => n.isMajor);
  if (majors.length !== MAJOR_WAYPOINT_COUNT) return false;
  const decisions = tree.decisions || [];
  if (decisions.length !== MAJOR_WAYPOINT_COUNT) return false;
  const majorIds = new Set(majors.map((n) => n.id));
  if (!decisions.every((d) => majorIds.has(d.nodeId))) return false;
  return true;
}

function computeActivePath(nodes, decisions) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const path = ['trunk'];
  let currentParent = 'trunk';
  const visited = new Set(['trunk']);
  let guard = 0;
  while (guard < MAX_TREE_NODES) {
    guard += 1;
    const children = (nodes || []).filter((n) => n.parentId === currentParent && !visited.has(n.id));
    if (!children.length) break;
    const decision = (decisions || []).find((d) => d.nodeId === currentParent);
    let next = null;
    if (decision && decision.chosenOptionId) {
      const opt = decision.options.find((o) => o.id === decision.chosenOptionId);
      if (opt?.childNodeId && byId.has(opt.childNodeId)) {
        next = byId.get(opt.childNodeId);
      }
    }
    if (!next) {
      next = children.find((c) => c.pathRole === 'spine')
        || children.find((c) => c.spineIndex)
        || children.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    }
    if (!next || visited.has(next.id)) break;
    path.push(next.id);
    visited.add(next.id);
    currentParent = next.id;
  }
  return path;
}

function decisionHasValidBranches(nodes, spineIds, decision) {
  if (!decision?.options || decision.options.length < 2) return false;
  return decision.options.every((opt) => {
    if (!opt.childNodeId) return false;
    const root = (nodes || []).find((n) => n.id === opt.childNodeId);
    if (!root || spineIds.has(root.id)) return false;
    return childrenOf(nodes, opt.childNodeId).some((n) => !spineIds.has(n.id));
  });
}

function synthesizeMissingBranches(nodes, spineChain, decisions, fitContext) {
  if (!spineChain || spineChain.length !== SPINE_WAYPOINT_COUNT) return;
  const majors = spineChain.filter((n) => n.isMajor);
  if (majors.length !== MAJOR_WAYPOINT_COUNT) return;

  const spineIds = new Set(spineChain.map((n) => n.id));

  majors.forEach((major) => {
    const existing = (decisions || []).find((d) => d.nodeId === major.id);
    if (existing && decisionHasValidBranches(nodes, spineIds, existing)) return;

    const staleIdx = decisions.findIndex((d) => d.nodeId === major.id);
    if (staleIdx >= 0) decisions.splice(staleIdx, 1);

    const majorTitle = major.title || 'this step';
    const options = [];
    const labels = ['Go deeper', 'Try another route'];

    // Use specific gaps from fitContext to create targeted branch waypoints
    const topGaps = (fitContext?.topGaps || []).slice(0, 4);
    const vectorGaps = (fitContext?.vectorGaps || []).slice(0, 4);
    const allGaps = [...new Set([...topGaps, ...vectorGaps.map(g => g.name).filter(Boolean)])];

    // Create specific branch titles based on actual gaps
    const gapForBranch0 = allGaps[0] || 'core skills';
    const gapForBranch1 = allGaps[1] || 'practical experience';
    const rootTitles = [
      `Deepen ${gapForBranch0}`,
      `Alternative: ${gapForBranch1}`
    ];
    const childTitles = [
      `Apply ${gapForBranch0} in practice`,
      `Build ${gapForBranch1} portfolio`
    ];

    for (let oi = 0; oi < 2; oi += 1) {
      if (nodes.length + 2 > MAX_TREE_NODES) break;
      const rootId = nextNodeId('br');
      const childId = nextNodeId('br');
      const majorConf = nodeConfidence(major);
      const rootDepth = (major.depth || 2) + 1;

      const rootNode = {
        id: rootId,
        parentId: major.id,
        depth: rootDepth,
        type: 'waypoint',
        pathRole: 'branch',
        title: rootTitles[oi],
        shortTitle: rootTitles[oi],
        detail: '',
        actionType: 'skill',
        confidence: Math.max(2, majorConf - 1),
        horizon: major.horizon || 'next_semester',
        done: false,
        status: 'active',
      };
      const childNode = {
        id: childId,
        parentId: rootId,
        depth: Math.min(MAX_TREE_DEPTH, rootDepth + 1),
        type: 'waypoint',
        pathRole: 'branch',
        title: childTitles[oi],
        shortTitle: childTitles[oi],
        detail: '',
        actionType: 'project',
        confidence: Math.max(2, majorConf - 2),
        horizon: major.horizon || 'longer_term',
        done: false,
        status: 'active',
      };

      const rootBackfill = backfillWaypointSteps(rootNode, fitContext);
      rootNode.whyItMatters = rootBackfill.whyItMatters;
      rootNode.addressedGaps = rootBackfill.addressedGaps;
      rootNode.careerValue = rootBackfill.careerValue;
      rootNode.steps = rootBackfill.steps;
      syncNodeDoneFromSteps(rootNode);

      const childBackfill = backfillWaypointSteps(childNode, fitContext);
      childNode.whyItMatters = childBackfill.whyItMatters;
      childNode.addressedGaps = childBackfill.addressedGaps;
      childNode.careerValue = childBackfill.careerValue;
      childNode.steps = childBackfill.steps;
      syncNodeDoneFromSteps(childNode);

      nodes.push(rootNode, childNode);
      options.push({
        id: nextNodeId('opt'),
        label: labels[oi],
        childNodeId: rootId,
      });
    }

    if (options.length === 2 && decisions.length < MAX_TREE_DECISIONS) {
      const norm = normalizeDecision({
        id: nextNodeId('d'),
        nodeId: major.id,
        prompt: `How do you want to approach "${majorTitle.slice(0, 80)}"?`,
        options,
      });
      if (norm) decisions.push(norm);
    }
  });
}

export function isValidRoadmapTree(roadmap) {
  if (!roadmap || typeof roadmap !== 'object' || roadmap.version !== ROADMAP_TREE_VERSION) return false;
  if (!roadmap.targetCareerSlug || !SLUG_RE.test(roadmap.targetCareerSlug)) return false;
  if (!roadmap.trunk || roadmap.trunk.id !== 'trunk') return false;
  if (!Array.isArray(roadmap.nodes) || roadmap.nodes.length < 1 || roadmap.nodes.length > MAX_TREE_NODES) return false;
  if (!Array.isArray(roadmap.activePath) || roadmap.activePath[0] !== 'trunk') return false;
  if (Array.isArray(roadmap.decisions) && roadmap.decisions.length > MAX_TREE_DECISIONS) return false;
  if (!roadmap.nodes.every((n) => n.id && n.parentId && n.title && n.depth >= 1 && n.depth <= MAX_TREE_DEPTH)) {
    return false;
  }
  const trunkChildren = childrenOf(roadmap.nodes, 'trunk');
  if (trunkChildren.length > 1) return false;
  return true;
}

export function normalizeRoadmapTree(raw, preserveFrom) {
  if (!raw || typeof raw !== 'object') return null;
  const slug = trim(raw.targetCareerSlug, 64).toLowerCase();
  const name = trim(raw.targetCareerName, 120);
  if (!slug || !SLUG_RE.test(slug) || !name) return null;

  const doneById = {
    ...collectTreeDoneMap(preserveFrom?.nodes),
    ...collectTreeDoneMap(raw.nodes),
  };
  const stepDoneMap = {
    ...collectStepDoneMap(preserveFrom?.nodes),
    ...collectStepDoneMap(raw.nodes),
  };
  if (preserveFrom?.decisions) {
    preserveFrom.decisions.forEach((d) => {
      if (d.chosenOptionId) doneById[`decision:${d.id}`] = d.chosenOptionId;
    });
  }

  const nodes = [];
  const list = Array.isArray(raw.nodes) ? raw.nodes : [];
  list.forEach((item) => {
    const n = normalizeNode(item, doneById, stepDoneMap, item.parentId, item.depth);
    if (n && nodes.length < MAX_TREE_NODES) nodes.push(n);
  });

  const decisions = [];
  (Array.isArray(raw.decisions) ? raw.decisions : []).forEach((d) => {
    const norm = normalizeDecision(d);
    if (norm && decisions.length < MAX_TREE_DECISIONS) {
      if (preserveFrom?.decisions) {
        const prev = preserveFrom.decisions.find((p) => p.id === norm.id);
        if (prev?.chosenOptionId) norm.chosenOptionId = prev.chosenOptionId;
      }
      decisions.push(norm);
    }
  });

  const fitContext = raw.fitContext && typeof raw.fitContext === 'object'
    ? {
      quizFitPercent: Number.isFinite(Number(raw.fitContext.quizFitPercent))
        ? Math.round(Number(raw.fitContext.quizFitPercent))
        : null,
      vectorFitScore: Number.isFinite(Number(raw.fitContext.vectorFitScore))
        ? Math.round(Number(raw.fitContext.vectorFitScore))
        : null,
      personalityFit: Number.isFinite(Number(raw.fitContext.personalityFit))
        ? Math.round(Number(raw.fitContext.personalityFit))
        : null,
      objectiveFit: Number.isFinite(Number(raw.fitContext.objectiveFit))
        ? Math.round(Number(raw.fitContext.objectiveFit))
        : null,
      preparedness: Number.isFinite(Number(raw.fitContext.preparedness))
        ? Math.round(Number(raw.fitContext.preparedness))
        : null,
      targetSoc: trim(raw.fitContext.targetSoc, 16) || null,
      topGaps: Array.isArray(raw.fitContext.topGaps)
        ? raw.fitContext.topGaps.map((g) => trim(g, 120)).filter(Boolean).slice(0, 5)
        : [],
      vectorGaps: Array.isArray(raw.fitContext.vectorGaps)
        ? raw.fitContext.vectorGaps.map((g) => ({
          index: Number.isFinite(Number(g.index)) ? Number(g.index) : 0,
          name: trim(g.name, 120),
          domain: trim(g.domain, 32) || 'unknown',
          gap: Number.isFinite(Number(g.gap)) ? Math.round(Number(g.gap) * 10) / 10 : 0,
        })).filter((g) => g.name).slice(0, 5)
        : [],
    }
    : null;

  const now = new Date().toISOString();
  let activePath = Array.isArray(raw.activePath) && raw.activePath.length
    ? raw.activePath.map((id) => trim(id, 48)).filter(Boolean)
    : computeActivePath(nodes, decisions);
  activePath = activePath[0] === 'trunk' ? activePath : ['trunk', ...activePath.filter((id) => id !== 'trunk')];

  const spineChain = enforceSpineShape(nodes, decisions, activePath);
  synthesizeMissingBranches(nodes, spineChain, decisions, fitContext);
  let prunedNodes = pruneExtraBranchRoots(nodes, spineChain, decisions);
  prunedNodes = pruneBranchNodes(prunedNodes, spineChain, decisions);
  assignConfidenceScores(prunedNodes, spineChain);
  inferPathRoles(prunedNodes, activePath, decisions);
  canonicalizeBranchTitles(prunedNodes);

  prunedNodes.forEach((n) => {
    if (nodeConfidence(n) <= 1) return;
    if (!n.steps || !n.steps.length) {
      const backfill = backfillWaypointSteps(n, fitContext);
      if (!n.whyItMatters) n.whyItMatters = backfill.whyItMatters;
      if (!n.addressedGaps?.length) n.addressedGaps = backfill.addressedGaps;
      if (!n.careerValue) n.careerValue = backfill.careerValue;
      n.steps = backfill.steps;
      syncNodeDoneFromSteps(n);
    }
  });

  activePath = computeActivePath(prunedNodes, decisions);

  const roadmap = {
    version: ROADMAP_TREE_VERSION,
    targetCareerSlug: slug,
    targetCareerName: name,
    generatedAt: trim(raw.generatedAt, 40) || now,
    summary: trim(raw.summary, 600),
    fitContext,
    trunk: normalizeTrunk(raw.trunk, name),
    nodes: prunedNodes,
    decisions,
    activePath: activePath[0] === 'trunk' ? activePath : ['trunk', ...activePath.filter((id) => id !== 'trunk')],
    updatedAt: now,
  };

  if (raw.roadmapMeta && typeof raw.roadmapMeta === 'object') {
    roadmap.roadmapMeta = {
      inputsHash: trim(raw.roadmapMeta.inputsHash, 64),
      focusSlug: trim(raw.roadmapMeta.focusSlug, 64),
      syncedAt: trim(raw.roadmapMeta.syncedAt, 40) || now,
    };
  }

  const withFocus = ensureFocusTrackerOnTree(
    raw.focusTracker ? { ...roadmap, focusTracker: raw.focusTracker } : roadmap,
  );

  const json = JSON.stringify(withFocus);
  if (json.length > ROADMAP_TREE_MAX_CHARS) return null;
  return isValidRoadmapTree(withFocus) ? withFocus : null;
}

export function migrateRoadmapV1ToV2(v1) {
  if (!v1 || v1.version !== 1 || !Array.isArray(v1.phases)) return null;
  const nodes = [];
  let prevParent = 'trunk';
  let depth = 1;
  const horizonMap = { this_month: 'next_month', next_semester: 'next_semester', longer_term: 'longer_term' };

  v1.phases.forEach((phase) => {
    (phase.actions || []).forEach((action) => {
      if (nodes.length >= MAX_TREE_NODES) return;
      const id = trim(action.id, 48) || nextNodeId('n');
      nodes.push({
        id,
        parentId: prevParent,
        depth,
        type: 'waypoint',
        title: trim(action.text, 120),
        detail: '',
        actionType: normalizeActionType(action.type),
        status: action.done ? 'completed' : 'active',
        done: !!action.done,
        confidence: Math.max(1, 6 - depth),
        horizon: horizonMap[phase.key] || 'longer_term',
      });
      prevParent = id;
      depth = Math.min(MAX_TREE_DEPTH, depth + 1);
    });
  });

  const activePath = ['trunk', ...nodes.filter((n) => n.done).map((n) => n.id)];
  if (activePath.length === 1 && nodes[0]) activePath.push(nodes[0].id);

  return normalizeRoadmapTree({
    version: ROADMAP_TREE_VERSION,
    targetCareerSlug: v1.targetCareerSlug,
    targetCareerName: v1.targetCareerName,
    generatedAt: v1.generatedAt,
    summary: v1.summary,
    fitContext: v1.fitContext,
    trunk: {
      title: `Path to ${v1.targetCareerName}`,
      subtitle: 'Migrated from checklist plan',
    },
    nodes,
    decisions: [],
    activePath,
    roadmapMeta: v1.roadmapMeta,
  });
}

export function derivePhaseChecklist(tree) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return null;
  const pathIds = new Set(tree.activePath || ['trunk']);
  const pathNodes = (tree.nodes || []).filter((n) => pathIds.has(n.id) || tree.activePath.includes(n.id));
  const ordered = (tree.activePath || [])
    .filter((id) => id !== 'trunk')
    .map((id) => pathNodes.find((n) => n.id === id) || (tree.nodes || []).find((n) => n.id === id))
    .filter(Boolean);

  const buckets = { this_month: [], next_semester: [], longer_term: [] };
  ordered.forEach((n) => {
    const key = n.horizon === 'next_month' ? 'this_month'
      : n.horizon === 'next_semester' ? 'next_semester' : 'longer_term';
    if (buckets[key].length < 5) {
      buckets[key].push({
        id: n.id,
        text: n.title,
        type: n.actionType || 'other',
        done: !!n.done,
      });
    }
  });

  return PHASE_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    actions: buckets[def.key].length ? buckets[def.key] : [{
      id: nextNodeId('m'),
      text: 'Review your tree plan',
      type: 'other',
      done: false,
    }],
  }));
}

export function roadmapAsPhases(roadmap) {
  if (!roadmap) return [];
  if (roadmap.version === ROADMAP_TREE_VERSION) return derivePhaseChecklist(roadmap) || [];
  return roadmap.phases || [];
}

export function roadmapProgressFromTree(tree) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return { done: 0, total: 0 };
  const interactive = (tree.nodes || []).filter((n) => nodeConfidence(n) > 1);
  let done = 0;
  let total = 0;
  interactive.forEach((n) => {
    const prog = nodeStepProgress(n);
    if (prog.total > 0) {
      done += prog.done;
      total += prog.total;
    } else {
      total += 1;
      if (n.done) done += 1;
    }
  });
  return { done, total };
}

export function nextWaypointOnPath(tree) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return null;
  const byId = new Map((tree.nodes || []).map((n) => [n.id, n]));
  for (const id of tree.activePath || []) {
    if (id === 'trunk') continue;
    const n = byId.get(id);
    if (n && !n.done) return n;
  }
  return null;
}

export function focusTrackerSummaryForCoach(tree) {
  if (!tree?.focusTracker?.skillGaps?.length) return '';
  const byId = new Map((tree.nodes || []).map((n) => [n.id, n]));
  const wp = byId.get(tree.focusTracker.waypointId);
  const lines = [
    `Waypoint: ${wp?.title || wp?.shortTitle || tree.focusTracker.waypointId}`,
  ];
  tree.focusTracker.skillGaps.forEach((g) => {
    lines.push(`- ${g.label} (${g.progress || 0}%, ${g.status || 'open'})`);
  });
  const recent = [];
  tree.focusTracker.skillGaps.forEach((g) => {
    (g.logs || []).slice(0, 2).forEach((l) => {
      recent.push(`${g.label}: ${l.text}`);
    });
  });
  if (recent.length) {
    lines.push('Recent progress logs:');
    recent.slice(0, 5).forEach((r) => lines.push(`- ${r}`));
  }
  return lines.join('\n');
}

export function compactTreeForPrompt(tree, { lite } = {}) {
  if (!tree || tree.version !== ROADMAP_TREE_VERSION) return {};
  if (lite) {
    const { done, total } = roadmapProgressFromTree(tree);
    return {
      targetCareerSlug: tree.targetCareerSlug,
      targetCareerName: tree.targetCareerName,
      summary: trim(tree.summary, 400),
      progress: `${done}/${total}`,
      activePath: (tree.activePath || []).slice(0, 8),
      openDecisions: (tree.decisions || []).filter((d) => !d.chosenOptionId).length,
    };
  }
  const pathSet = new Set(tree.activePath || []);
  const neighborhood = new Set(pathSet);
  (tree.nodes || []).forEach((n) => {
    if (pathSet.has(n.parentId) || pathSet.has(n.id)) neighborhood.add(n.id);
  });
  return {
    targetCareerSlug: tree.targetCareerSlug,
    targetCareerName: tree.targetCareerName,
    summary: trim(tree.summary, 400),
    trunk: tree.trunk,
    activePath: tree.activePath,
    nodes: (tree.nodes || []).filter((n) => neighborhood.has(n.id)).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      depth: n.depth,
      title: trim(n.title, 80),
      shortTitle: trim(n.shortTitle, 48),
      pathRole: n.pathRole,
      done: !!n.done,
      confidence: nodeConfidence(n),
      horizon: n.horizon,
      phaseLabel: n.phaseLabel,
    })),
    decisions: (tree.decisions || []).map((d) => ({
      id: d.id,
      nodeId: d.nodeId,
      prompt: trim(d.prompt, 120),
      chosenOptionId: d.chosenOptionId,
      options: d.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  };
}

export function sanitizeTreePatch(patch, current) {
  if (!patch || typeof patch !== 'object' || !current) return null;
  const out = {};
  if (typeof patch.summary === 'string' && patch.summary.trim()) {
    out.summary = trim(patch.summary, 600);
  }
  if (patch.fitContext) out.fitContext = patch.fitContext;
  if (Array.isArray(patch.nodes)) {
    const doneById = collectTreeDoneMap(current.nodes);
    out.nodes = patch.nodes
      .map((n) => normalizeNode(n, doneById, {}, n.parentId, n.depth))
      .filter(Boolean)
      .slice(0, MAX_TREE_NODES);
  }
  if (Array.isArray(patch.decisions)) {
    out.decisions = patch.decisions.map(normalizeDecision).filter(Boolean).slice(0, MAX_TREE_DECISIONS);
  }
  if (Array.isArray(patch.activePath)) {
    out.activePath = patch.activePath.map((id) => trim(id, 48)).filter(Boolean);
  }
  return Object.keys(out).length ? out : null;
}

export function mergeTreePatch(current, patch) {
  if (!current || !patch) return current;
  const out = { ...current };
  if (patch.summary) out.summary = patch.summary;
  if (patch.fitContext) {
    out.fitContext = { ...(current.fitContext || {}), ...patch.fitContext };
  }
  if (Array.isArray(patch.nodes) && patch.nodes.length) {
    const byId = new Map((current.nodes || []).map((n) => [n.id, { ...n }]));
    patch.nodes.forEach((n) => {
      const prev = byId.get(n.id);
      byId.set(n.id, prev ? { ...prev, ...n } : n);
    });
    out.nodes = [...byId.values()].slice(0, MAX_TREE_NODES);
  }
  if (Array.isArray(patch.decisions) && patch.decisions.length) {
    const byId = new Map((current.decisions || []).map((d) => [d.id, { ...d }]));
    patch.decisions.forEach((d) => {
      const prev = byId.get(d.id);
      byId.set(d.id, prev ? { ...prev, ...d } : d);
    });
    out.decisions = [...byId.values()].slice(0, MAX_TREE_DECISIONS);
  }
  if (Array.isArray(patch.activePath) && patch.activePath.length) {
    out.activePath = patch.activePath;
  }
  out.updatedAt = new Date().toISOString();
  if (current.roadmapMeta) out.roadmapMeta = current.roadmapMeta;
  return normalizeRoadmapTree(out, current) || out;
}

export function recomputeActivePathToNode(nodes, targetId) {
  if (!targetId || targetId === 'trunk') return ['trunk'];
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const chain = [];
  let cur = trim(targetId, 48);
  let guard = 0;
  while (cur && cur !== 'trunk' && guard < MAX_TREE_NODES) {
    guard += 1;
    if (!byId.has(cur)) break;
    chain.unshift(cur);
    cur = byId.get(cur).parentId;
  }
  return ['trunk', ...chain];
}

export function followTreePath(current, targetNodeId) {
  if (!current || current.version !== ROADMAP_TREE_VERSION || !targetNodeId) return current;
  const path = recomputeActivePathToNode(current.nodes, targetNodeId);
  const merged = {
    ...current,
    activePath: path,
    updatedAt: new Date().toISOString(),
  };
  
  // If the target node is on a branch (not spine), add that branch to branchFocuses
  const targetNode = merged.nodes?.find((n) => n.id === targetNodeId);
  if (targetNode && targetNode.pathRole === 'branch') {
    // Find the branch root by walking up to the first branch node
    const byId = new Map((merged.nodes || []).map((n) => [n.id, n]));
    let cur = targetNodeId;
    let branchRootId = targetNodeId;
    let guard = 0;
    while (cur && cur !== 'trunk' && guard < MAX_TREE_NODES) {
      guard += 1;
      const n = byId.get(cur);
      if (!n) break;
      if (n.pathRole === 'branch' && n.parentId) {
        const parent = byId.get(n.parentId);
        if (parent && parent.pathRole === 'spine') {
          branchRootId = n.id;
          break;
        }
      }
      cur = n.parentId;
    }
    
    const nodeIds = new Set((merged.nodes || []).map((n) => n.id));
    const existingBranchFocuses = normalizeBranchFocuses(merged.focusTracker?.branchFocuses || [], nodeIds);
    const branchExists = existingBranchFocuses.some((b) => b.branchKey === branchRootId);
    
    let newBranchFocuses;
    if (!branchExists) {
      if (existingBranchFocuses.length >= MAX_BRANCH_FOCUSES) {
        newBranchFocuses = existingBranchFocuses.filter((b) => b.branchKey === 'spine');
      } else {
        newBranchFocuses = [...existingBranchFocuses];
      }
      newBranchFocuses.push({
        branchKey: branchRootId,
        waypointId: targetNodeId,
        updatedAt: new Date().toISOString(),
      });
    } else {
      newBranchFocuses = existingBranchFocuses.map((b) => 
        b.branchKey === branchRootId 
          ? { ...b, waypointId: targetNodeId, updatedAt: new Date().toISOString() }
          : b
      );
    }
    
    if (!merged.focusTracker) merged.focusTracker = { version: 1, skillGaps: [] };
    merged.focusTracker = {
      ...merged.focusTracker,
      branchFocuses: newBranchFocuses,
      activeBranchKey: branchRootId,
    };
  }
  
  return normalizeRoadmapTree(merged, current) || merged;
}

export function chooseTreePath(current, decisionId, optionId) {
  if (!current || current.version !== ROADMAP_TREE_VERSION) return current;
  const decisions = (current.decisions || []).map((d) => {
    if (d.id !== decisionId) return d;
    return { ...d, chosenOptionId: optionId };
  });
  const merged = {
    ...current,
    decisions,
    updatedAt: new Date().toISOString(),
  };
  merged.activePath = computeActivePath(merged.nodes, merged.decisions);
  
  // Find the branch root that was chosen, so we can add it to branchFocuses
  const chosenDecision = decisions.find((d) => d.id === decisionId);
  const chosenOption = chosenDecision?.options?.find((o) => o.id === optionId);
  const chosenBranchRootId = chosenOption?.childNodeId;
  
  // If a branch was chosen, add it to branchFocuses (max 2: spine + one branch)
  if (chosenBranchRootId) {
    const nodeIds = new Set((merged.nodes || []).map((n) => n.id));
    const existingBranchFocuses = normalizeBranchFocuses(merged.focusTracker?.branchFocuses || [], nodeIds);
    const hasSpine = existingBranchFocuses.some((b) => b.branchKey === 'spine');
    const branchExists = existingBranchFocuses.some((b) => b.branchKey === chosenBranchRootId);
    
    let newBranchFocuses;
    if (!branchExists) {
      if (existingBranchFocuses.length >= MAX_BRANCH_FOCUSES) {
        // Replace the non-spine branch if we have 2 already
        newBranchFocuses = existingBranchFocuses.filter((b) => b.branchKey === 'spine');
      } else {
        newBranchFocuses = [...existingBranchFocuses];
      }
      newBranchFocuses.push({
        branchKey: chosenBranchRootId,
        waypointId: chosenBranchRootId,
        updatedAt: new Date().toISOString(),
      });
    } else {
      newBranchFocuses = existingBranchFocuses.map((b) => 
        b.branchKey === chosenBranchRootId 
          ? { ...b, waypointId: chosenBranchRootId, updatedAt: new Date().toISOString() }
          : b
      );
    }
    
    if (!merged.focusTracker) merged.focusTracker = { version: 1, skillGaps: [] };
    merged.focusTracker = {
      ...merged.focusTracker,
      branchFocuses: newBranchFocuses,
      activeBranchKey: chosenBranchRootId,
    };
  }
  
  return normalizeRoadmapTree(merged, current) || merged;
}

export function mergeTreeSplit(current, decisionId, optionId, subtree) {
  if (!current || current.version !== ROADMAP_TREE_VERSION) return current;
  const decisions = (current.decisions || []).map((d) => {
    if (d.id !== decisionId) return d;
    return { ...d, chosenOptionId: optionId };
  });
  const existingIds = new Set((current.nodes || []).map((n) => n.id));
  const newNodes = (subtree?.nodes || [])
    .filter((n) => n && n.id && !existingIds.has(n.id))
    .map((n) => normalizeNode(n, {}, {}, n.parentId, n.depth))
    .filter(Boolean);
  const nodes = [...(current.nodes || []), ...newNodes].slice(0, MAX_TREE_NODES);
  const newDecisions = (subtree?.decisions || [])
    .map(normalizeDecision)
    .filter(Boolean)
    .filter((d) => !(current.decisions || []).some((x) => x.id === d.id));
  const merged = {
    ...current,
    nodes,
    decisions: [...decisions, ...newDecisions].slice(0, MAX_TREE_DECISIONS),
    updatedAt: new Date().toISOString(),
  };
  merged.activePath = computeActivePath(merged.nodes, merged.decisions);
  
  // Track the newly split branch in focusTracker
  const chosenDecision = decisions.find((d) => d.id === decisionId);
  const chosenOption = chosenDecision?.options?.find((o) => o.id === optionId);
  const chosenBranchRootId = chosenOption?.childNodeId;
  
  if (chosenBranchRootId) {
    const nodeIds = new Set((merged.nodes || []).map((n) => n.id));
    const existingBranchFocuses = normalizeBranchFocuses(merged.focusTracker?.branchFocuses || [], nodeIds);
    const branchExists = existingBranchFocuses.some((b) => b.branchKey === chosenBranchRootId);
    
    let newBranchFocuses;
    if (!branchExists) {
      if (existingBranchFocuses.length >= MAX_BRANCH_FOCUSES) {
        newBranchFocuses = existingBranchFocuses.filter((b) => b.branchKey === 'spine');
      } else {
        newBranchFocuses = [...existingBranchFocuses];
      }
      newBranchFocuses.push({
        branchKey: chosenBranchRootId,
        waypointId: chosenBranchRootId,
        updatedAt: new Date().toISOString(),
      });
    } else {
      newBranchFocuses = existingBranchFocuses.map((b) => 
        b.branchKey === chosenBranchRootId 
          ? { ...b, waypointId: chosenBranchRootId, updatedAt: new Date().toISOString() }
          : b
      );
    }
    
    if (!merged.focusTracker) merged.focusTracker = { version: 1, skillGaps: [] };
    merged.focusTracker = {
      ...merged.focusTracker,
      branchFocuses: newBranchFocuses,
      activeBranchKey: chosenBranchRootId,
    };
  }
  
  return normalizeRoadmapTree(merged, current) || merged;
}

// Extend cap (WS4). The generator contract targets <=22 nodes total; we hold
// that ceiling here so an AI extend can never bloat a tree toward MAX_TREE_NODES.
export const MAX_EXTEND_NODES = 22;

// Walk trunk->tip down a branch, following parentId. Returns the deepest node on
// the chain rooted at branchNodeId (or branchNodeId itself if it has no branch
// children), used as the attach point for an extend.
function branchTipFrom(nodes, branchNodeId) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  let cur = byId.get(branchNodeId);
  if (!cur) return null;
  let guard = 0;
  while (guard < MAX_TREE_NODES) {
    guard += 1;
    const kids = (nodes || []).filter((n) => n.parentId === cur.id && n.pathRole === 'branch');
    if (!kids.length) break;
    // Deterministic: follow the lowest-id branch child so the tip is stable.
    cur = kids.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  }
  return cur;
}

// True when branchNodeId is on a committed/active branch: it (or an ancestor) is
// the chosen option's childNodeId of some decision, OR it sits on the activePath.
export function isNodeOnChosenBranch(tree, branchNodeId) {
  if (!tree || !branchNodeId) return false;
  const activeSet = new Set(tree.activePath || ['trunk']);
  if (activeSet.has(branchNodeId)) return true;
  const chosenRoots = new Set();
  (tree.decisions || []).forEach((d) => {
    if (!d.chosenOptionId) return;
    const opt = (d.options || []).find((o) => o.id === d.chosenOptionId);
    if (opt?.childNodeId) chosenRoots.add(opt.childNodeId);
  });
  if (!chosenRoots.size) return false;
  const byId = new Map((tree.nodes || []).map((n) => [n.id, n]));
  let cur = branchNodeId;
  let guard = 0;
  while (cur && cur !== 'trunk' && guard < MAX_TREE_NODES) {
    guard += 1;
    if (chosenRoots.has(cur)) return true;
    const n = byId.get(cur);
    if (!n) break;
    cur = n.parentId;
  }
  return false;
}

// Merge an AI-generated extension onto a committed branch tip. New nodes are
// re-parented onto the real tip (the AI's parentId hints are advisory), sanitized
// through normalizeNode, and capped at MAX_EXTEND_NODES. At most one new decision
// (a deeper fork) is accepted, and only if its option childNodeIds resolve to
// nodes we actually merged.
export function mergeTreeExtend(current, branchNodeId, subtree) {
  if (!current || current.version !== ROADMAP_TREE_VERSION) return current;
  const tip = branchTipFrom(current.nodes, branchNodeId);
  if (!tip) return current;

  const existingIds = new Set((current.nodes || []).map((n) => n.id));
  const rawNodes = Array.isArray(subtree?.nodes) ? subtree.nodes : [];
  const accepted = [];
  const acceptedIds = new Set();
  let prevParent = tip.id;

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== 'object') continue;
    if ((current.nodes || []).length + accepted.length >= MAX_EXTEND_NODES) break;
    if (raw.id && existingIds.has(raw.id)) continue;
    // Chain onto the tip unless this node names an already-accepted sibling as
    // parent (lets the AI branch a shallow fork inside the extension).
    const parentHint = trim(raw.parentId, 48);
    const parentId = acceptedIds.has(parentHint) ? parentHint : prevParent;
    const node = normalizeNode({ ...raw, parentId, pathRole: 'branch' }, {}, {}, parentId, raw.depth);
    if (!node) continue;
    node.pathRole = 'branch';
    accepted.push(node);
    acceptedIds.add(node.id);
    prevParent = node.id;
  }

  if (!accepted.length) return current;

  const nodes = [...(current.nodes || []), ...accepted].slice(0, MAX_TREE_NODES);
  const decisions = (current.decisions || []).slice();
  const rawDecisions = Array.isArray(subtree?.decisions) ? subtree.decisions : [];
  if (decisions.length < MAX_TREE_DECISIONS && rawDecisions.length) {
    const norm = normalizeDecision(rawDecisions[0]);
    if (norm
      && acceptedIds.has(norm.nodeId)
      && norm.options.every((o) => o.childNodeId && acceptedIds.has(o.childNodeId))
      && !decisions.some((d) => d.nodeId === norm.nodeId)) {
      norm.chosenOptionId = null;
      decisions.push(norm);
    }
  }

  const merged = {
    ...current,
    nodes,
    decisions: decisions.slice(0, MAX_TREE_DECISIONS),
    updatedAt: new Date().toISOString(),
  };
  merged.activePath = computeActivePath(merged.nodes, merged.decisions);
  return normalizeRoadmapTree(merged, current) || merged;
}

export function buildExtendPrompt({
  dossier,
  currentRoadmap,
  branchNode,
  careerName,
}) {
  const treeJson = JSON.stringify(compactTreeForPrompt(currentRoadmap, { lite: false }));
  const tipTitle = branchNode?.title || branchNode?.shortTitle || 'this branch';
  
  // Extract the specific gaps this branch addresses
  const branchGaps = (branchNode?.addressedGaps || []).join(', ') || 'core skills';
  const fitGaps = (currentRoadmap?.fitContext?.topGaps || []).slice(0, 4).join(', ') || 'key skills';

  return `You are a career planning coach for FlightWay. The student committed to a branch and wants to extend it with concrete next steps.

Career target: ${trim(careerName, 80)}
Branch to extend (its tip): "${trim(tipTitle, 90)}"
This branch addresses: ${branchGaps}
Overall top gaps: ${fitGaps}

Current tree:
${treeJson}

<dossier>
${trim(dossier, 2400)}
</dossier>

Generate ONLY the new nodes that extend this branch further. Return JSON:
{"nodes":[{"id":"ext1","parentId":"${branchNode?.id || 'trunk'}","depth":N,"type":"waypoint","title":"...","shortTitle":"<=36 chars","detail":"...","whyItMatters":"...","actionType":"class|project|skill|network|other","confidence":1-5,"horizon":"next_month|next_semester|longer_term","addressedGaps":["..."],"careerValue":"knowledge|network|resume|mixed","steps":[{"id":"ext1-st1","text":"...","done":false}]}],"decisions":[]}

Rules:
- Add 1-2 new nodes, chained one after another from the branch tip (pathRole is always "branch").
- Each node needs a short shortTitle (<=36 chars) for the map, plus 2-4 concrete "steps".
- Use the specific gaps above (${branchGaps}) to craft whyItMatters and addressedGaps.
- confidence decreases with depth; keep total tree size small.
- OPTIONALLY include exactly one new decision to open a deeper fork: its "nodeId" must be one of the new node ids, with 2 options whose "childNodeId" each points at a further new 1-node stub you also generate. Omit "decisions" (use []) if no natural fork exists.
- Concrete student actions only. No markdown.`;
}

export function collectDoneActionIdsFromTree(tree) {
  const ids = [];
  (tree?.nodes || []).forEach((n) => {
    if (n && n.id && n.done) ids.push(n.id);
  });
  return ids;
}

export function tryDeterministicTreePatch(userMessage, tree) {
  const MARK_DONE_RE = /\b(mark|marked|done|complete|completed|finished|checked off)\b/i;
  if (!tree || !isValidRoadmapTree(tree)) {
    return { updated: false, roadmap: tree, reason: 'no tree' };
  }
  const msg = String(userMessage || '').trim();
  if (!MARK_DONE_RE.test(msg)) {
    return { updated: false, roadmap: tree, reason: 'not mark-done' };
  }
  const needle = msg.replace(/.*?(mark|done|complete|finished)\s+/i, '').toLowerCase().trim();
  if (needle.length < 3) {
    return { updated: false, roadmap: tree, reason: 'no needle' };
  }
  const matches = (tree.nodes || []).filter((n) => {
    if (!n || n.done) return false;
    const t = String(n.title || '').toLowerCase();
    return t.includes(needle) || needle.includes(t.slice(0, 20));
  });
  if (matches.length !== 1) {
    return { updated: false, roadmap: tree, reason: matches.length ? 'ambiguous' : 'no match' };
  }
  const hit = matches[0];
  const patch = {
    nodes: [{ id: hit.id, title: hit.title, done: true, status: 'completed' }],
  };
  const merged = mergeTreePatch(tree, patch);
  return {
    updated: true,
    roadmap: merged,
    reason: 'deterministic mark done',
    reply: `Marked "${trim(hit.title, 80)}" as done.`,
    roadmapPatch: patch,
  };
}

export function buildTreePatchPrompt({
  dossier,
  currentRoadmap,
  userMessage,
  history,
  replyMaxChars = 240,
}) {
  const hist = (history || []).slice(-8)
    .map((m) => `${m.role}: ${trim(m.content, 600)}`)
    .join('\n');
  const treeJson = JSON.stringify(compactTreeForPrompt(currentRoadmap, { lite: false }));
  return `You are the FlightWay roadmap tree assistant. Reply with STRICT JSON only.

Dossier:
${trim(dossier, 1200)}

Roadmap tree (JSON):
${treeJson}

Recent chat:
${hist || '(none)'}

User: ${trim(userMessage, 600)}

Rules:
- "reply" max ${replyMaxChars} chars.
- "roadmapPatch" partial update: summary, nodes (by id), decisions, or activePath — or null.
- Mark nodes done:true when user completed a waypoint.
- Do NOT change targetCareerSlug or targetCareerName.
- For full career pivot, set roadmapPatch null.

Return:
{"intent":"question|update","reply":"...","roadmapPatch":null|{"summary":"...","nodes":[{"id":"...","done":true}]}}`;
}

export function buildSplitPrompt({
  dossier,
  currentRoadmap,
  decisionId,
  optionId,
  careerName,
}) {
  const decision = (currentRoadmap.decisions || []).find((d) => d.id === decisionId);
  const option = decision?.options?.find((o) => o.id === optionId);
  const treeJson = JSON.stringify(compactTreeForPrompt(currentRoadmap, { lite: false }));
  return `You are a career planning coach for FlightWay. The student chose a branch at a decision point.

Career target: ${careerName}
Decision: ${decision?.prompt || ''}
Chosen option: ${option?.label || ''}

Current tree:
${treeJson}

<dossier>
${trim(dossier, 2400)}
</dossier>

Generate ONLY the new subtree after this choice. Return JSON:
{"nodes":[{"id":"new1","parentId":"${option?.childNodeId || decision?.nodeId || 'trunk'}","depth":N,"type":"waypoint","title":"...","detail":"...","actionType":"class|project|skill|network|other","confidence":1-5,"horizon":"next_month|next_semester|longer_term","phaseId":"p1","phaseLabel":"...","phaseColor":"#hex","phaseEndsAt":"YYYY-MM-DD"}],"decisions":[]}

Rules:
- Add 3-6 new nodes extending from the chosen branch.
- confidence decreases with depth; max depth 5.
- Include at most 1 new unresolved decision if a natural fork exists.
- Concrete student actions only.`;
}
