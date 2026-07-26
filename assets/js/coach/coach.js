const COACH_CHAT_EP    = '/chat';
const COACH_DOSSIER_EP = '/dossier';
const COACH_RESET_AT   = 5;

let coachUserId = null;
let coachSending = false;
let coachPendingStarter = '';
let coachPostSignupTarget = 'coach';
let coachAuthReady = false;
// Rail sections are owned by slice: D1 fills focus + profile, D4 fills
// deadlines, D3 fills topics. Each renders only when it has real data — an
// empty rail card is worse than a shorter rail. Declared up here because the
// empty-state and rail renderers both read them before their own definitions.
let coachDossierText = '';
const coachRailState = { focus: null, deadlines: [], topics: [] };

// Display gate (WS3): server/browser error text never reaches the UI unless
// FWErr marked it user-facing.
function fwRespError(resp, data, fallback) {
  return window.FWErr
    ? FWErr.fromResponse(resp ? resp.status : 0, data, fallback)
    : new Error(fallback);
}

function coachSyncUserFromAuth() {
  coachUserId = (window.FWAuth && FWAuth.authEmail()) || null;
}

function coachEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Marco's face. FWBrand owns the mark; this only frames it, so the bird stays
// one asset across the nav, the hub chip and every message avatar.
function coachMarkHtml() {
  return (window.FWBrand && typeof FWBrand.icon === 'function') ? FWBrand.icon() : '';
}

function coachPaintMark(el) {
  if (el && !el.firstChild) el.innerHTML = coachMarkHtml();
}

function coachPortalUrl() {
  return (window.FWPageBoot && FWPageBoot.URLS.portal) || 'portal.html';
}

function coachAuthUrl() {
  return (window.FWPageBoot && FWPageBoot.authSignInUrl)
    ? FWPageBoot.authSignInUrl('coach.html')
    : 'auth.html#signin?next=' + encodeURIComponent('coach.html');
}

function isCoachPage() {
  return !!(document.body && document.body.classList.contains('coach-page'))
    || !!document.getElementById('page-coach');
}

