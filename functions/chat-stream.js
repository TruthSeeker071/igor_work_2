// FlightWay — Marco's streaming transport (WS-D slice D6).
//
// Same turn as `/chat`, different wire. `runChatTurn` owns every gate, prompt,
// sidecar and write; this file only decides how the result reaches the browser:
//
//   data: {"delta":"…"}                 prose, as the model produces it
//   event: control\ndata: {…payload}    the full `/chat` JSON, once, at the end
//   event: error\ndata: {status,error}  a failure the client renders as usual
//
// Two properties the client depends on:
//  1. The control frame is AUTHORITATIVE, not additive. Its `reply` replaces
//     whatever the deltas painted, so the FW_UI strip, markdown parse and
//     chip render all happen exactly once, on final text.
//  2. Every failure is a frame, never a status code. The response headers are
//     committed the moment streaming starts, so a 429 cap or a dead upstream
//     arrives as `event: error` carrying the status it would have had.
//
// A client that cannot stream (or hits this before it deploys) falls back to
// `/chat` transparently — see `coachSendStreaming` in assets/js/coach/coach.js.

import { originFromEnv } from './_lib.js';
import { authPreflight, authJsonResponse } from './_lib/auth.js';
import { createStreamProseGate } from './_lib/marco-ui.js';
import { sseEncode } from './_lib/sse.js';
import { runChatTurn } from './chat.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

function sseHeaders(origin) {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Cloudflare buffers a response it thinks it can compress; a stream that
    // arrives all at once is not a stream.
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function onRequestPost(context) {
  const origin = originFromEnv(context.env, context.request);

  // A body we cannot even read is worth a real status code: nothing has been
  // committed yet, and the client's fallback wants to know this was a request
  // problem, not a transport one.
  if (!context.request.body) {
    return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (frame) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          open = false; // the client hung up; the turn still finishes its writes
        }
      };

      const gate = createStreamProseGate();
      send(sseEncode('open', { ok: true }));

      try {
        const { status, payload } = await runChatTurn(context, {
          onDelta(text) {
            const prose = gate(text);
            if (prose) send(sseEncode(null, { delta: prose }));
          },
        });
        if (status >= 400) {
          send(sseEncode('error', { status, ...payload }));
        } else {
          send(sseEncode('control', payload));
        }
      } catch (err) {
        console.error('chat-stream failed', err && err.stack ? err.stack : err);
        send(sseEncode('error', {
          status: err?.status || 500,
          error: err?._userFacing ? err.message : 'Something went wrong. Please try again.',
        }));
      } finally {
        open = false;
        try {
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders(origin) });
}
