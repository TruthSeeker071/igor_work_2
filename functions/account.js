import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  getSessionEmail,
  destroyAllSessions,
  clearSessionCookieHeader,
} from './_lib/auth.js';
import { careerRankKeyPrefix } from './_lib/onet/career-rank.js';

// ---------------------------------------------------------------------------
// D1. Every table in migrations/ that holds a user identifier must appear in
// exactly one of the four lists below, and the `test:purge` gate parses
// migrations/ and fails if one does not. That is the whole point: the previous
// version of this file was a hand-written list that had silently fallen five
// tables behind the schema, and nothing could tell.

/** Deleted by `WHERE email = ?`. `users` is last so the row freeing the address goes last. */
export const USER_TABLES = [
  'artifacts',
  'career_analyses',
  // Support messages carry the sender's reply address, so they are personal data.
  'contact_messages',
  // The resume the student wrote here, and every saved revision of it. This is
  // the most personal free text in the product and it was surviving deletion.
  'resumes',
  'resume_versions',
  // Mock-interview transcripts and scores — same class, same omission.
  'interview_sessions',
  // An email-keyed entitlement. Leaving it behind means re-registering the same
  // address silently inherits a plan that was granted to whoever held it before.
  'comp_grants',
  // Leaving this is a privilege-persistence hole, not just a privacy one: delete
  // the account, re-register the same address, come back an admin.
  'admin_roles',
  'password_reset_tokens',
  'pricing_intents',
  'roadmaps',
  'sessions',
  'user_profiles',
  'vector_snapshots',
  'users',
];

/**
 * Deleted by `WHERE user_id = ?` as well as by email.
 * contact_messages stores BOTH: `email` is the reply address the sender typed,
 * `user_id` is who they were signed in as. Those differ whenever someone writes
 * from a different address than their account, so purging on one column leaves
 * rows attributed to the other.
 */
export const USER_ID_TABLES = [
  'contact_messages',
  // The email send log (S4). Its only identity column is user_id (the normalized
  // email we sent to), so it is purged by user_id, not email. Which addresses we
  // emailed is personal data — it goes with the account.
  'email_log',
  // The Deadline Radar (S9). Same shape: user_id is the normalized email. The
  // rows say which programs a named person is applying to and when — as
  // personal as the roadmap they hang off — so they go with the account.
  'deadlines',
  // The Application Tracker (S12). The most sensitive table in the schema after
  // the resume: it names every place a student applied, whether they were
  // rejected, and what they wrote to themselves about it. Same key shape.
  'applications',
  // S15. Public share pages the user created. They are the only rows in the
  // schema that are readable by ANYONE with a URL, so leaving one behind after a
  // deletion request would be the most visible possible failure of it. The PNG
  // that goes with each row lives in KV under `shareimg:<email>:<id>` — a key
  // that carries the email as a segment specifically so the sweep below finds it
  // without a second list.
  'shares',
  // Readiness scorecards (S16). Each row is a stored judgement about one named
  // person's preparedness — which requirements they did and did not meet, quoted
  // off their own resume — so it is at least as personal as the resume it was
  // built from and goes with the account. Same `user_id` key shape as the other
  // V2 tables.
  'scorecards',
  // The Network mapper (S17). These rows name THIRD PARTIES — the people a
  // student is trying to reach, sometimes by name and employer, alongside a
  // drafted message and private notes about how it went. That makes them the one
  // table in the schema holding personal data about someone who never signed up
  // for FlightWay, so they cannot survive the account they hang off. Same
  // `user_id` key shape as the other V2 tables.
  'contacts',
  // Interview Season programmes (S18). The six-week schedule itself is not
  // sensitive, but the row says which career a named person was interviewing for
  // and when — and its whole purpose is to be joined to `interview_sessions`,
  // which is already purged as personal data. A programme that outlived the
  // account would be an orphan pointing at deleted transcripts.
  'interview_seasons',
  // The Semester Loop's term records (S18). Free-text outcomes the student wrote
  // about their own year ("get the Jane Street interview", "fix my GPA in 154"),
  // their courses and clubs, and a stored retrospective of what they did and did
  // not manage. Same `user_id` key shape as the other V2 tables.
  'terms',
  // NPS responses (S19). Free-text comments a student wrote about the product,
  // keyed to their address. Nothing outside the admin console ever reads them,
  // but they are still that person's words about their own experience.
  'nps_responses',
  // Consented testimonials (S19). The single most visible row in the schema: an
  // approved one is printed on the marketing homepage under the student's own
  // name and school. A deletion request that left a quote up would be the most
  // publicly wrong this purge could possibly be, so it goes with the account —
  // and `functions/admin/testimonials.js` busts the public KV cache on every
  // status change, which is the same key the purge's disappearance relies on
  // expiring (≤10 minutes) for the quote to leave the homepage.
  'testimonials',
];

