/**
 * FlightWay — generalized dossier ↔ user identity-field sync.
 *
 * school.js proved the model: one fact, two representations, ONE sync
 * direction each. The dossier line is what conversation WRITES (a Gemini
 * merge rewrites it when the student states a durable fact); the user store
 * is what code READS. This registry generalizes that to the structured
 * identity fields. Vectors/scores stay one-way (computed; never
 * dossier-written) and are deliberately absent here.
 *
 * Direction rules (the invariant — never add a second writer per direction):
 *  - dossier → user: ONLY syncUserFromDossier, called from saveDossier on
 *    every dossier write. A differing dossier value can only mean the
 *    conversation stated something newer (seed and explicit sets write both
 *    stores in agreement), so the dossier wins.
 *  - user → dossier: ONLY the explicit-set mirrors — setUserField (write the
 *    store, then the dossier line) and mirrorFieldsToDossier (the dossier half
 *    on its own, for a value the client already wrote through /profile/quiz).
 *    Either way saveDossier re-enters syncUserFromDossier, which no-ops
 *    because the two now agree.
 *  - A placeholder ('(unknown)' etc.) never overwrites a real value: each
 *    field's clean() maps placeholders to '' and '' is never synced.
 *
 * These values reach Gemini prompts (via the dossier and userPromptContext),
 * so every clean() sanitizes as data — the sanitizeSchoolName pattern.
 */
import {
  cleanSchoolValue,
  sanitizeSchoolName,
  applySchoolToDossier,
} from './school.js';
import { parseDossierFields, patchDossierLine } from './dossier-parse.js';
import { getUserField, setPath, normalizeUser } from './user-model.js';

// Lazy stores — same reason school.js does it: keeps this module importable
// from plain-Node tests and the _lib.js ⇄ auth.js graph cycle-free.
const store = () => Promise.all([import('../_lib.js'), import('./user.js')])
  .then(([lib, user]) => ({ ...lib, ...user }));

const YEARS = {
  freshman: 'freshman',
  'first-year': 'freshman',
  'first year': 'freshman',
  frosh: 'freshman',
  sophomore: 'sophomore',
  'second-year': 'sophomore',
  'second year': 'sophomore',
  junior: 'junior',
  'third-year': 'junior',
  'third year': 'junior',
  senior: 'senior',
  'fourth-year': 'senior',
  'fourth year': 'senior',
};

export function cleanYearValue(v) {
  const s = sanitizeSchoolName(v).toLowerCase().replace(/\s+year$/, ' year');
  return YEARS[s] || YEARS[s.replace(/ year$/, '')] || '';
}

/** 0–4.33, two decimals, as a Number (the quiz stores numbers). '' if not a GPA. */
export function cleanGpaValue(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 4.33) return '';
  return Math.round(n * 100) / 100;
}

/** Comma/semicolon list → sanitized array, max 8 entries of 60 chars. */
export function cleanSubjectsValue(v) {
  const items = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;]/);
  const out = [];
  items.forEach((item) => {
    const clean = cleanSchoolValue(item).slice(0, 60);
    if (clean && out.length < 8 && out.indexOf(clean) === -1) out.push(clean);
  });
  return out.length ? out : '';
}

export function cleanLeaningValue(v) {
  return cleanSchoolValue(v).slice(0, 120);
}

// key: user-model path. line: dossier field name (buildSeedDossier +
// FIELD_PREFIXES must list every `line` here). toLine/equal handle the
// array-valued subjects field; the defaults cover scalar fields.
export const FIELDS = [
  { key: 'identity.school', line: 'school', clean: cleanSchoolValue },
  { key: 'identity.year', line: 'year', clean: cleanYearValue },
  { key: 'identity.gpa', line: 'gpa', clean: cleanGpaValue },
  {
    key: 'identity.subjects',
    line: 'subjects_major',
    clean: cleanSubjectsValue,
    toLine: (v) => (Array.isArray(v) ? v.join(', ') : String(v || '')),
  },
  { key: 'identity.careerLeaning', line: 'career_leaning', clean: cleanLeaningValue },
];

