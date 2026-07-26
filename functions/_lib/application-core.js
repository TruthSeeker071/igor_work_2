// FlightWay V2 S12 — Application Tracker, pure core (plan §5 S12).
//
// Everything here is a pure function of its arguments: no D1, no KV, no fetch, so
// the gate drives it directly rather than through a handler. The store
// (`application-store.js`) owns every read and write; the endpoint
// (`functions/applications.js`) owns auth and rate limiting.
//
// Two rules this file exists to hold in ONE place:
//   1. The status ladder is ordered. "Advanced" means the index went UP, and the
//      digest/review both count moves off that definition rather than each
//      inventing one.
//   2. A saved opportunity is identified by a stable hash of its URL, so pressing
//      Save twice on the same Opportunity Finder result cannot make two rows.

/** The pipeline, in order. Index is meaningful — see `isAdvance`. */
export const APPLICATION_STATUSES = ['interested', 'applied', 'interviewing', 'offer', 'closed'];

/** Column headings on the board and chip text on a card. */
export const STATUS_LABELS = {
  interested: 'Interested',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};

/**
 * One line per column, shown when the column is empty. These are the only place
 * the board explains itself, so they say what belongs there rather than
 * congratulating the student for an empty column.
 */
export const STATUS_HINTS = {
  interested: 'Saved from the Opportunity Finder, or added by hand.',
  applied: 'Submitted. Move it here the day you send it.',
  interviewing: 'They came back. Practise before the call.',
  offer: 'An offer is on the table.',
  closed: 'Withdrawn, rejected or done with.',
};

/** `closed` is terminal for counting purposes; `offer` is not — it can still close. */
export const TERMINAL_STATUSES = ['closed'];

export const APPLICATION_SOURCES = ['finder', 'manual'];

export const MAX_APPLICATIONS = 200;
export const MAX_ROLE = 140;
export const MAX_COMPANY = 120;
export const MAX_NOTES = 600;
export const MAX_URL = 400;

/**
 * Control characters and angle brackets out, whitespace collapsed. Same shape as
 * `cleanText` in deadline-core.js, and for the same reason: a role title can
 * arrive straight off a grounded search result via the Finder Save button.
 */
function clean(v, n) {
  return String(v == null ? '' : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

/** djb2 — same one `resume-tailor.js` uses. Short, stable, and never a secret. */
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function normalizeStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return APPLICATION_STATUSES.includes(s) ? s : '';
}

export function normalizeSource(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return APPLICATION_SOURCES.includes(s) ? s : 'manual';
}

/**
 * https only, and never a `javascript:`/`data:` payload dressed as one. Mirrors
 * `sanitizeManualUrl` in deadline-core.js: these strings come off arbitrary web
 * pages via the Opportunity Finder, so they are as untrusted as a deadline URL.
 */
export function sanitizeUrl(raw) {
  const url = clean(raw, MAX_URL);
  if (!url) return '';
  if (!/^https:\/\/[^\s]+$/i.test(url)) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return '';
    return u.toString().slice(0, MAX_URL);
  } catch (_) {
    return '';
  }
}

/**
 * The dedupe identity of a saved opportunity. Built from the URL when there is
 * one (the only genuinely stable thing a grounded result carries) and otherwise
 * from role+company, so a finder result with no link still cannot double-save.
 * Returns '' for manual entries — a student typing the same role twice is
 * allowed to, because they may well be applying to two of them.
 */
export function opportunityRefFor({ source, url, role, company } = {}) {
  if (normalizeSource(source) !== 'finder') return '';
  const key = sanitizeUrl(url) || `${clean(role, MAX_ROLE)}|${clean(company, MAX_COMPANY)}`.toLowerCase();
  if (!key.trim() || key.trim() === '|') return '';
  return 'op_' + djb2(key);
}

/** Did the pipeline move forward? Unknown statuses are never an advance. */
export function isAdvance(from, to) {
  const a = APPLICATION_STATUSES.indexOf(normalizeStatus(from));
  const b = APPLICATION_STATUSES.indexOf(normalizeStatus(to));
  if (a < 0 || b < 0) return false;
  return b > a;
}

