# Distinctive Fit Masterplan — 2026-07-21

This is the single execution document for moving personality fit from mean-centered
cosine to **baseline-subtracted (distinctive) fit**: subtracting the generic-occupation
profile from BOTH the user vector and the career/zone vector before correlating. It is
the scoped follow-on that overhaul fix 1.3 (shipped `e3da3a9..f958b3a`, closed) explicitly
deferred: fix 1.3 sharpened the user's vector, but the fit formula itself still rewards
resemblance to the white-collar common mode, which caps desk-sector separation no matter
how sharp the user vector is.

Every claim below was verified against the repo on 2026-07-21 at HEAD `2724e2b`, and every
number comes from a probe run against the real artifacts (782 careers, live hydration
code) on the same day. File:line references are real — re-grep before editing if the file
has drifted.

**Read first, in order:** `CLAUDE.md` → `docs/CONVERSATION_HANDOFF.md` (newest addendum)
→ `git log --oneline -10` → this document, fully, before writing any code.

---

## Part 0 — Operating framework (binding)

Part 0 of `docs/OVERHAUL_MASTERPLAN_2026-07-20.md` applies verbatim: deploy is
`git push origin Jacob_Work` and nothing else; vanilla JS, zero new runtime deps; fresh
`?v=` busters on changed assets only, every referencing page; verification is the repo's
npm scripts + curl; one commit per slice, gate before each commit; ledger + handoff
discipline; human-gated items recorded, never stalled on.

**The ledger for this plan is `docs/DISTINCT_FIT_PROGRESS.md`** — a new file, created from
the session map below on first use. `docs/OVERHAUL_PROGRESS.md` is closed; do not append
to it. The session-launch prompt is `docs/DISTINCT_FIT_SESSION_PROMPT.md`.

Additional invariants specific to this plan:

- **P0.1 — One chokepoint.** After phase D0 there is exactly ONE function pair that
  computes personality fit percent: `personalityFitPercent(userValues, careerValues)` in
  `assets/js/shared/onet-math.js` and `functions/_lib/onet/math.js`. No call site
  computes `cosinePercent(cosine(personality, …))` directly ever again. Any future fit
  change is a change to the chokepoint's internals.
- **P0.2 — Client/server parity, same commit.** The chokepoint, the baseline constant,
  `FIT_MATH_VERSION`, and the flag land in both math files in the same commit, byte-for-
  byte equivalent in behavior, verified by the parity section of `npm run test:vectors`.
- **P0.3 — Versioned outputs.** Any stored artifact containing a computed fit percent
  (KV career rank, KV stretch fits, portal snapshot, anything the D0 census finds) must
  carry `FIT_MATH_VERSION` in its key or its stored payload. Unversioned fit output in a
  cache is a failed run.
- **P0.4 — The existing `cosine()` is frozen.** It is used by career↔career similarity,
  the ETL rep-weighting, the LOD spread gate, and the objective path. It does not change,
  in either math file. Distinctive fit is a NEW code path that composes it.
- **P0.5 — No user-data migration.** Fit is computed, never stored on the user object.
  User vectors, seeds, hydration, `PERSONALITY_SEED_GEN`, KEY_MAP: all untouched. If a
  slice finds itself editing hydration or seed code, the slice is out of scope — stop.
- **P0.6 — Rollback stays one commit.** Until D4, `DISTINCT_FIT_ENABLED` (a plain
  constant in both math files, inside the chokepoint) can be flipped false + busters
  bumped to restore legacy scoring exactly. No other file may branch on the flag.

### Decisions already made — do not relitigate

These were settled by measurement on 2026-07-21 (probe results in Part 2):

1. **The fit variant is masked distinctive** ("variant D"): subtract the baseline from
   both sides, correlate over only the dimensions where the user vector is nonzero, with
   an unmasked fallback below `MASK_MIN_DIMS = 24` signal dims.
2. **The baseline is the mean of the 18 zone centroids** (`zone-centroids.json`), the
   same quantity fix 1.3's seed already uses (`zoneBaselineVector`). The all-782-career
   mean was measured at correlation 0.9969 with it — immaterial difference, and sharing
   the seed's concept keeps one mental model.
3. **The baseline ships as a generated literal** (`LV_BASELINE`, 161 floats, 2-decimal)
   embedded in both math files between `@generated` markers by a script, with a parity
   gate proving embedded == artifact == mean(centroids). No runtime fetch, no load-order
   dependency, no missing-artifact state.