/**
 * Identifier nulled, row kept.
 *
 * `events` is behavioural counting, not a record about a person: props are
 * PII-scrubbed server-side before they are written and no IP is stored, so
 * `user_id` is the only thing tying a row to anyone. Nulling it severs that
 * link completely, which is what a deletion request is actually asking for.
 * Deleting the rows instead would silently rewrite every funnel, cohort and
 * retention number for everyone else — one person exercising a privacy right
 * should not corrupt the aggregate reporting the product is steered by. The raw
 * rows also age out at 90 days on their own, and `events_daily` never held an
 * identifier to begin with.
 */
export const ANONYMIZE_TABLES = [
  { table: 'events', column: 'user_id' },
  // S15 referrals. A row is a RELATIONSHIP between two accounts and a ledger of
  // a credit that was actually issued, so deleting it on one party's request
  // would erase the other party's evidence — and, for a credited row, the only
  // record of money that moved. Nulling the departing side severs their link
  // completely (which is what the request is asking for) and leaves the counter
  // party with a row that no longer names anybody who left.
  //
  // Two entries, one table: the purge loop runs both UPDATEs, so it is correct
  // whichever side of the referral is closing their account. idx_referrals_referee
  // is UNIQUE over a NULLable column precisely so several anonymized rows can
  // coexist — see migration 0023.
  { table: 'referrals', column: 'referrer_id' },
  { table: 'referrals', column: 'referee_id' },
];

/**
 * Deliberately untouched, with the reason. The gate requires a reason string —
 * an entry here is a decision someone has to defend, not a place to park a
 * table that was awkward to handle.
 */
export const EXCLUDED_TABLES = {
  onet_careers: 'global O*NET catalog; no user data',
  derived_careers: 'global catalog cache; no user data',
  events_daily: 'daily rollup; counts only, no identifier column exists',
  server_errors: 'route + truncated message; no user column',
  stripe_events: 'webhook idempotency ledger keyed by Stripe event id',
  quiz_profiles: 'dropped in migration 0014 after backfill into user_profiles',
  admin_audit_log:
    'security audit trail (who granted or revoked what, and to whom). Retained '
    + 'deliberately: an audit log a subject can erase by deleting their own '
    + 'account is worthless in the one case it exists for — an admin covering '
    + 'their tracks. Disclosed in privacy.html as a named exception.',
  broadcasts:
    'the record of what was mailed to a segment and by which ADMIN (actor_email '
    + 'is a staff address, never a subject). Retained for the same reason as '
    + 'admin_audit_log: a send record the sender can erase by deleting their own '
    + 'account is worthless. It holds no recipient list — individual deliveries '
    + 'live in email_log, which IS purged with the recipient account.',
};

// ---------------------------------------------------------------------------
// KV. This used to be two hand-written lists of namespace names and BOTH were
// wrong, in three separate ways that were invisible from reading them:
//
//   · `stretch:v4:<email>:…` and `oppfind:v2:<email>:…` put a version segment
//     BEFORE the email, so a `stretch:<email>:` prefix matched nothing.
//   · `checkRateLimit` stores under `auth_rate:<key>`, so the entries naming
//     bare rate-limit types (`login`, `register`, `forgot`, …) matched nothing.
//   · Nine namespaces written since the lists were last touched — `rtailor`,
//     `rtailorday`, `rbuildqday`, `elab`, `wpplan`, `alignment_proposal`,
//     `admin_elev`, the `plan-limits` usage counters, `nudgefail` — were never
//     added at all.
//
// So the mechanism is now a sweep rather than an enumeration: list the namespace
// and delete every key that carries this email as a colon-delimited SEGMENT.
// Segment equality, not substring — `a@b.com` must never match `xa@b.com`.
// It costs one paginated list of a namespace whose keys are nearly all
// short-TTL caches, on an operation a user performs at most once. In exchange it
// is correct for namespaces that do not exist yet, which no list can be.
const KV_SWEEP_MAX_PAGES = 200; // ~200k keys; a real ceiling, not a guess at one

