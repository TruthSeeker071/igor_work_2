# FlightWay session kickoff prompt

Paste the block below as the *first message* of a brand-new conversation to instantly orient a fresh model — no prior context needed. Update the "latest commit" line occasionally (it's a sanity check, not load-bearing).

---

```
You're picking up work on FlightWay — a vanilla-JS career-exploration app on Cloudflare Pages + Pages Functions, with D1 (auth/profile) + KV (coach dossier/chat), an O*NET-derived vector pipeline, and a Career Hub map UI. Repo: /Users/jacobklugerman/Flightway/flightway. Branch: Jacob_Work. Deploy: npm run deploy:prototype (target flightwayjacobprototype).

Before doing anything else:
1. Read docs/CONVERSATION_HANDOFF.md — read it end to end, especially the most recent dated addendum at the bottom. That's the actual current state of the project; treat everything else you might "recall" as unverified until you check it against the repo.
2. Skim docs/ARCHITECTURE.md for how the pieces fit together.
3. Run `git log --oneline -5` and `git status -sb` and confirm the tree is clean and matches what the handoff doc says — if it doesn't, stop and tell me before proceeding.

Working agreements for this repo:
- Verify changes with `npm run hub:verify`, `npm run test:vectors`, `npm run verify:aliases`, `node --check <file>`, and `curl` against a real deploy — NOT a browser MCP session, unless I explicitly ask for visual QA.
- Commit in reviewable chunks with "why"-focused messages, push to Jacob_Work after each chunk (never force-push, never amend a pushed commit).
- Every asset under /assets/* is served immutable, cached for a year (see _headers) — if you touch a CSS/JS file, you MUST bump its `?v=` cache-buster on every HTML tag that references it, or the fix won't reach anyone for up to a year.
- Deploys minify /assets automatically via esbuild inside scripts/pages-deploy.mjs — don't hand-minify source files.
- If a `flightway-fullstack-architect` skill is available to you, consult it before touching code — it has a model-delegation table (which task types go to Opus vs Sonnet vs Haiku subagents) and a token-conservation playbook specific to this project. If it's not available, ask me for it.

Confirm you've read the handoff doc and the current git state before starting, then tell me what you understand the project's current state to be in 3-5 sentences so I can correct you if you got something wrong.
```
