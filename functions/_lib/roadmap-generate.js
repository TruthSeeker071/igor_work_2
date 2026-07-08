import { formatProfileBuildingBlock } from './dossier-enrich.js';
import { callGeminiJson } from './gemini-json.js';
import { loadCareerAnalysis, saveRoadmap, loadQuizProfile } from './auth.js';
import { normalizeRoadmap, attachRoadmapMeta, ROADMAP_TREE_VERSION } from './roadmap.js';
import { migrateRoadmapV1ToV2, hasValidSpineShape } from './roadmap-tree.js';
import { buildFitContext, loadDimensionRegistry } from './onet/gap-format.js';
import { computeVectorFitForSoc } from './onet/roadmap-vector-fit.js';

const MAX_DOSSIER_LEN = 2800;
const MAX_MSG_LEN = 600;
const SPINE_RETRY_APPEND = '\n\nCRITICAL: Your previous output was rejected. You MUST include exactly 2 decisions[] entries (one per major spine node), each with exactly 2 options whose childNodeId points to a branch root that has at least 1 child node.';

function trimForPrompt(s, max) {
  return String(s || '').trim().slice(0, max || 400);
}

function formatQuizScoresForPrompt(scores) {
  return Object.entries(scores || {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k}:${Math.round(v)}`)
    .join(', ');
}

export function buildGeneratePrompt({
  careerName,
  careerSlug,
  dossier,
  quizScores,
  userName,
  quizFitBreakdown,
  resumeSummary,
  characterSummary,
  customAnswers,
  profileBuildingAnswers,
  analysisSnippet,
  userPivotNote,
}) {
  const fitBlock = quizFitBreakdown
    ? `Quiz fit: ${JSON.stringify({
      percent: quizFitBreakdown.percent,
      strengths: (quizFitBreakdown.strengths || []).slice(0, 3),
      gaps: (quizFitBreakdown.gaps || []).slice(0, 2),
    })}`
    : '';
  const customBlock = Array.isArray(customAnswers) && customAnswers.length
    ? customAnswers.slice(0, 4).map((a) => `- ${trimForPrompt(a.prompt, 80)}: ${trimForPrompt(a.answer, 120)}`).join('\n')
    : '';
  const profileBlock = formatProfileBuildingBlock(profileBuildingAnswers, trimForPrompt);

  return `You are a career planning coach for FlightWay. Create a personalized step-by-step roadmap for a student targeting "${careerName}" (slug: ${careerSlug}).

User: ${userName || 'Student'}
Top quiz scores: ${formatQuizScoresForPrompt(quizScores)}
${fitBlock}
${resumeSummary ? `Resume: ${trimForPrompt(resumeSummary, 240)}` : ''}
${characterSummary ? `Character: ${trimForPrompt(characterSummary, 200)}` : ''}
${customBlock ? `Custom answers:\n${customBlock}` : ''}
${profileBlock}
${analysisSnippet ? `Career analysis notes: ${trimForPrompt(analysisSnippet, 400)}` : ''}
${userPivotNote ? `User request to incorporate: ${trimForPrompt(userPivotNote, MAX_MSG_LEN)}` : ''}

<dossier>
${trimForPrompt(dossier, MAX_DOSSIER_LEN)}
</dossier>

Rules:
- Output exactly 3 phases with keys: this_month, next_semester, longer_term (labels: This month, Next semester, Longer term).
- Each phase has 3-5 concrete actions (specific classes, projects, skills, conversations — not vague goals).
- Action types: class | project | skill | network | other
- Use plain student-friendly language. Personalize to their quiz fit, gaps, dossier constraints (school year, location, etc.).
- summary: 2-3 sentences overview.

Return ONLY JSON:
{"targetCareerSlug":"${careerSlug}","targetCareerName":"${careerName.replace(/"/g, '\\"')}","summary":"...","fitContext":{"quizFitPercent":0,"topGaps":["..."]},"phases":[{"key":"this_month","label":"This month","actions":[{"id":"m1","text":"...","type":"class","done":false}]},{"key":"next_semester","label":"Next semester","actions":[...]},{"key":"longer_term","label":"Longer term","actions":[...]}]}`;
}

