import {
  originFromEnv,
  loadDossier,
  saveDossier,
  loadChat,
  saveChat,
  buildSeedDossier,
  isValidDossier,
  EXCHANGE_RESET_AT,
  lastTopicFromMessages,
  DOSSIER_VERSION_MARKER,
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiStreamContent,
  geminiTextFromResponse,
  geminiOverloadUserMessage,
  GEMINI_SAFETY_SETTINGS,
} from './_lib.js';
import { loadDossierWithCoordinates } from './_lib/dossier-coordinates.js';
import { loadUserBlob } from './_lib/user.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './_lib/gemini-grounded.js';
import {
  isManualDossierCommand,
  transcriptHasDurableFacts,
  mergeDossierFromTranscript as updateDossierFromTranscript,
} from './_lib/dossier-update.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadRoadmap,
  saveRoadmap,
  checkRateLimit,
  refundRateLimit,
  RATE_LIMIT_CHAT_MAX,
} from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';
import { checkFeatureLimit, refundFeatureUse } from './_lib/plan-limits.js';
import {
  maybeUpdateRoadmapFromTranscript,
  isManualRoadmapCommand,
  buildCoachRoadmapContextBlock,
  buildProgressAckBlock,
  getNewlyDoneActions,
  buildRoadmapAckFromRoadmap,
  coachRoadmapSidecarNeeded,
  applyRoadmapPatchFromMessage,
  tryDeterministicRoadmapPatch,
  isRoadmapRegenerateIntent,
  isRoadmapPlanEditIntent,
  isValidRoadmap,
  resolveCareerTargetFromMessage,
} from './_lib/roadmap.js';
import { maybeSyncRoadmap, recordCareerFocus, attachMetaFromProfile, countRecentCareerSwitches } from './_lib/roadmap-sync.js';
import { maybePatchSectorFitForUser } from './_lib/sector-fit-sheet.js';
import { maybePatchObjectiveForUser } from './_lib/onet/objective-patch.js';
import { buildProfileSignalsBlock } from './_lib/profile-alignment.js';
import { parseMarcoReply, uiContractInstruction, validateUi } from './_lib/marco-ui.js';
import { selectThread } from './_lib/marco-thread.js';
import { loadUpcomingDeadlines, deadlinesPromptBlock, schoolForCacheKey } from './_lib/deadlines.js';
import {
  loadCachedCareerRank, refreshCareerRank, careerRankPromptBlock,
} from './_lib/onet/career-rank.js';
import { buildSurfacePrompt } from './_lib/marco-persona.js';
import { sanitizeUntrustedText } from './_lib/roadmap-tree.js';
import { collectCommitments, recentCompletion, commitmentsPromptBlock } from './_lib/commitments.js';
import { logServerEvent } from './_lib/events.js';

const MAX_MESSAGE_CHARS = 2000;

// D6 wall-clock budget. The client allows 60s for a whole turn; the reply call
// is the only unbounded piece, and everything after it (thread pick, roadmap
// sidecar, the exchange-5 dossier merge) still has to fit. 25s upstream leaves
// that tail room and stays under the JSON path's 30s default, so the streaming
// endpoint can never be the slower of the two.
const STREAM_UPSTREAM_TIMEOUT_MS = 25000;

/**
 * Hand back what a failed turn charged. Best-effort and never throws — a
 * refund that fails must not convert a handled error into an unhandled one.
 */
async function refundSpentBudgets(env, spent) {
  if (!spent || !spent.userId) return;
  await refundRateLimit(env, `chat:${spent.userId}`);
  if (spent.feature) await refundFeatureUse(env, spent.userId, 'marco-chat');
}

function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

const RETRYABLE_STATUS = new Set([500, 503]);
// Statuses worth trying the NEXT MODEL for (as opposed to retrying the same
// one). 429/503 are load. 404 is a retired or renamed model and 400 is a
// request this particular model rejects — both are reasons the fallback might
// still answer, and both used to abort the whole cascade. 401/403 are NOT here
// on purpose: a rejected key fails identically on every model, so cascading
// would just triple the latency before the same failure.
const CASCADE_STATUS = new Set([400, 404, 429, 503]);
const RETRY_DELAYS_MS = [800, 2000];

// Degraded-grounding fallback (fix plan 2.6): when governed research produced
// nothing (over budget, timeout, miss), fall back to the legacy in-call
// google_search rather than leaving the model believing it has live search
// (the system prompt says so) while actually having neither tool nor
// evidence. Flag off → byte-identical to the pre-Pillar-W path.
// Exported for grounding:check.
export function shouldUseLegacySearch(wantsCurrent, enabled, grounding) {
  return !!(wantsCurrent && (!enabled || !grounding));
}

function needsWebSearch(message, useSearchMode) {
  if (useSearchMode === 'always') return true;
  if (useSearchMode === 'never') return false;
  const m = String(message || '').toLowerCase();
  const factual = /\b(deadline|application|apply|tuition|salary|requirements|catalog|course list|look up|search for|find out|current|latest|website|how much|when is|what (are|is) the)\b/.test(m);
  const namedEntity = /\b(at|for|from)\s+[a-z][a-z0-9]{2,}\b/.test(m)
    || /\b(university|college|firm|company|school)\b/.test(m)
    || /\b(harvard|stanford|mit|google|meta|goldman|mckinsey|deloitte|jpmorgan|amazon|microsoft)\b/.test(m);
  const programContext = /\b(major|minor|program|internship|recruiting)\b.{0,40}\b(at|for)\b/.test(m);
  return factual && (namedEntity || programContext);
}

