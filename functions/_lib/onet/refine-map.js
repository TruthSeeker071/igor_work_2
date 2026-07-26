import { DIM_COUNT } from './constants.js';
import { clamp100, gateLayerDeltas } from './math.js';
import { applyResumeToObjective } from './resume-map.js';

const DOMAIN_INDEX_RANGES = {
  skills: [0, 35],
  knowledge: [35, 68],
  abilities: [68, 120],
  workActivities: [120, 161],
};

const SUBJECT_TEXT = {
  math: 'math statistics calculus',
  writing: 'writing english literature',
  science: 'science biology chemistry physics',
  art: 'art design creative',
  business: 'business finance marketing',
  tech: 'programming software computer coding',
  psych: 'psychology social education',
  politics: 'politics law government',
  medicine: 'medicine healthcare nursing',
  engineering: 'engineering mechanical civil',
  economics: 'economics finance business',
  film: 'film media marketing creative',
  global: 'social government law',
  hands: 'trades engineering building',
  cyber: 'cybersecurity programming tech',
  hospitality: 'hospitality business service',
};

function emptyVector() {
  return new Array(DIM_COUNT).fill(0);
}

function bumpDomainPending(pending, domain, boost) {
  const range = DOMAIN_INDEX_RANGES[domain];
  if (!range || !boost) return;
  for (let i = range[0]; i < range[1]; i++) pending[i] += boost;
}

// Sharpen answers bump whole 33-52 dimension domains at once, so ungated they
// pile far more mass onto the vector than the quiz seed carries and flatten the
// direction it established. Total |delta| the sharpen layer may apply, after
// per-dim direction gating (parity: assets/js/shared/refine-map.js).
const REFINE_L1_BUDGET = 120;

// Tags carry the pre-bump value ("refine:42") so strip restores the base exactly
// instead of zeroing it — strip/reapply must be a true inverse or every rebuild
// destroys the quiz-seeded personality in bumped domains. Legacy name tags
// ("refine:hours") have no number and restore to 0, which matches the old steady
// state so existing profiles don't jump. Parity: assets/js/shared/refine-map.js.
function stripTagged(vec, prefix) {
  const base = vec || { schemaId: 'onet-lv-161-v1', values: emptyVector(), sources: [] };
  const values = [...(base.values || emptyVector())];
  const sources = [...(base.sources || [])];
  for (let i = 0; i < DIM_COUNT; i++) {
    const tag = sources[i];
    if (tag && String(tag).startsWith(prefix)) {
      const restored = parseFloat(String(tag).slice(prefix.length));
      values[i] = Number.isFinite(restored) ? clamp100(restored) : 0;
      sources[i] = null;
    }
  }
  return { ...base, values, sources };
}

export function stripRefineFromPersonality(personalityVec) {
  return stripTagged(personalityVec, 'refine:');
}

export function stripRefineFromObjective(objectiveVec) {
  return stripTagged(objectiveVec, 'refine-obj:');
}

function subjectsObjectiveText(refine) {
  const tags = refine?.subjects;
  if (!Array.isArray(tags) || !tags.length) return '';
  return tags.map((t) => {
    const key = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
    const keys = Object.keys(SUBJECT_TEXT);
    for (let i = 0; i < keys.length; i++) {
      if (key.includes(keys[i])) return SUBJECT_TEXT[keys[i]];
    }
    return String(t || '').replace(/[^\w\s]/g, ' ');
  }).join(' ');
}

function applyTextToObjective(objectiveVec, text, tag, profiles) {
  if (!text) return objectiveVec;
  return applyResumeToObjective(objectiveVec, text, profiles);
}

