// FlightWay V2 S1 — the analytics gate.  run: npm run test:events
//
// Five things this asserts that nothing else can:
//   1. NAME PARITY — docs/EVENTS.md and REGISTERED_EVENTS say the same thing in
//      both directions, and every FWEvents.log('literal') in the client passes
//      the server's allowlist. Instrumentation that the beacon would silently
//      drop is the exact failure this whole session exists to prevent, and it
//      is invisible at runtime (the endpoint answers 204 either way).
//   2. THE PII LINT actually bites — banned keys, email-shaped values, prose,
//      nested objects, oversized props.
//   3. THE ENDPOINT EXECUTES — a real onRequestPost against fake D1/KV, so a
//      scope error can't ship green (the test:chat-turn lesson).
//   4. IDENTITY IS SERVER-DERIVED — a body claiming someone else's user_id
//      cannot write a row attributed to them.
//   5. ROLLUP MATH — counts, uniques, idempotency on re-run, prune cutoff.
//
// Plus the two silent-drop paths (DNT, bot UA) and the kill switch, each of
// which must write nothing and still answer 204.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REGISTERED_EVENTS, ALLOWED_PREFIXES, isAllowedName, classifyUa, scrubProps,
  sanitizeBatch, cleanPath, refHost, dayFromIso, previousDay, shiftDay,
  rollupDay, pruneEvents, writeEvents, analyticsEnabled, logServerEvent,
  MAX_BATCH, MAX_PROPS_BYTES, MAX_BODY_BYTES, EVENTS_RETENTION_DAYS,
} from '../functions/_lib/events.js';
import { onRequestPost as eventsPost } from '../functions/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = 'probe@flightway.ai';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };

// ---------------------------------------------------------------------------
// Fakes. The D1 stub records every bound row so a test can inspect what would
// actually have landed, including through batch().

function fakeKv() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => { map.set(k, String(v)); },
    delete: async (k) => { map.delete(k); },
  };
}

/**
 * `rows` is the live events table. `select` lets a test answer the rollup's
 * GROUP BY without implementing SQL: it is computed from `rows` directly.
 */
function fakeDb(opts = {}) {
  const db = {
    rows: opts.rows || [],
    daily: [],
    sessions: opts.session !== false,
    statements: [],
    prepare(sql) {
      const stmt = {
        sql,
        bound: [],
        bind(...args) { return { ...stmt, bound: args, bind: stmt.bind, first: stmt.first, run: stmt.run, all: stmt.all }; },
        async first() {
          if (/FROM sessions/i.test(sql)) {
            return db.sessions ? { email: EMAIL, expires_at: new Date(Date.now() + 864e5).toISOString() } : null;
          }
          return null;
        },
        async run() { return db.exec(sql, this.bound || []); },
        async all() { return db.query(sql, this.bound || []); },
      };
      return stmt;
    },
    async batch(list) {
      const out = [];
      for (const s of list) out.push(await db.exec(s.sql, s.bound || []));
      return out;
    },
    exec(sql, bound) {
      db.statements.push({ sql, bound });
      if (/^INSERT INTO events\b/i.test(sql)) {
        const [id, ts, day, anon_id, user_id, name, p, props, ref, us, um, uc, ua] = bound;
        db.rows.push({ id, ts, day, anon_id, user_id, name, path: p, props, ref, utm_source: us, utm_medium: um, utm_campaign: uc, ua_class: ua });
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM events_daily/i.test(sql)) {
        const before = db.daily.length;
        db.daily = db.daily.filter((r) => r.day !== bound[0]);
        return { meta: { changes: before - db.daily.length } };
      }
      if (/^INSERT INTO events_daily/i.test(sql)) {
        const [day, name, count, ua_, uu] = bound;
        db.daily.push({ day, name, count, uniques_anon: ua_, uniques_user: uu });
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM events\b/i.test(sql)) {
        const before = db.rows.length;
        db.rows = db.rows.filter((r) => !(r.day < bound[0]));
        return { meta: { changes: before - db.rows.length } };
      }
      return { meta: { changes: 0 } };
    },
    query(sql, bound) {
      if (/FROM events WHERE day = \?/i.test(sql)) {
        const day = bound[0];
        const byName = new Map();
        for (const r of db.rows.filter((x) => x.day === day)) {
          if (!byName.has(r.name)) byName.set(r.name, { name: r.name, count: 0, anons: new Set(), users: new Set() });
          const b = byName.get(r.name);
          b.count++;
          b.anons.add(r.anon_id);
          if (r.user_id) b.users.add(r.user_id);
        }
        return { results: [...byName.values()].map((b) => ({ name: b.name, count: b.count, uniques_anon: b.anons.size, uniques_user: b.users.size })) };
      }
      return { results: [] };
    },
  };
  return db;
}

