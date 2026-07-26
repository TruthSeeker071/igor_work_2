# Distinctive Fit — progress ledger

Execution ledger for `docs/DISTINCT_FIT_MASTERPLAN_2026-07-21.md`. One line per
completed slice, every deviation, every human-gated item. Sessions after the
first copy the D1 constants table from this file — they do not re-derive it.

Session map (from the masterplan): S1 = D0 + D1, S2 = D2 (the flip),
S3 = D3 remainder + D4 (after soak).

---

## Session 1 — D0 + D1 (2026-07-21)

Baseline before any edit, `npm run gates:unit`: **32/32 passed in 15.5s**, zero
`ok*` retries. Persona harness (`npm run test:vectors`) cross-matrix captured as
the byte-identical reference:

```
quant-finance cross-matrix: quant-finance=89 healthcare=62 creative=63 trades=18
healthcare     cross-matrix: quant-finance=42 healthcare=67 creative=33 trades=17
creative       cross-matrix: quant-finance=58 healthcare=44 creative=68 trades=18
trades         cross-matrix: quant-finance=0  healthcare=1  creative=0  trades=58
```

**Session close.** Full suite `npm run gates`: **35/35 passed in 57.5s**, zero `ok*` retries.
Pushed `a0f2f1e..41c30dc` to `Jacob_Work`. Live-verified against
`https://flightwayjacobprototype.pages.dev`: all 14 changed asset bodies sha-identical to
disk plus the new stamps in the HTML, on two consecutive polls (the POP-by-POP flip was
visible — 14 mismatches, then 6, then 1, then clean). `pages:smoke` 8/8 and `hub:smoke` 2/2
green against the deployed build. The served `onet-math.js` reads
`DISTINCT_FIT_ENABLED = false`, `FIT_MATH_VERSION = 1`, ladder unchanged — the intended
zero-behavior-change state.

### D0 slices

- [x] **D0.1** `abfc538` — `scripts/onet-etl/build-fit-baseline.mjs` (`npm run onet:baseline`,
  `--check`), `data/onet/artifacts/fit-baseline.json`, `LV_BASELINE` embedded between
  `@generated fit-baseline` markers in both math files. Three gates hold the copies
  together: `test:vectors` recomputes the mean independently of the generator,
  `hub:verify` fails a stale artifact, `--check` for CI. Mutation-checked (delta 1.0 → all
  three red).
- [x] **D0.2** `bd5669e` — `personalityFitPercent` / `distinctiveCosine` /
  `FIT_MATH_VERSION=1` / `DISTINCT_FIT_ENABLED=false` / `MASK_MIN_DIMS=24` in both math
  files. `test:vectors` chokepoint suite: 16 fixture pairs (fits 0-100), flag-off equality
  with the legacy expression on both client and server, client/server agreement on the dark
  distinctive path, mask floor vs an independent reimplementation. Mutation-checked by
  flipping the client flag alone.
- [x] **D0.3** `831bd42` — 10 call sites migrated. Persona harness byte-identical (see the
  baseline block above; same four lines after). Plus a structural gate: `test:vectors` scans
  `assets/js` + `functions` for a raw personality cosine and fails on one, allow-listing only
  `user-vectors.js` until D2.
- [x] **D0.4** `3cba98b` — `marco.js` (4×), `hub-canvas.js:1265-66`, `hub-dashboard.js:1198`,
  `quiz-app.js` `qzTierFor` now read `FWOnetMath.FIT_TIERS`; `fitRarity(50)` → `FIT_NEUTRAL`
  via `FWCareerTarget.neutralRarity()` in `career-target.js` (3×), `portal-target-switch.js`,
  `roadmap.js`.
- [x] **D0.5** cache census executed — findings below; `computePortalInputsHash` salted with
  `FIT_MATH_VERSION` (inert at version 1).

### D1 slices

- [x] **D1.1** `984d067` — `scripts/fit-calibrate.mjs` (`npm run fit:calibrate`),
  `scripts/fixtures/fit-personas.cjs` shared with `test:vectors`, tech + education personas,
  `expect`-SOC resolution assertion.
- [x] **D1.2** constants table locked below.

---

## D0.5 — cache census (executed 2026-07-21)

Every server-side KV write and client-side cache, and whether it stores a computed
personality/overall fit. P0.3 requires each "yes" to carry `FIT_MATH_VERSION`.