export function applyRefineToPersonality(personalityVec, refine) {
  const base = stripRefineFromPersonality(personalityVec);
  const values = [...base.values];
  const sources = [...(base.sources || [])];
  const a = refine || {};
  const pending = emptyVector();

  if (typeof a.hours === 'number') {
    const hx = a.hours / 100;
    bumpDomainPending(pending, 'workActivities', Math.round(hx * 9));
    bumpDomainPending(pending, 'abilities', Math.round((1 - hx) * 5));
  }
  if (typeof a.intensity === 'number') {
    const ix = a.intensity / 100;
    bumpDomainPending(pending, 'workActivities', Math.round(ix * 10));
    bumpDomainPending(pending, 'abilities', Math.round((1 - ix) * 4));
  }
  if (typeof a.creative === 'number') {
    const cx = a.creative / 100;
    bumpDomainPending(pending, 'abilities', Math.round(cx * 8));
    bumpDomainPending(pending, 'knowledge', Math.round((1 - cx) * 6));
  }
  if (typeof a.social === 'number') {
    const sx = a.social / 100;
    bumpDomainPending(pending, 'workActivities', Math.round(sx * 8));
    bumpDomainPending(pending, 'abilities', Math.round((1 - sx) * 5));
  }
  if (typeof a.workday === 'number') {
    const wd = [
      { workActivities: 10, skills: 8 },
      { workActivities: 9, abilities: 6 },
      { abilities: 9, workActivities: 5 },
      { workActivities: 8, abilities: 7 },
      { knowledge: 9, abilities: 6 },
    ];
    const pick = wd[a.workday] || wd[2];
    Object.keys(pick).forEach((dom) => {
      bumpDomainPending(pending, dom, pick[dom]);
    });
  }
  if (typeof a.problem === 'number') {
    const pb = [
      { knowledge: 8, skills: 6 },
      { abilities: 9, skills: 5 },
      { workActivities: 9, abilities: 5 },
      { knowledge: 7, workActivities: 6 },
    ];
    const pp = pb[a.problem] || pb[0];
    Object.keys(pp).forEach((dom) => {
      bumpDomainPending(pending, dom, pp[dom]);
    });
  }
  if (typeof a.path === 'number') {
    const pt = [
      { workActivities: 8, knowledge: 5 },
      { knowledge: 8, abilities: 6 },
      { abilities: 5, workActivities: 5 },
      { workActivities: 7, skills: 6 },
      { abilities: 10, skills: 7 },
    ];
    const pathPick = pt[a.path] || pt[2];
    Object.keys(pathPick).forEach((dom) => {
      bumpDomainPending(pending, dom, pathPick[dom]);
    });
  }

  const gated = gateLayerDeltas(values, pending, REFINE_L1_BUDGET, 50);
  for (let i = 0; i < DIM_COUNT; i++) {
    if (!gated[i]) continue;
    const next = clamp100(values[i] + gated[i]);
    if (next === values[i]) continue;
    sources[i] = `refine:${values[i]}`;
    values[i] = next;
  }

  return {
    ...base,
    values,
    sources,
    updatedAt: new Date().toISOString(),
    source: base.source || 'refine-rules',
  };
}

export function applyRefineToObjective(objectiveVec, refine, profiles) {
  const base = stripRefineFromObjective(objectiveVec);
  const a = refine || {};
  let out = base;
  const subj = subjectsObjectiveText(a);
  if (subj) out = applyTextToObjective(out, subj, 'refine-obj:subjects', profiles);
  const mcText = {
    workday: [
      'programming software engineering tech coding computer science',
      'business finance strategy meetings law negotiations',
      'design creative marketing media production',
      'healthcare education social work clients patients',
      'research science analysis writing deep thought',
    ],
    problem: [
      'data statistics finance science analysis crunch numbers',
      'design creative prototyping startups innovation',
      'consensus leadership business social communication',
      'engineering methodology healthcare law frameworks',
    ],
    path: [
      'finance business law corporate ladder stable',
      'healthcare education law professional craft expertise',
      'balanced business tech marketing growth',
      'tech marketing startups fast company',
      'entrepreneur startups founder builder bold',
    ],
  };
  Object.keys(mcText).forEach((key) => {
    if (typeof a[key] !== 'number') return;
    const list = mcText[key];
    const text = list && list[a[key]];
    if (text) out = applyTextToObjective(out, text, `refine-obj:${key}`, profiles);
  });
  return out;
}

export function refreshPersonalityFromRefine(personalityVec, refine) {
  if (!refine) return personalityVec;
  return applyRefineToPersonality(personalityVec, refine);
}

export function refreshObjectiveFromRefine(objectiveVec, refine, profiles) {
  if (!refine) return objectiveVec;
  return applyRefineToObjective(objectiveVec, refine, profiles);
}
