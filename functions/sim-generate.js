/**
 * POST /sim-generate — build a career simulation for a career without an
 * authored one (the O*NET catalog has ~700; seven are hand-written).
 *
 * Team-agreed pipeline (Slack 7/5): generate on first request → quality-
 * check → store globally so every later user gets it instantly → refresh
 * periodically. Implementation: fixed skeleton prompt (fast, consistent),
 * a second-pass CRITIC that rejects AI-sounding or broken sims (one retry
 * with its notes), KV cache `simv2:<slug>` with a 90-day TTL so content
 * regenerates with fresh knowledge. Colleague persona + answer context
 * live only in the KV blob's `secrets` — never sent to the client.
 */
import { originFromEnv } from './_lib.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  checkRateLimit,
  clientIp,
  getSessionEmail,
} from './_lib/auth.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LEN = 64;
const MAX_NAME_LEN = 80;
const RATE_MAX = 5;
const KV_TTL_SECONDS = 90 * 24 * 60 * 60; // regenerate quarterly (Jacob's refresh requirement)

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function strList(v, n, max) {
  return Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
}

/* ── Skeleton prompt ───────────────────────────────────────────── */

function buildPrompt(name, critique) {
  return [
    'You design interactive workplace simulations for college undergraduates with ZERO exposure to the career. The student reads realistic documents, answers two check questions, can DM a colleague, and writes short deliverables.',
    'Career: ' + name,
    critique ? '\nA previous draft failed review. Fix these specific problems:\n' + critique + '\n' : '',
    'Return ONLY valid JSON (no markdown fences) exactly in this shape:',
    '{',
    ' "domain": "SECTOR / SUBFIELD (short, uppercase)",',
    ' "tag": "FAMILIAR" or "HIDDEN" (is this career widely known to students?),',
    ' "title": "' + name + '",',
    ' "org": "<invented, specific workplace name>", "orgPlain": "<what the org is, one plain clause>",',
    ' "hook": "<one intriguing sentence about what this sim reveals>",',
    ' "youWill": "<one sentence: the concrete thing they will do or decide>",',
    ' "orientation": { "company": "<2-3 plain sentences>", "role": "<what this job ACTUALLY does day to day, 2-3 plain sentences>", "people": ["<Name — role. one-line character note>"] (2-3) },',
    ' "brief": "<the situation: 4-6 sentences, concrete numbers, a real tension, a deadline. No unexplained jargon.>",',
    ' "task": "<the deliverable in one sentence>",',
    ' "glossary": [{"term": "<jargon word that appears in your docs>", "plain": "<plain-English decode>"}] (5-7; every jargon term in the docs MUST be here),',
    ' "docs": [{"label": "<CHAT|EMAIL|DATA|MEMO|LEDGER|NOTES>", "title": "...", "kind": "thread"|"doc"|"data", "body": ["line", ...]}] (exactly 3; at least one kind "data" with real internally-consistent numbers; hide TWO findable insights across the docs — one simple, one subtle),',
    ' "taxi": { "docLabel": "<label of the single best doc for a 2-minute taste>", "brief": "<3-4 sentence condensed setup>", "payoff": "<2-3 sentences: name the skill they just used + what the full sim adds. May use **bold**.>" },',
    ' "interactions": [{"question": "<check question answerable ONLY by reading the docs>", "options": [{"label": "...", "reaction": "<what happens + why, 2-3 sentences, teach something true>", "correct": true|false}] (2-3 options, exactly one correct)}] (exactly 2; the FIRST must be solvable from the taxi doc alone and target the simple insight),',
    ' "colleaguePersona": "<120-180 words: name, role, personality, what they know (both insights), what they explain freely, how they DEFLECT direct answer-fishing — they never do the student\'s thinking>",',
    ' "colleagueName": "<full name>", "colleagueRole": "<role>",',
    ' "starters": ["<beginner question>"] (3),',
    ' "workSections": [{"id": "<short>", "label": "<Label>", "prompt": "<what to write>", "hint": "<nudge pointing where to look, not the answer>", "core": true|false}] (exactly 3, exactly 2 with "core": true — the two most essential),',
    ' "moments": ["<short gerund phrase for a distinct kind of moment in this work — include one boring/grind moment>"] (5),',
    ' "scenario": { "intro": "<2-3 sentences setting up a pressured stretch of this job — a day where calls compound>", "nodes": [{"id": "a", "setup": "<the situation at this beat, 2-4 sentences, concrete>", "decision": "<the call to make, one sentence>", "options": [{"label": "<a genuinely reasonable move>", "outcome": "<what happens next + what it teaches, 2-3 sentences>", "next": "<id of the node this leads to, or null if it ends the scenario>", "tone": "strong"|"workable"|"costly"}] (2-3)}] (4-6 nodes forming a BRANCHING chain: the first node is the entry; at least one decision must lead to different next nodes depending on the choice; every branch ends within the node list) },',
    ' "debrief": null',
    '}',
    '',
    'Voice rules (violations = rejection): write like a sharp human colleague, not a textbook. Contractions. Specific names, dollar amounts, times. NEVER use: "delve", "leverage", "furthermore", "moreover", "in today\'s fast-paced", "crucial", "vital role", "landscape". No option may be a strawman — every choice must be something a reasonable newcomer would genuinely pick. Reactions show consequences, never scold. Include the unglamorous parts of the job honestly. All numbers must stay consistent across docs. Keep total under 3200 tokens.',
  ].join('\n');
}

