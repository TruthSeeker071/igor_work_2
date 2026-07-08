import { DIM_COUNT } from './constants.js';
import { clamp100 } from './math.js';
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

function bumpDomain(values, sources, domain, boost, tag) {
  const range = DOMAIN_INDEX_RANGES[domain];
  if (!range || !boost) return;
  for (let i = range[0]; i < range[1]; i++) {
    values[i] = clamp100(values[i] + boost);
    sources[i] = tag;
  }
}

function stripTagged(vec, prefix) {
  const base = vec || { schemaId: 'onet-lv-161-v1', values: emptyVector(), sources: [] };
  const values = [...(base.values || emptyVector())];
  const sources = [...(base.sources || [])];
  for (let i = 0; i < DIM_COUNT; i++) {
    const tag = sources[i];
    if (tag && String(tag).startsWith(prefix)) {
      values[i] = 0;
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

  if (typeof a.hours === 'number') {
    const hx = a.hours / 100;
    bumpDomain(values, sources, 'workActivities', Math.round(hx * 9), 'refine:hours');
    bumpDomain(values, sources, 'abilities', Math.round((1 - hx) * 5), 'refine:hours');
  }
  if (typeof a.intensity === 'number') {
    const ix = a.intensity / 100;
    bumpDomain(values, sources, 'workActivities', Math.round(ix * 10), 'refine:intensity');
    bumpDomain(values, sources, 'abilities', Math.round((1 - ix) * 4), 'refine:intensity');
  }
  if (typeof a.creative === 'number') {
    const cx = a.creative / 100;
    bumpDomain(values, sources, 'abilities', Math.round(cx * 8), 'refine:creative');
    bumpDomain(values, sources, 'knowledge', Math.round((1 - cx) * 6), 'refine:creative');
  }
  if (typeof a.social === 'number') {
    const sx = a.social / 100;
    bumpDomain(values, sources, 'workActivities', Math.round(sx * 8), 'refine:social');
    bumpDomain(values, sources, 'abilities', Math.round((1 - sx) * 5), 'refine:social');
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
      bumpDomain(values, sources, dom, pick[dom], 'refine:workday');
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
      bumpDomain(values, sources, dom, pp[dom], 'refine:problem');
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
      bumpDomain(values, sources, dom, pathPick[dom], 'refine:path');
    });
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
