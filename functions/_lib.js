// Shared helpers for the AI-coach Cloudflare Pages Functions.
// Uses Workers KV (binding: COACH_KV) instead of Netlify Blobs.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const DOSSIER_VERSION_MARKER = '# user dossier v1';
export const DOSSIER_MAX_CHARS = 4000;
export const EXCHANGE_RESET_AT = 5;

const DOSSIER_PREFIX = 'dossier:';
const CHAT_PREFIX = 'chat:';

export function cors(origin, { credentials = false } = {}) {
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

/** Default CORS allowlist for prototype + canonical prod (comma-override via ALLOWED_ORIGIN). */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://flightwayjacobprototype.pages.dev',
  'https://flightway.ai',
];

function parseAllowedOrigins(env) {
  const raw = env && env.ALLOWED_ORIGIN != null ? String(env.ALLOWED_ORIGIN).trim() : '';
  if (!raw) return null; // unset → caller uses *
  if (raw === '*') return ['*'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve Access-Control-Allow-Origin for a response.
 * - ALLOWED_ORIGIN unset → "*" (local / preview-friendly)
 * - ALLOWED_ORIGIN="*" → "*"
 * - ALLOWED_ORIGIN comma-list + optional request → echo Origin if allowlisted, else first entry
 * Call sites may pass (env) or (env, request).
 */
export function originFromEnv(env, request) {
  const list = parseAllowedOrigins(env);
  if (!list) return '*';
  if (list.length === 1 && list[0] === '*') return '*';
  const reqOrigin = request && typeof request.headers?.get === 'function'
    ? String(request.headers.get('Origin') || '').trim()
    : '';
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return list[0] || DEFAULT_ALLOWED_ORIGINS[0];
}

export function jsonResponse(status, body, origin, opts = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin, opts) },
  });
}

export function preflightResponse(origin, opts = {}) {
  return new Response(null, { status: 204, headers: cors(origin, opts) });
}

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

export function userIdFromEmail(email) {
  return normalizeEmail(email);
}

function requireKv(env) {
  if (!env.COACH_KV) {
    const e = new Error(
      'COACH_KV is not bound. Create a KV namespace in Cloudflare, bind it as COACH_KV in Pages → Settings → Functions → KV namespace bindings, then redeploy.',
    );
    e._userFacing = true;
    throw e;
  }
  return env.COACH_KV;
}

export async function loadDossier(env, userId) {
  const text = await requireKv(env).get(DOSSIER_PREFIX + userId);
  return text || null;
}

// The [[coordinates]] block is composed at read time (dossier-coordinates.js)
// and must never persist: strip it from every save so a Gemini dossier merge
// that echoes it back can't bake a stale vector snapshot into KV.
export const COORDINATES_BLOCK_RE = /\n?\[\[coordinates\]\][\s\S]*?\[\[\/coordinates\]\]\n?/g;

export async function saveDossier(env, userId, text) {
  if (typeof text !== 'string') throw new Error('Dossier must be a string.');
  const trimmed = text.replace(COORDINATES_BLOCK_RE, '\n').slice(0, DOSSIER_MAX_CHARS);
  await requireKv(env).put(DOSSIER_PREFIX + userId, trimmed);
  // The dossier is where durable identity facts get stated ("I'm transferring
  // to X", "I'm a junior now") — the merge rewrites the named field line, and
  // the user store is what prompts and features read. Mirroring here — the one
  // path every dossier writer goes through — is what lets Marco and every
  // derivative update those facts everywhere without knowing they exist.
  // Best-effort and imported lazily: _lib.js must not take a static dependency
  // on auth.js, and a failed mirror must never fail the dossier write.
  try {
    const { syncUserFromDossier } = await import('./_lib/user-sync.js');
    await syncUserFromDossier(env, userId, trimmed);
  } catch (err) {
    console.warn('user sync from dossier failed', err && err.message ? err.message : err);
  }
  return trimmed;
}

export async function loadChat(env, userId) {
  const raw = await requireKv(env).get(CHAT_PREFIX + userId);
  if (!raw) return { exchangeCount: 0, messages: [], roadmapAck: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { exchangeCount: 0, messages: [], roadmapAck: null };
    const roadmapAck = parsed.roadmapAck && typeof parsed.roadmapAck === 'object'
      ? {
        doneActionIds: Array.isArray(parsed.roadmapAck.doneActionIds)
          ? parsed.roadmapAck.doneActionIds.map((id) => String(id))
          : [],
        roadmapUpdatedAt: String(parsed.roadmapAck.roadmapUpdatedAt || ''),
      }
      : null;
    return {
      exchangeCount: Number.isInteger(parsed.exchangeCount) ? parsed.exchangeCount : 0,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      roadmapAck,
    };
  } catch {
    return { exchangeCount: 0, messages: [], roadmapAck: null };
  }
}

