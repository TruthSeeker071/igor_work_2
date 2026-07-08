import { getCareers } from './store.js';

function normalizeSearch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizeToken(token) {
  const t = String(token || '');
  if (t.length > 3 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function normalizeTokens(text) {
  return normalizeSearch(text)
    .split(' ')
    .filter(Boolean)
    .map(singularizeToken)
    .join(' ');
}

function slugifyTitle(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function toCareerHit(row) {
  if (!row?.soc || !row?.title) return null;
  return {
    soc: row.soc,
    name: row.title,
    slug: slugifyTitle(row.title),
  };
}

function tokenList(text) {
  return normalizeTokens(text).split(' ').filter((t) => t.length > 2);
}

function fuzzyTokenScore(queryTokens, titleTokens) {
  if (!queryTokens.length || !titleTokens.length) return 0;
  let matches = 0;
  let weighted = 0;
  for (const qt of queryTokens) {
    const hit = titleTokens.some((tt) => tt === qt || tt.startsWith(qt) || qt.startsWith(tt)
      || (qt.length >= 4 && tt.includes(qt)) || (tt.length >= 4 && qt.includes(tt)));
    if (hit) {
      matches += 1;
      weighted += qt.length;
    }
  }
  if (!matches) return 0;
  const ratio = matches / queryTokens.length;
  return ratio * 90 + weighted + (matches >= 2 ? 25 : 0);
}

/** Pull the career label the user named from a free-text switch message. */
export function extractCareerPhraseFromMessage(message) {
  const m = String(message || '').trim();
  const patterns = [
    /\b(?:switch(?:ing)?|change(?:ing)?|pivot(?:ing)?|move|moving|target(?:ing)?)\s+(?:to|my target to)\s+(.+?)(?:[.!?]|$)/i,
    /\b(?:want to|going to|would like to|i'd like to|i would like to)\s+(?:switch|change|pivot|move|target|become|be|do|focus on)\s+(?:to\s+)?(?:a|an|the)?\s*(.+?)(?:[.!?]|$)/i,
    /\b(?:my target|target career)\s+(?:is|should be)\s+(?:now\s+)?(.+?)(?:[.!?]|$)/i,
    /\b(?:focus on|focusing on|interested in|considering|curious about)\s+(?:a|an|the)?\s*(.+?)(?:[.!?]|$)/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (hit && hit[1]) {
      const phrase = hit[1]
        .trim()
        .replace(/\s+as\s+my\s+target\s+career$/i, '')
        .replace(/\s+instead$/i, '')
        .trim();
      if (phrase.length >= 3) return phrase.slice(0, 120);
    }
  }
  return m.replace(/^(yes|yeah|yep|sure|ok|okay|confirm|no|nope|cancel)[,.\s]+/i, '').trim().slice(0, 120);
}

export function isAffirmativeConfirmation(message) {
  const m = String(message || '').trim().toLowerCase();
  if (!m) return false;
  return /^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|sounds good|do it|go ahead|that'?s right|that works|please do|let'?s do it|switch)\b/.test(m)
    || (/\b(yes|confirm)\b/.test(m) && m.length < 48);
}

export function isNegativeConfirmation(message) {
  const m = String(message || '').trim().toLowerCase();
  return /^(no|nope|nah|cancel|nevermind|never mind|not that|different|something else)\b/.test(m);
}

export function resolveProposalChoice(message, pendingProposal) {
  if (!pendingProposal?.primary) return null;
  const all = [pendingProposal.primary, ...(pendingProposal.alternatives || [])];

  if (isAffirmativeConfirmation(message)) {
    return pendingProposal.primary;
  }

  const numMatch = String(message || '').trim().match(/^#?(\d)[.)]?$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (all[idx]) return all[idx];
  }

  const msgTokens = normalizeTokens(message);
  if (!msgTokens || msgTokens.length < 4) return null;

  let best = null;
  let bestScore = 0;
  for (const career of all) {
    const titleTokens = normalizeTokens(career.name);
    const score = scoreTitleMatch(msgTokens, titleTokens) || fuzzyTokenScore(tokenList(message), tokenList(career.name));
    if (score > bestScore) {
      bestScore = score;
      best = career;
    }
  }
  return bestScore >= 8 ? best : null;
}

function scoreTitleMatch(messageTokens, titleTokens) {
  if (!messageTokens || !titleTokens) return 0;
  if (messageTokens === titleTokens) return titleTokens.length + 100;
  if (messageTokens.includes(titleTokens)) return titleTokens.length + 50;
  if (titleTokens.includes(messageTokens) && messageTokens.length >= 8) return messageTokens.length;
  return 0;
}

/**
 * Find the best O*NET career whose title appears in a free-text message.
 * Prefers longer, more specific title matches (e.g. "financial quantitative analyst"
 * over a shorter partial hit).
 */
export async function lookupOnetCareerInMessage(env, baseUrl, message) {
  const rows = await getCareers(env, baseUrl);
  const careers = (Array.isArray(rows) ? rows : rows?.careers || [])
    .filter((row) => row && row.mvpInScope !== false && row.title && row.soc);

  const messageTokens = normalizeTokens(message);
  if (!messageTokens || messageTokens.length < 4) return null;

  let best = null;
  let bestScore = 0;

  for (const row of careers) {
    const titleTokens = normalizeTokens(row.titleNorm || row.title);
    if (!titleTokens || titleTokens.length < 4) continue;
    const score = scoreTitleMatch(messageTokens, titleTokens);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || bestScore < 8) return null;

  return {
    soc: best.soc,
    name: best.title,
    slug: slugifyTitle(best.title),
  };
}

export async function searchOnetCareersByTitle(env, baseUrl, query, limit = 12) {
  const rows = await getCareers(env, baseUrl);
  const careers = (Array.isArray(rows) ? rows : rows?.careers || [])
    .filter((row) => row && row.mvpInScope !== false && row.title && row.soc);

  const q = normalizeSearch(query);
  const qTokens = normalizeTokens(query);
  if (!q) return [];

  const scored = careers
    .map((row) => {
      const title = normalizeSearch(row.title);
      const titleNorm = row.titleNorm || title;
      const titleTokens = normalizeTokens(row.title);
      let score = 0;
      if (title === q || titleTokens === qTokens) score = 200;
      else if (title.startsWith(q) || titleTokens.startsWith(qTokens)) score = 150;
      else if (title.includes(q) || titleNorm.includes(q) || titleTokens.includes(qTokens)) score = 100;
      else if (qTokens.includes(titleTokens)) score = 80;
      return score > 0 ? { row, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.row.title.length - a.row.title.length);

  return scored.slice(0, limit).map(({ row }) => toCareerHit(row));
}

export async function fuzzySearchOnetCareers(env, baseUrl, query, limit = 8) {
  const rows = await getCareers(env, baseUrl);
  const careers = (Array.isArray(rows) ? rows : rows?.careers || [])
    .filter((row) => row && row.mvpInScope !== false && row.title && row.soc);

  const queryTokens = tokenList(query);
  if (!queryTokens.length) return [];

  const scored = careers
    .map((row) => {
      const titleTokens = tokenList(row.titleNorm || row.title);
      const score = fuzzyTokenScore(queryTokens, titleTokens);
      return score > 0 ? { row, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.row.title.length - a.row.title.length);

  return scored.slice(0, limit).map(({ row }) => toCareerHit(row));
}

/**
 * Strictest single-result resolution for auto-pivot flows (no confirm step):
 * exact/title match first, then fuzzy only above a confidence floor so a
 * vague phrase can't silently switch someone to a barely-related career.
 * minScore 90 ≈ all tokens of a short query matched.
 */
export async function bestCatalogMatch(env, baseUrl, query, minScore = 90) {
  const titleHits = await searchOnetCareersByTitle(env, baseUrl, query, 1);
  if (titleHits[0]?.soc) return titleHits[0];

  const rows = await getCareers(env, baseUrl);
  const careers = (Array.isArray(rows) ? rows : rows?.careers || [])
    .filter((row) => row && row.mvpInScope !== false && row.title && row.soc);
  const queryTokens = tokenList(query);
  if (!queryTokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const row of careers) {
    const score = fuzzyTokenScore(queryTokens, tokenList(row.titleNorm || row.title));
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best && bestScore >= minScore ? toCareerHit(best) : null;
}

export async function validateOnetCareer(env, baseUrl, career) {
  if (!career?.soc) return null;
  const rows = await getCareers(env, baseUrl);
  const careers = (Array.isArray(rows) ? rows : rows?.careers || []);
  const row = careers.find((r) => r && r.soc === career.soc && r.mvpInScope !== false);
  return row ? toCareerHit(row) : null;
}

/**
 * Propose O*NET catalog matches for a career-switch message (never verbatim custom labels).
 */
export async function proposeOnetCareersForMessage(env, baseUrl, message) {
  const userPhrase = extractCareerPhraseFromMessage(message);
  if (!userPhrase || userPhrase.length < 3) {
    return { primary: null, alternatives: [], userPhrase: userPhrase || '' };
  }

  const exactInMessage = await lookupOnetCareerInMessage(env, baseUrl, message);
  if (exactInMessage) {
    return { primary: exactInMessage, alternatives: [], userPhrase };
  }

  const titleHits = await searchOnetCareersByTitle(env, baseUrl, userPhrase, 6);
  const fuzzyHits = await fuzzySearchOnetCareers(env, baseUrl, userPhrase, 6);

  const seen = new Set();
  const merged = [];
  [...titleHits, ...fuzzyHits].forEach((hit) => {
    if (!hit?.soc || seen.has(hit.soc)) return;
    seen.add(hit.soc);
    merged.push(hit);
  });

  if (!merged.length) {
    return { primary: null, alternatives: [], userPhrase };
  }

  return {
    primary: merged[0],
    alternatives: merged.slice(1, 3),
    userPhrase,
  };
}

export function buildProposalReply(proposal) {
  const { primary, alternatives, userPhrase } = proposal || {};
  if (!primary?.name) {
    return `I couldn't find "${userPhrase || 'that career'}" in our O*NET career catalog. Try describing the role differently, or search all careers from the target dropdown.`;
  }

  const userNorm = normalizeTokens(userPhrase || '');
  const primaryNorm = normalizeTokens(primary.name);
  const exact = userNorm && (userNorm === primaryNorm || primaryNorm.includes(userNorm));

  let reply;
  if (exact) {
    reply = `I found ${primary.name} in our career catalog. Should I switch your target to that career? Reply yes to confirm.`;
  } else {
    reply = `"${userPhrase}" isn't an exact title in our O*NET database. The closest match is ${primary.name}.`;
    if (alternatives?.length) {
      reply += ` Other options: ${alternatives.map((alt, i) => `${i + 2}) ${alt.name}`).join('; ')}.`;
    }
    reply += ' Reply yes to switch to the closest match, or name one of the options.';
  }
  return reply;
}