function makeRequest(body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const h = new Map(Object.entries({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Content-Length': String(text.length),
    Cookie: 'fw_session=tok',
    ...headers,
  }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: 'POST',
    url: 'https://flightwayjacobprototype.pages.dev/events',
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

async function postEvents(body, { headers = {}, env: envOverride = {}, db = fakeDb() } = {}) {
  const pending = [];
  const env = { DB: db, COACH_KV: fakeKv(), SESSION_PEPPER: 'p', ...envOverride };
  const res = await eventsPost({
    request: makeRequest(body, headers),
    env,
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return { res, db, env };
}

// ---------------------------------------------------------------------------
console.log('name allowlist:');
assert(isAllowedName('page_view'), 'a registered name is allowed');
assert(isAllowedName('quiz_start'), 'a registered quiz event is allowed');
assert(isAllowedName('roadmap_something_new'), 'an unregistered name on a known prefix is allowed (never silently drop a real event)');
assert(!isAllowedName('totally_unknown_thing'), 'an unknown prefix is rejected');
assert(!isAllowedName('Quiz_Start'), 'uppercase is rejected (one canonical spelling per event)');
assert(!isAllowedName('quiz start'), 'whitespace is rejected');
assert(!isAllowedName('<script>alert(1)</script>'), 'markup is rejected');
assert(!isAllowedName(''), 'empty is rejected');
assert(!isAllowedName('x'.repeat(80)), 'an over-long name is rejected');
assert(!isAllowedName(null), 'null is rejected');
assert(ALLOWED_PREFIXES.every((p) => /^[a-z][a-z0-9]*_$/.test(p)), 'every prefix is a lowercase surface token');

// ---------------------------------------------------------------------------
console.log('docs/EVENTS.md parity:');
const eventsMd = fs.readFileSync(path.join(ROOT, 'docs/EVENTS.md'), 'utf8');
const documented = new Set([...eventsMd.matchAll(/^\|\s*`([a-z][a-z0-9_]*)`\s*\|/gm)].map((m) => m[1]));
const registered = [...REGISTERED_EVENTS];
const undocumented = registered.filter((n) => !documented.has(n));
const unregistered = [...documented].filter((n) => !REGISTERED_EVENTS.has(n));
assert(documented.size > 40, `EVENTS.md parses as a registry (${documented.size} rows)`);
assert(!undocumented.length, `every registered event is documented${undocumented.length ? ' — missing: ' + undocumented.join(', ') : ''}`);
assert(!unregistered.length, `every documented event is registered${unregistered.length ? ' — extra: ' + unregistered.join(', ') : ''}`);

// ---------------------------------------------------------------------------
console.log('client call sites:');
function* clientSources() {
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) yield path.join(ROOT, f);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.js$/.test(e.name) ? [p] : []);
  });
  yield* walk(path.join(ROOT, 'assets/js'));
}
// The trailing `(\s*\+)?` group catches string CONCATENATION — feature-intro.js
// builds `'feature_intro_' + outcome`, whose literal half is a fragment, not a
// name. Those are unresolvable statically, so they are skipped here; the
// runtime guarantee for them is the `feature_` surface prefix in
// ALLOWED_PREFIXES, and each expanded name is registered individually.
const CALL_RE = /FWEvents\.log\(\s*'([^']*)'(\s*\+)?/g;
// pricing.html and coach/interview-mode.js call a local `log(name, data)`
// wrapper that forwards to FWEvents. Without this second pass their names —
// the whole pricing funnel — would never be linted. Scoped to files that
// mention FWEvents at all, and the lookbehind keeps `console.log(` out.
const WRAPPED_RE = /(?<![.\w])log\(\s*'([a-z][a-z0-9_]{2,})'(\s*\+)?/g;
const badNames = [];
const undocumentedCalls = [];
let callSites = 0;
for (const file of clientSources()) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('FWEvents')) continue;
  const names = new Set();
  for (const m of text.matchAll(CALL_RE)) if (!m[2]) names.add(m[1]);
  for (const m of text.matchAll(WRAPPED_RE)) if (!m[2]) names.add(m[1]);
  for (const name of names) {
    callSites++;
    const rel = path.relative(ROOT, file);
    if (!isAllowedName(name)) badNames.push(`${name} (${rel})`);
    else if (!documented.has(name)) undocumentedCalls.push(`${name} (${rel})`);
  }
}
assert(callSites >= 20, `found the instrumentation call sites (${callSites} distinct name×file)`);
assert(!badNames.length, `every literal FWEvents.log name passes the server allowlist${badNames.length ? ' — ' + badNames.join(', ') : ''}`);
assert(!undocumentedCalls.length, `every literal FWEvents.log name is in EVENTS.md${undocumentedCalls.length ? ' — ' + undocumentedCalls.join(', ') : ''}`);