export async function saveChat(env, userId, state) {
  const payload = {
    exchangeCount: Number.isInteger(state.exchangeCount) ? state.exchangeCount : 0,
    messages: Array.isArray(state.messages) ? state.messages : [],
  };
  if (state.roadmapAck && typeof state.roadmapAck === 'object') {
    payload.roadmapAck = {
      doneActionIds: Array.isArray(state.roadmapAck.doneActionIds)
        ? state.roadmapAck.doneActionIds.map((id) => String(id))
        : [],
      roadmapUpdatedAt: String(state.roadmapAck.roadmapUpdatedAt || ''),
    };
  }
  await requireKv(env).put(CHAT_PREFIX + userId, JSON.stringify(payload));
}

export function buildSeedDossier(quizResults) {
  const q = quizResults || {};
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.join(', ') : '(unknown)');
  const single = (v) => (v === null || v === undefined || v === '' ? '(unknown)' : String(v));

  return [
    DOSSIER_VERSION_MARKER,
    `top_industries: ${list(q.topIndustries)}`,
    `archetype: ${single(q.archetype)}`,
    `recommended_majors: ${list(q.recommendedMajors)}`,
    `school: ${single(q.school)}`,
    `gpa: ${single(q.gpa)}`,
    `year: ${single(q.year)}`,
    `subjects_major: ${list(q.subjects)}`,
    `career_leaning: ${single(q.careerLeaning)}`,
    `quiz_strengths: ${list(q.strengths)}`,
    `quiz_weaknesses: ${list(q.weaknesses)}`,
    `interests: (none yet)`,
    `goals: (none yet)`,
    `constraints: (none yet)`,
    `context: seeded from career quiz results`,
    `prior_focus: (none yet)`,
    `archived_interests: (none yet)`,
    `recent: (no chat yet)`,
    `notes: (none yet)`,
  ].join('\n');
}

export function isValidDossier(text) {
  if (typeof text !== 'string') return false;
  if (!text.startsWith(DOSSIER_VERSION_MARKER)) return false;
  const required = ['top_industries:', 'interests:', 'goals:', 'recent:'];
  return required.every((k) => text.includes(k));
}

// --- Gemini API (Generative Language) ---
// New AQ.-prefixed keys from AI Studio require x-goog-api-key; ?key= query auth returns 401.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

