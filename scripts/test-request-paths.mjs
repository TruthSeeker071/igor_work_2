// Request-path tests for metered Pages Functions — the structural blind spot.
//
// `test:chat-turn` exists because a scope error in `runChatTurn` took Marco
// down for two weeks with every gate green: nothing in the repo executed a
// request path. This file extends that pattern to the other endpoints that
// SPEND a user budget before doing model work. For each one it asserts the
// two things a prompt/contract suite structurally cannot:
//   1. the handler EXECUTES — no ReferenceError/TypeError from our own code
//      surfaces on the happy or the failure path;
//   2. a failure the user did not cause refunds what the request spent
//      (the roadmap lifetime allowance is the sharpest case: 1 per life on
//      free — an unrefunded 500 would consume a user's only AI roadmap).
//
// It also proves the career-rank cache path end-to-end (miss → absent block →
// waitUntil fill → hit → block in the next prompt), which had never executed
// anywhere before this file — its first turn is a deliberate cache miss and
// the fill hides inside waitUntil.
//
// Each section was validated against a reintroduced defect (a parsed-body
// rename of the exact `payload`→`reqBody` class) before being trusted.
//
// Run: npm run test:endpoints

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest as careerRoadmap } from '../functions/career-roadmap.js';
import { onRequest as careerFocus } from '../functions/career-focus.js';
import { onRequest as careerSwitchChat } from '../functions/career-switch-chat.js';
import { onRequestPost as mockInterviewPost } from '../functions/mock-interview.js';
import { onRequest as portalSnapshot } from '../functions/portal-snapshot.js';
import { runChatTurn } from '../functions/chat.js';
import { checkFeatureLimit } from '../functions/_lib/plan-limits.js';
import { DIM_COUNT } from '../functions/_lib/onet/constants.js';
import { MAX_STEPS_PER_NODE } from '../functions/_lib/roadmap-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = 'probe@flightway.ai';
const BASE = 'https://flightwayjacobprototype.pages.dev';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };

// ---------------------------------------------------------------------------
// Fakes — same shapes as test-chat-turn.mjs, plus a configurable D1.

function fakeKv() {
  const map = new Map();
  return {
    map,
    get: async (k, type) => {
      if (!map.has(k)) return null;
      const v = map.get(k);
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v) => { map.set(k, String(v)); },
    delete: async (k) => { map.delete(k); },
    list: async () => ({ keys: [] }),
  };
}

/**
 * D1 stub: `handlers` are [{ re, first?, run?, all? }] tried in order against the
 * SQL. The session lookup always answers with a live row; everything else
 * defaults to "nothing stored".
 */
function fakeDb(handlers = []) {
  return {
    // D1's real batch(): the caller prepares ONCE and binds per row, so bind()
    // must hand back a fresh statement rather than mutate a shared one. The
    // beacon (functions/_lib/events.js writeEvents) is the first caller here to
    // depend on that, and getting it wrong would have looked like "the last
    // event overwrote all the others".
    async batch(list) {
      const out = [];
      for (const s of list || []) out.push(await s.run());
      return out;
    },
    prepare(sql) {
      const stmt = (bound) => ({
        bind: (...args) => stmt(args),
        async first() {
          for (const h of handlers) {
            if (h.re.test(sql) && h.first) return typeof h.first === 'function' ? h.first(sql, bound) : h.first;
          }
          if (/FROM sessions/i.test(sql)) {
            return { email: EMAIL, expires_at: new Date(Date.now() + 864e5).toISOString() };
          }
          return null;
        },
        async run() {
          for (const h of handlers) {
            if (h.re.test(sql) && h.run) return h.run(sql, bound);
          }
          return { success: true };
        },
        async all() {
          for (const h of handlers) {
            if (h.re.test(sql) && h.all) return typeof h.all === 'function' ? h.all(sql, bound) : h.all;
          }
          return { results: [] };
        },
      });
      return stmt([]);
    },
  };
}

function makeContext({ pathName, body, db, kv, env: envOverrides = {} } = {}) {
  const env = {
    GEMINI_API_KEY: 'test-key',
    SESSION_SECRET: 'test-secret',
    DB: db || fakeDb(),
    COACH_KV: kv || fakeKv(),
    ...envOverrides,
  };
  const waits = [];
  const request = {
    method: 'POST',
    url: `${BASE}${pathName}`,
    headers: new Headers({ cookie: 'fw_session=probe-token', 'content-type': 'application/json' }),
    json: async () => body,
  };
  return {
    request,
    env,
    waits,
    waitUntil: (p) => { waits.push(Promise.resolve(p).catch(() => {})); },
  };
}

/** Swap global fetch; serve /data artifacts from disk so store.js works. */
async function withUpstream(gemini, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url && url.url ? url.url : url);
    const dataIdx = u.indexOf('/data/onet/');
    if (dataIdx >= 0) {
      const rel = u.slice(dataIdx + 1).split('?')[0];
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      const buf = fs.readFileSync(file);
      const type = rel.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return new Response(buf, { status: 200, headers: { 'content-type': type } });
    }
    return gemini(u, opts);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const geminiOk = (text) => async () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

// 404 (retired model) exhausts a cascade without the 800/2000ms retry sleeps,
// so the failure paths run fast. gemini-json advances models on it — that
// behavior is itself asserted below.
const geminiGone = async () => new Response(
  JSON.stringify({ error: { message: 'model not found' } }),
  { status: 404, headers: { 'content-type': 'application/json' } },
);

/** Console spy: an "our fault" line is a scope/type error from our own code. */
function spyConsole() {
  const lines = [];
  const origErr = console.error; const origWarn = console.warn;
  console.error = (...a) => { lines.push(a.map(String).join(' ')); };
  console.warn = (...a) => { lines.push(a.map(String).join(' ')); };
  return {
    lines,
    ourFault: () => lines.find((l) => /ReferenceError|is not defined|is not a function|Cannot read (properties|property)/.test(l)),
    restore: () => { console.error = origErr; console.warn = origWarn; },
  };
}

const featureUsed = async (kv, feature) => (await checkFeatureLimit(
  { PAYWALL_ENABLED: 'true', COACH_KV: kv }, EMAIL, feature, { spend: false, plan: 'free' },
)).used;

const rateCount = async (kv, key) => Number(await kv.get(`auth_rate:${key}`)) || 0;

// ---------------------------------------------------------------------------
console.log('career-roadmap generate: a failed generation refunds the LIFETIME allowance:');
{
  const kv = fakeKv();
  const ctx = makeContext({
    pathName: '/career-roadmap',
    body: { action: 'generate', careerSlug: 'test-career', careerName: 'Test Career' },
    kv,
    env: { PAYWALL_ENABLED: 'true' },
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await careerRoadmap(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `the generate path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status >= 500, `an exhausted upstream maps to a 5xx (got ${res && res.status})`);
  assert(await featureUsed(kv, 'roadmap-generate') === 0,
    'the lifetime roadmap-generate spend came back');
  assert(await rateCount(kv, `roadmap-gen:${EMAIL}`) === 0,
    'the roadmap-gen rate slot came back');
}

console.log('career-roadmap generate: a bad request costs nothing:');
{
  const kv = fakeKv();
  const ctx = makeContext({
    pathName: '/career-roadmap',
    body: { action: 'generate', careerSlug: '!!bad slug!!', careerName: '' },
    kv,
    env: { PAYWALL_ENABLED: 'true' },
  });
  const res = await careerRoadmap(ctx);
  assert(res.status === 400, `an invalid slug is rejected up front (got ${res.status})`);
  assert(kv.map.size === 0, 'and writes no counter at all');
}

console.log('career-roadmap generate: a rate wall does not eat the lifetime allowance:');
{
  const kv = fakeKv();
  await kv.put(`auth_rate:roadmap-gen:${EMAIL}`, '999');
  const ctx = makeContext({
    pathName: '/career-roadmap',
    body: { action: 'generate', careerSlug: 'test-career', careerName: 'Test Career' },
    kv,
    env: { PAYWALL_ENABLED: 'true' },
  });
  let res = null;
  await withUpstream(geminiGone, async () => { res = await careerRoadmap(ctx); });
  assert(res && res.status === 429, `an exhausted rate slot answers 429 (got ${res && res.status})`);
  // The rate wall is user-caused, so it must be hit BEFORE the spend — a
  // refund cannot cover it, because the spend flag only flips afterwards.
  assert(await featureUsed(kv, 'roadmap-generate') === 0,
    'and the one free AI roadmap is still there');
}

// ---------------------------------------------------------------------------
// career-roadmap's other ten actions. `generate` above was the only branch any
// suite had ever executed, and the ReferenceError that took roadmap down for
// two days lived in this half of the file. One executing case each.

/** A tree that survives normalizeRoadmap unchanged (verified: 3 nodes, 1 decision). */
function roadmapTree() {
  return {
    version: 2,
    targetCareerSlug: 'test-career',
    targetCareerName: 'Test Career',
    trunk: { id: 'trunk', title: 'Today', summary: 'Where you are now' },
    activePath: ['trunk', 'wp1', 'wp2'],
    nodes: [
      {
        id: 'wp1', parentId: 'trunk', title: 'Waypoint One', shortTitle: 'WP1',
        depth: 1, type: 'waypoint', pathRole: 'spine', horizon: 'next_month',
        whyItMatters: 'first', steps: [{ id: 's1', text: 'Do A', done: false }, { id: 's2', text: 'Do B', done: false }],
      },
      {
        id: 'wp2', parentId: 'wp1', title: 'Waypoint Two', shortTitle: 'WP2',
        depth: 2, type: 'waypoint', pathRole: 'spine', horizon: 'next_semester',
        whyItMatters: 'second', steps: [{ id: 's1', text: 'Do C', done: false }],
      },
      {
        id: 'br1', parentId: 'wp1', title: 'Branch Option', shortTitle: 'BR1',
        depth: 2, type: 'waypoint', pathRole: 'branch', horizon: 'longer_term',
        whyItMatters: 'alt', steps: [{ id: 's1', text: 'Do D', done: false }],
      },
    ],
    decisions: [{
      id: 'd1',
      nodeId: 'wp1',
      prompt: 'Which path?',
      options: [
        { id: 'o1', label: 'Option One', childNodeId: 'wp2' },
        { id: 'o2', label: 'Option Two', childNodeId: 'br1' },
      ],
    }],
  };
}

const userBlobWithVectors = () => ({
  name: 'Probe',
  scores: { tech: 70, business: 55 },
  objectiveVector: {
    schemaId: 'onet-lv-161-v1',
    values: Array.from({ length: DIM_COUNT }, () => 30),
  },
});

/** D1 that serves the roadmap + a user blob and records every write. */
function roadmapDb({ roadmap = roadmapTree(), blob = userBlobWithVectors(), saves = [], userSaves = [] } = {}) {
  return fakeDb([
    { re: /FROM roadmaps/i, first: () => (roadmap ? { payload: JSON.stringify(roadmap) } : null) },
    {
      re: /INTO roadmaps/i,
      run: (sql, args) => { saves.push(JSON.parse(args[1])); return { success: true }; },
    },
    { re: /FROM user_profiles/i, first: () => (blob ? { payload: JSON.stringify(blob) } : null) },
    {
      re: /INTO user_profiles/i,
      run: (sql, args) => { userSaves.push(JSON.parse(args[1])); return { success: true }; },
    },
  ]);
}

/** Runs one career-roadmap action and reports whether OUR code threw. */
async function runRoadmapAction(body, { db, kv, gemini = geminiGone, env } = {}) {
  const ctx = makeContext({ pathName: '/career-roadmap', body, db, kv: kv || fakeKv(), env });
  const spy = spyConsole();
  let res = null;
  await withUpstream(gemini, async () => { res = await careerRoadmap(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  return { res, ourFault: spy.ourFault(), ctx };
}

console.log('career-roadmap generate: a cap refusal hands back the rate slot it took:');
{
  const kv = fakeKv();
  // Spend the one free lifetime generation, then ask for another.
  await checkFeatureLimit({ PAYWALL_ENABLED: 'true', COACH_KV: kv }, EMAIL, 'roadmap-generate', { plan: 'free' });
  const ctx = makeContext({
    pathName: '/career-roadmap',
    body: { action: 'generate', careerSlug: 'test-career', careerName: 'Test Career' },
    kv,
    env: { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' },
    db: fakeDb([{ re: /FROM users\b/i, first: { email: EMAIL, plan: 'free', plan_source: null } }]),
  });
  let res = null;
  await withUpstream(geminiGone, async () => { res = await careerRoadmap(ctx); });
  assert(res && res.status === 402, `a spent lifetime allowance answers 402 (got ${res && res.status})`);
  assert((await res.json()).upgrade === true, 'with upgrade:true, so the client renders a cap card');
  assert(await rateCount(kv, `roadmap-gen:${EMAIL}`) === 0,
    'and the rate slot the cap check took on the way in comes back');
}

console.log('career-roadmap chat pivot: a failed regeneration refunds what it spent:');
{
  const kv = fakeKv();
  const ctx = makeContext({
    pathName: '/career-roadmap',
    body: {
      action: 'chat',
      careerSlug: 'test-career',
      careerName: 'Test Career',
      // isRoadmapRegenerateIntent must fire, or this is an ordinary chat turn.
      userMessage: 'Actually, regenerate my roadmap for data science instead.',
      currentRoadmap: roadmapTree(),
    },
    kv,
    db: roadmapDb(),
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await careerRoadmap(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  assert(!spy.ourFault(), `the pivot path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status >= 400, `a dead upstream is an error, not a crash (got ${res && res.status})`);
  // The pivot spends a roadmap-gen slot on the way in; a failure it caused
  // must hand it back, exactly like the generate path does.
  assert(await rateCount(kv, `roadmap-gen:${EMAIL}`) === 0,
    'the roadmap-gen rate slot came back');
  assert(await featureUsed(kv, 'roadmap-generate') === 0,
    'and the lifetime allowance was never left spent');
}

// ---------------------------------------------------------------------------
// career-focus IS the primary roadmap-build flow: the roadmap page records the
// focus first, and when that already returns a roadmap the client never reaches
// the metered action:'generate' path. So the "AI roadmap generations" allowance
// has to be spent HERE, or a free user builds their first roadmap for free and
// the usage meter stays "1 of 1 left". These pin that the spend and its refund
// live on this path too — the class of bug that put the meter out of sync.

console.log('career-focus build: a spent lifetime allowance blocks the auto-build (no free regen):');
{
  const kv = fakeKv();
  // Free user already spent their one lifetime AI roadmap.
  await checkFeatureLimit({ PAYWALL_ENABLED: 'true', COACH_KV: kv }, EMAIL, 'roadmap-generate', { plan: 'free' });
  const ctx = makeContext({
    pathName: '/career-focus',
    body: { slug: 'test-career', name: 'Test Career', source: 'build_roadmap' },
    kv,
    env: { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' },
    db: roadmapDb({ roadmap: null }),
  });
  const spy = spyConsole();
  let res = null;
  // geminiGone would ERROR if generation were attempted — it must not be.
  await withUpstream(geminiGone, async () => { res = await careerFocus(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  assert(!spy.ourFault(), `career-focus runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `career-focus still answers 200 (got ${res && res.status})`);
  const body = res && await res.json();
  assert(body && body.roadmapCapped === true && body.roadmap === null,
    'a capped free user gets roadmap:null + roadmapCapped, so the client falls through to the 402 upgrade');
  assert(await featureUsed(kv, 'roadmap-generate') === 1,
    'the cap check never double-spends, and it never regenerates a roadmap for free');
}

console.log('career-focus build: a failed auto-generation refunds the LIFETIME allowance:');
{
  const kv = fakeKv();
  const ctx = makeContext({
    pathName: '/career-focus',
    body: { slug: 'test-career', name: 'Test Career', source: 'build_roadmap' },
    kv,
    env: { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' },
    db: roadmapDb({ roadmap: null }),
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await careerFocus(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  assert(!spy.ourFault(), `the metered build path runs clean${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `focus is still recorded even when the build fails (got ${res && res.status})`);
  assert(await featureUsed(kv, 'roadmap-generate') === 0,
    'the spend it took up front came back when the generation we caused failed — the one free roadmap is intact');
}

console.log('career-roadmap follow/choose: the tree-graph writes execute and persist:');
{
  const saves = [];
  const follow = await runRoadmapAction(
    { action: 'follow', targetNodeId: 'br1', currentRoadmap: roadmapTree() },
    { db: roadmapDb({ saves }) },
  );
  assert(!follow.ourFault, `follow runs without a scope/type error${follow.ourFault ? ` — ${follow.ourFault}` : ''}`);
  assert(follow.res && follow.res.status === 200, `follow answers 200 (got ${follow.res && follow.res.status})`);
  // A follow onto a branch persists as a branch FOCUS, not an activePath edit:
  // normalizeRoadmapTree recomputes activePath from the decisions on every save,
  // so focusTracker is the only place the choice can survive a reload.
  assert(saves.length === 1 && saves[0].focusTracker?.activeBranchKey === 'br1',
    'follow persists the followed branch as the active branch focus');

  const chooseSaves = [];
  const choose = await runRoadmapAction(
    { action: 'choose', decisionId: 'd1', optionId: 'o2', currentRoadmap: roadmapTree() },
    { db: roadmapDb({ saves: chooseSaves }) },
  );
  assert(!choose.ourFault, `choose runs without a scope/type error${choose.ourFault ? ` — ${choose.ourFault}` : ''}`);
  assert(choose.res && choose.res.status === 200, `choose answers 200 (got ${choose.res && choose.res.status})`);
  assert(chooseSaves.length === 1
    && (chooseSaves[0].decisions || []).some((d) => d.id === 'd1' && d.chosenOptionId === 'o2'),
    'choose persists the chosen option on the decision');

  const missing = await runRoadmapAction(
    { action: 'follow', currentRoadmap: roadmapTree() },
    { db: roadmapDb() },
  );
  assert(missing.res && missing.res.status === 400, `follow without a targetNodeId is a 400 (got ${missing.res && missing.res.status})`);

  // §3A.4: a follow to an id not in the tree must 400, not silently reset the
  // path to bare ['trunk'] and discard the committed branch.
  const ghostSaves = [];
  const ghost = await runRoadmapAction(
    { action: 'follow', targetNodeId: 'ghost-node', currentRoadmap: roadmapTree() },
    { db: roadmapDb({ saves: ghostSaves }) },
  );
  assert(ghost.res && ghost.res.status === 400, `a follow to an unknown node is a 400 (got ${ghost.res && ghost.res.status})`);
  assert(ghostSaves.length === 0, 'and an unknown-node follow persists nothing');
}

console.log('career-roadmap split/extend: the model-backed graph grafts execute:');
{
  const splitSubtree = JSON.stringify({
    nodes: [{
      id: 'sp1', parentId: 'br1', title: 'Grafted Waypoint', shortTitle: 'GRAFT', depth: 3,
      type: 'waypoint', horizon: 'longer_term', whyItMatters: 'grafted',
      steps: [{ text: 'Grafted step one' }, { text: 'Grafted step two' }, { text: 'Grafted step three' }],
    }],
  });
  const saves = [];
  const split = await runRoadmapAction(
    { action: 'split', decisionId: 'd1', optionId: 'o2', currentRoadmap: roadmapTree() },
    { db: roadmapDb({ saves }), gemini: geminiOk(splitSubtree) },
  );
  assert(!split.ourFault, `split runs without a scope/type error${split.ourFault ? ` — ${split.ourFault}` : ''}`);
  assert(split.res && split.res.status === 200, `split answers 200 (got ${split.res && split.res.status})`);
  const splitBody = split.res && await split.res.json();
  assert(splitBody && (splitBody.roadmap.nodes || []).some((n) => n.id === 'sp1'),
    'split grafts the generated subtree onto the chosen option');

  const extendSaves = [];
  const extend = await runRoadmapAction(
    { action: 'extend', branchNodeId: 'wp2', currentRoadmap: roadmapTree() },
    {
      db: roadmapDb({ saves: extendSaves }),
      gemini: geminiOk(JSON.stringify({
        nodes: [{
          id: 'ex1', parentId: 'wp2', title: 'Extended Waypoint', shortTitle: 'EXT', depth: 3,
          type: 'waypoint', horizon: 'longer_term', whyItMatters: 'extended',
          steps: [{ text: 'Extended step one' }, { text: 'Extended step two' }, { text: 'Extended step three' }],
        }],
      })),
    },
  );
  assert(!extend.ourFault, `extend runs without a scope/type error${extend.ourFault ? ` — ${extend.ourFault}` : ''}`);
  assert(extend.res && extend.res.status === 200, `extend answers 200 (got ${extend.res && extend.res.status})`);
  const extendBody = extend.res && await extend.res.json();
  assert(extendBody && (extendBody.roadmap.nodes || []).length > roadmapTree().nodes.length,
    'extend adds nodes to the committed branch');

  const dead = await runRoadmapAction(
    { action: 'split', decisionId: 'd1', optionId: 'o2', currentRoadmap: roadmapTree() },
    { db: roadmapDb() },
  );
  assert(!dead.ourFault, `split with a dead upstream still runs clean${dead.ourFault ? ` — ${dead.ourFault}` : ''}`);
  assert(dead.res && dead.res.status === 502, `a dead upstream is a 502, not a crash (got ${dead.res && dead.res.status})`);
}

console.log('career-roadmap split/extend: a fruitless model run refunds the rate slot it spent (§3A.1/§3A.2):');
{
  // §3A.1: a split whose model returns no graftable nodes must not persist a
  // false "you're now on the X path" success — and must refund its rate slot.
  const kv = fakeKv();
  const emptySaves = [];
  const emptySplit = await runRoadmapAction(
    { action: 'split', decisionId: 'd1', optionId: 'o2', currentRoadmap: roadmapTree() },
    { db: roadmapDb({ saves: emptySaves }), kv, gemini: geminiOk(JSON.stringify({ nodes: [] })) },
  );
  assert(!emptySplit.ourFault, `an empty split runs clean${emptySplit.ourFault ? ` — ${emptySplit.ourFault}` : ''}`);
  assert(emptySplit.res && emptySplit.res.status === 502,
    `a split that grafts nothing is a 502, not a false success (got ${emptySplit.res && emptySplit.res.status})`);
  assert(emptySaves.length === 0, 'and the empty split persists nothing');
  assert(await rateCount(kv, `roadmap-split:${EMAIL}`) === 0,
    'the empty split spends then refunds its rate slot (net 0)');

  // §3A.2: a dead-upstream extend refunds the SAME shared roadmap-split slot.
  const kv2 = fakeKv();
  const deadExtend = await runRoadmapAction(
    { action: 'extend', branchNodeId: 'wp2', currentRoadmap: roadmapTree() },
    { db: roadmapDb(), kv: kv2 },
  );
  assert(deadExtend.res && deadExtend.res.status === 502,
    `a dead-upstream extend is a 502 (got ${deadExtend.res && deadExtend.res.status})`);
  assert(await rateCount(kv2, `roadmap-split:${EMAIL}`) === 0,
    'the failed extend refunds the shared roadmap-split slot');
}

console.log('career-roadmap gap-progress: the objective vector write is absolute and idempotent:');
{
  const userSaves = [];
  const body = {
    action: 'gap-progress',
    dimIndex: 12,
    gapLabel: 'Mathematics',
    base: 40,
    target: 80,
    doneCount: 2,
    totalCount: 4,
  };
  const first = await runRoadmapAction(body, { db: roadmapDb({ userSaves }) });
  assert(!first.ourFault, `gap-progress runs without a scope/type error${first.ourFault ? ` — ${first.ourFault}` : ''}`);
  assert(first.res && first.res.status === 200, `gap-progress answers 200 (got ${first.res && first.res.status})`);
  const firstBody = await first.res.json();
  assert(firstBody.objectivePatched === true && firstBody.dimIndex === 12,
    'the response reports the patched dimension');
  assert(firstBody.value > 40 && firstBody.value < 80,
    `the patched value lands inside the gap span (got ${firstBody.value})`);
  const savedDims = userSaves[0]?.vectors?.objectiveAiPatch?.dimensions || [];
  assert(userSaves.length === 1 && savedDims.some((d) => d.index === 12 && d.value === firstBody.value),
    'the write persists the patched dimension at its v2 user-model path');

  // Absolute recompute: the same inputs against the ALREADY-patched blob must
  // land on the same value — this is the single-server-side-writer invariant.
  const patched = userSaves[0];
  const secondSaves = [];
  const second = await runRoadmapAction(body, {
    db: fakeDb([
      { re: /FROM roadmaps/i, first: null },
      { re: /FROM user_profiles/i, first: () => ({ payload: JSON.stringify(patched) }) },
      { re: /INTO user_profiles/i, run: (sql, args) => { secondSaves.push(JSON.parse(args[1])); return { success: true }; } },
    ]),
  });
  const secondBody = await second.res.json();
  assert(secondBody.value === firstBody.value,
    `replaying the same progress is idempotent (${firstBody.value} → ${secondBody.value})`);

  const bad = await runRoadmapAction(
    { action: 'gap-progress', dimIndex: 999, gapLabel: 'x', base: 0, target: 1, doneCount: 0, totalCount: 1 },
    { db: roadmapDb() },
  );
  assert(bad.res && bad.res.status === 400, `an out-of-range dimIndex is rejected (got ${bad.res && bad.res.status})`);
}

console.log('career-roadmap gap-checklists / step-elaborate / waypoint-plan / branch-build: each executes:');
{
  const checklists = await runRoadmapAction(
    {
      action: 'gap-checklists',
      soc: '13-2041.00',
      careerName: 'Test Career',
      gaps: [{ dimIndex: 12, name: 'Mathematics', domain: 'skills', user: 40, target: 80 }],
    },
    {
      db: roadmapDb(),
      gemini: geminiOk(JSON.stringify({
        checklists: [{ index: 12, actions: ['Work five problem sets', 'Sit the placement exam'] }],
      })),
    },
  );
  assert(!checklists.ourFault, `gap-checklists runs without a scope/type error${checklists.ourFault ? ` — ${checklists.ourFault}` : ''}`);
  assert(checklists.res && checklists.res.status === 200,
    `gap-checklists answers 200 (got ${checklists.res && checklists.res.status})`);

  const kv = fakeKv();
  const elaborate = await runRoadmapAction(
    { action: 'step-elaborate', nodeId: 'wp1', itemText: 'Work through the first three chapters.' },
    { db: roadmapDb(), kv, gemini: geminiOk('Start with the exercises, not the prose.') },
  );
  assert(!elaborate.ourFault, `step-elaborate runs without a scope/type error${elaborate.ourFault ? ` — ${elaborate.ourFault}` : ''}`);
  assert(elaborate.res && elaborate.res.status === 200,
    `step-elaborate answers 200 (got ${elaborate.res && elaborate.res.status})`);
  assert([...kv.map.keys()].some((k) => k.startsWith('elab:')),
    'a question-less elaboration caches its answer');

  const planSaves = [];
  const waypoint = await runRoadmapAction(
    { action: 'waypoint-plan', nodeId: 'wp1' },
    {
      db: roadmapDb({ saves: planSaves }),
      gemini: geminiOk(JSON.stringify({
        overview: 'One semester, one focus.',
        phases: [{
          title: 'Foundations', weeks: 'Weeks 1-3', focus: 'get moving',
          items: [{ text: 'Read chapters 1-3 of Rudin', kind: 'reading', stepId: 's1', method: 'One chapter a week.' }],
        }],
        cadence: [{ label: 'Textbook block', freq: 'Mon/Wed/Fri mornings' }],
        protocol: 'Cap stuck-time at 20 minutes.',
        baseCase: 'Finish the book.',
        aspirational: 'Finish it and the problem sets.',
      })),
    },
  );
  assert(!waypoint.ourFault, `waypoint-plan runs without a scope/type error${waypoint.ourFault ? ` — ${waypoint.ourFault}` : ''}`);
  assert(waypoint.res && waypoint.res.status === 200,
    `waypoint-plan answers 200 (got ${waypoint.res && waypoint.res.status})`);
  assert(planSaves.some((r) => (r.nodes || []).some((n) => n.id === 'wp1' && n.semesterPlan?.plan)),
    'the generated plan is persisted onto its roadmap node, not just KV');

  const branchSaves = [];
  const branch = await runRoadmapAction(
    { action: 'branch-build', branchNodeId: 'br1' },
    {
      db: roadmapDb({ saves: branchSaves }),
      gemini: geminiOk(JSON.stringify({
        nodes: [{
          id: 'br1', title: 'Built Branch', shortTitle: 'BUILT', whyItMatters: 'now real',
          steps: [{ text: 'Built step one' }, { text: 'Built step two' }, { text: 'Built step three' }],
        }],
      })),
    },
  );
  assert(!branch.ourFault, `branch-build runs without a scope/type error${branch.ourFault ? ` — ${branch.ourFault}` : ''}`);
  assert(branch.res && branch.res.status === 200,
    `branch-build answers 200 (got ${branch.res && branch.res.status})`);
  assert(branchSaves.some((r) => (r.nodes || []).some((n) => n.id === 'br1' && n.aiBuilt === true)),
    'the built branch is marked aiBuilt so it is not rebuilt on the next open');
}

console.log('career-roadmap complete-step / revert-step: the superseded no-ops still answer:');
{
  const done = await runRoadmapAction({ action: 'complete-step', nodeId: 'wp1', stepId: 's1' }, { db: roadmapDb() });
  assert(done.res && done.res.status === 200, `complete-step answers 200 (got ${done.res && done.res.status})`);
  assert((await done.res.json()).objectivePatched === false,
    'and reports no vector patch — gap-progress-sync owns that write');
  const revert = await runRoadmapAction({ action: 'revert-step', nodeId: 'wp1', stepId: 's1' }, { db: roadmapDb() });
  assert(revert.res && revert.res.status === 200, `revert-step answers 200 (got ${revert.res && revert.res.status})`);
}

// ---------------------------------------------------------------------------
// S10 — action:'step-breakdown'. Splits one roadmap step into 2-4 AI-generated
// micro-steps. The pure normalize/preserve logic (test:vectors) and the
// commitment write above already cover collectStepMetaMap; what belongs here is
// the request path itself: does a bad id 400/404 before any model call, does
// the MAX_STEPS_PER_NODE ceiling refuse BEFORE Gemini is spent (normalizeSteps
// silently slices past it, so generated sub-steps would otherwise vanish on
// save), and does a failed/thin generation refund the rate slot it took.

console.log('career-roadmap step-breakdown: bad ids are refused before any model call (S10):');
{
  const missing = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: '', stepId: 's1' },
    { db: roadmapDb() },
  );
  assert(missing.res && missing.res.status === 400,
    `a missing nodeId/stepId is a 400 (got ${missing.res && missing.res.status})`);

  const unknown = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: 'wp1', stepId: 'ghost-step' },
    { db: roadmapDb() },
  );
  assert(unknown.res && unknown.res.status === 404,
    `a step id not on the tree is a 404 (got ${unknown.res && unknown.res.status})`);
}

console.log('career-roadmap step-breakdown: the step ceiling is refused BEFORE Gemini is ever called (S10):');
{
  const full = roadmapTree();
  const wp1 = full.nodes.find((n) => n.id === 'wp1');
  wp1.steps = Array.from({ length: MAX_STEPS_PER_NODE - 1 }, (_, i) => ({ id: `s${i + 1}`, text: `Step ${i + 1}`, done: false }));
  let geminiCalled = false;
  const saves = [];
  const result = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: 'wp1', stepId: 's1' },
    { db: roadmapDb({ roadmap: full, saves }), gemini: async () => { geminiCalled = true; return geminiGone(); } },
  );
  assert(!result.ourFault, `the ceiling path runs without a scope/type error${result.ourFault ? ` — ${result.ourFault}` : ''}`);
  assert(result.res && result.res.status === 200,
    `a waypoint at its step ceiling still answers 200, not an error (got ${result.res && result.res.status})`);
  const body = result.res && await result.res.json();
  assert(body && body.added === 0 && body.reason === 'full',
    `the response reports added:0, reason:'full' (got added=${body && body.added}, reason=${body && body.reason})`);
  assert(!geminiCalled,
    'and Gemini is never called for a waypoint one step short of MAX_STEPS_PER_NODE — normalizeSteps would silently slice any generated sub-steps away on save');
  assert(saves.length === 0, 'and nothing is persisted');
}

console.log('career-roadmap step-breakdown: a successful breakdown grafts micro-steps right after their parent (S10):');
{
  const dated = roadmapTree();
  const wp1 = dated.nodes.find((n) => n.id === 'wp1');
  wp1.steps[0] = { ...wp1.steps[0], dueAt: '2026-08-01', effort: 'M' };
  const saves = [];
  const result = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: 'wp1', stepId: 's1' },
    {
      db: roadmapDb({ roadmap: dated, saves }),
      gemini: geminiOk(JSON.stringify({
        substeps: ['Read chapter one', 'Do the first problem set', 'Check answers against the key'],
      })),
    },
  );
  assert(!result.ourFault, `the breakdown path runs without a scope/type error${result.ourFault ? ` — ${result.ourFault}` : ''}`);
  assert(result.res && result.res.status === 200, `a successful breakdown answers 200 (got ${result.res && result.res.status})`);
  const body = result.res && await result.res.json();
  assert(body && body.added === 3, `the response reports the number of micro-steps added (got ${body && body.added})`);
  const savedSteps = saves[0].nodes.find((n) => n.id === 'wp1').steps;
  const parentIdx = savedSteps.findIndex((s) => s.id === 's1');
  const inserted = savedSteps.slice(parentIdx + 1, parentIdx + 4);
  assert(inserted.length === 3 && inserted.every((s) => s.aiBuilt === true),
    'the generated micro-steps land immediately after the parent step, each marked aiBuilt:true');
  assert(savedSteps[parentIdx].dueAt === '2026-08-01' && savedSteps[parentIdx].effort === 'M',
    "the persisted roadmap keeps the parent step's own commitment untouched");
}