| Store | Holds a fit number? | Treatment |
|---|---|---|
| `career-rank:v1` (`_lib/onet/career-rank.js:44`) | **Yes** — `fit`, `personalityFit`, `objectiveFit`. Key is `prefix:emailhash:vectorFingerprint`; the fingerprint cannot see a formula change. | **D2: bump to `career-rank:v2`.** 30-day TTL reaps orphans. |
| `stretch:{email}:{slug}:{hash(drivers\|soc)}` (`stretch-fits.js:166`) | Indirectly — the payload is prose, but which candidates get explained is chosen by fit, and drivers are fit-derived. | **D2: version the key prefix.** 7-day TTL. |
| Portal snapshot (`auth.js` `computePortalInputsHash`) | **Yes, indirectly** — `buildCareerPoolForApi` (`auth.js:321`) sends `score` for the top 6 into the prompt, so the cached prose is written against fit numbers. Staleness keyed only on vector `updatedAt` + `vectorSchemaId`, which a formula change does not move. | **Done in D0**: salted with `FIT_MATH_VERSION`, gated `> 1` so it is a no-op today and starts invalidating at the flip. `quizPayloadHash` upload-dedupe untouched. |
| `gw:ca:*` (`career-analysis.js:290`) | No — keyed by career name; grounded outlook/salary facts about a career, no user fit. | None. |
| `_lib/flightplan-progress.js` | No — fractions/notes/lastWeek. | None. |
| `career-roadmap.js` step-elab / waypoint-plan caches | No — keyed by goal text, prose about steps. | None. |
| `sim-generate.js`, `resume-*.js`, `opportunities.js`, `weekly-plan.js`, `profile-alignment.js`, rate-limit and plan-limit counters | No. | None. |
| client `rankedCache` (onet-vectors) | Yes, but in-memory per page load. | None (masterplan). |

## Census corrections to the masterplan

1. `functions/_lib/onet/roadmap-vector-fit.js:40` computes personality fit via
   `computeFitPercent` and was **not** in Part 3's first table. Migrated in D0.3.
2. Part 3 listed `hub-dashboard.js` (highFit) and `quiz-app.js` (`qzTierFor`) as already
   reading the shared ladder. They were not — both hardcoded `56` (and quiz-app also
   `46`/`34`). Fixed in D0.4.
3. `assets/js/hub/hub-canvas.js:1196` (`pairFit >= 56`, link line width) is career↔career
   and therefore frozen — left alone deliberately.

## Deliberate hardcoded ladders that survive D0 (D2 must recalibrate them)

- `hub-canvas.js:827-828` `rarityOf` — the colour table, called per orb per frame for 782
  orbs. Documented in-file as a deliberate copy to keep the render hot path off module
  load order. **Update its literals in the D2 commit.**
- `career-target.js` `LOCAL_FIT_TIERS` / `LOCAL_FIT_NEUTRAL` — `resume.html` loads
  `career-target.js` without `onet-math.js`, so it needs a local ladder. Now one named
  table instead of scattered literals. **Update it in the D2 commit.**

---

## D1 constants table (LOCKED — session 2 copies from here, does not re-derive)

Measured 2026-07-21 at `984d067` with `npm run fit:calibrate`, six personas, 782 careers.
Re-run that command to reproduce every number below.

### The flip

| Constant | File(s) | From | **To** |
|---|---|---|---|
| `DISTINCT_FIT_ENABLED` | both math files | `false` | **`true`** |
| `FIT_MATH_VERSION` | both math files | `1` | **`2`** |

### Display ladder

| Constant | File | From | **To** |
|---|---|---|---|
| `FIT_TIERS.mythic` | `onet-math.js` | 66 | **70** |
| `FIT_TIERS.legendary` | `onet-math.js` | 56 | **58** |
| `FIT_TIERS.epic` | `onet-math.js` | 46 | **35** |
| `FIT_TIERS.rare` | `onet-math.js` | 34 | **20** |
| `FIT_TIERS.uncommon` | `onet-math.js` | 20 | **1** |
| `FIT_NEUTRAL` | `onet-math.js` | 50 | **0** |
| `LOCAL_FIT_TIERS` / `LOCAL_FIT_NEUTRAL` | `career-target.js` | 66/56/46/34/20, 50 | **same as above** |
| `rarityOf` literals | `hub-canvas.js:827-830` | 66/56/46/34 | **70/58/35/20** |

> **Superseded at D2: `mythic` shipped as 71, not 70.** The rounding below broke the
> occupancy bar this very table locks — see session 2's deviation 8. Every other value
> here shipped as written. `rarityOf` also needed its bottom branch moved `>= 0` → `>= 1`
> (deviation 9), which this table did not list.

**How the ladder was chosen.** Thresholds are the lowest integers meeting the masterplan's
occupancy targets (mythic ≤3%, legendary ≤8%, epic ≤20%) for every persona **but one**,
then rounded (the raw search returns 71/58/35/19/1). Occupancy under the locked ladder:

