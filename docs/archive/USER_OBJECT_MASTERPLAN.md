# FlightWay — Canonical User Object Masterplan

**Status: COMPLETE** (planned 2026-07-19, executed 2026-07-19 in fa182c0..497e2b8 —
Phases 0+1, 2A–2F, 3, 4 all shipped and live-verified; see the five
'Canonical User Object' addenda in docs/CONVERSATION_HANDOFF.md for what
actually landed, including the deliberate deviations). Owner: Fable session on Ultracode.
**Goal:** every feature reads and writes user data through one normalized `user`
object instead of reaching into the quiz blob with ad-hoc paths. `quiz.school`
→ `user.identity.school`, vectors → `user.vectors.objective` /
`user.vectors.personality`, and so on — one shape, one access layer, on both
client and server, finished with a real storage migration.

Decisions already made by Jacob (do not re-litigate):
1. **Full storage migration included** — this plan ends with the D1 table and
   localStorage actually holding the new shape, not just a facade.
2. **Exhaustive consumer migration** — all ~40 consumer files move to the user
   model, ending with a grep guard so no new direct blob reads appear.
3. **Dossier↔user sync generalizes to structured identity fields** (school,
   year, gpa, subjects/major, careerLeaning). Vectors/scores stay one-way
   (computed; never dossier-written).
4. Naming is **camelCase** (`user.vectors.objective`, not `objective_vector`)
   to match the codebase.

## Why this shape of plan (context for the implementing session)

The quiz blob (`fw_hub_quiz_v1` in localStorage, mirrored to D1
`quiz_profiles.payload` as one JSON column keyed by email) is *already* the
de-facto user object — it holds scores, both vectors, sectorFitSheet,
careerFocus, academics, profile.{year,gpa,school,subjects,careerLeaning},
traits, characterSummary, resumeText, portalSnapshot, refine, profileBuilding.
The problem is naming and access: consumers use inconsistent paths
(`quiz.school`, `quiz.profile.school`, and `profile.school` all exist), and the
blob has multiple concurrent writers protected only by convention.

Reference counts at planning time: ~54 `quiz.scores`, ~42 `quiz.objectiveVector`,
~39 `quiz.personalityVector`, ~39 `quiz.careerFocus`, ~34 `quiz.sectorFitSheet`,
~30 `quiz.profile.*`, 19 `quiz.academics`, 15 `quiz.profileBuilding`,
13 `quiz.refine` — across the consumer files listed in Phase 2.

**Order is load-bearing: facade first, storage last.** The blob's writers
(quiz-app, onet-vectors hydration, `PUT /profile/quiz` server rebuild,
gap-progress-sync, refine, academics, portal snapshot) each protect an
invariant. Renaming stored fields first breaks all of them at once *and*
requires migrating every saved D1 row and localStorage on day one. Migrating
access first makes the storage rename (Phase 4) a mechanical change behind one
module.

## Invariants that must survive every phase (verbatim, all fragile-subsystem)

- **Hydration idempotency:** vector rebuilds are idempotent; every vector
  mutation is an input replayed by BOTH client and server rebuilds (the
  `objectiveAiPatch` pattern). Anything else is silently wiped or compounds.
- **Accumulating math:** absolute values keyed by source with a recorded base
  (`bleedBase` pattern) — never deltas applied per render/event.
- **No-op save drops no fields** (`PUT /profile/quiz`, roadmap save,
  `preserveV3FocusTracker`).
- **`PUT /profile/quiz` keeps the client's vector object (and `updatedAt`) when
  the server rebuild is a no-op** — a fresh timestamp per PUT churns every
  staleness hash downstream (portal snapshot, roadmap, analysis cache).
- **school.js two-store invariant:** one fact, two representations, one sync
  direction each — dossier writes flow to the canonical store via
  `saveDossier`→`syncSchoolFromDossier`; explicit sets write both. Phase 3
  generalizes this; it must never gain a second writer per direction.
- **`[[coordinates]]` never persists** — `saveDossier` strips it
  (`COORDINATES_BLOCK_RE`).
