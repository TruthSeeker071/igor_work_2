/**
 * FlightWay — server facade over the canonical user object.
 *
 * loadUser/saveUser wrap loadUserRow/saveUserRow (the user_profiles table,
 * canonical since 0013; quiz_profiles dropped in 0014). auth.js is imported
 * lazily — same reason school.js does it: keeps _lib.js ⇄ _lib/auth.js
 * cycle-free and the pure helpers importable from plain-Node test scripts.
 */
import { normalizeUser, denormalizeUser, getUserField } from './user-model.js';
import { schoolPromptBlock, sanitizeSchoolName } from './school.js';

const store = () => import('./auth.js');

export { normalizeUser, denormalizeUser, getUserField };

/**
 * The normalized user for this email, or null when no profile exists.
 * Pass opts.quiz to normalize an already-loaded blob without a second D1 read.
 * Stored rows may be v1 (backfilled, not yet re-saved) or v2 — normalize
 * handles both, forever.
 */
export async function loadUser(env, email, opts = {}) {
  const raw = opts.quiz !== undefined
    ? opts.quiz
    : await (await store()).loadUserRow(env, email);
  return raw ? normalizeUser(raw) : null;
}

/** Persist a user — v2 native since Phase 4 (rows upgrade lazily on save). */
export async function saveUser(env, email, user) {
  const { saveUserRow } = await store();
  await saveUserRow(env, email, normalizeUser(user));
}

/**
 * v1-shaped working view of the stored profile (the legacy transformer
 * contract — mirrors the client's FWUser.getBlob). Null when no profile.
 * Phase 4 flips the stored shape; this keeps returning v1.
 */
export async function loadUserBlob(env, email) {
  const user = await loadUser(env, email);
  return user ? denormalizeUser(user) : null;
}

/** Persist a v1-shaped working blob through the model (FWUser.putBlob twin). */
export async function saveUserBlob(env, email, blob) {
  await saveUser(env, email, normalizeUser(blob));
}

/** load → mutate → save in one step; mutator may return a replacement user. */
export async function updateUser(env, email, mutator) {
  const user = (await loadUser(env, email)) || normalizeUser({});
  const result = (typeof mutator === 'function' ? await mutator(user) : null) || user;
  await saveUser(env, email, result);
  return result;
}

/**
 * Identity lines for prompt builders — the facts every advice surface should
 * know, sanitized as data. Includes schoolPromptBlock because the school is a
 * constraint, not just a fact (see school.js).
 */
export function userPromptContext(user) {
  const id = (user && user.identity) || {};
  const clean = (v) => sanitizeSchoolName(v);
  const lines = [];
  if (clean(id.name)) lines.push(`Name: ${clean(id.name)}`);
  if (clean(id.year)) lines.push(`Year: ${clean(id.year)}`);
  if (id.gpa !== null && id.gpa !== undefined && id.gpa !== '') lines.push(`GPA: ${clean(id.gpa)}`);
  if (Array.isArray(id.subjects) && id.subjects.length) {
    lines.push(`Subjects/major interests: ${id.subjects.map(clean).filter(Boolean).join(', ')}`);
  }
  if (clean(id.careerLeaning)) lines.push(`Career leaning: ${clean(id.careerLeaning)}`);
  lines.push(schoolPromptBlock(id.school));
  return lines.join('\n');
}
