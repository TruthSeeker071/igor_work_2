import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadRoadmap,
  saveRoadmap,
} from '../_lib/auth.js';
import { syncGapProgressToQuiz } from '../_lib/gap-progress-sync.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  try {
    const { email } = await requireSession(request, env);
    const roadmap = await loadRoadmap(env, email);
    return authJsonResponse(200, { roadmap: roadmap || {} }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  let payload;
  try {
    // Even a deep v3 tree with semester plans and checklists stays in the
    // hundreds of KB; 2 MB is abuse, and D1 rows shouldn't grow unbounded.
    const raw = await request.text();
    if (raw.length > 2_000_000) {
      return authJsonResponse(413, { error: 'Roadmap payload too large.' }, origin);
    }
    payload = JSON.parse(raw);
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const roadmap = payload.roadmap && typeof payload.roadmap === 'object' ? payload.roadmap : {};

  try {
    const { email } = await requireSession(request, env);
    // Client copies of the tree can predate a server-side semesterPlan write
    // (waypoint-plan persists onto the node directly) — carry existing plans
    // forward so a step-toggle save never wipes a generated plan.
    if (Array.isArray(roadmap.nodes)) {
      const existing = await loadRoadmap(env, email).catch(() => null);
      if (existing && existing.targetCareerSlug === roadmap.targetCareerSlug && Array.isArray(existing.nodes)) {
        const planById = new Map(existing.nodes.filter((n) => n?.id && n.semesterPlan).map((n) => [n.id, n.semesterPlan]));
        roadmap.nodes.forEach((n) => {
          if (n && n.id && !n.semesterPlan && planById.has(n.id)) n.semesterPlan = planById.get(n.id);
        });
        // Same clobber class for AI-upgraded gap checklists: a page holding a
        // pre-upgrade tree (generic fast ladders) must not wipe an 'ai'
        // checklist another page already earned. Carry it forward unless the
        // stale copy has real user state (done items) we'd be discarding.
        const aiByDim = new Map(
          (existing.focusTracker?.skillGaps || [])
            .filter((g) => g?.dimIndex != null && g.checklistSource === 'ai' && (g.checklist || []).length)
            .map((g) => [g.dimIndex, g]),
        );
        if (aiByDim.size && roadmap.focusTracker && Array.isArray(roadmap.focusTracker.skillGaps)) {
          roadmap.focusTracker.skillGaps = roadmap.focusTracker.skillGaps.map((g) => {
            if (!g || g.dimIndex == null || g.checklistSource === 'ai') return g;
            const prev = aiByDim.get(g.dimIndex);
            if (!prev) return g;
            const hasDone = (g.checklist || []).some((c) => c && c.done);
            return hasDone ? g : { ...g, checklist: prev.checklist, checklistSource: 'ai' };
          });
        }
        // Carry forward artifact-stamped gap logs so a stale client save
        // cannot wipe server-side evidence stamps (art-* / artifactId).
        const artByGap = new Map(
          (existing.focusTracker?.skillGaps || [])
            .filter((g) => g?.id && Array.isArray(g.logs) && g.logs.some((l) => l && (l.artifactId || String(l.id || '').startsWith('art-'))))
            .map((g) => [g.id, g.logs]),
        );
        if (artByGap.size && roadmap.focusTracker && Array.isArray(roadmap.focusTracker.skillGaps)) {
          roadmap.focusTracker.skillGaps = roadmap.focusTracker.skillGaps.map((g) => {
            if (!g || !g.id || !artByGap.has(g.id)) return g;
            const serverLogs = artByGap.get(g.id) || [];
            const clientLogs = Array.isArray(g.logs) ? g.logs : [];
            const clientIds = new Set(clientLogs.map((l) => l && l.id).filter(Boolean));
            const missing = serverLogs.filter((l) => {
              if (!l) return false;
              if (l.artifactId || String(l.id || '').startsWith('art-')) {
                return !clientIds.has(l.id);
              }
              return false;
            });
            if (!missing.length) return g;
            return { ...g, logs: [...missing, ...clientLogs].slice(0, 12) };
          });
        }
      }
    }
    await saveRoadmap(env, email, roadmap);
    // Step state is the source of truth for gap progress — every tree save
    // re-syncs the objective vector to it (absolute values; no-op when
    // nothing changed, so routine saves don't churn vector timestamps).
    let vec = null;
    try {
      vec = await syncGapProgressToQuiz(env, email, roadmap);
    } catch (syncErr) {
      console.warn('roadmap PUT gap-progress sync failed', syncErr?.message || syncErr);
    }
    const out = { ok: true };
    if (vec) {
      out.objectiveSynced = true;
      out.objectiveVector = vec.objectiveVector;
      out.objectiveAiPatch = vec.objectiveAiPatch;
    }
    return authJsonResponse(200, out, origin);
  } catch (err) {
    console.error('profile/roadmap PUT failed', err);
    return authErrorResponse(err, origin);
  }
}
