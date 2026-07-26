# Distinctive-fit session launcher prompt

Paste everything between the rules into a fresh session, replacing the SESSION SCOPE
block with one scope line from the Session map in
`docs/DISTINCT_FIT_MASTERPLAN_2026-07-21.md`. Set the Opus thinking level named for
that session in the map before sending (Session 1: Ultrathink · Session 2: Ultracode ·
Session 3: High).

---

You are executing the FlightWay distinctive-fit plan. The complete, decision-final
specification is docs/DISTINCT_FIT_MASTERPLAN_2026-07-21.md. Before writing any code,
read: the whole of its Part 0 (invariants P0.1–P0.6 and the decisions-already-made
list), the Parts covering the phases named in SESSION SCOPE below, CLAUDE.md, the
newest addendum of docs/CONVERSATION_HANDOFF.md, docs/DISTINCT_FIT_PROGRESS.md if it
exists, and git log --oneline -10. Part 0 of docs/OVERHAUL_MASTERPLAN_2026-07-20.md
applies verbatim by reference; do not read the rest of that document.

Part 0 is binding: its invariants, gates, commit discipline and decisions-already-made
override any instinct to re-plan. The variant, baseline, phases and consumer census
were settled by measurement on 2026-07-21 at HEAD 2724e2b — do not redesign them, but
re-grep every file:line reference before editing in case the file has drifted.

=== SESSION SCOPE ===
<paste one scope line from the masterplan's Session map here>
=== END SESSION SCOPE ===

Non-negotiables (full detail in the masterplan's Part 0):
- Deploy is `git push origin Jacob_Work` and nothing else — never deploy:prototype,
  never main. Vanilla JS, zero new runtime dependencies.
- Fresh `?v=` busters on changed assets only, on every page referencing them; never
  reuse a same-day stamp with different content.
- After D0 there is exactly ONE personality-fit chokepoint (`personalityFitPercent`);
  no call site computes `cosinePercent(cosine(...))` directly, ever again.
- Chokepoint, LV_BASELINE, FIT_MATH_VERSION and flag changes land in BOTH math files
  (client + server) in the same commit; the test:vectors parity section proves it.
- Any stored fit percent (KV career-rank, KV stretch-fits, snapshots) carries
  FIT_MATH_VERSION in its key or payload.
- Frozen, on pain of a failed run: `cosine()` itself, objective fit and every
  objective-side consumer, career↔career similarity/links/layout, ETL rep-weighting,
  and all seed/hydration code including PERSONALITY_SEED_GEN. If your slice seems to
  require editing any of these, stop and record it in the ledger instead.
- Sessions after the first copy D1's locked constants from the ledger — never
  re-derive them.
- Verify with the repo's npm scripts (`gates:unit` is the floor, ~56s; `test:vectors`
  after anything in this plan) and curl — not by re-reading code, and never by opening
  a browser session except the committed screenshot harness where the scope names it.
- Anything only Jacob can do goes in the ledger's Human-gated list — record it, skip
  forward, never stall.

Session protocol:
1. Run the gates relevant to your scope to establish a baseline; record green/red in
   docs/DISTINCT_FIT_PROGRESS.md (create it from the masterplan's session map if
   absent).
2. Execute your scope slice by slice, one commit per slice, gate before each commit.
   Any commit whose acceptance bar is "byte-identical" must prove it in the ledger
   with the persona-harness numbers captured before and after.
3. Push at the end of the session and verify live against
   https://flightwayjacobprototype.pages.dev with `curl -L` and `npm run pages:smoke`;
   sha-compare every busted URL to disk. The production alias flips POP-by-POP up to
   ~10 minutes behind the Active build — poll each URL until consecutive fresh
   responses match disk before concluding anything. If the deploy stalls (subdomain
   404), re-trigger with an empty commit.
4. Update the ledger: one line per completed slice, every deviation, every human-gated
   item — and, in session 1, the complete D1 constants table (later sessions depend on
   it).
5. Append a short addendum to docs/CONVERSATION_HANDOFF.md covering this session only.
6. Final message: outcome-first summary — what shipped, what's verified live, what's
   human-gated, and the exact scope line the next session should use.

Work at bounded, direct depth: trace the specific path each change touches, make the
change, run the gate, commit, move on. No open-ended analysis passes. No refactors of
working code the plan didn't ask for.