| persona | mythic | legendary | epic | own cluster reads | p99 reads |
|---|---|---|---|---|---|
| quant-finance | 1% | 4% | 17% | mythic | mythic |
| healthcare | 0% | 3% | 15% | epic | legendary |
| creative | 0% | 1% | 4% | epic | legendary |
| tech | 2% | 5% | 16% | legendary | mythic |
| education | 3% | 8% | 20% | legendary | mythic |
| **trades** | **10%** | **17%** | **27%** | mythic | mythic |

`uncommon: 1` is deliberate, not a typo. Under distinctive fit roughly half the catalog
displays exactly 0, so the meaningful bottom boundary is "any distinctive resemblance at
all" — 0 reads common (grey), anything positive reads at least uncommon. `FIT_NEUTRAL = 0`
follows from it: "we have no fit for this yet" must colour grey, and any positive
placeholder would inherit a real tier.

**Do not calibrate to the worst persona.** Requiring trades to meet 3% puts mythic at 85,
at which point no other persona can reach a top tier at all (their own clusters read epic,
their p99 reads epic). Trades is genuinely the most distinctive cluster in O*NET level
space; its exceedance is the measurement working, not failing.

### Thresholds that survive unchanged (measured, not assumed)

| Constant | File | Value | Why unchanged |
|---|---|---|---|
| `STRETCH_MIN_OBJECTIVE` | `onet-vectors.js` | **52** (keep) | See deviation 2 — unreachable for these fixtures under BOTH variants, so any new value would be fitted to a fixture artifact. |
| `STRETCH_MIN_GAP` | `onet-vectors.js` | **12** (keep) | Same. It is not the binding condition. |
| `STRETCH_TOP_EXCLUDE` | `onet-vectors.js` | **12** (keep) | Rank-based, scale-free. |
| `tradeOffLabel` ±30 | `onet-vectors.js` | **30** (keep) | See deviation 3 — the flip alone takes the "strong personality, early objective" branch from 82-90% of the catalog to 13-19%. Changing 30 as well would over-correct. |
| `tradeOffLabel` both-≥50 | `onet-vectors.js` | **50** (keep) | Already unreachable (objectiveFit tops out at 29); pre-existing, out of scope. |
| `MASK_MIN_DIMS` | both math files | **24** (keep) | Personas measure 134-152 signal dims; the floor never fires for a completed quiz. |

### Harness v2 assertion values (D2 replaces the current absolutes with these)

| Part 6 criterion | Locked assertion | Measured under D |
|---|---|---|
| 1. home zone #1 + margin | rank 1, margin ≥ **40** | 57, 68, 69, 92, 80, 70 |
| 2. own-cluster mean | ≥ **40** | 71, 53, 43, 83, 68, 60 |
| 3. every other cluster | ≤ own − **20** | worst gap 28 (creative vs education) |
| 4. trades persona | own ≥ **55**, every desk cluster ≤ **10** | 83; max desk 7 |
| 5. tier occupancy | desk personas: mythic ≤ **3%**, legendary ≤ **8%**; trades: mythic ≤ **12%**, legendary ≤ **20%** | see table above |
| — catalog spread (existing p90−p10 ≥ 35) | lower to ≥ **20** | 45, 42, 22, 70, 46, 48 |
| 6. re-hydration byte-identical | unchanged | — |
| 7. gate runtime | `gates:unit` ≤ ~60s | 15.4s wall |

### Cache versioning at D2

| Store | Change |
|---|---|
| `_lib/onet/career-rank.js:44` | `career-rank:v1` → **`career-rank:v2`** |
| `functions/stretch-fits.js:166` | `stretch:` → **`stretch:v2:`** |
| `auth.js` `computePortalInputsHash` | nothing to do — the `FIT_MATH_VERSION > 1` salt starts applying automatically at version 2. |

---

## Session 2 — D2, the flip (2026-07-21)

Baseline before any edit, `npm run gates:unit`: **32/32 passed in 15.6s**, zero `ok*`
retries. `npm run fit:calibrate` re-run at `415d9b6` reproduced the D1 constants table
exactly (own 71/53/43/83/68/60, margins 57/68/69/92/80/70, cross-matrix worst other
cluster 31/15/15/7/32/23) — the locked numbers are live, not stale.

**Session close.** Full suite `npm run gates`: **35/35 passed in 57.6s**, zero `ok*`
retries. Pushed `415d9b6..701dc77` to `Jacob_Work`. Live-verified against
`https://flightwayjacobprototype.pages.dev`: all four changed asset bodies sha-identical
to disk plus the `v=20260721r` stamp on all seven referencing pages, on two consecutive
clean polls (the POP-by-POP flip was visible again — 23 mismatches, then 7, then clean).
`pages:smoke` 8/8 and `hub:smoke` 2/2 green against the deployed build. The served
`onet-math.js` reads `DISTINCT_FIT_ENABLED = true`, `FIT_MATH_VERSION = 2`,
`FIT_TIERS = { mythic: 71, legendary: 58, epic: 35, rare: 20, uncommon: 1 }`,
`FIT_NEUTRAL = 0` — the flip is live.

