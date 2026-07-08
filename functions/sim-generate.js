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

async function generateOnce(env, name, critique) {
  return callGeminiJson(env, {
    prompt: buildPrompt(name, critique),
    temperature: 0.75,
    maxTokens: 4096,
    label: 'sim-generate',
  });
}

async function criticReview(env, name, rawSim) {
  try {
    const verdict = await callGeminiJson(env, {
      prompt: buildCriticPrompt(name, JSON.stringify(rawSim)),
      temperature: 0.2,
      maxTokens: 512,
      label: 'sim-critic',
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

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  if (request.method === 'OPTIONS') return authPreflight(origin);
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

  try {
    await checkRateLimit(env, 'simgen:' + clientIp(request), { max: RATE_MAX });
  } catch (err) {
    return authErrorResponse(err, origin);
  }

  try {
    // Draft → critic gate → (one retry with the critic's notes) → validate.
    let raw = await generateOnce(env, name, null);
    let review = await criticReview(env, name, raw);
    if (!review.pass) {
      console.warn('sim-generate: draft failed critic', name, review.problems);
      raw = await generateOnce(env, name, '- ' + review.problems.join('\n- '));
      review = await criticReview(env, name, raw);
      if (!review.pass) {
        return authJsonResponse(502, { error: 'Simulation drafts failed quality review.' }, origin);
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
    return authJsonResponse(200, { sim: result.pub, cached: false }, origin);
  } catch (err) {
    console.warn('sim-generate failed', err && err.message);
    return authErrorResponse(err, origin);
  }
}
