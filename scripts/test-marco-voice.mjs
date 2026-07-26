// Marco's voice (WS-E slice E4) — one character, checked mechanically.
//
// Deterministic and free by default: it builds every surface's prompt and
// asserts on the text. What it is actually protecting:
//
//   - Every surface inherits the persona core, so a new prompt cannot quietly
//     invent a second Marco.
//   - Every advice surface carries a schoolPromptBlock, in both the
//     school-known and school-unknown branches (invariant 0.2).
//   - Banned phrases appear ONLY as prohibitions. The banned list is an
//     instruction to a model, and the way it breaks is someone "helpfully"
//     writing an example that shows the model the phrase in use.
//   - Every JSON-mode Gemini caller still sets thinkingBudget: 0 (0.2).
//   - Committed goldens: a change to the composer shows up as a diff, not as a
//     silently different Marco. Refresh with `--update`.
//
// `--live` (needs GEMINI_API_KEY) additionally runs three fixture
// conversations against the real model and asserts the replies are short and
// clean. It costs money, so nothing in CI runs it.
//
// Run: npm run test:marco-voice [-- --update] [-- --live]

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildSurfacePrompt, SURFACES, SURFACE_KEYS, BANNED,
  PERSONA_MARKER, ROLEPLAY_MARKER, PERSONA_VERSION,
} from '../functions/_lib/marco-persona.js';
import { DEFAULT_GEMINI_MODEL } from '../functions/_lib.js';
import { buildTurnPrompt, buildDebriefPrompt } from '../functions/_lib/interview-core.js';
import { buildWeeklyPlanPrompt } from '../functions/_lib/weekly-plan-gen.js';
import { buildOpportunityPrompt } from '../functions/_lib/opportunity-core.js';
import { collectCommitments, commitmentsPromptBlock, recentCompletion } from '../functions/_lib/commitments.js';
import { buildGeneratePrompt, buildGenerateTreePrompt } from '../functions/_lib/roadmap-generate.js';
import {
  buildExtendPrompt, buildBranchBuildPrompt, buildTreePatchPrompt, buildSplitPrompt,
  branchChainFrom,
} from '../functions/_lib/roadmap-tree.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_DIR = join(ROOT, 'scripts/goldens/marco-voice');
const UPDATE = process.argv.includes('--update');
const LIVE = process.argv.includes('--live');

const SCHOOL = 'University of Chicago';