function coachLoadHubQuiz(){
  try {
    const data = (window.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null;
    if (data && data.scores && typeof data.scores === 'object') return data;
  } catch(_) {}
  return null;
}

function coachHasQuizContext(){
  try {
    const hub = coachLoadHubQuiz();
    if (hub && Object.values(hub.scores).some(v => Number(v) > 0)) return true;
    const sc = (typeof qzComputeScores === 'function') ? qzComputeScores() : {};
    return Object.values(sc).some(v => v > 0);
  } catch(_) { return false; }
}

function coachBootPage() {
  if (!coachUserId) {
    if (coachHasQuizContext()) {
      coachOpenSignup();
      coachNotifyPageVeil();
    } else {
      window.location.replace(coachAuthUrl());
      // no veil notify — keep the veil up through the redirect
    }
    return;
  }
  coachNotifyPageVeil();
  document.getElementById('coach-user-email').textContent = coachUserId;
  coachPaintMark(document.getElementById('coach-mark'));
  const chatEl = document.getElementById('coach-chat');
  Array.from(chatEl.querySelectorAll('.coach-turn, .coach-typing, .coach-day')).forEach(function (n) { n.remove(); });
  coachLastDay = ''; coachLastRole = '';
  coachRenderEmptyState();
  coachSetProgress(0);
  coachBootUsageChip();
  document.getElementById('coach-error').textContent = '';
  // Both are decoration around the conversation — never awaited, never fatal.
  coachLoadRailContext();
  coachPrimeDossier();
  coachLoadDeadlines();
  try {
    const starter = sessionStorage.getItem('fw_marco_starter');
    if (starter) {
      sessionStorage.removeItem('fw_marco_starter');
      coachAppendMsg('assistant', starter);
      // Send along with the first message so the server transcript contains
      // Marco's opener — otherwise his first reply has no idea what the
      // bubble line referred to.
      coachPendingStarter = starter;
    }
  } catch (_) {}
  try {
    const userPrompt = sessionStorage.getItem('fw_marco_user_prompt');
    if (userPrompt) {
      sessionStorage.removeItem('fw_marco_user_prompt');
      const input = document.getElementById('coach-input');
      if (input) input.value = userPrompt;
      setTimeout(function () { coachSend(); }, 120);
      return;
    }
  } catch (_) {}
  setTimeout(function () { document.getElementById('coach-input').focus(); }, 200);
  if (window.FWAppNav) FWAppNav.sync('advisor');
}

function coachInit(){
  const finishBoot = function(){
    coachSyncUserFromAuth();
    if (window.FWAuthNav && typeof FWAuthNav.sync === 'function') FWAuthNav.sync();
    if (isCoachPage()) {
      coachBootPage();
      document.documentElement.removeAttribute('data-boot-page');
    } else if (typeof qzBootFromHash === 'function' && qzBootFromHash()) {
      document.documentElement.removeAttribute('data-boot-page');
    }
    coachAuthReady = true;
  };

  if (window.FWAuth && typeof FWAuth.authBoot === 'function') {
    FWAuth.authBoot().then(function(){
      finishBoot();
    }).catch(function(err){
      console.warn('auth boot failed', err);
      finishBoot();
    });
  } else {
    finishBoot();
  }

  if (window.addEventListener) {
    window.addEventListener('fw-auth-change', function(){
      coachSyncUserFromAuth();
      if (window.FWAuthNav && typeof FWAuthNav.sync === 'function') FWAuthNav.sync();
    });
  }
}

// Boot-veil hook: the coach page reveals once the authed chat shell (or the
// signup gate) has rendered — FWPageVeil handles quiet-window + failsafes.
function coachNotifyPageVeil(){
  if (window.FWPageVeil && typeof FWPageVeil.notifyRender === 'function') {
    FWPageVeil.notifyRender();
  }
}

function coachSetUser(userId){
  coachUserId = userId;
  if (window.FWAuthNav && typeof FWAuthNav.sync === 'function') FWAuthNav.sync();
}

function coachClearUser(){
  coachUserId = null;
  if (window.FWAuthNav && typeof FWAuthNav.sync === 'function') FWAuthNav.sync();
}

/* ─── Skip-email & results-page integration ─────────────────────────── */

// "Just show me my results" button — bypasses the email-send step entirely.
function qzSkipEmailToResults(){
  document.getElementById('qz-gate').classList.add('qz-hidden');
  qzShowResults();
}

/* ─── Dev shortcut: randomize all quiz answers and jump straight to results ─
   Fills every answer slot with valid random data so qzComputeScores() returns
   real numbers and the rest of the results pipeline works as if the user
   completed the quiz. Useful for testing the AI coach without taking the
   quiz repeatedly. */
function _qzRandInt(n){ return Math.floor(Math.random() * n); }
function _qzPick(arr){ return arr[_qzRandInt(arr.length)]; }
function _qzShuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = _qzRandInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function qzRandomizeAndShowResults(){
  if (typeof QZ_Qs === 'undefined') {
    var qzErrEl = document.getElementById('coach-error');
    if (qzErrEl) qzErrEl.textContent = 'Quiz data not loaded yet — try again in a moment.';
    else console.warn('Quiz data not loaded yet — try again in a moment.');
    return;
  }

  // Reset to known-good defaults first.
  qzAnswers = {pairs:{},tot:{},env:[],map:null,emoji:{},swipes:{},yesno:{},rank:{},spectrum:null,subjects:[],multi:{},mcOther:{}};
  qzSliders = {};
  qzAns = {};
  qzBudget = {salary:17,purpose:17,flex:16,growth:17,recog:16,security:17};
  qzGpa = null; qzSchool = null; qzSchoolMatch = null; qzStage = null; qzName = '';
  qzResumeText = null; qzResumeBoosts = {};
  qzPairsIdx = 0; qzSwipeIdx = 0; qzYesNoIdx = 0; qzTotIdx = 0;

  const FAKE_SCHOOLS = ['UCLA', 'NYU', 'Boston College', 'University of Michigan',
    'UT Austin', 'Northwestern', 'Stanford', 'Georgia Tech', 'UNC Chapel Hill'];

  QZ_Qs.forEach(q => {
    switch (q.type) {
      case 'cards': {
        const c = _qzPick(q.cards);
        qzStage = c.k;
        qzAnswers.stage = c.k;
        break;
      }
      case 'tags': {
        const picks = _qzShuffle(q.tags).slice(0, Math.max(q.min, 4 + _qzRandInt(3)));
        qzAnswers.subjects = picks.map(p => p.t);
        break;
      }
      case 'text': {
        if (q.key === 'school') qzSchool = _qzPick(FAKE_SCHOOLS);
        break;
      }
      case 'name': {
        qzName = _qzPick(['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie']);
        break;
      }
      case 'gpa': {
        // 3.0–4.0 in 0.01 steps, biased a bit toward higher values.
        qzGpa = Math.round((3.0 + Math.random() * 1.0) * 100) / 100;
        break;
      }
      case 'pairs': {
        q.pairs.forEach((_, i) => { qzAnswers.pairs[i] = Math.random() < 0.5 ? 'a' : 'b'; });
        break;
      }
      case 'tot': {
        q.cards.forEach((_, i) => { qzAnswers.tot[i] = Math.random() < 0.5 ? 'a' : 'b'; });
        break;
      }
      case 'vpicker': {
        const idxs = _qzShuffle(q.options.map((_, i) => i)).slice(0, q.pick);
        qzAnswers.env = idxs;
        break;
      }
      case 'mc': {
        qzAns[q.id] = _qzRandInt(q.opts.length);
        break;
      }
      case 'multi': {
        const cap = q.max || q.opts.length;
        const idxs = _qzShuffle(q.opts.map((_, i) => i)).slice(0, Math.max(q.min || 1, 1 + _qzRandInt(cap)));
        qzAnswers.multi[q.id] = idxs.slice(0, cap);
        break;
      }
      case 'sl': {
        qzSliders[q.key] = _qzRandInt(101);
        break;
      }
      case 'map2d': {
        qzAnswers.map = { x: _qzRandInt(101), y: _qzRandInt(101) };
        break;
      }
      case 'emoji': {
        q.rows.forEach((_, i) => { qzAnswers.emoji[i] = _qzRandInt(4); });
        break;
      }
      case 'dial': {
        qzSliders[q.key] = _qzRandInt(101);
        break;
      }
      case 'yesno': {
        q.items.forEach((_, i) => { qzAnswers.yesno[i] = Math.random() < 0.5 ? 'yes' : 'no'; });
        break;
      }
      case 'spec': {
        qzAnswers.spectrum = _qzRandInt(q.stops.length);
        break;
      }
      case 'swipe': {
        q.cards.forEach((_, i) => { qzAnswers.swipes[i] = Math.random() < 0.5; });
        break;
      }
      case 'rank': {
        qzAnswers.rank[q.id] = _qzShuffle(q.items.map((_, i) => i));
        break;
      }
      case 'budget': {
        // Defaults already sum to 100 and are valid; leave them.
        break;
      }
      default:
        console.warn('qzRandomize: unhandled question type', q.type, q);
    }
  });

  // Try to match the fake school to a real school object so school-specific
  // recommendations render. Falls back silently if QZ_SCHOOLS isn't loaded.
  try {
    if (Array.isArray(window.QZ_SCHOOLS) && qzSchool) {
      qzSchoolMatch = QZ_SCHOOLS.find(s =>
        s.name && s.name.toLowerCase().includes(qzSchool.toLowerCase())
      ) || QZ_SCHOOLS[_qzRandInt(QZ_SCHOOLS.length)] || null;
    }
  } catch (e) { /* non-fatal */ }

  // Hide intro & jump straight to results, mirroring the post-quiz flow.
  document.getElementById('qz-intro').classList.add('qz-hidden');
  document.getElementById('qz-quiz').classList.add('qz-hidden');
  const gateEl = document.getElementById('qz-gate');
  if (gateEl) gateEl.classList.add('qz-hidden');
  qzShowResults();
}

// Build a compact summary of the quiz results to seed the dossier.
function coachExtractQuizResults(){
  try {
    const hub = coachLoadHubQuiz();
    const sc = hub && hub.scores
      ? hub.scores
      : ((typeof qzComputeScores === 'function') ? qzNormalizeScores(qzComputeScores()) : {});
    const sorted = Object.entries(sc).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const topIndustries = sorted.map(([k]) => (window.QZ_IND && QZ_IND[k] && QZ_IND[k].name) || k);
    const recommendedMajors = [];
    sorted.forEach(([k]) => {
      const ind = window.QZ_IND ? QZ_IND[k] : null;
      if (ind && Array.isArray(ind.majors)) recommendedMajors.push(...ind.majors.slice(0,2));
    });
    return {
      topIndustries,
      recommendedMajors: Array.from(new Set(recommendedMajors)).slice(0,6),
      school: (typeof qzSchool !== 'undefined' && qzSchool) ? qzSchool : null,
      gpa: (typeof qzGpa !== 'undefined' && qzGpa !== null) ? qzGpa : null,
      strengths: [],
      weaknesses: [],
    };
  } catch(e){
    console.warn('coach: failed to extract quiz results', e);
    return {};
  }
}

// Add the coach-account card to the bottom of the rendered results.
function coachInjectResultsCard(){
  const card = document.getElementById('qz-rcard');
  if (!card) return;
  if (card.querySelector('.coach-results-card')) return; // already injected
  const wrap = document.createElement('div');
  wrap.className = 'coach-results-card';
  if (coachUserId){
    wrap.innerHTML = `
      <div class="coach-results-eye">Continue with your AI coach</div>
      <div class="coach-results-title">You're already signed in as ${String(coachUserId).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="coach-results-sub">Pick up the conversation where you left off — your coach remembers your dossier across sessions.</div>
      <div class="coach-results-actions">
        <button class="primary" onclick="coachOpenFromNav()">Open coach →</button>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="coach-results-eye">Want more than the quiz?</div>
      <div class="coach-results-title">Chat 1-on-1 with your AI career coach.</div>
      <div class="coach-results-sub">It already knows your quiz results. Ask about specific majors, classes, internships — anything. Free, takes 10 seconds to set up.</div>
      <div class="coach-results-actions">
        <button class="primary" onclick="coachOpenSignup()">Create free account →</button>
      </div>`;
  }
  card.appendChild(wrap);
}

// Wrap qzShowResults so the card is injected after the regular render.
if (typeof qzShowResults === 'function') {
  const _origQzShowResults = qzShowResults;
  qzShowResults = function(){
    _origQzShowResults.apply(this, arguments);
    setTimeout(coachInjectResultsCard, 50);
  };
}

/* ─── Signup modal ──────────────────────────────────────────────────── */

function coachOpenSignup(){
  const ov = document.getElementById('coach-signup-overlay');
  document.getElementById('coach-signup-error').textContent = '';
  const input = document.getElementById('coach-signup-email');
  const pw = document.getElementById('coach-signup-password');
  const pw2 = document.getElementById('coach-signup-password-confirm');
  input.value = ''; input.disabled = false;
  if (pw) pw.value = '';
  if (pw2) pw2.value = '';
  const signupBtn = document.getElementById('coach-signup-btn');
  if (window.FWButtonBusy) FWButtonBusy.stop(signupBtn);
  signupBtn.disabled = false;
  ov.classList.add('vis');
  setTimeout(()=>input.focus(), 80);
}
function coachCloseSignup(){
  document.getElementById('coach-signup-overlay').classList.remove('vis');
}
function coachSignupOverlayClick(e){
  if (e.target && e.target.id === 'coach-signup-overlay') coachCloseSignup();
}

async function coachSignup(opts){
  opts = opts || {};
  const input = opts.inputEl || document.getElementById('coach-signup-email');
  const pwInput = opts.pwInputEl || document.getElementById('coach-signup-password');
  const pwConfirm = opts.pwConfirmEl || document.getElementById('coach-signup-password-confirm');
  const errEl = opts.errEl || document.getElementById('coach-signup-error');
  const btn = opts.btnEl || document.getElementById('coach-signup-btn');
  // No btnLabel: FWButtonBusy captures and restores the button's own markup.
  const btnBusy = opts.btnBusy || 'Creating…';
  const email = (input.value||'').trim();
  const password = pwInput ? pwInput.value : '';
  const confirm = pwConfirm ? pwConfirm.value : '';
  errEl.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){
    errEl.textContent = 'Please enter a valid email address.';
    return;
  }
  if (!window.FWAuth || !FWAuth.isValidPassword(password)) {
    errEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    return;
  }
  input.disabled = true;
  if (pwInput) pwInput.disabled = true;
  if (pwConfirm) pwConfirm.disabled = true;
  const restoreBtn = window.FWButtonBusy ? FWButtonBusy.start(btn, { label: btnBusy }) : function () {};
  try {
    const hubQuiz = (window.FWAuthPages && FWAuthPages.loadHubQuiz)
      ? FWAuthPages.loadHubQuiz() : coachLoadHubQuiz();
    await FWAuth.authRegister(email, password, hubQuiz);
    coachSetUser(FWAuth.authEmail());
    coachCloseSignup();
    if (coachPostSignupTarget === 'portal') {
      window.location.href = coachPortalUrl();
      coachPostSignupTarget = 'coach';
    } else if (isCoachPage()) {
      coachBootPage();
    } else {
      window.location.href = (window.FWPageBoot && FWPageBoot.URLS.coach) || 'coach.html';
    }
  } catch(err){
    errEl.textContent = window.FWErr
      ? FWErr.forUser(err, 'Something went wrong. Please try again.')
      : 'Something went wrong. Please try again.';
    console.error('coachSignup failed:', err);
    input.disabled = false;
    if (pwInput) pwInput.disabled = false;
    if (pwConfirm) pwConfirm.disabled = false;
    restoreBtn();
  }
}

