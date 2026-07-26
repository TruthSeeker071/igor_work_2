/**
 * FlightWay V2 S9 — Deadline Radar core (D12).
 *
 * Pure functions only (no D1/KV/fetch) so scripts/test-deadlines.mjs can execute
 * every invariant directly. D1 wiring lives in deadline-store.js, the grounded
 * pipeline in deadline-refresh.js, the HTTP surface in functions/deadlines.js.
 *
 * Invariants enforced HERE, not in the prompt (the opportunity-core discipline,
 * for the same reason: a model asked nicely still invents dates):
 *  - a GROUNDED deadline ships only with the exact https URL of one of the
 *    research sources — a date the student cannot go and check is worse than no
 *    date, because acting on a wrong one costs them the actual opportunity;
 *  - due dates are `YYYY-MM-DD`, parseable, in the future, and inside a sane
 *    horizon — a model that reads "November 1" off a 2019 page and stamps this
 *    year onto it is the single most likely failure, so the window is checked
 *    rather than trusted;
 *  - `kind` comes from a closed set; anything else is dropped, not coerced to a
 *    catch-all, so a hallucinated category never becomes a chip in the UI;
 *  - every date comparison is UTC-anchored. A deadline is a calendar day, so
 *    `daysUntil` must not change answer with the reader's timezone.
 */

export const DEADLINE_KINDS = [
  'internship', 'fellowship', 'competition', 'club', 'application-window',
];
const KIND_SET = new Set(DEADLINE_KINDS);
// Synonyms a model reaches for. Deliberately small: an unmapped value is
// dropped, never silently filed under application-window.
const KIND_ALIASES = {
  internships: 'internship',
  intern: 'internship',
  job: 'internship',
  fellowships: 'fellowship',
  fellow: 'fellowship',
  scholarship: 'fellowship',
  grant: 'fellowship',
  competitions: 'competition',
  contest: 'competition',
  hackathon: 'competition',
  clubs: 'club',
  // normalizeKind collapses whitespace AND underscores to hyphens before it
  // looks in here, so an alias key must already be in that shape.
  'student-org': 'club',
  'student-organization': 'club',
  organization: 'club',
  application: 'application-window',
  applicationwindow: 'application-window',
  program: 'application-window',
  admissions: 'application-window',
};

export const MAX_DEADLINES = 10;      // per grounded refresh
export const MAX_USER_ROWS = 100;     // hard ceiling on one account's radar
export const MAX_HORIZON_DAYS = 540;  // ~18 months — past this it is a bad year
export const MERGE_WINDOW_DAYS = 31;  // near-window dedupe (see the migration)
export const DAY_MS = 86400000;

export const DEADLINE_STATUSES = ['tracked', 'dismissed', 'done'];
const STATUS_SET = new Set(DEADLINE_STATUSES);

