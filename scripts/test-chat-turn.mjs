// Marco's REQUEST PATH — the gap that let two outages through.
//
// Every other Marco suite tests a piece: prompt builders (test:marco-voice),
// the reply contract (test:marco-ui), the SSE framing (test:marco-stream).
// None of them ever CALLED the endpoint. So when `runChatTurn` referenced
// `payload.starterContext` — where the parsed body is `reqBody` — every turn
// threw `ReferenceError: payload is not defined` before any Gemini call, the
// outer handler turned it into a bare 500, and Marco was dead on every surface
// for two weeks with every gate green. `node --check` only parses; a scope
// error is a runtime error and needs the code to actually run.
//
// This drives the real `runChatTurn` against stubbed storage and a stubbed
// upstream. It asserts nothing about Marco's voice — that is E4's job. It
// asserts the turn EXECUTES: no ReferenceError, no TypeError from our own
// code, a real reply on the happy path, and that a failed turn refunds what it
// charged.
//
// Run: npm run test:chat-turn

import { runChatTurn } from '../functions/chat.js';
import { checkFeatureLimit } from '../functions/_lib/plan-limits.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };

const EMAIL = 'probe@flightway.ai';

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

// Every D1 read the turn makes resolves to "nothing stored yet", except the
// session lookup, which must return a live row or requireSession 401s.
function fakeDb() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (/FROM sessions/i.test(sql)) {
            return { email: EMAIL, expires_at: new Date(Date.now() + 864e5).toISOString() };
          }
          return null;
        },
        async run() { return { success: true }; },
        async all() { return { results: [] }; },
      };
    },
  };
}

function makeContext({ body = { message: 'hello' }, env: envOverrides = {} } = {}) {
  const env = {
    GEMINI_API_KEY: 'test-key',
    SESSION_SECRET: 'test-secret',
    DB: fakeDb(),
    COACH_KV: fakeKv(),
    ...envOverrides,
  };
  const request = {
    method: 'POST',
    url: 'https://flightwayjacobprototype.pages.dev/chat',
    headers: new Headers({ cookie: 'fw_session=probe-token', 'content-type': 'application/json' }),
    json: async () => body,
  };
  return { request, env, waitUntil: () => {} };
}

/** Swap global fetch for the duration of one turn. */
async function withUpstream(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const geminiOk = (text) => async () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

const geminiDown = () => async () => new Response(
  JSON.stringify({ error: { message: 'model overloaded' } }),
  { status: 503, headers: { 'content-type': 'application/json' } },
);

console.log('the turn executes at all:');
{
  const ctx = makeContext();
  let result = null;
  let thrown = null;
  await withUpstream(geminiOk('Here is a real answer about your plan.'), async () => {
    try { result = await runChatTurn(ctx); } catch (err) { thrown = err; }
  });

  // THE assertion this file exists for. A ReferenceError or TypeError here is
  // our own code failing to run, not an environment problem.
  const ourFault = thrown && /ReferenceError|is not defined|is not a function|Cannot read (properties|property)/.test(
    `${thrown.name}: ${thrown.message}`,
  );
  assert(!ourFault, `the turn runs without a scope/type error from our own code${ourFault ? ` — ${thrown.message}` : ''}`);
  assert(result && result.status === 200, `a stubbed-upstream turn answers 200 (got ${result ? result.status : `throw: ${thrown && thrown.message}`})`);
  assert(!!(result && result.payload && result.payload.reply), 'the payload carries a reply');
}

console.log('the starter-context path (where the ReferenceError lived):');
{
  // `starterContext` is only read when the conversation is empty — the exact
  // branch that made the typo reachable on literally every first message.
  const ctx = makeContext({ body: { message: 'hello', starterContext: "Let's talk about quant trading." } });
  let result = null;
  let thrown = null;
  await withUpstream(geminiOk('Sure — quant trading.'), async () => {
    try { result = await runChatTurn(ctx); } catch (err) { thrown = err; }
  });
  assert(!thrown, `a turn carrying starterContext does not throw${thrown ? ` — ${thrown.message}` : ''}`);
  assert(result && result.status === 200, 'a turn carrying starterContext answers 200');
}

console.log('a failed turn refunds what it charged:');
{
  const kv = fakeKv();
  const ctx = makeContext({ env: { COACH_KV: kv, PAYWALL_ENABLED: 'true' } });
  let thrown = null;
  await withUpstream(geminiDown(), async () => {
    try { await runChatTurn(ctx); } catch (err) { thrown = err; }
  });
  assert(!!thrown, 'an upstream that never recovers still fails the turn');

  // The user asked and got nothing, so neither budget should have moved.
  const after = await checkFeatureLimit(
    { PAYWALL_ENABLED: 'true', COACH_KV: kv }, EMAIL, 'marco-chat', { spend: false, plan: 'free' },
  );
  assert(after.used === 0,
    `a failed turn leaves the daily Marco counter untouched (got used=${after.used})`);
  const rate = await kv.get(`auth_rate:chat:${EMAIL}`);
  assert(Number(rate || 0) === 0,
    `a failed turn leaves the hourly attempt counter untouched (got ${rate})`);
}

console.log('a bad request still costs the user nothing:');
{
  const kv = fakeKv();
  const ctx = makeContext({ body: { message: '' }, env: { COACH_KV: kv } });
  const result = await runChatTurn(ctx);
  assert(result.status === 400, 'an empty message is rejected before any spend');
  assert(kv.map.size === 0, 'a rejected message writes no counter at all');
}

console.log(`\n${fail ? `test:chat-turn FAIL — ${fail} assertion(s)` : 'test:chat-turn PASS'}`);
process.exit(fail ? 1 : 0);
