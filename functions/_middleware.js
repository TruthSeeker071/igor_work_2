// FlightWay — refuse to serve from an unconfigured environment.
//
// Both Pages projects build public preview deployments of the OTHER project's
// branch. So `flightway` (-> flightway.ai) publishes a preview of Jacob_Work on
// every push, at a stable, public, un-access-controlled alias:
//
//   https://jacob-work.flightway.pages.dev
//
// That host inherits the PRODUCTION D1 binding — and deleting the binding from
// wrangler.toml does NOT take it away. That was verified, not assumed: after the
// top-level [[d1_databases]] block was removed, the next preview deployment still
// answered /auth/login out of flightway-db. The binding also lives in the
// project's dashboard config, and for a Git-integrated build that is what wins.
//
// Meanwhile the preview gets NONE of [env.production.vars] and none of the
// secrets, so that public host was serving live user data with:
//
//   - PAYWALL_ENABLED unset  -> entitlements.js ships dark, every account
//                               resolves to premium, every cap inert
//   - SESSION_PEPPER unset   -> session tokens hashed with the constant fallback
//                               in _lib/auth.js, which is committed to this repo
//
// The binding cannot be revoked from inside the repo, so the app declines to run
// instead. SESSION_PEPPER is the right marker precisely because it is a per-project
// SECRET: it is set on both production environments and on no preview environment,
// so its absence means "this build was never configured" and can never mean "this
// is production". Failing closed is also correct on its own terms — without that
// secret every session token here is hashed with a public constant, so there is no
// version of this environment that should be accepting traffic.
//
// This is defence in depth, NOT the fix. The fix is to stop the production project
// building previews at all: Pages -> flightway -> Settings -> Builds & deployments
// -> Preview deployments. Until that is done, this is what closes the hole.
//
// ---------------------------------------------------------------------------
// S2 (V2 D23) — HOST LOCKDOWN.
//
// Everything above is about a host that should not be answering at all. This
// second layer is about the hosts that legitimately answer but must never be
// indexed: flightwayjacobprototype.pages.dev, every per-commit preview alias,
// and jacob-work.flightway.pages.dev. They serve a byte-identical copy of the
// product, so left alone Google indexes them as duplicate content, splits the
// ranking signal, and can surface the prototype above flightway.ai.
//
// The rule is a whitelist, not a blacklist: exactly one host is indexable, and
// EVERY other host — including hosts that do not exist yet — is noindex. That
// direction matters. A blacklist of known pages.dev hosts would have to be
// edited every time Cloudflare invents a new alias shape; this cannot go stale.
//
// It ships as a response HEADER rather than a <meta> tag because the header
// covers non-HTML too (the JSON APIs, sitemap.xml, and — until the function
// below shadows it — robots.txt), and because a header cannot be forgotten on
// a new page the way a meta tag can. `/robots.txt` (functions/robots.txt.js)
// serves Disallow-all on the same hosts; the two are independent on purpose:
// robots.txt asks a crawler not to FETCH, X-Robots-Tag tells one that already
// fetched not to INDEX, and a page reachable by an external link needs both.
//
// The whitelist itself lives in _lib/host.js so this file, robots.txt.js and
// the verify:meta gate all read one definition.
import { shouldNoindexHost } from './_lib/host.js';

export async function onRequest(context) {
  const { env, next, request } = context;

  if (!env || !env.SESSION_PEPPER) {
    return new Response(
      JSON.stringify({
        error: 'This deployment is not configured and is not available.',
        errorCode: 'unconfigured_environment',
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          // A host that should not exist must never be indexed while it does.
          'X-Robots-Tag': 'noindex, nofollow',
        },
      },
    );
  }

  const res = await next();

  // This middleware sits in front of EVERY request on the site, static assets
  // included. It must therefore be incapable of breaking one. Anything the
  // header rewrite could throw on — a 101 upgrade, a 204/304 that must not be
  // reconstructed with a body, a response whose headers are locked — falls
  // through to the original response untouched.
  let hostname = '';
  try { hostname = new URL(request.url).hostname; } catch (_) { hostname = ''; }
  if (!shouldNoindexHost(hostname)) return res;
  if (!res || res.webSocket || res.status === 101) return res;

  try {
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  } catch (err) {
    console.warn('host-noindex: could not tag response', err?.message || err);
    return res;
  }
}
