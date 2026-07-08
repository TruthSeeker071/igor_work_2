import {
  originFromEnv,
  loadDossier,
  buildSeedDossier,
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiTextFromResponse,
  GEMINI_SAFETY_SETTINGS,
} from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadQuizProfile,
  loadRoadmap,
  checkRateLimit,
} from './_lib/auth.js';
import { isExplicitCareerPivotIntent } from './_lib/roadmap.js';
import { generateFragmentsForBase } from './_lib/derive-career.js';
import {
  recordCareerFocus,
  resolveCareerFocus,
  countRecentCareerSwitches,
} from './_lib/roadmap-sync.js';
import {
  proposeOnetCareersForMessage,
  buildProposalReply,
  resolveProposalChoice,
  isNegativeConfirmation,
  validateOnetCareer,
} from './_lib/onet/career-lookup.js';

const MAX_MSG_LEN = 600;
const MAX_HISTORY = 6;

function trim(s, max) {
  return String(s || '').trim().slice(0, max || 400);
}

function normalizePendingProposal(raw) {
  if (!raw || typeof raw !== 'object' || !raw.primary?.soc || !raw.primary?.name) return null;
  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.filter((a) => a && a.soc && a.name).slice(0, 3)
    : [];
  return {
    primary: {
      soc: String(raw.primary.soc).slice(0, 16),
      name: String(raw.primary.name).slice(0, 120),
      slug: String(raw.primary.slug || '').slice(0, 64),
    },
    alternatives: alternatives.map((a) => ({
      soc: String(a.soc).slice(0, 16),
      name: String(a.name).slice(0, 120),
      slug: String(a.slug || '').slice(0, 64),
    })),
    userPhrase: String(raw.userPhrase || '').slice(0, 120),
  };
}

function buildSystemPrompt({ currentFocus, topMatches, switchCount }) {
  const targetLine = currentFocus
    ? `Current target career: ${currentFocus.name} (${currentFocus.slug}).`
    : 'Current target career: not set yet.';
  const matchesLine = topMatches.length
    ? `Top quiz matches: ${topMatches.map((m) => `${m.name} (${m.score}%)`).join(', ')}.`
    : '';
  const switchLine = switchCount >= 3
    ? `Note: user has switched target career ${switchCount} times in the last 30 days. If natural, gently ask what is driving the shifts.`
    : '';

  return `You are the FlightWay Career Switch Advisor on the home page — a narrow assistant scoped ONLY to:
- helping the user choose or change their target career
- comparing fit tradeoffs between their top matches
- clarifying which O*NET catalog career fits what they mean

You are NOT the full AI Career Advisor. Refuse general coaching, homework help, interview prep, or deep life advice.
If asked, say: "For broader advice, open AI Career Advisor from your home page."

${targetLine}
${matchesLine}
${switchLine}

Rules:
- Keep replies under 120 words.
- Only O*NET catalog careers can become the user's target — never invent job titles.
- The app proposes catalog matches and asks the user to confirm before switching; you do not switch careers yourself.
- If they are exploring without committing, help them compare options.
- Plain text only; no markdown headers or bullet lists unless very short.`;
}

function toGeminiContents(history, userMessage) {
  const msgs = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
  const contents = msgs
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content).slice(0, MAX_MSG_LEN) }],
    }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}

async function callGemini(env, systemInstruction, contents) {
  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    throw Object.assign(new Error('AI service is not configured.'), { _userFacing: true });
  }
  const models = resolveGeminiModels(env);
  const RETRYABLE = new Set([429, 500, 503]);
  const DELAYS = [800, 2000];
  let lastErr = null;
  for (const m of models) {
    for (let attempt = 0; attempt <= DELAYS.length; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, DELAYS[attempt - 1]));
      try {
        const data = await geminiGenerateContent({
          apiKey,
          model: m,
          logMeta: { endpoint: '/career-switch-chat', reason: 'switch-reply', cached: false },
          body: {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { temperature: 0.55, maxOutputTokens: 400 },
            safetySettings: GEMINI_SAFETY_SETTINGS,
          },
        });
        const text = geminiTextFromResponse(data);
        if (text) return text.trim();
      } catch (err) {
        lastErr = err;
        console.warn('career-switch-chat gemini failed', m, err?.message || err);
        if (RETRYABLE.has(err.status)) continue;
        break;
      }
    }
  }
  throw lastErr || Object.assign(new Error('AI service unavailable.'), { _userFacing: false });
}

function loadQuizSafe(env, email) {
  if (!env?.DB) return Promise.resolve(null);
  return loadQuizProfile(env, email).catch(() => null);
}

function rankTopMatches(quiz, limit = 5) {
  const scores = quiz?.scores;
  if (!scores || typeof scores !== 'object') return [];
  return Object.entries(scores)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, score]) => ({
      name: String(key).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      score: Math.round(Number(score)),
      slug: String(key).toLowerCase(),
    }));
}