4. **Display mapping stays `max(0, round(100 × corr))`.** No synthetic curve. The tier
   ladder is recalibrated instead (D1 locks final values; first cut in Part 2).
5. **Objective fit does not change.** It is a sparse evidence vector built from zero;
   subtracting a 0–100 baseline from it is meaningless. `objectiveFitPercent`,
   preparedness, gap vectors, roadmap vector gating: untouched.
6. **Career↔career math does not change.** Similarity artifacts, hub links/layout,
   `pivot-analysis.js:51` transferPct, ETL rep-weighting: untouched (deferred list, D4).
7. **`projectSectorScoresFromPersonality` switches to the chokepoint** in D2, with a
   round-trip guard (see census row) — the sheet should mean "distinctively like this
   sector," matching the portal bars.
8. **The sector-fit-sheet's bar colors get a frozen local copy of today's ladder.**
   Sheet scores are quiz-answer strengths, not cosines; they must not silently recolor
   when FIT_TIERS recalibrates (census row, `sector-fit-sheet.js:72`).

---

## Part 1 — The math

### 1.1 What today's fit is, and why it has a ceiling

`cosine()` (`assets/js/shared/onet-math.js:37`, `functions/_lib/onet/math.js:32`) is a
mean-centered cosine: each vector has its own mean subtracted, then the deviations are
correlated. This was the right fix for its era — raw cosine between any two O*NET
vectors reads 0.70–0.85 because they share a huge common profile, and centering strips
each vector's *level*.

What centering-by-own-mean cannot strip is a *pattern* shared across the population.
Every desk occupation is high on Reading Comprehension, Active Listening, Speaking,
Critical Thinking and low on Static Strength and Wrist-Finger Speed. That is not a level
difference; it is a shape they all share. Measured at HEAD on the weighted display-zone
centroids: **the nine desk zones correlate 0.75–0.95 with each other (mean 0.88)**;
only Trades stands apart (0.34–0.56). A user who resembles one desk zone therefore
scores high against all nine — which is why fix 1.3's harness had to cap the finance
persona's home-zone margin at 10 and route three personas' "opposite" assertions
through trades.

