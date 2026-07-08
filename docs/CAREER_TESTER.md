# Career Tester v3 — realistic career simulations

**Status:** v3 on `igor_work`, built against the `Jacob_Work` flagship (merged). Site-native design (theme tokens, Inter, light/dark). PRD item: *Career Tester v1 (H)*. History: v1 choice sims `a3bd60e`, v2 cockpit port `24c1d71`.

## The friction ladder (why v3 exists)

Team feedback (Slack 7/5): shallow MCQ sims read AI-written and overclaim; the open-ended version is better but too much friction. v3 answers with **progressive disclosure** — three altitudes per career:

| Tier | Time | What happens | Gate |
|---|---|---|---|
| **Quick look** | ~2 min | condensed brief + one real document + one spot-question + honest payoff. No writing. | 1-tap gut-feeling forecast |
| **Test flight** | ~10 min | all docs + colleague DM (6 msgs) + 2 warm-up MCQs + **2 core deliverables** + debrief w/ senior AI review | — |
| **Deep dive** | ~25 min | all deliverables, 12 DM msgs, Mirror credit | unlocks after a test flight |

The forecast-vs-reality **gap gauge** appears at every tier (the "aha"). Orientation is folded into the brief as a `<details>` disclosure. Autosave + resume everywhere. Completion of 2+ flights unlocks **the Mirror** (cross-career pattern readout).

## Where it's accessible

Hub orb drawer ("Try this career for 20 minutes →", live in both hub modes, wired via `resolveCareerPanelSlug`), `career.html` deep dive (CTA under Day-in-the-Life + footer row), portal quick-action card (`sim-portal-card.js`, injected without touching `portal.js`), and direct: `simulation.html?slug=<career>` / `?flight=<simId>`.

## Content at 700-career scale

7 authored sims (PM, forensic accountant, UXR, supply chain, SLP, SMM, urban planner) each now carry a `taxi` block + 2 authored warm-up interactions (taxi questions use a *secondary* insight; the big aha stays in the full sim). Slug aliases + catalog-title fuzzy matching route O*NET slugs to authored sims.

Everything else: `/sim-generate` — fixed-skeleton prompt (Jacob's format: 3 docs incl. data, reference-key glossary, 2 MCQs, 3 work sections) → **critic pass** with an anti-AI-voice rubric (banned words, strawman options, number consistency; one retry with the critic's notes; reject below 7/10) → KV `simv2:<slug>` with **90-day TTL** (Jacob's periodic-refresh requirement) → served globally to all users. `scripts/pregen-sims.mjs` pre-builds the top ~30 careers so most users never wait. Personas/answers stay server-side (KV `secrets` / `sim-secrets.js`).

## Telemetry for Leo's testing week

`localStorage.fw_sim_events_v1` (ring buffer, 300): `entry_view, forecast_set, tier_start, taxi_answer, taxi_complete, taxi_exit, tier_upgrade_click, chat_send, nudge, decode, submit, debrief_logged, feedback_ok/fail, mirror_run, generate_wait/fail, resume, save_exit`. Funnel of record: entry → forecast → taxi → upgrade → submit → debrief. History in `fw_sim_history_v2` (now with `tier`).

## Verification

`node scripts/…` harness: linkedom headless run covers alias routing, forecast gating, full taxi, flight (warm-ups, core-only sections, autosave), deep unlock, Mirror, generate-fail fallback, event log. `pages:smoke` includes `/simulation.html`. All sim/function files pass `node --check`.

## Next (not built)

Post-quiz results CTA (quiz-app.js is Jacob-active; do post-merge), D1 sync of history/events, feeding energizers/drainers into the O*NET personality vector, share cards.