### D2 slices

- [x] **D2** `9c5f125` — one commit, as the masterplan requires. `DISTINCT_FIT_ENABLED
  = true` + `FIT_MATH_VERSION = 2` in both math files; `FIT_TIERS` 71/58/35/20/1 and
  `FIT_NEUTRAL = 0` in `onet-math.js`, mirrored into `career-target.js`
  `LOCAL_FIT_TIERS`/`LOCAL_FIT_NEUTRAL` and `hub-canvas.js` `rarityOf`;
  `fitContributions` re-ranked on masked residual products in both files;
  `projectSectorScoresFromPersonality` → chokepoint with its round-trip guard;
  `sector-fit-sheet.js` given a frozen `SHEET_TIERS` copy of the old ladder;
  `career-rank:v1` → `:v2`, `stretch:` → `stretch:v2:`; harness v2; busters
  `v=20260721r` on the four changed assets across 7 pages.

### What the harness asserts now (all six personas, measured values)

| Criterion | Bar | quant-fin | health | creative | trades | tech | education |
|---|---|---|---|---|---|---|---|
| 1. home zone rank / margin | #1, ≥ 40 | 1 / 57 | 1 / 68 | 1 / 69 | 1 / 92 | 1 / 80 | 1 / 70 |
| 2. own cluster | ≥ 40 | 71.3 | 53.4 | 42.9 | 82.7 | 68.0 | 59.6 |
| 3. nearest OTHER cluster | ≤ own − 20 | tech 30.6 | edu 15.3 | edu 15.3 | crea 6.6 | fin 31.9 | health 22.7 |
| 5. mythic occupancy | ≤ 3% (trades ≤ 12%) | 1.0% | 0.0% | 0.0% | 10.0% | 1.5% | 2.9% |
| 5. legendary occupancy | ≤ 8% (trades ≤ 20%) | 4.5% | 2.7% | 1.3% | 16.8% | 5.1% | 7.5% |
| catalog p90−p10 | ≥ 20 | 45 | 42 | 22 | 70 | 46 | 52 |
| round-trip re-seed | home zone #1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`npm run test:vectors`: **199 assertions, 0 failures**. The old absolutes it replaced
(`own >= 55`, `spread >= 35`, `opposite cluster <= 20`) are gone from the suite AND
their per-persona exemptions are gone from the fixture — `minZoneMargin: 10`
(business-finance) and `maxOppositeFit: 35` (tech) both existed only because the
mean-centered formula could not separate desk from desk.

### Deviations recorded this session

8. **Shipped `FIT_TIERS.mythic = 71`, not the ledger's 70.** D1 derived 71 and then
   rounded it to 70 for cosmetics. At 70 the education persona reads **3.2%** mythic and
   fails D1's own locked acceptance bar (desk personas ≤ 3%); at 71 it reads 2.9%. The
   ladder value and the acceptance bar were both locked in D1 and are mutually
   inconsistent by 0.2pp — the bar is the masterplan's Part 6 criterion and predates the
   rounding, so the rounding lost. Loosening the bar to bless 70 would have been tuning
   the test to the result. `legendary 58 / epic 35 / rare 20 / uncommon 1` ship as locked.
   `fit-calibrate.mjs`'s candidate row is renamed `SHIPPED (D2)` and carries 71.
9. **`hub-canvas.js` `rarityOf`'s bottom branch moved `>= 0` → `>= 1`.** The ledger's
   table listed only the four upper literals, but `FIT_TIERS.uncommon = 1` means 0 must
   read common/grey. Left at `>= 0` the map would render every one of the ~50% zero-fit
   careers green — the exact "sea of uniform colour" the flip exists to end. Faithful
   sync, not a re-derivation.
10. **`why-this-match.js` still ranks on raw products.** The masterplan asked for
    `fitContributions` to explain the displayed score, and it now does. The visible
    drawer, though, is usually fed by `FWWhyThisMatch.fromComparisons`, which receives
    `{name, domain, user, target}` display rows with **no dimension index** — it cannot
    subtract `LV_BASELINE` without threading indices down from every caller. Out of
    scope for D2; carried as a D4 follow-up.
11. **`test:vectors` asserts the flag/version RELATION, not literals.** `DISTINCT_FIT_
    ENABLED === (FIT_MATH_VERSION > 1)` plus "the selected branch is the live one" gates
    the flip and a future rollback with the same code, keeping P0.6's one-commit rollback
    a single edit.

