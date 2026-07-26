// FlightWay — Marco's structured reply contract (WS-D slice D2).
//
// Marco answers in prose, then appends one fenced block:
//
//   <<<FW_UI {"suggestions":[...],"cards":[...],"thread":{...}} >>>
//
// This module owns both ends of that: the instruction text the chat surface
// prompt carries, and the parse/strip/validate on the way back. Three rules
// make it safe to ship:
//
//  1. The prose is authoritative. Any failure here — missing block, mangled
//     JSON, a card that fails validation — drops `ui` and returns the reply
//     unchanged. A structured extra must never be able to break an answer.
//  2. Nothing the model writes becomes a URL. Hrefs are derived from the
//     card's type (and a SOC we pattern-match), never copied from the model,
//     so a hallucinated link cannot leave the product.
//  3. Everything is clamped: counts, lengths, whitelisted types.
//
// Pure functions, no fetch/KV — scripts/test-marco-ui-contract.mjs unit-tests
// the parser against fixture model outputs directly.

export const FW_UI_MARKER = '<<<FW_UI';

export const UI_CARD_TYPES = ['career', 'roadmap-step', 'deadline', 'link'];
const CARD_TYPE_SET = new Set(UI_CARD_TYPES);

const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 48;
const MAX_CARDS = 3;
const SOC_RE = /^\d{2}-\d{4}(\.\d{2})?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(v, cap) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

/**
 * Split a raw model reply into prose + the raw FW_UI JSON string.
 *
 * Salvage order mirrors gemini-json.js: the exact delimiters first, then a
 * looser "marker then a JSON object somewhere after it" pass for the runs
 * where the model drops the closing `>>>` or wraps the block in a code fence.
 * Returns { prose, raw } with raw = '' when there is no block at all.
 */
export function splitUiBlock(text) {
  const full = String(text || '');
  const at = full.indexOf(FW_UI_MARKER);
  if (at < 0) return { prose: full.trim(), raw: '' };

  const prose = full.slice(0, at);
  let tail = full.slice(at + FW_UI_MARKER.length);
  const close = tail.indexOf('>>>');
  if (close >= 0) tail = tail.slice(0, close);

  // A fenced block inside the delimiters is still the payload.
  const fenced = tail.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) tail = fenced[1];

  const start = tail.indexOf('{');
  const end = tail.lastIndexOf('}');
  const raw = start >= 0 && end > start ? tail.slice(start, end + 1) : '';
  return { prose: prose.trim(), raw: raw.trim() };
}

/** Deep links are ours, not the model's. */
function hrefForCard(type, soc) {
  if (type === 'career') return soc ? `dashboard.html?soc=${encodeURIComponent(soc)}` : 'dashboard.html';
  if (type === 'roadmap-step') return 'roadmap.html';
  if (type === 'link') return 'portal.html';
  return '';       // deadline cards are rendered from the rail's own data
}

function validateCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = cleanText(raw.type, 20).toLowerCase();
  if (!CARD_TYPE_SET.has(type)) return null;
  const title = cleanText(raw.title, 80);
  if (!title) return null;

  const soc = SOC_RE.test(String(raw.soc || '').trim()) ? String(raw.soc).trim() : '';
  const date = ISO_DATE_RE.test(String(raw.date || '').trim()) && !Number.isNaN(Date.parse(raw.date))
    ? String(raw.date).trim()
    : '';
  // A career card with no SOC still deep-links (to the hub) — the hub opens on
  // the user's own map, which beats a dead row.
  const card = { type, title, href: hrefForCard(type, soc) };
  const subtitle = cleanText(raw.subtitle, 120);
  if (subtitle) card.subtitle = subtitle;
  const meta = cleanText(raw.meta, 48);
  if (meta) card.meta = meta;
  if (soc) card.soc = soc;
  if (date) card.date = date;
  return card;
}

