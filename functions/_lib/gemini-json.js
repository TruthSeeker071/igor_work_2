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

async function generateOnce({ apiKey, model, prompt, temperature, maxTokens, jsonMode, timeoutMs }) {
  const data = await geminiGenerateContent({
    apiKey,
    model,
    body: buildBody({ prompt, temperature, maxTokens, jsonMode }),
    timeoutMs,
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
    timeoutMs,
    deadlineAt,
  } = opts || {};

  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    const err = Object.assign(new Error('GEMINI_API_KEY is not configured.'), { _userFacing: true });
    if (softFail) return null;
    throw err;
  }

  const models = resolveGeminiModels(env);
  let lastErr = null;

  outer:
  for (const m of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      // §3A.7: cap the whole 2-model x 3-attempt cascade at deadlineAt and clamp
      // each request to the time remaining, matching callGeminiJson — without it
      // the cascade can run ~125s past the caller's soft ceiling.
      let effTimeoutMs = timeoutMs;
      if (deadlineAt) {
        const remaining = deadlineAt - Date.now();
        if (remaining < 2000) {
          if (!lastErr) lastErr = Object.assign(new Error(`${label}: deadline exhausted.`), { status: 503 });
          break outer;
        }
        effTimeoutMs = timeoutMs ? Math.min(timeoutMs, remaining) : remaining;
      }
      try {
        const { text } = await generateOnce({
          apiKey,
          model: m,
          prompt,
          temperature,
          maxTokens,
          jsonMode: false,
          timeoutMs: effTimeoutMs,
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
    timeoutMs,
    deadlineAt,
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

  // Without a deadline the cascade below can run models x tokenLimits x
  // attempts (up to 12 calls); a deadline caps the whole cascade and clamps
  // each request's timeout to the time remaining.
  outer:
  for (const m of models) {
    for (const outputTokens of tokenLimits) {
      // The bumped token tier only helps MAX_TOKENS truncation; re-running an
      // overloaded/erroring model at higher tokens just burns the deadline.
      let bumpTokens = false;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
        let effTimeoutMs = timeoutMs;
        if (deadlineAt) {
          const remaining = deadlineAt - Date.now();
          if (remaining < 2000) {
            if (!lastErr) lastErr = Object.assign(new Error(`${label}: deadline exhausted.`), { status: 503 });
            break outer;
          }
          effTimeoutMs = timeoutMs ? Math.min(timeoutMs, remaining) : remaining;
        }
        try {
          const { text, finishReason } = await generateOnce({
            apiKey,
            model: m,
            prompt,
            temperature,
            maxTokens: outputTokens,
            jsonMode,
            timeoutMs: effTimeoutMs,
          });

          if (jsonMode) {
            try {
              return parseJsonResponse(text);
            } catch (parseErr) {
              if (finishReason === 'MAX_TOKENS' && outputTokens < tokenLimits[tokenLimits.length - 1]) {
                lastErr = parseErr;
                bumpTokens = true;
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
          if (err.finishReason === 'MAX_TOKENS' && outputTokens < tokenLimits[tokenLimits.length - 1]) {
            bumpTokens = true;
          }
          break;
        }
      }
      if (!bumpTokens) break; // next model — bumped tokens won't fix this failure
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
