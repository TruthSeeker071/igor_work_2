import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  getSessionEmail,
  destroyAllSessions,
  clearSessionCookieHeader,
} from './_lib/auth.js';

// Every per-user (email-keyed) D1 table. `derived_careers` is a global catalog
// cache and is intentionally excluded. `users` is deleted last so the row is the
// final thing to go, freeing the email for a clean re-registration.
const USER_TABLES = [
  'artifacts',
  'career_analyses',
  'password_reset_tokens',
  'pricing_intents',
  'roadmaps',
  'sessions',
  'user_profiles',
  'vector_snapshots',
  'users',
];

// KV entries stored as exactly `<type>:<email>`.
const KV_EXACT = [
  'chat', 'derive', 'dossier', 'fb', 'forgot', 'login', 'q', 'register',
  'fpprog', 'roadmap-chat',
];

// KV entries with extra suffixes after the email (`<type>:<email>:...`) — the
// namespace is listed by prefix, then each matching key deleted.
const KV_PREFIXES = [
  'iprepseen', 'rbuildday', 'rbuildsaved', 'stretch', 'wkplan2', 'career-chat',
];

async function deleteKvByPrefix(kv, prefix) {
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys || []) {
      try { await kv.delete(k.name); } catch (_) { /* best effort */ }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

// DELETE /account — the "Doom Button". Purges the signed-in user's account from
// D1 + KV entirely and clears their session, so the same email can re-register
// from scratch. Best-effort per store: one failing table/key never aborts the rest.
export async function onRequestDelete(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  try {
    const email = await getSessionEmail(request, env);
    if (!email) return authJsonResponse(401, { error: 'Not signed in.' }, origin);

    if (env.DB) {
      for (const table of USER_TABLES) {
        try {
          await env.DB.prepare(`DELETE FROM ${table} WHERE email = ?`).bind(email).run();
        } catch (e) {
          console.warn(`account purge: DELETE ${table} failed`, e?.message || e);
        }
      }
    }

    if (env.COACH_KV) {
      for (const type of KV_EXACT) {
        try { await env.COACH_KV.delete(`${type}:${email}`); } catch (_) { /* best effort */ }
      }
      for (const type of KV_PREFIXES) {
        try { await deleteKvByPrefix(env.COACH_KV, `${type}:${email}:`); } catch (_) { /* best effort */ }
      }
    }

    try { await destroyAllSessions(env, email); } catch (_) { /* sessions row already purged above */ }

    return authJsonResponse(200, { ok: true, purged: true }, origin, {
      'Set-Cookie': clearSessionCookieHeader(),
    });
  } catch (err) {
    console.error('account purge failed', err);
    return authErrorResponse(err, origin);
  }
}

// Legacy account-creation path stays retired.
export async function onRequestPost(context) {
  const origin = originFromEnv(context.env, context.request);
  return authJsonResponse(410, {
    error: 'This endpoint is deprecated. Use POST /auth/register instead.',
  }, origin);
}