// `seed` is the message that gets sent when the user accepts the thread. It is
// server-authored (D3 picks threads deterministically), but it goes through the
// same clamp as everything else — the validator does not care who wrote it.
function validateThread(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanText(raw.title, 64);
  const hook = cleanText(raw.hook, 200);
  if (!title || !hook) return null;
  const seed = cleanText(raw.seed, 160);
  return { title, hook, ...(seed ? { seed } : {}) };
}

/**
 * Validate a parsed FW_UI object. Returns a clean payload or null when there
 * is nothing worth sending — an empty `ui` is noise on the wire.
 */
export function validateUi(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : [])
    .map((s) => cleanText(s, MAX_SUGGESTION_CHARS))
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);

  const cards = [];
  for (const item of (Array.isArray(raw.cards) ? raw.cards : [])) {
    if (cards.length >= MAX_CARDS) break;
    const card = validateCard(item);
    if (card) cards.push(card);
  }

  const thread = validateThread(raw.thread);

  if (!suggestions.length && !cards.length && !thread) return null;
  return {
    ...(suggestions.length ? { suggestions } : {}),
    ...(cards.length ? { cards } : {}),
    ...(thread ? { thread } : {}),
  };
}

/**
 * The whole round trip: raw model text in, { reply, ui } out. `ui` is null
 * whenever anything at all went wrong, and `reply` is always the prose the
 * user should see (the block stripped, never leaked).
 */
export function parseMarcoReply(text) {
  const { prose, raw } = splitUiBlock(text);
  if (!raw) return { reply: prose, ui: null };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reply: prose, ui: null };
  }
  return { reply: prose, ui: validateUi(parsed) };
}

/**
 * The streaming half of rule 1 (D6). Model deltas carry the FW_UI block with
 * them, so a naive progressive render ends with `<<<FW_UI {…}` typing itself
 * into the bubble. This gate emits prose up to the marker and nothing after
 * it, holding back any trailing partial marker so a delta boundary in the
 * middle of `<<<FW_UI` cannot leak the first half.
 *
 * Held text is simply dropped if the stream ends mid-marker — the control
 * frame re-renders the parsed prose anyway, so the gate is allowed to be
 * conservative and never has to guess.
 */
export function createStreamProseGate() {
  let held = '';
  let closed = false;
  return function pushDelta(delta) {
    if (closed) return '';
    let buf = held + String(delta == null ? '' : delta);
    held = '';
    const at = buf.indexOf(FW_UI_MARKER);
    if (at >= 0) {
      closed = true;
      return buf.slice(0, at);
    }
    for (let n = Math.min(FW_UI_MARKER.length - 1, buf.length); n > 0; n--) {
      if (buf.slice(buf.length - n) === FW_UI_MARKER.slice(0, n)) {
        held = buf.slice(buf.length - n);
        buf = buf.slice(0, buf.length - n);
        break;
      }
    }
    return buf;
  };
}

/**
 * The instruction half of the contract, appended to the chat surface prompt.
 * Kept beside the parser on purpose: a change to one that misses the other is
 * the failure mode this whole module exists to prevent.
 */
export function uiContractInstruction() {
  return `
## Reply attachments (machine-read — the user never sees this block)
After your prose, and only when it genuinely helps, append ONE block on its own line:

<<<FW_UI {"suggestions":["..."],"cards":[{"type":"career","title":"...","soc":"15-2051"}]} >>>

- suggestions: up to 3 follow-ups the user might tap, each under 48 characters,
  written in the user's voice ("How hard is the CFA?"), never restating your reply.
- cards: up to 3, each one thing the user can open right now.
  type "career" (add "soc" — the O*NET code, e.g. 15-2051 — when you know it),
  type "roadmap-step" for a step on their plan, type "deadline" with an ISO "date",
  type "link" for another part of Flightway.
  Give each a "title", and a "subtitle" of at most a dozen words when it adds something.
- Never put a URL in this block. Never mention the block, or that it exists.
- Omit the block entirely when nothing fits. An unhelpful chip is worse than none.`;
}