console.log('career-roadmap step-breakdown: a dead upstream (or a thin result) is a 502 and refunds the rate slot it spent:');
{
  const kv = fakeKv();
  const dead = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: 'wp1', stepId: 's1' },
    { db: roadmapDb(), kv },
  );
  assert(!dead.ourFault, `a dead upstream runs clean${dead.ourFault ? ` — ${dead.ourFault}` : ''}`);
  assert(dead.res && dead.res.status === 502, `a dead upstream is a 502, not a crash (got ${dead.res && dead.res.status})`);
  assert(await rateCount(kv, `step-breakdown:${EMAIL}`) === 0,
    'the step-breakdown rate slot it took on the way in comes back');

  const kv2 = fakeKv();
  const thin = await runRoadmapAction(
    { action: 'step-breakdown', nodeId: 'wp1', stepId: 's1' },
    { db: roadmapDb(), kv: kv2, gemini: geminiOk(JSON.stringify({ substeps: ['Only one substep'] })) },
  );
  assert(thin.res && thin.res.status === 502, `fewer than 2 usable sub-steps is also a 502 (got ${thin.res && thin.res.status})`);
  assert(await rateCount(kv2, `step-breakdown:${EMAIL}`) === 0,
    'and a thin result refunds the same rate slot');
}

// ---------------------------------------------------------------------------
console.log('career-switch-chat: the turn executes, and a failed turn refunds the Marco message:');
{
  const kv = fakeKv();
  const okCtx = makeContext({
    pathName: '/career-switch-chat', body: { message: 'should I switch to data science?' }, kv,
    env: { PAYWALL_ENABLED: 'true' },
  });
  const spy = spyConsole();
  let okRes = null;
  await withUpstream(geminiOk('Worth exploring — your quant skills transfer.'), async () => {
    okRes = await careerSwitchChat(okCtx);
  });
  spy.restore();
  assert(!spy.ourFault(), `the happy path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(okRes && okRes.status === 200, `a stubbed-upstream turn answers 200 (got ${okRes && okRes.status})`);
  const okBody = await okRes.json();
  assert(!!okBody.reply, 'the payload carries a reply');
  assert(await featureUsed(kv, 'marco-chat') === 1, 'a successful turn keeps its spend');

  const kv2 = fakeKv();
  const downCtx = makeContext({
    pathName: '/career-switch-chat', body: { message: 'hello?' }, kv: kv2,
    env: { PAYWALL_ENABLED: 'true' },
  });
  let downRes = null;
  const spy2 = spyConsole();
  await withUpstream(geminiGone, async () => { downRes = await careerSwitchChat(downCtx); });
  spy2.restore();
  assert(downRes && downRes.status >= 500, `a dead upstream maps to a 5xx (got ${downRes && downRes.status})`);
  assert(await featureUsed(kv2, 'marco-chat') === 0,
    'a failed turn hands back the daily Marco message');
  assert(await rateCount(kv2, `career-switch-chat:${EMAIL}`) === 0,
    'and the rate slot');
}

// ---------------------------------------------------------------------------
console.log('mock-interview: a session that never starts is not a session spent:');
{
  const kv = fakeKv();
  const ctx = makeContext({
    pathName: '/mock-interview',
    body: { action: 'turn', career: 'Trader', transcript: [] },
    kv,
    env: { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' },
    db: fakeDb([{ re: /FROM users\b/i, first: { email: EMAIL, plan: 'premium', plan_source: 'stripe' } }]),
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await mockInterviewPost(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `the turn path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  // A retired model's 404 used to ship as OUR 404 — "your interview does not
  // exist", with a UI to match. Only 429/503 are the upstream's to pass on;
  // everything else is our call failing, and reads as a 500.
  assert(res && res.status === 500,
    `a retired model is our 500, not the client's 404 (got ${res && res.status})`);
  const used = (await checkFeatureLimit(
    { PAYWALL_ENABLED: 'true', COACH_KV: kv }, EMAIL, 'mock-interview', { spend: false, plan: 'premium' },
  )).used;
  assert(used === 0, `a failed session start refunds the daily session (got used=${used})`);
}

// ---------------------------------------------------------------------------
console.log('portal-snapshot: a failure after the spend refunds the rate slot:');
{
  const kv = fakeKv();
  // The generation itself soft-fails to a fallback snapshot, so the failure
  // that historically burns the budget is the D1 save AFTER the spend.
  const db = fakeDb([
    { re: /user_profiles/i, first: { payload: JSON.stringify({ scores: { tech: 80 } }) } },
    {
      re: /UPDATE user_profiles|INSERT INTO user_profiles/i,
      run: () => { throw new Error('D1 write failed'); },
    },
  ]);
  const ctx = makeContext({ pathName: '/portal-snapshot', body: {}, kv, db });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await portalSnapshot(ctx); });
  spy.restore();
  assert(res && res.status >= 500, `a failed save maps to a 5xx (got ${res && res.status})`);
  assert(await rateCount(kv, `portal-snap:${EMAIL}`) === 0,
    'the portal-snap rate slot came back');
}

// ---------------------------------------------------------------------------
console.log('career-rank cache: miss → absent block → waitUntil fill → hit → block in prompt:');
{
  const kv = fakeKv();
  const personality = Array.from({ length: DIM_COUNT }, (_, i) => (i % 7 === 0 ? 82 : 12));
  const blob = {
    scores: { tech: 85, business: 60 },
    personalityVector: { schemaId: 'onet-lv-161-v1', values: personality, source: 'quiz-seed' },
    objectiveVector: null,
  };
  const db = fakeDb([{ re: /user_profiles/i, first: { payload: JSON.stringify(blob) } }]);
  const geminiBodies = [];
  const gemini = async (u, opts) => {
    if (opts && opts.body) geminiBodies.push(String(opts.body));
    return (geminiOk('A real coaching answer.'))();
  };

  const turn1 = makeContext({ pathName: '/chat', body: { message: 'what should I aim for?' }, kv, db });
  await withUpstream(gemini, async () => {
    const r1 = await runChatTurn(turn1);
    assert(r1.status === 200, `turn 1 answers 200 (got ${r1.status})`);
    assert(!geminiBodies.some((b) => b.includes('strongest career matches')),
      'turn 1 (cold cache) carries no career block — the designed miss');
    await Promise.all(turn1.waits);
  });
  const rankKeys = [...kv.map.keys()].filter((k) => k.startsWith('career-rank:'));
  assert(rankKeys.length === 1, `waitUntil filled exactly one rank cache entry (got ${rankKeys.length})`);
  const cached = JSON.parse(kv.map.get(rankKeys[0]) || '{}').careers || [];
  assert(cached.length > 0 && cached.every((r) => r.title && Number.isFinite(r.fit)),
    `the cached rank carries titled, scored careers (got ${cached.length})`);

  geminiBodies.length = 0;
  const turn2 = makeContext({ pathName: '/chat', body: { message: 'and after that?' }, kv, db });
  await withUpstream(gemini, async () => {
    const r2 = await runChatTurn(turn2);
    assert(r2.status === 200, `turn 2 answers 200 (got ${r2.status})`);
  });
  assert(geminiBodies.some((b) => b.includes('strongest career matches')),
    'turn 2 (warm cache) puts the career block in the prompt — the cached path works');
}

// ---------------------------------------------------------------------------
// Breadth pass: the rest of the priority list. Each section asserts the one
// thing no other suite does — the handler EXECUTES against a request without
// a scope/type error from our own code — plus the cheapest meaningful
// behavioral check its empty-state path offers.

console.log('weekly-plan GET: executes, and no roadmap is an empty week, not an error:');
{
  const ctx = makeContext({ pathName: '/weekly-plan', kv: fakeKv() });
  ctx.request.method = 'GET';
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/weekly-plan.js')).onRequestGet(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(body.empty === true && Array.isArray(body.tasks), 'an empty roadmap yields the empty week shape');

  // The handler had no try/catch at all: an exception was an unhandled runtime
  // 500 with no log line. Force one from inside and require a handled answer.
  const boom = makeContext({ pathName: '/weekly-plan', kv: fakeKv() });
  boom.request.method = 'GET';
  boom.env.DB = {
    prepare(sql) {
      if (/FROM sessions/i.test(sql)) {
        return { bind: () => ({ first: async () => ({ email: EMAIL, expires_at: new Date(Date.now() + 864e5).toISOString() }) }) };
      }
      throw new Error('D1 exploded');
    },
  };
  const spy2 = spyConsole();
  let boomRes = null;
  await withUpstream(geminiGone, async () => {
    boomRes = await (await import('../functions/weekly-plan.js')).onRequestGet(boom);
  });
  spy2.restore();
  assert(boomRes && boomRes.status === 500,
    `an exception inside the handler is a handled 500 (got ${boomRes && boomRes.status})`);
  assert(spy2.lines.some((l) => /weekly-plan GET failed/.test(l)),
    'and it leaves the log line a maintainer needs');
  assert(!/exploded/i.test(JSON.stringify(await boomRes.json())),
    'while the body stays friendly — no server detail leaks');
}

// ---------------------------------------------------------------------------
// S10 — POST /weekly-plan { commitment }. Sets/moves/clears a date on a
// roadmap step, or ticks it off, from the Flight Plan page. The pure
// normalize/preserve/clear logic already lives in test:vectors and the prompt
// block in test:marco-voice; what belongs HERE is the HTTP handler: does a bad
// request cost nothing, is a step id absent from the session-loaded tree a 404
// (that absence IS the authorization check — there is no id space in which one
// user can name another user's step), and did adding this branch leave the
// pre-existing { taskId, done } path intact.

/** Runs one weekly-plan commitment write and reports whether OUR code threw. */
async function runCommitment(commitment, { db, kv, headers } = {}) {
  const mod = await import('../functions/weekly-plan.js');
  const ctx = makeContext({ pathName: '/weekly-plan', body: { commitment }, db, kv: kv || fakeKv() });
  if (headers) ctx.request.headers = headers;
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await mod.onRequestPost(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  return { res, ourFault: spy.ourFault() };
}

console.log('weekly-plan commitment: signed out is a 401, not a silent write:');
{
  const { res } = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'set', dueAt: '2026-08-01' },
    { db: roadmapDb(), headers: new Headers({ 'content-type': 'application/json' }) },
  );
  assert(res && res.status === 401, `no session cookie is a 401 before the roadmap is even loaded (got ${res && res.status})`);
}