function fieldByKey(key) {
  return FIELDS.find((f) => f.key === key) || null;
}

function toLineValue(field, value) {
  return field.toLine ? field.toLine(value) : String(value == null ? '' : value);
}

function valuesEqual(field, a, b) {
  return toLineValue(field, a) === toLineValue(field, b);
}

/**
 * Dossier → user store, all registry fields, ONE save. Returns true when it
 * wrote. Called from saveDossier on every dossier write — best-effort there;
 * a failed sync never fails the dossier write.
 */
export async function syncUserFromDossier(env, email, dossierText, opts = {}) {
  const only = opts.only || null;
  const parsed = parseDossierFields(dossierText);
  const updates = [];
  FIELDS.forEach((field) => {
    if (only && only.indexOf(field.key) === -1) return;
    if (!(field.line in parsed)) return;
    const clean = field.clean(parsed[field.line]);
    if (clean === '' || clean == null) return; // placeholder/invalid — never overwrites
    updates.push({ field, clean });
  });
  if (!updates.length) return false;

  const { loadUserBlob, saveUser } = await store();
  const user = normalizeUser((await loadUserBlob(env, email)) || {});
  let changed = false;
  updates.forEach(({ field, clean }) => {
    const current = field.clean(getUserField(user, field.key));
    if (valuesEqual(field, current, clean)) return;
    setPath(user, field.key, clean);
    changed = true;
  });
  if (!changed) return false;
  await saveUser(env, email, user);
  return true;
}

/**
 * User store → dossier for registry fields the client edited through the quiz
 * blob. PUT /profile/quiz needs it for the GPA: the academics panel edits
 * academics.gpa, which normalizeUser resolves into identity.gpa, so without
 * this the dossier line would still hold the onboarding value and the next
 * dossier write would sync it back over the student's edit. Best-effort and
 * never throws — a failed mirror must not fail the profile save. Returns true
 * when it wrote.
 *
 * The GPA is the only field that needs this today: every other identity field
 * comes back from the server on the client's GET-merge-PUT, so a client blob
 * cannot change it.
 */
export async function mirrorFieldsToDossier(env, email, user, opts = {}) {
  const only = opts.only || null;
  try {
    const { loadDossier, saveDossier } = await store();
    const dossier = await loadDossier(env, email);
    if (!dossier) return false;
    let out = dossier;
    FIELDS.forEach((field) => {
      if (only && only.indexOf(field.key) === -1) return;
      const clean = field.clean(getUserField(user, field.key));
      if (clean === '' || clean == null) return; // never clears a stated fact
      out = field.line === 'school'
        ? applySchoolToDossier(out, clean)
        : patchDossierLine(out, field.line, toLineValue(field, clean));
    });
    if (out === dossier) return false;
    await saveDossier(env, email, out);
    return true;
  } catch (err) {
    console.warn('mirrorFieldsToDossier failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Explicit set (the setSchool pattern, generalized): write the user store
 * first, then mirror the dossier line so the next Gemini merge reads the same
 * fact and cannot revert it. Returns the cleaned value ('' clears).
 */
export async function setUserField(env, email, key, value) {
  const field = fieldByKey(key);
  if (!field) throw new Error(`setUserField: unknown field ${key}`);
  const clean = field.clean(value);
  const { loadDossier, saveDossier, loadUserBlob, saveUser } = await store();

  const user = normalizeUser((await loadUserBlob(env, email)) || {});
  if (clean !== '' && clean != null) setPath(user, field.key, clean);
  else setPath(user, field.key, undefined);
  await saveUser(env, email, user);

  try {
    const dossier = await loadDossier(env, email);
    if (dossier) {
      const updated = field.line === 'school'
        ? applySchoolToDossier(dossier, clean) // keeps school's placeholder idiom
        : patchDossierLine(dossier, field.line, toLineValue(field, clean) || '(unknown)');
      if (updated !== dossier) await saveDossier(env, email, updated);
    }
  } catch (err) {
    console.warn(`${field.line} mirror into dossier failed`, err && err.message ? err.message : err);
  }
  return clean;
}
