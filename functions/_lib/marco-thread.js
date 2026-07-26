// FlightWay — Marco's proactive threads (WS-D slice D3).
//
// After Marco answers, the server MAY propose one new topic the user did not
// think to ask about. This is the "unknown unknowns" half of the product: a
// coach who only answers questions can never tell you about the thing you did
// not know to raise.
//
// Rules that keep it from becoming nagging:
//  - Never auto-sent. The client renders a card the user accepts or dismisses.
//  - At most one per response, and only from exchange 2 onward — a proposal on
//    the opening turn reads as a script, not as noticing something.
//  - Deterministic priority, first hit wins. No model call, no cost, no
//    variance: the same state always proposes the same thread.
//  - Never proposes what the conversation already covered.
//
// Selection is pure (no fetch/KV) so scripts/test-marco-ui-contract.mjs can
// drive it from fixtures. The daily cap for free users lives in plan-limits
// (`marco-thread`) and is applied by the caller.

import { topIndustryKeys } from './portal-snapshot.js';

export const THREAD_MIN_EXCHANGES = 2;
const DEADLINE_HORIZON_DAYS = 30;
const TRANSCRIPT_SCAN = 12;

function transcriptText(messages) {
  return (messages || [])
    .slice(-TRANSCRIPT_SCAN)
    .map((m) => String((m && m.content) || ''))
    .join('\n')
    .toLowerCase();
}

/** Loose "have we talked about this" test — a bare word match, deliberately. */
function mentions(haystack, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (n.length < 3) return false;
  return haystack.includes(n);
}

function dossierValue(dossier, key) {
  const line = String(dossier || '')
    .split('\n')
    .find((l) => l.toLowerCase().startsWith(`${key}:`));
  if (!line) return '';
  const v = line.slice(line.indexOf(':') + 1).trim();
  return /^\(/.test(v) ? '' : v;
}

function industryLabel(key) {
  return String(key || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(iso, now) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.round((t - now) / 86400000);
}

/**
 * Pick at most one thread to propose.
 *
 * @returns {{title:string, hook:string, seed:string}|null}
 */
export function selectThread({
  exchangeCount = 0,
  dossier = '',
  quiz = null,
  roadmap = null,
  deadlines = [],
  careerRank = [],
  messages = [],
  now = Date.now(),
} = {}) {
  if (exchangeCount < THREAD_MIN_EXCHANGES) return null;
  const said = transcriptText(messages);
  const q = quiz || {};

  // 1. A deadline inside the horizon that has never come up. The most concrete
  //    thing Marco can know that the user does not.
  const soon = (deadlines || [])
    .map((d) => ({ ...d, daysOut: daysUntil(d && d.deadline, now) }))
    .filter((d) => d.title && Number.isFinite(d.daysOut) && d.daysOut >= 0 && d.daysOut <= DEADLINE_HORIZON_DAYS)
    .sort((a, b) => a.daysOut - b.daysOut)
    .find((d) => !mentions(said, d.title));
  if (soon) {
    const when = soon.daysOut === 0 ? 'today' : `in ${soon.daysOut} ${soon.daysOut === 1 ? 'day' : 'days'}`;
    return {
      title: 'A deadline you have not mentioned',
      hook: `${soon.title} closes ${when}. Worth deciding now whether you are going for it.`,
      seed: `Talk me through whether I should apply to ${soon.title}.`,
    };
  }

  // 2. A dossier gap that caps how good every future answer can be. Ordered by
  //    how much the missing fact actually changes advice.
  if (!dossierValue(dossier, 'school') && !mentions(said, 'school')) {
    return {
      title: 'One fact would sharpen everything',
      hook: 'I do not know where you study. That changes which clubs, courses and recruiting timelines are real for you.',
      seed: 'Here is where I go to school — what changes about your advice?',
    };
  }
  const target = (roadmap && roadmap.targetCareerName) || (q.careerFocus && q.careerFocus.name) || '';
  if (!target && !mentions(said, 'target')) {
    return {
      title: 'You have no target set',
      hook: 'Without one career in the crosshairs I am guessing at which trade-offs matter to you. Picking one is reversible.',
      seed: 'Help me pick a target career to aim at for now.',
    };
  }
  if (!dossierValue(dossier, 'goals') && !dossierValue(dossier, 'interests')) {
    return {
      title: 'I know your scores, not you',
      hook: 'Your dossier has results but no goals or interests in your own words — that is the part that makes advice specific.',
      seed: 'Ask me some questions so you actually know what I want.',
    };
  }

  // 3. A top-5-fit CAREER that has never come up. This is the rule the plan
  //    actually asked for; it needed a server-side career ranker to exist,
  //    which `onet/career-rank.js` now provides. The rank arrives from a KV
  //    cache, so it is [] until that cache warms (a fresh account's first
  //    turn) — the sector form below is the same insight one level coarser and
  //    stands in whenever the rank is absent. Never proposes the career they
  //    are already targeting.
  const targetLower = String(target || '').trim().toLowerCase();
  const pick = (Array.isArray(careerRank) ? careerRank : [])
    .filter((c) => c && c.title)
    .find((c) => {
      const t = String(c.title).toLowerCase();
      return t !== targetLower
        && !mentions(said, c.title)
        && !mentions(String(dossier).toLowerCase(), c.title);
    });
  if (pick) {
    return {
      title: 'A strong match we have never discussed',
      hook: `${pick.title} comes out at ${pick.fit}% fit for you and it has not come up once. Might be nothing — might be the thing.`,
      seed: `Why does ${pick.title} score so well for me?`,
    };
  }

  // 3b. Fallback: a sector you score highly for that has never come up.
  const sector = topIndustryKeys(q.scores, 5)
    .map(industryLabel)
    .find((label) => label && !mentions(said, label) && !mentions(String(dossier).toLowerCase(), label));
  if (sector) {
    return {
      title: 'A strong fit we have never discussed',
      hook: `${sector} is one of your highest-scoring areas and it has not come up once. Might be nothing — might be the thing.`,
      seed: `Why does ${sector} score so well for me?`,
    };
  }

  // 4. A part of the product that would answer the question they just asked,
  //    that they have not used. `featureIntros` (WS-F) is consulted when it
  //    exists; until it does, the real usage signals below stand in.
  const intros = (q.featureIntros && typeof q.featureIntros === 'object') ? q.featureIntros : {};
  const last = String((messages && messages.length && messages[messages.length - 1].content) || '').toLowerCase();
  if (/\b(resume|cv|application|apply)\b/.test(last) && !q.resumeText && !intros.resume) {
    return {
      title: 'Your resume is not in here yet',
      hook: 'I am answering resume questions blind. Drop yours into the Resume Builder and I can be specific about your lines.',
      seed: 'What should I fix about my resume once you can see it?',
    };
  }
  if (/\b(plan|steps|roadmap|semester|next year)\b/.test(last) && !roadmap) {
    return {
      title: 'There is no plan behind this advice',
      hook: 'You do not have a Career Roadmap yet, so none of this is tracked against anything. One takes a minute to build.',
      seed: 'Walk me through building a career roadmap.',
    };
  }

  return null;
}