console.log('weekly-plan commitment: action=set with a valid dueAt persists it (S10):');
{
  const saves = [];
  const { res, ourFault } = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'set', dueAt: '2026-08-01' },
    { db: roadmapDb({ saves }) },
  );
  assert(!ourFault, `the set path runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `a valid set answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(body.changed === true, 'a real date change reports changed:true');
  assert((body.commitments || []).some((c) => c.nodeId === 'wp1' && c.stepId === 's1' && c.dueAt === '2026-08-01'),
    'the response commitments list carries the new due date');
  assert(saves.length === 1, 'the write persists exactly once');
  const savedStep = (saves[0].nodes.find((n) => n.id === 'wp1').steps || []).find((s) => s.id === 's1');
  assert(savedStep && savedStep.dueAt === '2026-08-01',
    'the roadmap actually written to D1 carries the due date on that step');
}

console.log('weekly-plan commitment: an invalid dueAt changes nothing (S10):');
{
  const saves = [];
  const { res, ourFault } = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'set', dueAt: '2026-02-31' },
    { db: roadmapDb({ saves }) },
  );
  assert(!ourFault, `a bad calendar date does not crash the handler${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `an invalid date is a no-op, not an error (got ${res && res.status})`);
  const body = await res.json();
  assert(body.changed === false, 'a date that fails the calendar check reports changed:false');
  assert(saves.length === 0, 'and nothing is written to the roadmap');
}

console.log('weekly-plan commitment: a bad shape is a 400 before the roadmap loads:');
{
  const missingIds = await runCommitment(
    { action: 'set', dueAt: '2026-08-01' },
    { db: roadmapDb() },
  );
  assert(missingIds.res && missingIds.res.status === 400,
    `a commitment with no nodeId/stepId is a 400 (got ${missingIds.res && missingIds.res.status})`);

  const unknownAction = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'archive' },
    { db: roadmapDb() },
  );
  assert(unknownAction.res && unknownAction.res.status === 400,
    `an unrecognized action is a 400 (got ${unknownAction.res && unknownAction.res.status})`);
}

console.log('weekly-plan commitment: an id not on your tree is a 404, not a 500 or a silent success:');
{
  const { res } = await runCommitment(
    { nodeId: 'not-on-this-tree', stepId: 's1', action: 'set', dueAt: '2026-08-01' },
    { db: roadmapDb() },
  );
  assert(res && res.status === 404,
    `a nodeId absent from the session-loaded tree is a 404 — that IS the authorization check (got ${res && res.status})`);
  const body = res && await res.json();
  assert(body && body.error === 'That step is not on your roadmap.', 'and names the reason in plain words');
}

console.log('weekly-plan commitment: action=clear removes the commitment; clearing an undated step is a no-op:');
{
  const dated = roadmapTree();
  const wp1 = dated.nodes.find((n) => n.id === 'wp1');
  wp1.steps[0] = { ...wp1.steps[0], dueAt: '2026-08-01', effort: 'M', committedAt: '2026-07-01T00:00:00.000Z' };
  const saves = [];
  const { res, ourFault } = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'clear' },
    { db: roadmapDb({ roadmap: dated, saves }) },
  );
  assert(!ourFault, `clear runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `clear answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(body.changed === true, 'clearing a dated step reports changed:true');
  const savedStep = (saves[0].nodes.find((n) => n.id === 'wp1').steps || []).find((s) => s.id === 's1');
  assert(savedStep && !savedStep.dueAt && !savedStep.effort && !savedStep.committedAt && !savedStep.dueMoves,
    'dueAt, effort, committedAt and dueMoves are all gone from the persisted step');

  const noopSaves = [];
  const noop = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'clear' },
    { db: roadmapDb({ saves: noopSaves }) },
  );
  const noopBody = await noop.res.json();
  assert(noop.res.status === 200 && noopBody.changed === false,
    `clearing a step with no date already set is a no-op 200 (got ${noop.res.status}, changed=${noopBody.changed})`);
  assert(noopSaves.length === 0, 'and an undated clear writes nothing');
}

console.log('weekly-plan commitment: action=done flips the step and drops it from the open list:');
{
  const dated = roadmapTree();
  const wp1 = dated.nodes.find((n) => n.id === 'wp1');
  wp1.steps[0] = { ...wp1.steps[0], dueAt: '2026-08-01' };
  const saves = [];
  const { res, ourFault } = await runCommitment(
    { nodeId: 'wp1', stepId: 's1', action: 'done' },
    { db: roadmapDb({ roadmap: dated, saves }) },
  );
  assert(!ourFault, `done runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `done answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(body.changed === true, 'flipping done reports changed:true');
  const savedStep = (saves[0].nodes.find((n) => n.id === 'wp1').steps || []).find((s) => s.id === 's1');
  assert(savedStep && savedStep.done === true, 'the persisted step is marked done');
  assert(!(body.commitments || []).some((c) => c.nodeId === 'wp1' && c.stepId === 's1'),
    'a finished commitment is excluded from the returned open list — done commitments are not returned');
}

console.log('weekly-plan POST { taskId, done }: the pre-existing task-toggle path still works (S10 did not regress it):');
{
  const saves = [];
  const mod = await import('../functions/weekly-plan.js');
  const ctx = makeContext({ pathName: '/weekly-plan', body: { taskId: 'wp1:s1', done: true }, db: roadmapDb({ saves }) });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await mod.onRequestPost(ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  assert(!spy.ourFault(), `the legacy taskId path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `the legacy waypointId:stepId toggle still answers 200 (got ${res && res.status})`);
  const savedStep = (saves[0].nodes.find((n) => n.id === 'wp1').steps || []).find((s) => s.id === 's1');
  assert(savedStep && savedStep.done === true,
    'the underlying step is marked done via the pre-existing task path — the commitment branch did not break it');
}

console.log('opportunities GET ?cached=1: executes and degrades to the empty shape:');
{
  const ctx = makeContext({ pathName: '/opportunities?cached=1', kv: fakeKv() });
  ctx.request.method = 'GET';
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/opportunities.js')).onRequestGet(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(Array.isArray(body.opportunities) && body.opportunities.length === 0,
    'no profile degrades to an empty list, never an error');
}

console.log('derive-career GET ?all=1: executes the re-key serving path:');
{
  const ctx = makeContext({ pathName: '/derive-career?all=1', kv: fakeKv() });
  ctx.request.method = 'GET';
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/derive-career.js')).onRequest(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status === 200, `answers 200 (got ${res && res.status})`);
  const body = await res.json();
  assert(Array.isArray(body.fragments), 'serves a fragments array');
}

