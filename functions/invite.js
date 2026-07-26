// FlightWay V2 S15 — GET /invite, the outreach kit (plan §5 S15).
//
// Two audiences on one page, which is why it is a Function and not an app shell:
//   · a student who wants their link and something to paste into a group chat;
//   · Igor and Leo, doing manual outreach, who need per-channel links so the
//     Sources panel can tell an Instagram bio from a class Discord.
//
// Server-rendered with the same shell the /careers and /guides pages use, so it
// inherits the nav, the footer and the theme without a second copy of any of it.
// `noindex`: it is a signed-in tool with a personal link on it, not a marketing
// page — nothing here should ever be a search result.
//
// Every number and every URL on the page comes from GET /referral. Nothing is
// hard-coded client-side (§3 rule 11), including the yearly credit ceiling.

import { shell } from './_lib/career-page.js';
import { MAX_CREDITS_PER_YEAR } from './_lib/referral.js';

const CSS = `
.inv-wrap{max-width:820px;margin:0 auto;padding:56px 20px 96px}
.inv-lede{font-size:1.05rem;line-height:1.7;color:var(--fw-ink-dim,#8a93ac);max-width:60ch}
.inv-linkbox{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:24px 0 8px;padding:16px;
  border:1px solid var(--fw-line,#26365f);border-radius:14px}
.inv-link{flex:1 1 260px;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95rem;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inv-note{font-size:.88rem;color:var(--fw-ink-dim,#8a93ac);margin:0 0 28px}
.inv-stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:0 0 36px;padding:0;list-style:none}
.inv-stat{font-size:.92rem}
.inv-stat b{font-size:1.4rem;display:block;line-height:1.2}
.inv-steps{display:grid;gap:12px;margin:0 0 40px;padding:0;list-style:none;counter-reset:inv}
.inv-steps li{counter-increment:inv;padding-left:38px;position:relative;line-height:1.6}
.inv-steps li::before{content:counter(inv);position:absolute;left:0;top:0;width:26px;height:26px;
  border-radius:50%;border:1px solid var(--fw-line,#26365f);display:grid;place-items:center;
  font-size:.8rem;font-weight:700}
.inv-blurb{border:1px solid var(--fw-line,#26365f);border-radius:14px;padding:18px;margin:0 0 14px}
.inv-blurb h3{margin:0 0 4px;font-size:1rem}
.inv-chan{font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--fw-ink-dim,#8a93ac);margin:0 0 10px}
.inv-text{white-space:pre-wrap;font-size:.95rem;line-height:1.65;margin:0 0 12px}
.inv-copy{cursor:pointer}
.inv-copy[disabled]{opacity:.5;cursor:default}
`;

/**
 * The paste-ready blurbs. `{{LINK}}` is replaced client-side with this user's
 * per-channel link, `{{PROMO}}` with the free-month sentence — but ONLY when the
 * deployment actually has STRIPE_REFERRAL_PROMO_ID set. A blurb that promises a
 * free month on a deployment that cannot grant one is a lie the user tells their
 * friends on our behalf, so the placeholder collapses to nothing instead.
 *
 * Channel keys become `utm_content` via /r/<code>?c=<key>.
 */
