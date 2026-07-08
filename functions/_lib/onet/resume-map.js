import { DIM_COUNT } from './constants.js';

import { clamp100 } from './math.js';

import { applyThemedRulesToObjective } from './resume-theme-map.js';
import { refreshObjectiveFromRefine } from './refine-map.js';
import { applyObjectiveAiPatch } from './objective-patch.js';



const DOMAIN_INDEX_RANGES = {

  skills: [0, 35],

  knowledge: [35, 68],

  abilities: [68, 120],

  workActivities: [120, 161],

};



export function applyResumeToObjective(objectiveVec, resumeText, profiles) {

  return applyThemedRulesToObjective(objectiveVec, resumeText, { profiles });

}



export function stripAcademicsFromObjective(objectiveVec) {

  const values = [...(objectiveVec?.values || new Array(DIM_COUNT).fill(0))];

  const sources = [...(objectiveVec?.sources || [])];

  for (let i = 0; i < DIM_COUNT; i++) {

    const tag = sources[i];

    if (tag && String(tag).startsWith('academics:')) {

      values[i] = 0;

      sources[i] = null;

    }

  }

  return {

    schemaId: objectiveVec?.schemaId || 'onet-lv-161-v1',

    values,

    sources,

    updatedAt: objectiveVec?.updatedAt || new Date().toISOString(),

    source: objectiveVec?.source || 'empty',

  };

}



export function refreshObjectiveFromAcademics(objectiveVec, academics, profile, profiles) {

  const stripped = stripAcademicsFromObjective(objectiveVec);

  if (!academics) return stripped;

  return applyAcademicsToObjective(stripped, academics, profile, profiles);

}



export function stripResumeFromObjective(objectiveVec) {

  const values = [...(objectiveVec?.values || new Array(DIM_COUNT).fill(0))];

  const sources = [...(objectiveVec?.sources || [])];

  for (let i = 0; i < DIM_COUNT; i++) {

    const tag = sources[i];

    if (tag && String(tag).indexOf('resume') !== -1) {

      values[i] = 0;

      sources[i] = null;

    }

  }

  return {

    schemaId: objectiveVec?.schemaId || 'onet-lv-161-v1',

    values,

    sources,

    updatedAt: objectiveVec?.updatedAt || new Date().toISOString(),

    source: objectiveVec?.source === 'skipped' ? 'skipped' : 'empty',

  };

}



export function refreshObjectiveFromResume(objectiveVec, resumeText, profiles) {

  const stripped = stripResumeFromObjective(objectiveVec);

  const text = String(resumeText || '').trim();

  if (text.length < 40) return stripped;

  return applyResumeToObjective(stripped, text, profiles);

}



export function refreshFullObjective(objectiveVec, profile, profiles) {

  let vec = stripAcademicsFromObjective(objectiveVec);

  vec = stripResumeFromObjective(vec);

  if (profile?.objectiveSkipped) {

    return {

      schemaId: vec.schemaId || 'onet-lv-161-v1',

      values: new Array(DIM_COUNT).fill(0),

      sources: [],

      updatedAt: new Date().toISOString(),

      source: 'skipped',

      skipped: true,

    };

  }

  if (profile?.academics) {

    vec = applyAcademicsToObjective(vec, profile.academics, profile.profile, profiles);

  }

  if (profile?.refine) {

    vec = refreshObjectiveFromRefine(vec, profile.refine, profiles);

  }

  if (profile?.resumeText) {

    vec = applyResumeToObjective(vec, profile.resumeText, profiles);

  }

  // AI patches replay last — the client rebuilds this vector from rules alone,
  // so without a replay step every Gemini objective enrichment is lost on the
  // next hydration/upload cycle.
  if (profile?.objectiveAiPatch?.dimensions?.length) {
    vec = applyObjectiveAiPatch(vec, profile.objectiveAiPatch);
  }

  return vec;

}



