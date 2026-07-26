# Deploy (load-bearing)

**Full protocol: `docs/BRANCH_AND_ENV_PROTOCOL.md`. Read it before the first
push of a session; it covers promotion, rollback, the three config stores and
every gotcha below in detail.**

- **Two Pages projects, not two environments of one.** `Jacob_Work` →
  `flightwayprototype` → flightwayjacobprototype.pages.dev (test Stripe key).
  `main` → `flightway` → **flightway.ai** (live Stripe key). They share ONE D1
  (`flightway-db`) and ONE KV (`COACH_KV`) — there is no staging database.
- **Deploy the prototype by pushing to `Jacob_Work`** (`git push origin
  Jacob_Work`) — Cloudflare Pages auto-builds via the GitHub integration.
  **Do NOT run `npm run deploy:prototype`** (the direct wrangler upload path) —
  it is unreliable and no longer used. The git push IS the deploy.
- **Promote to production with `git push origin Jacob_Work:main`** — a
  fast-forward, no checkout needed. Code flows `Jacob_Work` → `main`, NEVER the
  other way. **Never push `main` autonomously; it needs Jacob's explicit go each
  time, same as any other hard-to-reverse production action.**
- **`npm run env:status`** before and after every push: branch tips vs the sha
  each project is actually SERVING, Stripe mode per site, branch delta, tree
  state. A green `git push` is not a deploy.
- **`npm run verify:env`** covers all three config stores (both Pages projects
  *and* the standalone `flightway-cron` Worker, which no git push ever deploys —
  that needs `npm run deploy:cron`).
- Per-environment Stripe config is automatic: `priceIdFor()` reads the key's
  mode and picks the `_TEST` or unsuffixed price ids. Never hand-flip it.
- After pushing, do live verification against the URL you actually deployed to —
  `pages:smoke` defaults to the prototype, so production needs the override:
  `SMOKE_BASE_URL=https://flightway.ai npm run pages:smoke`.
- **Push to `Jacob_Work` on your own after finishing any directive** — Jacob has
  standing authorization for this; do not ask each time. The loop is: make the
  change, `npm run gates:unit` green, commit, `git push origin Jacob_Work`. This
  deploys the prototype only, which is reversible and seen by nobody but us.
  - **The one carve-out: hold the push and ask first when the change could
    seriously destabilize the site or alter its function** — a schema/migration
    change, an auth/session/entitlement rewrite, anything touching the payment or
    webhook path, a new site-wide middleware or request path, deleting/moving
    files the app serves, or anything you are not confident is safe. When in
    doubt, that is a "hold and ask," not a "push." Report what you did either way.
  - **This authorization is for `Jacob_Work` ONLY. It NEVER extends to `main`.**
    Promoting to production (`git push origin Jacob_Work:main`) is the exact
    hard-to-reverse action the rule above still governs: propose it, never run it
    without Jacob's explicit go for that specific promotion.

# Speed (load-bearing — wall-clock is the scarce resource here)

Sessions on this repo have been slow for one reason: long commands run in the
foreground, one at a time, while everything else waits. Fix that first.

- **Gates: `npm run gates:unit` (~20s, 47 offline gates) before every commit.
  `npm run gates` (all 50, adds the full-layout and perf ones, ~80s) once
  before the push.** Its `pages:smoke` targets the PROTOTYPE, not flightway.ai —
  a green `gates` is not a production check (protocol §4). Both run the suite in
  parallel via `scripts/run-gates.mjs`
  and print one line per gate. Do NOT hand-roll a bash `for` loop over the gate
  names — that is the ~12-minute serial run this replaced.
  - `npm run gates -- --only=test:endpoints,verify:busters` for a targeted subset.
  - Per-gate output is in `.gates/<name>.log`; failures print their own tail, so
    you rarely need to open one.
  - Browser/network gates retry once automatically before being called red. A
    gate marked `ok*` passed on the retry — that is a flake, not a pass to hide.
- **Never spend a turn waiting.** This is the failure this section exists for.
  A turn whose only content is `sleep`, an `until ...; do sleep; done` poll, or
  re-reading a background output file is a wasted turn. A `PreToolUse` hook
  (`~/.claude/hooks/no-blocking-wait.sh`) now denies foreground waits outright.
  - Harness-tracked background commands **notify you on completion**. Polling
    one is pure waste — there is nothing to check for.
  - **Before you background anything, name the next independent task and start
    it in the same turn.** "Start the gate run" and "capture the screenshots"
    and "make the next edit" are one turn, not three.
  - If you truly have nothing independent left, end the turn and wait for the
    notification. Do not sleep to fill the gap.
- **Anything over ~20s goes to the background** (`run_in_background: true`) and
  you keep working. Gate runs, screenshot captures, deploy polling.
  - Long command + independent edits → launch the command FIRST, then edit while
    it runs. Never edit, then launch, then idle.
  - Verification that doesn't depend on the running job (reading a different
    file, a `git log`, drafting the ledger entry) all belongs in that window.
- **Batch independent tool calls into ONE assistant turn.** Greps, file reads,
  and `node --check`s that don't depend on each other should never be serialized
  across turns. This is the single biggest per-turn win after the gate suite.
- **Delegate wide, bounded, mechanical work to parallel subagents** — a
  multi-file rename, a per-file audit sweep, gathering call sites across many
  modules. Spawn them in one turn and let them run concurrently. Keep each brief
  self-contained and bounded (see the delegation rule below); do not delegate
  anything requiring judgment you'd have to re-derive from their answer anyway.
- **One port per gate.** Every local-server script owns a distinct port
  (`4599` hero, `8931` screenshots, `8934` layout, `8935` opportunities,
  `8936` plan, `8937` resume-ui) and reads its own env override. Two gates on
  one port is why `EADDRINUSE` used to bite; if you add a gate, give it a port.
- **`layout:check` has a `--quick` mode** (18 cells, ~19s) versus the full 270
  cells (~13 min). `gates:unit` uses quick automatically. Run the full walk when
  layout or CSS actually changed, not on every slice.

# Token conservation (load-bearing — user is on a metered plan)

- Grep/read narrowly (offset+limit) before reading whole files. Don't re-read a file you just Edited/Wrote.
- Delegate per the `flightway-fullstack-architect` skill: never spawn an agent above your own model tier; same-tier spawning only when the task is fully brief-able AND would flood your context (prefer inline); below-tier for mechanical/bounded work (batched into one brief). Cap every subagent brief at "bounded, direct depth" — no "think hard"/open-ended passes.
- Verify with project scripts (`hub:verify`, `test:vectors`, `verify:aliases`, `onet:test`, `pages:smoke`, `node --check`) and `curl`, not by re-reading code or opening a browser session — except when diagnosing a live runtime bug (page fails to boot, console error): those need `pages:smoke`/a headless Playwright probe, not more static reading.
- One targeted fix per confirmed bug. Don't refactor, restyle, or "improve" surrounding code that already works.
- Batch independent tool calls in one turn instead of serializing them (see Speed above).
- Bump `?v=` cache-busters only on files you actually changed, only on pages that reference them — never a blanket re-stamp.
- Keep responses proportional to the ask: a one-line fix gets a one-line report, not a full summary with headers.