const BLURBS = [
  {
    channel: 'dm', label: 'One friend, direct message',
    title: 'Short enough to actually send',
    text: 'ok this is the first career thing I\'ve used that actually explains itself — it scores you against real occupation data and then shows you the factor-by-factor reason for every match, instead of just naming a job. takes about 90 seconds.{{PROMO}}\n{{LINK}}',
  },
  {
    channel: 'groupchat', label: 'Group chat / class chat',
    title: 'For the "what are you even doing after graduation" thread',
    text: 'for anyone still deciding: FlightWay does a ~90 second quiz and then gives you a week-by-week plan for the path you pick, not just a personality label. the match explanations are the actually useful part.{{PROMO}}\n{{LINK}}',
  },
  {
    channel: 'social', label: 'Instagram story / TikTok caption / bio',
    title: 'Short caption + link sticker',
    text: 'took a career quiz that shows its work instead of just naming a job 😭 it breaks down exactly which parts of how you work line up and which don\'t{{PROMO}}\n{{LINK}}',
  },
  {
    channel: 'email', label: 'Email a friend (or a younger sibling)',
    title: 'A little more context',
    text: 'Thought of you — FlightWay is a career tool built for students. You answer about 90 seconds of questions, it scores you against real occupation data, and then it explains, factor by factor, why each match fits. If you pick one, it builds the week-by-week plan and keeps chasing you on it.\n\nIt\'s the "explains itself" part that made it worth sending.{{PROMO}}\n\n{{LINK}}',
  },
  {
    channel: 'club', label: 'Club Discord / Slack / listserv',
    title: 'For a club or org channel',
    text: 'Sharing for anyone doing recruiting prep or still picking a direction: FlightWay scores you against real occupation data, explains each match factor by factor, and turns the one you pick into a weekly plan with real application deadlines attached.{{PROMO}}\n{{LINK}}',
  },
  {
    channel: 'counselor', label: 'Career center / advisor outreach',
    title: 'For someone who advises students',
    text: 'Hi — I wanted to flag a tool my students have found useful. FlightWay is a career-development app for undergrads: it scores a student against O*NET occupation data, shows the reasoning behind every match rather than just the result, and then produces a week-by-week development plan they can actually work through. It\'s free to try.\n\nHappy to walk through what it looks like from a student\'s side.\n{{LINK}}',
  },
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Newlines travel through the data attribute as the two characters `\` and `n`
 * and are expanded in JS. An attribute is not the place to rely on literal
 * newline round-tripping, and the alternative — a second copy of every blurb in
 * a JSON island — is a second thing to keep in sync.
 *
 * The VISIBLE text is rendered with the placeholders already resolved to
 * something readable, so the page is never briefly showing `{{LINK}}` to
 * somebody on a slow connection.
 */
function blurbHtml(b, i) {
  const preview = b.text.split('{{PROMO}}').join('').split('{{LINK}}').join('flightway.ai/r/your-code');
  const raw = b.text.split('\n').join('\\n');
  return `<article class="inv-blurb">
    <p class="inv-chan">${esc(b.label)}</p>
    <h3>${esc(b.title)}</h3>
    <p class="inv-text" id="inv-text-${i}" data-inv-raw="${esc(raw)}" data-inv-channel="${esc(b.channel)}">${esc(preview)}</p>
    <button type="button" class="cg-btn cg-btn--ghost inv-copy" data-inv-copy="${i}" disabled>Copy</button>
  </article>`;
}

const SCRIPT = `
(function(){
  var PROMO = ' Your first month is free through my link.';
  var state = null;
  function byId(id){ return document.getElementById(id); }
  function render(){
    var link = byId('inv-link');
    var note = byId('inv-note');
    var copyBtn = byId('inv-copy-link');
    if (!state || !state.enabled) {
      link.textContent = state && state.signedOut ? 'Sign in to get your invite link' : (state && state.note) || 'Invites are not switched on yet.';
      note.textContent = state && state.signedOut ? 'Your link is tied to your account, so it only exists once you have one.' : '';
      return;
    }
    link.textContent = state.link;
    copyBtn.disabled = false;
    var bits = [];
    if (!state.verified) bits.push('Confirm your email address before a credit can be issued to you.');
    if (!state.promoConfigured) bits.push('The free-month offer for your friend is not switched on for this deployment yet — your credit still is.');
    bits.push('Up to ' + state.maxPerYear + ' credited invites a year.');
    note.textContent = bits.join(' ');
    var s = byId('inv-stats');
    s.hidden = false;
    byId('inv-joined').textContent = state.signedUp + state.converted + state.credited;
    byId('inv-subscribed').textContent = state.converted + state.credited;
    byId('inv-credited').textContent = state.credited;
    document.querySelectorAll('[data-inv-copy]').forEach(function(btn){ btn.disabled = false; });
    document.querySelectorAll('[data-inv-raw]').forEach(function(el){
      var chan = el.getAttribute('data-inv-channel') || '';
      var url = state.link + '?to=quiz&c=' + encodeURIComponent(chan);
      el.textContent = el.getAttribute('data-inv-raw')
        .split('\\\\n').join('\\n')
        .split('{{PROMO}}').join(state.promoConfigured ? PROMO : '')
        .split('{{LINK}}').join(url);
    });
  }
  function flash(btn, msg){
    var was = btn.textContent; btn.textContent = msg;
    setTimeout(function(){ btn.textContent = was; }, 1600);
  }
  function copy(text, btn){
    var done = function(){ flash(btn, 'Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function(){ flash(btn, 'Press Ctrl+C'); });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch(e) { flash(btn, 'Press Ctrl+C'); }
    ta.remove();
  }
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-inv-copy], #inv-copy-link');
    if (!btn || btn.disabled) return;
    var idx = btn.getAttribute('data-inv-copy');
    var text = idx == null ? (state && state.link) : (byId('inv-text-' + idx) || {}).textContent;
    if (!text) return;
    copy(text, btn);
    try { if (window.FWEvents) FWEvents.log('referral_copy', { channel: idx == null ? 'link' : (byId('inv-text-' + idx).getAttribute('data-inv-channel') || 'blurb') }); } catch(_){}
  });
  fetch('/referral', { credentials: 'include' }).then(function(r){
    if (r.status === 401) { state = { enabled: false, signedOut: true }; render(); return null; }
    return r.json();
  }).then(function(j){ if (j) { state = j; render(); } }).catch(function(){
    state = { enabled: false, note: 'Could not load your invite link. Reload the page.' };
    render();
  });
})();
`;

export async function onRequestGet(context) {
  const main = `<main class="inv-wrap">
  <h1>Invite a friend — you both get a month</h1>
  <p class="inv-lede">FlightWay grows by word of mouth from students who found it useful, not by ads. If that is you: this is your link, and below it is everything you would otherwise have to write yourself.</p>

  <div class="inv-linkbox">
    <span class="inv-link" id="inv-link">Loading your link…</span>
    <button type="button" class="cg-btn inv-copy" id="inv-copy-link" disabled>Copy link</button>
  </div>
  <p class="inv-note" id="inv-note"></p>

  <ul class="inv-stats" id="inv-stats" hidden>
    <li class="inv-stat"><b id="inv-joined">0</b>joined through your link</li>
    <li class="inv-stat"><b id="inv-subscribed">0</b>subscribed</li>
    <li class="inv-stat"><b id="inv-credited">0</b>months credited to you</li>
  </ul>

  <h2>How it works</h2>
  <ol class="inv-steps">
    <li>You send your link. Anyone who opens it lands on FlightWay with your invite attached for 30 days.</li>
    <li>They make an account and use it. Nothing is owed yet, and nothing is charged to them.</li>
    <li>If they subscribe, their first month is free — and a month of credit lands on your account automatically, coming off your next invoice.</li>
    <li>Up to ${MAX_CREDITS_PER_YEAR} credited invites a year. Both accounts need a confirmed email address, and inviting yourself does not count.</li>
  </ol>

  <h2>Things you can paste</h2>
  <p class="inv-lede">Each one carries your link with its own tag, so you can see which channel actually worked. Edit them — they read better in your own words.</p>
  ${BLURBS.map(blurbHtml).join('\n')}

  <script>${SCRIPT}</script>
</main>`;

  return new Response(shell({
    title: 'Invite a friend — FlightWay',
    description: 'Your FlightWay invite link, plus paste-ready messages for a DM, a group chat, a story, an email or a club channel.',
    canonicalPath: '/invite',
    noindex: true,
    css: CSS,
    main,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, follow',
    },
  });
}
