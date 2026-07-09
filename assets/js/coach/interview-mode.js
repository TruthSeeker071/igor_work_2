/**
 * FlightWay 2.0 — Pillar D1 interview prep UI (premium).
 *
 * Self-contained practice panel that mounts itself onto the coach page: a
 * "Practice interview" launcher in the coach header opens an overlay where the
 * student gets a question for their target career, types an answer, and gets
 * rubric-scored feedback from /interview-prep. Deliberately touches nothing in
 * coach.js so Marco stays Jacob-mergeable. Premium-gated via FWEnt (server enforces too).
 */
(function (global) {
  'use strict';

  var state = { career: '', question: null, busy: false };
  var overlay = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function post(bodyObj) {
    var url = '/interview-prep';
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      return FWAuth.authFetch(url, { method: 'POST', body: bodyObj });
    }
    return fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
    });
  }

  function prefillCareer() {
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.currentName === 'function') {
        return FWCareerTarget.currentName() || '';
      }
    } catch (_) {}
    return '';
  }

  function setBusy(b, label) {
    state.busy = b;
    var qb = overlay.querySelector('#fw-iv-getq');
    var fb = overlay.querySelector('#fw-iv-getfb');
    if (qb) qb.disabled = b;
    if (fb) fb.disabled = b;
    var status = overlay.querySelector('#fw-iv-status');
    if (status) status.textContent = b ? (label || 'Working…') : '';
  }

  function scoreRow(name, axis) {
    var s = Math.max(1, Math.min(5, Number(axis && axis.score) || 3));
    return '<div class="fw-iv-axis"><div class="fw-iv-axis-top"><span>' + esc(name) + '</span>'
      + '<span class="fw-iv-axis-score">' + s + '/5</span></div>'
      + '<div class="fw-iv-axis-track"><div class="fw-iv-axis-fill" style="width:' + (s / 5 * 100) + '%"></div></div>'
      + '<p class="fw-iv-axis-note">' + esc(axis && axis.note) + '</p></div>';
  }

  function renderFeedback(fb) {
    var box = overlay.querySelector('#fw-iv-feedback');
    if (!box) return;
    box.innerHTML = '<h4 class="fw-iv-fb-title">Coach feedback</h4>'
      + scoreRow('Structure', fb.structure)
      + scoreRow('Specificity', fb.specificity)
      + scoreRow('Clarity', fb.clarity)
      + '<p class="fw-iv-verdict">' + esc(fb.verdict) + '</p>'
      + (fb.model_moment ? '<p class="fw-iv-model"><strong>Try:</strong> ' + esc(fb.model_moment) + '</p>' : '');
    box.hidden = false;
  }

  function getQuestion() {
    var input = overlay.querySelector('#fw-iv-career');
    state.career = (input && input.value || '').trim();
    if (!state.career) { input && input.focus(); return; }
    setBusy(true, 'Finding a question…');
    overlay.querySelector('#fw-iv-feedback').hidden = true;
    post({ careerName: state.career, stage: 'question' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setBusy(false);
        if (!res.ok) { showError(res.d && res.d.error); return; }
        state.question = res.d.question;
        var qEl = overlay.querySelector('#fw-iv-question');
        qEl.innerHTML = '<span class="fw-iv-qtype fw-iv-qtype--' + esc(state.question.type) + '">' + esc(state.question.type) + '</span>'
          + '<p class="fw-iv-qtext">' + esc(state.question.text) + '</p>';
        qEl.hidden = false;
        overlay.querySelector('#fw-iv-answer-wrap').hidden = false;
        overlay.querySelector('#fw-iv-answer').value = '';
        try { if (global.FWEvents) FWEvents.log('iprep_question', { career: state.career, type: state.question.type }); } catch (_) {}
      })
      .catch(function () { setBusy(false); showError(); });
  }

  function getFeedback() {
    if (!state.question) return;
    var ans = (overlay.querySelector('#fw-iv-answer').value || '').trim();
    if (ans.length < 20) { showError('Write a sentence or two first.'); return; }
    setBusy(true, 'Reviewing your answer…');
    post({ careerName: state.career, stage: 'feedback', question: state.question.text, answer: ans })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setBusy(false);
        if (!res.ok || !res.d.feedback) { showError(res.d && res.d.error); return; }
        renderFeedback(res.d.feedback);
        try { if (global.FWEvents) FWEvents.log('iprep_feedback', { career: state.career }); } catch (_) {}
      })
      .catch(function () { setBusy(false); showError(); });
  }

  function showError(msg) {
    var e = overlay.querySelector('#fw-iv-error');
    if (e) { e.textContent = msg || 'Something went wrong — try again.'; e.hidden = false; setTimeout(function () { e.hidden = true; }, 4000); }
  }

  function buildPanel() {
    overlay = document.createElement('div');
    overlay.className = 'fw-iv-overlay';
    overlay.id = 'fw-iv-overlay';
    overlay.hidden = true;
    overlay.innerHTML = ''
      + '<div class="fw-iv-modal" role="dialog" aria-modal="true" aria-labelledby="fw-iv-title">'
      + '<button type="button" class="fw-iv-close" id="fw-iv-close" aria-label="Close">&times;</button>'
      + '<h3 id="fw-iv-title">Practice interview</h3>'
      + '<p class="fw-iv-sub">Get a real question for your target career, answer it, and get honest coaching.</p>'
      + '<div class="fw-iv-body">'
      + '<div class="fw-iv-row"><input type="text" id="fw-iv-career" class="fw-iv-input" placeholder="Target career, e.g. Financial Analyst" autocomplete="off">'
      + '<button type="button" id="fw-iv-getq" class="fw-iv-btn fw-iv-btn--primary">Get a question</button></div>'
      + '<div id="fw-iv-question" class="fw-iv-question" hidden></div>'
      + '<div id="fw-iv-answer-wrap" hidden><textarea id="fw-iv-answer" class="fw-iv-answer" rows="5" maxlength="2000" placeholder="Answer out loud, then type the gist here…"></textarea>'
      + '<button type="button" id="fw-iv-getfb" class="fw-iv-btn fw-iv-btn--primary">Get feedback</button></div>'
      + '<div id="fw-iv-feedback" class="fw-iv-feedback" hidden></div>'
      + '<p id="fw-iv-status" class="fw-iv-statusline" aria-live="polite"></p>'
      + '<p id="fw-iv-error" class="fw-iv-error" hidden></p>'
      + '</div></div>';
    (document.getElementById('page-coach') || document.body).appendChild(overlay);

    overlay.querySelector('#fw-iv-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#fw-iv-getq').addEventListener('click', getQuestion);
    overlay.querySelector('#fw-iv-getfb').addEventListener('click', getFeedback);

    // Premium gate (dark until PAYWALL_ENABLED — then locked users see the CTA).
    if (global.FWEnt && typeof FWEnt.boot === 'function') {
      FWEnt.boot().then(function () {
        if (!FWEnt.has('premium')) FWEnt.gate(overlay.querySelector('.fw-iv-body'), 'interview-prep');
      });
    }
  }

  function open() {
    if (!overlay) buildPanel();
    overlay.hidden = false;
    var input = overlay.querySelector('#fw-iv-career');
    if (input && !input.value) input.value = prefillCareer();
    try { if (global.FWEvents) FWEvents.log('iprep_open'); } catch (_) {}
    setTimeout(function () { input && input.focus(); }, 60);
  }
  function close() { if (overlay) overlay.hidden = true; }

  function mountLauncher() {
    var actions = document.querySelector('.coach-header-actions');
    if (!actions || document.getElementById('fw-iv-launch')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fw-iv-launch';
    btn.className = 'fw-iv-launch';
    btn.textContent = 'Practice interview';
    btn.addEventListener('click', open);
    actions.insertBefore(btn, actions.firstChild);
  }

  function init() { buildPanel(); mountLauncher(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.FWInterviewMode = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
