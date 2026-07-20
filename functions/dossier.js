import {
  originFromEnv,
  loadDossier,
  saveDossier,
  isValidDossier,
} from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
} from './_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  if (request.method === 'OPTIONS') {
    return authPreflight(origin);
  }

  try {
    const { email } = await requireSession(request, env);

    if (request.method === 'GET') {
      const dossier = await loadDossier(env, email);
      if (!dossier) return authJsonResponse(404, { error: 'No dossier for this user yet.' }, origin);
      return authJsonResponse(200, { dossier }, origin);
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
      }
      const text = typeof payload.dossier === 'string' ? payload.dossier : '';
      if (!isValidDossier(text)) {
        return authJsonResponse(
          400,
          {
            error:
              'Dossier must start with "# user dossier v1" and include the standard fields (top_industries, interests, goals, recent).',
          },
          origin,
        );
      }
      const saved = await saveDossier(env, email, text);
      return authJsonResponse(200, { ok: true, dossier: saved }, origin);
    }

    return authJsonResponse(405, { error: 'Method not allowed' }, origin);
  } catch (err) {
    console.error('dossier handler failed', err);
    return authErrorResponse(err, origin);
  }
}
