# AI-Derived "Fragment" Careers — Implementation Plan

Scoped 2026-07-03 for a future session (Jacob_Work). Not started — no code written yet.

## Goal

Extend the existing AI-derived careers feature (currently a manual, build-time
generator — see `scripts/derive-career.mjs` and `data/onet/artifacts/derived-careers.json`)
into a runtime feature: real O*NET careers can spawn "fragment" derived
careers on demand, shown as a scrollable strip off the base career's hub
drawer/detail-panel — mirroring how the legacy hub UI (main branch) presented
fragmented careers off a main orb.

## Trigger points (generate on-demand, cache result)

| Trigger | Where | Guard |
|---|---|---|
| Deep dive on a real O*NET career | `career-analysis.js` / `career.html` boot | only if `!career.aiDerived` |
| Target career selection | `career-focus.js` / `recordCareerFocus` | only if base is O*NET, not derived |
| User mentions an unlisted title | `chat.js`, `career-switch-chat.js`, `career-roadmap.js` (wherever Gemini extracts a career name) | fuzzy-match `derived-careers.json` first (reuse instead of regenerating); else fuzzy-match O*NET catalog as base |

**Non-goal, explicit:** interacting with an already-derived career (viewing,
chatting, targeting) never spawns another derived career. Check `aiDerived`
before any generation call, full stop.

## Generation path (runtime, not build-time)

- New server fn `functions/derive-career.js` — promote the logic already in
  `scripts/derive-career.mjs` (Gemini JSON-mode adjustment call + apply/clamp)
  server-side.
- Synchronous on first request (recommended — this is rare/low-QPS) vs.
  optimistic UI + background `waitUntil` fill: pick one before starting.
- Storage: today's static-file sidecar (`derived-careers.json`) can't be
  written at request time on Pages. Needs KV or a new D1 table
  `derived_careers`, merged into `store.getCareers()` / `/onet/vectors` the
  same way the static file is merged today — just backed by KV/D1 instead of
  a file read.
  - **Recommended: D1**, because the fragment-drawer UI needs a reverse
    lookup (`WHERE derived_from_soc = ?`), which D1 supports cleanly and KV
    does not (KV would need a hand-rolled index).
- Base-career selection for a mentioned/unlisted title: reuse
  `proposeOnetCareersForMessage` (existing fuzzy O*NET search) to pick the
  adjacent base automatically.

## Fragment UI (base-career drawer)

- The base O*NET career's `detail-panel` / `hub-drawer.js` panel gets a new
  scrollable strip of fragment chips: derived careers whose
  `derivedFrom.soc === this.soc`.
- Each chip: small orb/avatar + title + "AI-derived" micro-badge; click opens
  that derived career's own detail-panel (or navigates to its deep dive).
- Needs a `getFragmentsForSoc(soc)` lookup (reverse index of `derivedFrom.soc`)
  — cheap once derived careers live in KV/D1 with an index.
- **Must-check-first item:** confirm against the actual main-branch legacy
  drawer markup before styling — not verified pixel-for-pixel in this plan
  (main branch wasn't checked out when this was scoped).

## Open decisions (resolve before/at implementation)

1. Storage: KV vs. D1 (plan recommends D1 — see reverse-lookup need above).
2. Rate/abuse limits on runtime generation — a chat message can trivially
   name many fake careers in a row; needs a cap per user/session.
3. Whether fragments are per-user or global. Recommend **global** — first
   user "discovers" a fragment, it's cached/shared for everyone after that,
   cheaper than per-user generation.

## Verification when built

Same suite as the rest of the O*NET pipeline: `npm run hub:verify`,
`npm run test:vectors`, `npm run verify:aliases`, `node --check` on touched
files, plus `npm run pages:smoke` (added 2026-07-03 — see handoff "Hub boot
hotfix" addendum) since this touches live page boot paths.
