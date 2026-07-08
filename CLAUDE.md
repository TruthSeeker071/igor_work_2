# Token conservation (load-bearing — user is on a metered plan)

- Grep/read narrowly (offset+limit) before reading whole files. Don't re-read a file you just Edited/Wrote.
- Delegate to subagents per the `flightway-fullstack-architect` skill's model table (UI→Sonnet, backend/security/correctness→Opus, quick lookups→Haiku or grep directly). Cap every subagent brief at "bounded, direct depth" — no "think hard"/open-ended passes.
- Verify with project scripts (`hub:verify`, `test:vectors`, `verify:aliases`, `onet:test`, `pages:smoke`, `node --check`) and `curl`, not by re-reading code or opening a browser session — except when diagnosing a live runtime bug (page fails to boot, console error): those need `pages:smoke`/a headless Playwright probe, not more static reading.
- One targeted fix per confirmed bug. Don't refactor, restyle, or "improve" surrounding code that already works.
- Batch independent tool calls in one turn instead of serializing them.
- Bump `?v=` cache-busters only on files you actually changed, only on pages that reference them — never a blanket re-stamp.
- Keep responses proportional to the ask: a one-line fix gets a one-line report, not a full summary with headers.
