#!/usr/bin/env node
/**
 * Generate D1 seed SQL for onet_careers from artifacts.
 * Optional offline/search tooling — runtime uses static artifacts in data/onet/artifacts/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const careers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/artifacts/careers.json'), 'utf8'));
const hubMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/hub-career-soc-map.json'), 'utf8'));

const socToHubId = {};
Object.values(hubMap.careers).forEach((c) => {
  c.socs.forEach((s) => { socToHubId[s.soc] = c.hubId; });
});

const lines = ['BEGIN TRANSACTION;'];
for (const c of careers) {
  const title = c.title.replace(/'/g, "''");
  const desc = '';
  lines.push(
    `INSERT OR REPLACE INTO onet_careers (soc, title, title_norm, soc_major, hub_zone, layout_x, layout_y, job_zone, hub_featured, hub_id, vector_version, collar_category, mvp_in_scope) VALUES ('${c.soc}', '${title}', '${c.titleNorm}', '${c.socMajor}', '${c.hubZone}', ${c.layoutX}, ${c.layoutY}, ${c.jobZone ?? 'NULL'}, ${c.hubFeatured || 0}, ${socToHubId[c.soc] ?? 'NULL'}, 'onet-lv-161-v1', '${c.collarCategory || ''}', ${c.mvpInScope === false ? 0 : 1});`
  );
}
lines.push('COMMIT;');
const out = path.join(ROOT, 'migrations/0003_onet_careers_seed.sql');
fs.writeFileSync(out, lines.join('\n'));
console.log('Wrote', out, 'with', careers.length, 'rows');