### Post-flip spot-check (required by the session map, done before push)

Hub macro, dark, two personas seeded through the committed harness:

| | quant-finance | trades |
|---|---|---|
| Business & Finance | **53%** (epic, brightest cluster) | 0% |
| Trades | 0% | **69%** (legendary gold) |
| Tech | 34% | 3% |
| Government / Education | 22% / 22% | 0% / 0% |
| Engineering & Science | 16% | 0% |
| Creative & Media | 10% | 0% |
| Healthcare / Social | 0% / 0% | 0% / 0% |

One dominant cluster, a graded neighbourhood, and genuinely dead zones rendering
grey — the "selective gold cluster, not a sea of uniform gold" the masterplan's D3
asks for, visible two sessions early. The 0% floor does not read as broken in situ:
zero zones are grey and unremarkable rather than alarming.

**Harness changes shipped with it.** `FW_SHOT_QUIZ` lets any fixture persona be
rendered instead of the one generic probe — that is what made this spot-check
possible, and D3's sweep should use it. `waitHubReady` also now waits for a nonzero
zone fit to exist before the shutter, as a guard: the overlay hides before the fits
resolve and the zone label layer is cached, so an early shutter would capture a
plausible-looking map at pre-fit colours.

Recorded because the debugging was misleading: the first two persona runs came back
pixel-identical, which looked exactly like that timing bug. It was not — the fault
was in a throwaway driver script that failed to pass the env var through, and the
committed harness renders each persona correctly. **A same-looking screenshot is not
evidence of a rendering bug until the page's own computed values have been read
back;** doing that (`FWOnetHub.getZoneFit` per zone) is what settled it in one probe.

### Human-gated

Nothing. The flip is a code change.

---

## Session 3 — D3 remainder + D4 (2026-07-21)

Baseline before any edit, `npm run gates:unit`: **32/32 passed in 15.2s**, zero `ok*`
retries.

**Soak deviation, recorded up front.** The masterplan gates this session on "several
days of soak" after D2. D2 shipped earlier the same day, so the soak was hours, not
days. Session 3 ran anyway on explicit instruction. What that costs is real and worth
naming: D4 closes the one-commit rollback window, so anything the flip breaks in normal
use now costs a revert instead of a constant flip. Nothing in this session's QA
suggested that risk materialised.

**Session close.** Full suite `npm run gates`: **35/35 passed in 56.9s**, zero `ok*`
retries. Pushed `e4ab935..bcb5b22` to `Jacob_Work`. Live-verified against
`https://flightwayjacobprototype.pages.dev`: all three changed asset bodies
(`onet-math.js`, `why-this-match.js`, `portal.js`) sha-identical to disk, plus
`v=20260721t` on all six onet-math pages, `v=20260721t` on career's why-this-match and
`v=20260721s` on portal — two consecutive clean polls (the POP-by-POP flip was visible
again: 11 mismatches, then clean). `pages:smoke` 8/8 and `hub:smoke` 2/2 green against
the deployed build. The served `onet-math.js` contains **zero** occurrences of
`DISTINCT_FIT_ENABLED`, still reads `FIT_MATH_VERSION = 2` and the 71/58/35/20/1 ladder,
and the served `portal.js` carries the new sector-sheet sentence. `npm run fit:calibrate`
re-run after the flag removal still reproduces the ladder analysis.

### D3 slices

- [x] **D3.1** `133666a` — the harness seeds a HYDRATED persona. `fit-personas.cjs`
  carries quiz answers; a user who finished the quiz also has the vectors. The hub
  hydrates on its own so it looked fine, but `portal.html` read the stored vector,
  found an all-zero `source:'empty'` one, and ranked sectors off it — the quant-finance
  persona's profile chip read **"Trades · Social"** beside a map reading Business &
  Finance 53%. Pre-existing, not a D2 regression: with the flag forced off the same
  seed read "Education · Engineering & Science". New `scripts/fixtures/hydrate-persona.cjs`;
  `FW_SHOT_PAGES/THEMES/VIEWPORTS` narrow the 52-cell matrix to one axis; the portal
  profile drawer is opened and captured; hub zone fits are dumped beside the shot.
  Hub numbers byte-identical across the change (53/34/22/22/16/10/3/0/0/0).
- [x] **D3.2** `8d86429` — the pre-authorised copy tweak (details below).
- [x] **D3.3** `9c5849c` — the sector dive became a real look at the orb ladder:
  `POST /onet/vectors` is a Pages Function, so against the static server every career
  kept `fitScore: null` and a dive rendered 115 grey orbs — indistinguishable from
  "distinctive fit zeroed this sector". Route now served from the same artifacts; the
  dive targets the persona's own top zone (it had been diving into whatever sat nearest
  screen centre — Creative & Media for the finance persona); the coach page's
  first-visit intro modal is dismissed; tier histograms dumped beside each shot.
