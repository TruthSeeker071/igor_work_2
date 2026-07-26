// FlightWay — admin console + comp-grant invariants (migration 0016).
//   run: npm run test:admin
//
// Runs the real endpoint modules against a fake D1/KV, because most of what
// matters here is authorization, not arithmetic: who gets a 404, what a
// mutation refuses, and which SQL guard stops a downgrade.
//
// The load-bearing claims under test:
//   · a comp writes the SAME plan columns a purchase does, so getPlan() sees it
//     with no new reads and the three entitlement chokepoints stay untouched;
//   · revoke resets ONLY plan_source='comp' rows;
//   · a Stripe cancellation never strips a comp;
//   · root is env-var-only and can never be demoted or comped;
//   · sub-admins cannot see or touch /admin/admins;
//   · gates still hold for ordinary accounts (neither dev-listed nor comped).

import { hashPassword, hashSessionToken } from '../functions/_lib/auth.js';
import {
  isRootAdmin, requireAdmin, isProtectedTarget, elevationKey, ELEVATION_TTL_SEC,
  grantElevation, requireElevation, normalizeGrantInput, createGrant, revokeGrant,
  consumePendingGrant, stripePlanWrite,
} from '../functions/_lib/admin.js';
import { getPlan, resolveEntitlement, isDevTester } from '../functions/_lib/entitlements.js';
import { checkFeatureLimit } from '../functions/_lib/plan-limits.js';
import { onRequestGet as whoamiGet } from '../functions/admin/whoami.js';
import { onRequestPost as elevatePost } from '../functions/admin/elevate.js';
import { onRequestPost as grantsPost, onRequestGet as grantsGet } from '../functions/admin/grants.js';
import { onRequestPost as revokePost } from '../functions/admin/grants/revoke.js';
import {
  onRequestGet as adminsGet, onRequestPost as adminsPost, onRequestDelete as adminsDelete,
} from '../functions/admin/admins.js';
import { onRequestGet as auditGet } from '../functions/admin/audit.js';
import { onRequestGet as analyticsGet } from '../functions/admin/analytics.js';
import { onRequestPost as webhookPost } from '../functions/stripe/webhook.js';
import { signWebhookPayload } from '../functions/_lib/stripe.js';
import { logServerError, shiftDay } from '../functions/_lib/events.js';
import {
  overviewMetrics, funnelMetrics, retentionMetrics, featureUsage,
  sourceAttribution, liveTail, recentServerErrors,
  clampRange, weekStart, classifyChannel,
} from '../functions/_lib/analytics.js';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };

const ROOT = 'root@flightway.ai';
const SUB = 'sub@flightway.ai';
const DAY = 86400000;

// ------------------------------------------------------------- fake bindings

function fakeKv() {
  const map = new Map();
  const ttls = new Map();
  return {
    map, ttls,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v, opts) { map.set(k, v); if (opts && opts.expirationTtl) ttls.set(k, opts.expirationTtl); },
    async delete(k) { map.delete(k); },
  };
}

/**
 * Fake D1. Dispatches on the literal SQL each module issues — so a rewritten
 * query that drops a guard clause shows up here as a failing assertion rather
 * than as a silently different code path.
 */
