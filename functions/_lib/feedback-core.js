// FlightWay V2 S19 — NPS + testimonial rules, pure (plan §5 S19, D28).
//
// Nothing here touches D1, KV, the network or the clock-as-a-global: every
// function takes what it needs and returns a value. That is what lets
// `test:nps` run in the pure lane and assert the two things this feature can
// get wrong silently:
//
//   - the 30-day frequency cap (a nag is worse than no survey), and
//   - consent redaction (a name printed on the homepage that its owner never
//     agreed to print is the one mistake here that cannot be walked back).
//
// The redaction in particular is done ONCE, at write time, and the caller
// stores what comes out. Hiding an unconsented name at render time would leave
// it sitting in a row that some future admin export, debug endpoint or JSON
// response could read; not storing it means there is nothing to leak.

/** The three product moments allowed to raise the card (§5 S19). */
export const NPS_MOMENTS = ['flightplan_done', 'roadmap_commit', 'month_review'];

/** Once per user per 30 days, counting dismissals. */
export const NPS_COOLDOWN_DAYS = 30;

/** 0–10 inclusive — the standard NPS scale, not a 1–5 star rating. */
export const NPS_MIN_SCORE = 0;
export const NPS_MAX_SCORE = 10;

/** A promoter is 9 or 10. Only promoters are offered the quote follow-up. */
export const PROMOTER_MIN = 9;
/** A detractor is 0–6; 7–8 are passives and count in neither bucket. */
export const DETRACTOR_MAX = 6;

export const MAX_COMMENT = 500;

/** Long enough to be a sentence, short enough to render in a card. */
export const MIN_QUOTE = 20;
export const MAX_QUOTE = 400;

/** How many pending quotes one account may have waiting at once. */
export const MAX_PENDING_PER_USER = 3;

