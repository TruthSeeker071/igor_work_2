import { GEMINI_CAREER_BATCH_DISABLED, MAX_SOC_BATCH } from './constants.js';

/** Reject AI routes that try to process multiple careers at once. */
export function assertSingleCareerAiRequest(socsOrSlugs, context) {
  if (!GEMINI_CAREER_BATCH_DISABLED) return;
  const list = Array.isArray(socsOrSlugs) ? socsOrSlugs : [socsOrSlugs];
  const clean = list.filter(Boolean);
  if (clean.length > 1) {
    const err = new Error(`Batch career AI blocked (${context}): max 1 career per request`);
    err.status = 400;
    throw err;
  }
}

export function assertVectorBatchLimit(socs) {
  if (!Array.isArray(socs)) return;
  if (socs.length > MAX_SOC_BATCH) {
    const err = new Error(`Max ${MAX_SOC_BATCH} SOCs per vector request`);
    err.status = 400;
    throw err;
  }
}

export function trimGapDimensionsForPrompt(gaps, max = 20) {
  if (!Array.isArray(gaps)) return [];
  return gaps.slice(0, max);
}