function fakeDb(seed = {}) {
  const users = new Map((seed.users || []).map((u) => [u.email, {
    plan: 'free', plan_expires_at: null, plan_source: null, stripe_customer_id: null, password_hash: null, ...u,
  }]));
  const sessions = new Map(Object.entries(seed.sessions || {}));
  const compGrants = new Map();
  const adminRoles = new Map((seed.admins || []).map((e) => [e, { email: e, granted_by: ROOT, created_at: new Date().toISOString() }]));
  const auditRows = [];
  const events = new Map();

  const db = {
    users, sessions, compGrants, adminRoles, auditRows, events,
    prepare(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const stmt = {
        // D1 statements are runnable with or without .bind() — listAdmins()
        // takes no parameters, so both shapes have to work here.
        bind(...a) {
          return {
            async first() {
              if (/FROM sessions WHERE token_hash/.test(q)) return sessions.get(a[0]) || null;
              if (/FROM admin_roles WHERE email/.test(q)) return adminRoles.get(a[0]) || null;
              if (/FROM comp_grants WHERE email .* applied_at IS NULL AND revoked_at IS NULL/.test(q)) {
                const g = compGrants.get(a[0]);
                return g && !g.applied_at && !g.revoked_at ? { plan: g.plan, expires_at: g.expires_at } : null;
              }
              if (/FROM users WHERE stripe_customer_id/.test(q)) {
                for (const u of users.values()) if (u.stripe_customer_id === a[0]) return u;
                return null;
              }
              if (/FROM users WHERE email/.test(q)) return users.get(a[0]) || null;
              return null;
            },
            async all() {
              if (/FROM admin_audit_log/.test(q)) {
                const [limit, offset] = [a[0], a[1]];
                const sorted = auditRows.slice().sort((x, y) => (y.created_at < x.created_at ? -1 : y.created_at > x.created_at ? 1 : 0));
                return { results: sorted.slice(offset, offset + limit) };
              }
              if (/FROM comp_grants g/.test(q)) {
                return {
                  results: [...compGrants.values()].map((g) => {
                    const u = users.get(g.email);
                    return { ...g, user_plan: u ? u.plan : null, user_plan_expires_at: u ? u.plan_expires_at : null, user_plan_source: u ? u.plan_source : null };
                  }),
                };
              }
              if (/FROM admin_roles/.test(q)) return { results: [...adminRoles.values()] };
              return { results: [] };
            },
            async run() {
              if (/INSERT INTO admin_audit_log/.test(q)) {
                auditRows.push({ id: a[0], actor_email: a[1], action: a[2], target_email: a[3], detail: a[4], created_at: a[5] });
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO comp_grants/.test(q)) {
                compGrants.set(a[0], {
                  email: a[0], plan: a[1], expires_at: a[2], granted_by: a[3],
                  created_at: a[4], applied_at: null, revoked_at: null, note: a[5],
                });
                return { meta: { changes: 1 } };
              }
              if (/UPDATE comp_grants SET applied_at/.test(q)) {
                const g = compGrants.get(a[1]); if (g) g.applied_at = a[0];
                return { meta: { changes: g ? 1 : 0 } };
              }
              if (/UPDATE comp_grants SET revoked_at/.test(q)) {
                const g = compGrants.get(a[1]);
                if (!g || g.revoked_at) return { meta: { changes: 0 } };
                g.revoked_at = a[0];
                return { meta: { changes: 1 } };
              }
              // Revoke: guarded by plan_source = ? ('comp').
              if (/UPDATE users SET plan = \?, plan_expires_at = NULL, plan_source = NULL WHERE email = \? AND plan_source = \?/.test(q)) {
                const u = users.get(a[1]);
                if (!u || u.plan_source !== a[2]) return { meta: { changes: 0 } };
                u.plan = a[0]; u.plan_expires_at = null; u.plan_source = null;
                return { meta: { changes: 1 } };
              }
              // Comp apply + both Stripe variants: (plan, expiry, source, email).
              if (/UPDATE users SET plan = \?, plan_expires_at = \?, plan_source = \?/.test(q)) {
                const u = users.get(a[3]);
                if (u && /!= 'comp'/.test(q) && u.plan_source === 'comp') return { meta: { changes: 0 } };
                if (u) { u.plan = a[0]; u.plan_expires_at = a[1]; u.plan_source = a[2]; }
                return { meta: { changes: u ? 1 : 0 } };
              }
              if (/UPDATE users SET stripe_customer_id/.test(q)) {
                const u = users.get(a[1]); if (u) u.stripe_customer_id = a[0];
                return { meta: { changes: u ? 1 : 0 } };
              }
              if (/INSERT INTO admin_roles/.test(q)) {
                if (!adminRoles.has(a[0])) adminRoles.set(a[0], { email: a[0], granted_by: a[1], created_at: a[2] });
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM admin_roles/.test(q)) {
                const had = adminRoles.delete(a[0]);
                return { meta: { changes: had ? 1 : 0 } };
              }
              if (/INSERT OR IGNORE INTO stripe_events/.test(q)) {
                if (events.has(a[0])) return { meta: { changes: 0 } };
                events.set(a[0], a[1]);
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM stripe_events/.test(q)) { events.delete(a[0]); return { meta: { changes: 1 } }; }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
      const unbound = stmt.bind();
      stmt.first = unbound.first;
      stmt.all = unbound.all;
      stmt.run = unbound.run;
      return stmt;
    },
  };
  return db;
}

const PEPPER = 'test-pepper';
const PASSWORD = 'correct-horse-battery';
let PASSWORD_HASH = null;

/** Build an env whose sessions table already knows about the given emails. */
async function makeEnv(opts = {}) {
  const env = {
    ROOT_ADMIN_EMAIL: opts.rootEmail === undefined ? ROOT : opts.rootEmail,
    SESSION_PEPPER: PEPPER,
    PAYWALL_ENABLED: 'true',
    COACH_KV: fakeKv(),
  };
  const sessions = {};
  const tokens = {};
  for (const email of opts.signedIn || []) {
    const token = `tok-${email}`;
    tokens[email] = token;
    sessions[await hashSessionToken(token, env)] = { email, expires_at: new Date(Date.now() + DAY).toISOString() };
  }
  env.DB = fakeDb({ users: opts.users || [], sessions, admins: opts.admins || [] });
  env.__tokens = tokens;
  return env;
}

function req(env, path, { as, method = 'GET', body, contentType = 'application/json' } = {}) {
  const headers = {};
  if (as && env.__tokens[as]) headers.Cookie = `fw_session=${env.__tokens[as]}`;
  if (body !== undefined && contentType) headers['Content-Type'] = contentType;
  return new Request('https://flightwayjacobprototype.pages.dev' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(handler, env, path, opts) {
  const res = await handler({ request: req(env, path, opts), env });
  let json = {};
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

// ------------------------------------------------------------------- tests

PASSWORD_HASH = await hashPassword(PASSWORD);

console.log('root identity (env var only):');
{
  const env = { ROOT_ADMIN_EMAIL: '  Root@FlightWay.AI  ' };
  assert(isRootAdmin(env, 'root@flightway.ai'), 'root matches case- and whitespace-insensitively');
  assert(!isRootAdmin(env, 'someone@else.com'), 'a non-root email is not root');
  assert(!isRootAdmin({}, 'root@flightway.ai'), 'unset ROOT_ADMIN_EMAIL → nobody is root');
  assert(!isRootAdmin({ ROOT_ADMIN_EMAIL: '' }, ''), 'empty var + empty email never matches');
  assert(isProtectedTarget(env, 'root@flightway.ai'), 'root is a protected mutation target');

  // requireAdmin must not need D1 for root — the whole point of the env var.
  const noDb = await requireAdmin({ ROOT_ADMIN_EMAIL: ROOT }, ROOT);
  assert(noDb.ok && noDb.root, 'requireAdmin resolves root with zero D1 reads');
  const stranger = await requireAdmin({ ROOT_ADMIN_EMAIL: ROOT }, 'nobody@x.com');
  assert(!stranger.ok, 'a non-admin with no DB binding is refused, not defaulted in');
}

console.log('elevation lease:');
{
  const env = { COACH_KV: fakeKv() };
  assert(elevationKey(' A@B.com ') === 'admin_elev:a@b.com', 'elevation key is normalized');
  assert(!(await requireElevation(env, 'a@b.com')), 'no lease → not elevated');
  await grantElevation(env, 'a@b.com');
  assert(await requireElevation(env, 'a@b.com'), 'lease grants elevation');
  assert(env.COACH_KV.ttls.get(elevationKey('a@b.com')) === ELEVATION_TTL_SEC, 'lease carries the 15-minute TTL');
  assert(!(await requireElevation({}, 'a@b.com')), 'missing KV binding fails CLOSED (no elevation without a store)');
}

console.log('grant input validation:');
{
  const env = { ROOT_ADMIN_EMAIL: ROOT };
  assert(!normalizeGrantInput(env, { email: 'nope', plan: 'premium' }).ok, 'a malformed email is rejected');
  assert(!normalizeGrantInput(env, { email: ROOT, plan: 'lifetime' }).ok, 'root can never be a grant target');
  assert(!normalizeGrantInput(env, { email: 'a@b.com', plan: 'free' }).ok, 'free is not a comp-able plan');
  assert(!normalizeGrantInput(env, { email: 'a@b.com', plan: 'bogus' }).ok, 'an unknown plan is rejected outright');
  const lt = normalizeGrantInput(env, { email: 'A@B.com', plan: 'lifetime', days: 30 });
  assert(lt.ok && lt.email === 'a@b.com' && lt.expiresAt === null, 'lifetime ignores an expiry and normalizes the email');
  const days = normalizeGrantInput(env, { email: 'a@b.com', plan: 'premium', days: 30 });
  assert(days.ok && Math.round((Date.parse(days.expiresAt) - Date.now()) / DAY) === 30, 'days → an ISO expiry 30 days out');
  assert(!normalizeGrantInput(env, { email: 'a@b.com', plan: 'premium', expiresAt: 'not-a-date' }).ok, 'an unparseable expiry is rejected');
}

console.log('grant → getPlan, with the paywall ON:');
{
  const env = await makeEnv({ users: [{ email: 'user@x.com' }] });
  assert(await getPlan(env, 'user@x.com') === 'free', 'baseline: an ordinary account is free');

  const input = normalizeGrantInput(env, { email: 'user@x.com', plan: 'lifetime', note: 'beta partner' });
  const created = await createGrant(env, ROOT, input);
  assert(created.applied && !created.pending, 'a grant for an existing account applies immediately');

  const row = env.DB.users.get('user@x.com');
  assert(row.plan === 'lifetime' && row.plan_source === 'comp', 'the users row carries plan=lifetime, plan_source=comp');
  assert(await getPlan(env, 'user@x.com') === 'lifetime', 'getPlan picks the comp up with no new reads');

  const ent = await resolveEntitlement(env, 'user@x.com');
  assert(ent.effective === 'lifetime' && ent.dev !== true,
    'a comped user is a REAL user: full entitlement, and never marked dev:true');
  assert(!isDevTester(env, 'user@x.com'), 'comping does not add anyone to DEV_TEST_EMAILS');

  const marco = await checkFeatureLimit(env, 'user@x.com', 'marco-chat');
  assert(marco.ok && marco.unlimited && marco.dev !== true, 'the comp lifts the Marco cap without a dev marker');

  assert(env.DB.auditRows.some((r) => r.action === 'grant.create_apply' && r.target_email === 'user@x.com'),
    'the grant is audited');
}

console.log('expiry degradation:');
{
  const env = await makeEnv({ users: [{ email: 'temp@x.com' }] });
  await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'temp@x.com', plan: 'premium', days: 30 }));
  assert(await getPlan(env, 'temp@x.com') === 'premium', 'a 30-day comp reads as premium today');

  // Same row, expiry moved into the past — effectivePlan() is the one place
  // that decides what an expiry means, so no comp-specific logic is needed.
  env.DB.users.get('temp@x.com').plan_expires_at = new Date(Date.now() - DAY).toISOString();
  assert(await getPlan(env, 'temp@x.com') === 'free', 'an expired comp degrades to free on read');
  const capped = await checkFeatureLimit(env, 'temp@x.com', 'marco-chat');
  assert(capped.ok && capped.plan === 'free' && capped.remaining === 9, 'and the free caps come back with it');
}

console.log('revoke guard:');
{
  const env = await makeEnv({ users: [{ email: 'comped@x.com' }, { email: 'payer@x.com' }] });
  await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'comped@x.com', plan: 'lifetime' }));
  const r1 = await revokeGrant(env, ROOT, 'comped@x.com');
  assert(r1.ok && r1.hadGrant && r1.resetPlan, 'revoking a live comp resets the plan');
  assert(env.DB.users.get('comped@x.com').plan === 'free' && env.DB.users.get('comped@x.com').plan_source === null,
    'the users row is back to free with no plan_source');

  // Comped, then bought: plan_source is 'stripe', so revoke must not touch it.
  await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'payer@x.com', plan: 'premium', days: 30 }));
  const payer = env.DB.users.get('payer@x.com');
  payer.plan = 'lifetime'; payer.plan_expires_at = null; payer.plan_source = 'stripe';
  const r2 = await revokeGrant(env, ROOT, 'payer@x.com');
  assert(r2.ok && r2.hadGrant && !r2.resetPlan, 'revoke reports that it did not reset a non-comp plan');
  assert(payer.plan === 'lifetime' && payer.plan_source === 'stripe', 'a plan they PAID for survives the revoke');

  const r3 = await revokeGrant(env, ROOT, ROOT);
  assert(!r3.ok, 'root can never be a revoke target');
}

