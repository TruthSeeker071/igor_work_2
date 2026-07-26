// Marco's streaming transport (WS-D D6) — wire invariants.
//
// Everything here is deterministic and offline. What it pins:
//   - the SSE frame contract encodes and re-reads byte-identically, including
//     across chunk boundaries a network is free to pick anywhere;
//   - the prose gate never lets the FW_UI marker reach a client, even when the
//     marker is split across two deltas;
//   - the streamed text and the control frame's reply agree on the prose, so
//     "the control frame is authoritative" is a no-op for the user, not a jump;
//   - the coach client's hand-written parser still mirrors the server's.
//
// Run: npm run test:marco-stream

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sseEncode, createSseParser } from '../functions/_lib/sse.js';
import { createStreamProseGate, parseMarcoReply, FW_UI_MARKER } from '../functions/_lib/marco-ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok - ${name}`); return; }
  failures += 1;
  console.error(`  FAIL - ${name}${detail ? `\n        ${detail}` : ''}`);
}

/** Feed a string to a parser in `size`-byte pieces — a network's worst case. */
function feed(parser, text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(...parser.push(text.slice(i, i + size)));
  }
  out.push(...parser.flush());
  return out;
}

/* ── 1. The frame contract round-trips ────────────────────────────── */
{
  const wire = sseEncode('open', { ok: true })
    + sseEncode(null, { delta: 'Take Real Analysis' })
    + sseEncode(null, { delta: ' before you apply.\n\nIt is the one class that matters.' })
    + sseEncode('control', { reply: 'Take Real Analysis before you apply.', exchangeCount: 3 });

  const frames = feed(createSseParser(), wire, wire.length);
  check('frames: four frames in, four frames out', frames.length === 4, String(frames.length));
  check('frames: an omitted event name reads as "message"', frames[1].event === 'message');
  check('frames: the control frame keeps its name', frames[3].event === 'control');
  check('frames: a delta carrying newlines survives the wire',
    JSON.parse(frames[2].data).delta.includes('\n\n'));
  check('frames: the control payload round-trips',
    JSON.parse(frames[3].data).exchangeCount === 3);

  // The network chooses the chunk boundaries, not us.
  for (const size of [1, 3, 7, 64]) {
    const chunked = feed(createSseParser(), wire, size);
    check(`frames: identical when split every ${size} byte(s)`,
      JSON.stringify(chunked) === JSON.stringify(frames));
  }
}

/* ── 2. A frame without its terminator is still delivered ─────────── */
{
  // Gemini's last chunk sometimes arrives without the trailing blank line.
  const parser = createSseParser();
  const mid = parser.push(`${sseEncode(null, { delta: 'one' })}data: {"delta":"two"}`);
  check('flush: an unterminated trailing frame is buffered, not emitted', mid.length === 1);
  const tail = parser.flush();
  check('flush: and is emitted on flush', tail.length === 1 && JSON.parse(tail[0].data).delta === 'two');
  check('flush: a second flush yields nothing', parser.flush().length === 0);
}

/* ── 3. The prose gate never leaks the FW_UI block ────────────────── */
{
  const PROSE = 'Take Real Analysis before you apply.';
  const BLOCK = `\n\n${FW_UI_MARKER} {"suggestions":["How hard is it?"]} >>>`;
  const full = PROSE + BLOCK;

  for (const size of [1, 2, 4, 5, 9, 200]) {
    const gate = createStreamProseGate();
    let emitted = '';
    for (let i = 0; i < full.length; i += size) emitted += gate(full.slice(i, i + size));
    check(`gate: no marker at chunk size ${size}`, !emitted.includes('<<<') && !emitted.includes('FW_UI'), emitted.slice(-40));
    check(`gate: prose intact at chunk size ${size}`, emitted.trimEnd() === PROSE, JSON.stringify(emitted));
  }

  // The exact boundary that motivated the hold-back buffer.
  const split = createStreamProseGate();
  const a = split(`${PROSE}\n\n<<<F`);
  const b = split('W_UI {"suggestions":[]} >>>');
  check('gate: a marker split mid-token leaks neither half',
    !(a + b).includes('<<<') && (a + b).trimEnd() === PROSE, JSON.stringify(a + b));
  check('gate: everything after the marker is silence', split(' trailing junk') === '');
}

/* ── 4. Streamed prose and the control frame agree ────────────────── */
{
  const PROSE = 'Lead with the answer.\n\n- One\n- Two';
  const raw = `${PROSE}\n\n${FW_UI_MARKER} {"suggestions":["Why?"]} >>>`;
  const gate = createStreamProseGate();
  let streamed = '';
  for (let i = 0; i < raw.length; i += 11) streamed += gate(raw.slice(i, i + 11));
  const { reply, ui } = parseMarcoReply(raw);
  check('agree: the streamed text equals the control frame reply',
    streamed.trim() === reply, JSON.stringify([streamed.trim(), reply]));
  check('agree: the block still parses into ui after streaming',
    !!(ui && ui.suggestions.length === 1));
}

/* ── 5. A reply with no block streams unchanged ───────────────────── */
{
  const PROSE = 'No attachments this time — just the answer.';
  const gate = createStreamProseGate();
  let streamed = '';
  for (const ch of PROSE) streamed += gate(ch);
  check('no-block: nothing is held back at the end',
    streamed === PROSE, JSON.stringify(streamed));
}

/* ── 6. The client mirror still mirrors ───────────────────────────── */
{
  const coach = readFileSync(join(ROOT, 'assets/js/coach/coach.js'), 'utf8');
  check('client: coach.js carries an SSE frame parser', coach.includes('function coachParseSseFrame'));
  check('client: it splits frames on a blank line like the server does',
    coach.includes("indexOf('\\n\\n')"));
  check('client: it reads the same three frame names',
    coach.includes("=== 'control'") && coach.includes("=== 'error'") && coach.includes("=== 'message'"));
  check('client: the control frame replaces the streamed text, never appends',
    /replyEl\.innerHTML = coachRenderMarkdown\(data\.reply/.test(coach));
  check('client: the JSON path survives as the fallback',
    coach.includes('coachJsonTurn') && coach.includes('if (!turn) turn = await coachJsonTurn'));
  check('client: the streaming probe is disabled for the session, not per message',
    coach.includes('coachStreamAvailable = false'));

  const server = readFileSync(join(ROOT, 'functions/chat-stream.js'), 'utf8');
  check('server: an open frame is sent before any work, so the client can tell '
    + 'a live endpoint from a missing one', /sseEncode\('open'/.test(server));
  check('server: deltas pass through the prose gate', server.includes('createStreamProseGate'));
  check('server: failures are frames, not status codes',
    /sseEncode\('error'/.test(server) && server.includes('status: 200'));

  const chat = readFileSync(join(ROOT, 'functions/chat.js'), 'utf8');
  check('chat: the turn is shared, not forked', chat.includes('export async function runChatTurn'));
  check('chat: streaming carries its own upstream deadline',
    chat.includes('STREAM_UPSTREAM_TIMEOUT_MS'));
  check('chat: a retry after the first byte is refused',
    chat.includes('opts.hasStreamed && opts.hasStreamed()'));
}

if (failures) {
  console.error(`\ntest:marco-stream FAIL — ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\ntest:marco-stream PASS');
