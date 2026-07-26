import { formatProfileBuildingBlock } from './dossier-enrich.js';
import { callGeminiJson } from './gemini-json.js';
import { groundedJson, GROUNDING_TTL } from './gemini-grounded.js';
import { loadCareerAnalysis, saveRoadmap } from './auth.js';
import { loadUserBlob } from './user.js';
import { normalizeRoadmap, attachRoadmapMeta, ROADMAP_TREE_VERSION } from './roadmap.js';
import { migrateRoadmapV1ToV2, hasValidSpineShape, PLAIN_STYLE_RULES, sanitizeUntrustedText } from './roadmap-tree.js';
import { buildFitContext, loadDimensionRegistry } from './onet/gap-format.js';
import { computeVectorFitForSoc } from './onet/roadmap-vector-fit.js';
// schoolPromptBlock reaches these prompts through buildSurfacePrompt (0.2).
import { sanitizeSchoolName, resolveSchool } from './school.js';
import { buildSurfacePrompt } from './marco-persona.js';

const MAX_DOSSIER_LEN = 2800;
const MAX_MSG_LEN = 600;
const SPINE_RETRY_APPEND = '\n\nCRITICAL: Your previous output was rejected. You MUST include exactly 2 decisions[] entries (one per major spine node), each with exactly 2 options whose childNodeId points to a branch root that has at least 1 child node.';
// Per-request deadline for a single Gemini call, and an overall wall-clock
// budget for the whole generation. The client aborts at 120s (roadmap.js
// GENERATE_TIMEOUT_MS); we must return before that even in the worst case
// (2 spine attempts + a v1 fallback, each up to 2 model calls), so we stop
// launching new attempts past the budget and return the best roadmap we have.
// 40s: the richer 5-7-step waypoints roughly double the JSON payload, and a
// large output at flash-lite speeds can outrun a 30s cap.
const ROADMAP_GEMINI_TIMEOUT_MS = 40000;
const ROADMAP_BUDGET_MS = 85000;

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
  school,
}) {
  const fitBlock = quizFitBreakdown
    ? `Quiz fit: ${JSON.stringify({
      percent: quizFitBreakdown.percent,
      strengths: (quizFitBreakdown.strengths || []).slice(0, 3),
      gaps: (quizFitBreakdown.gaps || []).slice(0, 2),
    })}`
    : '';
  const customBlock = Array.isArray(customAnswers) && customAnswers.length
    ? customAnswers.slice(0, 6).map((a) => `- ${trimForPrompt(a.prompt, 160)}: ${trimForPrompt(a.answer, 200)}`).join('\n')
    : '';
  const profileBlock = formatProfileBuildingBlock(profileBuildingAnswers, trimForPrompt);

  return `${buildSurfacePrompt('roadmap-advice', { school })}

Create a personalized step-by-step roadmap for a student targeting "${sanitizeUntrustedText(careerName, 120)}" (slug: ${careerSlug}).

User: ${userName || 'Student'}
Top quiz scores: ${formatQuizScoresForPrompt(quizScores)}
${fitBlock}
${resumeSummary ? `Resume: ${trimForPrompt(resumeSummary, 240)}` : ''}
${characterSummary ? `Character: ${trimForPrompt(characterSummary, 200)}` : ''}
${customBlock ? `Student's answers to clarifying questions — WEIGHT THESE HEAVILY; they define the plan's timeline, weekly capacity, and approach:\n${customBlock}` : ''}
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
{"targetCareerSlug":"${careerSlug}","targetCareerName":"${sanitizeUntrustedText(careerName, 120).replace(/"/g, '\\"')}","summary":"...","fitContext":{"quizFitPercent":0,"topGaps":["..."]},"phases":[{"key":"this_month","label":"This month","actions":[{"id":"m1","text":"...","type":"class","done":false}]},{"key":"next_semester","label":"Next semester","actions":[...]},{"key":"longer_term","label":"Longer term","actions":[...]}]}`;
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
  school,
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
Top O*NET gaps, listed LARGEST GAP FIRST (use ONLY these in addressedGaps and fitContext.topGaps): ${gapNames.join(', ') || 'none listed'}
Order gap-closing waypoints to attack these gaps in the order listed — biggest coordinate gap earliest in the plan.`;
  }
  const socBlock = targetSoc ? `O*NET SOC: ${targetSoc}` : '';
  const customBlock = Array.isArray(customAnswers) && customAnswers.length
    ? customAnswers.slice(0, 6).map((a) => `- ${trimForPrompt(a.prompt, 160)}: ${trimForPrompt(a.answer, 200)}`).join('\n')
    : '';
  const profileBlock = formatProfileBuildingBlock(profileBuildingAnswers, trimForPrompt);

  return `${buildSurfacePrompt('roadmap-advice', { school })}

Create a personalized ROADMAP TREE for a student targeting "${sanitizeUntrustedText(careerName, 120)}" (slug: ${careerSlug}).

User: ${userName || 'Student'}
Top quiz scores: ${formatQuizScoresForPrompt(quizScores)}
${fitBlock}
${vectorBlock}
${socBlock}
${resumeSummary ? `Resume: ${trimForPrompt(resumeSummary, 240)}` : ''}
${characterSummary ? `Character: ${trimForPrompt(characterSummary, 200)}` : ''}
${customBlock ? `Student's answers to clarifying questions — WEIGHT THESE HEAVILY; they define the plan's timeline, weekly capacity, and approach:\n${customBlock}` : ''}
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
  - steps: MINIMUM 5 concrete actions per spine waypoint (aim for 6-7; a spine waypoint with fewer than 5 steps is INVALID), 4-6 per branch waypoint. Each waypoint is a SEMESTER-scale block with ONE main focus (a deliverable, a skill, or a domain of knowledge). Its steps must MIX action types around that focus — draw from: a specific reading (real book/paper title), a specific course (real course code at their school or named platform course), a club/community action (use a club from the dossier if one fits, else name a specific one to join — subject to the LOCATION CONSTRAINT above), a concrete deliverable/project, a networking action (who to email/meet), an assessment/milestone (exam score, competition, mock interview). Every step names its specific object (book title, course code, club name, artifact) — NEVER vague ("learn more", "practice X"). Every step carries kind: "reading" | "course" | "club" | "deliverable" | "network" | "milestone".

STRUCTURAL CONTRACT (mandatory):
1. Build a LINEAR SPINE FIRST — exactly 6 waypoints after trunk:
   s1.parentId = "trunk", s2.parentId = s1.id, s3.parentId = s2.id, s4.parentId = s3.id, s5.parentId = s4.id, s6.parentId = s5.id.
   NO other node may use parentId "trunk". pathRole "spine" on all s1-s6.
2. Mark isMajor: true on EXACTLY 2 spine nodes (recommend spine indices 2 and 4, i.e. s2 and s4).
3. For EACH major spine node, add ONE decisions[] entry (nodeId = that major's id) with EXACTLY 2 options.
   Each option childNodeId = first node of a pre-built branch chain (pathRole "branch").
4. Each branch: 1-2 nodes per option. Branch length budget: major at index i allows up to min(3, 6-i) hops.
    Branches NEVER extend past the spine tip (s6). Early majors → longer branches; late majors → shorter.
    Branch shortTitle must be very short (e.g. "Deepen Python", "Alternative: portfolio projects", "Apply ML in practice") — use the specific skill gaps from fitContext.topGaps/vectorGaps. Never use generic labels like "Explore depth" or "Alternative angle". The branch root node's title should name the specific gap (e.g., "Deepen quantitative skills") and its child should name a deliverable (e.g., "Build quantitative portfolio project").
  4b. Branch titles: The decision.options[].label MUST match the branch root node's shortTitle. Use the exact gap name from the Vector fit section above (e.g., "Deepen Python programming", "Alternative: SQL proficiency"). The branch root node's addressedGaps MUST include that same gap name.
  4c. CRITICAL — Branch steps must be CUSTOM-TAILORED to the specific skill gap and student context. Do NOT use generic templates. For each branch waypoint:
    - The root node (skill type): 4-6 concrete micro-actions to LEARN the specific gap (e.g., if gap is "Python programming", steps = "Complete Python for Data Science course on Coursera", "Build 3 data cleaning scripts with pandas", "Submit a pull request to an open-source Python project").
    - The child node (project type): 4-6 concrete micro-actions to APPLY the gap in a deliverable (e.g., "Design a portfolio project showcasing Python for [career-relevant domain]", "Write a technical blog post explaining your approach", "Present the project in a mock interview").
    - whyItMatters must explicitly connect the gap to the target career and student's current level.
    - addressedGaps on each branch node MUST include the specific gap name from the option label.
    - The steps should reference the student's dossier (school, year, location) and quiz strengths where relevant.
5. confidence on spine: s1=5, gentle decay (~0.5/step), minimum 3 at s6. Branch roots: spine confidence at fork minus 1; -1 per branch hop.
6. activePath: ["trunk","s1","s2","s3","s4","s5","s6"] — full default spine, NOT a side branch.
7. Total nodes ≤ 22. horizon: next_month | next_semester | longer_term; actionType: class | project | skill | network | other.
8. Project waypoints: phaseId, phaseLabel, phaseColor (#hex), phaseEndsAt. depth 1-2 spine nodes may include outcomes.roles and outcomes.firmTiers.
9. summary: 2-3 sentences.

Mini example shape (using vector gaps "Python programming" and "SQL proficiency"):
trunk → s1 → s2(major) → s3 → s4(major) → s5 → s6
              ├─ "Deepen Python programming" → "Apply Python in practice"
              └─ "Alternative: SQL proficiency"      └─ "Build SQL portfolio"
              ├─ "Deepen machine learning" → "Apply ML in practice"
              └─ "Alternative: data visualization" → "Build visualization portfolio"

Return ONLY JSON:
{"version":2,"targetCareerSlug":"${careerSlug}","targetCareerName":"${sanitizeUntrustedText(careerName, 120).replace(/"/g, '\\"')}","summary":"...","fitContext":{"quizFitPercent":0,"vectorFitScore":0,"personalityFit":0,"objectiveFit":0,"preparedness":0,"targetSoc":"","topGaps":["..."],"vectorGaps":[{"index":0,"name":"...","domain":"skills","gap":0}]},"trunk":{"id":"trunk","title":"...","subtitle":"Where you are now","confidence":5},"nodes":[{"id":"s1","parentId":"trunk","depth":1,"type":"waypoint","pathRole":"spine","shortTitle":"Take linear algebra","title":"Build a rock-solid foundation in linear algebra and statistics","whyItMatters":"Data science roles expect fluency in matrix math and probability; this closes your quantitative gap.","addressedGaps":["quantitative skills"],"careerValue":"knowledge","steps":[{"id":"s1a","text":"Enroll in MATH 20250 Abstract Linear Algebra this semester","done":false,"kind":"course"},{"id":"s1b","text":"Read chapters 1-6 of Axler's Linear Algebra Done Right","done":false,"kind":"reading"},{"id":"s1c","text":"Join the Data Science Society and attend 4 workshops","done":false,"kind":"club"},{"id":"s1d","text":"Build a matrix-methods cheat-sheet repo with worked examples","done":false,"kind":"deliverable"},{"id":"s1e","text":"Coffee-chat 2 upperclassmen who took the honors sequence","done":false,"kind":"network"},{"id":"s1f","text":"Score 85%+ on the final exam","done":false,"kind":"milestone"}],"confidence":5,"horizon":"next_month","actionType":"class"},...],"decisions":[{"id":"d1","nodeId":"s2","prompt":"...","options":[{"id":"opt1","label":"...","childNodeId":"branch2a"},{"id":"opt2","label":"...","childNodeId":"branch2c"}]},...],"activePath":["trunk","s1","s2","s3","s4","s5","s6"]}`
    + `\n\n${PLAIN_STYLE_RULES}`;
}

function treeV2Enabled(env) {
  return env?.ROADMAP_TREE_V2 !== 'false' && env?.ROADMAP_TREE_V2 !== '0';
}

async function callGenerateGemini(env, { prompt, temperature, maxTokens, timeoutMs, deadlineAt, research }) {
  const tokens = maxTokens || 2000;
  // Pillar W (Tier B): the first attempt may carry a fenced current-programs
  // brief (globally cached per career). Flag off / no research → groundedJson
  // passes straight through to callGeminiJson, byte-identical to before.
  const { result: groundedRaw, sources, fetchedAt, grounded } = await groundedJson(env, {
    research: research || [],
    freshnessTtl: GROUNDING_TTL.SEMI_STABLE,
    researchTimeoutMs: 6000,
    prompt,
    temperature: temperature ?? 0.55,
    maxTokens: tokens,
    jsonMode: true,
    label: 'career-roadmap',
    softFail: true,
    timeoutMs,
    deadlineAt,
  });
  let raw = groundedRaw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    // Provenance side-channel (fix plan 2.5): normalizeRoadmap strips unknown
    // keys, so the caller lifts _grounding off the raw before normalizing.
    if (grounded) raw._grounding = { sources: sources || [], fetchedAt: fetchedAt || null };
    return raw;
  }

  if (deadlineAt && Date.now() >= deadlineAt) {
    throw Object.assign(new Error('Could not generate a valid roadmap. Please try again.'), { _userFacing: true });
  }

  raw = await callGeminiJson(env, {
    prompt: `${prompt}\n\nReturn ONLY valid JSON.`,
    temperature: 0.2,
    maxTokens: tokens,
    jsonMode: true,
    label: 'career-roadmap-retry',
    softFail: true,
    timeoutMs,
    deadlineAt,
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
  const url = baseUrl || 'https://flightwayjacobprototype.pages.dev';
  const useTree = !forceV1 && treeV2Enabled(env);
  const genStartedAt = Date.now();

  const [cachedAnalysis, quiz, registry] = await Promise.all([
    analysisSnippet
      ? Promise.resolve(null)
      : loadCareerAnalysis(env, sessionEmail, careerSlug).catch(() => null),
    loadUserBlob(env, sessionEmail).catch(() => null),
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
    school: await resolveSchool(env, sessionEmail, { quiz }).catch(() => sanitizeSchoolName(quiz && quiz.school)),
  };

  const genDeadlineAt = genStartedAt + ROADMAP_BUDGET_MS;
  const outOfBudget = () => Date.now() > genDeadlineAt;

  let roadmap = null;
  let lastRoadmap = null; // best non-null result, even if it failed strict spine shape
  let groundingInfo = null; // provenance from the grounded first attempt (fix plan 2.5)
  const maxAttempts = useTree ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // A second spine attempt is the expensive one; skip it if we're out of
    // time and fall through to the cheaper v1 fallback / best-effort return.
    if (attempt > 0 && outOfBudget()) break;
    const retryNote = attempt > 0 && useTree ? SPINE_RETRY_APPEND : '';
    let raw;
    try {
      raw = await callGenerateGemini(env, {
        prompt: promptBuilder(promptArgs) + retryNote,
        // Without the school-scoped query the only campus programs in evidence
        // are other universities' — which is how a UChicago student got told to
        // join a Cornell fund. Query text stays identity-free so the gw: cache
        // is still shared by everyone at that school targeting that career.
        research: attempt === 0 && promptArgs?.careerName
          ? [
            `current courses, programs, competitions and certifications for a student becoming ${promptArgs.careerName}`,
            promptArgs.school
              ? `${promptArgs.school} student clubs, courses and campus programs for students pursuing ${promptArgs.careerName}`
              : `national student organizations and online programs open to any student pursuing ${promptArgs.careerName}`,
          ]
          : [],
        temperature: 0.55,
        maxTokens: useTree ? 6000 : 2000,
        timeoutMs: ROADMAP_GEMINI_TIMEOUT_MS,
        deadlineAt: genDeadlineAt,
      });
    } catch (err) {
      // Keep a best-effort roadmap from an earlier attempt over failing hard.
      if (lastRoadmap) break;
      throw err;
    }

    let preserve = preserveFrom?.targetCareerSlug === careerSlug ? preserveFrom : null;
    if (useTree && preserve?.version === 1) {
      preserve = migrateRoadmapV1ToV2(preserve);
    }

    if (raw?._grounding) groundingInfo = raw._grounding;
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

    if (roadmap) lastRoadmap = roadmap;
    if (roadmap && (!useTree || hasValidSpineShape(roadmap))) break;
    roadmap = null;
  }

  // v1 fallback: only worth attempting if we still have budget. Out of budget,
  // a best-effort tree (lastRoadmap) beats a 120s client timeout.
  if (!roadmap && useTree && !outOfBudget()) {
    let raw = null;
    try {
      raw = await callGenerateGemini(env, {
        prompt: buildGeneratePrompt(promptArgs),
        temperature: 0.55,
        maxTokens: 2000,
        timeoutMs: ROADMAP_GEMINI_TIMEOUT_MS,
        deadlineAt: genDeadlineAt,
      });
    } catch (err) {
      if (!lastRoadmap) throw err;
    }
    if (raw) {
      roadmap = normalizeRoadmap({
        ...raw,
        targetCareerSlug: careerSlug,
        targetCareerName: careerName,
        fitContext: mergeFitContext(raw.fitContext, serverFitContext),
      }, preserveFrom?.targetCareerSlug === careerSlug ? preserveFrom : null);
      if (roadmap && serverFitContext?.topGaps?.length) {
        roadmap.fitContext = mergeFitContext(roadmap.fitContext, serverFitContext);
      }
      if (roadmap) lastRoadmap = roadmap;
    }
  }

  if (!roadmap) roadmap = lastRoadmap;

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

  // Response-only provenance: attached AFTER saveRoadmap so the persisted doc
  // never carries it (normalizeRoadmap would strip it on the next save anyway)
  // — the client shows a one-time "as of" note for this generation.
  if (groundingInfo) withKeywords.grounding = groundingInfo;
  return withKeywords;
}