/* ─── Opening the Coach page ────────────────────────────────────────── */

function coachOpenFromNav(){
  if (!isCoachPage()) {
    window.location.href = (window.FWPageBoot && FWPageBoot.URLS.coach) || 'coach.html';
    return;
  }
  if (!coachUserId){
    if (coachHasQuizContext()) coachOpenSignup();
    else window.location.replace(coachAuthUrl());
    return;
  }
  coachBootPage();
}

// The 5-exchange dossier cadence, as a dial. r=16 → circumference 100.53, so
// the dash offset is (1 - fraction) * that.
const COACH_RING_C = 2 * Math.PI * 16;

function coachSetProgress(n){
  const el = document.getElementById('coach-memory');
  if (!el) return;
  const done = Math.max(0, Math.min(COACH_RESET_AT, Number(n) || 0));
  const offset = COACH_RING_C * (1 - done / COACH_RESET_AT);
  if (!el.firstChild) {
    el.innerHTML =
      '<svg viewBox="0 0 38 38" aria-hidden="true">'
      + '<circle class="ring-track" cx="19" cy="19" r="16"></circle>'
      + '<circle class="ring-fill" cx="19" cy="19" r="16"'
      + ' stroke-dasharray="' + COACH_RING_C.toFixed(2) + '"'
      + ' stroke-dashoffset="' + COACH_RING_C.toFixed(2) + '"></circle>'
      + '</svg><span class="coach-memory-num"></span>';
  }
  const fill = el.querySelector('.ring-fill');
  if (fill) fill.setAttribute('stroke-dashoffset', offset.toFixed(2));
  const num = el.querySelector('.coach-memory-num');
  if (num) num.textContent = String(done);
  const label = `Exchange ${done} of ${COACH_RESET_AT} — Marco updates what he remembers about you every ${COACH_RESET_AT} exchanges.`;
  el.setAttribute('aria-label', label);
  el.setAttribute('title', label);
}

/* ─── Empty state + context rail ────────────────────────────────────── */

// Three things Marco already knows, drawn from the dossier's `key: value`
// lines. Unknown/placeholder values are skipped rather than shown as
// "(unknown)" — a chip that admits it knows nothing teaches nothing.
// Each key owns a phrase, rather than a prefix glued onto a raw dossier value:
// `'Year' + ' ' + 'freshman'` reads "Year freshman", and `'Career' + ' ' +
// 'Quantitative Financial Analyst'` reads like a form label, not like something
// Marco knows about you. The chip should be a sentence fragment a person would
// say out loud.
const COACH_KNOWN_KEYS = [
  ['school', function (v) { return 'Studies at ' + v; }],
  ['year', function (v) { return coachSentenceCase(v) + ' year'; }],
  ['top_industries', function (v) { return 'Leaning toward ' + v; }],
  ['recommended_majors', function (v) { return 'Suggested major: ' + v; }],
  ['career_leaning', function (v) { return 'Targeting ' + v; }],
  ['goals', function (v) { return 'Goal: ' + v; }],
];

const COACH_FACT_MAX = 52;

