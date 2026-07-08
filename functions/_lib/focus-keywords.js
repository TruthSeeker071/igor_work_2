import { callGeminiJson } from './gemini-json.js';
import { nextWaypointOnPath } from './roadmap-tree.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'you',
  'this', 'that', 'from', 'into', 'about', 'skills', 'skill', 'core',
]);

export const KEYWORD_PROGRESS_PER_MATCH = 8;

export function buildFallbackKeywords(gapLabel, stepTexts = []) {
  const tokens = new Set();
  const addText = (text) => {
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .forEach((w) => tokens.add(w));
  };
  addText(gapLabel);
  stepTexts.forEach(addText);
  const labelWords = String(gapLabel || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  labelWords.forEach((w) => tokens.add(w));
  return Array.from(tokens).slice(0, 18);
}

export async function enrichGapKeywords(env, { gapLabel, careerName, waypointTitle, stepTexts }) {
  const fallback = buildFallbackKeywords(gapLabel, stepTexts);
  if (!env) return fallback;

  const stepsBlock = (stepTexts || []).slice(0, 6).map((t) => `- ${t}`).join('\n');
  const prompt = `You are helping a student track progress on a career skill gap.

Career: ${careerName || 'Target career'}
Waypoint: ${waypointTitle || 'Current focus'}
Skill gap: ${gapLabel}
Related steps:
${stepsBlock || '- (none listed)'}

Return JSON only: {"keywords": ["keyword1", "keyword2", ...]}
Generate 28-38 specific lowercase keywords and short phrases students might mention when logging progress.
Include: tools, courses, certifications, project types, verbs, deliverables, platforms, and skill-specific terms.
No sentences. No duplicates.`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.35,
      maxTokens: 900,
      jsonMode: true,
      label: 'focus-keywords',
      softFail: true,
    });
    const list = Array.isArray(raw?.keywords)
      ? raw.keywords.map((k) => String(k || '').trim().toLowerCase()).filter((k) => k.length > 1)
      : [];
    const merged = new Set([...list, ...fallback]);
    return Array.from(merged).slice(0, 40);
  } catch {
    return fallback;
  }
}

export async function enrichFocusTrackerKeywords(tree, env, opts = {}) {
  if (!tree?.focusTracker?.skillGaps?.length) return tree;
  const waypoint = nextWaypointOnPath(tree);
  if (!waypoint) return tree;

  const fast = !!opts.fast;
  // Fast keywords are tagged so a later background pass can upgrade them —
  // without the tag they satisfied the "has keywords" check and permanently
  // blocked Gemini enrichment.
  // v3 coordinate gaps carry an AI checklist, not keywords — skip them entirely
  // so enrichment never writes a keywords array onto a coordinate gap and mangles
  // its shape.
  const gapNeedsKeywords = (g) => g.source !== 'coordinate'
    && (!Array.isArray(g.keywords) || !g.keywords.length
      || (opts.upgrade && g.keywordsSource === 'fast'));
  const needsEnrich = tree.focusTracker.skillGaps.some(gapNeedsKeywords);
  if (!needsEnrich) return tree;

  const stepById = new Map((waypoint.steps || []).map((s) => [s.id, s]));
  const enrichOne = async (gap) => {
    if (!gapNeedsKeywords(gap)) return gap;
    const stepTexts = (gap.linkedStepIds || [])
      .map((id) => stepById.get(id)?.text)
      .filter(Boolean);
    const keywords = fast
      ? buildFallbackKeywords(gap.label, stepTexts)
      : await enrichGapKeywords(env, {
        gapLabel: gap.label,
        careerName: tree.targetCareerName,
        waypointTitle: waypoint.title || waypoint.shortTitle,
        stepTexts,
      });
    return {
      ...gap,
      keywords,
      keywordsSource: fast ? 'fast' : 'gemini',
      matchedKeywords: Array.isArray(gap.matchedKeywords) ? gap.matchedKeywords : [],
    };
  };

  const skillGaps = fast
    ? await Promise.all(tree.focusTracker.skillGaps.map(enrichOne))
    : [];
  if (!fast) {
    for (const gap of tree.focusTracker.skillGaps) {
      skillGaps.push(await enrichOne(gap));
    }
  }

  return {
    ...tree,
    focusTracker: {
      ...tree.focusTracker,
      skillGaps,
      updatedAt: new Date().toISOString(),
    },
  };
}
