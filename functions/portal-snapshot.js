import { originFromEnv, loadDossier } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadQuizProfile,
  saveQuizPortalSnapshot,
  checkRateLimit,
} from './_lib/auth.js';
import {
  computeInputsHash,
  generatePortalSnapshot,
} from './_lib/portal-snapshot.js';
import { generateFragmentsForBase, getFragmentsForSoc } from './_lib/derive-career.js';
import { bestCatalogMatch } from './_lib/onet/career-lookup.js';

const FALLBACK_FRESH_MS = 3600 * 1000;
const SOC_RE = /^\d{2}-\d{4}\.\d{2}$/;
const MAX_WARMUP_CANDIDATES = 2;

function isRealSoc(soc) {
  return typeof soc === 'string' && SOC_RE.test(soc) && !soc.startsWith('99-');
}

// Background-only: warm AI fragment careers for the user's current focus SOC
// plus their top-fit careerPool entries (resolved by title via the catalog),
// so returning users see fragments without a manual deep-dive. Never awaited
// by the caller, never allowed to affect the snapshot response.
async function warmFragmentsForSnapshot(env, context, { quiz, careerPool, email, baseUrl }) {
  try {
    const candidates = [];
    const seen = new Set();
    const pushSoc = (soc) => {
      if (isRealSoc(soc) && !seen.has(soc)) {
        seen.add(soc);
        candidates.push(soc);
      }
    };

    pushSoc(quiz?.careerFocus?.soc);

    const topPicks = Array.isArray(careerPool) ? careerPool.slice(0, 3) : [];
    for (const pick of topPicks) {
      if (candidates.length >= MAX_WARMUP_CANDIDATES + 1) break;
      const name = String(pick?.name || '').trim();
      if (!name) continue;
      try {
        const hit = await bestCatalogMatch(env, baseUrl, name, 90);
        pushSoc(hit?.soc);
      } catch {
        // best-effort resolution only — skip on any failure
      }
    }

    let generated = 0;
    for (const soc of candidates) {
      if (generated >= MAX_WARMUP_CANDIDATES) break;
      try {
        const existing = await getFragmentsForSoc(env, baseUrl, soc);
        if (existing.length) continue;
        await generateFragmentsForBase(env, context, { baseSoc: soc, email, baseUrl });
        generated += 1;
      } catch {
        // swallow — warm-up is additive, never allowed to surface an error
      }
    }
  } catch {
    // whole warm-up is best-effort and must never affect the snapshot response
  }
}

function normalizeCareerPool(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      careerId: Number(c.careerId),
      name: String(c.name || '').slice(0, 80),
      score: Number(c.score) || 0,
      skills: Array.isArray(c.skills) ? c.skills.map((s) => String(s).slice(0, 40)).slice(0, 6) : [],
    }))
    .filter((c) => Number.isFinite(c.careerId) && c.name)
    .slice(0, 6);
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const { email } = await requireSession(request, env);
    const [quizRaw, dossierRaw] = await Promise.all([
      loadQuizProfile(env, email),
      loadDossier(env, email),
    ]);
    const quiz = quizRaw || {};
    const dossier = dossierRaw || '';
    const careerPool = normalizeCareerPool(payload.careerPool);
    const force = !!payload.force;
    const inputsHash = computeInputsHash(quiz, dossier);
    const cached = quiz.portalSnapshot;
    // Per-request guard: onRequest only runs the warm-up path once per
    // invocation, but this makes the "at most once per request" invariant
    // explicit rather than relying on the two call sites never both firing.
    let warmupFired = false;

    if (
      !force
      && cached
      && cached.inputsHash === inputsHash
      && (
        (cached.source === 'ai' && cached.knowYou && cached.characterAnalysis)
        || (cached.source === 'fallback' && cached.generatedAt
          && (Date.now() - Date.parse(cached.generatedAt)) < FALLBACK_FRESH_MS)
      )
    ) {
      if (!warmupFired && context.waitUntil) {
        warmupFired = true;
        const baseUrl = new URL(request.url).origin;
        context.waitUntil(warmFragmentsForSnapshot(env, context, { quiz, careerPool, email, baseUrl }));
      }
      return authJsonResponse(200, {
        portalSnapshot: cached,
        cached: true,
        inputsHash,
      }, origin);
    }

    await checkRateLimit(env, `portal-snap:${email}`);

    const { portalSnapshot, aiError } = await generatePortalSnapshot(env, quiz, careerPool, dossier);

    if (portalSnapshot.source === 'ai' || portalSnapshot.source === 'fallback') {
      await saveQuizPortalSnapshot(env, email, portalSnapshot);
    }

    if (!warmupFired && context.waitUntil) {
      warmupFired = true;
      const baseUrl = new URL(request.url).origin;
      context.waitUntil(warmFragmentsForSnapshot(env, context, { quiz, careerPool, email, baseUrl }));
    }

    return authJsonResponse(200, {
      portalSnapshot,
      cached: false,
      inputsHash,
      aiError: aiError || undefined,
    }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}
