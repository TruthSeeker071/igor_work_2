// Server-sent events: one encoder, one incremental parser.
//
// Both ends of Marco's streaming transport live here on purpose (same reason
// `marco-ui.js` owns both the prompt instruction and the parser): a change to
// the frame shape that misses the reader is the exact failure this module
// exists to prevent. The coach client carries a hand-written mirror of
// `createSseParser` — it cannot import an ES module from `functions/` — so the
// contract is deliberately small enough to mirror without drifting:
//
//   frames are separated by a blank line; `event: <name>` is optional and
//   defaults to `message`; `data:` is always one line of JSON.

/** Encode one frame. `event` may be null for a plain data (delta) frame. */
export function sseEncode(event, data) {
  const payload = JSON.stringify(data === undefined ? null : data);
  return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`;
}

function parseFrame(raw) {
  let event = '';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  return { event: event || 'message', data: dataLines.join('\n') };
}

/**
 * Incremental frame reader. Feed it decoded text in whatever pieces the network
 * hands over — a frame split across two chunks is buffered until it completes.
 * `push` returns the frames that are now whole; `flush` returns a trailing
 * frame that arrived without its blank-line terminator (Gemini's last chunk
 * sometimes does exactly that).
 */
export function createSseParser() {
  let buf = '';
  return {
    push(text) {
      buf += String(text == null ? '' : text).replace(/\r\n/g, '\n');
      const out = [];
      let idx = buf.indexOf('\n\n');
      while (idx !== -1) {
        const frame = parseFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (frame) out.push(frame);
        idx = buf.indexOf('\n\n');
      }
      return out;
    },
    flush() {
      const rest = buf;
      buf = '';
      const frame = rest.trim() ? parseFrame(rest) : null;
      return frame ? [frame] : [];
    },
  };
}
