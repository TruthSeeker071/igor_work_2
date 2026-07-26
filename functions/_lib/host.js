// FlightWay — which host is the real one (V2 S2, decision D23).
//
// One host is indexable and every other host is not. That single fact is read
// by three places that must never disagree: the middleware's X-Robots-Tag
// header, /robots.txt, and the verify:meta gate. It lives here rather than in
// _middleware.js so a route file never has to import the middleware — files
// beginning with `_` are importable, but a normal function importing the thing
// that wraps it is the kind of unusual-but-legal arrangement this repo has
// been bitten by before in a build path that cannot be tested offline.
//
// The rule is a WHITELIST, not a blacklist. flightwayjacobprototype.pages.dev,
// jacob-work.flightway.pages.dev and every per-commit preview alias serve a
// byte-identical copy of the product; a blacklist would need editing every time
// Cloudflare invents a new alias shape, and would be wrong by default for hosts
// that do not exist yet. This cannot go stale.
export const CANONICAL_HOST = 'flightway.ai';

/** The one host allowed to be indexed. `www.` included so a DNS change cannot silently deindex prod. */
export function isCanonicalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === CANONICAL_HOST || h === `www.${CANONICAL_HOST}`;
}

/** Local dev is unreachable by a crawler; tagging it would only make local output differ from prod. */
export function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0' || h.endsWith('.localhost');
}

/**
 * Fails CLOSED: an empty or unparseable host is not canonical, so it is tagged.
 * The opposite default would mean one malformed URL is enough to hand a crawler
 * an indexable copy of the prototype, which is the whole thing this prevents.
 */
export function shouldNoindexHost(hostname) {
  return !isCanonicalHost(hostname) && !isLocalHost(hostname);
}
