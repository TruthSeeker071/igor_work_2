// FlightWay V2 S17 — Network mapper (plan §5 S17, D13).
//
//   GET  /outreach                                → list + archetype suggestions + cap
//   POST /outreach {action:'add', archetype}      → keep one suggested archetype
//   POST /outreach {action:'add', label, …}       → add someone they found themselves
//   POST /outreach {action:'draft', id}           → write the message (METERED, §4)
//   POST /outreach {action:'status', id, status}  → sent / replied / met
//   POST /outreach {action:'update', id, …}       → name / org / notes / channel
//   POST /outreach {action:'delete', id}
//
// **The route is `/outreach`, and the surface is called the Network mapper.** That
// is the S11/S12 rule applied on purpose: a Pages Function shadows a static asset
// at the same path, so a Function at `/network` would make a future
// `network.html` answer JSON instead of existing. The PAGE name stays free; the
// ENDPOINT is named after the action, which is also the vocabulary the events use
// (`outreach_draft`/`sent`/`replied`).
//
// **FlightWay never sends anything.** There is no send path in this file and no
// mail provider imported. `status` is the student's own report of what they did
// from their own account, which is why 'sent' is a value they set and never one
// this server infers — and why the panel says so in a sentence.
//
// Read-only over the vector chain: the draft READS the roadmap's skill gaps, the
// resume and the artifacts table to build the citable corpus, and writes only to
// `contacts`. Nothing here touches objectiveVector, objectiveAiPatch or the
// gap-progress-sync chain, so no re-sync is owed.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { resolveSchool } from './_lib/school.js';
import { resolveEntitlement } from './_lib/entitlements.js';
import { checkFeatureLimit, refundFeatureUse } from './_lib/plan-limits.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import { logServerError, logServerEvent } from './_lib/events.js';
import { loadDossierWithCoordinates } from './_lib/dossier-coordinates.js';
import { resolveCareer } from './_lib/deadline-refresh.js';
import { buildEvidenceCorpus } from './_lib/scorecard-core.js';
import { utcDate } from './_lib/deadline-core.js';
import {
  CONTACT_STATUSES, MAX_CONTACTS_PER_USER, NAME_CAP, ORG_CAP, NOTES_CAP, LABEL_CAP,
  buildSuggestions, suggestionForKey, openNetworkSteps, buildOutreachPrompt,
  sanitizeOutreachDraft, normalizeStatus, normalizeChannel, cleanText, publicContact,
  REFUNDABLE_DRAFT_REASONS,
} from './_lib/contact-core.js';
import {
  contactsTableReady, listContacts, getContact, insertContact,
  saveDraft, setStatus, updateContact, deleteContact,
} from './_lib/contact-store.js';

const RATE_LIMIT_MAX = 60;
const FEATURE = 'outreach-draft';
const DRAFT_TIMEOUT_MS = 20000;
const MAX_GAPS = 6;
const MAX_ARTIFACTS = 12;

/**
 * The one sentence each degraded state says out loud. A student who presses a
 * button and sees nothing assumes it is broken; every one of these is a real
 * state of the product, and naming it is the difference between "not switched on
 * yet" and "this feature is broken".
 */
