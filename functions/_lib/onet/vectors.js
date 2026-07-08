import {
  getSocIndex,
  getLvBuffer,
  getImBuffer,
  sliceVector,
  validateSocList,
  getManifest,
  getDerivedCareers,
} from './store.js';
import { DIM_COUNT } from './constants.js';

export async function getVectorsForSocs(env, baseUrl, socs) {
  const check = validateSocList(socs);
  if (!check.ok) return { error: check.error };

  const [socIndex, lvBuf, imBuf, manifest, derived] = await Promise.all([
    getSocIndex(env, baseUrl),
    getLvBuffer(env, baseUrl),
    getImBuffer(env, baseUrl),
    getManifest(env, baseUrl),
    getDerivedCareers(env, baseUrl),
  ]);

  // "Additional Careers" (99-XXXX.00) are not in the .bin — their vectors and
  // importance maps ship inline in the sidecar. Serve them from there so the
  // response shape is identical for derived and native SOCs.
  const derivedBySoc = {};
  for (const d of derived) {
    if (d && d.soc) derivedBySoc[d.soc] = d;
  }

  const vectors = {};
  const importance = {};
  const missing = [];

  for (const soc of check.socs) {
    const idx = socIndex[soc];
    if (idx == null) {
      const d = derivedBySoc[soc];
      if (d && Array.isArray(d.vector)) {
        vectors[soc] = d.vector.slice(0, DIM_COUNT);
        importance[soc] = Array.isArray(d.importance)
          ? d.importance.slice(0, DIM_COUNT)
          : new Array(DIM_COUNT).fill(0);
        continue;
      }
      missing.push(soc);
      continue;
    }
    vectors[soc] = sliceVector(lvBuf, idx);
    importance[soc] = sliceVector(imBuf, idx);
  }

  return {
    schemaId: manifest.schemaId,
    dimensionCount: DIM_COUNT,
    vectors,
    importance,
    missing,
  };
}

export async function getMagnitudeSample(env, baseUrl, sampleSize = 200) {
  const [lvBuf, manifest] = await Promise.all([
    getLvBuffer(env, baseUrl),
    getManifest(env, baseUrl),
  ]);
  const n = manifest.occupationCount || Math.floor(lvBuf.length / DIM_COUNT);
  const mags = [];
  const step = Math.max(1, Math.floor(n / sampleSize));
  for (let i = 0; i < n; i += step) {
    let sum = 0;
    const off = i * DIM_COUNT;
    for (let d = 0; d < DIM_COUNT; d++) {
      const v = lvBuf[off + d];
      sum += v * v;
    }
    mags.push(Math.sqrt(sum));
  }
  return mags;
}
