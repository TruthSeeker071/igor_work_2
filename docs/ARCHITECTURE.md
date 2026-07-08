# FlightWay architecture

Static multi-page app on Cloudflare Pages with five Functions and one KV namespace.

## Entry points

| File | Role |
|------|------|
| `index.html` | Marketing landing (`fw-*`) |
| `dashboard.html` | Career Hub canvas map |
| `portal.html` | Signed-in home (action cards, profile snapshot) |
| `roadmap.html` | Career roadmap + focus tracker (`?focus=1`) |
| `coach.html` | Marco AI career advisor |
| `profile-build.html` | Profile-building wizard |
| `quiz.html` | Career quiz flow |
| `auth.html` | Sign in, register, forgot/reset password |
| `career.html` | Career deep dives (`?slug=`) |
| `Flightway.html` | Legacy hash redirect shim (`#portal` → `portal.html`, etc.) |

## Asset layout

```
assets/
  css/          flightway-theme.css, flightway-pages.css, hub-dashboard.css
  js/
    boot/       theme-boot.js (FOUC preventer, blocking in <head>)
    shared/     theme, brand, app-nav, auth-pages, page-boot, data-field, flags
    landing/    reveal.js, landing.js, auth-cta.js
    app/        portal.js, roadmap.js, roadmap-tree.js, skill-gap-tracker.js, app-pages.js
    quiz/       quiz-data.js, quiz-app.js
    coach/      coach.js
    profile/    profile-building.js
    hub/        hub-careers.js, hub-dashboard.js, marco.js, career-personalize.js
  data/         industries.json, salary-tiers.json (+ schema/)
```

## Cross-page state

- **localStorage** — `fw_hub_quiz_v1`, `fw_roadmap_v1` (same origin)
- **sessionStorage** — `fw_marco_starter`, `fw_roadmap_pending_career`
- **Auth** — HTTP-only cookies via `/account`; `FWPageBoot.requireAuth()` gates protected pages

## Objective vector (resume)

1. **Sector-themed rules** — `RESUME_THEME_RULES` in `academics-map.js` match keywords → hub zones (`tech`, `finance`, …).
2. **Sparse profiles** — `data/onet/artifacts/zone-dimension-profiles.json` (ETL from zone centroids + `zone-dimension-profile-overrides.json`) lists top O*NET dimension indices per zone; rules bump only those indices, not whole domain slabs.
3. **Gemini patch** — `patchObjectiveFromResume` fine-tunes 10–18 specific dimensions after rules run.

1. **Quiz** — `quiz-data.js` defines `QZ_IND`; engine scores answers → `fw_hub_quiz_v1` in localStorage.
2. **Career Hub** — `hub-careers.js` maps 40 careers to industry keys; reads URL `#r=` or localStorage.
3. **Coach** — `coach.js` uses `/account`, `/chat`, `/dossier`; dossier seeded via `functions/_lib.buildSeedDossier()`.

## Edge API

`functions/_lib.js` centralizes CORS, KV (`COACH_KV`), and dossier format. Feature handlers import shared helpers only.

## Feature flags

`assets/js/shared/flags.js` sets `window.__FW_FLAGS` from URL params (`?fw_debug_quiz=1`, etc.).

## Deploy

- `main` → `flightway` (production)
- `Jacob_Work` → `flightway-prototype`

See [SETUP.md](SETUP.md).

## Career Tester

`simulation.html` — tiered career simulations (see `docs/CAREER_TESTER.md`). Engine `assets/js/sim/sim-engine.js`, data `assets/data/simulations/flights.json`, functions `sim-colleague/feedback/mirror/generate`, personas server-side in `functions/_lib/sim-secrets.js`.
