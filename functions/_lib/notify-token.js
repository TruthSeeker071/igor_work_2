// FlightWay 2.0 — one-click unsubscribe token (Pillar B2).
// Deterministic peppered SHA-256 of the email, so the cron worker can build the
// link, notify-prefs can store it, and unsubscribe can verify it — all without
// storing a per-user secret. Pure (Web Crypto only) so the standalone cron Worker
// can import it too. Same recipe family as session hashing.

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function unsubSecret(env) {
  return (env && (env.UNSUB_SECRET || env.SESSION_PEPPER)) || 'flightway-unsub';
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