- [x] **D3.4** full six-persona sweep across hub macro / hub sector dive / portal +
  profile drawer / career / Marco, dark desktop. Results below.

### D4 slices

- [x] **D4.1** `94fc087` — `DISTINCT_FIT_ENABLED` and the legacy branch removed from both
  math files; `personalityFitPercent` is the distinctive expression outright and
  `fitContributions` always ranks on masked residuals. The flag's two assertions were
  replaced, not dropped: `FIT_MATH_VERSION > 1` still ties a cached percent to a formula
  past the legacy one, both files are grepped to prove the flag is gone rather than
  half-removed, and "differs from the legacy cosine" is now the live-branch proof.
  Mutation-checked by pointing the client chokepoint back at `cosine()`: 31 failures.
  Busters `onet-math.js v=20260721t` on its six pages.
- [x] **D4.2** `60634d2` — deferred item closed (see below). Deferred list is now empty.

### The six-persona sweep (dark, desktop, `.screenshots/d3final`)

Home-sector dive, tier histogram of every career in the sector, and the zone's own
overall/personality fit:

| persona | home sector (n) | mythic | legendary | epic | rare | uncommon | common | zone overall/personality |
|---|---|---|---|---|---|---|---|---|
| quant-finance | business-finance (115) | 0 | 6 | 34 | 31 | 27 | 17 | 53 / 70 |
| healthcare | healthcare (134) | 0 | 0 | 56 | 59 | 19 | 0 | 51 / 68 |
| creative | creative-media (55) | 0 | 0 | 16 | 21 | 15 | 3 | 52 / 69 |
| trades | trades (89) | 0 | 60 | 25 | 3 | 1 | 0 | 69 / 92 |
| tech | tech (41) | 0 | 3 | 30 | 5 | 1 | 2 | 61 / 80 |
| education | education (71) | 0 | 16 | 38 | 11 | 4 | 2 | 62 / 83 |

Every persona dives into its own home zone, every home sector shows a graded ladder
rather than one flat colour, and the map outside it is grey. The finance dive is a gold
and purple knot around Accountants and Auditors / Financial and Investment Analysts /
Financial Risk Specialists thinning to grey toward Sales & Real Estate. The trades dive
is 60/89 legendary — the most uniform sector in the sweep, and the same "trades is
genuinely the most distinctive cluster" fact D1 refused to calibrate against.

Portal sector sheets agree with the hub to the point, every persona's home sector first:
finance 53/34/22/22/16/10/3, healthcare 51/26/19/16, creative 52/16/8/6/5, trades 69/3,
tech 61/47/17/14/8, education 62/22/22/18/17/10/8/4.

### The copy tweak (pre-authorised, used once)

The 0% floor did read as broken in one place: the portal's sector sheet lists only
sectors above 0%, so the trades persona sees **two rows out of ten** under a heading
saying "Fit across Career Hub sectors". Eight sectors vanishing without explanation
reads as a panel that failed to load. The sub-line now states the omission: "Sectors
your profile distinctively matches — from your personality and objective vectors.
Sectors not listed score 0%." Nothing else was touched; the sheet itself is right.

### Findings recorded, not fixed (out of D3's one-tweak budget)

1. **The top tier is unreachable on every surface that shows overall fit.** The hub map
   and the portal sheet colour on `overallFitScore = 0.75p + 0.25o`, but D1 calibrated
   the ladder's occupancy on **personality** fit. Objective fit tops out at 13-29 for
   the fixtures, so the blend caps well below `FIT_TIERS.mythic = 71`. Measured best
   career per persona (personality → overall): finance 77 → 61, healthcare 64 → 52,
   creative 62 → 53, trades 91 → 70, tech 78 → 65, education 81 → 67. **No persona ever
   renders a mythic orb**, and healthcare and creative never render a legendary one.
   This is Part 5's "blend imbalance" risk, measured: the plan said the ladder would
   absorb it, and the ladder was calibrated on the other quantity. Fixing it means
   either calibrating the ladder against the blend or displaying personality fit on
   those surfaces — both larger than a D3 tweak, and both touch D1-locked constants.
