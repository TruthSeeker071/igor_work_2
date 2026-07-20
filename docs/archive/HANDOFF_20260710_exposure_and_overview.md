# Handoff: AI Exposure Rename & Overview Card Refill

**Status:** ✅ Complete and live (commit `5787be3`, deployed to flightwayjacobprototype.pages.dev)

## What changed

Three improvements to the deep-dive career page:

### 1. "AI Automation Risk" → "AI Exposure" with synced metric tile
- **Why:** User wanted the metric tile and "How AI hits this career" section to show the same number, not independent estimates.
- **How it works:**
  - `ai-exposure.js:70` — `inject()` now returns a Promise that resolves with the computed 0–100 score
  - `career-personalize.js:22` — added `state.exposureScore` field
  - `career-personalize.js:686–698` — `hydrateUserOnetMatch()` captures the resolved score and calls `syncAiRisk()` to update the metric tile once "How AI hits this career" data loads
  - `career-personalize.js:1130–1134` — `applyAnalysis()` now prefers `state.exposureScore` over the Gemini `analysis.aiReplacement.percent` estimate when available
  - `app-pages.js:217` — metric tile label changed to "AI Exposure", scale labels to "Lower exposure" / "Higher exposure"
- **Fallback:** If the career's SOC isn't in `ai-exposure.json` (rare), the Gemini estimate is used; no breakage.

### 2. Removed empty space under "What you'll actually do"
- **Why:** O*NET descriptions are short; a separate "Core responsibilities" section 300px down left a gaping hole next to the taller "Quick facts" sidebar.
- **How it works:**
  - `app-pages.js:219` — moved responsibilities list into the overview card itself, below the description, in a new `<div class="overview-resp" data-career-personal-resp hidden>`
  - Removed the old standalone `<section class="career-resp-section">` (was line 223)
  - `career-personalize.js:755, 1108` — both places that unhide responsibilities now target `[data-career-personal-resp]` and use `.hidden` property
  - `flightway-pages.css:365` — added `.overview-resp { margin-top: 8px; padding-top: 20px; border-top: 1px solid var(--border-light); }` to separate visually while staying in-card
- **Result:** Layout is more compact; the 1.2fr/0.8fr grid doesn't have a visible gap anymore.

## Files changed

- `assets/js/app/app-pages.js` — metric label + scale, responsibilities DOM structure
- `assets/css/flightway-pages.css` — border-top divider for inline responsibilities
- `assets/js/hub/ai-exposure.js` — return score from `inject()` for metric sync
- `assets/js/hub/career-personalize.js` — wire exposure score, update responsibilities selector, prefer O*NET over Gemini estimate

Cache-buster updates (all pages referencing changed assets):
- `?v=20260710u` — `flightway-pages.css` (8 pages)
- `?v=20260710t` — `app-pages.js` (career.html)
- `?v=20260710p` — `ai-exposure.js` (career.html)
- `?v=20260710u` — `career-personalize.js` (career.html)

## Verification

**Live checks (all passed):**
- `curl` confirms `AI Exposure` label in deployed `app-pages.js`
- `state.exposureScore` wiring present in `career-personalize.js`
- Old `career-resp-section` selector removed
- New `overview-resp` selector live

**Manual repro:** Built isolated test card confirming "Core responsibilities" fits inline without breaking layout.

## No downstream impact

- No changes to data pipelines, auth, or quiz state
- No API changes
- No new dependencies
- Existing fallbacks (Gemini estimate when SOC not in `ai-exposure.json`) keep careers without O*NET data stable

## Next steps (if any)

None — this work is complete and live. If a new career page feature needs the exposure score, it's now available as `state.exposureScore` in `career-personalize.js`.