export function normalizeGeminiApiKey(raw) {
  let key = String(raw || '').trim();
  if (
    (key.startsWith('"') && key.endsWith('"'))
    || (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

export function normalizeSecretValue(raw) {
  return normalizeGeminiApiKey(raw);
}

export function resendConfigFromEnv(env) {
  const apiKey = normalizeSecretValue(env.RESEND_API_KEY);
  const fromEmail = String(env.FROM_EMAIL || 'Flightway <hello@flightway.ai>').trim();
  return { apiKey, fromEmail };
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
/** Next-cheapest stable model for 503 / overload fallback. */
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';

// 2026-07-09: Google hard-retired ALL gemini-2.x generateContent (404
// "no longer available"), so any stale 2.x env override must be discarded.
const DEPRECATED_GEMINI_MODEL_RE = /gemini-2\./i;

function sanitizeGeminiModelName(model) {
  const name = String(model || '').trim();
  if (!name || DEPRECATED_GEMINI_MODEL_RE.test(name)) return '';
  return name;
}

export function geminiConfigFromEnv(env) {
  const model = sanitizeGeminiModelName(env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
  const fallbackModel = sanitizeGeminiModelName(env.GEMINI_FALLBACK_MODEL) || DEFAULT_GEMINI_FALLBACK_MODEL;
  const resumeModel = sanitizeGeminiModelName(env.GEMINI_RESUME_MODEL) || model;
  return {
    apiKey: normalizeGeminiApiKey(env.GEMINI_API_KEY),
    model,
    fallbackModel,
    resumeModel,
    useSearchMode: String(env.GEMINI_USE_SEARCH || 'auto').toLowerCase(),
  };
}

export function resolveGeminiModels(env, opts) {
  opts = opts || {};
  const cfg = geminiConfigFromEnv(env);
  const list = [cfg.model, cfg.fallbackModel];
  if (opts.includeResume) list.push(cfg.resumeModel);
  const out = [];
  list.forEach(function (m) {
    const clean = sanitizeGeminiModelName(m) || DEFAULT_GEMINI_MODEL;
    if (out.indexOf(clean) === -1) out.push(clean);
  });
  if (out.length === 1) {
    const overloadFallback = sanitizeGeminiModelName(DEFAULT_GEMINI_FALLBACK_MODEL);
    if (overloadFallback && out.indexOf(overloadFallback) === -1) out.push(overloadFallback);
  }
  if (!out.length) out.push(DEFAULT_GEMINI_MODEL);
  return out;
}

/** User-facing copy when all Gemini models in the chain are exhausted. */
export function geminiOverloadUserMessage(status) {
  if (status === 429) {
    return 'Google rate-limited this API key. Wait about a minute and try again.';
  }
  if (status === 503) {
    return "Google's AI service is briefly overloaded. Please try again in a few seconds.";
  }
  return 'The AI service is temporarily unavailable. Please try again.';
}

export function geminiGenerateUrl(model) {
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
}

function parseGeminiErrorDetail(detailText) {
  try {
    const parsed = JSON.parse(detailText);
    const details = parsed?.error?.details;
    const reason = Array.isArray(details)
      ? details.find((d) => d.reason)?.reason || ''
      : '';
    return {
      message: parsed?.error?.message || '',
      reason,
    };
  } catch {
    return { message: detailText.slice(0, 200), reason: '' };
  }
}

export function geminiErrorMessage(httpStatus, detailText) {
  const { message, reason } = parseGeminiErrorDetail(detailText);
  if (httpStatus === 401 || reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') {
    return (
      'Gemini authentication failed. Update GEMINI_API_KEY in Cloudflare Pages secrets and redeploy. '
      + 'Use a key from aistudio.google.com/apikey. If the key has HTTP referrer restrictions, remove them for server-side API calls.'
    );
  }
  if (httpStatus === 403) {
    return (
      'Gemini API access denied. Enable the Generative Language API on your Google Cloud project '
      + 'and ensure the API key is not restricted to browser referrers only.'
    );
  }
  if (message) return `Gemini ${httpStatus}: ${message.slice(0, 180)}`;
  return `Gemini ${httpStatus}`;
}

/** Lightweight structured log for Gemini cost/usage tracking in Workers observability. */
export function logGeminiUsage(fields = {}) {
  console.log(JSON.stringify({
    type: 'gemini_usage',
    gemini_calls: 1,
    ts: new Date().toISOString(),
    ...fields,
  }));
}

export async function geminiGenerateContent({ apiKey, model, body, logMeta, timeoutMs }) {
  const key = normalizeGeminiApiKey(apiKey);
  if (!key) {
    const err = new Error('GEMINI_API_KEY is not configured.');
    err._userFacing = true;
    throw err;
  }

  const fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(body),
  };
  // Per-request deadline: a hung upstream call otherwise has nothing to stop
  // it (Workers fetch has no default timeout), which is how roadmap
  // generation once blew past the client's own timeout. Callers that omit
  // timeoutMs get a 30s default — long enough for the largest single JSON
  // generation, short enough that a hung connection can't outlive any
  // client's budget. Abort is surfaced as a retryable (503) error so the
  // caller's model/backoff logic moves on instead of failing hard.
  const effTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    fetchOpts.signal = AbortSignal.timeout(effTimeoutMs);
  }

  let resp;
  try {
    resp = await fetch(geminiGenerateUrl(model), fetchOpts);
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw Object.assign(new Error(`Gemini request timed out after ${timeoutMs}ms.`), {
        status: 503,
        timedOut: true,
      });
    }
    throw err;
  }

  const detailText = resp.ok ? '' : await resp.text();
  if (!resp.ok) {
    console.error(`Gemini API error [${model}]`, resp.status, detailText.slice(0, 500));
    const err = Object.assign(
      new Error(geminiErrorMessage(resp.status, detailText)),
      { status: resp.status, detail: detailText },
    );
    if (resp.status === 401 || resp.status === 403) err._userFacing = true;
    throw err;
  }

  logGeminiUsage({ gemini_model: model, ...(logMeta || {}) });

  return resp.json();
}

export function geminiTextFromResponse(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || '';
}
