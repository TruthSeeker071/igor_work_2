// Shared sim-trial sanitizer. Lifted verbatim out of functions/sim-mirror.js so
// both /sim-mirror and /resume-builder sanitize telemetry the same way — never
// forked. Sim telemetry is client-only (no D1 mirror); it reaches the server
// only in a request body, so every field is treated as untrusted input here.

export const MAX_TRIALS = 12;

export function num(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

export function strList(v, n, max) {
  return Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
}

export function sanitizeTrials(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TRIALS).map((t) => ({
    role: str(t && t.role, 80),
    domain: str(t && t.domain, 60),
    familiarity: str(t && t.familiarity, 20),
    predictedEnjoyment: num(t && t.predictedEnjoyment, 1, 10),
    experiencedEnjoyment: num(t && t.experiencedEnjoyment, 1, 10),
    gap: num(t && t.gap, -9, 9),
    minutesSpent: num(t && t.minutesSpent, 0, 240),
    colleagueMessagesSent: num(t && t.colleagueMessagesSent, 0, 50),
    hintsUsed: num(t && t.hintsUsed, 0, 20),
    energizedBy: strList(t && t.energizedBy, 6, 120),
    drainedBy: strList(t && t.drainedBy, 6, 120),
    surpriseNote: str(t && t.surpriseNote, 240),
    workExcerpt: str(t && t.workExcerpt, 300),
  })).filter((t) => t.role && t.experiencedEnjoyment != null);
}