// ---------------------------------------------------------------------------
console.log('PII lint (props are shape, never identity):');
const scrubbed = scrubProps({
  idx: 3, done: true, slug: 'financial-analyst', ok: null,
  email: 'a@b.com', firstName: 'Jacob', school: 'UChicago', gpa: 3.9,
  userEmail: 'x@y.com', authToken: 'abc', note: 'anything at all',
});
assert(scrubbed.props.idx === 3 && scrubbed.props.done === true, 'numbers and booleans survive');
assert(scrubbed.props.slug === 'financial-analyst', 'a slug survives');
assert(scrubbed.props.ok === null, 'an explicit null survives');
assert(!('email' in scrubbed.props) && !('userEmail' in scrubbed.props), 'email keys are dropped, including compound ones');
assert(!('firstName' in scrubbed.props), 'firstName is dropped');
assert(!('school' in scrubbed.props) && !('gpa' in scrubbed.props), 'school and gpa are dropped');
assert(!('authToken' in scrubbed.props) && !('note' in scrubbed.props), 'credential and free-text keys are dropped');
assert(scrubProps({ who: 'someone@example.com' }).props === null, 'an email-shaped VALUE is dropped even under an innocent key');
assert(scrubProps({ blurb: 'x'.repeat(200) }).props === null, 'prose-length strings are dropped');
assert(scrubProps({ nested: { a: 1 } }).props === null, 'nested objects are dropped (free text hides there)');
assert(scrubProps({ list: [1, 2] }).props === null, 'arrays are dropped');
assert(scrubProps({ n: NaN }).props === null, 'non-finite numbers are dropped');
assert(scrubProps(null).props === null, 'null props stay null');
assert(scrubProps('nope').props === null, 'a non-object props payload is refused');
const bigProps = {};
for (let i = 0; i < 60; i++) bigProps['k' + i] = 'v'.repeat(40);
const capped = scrubProps(bigProps);
assert(JSON.stringify(capped.props || {}).length <= MAX_PROPS_BYTES, `props are capped at ${MAX_PROPS_BYTES} bytes`);
assert(JSON.parse(JSON.stringify(capped.props)), 'the capped props still parse as JSON (shed keys, never truncate the string)');