console.log('profile/quiz GET + PUT: the save path executes and provenance survives it:');
{
  const saved = [];
  const blob = {
    scores: { tech: 70 },
    personalityVector: {
      schemaId: 'onet-lv-161-v1',
      values: Array.from({ length: DIM_COUNT }, () => 40),
      source: 'gemini-patch',
    },
  };
  const db = fakeDb([
    { re: /SELECT payload FROM user_profiles/i, first: { payload: JSON.stringify(blob) } },
    {
      re: /INSERT INTO user_profiles|UPDATE user_profiles/i,
      run: (sql, args) => { saved.push(args); return { success: true }; },
    },
  ]);
  const mod = await import('../functions/profile/quiz.js');

  const getCtx = makeContext({ pathName: '/profile/quiz', db });
  getCtx.request.method = 'GET';
  const getRes = await mod.onRequestGet(getCtx);
  assert(getRes.status === 200, `GET answers 200 (got ${getRes.status})`);
  const getBody = await getRes.json();
  assert(getBody.profile?.personalityVector?.source === 'gemini-patch',
    'GET serves the v1 view with provenance intact');

  const putCtx = makeContext({ pathName: '/profile/quiz', db });
  putCtx.request.method = 'PUT';
  putCtx.request.text = async () => JSON.stringify({ profile: blob });
  const spy = spyConsole();
  let putRes = null;
  await withUpstream(geminiGone, async () => { putRes = await mod.onRequestPut(putCtx); });
  await Promise.all(putCtx.waits);
  spy.restore();
  assert(!spy.ourFault(), `PUT runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(putRes && putRes.status === 200, `PUT answers 200 (got ${putRes && putRes.status})`);
  const savedJson = saved.flat().find((a) => typeof a === 'string' && a.includes('gemini-patch'));
  assert(!!savedJson,
    'the saved row still carries personalityVector.source — the re-seed guard reads this');
}

console.log('sim-generate POST: a cache miss with a dead upstream errors without crashing:');
{
  const ctx = makeContext({ pathName: '/sim-generate', body: { slug: 'test-career', name: 'Test Career' }, kv: fakeKv() });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/sim-generate.js')).onRequest(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status >= 400, `a dead upstream is an error, not a crash (got ${res && res.status})`);
}

console.log('resume-parse POST: text-only parse with a dead upstream errors without crashing:');
{
  const ctx = makeContext({
    pathName: '/resume-parse',
    body: { resumeText: 'Jacob — quant intern, built a market-making sim in Python.' },
    kv: fakeKv(),
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/resume-parse.js')).onRequest(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && res.status >= 200, `answers rather than crashes (got ${res && res.status})`);
}

console.log('stretch-fits POST: executes against the real catalog artifacts:');
{
  const ctx = makeContext({
    pathName: '/stretch-fits',
    body: { items: [{ soc: '13-2041.00', fit: 55 }] },
    kv: fakeKv(),
  });
  const spy = spyConsole();
  let res = null;
  await withUpstream(geminiGone, async () => { res = await (await import('../functions/stretch-fits.js')).onRequest(ctx); });
  spy.restore();
  assert(!spy.ourFault(), `runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
  assert(res && (res.status === 200 || res.status >= 400),
    `answers rather than crashes (got ${res && res.status})`);
}

// ---------------------------------------------------------------------------
// The rest of the functions/ tree. Same contract as the breadth pass above:
// the handler EXECUTES against a real request without a scope/type error from
// our own code, plus its cheapest honest behavioral check. These are the
// modules that had never been executed by anything in the repo.

/**
 * Runs one handler and reports whether OUR code threw. `entry` picks the
 * export (onRequest by default); `method` and `body` shape the request.
 */
async function runHandler(modPath, {
  entry = 'onRequest', pathName, method = 'POST', body, db, kv, env, gemini = geminiGone, text,
} = {}) {
  const ctx = makeContext({ pathName, body, db, kv: kv || fakeKv(), env });
  ctx.request.method = method;
  if (text !== undefined) ctx.request.text = async () => text;
  const spy = spyConsole();
  let res = null;
  const mod = await import(modPath);
  await withUpstream(gemini, async () => { res = await mod[entry](ctx); });
  await Promise.all(ctx.waits);
  spy.restore();
  return { res, ourFault: spy.ourFault() };
}

const PREMIUM_DB = () => fakeDb([
  { re: /FROM users\b/i, first: { email: EMAIL, plan: 'premium', plan_source: 'stripe' } },
]);

const FREE_DB = () => fakeDb([
  { re: /FROM users\b/i, first: { email: EMAIL, plan: 'free', plan_source: null } },
]);

const FREE_ENV = { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' };

console.log('career-analysis POST: the analysis path executes against a dead upstream:');
{
  const { res, ourFault } = await runHandler('../functions/career-analysis.js', {
    pathName: '/career-analysis',
    body: { action: 'analyze', careerSlug: 'test-career', careerName: 'Test Career' },
  });
  assert(!ourFault, `runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status >= 200, `answers rather than crashes (got ${res && res.status})`);
}

console.log('profile-align / profile-building: the drift and enrichment paths execute:');
{
  const align = await runHandler('../functions/profile-align.js', {
    pathName: '/profile-align', body: { action: 'check' },
    db: fakeDb([{ re: /FROM user_profiles/i, first: () => ({ payload: JSON.stringify(userBlobWithVectors()) }) }]),
  });
  assert(!align.ourFault, `profile-align runs without a scope/type error${align.ourFault ? ` — ${align.ourFault}` : ''}`);
  assert(align.res && align.res.status >= 200, `profile-align answers (got ${align.res && align.res.status})`);

  const building = await runHandler('../functions/profile-building.js', {
    pathName: '/profile-building',
    body: { answers: [{ prompt: 'What have you built?', answer: 'A market-making sim in Python.' }] },
    db: fakeDb([{ re: /FROM user_profiles/i, first: () => ({ payload: JSON.stringify(userBlobWithVectors()) }) }]),
  });
  assert(!building.ourFault, `profile-building runs without a scope/type error${building.ourFault ? ` — ${building.ourFault}` : ''}`);
  assert(building.res && building.res.status >= 200, `profile-building answers (got ${building.res && building.res.status})`);

  const empty = await runHandler('../functions/profile-building.js', {
    pathName: '/profile-building', body: { answers: [] },
  });
  assert(empty.res && empty.res.status === 400, `no answers is a 400, not a model call (got ${empty.res && empty.res.status})`);
}

console.log('dossier GET/PUT: the round trip executes and the shape guard holds:');
{
  const saved = [];
  const db = fakeDb([
    { re: /FROM dossiers/i, first: null },
    { re: /INTO dossiers/i, run: (sql, args) => { saved.push(args); return { success: true }; } },
  ]);
  const missing = await runHandler('../functions/dossier.js', { pathName: '/dossier', method: 'GET', db });
  assert(!missing.ourFault, `dossier GET runs without a scope/type error${missing.ourFault ? ` — ${missing.ourFault}` : ''}`);
  assert(missing.res && missing.res.status === 404, `no dossier is a 404, not a 500 (got ${missing.res && missing.res.status})`);

  const good = [
    '# user dossier v1',
    'top_industries: finance, tech',
    'interests: markets, systems',
    'goals: a quant internship',
    'recent: built a market-making sim',
  ].join('\n');
  const put = await runHandler('../functions/dossier.js', {
    pathName: '/dossier', method: 'PUT', body: { dossier: good }, db,
  });
  assert(!put.ourFault, `dossier PUT runs without a scope/type error${put.ourFault ? ` — ${put.ourFault}` : ''}`);
  assert(put.res && put.res.status === 200, `a well-formed dossier saves (got ${put.res && put.res.status})`);

  const bad = await runHandler('../functions/dossier.js', {
    pathName: '/dossier', method: 'PUT', body: { dossier: 'just some prose' }, db,
  });
  assert(bad.res && bad.res.status === 400, `a shapeless dossier is refused (got ${bad.res && bad.res.status})`);
}

console.log('sim-colleague / sim-feedback / sim-mirror: the three simulation paths execute:');
{
  // pm-northstar is a real SIM_SECRETS entry, so the prompt builder runs
  // against a real persona rather than short-circuiting on "unknown sim".
  const colleague = await runHandler('../functions/sim-colleague.js', {
    pathName: '/sim-colleague',
    body: { simId: 'pm-northstar', messages: [{ role: 'user', content: 'What does the security issue block?' }] },
  });
  assert(!colleague.ourFault, `sim-colleague runs without a scope/type error${colleague.ourFault ? ` — ${colleague.ourFault}` : ''}`);
  assert(colleague.res && colleague.res.status >= 400,
    `a dead upstream is an error, not a crash (got ${colleague.res && colleague.res.status})`);

  const unknown = await runHandler('../functions/sim-colleague.js', {
    pathName: '/sim-colleague',
    body: { simId: 'no-such-sim', messages: [{ role: 'user', content: 'hello' }] },
  });
  assert(unknown.res && unknown.res.status === 404,
    `an unknown sim is a 404 before any model call (got ${unknown.res && unknown.res.status})`);

  const feedback = await runHandler('../functions/sim-feedback.js', {
    pathName: '/sim-feedback',
    body: { simId: 'pm-northstar', artifact: 'We should cut scope and ship the fix first, then revisit the timeline.' },
  });
  assert(!feedback.ourFault, `sim-feedback runs without a scope/type error${feedback.ourFault ? ` — ${feedback.ourFault}` : ''}`);
  assert(feedback.res && feedback.res.status >= 400,
    `a dead upstream is an error, not a crash (got ${feedback.res && feedback.res.status})`);

  const trial = (role, experienced) => ({
    role, domain: 'finance', familiarity: 'none', predictedEnjoyment: 7,
    experiencedEnjoyment: experienced, gap: experienced - 7, minutesSpent: 25,
    colleagueMessagesSent: 3, hintsUsed: 1, energizedBy: ['the modelling'],
    drainedBy: ['the meetings'], surpriseNote: 'more writing than expected',
  });
  const mirror = await runHandler('../functions/sim-mirror.js', {
    pathName: '/sim-mirror',
    body: { trials: [trial('Product Manager', 8), trial('Quantitative Analyst', 4)] },
  });
  assert(!mirror.ourFault, `sim-mirror runs without a scope/type error${mirror.ourFault ? ` — ${mirror.ourFault}` : ''}`);
  assert(mirror.res && mirror.res.status >= 400,
    `a dead upstream is an error, not a crash (got ${mirror.res && mirror.res.status})`);

  const thin = await runHandler('../functions/sim-mirror.js', {
    pathName: '/sim-mirror', body: { trials: [trial('Product Manager', 8)] },
  });
  assert(thin.res && thin.res.status === 400,
    `one flight is not enough for the Mirror (got ${thin.res && thin.res.status})`);
}

console.log('resume-builder / resume-tailor: the paid resume paths execute:');
{
  const list = await runHandler('../functions/resume-builder.js', {
    entry: 'onRequestGet', pathName: '/resume-builder?soc=13-2041.00', method: 'GET',
    db: PREMIUM_DB(), env: { PAYWALL_ENABLED: 'true' },
  });
  assert(!list.ourFault, `resume-builder GET runs without a scope/type error${list.ourFault ? ` — ${list.ourFault}` : ''}`);
  assert(list.res && list.res.status === 200, `resume-builder GET answers 200 (got ${list.res && list.res.status})`);

  const build = await runHandler('../functions/resume-builder.js', {
    entry: 'onRequestPost', pathName: '/resume-builder',
    body: {
      soc: '13-2041.00', careerName: 'Credit Analyst',
      freeText: 'Built a market-making simulator in Python; ran the trading club options desk for two quarters.',
    },
    db: PREMIUM_DB(), env: { PAYWALL_ENABLED: 'true' },
  });
  assert(!build.ourFault, `resume-builder POST runs without a scope/type error${build.ourFault ? ` — ${build.ourFault}` : ''}`);
  assert(build.res && build.res.status >= 400,
    `a dead upstream is an error, not a crash (got ${build.res && build.res.status})`);

  // V2 §4 REPLACED the binary paywall here: building and editing a resume is
  // free, and only the whole-resume AI draft is metered. A 402 on this read
  // would be the old tier leaking back.
  const free = await runHandler('../functions/resume-builder.js', {
    entry: 'onRequestGet', pathName: '/resume-builder?soc=13-2041.00', method: 'GET',
    db: FREE_DB(), env: { PAYWALL_ENABLED: 'true', DEV_TEST_EMAILS: '' },
  });
  assert(free.res && free.res.status === 200,
    `a free account can READ its resume — build/edit is free (got ${free.res && free.res.status})`);

  const tailorList = await runHandler('../functions/resume-tailor.js', {
    entry: 'onRequestGet', pathName: '/resume-tailor?resumeId=base-1', method: 'GET',
    db: PREMIUM_DB(), env: { PAYWALL_ENABLED: 'true' },
  });
  assert(!tailorList.ourFault, `resume-tailor GET runs without a scope/type error${tailorList.ourFault ? ` — ${tailorList.ourFault}` : ''}`);
  assert(tailorList.res && tailorList.res.status === 200,
    `resume-tailor GET answers 200 (got ${tailorList.res && tailorList.res.status})`);

  const tailorMissing = await runHandler('../functions/resume-tailor.js', {
    entry: 'onRequestPost', pathName: '/resume-tailor',
    body: { resumeId: 'nope', jobTitle: 'Analyst', jobText: 'A'.repeat(200) },
    db: PREMIUM_DB(), env: { PAYWALL_ENABLED: 'true' },
  });
  assert(!tailorMissing.ourFault, `resume-tailor POST runs without a scope/type error${tailorMissing.ourFault ? ` — ${tailorMissing.ourFault}` : ''}`);
  assert(tailorMissing.res && tailorMissing.res.status === 404,
    `another user's resumeId is a 404, never someone else's document (got ${tailorMissing.res && tailorMissing.res.status})`);
}

console.log('roadmap-sync POST: the client-triggered resync executes:');
{
  const { res, ourFault } = await runHandler('../functions/roadmap-sync.js', {
    pathName: '/roadmap-sync', body: { reason: 'client' },
    db: roadmapDb(),
  });
  assert(!ourFault, `runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status >= 200, `answers rather than crashes (got ${res && res.status})`);
}

console.log('account: the deprecated POST is a 410 and DELETE clears every table:');
{
  const post = await runHandler('../functions/account.js', {
    entry: 'onRequestPost', pathName: '/account', body: {},
  });
  assert(post.res && post.res.status === 410, `POST /account is retired, not broken (got ${post.res && post.res.status})`);

  const deleted = [];
  const del = await runHandler('../functions/account.js', {
    entry: 'onRequestDelete', pathName: '/account', method: 'DELETE',
    db: fakeDb([{ re: /DELETE FROM/i, run: (sql) => { deleted.push(sql); return { success: true }; } }]),
  });
  assert(!del.ourFault, `DELETE runs without a scope/type error${del.ourFault ? ` — ${del.ourFault}` : ''}`);
  assert(del.res && del.res.status === 200, `DELETE answers 200 (got ${del.res && del.res.status})`);
  // The deletion gap closed on 2026-07-19 was a table left behind; assert the
  // user's own rows go, by table, so the next added table has to be added here.
  for (const table of ['user_profiles', 'roadmaps', 'sessions', 'users']) {
    assert(deleted.some((sql) => new RegExp(`DELETE FROM ${table}\\b`, 'i').test(sql)),
      `DELETE /account clears ${table}`);
  }
}

// ---------------------------------------------------------------------------
// artifacts — the portfolio-evidence write path. Nothing in this repo had ever
// executed this file: no script imported it, and the only `artifacts` this
// suite knew was the D1 table name in the account-deletion assertion. It also
// imports the exact loadUserBlob/saveUserBlob pair whose missing imports took
// career-roadmap down twice (678ac94, a66ea6d), so it gets covered BEFORE the
// client wiring makes it reachable by a user.

/** The v3 (coordinate) focus tracker skill-gap-tracker.js writes — the only
 *  shape that survives ensureFocusTrackerOnTree without being rebuilt from the
 *  waypoint. A gap must carry source:'coordinate' or the tracker is not v3. */
function gapTree(logs = []) {
  return {
    ...roadmapTree(),
    focusTracker: {
      version: 3,
      waypointId: 'wp1',
      skillGaps: [{
        id: 'gap-math',
        dimIndex: 12,
        label: 'Mathematics',
        domain: 'skills',
        source: 'coordinate',
        user: 40,
        vBase: 40,
        target: 80,
        gap: 40,
        checklist: [
          { id: 'c1', text: 'Finish the problem set', done: true },
          { id: 'c2', text: 'Sit the practice exam', done: false },
        ],
        logs,
        status: 'in_progress',
        progress: 30,
      }],
    },
  };
}

function artifactsDb({
  roadmap = gapTree(), blob = userBlobWithVectors(),
  rows = [], inserts = [], saves = [], userSaves = [],
} = {}) {
  return fakeDb([
    { re: /FROM artifacts/i, all: () => ({ results: rows }) },
    { re: /INTO artifacts/i, run: (sql, args) => { inserts.push(args); return { success: true }; } },
    { re: /FROM roadmaps/i, first: () => (roadmap ? { payload: JSON.stringify(roadmap) } : null) },
    { re: /INTO roadmaps/i, run: (sql, args) => { saves.push(JSON.parse(args[1])); return { success: true }; } },
    { re: /FROM user_profiles/i, first: () => (blob ? { payload: JSON.stringify(blob) } : null) },
    { re: /INTO user_profiles/i, run: (sql, args) => { userSaves.push(JSON.parse(args[1])); return { success: true }; } },
  ]);
}

const gapOf = (tree) => ((tree && tree.focusTracker && tree.focusTracker.skillGaps) || [])[0] || {};

console.log('artifacts GET: the evidence list executes and camelCases its columns:');
{
  const rows = [{
    id: 'art-1', waypoint_id: 'wp1', gap_id: 'gap-math', dim_index: 12,
    type: 'repo', title: 'Fraud-detection notebook', note: 'ships end to end',
    created_at: '2026-07-20T10:00:00.000Z',
  }];
  const { res, ourFault } = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestGet', pathName: '/artifacts', method: 'GET',
    db: artifactsDb({ rows }),
  });
  assert(!ourFault, `GET runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `GET answers 200 (got ${res && res.status})`);
  const body = res && await res.json();
  const a = (body && body.artifacts || [])[0];
  assert(!!a && a.waypointId === 'wp1' && a.dimIndex === 12 && a.createdAt === rows[0].created_at,
    'the snake_case columns reach the client camelCased — the shape resume-builder and the card read');
}

console.log('artifacts POST: a portfolio-only log inserts and touches no vector:');
{
  const inserts = []; const saves = []; const userSaves = [];
  const { res, ourFault } = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: { type: 'repo', title: 'Fraud-detection notebook', note: 'ships end to end' },
    db: artifactsDb({ inserts, saves, userSaves }),
  });
  assert(!ourFault, `POST runs without a scope/type error${ourFault ? ` — ${ourFault}` : ''}`);
  assert(res && res.status === 200, `POST answers 200 (got ${res && res.status})`);
  const body = res && await res.json();
  assert(!!(body && body.artifact && body.artifact.id), 'and hands back the row the card unshifts into its list');
  assert(inserts.length === 1, 'the artifact row is written exactly once');
  assert(body && body.gapStamp && body.gapStamp.stamped === false, 'no gap link means no stamp');
  // No gapId, no vector: gap-progress-sync stays the only writer that runs.
  assert(userSaves.length === 0 && saves.length === 0,
    'and nothing touches the objective vector or the roadmap');
}

console.log('artifacts POST: a bad body is refused before it costs a row:');
{
  const inserts = [];
  const badType = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: { type: 'screenshot', title: 'Something' }, db: artifactsDb({ inserts }),
  });
  assert(badType.res && badType.res.status === 400, `an unknown type is a 400 (got ${badType.res && badType.res.status})`);
  const badTitle = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: { type: 'repo', title: 'x' }, db: artifactsDb({ inserts }),
  });
  assert(badTitle.res && badTitle.res.status === 400, `a one-character title is a 400 (got ${badTitle.res && badTitle.res.status})`);
  const badDim = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: { type: 'repo', title: 'Valid title', gapId: 'gap-math', dimIndex: 999 },
    db: artifactsDb({ inserts }),
  });
  assert(badDim.res && badDim.res.status === 400, `an out-of-range dimIndex is a 400 (got ${badDim.res && badDim.res.status})`);
  assert(inserts.length === 0, 'and none of the three wrote an artifact row');
}

console.log('artifacts POST: a gap-linked log moves the objective vector, absolutely:');
{
  const saves = []; const userSaves = [];
  const first = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: { type: 'repo', title: 'Fraud-detection notebook', note: 'ships end to end', gapId: 'gap-math' },
    db: artifactsDb({ saves, userSaves }),
  });
  assert(!first.ourFault, `the gap-stamp path runs without a scope/type error${first.ourFault ? ` — ${first.ourFault}` : ''}`);
  assert(first.res && first.res.status === 200, `it answers 200 (got ${first.res && first.res.status})`);
  const body = first.res && await first.res.json();
  assert(!!(body && body.gapStamp && body.gapStamp.stamped) && body.gapStamp.dimIndex === 12,
    'the response reports the stamped dimension');
  // b=40, t=80, span=40; 1 of 2 checklist items done, one repo artifact at w=10
  // → 40 + 40 * (0.6*0.5 + 0.10) = 56. Pinned so a formula edit has to be meant.
  assert(body && body.gapStamp.value === 56,
    `the patched value is the absolute recompute, not an increment (got ${body && body.gapStamp.value})`);
  const dims = userSaves[0]?.vectors?.objectiveAiPatch?.dimensions || [];
  assert(userSaves.length === 1 && dims.some((d) => d.index === 12 && d.value === 56),
    'and it persists at its v2 user-model path as {index, value}');
  assert(saves.length === 1 && (gapOf(saves[0]).logs || []).length === 1,
    'the evidence log survives the roadmap round trip (normalizeV3Gap keeps it)');
  assert((gapOf(saves[0]).logs || [])[0]?.w === 10,
    'carrying its artifact weight — a dropped w silently stops the evidence counting');

  // Absolute recompute: replay the SAME evidence against the ALREADY-patched
  // blob and the already-stamped roadmap. promoteFromNote passes replaceLogId,
  // so the prior log is swapped rather than appended — the gap's evidence total
  // is unchanged and the value must land in the same place. This is the
  // single-server-side-writer invariant the whole pipeline rests on.
  const replaySaves = []; const replayUserSaves = [];
  const second = await runHandler('../functions/artifacts.js', {
    entry: 'onRequestPost', pathName: '/artifacts',
    body: {
      type: 'repo', title: 'Fraud-detection notebook', note: 'ships end to end',
      gapId: 'gap-math', replaceLogId: (gapOf(saves[0]).logs || [])[0]?.id,
    },
    db: artifactsDb({
      roadmap: saves[0], blob: userSaves[0], saves: replaySaves, userSaves: replayUserSaves,
    }),
  });
  const secondBody = second.res && await second.res.json();
  assert(secondBody && secondBody.gapStamp.value === 56,
    `replaying the same evidence is idempotent (56 → ${secondBody && secondBody.gapStamp.value})`);
  assert((gapOf(replaySaves[0]).logs || []).length === 1,
    'and replaceLogId swaps the log instead of stacking a second one');
  // 2026-07-24: the artifact path stopped computing its own value and now goes
  // through syncGapProgressToQuiz, whose whole point is that a dimension already
  // holding its computed value is NOT rewritten. A replay therefore writes the
  // roadmap and nothing else — no vector row, no churned timestamp.
  assert(replayUserSaves.length === 0,
    `an idempotent replay writes NO vector at all (got ${replayUserSaves.length} user saves)`);
  assert(!secondBody.objectiveVector && !secondBody.objectiveAiPatch,
    'and hands the client no vectors to merge, because nothing moved');
  // The reported number and the persisted number come from the same pure
  // function, so they cannot disagree — which is the bug this replaced.
  const persisted = (userSaves[0]?.vectors?.objectiveAiPatch?.dimensions || [])
    .find((d) => d.index === 12);
  assert(persisted && persisted.value === body.gapStamp.value,
    `the value in the response IS the value in the database (${body.gapStamp.value} vs ${persisted && persisted.value})`);
}

// ---------------------------------------------------------------------------
// events — the S1 beacon. Deep behaviour (allowlist, PII lint, rollup math)
// lives in test:events; what belongs HERE is the request-path property every
// other endpoint in this file is checked for: it EXECUTES, and it is
// auth-OPTIONAL — an anonymous visitor's page_view must land exactly as a
// signed-in one does, because the top of the funnel has no session by
// definition. A regression that made this endpoint require a session would
// silently delete the entire acquisition funnel while every other gate stayed
// green.

console.log('events POST: the beacon executes signed-in and signed-out alike:');
{
  const beaconCtx = ({ db, session = true, env }) => {
    const ctx = makeContext({ pathName: '/events', db, env });
    ctx.request.headers = new Headers({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      ...(session ? { cookie: 'fw_session=probe-token' } : {}),
    });
    const payload = JSON.stringify({
      anon: 'anon-endpoint-probe',
      path: '/quiz.html',
      attr: { ref: 'https://www.linkedin.com/feed', utm_source: 'linkedin' },
      events: [{ n: 'page_view' }, { n: 'quiz_start' }],
    });
    ctx.request.text = async () => payload;
    return ctx;
  };

  const mod = await import('../functions/events.js');

  const signedIn = [];
  const spy1 = spyConsole();
  const ctx1 = beaconCtx({ db: fakeDb([{ re: /INSERT INTO events/i, run: (sql, args) => { signedIn.push(args); return { meta: { changes: 1 } }; } }]) });
  const res1 = await mod.onRequestPost(ctx1);
  await Promise.all(ctx1.waits);
  spy1.restore();
  assert(!spy1.ourFault(), `runs without a scope/type error${spy1.ourFault() ? ` — ${spy1.ourFault()}` : ''}`);
  assert(res1 && res1.status === 204, `answers 204 (got ${res1 && res1.status})`);
  assert(signedIn.length === 2, `both events reached D1 (${signedIn.length})`);
  assert(signedIn[0][4] === EMAIL, 'the session stamps user_id on the row');
  assert(signedIn[0][9] === 'linkedin', 'first-touch utm_source is stored as a column');

  const anon = [];
  const spy2 = spyConsole();
  const ctx2 = beaconCtx({
    session: false,
    db: fakeDb([
      { re: /FROM sessions/i, first: () => null },
      { re: /INSERT INTO events/i, run: (sql, args) => { anon.push(args); return { meta: { changes: 1 } }; } },
    ]),
  });
  const res2 = await mod.onRequestPost(ctx2);
  await Promise.all(ctx2.waits);
  spy2.restore();
  assert(!spy2.ourFault(), `the anonymous path runs clean${spy2.ourFault() ? ` — ${spy2.ourFault()}` : ''}`);
  assert(res2 && res2.status === 204, 'an anonymous beacon is accepted, not 401d');
  assert(anon.length === 2, `the anonymous events landed too (${anon.length})`);
  assert(anon[0][4] === null, 'and carry a null user_id rather than a borrowed one');
}

// ---------------------------------------------------------------------------
// S2 — POST /contact. A public, unauthenticated write that also sends mail.
// The thing worth executing here is the ORDER: the D1 row is the deliverable
// and the email is only a notification, so a dead Resend must still be a 200
// with the message safely stored, while a dead D1 must be an honest failure
// that tells the student to email us instead of painting a fake success.

console.log('contact POST: the row is the record, the email is the notification:');
{
  const contactCtx = ({ db, body, session = false, env = {} }) => {
    const ctx = makeContext({ pathName: '/contact', body, db, env });
    ctx.request.headers = new Headers({
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 probe',
      ...(session ? { cookie: 'fw_session=probe-token' } : {}),
    });
    return ctx;
  };
  const noSession = { re: /FROM sessions/i, first: () => null };
  const goodBody = { email: 'Student@Example.com ', topic: 'billing', body: 'My card was charged twice this month.' };
  const mod = await import('../functions/contact.js');

  // 1. Happy path, signed out, with Resend configured and answering.
  {
    const rows = [];
    let sent = null;
    const spy = spyConsole();
    const ctx = contactCtx({
      body: goodBody,
      env: { RESEND_API_KEY: 're_test', SESSION_PEPPER: 'pepper' },
      db: fakeDb([
        noSession,
        { re: /INSERT INTO contact_messages/i, run: (sql, args) => { rows.push(args); return { meta: { changes: 1 } }; } },
        { re: /INSERT INTO events/i, run: () => ({ meta: { changes: 1 } }) },
      ]),
    });
    let res = null;
    await withUpstream(async (u, opts) => {
      if (u.includes('api.resend.com')) { sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); }
      return new Response('{}', { status: 200 });
    }, async () => { res = await mod.onRequestPost(ctx); });
    await Promise.all(ctx.waits);
    spy.restore();
    assert(!spy.ourFault(), `the contact path runs without a scope/type error${spy.ourFault() ? ` — ${spy.ourFault()}` : ''}`);
    assert(res && res.status === 200, `a valid message is accepted (got ${res && res.status})`);
    assert(rows.length === 1, `exactly one contact_messages row was written (${rows.length})`);
    assert(rows[0] && rows[0][2] === 'student@example.com', 'the reply address is normalized before storage');
    assert(rows[0] && rows[0][6] === null, 'a signed-out sender stores a null user_id, not a guess');
    assert(rows[0] && typeof rows[0][7] === 'string' && rows[0][7].length === 32 && !/\d+\.\d+\.\d+/.test(rows[0][7]),
      'the IP is stored as a peppered hash, never raw');
    assert(rows[0] && rows[0][3] === null && rows[0][5] === goodBody.body,
      'the optional name has its own column, so it cannot truncate the message body');
    assert(sent && sent.to[0] === 'hello@flightway.ai' && sent.reply_to === 'student@example.com',
      'the notification goes to the support inbox and replies to the student');
  }

  // 2. Resend down. The message is already durable, so this must NOT fail.
  {
    const rows = [];
    const spy = spyConsole();
    const ctx = contactCtx({
      body: goodBody,
      env: { RESEND_API_KEY: 're_test' },
      db: fakeDb([
        noSession,
        { re: /INSERT INTO contact_messages/i, run: (sql, args) => { rows.push(args); return { meta: { changes: 1 } }; } },
        { re: /INSERT INTO events/i, run: () => ({ meta: { changes: 1 } }) },
      ]),
    });
    let res = null;
    await withUpstream(async () => { throw new Error('resend unreachable'); }, async () => { res = await mod.onRequestPost(ctx); });
    await Promise.all(ctx.waits);
    spy.restore();
    assert(res && res.status === 200, 'a dead Resend still returns 200 — the row already landed');
    assert(rows.length === 1, 'and the message is still stored');
  }

  // 3. D1 down. The opposite: never paint success over a lost message.
  {
    const spy = spyConsole();
    const ctx = contactCtx({
      body: goodBody,
      db: fakeDb([noSession, { re: /INSERT INTO contact_messages/i, run: () => { throw new Error('D1 offline'); } }]),
    });
    let res = null;
    await withUpstream(async () => new Response('{}', { status: 200 }), async () => { res = await mod.onRequestPost(ctx); });
    spy.restore();
    const payload = res ? await res.json() : null;
    assert(res && res.status === 500, `a failed insert is an honest 500 (got ${res && res.status})`);
    assert(payload && /hello@flightway\.ai/.test(payload.error || ''),
      'and the error tells the student where to send it instead');
  }

  // 4. Validation + rate limit. Each rejection must be its own message.
  {
    const bad = async (body) => {
      const ctx = contactCtx({ body, db: fakeDb([noSession]) });
      const res = await mod.onRequestPost(ctx);
      return res.status;
    };
    assert(await bad({ ...goodBody, email: 'nope' }) === 400, 'a malformed email is rejected');
    assert(await bad({ ...goodBody, topic: 'free-text-topic' }) === 400, 'an off-allowlist topic is rejected');
    assert(await bad({ ...goodBody, body: 'hi' }) === 400, 'a one-word message is rejected');
    assert(await bad({ ...goodBody, email: `${'a'.repeat(300)}@example.com` }) === 400,
      'an over-long email is rejected before it reaches D1 (isValidEmail has no length bound)');

    const kv = fakeKv();
    let last = 0;
    for (let i = 0; i < 7; i += 1) {
      const ctx = contactCtx({
        body: goodBody,
        db: fakeDb([noSession, { re: /INSERT INTO contact_messages/i, run: () => ({ meta: { changes: 1 } }) }, { re: /INSERT INTO events/i, run: () => ({ meta: { changes: 1 } }) }]),
      });
      ctx.env.COACH_KV = kv;
      // eslint-disable-next-line no-await-in-loop
      await withUpstream(async () => new Response('{}', { status: 200 }), async () => { last = (await mod.onRequestPost(ctx)).status; });
    }
    assert(last === 429, `the seventh message from one IP inside an hour is rate limited (got ${last})`);
  }

  // 5. Turnstile: off by default, enforced once both keys exist.
  {
    const withKeys = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
    const ctxNoToken = contactCtx({ body: goodBody, env: withKeys, db: fakeDb([noSession]) });
    const resNoToken = await mod.onRequestPost(ctxNoToken);
    assert(resNoToken.status === 400, 'a configured Turnstile rejects a message with no token');

    const ctxBad = contactCtx({ body: { ...goodBody, turnstileToken: 'x' }, env: withKeys, db: fakeDb([noSession]) });
    let statusBad = 0;
    await withUpstream(async (u) => (u.includes('challenges.cloudflare.com')
      ? new Response(JSON.stringify({ success: false }), { status: 200 })
      : new Response('{}', { status: 200 })), async () => { statusBad = (await mod.onRequestPost(ctxBad)).status; });
    assert(statusBad === 400, 'and rejects a token Cloudflare says is bad');

    // Cloudflare unreachable must not become "nobody can contact support".
    const rows = [];
    const ctxDown = contactCtx({
      body: { ...goodBody, turnstileToken: 'x' },
      env: withKeys,
      db: fakeDb([noSession, { re: /INSERT INTO contact_messages/i, run: (s, a) => { rows.push(a); return { meta: { changes: 1 } }; } }, { re: /INSERT INTO events/i, run: () => ({ meta: { changes: 1 } }) }]),
    });
    let statusDown = 0;
    await withUpstream(async (u) => {
      if (u.includes('challenges.cloudflare.com')) throw new Error('unreachable');
      return new Response('{}', { status: 200 });
    }, async () => { statusDown = (await mod.onRequestPost(ctxDown)).status; });
    assert(statusDown === 200 && rows.length === 1, 'an unreachable Turnstile fails OPEN rather than closing the form');

    // ...but the fail-open must not be reachable ON PURPOSE. Without a length
    // bound, a caller posts a megabyte of junk, the 6s timeout fires, and the
    // degraded branch waves them through — a one-line bypass of the challenge.
    let reachedUpstream = false;
    const ctxHuge = contactCtx({ body: { ...goodBody, turnstileToken: 'x'.repeat(50000) }, env: withKeys, db: fakeDb([noSession]) });
    let statusHuge = 0;
    await withUpstream(async (u) => {
      if (u.includes('challenges.cloudflare.com')) { reachedUpstream = true; throw new Error('timeout'); }
      return new Response('{}', { status: 200 });
    }, async () => { statusHuge = (await mod.onRequestPost(ctxHuge)).status; });
    assert(statusHuge === 400 && !reachedUpstream,
      'an oversized token is rejected before the fetch, so the fail-open cannot be triggered on demand');

    // A refused challenge must give the attempt back — five an hour is tight
    // enough that three fumbled challenges would lock a real person out.
    const kv2 = fakeKv();
    for (let i = 0; i < 6; i += 1) {
      const c = contactCtx({ body: { ...goodBody, turnstileToken: '' }, env: withKeys, db: fakeDb([noSession]) });
      c.env.COACH_KV = kv2;
      // eslint-disable-next-line no-await-in-loop
      await mod.onRequestPost(c);
    }
    const after = contactCtx({
      body: goodBody,
      db: fakeDb([noSession, { re: /INSERT INTO contact_messages/i, run: () => ({ meta: { changes: 1 } }) }, { re: /INSERT INTO events/i, run: () => ({ meta: { changes: 1 } }) }]),
    });
    after.env.COACH_KV = kv2;
    let afterStatus = 0;
    await withUpstream(async () => new Response('{}', { status: 200 }), async () => { afterStatus = (await mod.onRequestPost(after)).status; });
    assert(afterStatus === 200, `six refused challenges do not burn the hourly allowance (got ${afterStatus})`);

    // And the rate-limit KEY is a hash: checkRateLimit persists whatever it is
    // handed as part of a KV key name, so a raw IP there IS a stored raw IP.
    const keys = [...kv2.map.keys()];
    assert(keys.length && keys.every((k) => !/\d+\.\d+\.\d+\.\d+/.test(k) && !k.includes('unknown')),
      `the rate-limit key carries no raw IP (${keys[0]})`);
  }
}

// ---------------------------------------------------------------------------
// S2 — the site-wide middleware. It now wraps EVERY response on the site, so a
// throw here is a total outage, not a degraded feature. Executed against the
// response shapes that would break a naive `new Response(res.body, res)`.

console.log('_middleware: host lockdown cannot break a response:');
{
  const mw = await import('../functions/_middleware.js');
  const call = async (url, res, env = { SESSION_PEPPER: 'p' }) => mw.onRequest({
    request: new Request(url), env, next: async () => res,
  });

  const prod = await call('https://flightway.ai/portal.html', new Response('<html>', { status: 200 }));
  assert(!prod.headers.get('X-Robots-Tag'), 'flightway.ai is served untagged');

  const proto = await call('https://flightwayjacobprototype.pages.dev/portal.html', new Response('<html>', { status: 200 }));
  assert(proto.headers.get('X-Robots-Tag') === 'noindex, nofollow', 'the prototype host is tagged noindex');
  assert(await proto.text() === '<html>', 'and the body survives the rewrite');

  const asset = await call('https://flightwayjacobprototype.pages.dev/assets/css/x.css',
    new Response('body{}', { status: 200, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }));
  assert(asset.headers.get('Cache-Control') === 'public, max-age=31536000, immutable',
    'existing headers (the immutable asset rule) are preserved, not replaced');

  // 304/204 have a null body; reconstructing one with a body throws.
  for (const status of [204, 304]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call('https://x.pages.dev/a', new Response(null, { status }));
    assert(r.status === status, `a ${status} passes through intact`);
  }

  const unconfigured = await call('https://flightway.ai/', new Response('x'), {});
  assert(unconfigured.status === 503, 'an unconfigured environment still refuses to serve (pre-existing guard intact)');

  const robots = await import('../functions/robots.txt.js');
  const rr = await robots.onRequest({ request: new Request('https://flightway.ai/robots.txt') });
  assert(rr.status === 200 && (await rr.text()).includes('Sitemap:'), 'GET /robots.txt executes and carries the sitemap');
}

// ---------------------------------------------------------------------------
// No endpoint writes a raw IP into a rate-limit KV key.
//
// `checkRateLimit` stores whatever it is handed under `auth_rate:<key>`, so a
// call site that interpolated `clientIp(request)` was writing the visitor's
// address into KV as a key NAME for the window. contact.js fixed its own; this
// asserts the property across the whole surface, two ways:
//   · SOURCE — no file builds a rate-limit key out of clientIp(request). This is
//     the anti-drift guarantee: a new endpoint that reaches for the old pattern
//     fails here rather than shipping the leak again.
//   · RUNTIME — drive a representative set of anonymous, IP-metered endpoints
//     with a known CF-Connecting-IP and confirm no KV key written matches an
//     IPv4/IPv6 shape or contains that address.

console.log('no rate-limit key carries a raw IP:');
{
  // 1. Source lint over every function.
  const fnDir = path.join(ROOT, 'functions');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
  const offenders = [];
  for (const file of walk(fnDir)) {
    if (file.endsWith(`_lib${path.sep}auth.js`)) continue; // defines clientIp + hashedIpKey
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/(checkRateLimit|refundRateLimit)/.test(line) && /clientIp\s*\(/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}: ${line.trim()}`);
      }
    }
  }
  assert(offenders.length === 0,
    `no rate-limit call interpolates a raw IP${offenders.length ? `\n    ${offenders.join('\n    ')}` : ''}`);

  // 2. hashedIpKey itself: peppered, truncated, and never the address.
  const authMod = await import('../functions/_lib/auth.js');
  const ipReq = (ip) => ({ headers: new Headers({ 'CF-Connecting-IP': ip }) });
  const TEST_IP = '203.0.113.99'; // TEST-NET-3, safe to hardcode
  const h1 = await authMod.hashedIpKey({ SESSION_PEPPER: 'p1' }, ipReq(TEST_IP));
  const h1b = await authMod.hashedIpKey({ SESSION_PEPPER: 'p1' }, ipReq(TEST_IP));
  const h2 = await authMod.hashedIpKey({ SESSION_PEPPER: 'p2' }, ipReq(TEST_IP));
  const hOther = await authMod.hashedIpKey({ SESSION_PEPPER: 'p1' }, ipReq('198.51.100.7'));
  assert(/^[0-9a-f]{32}$/.test(h1), 'hashedIpKey returns 32 hex chars');
  assert(!h1.includes(TEST_IP) && !/\d+\.\d+\.\d+\.\d+/.test(h1), 'and never the address itself');
  assert(h1 === h1b, 'deterministic for one (ip, pepper)');
  assert(h1 !== h2, 'pepper-sensitive — rotating the secret rebuckets everyone');
  assert(h1 !== hOther, 'distinct IPs get distinct buckets');

  // 3. Runtime, across a representative set. Each handler rate-limits early on
  //    the IP, so even if it later 4xxs on missing setup the key is already
  //    written — which is exactly what we want to inspect.
  const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
  const IPV6 = /(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{1,4}/i;
  const probe = async (label, run) => {
    const kv = fakeKv();
    try { await run(kv); } catch (_) { /* a later stage throwing is fine; the key is written first */ }
    const authKeys = [...kv.map.keys()].filter((k) => k.startsWith('auth_rate:'));
    assert(authKeys.length > 0, `${label}: a rate-limit key was written (the meter actually ran)`);
    const leaked = authKeys.filter((k) => k.includes(TEST_IP) || IPV4.test(k) || IPV6.test(k));
    assert(leaked.length === 0, `${label}: no rate-limit key carries an IP${leaked.length ? ` — ${leaked[0]}` : ''}`);
  };

  const headers = (extra = {}) => new Headers({ 'CF-Connecting-IP': TEST_IP, 'content-type': 'application/json', ...extra });

  // POST /events — anonymous beacon, meters on ev:<anon>:<ip-hash>. Needs a real
  // UA or the endpoint classifies it as a bot and drops it before persist runs.
  await probe('POST /events', async (kv) => {
    const mod = await import('../functions/events.js');
    const ctx = makeContext({ pathName: '/events', db: fakeDb([]), kv });
    ctx.request.headers = headers({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
    ctx.request.text = async () => JSON.stringify({ anon: 'anon-probe', events: [{ n: 'page_view' }] });
    await mod.onRequestPost(ctx);
    await Promise.all(ctx.waits);
  });

  // POST /contact — meters on contact:<ip-hash> (its own pre-existing hash).
  await probe('POST /contact', async (kv) => {
    const mod = await import('../functions/contact.js');
    const ctx = makeContext({ pathName: '/contact', body: { email: 'a@b.com', topic: 'support', body: 'a real sentence here' }, db: fakeDb([{ re: /FROM sessions/i, first: () => null }]), kv });
    ctx.request.headers = headers();
    await mod.onRequestPost(ctx);
  });

  // POST /waitlist-intent — meters on intent:<ip-hash>.
  await probe('POST /waitlist-intent', async (kv) => {
    const mod = await import('../functions/waitlist-intent.js');
    const ctx = makeContext({ pathName: '/waitlist-intent', body: { tier: 'monthly' }, db: fakeDb([{ re: /FROM sessions/i, first: () => null }]), kv });
    ctx.request.headers = headers();
    await mod.onRequestPost(ctx);
  });

  // POST /auth/login — meters on login:<ip-hash> before touching the user table.
  await probe('POST /auth/login', async (kv) => {
    const mod = await import('../functions/auth/login.js');
    const ctx = makeContext({ pathName: '/auth/login', body: { email: 'nobody@flightway.ai', password: 'whatever12' }, db: fakeDb([]), kv });
    ctx.request.headers = headers();
    await mod.onRequestPost(ctx);
  });
}

// ---------------------------------------------------------------------------
// S5 — Google OAuth (SDK-free start + callback).
//
// OAuth cannot be exercised against the real Google endpoints offline, so this
// drives the two Pages Functions directly and stubs Google's token endpoint. It
// covers what CAN be proven without a live client: the start redirect + PKCE/
// state/nonce shape, the sealed transaction round-trip, CSRF (state mismatch),
// the flag-off degradation, id-token claim validation (unverified email denied),
// and that link-vs-create + session-cookie parity behave. A manual live test is
// documented in the ledger for post-merge.

console.log('google oauth: /auth/google/start and /callback:');
{
  const CID = 'client-123.apps.googleusercontent.com';
  const { onRequestGet: googleStart } = await import('../functions/auth/google/start.js');
  const { onRequestGet: googleCallback } = await import('../functions/auth/google/callback.js');
  const { beginTransaction } = await import('../functions/_lib/google-oauth.js');

  const CALLBACK_URI = `${BASE}/auth/google/callback`;
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const idToken = (claims) => `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u(claims)}.sig`;
  const okClaims = (over = {}) => ({
    iss: 'https://accounts.google.com', aud: CID, sub: 'g-sub-1',
    email: 'newbie@gmail.com', email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600, ...over,
  });
  const setCookies = (res) => (res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []));
  const gctx = (url, { cookie, env } = {}) => {
    const h = new Headers({ 'CF-Connecting-IP': '203.0.113.5' });
    if (cookie) h.set('cookie', cookie);
    return { request: { method: 'GET', url, headers: h }, env, waitUntil: () => {} };
  };
  // Serve only Google's token endpoint; anything else 404s so a stray fetch fails loud.
  const withToken = async (respond, fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = async (u) => (String(u).includes('oauth2.googleapis.com/token')
      ? respond()
      : new Response('nope', { status: 404 }));
    try { return await fn(); } finally { globalThis.fetch = real; }
  };
  const tokenOk = (claims) => () => new Response(
    JSON.stringify({ id_token: idToken(claims), token_type: 'Bearer', access_token: 'a' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

  // --- start: configured -> 302 to Google with PKCE + state + nonce ---------
  {
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const res = await googleStart(gctx(`${BASE}/auth/google/start?return=/portal.html`, { env }));
    const loc = res.headers.get('location') || '';
    assert(res.status === 302, `start redirects (got ${res.status})`);
    assert(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'), 'start points at Google authorize');
    assert(/[?&]code_challenge_method=S256(&|$)/.test(loc) && /[?&]code_challenge=/.test(loc), 'carries a PKCE S256 challenge');
    assert(/[?&]state=/.test(loc) && /[?&]nonce=/.test(loc), 'carries state + nonce');
    assert(loc.includes(`client_id=${encodeURIComponent(CID)}`), 'carries the client id');
    assert(loc.includes(`redirect_uri=${encodeURIComponent(CALLBACK_URI)}`), 'redirect_uri is this origin/auth/google/callback');
    assert(setCookies(res).some((c) => /^fw_goauth=/.test(c) && /HttpOnly/.test(c) && /Secure/.test(c)), 'seals the transaction in an HttpOnly cookie');
  }

  // --- start: flag off -> bounce to sign-in, never to Google -----------------
  {
    const env = { SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const res = await googleStart(gctx(`${BASE}/auth/google/start`, { env }));
    assert(res.status === 302 && (res.headers.get('location') || '').startsWith('/auth.html?goauth_err='), 'flag-off start degrades to the sign-in page, not Google');
  }

  // --- callback: new email -> create verified account + sign in --------------
  {
    let inserted = null;
    const db = fakeDb([{ re: /INSERT INTO users/i, run: (sql, bound) => { inserted = bound; return { success: true }; } }]);
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: db, COACH_KV: fakeKv() };
    const { state, nonce, cookie } = await beginTransaction(env, '/portal.html');
    const res = await withToken(tokenOk(okClaims({ nonce })), () => googleCallback(
      gctx(`${BASE}/auth/google/callback?code=abc&state=${state}`, { cookie: `fw_goauth=${cookie}`, env }),
    ));
    const cookies = setCookies(res);
    assert(res.status === 302 && res.headers.get('location') === '/portal.html?fw_oauth=google&created=1', `new user lands on portal with created=1 (got ${res.headers.get('location')})`);
    assert(cookies.some((c) => /^fw_session=/.test(c) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c)), 'sets a session cookie with password-login parity');
    assert(cookies.some((c) => /^fw_goauth=;/.test(c)), 'clears the transaction cookie');
    assert(inserted && inserted[2] === 'g-sub-1' && inserted[1] === 'google-oauth' && !!inserted[3], 'stored google_sub, the no-password sentinel, and verified_at');
  }

  // --- callback: existing email -> link + sign in (a login, created=0) -------
  {
    let linked = null;
    const db = fakeDb([
      { re: /FROM users WHERE email/i, first: { email: 'existing@gmail.com', password_hash: 'pbkdf2$100000$aa$bb', created_at: '', updated_at: '' } },
      { re: /UPDATE users SET google_sub/i, run: (sql, bound) => { linked = bound; return { success: true }; } },
    ]);
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: db, COACH_KV: fakeKv() };
    const { state, nonce, cookie } = await beginTransaction(env, '/portal.html');
    const res = await withToken(tokenOk(okClaims({ sub: 'g-sub-2', email: 'existing@gmail.com', nonce })), () => googleCallback(
      gctx(`${BASE}/auth/google/callback?code=abc&state=${state}`, { cookie: `fw_goauth=${cookie}`, env }),
    ));
    assert(res.status === 302 && res.headers.get('location') === '/portal.html?fw_oauth=google&created=0', `existing user lands with created=0 (got ${res.headers.get('location')})`);
    assert(linked && linked[0] === 'g-sub-2', 'linked google_sub onto the existing row');
    assert(setCookies(res).some((c) => /^fw_session=/.test(c)), 'and signs them in');
  }

  // --- callback: unverified Google email -> denied ---------------------------
  {
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const { state, nonce, cookie } = await beginTransaction(env, '/portal.html');
    const res = await withToken(tokenOk(okClaims({ email_verified: false, nonce })), () => googleCallback(
      gctx(`${BASE}/auth/google/callback?code=abc&state=${state}`, { cookie: `fw_goauth=${cookie}`, env }),
    ));
    assert((res.headers.get('location') || '') === '/auth.html?goauth_err=unverified#signin', 'an unverified Google email is refused');
    assert(!setCookies(res).some((c) => /^fw_session=/.test(c)), 'and no session is created');
  }

  // --- callback: state mismatch (CSRF) -> fail, no session -------------------
  {
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const { cookie } = await beginTransaction(env, '/portal.html');
    const res = await withToken(tokenOk(okClaims()), () => googleCallback(
      gctx(`${BASE}/auth/google/callback?code=abc&state=WRONG`, { cookie: `fw_goauth=${cookie}`, env }),
    ));
    assert((res.headers.get('location') || '').startsWith('/auth.html?goauth_err=failed'), 'a forged state is rejected');
    assert(!setCookies(res).some((c) => /^fw_session=/.test(c)), 'and no session is created');
  }

  // --- callback: no transaction cookie -> fail -------------------------------
  {
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const res = await googleCallback(gctx(`${BASE}/auth/google/callback?code=abc&state=anything`, { env }));
    assert((res.headers.get('location') || '').startsWith('/auth.html?goauth_err=failed'), 'a callback without the sealed cookie is rejected');
  }

  // --- callback: token exchange fails -> fail, no session --------------------
  {
    const env = { GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 'sec', SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const { state, cookie } = await beginTransaction(env, '/portal.html');
    const res = await withToken(() => new Response('{"error":"invalid_grant"}', { status: 400 }), () => googleCallback(
      gctx(`${BASE}/auth/google/callback?code=abc&state=${state}`, { cookie: `fw_goauth=${cookie}`, env }),
    ));
    assert((res.headers.get('location') || '').startsWith('/auth.html?goauth_err=failed'), 'a failed token exchange is an error, not a crash');
    assert(!setCookies(res).some((c) => /^fw_session=/.test(c)), 'and no session is created');
  }

  // --- callback: flag off -> fail --------------------------------------------
  {
    const env = { SESSION_PEPPER: 'pep', DB: fakeDb(), COACH_KV: fakeKv() };
    const res = await googleCallback(gctx(`${BASE}/auth/google/callback?code=abc&state=x`, { env }));
    assert((res.headers.get('location') || '').startsWith('/auth.html?goauth_err=failed'), 'flag-off callback degrades cleanly');
  }
}

// ---------------------------------------------------------------------------
// V2 §4 cap re-tier (S8). test:entitlements proves the TABLE; this proves the
// ENDPOINTS read it — that the walls §4 removed are gone from the request path
// and the walls it added actually refuse.
console.log('V2 §4: the weekly loop is free, the tools are metered:');
{
  // §4 D1's headline row, and S7's top-priority deferral: the Weekly Flight Plan
  // is a primary nav tab, so a 402 here is a locked front door for every free
  // account. It must never come back.
  const wk = await runHandler('../functions/weekly-plan.js', {
    entry: 'onRequestGet', pathName: '/weekly-plan', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(wk.res && wk.res.status !== 402,
    `a free account is never 402'd off the Weekly Flight Plan (got ${wk.res && wk.res.status})`);
  const rc = await runHandler('../functions/receipts.js', {
    entry: 'onRequestGet', pathName: '/receipts', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(rc.res && rc.res.status !== 402,
    `receipts follow the plan they belong to — free (got ${rc.res && rc.res.status})`);

  // Mock interviews were free:0 — a hard gate ABOVE the counter. §4 gives free
  // one lifetime taste, which only works if that gate is gone.
  const iv = await runHandler('../functions/mock-interview.js', {
    entry: 'onRequestPost', pathName: '/mock-interview',
    body: { action: 'turn', career: 'Credit Analyst', transcript: [] },
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(iv.res && iv.res.status !== 402,
    `a free account reaches its one mock-interview taste (got ${iv.res && iv.res.status})`);

  const opp = await runHandler('../functions/opportunities.js', {
    entry: 'onRequestGet', pathName: '/opportunities', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(opp.res && opp.res.status !== 402,
    `the Opportunity Finder is a preview on free, not a wall (got ${opp.res && opp.res.status})`);
}

console.log('V2 §4: the free Opportunity preview is truncated SERVER-side:');
{
  const { shapeForPlan } = await import('../functions/opportunities.js');
  const five = { opportunities: [1, 2, 3, 4, 5].map((n) => ({ title: `real-${n}`, url: `https://x/${n}` })), grounded: true };
  const free = shapeForPlan(five, 'free');
  assert(free.opportunities.length === 2 && free.lockedCount === 3,
    'a free plan is served the top 2 and told how many it is missing');
  // The whole point: the locked items are absent from the PAYLOAD, so no amount
  // of devtools work reveals what a CSS blur would have been hiding.
  assert(!JSON.stringify(free).includes('real-3'),
    'the locked opportunities are never serialized — this is truncation, not a blur');
  const paid = shapeForPlan(five, 'premium');
  assert(paid.opportunities.length === 5 && paid.lockedCount === 0, 'a paying plan gets the whole list');
  assert(shapeForPlan(five, 'premium').opportunities.length === 5,
    'the paywall-dark plan resolves to premium, so the preview is inert until the flag flips');
  assert(shapeForPlan({ opportunities: [{ title: 'only' }] }, 'free').lockedCount === 0,
    'a list already inside the free allowance is not truncated and locks nothing');
}

console.log('V2 §4: a cached sim costs nothing; the monthly allowance refuses the next one:');
{
  // The reason anonymous students still get sims at all: sim-generate serves the
  // shared simv2:<slug> blob before it ever looks at a session, so a cache hit
  // must not touch the counter.
  const kv = fakeKv();
  await kv.put('simv2:credit-analyst', JSON.stringify({ pub: { title: 'Credit Analyst' }, secrets: {} }));
  const hit = await runHandler('../functions/sim-generate.js', {
    entry: 'onRequest', pathName: '/sim-generate',
    body: { slug: 'credit-analyst', name: 'Credit Analyst' },
    db: FREE_DB(), kv, env: FREE_ENV,
  });
  assert(hit.res && hit.res.status === 200, `a cached sim is served (got ${hit.res && hit.res.status})`);
  assert(await featureUsed(kv, 'career-sim') === 0,
    'and spends none of the monthly allowance — metering a KV read would wall off the discovery funnel');

  // Now spend the month, then ask for an UNCACHED sim.
  const kv2 = fakeKv();
  await checkFeatureLimit({ PAYWALL_ENABLED: 'true', COACH_KV: kv2 }, EMAIL, 'career-sim', { plan: 'free' });
  const capped = await runHandler('../functions/sim-generate.js', {
    entry: 'onRequest', pathName: '/sim-generate',
    body: { slug: 'nothing-cached', name: 'Nothing Cached' },
    db: FREE_DB(), kv: kv2, env: FREE_ENV,
  });
  const cappedBody = capped.res && capped.res.status === 429 ? await capped.res.json() : null;
  assert(capped.res && capped.res.status === 429 && cappedBody && cappedBody.upgrade === true,
    `a spent monthly allowance refuses with 429 + upgrade (got ${capped.res && capped.res.status})`);
  assert(!capped.ourFault, `the sim cap path runs without a scope/type error${capped.ourFault ? ` — ${capped.ourFault}` : ''}`);

  // Refund: a generation that produced nothing must not cost the month.
  const kv3 = fakeKv();
  const failed = await runHandler('../functions/sim-generate.js', {
    entry: 'onRequest', pathName: '/sim-generate',
    body: { slug: 'also-not-cached', name: 'Also Not Cached' },
    db: FREE_DB(), kv: kv3, env: FREE_ENV,
  });
  assert(failed.res && failed.res.status >= 400, `a dead upstream is an error, not a crash (got ${failed.res && failed.res.status})`);
  assert(await featureUsed(kv3, 'career-sim') === 0,
    'and the monthly sim came back — our failure is never the student\'s cost');
}

// ---------------------------------------------------------------------------
// S11 — GET /month-review and the admin broadcast composer.
//
// Two things here are only provable at the request layer: that the review is
// free and session-scoped (nobody can name another student's month), and that
// the composer NEVER mails a segment from inside a Pages Function — it queues,
// and the cron sends. A future "just send it inline, it's only a few users"
// would be invisible in a code review and catastrophic at 500 users.

console.log('S11 GET /month-review:');
{
  const { availableMonths } = await import('../functions/month-review.js');
  const months = availableMonths(Date.parse('2026-07-15T00:00:00Z'));
  assert(months.length === 12 && months[0].month === '2026-07', 'twelve months, newest first');
  assert(months[months.length - 1].month === '2025-08', 'and the window walks back across the year boundary');

  const ok = await runHandler('../functions/month-review.js', {
    entry: 'onRequestGet', pathName: '/month-review?m=2026-06', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(ok.res && ok.res.status === 200, `a FREE account reads its review (got ${ok.res && ok.res.status})`);
  assert(ok.res && ok.res.status !== 402, 'the review is never metered — §4 calls metering it self-harm');
  assert(!ok.ourFault, `the review path runs clean${ok.ourFault ? ` — ${ok.ourFault}` : ''}`);
  const okBody = await ok.res.json();
  assert(okBody.review && okBody.review.month === '2026-06', 'and gets the month it asked for');
  assert(Array.isArray(okBody.months) && okBody.months.length === 12, 'plus the picker’s month list');

  // A WELL-FORMED month outside the 12-month window is refused. (A malformed
  // one is a different case, below — the two must not collapse into each other.)
  const bad = await runHandler('../functions/month-review.js', {
    entry: 'onRequestGet', pathName: '/month-review?m=2021-01', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(bad.res && bad.res.status === 400, 'a month outside the window is refused, not silently coerced');

  const garbage = await runHandler('../functions/month-review.js', {
    entry: 'onRequestGet', pathName: '/month-review?m=<script>', method: 'GET',
    db: FREE_DB(), env: FREE_ENV,
  });
  assert(garbage.res && garbage.res.status === 200, 'a garbage month falls back to the default rather than erroring');
  const garbageBody = garbage.res.status === 200 ? await garbage.res.json() : null;
  assert(garbageBody && /^\d{4}-\d{2}$/.test(garbageBody.review.month),
    'and the fallback is a real month, never the raw string echoed back');

  // Signed out: the D1 stub answers the session lookup with a live row by
  // default, so this one has to say no explicitly — and with a FUNCTION, since
  // a bare `first: null` is falsy and the stub falls through to the default.
  const out = await runHandler('../functions/month-review.js', {
    entry: 'onRequestGet', pathName: '/month-review', method: 'GET',
    db: fakeDb([{ re: /FROM sessions/i, first: () => null }]), env: FREE_ENV,
  });
  assert(out.res && out.res.status === 401, `signed out is 401 (got ${out.res && out.res.status})`);
}

console.log('S11 POST /admin/broadcasts:');
{
  const ADMIN = EMAIL;
  const adminDb = (extra = []) => fakeDb([
    { re: /FROM admin_roles/i, first: { email: ADMIN, role: 'admin' } },
    { re: /FROM users\b/i, first: { email: ADMIN, plan: 'premium' } },
    ...extra,
  ]);
  const ADMIN_ENV = { ROOT_ADMIN_EMAIL: ADMIN, SESSION_PEPPER: 'pep', RESEND_API_KEY: 're_test' };
  const elevated = async () => {
    const kv = fakeKv();
    const { grantElevation } = await import('../functions/_lib/admin.js');
    await grantElevation({ COACH_KV: kv }, ADMIN);
    return kv;
  };

  // 404, not 403: the console's existence is not discoverable (house rule).
  const anon = await runHandler('../functions/admin/broadcasts.js', {
    entry: 'onRequestGet', pathName: '/admin/broadcasts', method: 'GET',
    db: fakeDb([{ re: /FROM admin_roles/i, first: null }]), env: { SESSION_PEPPER: 'pep' },
  });
  assert(anon.res && anon.res.status === 404, `a non-admin gets 404, never 403 (got ${anon.res && anon.res.status})`);

  const list = await runHandler('../functions/admin/broadcasts.js', {
    entry: 'onRequestGet', pathName: '/admin/broadcasts', method: 'GET',
    db: adminDb(), env: ADMIN_ENV,
  });
  assert(list.res && list.res.status === 200, `an admin reads the list (got ${list.res && list.res.status})`);
  const listBody = await list.res.json();
  assert(Array.isArray(listBody.segments) && listBody.segments.length === 5, 'the segment list is served, never hand-written client-side');
  assert(listBody.limits && listBody.limits.subject > 0 && listBody.limits.body > 0, 'and so are the length limits');

  // Preview is a read: admin, no elevation, and it must not send.
  let sent = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (String(u).includes('api.resend.com')) { sent += 1; return new Response(JSON.stringify({ id: 'm' }), { status: 200 }); }
    return new Response('no', { status: 404 });
  };
  try {
    const pv = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'preview', subject: 'Hello', body: '**hi** <script>x</script>', segment: 'all' },
      db: adminDb(), env: ADMIN_ENV,
    });
    assert(pv.res && pv.res.status === 200, `preview needs no elevation (got ${pv.res && pv.res.status})`);
    const pvBody = await pv.res.json();
    assert(/<strong>hi<\/strong>/.test(pvBody.html) && !/<script/i.test(pvBody.html), 'preview renders markdown and escapes the rest');
    assert(sent === 0, 'AND SENDS NOTHING — a preview that mails anyone is the worst bug available here');

    // Queue without elevation: refused.
    const noElev = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'queue', subject: 'Hello', body: 'hi', segment: 'all' },
      db: adminDb(), env: ADMIN_ENV,
    });
    assert(noElev.res && noElev.res.status === 403, `queueing without elevation is 403 (got ${noElev.res && noElev.res.status})`);
    const neBody = await noElev.res.json();
    assert(neBody.elevate === true, 'and tells the console to prompt for the password');
    assert(sent === 0, 'still nothing sent');

    // Queue WITH elevation: writes a scheduled row, sends nothing.
    const writes = [];
    const kv = await elevated();
    const q = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'queue', subject: 'Hello', body: 'hi', segment: 'all' },
      db: adminDb([{ re: /INSERT INTO broadcasts/i, run: (sql, bound) => { writes.push(bound); return { success: true }; } }]),
      kv, env: ADMIN_ENV,
    });
    assert(q.res && q.res.status === 200, `an elevated admin queues (got ${q.res && q.res.status})`);
    const qBody = await q.res.json();
    assert(qBody.status === 'scheduled', 'the response says SCHEDULED, not sent');
    assert(writes.length === 1 && writes[0].includes(ADMIN), 'a row was written, stamped with the acting admin');
    assert(sent === 0,
      'and the ENDPOINT MAILED NOBODY — the cron is the only sender, so a slow SMTP hop can never cut a send in half');

    // A validation failure never writes and never sends.
    const badSeg = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'queue', subject: 'Hello', body: 'hi', segment: 'school' },
      kv: await elevated(), db: adminDb(), env: ADMIN_ENV,
    });
    assert(badSeg.res && badSeg.res.status === 400, 'a school segment with no school name is 400');

    // Cancel only bites a still-scheduled row.
    const gone = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'cancel', id: 'bc_nope' },
      kv: await elevated(),
      db: adminDb([{ re: /UPDATE broadcasts/i, run: () => ({ meta: { changes: 0 } }) }]),
      env: ADMIN_ENV,
    });
    assert(gone.res && gone.res.status === 409,
      `cancelling an already-sending broadcast is a 409, not a lie in the record (got ${gone.res && gone.res.status})`);

    const unknown = await runHandler('../functions/admin/broadcasts.js', {
      entry: 'onRequestPost', pathName: '/admin/broadcasts',
      body: { action: 'nuke' }, kv: await elevated(), db: adminDb(), env: ADMIN_ENV,
    });
    assert(unknown.res && unknown.res.status === 400, 'an unknown action is refused');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// S12 — Application Tracker CRUD + cross-user authorization (plan §5 S12's
// mandatory gate). Driven against REAL SQLITE loaded from the real migration,
// not the regex D1 stub above: an ownership bug lives in a WHERE clause, and a
// stub that pattern-matches SQL cannot tell `WHERE id = ?` from
// `WHERE id = ? AND user_id = ?`. That distinction is the entire security
// property of this endpoint, so it gets a database that enforces it.

{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.log('\n  SKIP applications: node:sqlite unavailable (upgrade to Node 22.5+)');
  } else {
    console.log('\napplications: CRUD, dedupe and cross-user authz against real SQLite:');
    const { createUser, createSession } = await import('../functions/_lib/auth.js');
    const apps = await import('../functions/tracker.js');
    const { countMovedByUser } = await import('../functions/_lib/application-store.js');
    const { APPLICATION_STATUSES, isAdvance, opportunityRefFor, sanitizeUrl } = await import('../functions/_lib/application-core.js');

    const readMig = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
    const d1For = (sqlite) => ({
      prepare(sql) {
        const runP = (p) => { const r = sqlite.prepare(sql).run(...p); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (p) => ({ results: sqlite.prepare(sql).all(...p) });
        const firstP = (p) => (sqlite.prepare(sql).get(...p) ?? null);
        return {
          bind(...p) { return { async run() { return runP(p); }, async all() { return allP(p); }, async first() { return firstP(p); } }; },
          async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
        };
      },
      async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
    });

    const sqlite = new DatabaseSync(':memory:');
    // 0010 is in the list because 0022 ALTERs `artifacts` — the migration has a
    // real ordering dependency and this is the only place that proves it.
    for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0010_v2_artifacts.sql',
      '0013_user_profiles.sql', '0017_analytics.sql', '0019_email_v2.sql',
      '0020_deadlines.sql', '0022_applications.sql']) {
      sqlite.exec(readMig(m));
    }
    const env = {
      SESSION_PEPPER: 'test-session-pepper',
      ALLOWED_ORIGIN: BASE,
      SITE_URL: BASE,
      DB: d1For(sqlite),
      COACH_KV: fakeKv(),
    };

    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get() != null,
      'migration 0022 creates the applications table');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='applications'").get().c >= 3,
      'and its three indexes, including the partial UNIQUE on (user_id, opportunity_ref)');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM pragma_table_info('artifacts') WHERE name IN ('url','updated_at')").get().c === 2,
      '0022 also adds url + updated_at to artifacts (the Evidence Locker columns)');

    const A = 'appa@x.com';
    const B = 'appb@x.com';
    await createUser(env, A, 'h');
    await createUser(env, B, 'h');
    const { token: tokenA } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);

    const ctx = (method, { token, body } = {}) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      return { env, request: { url: `${BASE}/tracker`, method, headers, json: async () => body } };
    };
    const post = async (token, body) => {
      const res = await apps.onRequestPost(ctx('POST', { token, body }));
      return { status: res.status, body: await res.json() };
    };
    const get = async (token) => {
      const res = await apps.onRequestGet(ctx('GET', { token }));
      return { status: res.status, body: await res.json() };
    };
    const rowCount = (user) => sqlite.prepare('SELECT COUNT(*) c FROM applications WHERE user_id=?').get(user).c;

    // -- auth ---------------------------------------------------------------
    assert((await apps.onRequestGet(ctx('GET'))).status === 401, 'signed out → 401 on the board, never a leak');
    assert((await apps.onRequestPost(ctx('POST', { body: { action: 'save', role: 'x' } }))).status === 401,
      'and on the write path too');

    // -- create + dedupe ----------------------------------------------------
    const saved = await post(tokenA, {
      action: 'save', source: 'finder', role: 'Summer Analyst', company: 'Goldman Sachs',
      url: 'https://example.com/roles/summer-analyst', careerSlug: 'ib',
    });
    assert(saved.status === 200 && saved.body.ok && !saved.body.duplicate, 'a finder result saves');
    assert(saved.body.application.status === 'interested', 'and lands at the head of the ladder');
    const appId = saved.body.application.id;

    const again = await post(tokenA, {
      action: 'save', source: 'finder', role: 'Summer Analyst (2027)', company: 'Goldman Sachs',
      url: 'https://example.com/roles/summer-analyst',
    });
    assert(again.status === 200 && again.body.ok && again.body.duplicate === true,
      'saving the SAME opportunity twice is a success that reports duplicate, not an error');
    assert(rowCount(A) === 1, 'and it is still exactly one row — the partial UNIQUE index holds');

    const manual1 = await post(tokenA, { action: 'save', source: 'manual', role: 'Trading Intern' });
    const manual2 = await post(tokenA, { action: 'save', source: 'manual', role: 'Trading Intern' });
    assert(manual1.body.ok && manual2.body.ok && !manual2.body.duplicate && rowCount(A) === 3,
      'two manual rows with the same role are two rows — a student may well be applying to two of them');

    // -- validation ---------------------------------------------------------
    const noRole = await post(tokenA, { action: 'save', role: ' ' });
    assert(noRole.status === 400 && /role/i.test(noRole.body.error || ''), 'a nameless application is refused with product copy');
    const hostile = await post(tokenA, {
      action: 'save', source: 'manual', role: '<img src=x onerror=alert(1)>Quant Intern',
      url: 'javascript:alert(1)',
    });
    const hostileRow = sqlite.prepare('SELECT role, url FROM applications WHERE id=?').get(hostile.body.application.id);
    assert(!/[<>]/.test(hostileRow.role), 'angle brackets never reach the row (the role comes off a grounded web result)');
    assert(hostileRow.url == null, 'and a javascript: url is dropped, not stored');
    assert(sanitizeUrl('http://x.example') === '' && sanitizeUrl('https://x.example/a') === 'https://x.example/a',
      'https only, both directions');

    // -- status ladder ------------------------------------------------------
    const moved = await post(tokenA, { action: 'status', id: appId, status: 'applied' });
    assert(moved.status === 200 && moved.body.advanced === true && moved.body.from === 'interested',
      'moving forward reports the advance and where it came from');
    const statusAt1 = sqlite.prepare('SELECT status_at, updated_at FROM applications WHERE id=?').get(appId);
    assert(!!statusAt1.status_at, 'a status move writes status_at');
    assert(sqlite.prepare('SELECT COUNT(*) c FROM applications WHERE user_id=? AND status_at IS NULL').get(A).c === 3,
      'while a row that was only SAVED has a null status_at — saving is not moving');

    const noop = await post(tokenA, { action: 'status', id: appId, status: 'applied' });
    assert(noop.body.ok && noop.body.changed === false, 're-sending the same status is a no-op, not a fake move');

    const back = await post(tokenA, { action: 'status', id: appId, status: 'closed' });
    assert(back.body.advanced === true, 'closed is further along the ladder than applied, so it counts as a move forward');
    assert(isAdvance('interviewing', 'applied') === false, 'and a genuine step BACK is not an advance');
    assert(isAdvance('applied', 'nonsense') === false, 'an unknown status is never an advance');

    // The invariant the weekly digest and the Month in Review both count on.
    const beforeEdit = sqlite.prepare('SELECT status_at FROM applications WHERE id=?').get(appId).status_at;
    await new Promise((r) => setTimeout(r, 2));
    const edited = await post(tokenA, { action: 'update', id: appId, notes: 'phone screen on the 3rd' });
    const afterEdit = sqlite.prepare('SELECT status_at, updated_at, notes FROM applications WHERE id=?').get(appId);
    assert(edited.body.ok && afterEdit.notes === 'phone screen on the 3rd', 'a notes edit lands');
    assert(afterEdit.status_at === beforeEdit,
      'and does NOT touch status_at — a typo fix is not an application advancing');
    assert(afterEdit.updated_at >= beforeEdit, 'updated_at moves instead');

    const badUrl = await post(tokenA, { action: 'update', id: appId, url: 'ftp://nope' });
    assert(badUrl.status === 400, 'a non-https link is refused rather than silently blanked');

    // -- CROSS-USER AUTHZ (mandatory per plan §3.8 / §5 S12) ----------------
    const bStatus = await post(tokenB, { action: 'status', id: appId, status: 'offer' });
    assert(bStatus.status === 404, "another user's row is 404 on status — not 403, which would confirm it exists");
    const bUpdate = await post(tokenB, { action: 'update', id: appId, notes: 'pwned' });
    assert(bUpdate.status === 404, "and 404 on update");
    const bDelete = await post(tokenB, { action: 'delete', id: appId });
    assert(bDelete.status === 404, 'and 404 on delete');
    const survived = sqlite.prepare('SELECT status, notes FROM applications WHERE id=?').get(appId);
    assert(survived.status === 'closed' && survived.notes === 'phone screen on the 3rd',
      "and A's row is byte-for-byte untouched after all three attempts");
    assert(rowCount(A) === 4 && rowCount(B) === 0, 'B still has no rows of their own');

    const bBoard = await get(tokenB);
    assert(bBoard.status === 200 && bBoard.body.applications.length === 0,
      "B's board never contains A's applications");

    // -- read shape ---------------------------------------------------------
    const board = await get(tokenA);
    assert(board.body.applications.length === 4, 'A sees exactly their own four');
    assert(board.body.available === true, 'with 0022 applied the board reports itself available');
    assert(Array.isArray(board.body.statuses) && board.body.statuses.length === APPLICATION_STATUSES.length,
      'the board ships the status list from the server, so the client never hand-writes the ladder');
    assert(board.body.counts && board.body.counts.total === 4 && typeof board.body.counts.open === 'number',
      'and the counts every surface renders from');

    // -- delete -------------------------------------------------------------
    const del = await post(tokenA, { action: 'delete', id: appId });
    assert(del.status === 200 && del.body.ok && rowCount(A) === 3, 'the owner can delete their own row');
    assert((await post(tokenA, { action: 'delete', id: appId })).status === 404, 'and deleting it twice is a 404');

    assert((await post(tokenA, { action: 'nuke' })).status === 400, 'an unknown action is refused');

    // -- the digest aggregate ----------------------------------------------
    const movedMap = await countMovedByUser(env, '2000-01-01T00:00:00.000Z');
    assert((movedMap.get(A) || 0) === 0,
      'the deleted row takes its stage moves with it — the digest cannot count a row that no longer exists');
    const fresh = await post(tokenA, { action: 'save', source: 'manual', role: 'Risk Analyst' });
    await post(tokenA, { action: 'status', id: fresh.body.application.id, status: 'interviewing' });
    const movedMap2 = await countMovedByUser(env, '2000-01-01T00:00:00.000Z');
    assert((movedMap2.get(A) || 0) === 1 && !movedMap2.has(B),
      'and one aggregate query answers the whole run, per user');

    // -- the deadline link --------------------------------------------------
    const dated = await post(tokenA, {
      action: 'save', source: 'finder', role: 'Fellowship Application', company: 'Bain',
      url: 'https://example.com/fellowship', deadline: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
    });
    assert(dated.body.ok && dated.body.application.deadlineId,
      'a dated opportunity also lands on the Deadline Radar and the application carries the link');
    const past = await post(tokenA, {
      action: 'save', source: 'finder', role: 'Expired Program', url: 'https://example.com/expired', deadline: '2020-01-01',
    });
    assert(past.body.ok && !past.body.application.deadlineId,
      'a date the radar refuses leaves the application perfectly usable rather than failing the save');

    assert(opportunityRefFor({ source: 'manual', url: 'https://x.example/a' }) === '',
      'manual entries carry no dedupe ref, which is what lets a student track two of the same thing');

    // -- migration 0022 pending -------------------------------------------
    // The state the prototype is actually in between this deploy and Jacob
    // applying the migration. It must be an honest notice, not a save that
    // fails for reasons the student cannot act on.
    {
      const bare = new DatabaseSync(':memory:');
      for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql', '0017_analytics.sql']) {
        bare.exec(readMig(m));
      }
      const bareEnv = { ...env, DB: d1For(bare) };
      await createUser(bareEnv, A, 'h');
      const { token } = await createSession(bareEnv, A);
      const bareCtx = (method, body) => {
        const headers = new Headers({ 'content-type': 'application/json', origin: BASE, cookie: `fw_session=${token}` });
        return { env: bareEnv, request: { url: `${BASE}/tracker`, method, headers, json: async () => body } };
      };
      const g = await apps.onRequestGet(bareCtx('GET'));
      const gb = await g.json();
      assert(g.status === 200 && gb.available === false && gb.applications.length === 0,
        'with 0022 pending the board still answers 200 and reports available:false');
      const p = await apps.onRequestPost(bareCtx('POST', { action: 'save', role: 'Anything' }));
      const pb = await p.json();
      assert(p.status === 503 && pb.unavailable === true && /not switched on/i.test(pb.error),
        'and a save is refused with a sentence the student can read, not a generic failure');
    }
  }
}

