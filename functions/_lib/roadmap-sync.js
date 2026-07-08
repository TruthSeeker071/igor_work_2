import { loadDossier } from '../_lib.js';
import {
  loadQuizProfile,
  saveQuizProfile,
  loadRoadmap,
  saveRoadmap,
  checkRateLimit,
  RATE_LIMIT_SYNC_MAX,
} from './auth.js';
import { computeInputsHash } from './portal-snapshot.js';
import { normalizeProfileAnswers, appendCareerSwitchToDossier } from './dossier-enrich.js';
import {
  isValidRoadmap,
  ROADMAP_FRESH_MS,
  attachRoadmapMeta,
} from './roadmap.js';
import { executeGenerateRoadmap } from './roadmap-generate.js';
import { runAlignmentCheck } from './profile-alignment.js';
import { validateOnetCareer, searchOnetCareersByTitle } from './onet/career-lookup.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Chat-driven pivots must resolve to a real catalog career or be rejected —
// UI sources stay permissive because legacy hub-bridge slugs are still valid
// upstream and always originate from real catalog rows.
const STRICT_CATALOG_SOURCES = new Set(['coach_pivot', 'deep_dive_pivot']);

async function resolveCatalogFocus(env, { slug, name, soc }) {
  const baseUrl = env?.SITE_URL || 'https://flightway.pages.dev';
  try {
    if (soc) {
      const bySoc = await validateOnetCareer(env, baseUrl, { soc });
      if (bySoc) return bySoc;
    }
    if (name) {
      const byName = await searchOnetCareersByTitle(env, baseUrl, name, 1);
      if (byName[0]?.soc) return byName[0];
    }
    if (slug) {
      const bySlug = await searchOnetCareersByTitle(env, baseUrl, slug.replace(/-/g, ' '), 1);
      if (bySlug[0]?.soc) return bySlug[0];
    }
  } catch (err) {
    console.warn('resolveCatalogFocus failed', err);
  }
  return null;
}

export const FOCUS_WEIGHTS = {
  build_roadmap: 90,
  portal_pick: 80,
  home_dropdown: 80,
  coach_pivot: 85,
  home_advisor: 85,
  deep_dive_pivot: 75,
  legacy_migration: 80,
  hub_view: 5,
  deep_dive_view: 5,
};

const SLUG_ALIASES = {
  'software-engineering': 'software-engineer',
  'data-science': 'data-scientist',
  'ux-design': 'ux-designer',
  'product-management': 'product-manager',
  'investment-banking': 'investment-banker',
  'financial-analysis': 'financial-analyst',
  'management-consulting': 'operations-manager',
  'marketing-strategy': 'content-strategist',
  'business-analytics': 'financial-analyst',
  'corporate-strategy': 'operations-manager',
  'healthcare-admin': 'nurse',
  'legal-operations': 'paralegal',
};

export function normalizeFocusSlug(slug) {
  const s = String(slug || '').trim().toLowerCase().slice(0, 64);
  if (!s) return '';
  return SLUG_ALIASES[s] || s;
}

export const RETARGET_WEIGHT_MIN = 75;
const MAX_FOCUS_HISTORY = 20;
const SWITCH_WINDOW_DAYS = 30;

export function countRecentCareerSwitches(quiz, windowDays = SWITCH_WINDOW_DAYS) {
  const hist = Array.isArray(quiz?.careerFocusHistory) ? quiz.careerFocusHistory : [];
  const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
  return hist.filter((e) => {
    const t = Date.parse(e?.at || '');
    return !Number.isNaN(t) && t >= cutoff;
  }).length;
}

function appendCareerFocusHistory(quiz, entry) {
  if (!quiz || !entry?.toSlug) return;
  const hist = Array.isArray(quiz.careerFocusHistory) ? quiz.careerFocusHistory.slice() : [];
  hist.push({
    fromSlug: String(entry.fromSlug || '').slice(0, 64),
    fromName: String(entry.fromName || '').slice(0, 120),
    toSlug: String(entry.toSlug).slice(0, 64),
    toName: String(entry.toName || '').slice(0, 120),
    source: String(entry.source || 'unknown').slice(0, 32),
    at: entry.at || new Date().toISOString(),
  });
  quiz.careerFocusHistory = hist.slice(-MAX_FOCUS_HISTORY);
}

export function computeRoadmapInputsHash(quiz, dossier = '') {
  return computeInputsHash(quiz, dossier);
}

export function slugifyCareerLabel(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'custom-career';
}