export function mergeObjectiveVectors(existing, patch) {

  const values = [...(existing?.values || new Array(DIM_COUNT).fill(0))];

  const sources = [...(existing?.sources || [])];

  for (let i = 0; i < DIM_COUNT; i++) {

    if (patch.values?.[i] > values[i]) {

      values[i] = patch.values[i];

      sources[i] = patch.sources?.[i] || patch.source;

    }

  }

  return {

    ...existing,

    values,

    sources,

    updatedAt: new Date().toISOString(),

  };

}



function bumpDomain(values, sources, domain, boost, sourceTag) {

  const range = DOMAIN_INDEX_RANGES[domain];

  if (!range) return;

  for (let i = range[0]; i < range[1]; i++) {

    values[i] = clamp100(values[i] + boost);

    sources[i] = sources[i] || sourceTag;

  }

}



function gpaTierBoost(gpa) {

  const g = Number(gpa);

  if (!Number.isFinite(g)) return 0;

  if (g >= 3.7) return 14;

  if (g >= 3.3) return 10;

  if (g >= 3.0) return 7;

  if (g >= 2.5) return 4;

  return 2;

}



export function applyAcademicsToObjective(objectiveVec, academics, profile, profiles) {

  const values = [...(objectiveVec?.values || new Array(DIM_COUNT).fill(0))];

  const sources = [...(objectiveVec?.sources || [])];

  const acad = academics || {};



  const gpaBoost = gpaTierBoost(acad.gpa);

  if (gpaBoost > 0) {

    bumpDomain(values, sources, 'skills', gpaBoost, 'academics:gpa');

    bumpDomain(values, sources, 'knowledge', Math.round(gpaBoost * 0.6), 'academics:gpa');

  }



  const majorText = [acad.major, profile?.school].filter(Boolean).join(' ');

  if (majorText) {

    const majorPatch = applyResumeToObjective({ values, sources, schemaId: objectiveVec?.schemaId }, majorText, profiles);

    for (let i = 0; i < DIM_COUNT; i++) {

      if (majorPatch.values[i] > values[i]) {

        values[i] = majorPatch.values[i];

        sources[i] = majorPatch.sources[i] || 'academics:major';

      }

    }

  }



  if (acad.liked) {

    const likedPatch = applyResumeToObjective({ values, sources, schemaId: objectiveVec?.schemaId }, acad.liked, profiles);

    for (let i = 0; i < DIM_COUNT; i++) {

      if (likedPatch.values[i] > values[i]) {

        values[i] = likedPatch.values[i];

        sources[i] = likedPatch.sources[i] || 'academics:liked';

      }

    }

  }



  if (acad.disliked) {

    const dislikedPatch = applyResumeToObjective({ values: new Array(DIM_COUNT).fill(0), sources: [] }, acad.disliked, profiles);

    for (let i = 0; i < DIM_COUNT; i++) {

      if (dislikedPatch.values[i] > 0) {

        values[i] = clamp100(Math.max(0, values[i] - Math.round(dislikedPatch.values[i] * 0.35)));

      }

    }

  }



  if (typeof acad.majorLock === 'number' && acad.majorLock >= 70) {

    bumpDomain(values, sources, 'knowledge', 6, 'academics:major-lock');

  }



  if (typeof acad.grad === 'number') {

    const gradTexts = [

      'medicine healthcare nursing mcat pre-med science med school health professions',

      'law school lsat legal government attorney pre-law',

      'phd research academia graduate science thesis dissertation',

      'mba business finance graduate school management',

      'internship work industry experience tech business career',

      '',

    ];

    const gradTxt = gradTexts[acad.grad] || '';

    if (gradTxt) {

      const gradPatch = applyResumeToObjective({ values, sources, schemaId: objectiveVec?.schemaId }, gradTxt, profiles);

      for (let i = 0; i < DIM_COUNT; i++) {

        if (gradPatch.values[i] > values[i]) {

          values[i] = gradPatch.values[i];

          sources[i] = gradPatch.sources[i] || 'academics:grad';

        }

      }

    }

  }



  return {

    schemaId: objectiveVec?.schemaId || 'onet-lv-161-v1',

    values,

    sources,

    updatedAt: new Date().toISOString(),

    source: 'academics',

  };

}