// ---------------------------------------------------------------------------
// S16 — the readiness scorecard endpoint, against real SQLite.
//
// The regex D1 stub cannot answer this one either: the property under test is
// that a stored report is reachable ONLY by the account that owns it, and that
// lives in a WHERE clause. The second property is the meter — a run refused
// before it starts must not cost a free account its single lifetime taste.
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.log('\n  SKIP scorecard: node:sqlite unavailable (upgrade to Node 22.5+)');
  } else {
    console.log('\nscorecard: auth, ownership and the meter against real SQLite:');
    const { createUser, createSession } = await import('../functions/_lib/auth.js');
    const sc = await import('../functions/scorecard.js');
    const { insertScorecard } = await import('../functions/_lib/scorecard-store.js');
    const { featureKvKey } = await import('../functions/_lib/plan-limits.js');

    const readMig = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
    const d1For = (sqlite) => ({
      prepare(sql) {
        const runP = (p) => { const r = sqlite.prepare(sql).run(...p); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (p) => ({ results: sqlite.prepare(sql).all(...p) });
        const firstP = (p) => (sqlite.prepare(sql).get(...p) ?? null);
        return {
          bind(...p) { return { async run() { return runP(p); }, async all() { return allP(p); }, async first() { return firstP(p); } }; },
          async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
        };
      },
      async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
    });

    const sqlite = new DatabaseSync(':memory:');
    for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql',
      '0017_analytics.sql', '0019_email_v2.sql', '0024_scorecards.sql']) {
      sqlite.exec(readMig(m));
    }
    const kv = fakeKv();
    const env = {
      SESSION_PEPPER: 'test-session-pepper',
      ALLOWED_ORIGIN: BASE,
      SITE_URL: BASE,
      DB: d1For(sqlite),
      COACH_KV: kv,
      PAYWALL_ENABLED: 'true',
    };

    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scorecards'").get() != null,
      'migration 0024 creates the scorecards table');

    const A = 'sca@x.com';
    const B = 'scb@x.com';
    await createUser(env, A, 'h');
    await createUser(env, B, 'h');
    const { token: tokenA } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);

    const ctx = (method, { token, body } = {}) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      return { env, request: { url: `${BASE}/scorecard`, method, headers, json: async () => body } };
    };
    const post = async (token, body) => {
      const res = await sc.onRequestPost(ctx('POST', { token, body }));
      return { status: res.status, body: await res.json() };
    };

    // -- auth ---------------------------------------------------------------
    assert((await sc.onRequestGet(ctx('GET'))).status === 401, 'signed out -> 401 on the read');
    assert((await sc.onRequestPost(ctx('POST', { body: { action: 'run' } }))).status === 401,
      'and on the run, before anything is spent');

    // -- the empty read -----------------------------------------------------
    {
      const res = await sc.onRequestGet(ctx('GET', { token: tokenA }));
      const b = await res.json();
      assert(res.status === 200 && b.ready === true && b.report === null && b.trend.length === 0,
        'a signed-in account with no history reads 200 / ready / empty');
      assert(b.cap && b.cap.limit === 1 && b.cap.remaining === 1,
        'and the cap state comes from plan-limits, not from the page');
    }

    // -- grounding off: refused, and NOT charged -----------------------------
    {
      const r = await post(tokenA, { action: 'run' });
      assert(r.status === 200 && r.body.ok === false && r.body.reason === 'grounding-off',
        'with grounding off the run is refused with a readable sentence, not a 500');
      assert(typeof r.body.message === 'string' && r.body.message.length > 20,
        'and the sentence is the server\'s, ready to render');
      const spent = await kv.get(featureKvKey('scorecard-run', A, Date.now(), 'free'));
      assert(!spent || Number(spent) === 0,
        'a run refused before it started never costs the one free lifetime taste');
    }

    // -- unknown action -----------------------------------------------------
    assert((await post(tokenA, { action: 'destroy' })).status === 400, 'an unknown action is a 400');
    assert((await post(tokenA, { action: 'commit' })).status === 400, 'commit with no actionId is a 400');

    // -- ownership ----------------------------------------------------------
    {
      const report = {
        v: 1, careerName: 'Quantitative Analyst', careerSlug: 'quant', school: '', source: 'manual',
        ranAt: new Date().toISOString(), score: 50, band: 'building', bandLabel: 'Building', bandBlurb: 'x',
        counts: { met: 1, partial: 0, missing: 1, total: 2, coreMet: 1, coreTotal: 2 },
        postings: [], requirements: [], sources: [], fetchedAt: null,
        actions: [{ id: 'sca-abc', text: 'Take the statistics sequence.', requirement: 'Statistics coursework' }],
      };
      const saved = await insertScorecard(env, A, {
        report, scored: { score: 50, met: 1, partial: 0, missing: 1 },
        careerName: 'Quantitative Analyst', careerSlug: 'quant', source: 'manual',
      });
      assert(saved.ok, 'a report stores');

      const mine = await sc.onRequestGet(ctx('GET', { token: tokenA }));
      const mineBody = await mine.json();
      assert(mineBody.report && mineBody.report.actions[0].id === 'sca-abc', 'the owner reads their own report back');

      const theirs = await sc.onRequestGet(ctx('GET', { token: tokenB }));
      const theirsBody = await theirs.json();
      assert(theirsBody.report === null, 'another account never sees it');

      // The commit path takes a scorecardId. Naming someone else's row must be
      // indistinguishable from naming one that does not exist.
      const cross = await post(tokenB, { action: 'commit', scorecardId: saved.id, actionId: 'sca-abc' });
      assert(cross.status === 404, "another account cannot commit an action off someone else's scorecard");

      // The owner gets the same 404 here only because they have no roadmap —
      // asserted so the 404 above is proven to be about OWNERSHIP, not about a
      // shared failure mode that would mask it.
      const ownNoRoadmap = await post(tokenA, { action: 'commit', scorecardId: saved.id, actionId: 'sca-abc' });
      assert(ownNoRoadmap.status === 409 && /roadmap/i.test(ownNoRoadmap.body.error),
        'the owner instead gets a 409 telling them to build a roadmap first');
      const unknownAction = await post(tokenA, { action: 'commit', actionId: 'sca-nope' });
      assert(unknownAction.status === 404, 'an actionId that is on no report of theirs is a 404');
    }

    // -- 0024 pending -------------------------------------------------------
    {
      const bare = new DatabaseSync(':memory:');
      for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql',
        '0017_analytics.sql', '0019_email_v2.sql']) bare.exec(readMig(m));
      const bareEnv = { ...env, DB: d1For(bare), COACH_KV: fakeKv() };
      await createUser(bareEnv, A, 'h');
      const { token } = await createSession(bareEnv, A);
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE, cookie: `fw_session=${token}` });
      const bareCtx = (method, body) => ({ env: bareEnv, request: { url: `${BASE}/scorecard`, method, headers, json: async () => body } });
      const g = await sc.onRequestGet(bareCtx('GET'));
      const gb = await g.json();
      assert(g.status === 200 && gb.ready === false && /not switched on/i.test(gb.message),
        'with 0024 pending the panel is told so in a sentence, not shown a failure');
      const p = await sc.onRequestPost(bareCtx('POST', { action: 'run' }));
      const pb = await p.json();
      assert(p.status === 200 && pb.ok === false && pb.reason === 'not-ready',
        'and a run is refused before the meter is touched');
    }
  }
}