export function resolveCareerFocus(quiz, roadmap) {
  const focus = quiz?.careerFocus;
  if (
    focus?.slug
    && focus?.name
    && SLUG_RE.test(focus.slug)
    && (focus.weight || 0) >= RETARGET_WEIGHT_MIN
  ) {
    return {
      slug: focus.slug.toLowerCase(),
      name: String(focus.name).slice(0, 120),
      source: focus.source || 'careerFocus',
    };
  }

  if (roadmap?.targetCareerSlug && roadmap?.targetCareerName && isValidRoadmap(roadmap)) {
    return {
      slug: roadmap.targetCareerSlug,
      name: roadmap.targetCareerName,
      source: 'roadmap',
    };
  }

  const picks = quiz?.portalSnapshot?.careerPicks;
  if (Array.isArray(picks) && picks[0]?.name) {
    const name = String(picks[0].name).slice(0, 120);
    const slug = picks[0].slug && SLUG_RE.test(picks[0].slug)
      ? picks[0].slug.toLowerCase()
      : slugifyCareerLabel(name);
    if (SLUG_RE.test(slug)) {
      return { slug, name, source: 'portal_pick_bootstrap' };
    }
  }

  return null;
}

export async function recordCareerFocus(env, email, { slug, name, source, soc }) {
  const weight = FOCUS_WEIGHTS[source] || 0;
  let cleanSlug = normalizeFocusSlug(String(slug || '').trim().toLowerCase().slice(0, 64));
  let cleanName = String(name || '').trim().slice(0, 120);
  let cleanSoc = soc ? String(soc).trim().slice(0, 16) : null;
  if (!cleanSlug || !cleanName || !SLUG_RE.test(cleanSlug)) {
    return { focus: null, retarget: false, switchLogged: false };
  }

  // Resolve against the O*NET catalog: chat pivots are canonicalized or
  // rejected outright; UI sources keep their slug (legacy hub aliases must
  // stay matchable client-side) and just get the catalog SOC backfilled.
  const resolved = await resolveCatalogFocus(env, { slug: cleanSlug, name: cleanName, soc: cleanSoc });
  if (STRICT_CATALOG_SOURCES.has(source)) {
    if (!resolved) {
      return { focus: null, retarget: false, switchLogged: false, invalid: true };
    }
    cleanSlug = resolved.slug;
    cleanName = resolved.name;
    cleanSoc = resolved.soc;
  } else if (resolved && !cleanSoc) {
    cleanSoc = resolved.soc;
  }

  const [quizRaw, roadmap] = await Promise.all([
    loadQuizProfile(env, email),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const quiz = quizRaw || {};
  const priorResolved = resolveCareerFocus(quiz, roadmap);
  const priorSlug = priorResolved?.slug?.toLowerCase() || '';
  const current = quiz.careerFocus;
  const shouldReplace = !current
    || weight > (current.weight || 0)
    || (current.slug === cleanSlug && weight >= (current.weight || 0));

  const slugChanged = cleanSlug !== priorSlug;
  let switchLogged = false;
  const now = new Date().toISOString();

  if (shouldReplace || weight >= RETARGET_WEIGHT_MIN || !current) {
    quiz.careerFocus = {
      slug: cleanSlug,
      name: cleanName,
      source: source || 'unknown',
      weight,
      updatedAt: now,
    };
    if (cleanSoc) quiz.careerFocus.soc = cleanSoc;

    if (slugChanged) {
      appendCareerFocusHistory(quiz, {
        fromSlug: priorSlug,
        fromName: priorResolved?.name || '',
        toSlug: cleanSlug,
        toName: cleanName,
        source: source || 'unknown',
        at: now,
      });
      try {
        await appendCareerSwitchToDossier(env, email, {
          fromName: priorResolved?.name || 'none',
          toName: cleanName,
          source: source || 'unknown',
          at: now,
        });
        switchLogged = true;
      } catch (err) {
        console.warn('appendCareerSwitchToDossier failed', err);
      }
    }

    await saveQuizProfile(env, email, quiz);
  }

  let alignment = null;
  if (slugChanged) {
    try {
      alignment = await runAlignmentCheck(env, email, {
        autoSmall: true,
        autoProposeLarge: true,
        forceAfterSwitch: true,
      });
    } catch (alignErr) {
      console.warn('recordCareerFocus alignment failed', alignErr);
    }
  }

  return {
    focus: quiz.careerFocus,
    retarget: weight >= RETARGET_WEIGHT_MIN && slugChanged,
    careerFocusHistory: quiz.careerFocusHistory || [],
    switchCount: countRecentCareerSwitches(quiz),
    switchLogged,
    quiz,
    alignment,
  };
}

function roadmapIsFresh(roadmap, focus, inputsHash) {
  if (!roadmap || !isValidRoadmap(roadmap)) return false;
  const meta = roadmap.roadmapMeta;
  const slugMatch = roadmap.targetCareerSlug === focus.slug;
  if (!slugMatch) return false;

  if (meta?.inputsHash === inputsHash && meta?.focusSlug === focus.slug) {
    return true;
  }

  if (!meta?.inputsHash && roadmap.updatedAt) {
    const t = Date.parse(roadmap.updatedAt);
    if (!Number.isNaN(t) && (Date.now() - t) < ROADMAP_FRESH_MS) {
      return true;
    }
  }

  return false;
}

export async function maybeSyncRoadmap(env, email, opts = {}) {
  const force = !!opts.force;
  const reason = String(opts.reason || 'sync').slice(0, 64);

  const [quiz, dossierRaw, roadmap] = await Promise.all([
    opts.quiz !== undefined ? Promise.resolve(opts.quiz) : loadQuizProfile(env, email).catch(() => null),
    opts.dossier !== undefined ? Promise.resolve(opts.dossier) : loadDossier(env, email).catch(() => ''),
    opts.roadmap !== undefined ? Promise.resolve(opts.roadmap) : loadRoadmap(env, email).catch(() => null),
  ]);
  const dossier = dossierRaw || '';

  const focus = resolveCareerFocus(quiz, roadmap);
  if (!focus) {
    return {
      roadmap: roadmap || null,
      cached: true,
      retargeted: false,
      focus: null,
      focusUpdated: false,
      reason: 'no_focus',
    };
  }

  const inputsHash = computeRoadmapInputsHash(quiz || {}, dossier);

  if (!force && roadmapIsFresh(roadmap, focus, inputsHash)) {
    return {
      roadmap,
      cached: true,
      retargeted: false,
      focus,
      focusUpdated: false,
      reason: 'fresh',
    };
  }

  try {
    await checkRateLimit(env, `roadmap-sync:${email}`, { max: RATE_LIMIT_SYNC_MAX });
  } catch (err) {
    throw err;
  }

  const retargeted = !roadmap || roadmap.targetCareerSlug !== focus.slug;
  const profileBuildingAnswers = normalizeProfileAnswers(quiz?.profileBuilding?.answers);

  const quizFitBreakdown = roadmap?.fitContext && !retargeted
    ? {
      percent: roadmap.fitContext.quizFitPercent,
      gaps: roadmap.fitContext.topGaps || [],
      strengths: [],
    }
    : null;

  const generated = await executeGenerateRoadmap(env, email, {
    careerSlug: focus.slug,
    careerName: focus.name,
    dossier,
    quizScores: quiz?.scores || null,
    userName: quiz?.name || 'Student',
    quizFitBreakdown,
    resumeSummary: quiz?.resumeSummary || '',
    characterSummary: quiz?.characterSummary || '',
    customAnswers: Array.isArray(quiz?.customAnswers) ? quiz.customAnswers : [],
    profileBuildingAnswers: profileBuildingAnswers.length ? profileBuildingAnswers : undefined,
    userPivotNote: opts.userPivotNote || undefined,
    preserveFrom: !retargeted && roadmap ? roadmap : null,
    roadmapMeta: { inputsHash, focusSlug: focus.slug },
  });

  return {
    roadmap: generated,
    cached: false,
    retargeted,
    focus,
    focusUpdated: false,
    reason: retargeted ? 'retarget' : reason,
  };
}

export async function enrichRoadmapFocusKeywords(env, roadmap) {
  if (!roadmap || !env) return roadmap;
  const { enrichFocusTrackerKeywords } = await import('./focus-keywords.js');
  return enrichFocusTrackerKeywords(roadmap, env);
}

export async function attachMetaFromProfile(env, email, roadmap, opts = {}) {
  if (!roadmap) return roadmap;
  const [quiz, dossierRaw] = await Promise.all([
    opts.quiz !== undefined ? Promise.resolve(opts.quiz) : loadQuizProfile(env, email).catch(() => null),
    opts.dossier !== undefined ? Promise.resolve(opts.dossier) : loadDossier(env, email).catch(() => ''),
  ]);
  const focus = resolveCareerFocus(quiz, roadmap);
  const inputsHash = computeRoadmapInputsHash(quiz || {}, dossierRaw || '');
  const focusSlug = focus?.slug || roadmap.targetCareerSlug || '';
  return attachRoadmapMeta(roadmap, inputsHash, focusSlug);
}