The same common mode quietly broke the tier ladder. `FIT_TIERS`
(`assets/js/shared/onet-math.js:180`) was calibrated before fix 1.3 ("top real matches
~58–66, so mythic is genuinely rare"). Fix 1.3 sharpened decided users' vectors, which
raised their absolute correlation with the entire desk catalog. Measured today: **a
decided finance persona has 446 of 782 careers at mythic (≥66) and 562 at legendary**.
The ladder's premise — mythic is rare — is currently false for exactly the decided
users the product is for.

### 1.2 The new quantity

Let `b` be the per-dimension mean across the 18 zone centroids (the "generic
occupation"). Distinctive fit correlates the *residuals*:

    distinctive(u, v) = corr(u − b, v − b)        restricted to dims where u ≠ 0

- Subtracting `b` from the career says: score what this career demands *unusually much
  or little of*, compared to work in general.
- Subtracting `b` from the user says the same about the person.
- **The mask** (user-nonzero dims only) exists because a zeroed user dim means "no
  signal" (fix 1.3's seed zeroes the no-signal band; confidence = 'estimated'). Unmasked
  subtraction would turn every unknown into `−b_i` — a strong claim that the user is
  *anti-generic* on dimensions we know nothing about. Measured, the mask is worth 3–8
  fit points on every persona's own-cluster mean and costs nothing in separation.
- **Mask floor:** below 24 nonzero dims (real profiles measure 48–139), fall back to the
  unmasked form. Guards degenerate/legacy vectors; never triggers for a completed quiz.

Implementation note: because `cosine()` already centers each argument,
`cosine(u − b, v − b)` *is* the residual correlation — the chokepoint subtracts and
masks, then calls the frozen `cosine()`. No second math implementation exists.

This is **not a monotone rescale**. Rankings change — that is the point — which is why
this plan has a calibration phase, a cache-versioning invariant, and a visual QA phase
rather than a constant-swap commit.

---

## Part 2 — Measured evidence (2026-07-21, HEAD `2724e2b`)

Probe: real hydration code (`hydrateQuizVectors` against live artifacts), 6 personas
(the 4 committed in `scripts/test-vectors.cjs` plus tech and education), 782 careers,
zone fits against the lvMeanW display fold. Variants measured: A = current; B =
distinctive unmasked; B7 = B with all-782 baseline; C = career-side-only subtraction;
D = masked distinctive. B7 ≈ B everywhere (baseline choice immaterial); C separates
zones less than B/D; **D dominates**: best own-cluster scores of the distinctive
variants with B-level zone separation.

**Variant D vs current (A), per persona** (own = mean fit of the persona's expected
careers; margin = home zone score − median zone score; zero% = share of catalog
displaying 0):

| Persona | own A→D | home margin A→D | zone rank | zero% A→D |
|---|---|---|---|---|
| quant-finance | 89 → 71 | 10 → **57** | 1 → 1 | 3 → 49 |
| healthcare | 67 → 53 | 23 → **68** | 1 → 1 | 3 → 51 |
| creative | 68 → 43 | 17 → **69** | 1 → 1 | 3 → 59 |
| trades | 58 → 83 | 60 → **92** | 1 → 1 | 71 → 57 |
| tech | 77 → 69 | 28 → **80** | 1 → 1 | 3 → 60 |
| education | 79 → 64 | 17 → **72** | 1 → 1 | 3 → 47 |

**Desk-vs-desk separation under D** (the thing A structurally cannot do — under A the
finance persona reads tech=77, education=74):

| Persona | own cluster | worst other desk cluster | gap |
|---|---|---|---|
| quant-finance | 71 | tech 35 | 36 |
| tech | 69 | finance 25 | 44 |
| education | 64 | healthcare 22 | 42 |
| healthcare | 53 | education 19 | 34 |
| creative | 43 | education 16 | 27 |

- Desk-zone centroid cross-correlation: **0.88 mean → 0.05 mean** (range −0.80..0.71).
- Top-10 sanity: finance persona's top-10 under D is the same accountant/analyst/risk
  cluster as under A, minus generic "Project Management"-adjacent inflation creeping up;
  tech persona's top-10 pulls in Data Scientists and Penetration Testers above Database
  Administrators. Order changes are improvements, not chaos.
- Costs, stated honestly: absolute numbers shrink (a top match reads 60–90 by persona,
  a median career reads ~0–4), and roughly half the catalog displays 0%. That is what
  "distinctively like you" means — the ladder recalibration and D3's copy/visual QA
  absorb it deliberately rather than accidentally.

**First-cut ladder** (D1 finalizes against occupancy targets): mythic 60, legendary 45,
epic 30, rare 15, uncommon 5. Occupancy targets, per decided persona: mythic ≤ 3% of
catalog, legendary ≤ 8%, epic ≤ 20%. (Today: mythic = 57%.)

---

## Part 3 — Consumer census (verified file:line at `2724e2b`)

Every touchpoint, with its treatment. "Chokepoint" = migrate to
`personalityFitPercent` in D0, behavior unchanged until D2.

**Personality-fit computations (→ chokepoint, D0):**

| Site | What it is |
|---|---|
| `assets/js/shared/onet-vectors.js:805` | `fitForSlugOrSoc` personality component |
| `assets/js/shared/onet-vectors.js:1151` | blended-vector fit (personalize path) |
| `assets/js/shared/onet-vectors.js:1417` | `stretchFitCandidates` personality side |
| `assets/js/shared/onet-vectors.js:1876` | ranked-careers personality fit |
| `assets/js/shared/hub-zone-fit.js:~104` | `computeZoneFitsMap` personality vs zone centroid |
| `assets/js/hub/hub-onet-map.js:~867` | fallback zone-fit pass (and its lvMeanW read) |
| `assets/js/hub/career-personalize.js`, `career-compare.js`, `assets/js/app/portal-target-switch.js` | per-file cosine call sites (grep `cosinePercent\|cosine(` in each during D0) |
| `functions/vector-fit.js:83` | server fit endpoint personality component |
| `functions/_lib/onet/career-rank.js:99` | KV ranker personality component |
| `functions/_lib/onet/user-vectors.js:156` | `projectSectorScoresFromPersonality` — switches in **D2** (decision 7) with a round-trip guard: `test:vectors` asserts seeding from the projected scores keeps the persona's home zone #1 |

**Thresholds and defaults (recalibrate, D2):**

| Site | Issue |
|---|---|
| `assets/js/shared/onet-math.js:180` | `FIT_TIERS` — new values from D1 |
| `assets/js/hub/marco.js:58,70,82,92` | hardcoded `>= 56` — route through `FIT_TIERS.legendary` in **D0** (drift bug independent of this plan) |
| `assets/js/hub/hub-canvas.js:1265` | hardcoded `>= 56` — same D0 fix |
| `assets/js/shared/career-target.js:145,234,274`; `portal-target-switch.js:232`; `roadmap.js:151-152` | `fitRarity(50)` as "unknown fit" placeholder — 50 under the new ladder is legendary; replace with named `FIT_NEUTRAL` constant in **D0**, value re-picked in D1 |
| `assets/js/shared/onet-vectors.js:1261-1270` | stretch criteria (`objectiveFit >= 52`, objective-vs-personality gap) — personality median drops to ~0, so the gap condition fires far more; recalibrate in D1/D2 |
| `assets/js/shared/onet-vectors.js:1440-1449` | `tradeOffLabel` `>= 50` / ±30 gap — recalibrate in D1/D2 |
| `assets/js/shared/sector-fit-sheet.js:72` | colors quiz-answer scores through `fitRarity` — freeze a local copy of today's ladder (decision 8) in D2 |
| `assets/js/hub/hub-dashboard.js` (highFit), `assets/js/quiz/quiz-app.js` (qzTierFor) | read the shared ladder — verify no local numbers during D0 census |

**Versioned outputs (P0.3):**

| Store | Treatment |
|---|---|
| `functions/_lib/onet/career-rank.js:43` `KV_PREFIX = 'career-rank:v1'` | bump to `:v2` at D2 flip (30-day TTL reaps orphans) |
| `functions/stretch-fits.js` KV cache | same pattern — version the prefix at D2 |
| `assets/js/shared/auth.js:584` `portalSnapshotIsStale` | D0 census slice: determine whether the snapshot stores computed fit numbers; if yes, salt its staleness input with `FIT_MATH_VERSION` — do NOT change the upload-dedupe semantics of `quizPayloadHash` beyond that |
| client `rankedCache` (onet-vectors) | in-memory per page load — no action |

**Explicitly untouched (P0.4/0.5, with the reason):** `cosine()` itself;
`objectiveFitPercent` and every objective-side consumer (`functions/vector-fit.js:86`,
`roadmap-vector-fit.js:42`, preparedness, gap vectors); `pivot-analysis.js:51`
career↔career transferPct; similarity artifacts and hub links/layout
(`hub-onet-map.js:~1844`); ETL rep-weighting (`scripts/onet-etl/zone-weighting.mjs`);
seed/hydration/`PERSONALITY_SEED_GEN` (`onet-vectors.js:528-551,936`);
`scripts/verify-hub-lod.mjs:211` `verifyGlobalCosineSpread` (guards artifact quality via
the frozen cosine — still valid).

---

## Part 4 — Execution phases

Phases are units of WORK, not sessions — sessions bundle them per the session map at
the end of this document (D0+D1 share one session; D2 carries an immediate post-flip
spot-check; D3's full sweep and D4 share the soak-gated final session). One commit per
slice; gates before every commit (`npm run gates:unit` is the floor; `test:vectors`
after anything in this plan).

### D0 — Dark infrastructure (no behavior change)

1. **Baseline generator.** `scripts/onet-etl/build-fit-baseline.mjs`
   (`npm run onet:baseline`): computes mean of `zone-centroids.json`, writes
   `data/onet/artifacts/fit-baseline.json`, and rewrites the `LV_BASELINE` literal
   between `@generated fit-baseline` markers in BOTH math files, idempotently.
   `test:vectors` gains a parity assertion: embedded (client) == embedded (server) ==
   artifact == recomputed mean, within 1e-3. `hub:verify` fails if the artifact is
   stale relative to the centroids (mirror the `onet:zoneweights --check` pattern).
2. **Chokepoint.** `personalityFitPercent(u, v)` + `distinctiveCosine(u, v)` +
   `FIT_MATH_VERSION = 1` + `DISTINCT_FIT_ENABLED = false` + `MASK_MIN_DIMS = 24` in
   both math files. Flag false ⇒ chokepoint returns exactly
   `cosinePercent(cosine(u, v))`; `test:vectors` asserts equality against the legacy
   expression on fixture vectors.
3. **Call-site migration.** Every row of the census's first table (except
   `user-vectors.js:156`, which waits for D2) moves to the chokepoint. Zero output
   change — the persona harness numbers must be byte-identical before/after this slice.
4. **Drift fixes that stand alone:** marco.js/hub-canvas.js hardcoded 56s →
   `FIT_TIERS.legendary`; `fitRarity(50)` placeholders → `FIT_NEUTRAL` (value 50 for
   now).
5. **Cache census execution:** resolve the snapshot question (census table); grep
   `functions/` for any other stored fit numbers; record findings in the ledger.
6. Busters on every touched asset, every referencing page. Gates. Push. Live verify.

### D1 — Calibration (offline; no flip)

1. **Productionize the probe** as `scripts/fit-calibrate.mjs` (committed tooling, reads
   the real modules the way `test-vectors.cjs` does). Add the tech and education
   personas to `scripts/test-vectors.cjs` (6 total; education's `25-2052.00` doesn't
   resolve — probe note — pick a live SOC).
2. **Lock final numbers** against the occupancy targets in Part 2: FIT_TIERS,
   FIT_NEUTRAL, stretch criteria, tradeOffLabel thresholds, and the harness v2
   assertion values (Part 6). Record every final constant in the ledger — the D2
   session copies from the ledger, it does not re-derive.
3. No app-code commit beyond the tooling and fixtures.

### D2 — The flip (one commit for the behavior change)

1. `DISTINCT_FIT_ENABLED = true` + `FIT_MATH_VERSION = 2`, both math files, same
   commit, with: new FIT_TIERS + FIT_NEUTRAL; stretch + tradeOff recalibration;
   sector-sheet frozen ladder; `projectSectorScoresFromPersonality` → chokepoint with
   the round-trip guard; `fitContributions` (`onet-math.js:~110`) re-ranked on masked
   residual products so "why this match" explains the displayed score (drivers keep
   displaying raw user/career levels); KV prefixes bumped (`career-rank:v2`,
   stretch-fits equivalent).
2. Harness v2 in the same commit: the six-persona suite asserts the Part 6 criteria.
   The old absolute assertions (own ≥ 55 etc.) are replaced by the D1-locked values —
   deliberately, in one place, recorded in the ledger.
3. Busters on all touched assets (this is the visible commit — expect onet-math,
   onet-vectors, hub-zone-fit, hub-onet-map, marco, hub-canvas, career-target,
   sector-fit-sheet, quiz-app, hub-dashboard and their referencing pages).
4. Gates, push, live verify: curl the busted URLs sha-identical; `pages:smoke`,
   `hub:smoke` green.

### D3 — Surface QA + soak

1. Screenshot-harness sweeps with persona localStorage: hub map (orb color spread —
   the map should show a selective gold cluster, not a sea of uniform gold), portal
   sector bars, career page fit card + tradeoff label, quiz results tiers, Marco
   target chip. One copy tweak is in scope if the 0% floor reads as broken in situ;
   anything larger goes to the ledger as a follow-up, not into this phase.
2. `gates` (full), live smokes, ledger + handoff addendum.

### D4 — Cleanup + deferred list

1. Remove `DISTINCT_FIT_ENABLED` and the legacy branch from the chokepoint (flag has
   soaked; rollback window closes). Busters.
2. Record the deferred items as closed-or-ticketed in the ledger: distinctive
   career↔career similarity (links/layout/pivot transferPct), objective-side
   distinctiveness, any D3 copy follow-up.

---

## Part 5 — Risks

- **Sea of zeros (product feel).** ~50% of the catalog reads 0% for a decided user.
  Mitigation: ladder recalibration makes tiers meaningful again; D3 QA owns the visual
  check; copy tweak pre-authorized. The trades persona already ships 71% zeros today —
  the app survives it.
- **Blend imbalance.** `overallFitScore` (0.75p + 0.25o) now mixes a shrunken p with an
  unchanged o; for weak-p careers overall ≈ 0.25o ≤ ~15 — absorbed by the ladder. Watch
  the stretch panel in D3 (its whole premise is o ≫ p).
- **Mixed-math window during deploy.** CF Pages flips POP-by-POP; a client on the new
  asset can hit a function on the old build. Exposure is one page-load of inconsistent
  numbers; KV writes are version-keyed so nothing wrong is cached. Accept; do not
  engineer around it.
- **Fixture breakage.** `test:vectors` stretch/synthetic fixtures assume current-scale
  personality fits; D2 re-derives them alongside the harness swap (they are inputs to
  assertions, not user data).
- **The mask is new semantics.** Fit now improves/changes when a user opens new dims
  (sharpen/resume). That is correct behavior (more signal → better estimate) but it
  means fit can move without any career changing — the KV fingerprint already keys on
  the full vector, so caches follow automatically. State it in the D2 commit message.
- **Rollback:** flip `DISTINCT_FIT_ENABLED` false + revert FIT_TIERS block + bump
  busters, one commit. KV v2 entries orphan harmlessly (TTL). Do not revert D0.

## Part 6 — Acceptance criteria (all six personas, committed harness)

Values are D1-locked; measured room shown from the probe:

1. Home zone ranks #1 with margin over median zone ≥ 15 (measured 57–92).
2. Own-cluster mean ≥ 40 (measured 43–83).
3. Every OTHER persona's cluster ≤ own − 20 (measured gaps 27–44) — including
   desk-vs-desk, which the old harness could not assert at all.
4. Trades persona: own ≥ 55 and every desk cluster ≤ 10 (measured 83 / ≤ 7).
5. Mythic occupancy ≤ 3% of catalog per persona; legendary ≤ 8% (today: 57% / 72% for
   finance — the headline defect this plan kills).
6. Re-hydration byte-identical (unchanged invariant; fit is read-only).
7. Full `gates` stays within its current runtime envelope (~56s unit tier).

## Session map

Three sessions. Per-session Opus thinking level is part of the contract — the levels
are calibrated to each session's dominant failure mode, not its size.

**Session 1 — phases D0 + D1 (dark infra + calibration lock). Thinking: Ultrathink.**
Both phases are zero-behavior-change and share all context; splitting them buys only
duplicated session overhead. Ultrathink rather than High because the migration is wide
and the gates do NOT cover every migrated path — `career-compare.js`,
`career-personalize.js` and `portal-target-switch.js` have no numeric assertions, so a
botched chokepoint migration there survives every gate and ships a silently wrong
number; the model's own carefulness IS the coverage on those files.
Exit: all gates green; persona harness byte-identical pre/post migration; baseline
parity gate green; every D1 constant recorded in the ledger; pushed + live-verified.

    === SESSION SCOPE ===  Distinctive fit session 1 = phases D0+D1 (docs/DISTINCT_FIT_MASTERPLAN_2026-07-21.md): baseline generator + chokepoint (flag OFF) + call-site migration + standalone drift fixes + cache census, then fit-calibrate tooling + 6-persona fixtures + lock all final constants in the ledger. Zero behavior change; persona harness numbers byte-identical. No flip.  === END SESSION SCOPE ===

**Session 2 — phase D2 (the flip) + immediate spot-check. Thinking: Ultracode.**
The one genuinely hazardous session: it rewrites the very assertions that judge it
(harness v2 replaces the old absolute numbers), recalibrates thresholds across ~10
files, and the classic failure mode is quietly tuning the tests to bless a wrong
result. Maximum thinking is bought for exactly this. Exit: flip live-verified (busted
URLs sha-identical, `pages:smoke`/`hub:smoke` green), harness v2 green against Part 6,
KV prefixes bumped, and a hub + portal screenshot spot-check with 2 personas BEFORE
ending the session — never leave a flipped scoring system unlooked-at.

    === SESSION SCOPE ===  Distinctive fit session 2 = phase D2: the flip commit per the masterplan, constants copied from the D1 ledger entry (do not re-derive), harness v2, cache prefix bumps, busters, live verify, then a hub+portal screenshot spot-check with 2 personas before session end.  === END SESSION SCOPE ===

**Session 3 — phase D3 remainder + D4, after a soak of days. Thinking: High.**
Perception-heavy QA plus mechanical flag removal; deep reasoning adds little. Runs
only after real soak time — D4's flag deletion closes the one-commit rollback window.
Exit: full persona sweep across the five surfaces, any pre-authorized copy tweak,
flag + legacy branch removed, deferred list closed, ledger + handoff final.

    === SESSION SCOPE ===  Distinctive fit session 3 = D3 remainder + D4 (run only after several days of soak): full persona screenshot QA across hub/portal/career/quiz/Marco, pre-authorized copy tweak if the 0% floor reads broken, remove DISTINCT_FIT_ENABLED and the legacy branch, close the deferred list, final ledger + handoff.  === END SESSION SCOPE ===
