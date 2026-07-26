/**
 * FlightWay V2 S12 — Evidence Locker vector attribution (plan §5 S12).
 *
 * **READ-ONLY OVER VECTORS. This module has no writer and must never grow one.**
 * The 2026-07-10 invariant is that `gap-progress-sync.js` is the single writer of
 * the objective vector; the locker's job is to *explain* a movement that has
 * already happened, so everything here is a pure function of `(tree, artifacts)`
 * with no env, no D1, no KV and no mutation of its arguments.
 *
 * How the number is derived, and why it is honest:
 *   `computeGapProgressDims(tree)` is the same pure function the single writer
 *   uses. Attribution runs it TWICE — once on the real tree, once on a
 *   counterfactual tree in which this one artifact's evidence log is absent —
 *   and reports the difference. So the number on the card is, by construction,
 *   exactly the amount the student's coordinate would drop if they deleted that
 *   piece of evidence. It is not a re-derivation of the formula (which would
 *   drift the moment the formula changed) and it is not the artifact's raw
 *   weight (which ignores the 30-point evidence cap and the 90% progress cap,
 *   and would therefore over-claim for anyone with several artifacts on one gap).
 *
 * A delta of 0 is a real and common answer — the gap was already at its cap, or
 * step completion had already closed it. The renderer says so rather than
 * rounding up to something that looks better.
 */

import { computeGapProgressDims } from './gap-progress-sync.js';

/** `stampGapEvidence` writes `{ id: 'art-<artifactId>', artifactId }` onto the gap. */
function logMatchesArtifact(log, artifactId) {
  if (!log || !artifactId) return false;
  if (log.artifactId && String(log.artifactId) === String(artifactId)) return true;
  return String(log.id || '') === `art-${artifactId}`;
}

/** The gap carrying this artifact's evidence log, or null. Never mutates. */
export function findGapForArtifact(tree, artifactId) {
  const gaps = (tree && tree.focusTracker && tree.focusTracker.skillGaps) || [];
  if (!Array.isArray(gaps) || !artifactId) return null;
  return gaps.find((g) => g && Array.isArray(g.logs)
    && g.logs.some((l) => logMatchesArtifact(l, artifactId))) || null;
}

/**
 * The same tree with one gap's matching evidence log removed. Structurally
 * shared everywhere else — only the one gap object and the enclosing
 * focusTracker are new — so this can never be mistaken for an edit of the
 * caller's tree.
 */
function treeWithoutLog(tree, gapId, artifactId) {
  const gaps = tree.focusTracker.skillGaps;
  return {
    ...tree,
    focusTracker: {
      ...tree.focusTracker,
      skillGaps: gaps.map((g) => (g && g.id === gapId
        ? { ...g, logs: (g.logs || []).filter((l) => !logMatchesArtifact(l, artifactId)) }
        : g)),
    },
  };
}

function dimValue(dims, index) {
  const hit = (dims || []).find((d) => d && d.index === index);
  return hit ? Number(hit.value) || 0 : null;
}

/**
 * One artifact's contribution to the objective vector.
 * @returns {{linked:boolean, gapId:string, gapLabel:string, dimIndex:number|null, delta:number|null}}
 *   `linked:false` — no evidence log on any gap (portfolio-only, or the roadmap
 *   was regenerated and the gap it hung off is gone). `delta:null` — the gap
 *   carries no dimension index, so there is no coordinate to have moved.
 */
export function attributeArtifact(tree, artifact, baseDims) {
  const id = artifact && artifact.id;
  const gap = findGapForArtifact(tree, id);
  if (!gap) {
    return {
      linked: false,
      gapId: (artifact && artifact.gapId) || '',
      gapLabel: '',
      dimIndex: Number.isInteger(artifact && artifact.dimIndex) ? artifact.dimIndex : null,
      delta: null,
    };
  }
  const out = {
    linked: true,
    gapId: gap.id || '',
    gapLabel: String(gap.label || ''),
    dimIndex: Number.isInteger(gap.dimIndex) ? gap.dimIndex : null,
    delta: null,
  };
  if (out.dimIndex == null) return out;

  const base = baseDims || computeGapProgressDims(tree);
  const now = dimValue(base, out.dimIndex);
  if (now == null) return out;
  const without = dimValue(computeGapProgressDims(treeWithoutLog(tree, gap.id, id)), out.dimIndex);
  if (without == null) return out;
  out.delta = Math.max(0, Math.round(now - without));
  return out;
}

/**
 * Attribution for a whole locker, computed with ONE base pass over the tree.
 * @returns {{byId:Object<string,object>, totalDelta:number, linkedCount:number}}
 */
export function attributeArtifacts(tree, artifacts = []) {
  const byId = {};
  let totalDelta = 0;
  let linkedCount = 0;
  const usable = tree && tree.focusTracker && Array.isArray(tree.focusTracker.skillGaps);
  const baseDims = usable ? computeGapProgressDims(tree) : [];
  (artifacts || []).forEach((a) => {
    if (!a || !a.id) return;
    const info = usable
      ? attributeArtifact(tree, a, baseDims)
      : { linked: false, gapId: a.gapId || '', gapLabel: '', dimIndex: null, delta: null };
    byId[a.id] = info;
    if (info.linked) linkedCount += 1;
    if (Number.isFinite(info.delta)) totalDelta += info.delta;
  });
  return { byId, totalDelta, linkedCount };
}

/**
 * The one line the card shows. Never invents a number: an unlinked artifact is
 * described as portfolio evidence, and a linked one that moved nothing says the
 * gap it is filed under rather than "+0".
 */
export function attributionPhrase(info) {
  if (!info || !info.linked) return '';
  const label = info.gapLabel || 'a tracked skill';
  if (Number.isFinite(info.delta) && info.delta > 0) return `Moved ${label} +${info.delta}`;
  return `Filed under ${label}`;
}