function buildGeminiBody({ systemInstruction, contents, temperature, useSearch }) {
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 800,
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };
  if (!useSearch) {
    body.generationConfig.responseMimeType = 'text/plain';
  }
  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }
  return body;
}

async function callGeminiOnce({ model, apiKey, systemInstruction, contents, temperature, useSearch, onDelta, timeoutMs }) {
  const body = buildGeminiBody({ systemInstruction, contents, temperature, useSearch });
  const logMeta = { endpoint: onDelta ? '/chat-stream' : '/chat', cached: false, reason: useSearch ? 'coach-search' : 'coach-reply' };
  const text = onDelta
    ? await geminiStreamContent({ apiKey, model, body, logMeta, timeoutMs, onDelta })
    : geminiTextFromResponse(await geminiGenerateContent({ apiKey, model, body, logMeta, timeoutMs }));
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function callGeminiWithRetries(opts) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      return await callGeminiOnce(opts);
    } catch (err) {
      lastErr = err;
      if (err.status === 429) throw err;
      // D6: once any text has reached the client, a retry would replay the
      // reply from the top and the user would watch it duplicate itself.
      // Streaming buys latency, and the price is exactly one attempt.
      if (opts.hasStreamed && opts.hasStreamed()) throw err;
      if (!RETRYABLE_STATUS.has(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Gemini request failed.');
}

// D6: `onDelta` turns this into the streaming caller. Everything else — key
// resolution, the model cascade, the retry ladder, the friendly overload
// message — is shared, so the streaming and JSON endpoints cannot drift on
// which model answered or how a 503 is worded.
async function callGemini(env, { systemInstruction, contents, temperature = 0.7, useSearch = false, onDelta = null, timeoutMs }) {
  const { apiKey, model: primaryModel } = geminiConfigFromEnv(env);
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Cloudflare Pages → Settings → Variables and Secrets, then redeploy.',
    );
  }

  const models = resolveGeminiModels(env);
  const attempts = models.map(function (m, i) {
    return { model: m, useSearch: useSearch && i === 0 && m === primaryModel };
  });

  // Same one-attempt-after-first-byte rule across the model cascade.
  let streamed = false;
  const wrappedDelta = onDelta
    ? function (text) { streamed = true; onDelta(text); }
    : null;
  const hasStreamed = function () { return streamed; };

  let lastStatus = null;
  let lastDetail = '';
  for (const { model: m, useSearch: search } of attempts) {
    try {
      return await callGeminiWithRetries({
        model: m,
        apiKey,
        systemInstruction,
        contents,
        temperature,
        useSearch: search,
        onDelta: wrappedDelta,
        hasStreamed,
        timeoutMs,
      });
    } catch (err) {
      lastStatus = err.status || lastStatus;
      lastDetail = err.message || lastDetail;
      if (streamed) throw err;
      // A model-level rejection (404 retired/renamed, 400 unsupported request
      // for THIS model) used to rethrow here, so the configured fallback was
      // never tried and every Marco surface died on a bare 500 — the exact
      // shape of the 2026-07-09 gemini-2.x retirement. Falling through is the
      // whole point of having a cascade.
      if (!CASCADE_STATUS.has(err.status)) {
        // 401/403 = the key itself is rejected (revoked, restricted, billing
        // off). It presents to the user as a generic 5xx by design, so this
        // log is the ONLY place that says which it was — without it the whole
        // failure class is indistinguishable from a code bug.
        console.error(`Gemini [${m}] rejected the request (${err.status}: ${err.message || 'no detail'}) — not a cascade case, giving up.`);
        throw err;
      }
      console.warn(`Gemini [${m}] failed (${err.status}: ${err.message || 'no detail'}), trying next model…`);
    }
  }

  // Every model in the chain is exhausted. Log loudly with the status and
  // upstream detail — this is the line that tells a maintainer "the key is
  // rejected" vs "Google is down" — and hand the user friendly copy only.
  console.error(`Gemini cascade exhausted [${models.join(' → ')}] status=${lastStatus} detail=${lastDetail || 'none'}`);
  const friendly = geminiOverloadUserMessage(lastStatus);
  const e = new Error(friendly);
  e._userFacing = true;
  e.status = lastStatus === 429 ? 429 : 503;
  throw e;
}

// WS-E: the identity, voice and reasoning protocol that used to live here now
// live in marco-persona.js, so every surface inherits them. What stays is what
// only the chat surface owns — the research rules that depend on this call
// having search, and the FW_UI contract.
const CHAT_RESEARCH_BLOCK = `## Research
You have Google Search available. Use it for questions involving specific schools, programs,
courses, deadlines, firms, salaries, or any current factual claim. Do not answer from memory
alone on facts that change over time. When you searched, weave findings in naturally and name
the source institution. Label uncertain claims as such. Source hierarchy: official pages >
institutional publications > credentialed guides > forums (flag as unverified).`;

