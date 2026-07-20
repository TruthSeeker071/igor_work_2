import { isValidEmail, normalizeEmail } from '../_lib.js';
import { normalizeUser, setPath } from './user-model.js';
import {
  normalizeRoadmap,
  ROADMAP_MAX_CHARS,
  migrateRoadmapV1ToV2,
  isValidRoadmapV1,
} from './roadmap.js';

export const SESSION_COOKIE = 'fw_session';
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LEN = 8;
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_ANALYSIS_MAX = 20;
export const RATE_LIMIT_SYNC_MAX = 30;
export const RATE_LIMIT_SPLIT_MAX = 20;
export const RATE_LIMIT_DERIVE_MAX = 8;
export const RATE_LIMIT_GAP_CHECKLIST_MAX = 15;
export const RATE_LIMIT_WINDOW_SEC = 3600;
export const RESET_TOKEN_TTL_SEC = 3600;
// Career analyses are considered fresh for 6h (matches the client localStorage TTL).
export const ANALYSIS_FRESH_MS = 6 * 3600 * 1000;
// Cap stored analysis JSON to keep D1 rows small and reject pathological payloads.
const ANALYSIS_MAX_CHARS = 24000;

const PBKDF2_ITERATIONS = 100000;

function requireDb(env) {
  if (!env.DB) {
    const err = new Error('Database is not configured.');
    err._userFacing = true;
    throw err;
  }
  return env.DB;
}

function nowIso() {
  return new Date().toISOString();
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function sessionPepper(env) {
  return String(env.SESSION_PEPPER || env.GEMINI_API_KEY || 'flightway-dev-pepper');
}

export async function hashSessionToken(token, env) {
  return sha256Hex(`${sessionPepper(env)}:${token}`);
}

export function generateToken(byteLen = 32) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LEN;
}

export async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = bytesToHex(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  const hashHex = bytesToHex(new Uint8Array(derived));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHash = parts[3];
  if (!Number.isFinite(iterations) || !saltHex || !expectedHash) return false;

  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  const actualHash = bytesToHex(new Uint8Array(derived));
  return timingSafeEqual(actualHash, expectedHash);
}

// Well-formed but non-matching hash used to run a real PBKDF2 verification on
// the "user not found" login branch, so response time can't distinguish a
// registered email from an unregistered one (timing-based user enumeration).
export const DUMMY_PASSWORD_HASH =
  'pbkdf2$100000$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function sessionCookieHeader(token, maxAgeSec) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export async function createSession(env, email) {
  const db = requireDb(env);
  const token = generateToken(32);
  const tokenHash = await hashSessionToken(token, env);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();

  await db.prepare(
    'INSERT INTO sessions (id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, email, tokenHash, expiresAt, createdAt).run();

  return { token, expiresAt };
}