// ---------------------------------------------------------------------------
console.log('path + referrer hygiene:');
assert(cleanPath('/quiz.html?token=secret#x') === '/quiz.html', 'query strings and fragments are stripped from path');
assert(cleanPath('') === '/', 'an empty path becomes /');
assert(cleanPath('portal.html') === '/portal.html', 'a bare path is rooted');
assert(cleanPath('/' + 'a'.repeat(300)).length <= 120, 'path is length-capped');
assert(refHost('https://www.linkedin.com/feed/x?y=1') === 'www.linkedin.com', 'referrer is reduced to a host');
assert(refHost('') === null, 'no referrer → null');

// ---------------------------------------------------------------------------
console.log('user-agent classification:');
assert(classifyUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari') === 'mobile', 'iPhone → mobile');
assert(classifyUa('Mozilla/5.0 (Macintosh) Chrome/120') === 'desktop', 'desktop UA → desktop');
assert(classifyUa('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)') === 'bot', 'Googlebot → bot');
assert(classifyUa('curl/8.4.0') === 'bot', 'curl → bot');
assert(classifyUa('') === 'bot', 'no UA at all → bot');

// ---------------------------------------------------------------------------
console.log('batch sanitation:');
const many = { anon: 'anon-1', events: Array.from({ length: 40 }, () => ({ n: 'page_view' })) };
const sanitizedMany = sanitizeBatch(many, { uaClass: 'desktop' });
assert(sanitizedMany.rows.length === MAX_BATCH, `a batch is truncated to ${MAX_BATCH} events`);
assert(sanitizedMany.rejected === 20, 'the overflow is counted as rejected, not silently ignored');
const mixed = sanitizeBatch({
  anon: 'anon-2',
  attr: { ref: 'https://news.ycombinator.com/x', utm_source: 'linkedin', utm_medium: 'post', utm_campaign: 'launch' },
  events: [{ n: 'quiz_start' }, { n: 'not_a_real_surface' }, { n: 'quiz_q_view', p: { idx: 2 } }, null],
}, { uaClass: 'mobile', userId: EMAIL, nowIso: '2026-07-23T10:00:00.000Z' });
assert(mixed.rows.length === 2 && mixed.rejected === 2, 'unknown names and junk entries are dropped, valid ones kept');
assert(mixed.rows.every((r) => r.utm_source === 'linkedin' && r.ref === 'news.ycombinator.com'), 'first-touch attribution is stamped on every row');
assert(mixed.rows.every((r) => r.user_id === EMAIL && r.ua_class === 'mobile'), 'caller-supplied identity and ua class win');
assert(mixed.rows.every((r) => r.day === '2026-07-23'), 'day is derived from the server timestamp');
assert(new Set(mixed.rows.map((r) => r.id)).size === 2, 'every row gets a distinct id');
assert(sanitizeBatch({ events: [{ n: 'page_view' }] }, {}).rows.length === 0, 'a batch with no anon id writes nothing');

// ---------------------------------------------------------------------------
console.log('POST /events executes:');
{
  const { res, db } = await postEvents({
    anon: 'anon-live',
    path: '/quiz.html',
    events: [{ n: 'quiz_start' }, { n: 'quiz_q_view', p: { idx: 0 } }],
  });
  assert(res.status === 204, 'a good batch answers 204 (fire-and-forget contract)');
  assert(db.rows.length === 2, 'both events landed in D1');
  assert(db.rows.every((r) => r.user_id === EMAIL), 'user_id came from the session cookie');
  assert(db.rows[0].ua_class === 'desktop', 'ua_class is server-classified');
  const inserts = db.statements.filter((s) => /^INSERT INTO events\b/i.test(s.sql));
  assert(inserts.length === 2, 'rows were written through one batch(), not one request each');
}
{
  const { res, db } = await postEvents({ anon: 'anon-x', user_id: 'victim@flightway.ai', events: [{ n: 'page_view' }] }, { db: fakeDb({ session: false }) });
  assert(res.status === 204 && db.rows.length === 1, 'an anonymous visitor still writes');
  assert(db.rows[0].user_id === null, 'a body-supplied user_id is ignored — identity is never taken from the caller');
}
{
  const { res, db } = await postEvents({ anon: 'a', events: [{ n: 'page_view' }] }, { headers: { DNT: '1' } });
  assert(res.status === 204 && db.rows.length === 0, 'DNT:1 → 204 and nothing written');
}
{
  const { res, db } = await postEvents({ anon: 'a', events: [{ n: 'page_view' }] }, { headers: { 'User-Agent': 'Googlebot/2.1' } });
  assert(res.status === 204 && db.rows.length === 0, 'a bot → 204 and nothing written');
}
{
  const { res, db } = await postEvents({ anon: 'a', events: [{ n: 'page_view' }] }, { env: { ANALYTICS_ENABLED: 'false' } });
  assert(res.status === 204 && db.rows.length === 0, 'the kill switch → 204 and nothing written');
}
{
  const { res, db } = await postEvents('not json at all{');
  assert(res.status === 204 && db.rows.length === 0, 'malformed JSON → 204, never a 4xx the page would log');
}
{
  const huge = JSON.stringify({ anon: 'a', events: [{ n: 'page_view', p: { pad: 'x'.repeat(MAX_BODY_BYTES) } }] });
  const { res, db } = await postEvents(huge);
  assert(res.status === 204 && db.rows.length === 0, 'an over-size body is refused without a write');
}
{
  const db = fakeDb();
  const kv = fakeKv();
  let last = null;
  for (let i = 0; i < 125; i++) {
    last = await postEvents({ anon: 'flood', events: [{ n: 'page_view' }] }, { db, env: { COACH_KV: kv } });
  }
  assert(last.res.status === 204, 'a rate-limited caller still gets 204');
  assert(db.rows.length === 120, 'the beacon rate limit stops the flood at 120/hr per anon+ip');
}
{
  const { res, db } = await postEvents({
    anon: 'anon-pii',
    events: [{ n: 'signup_complete', p: { method: 'password', email: 'leak@flightway.ai' } }],
  });
  assert(res.status === 204 && db.rows.length === 1, 'the event is kept');
  assert(!/leak@flightway\.ai/.test(db.rows[0].props || ''), 'the PII prop never reaches the row');
  assert(/"method":"password"/.test(db.rows[0].props || ''), 'the safe prop survives');
}

// ---------------------------------------------------------------------------
console.log('server-side events (Stripe webhook path):');
{
  const db = fakeDb();
  const ok = await logServerEvent({ DB: db }, 'checkout_success', { userId: EMAIL, props: { mode: 'subscription', price: 'monthly' } });
  assert(ok && db.rows.length === 1, 'a server event writes without a browser');
  assert(db.rows[0].anon_id === 'server' && db.rows[0].ua_class === 'server', 'server rows are labelled as such');
  assert(await logServerEvent({ DB: db }, 'made_up_name', {}) === false, 'an unknown server event name is refused');
  const thrower = { DB: { prepare() { throw new Error('boom'); } } };
  assert(await logServerEvent(thrower, 'checkout_success', {}) === false, 'a failing insert returns false instead of throwing into the webhook');
  const killedDb = fakeDb();
  assert(await logServerEvent({ DB: killedDb, ANALYTICS_ENABLED: 'false' }, 'checkout_success', {}) === false, 'the kill switch stops the server writer too');
  assert(killedDb.rows.length === 0, 'and writes nothing when it does');
}

// ---------------------------------------------------------------------------
console.log('rollup + retention:');
{
  const db = fakeDb();
  const rows = [
    { name: 'page_view', anon_id: 'a1', user_id: EMAIL },
    { name: 'page_view', anon_id: 'a1', user_id: EMAIL },
    { name: 'page_view', anon_id: 'a2', user_id: null },
    { name: 'quiz_start', anon_id: 'a2', user_id: null },
  ].map((r, i) => ({ id: 'i' + i, ts: '2026-07-22T01:00:00.000Z', day: '2026-07-22', path: '/', props: null, ref: null, utm_source: null, utm_medium: null, utm_campaign: null, ua_class: 'desktop', ...r }));
  await writeEvents(db, rows);
  assert(db.rows.length === 4, 'writeEvents batches the fixture in');

  const n = await rollupDay(db, '2026-07-22');
  assert(n === 2, 'the rollup produced one row per event name');
  const pv = db.daily.find((r) => r.name === 'page_view');
  assert(pv.count === 3, 'count is every row');
  assert(pv.uniques_anon === 2, 'uniques_anon counts distinct browsers');
  assert(pv.uniques_user === 1, 'uniques_user counts distinct accounts, ignoring anonymous rows');

  await rollupDay(db, '2026-07-22');
  assert(db.daily.filter((r) => r.name === 'page_view').length === 1, 'a re-run replaces the day rather than double-counting');

  const old = { ...rows[0], id: 'old', day: shiftDay('2026-07-23', -(EVENTS_RETENTION_DAYS + 1)) };
  db.rows.push(old);
  const pruned = await pruneEvents(db, '2026-07-23');
  assert(pruned.cutoff === shiftDay('2026-07-23', -EVENTS_RETENTION_DAYS), `the prune cutoff is ${EVENTS_RETENTION_DAYS} days back`);
  assert(pruned.changes === 1 && !db.rows.some((r) => r.id === 'old'), 'raw events past the window are deleted');
  assert(db.rows.length === 4, 'events inside the window survive the prune');
  assert(db.daily.length === 2, 'the rollup outlives the raw rows it summarizes');
}
assert(previousDay('2026-01-01') === '2025-12-31', 'previousDay crosses a year boundary');
assert(dayFromIso('2026-07-23T23:59:59.999Z') === '2026-07-23', 'day is the UTC date slice');

// ---------------------------------------------------------------------------
// The stub above pattern-MATCHES sql; it never executes it. So a misspelled
// column, a 12-for-13 placeholder count or a GROUP BY that SQLite rejects would
// pass every assertion up to here and fail only in production, silently, inside
// a swallowed catch. This section runs the REAL statements against the REAL
// migration in an in-memory SQLite, which is the only thing that can catch that
// class. node:sqlite is built in from Node 22.5; if it is missing the section
// says so out loud rather than quietly passing.
console.log('SQL against the real schema (migrations/0017_analytics.sql):');
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.warn('  SKIP node:sqlite unavailable — the real-SQL section did not run');
  } else {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(fs.readFileSync(path.join(ROOT, 'migrations/0017_analytics.sql'), 'utf8'));

    // A D1-shaped adapter, so the production helpers run completely unmodified.
    const d1 = {
      prepare(sql) {
        const mk = (params) => ({
          bind: (...args) => mk(args),
          async run() { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) || 0 } }; },
          async all() { return { results: sqlite.prepare(sql).all(...params) }; },
          async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        });
        return mk([]);
      },
      async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
    };

    const { rows } = sanitizeBatch({
      anon: 'anon-sql',
      attr: { ref: 'https://linkedin.com/x', utm_source: 'linkedin' },
      events: [{ n: 'page_view' }, { n: 'quiz_start', p: { idx: 0 } }, { n: 'quiz_complete', p: { ms: 4200, n: 10 } }],
    }, { userId: EMAIL, uaClass: 'mobile', nowIso: '2026-07-22T12:00:00.000Z' });
    await writeEvents(d1, rows);
    const stored = sqlite.prepare('SELECT * FROM events ORDER BY name').all();
    assert(stored.length === 3, `INSERT_EVENT_SQL executes against the real table (${stored.length} rows)`);
    assert(stored.every((r) => r.user_id === EMAIL && r.day === '2026-07-22' && r.ua_class === 'mobile'), 'every column lands in the column it names');
    assert(stored.find((r) => r.name === 'quiz_complete').props === '{"ms":4200,"n":10}', 'props round-trip as JSON text');
    assert(stored.every((r) => r.utm_source === 'linkedin' && r.ref === 'linkedin.com'), 'attribution columns are populated');

    await logServerEvent({ DB: d1 }, 'checkout_success', { userId: EMAIL, props: { mode: 'subscription', price: 'monthly' } });
    assert(sqlite.prepare("SELECT COUNT(*) c FROM events WHERE anon_id = 'server'").get().c === 1, 'the server-side insert path executes too');

    const names = await rollupDay(d1, '2026-07-22');
    assert(names === 3, `ROLLUP_SELECT_SQL executes and groups (${names} names)`);
    const daily = sqlite.prepare('SELECT * FROM events_daily WHERE day = ? ORDER BY name').all('2026-07-22');
    assert(daily.length === 3 && daily.every((r) => r.count === 1 && r.uniques_anon === 1 && r.uniques_user === 1), 'real COUNT(DISTINCT ...) matches the stubbed math');
    await rollupDay(d1, '2026-07-22');
    assert(sqlite.prepare('SELECT COUNT(*) c FROM events_daily').get().c === 3, 'the real re-run is idempotent (PRIMARY KEY (day,name) is never violated)');

    const pruned = await pruneEvents(d1, shiftDay('2026-07-22', EVENTS_RETENTION_DAYS + 1));
    assert(pruned.changes === 3, `the prune DELETE executes and removes aged rows (${pruned.changes})`);
    assert(sqlite.prepare('SELECT COUNT(*) c FROM events_daily').get().c === 3, 'and leaves events_daily untouched');
    sqlite.close();
  }
}