/**
 * S10 Marco memory. What the last conversation was about, so this one can open
 * by picking it up instead of starting from zero every time.
 *
 * Only rendered at the START of a conversation (`isOpening`). Mid-conversation
 * it would read as Marco losing the thread he is already holding — and the
 * commitments block below it already carries the durable half of the memory
 * on every turn.
 */
function buildLastTopicBlock(lastTopic, isOpening) {
  if (!isOpening || !lastTopic || !lastTopic.text) return '';
  const when = lastTopic.at ? Math.max(0, Math.round((Date.now() - Date.parse(lastTopic.at)) / 86400000)) : null;
  const ago = when == null ? '' : when === 0 ? ' (earlier today)' : when === 1 ? ' (yesterday)' : ` (${when} days ago)`;
  return `## Last conversation${ago}
It opened with, in their words:

<their_words>
${sanitizeUntrustedText(lastTopic.text, 160)}
</their_words>

That is the transcript's opening line, not a summary — it may or may not be where the
conversation ended up. Use it as a way in ("last time you were asking about X — where did that
land?") only when it still looks relevant. Never claim to remember more of it than this.\n`;
}

function chatSystemPrompt({
  dossier,
  school,
  roadmapBlock,
  progressAckBlock,
  noRoadmapHint,
  switchHint,
  profileSignalsBlock,
  deadlineBlock,
  careerRankBlock,
  commitmentBlock,
  lastTopicBlock,
}) {
  return buildSurfacePrompt('chat', {
    school,
    dossier,
    blocks: [
      CHAT_RESEARCH_BLOCK,
      switchHint,
      noRoadmapHint,
      roadmapBlock,
      progressAckBlock,
      profileSignalsBlock,
      careerRankBlock,
      deadlineBlock,
      // Follow-through last, closest to the instruction that acts on it.
      lastTopicBlock,
      commitmentBlock,
    ],
    constraints: uiContractInstruction(),
  });
}

function chatResponsePayload({
  reply,
  exchangeCount,
  remaining,
  roadmapUpgrade,
  dossierUpdated,
  roadmapUpdated,
  roadmapUpdateType,
  reset,
  manualUpdate,
  roadmapRetargeted,
  focusUpdated,
  roadmapCapped,
  roadmapCapMessage,
  roadmapRateLimited,
  sectorFitSheet,
  sectorFitUpdated,
  personalityVector,
  objectiveVector,
  objectiveAiPatch,
  grounding,
  ui,
}) {
  return {
    reply,
    ...(grounding ? { grounded: true, groundedSources: grounding.sources || [], groundedAt: grounding.fetchedAt || null } : {}),
    // WS-D D2: suggestion chips / deep-link cards / a proposed thread, parsed
    // out of the reply. Absent whenever the model gave us nothing usable.
    ...(ui ? { ui } : {}),
    exchangeCount,
    dossierUpdated: !!dossierUpdated,
    roadmapUpdated: !!roadmapUpdated,
    roadmapUpdateType: roadmapUpdateType || null,
    reset: !!reset,
    manualUpdate: !!manualUpdate,
    roadmapRetargeted: !!roadmapRetargeted,
    focusUpdated: !!focusUpdated,
    roadmapRateLimited: !!roadmapRateLimited,
    sectorFitSheet: sectorFitSheet || undefined,
    sectorFitUpdated: !!sectorFitUpdated,
    personalityVector: personalityVector || undefined,
    objectiveVector: objectiveVector || undefined,
    objectiveAiPatch: objectiveAiPatch || undefined,
    // Free/paid merge §2: Marco messages left today (null = unlimited plan,
    // undefined = counter not applicable), so the UI can nudge instead of wall.
    remaining: remaining === undefined ? undefined : remaining,
    // true when an AI roadmap rewrite was declined for plan reasons (§1), so the
    // UI can nudge instead of looking like Marco just ignored the request.
    roadmapUpgrade: roadmapUpgrade || undefined,
    // §4 (option C): a conversational pivot switched the target but the user is
    // out of roadmap rebuilds, so the roadmap stays on the initial career and the
    // UI says so in Marco's voice instead of rebuilding for free.
    roadmapCapped: roadmapCapped || undefined,
    roadmapCapMessage: roadmapCapMessage || undefined,
  };
}

// D3: pick at most one proactive thread and fold it into the reply's `ui`.
// The model never proposes threads — selectThread is deterministic, so the same
// state always yields the same proposal, and a run that costs a free user their
// one card a day is one they can predict. Spends the counter only when a thread
// was actually found, and stays silent (no upgrade nag) when the cap is hit:
// this rations interruption, not a feature the user asked for.
async function maybeAttachThread(env, userId, ui, ctx) {
  let thread = null;
  try {
    thread = selectThread(ctx);
  } catch (err) {
    console.warn('marco thread selection failed', err);
    return ui;
  }
  if (!thread) return ui;
  try {
    const cap = await checkFeatureLimit(env, userId, 'marco-thread');
    if (!cap.ok) return ui;
  } catch (err) {
    console.warn('marco thread cap check failed', err);
    return ui;
  }
  // Back through the same validator as a model-authored block — one clamp, one
  // shape, no second path onto the wire.
  return validateUi({ ...(ui || {}), thread });
}

