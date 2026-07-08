const COACH_CHAT_EP    = '/chat';
const COACH_DOSSIER_EP = '/dossier';
const COACH_RESET_AT   = 5;
const COACH_HUB_KEY    = 'fw_hub_quiz_v1';

let coachUserId = null;
let coachSending = false;
let coachPendingStarter = '';
let coachPostSignupTarget = 'coach';
let coachAuthReady = false;

function coachSyncUserFromAuth() {
  coachUserId = (window.FWAuth && FWAuth.authEmail()) || null;
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
    const raw = localStorage.getItem(COACH_HUB_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
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
    if (coachHasQuizContext()) coachOpenSignup();
    else window.location.replace(coachAuthUrl());
    return;
  }
  document.getElementById('coach-user-email').textContent = coachUserId;
  document.getElementById('coach-empty').style.display = '';
  const chatEl = document.getElementById('coach-chat');
  Array.from(chatEl.querySelectorAll('.coach-msg, .coach-typing')).forEach(function (n) { n.remove(); });
  coachSetProgress(0);
  document.getElementById('coach-error').textContent = '';
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
    const archetype = (typeof qzDetermineArchetype === 'function')
      ? (qzDetermineArchetype().name || null) : null;
    return {
      topIndustries,
      recommendedMajors: Array.from(new Set(recommendedMajors)).slice(0,6),
      archetype,
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
      <div class="coach-results-title">You're already signed in as ${coachUserId}</div>
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
  document.getElementById('coach-signup-btn').disabled = false;
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
  const btnLabel = opts.btnLabel || 'Create account →';
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
  btn.disabled = true;
  btn.textContent = btnBusy;
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
    const msg = (err && err.message) || String(err) || 'Something went wrong.';
    errEl.textContent = msg;
    console.error('coachSignup failed:', err);
    input.disabled = false;
    if (pwInput) pwInput.disabled = false;
    if (pwConfirm) pwConfirm.disabled = false;
    btn.disabled = false;
    btn.textContent = btnLabel;
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

function coachSetProgress(n){
  const pct = Math.min(100, Math.round((n / COACH_RESET_AT) * 100));
  document.getElementById('coach-progress-fill').style.width = pct + '%';
  document.getElementById('coach-progress-label').textContent =
    `Exchange ${n} / ${COACH_RESET_AT} — memory refreshes after ${COACH_RESET_AT} (dossier + roadmap)`;
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

function coachAppendMsg(role, text){
  const empty = document.getElementById('coach-empty');
  if (empty) empty.style.display = 'none';
  const chat = document.getElementById('coach-chat');
  const div = document.createElement('div');
  div.className = 'coach-msg ' + role;
  if (role === 'assistant') {
    div.innerHTML = coachRenderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function coachShowTyping(){
  const chat = document.getElementById('coach-chat');
  const div = document.createElement('div');
  div.className = 'coach-typing';
  div.id = 'coach-typing-indicator';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
function coachHideTyping(){
  const t = document.getElementById('coach-typing-indicator');
  if (t) t.remove();
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
  input.disabled = true;
  document.getElementById('coach-send-btn').disabled = true;

  coachAppendMsg('user', msg);
  coachShowTyping();

  try {
    const chatBody = { message: msg };
    if (coachPendingStarter) {
      chatBody.starterContext = coachPendingStarter;
      coachPendingStarter = '';
    }
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
    coachHideTyping();
    if (!resp.ok) throw new Error(data.error || 'Coach is offline. Try again in a moment.');

    const replyEl = coachAppendMsg('assistant', data.reply || '(no reply)');
    coachSetProgress(data.exchangeCount || 0);
    coachRefreshRoadmapAfterUpdate(data);

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
        Array.from(chat.querySelectorAll('.coach-msg')).forEach(n => {
          if (n !== replyEl) n.remove();
        });
        const sys = document.createElement('div');
        sys.className = 'coach-msg system';
        const msgs = [];
        if (data.dossierUpdated) msgs.push('dossier updated');
        if (data.roadmapUpdated) msgs.push('roadmap updated');
        sys.textContent = msgs.length
          ? '✓ Memory refreshed — ' + msgs.join(', ') + '. The reply above carries into this new conversation.'
          : '↻ Conversation reset. The reply above carries over.';
        chat.insertBefore(sys, replyEl);
        coachSetProgress(0);
      }, 2200);
    }
  } catch(err){
    coachHideTyping();
    errEl.textContent = err.message || 'Something went wrong.';
  } finally {
    coachSending = false;
    input.disabled = false;
    document.getElementById('coach-send-btn').disabled = false;
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
    if (!resp.ok) throw new Error(data.error || 'Could not load dossier.');
    ta.value = data.dossier || '';
  } catch(err){
    status.textContent = err.message || 'Load failed.';
    status.className = 'coach-dossier-status err';
  }
}

async function coachSaveDossier(){
  if (!coachUserId) return;
  const ta = document.getElementById('coach-dossier-text');
  const status = document.getElementById('coach-dossier-status');
  const btn = document.getElementById('coach-dossier-save-btn');
  status.textContent = 'Saving…'; status.className = 'coach-dossier-status';
  btn.disabled = true;
  try {
    const resp = await fetch(COACH_DOSSIER_EP, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ dossier: ta.value }),
    });
    const data = await resp.json().catch(()=>({}));
    if (!resp.ok) throw new Error(data.error || 'Save failed.');
    ta.value = data.dossier || ta.value;
    status.textContent = '✓ Saved.'; status.className = 'coach-dossier-status ok';
    coachRefreshPortalAfterDossier();
  } catch(err){
    status.textContent = err.message || 'Save failed.';
    status.className = 'coach-dossier-status err';
  } finally {
    btn.disabled = false;
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
    e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px';
  }
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