// ---------------------------------------------------------------------------
// S17 — the network mapper endpoint, against real SQLite.
//
// The regex D1 stub cannot answer this one: the properties under test are that a
// contact row is reachable and writable ONLY by the account that owns it, and
// that a status change is distinguishable from a metadata edit. Both live in
// WHERE clauses and in a CASE expression. The rows also name THIRD PARTIES — the
// people a student is trying to reach — which makes a cross-account read the
// worst possible defect in this table.
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.log('\n  SKIP outreach: node:sqlite unavailable (upgrade to Node 22.5+)');
  } else {
    console.log('\noutreach: auth, ownership and the ladder against real SQLite:');
    const { createUser, createSession } = await import('../functions/_lib/auth.js');
    const out = await import('../functions/outreach.js');
    const store = await import('../functions/_lib/contact-store.js');
    const { featureKvKey } = await import('../functions/_lib/plan-limits.js');
    const { STALE_DRAFT_DAYS } = await import('../functions/_lib/contact-core.js');

    const readMig = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
    const d1For = (sqlite) => ({
      prepare(sql) {
        const runP = (a) => { const r = sqlite.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (a) => ({ results: sqlite.prepare(sql).all(...a) });
        const firstP = (a) => (sqlite.prepare(sql).get(...a) ?? null);
        return {
          bind(...a) { return { async run() { return runP(a); }, async all() { return allP(a); }, async first() { return firstP(a); } }; },
          async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
        };
      },
      async batch(list) { const o = []; for (const st of list) o.push(await st.run()); return o; },
    });

    const sqlite = new DatabaseSync(':memory:');
    for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql',
      '0017_analytics.sql', '0019_email_v2.sql', '0025_contacts.sql']) {
      sqlite.exec(readMig(m));
    }
    const kv = fakeKv();
    const env = {
      SESSION_PEPPER: 'test-session-pepper',
      ALLOWED_ORIGIN: BASE,
      SITE_URL: BASE,
      DB: d1For(sqlite),
      COACH_KV: kv,
      PAYWALL_ENABLED: 'true',
    };

    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'").get() != null,
      'migration 0025 creates the contacts table');

    const A = 'nwa@x.com';
    const B = 'nwb@x.com';
    await createUser(env, A, 'h');
    await createUser(env, B, 'h');
    const { token: tokenA } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);

    const ctx = (method, { token, body } = {}) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      return { env, request: { url: `${BASE}/outreach`, method, headers, json: async () => body } };
    };
    const post = async (token, body) => {
      const res = await out.onRequestPost(ctx('POST', { token, body }));
      return { status: res.status, body: await res.json() };
    };
    const get = async (token) => {
      const res = await out.onRequestGet(ctx('GET', { token }));
      return { status: res.status, body: await res.json() };
    };

    // -- auth ---------------------------------------------------------------
    assert((await out.onRequestGet(ctx('GET'))).status === 401, 'signed out -> 401 on the read');
    assert((await out.onRequestPost(ctx('POST', { body: { action: 'draft', id: 'x' } }))).status === 401,
      'and on the draft, before any allowance is touched');
    assert((await out.onRequestPost(ctx('POST', { body: { action: 'add', archetype: 'alum' } }))).status === 401,
      'and on the add');

    // -- the empty read -----------------------------------------------------
    {
      const r = await get(tokenA);
      assert(r.status === 200 && r.body.ready === true && r.body.contacts.length === 0,
        'a signed-in account with no list reads 200 / ready / empty');
      assert(r.body.cap && r.body.cap.limit === 2 && r.body.cap.remaining === 2,
        'the cap state comes from plan-limits (§4: 2/month), not from the page');
      assert(Array.isArray(r.body.statuses) && r.body.statuses[0] === 'suggested',
        'the ladder is served so the client never hardcodes one');
      // No career on file, so the archetype generator has nothing to render a
      // sentence from — an empty list beats a card with a hole in it.
      assert(r.body.suggestions.length === 0,
        'and an account with no target career is offered no cards rather than filler');
    }

    // -- add: the manual path is the student's own text, sanitized -----------
    let rowA = null;
    {
      const bad = await post(tokenA, { action: 'add' });
      assert(bad.status === 400, 'an add with neither a name nor a label is a 400');

      const r = await post(tokenA, {
        action: 'add',
        name: '  Priya <script>alert(1)</script>  ',
        org: 'Borough Bank',
        label: 'A UChicago alum on the trading desk',
      });
      assert(r.status === 200 && r.body.ok === true, 'a manual add succeeds');
      rowA = r.body.contact;
      assert(rowA && rowA.id, 'and comes back with its row');
      assert(rowA.name.indexOf('<') === -1 && rowA.name.indexOf('>') === -1,
        'angle brackets never survive into a stored name');
      assert(rowA.status === 'suggested', 'a new row starts at the bottom of the ladder');
      assert(rowA.statusAt === null, 'and its status_at is NULL until a real status change');
      assert(rowA.archetype === '', 'a manual row carries no archetype, so it suppresses no card');
      assert(!JSON.stringify(rowA).includes(A), 'the payload never carries the account email');

      const stale = await post(tokenA, { action: 'add', archetype: 'ceo-of-goldman' });
      assert(stale.body.ok === false && stale.body.reason === 'stale-suggestion',
        'an archetype key that resolves to nothing is refused, never invented');
    }

    // -- the ladder: status_at moves only on a real change -------------------
    {
      const sent = await post(tokenA, { action: 'status', id: rowA.id, status: 'sent' });
      assert(sent.status === 200 && sent.body.ok === true, 'a status move succeeds');
      assert(sent.body.contact.status === 'sent' && sent.body.from === 'suggested',
        'and reports both ends, so the client can log the right event');
      const firstAt = sent.body.contact.statusAt;
      assert(!!firstAt, 'status_at is stamped on the first real change');

      const noop = await post(tokenA, { action: 'status', id: rowA.id, status: 'sent' });
      assert(noop.body.contact.statusAt === firstAt,
        're-selecting the same status is a no-op that does NOT reset the clock the nudge reads');

      const back = await post(tokenA, { action: 'status', id: rowA.id, status: 'suggested' });
      assert(back.body.ok === true && back.body.contact.status === 'suggested',
        'a backwards move is allowed — refusing one teaches students to lie to the tracker');

      const bogus = await post(tokenA, { action: 'status', id: rowA.id, status: 'hired' });
      assert(bogus.status === 400, 'a status off the ladder is a 400');

      // The S12 column semantics, end to end: a notes edit must not look like a move.
      const beforeEdit = (await post(tokenA, { action: 'status', id: rowA.id, status: 'sent' })).body.contact.statusAt;
      const edited = await post(tokenA, { action: 'update', id: rowA.id, notes: 'Left a voicemail.' });
      assert(edited.body.ok === true && edited.body.contact.notes === 'Left a voicemail.', 'a notes edit succeeds');
      assert(edited.body.contact.statusAt === beforeEdit,
        'and never touches status_at — a typo fix is not a re-draft');
      assert(edited.body.contact.status === 'sent', 'nor the status itself');
      assert((await post(tokenA, { action: 'update', id: rowA.id })).status === 400,
        'an update with no fields is a 400 rather than a silent no-op write');
    }

    // -- ownership: the whole point of this table --------------------------
    {
      const theirs = await get(tokenB);
      assert(theirs.body.contacts.length === 0, "B's list never contains A's rows");

      for (const body of [
        { action: 'status', id: rowA.id, status: 'met' },
        { action: 'update', id: rowA.id, name: 'Hijacked' },
        { action: 'delete', id: rowA.id },
        { action: 'draft', id: rowA.id },
      ]) {
        const r = await post(tokenB, body);
        assert(r.status === 404,
          `B naming A's row is a 404, not a 403 (${body.action}) — telling an attacker the row exists is itself a disclosure`);
      }

      // A's row must be byte-identical after all four denied writes.
      const after = (await get(tokenA)).body.contacts.find((c) => c.id === rowA.id);
      assert(after && after.name.startsWith('Priya') && after.status === 'sent',
        "and A's row is untouched by every one of them");

      const ghost = await post(tokenA, { action: 'status', id: 'ct-does-not-exist', status: 'sent' });
      assert(ghost.status === 404,
        'a row that does not exist is the same 404, so the two cases are indistinguishable');
    }

    // -- the draft meter: a refusal before the call costs nothing -----------
    {
      // No GEMINI_API_KEY and no career on file: the profile refusals fire before
      // the meter, which is the ordering the whole feature's fairness rests on.
      const r = await post(tokenA, { action: 'draft', id: rowA.id });
      assert(r.status === 200 && r.body.ok === false && r.body.reason === 'no-career',
        'a draft for an account with no target career is refused with a readable sentence');
      assert(typeof r.body.message === 'string' && r.body.message.length > 20,
        "and the sentence is the server's, ready to render");
      const spent = await kv.get(featureKvKey('outreach-draft', A, Date.now(), 'free'));
      assert(!spent || Number(spent) === 0,
        'a draft refused before it started never costs one of the two monthly allowances');
    }

    // -- delete, and the stale sweep --------------------------------------
    {
      const drafted = await post(tokenA, { action: 'add', name: 'Sam', label: 'A program lead' });
      const id = drafted.body.contact.id;
      const old = new Date(Date.now() - (STALE_DRAFT_DAYS + 3) * 86400000).toISOString();
      assert(await store.saveDraft(env, A, id, { subject: 's', body: 'b', now: Date.parse(old) }),
        'a draft stores against the owning account');
      const map = await store.staleDraftsByUser(env, new Date(Date.now() - STALE_DRAFT_DAYS * 86400000).toISOString());
      assert(map.get(A) === 1, 'the cron aggregate finds exactly the one stale draft');
      assert(!map.has(B), "and nobody else's");

      // Sending it takes it out of the sweep — the nudge must stop nudging.
      await post(tokenA, { action: 'status', id, status: 'sent' });
      const after = await store.staleDraftsByUser(env, new Date(Date.now() - STALE_DRAFT_DAYS * 86400000).toISOString());
      assert(!after.has(A), 'a draft the student marked sent is no longer stale');

      assert((await post(tokenA, { action: 'delete', id })).body.ok === true, 'the owner can remove a row');
      assert((await post(tokenA, { action: 'delete', id })).status === 404,
        'and removing it twice is a 404 rather than a silent success');
    }

    assert((await post(tokenA, { action: 'destroy' })).status === 400, 'an unknown action is a 400');

    // -- 0025 pending -------------------------------------------------------
    {
      const bare = new DatabaseSync(':memory:');
      for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql',
        '0017_analytics.sql', '0019_email_v2.sql']) bare.exec(readMig(m));
      const bareEnv = { ...env, DB: d1For(bare), COACH_KV: fakeKv() };
      await createUser(bareEnv, A, 'h');
      const { token } = await createSession(bareEnv, A);
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE, cookie: `fw_session=${token}` });
      const bareCtx = (method, body) => ({ env: bareEnv, request: { url: `${BASE}/outreach`, method, headers, json: async () => body } });
      const g = await out.onRequestGet(bareCtx('GET'));
      const gb = await g.json();
      assert(g.status === 200 && gb.ready === false && /not switched on/i.test(gb.message),
        'with 0025 pending the panel is told so in a sentence, not shown a failure');
      const p2 = await out.onRequestPost(bareCtx('POST', { action: 'add', name: 'x' }));
      const pb = await p2.json();
      assert(p2.status === 200 && pb.ok === false && pb.reason === 'not-ready',
        'and every write is refused the same readable way');
      const d = await out.onRequestPost(bareCtx('POST', { action: 'draft', id: 'ct1' }));
      const db = await d.json();
      assert(d.status === 200 && db.reason === 'not-ready',
        'including the draft, before the meter is touched');
      const spent = await bareEnv.COACH_KV.get(featureKvKey('outreach-draft', A, Date.now(), 'free'));
      assert(!spent || Number(spent) === 0, 'so a pending migration can never cost an allowance');
    }
  }
}

