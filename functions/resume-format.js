// FlightWay 2.0 — Resume Builder v2: public resume-format reference data.
//   GET /resume-format?soc=15-1252.00&career=Software%20Engineer
//     -> { family, profile } via resolveCareerFamily + formatProfileForFamily.
// Static reference data (career-family taxonomy + format profiles) — no AI,
// no auth. Same trust tier as functions/config.js; mirrors its shape.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { resolveCareerFamily, formatProfileForFamily } from './_lib/resume-formats.js';

const SOC_MAX = 16;
const CAREER_MAX = 120;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const origin = originFromEnv(env, request);
  const url = new URL(request.url);
  const soc = (url.searchParams.get('soc') || '').trim().slice(0, SOC_MAX);
  const careerName = (url.searchParams.get('career') || '').trim().slice(0, CAREER_MAX);

  const family = resolveCareerFamily({ soc, careerName });
  const profile = formatProfileForFamily(family);
  return jsonResponse(200, { family, profile }, origin);
}
