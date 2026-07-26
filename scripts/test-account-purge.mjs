// FlightWay — the account-deletion completeness gate.  run: npm run test:purge
//
// "Delete my account" is the one promise in the product that cannot be checked
// by looking at the screen. It returns `{ ok: true, purged: true }` and clears
// the cookie whether it deleted nine tables or fourteen, so the failure mode is
// silent by construction — and it had already happened: `USER_TABLES` had
// fallen five tables behind the schema (resumes, resume_versions,
// interview_sessions, comp_grants, admin_roles), and the KV lists were wrong in
// three separate ways nobody could see by reading them.
//
// Five things asserted here that nothing else can:
//   1. SCHEMA PARITY — every table in migrations/ that carries a user
//      identifier is classified (purge / anonymize / excluded-with-a-reason),
//      in BOTH directions. A new migration with an `email` column fails this
//      gate until someone decides what deletion should do with it. That is the
//      whole point: the decision becomes mandatory instead of forgotten.
//   2. THE HANDLER EXECUTES — a real onRequestDelete against fake D1/KV, so a
//      typo'd table name or a scope error cannot ship green.
//   3. THE KV SWEEP IS EXACT — seeded with the REAL key shapes from the
//      codebase (each cited below), plus another user's keys and the global
//      caches. Deleting a neighbour's data would be far worse than leaving
//      your own, so the decoys matter more than the targets.
//   4. THE HASHED NAMESPACE IS COVERED — career-rank hashes the email, so the
//      sweep is structurally blind to it and it must be deleted by name.
//   5. ORDER — `users` goes last, and anonymization happens before deletion so
//      an interrupted purge is interrupted in the safe state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  USER_TABLES, USER_ID_TABLES, ANONYMIZE_TABLES, EXCLUDED_TABLES, keyBelongsTo,
  onRequestDelete,
} from '../functions/account.js';
import { careerRankKeyPrefix } from '../functions/_lib/onet/career-rank.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = 'probe@flightway.ai';
const OTHER = 'someone-else@flightway.ai';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail += 1; console.error('  FAIL', m); } };

// ---------------------------------------------------------------------------
// 1. Schema parity.

/** Columns that mean "this row is about a person". */
// S15 added `referrals`, whose two identity columns are named for the ROLE each
// account plays rather than with the generic `user_id`. Without them here the
// table would have carried two real email addresses past a classification gate
// whose entire job is to notice exactly that.
const IDENTITY_COLUMNS = /^(email|user_id|actor_email|target_email|granted_by|referrer_id|referee_id)$/;

function parseMigrations() {
  const created = new Map(); // table -> Set(columns)
  const dropped = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, 'migrations')).sort()) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
    for (const m of sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      dropped.add(m[1]);
    }
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n\)/gi)) {
      const [, table, body] = m;
      const cols = created.get(table) || new Set();
      for (const line of body.split('\n')) {
        const clean = line.replace(/--.*$/, '').trim();
        const col = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/i);
        if (col) cols.add(col[1]);
      }
      created.set(table, cols);
      dropped.delete(table); // re-created later
    }
  }
  return { created, dropped };
}

console.log('schema parity (migrations/ vs the purge classification):');
const { created, dropped } = parseMigrations();
assert(created.size >= 20, `parsed the migration schema (${created.size} tables)`);

const purged = new Set(USER_TABLES);
// USER_ID_TABLES is a purge variant (DELETE ... WHERE user_id = ?). Until S4 every
// member was ALSO in USER_TABLES (contact_messages has both columns); email_log is
// the first user_id-ONLY purge table, so the classified set has to count this list
// too or a correctly-purged table reads as unclassified.
const purgedByUserId = new Set(USER_ID_TABLES);
const anonymized = new Set(ANONYMIZE_TABLES.map((a) => a.table));
const excluded = new Set(Object.keys(EXCLUDED_TABLES));
const classified = new Set([...purged, ...purgedByUserId, ...anonymized, ...excluded]);