// ---------------------------------------------------------------------------
// S18 — Interview Season + the Semester Loop, against real SQLite.
//
// Three properties the regex D1 stub cannot answer, and each of them is the kind
// of defect that is invisible until it costs somebody something:
//
//   1. **The +1 roadmap regeneration is granted exactly once.** `claimTermRegen`
//      is a single conditional UPDATE (`... AND regen_granted_at IS NULL`) and
//      `meta.changes` is the claim. A stub that cannot count changed rows cannot
//      tell a grant from a no-op, which is the whole guard.
//   2. **One active season per account is an INDEX**, not a check in JS. The
//      constraint violation is the thing under test.
//   3. **Cross-account isolation on `terms`**, which holds free text a student
//      wrote about their own year.
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.log('\n  SKIP season/semester: node:sqlite unavailable (upgrade to Node 22.5+)');
  } else {
    console.log('\nseason + semester: auth, the one-active index and the once-only grant:');
    const { createUser, createSession } = await import('../functions/_lib/auth.js');
    const seasonFn = await import('../functions/interview-season.js');
    const semesterFn = await import('../functions/semester.js');
    const seasonStore = await import('../functions/_lib/season-store.js');
    const termStore = await import('../functions/_lib/term-store.js');
    const { buildProgram, SEASON_WEEKS } = await import('../functions/_lib/season-core.js');
    const { featureBonusKey } = await import('../functions/_lib/plan-limits.js');
    const { saveUserBlob } = await import('../functions/_lib/user.js');

    const readMig = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
    const d1For = (sqlite) => ({
      prepare(sql) {
        const runP = (a) => { const r = sqlite.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (a) => ({ results: sqlite.prepare(sql).all(...a) });
        const firstP = (a) => (sqlite.prepare(sql).get(...a) ?? null);
        return {
          bind(...a) { return { async run() { return runP(a); }, async all() { return allP(a); }, async first() { return firstP(a); } }; },
          async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
        };
      },
      async batch(list) { const o = []; for (const st of list) o.push(await st.run()); return o; },
    });

    const MIGS = ['0001_auth.sql', '0008_v2_entitlements.sql', '0009_v2_notifications.sql',
      '0012_interview_sessions.sql', '0013_user_profiles.sql', '0017_analytics.sql',
      '0019_email_v2.sql', '0026_season_term.sql'];
    const sqlite = new DatabaseSync(':memory:');
    for (const m of MIGS) sqlite.exec(readMig(m));
    const kv = fakeKv();
    const env = {
      SESSION_PEPPER: 'test-session-pepper',
      ALLOWED_ORIGIN: BASE,
      SITE_URL: BASE,
      DB: d1For(sqlite),
      COACH_KV: kv,
      PAYWALL_ENABLED: 'true',
    };

    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_seasons'").get() != null,
      'migration 0026 creates interview_seasons');
    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='terms'").get() != null,
      'and terms');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM pragma_table_info('interview_sessions') WHERE name IN ('season_id','season_week')").get().c === 2,
      'and adds the season link to the table that already holds the score — no second copy of a rubric');

    const A = 'sza@x.com';
    const B = 'szb@x.com';
    await createUser(env, A, 'h');
    await createUser(env, B, 'h');
    const { token: tokenA } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);

    const call = async (mod, route, method, token, body) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      const ctx = { env, request: { url: `${BASE}${route}`, method, headers, json: async () => body } };
      const res = method === 'GET' ? await mod.onRequestGet(ctx) : await mod.onRequestPost(ctx);
      return { status: res.status, body: await res.json() };
    };
    const seasonGet = (t) => call(seasonFn, '/interview-season', 'GET', t);
    const seasonPost = (t, b) => call(seasonFn, '/interview-season', 'POST', t, b);
    const semGet = (t) => call(semesterFn, '/semester', 'GET', t);
    const semPost = (t, b) => call(semesterFn, '/semester', 'POST', t, b);

    // -- auth ---------------------------------------------------------------
    assert((await seasonGet()).status === 401, 'signed out -> 401 on the season read');
    assert((await seasonPost(undefined, { action: 'start' })).status === 401, 'and on the start');
    assert((await semGet()).status === 401, 'signed out -> 401 on the term read');
    assert((await semPost(undefined, { action: 'setup' })).status === 401, 'and on the setup');

    // -- the season is premium, and free is locked-VISIBLE ------------------
    {
      // A target career, so the arc has something to be built around.
      await saveUserBlob(env, A, { careerFocus: { name: 'Quantitative Analyst', slug: 'quant', soc: '15-2051.00' } });
      const r = await seasonGet(tokenA);
      assert(r.status === 200 && r.body.ready === true, 'a signed-in read is 200 with 0026 applied');
      assert(r.body.locked === true, 'a free account is locked');
      assert(r.body.program && r.body.program.weeks.length === SEASON_WEEKS,
        'and still sees six weeks — locked-VISIBLE, built from its own career family');
      const detailed = r.body.program.weeks.filter((w) => !w.locked);
      assert(detailed.length === 1 && detailed[0].week === 1,
        'week 1 keeps its detail; the rest are marked locked');
      assert(r.body.program.weeks.slice(1).every((w) => !w.focus && !w.why),
        'and the truncation is SERVER-side — there is nothing in the payload to un-blur');
      assert(r.body.lockedWeeks === SEASON_WEEKS - 1,
        'lockedWeeks counts what is genuinely absent, which is what the lock tail renders');
      const blocked = await seasonPost(tokenA, { action: 'start' });
      assert(blocked.body.ok === false && blocked.body.reason === 'upgrade' && blocked.body.upgrade === true,
        'and starting one is refused with an upgrade, not a 500');
      assert(sqlite.prepare('SELECT COUNT(*) c FROM interview_seasons').get().c === 0,
        'with no row written by the refusal');
    }

    // -- premium: one season, and only one ----------------------------------
    {
      sqlite.prepare("UPDATE users SET plan='premium' WHERE email=?").run(A);
      const started = await seasonPost(tokenA, { action: 'start' });
      assert(started.status === 200 && started.body.ok === true, 'a premium account starts a season');
      assert(started.body.program.formatSource === 'playbook',
        'and with grounding off it says so — formatSource is the honesty metric here');
      assert(started.body.weekNow === 1, 'which begins today, at week 1');

      const again = await seasonPost(tokenA, { action: 'start' });
      assert(again.body.ok === false && again.body.reason === 'already-active',
        'a second start is refused rather than creating a second program');
      assert(sqlite.prepare("SELECT COUNT(*) c FROM interview_seasons WHERE status='active'").get().c === 1,
        'and exactly one active row survives — the partial UNIQUE index is what makes that true');

      // The index, directly: application code is not the guard.
      let violated = false;
      try {
        sqlite.prepare(`INSERT INTO interview_seasons (id,user_id,status,start_date,end_date,program_json,created_at,updated_at)
                        VALUES ('dup',?, 'active','2026-01-01','2026-02-11','{}','x','x')`).run(A);
      } catch (_) { violated = true; }
      assert(violated, 'a hand-written second active row is rejected by the database itself');

      const ended = await seasonPost(tokenA, { action: 'end' });
      assert(ended.body.ok === true && ended.body.status === 'abandoned',
        'ending in week 1 is "abandoned", decided from the clock rather than the button');
      assert((await seasonPost(tokenA, { action: 'end' })).status === 404,
        'and ending it twice is a 404 rather than a silent success');
      sqlite.prepare("UPDATE users SET plan='free' WHERE email=?").run(A);
    }

    // -- the season stamp comes from the server, never the body -------------
    {
      sqlite.prepare("UPDATE users SET plan='premium' WHERE email=?").run(A);
      await seasonPost(tokenA, { action: 'start' });
      const stamp = await seasonStore.seasonStampFor(env, A);
      assert(stamp && stamp.week === 1, 'seasonStampFor reports week 1 on the day a season starts');
      const outside = await seasonStore.seasonStampFor(env, A, Date.now() + 90 * 86400000);
      assert(outside === null,
        'a session run after the six weeks gets NO stamp — inventing "week 13" would put a point on the trend the program never scheduled');
      assert((await seasonStore.seasonStampFor(env, B)) === null, "and B's account has no season to stamp against");
      await seasonPost(tokenA, { action: 'end' });
      sqlite.prepare("UPDATE users SET plan='free' WHERE email=?").run(A);
    }

    // -- the term ritual ----------------------------------------------------
    const today = new Date();
    const iso = (d) => new Date(d).toISOString().slice(0, 10);
    const startDate = iso(today.getTime() - 60 * 86400000);
    // Three days out, so the term is real AND the review window is open (§5 S18:
    // the review opens a week before the end, because the last day of term is
    // the day a student is least likely to open anything).
    const endDate = iso(today.getTime() + 3 * 86400000);
    {
      const bad = await semPost(tokenA, { action: 'setup', system: 'fortnight', startDate, endDate, outcomes: ['a'] });
      assert(bad.body.ok === false && bad.body.reason === 'bad-system', 'an unknown term system is refused by name');
      const short = await semPost(tokenA, { action: 'setup', system: 'quarter', startDate, endDate: startDate, outcomes: ['a'] });
      assert(short.body.ok === false && short.body.reason === 'too-short', 'so is a zero-length term');
      const empty = await semPost(tokenA, { action: 'setup', system: 'quarter', startDate, endDate, outcomes: [] });
      assert(empty.body.ok === false && empty.body.reason === 'no-outcomes',
        'and a ritual with no outcomes, which is not a ritual');
      assert(sqlite.prepare('SELECT COUNT(*) c FROM terms').get().c === 0, 'none of which wrote a row');

      const ok = await semPost(tokenA, {
        action: 'setup', system: 'quarter', label: 'Fall <b>2026</b>', startDate, endDate,
        outcomes: ['Ship the backtest', '  ', 'Get the referral'],
        anchors: { courses: 'CS 154, Stats 244', clubs: ['Trading club'], deliverable: 'A public writeup' },
      });
      assert(ok.status === 200 && ok.body.ok === true, 'a well-formed ritual succeeds');
      assert(ok.body.term.outcomes.length === 2, 'blank outcomes are dropped rather than stored empty');
      assert(!/[<>]/.test(ok.body.term.label), 'and the label is sanitized as the untrusted text it is');
      assert(ok.body.term.week >= 1 && ok.body.term.week <= ok.body.term.total,
        'the week it reports back is inside the term');
      // No roadmap on this account, so the seeding refuses rather than inventing
      // a waypoint — and the term still exists, which is the ordering that
      // matters: a term with no seeded steps is a working feature.
      assert(ok.body.reason === 'no-roadmap' && ok.body.seeded.length === 0,
        'with no roadmap the seeding says so and seeds nothing');
      assert(sqlite.prepare('SELECT COUNT(*) c FROM terms WHERE user_id=?').get(A).c === 1, 'and the term row exists anyway');

      // The mirror: three identity fields, one user save.
      const { loadUserBlob } = await import('../functions/_lib/user.js');
      const blob = await loadUserBlob(env, A);
      assert(blob.termSystem === 'quarter' && blob.termStart === startDate && blob.termEnd === endDate,
        'the dates are mirrored onto the user object so Marco and the client can read them');

      const rerun = await semPost(tokenA, {
        action: 'setup', system: 'quarter', label: 'Fall 2026', startDate, endDate, outcomes: ['One outcome'],
      });
      assert(rerun.body.ok === true && sqlite.prepare('SELECT COUNT(*) c FROM terms WHERE user_id=?').get(A).c === 1,
        're-running the ritual for the SAME term rewrites it rather than stacking a second row');
    }

    // -- the review, and the once-only grant --------------------------------
    {
      const early = await semPost(tokenB, { action: 'review' });
      assert(early.body.ok === false && early.body.reason === 'no-term', 'an account with no term cannot review one');

      const bonusKey = featureBonusKey('roadmap-generate', A);
      assert((await kv.get(bonusKey)) == null, 'no bonus is held before the review');

      const first = await semPost(tokenA, { action: 'review' });
      assert(first.status === 200 && first.body.ok === true, 'the review runs in the last week of term');
      assert(first.body.granted === true, 'and grants the +1 roadmap regeneration');
      assert(typeof first.body.grantLine === 'string' && first.body.grantLine.length > 20,
        'with a sentence saying so, and no cap number written into it');
      assert(Number(await kv.get(bonusKey)) === 1, 'the bonus lands on the account');
      assert(first.body.review && first.body.review.term && first.body.review.term.id,
        'the stored review remembers which term it was for');

      const second = await semPost(tokenA, { action: 'review' });
      assert(second.body.ok === true, 're-opening the review works');
      assert(second.body.granted === false, 'but the grant does NOT fire twice');
      assert(Number(await kv.get(bonusKey)) === 1, 'and the bonus is still exactly one');
      assert(sqlite.prepare('SELECT regen_granted_at FROM terms WHERE user_id=?').get(A).regen_granted_at != null,
        'because the guard is a D1 column written in the same statement that checks it');
    }

    // -- ownership ----------------------------------------------------------
    {
      const theirs = await semGet(tokenB);
      assert(theirs.body.term === null, "B never sees A's term");
      assert((await termStore.getTerm(env, B, sqlite.prepare('SELECT id FROM terms WHERE user_id=?').get(A).id)) === null,
        "and cannot read it by id either — the query is scoped, not just the id unguessable");
      assert((await termStore.claimTermRegen(env, B, sqlite.prepare('SELECT id FROM terms WHERE user_id=?').get(A).id)) === false,
        "nor claim A's grant");
      assert((await seasonStore.activeSeason(env, B)) === null, "and B has no season of A's either");
    }

    assert((await semPost(tokenA, { action: 'destroy' })).status === 400, 'an unknown semester action is a 400');
    assert((await seasonPost(tokenA, { action: 'destroy' })).status === 400, 'and an unknown season action is too');

    // -- 0026 pending -------------------------------------------------------
    {
      const bare = new DatabaseSync(':memory:');
      for (const m of MIGS.filter((m2) => m2 !== '0026_season_term.sql')) bare.exec(readMig(m));
      const bareKv = fakeKv();
      const bareEnv = { ...env, DB: d1For(bare), COACH_KV: bareKv };
      await createUser(bareEnv, A, 'h');
      bare.prepare("UPDATE users SET plan='premium' WHERE email=?").run(A);
      const { token } = await createSession(bareEnv, A);
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE, cookie: `fw_session=${token}` });
      const bareCall = async (mod, route, method, body) => {
        const ctx = { env: bareEnv, request: { url: `${BASE}${route}`, method, headers, json: async () => body } };
        const res = method === 'GET' ? await mod.onRequestGet(ctx) : await mod.onRequestPost(ctx);
        return { status: res.status, body: await res.json() };
      };
      const sg = await bareCall(seasonFn, '/interview-season', 'GET');
      assert(sg.status === 200 && sg.body.ready === false && /not switched on/i.test(sg.body.message),
        'with 0026 pending the season panel is told so in a sentence, not shown a failure');
      const sp = await bareCall(seasonFn, '/interview-season', 'POST', { action: 'start' });
      assert(sp.status === 200 && sp.body.ok === false && sp.body.reason === 'not-ready',
        'and starting one is refused the same readable way');
      const tg = await bareCall(semesterFn, '/semester', 'GET');
      assert(tg.status === 200 && tg.body.ready === false && /not switched on/i.test(tg.body.message),
        'so is the term read');
      const tp = await bareCall(semesterFn, '/semester', 'POST', { action: 'setup', system: 'quarter', startDate, endDate, outcomes: ['a'] });
      assert(tp.status === 200 && tp.body.ok === false && tp.body.reason === 'not-ready', 'and every term write');
      assert((await bareKv.get(featureBonusKey('roadmap-generate', A))) == null,
        'a pending migration can never hand out a bonus');
      // The debrief INSERT has to keep working without the two ALTERed columns:
      // one probe covers the table and the columns, because they ship together.
      assert((await seasonStore.seasonStampFor(bareEnv, A)) === null,
        'and seasonStampFor answers null, which is what keeps the legacy INSERT correct');
    }
  }
}

