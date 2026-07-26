import {
  originFromEnv,
  loadDossier,
  saveDossier,
  buildSeedDossier,
  isValidDossier,
  DOSSIER_VERSION_MARKER,
  geminiConfigFromEnv,
  geminiGenerateContent,
  geminiTextFromResponse,
} from './_lib.js';
import { authPreflight, authJsonResponse, authErrorResponse, optionalSession, checkRateLimit, hashedIpKey } from './_lib/auth.js';
import { maybeSyncRoadmap } from './_lib/roadmap-sync.js';
import { loadUserBlob, saveUserBlob } from './_lib/user.js';
import { maybePatchSectorFitForUser } from './_lib/sector-fit-sheet.js';
import { applyResumeToObjective } from './_lib/onet/resume-map.js';
import { patchObjectiveFromResume, mergeObjectiveAiPatch } from './_lib/onet/objective-patch.js';
import { patchPersonalityFromResume } from './_lib/onet/personality-patch.js';
import { ensureUserVectors, bleedPersonalityFromObjectiveDelta } from './_lib/onet/user-vectors.js';
import { getZoneDimensionProfiles } from './_lib/onet/store.js';
import { setZoneDimensionProfiles } from './_lib/onet/resume-theme-map.js';
import { extractResumeDocument } from './_lib/resume-extract.js';
import { callGeminiJson } from './_lib/gemini-json.js';

const MAX_RESUME_CHARS = 12000;
const MAX_NAME_LEN = 80;
const MAX_BASE64_CHARS = 5_500_000;

const INDUSTRY_KEYS = [
  'tech', 'healthcare', 'finance', 'creative', 'education', 'business', 'law',
  'engineering', 'science', 'startups', 'social', 'marketing', 'trades', 'media',
  'government', 'cybersecurity', 'operations', 'hospitality', 'aerospace',
  'pharmaceutical', 'sports', 'realestate', 'hr', 'agriculture',
];

const INDUSTRY_KEYWORDS = {
  finance: ['finance', 'accounting', 'investment', 'banking', 'equity', 'trading', 'financial analyst', 'cfa', 'cpa'],
  tech: ['software', 'programming', 'python', 'javascript', 'typescript', 'java', 'react', 'developer', 'engineer', 'github', 'sql', 'machine learning', 'data science', 'api', 'aws', 'cloud'],
  engineering: ['engineering', 'mechanical', 'electrical', 'civil', 'cad', 'matlab', 'hardware', 'embedded'],
  healthcare: ['healthcare', 'medical', 'clinical', 'patient', 'nursing', 'biology', 'chemistry', 'pre-med', 'research', 'lab'],
  law: ['law', 'legal', 'attorney', 'paralegal', 'policy', 'compliance', 'litigation', 'contract'],
  business: ['management', 'consulting', 'strategy', 'operations', 'mba', 'project management', 'leadership'],
  marketing: ['marketing', 'brand', 'social media', 'content', 'campaign', 'advertising', 'seo', 'growth'],
  startups: ['startup', 'founder', 'venture', 'entrepreneurship', 'product manager', 'innovation', 'launched', 'co-founded'],
  creative: ['design', 'creative', 'ux', 'ui', 'figma', 'adobe', 'photoshop', 'illustrator', 'branding'],
  education: ['teaching', 'tutoring', 'education', 'curriculum', 'mentoring', 'instructed', 'coach'],
  social: ['nonprofit', 'volunteer', 'community', 'social work', 'counseling', 'advocacy', 'outreach'],
  science: ['research', 'laboratory', 'thesis', 'publication', 'experiment', 'physics', 'neuroscience'],
  trades: ['electrician', 'plumber', 'welding', 'hvac', 'carpentry', 'construction'],
  media: ['broadcast', 'journalism', 'video production', 'podcast', 'filmmaking', 'reporter'],
  government: ['public policy', 'municipal', 'federal', 'civil service', 'legislative'],
  cybersecurity: ['cybersecurity', 'infosec', 'penetration test', 'soc analyst', 'siem', 'incident response'],
  operations: ['supply chain', 'logistics', 'warehouse', 'procurement', 'inventory', 'lean six sigma'],
  hospitality: ['hospitality', 'hotel management', 'restaurant', 'chef', 'culinary', 'event planning'],
  aerospace: ['aerospace', 'aviation', 'aircraft', 'flight test', 'nasa', 'spacex', 'boeing', 'pilot'],
  pharmaceutical: ['pharmaceutical', 'pharma', 'biotech', 'clinical trial', 'fda', 'drug development'],
  sports: ['athletics', 'coaching', 'sports management', 'kinesiology', 'personal trainer', 'ncaa'],
  realestate: ['real estate', 'realtor', 'broker', 'property management', 'leasing', 'commercial real estate'],
  hr: ['human resources', 'talent acquisition', 'recruiting', 'people operations', 'onboarding'],
  agriculture: ['agriculture', 'sustainable farming', 'agtech', 'crop science', 'conservation', 'forestry'],
};

