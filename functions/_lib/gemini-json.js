import {
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiTextFromResponse,
  GEMINI_SAFETY_SETTINGS,
} from '../_lib.js';

const RETRYABLE_STATUS = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [800, 2000];
// Gemini 2.5 spends output budget on internal thinking in JSON mode; callers
// with large structured payloads (derive-fragments) need real headroom.
const MAX_OUTPUT_TOKENS_CAP = 8192;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

export function parseJsonFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Empty Gemini response.');
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('Gemini returned invalid JSON.');
  }
}

function buildBody({ prompt, temperature, maxTokens, jsonMode }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };
  if (jsonMode) {
    body.generationConfig.responseMimeType = 'application/json';
    // Zero thinking budget: Gemini 2.5 otherwise burns maxOutputTokens on
    // internal thinking and truncates large JSON payloads mid-object.
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  return body;
}

async function generateOnce({ apiKey, model, prompt, temperature, maxTokens, jsonMode }) {
  const data = await geminiGenerateContent({
    apiKey,
    model,
    body: buildBody({ prompt, temperature, maxTokens, jsonMode }),
  });
  const finishReason = data?.candidates?.[0]?.finishReason || '';
  const text = geminiTextFromResponse(data);
  if (!text) {
    const blocked = finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS';
    throw Object.assign(
      new Error(blocked ? `Gemini blocked response (${finishReason}).` : 'Gemini returned an empty response.'),
      { status: blocked ? 503 : undefined, finishReason },
    );
  }
  return { text, finishReason };
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseJsonFromText(text);
  }
}

/**
 * Plain-text Gemini call (no JSON mode).
 */
export async function callGeminiText(env, opts) {
  const {
    prompt,
    temperature = 0.55,
    maxTokens = 512,
    label = 'gemini-text',
    softFail = false,
  } = opts || {};

  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    const err = Object.assign(new Error('GEMINI_API_KEY is not configured.'), { _userFacing: true });
    if (softFail) return null;
    throw err;
  }

  const models = resolveGeminiModels(env);
  let lastErr = null;

  for (const m of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const { text } = await generateOnce({
          apiKey,
          model: m,
          prompt,
          temperature,
          maxTokens,
          jsonMode: false,
        });
        return String(text).trim();
      } catch (err) {
        lastErr = err;
        console.warn(`${label} [${m}] attempt ${attempt + 1} failed:`, err?.message || err);
        if (RETRYABLE_STATUS.has(err.status)) continue;
        break;
      }
    }
  }

  if (softFail) return null;
  throw lastErr || new Error('Gemini request failed.');
}

/**
 * Shared Gemini JSON caller — matches proven career-analysis behavior with backoff.
 */
export async function callGeminiJson(env, opts) {
  const {
    prompt,
    temperature = 0.45,
    maxTokens = 1024,
    jsonMode = true,
    label = 'gemini-json',
    softFail = false,
  } = opts || {};

  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    const err = Object.assign(new Error('GEMINI_API_KEY is not configured.'), { _userFacing: true });
    if (softFail) {
      console.warn(`${label}: missing API key`);
      return null;
    }
    throw err;
  }

  const models = resolveGeminiModels(env);
  const baseTokens = Math.min(maxTokens || 1024, MAX_OUTPUT_TOKENS_CAP);
  const bumpedTokens = Math.min(Math.max(baseTokens * 2, baseTokens + 512), MAX_OUTPUT_TOKENS_CAP);
  const tokenLimits = baseTokens === bumpedTokens ? [baseTokens] : [baseTokens, bumpedTokens];
  let lastErr = null;

  for (const m of models) {
    for (const outputTokens of tokenLimits) {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
        try {
          const { text, finishReason } = await generateOnce({
            apiKey,
            model: m,
            prompt,
            temperature,
            maxTokens: outputTokens,
            jsonMode,
          });

          if (jsonMode) {
            try {
              return parseJsonResponse(text);
            } catch (parseErr) {
              if (finishReason === 'MAX_TOKENS' && outputTokens < tokenLimits[tokenLimits.length - 1]) {
                lastErr = parseErr;
                break;
              }
              throw parseErr;
            }
          }

          return parseJsonFromText(text);
        } catch (err) {
          lastErr = err;
          console.warn(`${label} [${m}] attempt ${attempt + 1} failed:`, err?.message || err);
          if (RETRYABLE_STATUS.has(err.status)) continue;
          if (err.finishReason === 'MAX_TOKENS' && outputTokens < tokenLimits[tokenLimits.length - 1]) break;
          break;
        }
      }
    }
  }

  if (lastErr) {
    console.warn(`${label}: exhausted models`, lastErr?.message || lastErr);
    if (softFail) return null;
    throw lastErr;
  }
  if (softFail) return null;
  throw new Error('Gemini request failed.');
}