- **gap-progress-sync is the single vector writer** for gap progress.
- **`_lib.js` ⇄ `_lib/auth.js` must stay cycle-free** (school.js uses lazy
  dynamic imports for exactly this reason — the user model must too).
- Hub boot TDZ trap, `/assets/*` immutable caching (bump `?v=YYYYMMDDx`
  busters on every changed asset, changed files only), deploy = `git push
  origin Jacob_Work`, O*NET levels already 0–100, vanilla JS only, extend
  existing modules rather than adding parallel systems.

## Canonical user shape (v2 payload)

```js
user = {
  v: 2,                       // payload schema version; absent/undefined = legacy v1 quiz blob
  identity: {
    name, school, schoolCity, year,          // year: freshman|sophomore|junior|senior
    gpa, subjects: [], careerLeaning, careerLeaningSoc,
  },
  vectors: {
    personality,              // vector object unchanged: {schemaId, values, confidence, updatedAt, source(s), patches, bleedBase…}
    objective,                // ditto, incl. objectiveAiPatch replay inputs
    schemaId,                 // was vectorSchemaId
    objectiveSkipped,         // bool
  },
  assessment: {
    scores, scoresRaw, traits, characterSummary, sectorFitSheet,
    enrichBoosts, customAnswers,
  },
  focus: { careerFocus, academics },
  resume: { text, summary, boosts },
  journey: { profileBuilding, refine, portalSnapshot /* + any inventory finds */ },
}
```

The **inner objects keep their exact current shapes** — a vector object, a
sectorFitSheet, a careerFocus are moved, not redesigned. Phase 0's inventory is
authoritative for the full top-level field list; the layout above is the
grouping decision, not a complete census. Email stays the row key, not a field.

## Phase 0 — Inventory + safety net (do first, cheap)

1. Grep-derive the **complete** field inventory of the quiz blob: every key
   written by `qzBuildHubPayload`/`qzRegisterProfilePayload` (quiz-app.js
   ~2445–2505), onet-vectors hydration, hub-refine, hub-academics,
   career-target, gap-progress-sync, portal-snapshot, resume-parse,
   profile-building, and `saveQuizProfile` call sites. Record the v1→v2 key map
   in `functions/_lib/user-model.js` (Phase 1) as a single table — that map IS
  the spec.
2. Capture 2–3 realistic v1 payload fixtures (a fresh-quiz user, a
   resume-uploaded user with patches/bleedBase, a long-tenured user with
   refine+academics+portalSnapshot) under `scripts/fixtures/`.
3. New script `scripts/test-user-model.mjs` (wire as `npm run test:user`):
   round-trip property — `denormalize(normalize(v1Fixture))` preserves every
   field (deep-equal modulo the `v` marker), and `normalize` is idempotent.
   Extend, don't replace, `test:vectors` / `test-school.mjs`.

## Phase 1 — The user model + facades (no consumer changes yet)

- **`functions/_lib/user-model.js`** — pure, dependency-free: the v1↔v2 key
  map, `normalizeUser(raw)` (accepts v1 or v2, returns v2), `denormalizeUser`
  (v2→v1, needed until Phase 4 completes), field getters used by both sides.
  Pure so plain-Node scripts can unit-test it (same reason school.js keeps its
  helpers pure).
- **`functions/_lib/user.js`** — server facade: `loadUser(env, email)`
  (= `loadQuizProfile` + normalize), `saveUser(env, email, user)` (denormalize
  → `saveQuizProfile` until Phase 4 flips it), `userPromptContext(user)`
  helpers for prompt builders. Lazy dynamic imports of `_lib.js`/`auth.js`
  (cycle-free rule).