export function buildGenerateTreePrompt({
  careerName,
  careerSlug,
  dossier,
  quizScores,
  userName,
  quizFitBreakdown,
  vectorFit,
  targetSoc,
  resumeSummary,
  characterSummary,
  customAnswers,
  profileBuildingAnswers,
  analysisSnippet,
  userPivotNote,
}) {
  const fitBlock = quizFitBreakdown
    ? `Quiz fit: ${JSON.stringify({
      percent: quizFitBreakdown.percent,
      strengths: (quizFitBreakdown.strengths || []).slice(0, 3),
      gaps: (quizFitBreakdown.gaps || []).slice(0, 2),
    })}`
    : '';
  let vectorBlock = '';
  if (vectorFit && typeof vectorFit === 'object') {
    const gapNames = (vectorFit.topGaps && vectorFit.topGaps.length)
      ? vectorFit.topGaps.map((g) => (typeof g === 'string' ? g : g.name)).filter(Boolean)
      : (vectorFit.vectorGaps || []).map((g) => g.name).filter(Boolean);
    vectorBlock = `Vector fit: personality ${vectorFit.personalityFit ?? '—'}%, objective ${vectorFit.objectiveFit ?? '—'}%, preparedness ${vectorFit.preparedness ?? '—'}%, overall ${vectorFit.vectorFitScore ?? vectorFit.fitScore ?? '—'}%.
Top O*NET gaps (use ONLY these in addressedGaps and fitContext.topGaps): ${gapNames.join(', ') || 'none listed'}`;
  }
  const socBlock = targetSoc ? `O*NET SOC: ${targetSoc}` : '';
  const customBlock = Array.isArray(customAnswers) && customAnswers.length
    ? customAnswers.slice(0, 4).map((a) => `- ${trimForPrompt(a.prompt, 80)}: ${trimForPrompt(a.answer, 120)}`).join('\n')
    : '';
  const profileBlock = formatProfileBuildingBlock(profileBuildingAnswers, trimForPrompt);

  return `You are a career planning coach for FlightWay. Create a personalized ROADMAP TREE for a student targeting "${careerName}" (slug: ${careerSlug}).

User: ${userName || 'Student'}
Top quiz scores: ${formatQuizScoresForPrompt(quizScores)}
${fitBlock}
${vectorBlock}
${socBlock}
${resumeSummary ? `Resume: ${trimForPrompt(resumeSummary, 240)}` : ''}
${characterSummary ? `Character: ${trimForPrompt(characterSummary, 200)}` : ''}
${customBlock ? `Custom answers:\n${customBlock}` : ''}
${profileBlock}
${analysisSnippet ? `Career analysis notes: ${trimForPrompt(analysisSnippet, 400)}` : ''}
${userPivotNote ? `User request: ${trimForPrompt(userPivotNote, MAX_MSG_LEN)}` : ''}

<dossier>
${trimForPrompt(dossier, MAX_DOSSIER_LEN)}
</dossier>

Rules:
- version is 2 (tree, not a flat checklist).
- trunk = where the student is now (year, school, current situation).
- Every node needs shortTitle (max 28 chars, 2-6 words, imperative canvas label) AND title (max 90 chars for detail panel; put extra detail in whyItMatters). If title is 42 characters or fewer, set shortTitle equal to title. Otherwise shortTitle must be a shorter 3-6 word label — never a truncated copy of title.
- confidence (1-5): hypothetical risk score — higher on early spine, lower on branches. NOT AI uncertainty.
- Every interactive node also needs:
  - whyItMatters: 1-2 sentences — what this waypoint is, which skill gaps it addresses, how it advances the career (knowledge, network, or resume deliverable).
  - addressedGaps: 1-2 strings from fitContext.topGaps / O*NET vector gaps this waypoint helps close (or [] if none fit).
  - careerValue: "knowledge" | "network" | "resume" | "mixed"
  - steps: 3-5 concrete micro-actions the student can check off (specific classes, projects, emails, deliverables — NOT vague).

STRUCTURAL CONTRACT (mandatory):
1. Build a LINEAR SPINE FIRST — exactly 6 waypoints after trunk:
   s1.parentId = "trunk", s2.parentId = s1.id, s3.parentId = s2.id, s4.parentId = s3.id, s5.parentId = s4.id, s6.parentId = s5.id.
   NO other node may use parentId "trunk". pathRole "spine" on all s1-s6.
2. Mark isMajor: true on EXACTLY 2 spine nodes (recommend spine indices 2 and 4, i.e. s2 and s4).
3. For EACH major spine node, add ONE decisions[] entry (nodeId = that major's id) with EXACTLY 2 options.
   Each option childNodeId = first node of a pre-built branch chain (pathRole "branch").
4. Each branch: 1-2 nodes per option. Branch length budget: major at index i allows up to min(3, 6-i) hops.
   Branches NEVER extend past the spine tip (s6). Early majors → longer branches; late majors → shorter.
   Branch shortTitle must be very short (e.g. "Explore depth", "Alternative angle", "Further development") — never prefix with the parent spine title.
5. confidence on spine: s1=5, gentle decay (~0.5/step), minimum 3 at s6. Branch roots: spine confidence at fork minus 1; -1 per branch hop.
6. activePath: ["trunk","s1","s2","s3","s4","s5","s6"] — full default spine, NOT a side branch.
7. Total nodes ≤ 22. horizon: next_month | next_semester | longer_term; actionType: class | project | skill | network | other.
8. Project waypoints: phaseId, phaseLabel, phaseColor (#hex), phaseEndsAt. depth 1-2 spine nodes may include outcomes.roles and outcomes.firmTiers.
9. summary: 2-3 sentences.

Mini example shape:
trunk → s1 → s2(major) → s3 → s4(major) → s5 → s6
              ├─ branch2a → branch2b          ├─ branch4a
              └─ branch2c                       └─ branch4b

Return ONLY JSON:
{"version":2,"targetCareerSlug":"${careerSlug}","targetCareerName":"${careerName.replace(/"/g, '\\"')}","summary":"...","fitContext":{"quizFitPercent":0,"vectorFitScore":0,"personalityFit":0,"objectiveFit":0,"preparedness":0,"targetSoc":"","topGaps":["..."],"vectorGaps":[{"index":0,"name":"...","domain":"skills","gap":0}]},"trunk":{"id":"trunk","title":"...","subtitle":"Where you are now","confidence":5},"nodes":[{"id":"s1","parentId":"trunk","depth":1,"type":"waypoint","pathRole":"spine","shortTitle":"Take linear algebra","title":"Build a rock-solid foundation in linear algebra and statistics","whyItMatters":"Data science roles expect fluency in matrix math and probability; this closes your quantitative gap.","addressedGaps":["quantitative skills"],"careerValue":"knowledge","steps":[{"id":"s1a","text":"Enroll in linear algebra this semester","done":false},{"id":"s1b","text":"Complete 8 weekly problem sets","done":false},{"id":"s1c","text":"Score 85%+ on the final exam","done":false}],"confidence":5,"horizon":"next_month","actionType":"class"},...],"decisions":[{"id":"d1","nodeId":"s2","prompt":"...","options":[{"id":"opt1","label":"...","childNodeId":"branch2a"},{"id":"opt2","label":"...","childNodeId":"branch2c"}]},...],"activePath":["trunk","s1","s2","s3","s4","s5","s6"]}`;
}