function cleanText(v, cap) {
  return String(v == null ? '' : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

/** UTC day string for an epoch-ms instant. */
export function utcDate(nowMs) {
  return new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by whole days, UTC. */
export function shiftDate(iso, days) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole days from now until a `YYYY-MM-DD`, UTC-anchored on BOTH sides so the
 * answer is a property of the calendar rather than of the caller's clock time.
 * Returns null for an unparseable date. Negative once the day has passed.
 */
export function daysUntil(iso, nowMs) {
  const t = Date.parse(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.parse(`${utcDate(nowMs)}T00:00:00Z`);
  return Math.round((t - today) / DAY_MS);
}

/** `2026-11-03` shape AND a real calendar date (rejects 2026-02-31). */
export function isIsoDate(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

export function normalizeKind(v) {
  const raw = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (KIND_SET.has(raw)) return raw;
  const flat = raw.replace(/-/g, '');
  return KIND_ALIASES[raw] || KIND_ALIASES[flat] || '';
}

export function normalizeStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return STATUS_SET.has(s) ? s : '';
}

/**
 * The comparison key two wordings of the same program must share.
 * Deliberately conservative — it lowercases, drops punctuation and a handful of
 * words that carry no identity ("program", "application", "deadline", a bare
 * year) and nothing else. Over-normalizing here would merge two genuinely
 * different programs into one row, which is a worse failure than a duplicate:
 * the student then never sees one of them at all.
 */
const NOISE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'at',
  'program', 'programme', 'application', 'applications', 'apply', 'deadline',
  'deadlines', 'summer', 'fall', 'spring', 'winter', 'early', 'regular',
]);
export function normalizeTitleKey(title) {
  const words = String(title == null ? '' : title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !NOISE_WORDS.has(w) && !/^(19|20)\d{2}$/.test(w));
  // Everything was noise (e.g. "Summer Program 2027") — fall back to the raw
  // squashed string so the key is still stable rather than empty for everyone.
  const key = words.join('-') || String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return key.slice(0, 80);
}

/** `title_key|YYYY-MM` — the UNIQUE-index backstop (see the migration header). */
export function dedupeKeyFor(titleKey, dueDate) {
  return `${titleKey}|${String(dueDate || '').slice(0, 7)}`;
}

/** Stable id from user + dedupe key (djb2, base36) — same recipe as opportunityId. */
export function deadlineId(userId, dedupeKey) {
  const s = `${String(userId || '').toLowerCase()}|${dedupeKey}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `dl-${h.toString(36)}`;
}

/**
 * Comparison key that absorbs the drift a model introduces when copying a URL
 * (case, www., trailing slash, fragment) but nothing that changes which page it
 * points at. Copied in spirit from opportunity-core.urlMatchKey — same job,
 * same rules, kept local so neither file can be "simplified" into breaking the
 * other's guarantee.
 */
function urlMatchKey(url) {
  try {
    const u = new URL(String(url == null ? '' : url).trim());
    if (u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '')
      + u.pathname.replace(/\/+$/, '')
      + u.search;
  } catch (_) {
    return '';
  }
}

/** An https URL the student typed by hand. Empty string when it is not usable. */
export function sanitizeManualUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.href.slice(0, 300) : '';
  } catch (_) {
    return '';
  }
}

/**
 * The academic cycle label used in research queries, e.g. `2026-27`. Derived
 * from the date alone — no user identity — so the shared cross-user research
 * cache (`gw:q2:`) is hit by every student asking about the same career in the
 * same cycle. Cycles roll in July, when the next year's internship listings go up.
 */
export function cycleLabel(nowMs) {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Three career-and-school-only research queries. NO user identity: the query
 * text is the cache key for researchWeb's global brief cache, so anything
 * personal in here would both leak across the cache and destroy its hit rate.
 * School is a shared attribute and is included deliberately (§3.6 — a grounded
 * prompt must STATE the school; the finder does the same).
 */
export function buildDeadlineQueries({ careerName, school, now } = {}) {
  const career = cleanText(careerName, 120) || 'this career';
  const cycle = cycleLabel(now);
  const cleanSchool = cleanText(school, 120);
  return [
    `${career} internship and entry program application deadlines for undergraduate students ${cycle}`,
    `fellowships, scholarships and student competitions for people pursuing ${career}, with application deadlines ${cycle}`,
    cleanSchool
      ? `${cleanSchool} recruiting timeline and application deadlines for students pursuing ${career} ${cycle}`
      : `university career center recruiting timeline and application deadlines for students pursuing ${career} ${cycle}`,
  ];
}

/**
 * Extraction prompt. Evidence first (already fenced by buildEvidenceBlock),
 * then the labelled student context, then the task. No persona block: this call
 * produces no user-visible prose at all — only titles, orgs, dates and URLs
 * copied out of the evidence — so the house voice would be tokens spent on
 * nothing. `today` is stated so the model can reject stale listings itself
 * rather than leaving every year check to sanitizeDeadlines.
 */
export function buildDeadlinePrompt({ evidence, careerName, school, year, today } = {}) {
  const career = cleanText(careerName, 120);
  const cleanSchool = cleanText(school, 120);
  const cleanYear = cleanText(year, 40);
  return [
    evidence || '',
    '',
    `TODAY'S DATE: ${today}`,
    `TARGET CAREER: ${career}`,
    cleanSchool ? `STUDENT'S SCHOOL: ${cleanSchool}` : 'STUDENT\'S SCHOOL: not stated',
    cleanYear ? `STUDENT'S YEAR IN SCHOOL: ${cleanYear}` : '',
    '',
    'TASK: From the WEB EVIDENCE above, extract every real application deadline that is',
    'genuinely useful to this student — internships, fellowships, competitions, student',
    'clubs with intake windows, and general application windows.',
    'Return JSON: {"deadlines":[{"kind":"internship|fellowship|competition|club|application-window",',
    '"title":"...","org":"...","dueDate":"YYYY-MM-DD","url":"https://..."}]}',
    'Rules:',
    '- dueDate: ONLY a date the evidence states explicitly, formatted YYYY-MM-DD. Never',
    '  estimate, never carry a date forward from a past cycle, never output a range.',
    `  It must be after ${today}. If the evidence gives a month with no day, leave the item out.`,
    '- url: copy, character for character, the URL of the numbered [n] source line in WEB',
    '  EVIDENCE that states THIS deadline. Never shorten, edit or invent a URL, and never',
    '  reuse a URL that belongs to a different item. If no source line states the deadline,',
    '  leave the item out entirely — a date the student cannot verify is worse than none.',
    cleanSchool
      ? `- Only list things this student can actually apply to: programs open to any student, or ones at ${cleanSchool}. Never list another university's internal club or fund.`
      : '- Only list things open to any student: national or online programs, not one university\'s internal club or fund.',
    '- title: the name of the program or opportunity, not a sentence.',
    '- org: the organisation running it, or "" if the evidence does not name one.',
    '- Return at most 10 items. Fewer real ones beats more invented ones.',
  ].filter((l) => l !== '').join('\n');
}

/**
 * Validate model output against the real research sources and the calendar.
 * Drops: unknown kind, empty title, non-https/non-source URL, unparseable or
 * past or beyond-horizon dueDate, in-batch duplicates. Coerces the shipped URL
 * to the source's OWN string, so what we store is a URL that was actually
 * fetched rather than the model's transcription of it.
 *
 * @returns Array<{kind,title,org,dueDate,url,titleKey,dedupeKey}>
 */
export function sanitizeDeadlines(raw, { sources, now } = {}) {
  const byUrl = new Map();
  const byHost = new Map();
  for (const s of sources || []) {
    const key = urlMatchKey(s && s.url);
    if (!key) continue;
    if (!byUrl.has(key)) byUrl.set(key, s.url);
    const host = key.split('/')[0];
    byHost.set(host, byHost.has(host) ? null : s.url); // null = ambiguous host
  }

  const today = utcDate(now);
  const horizon = shiftDate(today, MAX_HORIZON_DAYS);
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const kind = normalizeKind(item.kind);
    if (!kind) continue;
    const title = cleanText(item.title, 120);
    if (!title) continue;
    const dueDate = String(item.dueDate || item.due_date || '').trim().slice(0, 10);
    if (!isIsoDate(dueDate)) continue;
    // Strictly after today: a deadline that closes today is still actionable,
    // so `>=` — but nothing already in the past, and nothing past the horizon.
    if (dueDate < today || dueDate > horizon) continue;
    const key = urlMatchKey(item.url);
    if (!key) continue;
    const url = byUrl.get(key) || byHost.get(key.split('/')[0]) || '';
    if (!url) continue;

    const titleKey = normalizeTitleKey(title);
    if (!titleKey) continue;
    const dedupeKey = dedupeKeyFor(titleKey, dueDate);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({ kind, title, org: cleanText(item.org, 80), dueDate, url, titleKey, dedupeKey });
    if (out.length >= MAX_DEADLINES) break;
  }
  return out;
}

