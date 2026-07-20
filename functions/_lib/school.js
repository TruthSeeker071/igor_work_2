/**
 * FlightWay — the student's school, in one place.
 *
 * Two stores, deliberately kept in step:
 *  - `quiz_profiles.school` (D1) is what code READS — every prompt, the
 *    opportunity finder, the [[coordinates]] digest.
 *  - the dossier's `school:` line (KV) is what conversation WRITES — when the
 *    student tells Marco "I'm transferring to X", the dossier merge rewrites
 *    that line like any other durable fact.
 *
 * `saveDossier()` calls syncSchoolFromDossier on every write, so a school
 * change stated in ANY conversation (Marco, waypoint chat, career-switch chat,
 * profile building, a resume upload) lands in quiz_profiles without those
 * surfaces knowing that schools exist. setSchool() writes both stores, so the
 * opportunity finder's field and the dossier can never disagree — that pair is
 * the whole invariant: one fact, two representations, one sync direction each.
 *
 * ADDING AN AI SURFACE THAT ADVISES A STUDENT? Put schoolPromptBlock() in its
 * prompt. Advice that names a club, team, fund, course code or campus program
 * is simply wrong when it names a school the student does not attend — and the
 * model will name one, because web evidence is full of other universities'.
 * scripts/test-school.mjs keeps the wired surfaces honest; add new ones there.
 */

// No static imports on purpose: the pure helpers below are imported by
// opportunity-core.js (which scripts unit-test in plain Node) and by _lib.js's
// saveDossier, so the D1/KV dependencies are pulled in lazily, inside the three
// functions that actually need them. That also keeps _lib.js ⇄ auth.js
// cycle-free.
const store = () => Promise.all([import('../_lib.js'), import('./auth.js'), import('./user.js')])
  .then(([lib, auth, user]) => ({ ...lib, ...auth, ...user }));

// Pure and dependency-free, so a static import keeps this file plain-Node
// testable and the _lib.js ⇄ auth.js cycle unbroken. The user model owns the
// v1 blob's school quirk (root key + profile.school): reads coalesce the two,
// writes land in both, so they can never drift again.
import { normalizeUser } from './user-model.js';

// Placeholder values the seed dossier and enrichment passes write for "we
// don't know yet" — treating one as a school name is worse than knowing nothing.
const PLACEHOLDERS = new Set(['', '(unknown)', '(none yet)', '(none)', 'unknown', 'none', 'n/a', 'na', 'null', 'undefined', 'tbd']);
const SCHOOL_LINE_RE = /^[ \t]*school:[ \t]*(.*)$/im;

export function sanitizeSchoolName(v) {
  return String(v == null ? '' : v)
    .replace(/[<>&"']/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function normalizeSchoolKey(school) {
  return sanitizeSchoolName(school).toLowerCase();
}

/** '' for anything that is a placeholder rather than a real school name. */
export function cleanSchoolValue(v) {
  const clean = sanitizeSchoolName(v);
  return PLACEHOLDERS.has(clean.toLowerCase()) ? '' : clean;
}

/**
 * The block every advice-giving prompt should carry. States the school as a
 * fact AND as a constraint: naming the fact alone does not stop a model that
 * has just been handed web evidence about another university's quant fund.
 */
export function schoolPromptBlock(school) {
  const clean = cleanSchoolValue(school);
  if (!clean) {
    return 'School: not stated — prefer national, online or open-to-anyone programs, and never name a specific university\'s internal club, team or fund.';
  }
  return `School: ${clean}
LOCATION CONSTRAINT (hard): every club, team, fund, competition team, course code and campus program you name must be one this student can actually join or enroll in — i.e. at ${clean}, or open to students anywhere. NEVER name another university's internal club, team or fund (e.g. a quant fund, trading team or society belonging to a different school): they cannot join it. When you are not sure ${clean} has an equivalent, name a national/online program instead, or tell them to start one.`;
}

/** Read the dossier's `school:` field. */
export function schoolFromDossier(text) {
  const m = SCHOOL_LINE_RE.exec(String(text || ''));
  return m ? cleanSchoolValue(m[1]) : '';
}

/** Rewrite (or append) the dossier's `school:` line. Returns the new text. */
export function applySchoolToDossier(text, school) {
  const src = String(text || '');
  if (!src) return src;
  const line = `school: ${cleanSchoolValue(school) || '(unknown)'}`;
  if (SCHOOL_LINE_RE.test(src)) return src.replace(SCHOOL_LINE_RE, line);
  // `school:` is a known field prefix, so an appended line terminates the
  // preceding field cleanly for parseDossierFields.
  return `${src.replace(/\s+$/, '')}\n${line}`;
}

/**
 * quiz_profiles.school, falling back to the dossier for accounts whose school
 * was only ever stated in conversation. The fallback persists by default:
 * leaving it unadopted means every later read re-derives it and the
 * opportunity finder still shows an empty field.
 */
export async function resolveSchool(env, email, opts = {}) {
  const { quiz, persist = true } = opts;
  const { loadDossier, loadUserBlob, saveUser } = await store();
  const profile = quiz !== undefined ? quiz : await loadUserBlob(env, email).catch(() => null);
  const fromQuiz = cleanSchoolValue(normalizeUser(profile || {}).identity.school);
  if (fromQuiz) return fromQuiz;

  const fromDossier = schoolFromDossier(await loadDossier(env, email).catch(() => null));
  if (!fromDossier || !persist) return fromDossier;
  try {
    const base = (profile && typeof profile === 'object' ? profile : await loadUserBlob(env, email)) || {};
    const user = normalizeUser(base);
    user.identity.school = fromDossier;
    await saveUser(env, email, user);
  } catch (err) {
    console.warn('school adopt from dossier failed', err && err.message ? err.message : err);
  }
  return fromDossier;
}

/**
 * Set the school explicitly (the opportunity finder's field). Writes D1 first,
 * then mirrors into the dossier so the next Gemini dossier merge reads the same
 * fact and cannot revert it. The mirror's saveDossier re-enters
 * syncSchoolFromDossier, which no-ops because the two now agree.
 */
export async function setSchool(env, email, school) {
  const { setUserField } = await import('./user-sync.js');
  return setUserField(env, email, 'identity.school', school);
}

/**
 * Dossier → quiz_profiles. Called from saveDossier on every dossier write, so
 * "I'm transferring to X" propagates from whichever conversation stated it.
 * Returns true when it actually wrote.
 */
export async function syncSchoolFromDossier(env, email, dossierText) {
  const { syncUserFromDossier } = await import('./user-sync.js');
  return syncUserFromDossier(env, email, dossierText, { only: ['identity.school'] });
}