/**
 * Validate a create. Role is the only required field: a student who saw
 * something worth chasing should be able to record it before they know the
 * company's legal name.
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function sanitizeApplication(body = {}) {
  const role = clean(body.role || body.title, MAX_ROLE);
  if (role.length < 2) return { ok: false, error: 'Give the role a name.' };
  const source = normalizeSource(body.source);
  const status = normalizeStatus(body.status) || 'interested';
  const url = sanitizeUrl(body.url);
  const value = {
    source,
    role,
    company: clean(body.company || body.org, MAX_COMPANY),
    careerSlug: clean(body.careerSlug || body.career_slug, 80),
    status,
    url,
    notes: clean(body.notes, MAX_NOTES),
    deadlineId: clean(body.deadlineId || body.deadline_id, 64),
    opportunityRef: clean(body.opportunityRef, 80) || opportunityRefFor({ source, url, role, company: body.company || body.org }),
  };
  return { ok: true, value };
}

/**
 * Validate an edit. Only the fields actually present are returned, so a client
 * that sends `{notes}` cannot blank the role by omission — the store writes a
 * partial UPDATE from exactly this object.
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function sanitizeApplicationPatch(body = {}) {
  const value = {};
  if (body.role !== undefined) {
    const role = clean(body.role, MAX_ROLE);
    if (role.length < 2) return { ok: false, error: 'Give the role a name.' };
    value.role = role;
  }
  if (body.company !== undefined) value.company = clean(body.company, MAX_COMPANY);
  if (body.notes !== undefined) value.notes = clean(body.notes, MAX_NOTES);
  if (body.url !== undefined) {
    const url = sanitizeUrl(body.url);
    if (!url && clean(body.url, MAX_URL)) return { ok: false, error: 'Links must start with https://.' };
    value.url = url;
  }
  if (body.deadlineId !== undefined) value.deadlineId = clean(body.deadlineId, 64);
  if (!Object.keys(value).length) return { ok: false, error: 'Nothing to update.' };
  return { ok: true, value };
}

/** The client-facing shape of one stored row. */
export function toClientApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    role: row.role,
    company: row.company || '',
    careerSlug: row.career_slug || '',
    status: row.status,
    url: row.url || '',
    notes: row.notes || '',
    deadlineId: row.deadline_id || '',
    opportunityRef: row.opportunity_ref || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusAt: row.status_at || '',
  };
}

/**
 * Group rows into the board's columns, always in ladder order and always with
 * every column present — an absent column would make the board's shape depend on
 * the data, so a student with three "applied" rows would see a one-column page.
 */
export function boardBuckets(rows = []) {
  const byStatus = new Map(APPLICATION_STATUSES.map((s) => [s, []]));
  (rows || []).forEach((r) => {
    const s = normalizeStatus(r && r.status);
    if (s) byStatus.get(s).push(r);
  });
  return APPLICATION_STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    hint: STATUS_HINTS[status],
    items: byStatus.get(status),
  }));
}

/** Per-status counts plus the two totals every surface wants. */
export function applicationCounts(rows = []) {
  const counts = {};
  APPLICATION_STATUSES.forEach((s) => { counts[s] = 0; });
  (rows || []).forEach((r) => {
    const s = normalizeStatus(r && r.status);
    if (s) counts[s] += 1;
  });
  counts.total = (rows || []).length;
  counts.open = counts.total - TERMINAL_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  return counts;
}

/**
 * Rows whose STATUS moved inside [sinceIso, untilIso). Reads `status_at`, never
 * `updated_at`: a student fixing a typo in their notes has not advanced an
 * application, and a digest that says they have is a number they can catch us on.
 */
export function movedInWindow(rows = [], sinceIso = '', untilIso = '') {
  const from = String(sinceIso || '');
  const to = String(untilIso || '');
  return (rows || []).filter((r) => {
    const at = String((r && (r.status_at || r.statusAt)) || '');
    if (!at) return false;
    if (from && at < from) return false;
    if (to && at >= to) return false;
    return true;
  });
}

/** "3 applications moved stage" — the exact claim `movedInWindow` supports. */
export function movedPhrase(n) {
  if (!n) return '';
  return n === 1 ? '1 application moved stage' : `${n} applications moved stage`;
}