console.log('pending grant consumed at register:');
{
  const env = await makeEnv({ users: [] });
  const created = await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'newbie@x.com', plan: 'premium', days: 14 }));
  assert(created.pending && !created.applied, 'an email with no account leaves a PENDING row');
  assert(env.DB.compGrants.get('newbie@x.com').applied_at === null, 'applied_at stays null while pending');

  const early = await consumePendingGrant(env, 'newbie@x.com');
  assert(!early.applied, 'nothing to consume before the users row exists');

  env.DB.users.set('newbie@x.com', { email: 'newbie@x.com', plan: 'free', plan_expires_at: null, plan_source: null });
  const consumed = await consumePendingGrant(env, 'newbie@x.com');
  assert(consumed.applied && consumed.plan === 'premium', 'signup consumes the pending comp');
  assert(env.DB.users.get('newbie@x.com').plan_source === 'comp', 'and stamps plan_source=comp on the fresh account');
  assert(env.DB.compGrants.get('newbie@x.com').applied_at, 'applied_at is stamped so it is consumed exactly once');
  assert(env.DB.auditRows.some((r) => r.action === 'grant.apply_at_signup'), 'the signup application is audited');

  const again = await consumePendingGrant(env, 'newbie@x.com');
  assert(!again.applied, 'a consumed grant is never applied twice');

  // A revoked pending grant must not spring back to life at signup.
  const env2 = await makeEnv({ users: [] });
  await createGrant(env2, ROOT, normalizeGrantInput(env2, { email: 'ghost@x.com', plan: 'lifetime' }));
  await revokeGrant(env2, ROOT, 'ghost@x.com');
  env2.DB.users.set('ghost@x.com', { email: 'ghost@x.com', plan: 'free', plan_expires_at: null, plan_source: null });
  assert(!(await consumePendingGrant(env2, 'ghost@x.com')).applied, 'a revoked pending grant is not applied at signup');

  // register.js must actually call it, right after the users row is created.
  const registerSrc = await readFile(new URL('../functions/auth/register.js', import.meta.url), 'utf8');
  assert(/await createUser\(env, email, passwordHash\);[\s\S]{0,600}?await consumePendingGrant\(env, email\);/.test(registerSrc),
    'functions/auth/register.js consumes the pending comp right after createUser');
}