export async function destroySession(env, token) {
  if (!token || !env.DB) return;
  const tokenHash = await hashSessionToken(token, env);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function destroyAllSessions(env, email) {
  if (!env.DB) return;
  await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
}

export async function getSessionEmail(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token || !env.DB) return null;

  const tokenHash = await hashSessionToken(token, env);
  const row = await env.DB.prepare(
    'SELECT email, expires_at FROM sessions WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first();

  if (!row || !row.email) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return normalizeEmail(row.email);
}

export async function requireSession(request, env) {
  const email = await getSessionEmail(request, env);
  if (!email || !isValidEmail(email)) {
    const err = new Error('Sign in required.');
    err.status = 401;
    err._userFacing = true;
    throw err;
  }
  return { email };
}

export async function optionalSession(request, env) {
  try {
    const email = await getSessionEmail(request, env);
    if (email && isValidEmail(email)) return { email };
  } catch (_) { /* ignore */ }
  return null;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

export async function checkRateLimit(env, key, opts = {}) {
  if (!env.COACH_KV) return;
  const max = opts.max ?? RATE_LIMIT_MAX;
  const fullKey = `auth_rate:${key}`;
  const raw = await env.COACH_KV.get(fullKey);
  const count = raw ? Number(raw) : 0;
  if (count >= max) {
    const err = new Error('Too many attempts. Please try again later.');
    err.status = 429;
    err._userFacing = true;
    throw err;
  }
  await env.COACH_KV.put(fullKey, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SEC });
}

export async function findUserByEmail(env, email) {
  const db = requireDb(env);
  return db.prepare('SELECT email, password_hash, created_at, updated_at FROM users WHERE email = ?')
    .bind(email).first();
}

export async function createUser(env, email, passwordHash) {
  const db = requireDb(env);
  const ts = nowIso();
  await db.prepare(
    'INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).bind(email, passwordHash, ts, ts).run();
}

export async function updateUserPassword(env, email, passwordHash) {
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?',
  ).bind(passwordHash, nowIso(), email).run();
}

export async function saveQuizPortalSnapshot(env, email, portalSnapshot) {
  const user = normalizeUser((await loadUserRow(env, email)) || {});
  setPath(user, 'journey.portalSnapshot', portalSnapshot);
  await saveUserRow(env, email, user);
}

// user_profiles is canonical storage since 0013 (payload is v2, or v1 for
// backfilled rows not yet re-saved — loadUserRow's callers normalize on read
// forever). quiz_profiles was dropped in 0014.
export async function saveUserRow(env, email, payload) {
  const ts = nowIso();
  const json = JSON.stringify(payload);
  await env.DB.prepare(
    `INSERT INTO user_profiles (email, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  ).bind(email, json, ts).run();
}

export async function loadUserRow(env, email) {
  const row = await env.DB.prepare('SELECT payload FROM user_profiles WHERE email = ?')
    .bind(email).first();
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

export async function saveRoadmap(env, email, payload) {
  const normalized = normalizeRoadmap(payload, payload);
  if (!normalized) {
    const err = new Error('Invalid roadmap data.');
    err.status = 400;
    err._userFacing = true;
    throw err;
  }
  const json = JSON.stringify(normalized);
  if (json.length > ROADMAP_MAX_CHARS) {
    const err = new Error('Roadmap is too large to save.');
    err.status = 400;
    err._userFacing = true;
    throw err;
  }
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO roadmaps (email, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  ).bind(email, json, ts).run();
}

export async function loadRoadmap(env, email) {
  const row = await env.DB.prepare('SELECT payload FROM roadmaps WHERE email = ?')
    .bind(email).first();
  if (!row?.payload) return null;
  try {
    const data = JSON.parse(row.payload);
    if (isValidRoadmapV1(data)) {
      const migrated = migrateRoadmapV1ToV2(data);
      if (migrated) {
        await saveRoadmap(env, email, migrated);
        return migrated;
      }
    }
    return normalizeRoadmap(data, data) || data;
  } catch {
    return null;
  }
}

export async function saveCareerAnalysis(env, email, slug, payload) {
  if (!env.DB || !email || !slug || !payload) return;
  const json = JSON.stringify(payload);
  if (json.length > ANALYSIS_MAX_CHARS) return;
  await env.DB.prepare(
    `INSERT INTO career_analyses (email, slug, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email, slug) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  ).bind(email, slug, json, nowIso()).run();
}

export async function loadCareerAnalysis(env, email, slug) {
  if (!env.DB || !email || !slug) return null;
  const row = await env.DB.prepare(
    'SELECT payload, updated_at FROM career_analyses WHERE email = ? AND slug = ?',
  ).bind(email, slug).first();
  if (!row?.payload) return null;
  try {
    return { payload: JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function loadCareerAnalyses(env, email, opts = {}) {
  if (!env.DB || !email) return [];
  const sinceMs = opts.sinceMs != null ? opts.sinceMs : ANALYSIS_FRESH_MS;
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const result = await env.DB.prepare(
    'SELECT slug, payload, updated_at FROM career_analyses WHERE email = ? AND updated_at > ?',
  ).bind(email, sinceIso).all();
  const rows = (result && result.results) || [];
  const out = [];
  for (const row of rows) {
    if (!row || !row.payload) continue;
    try {
      out.push({ slug: row.slug, payload: JSON.parse(row.payload), updatedAt: row.updated_at });
    } catch { /* skip corrupt row */ }
  }
  return out;
}

export async function invalidateCareerAnalyses(env, email) {
  if (!env.DB || !email) return 0;
  const result = await env.DB.prepare(
    'DELETE FROM career_analyses WHERE email = ?',
  ).bind(email).run();
  return result?.meta?.changes || 0;
}

export async function createPasswordResetToken(env, email) {
  const token = generateToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SEC * 1000).toISOString();
  await env.DB.prepare('DELETE FROM password_reset_tokens WHERE email = ?').bind(email).run();
  await env.DB.prepare(
    'INSERT INTO password_reset_tokens (token_hash, email, expires_at, used_at) VALUES (?, ?, ?, NULL)',
  ).bind(tokenHash, email, expiresAt).run();
  return token;
}

export async function consumePasswordResetToken(env, token) {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT email, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first();

  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  await env.DB.prepare(
    'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?',
  ).bind(nowIso(), tokenHash).run();

  return normalizeEmail(row.email);
}

export function quizProfileToSeed(quizProfile) {
  if (!quizProfile || typeof quizProfile !== 'object') return {};
  const identity = normalizeUser(quizProfile).identity;
  const scores = quizProfile.scores || {};
  const topIndustries = Object.entries(scores)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
  return {
    topIndustries,
    archetype: quizProfile.name || 'Student',
    school: identity.school || null,
    gpa: identity.gpa ?? null,
    year: identity.year || null,
    subjects: Array.isArray(identity.subjects) ? identity.subjects : [],
    careerLeaning: identity.careerLeaning || null,
    strengths: topIndustries,
    weaknesses: [],
  };
}

export function authJsonResponse(status, body, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

export function authPreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function authErrorResponse(err, origin) {
  const status = err.status || 500;
  const message = err._userFacing
    ? err.message
    : 'Something went wrong. Please try again.';
  return authJsonResponse(status, { error: message }, origin);
}
