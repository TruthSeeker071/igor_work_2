# Fable 5 brief — FlightWay macro career-hub changes

**Repo:** `/Users/jacobklugerman/Flightway/flightway` · **branch:** `Jacob_Work`
**Deploy = `git push origin Jacob_Work`** (Cloudflare Pages auto-builds; **never** `npm run deploy:prototype`). Verify live with `curl -L` + `npm run pages:smoke`.

Higher effort is authorized: this touches the ETL data pipeline, canvas rendering, and camera math. Spend the effort on the three design-judgment calls flagged **[JUDGMENT]**; keep the mechanical parts tight. Before editing, read `docs/CONVERSATION_HANDOFF.md` (newest addendum) and reconcile it against `git log --oneline -5` — resumed context has lagged the repo before. Trace each path before editing; one change per goal; verify with the project scripts, not by re-reading.

**Do Tasks 1 and 4 together** — both regenerate the same layout artifacts in one ETL run.

---

## Task 1 — Merge Business + Finance → "Business & Finance"

The 11 macro-zones are produced by the ETL, not display-only. Business and finance are still two separate zones in `careers.json` (72 + 43). Merge them the way engineering/science/cyber were merged.

**ETL — `scripts/onet-etl/rezone-hub.mjs`:**
- `MERGE_INTO` (line 78): add `business: 'business-finance', finance: 'business-finance'`.
- `ZONE_LABELS` (line 83): remove standalone `business` and `finance`; add `'business-finance': 'Business & Finance'`. (`EXPECTED_ZONES` becomes 10.)
- `DEAD_ZONES` (line 90): add `'business'`, `'finance'`.
- `ZONE_COLORS` (line 93): set `ZONE_COLORS['business-finance'] = OLD_ZONE_COLORS.finance` (finance's hue reads stronger; your call).
- Macro-placement constituent loop (~line 156) already averages the untouched `zone-aggregate-vectors.json` keys — `'business'` and `'finance'` exist there, so it works unchanged. **Confirm, don't assume.**
- Re-run: `node scripts/onet-etl/rezone-hub.mjs` → rewrites `careers.json`, `hub-zone-map.json`, `layout-2d.json`, `zone-colors.json`, `zone-layout.json` (idempotent — already-merged zones pass through).

**Runtime — `assets/js/hub/hub-onet-map.js`:**
- `DISPLAY_ZONE_MERGE` (line 652): add `business: 'business-finance', finance: 'business-finance'` (aggregate-fit reader; miss it and the merged zone shows 0% fit — the comment above it calls out exactly this bug).
- `ZONE_LABEL_OVERRIDES` (line 45): add `'business-finance': 'Business & Finance'`.

**Update assertion:** `scripts/verify-hub-lod.mjs:24` — `EXPECTED_ZONE_COUNT = 11` → `10`.

---

## Task 4 — Spatially link Business & Finance ↔ Tech ↔ Engineering & Science (Tech as the bridge)

Macro-cluster placement is `UMAP(zone aggregate vectors) → circle-pack` in `rezone-hub.mjs` (~lines 151–232). Tech is vector-adjacent to both, so it may already sit between them — not guaranteed.

**[JUDGMENT]** Pick the cleaner of: (a) a deterministic post-circle-pack nudge that makes those three centroids adjacent/collinear with tech in the middle, preserving the other clusters; or (b) seeding the UMAP init so the three land together. Either way it must keep **every** cluster on-screen at fit zoom — respect `CLUSTER_GAP` (line 232) and the fit-zoom orphaned-edge-label guard (`hub-onet-map.js:1297`). The inter-cluster `similarityLinks` web already exists; emphasizing those three links reinforces the "bridge" visually but is not a substitute for placement.

---

## Task 2 — Background sub-area labels inside every individualized (sector) hub

Restore the legacy hub's faint background area labels behind the orbs in each zone dive — e.g. Engineering & Science shows **Physics · Engineering · Chemistry · Biology**. Render for **every** zone and **independently of the top-fit lens** (grounding even when few orbs in that area are top fits).

**No existing data — this is a new subsystem.** Use the starter map below (keyed by SOC prefix, **per zone**). Algorithm:
1. For each career in a zone, assign it to the sub-area whose `soc` prefix is the **longest match** against `career.soc` (so `19-2011` beats `19-20` beats `19-`). `soc` looks like `"17-2011.00"`; prefixes are plain string-prefix matches.
2. A sub-area renders only if it has **≥ 3 member careers** (tunable). Careers matching no rendered sub-area simply get no backdrop label.
3. Position each label at the **centroid of its members' `sectorX`/`sectorY`** (both fields exist per career).
4. Build the per-zone label list once at load; store on `state`; render **before** orbs in the sector paint.

**Render:** mirror the macro zone-label style (`ZONE_LABEL_FONT_PX`, `wrapZoneLabel`, ~`hub-canvas.js:582`) but faint, large, uppercase, low-alpha, behind orbs. Sector background entry point: `paintSectorScreenBackground` (`hub-canvas.js:257`). **Invariant:** labels are static per-zone — never gate them on `lensCutoffValue`/fits. This one warrants real visual QA (headless Playwright probe or `pages:smoke` + screenshot).

**[JUDGMENT]** The starter labels below are opinionated and user-facing — review/tune wording and granularity; they're grounded in the actual SOC distribution but not sacred. The map is **per zone**, which is deliberate: e.g. `15-12` means Software in `tech` but Cybersecurity in `engineering-science`, and the per-zone keying resolves that cleanly.

### Starter map — `SECTOR_SUBAREAS`

```js
// Per-zone background sub-area labels. Assign each career to the sub-area whose
// `soc` prefix is the LONGEST match against career.soc. Render a label only if
// its member count >= SUBAREA_MIN (3). Position at the centroid of members'
// sectorX/sectorY. Independent of the fit lens.
var SUBAREA_MIN = 3;
var SECTOR_SUBAREAS = {
  'business-finance': [
    { label: 'Management & Leadership', soc: ['11-'] },
    { label: 'Finance & Accounting',    soc: ['13-20'] },
    { label: 'Business Operations',     soc: ['13-10', '13-11'] },
    { label: 'Sales & Real Estate',     soc: ['41-'] },
  ],
  'engineering-science': [
    { label: 'Engineering',                    soc: ['17-10', '17-20', '17-21'] },
    { label: 'Drafting & Eng. Technicians',    soc: ['17-30'] },
    { label: 'Biology & Life Sciences',        soc: ['19-10'] },
    { label: 'Physics & Astronomy',            soc: ['19-2011', '19-2012', '19-2021'] },
    { label: 'Chemistry & Materials',          soc: ['19-2031', '19-2032'] },
    { label: 'Earth & Environmental Science',  soc: ['19-2041', '19-2042', '19-2043'] },
    { label: 'Social Sciences',                soc: ['19-30'] },
    { label: 'Science Technicians',            soc: ['19-40'] },
    { label: 'Security & Cybersecurity',       soc: ['15-12', '13-11', '11-30', '33-'] },
  ],
  'tech': [
    { label: 'Software & IT',        soc: ['15-12', '11-30'] },
    { label: 'Data Science & Math',  soc: ['15-20'] },
    { label: 'Computer Hardware',    soc: ['17-20'] },
  ],
  'healthcare': [
    { label: 'Physicians & Surgeons',      soc: ['29-12'] },
    { label: 'Dental, Pharmacy & Vision',  soc: ['29-10'] },
    { label: 'Nursing & Therapy',          soc: ['29-11'] },
    { label: 'Medical Technicians',        soc: ['29-20', '29-90'] },
    { label: 'Care Aides & Assistants',    soc: ['31-'] },
    { label: 'Mental Health & Counseling', soc: ['21-'] },
    { label: 'Public Health & Science',    soc: ['19-', '15-12', '17-20'] },
  ],
  'creative-media': [
    { label: 'Art & Design',        soc: ['27-10', '15-12'] },
    { label: 'Performing Arts',     soc: ['27-20'] },
    { label: 'Writing & Journalism',soc: ['27-30'] },
    { label: 'Media Production',    soc: ['27-40'] },
    { label: 'Marketing & PR',      soc: ['11-20', '13-11', '41-30'] },
  ],
  'education': [
    { label: 'College Faculty',        soc: ['25-10', '25-11'] },
    { label: 'K–12 Teaching',          soc: ['25-20'] },
    { label: 'Adult & Continuing Ed',  soc: ['25-30'] },
    { label: 'Library & Museum',       soc: ['25-40'] },
    { label: 'Administration & Support',soc: ['11-90', '25-90', '21-'] },
  ],
  'government': [
    { label: 'Administrative Support',    soc: ['43-10', '43-20', '43-40', '43-41', '43-60', '43-90', '43-91'] },
    { label: 'Financial & Records Clerks',soc: ['43-30'] },
    { label: 'Logistics & Dispatch',      soc: ['43-50', '43-51'] },
    { label: 'Military & Defense',        soc: ['55-'] },
    { label: 'Food Service',              soc: ['35-'] },
  ],
  'law': [
    { label: 'Legal Practice',             soc: ['23-', '43-60'] },
    { label: 'Law Enforcement',            soc: ['33-10', '33-30'] },
    { label: 'Fire & Protective Services', soc: ['33-20', '33-90'] },
  ],
  'social': [
    { label: 'Counseling & Social Work',   soc: ['21-'] },
    { label: 'Personal Care',              soc: ['39-50', '39-60', '39-90'] },
    { label: 'Recreation & Gaming',        soc: ['39-10', '39-20', '39-30'] },
    { label: 'Funeral Services',           soc: ['39-40'] },
    { label: 'Hospitality & Guest Services',soc: ['39-70', '35-', '43-40'] },
  ],
  'trades': [
    { label: 'Manufacturing & Machining',    soc: ['51-40', '51-41'] },
    { label: 'Production & Plant Operations',soc: ['51-80', '51-90', '51-91'] },
    { label: 'Agriculture & Forestry',       soc: ['45-', '19-40', '11-90'] },
    { label: 'Grounds & Maintenance',        soc: ['37-'] },
    { label: 'Culinary',                     soc: ['35-'] },
  ],
};
```

Note: `'business-finance'` is the merged key from Task 1 — keep the two tasks in sync. Sub-3-member buckets (a couple in healthcare/tech at current counts) will self-suppress via `SUBAREA_MIN`; that's intended.

---

## Task 3 — Open on the fully zoomed-out macro view, and allow zooming out further

- `hub-onet-map.js:1292` — `OVERVIEW_DEFAULT_ZOOM_MULT = 1.85` is why the hub opens zoomed *past* fit. Set it to `1.0` so it lands showing the entire world (all clusters).
- `MIN_ZOOM` (line 21) `= 0.5` → lower it (try `0.35`) for more zoom-out. **But** re-check pan clamping and the orphaned-edge-label guard (`:1297`) at the new floor — the risk is clusters sliding off-screen. Test panning at min zoom.
- **TDZ trap:** any new `let`/`const` reached by the top-level boot chain (`resize → syncMapHud`) must be declared before ~line 240 of `hub-dashboard.js`, or the hub boots to an infinite spinner with no error (`node --check` won't catch it — `pages:smoke` will).

---

## Task 5 — Darkened hub background so the pointer light shows in light mode

Today the cursor spotlight is gated `!isHubLightTheme()` (`hub-canvas.js:1454`, redraw request at `hub-dashboard.js:1383`), and in light mode the canvas fill is light — so the light can't be seen. Restore legacy behavior: **the hub canvas is always dark, spotlight always on.**

- Force the dark backdrop for the hub regardless of page theme — make `getHubCanvasBg()` (`assets/js/shared/hub-canvas-bg.js:10`) return the dark value for the hub, or set `--hub-canvas-bg` to the dark color unconditionally. Keep it scoped to the hub canvas; don't darken page chrome.
- Remove the `!isHubLightTheme()` gate on the spotlight at `hub-canvas.js:1454` and `hub-dashboard.js:1383`.
- **[JUDGMENT] Fragile — trace before editing.** An always-dark canvas breaks any interior text/label that assumed a light canvas in light mode. Walk **every** `isHubLightTheme()` call in `hub-canvas.js` (lines 199, 260, 375, 435, 727, 824) and the dot-grid color (`hub-canvas-bg.js:65`); decide per call — page-chrome/HUD stays theme-aware, **canvas-interior** text/labels/grid follow the now-dark canvas so they stay legible. Don't blanket-flip.

---

## Ship checklist

- `node --check` every touched JS.
- `npm run hub:verify` (after the `EXPECTED_ZONE_COUNT` edit), `npm run test:vectors`, `npm run onet:test`, `npm run pages:smoke`; visual QA for Tasks 2 & 5.
- Bump `?v=` busters — changed files only, on **every** page referencing each:
  - `hub-onet-map.js` — `dashboard.html:210`
  - `hub-canvas.js` — `dashboard.html:215`
  - `hub-dashboard.js` — `dashboard.html:216`
  - `hub-canvas-bg.js` — `dashboard.html:214` **and** `roadmap.html:83`
  - Give co-changed files the same new stamp.
- Commit the regenerated `data/onet/artifacts/*` alongside the code. `git push origin Jacob_Work` (this deploys). `curl -L` the live URL + `npm run pages:smoke`. Report outcome-first with file:line evidence.
