/**
 * FlightWay — the canonical user object (v2) and its mapping to the legacy
 * quiz blob (v1). Pure and dependency-free on purpose: plain-Node scripts
 * unit-test it (scripts/test-user-model.mjs) and the client facade
 * (assets/js/shared/user.js) mirrors it verbatim — test:user asserts the two
 * KEY_MAPs and normalize outputs never drift.
 *
 * KEY_MAP is the spec. Every stored top-level field of fw_hub_quiz_v1 /
 * quiz_profiles.payload appears here exactly once per storage location;
 * unknown fields pass through untouched so a round-trip never drops data.
 *
 * v1 quirks this module owns — same shape both times: one fact, two v1 homes,
 * ONE canonical v2 field, and a denormalize mirror that writes it back to both
 * so they can never drift again. Those two mirrors are the only deliberate
 * asymmetries in the round-trip.
 *   - school: blob root (written by school.js dossier sync) + profile.school
 *     (written by the quiz). Coalesced root-first.
 *   - gpa: profile.gpa (written once at quiz completion) + academics.gpa (what
 *     the academics panel edits thereafter, and what the vector GPA boost
 *     reads). Coalesced academics-first — the panel's value is the live one —
 *     and the academics copy is dropped from v2, so identity.gpa is the single
 *     GPA. The dossier sync (user-sync.js FIELDS) writes identity.gpa; the
 *     mirror carries it back to academics.gpa for the vector rebuild.
 */

// [v1 path, v2 path] — order matters only for the two-home rows (school, gpa):
// the path listed first wins when both exist and disagree.
export const KEY_MAP = [
  ['name', 'identity.name'],
  ['school', 'identity.school'],
  ['profile.school', 'identity.school'],
  ['profile.schoolCity', 'identity.schoolCity'],
  ['profile.year', 'identity.year'],
  ['academics.gpa', 'identity.gpa'],
  ['profile.gpa', 'identity.gpa'],
  ['profile.subjects', 'identity.subjects'],
  ['profile.careerLeaning', 'identity.careerLeaning'],
  ['careerLeaningSoc', 'identity.careerLeaningSoc'],
  // S18 Semester Loop. The student's academic calendar: which block their school
  // runs on and when the current one starts and ends. Three scalar rows rather
  // than one `term` object, because these go through the user-sync registry
  // (user-sync.js FIELDS) — a registry field is one dossier LINE with one
  // clean(), so an object would have needed a private serializer and would have
  // been the only field in the registry that could not be stated in conversation.
  // The `terms` D1 row (0026) is the record of the RITUAL; these three are the
  // readable mirror. term-store.js `resolveTerm` is the single reader over both.
  ['termSystem', 'identity.termSystem'],
  ['termStart', 'identity.termStart'],
  ['termEnd', 'identity.termEnd'],
  ['personalityVector', 'vectors.personality'],
  ['objectiveVector', 'vectors.objective'],
  ['vectorSchemaId', 'vectors.schemaId'],
  ['objectiveSkipped', 'vectors.objectiveSkipped'],
  ['objectiveAiPatch', 'vectors.objectiveAiPatch'],
  ['personalityPatchFailed', 'vectors.personalityPatchFailed'],
  ['scores', 'assessment.scores'],
  ['scoresRaw', 'assessment.scoresRaw'],
  ['traits', 'assessment.traits'],
  ['characterSummary', 'assessment.characterSummary'],
  ['sectorFitSheet', 'assessment.sectorFitSheet'],
  ['enrichBoosts', 'assessment.enrichBoosts'],
  ['customAnswers', 'assessment.customAnswers'],
  ['careerFocus', 'focus.careerFocus'],
  ['careerFocusHistory', 'focus.careerFocusHistory'],
  ['academics', 'focus.academics'],
  ['academicsTranscript', 'focus.academicsTranscript'],
  ['resumeText', 'resume.text'],
  ['resumeSummary', 'resume.summary'],
  ['resumeBoosts', 'resume.boosts'],
  ['profileBuilding', 'journey.profileBuilding'],
  ['refine', 'journey.refine'],
  ['portalSnapshot', 'journey.portalSnapshot'],
  ['profileAlignment', 'journey.profileAlignment'],
  // Which feature interstitials/ribbons this student has already been shown
  // (feature-intro.js). Client-owned UI state — the server only stores and
  // returns it, which is what makes it follow the account across devices.
  ['featureIntros', 'journey.featureIntros'],
];

export const GROUPS = ['identity', 'vectors', 'assessment', 'focus', 'resume', 'journey'];

export function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Generic dot-path read on a normalized user, e.g. getUserField(u, 'identity.school'). */
export function getUserField(user, path) {
  return getPath(user, path);
}

export function emptyUser() {
  const user = { v: 2 };
  GROUPS.forEach((g) => { user[g] = {}; });
  return user;
}

// v1 keys consumed by KEY_MAP, split by storage location.
const V1_ROOT_KEYS = new Set(KEY_MAP.map(([p]) => p).filter((p) => !p.includes('.')));
const V1_PROFILE_KEYS = new Set(
  KEY_MAP.map(([p]) => p).filter((p) => p.startsWith('profile.')).map((p) => p.slice('profile.'.length)),
);
// v2 identity keys with a mapped v1 home; unknown identity keys denormalize into profile.*.
const V2_IDENTITY_KEYS = new Set(
  KEY_MAP.map(([, p]) => p).filter((p) => p.startsWith('identity.')).map((p) => p.slice('identity.'.length)),
);