console.log('endpoints — 404 to everyone who is not an admin:');
{
  const env = await makeEnv({ signedIn: [ROOT, SUB, 'plain@x.com'], users: [{ email: ROOT }, { email: SUB }, { email: 'plain@x.com' }], admins: [SUB] });

  assert((await call(whoamiGet, env, '/admin/whoami')).status === 404, 'unauthenticated GET /admin/whoami → 404');
  assert((await call(whoamiGet, env, '/admin/whoami', { as: 'plain@x.com' })).status === 404, 'a signed-in non-admin → 404');

  const rootWho = await call(whoamiGet, env, '/admin/whoami', { as: ROOT });
  assert(rootWho.status === 200 && rootWho.body.root === true, 'root sees whoami with root:true');
  const subWho = await call(whoamiGet, env, '/admin/whoami', { as: SUB });
  assert(subWho.status === 200 && subWho.body.root === false, 'a sub-admin sees whoami with root:false');
  assert(subWho.body.elevated === false, 'a fresh session is not elevated');
}

// The 404-not-403 property is the console's whole cover story: a 403 tells a
// stranger the route exists and that admins exist. It was asserted for whoami
// and admins only; these are the other four routes, from real requests.
console.log('endpoints — every admin route 404s a stranger, signed out or in:');
{
  const env = await makeEnv({
    signedIn: [ROOT, 'plain@x.com'],
    users: [{ email: ROOT, password_hash: PASSWORD_HASH }, { email: 'plain@x.com' }, { email: 'target@x.com' }],
  });
  await grantElevation(env, 'plain@x.com'); // a lease is worthless without the role

  const routes = [
    ['GET  /admin/audit', auditGet, '/admin/audit', { method: 'GET' }],
    ['GET  /admin/grants', grantsGet, '/admin/grants', { method: 'GET' }],
    ['POST /admin/grants', grantsPost, '/admin/grants', { method: 'POST', body: { email: 'target@x.com', plan: 'lifetime' } }],
    ['POST /admin/grants/revoke', revokePost, '/admin/grants/revoke', { method: 'POST', body: { email: 'target@x.com' } }],
    ['POST /admin/elevate', elevatePost, '/admin/elevate', { method: 'POST', body: { password: PASSWORD } }],
    // S3: the analytics dashboards are behind the same 404-to-strangers gate.
    ['GET  /admin/analytics', analyticsGet, '/admin/analytics?panel=overview', { method: 'GET' }],
  ];

  for (const [label, handler, path, opts] of routes) {
    const anon = await call(handler, env, path, opts);
    assert(anon.status === 404, `${label} → 404 signed out (got ${anon.status})`);
    const stranger = await call(handler, env, path, { ...opts, as: 'plain@x.com' });
    assert(stranger.status === 404, `${label} → 404 for a signed-in non-admin (got ${stranger.status})`);
    assert(!/admin|elevat|grant/i.test(JSON.stringify(stranger.body)),
      `${label} leaks nothing about the console in its 404 body`);
  }

  // Reads render for an admin with no elevation — analytics is a read.
  const rootAnalytics = await call(analyticsGet, env, '/admin/analytics?panel=overview', { as: ROOT });
  assert(rootAnalytics.status === 200 && rootAnalytics.body.panel === 'overview' && rootAnalytics.body.data
    && typeof rootAnalytics.body.data.active === 'object',
    'an admin GETs /admin/analytics 200 with an overview payload (no elevation needed)');
  const badPanel = await call(analyticsGet, env, '/admin/analytics?panel=nonsense', { as: ROOT });
  assert(badPanel.status === 400, 'an unknown panel is a 400, not a 500');

  assert(env.DB.users.get('target@x.com').plan === 'free', 'and no stranger mutation reached the users table');
  assert(!env.DB.auditRows.some((r) => r.actor_email === 'plain@x.com'),
    'a refused stranger writes no audit row — the log stays a record of admins');
}