const identityTables = [...created.entries()]
  .filter(([t, cols]) => !dropped.has(t) && [...cols].some((c) => IDENTITY_COLUMNS.test(c)))
  .map(([t]) => t)
  .sort();

assert(identityTables.length > 0, `found the identity-bearing tables (${identityTables.length})`);
for (const t of identityTables) {
  assert(classified.has(t),
    `${t} carries a user identifier and is classified (purge / anonymize / excluded-with-reason)`);
}

// Reverse direction: nothing is deleted from a table that no longer exists.
for (const t of purged) {
  assert(created.has(t) && !dropped.has(t), `USER_TABLES entry ${t} exists in the live schema`);
}
for (const { table, column } of ANONYMIZE_TABLES) {
  assert(created.has(table) && created.get(table).has(column),
    `ANONYMIZE_TABLES entry ${table}.${column} exists in the live schema`);
}
for (const [t, reason] of Object.entries(EXCLUDED_TABLES)) {
  assert(typeof reason === 'string' && reason.length >= 20,
    `EXCLUDED_TABLES.${t} states a real reason, not a shrug`);
}
// A table with NO identity column must not be in the purge list — deleting from
// it either errors or, worse, deletes someone else's rows.
for (const t of purged) {
  assert(created.get(t)?.has('email'), `${t} actually has an email column to delete on`);
}
for (const t of USER_ID_TABLES) {
  assert(created.get(t)?.has('user_id'), `${t} actually has a user_id column to delete on`);
}
assert(USER_TABLES[USER_TABLES.length - 1] === 'users',
  'users is deleted last, so the address is freed only after everything keyed to it is gone');

// The five that were silently surviving. Named explicitly so a future refactor
// that drops one fails loudly rather than quietly reopening the hole.
for (const t of ['resumes', 'resume_versions', 'interview_sessions', 'comp_grants', 'admin_roles']) {
  assert(purged.has(t), `${t} is purged (it was silently surviving deletion before this gate existed)`);
}

// ---------------------------------------------------------------------------
// Fakes.

// `bind()` must return a FRESH statement, exactly as D1 does — binding a shared
// one is how a fixture quietly stops testing what it claims to.
function fakeDb(recorder, { session = true } = {}) {
  const mk = (sql) => ({
    sql,
    args: [],
    bind(...args) { const s = mk(sql); s.args = args; return s; },
    async run() { recorder.push({ sql, args: this.args }); return { meta: { changes: 1 } }; },
    async first() {
      if (session && /FROM sessions/i.test(sql)) {
        return { email: EMAIL, expires_at: '2099-01-01T00:00:00.000Z' };
      }
      return null;
    },
    async all() { return { results: [] }; },
  });
  return { prepare: (sql) => mk(sql) };
}

function fakeKv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: cursor || null };
    },
  };
}

const ctxFor = (db, kv) => ({
  request: {
    method: 'DELETE',
    url: 'https://flightwayjacobprototype.pages.dev/account',
    headers: new Headers({ cookie: 'fw_session=probe-token' }),
  },
  env: { DB: db, COACH_KV: kv, SESSION_PEPPER: 'test-pepper' },
});

// ---------------------------------------------------------------------------
// 2 + 5. The handler executes, in the right order.