function coachSentenceCase(s){
  const v = String(s || '').trim();
  if (!v) return v;
  // Leave an existing capital alone — "PhD" must not become "Phd".
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// Truncate on a word boundary with an ellipsis. Slicing at a fixed index gave
// chips like "complete CMSC sequence starting second qua".
function coachTrimWords(s, max){
  const v = String(s || '').trim().replace(/\s+/g, ' ');
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

function coachDossierFacts(dossier, limit){
  const out = [];
  const lines = String(dossier || '').split('\n');
  const byKey = {};
  lines.forEach(function (line) {
    const at = line.indexOf(':');
    if (at <= 0) return;
    byKey[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  });
  COACH_KNOWN_KEYS.forEach(function (pair) {
    if (out.length >= limit) return;
    const raw = byKey[pair[0]];
    if (!raw || /^\(/.test(raw)) return;
    // The dossier stores comma-separated lists; one value per chip reads
    // cleaner than a run-on, and the year often arrives as "freshman (2029)".
    const first = raw.split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!first) return;
    const value = coachTrimWords(first, COACH_FACT_MAX);
    if (!value) return;
    out.push(pair[1](value));
  });
  return out;
}

const COACH_STARTERS = [
  'What should I be doing this quarter to stay on track?',
  'Which of my top matches actually fits how I like to work?',
  'What is the weakest part of my profile right now?',
];

function coachRenderEmptyState(){
  const el = document.getElementById('coach-empty');
  if (!el) return;
  const facts = coachDossierFacts(coachDossierText, 3);
  el.hidden = false;
  el.innerHTML =
    '<span class="coach-empty-mark" aria-hidden="true">' + coachMarkHtml() + '</span>'
    + '<div><div class="coach-empty-title">Marco is caught up.</div>'
    + '<div class="coach-empty-line">He reads your profile before every reply, so skip the background '
    + 'and ask the real question. He will tell you when he is not sure.</div></div>'
    + (facts.length
      ? '<div><div class="coach-empty-label">He already knows</div><div class="coach-knows">'
        + facts.map(function (f) { return '<span class="coach-know-chip">' + coachEsc(f) + '</span>'; }).join('')
        + '</div></div>'
      : '')
    + '<div class="coach-starters">'
    + COACH_STARTERS.map(function (s) {
      return '<button type="button" class="coach-chip" data-coach-starter="' + coachEsc(s) + '">' + coachEsc(s) + '</button>';
    }).join('')
    + '</div>';
}

function coachRailCard(title, inner){
  return '<section class="coach-rail-card"><div class="coach-rail-title">' + coachEsc(title) + '</div>' + inner + '</section>';
}

function coachRenderRail(){
  const rail = document.getElementById('coach-rail');
  if (!rail) return;
  let html = '';

  const focus = coachRailState.focus;
  if (focus && focus.name) {
    html += coachRailCard('Current focus',
      '<div class="coach-focus-name">' + coachEsc(focus.name) + '</div>'
      + (Number.isFinite(focus.fit)
        ? '<span class="coach-focus-fit">' + Math.round(focus.fit) + '% fit</span>'
        : ''));
  }

  if (coachRailState.deadlines.length) {
    html += coachRailCard('Next deadlines',
      '<div class="coach-rail-list">' + coachRailState.deadlines.map(function (d) {
        const soon = Number.isFinite(d.daysOut) && d.daysOut <= 14;
        const when = !Number.isFinite(d.daysOut) ? ''
          : d.daysOut <= 0 ? 'today'
            : 'in ' + d.daysOut + (d.daysOut === 1 ? ' day' : ' days');
        const inner = '<span class="coach-deadline-name">' + coachEsc(d.title) + '</span>'
          + (when ? '<span class="coach-deadline-in' + (soon ? ' is-soon' : '') + '">' + coachEsc(when) + '</span>' : '');
        return /^https:\/\//i.test(d.url || '')
          ? '<a class="coach-deadline" href="' + coachEsc(d.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
          : '<div class="coach-deadline">' + inner + '</div>';
      }).join('') + '</div>');
  }

  if (coachRailState.topics.length) {
    html += coachRailCard('Worth asking about',
      '<div class="coach-starters">' + coachRailState.topics.map(function (t) {
        return '<button type="button" class="coach-chip" data-coach-starter="' + coachEsc(t) + '">' + coachEsc(t) + '</button>';
      }).join('') + '</div>');
  }

  const facts = coachDossierFacts(coachDossierText, 6);
  if (facts.length) {
    html += coachRailCard('What Marco is working from',
      '<div class="coach-knows">' + facts.map(function (f) {
        return '<span class="coach-know-chip">' + coachEsc(f) + '</span>';
      }).join('') + '</div>');
  }

  rail.innerHTML = html;
}

/* ─── Composer meters ───────────────────────────────────────────────── */

const COACH_MAX_CHARS = 2000;
const COACH_COUNT_AT = 1800;      // counter appears only near the wall

// "3 of 5 left today" — the free plan's allowance. WS-G: both numbers now come
// from FWPlanSurface, which reads the cap table the server actually enforces;
// the 5 used to be hardcoded here and would have gone stale the first time the
// cap was retuned. Unlimited plans (and an unknown counter) show nothing.
function coachSyncUsageChip(){
  const el = document.getElementById('coach-usage');
  if (!el) return;
  const a = (window.FWPlanSurface && typeof FWPlanSurface.allowance === 'function')
    ? FWPlanSurface.allowance('marco-chat') : null;
  if (!a) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = FWPlanSurface.allowanceText(a);
  el.classList.toggle('is-low', a.left <= 2);
}

// FWEnt.boot() only reads /auth/me when the paywall is live, so the counter is
// undefined on a dark-paywall build — that is the hidden case, not an error.
function coachBootUsageChip(){
  coachSyncUsageChip();
  if (window.FWEnt && typeof FWEnt.boot === 'function') {
    FWEnt.boot().then(coachSyncUsageChip).catch(function () { /* chip stays hidden */ });
  }
}

function coachSyncCharCount(){
  const input = document.getElementById('coach-input');
  const el = document.getElementById('coach-count');
  if (!input || !el) return;
  const used = (input.value || '').length;
  if (used < COACH_COUNT_AT) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = used + ' / ' + COACH_MAX_CHARS;
  el.classList.toggle('is-low', used >= COACH_MAX_CHARS - 50);
}

// Next deadlines (D4). `?cached=1` is the read-only half of the Opportunity
// Finder: it serves whatever the panel last produced and never spends a
// research call. Every miss — free plan (402), grounding off, panel never
// opened — resolves to an empty list and the rail card simply is not there.
// That emptiness is the correct behaviour, not a bug to paper over.
async function coachLoadDeadlines(){
  let data;
  try {
    const resp = await fetch('/opportunities?cached=1', { credentials: 'include' });
    if (!resp.ok) return;
    data = await resp.json();
  } catch (_) { return; }
  const list = Array.isArray(data && data.opportunities) ? data.opportunities : [];
  const upcoming = list
    .filter(function (o) { return o && o.title && o.deadline; })
    .map(function (o) {
      return { title: o.title, url: o.url || '', deadline: o.deadline, daysOut: coachDeadlineDays(o.deadline) };
    })
    .filter(function (o) { return Number.isFinite(o.daysOut) && o.daysOut >= 0; })
    .sort(function (a, b) { return a.daysOut - b.daysOut; })
    .slice(0, 3);
  if (!upcoming.length) return;
  coachRailState.deadlines = upcoming;
  coachRenderRail();
}

// One dossier read serves the empty state, the rail and the settings modal.
async function coachPrimeDossier(){
  try {
    const resp = await fetch(COACH_DOSSIER_EP, { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({}));
    coachDossierText = String(data.dossier || '');
  } catch (_) { return; }
  const empty = document.getElementById('coach-empty');
  if (empty && !empty.hidden) coachRenderEmptyState();
  coachRenderRail();
}

// Focus career + fit% from data already on the client: the v2 user object holds
// careerFocus, the roadmap holds the server-computed fit for that target.
async function coachLoadRailContext(){
  try {
    const blob = (window.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null;
    const focus = blob && blob.careerFocus ? blob.careerFocus : null;
    if (focus && focus.name) coachRailState.focus = { name: focus.name, fit: null };
  } catch (_) { /* rail is decoration; never block the chat */ }
  coachRenderRail();

  if (window.FWAuth && typeof FWAuth.getRoadmap === 'function') {
    try {
      const roadmap = await FWAuth.getRoadmap();
      if (roadmap && roadmap.targetCareerName) {
        const pct = roadmap.fitContext && Number(roadmap.fitContext.quizFitPercent);
        coachRailState.focus = {
          name: roadmap.targetCareerName,
          fit: Number.isFinite(pct) && pct > 0 ? pct : (coachRailState.focus && coachRailState.focus.fit) || null,
        };
        coachRenderRail();
      }
    } catch (_) { /* ignore */ }
  }
}

function coachRefreshRoadmapAfterUpdate(data) {
  if (!data) return;
  if (data.roadmapRateLimited) {
    if (window.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
      FWRoadmap.showToast('Roadmap update limit reached—try again in a few minutes.');
    }
    return;
  }
  if (data.roadmapUpdated) {
    if (window.FWAuth && typeof FWAuth.getRoadmap === 'function') {
      FWAuth.getRoadmap().catch(function () { /* ignore */ });
    }
    if (window.FWRoadmap) {
      if (typeof FWRoadmap.bootPending === 'function') FWRoadmap.bootPending();
      if (typeof FWRoadmap.render === 'function') FWRoadmap.render();
    }
  } else if (data.dossierUpdated && window.FWAuth && typeof FWAuth.syncRoadmap === 'function') {
    FWAuth.syncRoadmap({ reason: 'coach-dossier' }).then(function (sync) {
      if (sync && sync.roadmap && !sync.cached && window.FWRoadmap) {
        if (typeof FWRoadmap.render === 'function') FWRoadmap.render();
      }
    }).catch(function () { /* ignore */ });
  }
  if (data.roadmapUpdated && (data.roadmapRetargeted || data.roadmapUpdateType === 'regenerate')) {
    const banner = document.getElementById('coach-updating');
    if (banner) {
      banner.classList.add('vis');
      const sub = banner.querySelector('div:last-child');
      if (sub) sub.textContent = 'Career plan rebuilt — open Career Roadmap to review.';
      setTimeout(function () { banner.classList.remove('vis'); }, 3200);
    }
    if (window.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
      FWRoadmap.showToast('Your plan was updated to match your latest focus.');
    }
  } else if (data.roadmapUpdated && data.roadmapUpdateType === 'sync') {
    if (window.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
      FWRoadmap.showToast('Your roadmap was updated with your latest profile.');
    }
  } else if (data.roadmapUpdated && data.roadmapUpdateType === 'patch') {
    const banner = document.getElementById('coach-updating');
    if (banner) {
      banner.classList.add('vis');
      const sub = banner.querySelector('div:last-child');
      if (sub) sub.textContent = 'Roadmap updated — open Career Roadmap to review.';
      setTimeout(function () { banner.classList.remove('vis'); }, 3200);
    }
  }
}

function coachRefreshPortalAfterDossier() {
  if (window.FWAuth && typeof FWAuth.bumpDossierFingerprint === 'function') {
    FWAuth.bumpDossierFingerprint();
  }
  if (!window.FWAuth || typeof FWAuth.refreshPortalSnapshot !== 'function') return;
  FWAuth.refreshPortalSnapshot({ force: true })
    .then(function () {
      if (window.FWPortal && typeof FWPortal.render === 'function') FWPortal.render();
    })
    .catch(function () { /* ignore */ });
}

function coachApplySectorFit(data) {
  if (!data) return;
  if (data.sectorFitSheet && window.FWAuth && typeof FWAuth.applySectorFitFromResponse === 'function') {
    FWAuth.applySectorFitFromResponse(data);
  }
  if (data.personalityVector && window.FWAuth
    && typeof FWAuth.applyVectorsFromResponse === 'function') {
    FWAuth.applyVectorsFromResponse(data);
  }
  if (window.FWPortal && typeof FWPortal.render === 'function') FWPortal.render();
}

/* ─── Sending messages ──────────────────────────────────────────────── */

// Minimal, safe markdown renderer for assistant messages. Escapes all HTML
// first, then converts the small subset the coach is told to use: **bold**,
// *italic*, and simple "1." / "-" lists. No raw-HTML injection possible.
function coachRenderMarkdown(text){
  const esc = String(text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = esc.split('\n');
  let html = '', inList = null; // 'ol' | 'ul' | null
  const closeList = () => { if (inList){ html += `</${inList}>`; inList = null; } };
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  for (const raw of lines){
    const line = raw.trimEnd();
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-•]\s+(.*)$/);
    if (ol){
      if (inList !== 'ol'){ closeList(); html += '<ol>'; inList = 'ol'; }
      html += `<li>${inline(ol[2])}</li>`;
    } else if (ul){
      if (inList !== 'ul'){ closeList(); html += '<ul>'; inList = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
    } else if (line.trim() === ''){
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// Pillar W provenance UX: when a reply used live web evidence, show a quiet
// "as of <date>" line + source links under it. DOM-built (no innerHTML with
// server strings) — source titles/urls are untrusted web text.
function coachAppendSources(replyEl, data){
  if (!replyEl || !data || !data.grounded) return;
  const sources = Array.isArray(data.groundedSources) ? data.groundedSources : [];
  if (!sources.length) return; // no bare "Current as of" chip with nothing to cite
  const asOf = String(data.groundedAt || '').slice(0, 10);
  const line = document.createElement('div');
  line.className = 'coach-msg-sources';
  if (asOf) {
    const chip = document.createElement('span');
    chip.textContent = 'Current as of ' + asOf;
    line.appendChild(chip);
  }
  sources.slice(0, 4).forEach((s) => {
    const url = String((s && s.url) || '');
    if (!/^https?:\/\//i.test(url)) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = String((s && s.title) || url).slice(0, 60);
    line.appendChild(a);
  });
  replyEl.appendChild(line);
}

// Day dividers: the transcript lives server-side and is not replayed on load,
// so in practice this only fires when a session crosses midnight — but a chat
// that silently relabels "today" is exactly the kind of small lie that makes a
// product feel careless.
let coachLastDay = '';
let coachLastRole = '';

function coachDayKey(d){ return d.toISOString().slice(0, 10); }

function coachDayLabel(d){
  const today = coachDayKey(new Date());
  const key = coachDayKey(d);
  if (key === today) return 'Today';
  const yest = new Date(Date.now() - 86400000);
  if (key === coachDayKey(yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function coachTimeLabel(d){
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function coachMaybeDayDivider(chat, when){
  const key = coachDayKey(when);
  if (key === coachLastDay) return;
  coachLastDay = key;
  const div = document.createElement('div');
  div.className = 'coach-day';
  div.textContent = coachDayLabel(when);
  chat.appendChild(div);
}

function coachScrollToEnd(chat){
  chat.scrollTop = chat.scrollHeight;
}

// A turn is avatar + bubble + hover timestamp. Returns the bubble, because
// every caller that decorates a reply (sources, suggestion chips, thread
// cards) hangs its extras off the bubble, not the wrapper.
/* ─── Structured reply attachments (D2) ─────────────────────────────── */

// The server has already whitelisted card types, clamped every string and
// derived every href — nothing here is model-authored except the text, which
// goes in as textContent. This renders; it does not re-decide what is safe.
const COACH_CARD_ICON = {
  career: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  'roadmap-step': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  deadline: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
};

function coachCardIcon(type){
  const d = COACH_CARD_ICON[type] || COACH_CARD_ICON.link;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
}

function coachDeadlineDays(iso){
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

function coachBuildCards(cards){
  if (!Array.isArray(cards) || !cards.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'coach-cards';
  cards.forEach(function (c) {
    const href = String(c.href || '');
    const isLink = /^[a-z0-9-]+\.html(\?[\w=&.%-]*)?$/i.test(href);
    const row = document.createElement(isLink ? 'a' : 'div');
    row.className = 'coach-card-row';
    if (isLink) row.href = href;
    const days = c.date ? coachDeadlineDays(c.date) : null;
    row.innerHTML =
      '<span class="coach-card-icon" aria-hidden="true">' + coachCardIcon(c.type) + '</span>'
      + '<span class="coach-card-text">'
      + '<span class="coach-card-title"></span>'
      + (c.subtitle ? '<span class="coach-card-sub"></span>' : '')
      + '</span>'
      + (Number.isFinite(days)
        ? '<span class="coach-card-meta">' + (days <= 0 ? 'today' : 'in ' + days + (days === 1 ? ' day' : ' days')) + '</span>'
        : (c.meta ? '<span class="coach-card-meta"></span>' : ''));
    row.querySelector('.coach-card-title').textContent = c.title;
    const sub = row.querySelector('.coach-card-sub');
    if (sub) sub.textContent = c.subtitle;
    const meta = !Number.isFinite(days) ? row.querySelector('.coach-card-meta') : null;
    if (meta) meta.textContent = c.meta;
    wrap.appendChild(row);
  });
  return wrap;
}

function coachBuildSuggestions(suggestions){
  if (!Array.isArray(suggestions) || !suggestions.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'coach-suggests';
  suggestions.forEach(function (s) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'coach-chip';
    btn.setAttribute('data-coach-starter', s);
    btn.textContent = s;
    wrap.appendChild(btn);
  });
  return wrap;
}

// Deadline cards double as rail content — the reply mentions one, the rail
// keeps it in view. D4 fills the rail from the opportunities pipeline; this
// only tops it up with whatever the current reply surfaced.
function coachAbsorbDeadlineCards(cards){
  const fresh = (cards || []).filter(function (c) { return c.type === 'deadline' && c.date; });
  if (!fresh.length) return;
  const seen = {};
  coachRailState.deadlines.concat(fresh.map(function (c) {
    return { title: c.title, url: '', deadline: c.date, daysOut: coachDeadlineDays(c.date) };
  })).forEach(function (d) {
    const key = d.title + '|' + d.deadline;
    if (!seen[key]) seen[key] = d;
  });
  coachRailState.deadlines = Object.keys(seen)
    .map(function (k) { return seen[k]; })
    .filter(function (d) { return Number.isFinite(d.daysOut) && d.daysOut >= 0; })
    .sort(function (a, b) { return a.daysOut - b.daysOut; })
    .slice(0, 3);
  coachRenderRail();
}

// Proactive threads (D3). Deliberately NOT auto-sent: Marco noticing something
// is useful, Marco changing the subject on his own is not. Dismissals are
// session-only — this is a nudge, not a setting.
const coachDismissedThreads = Object.create(null);

function coachBuildThread(thread){
  if (!thread || !thread.title || !thread.hook) return null;
  const key = thread.title + '|' + thread.hook;
  if (coachDismissedThreads[key]) return null;

  const card = document.createElement('div');
  card.className = 'coach-thread';
  card.innerHTML =
    '<div class="coach-thread-head"><span class="coach-thread-mark" aria-hidden="true">'
    + coachMarkHtml() + '</span><span class="coach-thread-eye">Marco spotted something</span></div>'
    + '<div class="coach-thread-title"></div><div class="coach-thread-hook"></div>'
    + '<div class="coach-thread-actions">'
    + '<button type="button" class="coach-thread-go">Talk about it</button>'
    + '<button type="button" class="coach-thread-no">Not now</button>'
    + '</div>';
  card.querySelector('.coach-thread-title').textContent = thread.title;
  card.querySelector('.coach-thread-hook').textContent = thread.hook;

  card.querySelector('.coach-thread-go').addEventListener('click', function () {
    coachDismissedThreads[key] = true;
    const input = document.getElementById('coach-input');
    if (input) {
      input.value = thread.seed || thread.title;
      coachSyncCharCount();
    }
    card.remove();
    coachSend();
  });
  card.querySelector('.coach-thread-no').addEventListener('click', function () {
    coachDismissedThreads[key] = true;
    card.remove();
  });
  return card;
}

function coachRenderUi(bubbleEl, ui){
  if (!bubbleEl || !ui) return;
  const body = bubbleEl.parentNode;
  if (!body) return;
  // Attachments belong under the bubble but above the hover timestamp, so the
  // stamp stays the last thing in the turn.
  const stamp = body.querySelector('.coach-stamp');
  const place = function (el) {
    if (!el) return;
    if (stamp) body.insertBefore(el, stamp); else body.appendChild(el);
  };
  place(coachBuildCards(ui.cards));
  coachAbsorbDeadlineCards(ui.cards);
  place(coachBuildSuggestions(ui.suggestions));
  place(coachBuildThread(ui.thread));
}

function coachAppendMsg(role, text){
  const empty = document.getElementById('coach-empty');
  if (empty) empty.hidden = true;
  const chat = document.getElementById('coach-chat');
  const when = new Date();

  if (role === 'system') {
    const sys = document.createElement('div');
    sys.className = 'coach-msg system';
    sys.textContent = text;
    chat.appendChild(sys);
    coachLastRole = '';
    coachScrollToEnd(chat);
    return sys;
  }

  coachMaybeDayDivider(chat, when);
  const turn = document.createElement('div');
  turn.className = 'coach-turn ' + role + (coachLastRole === role ? ' is-run' : '');
  coachLastRole = role;

  // Only Marco wears a face — a user avatar would just be a second empty
  // circle on every line.
  let avatar = null;
  if (role === 'assistant') {
    avatar = document.createElement('div');
    avatar.className = 'coach-turn-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = coachMarkHtml();
  }

  const body = document.createElement('div');
  body.className = 'coach-turn-body';
  const bubble = document.createElement('div');
  bubble.className = 'coach-msg ' + role;
  if (role === 'assistant') bubble.innerHTML = coachRenderMarkdown(text);
  else bubble.textContent = text;
  const stamp = document.createElement('div');
  stamp.className = 'coach-stamp';
  stamp.textContent = coachTimeLabel(when);
  body.appendChild(bubble);
  body.appendChild(stamp);

  if (avatar) turn.appendChild(avatar);
  turn.appendChild(body);
  chat.appendChild(turn);
  coachScrollToEnd(chat);
  return bubble;
}

function coachShowTyping(){
  const chat = document.getElementById('coach-chat');
  const div = document.createElement('div');
  div.className = 'coach-typing';
  div.id = 'coach-typing-indicator';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  chat.appendChild(div);
  coachScrollToEnd(chat);
}
function coachHideTyping(){
  const t = document.getElementById('coach-typing-indicator');
  if (t) t.remove();
}

// Free/paid merge §1/§2 — Marco's free allowance. The server is the authority
// (it returns `remaining` on every reply and 429s at the wall); this only makes
// the wall visible early, so the free tier degrades with a nudge instead of
// dead-ending mid-conversation.
function coachSystemNudge(text, linkLabel) {
  const chat = document.getElementById('coach-chat');
  if (!chat) return;
  const sys = document.createElement('div');
  sys.className = 'coach-msg system';
  sys.textContent = text + ' ';
  const a = document.createElement('a');
  a.href = 'pricing.html';
  a.textContent = linkLabel || 'See Flight Plan \u2192';
  sys.appendChild(a);
  chat.appendChild(sys);
  coachLastRole = '';
  chat.scrollTop = chat.scrollHeight;
}

// The cap-hit card, in the transcript where the reply would have been. One
// per conversation: hitting send again must not stack a second copy.
function coachCapCard(serverMessage) {
  const chat = document.getElementById('coach-chat');
  if (!chat) return;
  if (window.FWPlanSurface && typeof FWPlanSurface.capCard === 'function') {
    FWPlanSurface.capCard(chat, 'marco-chat', serverMessage);
  } else {
    coachSystemNudge(serverMessage || 'You have used your free Marco messages for today.');
    return;
  }
  coachLastRole = '';
  chat.scrollTop = chat.scrollHeight;
}

function coachTrackRemaining(data) {
  if (!data || data.remaining === undefined || data.remaining === null) return;
  if (window.FWEnt && typeof FWEnt.setRemaining === 'function') FWEnt.setRemaining('marco-chat', data.remaining);
  coachSyncUsageChip();
  const left = Number(data.remaining);
  if (!Number.isFinite(left) || left > 2) return;
  // Spending the last one IS the cap hit \u2014 the student just met the wall, so
  // it gets the card. One and two left get a quiet line instead, which is how
  // the cap stays discoverable before it bites (WS-G gate).
  if (left <= 0) {
    coachCapCard('That was your last free Marco message today.');
    return;
  }
  coachSystemNudge(
    left + (left === 1 ? ' message' : ' messages') + ' left today on the free plan.',
    'Flight Plan removes the cap \u2192',
  );
}

/* ─── Transport: SSE first, JSON always (D6) ────────────────────────── */

const COACH_STREAM_EP = '/chat-stream';

// Flips off for the rest of the session the first time /chat-stream proves
// unusable (not deployed yet, a proxy that strips event-streams, a browser
// without a body reader), so the fallback costs one probe, not one per message.
let coachStreamAvailable = true;

// Hand-written mirror of createSseParser in functions/_lib/sse.js — a browser
// IIFE cannot import an ES module from functions/. The frame contract is kept
// deliberately small for exactly this reason: frames split on a blank line,
// `event:` is optional, `data:` is one line of JSON.
function coachParseSseFrame(raw){
  let event = '';
  const dataLines = [];
  raw.split('\n').forEach(function (line) {
    if (!line || line.charAt(0) === ':') return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.charAt(0) === ' ') value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  });
  if (!dataLines.length) return null;
  try {
    return { event: event || 'message', data: JSON.parse(dataLines.join('\n')) };
  } catch (_) {
    return null;
  }
}

// Resolves to { status, data } like the JSON path, or null meaning "this
// transport is not available" — in which case nothing was sent and nothing was
// shown, and the caller runs /chat instead.
async function coachStreamTurn(chatBody, onDelta){
  if (!coachStreamAvailable) return null;
  if (typeof TextDecoder === 'undefined' || typeof ReadableStream === 'undefined') {
    coachStreamAvailable = false;
    return null;
  }

  let resp;
  try {
    const fetchFn = (window.FWAuth && typeof FWAuth.authFetch === 'function')
      ? FWAuth.authFetch : null;
    // Longer than the JSON path's 60s on purpose: a stream shows progress the
    // whole time, so waiting is informed rather than blind. The server's own
    // upstream budget (25s) still finishes well inside it.
    resp = fetchFn
      ? await fetchFn(COACH_STREAM_EP, { method: 'POST', body: chatBody, timeoutMs: 90000 })
      : await fetch(COACH_STREAM_EP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(chatBody),
      });
  } catch (_) {
    coachStreamAvailable = false;
    return null;
  }

  const ctype = resp.headers.get('Content-Type') || '';
  if (!resp.ok || !resp.body || ctype.indexOf('text/event-stream') === -1) {
    coachStreamAvailable = false;
    return null;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let control = null;
  let failure = null;
  let sawFrame = false;

  const drain = function () {
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const frame = coachParseSseFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (frame) {
        sawFrame = true;
        if (frame.event === 'control') control = frame.data;
        else if (frame.event === 'error') failure = frame.data;
        else if (frame.event === 'message' && frame.data && frame.data.delta) onDelta(frame.data.delta);
      }
      idx = buf.indexOf('\n\n');
    }
  };

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      drain();
    }
    buf += decoder.decode();
    drain();
  } catch (err) {
    // The server sends an `open` frame before doing any work, so anything that
    // got this far is a live endpoint mid-turn — the message is already spent.
    // Retrying on /chat would charge it twice and answer twice.
    if (!sawFrame) { coachStreamAvailable = false; return null; }
    throw err;
  }

  if (!sawFrame) { coachStreamAvailable = false; return null; }
  if (failure) return { status: failure.status || 500, data: failure };
  if (!control) {
    throw window.FWErr
      ? FWErr.friendly('Marco stopped mid-answer. Try again in a moment.')
      : new Error('Marco stopped mid-answer. Try again in a moment.');
  }
  return { status: 200, data: control };
}

async function coachJsonTurn(chatBody){
  // authFetch adds the request timeout; raw fetch could hang indefinitely.
  const fetchFn = (window.FWAuth && typeof FWAuth.authFetch === 'function')
    ? FWAuth.authFetch : null;
  const resp = fetchFn
    ? await fetchFn(COACH_CHAT_EP, { method: 'POST', body: chatBody, timeoutMs: 60000 })
    : await fetch(COACH_CHAT_EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(chatBody),
    });
  const data = await resp.json().catch(()=>({}));
  return { status: resp.status, data };
}

async function coachSend(){
  if (coachSending) return;
  if (!coachUserId){ coachOpenSignup(); return; }
  const input = document.getElementById('coach-input');
  const errEl = document.getElementById('coach-error');
  const msg = (input.value||'').trim();
  errEl.textContent = '';
  if (!msg) return;

  coachSending = true;
  input.value = '';
  input.style.height = 'auto';
  coachSyncCharCount();
  input.disabled = true;
  const restoreSend = window.FWButtonBusy
    ? FWButtonBusy.start(document.getElementById('coach-send-btn'), { label: 'Sending…' })
    : function () {};

  coachAppendMsg('user', msg);
  coachShowTyping();

  let streamEl = null;
  try {
    const chatBody = { message: msg };
    if (coachPendingStarter) {
      chatBody.starterContext = coachPendingStarter;
      coachPendingStarter = '';
    }

    // Progressive render. The bubble is created on the first delta — before
    // that the typing dots are the honest state, and if the transport falls
    // back nothing was drawn to undo.
    let streamedText = '';
    const onDelta = function (text) {
      streamedText += text;
      if (!streamEl) {
        coachHideTyping();
        streamEl = coachAppendMsg('assistant', '');
        streamEl.classList.add('is-streaming');
      }
      streamEl.innerHTML = coachRenderMarkdown(streamedText);
      coachScrollToEnd(document.getElementById('coach-chat'));
    };

    let turn = await coachStreamTurn(chatBody, onDelta);
    if (!turn) turn = await coachJsonTurn(chatBody);

    const data = turn.data || {};
    coachHideTyping();
    if (turn.status >= 400) {
      // A half-painted bubble is not an answer — take it back before saying so.
      if (streamEl) {
        const turnEl = streamEl.closest('.coach-turn');
        if (turnEl) turnEl.remove();
        coachLastRole = '';
        streamEl = null;
      }
      if (data.upgrade) {
        // WS-G upgrade moment 1: the daily cap. The card carries the server's
        // own message plus one CTA — the composer stays live, because tomorrow
        // it works again and a dead input reads as a broken product.
        coachCapCard(data.error);
        return;
      }
      throw fwRespError({ status: turn.status }, data, 'Coach is offline. Try again in a moment.');
    }

    // The control frame is authoritative, not additive: the streamed text was
    // raw model prose, this is the parsed reply with the FW_UI block stripped.
    let replyEl;
    if (streamEl) {
      replyEl = streamEl;
      replyEl.classList.remove('is-streaming');
      replyEl.innerHTML = coachRenderMarkdown(data.reply || '(no reply)');
    } else {
      replyEl = coachAppendMsg('assistant', data.reply || '(no reply)');
    }
    coachAppendSources(replyEl, data);
    coachRenderUi(replyEl, data.ui);
    coachSetProgress(data.exchangeCount || 0);
    coachRefreshRoadmapAfterUpdate(data);
    coachTrackRemaining(data);
    if (data.roadmapUpgrade) {
      coachSystemNudge('Rewriting your roadmap with Marco is a Flight Plan feature \u2014 checking steps off stays free.');
    }
    if (data.roadmapCapped && data.roadmapCapMessage) {
      coachSystemNudge(data.roadmapCapMessage);
    }

    if (data.manualUpdate) {
      const banner = document.getElementById('coach-updating');
      banner.classList.add('vis');
      if (data.roadmapUpdated) {
        banner.querySelector('div:last-child').textContent = data.roadmapUpdateType === 'regenerate'
          ? 'Career plan rebuilt — open Career Roadmap to review.'
          : 'Roadmap updated — open Career Roadmap to review.';
      } else {
        banner.querySelector('div:last-child').textContent = data.dossierUpdated
          ? 'Updating dossier…'
          : 'No profile changes needed.';
      }
      if (data.dossierUpdated) coachRefreshPortalAfterDossier();
      if (data.sectorFitUpdated) coachApplySectorFit(data);
      setTimeout(() => banner.classList.remove('vis'), 2200);
    } else if (data.reset) {
      const banner = document.getElementById('coach-updating');
      banner.classList.add('vis');
      const parts = [];
      if (data.dossierUpdated) parts.push('dossier');
      if (data.roadmapUpdated) parts.push('roadmap');
      banner.querySelector('div:last-child').textContent = parts.length
        ? 'Updating your ' + parts.join(' and ') + '…'
        : 'Refreshing memory…';
      if (data.dossierUpdated) coachRefreshPortalAfterDossier();
      if (data.sectorFitUpdated) coachApplySectorFit(data);
      setTimeout(() => {
        banner.classList.remove('vis');
        const chat = document.getElementById('coach-chat');
        // The reply lives inside its turn wrapper now, so keep the wrapper the
        // bubble belongs to and drop every other turn/divider.
        const keep = replyEl.closest('.coach-turn');
        Array.from(chat.querySelectorAll('.coach-turn, .coach-day, .coach-msg.system')).forEach(n => {
          if (n !== keep) n.remove();
        });
        const sys = document.createElement('div');
        sys.className = 'coach-msg system';
        const msgs = [];
        if (data.dossierUpdated) msgs.push('dossier updated');
        if (data.roadmapUpdated) msgs.push('roadmap updated');
        sys.textContent = msgs.length
          ? '✓ Memory refreshed — ' + msgs.join(', ') + '. The reply above carries into this new conversation.'
          : '↻ Conversation reset. The reply above carries over.';
        if (keep) chat.insertBefore(sys, keep);
        else chat.appendChild(sys);
        coachSetProgress(0);
        if (data.dossierUpdated) coachPrimeDossier();
      }, 2200);
    }
  } catch(err){
    coachHideTyping();
    // Whatever streamed through before the failure is real text Marco already
    // spent the message producing — keep it, just stop pretending it is still
    // arriving. The error line below says the rest is missing.
    if (streamEl) streamEl.classList.remove('is-streaming');
    errEl.textContent = window.FWErr
      ? FWErr.forUser(err, 'Marco could not answer that — please try again.')
      : 'Marco could not answer that — please try again.';
  } finally {
    coachSending = false;
    input.disabled = false;
    restoreSend();
    input.focus();
  }
}

/* ─── Settings panel + dossier editor ───────────────────────────────── */

function coachOpenSettings(){
  if (!coachUserId) return;
  document.getElementById('coach-settings-overlay').classList.add('vis');
  coachLoadDossier();
}
function coachCloseSettings(){
  document.getElementById('coach-settings-overlay').classList.remove('vis');
}
function coachSettingsOverlayClick(e){
  if (e.target && e.target.id === 'coach-settings-overlay') coachCloseSettings();
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const settings = document.getElementById('coach-settings-overlay');
  if (settings && settings.classList.contains('vis')) coachCloseSettings();
});

async function coachLoadDossier(){
  if (!coachUserId) return;
  const ta = document.getElementById('coach-dossier-text');
  const status = document.getElementById('coach-dossier-status');
  ta.value = ''; ta.placeholder = 'Loading dossier…';
  status.textContent = ''; status.className = 'coach-dossier-status';
  try {
    const resp = await fetch(COACH_DOSSIER_EP, {
      credentials: 'include',
    });
    const data = await resp.json().catch(()=>({}));
    if (!resp.ok) throw fwRespError(resp, data, 'Could not load your dossier.');
    ta.value = data.dossier || '';
    coachDossierText = ta.value;
    coachRenderRail();
  } catch(err){
    status.textContent = window.FWErr ? FWErr.forUser(err, 'Could not load your dossier.') : 'Could not load your dossier.';
    status.className = 'coach-dossier-status err';
  }
}

async function coachSaveDossier(){
  if (!coachUserId) return;
  const ta = document.getElementById('coach-dossier-text');
  const status = document.getElementById('coach-dossier-status');
  const btn = document.getElementById('coach-dossier-save-btn');
  status.textContent = 'Saving…'; status.className = 'coach-dossier-status';
  const restoreSave = window.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Saving…' }) : function () {};
  try {
    const resp = await fetch(COACH_DOSSIER_EP, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ dossier: ta.value }),
    });
    const data = await resp.json().catch(()=>({}));
    if (!resp.ok) throw fwRespError(resp, data, 'Could not save your dossier.');
    ta.value = data.dossier || ta.value;
    coachDossierText = ta.value;
    coachRenderRail();
    status.textContent = '✓ Saved.'; status.className = 'coach-dossier-status ok';
    coachRefreshPortalAfterDossier();
  } catch(err){
    status.textContent = window.FWErr ? FWErr.forUser(err, 'Could not save your dossier.') : 'Could not save your dossier.';
    status.className = 'coach-dossier-status err';
  } finally {
    restoreSave();
  }
}

async function coachSignOut(reopenSignup){
  try {
    if (window.FWAuth) await FWAuth.authLogout();
  } catch (_) { /* ignore */ }
  coachClearUser();
  coachCloseSettings();
  if (reopenSignup) {
    coachOpenSignup();
  } else {
    window.location.href = coachAuthUrl();
  }
}

/* ─── Wire-up ───────────────────────────────────────────────────────── */

// Auto-resize the chat textarea up to its max-height.
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'coach-input') {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px';
    coachSyncCharCount();
  }
});

// Starter and suggestion chips send their own text. One delegated listener
// covers the empty state, the rail and every reply's chips.
document.addEventListener('click', (e) => {
  const chip = e.target && e.target.closest ? e.target.closest('[data-coach-starter]') : null;
  if (!chip) return;
  e.preventDefault();
  const input = document.getElementById('coach-input');
  if (!input) return;
  input.value = chip.getAttribute('data-coach-starter') || '';
  coachSyncCharCount();
  coachSend();
});

// Submit on Enter, newline on Shift+Enter.
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'coach-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    coachSend();
  }
});

if (isCoachPage() || document.getElementById('page-quiz') || document.body.classList.contains('quiz-page')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', coachInit);
  } else {
    coachInit();
  }
}
