// Marco's structured reply contract (WS-D D2) — parser invariants.
//
// Every fixture here is a shape a real model run produced or plausibly will:
// a clean block, a block the model mangled, no block at all, and a block
// carrying values that must not survive validation. The one rule that matters
// across all of them: the prose always comes back intact, and `ui` is null
// rather than half-trusted.
//
// Deterministic, no API cost. Run: npm run test:marco-ui

import {
  splitUiBlock, validateUi, parseMarcoReply, uiContractInstruction, UI_CARD_TYPES,
} from '../functions/_lib/marco-ui.js';
import { selectThread, THREAD_MIN_EXCHANGES } from '../functions/_lib/marco-thread.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok - ${name}`); return; }
  failures += 1;
  console.error(`  FAIL - ${name}${detail ? `\n        ${detail}` : ''}`);
}

const PROSE = 'Take Real Analysis before you apply. It is the single class that separates\nquant applicants who get interviews from those who do not.';

/* ── 1. A clean block ─────────────────────────────────────────────── */
{
  const raw = `${PROSE}\n\n<<<FW_UI {"suggestions":["How hard is Real Analysis?","What else should I take?"],"cards":[{"type":"career","title":"Quantitative Analyst","subtitle":"Your strongest fit right now","soc":"13-2099"}]} >>>`;
  const { reply, ui } = parseMarcoReply(raw);
  check('clean: prose survives with the block stripped', reply === PROSE, JSON.stringify(reply));
  check('clean: no marker leaks into the reply', !reply.includes('FW_UI'));
  check('clean: both suggestions kept', ui && ui.suggestions.length === 2);
  check('clean: card kept with its soc', ui && ui.cards[0].soc === '13-2099');
  check('clean: href is derived server-side, not model-supplied',
    ui && ui.cards[0].href === 'dashboard.html?soc=13-2099', ui && ui.cards[0].href);
}

/* ── 2. Mangled blocks still degrade to prose ─────────────────────── */
{
  const noClose = `${PROSE}\n<<<FW_UI {"suggestions":["One thing"]}`;
  const r1 = parseMarcoReply(noClose);
  check('mangled: missing >>> still parses', r1.ui && r1.ui.suggestions[0] === 'One thing');
  check('mangled: missing >>> keeps the prose', r1.reply === PROSE);

  const fenced = `${PROSE}\n<<<FW_UI\n\`\`\`json\n{"suggestions":["Fenced"]}\n\`\`\`\n>>>`;
  const r2 = parseMarcoReply(fenced);
  check('mangled: a fence inside the delimiters is still the payload',
    r2.ui && r2.ui.suggestions[0] === 'Fenced');

  const broken = `${PROSE}\n<<<FW_UI {"suggestions":["unterminated, >>>`;
  const r3 = parseMarcoReply(broken);
  check('mangled: unparseable JSON drops ui, never the reply',
    r3.ui === null && r3.reply === PROSE, JSON.stringify(r3));

  const empty = `${PROSE}\n<<<FW_UI {} >>>`;
  const r4 = parseMarcoReply(empty);
  check('mangled: an empty object is not shipped as an empty ui', r4.ui === null);
}

/* ── 3. No block at all — the common case ─────────────────────────── */
{
  const { reply, ui } = parseMarcoReply(PROSE);
  check('missing: reply is untouched', reply === PROSE);
  check('missing: ui is null', ui === null);
  const split = splitUiBlock(PROSE);
  check('missing: splitUiBlock reports no raw payload', split.raw === '');
}

/* ── 4. Validation actually refuses things ────────────────────────── */
{
  const ui = validateUi({
    suggestions: [
      'ok',
      '   ',
      'x'.repeat(120),
      'fourth is dropped',
      'fifth is dropped',
    ],
    cards: [
      { type: 'wormhole', title: 'Not a real type' },
      { type: 'career', title: '' },
      { type: 'link', title: 'Open your resume', href: 'https://evil.example/steal' },
      { type: 'deadline', title: 'Jane Street applications', date: '2026-09-30' },
      { type: 'deadline', title: 'Bad date', date: 'next Tuesday' },
      { type: 'career', title: 'Fourth card is dropped' },
    ],
  });

  check('validate: blank + overflow suggestions dropped, cap of 3 honoured',
    ui.suggestions.length === 3, JSON.stringify(ui.suggestions));
  check('validate: a suggestion is clamped to 48 chars',
    ui.suggestions.every((s) => s.length <= 48));
  check('validate: unknown card type refused',
    !ui.cards.some((c) => c.type === 'wormhole'));
  check('validate: titleless card refused', ui.cards.every((c) => c.title));
  check('validate: a model-supplied external URL never becomes an href',
    ui.cards.every((c) => !/^https?:/i.test(c.href)),
    JSON.stringify(ui.cards.map((c) => c.href)));
  check('validate: card cap of 3 honoured', ui.cards.length === 3);
  check('validate: a non-ISO date is dropped, the card survives',
    ui.cards.some((c) => c.title === 'Bad date' && c.date === undefined));
  check('validate: an ISO date survives',
    ui.cards.some((c) => c.date === '2026-09-30'));
  check('validate: every shipped type is on the whitelist',
    ui.cards.every((c) => UI_CARD_TYPES.includes(c.type)));
}

/* ── 5. Angle brackets in model text cannot reach the client ──────── */
{
  const ui = validateUi({ suggestions: ['<img src=x onerror=alert(1)>'] });
  check('escape: angle brackets stripped from suggestion text',
    ui && !ui.suggestions[0].includes('<') && !ui.suggestions[0].includes('>'),
    ui && ui.suggestions[0]);
}

