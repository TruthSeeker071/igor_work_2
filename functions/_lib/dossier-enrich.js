import {
  loadDossier,
  saveDossier,
  buildSeedDossier,
  isValidDossier,
  DOSSIER_VERSION_MARKER,
  geminiConfigFromEnv,
  geminiGenerateContent,
  geminiTextFromResponse,
} from '../_lib.js';

export const MAX_ANSWER_LEN = 400;
export const MAX_CUSTOM_ANSWERS = 8;

export function normalizeProfileAnswers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      id: item.id ? String(item.id).slice(0, 40) : undefined,
      itemIndex: item.itemIndex != null ? Number(item.itemIndex) : undefined,
      prompt: String(item.prompt || '').slice(0, 240),
      answer: String(item.answer || '').trim().slice(0, MAX_ANSWER_LEN),
    }))
    .filter((item) => item.prompt && item.answer)
    .slice(0, MAX_CUSTOM_ANSWERS);
}

export function dossierFromEnrichPrompt(customAnswers, characterSummary, traits, resumeSummary, currentDossier) {
  const answersBlock = customAnswers
    .map((a) => `Statement: ${a.prompt}\nUser wrote: ${a.answer}`)
    .join('\n\n');
  return [
    'Update the structured user dossier with durable personality and career signals from quiz free-text answers.',
    `Output ONLY dossier text starting with "${DOSSIER_VERSION_MARKER}".`,
    'Merge into quiz_strengths, interests, notes — keep terse. Preserve existing facts.',
    currentDossier ? `<current_dossier>\n${currentDossier}\n</current_dossier>` : '',
    characterSummary ? `<character_summary>\n${characterSummary}\n</character_summary>` : '',
    traits.length ? `<traits>\n${traits.join(', ')}\n</traits>` : '',
    resumeSummary ? `<resume_summary>\n${resumeSummary}\n</resume_summary>` : '',
    answersBlock ? `<custom_answers>\n${answersBlock}\n</custom_answers>` : '',
  ].filter(Boolean).join('\n');
}

export function dossierFromProfileBuildingPrompt(answers, currentDossier) {
  const answersBlock = answers
    .map((a) => `Question: ${a.prompt}\nUser wrote: ${a.answer}`)
    .join('\n\n');
  return [
    'Update the structured user dossier with durable personality and career signals from profile-building free-text answers.',
    `Output ONLY dossier text starting with "${DOSSIER_VERSION_MARKER}".`,
    'Merge into interests, goals, notes, quiz_strengths — keep terse. Preserve existing facts.',
    'These answers reveal what they enjoy, what they are unsure about, and careers they are curious about.',
    currentDossier ? `<current_dossier>\n${currentDossier}\n</current_dossier>` : '',
    answersBlock ? `<profile_building>\n${answersBlock}\n</profile_building>` : '',
  ].filter(Boolean).join('\n');
}

export async function mergeDossierFromPrompt(env, email, mergePrompt, opts = {}) {
  if (!email || !mergePrompt) return false;
  let dossier = opts.currentDossier;
  if (dossier === undefined) dossier = await loadDossier(env, email);
  if (!dossier) dossier = buildSeedDossier({});

  const { apiKey, model } = geminiConfigFromEnv(env);
  if (!apiKey) return false;

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
      return true;
    }
  } catch (err) {
    console.warn('dossier merge failed', err);
  }
  return false;
}

export function formatProfileBuildingBlock(answers, trimFn) {
  if (!Array.isArray(answers) || !answers.length) return '';
  const trim = trimFn || ((s, n) => String(s || '').slice(0, n));
  return `Profile building:\n${answers.slice(0, 5).map((a) => `- ${trim(a.prompt, 80)}: ${trim(a.answer, 120)}`).join('\n')}`;
}

