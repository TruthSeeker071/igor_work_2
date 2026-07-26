// FlightWay 2.0 — one-click unsubscribe token (Pillar B2).
// Deterministic peppered SHA-256 of the email, so the cron worker can build the
// link, notify-prefs can store it, and unsubscribe can verify it — all without
// storing a per-user secret. Pure (Web Crypto only) so the standalone cron Worker
// can import it too. Same recipe family as session hashing.

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// S2: the fallback chain below is a correctness bug the moment two DIFFERENT
// deploy targets take two different branches of it — and that is exactly the
// live state today. The Pages projects have SESSION_PEPPER but no UNSUB_SECRET,
// so they mint tokens from the pepper; the standalone cron Worker has neither,
// so it mints them from the committed constant. The cron builds the unsubscribe
// link, Pages verifies it, and they disagree — every unsubscribe link in the
// weekly digest 403s, which is a CAN-SPAM problem, not a cosmetic one.
//
// The code cannot fix that (only Jacob can set the env var in all three stores),
// but it must stop HIDING it. Warned once per isolate: this runs per-recipient
// inside the cron's send loop, and a warning repeated 200 times is a warning
// nobody reads.
let warnedUnsubFallback = false;

export function unsubSecret(env) {
  const explicit = env && env.UNSUB_SECRET;
  if (explicit) return explicit;
  if (!warnedUnsubFallback) {
    warnedUnsubFallback = true;
    console.warn(
      'UNSUB_SECRET is not set — falling back to '
      + (env && env.SESSION_PEPPER ? 'SESSION_PEPPER' : "the committed constant 'flightway-unsub'")
      + '. Unsubscribe links only verify if EVERY target (both Pages projects AND '
      + 'the flightway-cron Worker) resolves to the same value. Run `npm run verify:env`.',
    );
  }
  return (env && env.SESSION_PEPPER) || 'flightway-unsub';
}

export async function unsubToken(email, env) {
  return sha256Hex(String(email).toLowerCase().trim() + '|' + unsubSecret(env));
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