/**
 * Validate one manually-added deadline. Manual rows are the ONE case where an
 * empty URL is allowed — the student is the source, so there is nothing to
 * verify against and demanding a link would just stop them recording a date
 * they already know.
 *
 * @returns {{ok:true, value:{...}} | {ok:false, error:string}}
 */
export function sanitizeManualDeadline(body, { now } = {}) {
  const title = cleanText(body && body.title, 120);
  if (!title) return { ok: false, error: 'A title is required.' };
  const dueDate = String((body && (body.dueDate || body.due_date)) || '').trim().slice(0, 10);
  if (!isIsoDate(dueDate)) return { ok: false, error: 'Pick a date (YYYY-MM-DD).' };
  const today = utcDate(now);
  if (dueDate < today) return { ok: false, error: 'That date has already passed.' };
  if (dueDate > shiftDate(today, MAX_HORIZON_DAYS)) return { ok: false, error: 'That date is too far out to track.' };
  const kind = normalizeKind(body && body.kind) || 'application-window';
  const titleKey = normalizeTitleKey(title);
  if (!titleKey) return { ok: false, error: 'A title is required.' };
  return {
    ok: true,
    value: {
      kind,
      title,
      org: cleanText(body && body.org, 80),
      dueDate,
      url: sanitizeManualUrl(body && body.url),
      titleKey,
      dedupeKey: dedupeKeyFor(titleKey, dueDate),
    },
  };
}

/** The client-facing shape of one stored row. `daysOut` is always recomputed. */
export function toClientDeadline(row, now) {
  return {
    id: row.id,
    title: row.title,
    org: row.org || '',
    kind: row.kind,
    deadline: row.due_date,
    url: row.url || '',
    source: row.source,
    status: row.status,
    daysOut: daysUntil(row.due_date, now),
  };
}

/** "closes today" / "closes tomorrow" / "closes in N days" — shared by UI and email. */
export function closesPhrase(daysOut) {
  if (daysOut === 0) return 'closes today';
  if (daysOut === 1) return 'closes tomorrow';
  if (daysOut < 0) return 'closed';
  return `closes in ${daysOut} days`;
}

/**
 * The two cron alert tiers, as day RANGES rather than exact days.
 *
 * The plan names "T-14 and T-3". An exact-day trigger would have been wrong in
 * practice: the radar refreshes weekly, so most deadlines are DISCOVERED
 * somewhere in the middle of their window and would have sailed past the one
 * day the query looked at without ever generating an alert. Ranges also make a
 * failed send retryable — the marker is written only on success, and the row is
 * still selectable tomorrow.
 *
 * The two ranges are disjoint and together cover 1..14 days out, so no tracked
 * deadline inside a fortnight can be silently skipped.
 */
export const ALERT_TIERS = [
  { tier: 't3', column: 'alerted_t3', minDays: 1, maxDays: 7, label: 'closing soon' },
  { tier: 't14', column: 'alerted_t14', minDays: 8, maxDays: 14, label: 'two weeks out' },
];
