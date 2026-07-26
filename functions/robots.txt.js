// FlightWay — per-host robots.txt (V2 S2, decision D23).
//
// This REPLACES the static /robots.txt, which was committed at the repo root and
// therefore served the same `Allow: /` from every host the site answers on —
// including flightwayjacobprototype.pages.dev, which was verified live as fully
// crawlable. A static file cannot know which host it is being fetched from, so
// there is no version of it that says "index the real site, ignore the clones".
//
// One host is indexable. Every other host — the prototype, every per-commit
// preview alias, and any host Cloudflare invents later — gets Disallow-all,
// permanently, with no list to maintain. The whitelist lives in _middleware.js
// (`isCanonicalHost`) so the header and this file can never disagree.
//
// robots.txt and the X-Robots-Tag header from _middleware.js are deliberately
// BOTH shipped: this file asks a crawler not to fetch, the header tells one that
// already fetched (via an external link, which robots.txt cannot prevent) not to
// index. Neither alone closes the hole.
//
// Note what is NOT disallowed here: the app-shell pages. They carry
// `<meta name="robots" content="noindex">` instead, and a crawler must be
// allowed to FETCH a page in order to see that tag. Disallowing them would
// strand their URLs in the index with no content — strictly worse.
import { isCanonicalHost } from './_lib/host.js';

// Internal repo paths. Already 302'd in _redirects; repeated here so a crawler
// never spends a fetch discovering that.
const INTERNAL = ['/docs/', '/scripts/', '/migrations/', '/workers/', '/node_modules/', '/.github/'];

// AI crawlers and the training/answer-engine control tokens, allowed on purpose
// (D20: AI search is a first-class channel for this product, not a leak).
// Grouped under one set of rules — robots.txt lets several User-agent lines
// share a group, and a named group REPLACES the `*` group for that agent, so
// the Disallow lines have to be repeated rather than inherited.
const AI_AGENTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
];

function canonicalRobots() {
  const disallow = INTERNAL.map((p) => `Disallow: ${p}`).join('\n');
  return [
    '# https://flightway.ai/robots.txt — served by functions/robots.txt.js',
    '',
    'User-agent: *',
    'Allow: /',
    disallow,
    '',
    '# AI crawlers and answer engines are welcome (see /llms.txt).',
    AI_AGENTS.map((a) => `User-agent: ${a}`).join('\n'),
    'Allow: /',
    disallow,
    '',
    'Sitemap: https://flightway.ai/sitemap.xml',
    '',
  ].join('\n');
}

function lockedRobots(hostname) {
  return [
    `# ${hostname} is not the canonical FlightWay site.`,
    '# The canonical site is https://flightway.ai — index that one instead.',
    '',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  let hostname = '';
  try { hostname = new URL(request.url).hostname; } catch (_) { hostname = ''; }

  // Fail CLOSED. An unparseable host is not a reason to hand out an allow-all.
  const canonical = isCanonicalHost(hostname);
  const body = canonical ? canonicalRobots() : lockedRobots(hostname || 'This host');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Short on the locked hosts: if this ever has to change, a stale allow
      // sitting in a CDN cache is the only outcome that actually costs anything.
      'Cache-Control': canonical ? 'public, max-age=3600' : 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