function isBlank(v) { return v === undefined || v === null || v === ''; }

/** Drop v2's second GPA copy, without mutating the caller's academics object. */
function stripAcademicsGpa(user) {
  const acad = user.focus && user.focus.academics;
  if (!acad || typeof acad !== 'object' || !('gpa' in acad)) return user;
  const copy = { ...acad };
  delete copy.gpa;
  user.focus.academics = copy;
  return user;
}

/**
 * A v2 user written before the GPA merge (or mutated through focus.academics)
 * carries a second GPA under focus.academics.gpa. That copy is the academics
 * panel's — the live one — so adopt it into identity.gpa and drop the key.
 * Idempotent: after one pass there is nothing left to adopt.
 */
function adoptAcademicsGpa(user) {
  const acad = user.focus && user.focus.academics;
  if (!acad || typeof acad !== 'object' || !('gpa' in acad)) return user;
  if (!isBlank(acad.gpa)) setPath(user, 'identity.gpa', acad.gpa);
  return stripAcademicsGpa(user);
}

/**
 * v1 or v2 in, v2 out. Idempotent: a v2 payload is returned as-is.
 * Unknown v1 root keys pass through at the v2 root (a corrupted key colliding
 * with a group name is parked under _legacy); unknown profile.* keys ride in
 * identity.
 */
export function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return emptyUser();
  if (raw.v === 2) return adoptAcademicsGpa(raw);
  const user = emptyUser();
  for (let i = 0; i < KEY_MAP.length; i += 1) {
    const [v1Path, v2Path] = KEY_MAP[i];
    const val = getPath(raw, v1Path);
    if (val === undefined) continue;
    const existing = getPath(user, v2Path);
    if (existing !== undefined && !isBlank(existing)) continue;
    if (existing !== undefined && isBlank(val)) continue;
    setPath(user, v2Path, val);
  }
  if (raw.profile && typeof raw.profile === 'object') {
    Object.keys(raw.profile).forEach((k) => {
      if (!V1_PROFILE_KEYS.has(k)) user.identity[k] = raw.profile[k];
    });
  }
  Object.keys(raw).forEach((k) => {
    if (V1_ROOT_KEYS.has(k) || k === 'profile') return;
    if (k === 'v' || GROUPS.indexOf(k) !== -1 || k === '_legacy') {
      if (!user._legacy) user._legacy = {};
      user._legacy[k] = raw[k];
      return;
    }
    user[k] = raw[k];
  });
  // The academics.gpa row above already adopted the panel's value with the
  // right precedence; drop the copy so v2 holds exactly one GPA.
  return stripAcademicsGpa(user);
}

/**
 * v2 → v1 (the stored shape until Phase 4 flips storage). A v1 payload is
 * returned as-is. No field is ever dropped; the only additions are the school
 * and GPA mirrors (each canonical value written to both of its v1 homes).
 */
export function denormalizeUser(user) {
  if (!user || typeof user !== 'object') return {};
  if (user.v !== 2) return user;
  const out = {};
  for (let i = 0; i < KEY_MAP.length; i += 1) {
    const [v1Path, v2Path] = KEY_MAP[i];
    if (v2Path === 'identity.school') continue; // handled below — two homes
    if (v1Path === 'academics.gpa') continue;   // handled below — two homes
    const val = getPath(user, v2Path);
    if (val !== undefined) setPath(out, v1Path, val);
  }
  const school = getPath(user, 'identity.school');
  if (school !== undefined) {
    if (typeof school === 'string' && school.trim()) {
      out.school = school;
      setPath(out, 'profile.school', school);
    } else {
      // null/'' only ever came from the quiz's profile.school; keep it there.
      setPath(out, 'profile.school', school);
    }
  }
  // GPA's second home. profile.gpa came from the KEY_MAP row; academics.gpa is
  // rewritten here — and created when the student never opened the academics
  // panel, so every academics.gpa reader (the vector GPA boost, stretch-fits,
  // the coach's profile signals) sees the one live value. A blank GPA is never
  // fabricated: gpaTierBoost reads null as 0 and would boost on nothing.
  const gpa = getPath(user, 'identity.gpa');
  const acad = out.academics && typeof out.academics === 'object' ? out.academics : null;
  if (gpa !== undefined && (!isBlank(gpa) || acad)) {
    out.academics = acad ? { ...acad, gpa } : { gpa };
  }
  if (user.identity && typeof user.identity === 'object') {
    Object.keys(user.identity).forEach((k) => {
      if (!V2_IDENTITY_KEYS.has(k)) setPath(out, `profile.${k}`, user.identity[k]);
    });
  }
  Object.keys(user).forEach((k) => {
    if (k === 'v' || GROUPS.indexOf(k) !== -1 || k === '_legacy') return;
    out[k] = user[k];
  });
  if (user._legacy && typeof user._legacy === 'object') {
    Object.keys(user._legacy).forEach((k) => { out[k] = user._legacy[k]; });
  }
  return out;
}