export const TESTIMONIAL_STATUSES = ['pending', 'approved', 'featured', 'rejected'];
/** The two the world can see. Everything else is invisible outside the console. */
export const PUBLIC_STATUSES = ['featured', 'approved'];
/** What the admin console may do to a row, and what each does to `status`. */
export const REVIEW_ACTIONS = {
  approve: 'approved',
  feature: 'featured',
  unfeature: 'approved',
  reject: 'rejected',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Whole days between two ISO timestamps, or NaN if either is unparseable.
 * Fractional days round DOWN, so "asked 29.9 days ago" is 29 and still capped —
 * erring toward asking less often is the correct direction for a survey.
 */
export function daysBetween(fromIso, toIso) {
  const a = toTime(fromIso);
  const b = toTime(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.floor((b - a) / DAY_MS);
}

/**
 * May we raise the card? `lastAskedAt` is the created_at of this user's most
 * recent nps_responses row, of ANY status, or null/'' when they have none.
 *
 * An unparseable timestamp returns FALSE. A corrupt row must not become an
 * excuse to survey somebody every single day; the failure direction for a
 * frequency cap is always "ask less".
 */
export function npsEligible(lastAskedAt, nowIso) {
  if (!lastAskedAt) return true;
  const days = daysBetween(lastAskedAt, nowIso);
  if (!Number.isFinite(days)) return false;
  return days >= NPS_COOLDOWN_DAYS;
}

/** When the cap lifts, for the `retryAfter` the endpoint reports back. */
export function npsCooldownUntil(lastAskedAt) {
  const t = toTime(lastAskedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + NPS_COOLDOWN_DAYS * DAY_MS).toISOString();
}

/**
 * Validate a POST /nps body. Returns `{ error }` or the normalized write.
 *
 * `dismiss` writes a row exactly like `score` does, minus the number: it is the
 * record that we asked and were declined, which is both the response-rate
 * denominator and the thing that starts the cooldown.
 */
export function validateNps(body) {
  const moment = String(body?.moment || '').trim();
  if (!NPS_MOMENTS.includes(moment)) return { error: 'Unknown moment.' };

  const action = String(body?.action || 'score').trim().toLowerCase();
  if (action === 'dismiss') {
    return { moment, status: 'dismissed', score: null, comment: '' };
  }
  if (action !== 'score') return { error: 'Unknown action.' };

  // Explicitly reject anything non-integer BEFORE coercing: `Number('')` is 0,
  // and a blank field silently landing as a 0 would read as the angriest
  // possible answer from somebody who answered nothing.
  const raw = body?.score;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return { error: 'Pick a score from 0 to 10.' };
  if (raw < NPS_MIN_SCORE || raw > NPS_MAX_SCORE) return { error: 'Pick a score from 0 to 10.' };

  const comment = String(body?.comment || '').trim().slice(0, MAX_COMMENT);
  return { moment, status: 'scored', score: raw, comment };
}

/** True when this score earns the "mind if we quote you?" follow-up. */
export function isPromoter(score) {
  return typeof score === 'number' && score >= PROMOTER_MIN && score <= NPS_MAX_SCORE;
}

/** Validate a POST /testimonials body. Returns `{ error }` or the normalized write. */
export function validateTestimonial(body) {
  const quote = String(body?.quote || '').replace(/\s+/g, ' ').trim();
  if (quote.length < MIN_QUOTE) return { error: `Please write at least ${MIN_QUOTE} characters.` };
  if (quote.length > MAX_QUOTE) return { error: `Please keep it under ${MAX_QUOTE} characters.` };
  return {
    quote,
    npsId: String(body?.npsId || '').trim().slice(0, 40),
    consentName: body?.consentName === true,
    consentSchool: body?.consentSchool === true,
  };
}

/**
 * THE privacy invariant. Given what we know about the student and what they
 * ticked, return only what may be stored.
 *
 * Both directions matter: an unticked box yields `''`, and a ticked box with
 * nothing behind it (we never learned their school) ALSO yields `''` rather
 * than a placeholder — "— , University of" on the homepage is worse than no
 * attribution at all. Consent is a permission, never a promise that a value
 * exists.
 */
export function redactConsent({ name, school, consentName, consentSchool } = {}) {
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
  return {
    displayName: consentName === true ? clean(name) : '',
    school: consentSchool === true ? clean(school) : '',
  };
}

/**
 * A stored row → what the public endpoint may serve. Reads only columns the
 * redaction above already filtered, so this is a projection and not a second
 * chance to get consent wrong.
 */
export function publicQuote(row) {
  if (!row) return null;
  const out = { id: String(row.id || ''), quote: String(row.quote || '') };
  const name = String(row.display_name || '').trim();
  const school = String(row.school || '').trim();
  if (name) out.name = name;
  if (school) out.school = school;
  return out;
}

/**
 * Featured first, then newest. Deterministic on ties (by id) so the homepage
 * does not reshuffle between two requests and look like it is A/B testing.
 */
export function sortQuotes(rows) {
  return [...(rows || [])].sort((a, b) => {
    const fa = a.status === 'featured' ? 0 : 1;
    const fb = b.status === 'featured' ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ta = String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (ta !== 0) return ta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * The admin console's summary. `rows` is every nps_responses row in the window,
 * INCLUDING dismissals — which is the point: the response rate is as
 * interesting as the score, and computing it from a pre-filtered list would
 * have thrown the denominator away.
 *
 * `nps` is null rather than 0 when nobody scored. A zero NPS is a real, bad
 * number; a survey nobody answered has no number, and printing 0 for it would
 * be a fabricated result.
 */
export function npsSummary(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const scored = all.filter((r) => r && r.status === 'scored' && typeof r.score === 'number');
  const promoters = scored.filter((r) => r.score >= PROMOTER_MIN).length;
  const detractors = scored.filter((r) => r.score <= DETRACTOR_MAX).length;
  const passives = scored.length - promoters - detractors;
  return {
    asked: all.length,
    scored: scored.length,
    dismissed: all.length - scored.length,
    promoters,
    passives,
    detractors,
    nps: scored.length ? Math.round(((promoters - detractors) / scored.length) * 100) : null,
  };
}
