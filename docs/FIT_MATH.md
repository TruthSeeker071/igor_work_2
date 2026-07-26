# How FlightWay scores fit

Current as of 2026-07-21. This is the single reference for what the fit numbers
mean, what they cost, and what is measured rather than assumed. Code lives in
`assets/js/shared/onet-math.js` and `functions/_lib/onet/math.js` — one pair,
kept byte-identical in behaviour by the parity section of `npm run test:vectors`.

## The two chokepoints

```
personalityFitPercent(personality, career) = cosinePercent(cosine(p, career))
displayFitPercent(personality, career)     = personalityFitPercent(...)
```

`cosine()` is a **mean-centered** cosine (Pearson correlation): each vector has
its own mean subtracted before the dot product. Raw cosine between any two O*NET
vectors sits at 0.70–0.85 because occupations share an enormous common profile;
centering strips each vector's level so the correlation reflects shape.

**Every fit percent the product shows is personality fit** — sector clouds,
career orbs, career pages, quiz results, Marco. Objective fit is computed
alongside and displayed separately.

### Why objective fit is not folded into the number

It was, twice, and both were wrong in the same way:

- **0.75 × personality + 0.25 × objective.** Capped overall fit at 0.75 ×
  personality for anyone without resume evidence, putting the top display tier
  out of reach on every surface that showed it.
- **One correlation against the summed vector.** Fixed the ceiling, but still
  mixed the two.

The problem both shared is not arithmetic. *"Would I like this work"* and
*"am I ready for this work"* are different questions a user asks at different
moments, and averaging them produces a number that answers neither. Fit tells
you where you'd want to be; objective fit tells you how far you have to go.
Objective fit now lives where "how far" belongs: beside personality fit on the
career page, and driving preparedness, skill gaps and the stretch panel.

## What this formula does and does not do

**Does:** produce a legible spread across sectors. A decided quant-finance
profile reads business-finance 88 · tech 82 · education 81 · government 81 ·
engineering-science 79 · creative-media 78 · law 76 · social 71 · healthcare 70 ·
trades 27.

**Does not:** discriminate sharply between desk sectors — 88 versus 82 is a real
but narrow gap. This is structural to mean-centered cosine, which cannot separate
occupations that share the white-collar common mode.

A formula that could — baseline-subtracted ("distinctive") fit — shipped on
2026-07-21 (`9c5f125`) and was reverted the same day (`ee45570`). It separated
desk clusters cleanly (cross-cluster correlation 0.88 → 0.05) and was correct. It
was also unusable: it scores how *unusual* a match is, so a profile that is not
unusual scores near zero against everything. Full record in
`docs/DISTINCT_FIT_PROGRESS.md`. **Do not re-derive it from first principles.**

One further measurement worth keeping, from diagnosing that revert: feeding the
"generic occupation" profile (the mean of all 18 sector centroids — a person with
no distinguishing traits at all) through this formula scores 90+ against nine
sectors. The floor of a plain correlation is high, and quiz answers move the
sector ORDER far less than they move the individual career scores. If sector
numbers ever look flat again, that is the mechanism.

## Measured behaviour — six personas × 782 careers

Reproduce with `npm run fit:calibrate`; fixtures in
`scripts/fixtures/fit-personas.cjs`.

| persona | home zone | its score | best career | catalog mythic | legendary |
|---|---|---|---|---|---|
| quant-finance | business-finance | 88 | 91 | 5.4% | 27.4% |
| healthcare | healthcare | 71 | 73 | 0.0% | 0.0% |
| creative | creative-media | 76 | 78 | 0.0% | 1.5% |
| trades | trades | 60 | 66 | 0.0% | 0.0% |
| tech | tech | 79 | 81 | 0.0% | 3.5% |
| education | education | 84 | 86 | 0.4% | 9.5% |

## The tier ladder

    FIT_TIERS = { mythic: 85, legendary: 75, epic: 60, rare: 45, uncommon: 30 }
    FIT_NEUTRAL = 0

Set deliberately in 2026-07-21: gold above 85, amber above 75, purple above 60.

**Known consequence, measured not assumed:** these are absolute gates, and how
high a profile scores in absolute terms depends partly on how *typical* it is.
Under this ladder a quant-finance profile reaches gold; a healthcare or trades
profile tops out in the purple band. If that reads wrong later, the fix is
percentile tiers ("mythic = your own top 2%"), not different absolute numbers —
no set of absolute numbers is fair across profiles.

Consumers of the ladder: `career-target.js` `fitRarity`, `hub-canvas.js`
`rarityOf` (hot-path literal copy — keep in sync), `marco.js`, `quiz-app.js`
`qzTierFor`, `hub-dashboard.js`. `sector-fit-sheet.js` deliberately carries its
own frozen `SHEET_TIERS`: it colours quiz self-report strengths (0–100), not
correlations, and must not move when this ladder does.

## Versioning

`FIT_MATH_VERSION = 4` (1 = original cosine, 2 = distinctive, 3 = summed-vector,
4 = personality-only display).
Every stored fit percent carries it: KV `career-rank:v4`, `stretch:v4:`, and the
portal snapshot hash is salted with it. A cache written by one formula can never
be served under another.

## Degenerate vectors

`resolvePersonality` refuses to serve a stored personality vector with fewer than
12 nonzero dimensions and re-seeds from the quiz scores instead. A full-length
all-zero vector has a `values` array, so every "do we have a vector?" check used
to pass on it, and re-hydration reuses stored vectors — the state was absorbing.
Real profiles carry 48–152 nonzero dimensions.

---

## Live verification (2026-07-21, `4752206`)

`npm run gates` 35/35. Against `https://flightwayjacobprototype.pages.dev`, two
consecutive clean polls: `onet-math.js`, `onet-vectors.js`, `hub-canvas.js`,
`hub-onet-map.js` and `hub-zone-fit.js` all sha-identical to disk at
`v=20260721v`, the stamps present on every referencing page, and the rewritten
explainer copy served. `pages:smoke` 8/8, `hub:smoke` 2/2. The served
`onet-math.js` reads `FIT_MATH_VERSION = 4`, the 85/75/60/45/30 ladder, and
contains zero references to the deleted summed-vector functions; the served
`hub-canvas.js` mirror carries the same five gates.

Persona QA through the committed screenshot harness, reading the page's own
numbers back: quant-finance sectors 88 · 82 · 81 · 81 · 79 · 78 · 76 · 71 · 70 ·
27, and its home sector renders a genuine gradient — 32 mythic / 54 legendary /
24 epic / 4 rare / 1 uncommon across 115 careers, topped by Accountants and
Auditors at 91.
