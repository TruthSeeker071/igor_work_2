// test:nps — V2 S19, the NPS card and the consented-testimonial flow (D28).
//
// Four things this gate exists for, each of which is silent when it goes wrong:
//
//   1. **Consent redaction happens at WRITE time, and both directions hold.**
//      An unticked box must yield the empty string, and a TICKED box with
//      nothing behind it must also yield the empty string rather than a
//      placeholder. The failure mode is a real student's name on the marketing
//      homepage that they never agreed to print, which is the one mistake in
//      this feature that cannot be walked back.
//   2. **The 30-day frequency cap counts dismissals.** The card is raised at
//      three product moments and a student can hit two in one sitting, so a
//      cap that only counts answers nags exactly the people least interested.
//      Also asserted: an unparseable timestamp fails CLOSED — the failure
//      direction for a survey is always "ask less".
//   3. **A blank score is refused rather than coerced.** `Number('')` is 0, and
//      0 on an NPS scale is the angriest possible answer. A validator that
//      coerces would silently manufacture detractors out of people who answered
//      nothing.
//   4. **`nps: null` is not `nps: 0`.** A zero Net Promoter Score is a real and
//      very bad number; a survey nobody has answered has no number at all, and
//      printing 0 for it is a fabricated result on an admin dashboard somebody
//      will make a decision from.
//
// Everything runs offline: feedback-core.js is pure by construction, and the
// two structural assertions read the repo rather than a server.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NPS_MOMENTS, NPS_COOLDOWN_DAYS, NPS_MIN_SCORE, NPS_MAX_SCORE, PROMOTER_MIN, DETRACTOR_MAX,
  MIN_QUOTE, MAX_QUOTE, MAX_COMMENT, MAX_PENDING_PER_USER,
  TESTIMONIAL_STATUSES, PUBLIC_STATUSES, REVIEW_ACTIONS,
  daysBetween, npsEligible, npsCooldownUntil, validateNps, isPromoter,
  validateTestimonial, redactConsent, publicQuote, sortQuotes, npsSummary,
} from '../functions/_lib/feedback-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (cond) { console.log(`  ok - ${name}`); return; }
  failures += 1;
  console.error(`  FAIL - ${name}`);
}
function section(title) { console.log(`\n${title}`); }