function normalizeBoosts(raw) {
  const out = {};
  INDUSTRY_KEYS.forEach((k) => {
    const v = raw && raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(15, Math.round(v)));
    }
  });
  return out;
}

function keywordBoostsFromText(text) {
  const t = String(text || '').toLowerCase();
  const out = {};
  Object.keys(INDUSTRY_KEYWORDS).forEach((ind) => {
    const hits = INDUSTRY_KEYWORDS[ind].filter((kw) => t.includes(kw)).length;
    if (hits > 0) out[ind] = Math.min(hits * 2, 10);
  });
  return out;
}

function fallbackSummary(resumeText) {
  const trimmed = String(resumeText || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Resume uploaded';
  return trimmed.slice(0, 200);
}

function industryAnalysisPrompt(resumeText, customBlock) {
  return `Analyze this resume for career quiz personalization.

Return ONLY valid JSON:
{
  "summary": "max 200 chars — key experience themes",
  "industryBoosts": { ${INDUSTRY_KEYS.map((k) => `"${k}":0-15`).join(', ')} },
  "experienceHighlights": ["max 5 short bullets"],
  "suggestedStrengths": ["max 4"]
}

Score industryBoosts 0-15 based on how strongly resume supports each industry (0 = no signal).
Use only these industry keys exactly.
${customBlock}
<resume>
${resumeText}
</resume>`;
}

async function analyzeIndustryFromResume(env, resumeText, customBlock) {
  const raw = await callGeminiJson(env, {
    prompt: industryAnalysisPrompt(resumeText, customBlock),
    temperature: 0.4,
    maxTokens: 1800,
    jsonMode: true,
    label: 'resume-industry-analysis',
    softFail: true,
  });

  if (raw && typeof raw === 'object') {
    return {
      summary: String(raw.summary || '').slice(0, 240) || fallbackSummary(resumeText),
      boosts: normalizeBoosts(raw.industryBoosts),
      highlights: Array.isArray(raw.experienceHighlights)
        ? raw.experienceHighlights.map((s) => String(s).slice(0, 120)).slice(0, 6)
        : [],
      degraded: false,
    };
  }

  return {
    summary: fallbackSummary(resumeText),
    boosts: keywordBoostsFromText(resumeText),
    highlights: [],
    degraded: true,
  };
}

function dossierFromResumePrompt(resumeText, currentDossier) {
  return [
    'Extract durable career facts from this resume into the dossier schema.',
    `Output ONLY dossier text starting with "${DOSSIER_VERSION_MARKER}".`,
    'Update interests, goals, quiz_strengths, notes with resume-derived facts. Keep terse.',
    currentDossier ? `<current_dossier>\n${currentDossier}\n</current_dossier>` : '',
    '<resume>',
    resumeText.slice(0, MAX_RESUME_CHARS),
    '</resume>',
  ].filter(Boolean).join('\n');
}

function objectiveVectorChanged(before, after) {
  const prev = before?.values || [];
  const next = after?.values || [];
  const len = Math.max(prev.length, next.length);
  for (let i = 0; i < len; i += 1) {
    if ((prev[i] || 0) !== (next[i] || 0)) return true;
  }
  return false;
}

function personalityVectorChanged(beforeValues, afterVec) {
  const prev = beforeValues || [];
  const next = afterVec?.values || [];
  const len = Math.max(prev.length, next.length);
  for (let i = 0; i < len; i += 1) {
    if ((prev[i] || 0) !== (next[i] || 0)) return true;
  }
  return false;
}

function bleedPersonalityAfterObjective(quiz, beforeObjectiveValues) {
  const persBefore = quiz.personalityVector?.values?.slice();
  quiz.personalityVector = bleedPersonalityFromObjectiveDelta(
    quiz.personalityVector,
    beforeObjectiveValues,
    quiz.objectiveVector?.values,
  );
  return personalityVectorChanged(persBefore, quiz.personalityVector);
}

async function runResumeEnrichment(env, email, { resumeText, summary, highlights, origin, skipPersonalityEnrichment }) {
  if (skipPersonalityEnrichment) return;
  const baseUrl = origin && origin !== '*' ? origin : originFromEnv(env);
  let dossierUpdated = false;

  try {
    let dossier = (await loadDossier(env, email)) || '';
    if (!dossier) dossier = buildSeedDossier({});
    const mergePrompt = dossierFromResumePrompt(resumeText, dossier);
    const { apiKey, model } = geminiConfigFromEnv(env);
    try {
      const data = await geminiGenerateContent({
        apiKey,
        model,
        body: {
          contents: [{ role: 'user', parts: [{ text: mergePrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
        },
      });
      const text = geminiTextFromResponse(data);
      const cleaned = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
      if (isValidDossier(cleaned)) {
        await saveDossier(env, email, cleaned);
        dossierUpdated = true;
      }
    } catch (mergeErr) {
      console.warn('resume dossier merge failed', mergeErr);
    }

    if (dossierUpdated) {
      try {
        await maybeSyncRoadmap(env, email, { reason: 'resume-parse' });
      } catch (err) {
        console.warn('resume-parse roadmap sync failed', err);
      }
    }

    await maybePatchSectorFitForUser(env, email, {
      source: 'resume',
      contextText: [summary, highlights.join('; ')].filter(Boolean).join('\n'),
      baseUrl,
    });
  } catch (err) {
    console.warn('resume enrichment background task failed', err);
  }
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const origin = originFromEnv(env, request);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  // Anonymous by design (the quiz flow runs before signup) and each request
  // can fan out to several Gemini calls including file extraction, so
  // throttle per-IP before any model work. 20/hour tolerates a campus NAT
  // while capping anonymous cost abuse.
  try {
    await checkRateLimit(env, `resume-parse:${await hashedIpKey(env, request)}`, { max: 20 });
  } catch (err) {
    return authErrorResponse(err, origin);
  }

  let resumeText = String(payload.resumeText || '').trim().slice(0, MAX_RESUME_CHARS);
  const fileBase64 = String(payload.resumeFileBase64 || '').trim();
  if (fileBase64.length > MAX_BASE64_CHARS) {
    return authJsonResponse(413, { error: 'Resume file is too large. Please use a file under 4 MB.' }, origin);
  }
  let extractedFromFile = '';
  let extractionMethod = '';
  let structuredSummary = null;
  if (fileBase64) {
    const extraction = await extractResumeDocument(env, {
      base64: fileBase64,
      mimeType: payload.mimeType,
      fileName: payload.fileName,
    });
    extractionMethod = extraction.method || '';
    if (extraction.ok && extraction.resumeText) {
      extractedFromFile = extraction.extractedText || extraction.resumeText;
      resumeText = extraction.resumeText.slice(0, MAX_RESUME_CHARS);
      if (extraction.structured) {
        structuredSummary = {
          experienceCount: Array.isArray(extraction.structured.experience) ? extraction.structured.experience.length : 0,
          educationCount: Array.isArray(extraction.structured.education) ? extraction.structured.education.length : 0,
          skillsCount: Array.isArray(extraction.structured.skills) ? extraction.structured.skills.length : 0,
        };
      }
    } else if (!resumeText || resumeText.length < 40) {
      const extractionError = extraction.retryable
        ? 'AI is busy — paste your resume text instead.'
        : (extraction.error || 'Could not extract enough resume text. Try pasting your resume or a different file.');
      return authJsonResponse(400, {
        error: extractionError,
        extractionFailed: true,
        extractionMethod: extraction.method || undefined,
        retryable: extraction.retryable || undefined,
      }, origin);
    }
  }
  if (resumeText.length < 40) {
    return authJsonResponse(400, {
      error: 'Could not extract enough resume text. Try pasting your resume or a different file.',
      extractionFailed: !!fileBase64,
    }, origin);
  }

  const session = await optionalSession(request, env);
  const email = session?.email || null;
  const userName = String(payload.userName || 'Student').trim().slice(0, MAX_NAME_LEN);

  const customAnswers = Array.isArray(payload.customAnswers)
    ? payload.customAnswers
      .map((item) => ({
        prompt: String(item.prompt || '').slice(0, 240),
        answer: String(item.answer || '').trim().slice(0, 400),
      }))
      .filter((item) => item.prompt && item.answer)
      .slice(0, 8)
    : [];
  const customBlock = customAnswers.length
    ? `\nThe user also wrote their own words on quiz group-behavior statements (weight these for industryBoosts and summary):\n${customAnswers.map((a) => `- "${a.prompt}": ${a.answer}`).join('\n')}\n`
    : '';

  const rulesOnly = payload.rulesOnly === true;

  try {
    let summary;
    let boosts;
    let highlights;
    let industryAnalysisDegraded;

    if (rulesOnly) {
      summary = fallbackSummary(resumeText);
      boosts = keywordBoostsFromText(resumeText);
      highlights = [];
      industryAnalysisDegraded = true;
    } else {
      const industry = await analyzeIndustryFromResume(env, resumeText, customBlock);
      summary = industry.summary;
      boosts = industry.boosts;
      highlights = industry.highlights;
      industryAnalysisDegraded = industry.degraded;
    }

    let objectiveVector = null;
    let objectivePatch = null;
    let objectiveAiPatchOut = null;
    let objectiveUpdated = false;
    let objectiveGeminiSkipped = rulesOnly || false;
    let personalityVector = null;
    let personalityPatch = null;
    let personalityUpdated = false;
    let personalityScores = null;
    let dossier = '';

    if (email) {
      if (!rulesOnly) dossier = (await loadDossier(env, email)) || '';
      const baseUrl = originFromEnv(env, request);
      const quiz = (await loadUserBlob(env, email)) || {};
      const zoneRes = await fetch(new URL('/data/onet/artifacts/zone-centroids.json', baseUrl).toString());
      const zoneCentroids = zoneRes.ok ? await zoneRes.json() : null;
      if (zoneCentroids) ensureUserVectors(quiz, zoneCentroids);

      quiz.objectiveSkipped = false;
      quiz.resumeText = resumeText;
      quiz.resumeSummary = summary;
      quiz.resumeBoosts = boosts;

      const zoneProfiles = await getZoneDimensionProfiles(env, baseUrl);
      setZoneDimensionProfiles(zoneProfiles);

      const resumeTextForVec = rulesOnly
        ? resumeText
        : [summary, highlights.join('\n'), resumeText].join('\n');
      const vectorBefore = quiz.objectiveVector;
      const objBeforeValues = vectorBefore?.values?.slice();
      quiz.objectiveVector = applyResumeToObjective(quiz.objectiveVector, resumeTextForVec, zoneProfiles);
      if (objectiveVectorChanged(vectorBefore, quiz.objectiveVector)) {
        objectiveUpdated = true;
      }
      if (bleedPersonalityAfterObjective(quiz, objBeforeValues)) {
        personalityUpdated = true;
      }

      if (rulesOnly || industryAnalysisDegraded) {
        objectiveGeminiSkipped = true;
        if (quiz.objectiveVector) quiz.objectiveVector.source = 'resume-rules';
      } else {
        const objPatch = await patchObjectiveFromResume(env, baseUrl, {
          objectiveVector: quiz.objectiveVector,
          resumeText,
          summary,
          highlights,
          dossier,
        });
        if (objPatch.changed) {
          const beforeGeminiObj = quiz.objectiveVector?.values?.slice();
          quiz.objectiveVector = objPatch.objectiveVector;
          // Persist a replayable record — rebuilds (client boot hydration,
          // server PUT) reconstruct the objective from rules and replay this,
          // so the Gemini enrichment survives instead of lasting one page load.
          quiz.objectiveAiPatch = mergeObjectiveAiPatch(quiz.objectiveAiPatch, objPatch.changes, 'resume');
          objectivePatch = { dimensions: objPatch.changes, source: 'resume' };
          objectiveUpdated = true;
          if (bleedPersonalityAfterObjective(quiz, beforeGeminiObj)) {
            personalityUpdated = true;
          }
        }

        const persPatch = await patchPersonalityFromResume(env, baseUrl, {
          quiz,
          dossier,
          resumeText,
          summary,
          highlights,
        });
        if (persPatch.changed) {
          quiz.personalityVector = persPatch.quiz.personalityVector;
          quiz.sectorFitSheet = persPatch.quiz.sectorFitSheet;
          quiz.scores = persPatch.quiz.scores;
          personalityScores = quiz.scores;
          personalityPatch = { dimensions: persPatch.changes, source: 'resume' };
          personalityUpdated = true;
        }
      }

      await saveUserBlob(env, email, quiz);
      objectiveVector = quiz.objectiveVector;
      objectiveAiPatchOut = quiz.objectiveAiPatch || null;
      personalityVector = quiz.personalityVector;

      if (!rulesOnly && !industryAnalysisDegraded) {
        if (typeof waitUntil === 'function') {
          waitUntil(runResumeEnrichment(env, email, {
            resumeText,
            summary,
            highlights,
            origin,
            skipPersonalityEnrichment: personalityUpdated,
          }));
        } else {
          runResumeEnrichment(env, email, {
            resumeText,
            summary,
            highlights,
            origin,
            skipPersonalityEnrichment: personalityUpdated,
          }).catch((err) => {
            console.warn('resume enrichment failed (no waitUntil)', err);
          });
        }
      }
    }

    return authJsonResponse(200, {
      summary,
      industryBoosts: boosts,
      experienceHighlights: highlights,
      industryAnalysisDegraded: industryAnalysisDegraded || undefined,
      objectiveGeminiSkipped: objectiveGeminiSkipped || undefined,
      rulesOnly: rulesOnly || undefined,
      savedAt: new Date().toISOString(),
      userName,
      resumeText: resumeText.slice(0, 500),
      extractedText: extractedFromFile ? extractedFromFile.slice(0, 2000) : undefined,
      extractionMethod: extractionMethod || undefined,
      structuredSummary: structuredSummary || undefined,
      objectiveVector: objectiveVector || undefined,
      objectiveUpdated,
      objectivePatch: objectivePatch || undefined,
      objectiveAiPatch: objectiveAiPatchOut || undefined,
      personalityVector: personalityVector || undefined,
      personalityUpdated,
      personalityPatch: personalityPatch || undefined,
      scores: personalityScores || undefined,
    }, origin);
  } catch (err) {
    const stage = err?.stage || 'unknown';
    console.error('resume-parse failed', { stage, extractionMethod, message: err?.message || err });
    const message = err?._userFacing
      ? err.message
      : 'Could not save resume analysis. Try again.';
    return authJsonResponse(500, { error: message, stage }, origin);
  }
}