function treeV2Enabled(env) {
  return env?.ROADMAP_TREE_V2 !== 'false' && env?.ROADMAP_TREE_V2 !== '0';
}

async function callGenerateGemini(env, { prompt, temperature, maxTokens }) {
  const tokens = maxTokens || 2000;
  let raw = await callGeminiJson(env, {
    prompt,
    temperature: temperature ?? 0.55,
    maxTokens: tokens,
    jsonMode: true,
    label: 'career-roadmap',
    softFail: true,
  });
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  raw = await callGeminiJson(env, {
    prompt: `${prompt}\n\nReturn ONLY valid JSON.`,
    temperature: 0.2,
    maxTokens: tokens,
    jsonMode: true,
    label: 'career-roadmap-retry',
    softFail: true,
  });
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  throw Object.assign(new Error('Could not generate a valid roadmap. Please try again.'), { _userFacing: true });
}

function mergeFitContext(geminiCtx, serverCtx) {
  if (!serverCtx) return geminiCtx || null;
  const merged = { ...(geminiCtx || {}), ...serverCtx };
  if (serverCtx.topGaps?.length) merged.topGaps = serverCtx.topGaps;
  if (serverCtx.vectorGaps?.length) merged.vectorGaps = serverCtx.vectorGaps;
  if (serverCtx.targetSoc) merged.targetSoc = serverCtx.targetSoc;
  if (serverCtx.vectorFitScore != null) merged.vectorFitScore = serverCtx.vectorFitScore;
  if (serverCtx.personalityFit != null) merged.personalityFit = serverCtx.personalityFit;
  if (serverCtx.objectiveFit != null) merged.objectiveFit = serverCtx.objectiveFit;
  if (serverCtx.preparedness != null) merged.preparedness = serverCtx.preparedness;
  return merged;
}

