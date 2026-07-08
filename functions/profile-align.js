import { originFromEnv, loadDossier } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadQuizProfile,
} from './_lib/auth.js';
import {
  getAlignmentStatus,
  runAlignmentCheck,
  proposeLargeAlignment,
  applyLargeAlignment,
  dismissAlignment,
} from './_lib/profile-alignment.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  if (request.method === 'OPTIONS') return authPreflight(origin);

  try {
    const { email } = await requireSession(request, env);

    if (request.method === 'GET') {
      const status = await getAlignmentStatus(env, email);
      return authJsonResponse(200, {
        severity: status.severity,
        reasons: status.reasons,
        signals: status.signals,
        proposal: status.proposal,
        dismissed: status.dismissed,
      }, origin);
    }

    if (request.method !== 'POST') {
      return authJsonResponse(405, { error: 'Method not allowed' }, origin);
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const action = String(payload.action || 'check').trim().toLowerCase();

    if (action === 'check') {
      const result = await runAlignmentCheck(env, email, {
        autoSmall: true,
        autoProposeLarge: false,
      });
      return authJsonResponse(200, {
        severity: result.severity,
        reasons: result.reasons,
        appliedSmall: result.appliedSmall,
        proposal: result.proposal,
      }, origin);
    }

    if (action === 'propose') {
      const [quiz, dossier] = await Promise.all([
        loadQuizProfile(env, email),
        loadDossier(env, email).catch(() => ''),
      ]);
      const propResult = await proposeLargeAlignment(env, email, quiz, dossier);
      return authJsonResponse(200, {
        proposal: propResult.proposal,
        rateLimited: !!propResult.rateLimited,
      }, origin);
    }

    if (action === 'apply') {
      const proposalId = String(payload.proposalId || '').trim();
      if (!proposalId) {
        return authJsonResponse(400, { error: 'Missing proposalId.' }, origin);
      }
      const result = await applyLargeAlignment(env, email, proposalId);
      if (!result.applied) {
        return authJsonResponse(400, { error: result.error || 'Could not apply alignment.' }, origin);
      }
      return authJsonResponse(200, {
        applied: true,
        summary: result.summary,
      }, origin);
    }

    if (action === 'dismiss') {
      await dismissAlignment(env, email);
      return authJsonResponse(200, { dismissed: true }, origin);
    }

    return authJsonResponse(400, { error: 'Unknown action.' }, origin);
  } catch (err) {
    console.error('profile-align failed', err);
    return authErrorResponse(err, origin);
  }
}
