# AI-Exposure Score — method

The AI-Exposure Score on each career page is a **self-assessment planning aid, not
a prediction** about your job, your employer, or anyone's employment. It exists to
help you plan toward durable skills — "don't compete with AI, out-plan it."

## How it's computed
Every O*NET occupation is described by 41 standardized **work activities** (e.g.
"Processing Information", "Assisting and Caring for Others"), each with a level of
how central it is to the job. We pair each work activity with an **editorial
exposure weight** from 0 (durable / human-anchored) to 1 (highly automatable by
today's AI), authored by us and kept reviewable in
`scripts/onet-etl/ai-exposure-weights.json`.

For a career we compute an importance-weighted average of those weights:

```
rawExposure = 100 · Σ(level · exposure) / Σ(level)   over the career's work activities
```

Because raw exposure clusters in a narrow band (most jobs do a broad mix of
activities), the **displayed 0–100 score is the percentile rank** of that raw
value across all careers — i.e. "more AI-exposed than N% of the careers we map."
The absolute `rawExposure` is kept in the data for transparency.

- **What AI is starting to do** = the career's activities ranked by `level · exposure`.
- **What stays human** = the same activities ranked by `level · (1 − exposure)`.

## Weighting principles
- Routine cognitive and information work (processing/analyzing information,
  documenting, administration, scheduling) scores **high**.
- Interpersonal care, relationship-building, negotiation, motivation, and
  accountable judgment score **low / durable**.
- Physical work in unstructured settings scores **low**, since robotics is slower
  and costlier to deploy than software AI (this may shift over time).

Weights draw on the public task-exposure literature (Frey & Osborne 2017;
Eloundou et al. 2023, "GPTs are GPTs"; Brynjolfsson/Mitchell/Rock SML; OECD 2023).
They are estimates, reasonable people will disagree at the margins, and they are
versioned so we can revise them — edit the weights file and rerun
`npm run onet:exposure`.

## What this is not
It is **not** a forecast of layoffs, hiring, wages, or your individual prospects.
Careers are reshaped by AI as much as replaced by it, and the "what stays human"
column is the point: it's where to aim your plan.
