import {
  originFromEnv,
  loadDossier,
  saveDossier,
  loadChat,
  saveChat,
  buildSeedDossier,
  isValidDossier,
  EXCHANGE_RESET_AT,
  DOSSIER_VERSION_MARKER,
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiTextFromResponse,
  geminiOverloadUserMessage,
  GEMINI_SAFETY_SETTINGS,
} from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadQuizProfile,
  loadRoadmap,
  saveRoadmap,
  checkRateLimit,
} from './_lib/auth.js';
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

const MAX_MESSAGE_CHARS = 2000;

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
const RETRY_DELAYS_MS = [800, 2000];

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

async function callGeminiOnce({ model, apiKey, systemInstruction, contents, temperature, useSearch }) {
  const body = buildGeminiBody({ systemInstruction, contents, temperature, useSearch });
  const data = await geminiGenerateContent({
    apiKey,
    model,
    body,
    logMeta: { endpoint: '/chat', cached: false, reason: useSearch ? 'coach-search' : 'coach-reply' },
  });
  const text = geminiTextFromResponse(data);
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
      if (!RETRYABLE_STATUS.has(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Gemini request failed.');
}

async function callGemini(env, { systemInstruction, contents, temperature = 0.7, useSearch = false }) {
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

  let lastStatus = null;
  for (const { model: m, useSearch: search } of attempts) {
    try {
      return await callGeminiWithRetries({
        model: m,
        apiKey,
        systemInstruction,
        contents,
        temperature,
        useSearch: search,
      });
    } catch (err) {
      lastStatus = err.status || lastStatus;
      if (err.status !== 429 && err.status !== 503) throw err;
      console.warn(`Gemini [${m}] failed (${err.status}), trying next option…`);
    }
  }

  const friendly = geminiOverloadUserMessage(lastStatus);
  const e = new Error(friendly);
  e._userFacing = true;
  throw e;
}

function chatSystemPrompt(dossier, roadmapBlock, progressAckBlock, noRoadmapHint, switchHint, profileSignalsBlock) {
  const roadmapSection = roadmapBlock || '';
  const progressSection = progressAckBlock || '';
  const noRoadmapSection = noRoadmapHint || '';
  const switchSection = switchHint || '';
  const profileSection = profileSignalsBlock ? `\n${profileSignalsBlock}\n` : '';
  return `# Marco — Flightway's AI Career Advisor

## Identity
You are Marco, the user's friendly AI career advisor inside Flightway. You are warm and
personable in HOW you talk, but your actual guidance is honest, direct, and specific — a
friendly face giving straight talk, never empty cheerleading.
You are an honest career and academics advisor for a student user. Tell them what is true and
useful across any domain: career planning, college academics, majors and course selection,
internships and recruiting, workload management, skill-building, and personal trajectory.
Credibility depends entirely on accuracy and consistency under pushback.

If this is the FIRST message of the conversation (no prior assistant turns), open by briefly
introducing yourself: you're Marco, their AI career advisor, and you're already caught up on
everything from their quizzes and chats — so they can dive straight in. One or two warm
sentences, then answer or invite their question. On every later message, skip the intro.

## Reasoning protocol (internal — never surface this process)
Before every response:
1. Identify the domain of the question (career | academics | planning | skills | personal | mixed).
   Do not import career framing into questions that don't call for it.
2. Reconcile sources: the dossier below + the current conversation. Newer supersedes older.
   If the dossier contradicts your training knowledge about the user, trust the dossier.
3. Filter for user-specificity. Would this answer change if advising a different student?
   If not, cut it. Strip generically-true filler.
4. Identify the crux — the single most important thing they need to know or do. Lead with it.
5. Check for distortion before outputting: softening a hard truth under emotional pressure?
   Manufacturing false balance between unequal options? Capitulating to pushback without new
   information? Giving a generic answer when a user-specific one is available? Correct any "yes."

## Research
You have Google Search available. Use it for questions involving specific schools, programs,
courses, deadlines, firms, salaries, or any current factual claim. Do not answer from memory
alone on facts that change over time. When you searched, weave findings in naturally and name
the source institution. Label uncertain claims as such. Source hierarchy: official pages >
institutional publications > credentialed guides > forums (flag as unverified).

## Communication rules
- Light formatting only. The chat supports bold (**text**), italics (*text*), and simple
  numbered or dashed lists. Do NOT use headers (#), tables, code blocks, or nested lists.
  Use formatting sparingly — most replies should be plain prose.
- Lead with the answer. No preamble, no restating the question.
- 2-4 sentence paragraphs. Keep replies under ~150 words unless the user asks for depth.
- No motivational filler, no "That's a great question!", no offers of next steps at the end.
- One focused follow-up question is fine when it genuinely advances the conversation.
- Treat the user as capable. Don't dumb things down; don't pad.
- Do not thank them for corrections. Incorporate and continue.

## Dossier
The dossier below is the user's persistent profile. Never ask for information already in it.
If the user states a new durable fact about themselves (a major they want, a school decision,
a goal, a constraint), acknowledge it naturally — it will be merged into the dossier later.
If the user asks you to update the dossier, tell them it's being updated now (the system
handles the actual update).
${switchSection}${noRoadmapSection}${roadmapSection}${progressSection}${profileSection}
<user_dossier>
${dossier}
</user_dossier>`;
}

function dossierUpdatePrompt(currentDossier, transcript) {
  const transcriptText = transcript
    .map((m) => `${m.role === 'assistant' ? 'COACH' : 'USER'}: ${m.content}`)
    .join('\n');
  return [
    'You are updating a structured user dossier from a recent chat transcript.',
    '',
    'EXTRACTION RULES (apply in order):',
    '1. Scan every USER line for durable facts: stated majors/minors, school decisions,',
    '   goals, interests, constraints, preferences, deadlines, background details.',
    '   A single mention is enough — if the user said "I want to major in X and minor',
    '   in Y", that MUST appear in the goals field of the new dossier.',
    '2. Statements late in the transcript matter just as much as early ones. Re-read',
    '   the final USER messages carefully before finishing.',
    '3. Newer statements supersede older dossier values when they conflict.',
    '4. Merge into the existing dossier. Preserve the exact schema and field order.',
    '   Keep values terse and comma-separated.',
    '5. If a field has no new info, keep its existing value unchanged.',
    '6. Use "recent:" for conversation topics that are not yet durable facts. Move',
    '   stale recent items into stable sections (interests, goals) or drop them.',
    '7. If the total dossier would exceed ~500 tokens, compress redundant items.',
    '',
    'SELF-CHECK before output: list (mentally) each durable fact stated by the USER',
    'in the transcript, and verify each one appears somewhere in your output dossier.',
    'Losing a user-stated fact is the worst possible failure.',
    '',
    `Output ONLY the new dossier text, starting with "${DOSSIER_VERSION_MARKER}".`,
    'No markdown fences, no commentary.',
    '',
    '<current_dossier>',
    currentDossier,
    '</current_dossier>',
    '',
    '<recent_transcript>',
    transcriptText,
    '</recent_transcript>',
  ].join('\n');
}

function isManualDossierCommand(message) {
  const m = message.toLowerCase();
  return (
    /\b(update|refresh|save|sync|regenerate)\b[^.!?]{0,40}\bdossier\b/.test(m)
    || /\bdossier\b[^.!?]{0,30}\b(update|refresh|save)\b/.test(m)
  );
}

function transcriptHasDurableFacts(transcript) {
  const userMsgs = (transcript || []).filter((m) => m && m.role === 'user');
  if (userMsgs.length < 2) return false;
  const durableRe = /\b(i am|i'm|i study|my major|my school|i work|i intern|i graduated|i want to|my goal|i live in|i'm from|i have a|i took|i'm taking)\b/i;
  return userMsgs.some((m) => durableRe.test(String(m.content || '')));
}

async function updateDossierFromTranscript(env, userId, currentDossier, transcript) {
  const newDossier = await callGemini(env, {
    systemInstruction:
      'You are a precise data-merger. Follow the user instructions exactly and output only the requested dossier text.',
    contents: [
      {
        role: 'user',
        parts: [{ text: dossierUpdatePrompt(currentDossier, transcript) }],
      },
    ],
    temperature: 0.2,
  });

  const cleaned = newDossier
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/```\s*$/, '')
    .trim();

  if (!isValidDossier(cleaned)) {
    console.warn('Dossier update produced invalid output; keeping previous dossier.');
    return { updated: false, dossier: currentDossier };
  }
  const saved = await saveDossier(env, userId, cleaned);
  return { updated: true, dossier: saved };
}

function chatResponsePayload({
  reply,
  exchangeCount,
  dossierUpdated,
  roadmapUpdated,
  roadmapUpdateType,
  reset,
  manualUpdate,
  roadmapRetargeted,
  focusUpdated,
  roadmapRateLimited,
  sectorFitSheet,
  sectorFitUpdated,
  personalityVector,
  objectiveVector,
  objectiveAiPatch,
}) {
  return {
    reply,
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
  };
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

  const deterministic = tryDeterministicRoadmapPatch(userMessage, roadmap);
  if (deterministic.updated) {
    const saved = await saveRoadmapWithMeta(env, userId, deterministic.roadmap, { quiz, dossier });
    return { updated: true, roadmap: saved, type: 'patch', retargeted: false };
  }

  if (isRoadmapPlanEditIntent(userMessage)) {
    const markDoneOnly = /\b(mark|marked|done|complete|completed|finished|checked off)\b/i.test(userMessage)
      && !/\b(add|remove|change|replace|instead|swap|new action|new step|update|edit|tweak)\b/i.test(userMessage);
    if (!markDoneOnly) {
      const patch = await applyRoadmapPatchFromMessage(env, {
        dossier,
        currentRoadmap: roadmap,
        userMessage,
        history,
      });
      if (patch.updated) {
        const saved = await saveRoadmapWithMeta(env, userId, patch.roadmap, { quiz, dossier });
        return { updated: true, roadmap: saved, type: 'patch', retargeted: false };
      }
    }
  }

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
    if (target.pivoted && target.slug && target.name) {
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
      });
      if (syncResult?.roadmap && !syncResult.cached) {
        return {
          updated: true,
          roadmap: syncResult.roadmap,
          type: syncResult.retargeted ? 'regenerate' : 'sync',
          retargeted: !!syncResult.retargeted,
        };
      }
    } catch (err) {
      console.warn('coach roadmap sync regen failed', err);
    }
  }

  return { updated: false, roadmap, type: null, retargeted: false };
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const { apiKey, useSearchMode } = geminiConfigFromEnv(env);

  if (!apiKey) {
    return authJsonResponse(
      500,
      {
        error:
          'AI service is not configured. Set GEMINI_API_KEY in Cloudflare Pages → Settings → Variables and Secrets.',
      },
      origin,
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const userMessage = String(payload.message || '').trim();

  if (!userMessage) {
    return authJsonResponse(400, { error: 'Message cannot be empty.' }, origin);
  }
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    return authJsonResponse(
      400,
      { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      origin,
    );
  }

  try {
    const { email: userId } = await requireSession(request, env);
    await checkRateLimit(env, `chat:${userId}`);

    let [dossier, chat, quiz, roadmap] = await Promise.all([
      loadDossier(env, userId).catch(() => null),
      loadChat(env, userId),
      loadQuizProfile(env, userId).catch(() => null),
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
    const starterContext = String(payload.starterContext || '').trim().slice(0, 300);
    if (starterContext && chat.messages.length === 0) {
      chat.messages.push({ role: 'assistant', content: starterContext });
    }

    const newlyDone = getNewlyDoneActions(roadmap, chat.roadmapAck);
    const roadmapBlock = buildCoachRoadmapContextBlock(roadmap, userMessage);
    const progressAckBlock = buildProgressAckBlock(newlyDone);
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
      return authJsonResponse(
        200,
        chatResponsePayload({
          reply,
          exchangeCount: chat.exchangeCount,
          dossierUpdated: false,
          roadmapUpdated,
          roadmapUpdateType,
          reset: false,
          manualUpdate: true,
        }),
        origin,
      );
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
      return authJsonResponse(
        200,
        chatResponsePayload({
          reply,
          exchangeCount: chat.exchangeCount,
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
        }),
        origin,
      );
    }

    chat.messages.push({ role: 'user', content: userMessage });
    const profileSignals = buildProfileSignalsBlock(quiz, dossier);
    const reply = await callGemini(env, {
      systemInstruction: chatSystemPrompt(dossier, roadmapBlock, progressAckBlock, noRoadmapHint, switchHint, profileSignals),
      contents: toGeminiContents(chat.messages),
      temperature: 0.7,
      useSearch: needsWebSearch(userMessage, useSearchMode),
    });

    chat.messages.push({ role: 'assistant', content: reply });
    chat.exchangeCount += 1;

    let dossierUpdated = false;
    let roadmapUpdated = false;
    let roadmapUpdateType = null;
    let roadmapRetargeted = false;
    let roadmapRateLimited = false;
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
      }, shouldRefreshAck || roadmapUpdated ? roadmap : null));
      return authJsonResponse(
        200,
        chatResponsePayload({
          reply,
          exchangeCount: 0,
          dossierUpdated,
          roadmapUpdated,
          roadmapUpdateType,
          reset: true,
          manualUpdate: false,
          roadmapRetargeted,
          focusUpdated: false,
          roadmapRateLimited,
          sectorFitSheet: sectorPatch?.sectorFitSheet,
          sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
          personalityVector: sectorPatch?.personalityVector,
          objectiveVector: sectorPatch?.objectiveVector,
          objectiveAiPatch: sectorPatch?.objectiveAiPatch,
        }),
        origin,
      );
    }

    await saveChat(env, userId, persistChatState(chat, shouldRefreshAck ? roadmap : null));
    return authJsonResponse(
      200,
      chatResponsePayload({
        reply,
        exchangeCount: chat.exchangeCount,
        dossierUpdated: false,
        roadmapUpdated,
        roadmapUpdateType,
        reset: false,
        manualUpdate: false,
        roadmapRetargeted,
        focusUpdated: false,
        roadmapRateLimited,
        sectorFitSheet: sectorPatch?.sectorFitSheet,
        sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
        personalityVector: sectorPatch?.personalityVector,
        objectiveVector: sectorPatch?.objectiveVector,
        objectiveAiPatch: sectorPatch?.objectiveAiPatch,
      }),
      origin,
    );
  } catch (err) {
    console.error('chat handler failed', err && err.stack ? err.stack : err);
    return authErrorResponse(err, origin);
  }
}