console.log('endpoints — /admin/admins is ROOT-ONLY:');
{
  const env = await makeEnv({ signedIn: [ROOT, SUB], users: [{ email: ROOT, password_hash: PASSWORD_HASH }, { email: SUB, password_hash: PASSWORD_HASH }], admins: [SUB] });
  await grantElevation(env, ROOT);
  await grantElevation(env, SUB);

  assert((await call(adminsGet, env, '/admin/admins', { as: SUB })).status === 404, 'a sub-admin GETs 404 from /admin/admins');
  assert((await call(adminsPost, env, '/admin/admins', { as: SUB, method: 'POST', body: { email: 'friend@x.com' } })).status === 404,
    'a sub-admin cannot mint another admin (404, not 403)');
  assert((await call(adminsDelete, env, '/admin/admins?email=' + SUB, { as: SUB, method: 'DELETE' })).status === 404,
    'a sub-admin cannot remove admins either');
  assert(env.DB.adminRoles.has(SUB), 'the roster is unchanged by the sub-admin attempts');

  const rootList = await call(adminsGet, env, '/admin/admins', { as: ROOT });
  assert(rootList.status === 200 && rootList.body.admins.length === 1, 'root can list admins');

  // Root demotion: refused whether it is aimed at the roster or at the env var.
  const demote = await call(adminsDelete, env, '/admin/admins?email=' + encodeURIComponent(ROOT), { as: ROOT, method: 'DELETE' });
  assert(demote.status === 400 && /cannot be demoted/i.test(demote.body.error), 'root cannot be demoted');
  const addRoot = await call(adminsPost, env, '/admin/admins', { as: ROOT, method: 'POST', body: { email: ROOT } });
  assert(addRoot.status === 400, 'root cannot be inserted into admin_roles either');
  assert((await requireAdmin(env, ROOT)).root, 'root is still root after both attempts');

  const removed = await call(adminsDelete, env, '/admin/admins?email=' + encodeURIComponent(SUB), { as: ROOT, method: 'DELETE' });
  assert(removed.status === 200 && !env.DB.adminRoles.has(SUB), 'root can remove a sub-admin');
  assert(!(await requireElevation(env, SUB)), 'a demoted admin loses their elevation lease');
  assert(env.DB.auditRows.some((r) => r.action === 'admin.remove' && r.target_email === SUB), 'the demotion is audited');
}

console.log('endpoints — mutations require elevation:');
{
  const env = await makeEnv({ signedIn: [ROOT], users: [{ email: ROOT, password_hash: PASSWORD_HASH }, { email: 'target@x.com' }] });

  const unelevated = await call(grantsPost, env, '/admin/grants', { as: ROOT, method: 'POST', body: { email: 'target@x.com', plan: 'lifetime' } });
  assert(unelevated.status === 403 && unelevated.body.elevate === true, 'granting without elevation → 403 + elevate:true');
  assert(env.DB.users.get('target@x.com').plan === 'free', 'and nothing was written');

  const unelevatedRevoke = await call(revokePost, env, '/admin/grants/revoke', { as: ROOT, method: 'POST', body: { email: 'target@x.com' } });
  assert(unelevatedRevoke.status === 403, 'revoking without elevation → 403');

  // Reads stay open — the console needs to render before you unlock it.
  assert((await call(grantsGet, env, '/admin/grants', { as: ROOT })).status === 200, 'listing grants does not require elevation');
  assert((await call(auditGet, env, '/admin/audit', { as: ROOT })).status === 200, 'reading the audit log does not require elevation');

  const wrongPw = await call(elevatePost, env, '/admin/elevate', { as: ROOT, method: 'POST', body: { password: 'wrong' } });
  assert(wrongPw.status === 401, 'a wrong password does not elevate');
  assert(env.DB.auditRows.some((r) => r.action === 'admin.elevate_fail'), 'the failed attempt is audited');

  const ok = await call(elevatePost, env, '/admin/elevate', { as: ROOT, method: 'POST', body: { password: PASSWORD } });
  assert(ok.status === 200 && ok.body.elevated === true, 'the correct password buys a lease');
  assert(env.DB.auditRows.some((r) => r.action === 'admin.elevate'), 'the successful elevation is audited');

  const granted = await call(grantsPost, env, '/admin/grants', { as: ROOT, method: 'POST', body: { email: 'target@x.com', plan: 'lifetime' } });
  assert(granted.status === 200 && env.DB.users.get('target@x.com').plan === 'lifetime', 'the same mutation now succeeds');

  const rootTarget = await call(grantsPost, env, '/admin/grants', { as: ROOT, method: 'POST', body: { email: ROOT, plan: 'lifetime' } });
  assert(rootTarget.status === 400, 'root is refused as a grant target at the endpoint too');

  const formPost = await call(grantsPost, env, '/admin/grants', {
    as: ROOT, method: 'POST', body: { email: 'target@x.com', plan: 'lifetime' }, contentType: 'application/x-www-form-urlencoded',
  });
  assert(formPost.status === 415, 'a non-JSON Content-Type is refused (cross-site form posts cannot reach a mutation)');
}

console.log('webhook: a cancellation never strips a comp:');
{
  const SECRET = 'whsec_test_admin';
  const env = await makeEnv({ users: [{ email: 'comped@x.com', stripe_customer_id: 'cus_9' }] });
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  env.STRIPE_SECRET_KEY = 'sk_test_x';

  await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'comped@x.com', plan: 'lifetime' }));
  assert(env.DB.users.get('comped@x.com').plan_source === 'comp', 'setup: the user holds a comp');

  const deliver = async (event) => {
    const raw = JSON.stringify(event);
    const request = new Request('https://flightwayjacobprototype.pages.dev/stripe/webhook', {
      method: 'POST', body: raw,
      headers: { 'Stripe-Signature': await signWebhookPayload(raw, SECRET), 'Content-Type': 'application/json' },
    });
    const res = await webhookPost({ request, env });
    return { status: res.status, body: await res.json() };
  };

  const cancel = await deliver({
    id: 'evt_cancel_comp', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_9', status: 'canceled', customer: 'cus_9', metadata: {} } },
  });
  assert(cancel.status === 200, 'the cancellation is acknowledged');
  assert(env.DB.users.get('comped@x.com').plan === 'lifetime' && env.DB.users.get('comped@x.com').plan_source === 'comp',
    'the comp survives a subscription cancellation');

  // A purchase, though, may overwrite a comp — money wins.
  const write = stripePlanWrite({ plan: 'premium', expiresAt: '2027-01-01T00:00:00Z' });
  assert(write.source === 'stripe' && write.skipComp === false, 'a purchase stamps plan_source=stripe and may overwrite a comp');
  const down = stripePlanWrite({ plan: 'free', expiresAt: null });
  assert(down.skipComp === true, 'a downgrade to free must carry the comp guard');
  assert(stripePlanWrite({ skip: true }) === null && stripePlanWrite(null) === null, 'a skipped grant writes nothing');
}

