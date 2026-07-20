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
import { onRequestPost as webhookPost } from '../functions/stripe/webhook.js';
import { signWebhookPayload } from '../functions/_lib/stripe.js';
import { readFile } from 'node:fs/promises';

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
  assert(capped.ok && capped.plan === 'free' && capped.remaining === 4, 'and the free caps come back with it');
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
  for (let i = 0; i < 5; i++) marco = await checkFeatureLimit(env, 'honest@x.com', 'marco-chat');
  assert(marco.ok && marco.remaining === 0, 'it spends exactly 5 Marco messages');
  const sixth = await checkFeatureLimit(env, 'honest@x.com', 'marco-chat');
  assert(!sixth.ok && sixth.upgrade, 'the 6th Marco message is blocked');

  const gen1 = await checkFeatureLimit(env, 'honest@x.com', 'roadmap-generate');
  const gen2 = await checkFeatureLimit(env, 'honest@x.com', 'roadmap-generate');
  assert(gen1.ok && !gen2.ok, 'one free roadmap generation, then blocked');

  const iv = await checkFeatureLimit(env, 'honest@x.com', 'mock-interview');
  assert(!iv.ok && iv.limit === 0, 'mock interviews stay hard-gated off the free plan');
}

process.exit(fail ? 1 : 0);