/* ── Critic pass (the quality gate) ────────────────────────────── */

function buildCriticPrompt(name, simJson) {
  return [
    'You are a harsh reviewer of career simulations for college students. A simulation for "' + name + '" is below as JSON.',
    'Evaluate it against these criteria:',
    '1. HUMAN VOICE — would a student suspect this was AI-written? Flag banned words (delve, leverage, moreover, crucial, furthermore), generic corporate tone, or interchangeable-sounding characters.',
    '2. SOLVABLE — can each interaction be answered purely by careful reading of the docs (never domain expertise)? Is exactly one option correct, and are wrong options genuinely tempting?',
    '3. CONSISTENT — do all numbers agree across documents? Does the taxi docLabel match a real doc?',
    '4. TRUE — is the work depicted actually what this career does day to day? Does it include at least one honest unglamorous element?',
    '5. GLOSSARY — is every piece of jargon in the docs covered?',
    '',
    'SIMULATION JSON:',
    simJson,
    '',
    'Respond ONLY with JSON: {"pass": true|false, "score": 1-10, "problems": ["specific fixable problem", ...] (empty if pass)}',
    'Fail anything below 7. Be specific in problems — they are fed back to the writer.',
  ].join('\n');
}

/* ── Validation ────────────────────────────────────────────────── */