export function buildFallbackIdentityAnalysis(answers, context = {}) {
  const ctx = context || {};
  const trim = (s) => {
    const t = String(s || '').trim();
    if (!t) return 'something meaningful to you';
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  };

  const byId = {};
  (answers || []).forEach((a) => {
    if (a?.id && a?.answer) byId[a.id] = a.answer;
  });

  const fragments = {
    unfinished: (a) => `You're working on ${trim(a)} — something you haven't had time to finish yet.`,
    friends: (a) => `People who know you well say you're naturally good at ${trim(a)}.`,
    curious: (a) => `You've been quietly curious about ${trim(a)}, even if it feels like a long shot.`,
    talk: (a) => `You could talk for twenty minutes about ${trim(a)} without needing to prepare.`,
    downtime: (a) => `When you have real free time, you gravitate toward ${trim(a)}.`,
  };

  const parts = [];
  const name = ctx.userName || ctx.name;
  if (name && name !== 'Student') {
    parts.push(`Here's what stands out about you, ${name}.`);
  } else {
    parts.push("Here's what stands out from what you shared.");
  }

  Object.keys(fragments).forEach((id) => {
    if (byId[id]) parts.push(fragments[id](byId[id]));
  });

  (answers || []).forEach((a) => {
    if (!a?.answer || !a?.id || fragments[a.id]) return;
    parts.push(`You also mentioned: ${trim(a.answer)}.`);
  });

  if (ctx.archetype) {
    parts.push(`Your quiz archetype (${ctx.archetype}) lines up with these signals — your coach and career deep dives will use all of it.`);
  } else if (Array.isArray(ctx.topIndustries) && ctx.topIndustries.length) {
    parts.push(`This fits alongside your top industry matches (${ctx.topIndustries.slice(0, 3).join(', ')}).`);
  }

  return parts.join('\n\n').slice(0, 900);
}

export async function synthesizeIdentityAnalysis(env, answers, context = {}) {
  const { apiKey, model } = geminiConfigFromEnv(env);
  if (!apiKey || !answers.length) return '';

  const ctx = context || {};
  const block = answers.map((a) => `- ${a.prompt}: ${a.answer}`).join('\n');
  const ctxLines = [
    ctx.userName ? `Name: ${ctx.userName}` : '',
    ctx.archetype ? `Quiz archetype: ${ctx.archetype}` : '',
    ctx.topIndustries?.length ? `Top industries: ${ctx.topIndustries.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `Write a warm identity analysis for a student based on their profile-building answers.

Rules:
- Second person ("you")
- 2-3 short paragraphs (500-900 characters total)
- Synthesize themes: strengths, curiosities, how they spend time — show you noticed patterns
- No bullet points, no sales pitch, no generic career advice
- Sound like a thoughtful coach who paid attention

${ctxLines ? `Context:\n${ctxLines}\n` : ''}
Answers:
${block}`;

  try {
    const data = await geminiGenerateContent({
      apiKey,
      model,
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: 400 },
      },
    });
    const text = geminiTextFromResponse(data);
    return String(text || '').trim().slice(0, 900);
  } catch (_) {
    return '';
  }
}

/** @deprecated use synthesizeIdentityAnalysis */
export async function synthesizeInsightsSummary(env, answers) {
  return synthesizeIdentityAnalysis(env, answers, {}).then((t) => t.slice(0, 300));
}

function patchDossierLine(lines, prefix, newValue) {
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return `${prefix} ${newValue}`;
    }
    return line;
  });
  if (!found) {
    const recentIdx = out.findIndex((l) => l.startsWith('recent:'));
    if (recentIdx >= 0) out.splice(recentIdx, 0, `${prefix} ${newValue}`);
    else out.push(`${prefix} ${newValue}`);
  }
  return out;
}

/**
 * Log a target-career switch into the KV dossier (deterministic, no Gemini).
 */
export async function appendCareerSwitchToDossier(env, email, entry) {
  if (!email || !entry?.toName) return false;
  let dossier = await loadDossier(env, email);
  if (!dossier) dossier = buildSeedDossier({});

  const date = new Date(entry.at || Date.now()).toISOString().slice(0, 10);
  const fromName = String(entry.fromName || 'none').slice(0, 80);
  const toName = String(entry.toName).slice(0, 80);
  const source = String(entry.source || 'unknown').slice(0, 32);
  const switchNote = `Switched target career from ${fromName} to ${toName} on ${date} (via ${source}).`;
  const targetLine = `${toName} (switched ${date}, via ${source})`;

  let lines = dossier.split('\n');
  lines = patchDossierLine(lines, 'target_career:', targetLine);

  let foundRecent = false;
  lines = lines.map((line) => {
    if (!line.startsWith('recent:')) return line;
    foundRecent = true;
    const existing = line.slice('recent:'.length).trim();
    const skip = !existing || existing === '(no chat yet)';
    const combined = skip ? switchNote : `${switchNote} ${existing}`;
    return `recent: ${combined.slice(0, 500)}`;
  });
  if (!foundRecent) lines.push(`recent: ${switchNote.slice(0, 500)}`);

  const updated = lines.join('\n');
  if (!isValidDossier(updated)) return false;
  await saveDossier(env, email, updated);
  return true;
}
