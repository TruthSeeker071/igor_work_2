# Phased execution prompts for the overhaul

The specification is `docs/OVERHAUL_MASTERPLAN_2026-07-20.md`. This file holds the session
map and the paste-ready prompt template used to run the overhaul one phase at a time.

Run each session in a FRESH conversation with cwd = this repo. Between sessions, the only
thing that changes in the prompt is the SESSION SCOPE block.

---

## Session map

| # | Scope | Masterplan sections | Ends when |
|---|-------|--------------------|-----------|
| S1 | Baseline + the three shallow fixes | Phase 0, Fix 1.4, Fix 1.7, Fix 1.5 | Nav duplicate gone, favicon renamed+busted, portal full-window; pushed and live-verified |
| S2 | Hub data + hub speed | Fix 1.2, Fix 1.1 | Satellites render in current zones; fw-perf marks permanent and boot budget met |
| S3 | Scoring (run alone — heaviest judgment) | Fix 1.3 | 4-persona harness green in `test:vectors`; weighted sector centroid live client+server |
| S4 | Foundations | WS-A, WS-B | Fonts self-hosted, SVG lockup shipped, fluid frame across all pages, QA matrix green |
| S5 | Polish burn-down | WS-C | `docs/POLISH_AUDIT_2026-07.md` fully checked off |
| S6 | Marco product | WS-D slices D1–D5 | Rebuilt coach UI, UI contract, thread cards, deadlines — streaming NOT yet |
| S7 | Marco brain + streaming | WS-D6, WS-E | SSE live with JSON fallback; persona module drives all nine surfaces; voice harness green |
| S8 | Feature onboarding | WS-F | Nine interstitials, empty states, hint ribbons, `featureIntros` persisted both sides |
| S9 | Monetization + close-out | WS-G, WS-H | Plan surfaces live, full suite green, handoff addendum + final report delivered |

S3 is the one session worth spending a premium model on if budget is tight. S1, S5, and S8
are the most mechanical.

---

## Prompt template

Paste the whole thing. Before each session, edit ONLY the SESSION SCOPE block (see
"Between sessions" below).

---

You are executing a phased product overhaul of FlightWay. The complete, decision-final
specification is `docs/OVERHAUL_MASTERPLAN_2026-07-20.md`. Read the whole of Part 0
(operating framework) plus the sections named in SESSION SCOPE below before writing any
code, along with `CLAUDE.md`, the newest addendum of `docs/CONVERSATION_HANDOFF.md`,
`docs/OVERHAUL_PROGRESS.md` if it exists, and `git log --oneline -10`. You do not need to
read the masterplan sections outside your scope.

Part 0 is binding: its invariants, verification gates, commit discipline, buster rules, and
"decisions already made" list override any instinct to re-plan. Do not redesign what it
already decides. Where it says grep-and-verify before editing, do exactly that. Every root
cause in the plan was verified against the repo with file:line evidence on 2026-07-20 —
trust it, but re-grep any reference before editing in case the file has drifted.

=== SESSION SCOPE ===
This session executes: <PHASE LINE — see the session map>
Do NOT start any later workstream, even if you finish early and have context left. Ending
cleanly inside scope is the goal; a partial slice of the next phase is worse than nothing.
=== END SESSION SCOPE ===

Non-negotiables (full detail in Part 0): deploy is `git push origin Jacob_Work` and nothing
else — never `deploy:prototype`, never `main`; vanilla JS with zero new runtime
dependencies; fresh `?v=` busters on changed assets only, on every page referencing them;
every scoring change lands client+server in the same commit and stays hydration-idempotent;
KEY_MAP additions go to both client and server plus the sync registry; every AI prompt
includes `schoolPromptBlock()`; Gemini JSON calls set `thinkingBudget: 0` and carry
timeouts; verify with the repo's npm scripts and `curl`, not by re-reading code or opening a
browser; anything only Jacob can do goes in the ledger's Human-gated list — record it, skip
forward, never stall.

Work at bounded, direct depth: trace the specific path each change touches, make the change,
run the gate, commit, move on. No open-ended analysis passes. No refactors of working code
the plan didn't ask for.

Session protocol:
1. Start by running the verification gates relevant to your scope to establish a baseline,
   and record green/red in `docs/OVERHAUL_PROGRESS.md` (create it from the session map if
   absent).
2. Execute your scope slice by slice, one commit per slice, gate before each commit.
3. Push at the end of the session and verify live against
   `https://flightwayjacobprototype.pages.dev` with `curl -L` and `npm run pages:smoke`.
   If the deploy stalls (subdomain 404), re-trigger with an empty commit.
4. Update the ledger with a one-line note per completed slice, every deviation, and every
   human-gated item.
5. Append a short addendum to `docs/CONVERSATION_HANDOFF.md` covering this session only.
6. Final message: outcome-first summary, what shipped, what's verified live, what's
   human-gated, and the exact scope line the next session should use.

---

## Between sessions

Change exactly one thing: the `<PHASE LINE>` inside SESSION SCOPE. Everything else in the
prompt stays byte-identical every time — the invariants, the protocol, and the pointer to
the ledger are what make a fresh context safe.

Phase lines to paste in, in order:

- **S1** — `Phase 0 (baseline suite + ledger creation), then Phase 1 fixes 1.4 (nav "Go to home"), 1.7 (favicon rename + bust), and 1.5 (portal full-window / WS-B slice B0). Stop after 1.5.`
- **S2** — `Phase 1 fixes 1.2 (missing AI-derived hub satellites) and 1.1 (career hub open lag). Stop after 1.1.`
- **S3** — `Phase 1 fix 1.3 only (personality-vector gain restructure + representativeness-weighted sector fit), including the 4-persona tuning harness. Stop when all four personas pass and the constants are recorded in the ledger.`
- **S4** — `Workstream A (brand & typography) then Workstream B (site-wide fluid layout), including the full QA screenshot matrix at the WS-B gate. Stop after the matrix passes.`
- **S5** — `Workstream C (polish sweep): produce docs/POLISH_AUDIT_2026-07.md first, then burn it down. Stop when every audit item is checked off or explicitly deferred with a reason.`
- **S6** — `Workstream D slices D1 through D5 only (coach page rebuild, structured reply contract, proactive threads, deadlines, Marco touchpoints). Do NOT implement D6 streaming this session.`
- **S7** — `Workstream D slice D6 (SSE streaming with JSON fallback), then Workstream E (Marco persona & prompt system across all nine surfaces, incl. the voice eval harness).`
- **S8** — `Workstream F (feature onboarding interstitials, empty-state teaching, hint ribbons, featureIntros persistence).`
- **S9** — `Workstream G (free/paid activation surfaces) then Workstream H (performance, full suite, screenshot matrix, handoff addendum, final report).`

If a session ends early or a slice is left incomplete, do not invent a new phase line for
the next one. Paste the SAME phase line again — the agent reads the ledger, sees what
landed, and resumes at the first unchecked slice.