/** Every namespace where the email is HASHED, so the sweep cannot see it. */
function hashedKeyPrefixes(email) {
  return [careerRankKeyPrefix(email)];
}

async function deleteKvByPrefix(kv, prefix) {
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys || []) {
      try { await kv.delete(k.name); } catch (_) { /* best effort */ }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
}

/** True when `email` appears as a whole colon-delimited segment of `key`. */
export function keyBelongsTo(key, email) {
  return String(key || '').split(':').includes(email);
}

async function sweepKvByEmail(kv, email) {
  let cursor;
  let pages = 0;
  let deleted = 0;
  do {
    const res = await kv.list({ cursor });
    for (const k of res.keys || []) {
      if (!keyBelongsTo(k.name, email)) continue;
      try { await kv.delete(k.name); deleted += 1; } catch (_) { /* best effort */ }
    }
    cursor = res.list_complete ? null : res.cursor;
    pages += 1;
    if (pages >= KV_SWEEP_MAX_PAGES && cursor) {
      // Say so rather than report a clean purge. A silent partial delete is the
      // failure this whole rewrite exists to stop.
      console.error(`account purge: KV sweep hit the ${KV_SWEEP_MAX_PAGES}-page cap; some keys may remain`);
      break;
    }
  } while (cursor);
  return deleted;
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

// DELETE /account — the "Doom Button". Purges the signed-in user's account from
// D1 + KV entirely and clears their session, so the same email can re-register
// from scratch. Best-effort per store: one failing table/key never aborts the rest.
export async function onRequestDelete(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  try {
    const email = await getSessionEmail(request, env);
    if (!email) return authJsonResponse(401, { error: 'Not signed in.' }, origin);

    if (env.DB) {
      // Anonymize before deleting: if the purge dies partway, a row that has
      // already lost its identifier is the safe state to be interrupted in.
      for (const { table, column } of ANONYMIZE_TABLES) {
        try {
          await env.DB.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).bind(email).run();
        } catch (e) {
          console.warn(`account purge: ANONYMIZE ${table} failed`, e?.message || e);
        }
      }
      for (const table of USER_ID_TABLES) {
        try {
          await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(email).run();
        } catch (e) {
          console.warn(`account purge: DELETE ${table} BY user_id failed`, e?.message || e);
        }
      }
      for (const table of USER_TABLES) {
        try {
          await env.DB.prepare(`DELETE FROM ${table} WHERE email = ?`).bind(email).run();
        } catch (e) {
          console.warn(`account purge: DELETE ${table} failed`, e?.message || e);
        }
      }
    }

    if (env.COACH_KV) {
      for (const prefix of hashedKeyPrefixes(email)) {
        try { await deleteKvByPrefix(env.COACH_KV, prefix); } catch (_) { /* best effort */ }
      }
      try { await sweepKvByEmail(env.COACH_KV, email); } catch (e) {
        console.warn('account purge: KV sweep failed', e?.message || e);
      }
    }

    try { await destroyAllSessions(env, email); } catch (_) { /* sessions row already purged above */ }

    return authJsonResponse(200, { ok: true, purged: true }, origin, {
      'Set-Cookie': clearSessionCookieHeader(),
    });
  } catch (err) {
    console.error('account purge failed', err);
    return authErrorResponse(err, origin);
  }
}

// Legacy account-creation path stays retired.
export async function onRequestPost(context) {
  const origin = originFromEnv(context.env, context.request);
  return authJsonResponse(410, {
    error: 'This endpoint is deprecated. Use POST /auth/register instead.',
  }, origin);
}