/** A source file with its comments stripped — a lint a comment can flip is not a lint (S17). */
function codeOnly(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-03-01T12:00:00Z');

// ---------------------------------------------------------------------------
section('consent redaction — the invariant that cannot be walked back');

const FULL = { name: 'Jacob Klugerman', school: 'University of Chicago' };

check('both ticked → both stored',
  JSON.stringify(redactConsent({ ...FULL, consentName: true, consentSchool: true }))
  === JSON.stringify({ displayName: 'Jacob Klugerman', school: 'University of Chicago' }));

check('neither ticked → NOTHING stored, not merely hidden',
  JSON.stringify(redactConsent({ ...FULL, consentName: false, consentSchool: false }))
  === JSON.stringify({ displayName: '', school: '' }));

check('name only',
  redactConsent({ ...FULL, consentName: true, consentSchool: false }).school === '');
check('school only',
  redactConsent({ ...FULL, consentName: false, consentSchool: true }).displayName === '');

// A truthy-but-not-true value must not pass: `consentName: 'false'` is a string
// and would sail through an `if (consentName)`.
check('consent is strict === true, so a truthy string is not consent',
  redactConsent({ ...FULL, consentName: 'yes', consentSchool: 1 }).displayName === ''
  && redactConsent({ ...FULL, consentName: 'yes', consentSchool: 1 }).school === '');

check('a ticked box with no value behind it yields empty, never a placeholder',
  JSON.stringify(redactConsent({ name: '', school: '  ', consentName: true, consentSchool: true }))
  === JSON.stringify({ displayName: '', school: '' }));

check('whitespace is collapsed and the value is bounded',
  redactConsent({ name: '  Jacob\n  K  ', consentName: true }).displayName === 'Jacob K'
  && redactConsent({ name: 'x'.repeat(300), consentName: true }).displayName.length === 80);

// The projection: adding a column to `testimonials` must not start serving it.
const proj = publicQuote({
  id: 'abc', quote: 'It told me what to do.', display_name: '', school: '',
  user_id: 'someone@example.edu', consent_name: 0, status: 'approved',
});
check('publicQuote copies four named fields and never the whole row',
  JSON.stringify(Object.keys(proj)) === JSON.stringify(['id', 'quote']));
check('and includes name/school only when they are actually stored',
  publicQuote({ id: 'a', quote: 'q', display_name: 'Jo', school: '' }).name === 'Jo'
  && publicQuote({ id: 'a', quote: 'q', display_name: 'Jo', school: '' }).school === undefined);

// ---------------------------------------------------------------------------
section('the 30-day cap — and that a dismissal spends it');

check('never asked → eligible', npsEligible(null, iso(T0)) === true);
check('asked yesterday → not eligible', npsEligible(iso(T0 - DAY), iso(T0)) === false);
check('asked 29 days ago → still capped', npsEligible(iso(T0 - 29 * DAY), iso(T0)) === false);
check('asked exactly 30 days ago → eligible again', npsEligible(iso(T0 - 30 * DAY), iso(T0)) === true);
check('asked 31 days ago → eligible', npsEligible(iso(T0 - 31 * DAY), iso(T0)) === true);
check('the cap is the documented 30 days', NPS_COOLDOWN_DAYS === 30);

// 29.9 days must floor to 29 and stay capped: rounding UP here would let the
// card reappear a few hours early, every single month.
check('a fractional day floors DOWN, so the cap never lifts early',
  daysBetween(iso(T0 - Math.round(29.9 * DAY)), iso(T0)) === 29
  && npsEligible(iso(T0 - Math.round(29.9 * DAY)), iso(T0)) === false);

check('a corrupt timestamp fails CLOSED (ask less, never more)',
  npsEligible('not-a-date', iso(T0)) === false && Number.isNaN(daysBetween('x', iso(T0))));

check('the cooldown end is reported for the client to explain',
  npsCooldownUntil(iso(T0)) === iso(T0 + 30 * DAY) && npsCooldownUntil('nope') === null);

// A dismissal is a WRITE. If it ever stopped being one, `lastNpsAsk` would find
// nothing and the next moment in the same sitting would ask again.
const dismissed = validateNps({ action: 'dismiss', moment: 'flightplan_done' });
check('dismiss produces a real row (status dismissed, score null)',
  dismissed.status === 'dismissed' && dismissed.score === null && !dismissed.error);
check('and the endpoint records it rather than short-circuiting',
  /action === 'dismiss'/.test(codeOnly('functions/_lib/feedback-core.js'))
  && /recordNps\(/.test(codeOnly('functions/nps.js')));

// ---------------------------------------------------------------------------
section('score validation — a blank field is not a zero');

check('a valid score passes', validateNps({ moment: 'month_review', score: 7 }).score === 7);
check('0 and 10 are both valid',
  validateNps({ moment: 'month_review', score: 0 }).score === 0
  && validateNps({ moment: 'month_review', score: 10 }).score === 10);
check('an empty string is REFUSED, not coerced to 0',
  !!validateNps({ moment: 'month_review', score: '' }).error);
check('a numeric string is refused too', !!validateNps({ moment: 'month_review', score: '9' }).error);
check('null is refused', !!validateNps({ moment: 'month_review', score: null }).error);
check('a missing score is refused', !!validateNps({ moment: 'month_review' }).error);
check('a fraction is refused', !!validateNps({ moment: 'month_review', score: 7.5 }).error);
check('out of range is refused',
  !!validateNps({ moment: 'month_review', score: 11 }).error
  && !!validateNps({ moment: 'month_review', score: -1 }).error);
check('an unknown moment is refused', !!validateNps({ moment: 'whenever', score: 9 }).error);
check('an unknown action is refused', !!validateNps({ action: 'nope', moment: 'month_review' }).error);
check('the three moments are the three the client can trigger',
  JSON.stringify(NPS_MOMENTS) === JSON.stringify(['flightplan_done', 'roadmap_commit', 'month_review']));
check('a comment is bounded',
  validateNps({ moment: 'month_review', score: 9, comment: 'x'.repeat(999) }).comment.length === MAX_COMMENT);
check('the scale bounds are 0..10', NPS_MIN_SCORE === 0 && NPS_MAX_SCORE === 10);

check('promoters are 9 and 10 only',
  isPromoter(9) && isPromoter(10) && !isPromoter(8) && !isPromoter(11) && !isPromoter(null));
check('and only a promoter is offered the quote step',
  /promoter/.test(codeOnly('functions/nps.js')) && PROMOTER_MIN === 9);

// ---------------------------------------------------------------------------
section('the summary — null is not zero, and dismissals are the denominator');

const rows = [
  { status: 'scored', score: 10 }, { status: 'scored', score: 9 },
  { status: 'scored', score: 8 },
  { status: 'scored', score: 3 }, { status: 'scored', score: 6 },
  { status: 'dismissed', score: null }, { status: 'dismissed', score: null },
];
const sum = npsSummary(rows);
check('promoters / passives / detractors split on 9+ and 6-',
  sum.promoters === 2 && sum.passives === 1 && sum.detractors === 2 && DETRACTOR_MAX === 6);
check('the NPS is (promoters − detractors) / scored, as a percentage', sum.nps === 0);
check('dismissals are counted but never scored',
  sum.asked === 7 && sum.scored === 5 && sum.dismissed === 2);
check('a survey nobody answered has NO number, not a zero',
  npsSummary([{ status: 'dismissed', score: null }]).nps === null
  && npsSummary([]).nps === null);
check('a null score with status scored is not silently averaged in',
  npsSummary([{ status: 'scored', score: null }]).scored === 0);
check('a real zero NPS is still reported as 0',
  npsSummary([{ status: 'scored', score: 3 }]).nps === -100
  && npsSummary([{ status: 'scored', score: 10 }, { status: 'scored', score: 0 }]).nps === 0);

// ---------------------------------------------------------------------------
section('the quote itself');

check('too short is refused', !!validateTestimonial({ quote: 'good' }).error);
check('a long one is refused rather than truncated',
  !!validateTestimonial({ quote: 'x'.repeat(MAX_QUOTE + 1) }).error);
check('whitespace is collapsed before the length is judged',
  validateTestimonial({ quote: `  It   told me what to do this week.  ` }).quote
  === 'It told me what to do this week.');
check('the bounds are a sentence, not a paragraph', MIN_QUOTE === 20 && MAX_QUOTE === 400);
check('consent defaults to FALSE when the field is absent',
  validateTestimonial({ quote: 'It told me exactly what to do this week.' }).consentName === false);
check('one account cannot flood the queue', MAX_PENDING_PER_USER === 3);

check('only approved and featured are public',
  JSON.stringify(PUBLIC_STATUSES) === JSON.stringify(['featured', 'approved'])
  && !PUBLIC_STATUSES.includes('pending') && !PUBLIC_STATUSES.includes('rejected'));
check('and the SQL filters on them rather than a later .filter()',
  /WHERE status IN \(/.test(codeOnly('functions/_lib/feedback-store.js')));
check('nothing is published without a human — there is no auto-approve',
  !/status\s*=\s*'approved'/.test(codeOnly('functions/testimonials.js'))
  && /'pending'/.test(codeOnly('functions/_lib/feedback-store.js')));
check('every review action maps to a real status',
  Object.values(REVIEW_ACTIONS).every((s) => TESTIMONIAL_STATUSES.includes(s)));

const sorted = sortQuotes([
  { id: 'b', status: 'approved', created_at: '2026-03-02' },
  { id: 'a', status: 'featured', created_at: '2026-01-01' },
  { id: 'c', status: 'approved', created_at: '2026-03-05' },
]);
check('featured sorts first, then newest, then stable by id',
  sorted.map((r) => r.id).join('') === 'acb');

// ---------------------------------------------------------------------------
section('structure');

check('the routes exist',
  fs.existsSync(path.join(ROOT, 'functions/nps.js'))
  && fs.existsSync(path.join(ROOT, 'functions/testimonials.js'))
  && fs.existsSync(path.join(ROOT, 'functions/admin/testimonials.js')));
check('and do not shadow a static page',
  !fs.existsSync(path.join(ROOT, 'nps.html')) && !fs.existsSync(path.join(ROOT, 'testimonials.html')));

const migration = fs.readdirSync(path.join(ROOT, 'migrations')).find((f) => /feedback/.test(f));
check('the migration exists', !!migration);
const sql = migration ? fs.readFileSync(path.join(ROOT, 'migrations', migration), 'utf8') : '';
check('it creates both tables',
  /CREATE TABLE IF NOT EXISTS nps_responses/.test(sql)
  && /CREATE TABLE IF NOT EXISTS testimonials/.test(sql));
check('the consent columns are recorded alongside the redacted values',
  /consent_name/.test(sql) && /consent_school/.test(sql));

// A published quote outliving a deletion request is the most visible possible
// failure of the purge, so the tables must be on the by-user_id sweep.
const account = fs.readFileSync(path.join(ROOT, 'functions/account.js'), 'utf8');
check("both tables are in account.js's USER_ID_TABLES",
  /'nps_responses'/.test(account) && /'testimonials'/.test(account));

// Mutating the queue publishes text to the homepage: same bar as grants.
check('every admin mutation requires elevation',
  /requireElevation/.test(codeOnly('functions/admin/testimonials.js')));
check('and approval busts the public cache, so a button never looks dead',
  /bustPublicCache/.test(codeOnly('functions/admin/testimonials.js')));

// The card asks at a MOMENT, never on page load — three call sites, no boot hook.
for (const [file, moment] of [
  ['assets/js/app/portal-flightplan.js', 'flightplan_done'],
  ['assets/js/app/roadmap.js', 'roadmap_commit'],
  ['assets/js/app/month-review.js', 'month_review'],
]) {
  check(`${moment} is wired at its moment in ${file.split('/').pop()}`,
    new RegExp(`FWNps\\.maybeAsk\\('${moment}'\\)`).test(codeOnly(file)));
}
const npsClient = codeOnly('assets/js/shared/nps.js');
check('the client asks the server for permission and never decides alone',
  /\/nps\?moment=/.test(npsClient) && !/localStorage/.test(npsClient));
check('and closing an ANSWERED card sends the answer rather than a dismissal',
  /chosen === null \? \{ action: 'dismiss'/.test(npsClient) || /if \(chosen === null\) \{ submit\('dismiss'\)/.test(npsClient));

// Every page with a trigger must actually load the module, or the call is a no-op.
for (const page of ['portal.html', 'flightplan.html', 'roadmap.html', 'review.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  check(`${page} loads nps.js and nps.css`,
    /assets\/js\/shared\/nps\.js\?v=/.test(html) && /assets\/css\/nps\.css\?v=/.test(html));
}
for (const page of ['index.html', 'pricing.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  check(`${page} carries the quote slot and loads quotes.js`,
    /data-fw-quotes="/.test(html) && /assets\/js\/shared\/quotes\.js\?v=/.test(html));
  check(`${page}'s quote section starts hidden (no placeholder proof ever renders)`,
    /id="quotes"[^>]*\bhidden\b/.test(html));
}

// ---------------------------------------------------------------------------
section('the business surface');

const cfg = codeOnly('functions/config.js');
check('both product proposals are served as flags',
  /semesterPassEnabled/.test(cfg) && /giftEnabled/.test(cfg));
const pricing = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');
check('and both cards ship hidden',
  /id="proposal-semester"[^>]*\bhidden\b/.test(pricing) && /id="proposal-gift"[^>]*\bhidden\b/.test(pricing));
// The whole point of Jacob-gating: a proposal must never reach checkout.
check('a proposal CTA can never reach Stripe checkout',
  /fw-proposal-cta/.test(pricing)
  && /var BUYABLE = \{ monthly: 1, annual: 1, lifetime: 1, sprint: 1 \}/.test(pricing));
check('and the checkout resume path reads BUYABLE, not the label map',
  /BUYABLE\[resumeTier\]/.test(pricing));

const waitlist = codeOnly('functions/waitlist-intent.js');
check('waitlist tiers are kept apart from pricing tiers',
  /WAITLIST_TIERS = \['community'\]/.test(waitlist));
check('and only a waitlist tier has a public count',
  /WAITLIST_TIERS\.includes\(tier\)/.test(waitlist));

for (const page of ['career-centers.html', 'community.html']) {
  check(`${page} exists`, fs.existsSync(path.join(ROOT, page)));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`test:nps FAILED (${failures})`); process.exit(1); }
console.log('test:nps OK');