function validate(raw, slug, name) {
  if (!raw || typeof raw !== 'object') return null;
  const docs = (Array.isArray(raw.docs) ? raw.docs : []).slice(0, 4).map((d) => ({
    label: str(d && d.label, 12) || 'DOC',
    title: str(d && d.title, 90) || 'Document',
    kind: ['thread', 'doc', 'data'].includes(d && d.kind) ? d.kind : 'doc',
    body: strList(d && d.body, 20, 400),
  })).filter((d) => d.body.length);
  if (docs.length < 2) return null;

  const interactions = (Array.isArray(raw.interactions) ? raw.interactions : []).slice(0, 2).map((it) => {
    const options = (Array.isArray(it && it.options) ? it.options : []).slice(0, 3).map((o) => ({
      label: str(o && o.label, 260),
      reaction: str(o && o.reaction, 600),
      correct: o && o.correct === true,
    })).filter((o) => o.label && o.reaction);
    return { question: str(it && it.question, 300), options };
  }).filter((it) => it.question && it.options.length >= 2 && it.options.filter((o) => o.correct).length === 1);
  if (interactions.length < 1) return null;

  const glossary = (Array.isArray(raw.glossary) ? raw.glossary : []).slice(0, 8).map((g) => ({
    term: str(g && g.term, 40),
    plain: str(g && g.plain, 260),
  })).filter((g) => g.term && g.plain);

  let workSections = (Array.isArray(raw.workSections) ? raw.workSections : []).slice(0, 4).map((s, i) => ({
    id: (str(s && s.id, 16) || 'w' + i).toLowerCase().replace(/[^a-z0-9]/g, '') || ('w' + i),
    label: str(s && s.label, 60) || 'Section ' + (i + 1),
    prompt: str(s && s.prompt, 300),
    hint: str(s && s.hint, 300),
    core: s && s.core === true,
  })).filter((s) => s.prompt);
  if (workSections.length < 2) return null;
  if (workSections.filter((s) => s.core).length < 2) {
    workSections = workSections.map((s, i) => ({ ...s, core: i < 2 }));
  }

  const orientation = raw.orientation || {};
  const persona = str(raw.colleaguePersona, 1400);
  const colleagueName = str(raw.colleagueName, 60) || 'Sam Rivera';
  const brief = str(raw.brief, 1600);
  const task = str(raw.task, 400);
  if (!brief || !task || persona.length < 80) return null;

  // Branching decision scenario (deep tier's ~20-minute narrative arc).
  // Optional — a sim without one simply skips the Crossroads stage.
  let scenario = null;
  const scRaw = raw.scenario;
  if (scRaw && typeof scRaw === 'object' && Array.isArray(scRaw.nodes)) {
    const nodes = scRaw.nodes.slice(0, 6).map((n) => ({
      id: (str(n && n.id, 12) || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
      setup: str(n && n.setup, 700),
      decision: str(n && n.decision, 260),
      options: (Array.isArray(n && n.options) ? n.options : []).slice(0, 3).map((o) => ({
        label: str(o && o.label, 200),
        outcome: str(o && o.outcome, 600),
        next: str(o && o.next, 12).toLowerCase().replace(/[^a-z0-9]/g, '') || null,
        tone: ['strong', 'workable', 'costly'].includes(o && o.tone) ? o.tone : 'workable',
      })).filter((o) => o.label && o.outcome),
    })).filter((n) => n.id && n.setup && n.decision && n.options.length >= 2);
    const ids = new Set(nodes.map((n) => n.id));
    nodes.forEach((n) => n.options.forEach((o) => { if (o.next && !ids.has(o.next)) o.next = null; }));
    if (nodes.length >= 3) {
      scenario = { intro: str(scRaw.intro, 500), nodes };
    }
  }

  const taxiRaw = raw.taxi || {};
  const taxi = {
    docLabel: str(taxiRaw.docLabel, 12),
    brief: str(taxiRaw.brief, 900) || brief,
    payoff: str(taxiRaw.payoff, 700),
  };
  if (taxi.docLabel && !docs.some((d) => d.label === taxi.docLabel)) taxi.docLabel = '';

  const pub = {
    id: slug,
    domain: str(raw.domain, 40) || 'GENERATED',
    tag: raw.tag === 'HIDDEN' ? 'HIDDEN' : 'FAMILIAR',
    minutes: 20,
    title: str(raw.title, 80) || name,
    org: str(raw.org, 80) || 'a mid-size team',
    orgPlain: str(raw.orgPlain, 160),
    hook: str(raw.hook, 220),
    youWill: str(raw.youWill, 220),
    orientation: {
      company: str(orientation.company, 500),
      role: str(orientation.role, 500),
      people: strList(orientation.people, 3, 200),
    },
    brief,
    task,
    glossary,
    docs,
    taxi,
    interactions,
    colleague: { name: colleagueName, role: str(raw.colleagueRole, 60) || 'Senior colleague' },
    starters: strList(raw.starters, 3, 160),
    workSections,
    moments: strList(raw.moments, 5, 120),
    scenario,
    generated: true,
    generatedAt: new Date().toISOString(),
  };
  const secrets = {
    title: pub.title,
    persona,
    colleagueName,
    colleagueRole: pub.colleague.role,
    brief,
    task,
  };
  return { pub, secrets };
}

/* ── Handler ───────────────────────────────────────────────────── */

// Whole-pipeline wall-clock budget. Workers `fetch` has no default timeout, so
// without this a slow/hung Gemini call has nothing to stop it and the Function
// hangs until the platform kills it — which the client sees as "not ready yet"
// after a long wait. Each call also carries its own timeoutMs; deadlineAt caps
// the cascade and clamps every sub-call to the time remaining.
const PIPELINE_BUDGET_MS = 55000;
const GEN_TIMEOUT_MS = 30000;
const CRITIC_TIMEOUT_MS = 12000;

async function generateOnce(env, name, critique, deadlineAt) {
  return callGeminiJson(env, {
    prompt: buildPrompt(name, critique),
    temperature: 0.75,
    // Full headroom (thinkingBudget is 0 in JSON mode) so the larger payload —
    // docs + interactions + the branching scenario — never truncates and forces
    // a costly re-generation at a bumped token tier.
    maxTokens: 8192,
    label: 'sim-generate',
    softFail: true,
    timeoutMs: GEN_TIMEOUT_MS,
    deadlineAt,
  });
}

async function criticReview(env, name, rawSim, deadlineAt) {
  try {
    const verdict = await callGeminiJson(env, {
      prompt: buildCriticPrompt(name, JSON.stringify(rawSim)),
      temperature: 0.2,
      maxTokens: 512,
      label: 'sim-critic',
      timeoutMs: CRITIC_TIMEOUT_MS,
      deadlineAt,
    });
    if (!verdict || typeof verdict.pass !== 'boolean') return { pass: true, problems: [] }; // critic broken → don't block
    return {
      pass: verdict.pass === true,
      problems: strList(verdict.problems, 6, 300),
    };
  } catch (err) {
    console.warn('sim-critic failed (passing draft through)', err && err.message);
    return { pass: true, problems: [] };
  }
}

/* ── Global index of generated sims (board discovery) ──────────── */
// Lightweight KV doc listing every cached generated sim so the Career Tester
// board can offer them alongside the authored seven. Best-effort: a failed
// index write never blocks serving the sim itself.

const INDEX_KEY = 'simv2-index';
const INDEX_MAX = 100;

async function addToIndex(env, pub) {
  if (!env.COACH_KV) return;
  try {
    const list = (await env.COACH_KV.get(INDEX_KEY, 'json')) || [];
    const entries = Array.isArray(list) ? list.filter((e) => e && e.id !== pub.id) : [];
    entries.unshift({
      id: pub.id,
      title: pub.title,
      domain: pub.domain,
      tag: pub.tag,
      org: pub.org,
      orgPlain: pub.orgPlain,
      hook: pub.hook,
      at: pub.generatedAt,
    });
    await env.COACH_KV.put(INDEX_KEY, JSON.stringify(entries.slice(0, INDEX_MAX)));
  } catch (err) {
    console.warn('sim-generate: index update failed', err);
  }
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method === 'GET') {
    // Board discovery: list of generated sims available to open instantly.
    let sims = [];
    try {
      if (env.COACH_KV) sims = (await env.COACH_KV.get(INDEX_KEY, 'json')) || [];
    } catch (err) {
      console.warn('sim-generate: index read failed', err);
    }
    return authJsonResponse(200, { sims: Array.isArray(sims) ? sims : [] }, origin);
  }
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const slug = String(payload.slug || '').trim().toLowerCase();
  const name = str(payload.name, MAX_NAME_LEN)
    || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (!slug || slug.length > MAX_SLUG_LEN || !SLUG_RE.test(slug)) {
    return authJsonResponse(400, { error: 'Missing or invalid slug.' }, origin);
  }

  const kvKey = 'simv2:' + slug;
  try {
    if (env.COACH_KV) {
      const cached = await env.COACH_KV.get(kvKey, 'json');
      if (cached && cached.pub) {
        return authJsonResponse(200, { sim: cached.pub, cached: true }, origin);
      }
    }
  } catch (err) {
    console.warn('sim-generate: KV read failed', err);
  }

  // Cache miss → Gemini burn requires a signed-in session.
  const email = await getSessionEmail(request, env);
  if (!email) return authJsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, 'simgen:' + clientIp(request), { max: RATE_MAX });
  } catch (err) {
    return authErrorResponse(err, origin);
  }

  try {
    // Draft → critic gate → (one retry with the critic's notes, budget
    // permitting) → validate. Bounded degradation: the critic is advisory,
    // not a hard gate — a schema-valid draft SHIPS even if the critic keeps
    // flagging it, rather than throwing away a usable sim with a 502. Only a
    // total generation failure (nothing to validate) returns an error.
    const deadlineAt = Date.now() + PIPELINE_BUDGET_MS;
    let raw = await generateOnce(env, name, null, deadlineAt);
    if (!raw) {
      return authJsonResponse(502, { error: 'The simulation builder is busy right now. Please try again in a moment.' }, origin);
    }
    const review = await criticReview(env, name, raw, deadlineAt);
    // Retry once with the critic's notes only if there's budget for another
    // full generation + review; keep the retry only when it actually passes.
    if (!review.pass && deadlineAt - Date.now() > GEN_TIMEOUT_MS + CRITIC_TIMEOUT_MS) {
      console.warn('sim-generate: draft failed critic', name, review.problems);
      const retry = await generateOnce(env, name, '- ' + review.problems.join('\n- '), deadlineAt);
      if (retry && (await criticReview(env, name, retry, deadlineAt)).pass) {
        raw = retry;
      }
    }
    const result = validate(raw, slug, name);
    if (!result) {
      return authJsonResponse(502, { error: 'Generated simulation failed validation.' }, origin);
    }
    try {
      if (env.COACH_KV) {
        await env.COACH_KV.put(kvKey, JSON.stringify(result), { expirationTtl: KV_TTL_SECONDS });
      }
    } catch (err) {
      console.warn('sim-generate: KV write failed', err);
    }
    await addToIndex(env, result.pub);
    return authJsonResponse(200, { sim: result.pub, cached: false }, origin);
  } catch (err) {
    console.warn('sim-generate failed', err && err.message);
    return authErrorResponse(err, origin);
  }
}