async function confirmCareerSwitch(env, email, career, currentFocus) {
  const baseUrl = env?.SITE_URL || 'https://flightway.pages.dev';
  const validated = await validateOnetCareer(env, baseUrl, career);
  if (!validated) return null;

  const slug = validated.slug.toLowerCase();
  const pivoted = slug !== String(currentFocus?.slug || '').toLowerCase()
    || validated.name !== String(currentFocus?.name || '');
  if (!pivoted) {
    return { focusUpdated: false, focusResult: null, career: validated };
  }

  const focusResult = await recordCareerFocus(env, email, {
    slug: validated.slug,
    name: validated.name,
    soc: validated.soc,
    source: 'home_advisor',
  });
  return { focusUpdated: true, focusResult, career: validated };
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

  const userMessage = trim(payload.message, MAX_MSG_LEN);
  if (!userMessage) return authJsonResponse(400, { error: 'Message cannot be empty.' }, origin);

  let email = '';
  try {
    ({ email } = await requireSession(request, env));
    await checkRateLimit(env, `career-switch-chat:${email}`);

    const [quiz, dossierRaw, roadmap] = await Promise.all([
      loadQuizSafe(env, email),
      loadDossier(env, email).catch(() => ''),
      loadRoadmap(env, email).catch(() => null),
    ]);
    const dossier = dossierRaw || buildSeedDossier({});
    const currentFocus = resolveCareerFocus(quiz, roadmap);
    const switchCount = countRecentCareerSwitches(quiz || {});
    const topMatches = rankTopMatches(quiz, 5);
    const pendingProposal = normalizePendingProposal(payload.pendingProposal);
    const baseUrl = env?.SITE_URL || 'https://flightway.pages.dev';

    const systemInstruction = buildSystemPrompt({ currentFocus, topMatches, switchCount });
    const contents = toGeminiContents(payload.history, userMessage);

    let focusUpdated = false;
    let roadmapRetargeted = false;
    const syncedRoadmap = null;
    let focusResult = null;
    let awaitingConfirmation = false;
    let proposedFocus = null;
    let proposedAlternatives = [];
    let pendingProposalOut = null;
    let reply = '';

    if (pendingProposal && isNegativeConfirmation(userMessage)) {
      reply = 'No problem — tell me another career you are considering, or compare a few options before you switch.';
    } else {
      const confirmedCareer = pendingProposal
        ? resolveProposalChoice(userMessage, pendingProposal)
        : null;

      if (confirmedCareer) {
        const switchResult = await confirmCareerSwitch(env, email, confirmedCareer, currentFocus);
        if (switchResult?.focusUpdated) {
          focusUpdated = true;
          focusResult = switchResult.focusResult;
          reply = `Got it — your target is now ${switchResult.career.name}. Open your roadmap when you are ready to refresh your plan.`;
        } else if (switchResult?.career) {
          reply = `Your target is already ${switchResult.career.name}. Want to explore a different career instead?`;
        } else {
          reply = 'That career is not in our catalog anymore. Try describing another role or search from the target dropdown.';
        }
      } else if (isExplicitCareerPivotIntent(userMessage)) {
        const proposal = await proposeOnetCareersForMessage(env, baseUrl, userMessage);
        if (proposal.primary) {
          awaitingConfirmation = true;
          proposedFocus = proposal.primary;
          proposedAlternatives = proposal.alternatives || [];
          pendingProposalOut = proposal;
          reply = buildProposalReply(proposal);
          // Pre-warm fragments for the proposed base so the hub strip is
          // populated if the user follows through on the switch.
          if (proposal.primary.soc && !String(proposal.primary.soc).startsWith('99-')
            && typeof context.waitUntil === 'function') {
            context.waitUntil(
              generateFragmentsForBase(env, context, {
                baseSoc: proposal.primary.soc,
                email,
                baseUrl,
              }).catch(() => {})
            );
          }
        } else {
          reply = buildProposalReply(proposal);
        }
      } else {
        try {
          reply = await callGemini(env, systemInstruction, contents);
        } catch (err) {
          const msg = err._userFacing ? err.message : 'The career switch advisor is busy. Try again shortly.';
          return authJsonResponse(502, { error: msg }, origin);
        }

        if (!reply || !String(reply).trim()) {
          reply = 'Hi! Tell me which career you are curious about, or what you might want to switch to.';
        }
      }
    }

    return authJsonResponse(200, {
      reply,
      focusUpdated,
      roadmapRetargeted,
      roadmap: syncedRoadmap,
      focus: focusResult?.focus || currentFocus,
      switchCount: focusResult?.switchCount ?? switchCount,
      careerFocusHistory: focusResult?.careerFocusHistory || quiz?.careerFocusHistory || [],
      awaitingConfirmation,
      proposedFocus,
      proposedAlternatives,
      pendingProposal: pendingProposalOut,
      dossierSnippet: trim(dossier, 200),
    }, origin);
  } catch (err) {
    console.error(JSON.stringify({
      type: 'career_switch_chat_error',
      endpoint: '/career-switch-chat',
      email_hash: email ? `${email.slice(0, 2)}…` : 'none',
      status: err?.status || 500,
      message: err?.message || String(err),
      stack: err?.stack ? String(err.stack).slice(0, 400) : undefined,
    }));
    return authErrorResponse(err, origin);
  }
}