const REASON_COPY = {
  'not-ready': 'The network mapper is not switched on yet.',
  'no-career': 'Pick a target career first — the people worth contacting depend on where you are headed.',
  'no-record': 'Add your resume or log some evidence first. A message with nothing real in it is the one thing outreach cannot be.',
  'list-full': `Your list is at its limit of ${MAX_CONTACTS_PER_USER}. Close out a few before adding more.`,
  'not-found': 'That person is not on your list.',
  'shape-failed': 'Could not write that draft just now. Try again — this one did not use your allowance.',
  template: 'The draft came back reading like a template, so it was thrown away rather than shown to you. Try again — this one did not use your allowance.',
  'no-ask': 'The draft came back without a question in it, which gets no reply. Try again — this one did not use your allowance.',
  generic: 'The draft came back without anything specific to you in it. Try again — this one did not use your allowance.',
  'too-long': 'The draft came back too long to get read. Try again — this one did not use your allowance.',
  'too-short': 'The draft came back too thin to be worth sending. Try again — this one did not use your allowance.',
  'no-subject': 'The draft came back without a subject line. Try again — this one did not use your allowance.',
  'save-failed': 'Could not save that draft. Try again — this one did not use your allowance.',
};

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await resolveEntitlement(env, email);
  return { origin, email, env, request, plan: ent.effective };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `outreach:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** The cap as the panel renders it. Peeks — never spends. */
async function capState(env, email, plan) {
  const cap = await checkFeatureLimit(env, email, FEATURE, { spend: false, plan });
  return {
    ok: !!cap.ok,
    limit: cap.limit === undefined ? null : cap.limit,
    remaining: cap.unlimited ? null : cap.remaining,
    resetPeriod: cap.resetPeriod || null,
    upgrade: !!cap.upgrade,
    message: cap.message || '',
  };
}

/**
 * The context the archetype generator needs: target career, school, top gaps and
 * the open network steps. One roadmap read serves all four.
 */
async function suggestionContext(env, email) {
  const [quiz, roadmap] = await Promise.all([
    loadUserBlob(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const career = resolveCareer(quiz, roadmap);
  const school = await resolveSchool(env, email, { quiz }).catch(() => '');
  const gaps = ((roadmap && roadmap.focusTracker && roadmap.focusTracker.skillGaps) || [])
    .filter((g) => g && g.label)
    .slice(0, MAX_GAPS);
  return {
    careerName: career.name,
    careerSlug: career.slug,
    school,
    gaps,
    steps: openNetworkSteps(roadmap),
    roadmap,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  try {
    const ready = await contactsTableReady(env);
    const [rows, ctx, cap] = await Promise.all([
      ready ? listContacts(env, email) : [],
      suggestionContext(env, email),
      capState(env, email, plan),
    ]);
    const contacts = rows.map(publicContact);
    // An archetype already on the list is not offered again. A MANUAL row carries
    // no archetype and therefore suppresses nothing — we have no idea who it was.
    const taken = new Set(contacts.map((c) => c.archetype).filter(Boolean));
    return jsonResponse(200, {
      ready,
      contacts,
      suggestions: buildSuggestions({ ...ctx, existing: taken }),
      networkSteps: ctx.steps,
      careerName: ctx.careerName,
      statuses: CONTACT_STATUSES,
      cap,
      full: contacts.length >= MAX_CONTACTS_PER_USER,
      reason: ready ? '' : 'not-ready',
      message: ready ? '' : REASON_COPY['not-ready'],
    }, origin);
  } catch (err) {
    await logServerError(env, 'outreach', err);
    console.warn('outreach GET failed', err && err.message ? err.message : err);
    return jsonResponse(200, {
      ready: false, contacts: [], suggestions: [], networkSteps: [], careerName: '',
      statuses: CONTACT_STATUSES,
      cap: { ok: false, limit: null, remaining: 0, resetPeriod: null, upgrade: false, message: '' },
      full: false, reason: 'error', message: 'Could not load your network list just now.',
    }, origin);
  }
}

/**
 * Keep one archetype, or add someone the student found themselves.
 *
 * For an archetype the row is built SERVER-SIDE from the key — `suggestionForKey`
 * re-derives the label from this account's own career/school/gaps. The client
 * sends a key and the server decides what that key means, so no shape of request
 * can put arbitrary text on the list under the appearance of a suggestion we made.
 *
 * A MANUAL row is the opposite case and is treated as such: it is the student's
 * own text, so it is sanitized as untrusted and stored with no archetype.
 */
async function handleAdd(env, email, raw, origin) {
  const ctx = await suggestionContext(env, email);
  const archetype = cleanText(raw && raw.archetype, 40).toLowerCase();

  let row;
  if (archetype) {
    const s = suggestionForKey(archetype, ctx);
    if (!s) {
      return jsonResponse(200, {
        ok: false, reason: 'stale-suggestion',
        error: 'That suggestion no longer applies to your profile. Reload to see the current list.',
      }, origin);
    }
    row = {
      archetype: s.archetype,
      label: s.label,
      orgType: s.orgType,
      howToFind: s.howToFind,
      stepId: s.stepId,
      careerSlug: ctx.careerSlug,
      channel: 'email',
      name: cleanText(raw && raw.name, NAME_CAP),
      org: cleanText(raw && raw.org, ORG_CAP),
    };
  } else {
    const label = cleanText(raw && raw.label, LABEL_CAP);
    const name = cleanText(raw && raw.name, NAME_CAP);
    if (!label && !name) return jsonResponse(400, { error: 'Say who this is.' }, origin);
    row = {
      archetype: '',
      label: label || name,
      orgType: '',
      howToFind: '',
      stepId: (ctx.steps[0] && ctx.steps[0].stepId) || '',
      careerSlug: ctx.careerSlug,
      channel: normalizeChannel(raw && raw.channel),
      name,
      org: cleanText(raw && raw.org, ORG_CAP),
      notes: cleanText(raw && raw.notes, NOTES_CAP),
    };
  }

  const res = await insertContact(env, email, row);
  if (!res.ok) {
    return jsonResponse(200, {
      ok: false, reason: res.reason,
      error: REASON_COPY[res.reason] || 'Could not add that.',
    }, origin);
  }
  const saved = await getContact(env, email, res.id);
  return jsonResponse(200, { ok: true, contact: saved ? publicContact(saved) : null }, origin);
}

/**
 * Write one draft.
 *
 * Ordering is the safety story, exactly as it is in `scorecard.js`: the cheap
 * refusals (migration, the row exists, is there anything to be specific ABOUT)
 * come FIRST and cost nothing, the meter is spent only once the call is genuinely
 * about to happen, and every downstream failure the student did not cause hands
 * the allowance back. A free account gets two of these a month; losing one to a
 * Gemini timeout, or to a draft the contract threw away, would be indefensible.
 */
async function handleDraft(env, email, plan, raw, origin) {
  if (!(await contactsTableReady(env))) {
    return jsonResponse(200, { ok: false, reason: 'not-ready', message: REASON_COPY['not-ready'] }, origin);
  }
  const id = cleanText(raw && raw.id, 64);
  const contact = id ? await getContact(env, email, id) : null;
  if (!contact) {
    return jsonResponse(404, { ok: false, reason: 'not-found', error: REASON_COPY['not-found'] }, origin);
  }

  const ctx = await suggestionContext(env, email);
  if (!ctx.careerName) {
    return jsonResponse(200, { ok: false, reason: 'no-career', message: REASON_COPY['no-career'] }, origin);
  }
  const [resume, artifacts, dossier] = await Promise.all([
    loadLatestResume(env, email),
    loadArtifacts(env, email),
    loadDossierWithCoordinates(env, email).catch(() => ''),
  ]);
  const corpus = buildEvidenceCorpus({ resume, gaps: ctx.gaps, artifacts });
  // Nothing on record means every sentence about the student would have to be
  // invented, and the contract below would reject the result anyway. Refuse
  // BEFORE spending, and say which thing to go and fill in.
  if (!corpus.entries.length) {
    return jsonResponse(200, { ok: false, reason: 'no-record', message: REASON_COPY['no-record'] }, origin);
  }

  const cap = await checkFeatureLimit(env, email, FEATURE, { plan });
  if (!cap.ok) {
    return jsonResponse(200, {
      ok: false,
      reason: 'capped',
      message: cap.message,
      cap: { message: cap.message, upgrade: !!cap.upgrade, resetPeriod: cap.resetPeriod, limit: cap.limit },
    }, origin);
  }

  const refundAnd = async (reason, words) => {
    await refundFeatureUse(env, email, FEATURE, { plan });
    return jsonResponse(200, {
      ok: false, reason, refunded: true, words: words || 0,
      message: REASON_COPY[reason] || 'Could not write that draft just now.',
    }, origin);
  };

  let shaped;
  try {
    shaped = await callGeminiJson(env, {
      prompt: buildOutreachPrompt({
        contact: publicContact(contact),
        careerName: ctx.careerName,
        school: ctx.school,
        corpus,
        dossier,
        today: utcDate(Date.now()),
      }),
      temperature: 0.5,
      maxTokens: 900,
      jsonMode: true,
      label: 'outreach',
      softFail: true,
      timeoutMs: DRAFT_TIMEOUT_MS,
    });
  } catch (err) {
    await logServerError(env, 'outreach', err);
    return refundAnd('shape-failed');
  }

  const draft = sanitizeOutreachDraft(shaped, {
    corpus,
    name: contact.name,
    channel: contact.channel,
  });
  // Every reason the contract can produce is one the student did not cause, so
  // every one of them refunds. `REFUNDABLE_DRAFT_REASONS` is the assertion that
  // this stays true if a reason is ever added.
  if (!draft.ok) {
    return refundAnd(REFUNDABLE_DRAFT_REASONS.has(draft.reason) ? draft.reason : 'shape-failed', draft.words);
  }

  const stored = await saveDraft(env, email, contact.id, { subject: draft.subject, body: draft.body });
  if (!stored) return refundAnd('save-failed');

  await logServerEvent(env, 'outreach_draft', {
    userId: email,
    props: {
      archetype: contact.archetype || 'manual',
      channel: contact.channel,
      words: draft.words,
      cited: draft.usedIds.length,
      repairs: draft.repairs.length,
      named: contact.name ? 1 : 0,
    },
  });

  const saved = await getContact(env, email, contact.id);
  return jsonResponse(200, {
    ok: true,
    contact: saved ? publicContact(saved) : null,
    words: draft.words,
    repairs: draft.repairs,
    remaining: cap.unlimited ? null : Math.max(0, Number(cap.remaining) || 0),
  }, origin);
}

/** Latest saved resume for one account, or null. Read-only. */
async function loadLatestResume(env, email) {
  if (!env || !env.DB || !email) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT json FROM resumes WHERE email = ? ORDER BY updated_at DESC LIMIT 1',
    ).bind(email).first();
    if (!row) return null;
    return JSON.parse(row.json);
  } catch (_) {
    return null;
  }
}

/** Filed evidence for one account. Read-only over artifacts — never a writer. */
async function loadArtifacts(env, email) {
  if (!env || !env.DB || !email) return [];
  try {
    const r = await env.DB.prepare(
      'SELECT title, note FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT ?',
    ).bind(email, MAX_ARTIFACTS).all();
    return r.results || [];
  } catch (_) {
    return [];
  }
}

/**
 * The student's own report of what happened.
 *
 * Any valid status is accepted, including a no-op and a walk-back — the same call
 * S12's application ladder made, for the same reason: a student who marked
 * something sent by mistake needs a way back, and refusing a backwards move
 * teaches them to lie to the tracker instead.
 *
 * Events: the plan names three (`outreach_draft`/`sent`/`replied`). 'met' is a
 * stronger outcome than 'replied' rather than a different funnel, so it rides
 * `outreach_replied` with a `status` prop instead of inventing a fourth name that
 * would split the one conversion this feature is measured on.
 */
async function handleStatus(env, email, raw, origin) {
  const id = cleanText(raw && raw.id, 64);
  const status = normalizeStatus(raw && raw.status);
  if (!id) return jsonResponse(400, { error: 'Missing id.' }, origin);
  if (!status) return jsonResponse(400, { error: 'Unknown status.' }, origin);

  const before = await getContact(env, email, id);
  if (!before) return jsonResponse(404, { error: REASON_COPY['not-found'] }, origin);
  const res = await setStatus(env, email, id, status);
  if (!res.ok) return jsonResponse(404, { error: REASON_COPY['not-found'] }, origin);

  const saved = await getContact(env, email, id);
  return jsonResponse(200, {
    ok: true,
    contact: saved ? publicContact(saved) : null,
    from: String(before.status || ''),
    to: status,
  }, origin);
}

async function handleUpdate(env, email, raw, origin) {
  const id = cleanText(raw && raw.id, 64);
  if (!id) return jsonResponse(400, { error: 'Missing id.' }, origin);
  const patch = {};
  if (raw && raw.name !== undefined) patch.name = cleanText(raw.name, NAME_CAP);
  if (raw && raw.org !== undefined) patch.org = cleanText(raw.org, ORG_CAP);
  if (raw && raw.notes !== undefined) patch.notes = cleanText(raw.notes, NOTES_CAP);
  if (raw && raw.channel !== undefined) patch.channel = normalizeChannel(raw.channel);
  if (!Object.keys(patch).length) return jsonResponse(400, { error: 'Nothing to update.' }, origin);

  const ok = await updateContact(env, email, id, patch);
  if (!ok) return jsonResponse(404, { error: REASON_COPY['not-found'] }, origin);
  const saved = await getContact(env, email, id);
  return jsonResponse(200, { ok: true, contact: saved ? publicContact(saved) : null }, origin);
}

async function handleDelete(env, email, raw, origin) {
  const id = cleanText(raw && raw.id, 64);
  if (!id) return jsonResponse(400, { error: 'Missing id.' }, origin);
  const ok = await deleteContact(env, email, id);
  if (!ok) return jsonResponse(404, { error: REASON_COPY['not-found'] }, origin);
  return jsonResponse(200, { ok: true, id }, origin);
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  // Every write needs the table. Checked once here rather than in five handlers,
  // and answered with a sentence rather than a 500 — "not switched on yet" and
  // "your save failed" look identical from outside and only one is actionable.
  if (action !== 'draft' && !(await contactsTableReady(env))) {
    return jsonResponse(200, { ok: false, reason: 'not-ready', message: REASON_COPY['not-ready'] }, origin);
  }

  try {
    if (action === 'add') return await handleAdd(env, email, body, origin);
    if (action === 'draft') return await handleDraft(env, email, plan, body, origin);
    if (action === 'status') return await handleStatus(env, email, body, origin);
    if (action === 'update') return await handleUpdate(env, email, body, origin);
    if (action === 'delete') return await handleDelete(env, email, body, origin);
  } catch (err) {
    await logServerError(env, 'outreach', err);
    console.warn('outreach POST failed', action, err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not save that just now.' }, origin);
  }
  return jsonResponse(400, { error: 'Unknown outreach action.' }, origin);
}

export { REASON_COPY };
