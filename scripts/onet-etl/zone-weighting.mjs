/**
 * Zone membership + representativeness-weighted zone centroids.
 *
 * The unweighted zone mean (lvMean) is dragged around by whichever careers sit
 * at the edge of a zone, so sector fit reflected a zone's outliers as much as
 * its representative careers. lvMeanW re-means each zone with every career
 * weighted by how well it represents the zone (rep^3 of its centered cosine
 * against the unweighted mean), which sharpens the centroid toward the careers
 * a user actually pictures when they name the sector.
 *
 * Shared by build.mjs (full O*NET rebuild) and build-zone-weighted.mjs (adds the
 * weighted fields to an already-built artifact without touching the rest of it).
 */
import { cosine } from '../../functions/_lib/onet/math.js';
import { DIM_COUNT } from '../../functions/_lib/onet/constants.js';

export const REP_WEIGHT_EXPONENT = 3;

const SOC_MAJOR_TO_ZONE = {
  '11': 'business', '13': 'finance', '15': 'tech', '17': 'engineering',
  '19': 'science', '21': 'social', '23': 'law', '25': 'education',
  '27': 'creative', '29': 'healthcare', '31': 'healthcare', '33': 'law',
  '35': 'government', '37': 'operations', '39': 'social', '41': 'business',
  '43': 'government', '45': 'agriculture', '47': 'trades', '49': 'trades',
  '51': 'trades', '53': 'operations', '55': 'government',
};

/**
 * The 18 build-time zone ids. Pure in (soc, title), which is what lets the
 * artifact-only refresh recover zone membership from careers.json after
 * rezone-hub.mjs has rewritten hubZone to the 10 display macro-sectors.
 */
export function hubZoneForSoc(soc, title) {
  const major = String(soc || '').slice(0, 2);
  const t = String(title || '').toLowerCase();
  if (/cyber|security|information security/.test(t)) return 'cybersecurity';
  if (/software|computer|data scien|web dev|programmer/.test(t)) return 'tech';
  if (/nurse|physician|surgeon|medical|health|therapist|pharmac/.test(t)) return 'healthcare';
  if (/hotel|restaurant|hospitality|chef|concierge/.test(t)) return 'hospitality';
  if (/marketing|public relations|advertis/.test(t)) return 'marketing';
  if (/journal|media|broadcast|film|video/.test(t)) return 'media';
  if (/lawyer|attorney|legal|paralegal/.test(t)) return 'law';
  if (/teacher|professor|education|instructional/.test(t)) return 'education';
  if (/farm|agricultur/.test(t)) return 'agriculture';
  return SOC_MAJOR_TO_ZONE[major] || 'business';
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * @param {Array<ArrayLike<number>>} vectors one LV vector per career in the zone
 * @param {number[]} [c0] pre-computed unweighted mean (pass the stored lvMean to
 *   keep an existing artifact's values byte-identical)
 */
export function zoneAggregateEntry(vectors, c0) {
  const n = vectors.length || 1;
  let mean = c0;
  if (!mean) {
    const acc = new Float64Array(DIM_COUNT);
    vectors.forEach((v) => {
      for (let d = 0; d < DIM_COUNT; d++) acc[d] += v[d];
    });
    mean = Array.from(acc, (v) => round3(v / n));
  }

  const weighted = new Float64Array(DIM_COUNT);
  let repWeightSum = 0;
  vectors.forEach((v) => {
    const rep = Math.max(0, cosine(v, mean));
    const w = rep ** REP_WEIGHT_EXPONENT;
    if (!w) return;
    repWeightSum += w;
    for (let d = 0; d < DIM_COUNT; d++) weighted[d] += v[d] * w;
  });

  // A zone whose every member is anti-correlated with its own mean cannot
  // happen with real O*NET data, but a degenerate fixture must not divide by 0.
  const lvMeanW = repWeightSum > 0
    ? Array.from(weighted, (v) => round3(v / repWeightSum))
    : mean.slice();

  return {
    count: vectors.length,
    lvMean: mean,
    lvMeanW,
    repWeightSum: round3(repWeightSum),
  };
}

export { SOC_MAJOR_TO_ZONE };