- **`assets/js/shared/user.js`** — client facade `FWUser` (vanilla IIFE global,
  same idiom as `FWOnetVectors`): `FWUser.get()` returns the normalized user
  view over `fw_hub_quiz_v1`; `FWUser.update(mutator)` writes through the
  existing save path (`FWAuth`'s quiz save / `PUT /profile/quiz`), preserving
  no-op-save semantics. It shares the key map with the server: keep the pure
  map in a tiny client-loadable file OR duplicate it with a parity assertion in
  `test:user` that imports both and diffs the maps — pick whichever the repo's
  existing client/server sharing idiom supports; do NOT let the two maps drift
  unguarded.
- Client pages that need it get one new `<script>` tag with a fresh buster;
  `user.js` must load before consumers (mind the hub TDZ/boot order).
- Verify: `npm run test:user`, `node --check`, `pages:smoke` (facade present,
  nothing else changed).

## Phase 2 — Exhaustive consumer migration, in verified waves

Each wave: migrate the listed files to `FWUser`/`loadUser` paths, run the named
scripts, commit, push (deploys), curl-verify. One wave per commit. Consumer
lists are from planning-time greps — re-grep at execution time; the grep is
authoritative, not this list.

**Wave A — school + identity** (the pattern already exists in school.js):
`resolveSchool`/`setSchool` become thin wrappers over the user model (keep
their exported signatures — every prompt surface calls them);
`opportunity-finder.js`, `hub-academics.js`, `functions/opportunities.js`,
`mock-interview.js`, `weekly-plan.js`, and every `profile.school`/`quiz.school`
read. Verify: `node scripts/test-school.mjs`, `test:user`.

**Wave B — vectors** (fragile — full trace before editing, one file at a time):
`onet-vectors.js` (hydrate/persist read the blob directly at ~480/670/1078),
`gap-progress-sync.js`, `onet/objective-patch.js`, `onet/personality-patch.js`,
`profile/quiz.js` (the PUT rebuild), `vector-fit.js`, `receipts.js`,
`dossier-coordinates.js`, `onet-quiz-seed.js`, `resume-ingest.js`. State per
edit which invariant it preserves. Verify: `test:vectors`, `onet:test`,
`test:user`, `pages:smoke`.

**Wave C — assessment/fit:** `hub-dashboard.js`, `hub-careers.js`,
`hub-onet-map.js`, `hub-zone-fit.js`, `career-compare.js`,
`career-personalize.js`, `sector-fit-sheet.js` (client+server),
`stretch-fits.js`, `profile-alignment.js`/`profile-align.js`,
`why-this-match.js`. Verify: `hub:verify`, `pages:smoke`.

**Wave D — focus + academics + roadmap surface:** `career-target.js`,
`career-focus-migrate.js`, `portal-target-switch.js`, `skill-gap-tracker.js`,
`roadmap-sync.js` (client+server), `roadmap-generate.js`, `career-roadmap.js`,
`academics-map.js`, `hub-refine.js` (careerFocus/academics reads). Verify:
`verify:aliases`, `hub:verify`, `pages:smoke`.

**Wave E — long tail:** `coach.js`, `marco.js`, `portal.js` + portal-snapshot
(client+server), `artifacts.js` (client+server), `resume-page.js`,
`resume-parse.js`, `resume-builder.js`, `profile-building.js` (client+server),
`career-analysis.js`, `career-switch-chat.js`, `chat.js`, `auth.js`/
`auth-pages.js` (the slim register payload), `quiz-app.js` itself
(`qzBuildHubPayload` emits v2 directly; keep the `#r=` dashboard hash-token
flow working — the token now carries v2, and the dashboard reader must accept
both during rollout). Verify: full script suite.

**Wave F — the guard:** `scripts/verify-user-model.mjs` (wire as
`npm run verify:user`): greps the repo and **fails** on any
`fw_hub_quiz_v1` / `HUB_QUIZ_KEY` / `loadQuizProfile` / `saveQuizProfile`
reference outside the facade files + quiz-app's writer + this doc. Run it in
the same breath as `test:vectors` from here on.

## Phase 3 — Generalized dossier↔user field sync

Generalize school.js into a **field registry** in `functions/_lib/user-sync.js`
(school.js keeps its exports but delegates):

```js
FIELDS = [
  { key: 'identity.school',        dossierLine: 'school',         clean: cleanSchoolValue },
  { key: 'identity.year',          dossierLine: 'year',           clean: … },
  { key: 'identity.gpa',           dossierLine: 'gpa',            clean: … },
  { key: 'identity.subjects',      dossierLine: 'subjects_major', clean: … },  // match actual seed-dossier line names
  { key: 'identity.careerLeaning', dossierLine: 'career_leaning', clean: … },
]
```

- Match `buildSeedDossier`'s actual line names (read `_lib.js` first); add
  per-field placeholder handling and sanitizers mirroring
  `sanitizeSchoolName`/`cleanSchoolValue` (these fields reach Gemini prompts —
  sanitize as data, mirror the fencing in `career-roadmap.js`).
- `saveDossier` → `syncUserFromDossier(env, userId, text)` (replaces the
  school-only call; still lazy-imported, still best-effort — a failed mirror
  never fails the dossier write). Explicit sets go through
  `setUserField(env, email, key, value)` = write user store, mirror dossier
  line (the `setSchool` pattern). One sync direction each, per field.
- Add each synced field to `test-school.mjs`'s honesty pattern (or a successor
  `test-user-sync.mjs`): a dossier merge stating "I'm a junior now" must land
  in `user.identity.year`, and a placeholder must never overwrite a real value.