// A minimal but structurally real v2 tree. The four roadmap-tree prompts all
// serialise a tree into their body, so they need one that survives
// compactTreeForPrompt — an empty object would make every contract assertion
// pass vacuously.
const TREE = {
  version: 2,
  targetCareerSlug: 'quant-trader',
  targetCareerName: 'Quantitative Trader',
  summary: 'Get to a trading desk.',
  trunk: { title: 'Second-year at UChicago' },
  activePath: ['w1', 'w2'],
  fitContext: { topGaps: ['Probability', 'Programming'] },
  nodes: [
    { id: 'w1', parentId: null, depth: 0, type: 'waypoint', title: 'Finish MATH 20700', shortTitle: 'MATH 20700', pathRole: 'spine', confidence: 5, horizon: 'next_semester', addressedGaps: ['Probability'], steps: [] },
    { id: 'w2', parentId: 'w1', depth: 1, type: 'waypoint', title: 'Ship a backtester', shortTitle: 'Backtester', pathRole: 'spine', confidence: 4, horizon: 'longer_term', addressedGaps: ['Programming'], steps: [] },
    { id: 'b1', parentId: 'w2', depth: 2, type: 'waypoint', title: 'Research track', shortTitle: 'Research', pathRole: 'branch', confidence: 3, horizon: 'longer_term', addressedGaps: ['Probability'], steps: [] },
  ],
  decisions: [
    { id: 'd1', nodeId: 'w2', prompt: 'Desk or research?', chosenOptionId: null, options: [{ id: 'o1', label: 'Desk', childNodeId: 'b1' }, { id: 'o2', label: 'Research', childNodeId: 'b1' }] },
  ],
};
const TREE_CTX = { dossier: 'name: Test Student\nschool: University of Chicago', currentRoadmap: TREE, careerName: 'Quantitative Trader' };

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok - ${name}`); return; }
  failures += 1;
  console.error(`  FAIL - ${name}${detail ? `\n        ${detail}` : ''}`);
}

/* ── 1. Every surface builds, and inherits the core ───────────────── */

const built = {};
for (const key of SURFACE_KEYS) {
  built[key] = buildSurfacePrompt(key, {
    school: SCHOOL,
    dossier: SURFACES[key].roleplay ? '' : 'name: Test Student\nschool: University of Chicago',
    omitSchool: !!SURFACES[key].roleplay,
  });
}

check('every surface in the registry builds a prompt', Object.keys(built).length === SURFACE_KEYS.length);

for (const key of SURFACE_KEYS) {
  const p = built[key];
  const spec = SURFACES[key];
  check(`${key}: carries the core marker`,
    p.includes(spec.roleplay ? ROLEPLAY_MARKER : PERSONA_MARKER));
  check(`${key}: carries the shared voice rules`, p.includes('## How you write'));
  check(`${key}: carries the banned list`, p.includes('## Never'));
  check(`${key}: carries its own surface layer`, p.includes('## This surface'));
  // Roleplay surfaces must NOT claim to be Marco — a mock interviewer who is
  // secretly your advisor is not a mock interview.
  if (spec.roleplay) {
    check(`${key}: roleplay surface never claims to be Marco`,
      !p.includes(PERSONA_MARKER) && !/^You are Marco\b/m.test(p));
  } else {
    check(`${key}: reasoning protocol present`, p.includes('## Before each reply'));
  }
}

check('an unknown surface throws rather than shipping a coreless prompt',
  (() => { try { buildSurfacePrompt('nope', {}); return false; } catch { return true; } })());

/* ── 2. Banned phrases appear only as prohibitions ────────────────── */
{
  // The banned block is the one place the phrases may appear. Everything after
  // it in a built prompt is surface constraints and context, which must be clean.
  for (const key of SURFACE_KEYS) {
    const p = built[key];
    const after = p.slice(p.indexOf('## This surface'));
    const leaked = BANNED.filter((b) => after.toLowerCase().includes(b.toLowerCase()));
    check(`${key}: no banned phrase outside the prohibition block`,
      leaked.length === 0, leaked.join(', '));
  }
  check('the banned list is not empty', BANNED.length >= 8);
  for (const phrase of BANNED) {
    check(`banned "${phrase}" is actually written into the prompt`,
      built.chat.toLowerCase().includes(phrase.toLowerCase()));
  }
}

/* ── 3. School: every advice surface, both branches ───────────────── */
{
  const SCHOOL_SURFACES = [
    ['chat', (school) => buildSurfacePrompt('chat', { school })],
    ['career-switch', (school) => buildSurfacePrompt('career-switch', { school })],
    ['roadmap-advice', (school) => buildSurfacePrompt('roadmap-advice', { school })],
    ['roadmap-waypoint', (school) => buildSurfacePrompt('roadmap-waypoint', { school })],
    ['weekly-plan', (school) => buildWeeklyPlanPrompt({
      careerName: 'Quant Trader', node: { title: 'n' }, stepLines: [], planPhases: [],
      prevTasks: [], notes: [], week: '2026-W30', school,
    })],
    ['opportunities', (school) => buildOpportunityPrompt({
      evidence: 'E', dossier: 'D', careerName: 'Quant Trader', gaps: [], school,
    })],
    ['interview-turn', (school) => buildTurnPrompt({
      playbook: { label: 'x', behavioralFocus: [], technicalArchetypes: [], sampleTechnicalQuestions: [] },
      persona: 'analyst', careerName: 'Quant Trader', transcript: [], difficulty: 3,
      slot: 'intro', questionIndex: 0, school,
    }), true],
    ['interview-debrief', (school) => buildDebriefPrompt({
      playbook: { label: 'x', evaluationEmphasis: [] }, careerName: 'Quant Trader',
      transcript: [], technicalAsked: false, school,
    })],
    ['roadmap v1', (school) => buildGeneratePrompt({ careerName: 'Quant Trader', careerSlug: 'q', school })],
    ['roadmap tree', (school) => buildGenerateTreePrompt({ careerName: 'Quant Trader', careerSlug: 'q', school })],
    // The four roadmap-tree branch prompts. `dossier` is deliberately
    // school-free here: these bodies inline the dossier, so a dossier naming
    // the school would make the school-unknown branch pass on the wrong text.
    ['roadmap extend', (school) => buildExtendPrompt({
      ...TREE_CTX, dossier: 'name: Test Student', branchNode: TREE.nodes[2], school,
    })],
    ['roadmap branch build', (school) => buildBranchBuildPrompt({
      ...TREE_CTX, dossier: 'name: Test Student', branchChain: branchChainFrom(TREE.nodes, 'b1'), school,
    })],
    ['roadmap tree patch', (school) => buildTreePatchPrompt({
      ...TREE_CTX, dossier: 'name: Test Student', userMessage: 'what next?', history: [], school,
    })],
    ['roadmap split', (school) => buildSplitPrompt({
      ...TREE_CTX, dossier: 'name: Test Student', decisionId: 'd1', optionId: 'o1', school,
    })],
  ];
  for (const [label, build, roleplay] of SCHOOL_SURFACES) {
    const withSchool = String(build(SCHOOL));
    const without = String(build(''));
    check(`${label}: names the school when it has one`, withSchool.includes(SCHOOL));
    check(`${label}: states the constraint, not just the name`,
      /never name another university's internal club|never list another university's internal club/i.test(withSchool));
    check(`${label}: falls back to open-to-anyone when it has none`,
      !without.includes(SCHOOL) && /not stated|open to any student|open-to-anyone/i.test(without));
    check(`${label}: inherits the persona core`,
      withSchool.includes(roleplay ? ROLEPLAY_MARKER : PERSONA_MARKER));
  }
}

/* ── 3b. Tone balance: critical, not adversarial ──────────────────── */
{
  // Persona v1 was rebalanced after Marco read as contrarian in production: he
  // disagreed by default rather than advising. No single rule caused it —
  // FIVE pointed the same way at once, and the per-reply self-check asked "am
  // I being too soft?" three times with nothing asking the reverse. A model
  // running that checklist every turn learns that agreement is a failure mode.
  //
  // These assertions are the guard against drifting back. They pin the SHAPE
  // of the balance (both directions present), not any particular wording, so
  // the copy can still be edited freely.
  const core = buildSurfacePrompt('chat', { school: SCHOOL });

  // Anti-sycophancy must survive intact — that half was never the problem.
  check('tone: flattery is still called out as a cost',
    /flattery costs you credibility/i.test(core));
  check('tone: still refuses to change its answer under mere pressure',
    /never change a recommendation just because they are unhappy/i.test(core));
  check('tone: still says the hard thing plainly',
    /say the hard thing plainly/i.test(core));
  check('tone: still refuses manufactured balance',
    /never manufacture balance/i.test(core));

  // ...and the counterweights that stop it becoming adversarial.
  check('tone: manufactured disagreement is banned alongside manufactured balance',
    /never manufacture a\s*\n?\s*disagreement|manufacture a disagreement/i.test(core));
  check('tone: contrarianism is named as a credibility cost, not just flattery',
    /contrarianism/i.test(core));
  check('tone: crediting what works is an instruction, not an option',
    /say what is working/i.test(core));
  check('tone: criticism must carry a next step',
    /a problem named without a next\s*\n?\s*step is just criticism/i.test(core));
  check('tone: the reply is aimed at growth, not at grading the plan',
    /better at this/i.test(core) && /not that their plan gets graded/i.test(core));
  check('tone: does not go hunting for faults',
    /never open by looking for what is wrong/i.test(core));
  check('tone: being persuaded by a real argument is explicitly not caving',
    /being persuaded by a good argument is not caving/i.test(core));

  // The self-check is the strongest lever, because it runs on every reply.
  // It has to interrogate BOTH failure modes or it becomes a bias.
  const selfCheck = core.slice(core.indexOf('Check yourself before answering'));
  check('tone: the self-check explicitly runs in both directions',
    /in BOTH directions/i.test(selfCheck));
  check('tone: the self-check asks about unearned harshness, not only softness',
    /disagreeing to sound rigorous/i.test(selfCheck)
    && /ignoring what they got right/i.test(selfCheck));
  check('tone: the self-check still asks about unearned softness',
    /softening a real problem/i.test(selfCheck));
  check('tone: the self-check ends on what to DO',
    /what to DO, not just what is wrong/i.test(selfCheck));

  // A cheap structural read on the balance: the core should not be lopsided
  // toward fault-finding. Counts the imperative counterweights against the
  // criticism-side rules; the point is that neither side is absent.
  const softSignals = (core.match(/what is working|build on what they brought|on their side|warm and direct|not fragile/gi) || []).length;
  check('tone: the core carries several explicit build-them-up instructions',
    softSignals >= 4, `found ${softSignals}`);

  // S10 follow-through. The golden alone would not protect these: a later
  // session can delete any of them and re-run with --update, and the suite goes
  // green on the deletion. Every rule below is one where losing it turns the
  // memory feature into the thing it was specifically designed not to be.
  // Whitespace-flattened: the prompt is hard-wrapped prose, so a rule can sit
  // across a line break and a naive /a b/ misses it. Flattening tests the
  // sentence rather than the column width it happens to be wrapped at.
  const follow = core.slice(core.indexOf('## Follow-through')).replace(/\s+/g, ' ');
  check('follow-through: the section exists on the chat surface',
    core.includes('## Follow-through'));
  check('follow-through: the callback is capped at one per conversation',
    /one callback per conversation/i.test(follow));
  check('follow-through: it names the commitment rather than asking vaguely',
    /by name, not/i.test(follow));
  // The load-bearing one. A coach that scolds a student who fell behind loses
  // exactly the student the feature exists for.
  check('follow-through: never scold and never moralise about a slipped date',
    /never scold and never moralise/i.test(follow));
  check('follow-through: a missed date is answered with a smaller next step',
    /smallest version/i.test(follow) && /offer to move the date/i.test(follow));
  check('follow-through: fabricating a commitment or a past conversation is banned',
    /never invent a commitment, a date or a past conversation/i.test(follow));
  check('follow-through: with no context it opens normally instead of improvising',
    /if the context gives you none, open normally/i.test(follow));
}

/* ── 3b. S10: the follow-through CONTEXT blocks the chat surface consumes ── */
{
  const NOW = Date.parse('2026-07-24T12:00:00Z');
  const tree = {
    version: 2,
    targetCareerSlug: 'x', targetCareerName: 'X',
    nodes: [{
      id: 'w1', shortTitle: 'Modelling', title: 'Modelling',
      steps: [
        { id: 's1', text: 'Finish the DCF course module', done: false, dueAt: '2026-07-21', dueMoves: 2 },
        { id: 's2', text: 'Email two alumni', done: false, dueAt: '2026-07-24' },
        { id: 's3', text: 'Read ch. 4', done: true, dueAt: '2026-07-20' },
      ],
    }],
  };
  const open = collectCommitments(tree, { now: NOW });
  const block = commitmentsPromptBlock(open, { completion: recentCompletion(tree, { now: NOW }) });

  check('commitments block: names the overdue item and says how late it is',
    block.includes('Finish the DCF course module') && /3 days OVERDUE/.test(block));
  check('commitments block: says "due TODAY" for today, not "0 days"',
    /due TODAY/.test(block));
  check('commitments block: surfaces the reschedule count',
    /already moved 2x/.test(block));
  check('commitments block: a completed commitment is not offered as something to chase',
    !block.includes('Read ch. 4'));
  check('commitments block: reports the recent completion ratio',
    /1 of 3 dated steps completed/.test(block));
  check('commitments block: carries the never-scold instruction to the model',
    /Never scold/i.test(block) && /what got in the way/i.test(block));
  check('commitments block: empty state emits NOTHING (no invented callback)',
    commitmentsPromptBlock([], {}) === '');
}

/* ── 4. Surface-owned constraints survived the refactor ───────────── */
{
  const HARD = [
    ['chat', 'under about 150 words'],
    ['chat', 'code blocks and nested lists are not'],
    ['career-switch', 'Under 120 words'],
    ['career-switch', 'open AI Career Advisor from your home page'],
    ['career-switch', 'never invent a job title'],
    ['interview-turn', 'Do not coach, score or explain'],
    ['roadmap-waypoint', 'no headers'],
    ['opportunities', 'never invent a program'],
  ];
  for (const [key, needle] of HARD) {
    check(`${key}: keeps its hard constraint "${needle.slice(0, 40)}"`,
      built[key].includes(needle));
  }

  // The JSON contracts live downstream of the composer; assert the real
  // builders still emit them.
  const turn = buildTurnPrompt({
    playbook: { label: 'x', behavioralFocus: [], technicalArchetypes: [], sampleTechnicalQuestions: [] },
    persona: 'analyst', careerName: 'Quant Trader', transcript: [], difficulty: 3,
    slot: 'intro', questionIndex: 0, school: SCHOOL,
  });
  check('interview turn: JSON contract intact', turn.includes('"question": "<your next interviewer turn, in persona>"'));
  check('interview turn: fenced resume/transcript intact',
    turn.includes('[RESUME START]') && turn.includes('[TRANSCRIPT START]'));

  const weekly = buildWeeklyPlanPrompt({
    careerName: 'Quant Trader', node: { title: 'n' }, stepLines: [], planPhases: [],
    prevTasks: [], notes: [], week: '2026-W30', school: SCHOOL,
  });
  check('weekly plan: JSON contract intact', weekly.includes('{"tasks":[{"label":"...","stepId":"id-or-null"'));

  const opp = buildOpportunityPrompt({ evidence: '=== WEB EVIDENCE ===\nx', dossier: 'D', careerName: 'C', gaps: [], school: SCHOOL });
  check('opportunities: evidence still leads the prompt', opp.startsWith('=== WEB EVIDENCE'));

  // The four roadmap-tree prompts. These carry the tree's structural JSON
  // contract — node ids, parentId wiring, the patch envelope — and there is no
  // `roadmap:` gate that would catch a break. Pinned HERE so the contract fails
  // this suite before a persona edit can quietly change what the tree parses.
  {
    const extend = buildExtendPrompt({ ...TREE_CTX, branchNode: TREE.nodes[2], school: SCHOOL });
    check('roadmap extend: JSON contract intact',
      extend.includes('{"nodes":[{"id":"ext1","parentId":"b1","depth":N,"type":"waypoint"')
      && extend.includes('"steps":[{"id":"ext1-st1"')
      && extend.includes('"decisions":[]}'));
    check('roadmap extend: keeps its hard constraints',
      // WS-multi (2026-07-22): extend builds a 3-6 NODE sub-roadmap and MAY carry
      // ONE critical-choice fork (a decision + two option-root waypoints); the tip
      // is a fresh confidence-5 start that decays along the new hops.
      extend.includes('Add 3-6 NEW NODES TOTAL')
      && extend.includes('let confidence DECAY along the new hops')
      && extend.includes('ONE critical-choice fork')
      && extend.includes('Concrete student actions only. No markdown.'));
    check('roadmap extend: keeps the plain-style rules', extend.includes('BANNED words/phrases'));
    check('roadmap extend: serialises the live tree', extend.includes('"targetCareerSlug":"quant-trader"'));

    const branch = buildBranchBuildPrompt({
      ...TREE_CTX, branchChain: branchChainFrom(TREE.nodes, 'b1'), school: SCHOOL,
    });
    check('roadmap branch build: JSON contract intact',
      branch.includes('# Output — ONLY JSON')
      && branch.includes('{"nodes":[{"id":"<same id>"')
      && branch.includes('"steps":[{"id":"<nodeId>-st1"'));
    check('roadmap branch build: keeps the id-preservation rule',
      branch.includes('Keep every node id EXACTLY as given')
      && branch.includes('One output node per input id — never add, drop, or rename ids.'));
    check('roadmap branch build: lists the nodes to rewrite', branch.includes('- id "b1": currently'));

    const patch = buildTreePatchPrompt({ ...TREE_CTX, userMessage: 'done with MATH 20700', history: [], replyMaxChars: 240 });
    check('roadmap tree patch: JSON contract intact',
      patch.includes('{"intent":"question|update","reply":"...","roadmapPatch":null|{"summary":"...","nodes":[{"id":"...","done":true}]}}'));
    check('roadmap tree patch: keeps its hard constraints',
      patch.includes('Reply with STRICT JSON only')
      && patch.includes('"reply" max 240 chars')
      && patch.includes('Do NOT change targetCareerSlug or targetCareerName')
      && patch.includes('For full career pivot, set roadmapPatch null'));

    const split = buildSplitPrompt({
      ...TREE_CTX, decisionId: 'd1', optionId: 'o1', school: SCHOOL,
    });
    check('roadmap split: JSON contract intact',
      split.includes('{"nodes":[{"id":"new1","parentId":"b1","depth":N,"type":"waypoint"')
      && split.includes('"steps":[{"id":"new1-st1"')
      && split.includes('"decisions":[]}'));
    check('roadmap split: keeps its hard constraints',
      split.includes('Add 3-6 new nodes')
      && split.includes('confidence decreases with depth; max depth 5')
      && split.includes('Include at most 1 new unresolved decision')
      && split.includes('Concrete student actions only.'));
    check('roadmap split: names the chosen decision and option',
      split.includes('Desk or research?') && split.includes('Chosen option: Desk'));
  }
}

/* ── 5. thinkingBudget: 0 on every JSON-mode caller ───────────────── */
{
  const jsonMode = [
    'functions/_lib/gemini-json.js',
    'functions/career-analysis.js',
  ];
  for (const rel of jsonMode) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    check(`${rel}: sets thinkingBudget: 0`, /thinkingBudget:\s*0/.test(src));
  }
  // Anything else that builds a responseMimeType JSON body must route through
  // one of those two — a third path would be a silent budget regression.
  const fnDir = join(ROOT, 'functions');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = readFileSync(full, 'utf8');
      if (/responseMimeType:\s*'application\/json'/.test(src) && !/thinkingBudget:\s*0/.test(src)) {
        offenders.push(full.slice(ROOT.length + 1));
      }
    }
  };
  walk(fnDir);
  check('no JSON-mode body is built outside a thinkingBudget: 0 caller',
    offenders.length === 0, offenders.join(', '));
}

/* ── 6. Goldens ───────────────────────────────────────────────────── */
{
  let drift = 0;
  for (const key of SURFACE_KEYS) {
    const file = join(GOLDEN_DIR, `${key}.txt`);
    const current = buildSurfacePrompt(key, {
      school: SURFACES[key].roleplay ? '' : SCHOOL,
      omitSchool: !!SURFACES[key].roleplay,
    });
    if (UPDATE || !existsSync(file)) {
      writeFileSync(file, current);
      console.log(`  ${UPDATE ? 'updated' : 'created'} golden - ${key}`);
      continue;
    }
    const golden = readFileSync(file, 'utf8');
    if (golden === current) { console.log(`  ok - golden matches - ${key}`); continue; }
    drift += 1;
    failures += 1;
    console.error(`  FAIL - golden drifted - ${key} (re-run with --update if intended)`);
  }
  if (!drift) check(`goldens pinned at persona ${PERSONA_VERSION}`, true);
}

/* ── 7. Optional live pass ────────────────────────────────────────── */
if (LIVE) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('  SKIP - --live needs GEMINI_API_KEY');
  } else {
    const FIXTURES = [
      'Should I take Real Analysis next quarter or wait a year?',
      'I bombed my first interview and I think I should give up on quant.',
      'what do i even do this summer',
      // Tone probe (persona v2): a genuinely sound plan. If Marco picks a
      // fight with this one, he is disagreeing by reflex rather than judging.
      'My plan is Real Analysis in the fall, keep building my backtester over '
        + 'the summer, and apply to Jane Street and Citadel in September. '
        + 'What do you think?',
    ];
    // The retired default here (gemini-2.5-flash) meant --live 404'd on every
    // call: this file's own repo marks 2.x as hard-retired. Use the shared
    // resolver so the live pass tracks the models the product actually calls.
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    for (const message of FIXTURES) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: built.chat }] },
            contents: [{ role: 'user', parts: [{ text: message }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!resp.ok) {
        check(`live: "${message.slice(0, 32)}…" answered`, false, `HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const words = text.split(/\s+/).filter(Boolean).length;
      check(`live: "${message.slice(0, 32)}…" stays under 180 words`, words < 180, `${words} words`);
      const used = BANNED.filter((b) => text.toLowerCase().includes(b.toLowerCase()));
      check(`live: "${message.slice(0, 32)}…" uses no banned phrase`, used.length === 0, used.join(', '));
      console.log(`\n--- reply (${words} words) ---\n${text}\n`);
    }
  }
}

if (failures) {
  console.error(`\ntest:marco-voice FAIL — ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\ntest:marco-voice PASS');