export async function executeGenerateRoadmap(env, sessionEmail, {
  careerSlug,
  careerName,
  dossier,
  quizScores,
  userName,
  quizFitBreakdown,
  vectorFit,
  targetSoc,
  baseUrl,
  resumeSummary,
  characterSummary,
  customAnswers,
  profileBuildingAnswers,
  analysisSnippet,
  userPivotNote,
  preserveFrom,
  roadmapMeta,
  forceV1,
  waitUntil,
}) {
  const url = baseUrl || 'https://flightway.pages.dev';
  const useTree = !forceV1 && treeV2Enabled(env);
  const genStartedAt = Date.now();

  const [cachedAnalysis, quiz, registry] = await Promise.all([
    analysisSnippet
      ? Promise.resolve(null)
      : loadCareerAnalysis(env, sessionEmail, careerSlug).catch(() => null),
    loadQuizProfile(env, sessionEmail).catch(() => null),
    loadDimensionRegistry(url).catch(() => null),
  ]);
  let snippet = analysisSnippet || '';
  if (!snippet && cachedAnalysis?.payload?.overview) snippet = cachedAnalysis.payload.overview;

  const promptBuilder = useTree ? buildGenerateTreePrompt : buildGeneratePrompt;

  let resolvedSoc = targetSoc ? String(targetSoc).trim().slice(0, 16) : null;
  let resolvedVectorFit = vectorFit && typeof vectorFit === 'object' ? vectorFit : null;
  if (resolvedSoc && !resolvedVectorFit && quiz) {
    resolvedVectorFit = await computeVectorFitForSoc(env, url, quiz, resolvedSoc);
  }
  const serverFitContext = buildFitContext(resolvedVectorFit, quizFitBreakdown, resolvedSoc, registry);
  const promptVectorFit = resolvedVectorFit ? {
    ...resolvedVectorFit,
    vectorGaps: serverFitContext.vectorGaps,
    topGaps: serverFitContext.topGaps,
    vectorFitScore: serverFitContext.vectorFitScore,
  } : (serverFitContext.topGaps.length ? serverFitContext : null);

  const promptArgs = {
    careerName,
    careerSlug,
    dossier,
    quizScores,
    userName,
    quizFitBreakdown,
    vectorFit: promptVectorFit,
    targetSoc: resolvedSoc,
    resumeSummary,
    characterSummary,
    customAnswers,
    profileBuildingAnswers,
    analysisSnippet: snippet,
    userPivotNote,
  };

  let roadmap = null;
  const maxAttempts = useTree ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryNote = attempt > 0 && useTree ? SPINE_RETRY_APPEND : '';
    const raw = await callGenerateGemini(env, {
      prompt: promptBuilder(promptArgs) + retryNote,
      temperature: 0.55,
      maxTokens: useTree ? 3500 : 2000,
    });

    let preserve = preserveFrom?.targetCareerSlug === careerSlug ? preserveFrom : null;
    if (useTree && preserve?.version === 1) {
      preserve = migrateRoadmapV1ToV2(preserve);
    }

    roadmap = normalizeRoadmap({
      ...raw,
      version: useTree ? ROADMAP_TREE_VERSION : undefined,
      targetCareerSlug: careerSlug,
      targetCareerName: careerName,
      fitContext: mergeFitContext(raw.fitContext, serverFitContext),
    }, preserve);

    if (roadmap && serverFitContext?.topGaps?.length) {
      roadmap.fitContext = mergeFitContext(roadmap.fitContext, serverFitContext);
    }

    if (roadmap && (!useTree || hasValidSpineShape(roadmap))) break;
    roadmap = null;
  }

  if (!roadmap && useTree) {
    const raw = await callGenerateGemini(env, {
      prompt: buildGeneratePrompt(promptArgs),
      temperature: 0.55,
      maxTokens: 2000,
    });
    roadmap = normalizeRoadmap({
      ...raw,
      targetCareerSlug: careerSlug,
      targetCareerName: careerName,
      fitContext: mergeFitContext(raw.fitContext, serverFitContext),
    }, preserveFrom?.targetCareerSlug === careerSlug ? preserveFrom : null);
    if (roadmap && serverFitContext?.topGaps?.length) {
      roadmap.fitContext = mergeFitContext(roadmap.fitContext, serverFitContext);
    }
  }

  if (!roadmap) {
    throw Object.assign(new Error('Could not generate a valid roadmap. Please try again.'), { _userFacing: true });
  }

  const toSave = roadmapMeta
    ? attachRoadmapMeta(roadmap, roadmapMeta.inputsHash, roadmapMeta.focusSlug, {
      vectorInputsHash: roadmapMeta.vectorInputsHash || null,
      vectorSchemaId: roadmapMeta.vectorSchemaId || null,
    })
    : roadmap;

  const { enrichFocusTrackerKeywords } = await import('./focus-keywords.js');
  const withKeywords = await enrichFocusTrackerKeywords(toSave, env, { fast: true });

  await saveRoadmap(env, sessionEmail, withKeywords);

  const genMs = Date.now() - genStartedAt;
  if (genMs > 30000) {
    console.warn('[roadmap-generate] slow generation', {
      ms: genMs,
      soc: resolvedSoc || null,
      slug: careerSlug,
      tree: useTree,
    });
  }

  // The fast pass above only builds heuristic keywords so generation stays
  // quick; upgrade them with the Gemini pass in the background. Re-load the
  // roadmap inside the task so we never clobber progress the user saved in
  // the meantime.
  if (typeof waitUntil === 'function') {
    waitUntil((async () => {
      try {
        const { loadRoadmap } = await import('./auth.js');
        const fresh = await loadRoadmap(env, sessionEmail);
        if (!fresh || fresh.targetCareerSlug !== withKeywords.targetCareerSlug) return;
        const enriched = await enrichFocusTrackerKeywords(fresh, env, { upgrade: true });
        if (enriched !== fresh) await saveRoadmap(env, sessionEmail, enriched);
      } catch (err) {
        console.warn('background focus-keyword enrichment failed', err);
      }
    })());
  }

  return withKeywords;
}
