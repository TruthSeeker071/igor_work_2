// Shared dossier-merge path — single write pipeline for every Marco surface
// (main coach chat, macro roadmap "refine plan" chat, inline waypoint chat).
// The merge prompt + validation lived in functions/chat.js; extracted here so
// the roadmap chat surfaces reuse the exact same logic instead of forking it.

import { saveDossier, isValidDossier, DOSSIER_VERSION_MARKER } from '../_lib.js';
import { callGeminiText } from './gemini-json.js';

export function dossierUpdatePrompt(currentDossier, transcript) {
  const transcriptText = transcript
    .map((m) => `${m.role === 'assistant' ? 'COACH' : 'USER'}: ${m.content}`)
    .join('\n');
  return [
    'You are updating a structured user dossier from a recent chat transcript.',
    '',
    'EXTRACTION RULES (apply in order):',
    '1. Scan every USER line for durable facts: stated majors/minors, school decisions,',
    '   goals, interests, constraints, preferences, deadlines, background details.',
    '   A single mention is enough — if the user said "I want to major in X and minor',
    '   in Y", that MUST appear in the goals field of the new dossier.',
    '2. Statements late in the transcript matter just as much as early ones. Re-read',
    '   the final USER messages carefully before finishing.',
    '3. Newer statements supersede older dossier values when they conflict.',
    '4. Merge into the existing dossier. Preserve the exact schema and field order.',
    '   Keep values terse and comma-separated.',
    '5. If a field has no new info, keep its existing value unchanged.',
    '6. A stated change of school ("I\'m transferring to X", "I got into X", "I start at',
    '   X in the fall") MUST be written into the "school:" field itself — not only into',
    '   recent: or notes:. That field is what every other feature reads to decide which',
    '   clubs, courses and campus programs the student can actually use, so leaving it',
    '   stale makes their whole plan wrong. The same rule applies to these stated facts',
    '   and their named fields (add the missing line directly above "recent:" if the',
    '   dossier lacks it): class year ("I\'m a junior now") → "year:" (one of freshman/',
    '   sophomore/junior/senior), declared major or favorite subjects → "subjects_major:",',
    '   a stated GPA → "gpa:", career direction ("I want to do quant finance") →',
    '   "career_leaning:".',
    '7. Use "recent:" for conversation topics that are not yet durable facts. Move',
    '   stale recent items into stable sections (interests, goals) or drop them.',
    '8. If the total dossier would exceed ~500 tokens, compress redundant items.',
    '9. If the transcript contains NO durable fact and nothing that adds to or',
    '   contradicts the dossier (off-hand opinions, questions, chit-chat), output',
    '   the current dossier EXACTLY as-is, byte for byte.',
    // WS-E E3: the dossier is what every advice surface reads instead of the
    // transcript, so a fact that arrives here as a paraphrase is a fact every
    // later reply has to be vague about.
    '10. Keep it dense and literal. Names, numbers, course codes, firms, dates and',
    '    titles go in VERBATIM as the user said them ("Math 16100", "3.7", "Jane',
    '    Street", "spring 2027") — never softened into a category ("a math class",',
    '    "a good GPA", "a trading firm"). No adjectives about the user, no summary',
    '    sentences, no interpretation: this is a record, not a description.',
    '',
    'SELF-CHECK before output: list (mentally) each durable fact stated by the USER',
    'in the transcript, and verify each one appears somewhere in your output dossier.',
    'Losing a user-stated fact is the worst possible failure.',
    '',
    `Output ONLY the new dossier text, starting with "${DOSSIER_VERSION_MARKER}".`,
    'No markdown fences, no commentary.',
    '',
    '<current_dossier>',
    currentDossier,
    '</current_dossier>',
    '',
    '<recent_transcript>',
    transcriptText,
    '</recent_transcript>',
  ].join('\n');
}

export function isManualDossierCommand(message) {
  const m = String(message || '').toLowerCase();
  return (
    /\b(update|refresh|save|sync|regenerate)\b[^.!?]{0,40}\bdossier\b/.test(m)
    || /\bdossier\b[^.!?]{0,30}\b(update|refresh|save)\b/.test(m)
  );
}

const DURABLE_RE = /\b(i am|i'm|i study|my major|my school|i work|i intern|i graduated|i want to|my goal|i live in|i'm from|i have a|i took|i'm taking|instead of|i decided|i chose|i finished|i completed|i switched|transferring|transferred|enrolling|enrolled|committed to|starting at)\b/i;

export function transcriptHasDurableFacts(transcript) {
  const userMsgs = (transcript || []).filter((m) => m && m.role === 'user');
  if (userMsgs.length < 2) return false;
  return userMsgs.some((m) => DURABLE_RE.test(String(m.content || '')));
}

// Cheap pre-gate for single-message surfaces (roadmap chats): only worth a
// Gemini merge call when the message states a durable fact OR names something
// the dossier already tracks (e.g. swapping a course that appears there).
// Off-hand opinions about things with no dossier footprint stay gated out.
export function messageTouchesDossier(message, dossier) {
  const msg = String(message || '');
  if (!msg.trim()) return false;
  if (DURABLE_RE.test(msg)) return true;
  const doc = String(dossier || '').toLowerCase();
  if (!doc) return false;
  const tokens = msg.toLowerCase().match(/[a-z][a-z0-9]{4,}/g) || [];
  const STOP = new Set(['about', 'should', 'would', 'could', 'think', 'there', 'their', 'where', 'which', 'because', 'really', 'maybe', 'going', 'want', 'wants', 'better', 'worse', 'instead', 'waypoint', 'roadmap', 'semester', 'course', 'class', 'marco', 'please', 'thanks']);
  return tokens.some((t) => !STOP.has(t) && doc.includes(t));
}

// Merge the transcript into the user's dossier and persist — but skip the
// save when the model returns the dossier unchanged (no durable content),
// so opinions never churn the stored dossier. Best-effort: any failure keeps
// the previous dossier and reports updated:false.
export async function mergeDossierFromTranscript(env, userId, currentDossier, transcript) {
  const text = await callGeminiText(env, {
    prompt: 'You are a precise data-merger. Follow the instructions exactly and output only the requested dossier text.\n\n'
      + dossierUpdatePrompt(currentDossier, transcript),
    temperature: 0.2,
    maxTokens: 1200,
    label: 'dossier-merge',
    softFail: true,
    timeoutMs: 25000,
  });
  if (!text) return { updated: false, dossier: currentDossier };

  const cleaned = String(text)
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/```\s*$/, '')
    .trim();

  if (!isValidDossier(cleaned)) {
    console.warn('Dossier merge produced invalid output; keeping previous dossier.');
    return { updated: false, dossier: currentDossier };
  }
  if (cleaned === String(currentDossier || '').trim()) {
    return { updated: false, dossier: currentDossier };
  }
  const saved = await saveDossier(env, userId, cleaned);
  return { updated: true, dossier: saved };
}