console.log('\nthe purge executes:');
{
  const sqls = [];
  const res = await onRequestDelete(ctxFor(fakeDb(sqls), fakeKv()));
  assert(res && res.status === 200, `a signed-in purge returns 200 (got ${res && res.status})`);

  const stmts = sqls.map((s) => s.sql);
  for (const t of USER_TABLES) {
    const hit = sqls.find((s) => s.sql === `DELETE FROM ${t} WHERE email = ?`);
    assert(!!hit && hit.args[0] === EMAIL, `DELETE FROM ${t} ran, bound to the session's email`);
  }
  for (const t of USER_ID_TABLES) {
    assert(sqls.some((s) => s.sql === `DELETE FROM ${t} WHERE user_id = ?` && s.args[0] === EMAIL),
      `${t} is also purged by user_id (a message sent from a different reply address)`);
  }
  for (const { table, column } of ANONYMIZE_TABLES) {
    const i = stmts.indexOf(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`);
    assert(i >= 0, `${table}.${column} is anonymized rather than deleted`);
    const firstDelete = stmts.findIndex((s) => s.startsWith('DELETE FROM'));
    assert(i >= 0 && i < firstDelete, 'anonymization runs before any delete (safe state if interrupted)');
  }
  // `users` last within the classified loop. destroyAllSessions deliberately
  // re-deletes sessions afterwards as belt-and-braces, so compare first
  // occurrences rather than asking which statement is last overall.
  const firstIdx = (t) => stmts.indexOf(`DELETE FROM ${t} WHERE email = ?`);
  const usersAt = firstIdx('users');
  assert(usersAt >= 0, 'the users row is deleted');
  for (const t of USER_TABLES) {
    if (t === 'users') continue;
    assert(firstIdx(t) < usersAt, `${t} is purged before the users row frees the address`);
  }

  // No table is deleted that nobody classified.
  const touched = stmts.filter((s) => s.startsWith('DELETE FROM ')).map((s) => s.split(' ')[2]);
  for (const t of touched) {
    assert(purged.has(t) || USER_ID_TABLES.includes(t) || t === 'sessions',
      `${t} is deleted only because it is classified for deletion`);
  }
}

// ---------------------------------------------------------------------------
// 3 + 4. KV. Every shape below is a real key built somewhere in functions/;
// the citation is the line that builds it. If one of these ever stops being
// deleted, this is the list that says so.

console.log('\nKV sweep (real key shapes, with decoys):');
{
  const mine = {
    [`chat:${EMAIL}`]: '1',                              // _lib/profile.js coachChat
    [`dossier:${EMAIL}`]: '1',                           // _lib/profile.js dossier
    [`fpprog:${EMAIL}`]: '1',                            // _lib/flightplan-progress.js:15
    [`roadmap-chat:${EMAIL}`]: '1',                      // career-roadmap.js:71
    [`alignment_proposal:${EMAIL}`]: '1',                // _lib/profile-alignment.js:22
    [`admin_elev:${EMAIL}`]: '1',                        // _lib/admin.js:113
    [`roadmapgen:${EMAIL}`]: '1',                        // _lib/plan-limits.js keyPrefix, lifetime
    [`marcochatday:${EMAIL}:2026-07-24`]: '1',           // _lib/plan-limits.js:20
    [`marcothreadday:${EMAIL}:2026-07-24`]: '1',         // _lib/plan-limits.js:29
    [`mockivday:${EMAIL}:2026-07-24`]: '1',              // _lib/plan-limits.js:42
    [`career-chat:${EMAIL}:nurse`]: '1',                 // career-analysis.js:71
    [`wkplan2:${EMAIL}:2026-W30`]: '1',                  // weekly-plan.js:31
    [`rbuildsaved:${EMAIL}:29-1141`]: '1',               // resume-builder.js:67
    [`rbuildday:${EMAIL}:2026-07-24`]: '1',              // resume-builder.js:218 default prefix
    [`rbuildqday:${EMAIL}:2026-07-24`]: '1',             // resume-builder.js:323
    [`rtailorday:${EMAIL}:2026-07-24`]: '1',             // resume-tailor.js:36
    [`rtailor:${EMAIL}:8f2a1c`]: '1',                    // resume-tailor.js:215
    [`elab:${EMAIL}:node-3:9ab1`]: '1',                  // career-roadmap.js:797
    [`wpplan:${EMAIL}:node-3:1fe0`]: '1',                // career-roadmap.js:1087
    [`iprepseen:${EMAIL}:soc-29`]: '1',                  // interview prep
    [`nudgefail:${EMAIL}:1753300000000`]: '1',           // workers/cron/index.js:110
    // The two whose version segment sits BEFORE the email — the exact shape the
    // old `<type>:<email>:` prefix list could never match.
    [`stretch:v4:${EMAIL}:rn:7c1`]: '1',                 // stretch-fits.js:170
    [`oppfind:v2:${EMAIL}:29-1141:3.7:uchicago`]: '1',   // _lib/opportunity-core.js:124
    // Rate-limit counters live under auth_rate:, which the old list also missed.
    [`auth_rate:login:${EMAIL}`]: '3',                   // _lib/auth.js:253 + auth/login.js:41
    [`auth_rate:chat:${EMAIL}`]: '2',                    // chat.js
    // Hashed email: structurally invisible to the sweep.
    [`${careerRankKeyPrefix(EMAIL)}fingerprint1`]: '1',  // _lib/onet/career-rank.js
  };
  const theirs = {
    [`chat:${OTHER}`]: '1',
    [`rtailor:${OTHER}:aaa`]: '1',
    [`stretch:v4:${OTHER}:rn:1`]: '1',
    [`${careerRankKeyPrefix(OTHER)}fp`]: '1',
    // A near-miss address that CONTAINS the target as a substring. Segment
    // equality is the only thing standing between a purge and a neighbour's data.
    [`chat:x${EMAIL}`]: '1',
    [`rtailor:${EMAIL}.attacker.example:z`]: '1',
  };
  const global = {
    'gw:ca:overview:registered-nurse': '1',              // career-analysis.js:301
    'gw:q2:abc123': '1',                                 // _lib/gemini-grounded.js:284
    'sim:index': '1',                                    // sim-generate.js
    'auth_rate:ev:anon-uuid:203.0.113.9': '1',           // events.js:90 — no email in it
  };

  const kv = fakeKv({ ...mine, ...theirs, ...global });
  await onRequestDelete(ctxFor(fakeDb([]), kv));

  const left = new Set(kv.map.keys());
  for (const k of Object.keys(mine)) assert(!left.has(k), `purged ${k.replace(EMAIL, '<me>')}`);
  for (const k of Object.keys(theirs)) assert(left.has(k), `LEFT ALONE ${k.replace(OTHER, '<other>').replace(EMAIL, '<me>')}`);
  for (const k of Object.keys(global)) assert(left.has(k), `LEFT ALONE global cache ${k}`);
  assert(left.size === Object.keys(theirs).length + Object.keys(global).length,
    `exactly the caller's keys were removed (${left.size} remain)`);
}

// ---------------------------------------------------------------------------
// The matcher itself, directly. The decoys above prove it in situ; these prove
// the property.

console.log('\nsegment matching:');
assert(keyBelongsTo(`rtailor:${EMAIL}:h`, EMAIL), 'matches the email as a middle segment');
assert(keyBelongsTo(`chat:${EMAIL}`, EMAIL), 'matches the email as the last segment');
assert(keyBelongsTo(`stretch:v4:${EMAIL}:a:b`, EMAIL), 'matches past a version segment');
assert(!keyBelongsTo(`chat:x${EMAIL}`, EMAIL), 'does NOT match an address that merely ends with it');
assert(!keyBelongsTo(`chat:${EMAIL}.evil.example`, EMAIL), 'does NOT match an address that merely starts with it');
assert(!keyBelongsTo('gw:ca:overview:nurse', EMAIL), 'does not match a global cache key');
assert(!keyBelongsTo('', EMAIL), 'an empty key matches nothing');

// ---------------------------------------------------------------------------
// Signed-out callers purge nothing.

console.log('\nauthorization:');
{
  const sqls = [];
  const db = fakeDb(sqls, { session: false });
  const kv = fakeKv({ [`chat:${EMAIL}`]: '1' });
  const res = await onRequestDelete(ctxFor(db, kv));
  assert(res && res.status === 401, `a signed-out DELETE /account is 401 (got ${res && res.status})`);
  assert(sqls.length === 0, 'and writes nothing');
  assert(kv.map.has(`chat:${EMAIL}`), 'and deletes no KV key');
}

console.log(`\n${fail ? `test:purge FAIL — ${fail} assertion(s)` : 'test:purge PASS'}`);
process.exit(fail ? 1 : 0);