/* ── 6. The prompt half and the parser half agree ─────────────────── */
{
  const instruction = uiContractInstruction();
  check('prompt: instruction names the exact marker the parser looks for',
    instruction.includes('<<<FW_UI'));
  check('prompt: instruction forbids model-authored URLs',
    /never put a url/i.test(instruction));
  check('prompt: every whitelisted card type is described to the model',
    UI_CARD_TYPES.every((t) => instruction.includes(`"${t}"`)),
    UI_CARD_TYPES.filter((t) => !instruction.includes(`"${t}"`)).join(', '));
}

/* ── 7. Proactive thread selection (D3) ───────────────────────────── */
{
  const NOW = Date.parse('2026-07-20T00:00:00Z');
  const FULL = {
    dossier: 'v3\nschool: UChicago\ngoals: land a quant internship\ninterests: poker, options\n',
    quiz: { scores: { finance: 90 }, careerFocus: { name: 'Quantitative Analyst' } },
    roadmap: { targetCareerName: 'Quantitative Analyst' },
    now: NOW,
  };
  const msg = (t) => [{ role: 'user', content: t }];

  check('thread: silent before the minimum exchange count',
    selectThread({ ...FULL, exchangeCount: THREAD_MIN_EXCHANGES - 1, dossier: '' }) === null);

  const dl = selectThread({
    ...FULL,
    exchangeCount: 3,
    deadlines: [
      { title: 'Jane Street Quant Program', deadline: '2026-08-05' },
      { title: 'Something Next Year', deadline: '2027-05-01' },
    ],
  });
  check('thread: an in-horizon deadline outranks everything', dl && /Jane Street/.test(dl.hook), JSON.stringify(dl));
  check('thread: a deadline past the 30-day horizon is not proposed', dl && !/Next Year/.test(dl.hook));
  check('thread: the proposal carries a seed message to send on accept', dl && !!dl.seed);

  const discussed = selectThread({
    ...FULL,
    exchangeCount: 3,
    deadlines: [{ title: 'Jane Street Quant Program', deadline: '2026-08-05' }],
    messages: msg('I already applied to the Jane Street Quant Program last week'),
  });
  check('thread: a deadline already discussed is never re-proposed',
    !discussed || !/Jane Street/.test(discussed.hook), JSON.stringify(discussed));

  const noSchool = selectThread({ ...FULL, exchangeCount: 3, dossier: 'v3\nschool: (unknown)\n' });
  check('thread: a missing school is the top dossier gap', noSchool && /where you study/.test(noSchool.hook));

  const noTarget = selectThread({
    ...FULL, exchangeCount: 3, roadmap: null,
    quiz: { scores: { finance: 90 } },
  });
  check('thread: no target career is proposed once school is known',
    noTarget && /target/i.test(noTarget.title), JSON.stringify(noTarget));

  const sector = selectThread({ ...FULL, exchangeCount: 3 });
  check('thread: an undiscussed high-scoring sector is the fallback',
    sector && /Finance/.test(sector.hook), JSON.stringify(sector));

  // Rule 3 proper: with a server-side rank available it proposes a CAREER, not
  // a sector. The rank arrives from a KV cache, so [] is a normal state and the
  // sector form above must keep standing in.
  const RANK = [
    { soc: '13-2099.00', title: 'Quantitative Analyst', fit: 91, personalityFit: 92, objectiveFit: 88 },
    { soc: '15-2041.00', title: 'Statistician', fit: 87, personalityFit: 88, objectiveFit: 84 },
  ];
  const ranked = selectThread({ ...FULL, exchangeCount: 3, careerRank: RANK });
  check('thread: an undiscussed top-fit career outranks the sector fallback',
    ranked && /Statistician/.test(ranked.hook), JSON.stringify(ranked));
  check('thread: the career proposal quotes its fit score',
    ranked && /87% fit/.test(ranked.hook), JSON.stringify(ranked));
  check('thread: never proposes the career they are already targeting',
    ranked && !/Quantitative Analyst/.test(ranked.hook), JSON.stringify(ranked));
  const rankedDiscussed = selectThread({
    ...FULL, exchangeCount: 3, careerRank: RANK,
    messages: msg('tell me about being a Statistician'),
  });
  check('thread: a career already discussed falls through to the sector',
    rankedDiscussed && /Finance/.test(rankedDiscussed.hook), JSON.stringify(rankedDiscussed));
  check('thread: an empty rank leaves the sector fallback exactly as it was',
    JSON.stringify(selectThread({ ...FULL, exchangeCount: 3, careerRank: [] }))
      === JSON.stringify(sector));

  const nothing = selectThread({
    ...FULL, exchangeCount: 3,
    messages: msg('I want to talk about finance careers'),
  });
  check('thread: proposes nothing when there is nothing new to raise',
    nothing === null, JSON.stringify(nothing));

  check('thread: selection is deterministic for identical state',
    JSON.stringify(selectThread({ ...FULL, exchangeCount: 3 }))
      === JSON.stringify(selectThread({ ...FULL, exchangeCount: 3 })));

  const shipped = validateUi({ thread: dl });
  check('thread: survives the shared validator with title, hook and seed',
    shipped && shipped.thread.title && shipped.thread.hook && shipped.thread.seed);
}

if (failures) {
  console.error(`\ntest:marco-ui FAIL — ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\ntest:marco-ui PASS');
