// FlightWay 2.0 — stateless mock-interview session token (daily-cap integrity).
// Minted on the first turn of a session (the moment the daily slot is spent)
// and verified on every later turn and on the debrief, proving the call belongs
// to a session that actually went through the turn flow — closes the
// debrief-only cap bypass without any per-session storage. Peppered SHA-256 of
// email + server start timestamp, same recipe family as notify-token.js.
// Pure (Web Crypto only) so scripts/test-interview.mjs can import it.

import { sha256Hex, timingSafeEqualHex } from './notify-token.js';

// ~20-minute target session + generous buffer.
export const INTERVIEW_SESSION_MAX_AGE_MS = 40 * 60 * 1000;

function tokenSecret(env) {
  return String((env && (env.SESSION_PEPPER || env.GEMINI_API_KEY)) || 'flightway-dev-pepper');
}

export async function mintInterviewToken(env, email, sessionStartTs) {
  return sha256Hex(`${tokenSecret(env)}:mockiv:${String(email).toLowerCase().trim()}:${Number(sessionStartTs)}`);
}

/** True iff `token` proves `email` started a session at `sessionStartTs` within the age ceiling. */
export async function verifyInterviewToken(env, email, token, sessionStartTs, now = Date.now()) {
  const ts = Number(sessionStartTs);
  if (!token || !Number.isFinite(ts) || ts <= 0) return false;
  const age = now - ts;
  if (age > INTERVIEW_SESSION_MAX_AGE_MS || age < -60 * 1000) return false;
  return timingSafeEqualHex(String(token), await mintInterviewToken(env, email, ts));
}

// Per-turn difficulty marker `${difficulty}.${hash16}`, minted with each
// interviewer turn the server generates and read back from the resent
// transcript on the next turn — so adaptive difficulty is derived from the
// server's own prior markers, never from a client-supplied number. Binding
// questionIndex + sessionStartTs into the hash blocks replaying an easier
// tag from an earlier turn or an older session.
export async function mintDifficultyTag(env, email, sessionStartTs, questionIndex, difficulty) {
  const d = Math.max(1, Math.min(5, Math.round(Number(difficulty) || 3)));
  const h = (await sha256Hex(
    `${tokenSecret(env)}:mockivdiff:${String(email).toLowerCase().trim()}:${Number(sessionStartTs)}:${Number(questionIndex)}:${d}`,
  )).slice(0, 16);
  return `${d}.${h}`;
}

/** The tag's difficulty (1-5) if it verifies for this position, else null. */
export async function verifyDifficultyTag(env, email, sessionStartTs, questionIndex, tag) {
  const m = /^([1-5])\.[0-9a-f]{16}$/.exec(String(tag || ''));
  if (!m) return null;
  const expected = await mintDifficultyTag(env, email, sessionStartTs, questionIndex, Number(m[1]));
  return timingSafeEqualHex(String(tag), expected) ? Number(m[1]) : null;
}