2. **`resolvePersonality` returns an all-zero vector as if it were an answer.** A
   `source:'empty'` vector has `values`, so the seed-from-scores fallback never runs,
   and under a residual correlation an all-zero user reads "anti-generic" — which ranks
   trades first for everybody, deterministically. Only reachable with a degenerate
   stored vector (the harness's old seed was one), and the guard belongs in
   `resolvePersonality`, which P0.5 freezes. Carried, not fixed.
3. **`qzTierFor`'s bottom branch labels 0% "SOLID MATCH"** (`quiz-app.js:1462`). Only
   reachable if a user's #1 career scores under 20, i.e. essentially a degenerate
   vector, so it is finding 2 wearing a different hat.
4. **Marco's target chip was not exercised.** It renders only with a chosen target
   career and the fixture personas have none; the empty state is correct. Its ladder
   read (D0.4) is covered by gates, not by this sweep.
5. **Quiz results tiers were not exercised visually** — the results screen needs a quiz
   played to completion, which the seed cannot fake. `qzTierFor` reads the shared ladder
   and the percent it grades is `hubPct`, a real fit score, so it is on the correct
   scale; verified by reading, not by screenshot.

### Deferred list — CLOSED

| Item | Outcome |
|---|---|
| `why-this-match.js` raw-product ranking (D2 deviation 10) | **Fixed**, `60634d2`. The blocker recorded at D2 — "display rows carry no dimension index" — was wrong: `onet-vectors.js:326,371` both push `index`. Ranked on residuals it now matches `fitContributions` exactly, and rows are restricted to dimensions where both sides sit above baseline (see the commit for why that differs from `fitContributions` on purpose). |
| Distinctive career↔career similarity (links, layout, `pivot-analysis.js` transferPct) | **Not done, and not ticketed as pending work.** P0.4 froze it for this plan and nothing in D3 argued for changing it: the map's link structure reads correctly under the new orb colours. A future plan may revisit; this one closes without it. |
| Objective-side distinctiveness | **Closed as won't-do for this plan** (masterplan decision 5: the objective vector is sparse evidence built from zero, so subtracting a 0-100 baseline from it is meaningless). Finding 1 above is the live consequence and is the item a future session should pick up. |
| D3 copy follow-up | **Closed** — one tweak was needed and shipped (`8d86429`). |

### Human-gated

Nothing.

---

## Deviations from the masterplan

1. **`roadmap-vector-fit.js:40` was missing from the Part 3 census** and computes personality
   fit the same way the listed sites do. Migrated in D0.3 rather than left behind.

2. **The stretch criteria cannot be recalibrated from these fixtures, and were left alone.**
   The masterplan (Part 3) predicted the gap condition would "fire far more" once personality
   medians drop to ~0. Measured: it is not the binding condition. `objectiveFit` tops out at
   **22-29** across all six personas, so `STRETCH_MIN_OBJECTIVE = 52` never passes — the
   stretch panel produces zero candidates under variant A *and* variant D. Lowering 52 to
   fit these personas would be tuning a production constant against fixtures whose objective
   vector is two sentences of resume text. `test:vectors` already defends the stretch
   criterion with synthetic orthogonal-subspace fixtures; those stay the gate. **Open
   question for a future session, not this plan: is `objectiveFit >= 52` reachable by any
   real user?** If not, the stretch panel is dead code in production.

3. **`tradeOffLabel`'s ±30 was left alone because the flip already fixes it.** Under variant
   A the "strong personality fit, early-stage objective fit" branch fires for **82-90%** of
   the catalog for every desk persona — a label that always shows says nothing. Under D it
   fires for 13-19% (creative 2%, trades 28%). Moving the threshold as well would over-correct
   a defect the flip cures on its own.

4. **Part 6 criterion 5 is split by persona.** "Mythic ≤3% per decided persona" is not
   achievable for trades at any ladder that leaves the top tier reachable for the other five
   (it would require mythic = 85). The locked assertion is mythic ≤3% / legendary ≤8% for the
   five desk personas and ≤12% / ≤20% for trades. Reasoning is in the constants table.

5. **The p90−p10 spread assertion drops from ≥35 to ≥20.** Under D, creative measures 22.
   The old floor was calibrated to variant A, where p10 sat at 21-28 rather than 0.

6. **Criterion 1's margin floor is tightened from the plan's ≥15 to ≥40.** Measured minimum
   under D is 57; ≥15 would not catch a real regression.

7. **`tech` carries `maxOppositeFit: 35`** in the shared fixture (vs the suite's default 20).
   Under variant A it measures 31 against trades. This is a property of the mean-centered
   formula, and D2's criterion 3 replaces the absolute ceiling with a per-cluster margin.

12. **Session 3 ran without the soak.** The masterplan gates D4 on "several days" after
    D2; it ran the same day, on instruction. Consequence stated in the session-3 block.

13. **D3 spent its one copy tweak on a different sentence than the plan anticipated.**
    Part 5 expected the risk to be careers reading 0% inside the map. On the map that
    reads fine — zeros are grey and unremarkable. What read broken was the portal sector
    sheet *hiding* its zero rows, so the panel looked truncated. Same defect class,
    different surface.

14. **Three of D3's five named surfaces could not be QA'd by screenshot, and the reason
    was the harness, not the product.** The sector dive rendered every orb grey because
    `POST /onet/vectors` is a Pages Function the static server does not have; the coach
    page was covered by a first-visit modal; the portal was seeded with a vectorless
    quiz. All three were fixed in the harness (`133666a`, `9c5849c`) before any
    conclusion was drawn from a picture. The career page's fit card and the quiz results
    tiers remain unreachable offline — they need live AI responses and a played quiz —
    and were verified by reading the code path instead, recorded as findings 4 and 5.

## Human-gated

_Nothing in this plan, D0 through D4, requires Jacob._ The flip itself (D2) was a code
change, not an env var, and D3/D4 are code and tooling.

Carried forward from the overhaul, unchanged and unrelated to this plan: `PAYWALL_ENABLED`,
`DEV_TEST_EMAILS`, Stripe IDs, `ROOT_ADMIN_EMAIL`, `GROUNDING_ENABLED` — see the
"Consolidated Human-gated punch list" in `docs/CONVERSATION_HANDOFF.md`.

---

## REVERSED — 2026-07-21, same day (see docs/FIT_MATH.md)

Distinctive fit shipped (D2), passed its own acceptance suite, survived a
five-surface persona QA (D3), and was **reverted the same day on report from
use**: real profiles read ~5% against every cluster.

The formula was not wrong; it answered a different question than the product
asks. Baseline-subtracted correlation scores how *unusual* a match is, so a
person whose profile is not unusual scores near zero against everything. The
six fixture personas are synthetic extremists — sector scores of 95/78/62 with
matching resumes — and every one of them cleared every bar. A profile closer to
the population mean, which is what most users are, does not. **A fixture set
built from decisive profiles cannot detect a formula that only works on
decisive profiles.** That is the lesson worth keeping from this plan.

What shipped instead (`ee45570`, `284ebb6`, `2b805c1`):

- `personalityFitPercent` is the mean-centered cosine again.
- `overallFitPercent(personality, objective, career)` — ONE correlation against
  the summed user vector, replacing the 0.75/0.25 blend of two correlations.
  This also closes D3's finding 1 by construction: with no objective vector the
  sum IS the personality vector, so the top tier is reachable without evidence.
- `FIT_TIERS` 75/62/50/38/15; `FIT_MATH_VERSION` 3; KV `career-rank:v3`,
  `stretch:v3:`.
- `resolvePersonality` no longer serves a signal-less stored vector (D3 finding
  2, previously frozen by P0.5 — the freeze died with the plan).
- LV_BASELINE, its generator, its artifact and its parity gates are deleted.

What was kept from the plan, because it was right independently of the formula:
the single-chokepoint discipline (both formula changes cost nothing at the call
sites precisely because none of them compute their own cosine), the version
stamp on every stored fit, and the client/server parity gate.

**The accepted cost, restated:** plain correlation does not separate desk
sectors. A quant-finance profile reads tech 79 against its own 82. The persona
suite's cross-cluster assertion is deleted rather than weakened.

**Open, and likely the next complaint:** one absolute ladder cannot be fair
across profiles, because absolute level tracks how *typical* a profile is. Under
the shipped ladder a quant-finance profile reads 17% of the catalog mythic — 76
of the 115 careers in its home sector render gold — while trades reads 0%.
Percentile tiers ("mythic = your own top 2%") are the fix; they are specified in
docs/FIT_MATH.md and not built.

**Verified live.** Full suite `npm run gates`: **35/35 in 56.3s**, zero `ok*` retries.
Pushed `8a60b47..dcdfb43` to `Jacob_Work`. Against
`https://flightwayjacobprototype.pages.dev`: `onet-math.js`, `onet-vectors.js`,
`hub-canvas.js` and `portal.js` all sha-identical to disk at `v=20260721u`, the stamp
present on every referencing page, and the rewritten explainer copy served — two
consecutive clean polls (6 mismatches on the first, then clean). `pages:smoke` 8/8,
`hub:smoke` 2/2. The served `onet-math.js` reads `FIT_MATH_VERSION = 3`,
`FIT_TIERS = { mythic: 75, legendary: 62, epic: 50, rare: 38, uncommon: 15 }`, and carries
both `personalityFitPercent` and `overallFitPercent`.

Persona QA through the committed harness, reading the page's own numbers back:
quant-finance zones `85 · 81 · 78 · 76 · 76 · 74 · 68 · 65 · 65 · 19`, its home sector
topped by Accountants and Auditors 87; trades reads its own zone 58 and every other zone
0. The spread is the one the change was asked for. The home-sector colour density is not
— 76 of business-finance's 115 careers render mythic, which is the absolute-ladder limit
above, visible on the first surface anyone will look at.