console.log('gate integrity — ordinary accounts (not dev-listed, not comped):');
{
  // The whole point of §3.5's honesty rule: prove the gates with an account
  // that has no override of any kind. Both escape hatches are live here.
  const env = await makeEnv({ users: [{ email: 'honest@x.com' }] });
  env.DEV_TEST_EMAILS = 'dev@flightway.ai';
  await createGrant(env, ROOT, normalizeGrantInput(env, { email: 'comped@x.com', plan: 'lifetime' }));

  assert(!isDevTester(env, 'honest@x.com'), 'the test account is NOT in DEV_TEST_EMAILS');
  assert(!env.DB.compGrants.has('honest@x.com'), 'the test account has NO comp grant');
  assert(await getPlan(env, 'honest@x.com') === 'free', 'it really is a free account with the paywall on');

  let marco;
  for (let i = 0; i < 10; i++) marco = await checkFeatureLimit(env, 'honest@x.com', 'marco-chat');
  assert(marco.ok && marco.remaining === 0, 'it spends exactly 10 Marco messages (V2 §4)');
  const eleventh = await checkFeatureLimit(env, 'honest@x.com', 'marco-chat');
  assert(!eleventh.ok && eleventh.upgrade, 'the 11th Marco message is blocked');

  const gen1 = await checkFeatureLimit(env, 'honest@x.com', 'roadmap-generate');
  const gen2 = await checkFeatureLimit(env, 'honest@x.com', 'roadmap-generate');
  assert(gen1.ok && !gen2.ok, 'one free roadmap generation a month, then blocked');

  // V2 §4 replaced the free:0 hard gate with a single lifetime taste, so the
  // honest free account now gets one session and is refused the second.
  const iv = await checkFeatureLimit(env, 'honest@x.com', 'mock-interview');
  const iv2 = await checkFeatureLimit(env, 'honest@x.com', 'mock-interview');
  assert(iv.ok && !iv2.ok && iv2.upgrade, 'the free plan gets exactly one mock-interview taste');
}