- `schoolPromptBlock()` stays — it is a constraint block, not just a fact.
  Audit which prompts should also carry year/gpa via `userPromptContext`.

## Phase 4 — Storage migration (last, only after `verify:user` is green)

Server (D1):
1. Migration `0013_user_profiles.sql`: `CREATE TABLE IF NOT EXISTS
   user_profiles (email TEXT PRIMARY KEY, payload TEXT, updated_at TEXT)` +
   `INSERT … SELECT` backfill from `quiz_profiles` (raw copy — payloads stay
   v1; normalize-on-read handles them). Keep `quiz_profiles` in place, frozen,
   for one release as rollback; drop in a later `0014`.
2. Flip `loadUser`/`saveUser` to the new table; `saveUser` now writes **v2
   natively** (drop the denormalize step). `loadUser` normalizes v1 rows
   forever — lazy per-user upgrade on next save; no big-bang rewrite of rows.
3. `loadQuizProfile`/`saveQuizProfile` become deprecated aliases over the new
   table (the guard already bans new callers).

Client:
4. New key `fw_user_v1`. One-time boot migration in `user.js`: if `fw_user_v1`
   absent and `fw_hub_quiz_v1` present, normalize → write `fw_user_v1` →
   leave the old key untouched for one release (rollback), then a later commit
   deletes it on boot. All facade reads/writes use the new key from this
   commit on.
5. The `#r=` quiz→dashboard token and the register slim payload emit v2
   (done in Wave E); server endpoints keep accepting both shapes via
   `normalizeUser` indefinitely — old tabs and cached pages exist.

Gotchas pinned from past sessions: pending-migrations trap (0011/0012 were
once pending — check `wrangler d1 migrations list` before assuming 0013 is the
only one to apply); smoke-is-live gotcha (smoke hits the deployed site, not
your working tree); session cookies are per-deployment-subdomain (re-login
after each deploy when testing live).

## Verification matrix (run per wave; all green before push)

| Change touches | Must run |
|---|---|
| user-model / any wave | `npm run test:user`, `node --check` on touched files |
| vectors/merge/patch | `npm run test:vectors`, `npm run onet:test` |
| hub surfaces | `npm run hub:verify`, `npm run pages:smoke` |
| slugs/aliases | `npm run verify:aliases` |
| school/sync fields | `node scripts/test-school.mjs` (+ successor) |
| after Wave F | `npm run verify:user` always |
| every push | `curl -L` live URL, check busters + content |

## Execution rules for the implementing session

- Work wave-by-wave; one commit per wave; push `Jacob_Work` (that IS the
  deploy); bump busters on changed assets only.
- Fragile subsystems (Wave B, Phase 3 sync, Phase 4) get full causal traces
  inline at your own tier; batch mechanical grep/verify runs to Haiku.
- Bounded, direct depth throughout — trace the specific path each edit
  touches; no exhaustive rule-out-everything passes.
- If a planning-time file list disagrees with a fresh grep, the grep wins.
  If this plan disagrees with the repo, the repo wins — note the deviation in
  `docs/CONVERSATION_HANDOFF.md` and proceed.
- Update `CONVERSATION_HANDOFF.md` with an addendum after each phase lands.
