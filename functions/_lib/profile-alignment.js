import { saveDossier, loadDossier } from '../_lib.js';
import { callGeminiJson } from './gemini-json.js';
import {
  checkRateLimit,
  loadQuizProfile,
  saveQuizProfile,
  invalidateCareerAnalyses,
} from './auth.js';
import { maybeSyncRoadmap } from './roadmap-sync.js';
import {
  ensureSectorFitSheet,
  industryFitFromSheet,
} from './sector-fit-sheet.js';
import { primarySectorKeysForSlug } from './career-sector-map.js';
import {
  parseDossierFields,
  applyDossierPatches,
  validatePatchedDossier,
  tokenizeList,
  extractSectorTokensFromText,
} from './dossier-parse.js';

const PROPOSAL_KV_PREFIX = 'alignment_proposal:';
const PROPOSAL_TTL_SEC = 86400;
const RATE_LIMIT_PROPOSE_MAX = 5;

function nowIso() {
  return new Date().toISOString();
}

function generateProposalId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setsEqual(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

function overlapCount(a, b) {
  const B = new Set(b);
  return a.filter((x) => B.has(x)).length;
}

function ensureProfileAlignmentMeta(quiz) {
  if (!quiz.profileAlignment || typeof quiz.profileAlignment !== 'object') {
    quiz.profileAlignment = {};
  }
  return quiz.profileAlignment;
}

function sheetTopIndustryKeys(quiz) {
  ensureSectorFitSheet(quiz);
  return industryFitFromSheet(quiz.sectorFitSheet, 4).map((it) => it.key);
}

export function detectDrift(quiz, dossier) {
  const reasons = [];
  const signals = {};
  if (!quiz || !dossier) {
    return { severity: 'none', reasons, signals };
  }

  const fields = parseDossierFields(dossier);
  const focus = quiz.careerFocus;
  const targetSectors = focus?.slug ? primarySectorKeysForSlug(focus.slug) : [];
  const dossierTop = tokenizeList(fields.top_industries);
  const dossierSectorText = [
    fields.career_signals,
    fields.goals,
    fields.interests,
  ].filter(Boolean).join(' ');
  const dossierSectorTokens = new Set([
    ...dossierTop,
    ...extractSectorTokensFromText(dossierSectorText),
  ]);

  signals.targetSectors = targetSectors;
  signals.dossierTop = dossierTop;
  signals.sheetTop = sheetTopIndustryKeys(quiz);

  if (targetSectors.length) {
    const overlap = targetSectors.filter((s) => dossierSectorTokens.has(s));
    signals.targetOverlap = overlap;
    if (overlap.length === 0) {
      reasons.push('target_sector_overlap');
    }
  }

  if (signals.sheetTop.length && !setsEqual(signals.sheetTop, dossierTop)) {
    reasons.push('sheet_vs_dossier_top4');
  }

  if (focus?.name) {
    const targetLine = String(fields.target_career || '').toLowerCase();
    if (!targetLine.includes(String(focus.name).toLowerCase())) {
      reasons.push('focus_vs_dossier_target');
    }
  }

  const meta = quiz.profileAlignment || {};
  const sheetUpdated = quiz.sectorFitSheet?.updatedAt;
  if (
    sheetUpdated
    && reasons.includes('sheet_vs_dossier_top4')
    && meta.lastAlignedAt
    && Date.parse(meta.lastAlignedAt) < Date.parse(sheetUpdated)
  ) {
    reasons.push('stale_alignment_stamp');
  }

  let severity = 'none';
  if (reasons.includes('target_sector_overlap')) severity = 'large';
  else if (reasons.length) severity = 'small';

  return { severity, reasons, signals };
}

function buildTargetCareerLine(focus) {
  if (!focus?.name) return '';
  const date = (focus.updatedAt || nowIso()).slice(0, 10);
  const source = String(focus.source || 'unknown').slice(0, 32);
  return `${focus.name} (focused ${date}, via ${source})`;
}

export async function applySmallAlignment(env, email, quiz, dossier) {
  ensureSectorFitSheet(quiz);
  const top4 = sheetTopIndustryKeys(quiz);
  const patches = {};
  if (top4.length) {
    patches.top_industries = top4.join(', ');
  }
  if (quiz.careerFocus?.name) {
    patches.target_career = buildTargetCareerLine(quiz.careerFocus);
  }

  let updated = applyDossierPatches(dossier, patches);
  updated = validatePatchedDossier(updated);
  if (!updated) return { applied: false, dossier, quiz };

  await saveDossier(env, email, updated);
  const meta = ensureProfileAlignmentMeta(quiz);
  meta.lastAlignedAt = nowIso();
  meta.lastSeverity = 'small';
  meta.lastCheckedAt = nowIso();
  await saveQuizProfile(env, email, quiz);

  return { applied: true, dossier: updated, quiz, patches };
}

async function loadProposal(env, email) {
  if (!env.COACH_KV || !email) return null;
  const raw = await env.COACH_KV.get(`${PROPOSAL_KV_PREFIX}${email}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveProposal(env, email, proposal) {
  if (!env.COACH_KV || !email || !proposal) return;
  await env.COACH_KV.put(
    `${PROPOSAL_KV_PREFIX}${email}`,
    JSON.stringify(proposal),
    { expirationTtl: PROPOSAL_TTL_SEC },
  );
}

async function clearProposal(env, email) {
  if (!env.COACH_KV || !email) return;
  await env.COACH_KV.delete(`${PROPOSAL_KV_PREFIX}${email}`);
}

export async function proposeLargeAlignment(env, email, quiz, dossier) {
  try {
    await checkRateLimit(env, `align_propose:${email}`, { max: RATE_LIMIT_PROPOSE_MAX });
  } catch {
    return { proposal: null, rateLimited: true };
  }

  ensureSectorFitSheet(quiz);
  const fields = parseDossierFields(dossier);
  const focus = quiz.careerFocus || {};
  const topSectors = industryFitFromSheet(quiz.sectorFitSheet, 6)
    .map((it) => `${it.key}: ${it.score}`)
    .join(', ');
  const history = (quiz.careerFocusHistory || []).slice(-5)
    .map((h) => `${h.fromName || '?'} → ${h.toName || '?'} (${h.source || ''})`)
    .join('; ');

  const prompt = `You reconcile a student dossier after a significant career pivot.
Return ONLY JSON:
{
  "dossierPatches": {
    "top_industries": "comma-separated sector keys",
    "goals": "active goals aligned to new target",
    "interests": "active interests aligned to new target",
    "career_signals": "short career direction signals for new target",
    "notes": "brief notes if needed",
    "prior_focus": "compressed summary of displaced career focus",
    "archived_interests": "hobbies/personality depth from old focus, secondary"
  },
  "summary": "one line for the student",
  "rationale": "short internal rationale"
}

Rules:
- Active fields (goals, interests, career_signals) must reflect target career: ${focus.name || 'unknown'} (${focus.slug || ''}).
- Move displaced quant/tech/finance focus into prior_focus and archived_interests — do not delete personality depth.
- top_industries should align with target career sectors first, then sector sheet.
- Do NOT change sector fit scores (handled elsewhere).
- Preserve school, constraints, archetype unless clearly wrong.
- Terse comma-separated style where the dossier uses lists.

Current dossier fields:
top_industries: ${fields.top_industries || ''}
goals: ${fields.goals || ''}
interests: ${fields.interests || ''}
career_signals: ${fields.career_signals || ''}
target_career: ${fields.target_career || ''}
prior_focus: ${fields.prior_focus || ''}

Sector sheet top scores: ${topSectors || 'none'}
Recent career switches: ${history || 'none'}`;

  const raw = await callGeminiJson(env, {
    prompt,
    temperature: 0.35,
    maxTokens: 1200,
    jsonMode: true,
    label: 'profile-align-propose',
    softFail: true,
  });

  if (!raw?.dossierPatches) return { proposal: null };

  const proposalId = generateProposalId();
  const proposal = {
    id: proposalId,
    createdAt: nowIso(),
    focusSlug: focus.slug || '',
    focusName: focus.name || '',
    dossierPatches: raw.dossierPatches,
    summary: String(raw.summary || '').slice(0, 200),
    rationale: String(raw.rationale || '').slice(0, 300),
    before: {
      top_industries: fields.top_industries || '',
      goals: fields.goals || '',
      interests: fields.interests || '',
      career_signals: fields.career_signals || '',
    },
  };

  await saveProposal(env, email, proposal);
  const meta = ensureProfileAlignmentMeta(quiz);
  meta.pendingProposalId = proposalId;
  meta.lastCheckedAt = nowIso();
  meta.lastSeverity = 'large';
  await saveQuizProfile(env, email, quiz);

  return { proposal, rateLimited: false };
}

export async function applyLargeAlignment(env, email, proposalId) {
  const proposal = await loadProposal(env, email);
  if (!proposal || proposal.id !== proposalId) {
    return { applied: false, error: 'Proposal not found or expired.' };
  }

  const [quiz, dossier] = await Promise.all([
    loadQuizProfile(env, email),
    loadDossier(env, email),
  ]);
  if (!quiz || !dossier) return { applied: false, error: 'Profile not found.' };

  let updated = applyDossierPatches(dossier, proposal.dossierPatches);
  if (quiz.careerFocus?.name) {
    updated = applyDossierPatches(updated, {
      target_career: buildTargetCareerLine(quiz.careerFocus),
    });
  }
  updated = validatePatchedDossier(updated);
  if (!updated) return { applied: false, error: 'Invalid dossier after merge.' };

  await saveDossier(env, email, updated);
  await invalidateCareerAnalyses(env, email);

  const priorSnippet = [
    proposal.dossierPatches?.prior_focus,
    proposal.dossierPatches?.archived_interests,
  ].filter(Boolean).join(' ').slice(0, 400);

  try {
    await maybeSyncRoadmap(env, email, {
      reason: 'profile_alignment',
      userPivotNote: priorSnippet
        ? `Career pivot alignment. Prior focus archived: ${priorSnippet}. New target: ${quiz.careerFocus?.name || proposal.focusName}.`
        : `Career pivot alignment to ${quiz.careerFocus?.name || proposal.focusName}.`,
      quiz,
      dossier: updated,
    });
  } catch (err) {
    console.warn('alignment roadmap sync failed', err);
  }

  const meta = ensureProfileAlignmentMeta(quiz);
  meta.lastAlignedAt = nowIso();
  meta.lastSeverity = 'large';
  meta.lastCheckedAt = nowIso();
  meta.pendingProposalId = null;
  meta.dismissedForSlug = null;
  meta.dismissedProposalAt = null;
  await saveQuizProfile(env, email, quiz);
  await clearProposal(env, email);

  return { applied: true, dossier: updated, summary: proposal.summary };
}

export async function dismissAlignment(env, email) {
  const quiz = (await loadQuizProfile(env, email)) || {};
  const meta = ensureProfileAlignmentMeta(quiz);
  meta.dismissedProposalAt = nowIso();
  meta.dismissedForSlug = quiz.careerFocus?.slug || null;
  meta.pendingProposalId = null;
  meta.lastCheckedAt = nowIso();
  await saveQuizProfile(env, email, quiz);
  await clearProposal(env, email);
  return { dismissed: true };
}

export async function getAlignmentStatus(env, email) {
  const [quiz, dossier] = await Promise.all([
    loadQuizProfile(env, email),
    loadDossier(env, email).catch(() => ''),
  ]);
  if (!quiz || !dossier) {
    return { severity: 'none', reasons: [], proposal: null };
  }

  const drift = detectDrift(quiz, dossier);
  const proposal = await loadProposal(env, email);
  const meta = quiz.profileAlignment || {};
  const dismissed = meta.dismissedForSlug
    && meta.dismissedForSlug === quiz.careerFocus?.slug
    && meta.dismissedProposalAt;

  return {
    severity: drift.severity,
    reasons: drift.reasons,
    signals: drift.signals,
    proposal: (drift.severity === 'large' && !dismissed) ? proposal : null,
    dismissed: !!dismissed,
  };
}

export async function runAlignmentCheck(env, email, opts = {}) {
  const autoSmall = opts.autoSmall !== false;
  const autoProposeLarge = opts.autoProposeLarge !== false;
  const forceAfterSwitch = !!opts.forceAfterSwitch;

  const [quiz, dossier] = await Promise.all([
    loadQuizProfile(env, email),
    loadDossier(env, email).catch(() => ''),
  ]);
  if (!quiz || !dossier) {
    return { severity: 'none', appliedSmall: false, proposal: null };
  }

  const drift = detectDrift(quiz, dossier);
  const meta = quiz.profileAlignment || {};
  meta.lastCheckedAt = nowIso();
  meta.lastSeverity = drift.severity;

  let appliedSmall = false;
  let proposal = null;

  if (drift.severity === 'small' && autoSmall) {
    const result = await applySmallAlignment(env, email, quiz, dossier);
    appliedSmall = result.applied;
  } else if (drift.severity === 'large' && (autoProposeLarge || forceAfterSwitch)) {
    const dismissed = meta.dismissedForSlug === quiz.careerFocus?.slug && meta.dismissedProposalAt;
    if (!dismissed) {
      const propResult = await proposeLargeAlignment(env, email, quiz, dossier);
      proposal = propResult.proposal || null;
    } else {
      await saveQuizProfile(env, email, quiz);
    }
  } else {
    await saveQuizProfile(env, email, quiz);
  }

  return {
    severity: drift.severity,
    reasons: drift.reasons,
    appliedSmall,
    proposal,
  };
}

export async function maybeSmallAlignAfterSectorPatch(env, email) {
  const [quiz, dossier] = await Promise.all([
    loadQuizProfile(env, email),
    loadDossier(env, email).catch(() => ''),
  ]);
  if (!quiz || !dossier) return { applied: false };

  const drift = detectDrift(quiz, dossier);
  if (drift.severity !== 'small' || !drift.reasons.includes('sheet_vs_dossier_top4')) {
    return { applied: false };
  }
  const result = await applySmallAlignment(env, email, quiz, dossier);
  return { applied: result.applied };
}

export function buildProfileSignalsBlock(quiz, dossier) {
  if (!quiz) return '';
  ensureSectorFitSheet(quiz);
  const focus = quiz.careerFocus;
  const sectors = primarySectorKeysForSlug(focus?.slug || '');
  const top = industryFitFromSheet(quiz.sectorFitSheet, 6)
    .map((it) => `${it.key} ${it.score}`)
    .join(', ');
  const fields = parseDossierFields(dossier || '');
  const prior = fields.prior_focus || fields.archived_interests || '';

  const lines = ['## Profile signals (canonical)'];
  if (focus?.name) {
    lines.push(`Target career: ${focus.name}${sectors.length ? ` (${sectors.join(', ')})` : ''}`);
  }
  if (top) lines.push(`Top sector fits: ${top}`);
  if (prior) lines.push(`Prior focus (archived): ${prior.slice(0, 280)}`);
  return lines.join('\n');
}