function transcriptContext(messages, max = 6) {
  const slice = (messages || []).slice(-max);
  return slice.map((m) => `${m.role}: ${String(m.content || '').slice(0, 400)}`).join('\n');
}

async function sectorPatchAfterDossier(env, email, dossierUpdated, messages, baseUrl) {
  if (!dossierUpdated || !email) return null;
  const contextText = transcriptContext(messages);
  let sector = null;
  try {
    sector = await maybePatchSectorFitForUser(env, email, {
      source: 'coach',
      contextText,
      baseUrl: baseUrl,
    });
  } catch (err) {
    console.warn('coach sector patch failed', err);
  }
  // Sequential, not parallel: both helpers load+save the quiz profile, so a
  // parallel run would let the second save clobber the first's changes.
  let objective = null;
  try {
    objective = await maybePatchObjectiveForUser(env, email, {
      source: 'coach',
      contextText,
      baseUrl: baseUrl,
    });
  } catch (err) {
    console.warn('coach objective patch failed', err);
  }
  if (!sector && !objective?.changed) return sector;
  return {
    ...(sector || {}),
    objectiveVector: objective?.changed ? objective.quiz?.objectiveVector : undefined,
    objectiveAiPatch: objective?.changed ? objective.quiz?.objectiveAiPatch : undefined,
  };
}

function persistChatState(chat, roadmap) {
  const next = {
    exchangeCount: chat.exchangeCount,
    messages: chat.messages,
  };
  // Carried explicitly: this function decides the whole persisted shape, so a
  // field it does not name is dropped on every single turn, not just at reset.
  if (chat.lastTopic) next.lastTopic = chat.lastTopic;
  if (roadmap) {
    next.roadmapAck = buildRoadmapAckFromRoadmap(roadmap);
  } else if (chat.roadmapAck) {
    next.roadmapAck = chat.roadmapAck;
  }
  return next;
}

async function saveRoadmapWithMeta(env, userId, roadmap, profileOpts = {}) {
  const withMeta = await attachMetaFromProfile(env, userId, roadmap, profileOpts);
  await saveRoadmap(env, userId, withMeta);
  return withMeta;
}