// The gates above run the analytics ENDPOINT against the SQL-pattern-matching
// fakeDb, which proves authorization but returns empty aggregates. The numbers
// themselves are proven here against a REAL SQLite loaded from migration 0017 —
// the only thing that can catch a wrong GROUP BY, a broken julianday window, or
// a DISTINCT that double-counts. (node:sqlite is built in from Node 22.5.)
console.log('analytics aggregates (real SQL against migrations/0017_analytics.sql):');
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
  if (!DatabaseSync) {
    console.warn('  SKIP node:sqlite unavailable — the aggregate section did not run');
  } else {
    // --- pure helpers first (cheap, catch date/channel regressions) ---
    assert(new Date(weekStart('2026-07-24') + 'T00:00:00Z').getUTCDay() === 1, 'weekStart lands on a Monday');
    assert(clampRange(undefined, undefined, '2026-07-24').from === shiftDay('2026-07-24', -29), 'clampRange defaults to a 30-day window');
    assert(clampRange('2020-01-01', '2026-07-24', '2026-07-24', 90).from === shiftDay('2026-07-24', -90), 'clampRange caps an over-long range at maxDays');
    assert(clampRange('2026-07-01', '2999-01-01', '2026-07-24').to === '2026-07-24', 'clampRange never lets `to` exceed today');
    assert(classifyChannel('linkedin', '', '') === 'linkedin', 'utm_source maps to a channel');
    assert(classifyChannel('', '', 'instagram.com') === 'instagram', 'ref host maps to a channel when utm is absent');
    assert(classifyChannel('', 'referral', '') === 'referral', 'a referral medium is its own channel');
    assert(classifyChannel('', '', '') === 'organic', 'no attribution is organic');
    // The label-boundary fix (both sides `(^|\.)`…`(\.|$)`): the SAME list must
    // catch a full host, a bare utm token, AND an apex shortener like t.co — and
    // must NOT let the single-letter `x` token false-match an unrelated host.
    assert(classifyChannel('', '', 't.co') === 'twitter', 't.co (the Twitter/X web referrer) maps to twitter, not its own row');
    assert(classifyChannel('', '', 'www.linkedin.com') === 'linkedin', 'a full referrer host still maps');
    assert(classifyChannel('x', '', '') === 'twitter', 'a bare x utm_source maps to twitter');
    assert(classifyChannel('ig', '', '') === 'instagram', 'a bare ig utm_source maps to instagram');
    assert(classifyChannel('fb', '', '') === 'facebook', 'a bare fb utm_source maps to facebook');
    assert(classifyChannel('', '', 'xyz.com') !== 'twitter', 'the single-letter x token does not false-match xyz.com');

    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../migrations/0017_analytics.sql', import.meta.url), 'utf8'));
    sqlite.exec('CREATE TABLE users (email TEXT PRIMARY KEY, plan TEXT, plan_expires_at TEXT, plan_source TEXT)');

    // D1-shaped wrapper over the real database (mirrors scripts/test-events.mjs).
    const d1 = {
      prepare(sql) {
        const runP = (params) => { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) || 0 } }; };
        const allP = (params) => ({ results: sqlite.prepare(sql).all(...params) });
        const firstP = (params) => (sqlite.prepare(sql).get(...params) ?? null);
        return {
          bind(...params) { return { async run() { return runP(params); }, async all() { return allP(params); }, async first() { return firstP(params); } }; },
          async run() { return runP([]); },
          async all() { return allP([]); },
          async first() { return firstP([]); },
        };
      },
      async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
    };

    const TODAY = '2026-07-24';
    const NOW_ISO = TODAY + 'T23:59:59.000Z';
    const DM10 = '2026-07-14';
    const at = (day, hhmm) => `${day}T${hhmm}:00.000Z`;

    const insEv = sqlite.prepare(
      'INSERT INTO events (id,ts,day,anon_id,user_id,name,path,props,ref,utm_source,utm_medium,utm_campaign,ua_class) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    let evn = 0;
    const ev = (o) => insEv.run(
      'e' + (evn++), o.ts, o.day, o.anon, o.user || null, o.name, o.path || '/', o.props ? JSON.stringify(o.props) : null,
      o.ref || null, o.utm || null, o.med || null, null, o.ua || 'desktop',
    );

    // A1 (linkedin) — full funnel + activation. u1 signed-in on a today row.
    const L = { utm: 'linkedin' };
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:00'), name: 'page_view', path: '/', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:00'), name: 'session_start', path: '/', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:05'), name: 'quiz_start', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:10'), name: 'quiz_complete', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:11'), name: 'reveal_view', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:12'), name: 'signup_complete', ...L });
    ev({ anon: 'anon1-aaaa', day: TODAY, ts: at(TODAY, '09:20'), name: 'roadmap_generated', user: 'u1@x.com', ...L });
    // A2 (instagram via ref) — funnel to signup, no activation, all paywall stages. u2 signed-in.
    const I = { ref: 'instagram.com' };
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:00'), name: 'page_view', path: '/', user: 'u2@x.com', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:00'), name: 'session_start', path: '/', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:05'), name: 'quiz_start', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:10'), name: 'quiz_complete', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:11'), name: 'reveal_view', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:12'), name: 'signup_complete', ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:30'), name: 'plan_cap_hit', props: { feature: 'mock-interview' }, ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:31'), name: 'plan_cap_hit', props: { feature: 'resume-tailor' }, ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:32'), name: 'upgrade_click', props: { source: 'cap:mock-interview' }, ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:33'), name: 'checkout_start', props: { price: 'monthly' }, ...I });
    ev({ anon: 'anon2-bbbb', day: TODAY, ts: at(TODAY, '10:40'), name: 'checkout_success', props: { mode: 'subscription', price: 'monthly' }, ua: 'server' });
    // A3 — a bounced organic visitor (landing only).
    ev({ anon: 'anon3-cccc', day: TODAY, ts: at(TODAY, '11:00'), name: 'page_view', path: '/' });
    // A4 — active 10 days ago (inside MAU, outside WAU/DAU and the 7-day funnel).
    ev({ anon: 'anon4-dddd', day: DM10, ts: at(DM10, '09:00'), name: 'page_view', path: '/other' });

    // events_daily fixture for the feature-usage panel (reads the rollup, not raw).
    const insDaily = sqlite.prepare('INSERT INTO events_daily (day,name,count,uniques_anon,uniques_user) VALUES (?,?,?,?,?)');
    insDaily.run(TODAY, 'roadmap_generated', 5, 3, 2);
    insDaily.run(TODAY, 'quiz_complete', 4, 4, 2);

    // server_errors fixture (day-stamped to TODAY so the byRoute window is deterministic).
    const insErr = sqlite.prepare('INSERT INTO server_errors (id,ts,day,route,message,detail) VALUES (?,?,?,?,?,?)');
    insErr.run('er0', at(TODAY, '08:00'), TODAY, 'career-analysis', 'Gemini timeout', null);
    insErr.run('er1', at(TODAY, '08:05'), TODAY, 'career-analysis', 'parse fail', null);
    insErr.run('er2', at(TODAY, '08:10'), TODAY, 'contact', 'resend unreachable', null);

    const opts = { today: TODAY, nowIso: NOW_ISO };

    // --- overview ---
    const ov = await overviewMetrics(d1, { ...opts, monthlyCents: 1200 });
    assert(ov.active.dau.anon === 3 && ov.active.wau.anon === 3 && ov.active.mau.anon === 4,
      `DAU/WAU/MAU anon = 3/3/4 (got ${ov.active.dau.anon}/${ov.active.wau.anon}/${ov.active.mau.anon})`);
    assert(ov.active.dau.user === 2, `DAU signed-in uniques = 2 (got ${ov.active.dau.user})`);
    assert(ov.signups.today === 2 && ov.signups.last7 === 2 && ov.signups.last30 === 2, 'signups today/7d/30d = 2');
    assert(ov.signups.perDay.length === 14 && ov.signups.perDay[13].count === 2, 'the 14-day trend ends on today with 2 signups');
    assert(ov.activation.signups === 2 && ov.activation.activated === 1 && ov.activation.rate === 50,
      `activation = 1/2 within 48h = 50% (got ${ov.activation.activated}/${ov.activation.signups} = ${ov.activation.rate})`);

    // --- overview revenue (needs the users fixture) ---
    const insUser = sqlite.prepare('INSERT INTO users (email,plan,plan_expires_at,plan_source) VALUES (?,?,?,?)');
    insUser.run('u1@x.com', 'premium', null, 'stripe');
    insUser.run('u2@x.com', 'free', null, null);
    insUser.run('u3@x.com', 'lifetime', null, 'stripe');
    insUser.run('u4@x.com', 'premium', '2020-01-01T00:00:00.000Z', 'stripe'); // expired → not paid
    const ov2 = await overviewMetrics(d1, { ...opts, monthlyCents: 1200 });
    assert(ov2.revenue.paidCount === 2 && ov2.revenue.activeByPlan.premium === 1 && ov2.revenue.activeByPlan.lifetime === 1,
      `paid = 2 (1 premium, 1 lifetime); the expired premium is excluded (got ${ov2.revenue.paidCount})`);
    assert(ov2.revenue.mrr.estimateCents === 1200, 'MRR estimate = active premium × monthly cents; lifetime excluded');
    const ov3 = await overviewMetrics(d1, opts);
    assert(ov3.revenue.mrr.estimateCents === null, 'MRR is null (never fabricated) when no monthly price is provided');

    // --- funnel (7-day window) ---
    const fn = await funnelMetrics(d1, { ...opts, from: shiftDay(TODAY, -6), to: TODAY });
    const byStage = Object.fromEntries(fn.discovery.map((s) => [s.stage, s]));
    assert(byStage.landing.count === 3, `funnel landing = 3 distinct visitors (got ${byStage.landing.count})`);
    assert(byStage.quiz_start.count === 2 && byStage.quiz_complete.count === 2, 'quiz start/complete = 2');
    // S6 shipped the reveal, so this stage counts REAL events now. Seeding it
    // (rather than asserting a structural 0) is what makes the assertion able to
    // fail if the stage is ever wired to the wrong event name.
    assert(byStage.reveal_view.count === 2 && !byStage.reveal_view.pending,
      `reveal_view counts real events and is no longer flagged pending (got ${byStage.reveal_view.count}, pending=${byStage.reveal_view.pending})`);
    assert(byStage.signup.count === 2 && byStage.activated.count === 1, 'signup = 2, activated (roadmap) = 1');
    assert(byStage.quiz_start.pctOfPrev === Math.round((2 / 3) * 1000) / 10, 'per-stage conversion is share of the previous stage');
    const pay = Object.fromEntries(fn.paywall.stages.map((s) => [s.event, s.count]));
    assert(pay.plan_cap_hit === 2 && pay.upgrade_click === 1 && pay.checkout_start === 1 && pay.checkout_success === 1, 'paywall stage totals');
    assert(fn.paywall.capsByFeature.length === 2 && fn.paywall.capsByFeature.every((c) => c.count === 1), 'cap hits split by feature');

    // --- retention ---
    const rt = await retentionMetrics(d1, { ...opts, weeks: 8 });
    assert(rt.cohorts.length === 8, 'retention returns one row per requested week');
    const thisCohort = rt.cohorts.find((c) => c.cohortWeek === weekStart(TODAY));
    assert(thisCohort && thisCohort.size === 2 && thisCohort.retained[0].count === 2,
      `this week's cohort has both signups, week-0 retained = 2 (got size ${thisCohort && thisCohort.size})`);
    const rec = Object.fromEntries(rt.recency.map((b) => [b.bucket, b.count]));
    assert(rec['0–1d'] === 3 && rec['8–30d'] === 1, `recency: 3 active today, 1 at ten days (got 0–1d=${rec['0–1d']}, 8–30d=${rec['8–30d']})`);

    // --- features (from events_daily) ---
    const feat = await featureUsage(d1, { ...opts, weeks: 8 });
    const fmap = Object.fromEntries(feat.features.map((f) => [f.event, f]));
    assert(fmap.roadmap_generated.total === 5 && fmap.quiz_complete.total === 4, 'weekly feature totals come from events_daily');
    assert(feat.zeroUse.some((z) => z.key === 'opp_finder') && !feat.zeroUse.some((z) => z.event === 'roadmap_generated'),
      'zero-use lists the untouched features and excludes the used ones');

    // --- sources (7-day window) ---
    const src = await sourceAttribution(d1, { ...opts, from: shiftDay(TODAY, -6), to: TODAY });
    const chan = Object.fromEntries(src.channels.map((c) => [c.channel, c]));
    assert(chan.linkedin.visitors === 1 && chan.linkedin.signups === 1 && chan.linkedin.activations === 1, 'linkedin visitor signed up and activated');
    assert(chan.instagram.visitors === 1 && chan.instagram.signups === 1 && chan.instagram.activations === 0, 'instagram visitor signed up, did not activate');
    assert(chan.organic.visitors === 1 && chan.organic.signups === 0, 'the bounced organic visitor is attributed but never converts');

    // --- live tail ---
    const tail = await liveTail(d1, { limit: 100 });
    assert(tail.events.length === evn, `the tail returns every event (${tail.events.length}/${evn})`);
    assert(tail.events[0].name === 'page_view' && tail.events[0].anon === 'anon3-cc', 'newest-first, anon id truncated to 8 chars');
    assert(tail.events.every((e) => !('user' in e) && !('user_id' in e)), 'the tail never carries a user id / email');
    const capRow = tail.events.find((e) => e.name === 'plan_cap_hit'); // newest-first → resume-tailor (10:31) before mock-interview (10:30)
    assert(capRow && capRow.props && ['mock-interview', 'resume-tailor'].includes(capRow.props.feature), 'props are parsed back for debugging');

    // --- error log + logServerError write→read→PII redaction + 4xx drop ---
    const errEnv = { DB: d1 };
    const wrote = await logServerError(errEnv, 'roadmap-generate',
      new Error('bad email leaked@example.com from 203.0.113.9 tok deadbeefdeadbeefdeadbeefdeadbeef'), { status: 500 });
    assert(wrote === true, 'logServerError writes a row and reports success');
    // A user-caused 4xx (a 429 rate-limit that reached an outer catch) is NOT a
    // server error and must not fill the Sentry-stand-in with throttle noise.
    const skipped429 = await logServerError(errEnv, 'rate-throttle', { status: 429, message: 'rate limited' });
    assert(skipped429 === false, 'a user-caused 4xx (429 rate-limit) is dropped, not logged');
    const errs = await recentServerErrors(d1, { ...opts, limit: 50, sinceDays: 7 });
    assert(errs.recent.length === 4, `recent errors = 3 seeded + 1 logged, the 429 wrote nothing (got ${errs.recent.length})`);
    assert(!errs.recent.some((r) => r.route === 'rate-throttle'), 'the dropped 429 left no server_errors row');
    const logged = errs.recent.find((r) => r.route === 'roadmap-generate');
    assert(logged && /<redacted>/.test(logged.message) && !/leaked@example\.com/.test(logged.message),
      'an email in an error message is redacted before it is stored');
    assert(logged && /<ip>/.test(logged.message) && !/203\.0\.113\.9/.test(logged.message),
      'an IPv4 address in an error message is redacted');
    assert(logged && /<token>/.test(logged.message) && !/deadbeefdeadbeef/.test(logged.message),
      'a long hex token in an error message is redacted');
    const byRoute = Object.fromEntries(errs.byRoute.map((r) => [r.route, r.count]));
    assert(byRoute['career-analysis'] === 2 && byRoute.contact === 1, 'byRoute rolls the seeded errors up per route');
    assert(await logServerError({}, 'x', new Error('y')) === false, 'logServerError with no DB binding degrades to false, never throws');
  }
}

process.exit(fail ? 1 : 0);