// ---------------------------------------------------------------------------
console.log('kill switch:');
assert(analyticsEnabled({}) === true, 'unset → analytics on (a deployment must be able to see itself)');
assert(analyticsEnabled({ ANALYTICS_ENABLED: 'false' }) === false, '"false" → off');
assert(analyticsEnabled({ ANALYTICS_ENABLED: '0' }) === false, '"0" → off');
assert(analyticsEnabled({ ANALYTICS_ENABLED: 'true' }) === true, '"true" → on');

// ---------------------------------------------------------------------------
console.log('client engine (assets/js/shared/events.js):');
{
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/shared/events.js'), 'utf8');
  assert(/doNotTrack/.test(src), 'the client honors Do Not Track');
  assert(/sendBeacon/.test(src), 'the client flushes with sendBeacon');
  assert(/pagehide/.test(src) && /visibilitychange/.test(src), 'the client flushes on both page-exit signals');
  assert(/fw_anon_v1/.test(src) && !/document\.cookie/.test(src), 'identity is a localStorage anon id, never a cookie');
  assert(/analyticsEnabled/.test(src), 'the client honors the /config kill switch');
  assert(/global\.FWEvents = \{[\s\S]*log: log/.test(src), 'FWEvents.log stays the public API (22 pre-S1 call sites depend on it)');
  assert(/location\.pathname/.test(src) && !/location\.search[^)]*\bbody\b/.test(src), 'only the path is sent, never the query string');
  const cfgFetches = [...src.matchAll(/fetch\('\/config'/g)].length;
  assert(cfgFetches <= 1, 'at most one /config fetch in the client engine');

  // The client duplicates three server constants (it has to — it is vanilla JS
  // on a page, it cannot import from functions/). Duplicated constants drift,
  // and the drift here is silent AND total: the server rejects a batch
  // all-or-nothing, so a client that batches past the body cap loses every
  // event in it and still sees 204. Same class as the KEY_MAP duplication that
  // verify:user exists to police.
  const clientConst = (name) => Number((src.match(new RegExp(`var ${name} = (\\d+)`)) || [])[1]);
  assert(clientConst('MAX_BATCH') === MAX_BATCH, `client MAX_BATCH matches the server (${clientConst('MAX_BATCH')} vs ${MAX_BATCH})`);
  assert(clientConst('MAX_PROPS_BYTES') === MAX_PROPS_BYTES, `client MAX_PROPS_BYTES matches the server (${clientConst('MAX_PROPS_BYTES')} vs ${MAX_PROPS_BYTES})`);
  assert(clientConst('MAX_SEND_BYTES') < MAX_BODY_BYTES, `the client batches below the server body cap (${clientConst('MAX_SEND_BYTES')} < ${MAX_BODY_BYTES})`);
  assert(/function takeBatch/.test(src), 'the client batches by SIZE, not just by count');
}

process.exit(fail ? 1 : 0);