// ---------------------------------------------------------------------------
// S19 — NPS + consented testimonials (0027) against REAL SQLite.
//
// The regex D1 stub cannot answer "what did that INSERT actually store", and
// that is the whole question here: consent redaction happens at write time, so
// the only assertion worth making is on the ROW. Three things this covers that
// nothing else can:
//
//   1. An unconsented name is absent from the row, not merely from the render.
//   2. The 30-day cap is re-checked on the WRITE path, so a client that skips
//      the GET (or two tabs that both passed it) still cannot write twice.
//   3. A pending quote is invisible to the public read until a human approves
//      it — and the queue-to-homepage path is exercised end to end.
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.log('\n  SKIP nps/testimonials: node:sqlite unavailable (upgrade to Node 22.5+)');
  } else {
    console.log('\nnps + testimonials: the cap, the consent redaction and the review wall:');
    const { createUser, createSession } = await import('../functions/_lib/auth.js');
    const npsFn = await import('../functions/nps.js');
    const quotesFn = await import('../functions/testimonials.js');
    const adminQuotesFn = await import('../functions/admin/testimonials.js');
    const store = await import('../functions/_lib/feedback-store.js');
    const { saveUserBlob } = await import('../functions/_lib/user.js');

    const readMig = (m) => fs.readFileSync(path.join(ROOT, 'migrations', m), 'utf8');
    const d1For = (sqlite) => ({
      prepare(sql) {
        const runP = (a) => { const r = sqlite.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (a) => ({ results: sqlite.prepare(sql).all(...a) });
        const firstP = (a) => (sqlite.prepare(sql).get(...a) ?? null);
        return {
          bind(...a) { return { async run() { return runP(a); }, async all() { return allP(a); }, async first() { return firstP(a); } }; },
          async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
        };
      },
      async batch(list) { const o = []; for (const st of list) o.push(await st.run()); return o; },
    });

    // 0006 for pricing_intents (the waitlist counter) and 0016 for admin_roles,
    // so the admin 404 below is a real "you are not an admin" and not a missing
    // table answering the same way by accident.
    const MIGS = ['0001_auth.sql', '0006_v2_pricing.sql', '0008_v2_entitlements.sql',
      '0009_v2_notifications.sql', '0013_user_profiles.sql', '0016_admin_console.sql',
      '0017_analytics.sql', '0019_email_v2.sql', '0027_feedback.sql'];
    const sqlite = new DatabaseSync(':memory:');
    for (const m of MIGS) sqlite.exec(readMig(m));
    const kv = fakeKv();
    const env = {
      SESSION_PEPPER: 'test-session-pepper',
      ALLOWED_ORIGIN: BASE,
      SITE_URL: BASE,
      DB: d1For(sqlite),
      COACH_KV: kv,
    };

    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nps_responses'").get() != null,
      'migration 0027 creates nps_responses');
    assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='testimonials'").get() != null,
      'and testimonials');

    const A = 'npsa@x.com';
    const B = 'npsb@x.com';
    await createUser(env, A, 'h');
    await createUser(env, B, 'h');
    const { token: tokenA } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);
    // Name and school on the profile, so the redaction has something real to
    // withhold. A test where both are empty proves nothing.
    await saveUserBlob(env, A, { name: 'Ada L', school: 'University of Chicago' });
    await saveUserBlob(env, B, { name: 'Bo N', school: 'CUNY Hunter' });

    const call = async (mod, route, method, token, body) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      const ctx = {
        env,
        request: { url: `${BASE}${route}`, method, headers, json: async () => body },
        waitUntil: () => {},
      };
      const res = method === 'GET' ? await mod.onRequestGet(ctx) : await mod.onRequestPost(ctx);
      return { status: res.status, body: await res.json() };
    };

    // -- auth ---------------------------------------------------------------
    assert((await call(npsFn, '/nps?moment=month_review', 'GET')).status === 401, 'signed out -> 401 on the NPS read');
    assert((await call(npsFn, '/nps', 'POST', undefined, { action: 'dismiss', moment: 'month_review' })).status === 401,
      'and on the write');
    assert((await call(quotesFn, '/testimonials', 'POST', undefined, { quote: 'x'.repeat(40) })).status === 401,
      'a quote cannot be submitted signed out');
    assert((await call(quotesFn, '/testimonials?limit=3', 'GET')).status === 200,
      'but the public READ needs no session — it is on the marketing pages');

    // -- eligibility, then the cap on the write path ------------------------
    {
      const g = await call(npsFn, '/nps?moment=month_review', 'GET', tokenA);
      assert(g.status === 200 && g.body.ready === true && g.body.eligible === true,
        'a fresh account is eligible with 0027 applied');
      assert((await call(npsFn, '/nps?moment=nonsense', 'GET', tokenA)).status === 400,
        'an unknown moment is refused before anything is read');

      const p = await call(npsFn, '/nps', 'POST', tokenA, { action: 'score', moment: 'month_review', score: 9, comment: 'useful' });
      assert(p.status === 200 && p.body.promoter === true, 'a 9 is a promoter and is offered the quote step');
      assert(p.body.attribution && p.body.attribution.name === 'Ada L' && /Chicago/.test(p.body.attribution.school),
        'and is shown the exact attribution we would print, BEFORE consenting to it');

      const again = await call(npsFn, '/nps', 'POST', tokenA, { action: 'score', moment: 'roadmap_commit', score: 2 });
      assert(again.status === 429 && again.body.cooldownUntil,
        'the 30-day cap is re-enforced on the WRITE path, not just advised by the GET');
      assert(sqlite.prepare('SELECT COUNT(*) c FROM nps_responses WHERE user_id = ?').get(A).c === 1,
        'so a client that skips the GET still writes exactly one row');
      const g2 = await call(npsFn, '/nps?moment=flightplan_done', 'GET', tokenA);
      assert(g2.body.eligible === false && g2.body.cooldownUntil, 'and the read agrees, with a date');

      // A DISMISSAL spends the cap too — otherwise two moments in one sitting ask twice.
      const d = await call(npsFn, '/nps', 'POST', tokenB, { action: 'dismiss', moment: 'flightplan_done' });
      assert(d.status === 200 && d.body.promoter === false, 'a dismissal is accepted and is not a promoter');
      const row = sqlite.prepare('SELECT status, score FROM nps_responses WHERE user_id = ?').get(B);
      assert(row.status === 'dismissed' && row.score === null, 'and is stored as a real row with a null score');
      assert((await call(npsFn, '/nps?moment=month_review', 'GET', tokenB)).body.eligible === false,
        'so the next moment in the same sitting is capped');
      assert((await call(npsFn, '/nps', 'POST', tokenA, { action: 'score', moment: 'month_review', score: '' })).status === 400,
        'a blank score is a 400, never a coerced zero');
    }

    // -- the consent invariant, asserted on the ROW -------------------------
    {
      const r = await call(quotesFn, '/testimonials', 'POST', tokenA, {
        quote: 'It told me the three things to do this week and then asked whether I did them.',
        consentName: true, consentSchool: false,
      });
      assert(r.status === 200 && r.body.status === 'pending', 'a quote lands PENDING, never approved');
      const q = sqlite.prepare('SELECT * FROM testimonials WHERE user_id = ?').get(A);
      assert(q.display_name === 'Ada L', 'the consented name is stored');
      assert(q.school === '', 'and the UNCONSENTED school is absent from the row, not merely hidden at render');
      assert(q.consent_name === 1 && q.consent_school === 0, 'both consent decisions are recorded');

      assert((await call(quotesFn, '/testimonials', 'POST', tokenA, { quote: 'nice' })).status === 400,
        'a one-word quote is refused');

      // Nothing a client sends can name somebody: the identity is read server-side.
      await call(quotesFn, '/testimonials', 'POST', tokenB, {
        quote: 'The weekly plan is the only part of this I actually open every Monday.',
        consentName: true, consentSchool: true, displayName: 'Somebody Else', school: 'Fake U',
      });
      const qb = sqlite.prepare('SELECT * FROM testimonials WHERE user_id = ?').get(B);
      assert(qb.display_name === 'Bo N' && /Hunter/.test(qb.school),
        'a client-supplied name is ignored — attribution comes from the session, never the body');
    }

    // -- the review wall ----------------------------------------------------
    {
      const pub = await call(quotesFn, '/testimonials?limit=6', 'GET');
      assert(Array.isArray(pub.body.quotes) && pub.body.quotes.length === 0,
        'two pending quotes are invisible to the public read');

      // The admin console is the only way through, and it is 404 to everyone else.
      const notAdmin = await call(adminQuotesFn, '/admin/testimonials', 'GET', tokenA);
      assert(notAdmin.status === 404, 'the queue 404s to a non-admin — it does not announce itself');
      const notAdminPost = await call(adminQuotesFn, '/admin/testimonials', 'POST', tokenA, { action: 'approve', id: 'x' });
      assert(notAdminPost.status === 404, 'and so does every mutation');

      const id = sqlite.prepare('SELECT id FROM testimonials WHERE user_id = ?').get(A).id;
      const changed = await store.reviewTestimonial(env, id, 'approved', 'root@x.com', new Date().toISOString());
      assert(changed === 1, 'approving reports the rows it actually changed');
      assert(await store.reviewTestimonial(env, 'no-such-id', 'approved', 'root@x.com', new Date().toISOString()) === 0,
        'and a missing id reports 0 rather than a false success');

      // The public GET is KV-cached; the console busts it on every status
      // change, which is the reason an approval is visible immediately.
      await kv.delete('quotes:public:v1');
      const pub2 = await call(quotesFn, '/testimonials?limit=6', 'GET');
      assert(pub2.body.quotes.length === 1, 'only the approved one is served');
      assert(pub2.body.quotes[0].name === 'Ada L' && pub2.body.quotes[0].school === undefined,
        'and it carries ONLY the field its author consented to');
      assert(pub2.body.quotes[0].user_id === undefined && pub2.body.quotes[0].status === undefined,
        'the public projection copies four named fields and nothing else');
    }

    // -- the waitlist counter ------------------------------------------------
    {
      const waitFn = await import('../functions/waitlist-intent.js');
      const wl = async (method, qs, body) => {
        const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
        const ctx = { env, request: { url: `${BASE}/waitlist-intent${qs || ''}`, method, headers, json: async () => body } };
        const res = method === 'GET' ? await waitFn.onRequestGet(ctx) : await waitFn.onRequestPost(ctx);
        return { status: res.status, body: await res.json() };
      };
      assert((await wl('POST', '', { tier: 'community', source: 'community', email: 'c@x.com' })).status === 200,
        'the community waitlist accepts a signup');
      await kv.delete('waitcount:community');
      const c = await wl('GET', '?tier=community');
      assert(c.status === 200 && c.body.count === 1, 'and its public count is a count');
      // A pricing tier's count is a business number and stays private.
      assert((await wl('GET', '?tier=lifetime')).status === 400, 'a pricing tier has NO public count');
      assert((await wl('GET', '?tier=')).status === 400, 'and neither does a missing one');
      assert((await wl('POST', '', { tier: 'semester', source: 'pricing_semester' })).status === 200,
        'the two Jacob-gated proposals are capturable as pricing intent');
    }

    // -- 0027 pending --------------------------------------------------------
    {
      const bare = new DatabaseSync(':memory:');
      for (const m of MIGS.filter((m2) => m2 !== '0027_feedback.sql')) bare.exec(readMig(m));
      const bareKv = fakeKv();
      const bareEnv = { ...env, DB: d1For(bare), COACH_KV: bareKv };
      await createUser(bareEnv, A, 'h');
      const { token } = await createSession(bareEnv, A);
      const bareCall = async (mod, route, method, body) => {
        const headers = new Headers({ 'content-type': 'application/json', origin: BASE, cookie: `fw_session=${token}` });
        const ctx = {
          env: bareEnv,
          request: { url: `${BASE}${route}`, method, headers, json: async () => body },
          waitUntil: () => {},
        };
        const res = method === 'GET' ? await mod.onRequestGet(ctx) : await mod.onRequestPost(ctx);
        return { status: res.status, body: await res.json() };
      };
      const g = await bareCall(npsFn, '/nps?moment=month_review', 'GET');
      assert(g.status === 200 && g.body.ready === false && g.body.eligible === false,
        'with 0027 pending the card is never raised — no student sees a survey whose submit would 500');
      const p = await bareCall(npsFn, '/nps', 'POST', { action: 'score', moment: 'month_review', score: 9 });
      assert(p.status === 503 && p.body.ready === false, 'and a write is refused readably');
      const q = await bareCall(quotesFn, '/testimonials', 'POST', { quote: 'x'.repeat(40) });
      assert(q.status === 503, 'so is a quote');
      const pub = await bareCall(quotesFn, '/testimonials?limit=3', 'GET');
      assert(pub.status === 200 && pub.body.quotes.length === 0,
        'and the marketing pages get an empty list, which is exactly what they render for zero quotes anyway');
    }
  }
}

console.log(`\n${fail ? `test:endpoints FAIL — ${fail} assertion(s)` : 'test:endpoints PASS'}`);
process.exit(fail ? 1 : 0);