async function runCoachRoadmapSidecar(env, userId, {
  userMessage,
  dossier,
  quiz,
  roadmap,
  history,
}) {
  if (!roadmap || !coachRoadmapSidecarNeeded(userMessage)) {
    return { updated: false, roadmap, type: null, retargeted: false };
  }

  // Checking a step off is deterministic, free, and stays free (§1: the roadmap
  // is viewable and tickable on the free tier).
  const deterministic = tryDeterministicRoadmapPatch(userMessage, roadmap);
  if (deterministic.updated) {
    const saved = await saveRoadmapWithMeta(env, userId, deterministic.roadmap, { quiz, dossier });
    return { updated: true, roadmap: saved, type: 'patch', retargeted: false };
  }

  // Everything past here is an AI rewrite of the plan — inline waypoint edits and
  // full regeneration are the Flight Plan half of the roadmap (§1).
  // §4 (option C): a full rebuild/pivot is metered by the one-roadmap allowance —
  // the SAME fungible allowance the primary build spends — not gated behind
  // premium. A capped free user's focus still switches; only the rebuild is
  // withheld, with an upgrade message. Inline AI plan-editing below is a separate
  // Flight Plan feature and stays premium; the two intents are disjoint
  // (isRoadmapPlanEditIntent returns false when isRoadmapRegenerateIntent is true).
  if (isRoadmapRegenerateIntent(userMessage)) {
    try {
      await checkRateLimit(env, `roadmap-gen:${userId}`);
    } catch (err) {
      console.warn('coach roadmap regen rate limited', err);
      return { updated: false, roadmap, type: null, retargeted: false, rateLimited: true };
    }

    const target = await resolveCareerTargetFromMessage(
      env,
      userMessage,
      roadmap.targetCareerSlug,
      roadmap.targetCareerName,
    );
    const pivoted = !!(target.pivoted && target.slug && target.name);
    if (pivoted) {
      await recordCareerFocus(env, userId, {
        slug: target.slug,
        name: target.name,
        source: 'coach_pivot',
        soc: target.soc || null,
      });
    }

    try {
      const syncResult = await maybeSyncRoadmap(env, userId, {
        force: true,
        reason: 'coach_pivot',
        userPivotNote: userMessage,
        quiz,
        dossier,
        roadmap,
        meter: true,
      });
      if (syncResult?.capped) {
        return {
          updated: false,
          roadmap,
          type: null,
          retargeted: false,
          focusUpdated: pivoted,
          roadmapCapped: true,
          capMessage: syncResult.capMessage || '',
        };
      }
      if (syncResult?.roadmap && !syncResult.cached) {
        return {
          updated: true,
          roadmap: syncResult.roadmap,
          type: syncResult.retargeted ? 'regenerate' : 'sync',
          retargeted: !!syncResult.retargeted,
          focusUpdated: pivoted,
        };
      }
    } catch (err) {
      console.warn('coach roadmap sync regen failed', err);
    }
    return { updated: false, roadmap, type: null, retargeted: false };
  }

  // Inline AI plan-editing is a Flight Plan (premium) feature.
  const ent = await requirePlan(env, userId, 'premium');
  if (!ent.ok) return { updated: false, roadmap, type: null, retargeted: false, upgrade: true };

  if (isRoadmapPlanEditIntent(userMessage)) {
    const markDoneOnly = /\b(mark|marked|done|complete|completed|finished|checked off)\b/i.test(userMessage)
      && !/\b(add|remove|change|replace|instead|swap|new action|new step|update|edit|tweak)\b/i.test(userMessage);
    if (!markDoneOnly) {
      const patch = await applyRoadmapPatchFromMessage(env, {
        dossier,
        currentRoadmap: roadmap,
        userMessage,
        history,
        school: schoolForCacheKey({ quiz, dossier }),
      });
      if (patch.updated) {
        const saved = await saveRoadmapWithMeta(env, userId, patch.roadmap, { quiz, dossier });
        return { updated: true, roadmap: saved, type: 'patch', retargeted: false };
      }
    }
  }

  return { updated: false, roadmap, type: null, retargeted: false };
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

/**
 * One Marco turn, transport-agnostic: resolves to `{ status, payload }` and
 * throws only what `authErrorResponse` knows how to word. `/chat` renders that
 * as JSON; `/chat-stream` (D6) renders the same object as the closing SSE
 * control frame, having already streamed the prose through `opts.onDelta`.
 * Every gate, prompt, sidecar and persistence path is therefore shared — the
 * two endpoints cannot answer differently.
 */
export async function runChatTurn(context, opts = {}) {
  const { request, env } = context;
  const { apiKey, useSearchMode } = geminiConfigFromEnv(env);
  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;

  if (!apiKey) {
    return {
      status: 500,
      payload: {
        error:
          'AI service is not configured. Set GEMINI_API_KEY in Cloudflare Pages → Settings → Variables and Secrets.',
      },
    };
  }

  // Set once both budgets are spent, so only a turn that actually charged the
  // user can refund. Declared out here because the catch is outside the try
  // that sets it.
  let spentBudgets = null;

  let reqBody;
  try {
    reqBody = await request.json();
  } catch {
    return { status: 400, payload: { error: 'Invalid JSON body' } };
  }

  const userMessage = String(reqBody.message || '').trim();

  if (!userMessage) {
    return { status: 400, payload: { error: 'Message cannot be empty.' } };
  }
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    return {
      status: 400,
      payload: { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
    };
  }

  try {
    const origin = originFromEnv(env, request);
    const { email: userId } = await requireSession(request, env);
    await checkRateLimit(env, `chat:${userId}`, { max: RATE_LIMIT_CHAT_MAX });

    // Free/paid merge §1: Marco stays part of the free funnel but every message
    // is a live Gemini call — 5/day free, unlimited on Flight Plan. Spent before
    // any model work so a blocked message costs nothing upstream.
    const marcoCap = await checkFeatureLimit(env, userId, 'marco-chat');
    if (!marcoCap.ok) {
      return {
        status: 429,
        payload: {
          error: marcoCap.message,
          upgrade: !!marcoCap.upgrade,
          remaining: 0,
          feature: 'marco-chat',
        },
      };
    }
    const marcoRemaining = marcoCap.remaining;
    // Both budgets are now spent. If this turn fails for a reason the user did
    // not cause, the catch below hands them back — see refundSpentBudgets.
    spentBudgets = { userId, feature: !marcoCap.unlimited && !marcoCap.dev };

    let [dossier, chat, quiz, roadmap] = await Promise.all([
      // Coordinates-aware read: Marco's prompt sees the live vector snapshot.
      // saveDossier strips the fenced block, so the merge flow stays clean.
      loadDossierWithCoordinates(env, userId).catch(() => null),
      loadChat(env, userId),
      loadUserBlob(env, userId).catch(() => null),
      loadRoadmap(env, userId).catch(() => null),
    ]);
    if (!dossier) {
      dossier = buildSeedDossier({});
      await saveDossier(env, userId, dossier);
    }

    // Marco's hub bubble opener: the coach page shows it client-side, but the
    // server transcript never contained it, so Marco's first reply had no idea
    // what "let's talk about X" referred to. Seed it as the opening assistant
    // turn (only at the start of a conversation).
    // `reqBody`, not `payload` — `payload` is a key on the RETURN objects and
    // has never been a variable in this scope. The typo threw a ReferenceError
    // on every single turn, before any Gemini call, which the outer handler
    // turned into a generic 500: Marco was down on every surface.
    const starterContext = String(reqBody.starterContext || '').trim().slice(0, 300);
    if (starterContext && chat.messages.length === 0) {
      chat.messages.push({ role: 'assistant', content: starterContext });
    }

    const newlyDone = getNewlyDoneActions(roadmap, chat.roadmapAck);
    const roadmapBlock = buildCoachRoadmapContextBlock(roadmap, userMessage);
    const progressAckBlock = buildProgressAckBlock(newlyDone);

    // S10 follow-through. `isOpening` is read HERE, before the turn is pushed
    // onto the transcript: after that the count is 1 and every conversation
    // looks like a continuation.
    const isOpening = chat.messages.length === 0
      || (chat.messages.length === 1 && chat.messages[0]?.role === 'assistant');
    const openCommitments = collectCommitments(roadmap);
    const commitmentBlock = commitmentsPromptBlock(openCommitments, {
      completion: recentCompletion(roadmap),
    });
    const lastTopicBlock = buildLastTopicBlock(chat.lastTopic, isOpening);
    // Counts the callback OPPORTUNITY, not proof Marco took it: the server
    // knows exactly what it handed the model and nothing about what the reply
    // did with it. Naming it honestly here beats a client-side heuristic that
    // greps a reply for a commitment title and calls the result a metric.
    // Written server-side because the browser never sees this block.
    if (isOpening && (commitmentBlock || lastTopicBlock) && typeof context.waitUntil === 'function') {
      context.waitUntil(logServerEvent(env, 'marco_callback_shown', {
        userId,
        path: '/chat',
        props: {
          open: openCommitments.length,
          overdue: openCommitments.filter((c) => c.overdue).length,
          topic: lastTopicBlock ? 1 : 0,
        },
      }));
    }
    const noRoadmapHint = (!roadmap || !isValidRoadmap(roadmap))
      ? '\n## Career roadmap\nThe user does not have a generated career roadmap yet. They can build one from their Portal home page or the Career Roadmap section.\n'
      : '';
    const switchCount = countRecentCareerSwitches(quiz || {});
    const switchHint = switchCount >= 3
      ? `\n## Career focus pattern\nThe user has changed their target career ${switchCount} times in the last 30 days. If it fits naturally in the conversation, gently ask what is driving the shifts and whether they want help narrowing options.\n`
      : '';

    if (isManualRoadmapCommand(userMessage)) {
      const transcript = chat.messages.concat([{ role: 'user', content: userMessage }]);
      let roadmapUpdated = false;
      let roadmapUpdateType = null;
      // "Update my roadmap" is an AI rewrite of the plan — premium (§1).
      const editEnt = await requirePlan(env, userId, 'premium');
      if (!editEnt.ok) {
        return { status: 200, payload: chatResponsePayload({
          reply: 'Rewriting your roadmap from our conversation is a Flight Plan feature. '
            + 'Your roadmap stays here either way — you can keep checking steps off, and see what Flight Plan adds on the pricing page.',
          exchangeCount: chat.exchangeCount,
          remaining: marcoRemaining,
          dossierUpdated: false,
          roadmapUpdated: false,
          roadmapUpdateType: null,
          reset: false,
          manualUpdate: true,
          roadmapUpgrade: true,
        }) };
      }
      if (chat.messages.length > 0 && roadmap) {
        const result = await maybeUpdateRoadmapFromTranscript(env, userId, roadmap, transcript);
        if (result.updated) {
          roadmap = result.roadmap;
          await saveRoadmap(env, userId, roadmap);
          roadmapUpdated = true;
          roadmapUpdateType = 'patch';
        }
      }
      const reply = roadmapUpdated
        ? 'Done — I updated your career roadmap based on our conversation. Open Career Roadmap to review it.'
        : !roadmap
          ? "You don't have a roadmap yet. Open Career Roadmap from your home page to generate one."
          : chat.messages.length === 0
            ? "There's nothing new to add yet — we haven't discussed anything this conversation."
            : "I reviewed our chat but your roadmap didn't need changes right now.";
      if (roadmapUpdated) {
        await saveChat(env, userId, persistChatState(chat, roadmap));
      }
      return { status: 200, payload: chatResponsePayload({
        reply,
        exchangeCount: chat.exchangeCount,
        remaining: marcoRemaining,
        dossierUpdated: false,
        roadmapUpdated,
        roadmapUpdateType,
        reset: false,
        manualUpdate: true,
      }) };
    }

    if (isManualDossierCommand(userMessage)) {
      const transcript = chat.messages.concat([{ role: 'user', content: userMessage }]);
      let updated = false;
      if (chat.messages.length > 0) {
        const result = await updateDossierFromTranscript(env, userId, dossier, transcript);
        updated = result.updated;
      }
      const reply = updated
        ? 'Done — I updated your dossier with what we covered. You can review it in Settings (gear icon).'
        : chat.messages.length === 0
          ? "There's nothing new to add yet — we haven't discussed anything this conversation. Your dossier is unchanged."
          : "I tried to update the dossier but the result didn't validate, so I kept the previous version. Try again in a moment.";
      const sectorPatch = await sectorPatchAfterDossier(env, userId, updated, transcript, origin);
      return { status: 200, payload: chatResponsePayload({
        reply,
        exchangeCount: chat.exchangeCount,
        remaining: marcoRemaining,
        dossierUpdated: updated,
        roadmapUpdated: false,
        roadmapUpdateType: null,
        reset: false,
        manualUpdate: true,
        sectorFitSheet: sectorPatch?.sectorFitSheet,
        sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
        personalityVector: sectorPatch?.personalityVector,
        objectiveVector: sectorPatch?.objectiveVector,
        objectiveAiPatch: sectorPatch?.objectiveAiPatch,
      }) };
    }

    chat.messages.push({ role: 'user', content: userMessage });
    const profileSignals = buildProfileSignalsBlock(quiz, dossier);
    // D4: one KV read of whatever the Opportunity Finder last produced. Never
    // triggers research — with grounding off (or the panel never opened) this
    // is [] and the block disappears, which is the correct degrade.
    const upcomingDeadlines = await loadUpcomingDeadlines(env, userId, { quiz, roadmap, dossier })
      .catch(() => []);

    // E3 + D3: the top-5 fit careers, by name and score. One KV read — a HIT
    // costs nothing, a MISS costs nothing either: the block is absent this turn
    // and the catalog-sized computation runs after the response through
    // waitUntil, so the next turn has it. Chat never waits on the catalog.
    const personalityValues = quiz?.personalityVector?.values || null;
    const objectiveValues = quiz?.objectiveVector?.values || null;
    const careerRank = await loadCachedCareerRank(env, userId, personalityValues, objectiveValues);
    if (!careerRank.length && personalityValues && typeof context.waitUntil === 'function') {
      context.waitUntil(refreshCareerRank(
        env, new URL(request.url).origin, userId, personalityValues, objectiveValues,
      ));
    }

    // Pillar W (Tier A): when governed grounding is on, current-fact questions
    // go through the shared research layer (global cache, budgets, fenced
    // evidence, provenance) and the reply call itself stays search-free. With
    // the flag off this is byte-identical to the legacy path: the reply call
    // itself carries google_search when the heuristic fires.
    const wantsCurrent = needsWebSearch(userMessage, useSearchMode);
    let grounding = null;
    if (wantsCurrent && groundingEnabled(env)) {
      const careerCtx = roadmap?.targetCareerName || quiz?.careerFocus?.name || '';
      const topic = userMessage.replace(/\s+/g, ' ').trim().slice(0, 220)
        + (careerCtx ? ` (asked by a student targeting: ${String(careerCtx).slice(0, 80)})` : '');
      grounding = await researchWeb(env, {
        query: topic,
        freshnessTtl: GROUNDING_TTL.VOLATILE,
        timeoutMs: 8000,
        budgetKey: userId,
      });
    }
    const evidenceSuffix = grounding
      ? `\n\n${buildEvidenceBlock(grounding)}\nWhen your answer uses facts from the WEB EVIDENCE, say they are current as of its date; the client will show the sources.`
      : '';
    const rawReply = await callGemini(env, {
      systemInstruction: chatSystemPrompt({
        dossier,
        // The no-I/O school resolver (profile before dossier) — the chat hot
        // path cannot afford a read, and every advice prompt owes the model a
        // schoolPromptBlock (invariant 0.2).
        school: schoolForCacheKey({ quiz, dossier }),
        roadmapBlock,
        progressAckBlock,
        noRoadmapHint,
        switchHint,
        profileSignalsBlock: profileSignals,
        careerRankBlock: careerRankPromptBlock(careerRank),
        deadlineBlock: deadlinesPromptBlock(upcomingDeadlines),
        commitmentBlock,
        lastTopicBlock,
      }) + evidenceSuffix,
      contents: toGeminiContents(chat.messages),
      temperature: 0.7,
      useSearch: shouldUseLegacySearch(wantsCurrent, groundingEnabled(env), grounding),
      // D6: streaming only when the caller asked for it. Deltas are raw model
      // text — the FW_UI block included — so the transport gates them through
      // `createStreamProseGate` before they reach a client. The control frame
      // still carries the parsed prose and is authoritative, not additive.
      onDelta,
      timeoutMs: onDelta ? STREAM_UPSTREAM_TIMEOUT_MS : undefined,
    });
    // D2: split the FW_UI block off the prose. The prose is what the user sees
    // AND what the transcript keeps, so the block never re-enters the context.
    // A reply that is nothing but a block falls back to the raw text — visibly
    // wrong beats silently empty.
    const parsedReply = parseMarcoReply(rawReply);
    const reply = parsedReply.reply || rawReply;
    let replyUi = parsedReply.ui;

    chat.messages.push({ role: 'assistant', content: reply });
    chat.exchangeCount += 1;

    replyUi = await maybeAttachThread(env, userId, replyUi, {
      exchangeCount: chat.exchangeCount,
      dossier,
      quiz,
      roadmap,
      deadlines: upcomingDeadlines,
      careerRank,
      messages: chat.messages,
    });

    let dossierUpdated = false;
    let roadmapUpdated = false;
    let roadmapUpdateType = null;
    let roadmapRetargeted = false;
    let roadmapRateLimited = false;
    let roadmapUpgrade = false;
    let roadmapCapped = false;
    let roadmapCapMessage = '';
    let sectorPatch = null;

    if (roadmap) {
      try {
        const sidecar = await runCoachRoadmapSidecar(env, userId, {
          userMessage,
          dossier,
          quiz,
          roadmap,
          history: chat.messages.slice(0, -1),
        });
        if (sidecar.updated) {
          roadmap = sidecar.roadmap;
          roadmapUpdated = true;
          roadmapUpdateType = sidecar.type;
          if (sidecar.retargeted || sidecar.type === 'regenerate') roadmapRetargeted = true;
        } else if (sidecar.rateLimited) {
          roadmapRateLimited = true;
        } else if (sidecar.roadmapCapped) {
          roadmapCapped = true;
          roadmapCapMessage = sidecar.capMessage || '';
        } else if (sidecar.upgrade) {
          roadmapUpgrade = true;
        }
      } catch (err) {
        console.error('Coach roadmap sidecar failed', err);
      }
    }

    const shouldRefreshAck = newlyDone.length > 0 || roadmapUpdated;

    if (chat.exchangeCount >= EXCHANGE_RESET_AT) {
      const skipDossier = !transcriptHasDurableFacts(chat.messages);
      if (!skipDossier) {
        try {
          const result = await updateDossierFromTranscript(env, userId, dossier, chat.messages);
          dossierUpdated = result.updated;
          if (result.updated) dossier = result.dossier;
        } catch (err) {
          console.error('Dossier update failed', err);
        }
      }
      if (dossierUpdated) {
        sectorPatch = await sectorPatchAfterDossier(env, userId, true, chat.messages, origin);
      }
      if (roadmap && !roadmapUpdated) {
        if (dossierUpdated) {
          try {
            const syncResult = await maybeSyncRoadmap(env, userId, {
              reason: 'coach-exchange-5',
              quiz,
              dossier,
              roadmap,
            });
            if (syncResult?.roadmap && !syncResult.cached) {
              roadmap = syncResult.roadmap;
              roadmapUpdated = true;
              roadmapUpdateType = syncResult.retargeted ? 'regenerate' : 'sync';
              roadmapRetargeted = !!syncResult.retargeted;
            }
          } catch (err) {
            console.warn('coach exchange-5 roadmap sync failed', err);
          }
        } else {
          try {
            const rmResult = await maybeUpdateRoadmapFromTranscript(env, userId, roadmap, chat.messages);
            if (rmResult.updated) {
              roadmap = await saveRoadmapWithMeta(env, userId, rmResult.roadmap, { quiz, dossier });
              roadmapUpdated = true;
              roadmapUpdateType = roadmapUpdateType || 'patch';
            }
          } catch (err) {
            console.error('Roadmap update failed', err);
          }
        }
      }
      await saveChat(env, userId, persistChatState({
        exchangeCount: 0,
        messages: [{ role: 'assistant', content: reply }],
        roadmapAck: chat.roadmapAck,
        // S10: the transcript is about to be discarded — capture what this
        // conversation was about BEFORE it goes, so the next one can open by
        // picking it up. This is the only moment the messages still exist.
        lastTopic: lastTopicFromMessages(chat.messages, chat.exchangeCount) || chat.lastTopic,
      }, shouldRefreshAck || roadmapUpdated ? roadmap : null));
      return { status: 200, payload: chatResponsePayload({
        reply,
        grounding,
        ui: replyUi,
        exchangeCount: 0,
        remaining: marcoRemaining,
        roadmapUpgrade,
        dossierUpdated,
        roadmapUpdated,
        roadmapUpdateType,
        reset: true,
        manualUpdate: false,
        roadmapRetargeted,
        focusUpdated: false,
        roadmapCapped,
        roadmapCapMessage,
        roadmapRateLimited,
        sectorFitSheet: sectorPatch?.sectorFitSheet,
        sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
        personalityVector: sectorPatch?.personalityVector,
        objectiveVector: sectorPatch?.objectiveVector,
        objectiveAiPatch: sectorPatch?.objectiveAiPatch,
      }) };
    }

    await saveChat(env, userId, persistChatState(chat, shouldRefreshAck ? roadmap : null));
    return { status: 200, payload: chatResponsePayload({
      reply,
      grounding,
      ui: replyUi,
      exchangeCount: chat.exchangeCount,
      remaining: marcoRemaining,
      roadmapUpgrade,
      dossierUpdated: false,
      roadmapUpdated,
      roadmapUpdateType,
      reset: false,
      manualUpdate: false,
      roadmapRetargeted,
      focusUpdated: false,
      roadmapCapped,
      roadmapCapMessage,
      roadmapRateLimited,
      sectorFitSheet: sectorPatch?.sectorFitSheet,
      sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
      personalityVector: sectorPatch?.personalityVector,
      objectiveVector: sectorPatch?.objectiveVector,
      objectiveAiPatch: sectorPatch?.objectiveAiPatch,
    }) };
  } catch (err) {
    console.error('chat turn failed', err && err.stack ? err.stack : err);
    // The user asked a question and got nothing. Charging them an hourly
    // attempt AND one of their daily messages for our failure is how a broken
    // Marco became a locked-out Marco: every retry against the ReferenceError
    // still spent a token, so fixing the bug revealed a rate limit instead of
    // a reply. A 4xx the user DID cause keeps its cost.
    if (!(err && err.status >= 400 && err.status < 500)) {
      await refundSpentBudgets(env, spentBudgets);
    }
    throw err;
  }
}

export async function onRequestPost(context) {
  const origin = originFromEnv(context.env, context.request);
  try {
    const { status, payload } = await runChatTurn(context);
    return authJsonResponse(status, payload, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}
