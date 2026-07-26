/**
 * FlightWay 2.0 — Pillar D1 mock interview UI (premium).
 *
 * Self-contained panel that mounts itself onto the coach page: a "Practice
 * interview" launcher in the coach header opens an overlay running a
 * continuous 8-question, ~20-minute, text-only mock interview against the
 * stateful POST /mock-interview endpoint (intro -> behavioral -> technical ->
 * candidate-questions -> close, one persona throughout). Feedback is withheld
 * until a single end-of-session debrief. The client holds the transcript —
 * every turn resends the full transcript (each interviewer entry carrying the
 * server's signed difficulty marker) plus the session token minted on the
 * first turn; difficulty itself is server-derived. Deliberately touches nothing
 * in coach.js so Marco stays Jacob-mergeable. Premium-gated via FWEnt (server
 * enforces too). All server/user strings go through esc() before innerHTML —
 * server text (questions, debrief, source titles) is untrusted.
 */
(function (global) {
  'use strict';

  var MAX_RESUME_CHARS = 2500;
  var MAX_COMPANY_CHARS = 80;
  var TURN_TIMEOUT_MS = 40000;
  var DEBRIEF_TIMEOUT_MS = 50000;

  var AXIS_ORDER = ['communication', 'structure', 'specificity', 'technical', 'composure', 'fit'];
  var AXIS_LABELS = {
    communication: 'Communication', structure: 'Structure', specificity: 'Specificity',
    technical: 'Technical', composure: 'Composure', fit: 'Fit',
  };
  var PHASE_LABELS = {
    intro: 'Intro', behavioral: 'Behavioral', technical: 'Technical',
    candidate_questions: 'Your questions', close: 'Wrapping up',
  };
  var PERSONA_CARDS = [
    { id: 'coach', name: 'Maya', tag: 'Supportive coach' },
    { id: 'pressure', name: 'Elliot', tag: 'Realistic pressure' },
  ];

  var state = null;
  var overlay = null;
  var timerHandle = null;
  var answerHintTimer = null;

  function freshState() {
    return {
      career: '', soc: '', prefilledCareerName: '', persona: 'coach', company: '',
      resumeText: '', transcript: [], questionIndex: 0, totalQuestions: 8,
      sessionToken: '', sessionStartTs: 0,
      phase: 'intro', personaName: 'Maya', done: false, companySources: null, companyAsOf: null,
      busy: false, startedAt: null,
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function logEvent(name, data) {
    try { if (global.FWEvents) FWEvents.log(name, data); } catch (_) {}
  }

  function post(bodyObj, timeoutMs) {
    var url = '/mock-interview';
    var opts = { method: 'POST', body: bodyObj };
    if (timeoutMs) opts.timeoutMs = timeoutMs;
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      return FWAuth.authFetch(url, opts);
    }
    return fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
    });
  }

  function getJson(url) {
    var opts = { method: 'GET' };
    var p = (global.FWAuth && typeof FWAuth.authFetch === 'function')
      ? FWAuth.authFetch(url, opts)
      : fetch(url, { method: 'GET', credentials: 'include' });
    return p.then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function parseResponse(r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      return { ok: r.ok, status: r.status, d: d || {} };
    });
  }

  function prefillCareer() {
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
        var t = FWCareerTarget.resolveTargetCareer();
        if (t && t.name) return { name: t.name, soc: t.soc || '' };
      }
    } catch (_) {}
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.currentName === 'function') {
        var n = FWCareerTarget.currentName();
        if (n) return { name: n, soc: '' };
      }
    } catch (_) {}
    return { name: '', soc: '' };
  }

  function fetchResumeText() {
    if (!(global.FWAuth && typeof FWAuth.authFetch === 'function')) return Promise.resolve('');
    return getJson('/resume-doc').then(function (d) {
      var doc = d && (d.latest || d.doc);
      if (!doc || !doc.json) return '';
      if (!(global.FWResumeRender && typeof FWResumeRender.toPlainText === 'function')) return '';
      try {
        return String(FWResumeRender.toPlainText(doc.json) || '').slice(0, MAX_RESUME_CHARS);
      } catch (_) { return ''; }
    });
  }

  // ── Screens ────────────────────────────────────────────────────────────

  function showScreen(name) {
    var names = ['setup', 'interview', 'debrief-loading', 'debrief'];
    for (var i = 0; i < names.length; i++) {
      var el = overlay.querySelector('#fw-iv-screen-' + names[i]);
      if (el) el.hidden = names[i] !== name;
    }
  }

  function setSetupBusy(b, label) {
    state.busy = b;
    var btn = overlay.querySelector('#fw-iv-start');
    if (btn) btn.disabled = b;
    var status = overlay.querySelector('#fw-iv-setup-status');
    if (status) status.textContent = b ? (label || 'Working…') : '';
  }

  function showSetupError(msg) {
    var e = overlay.querySelector('#fw-iv-setup-error');
    if (e) { e.textContent = msg || 'Something went wrong — try again.'; e.hidden = false; }
  }

  function hideSetupError() {
    var e = overlay.querySelector('#fw-iv-setup-error');
    if (e) e.hidden = true;
  }

  // ── Setup screen ───────────────────────────────────────────────────────

  function wirePersonaCards() {
    var grid = overlay.querySelector('#fw-iv-persona-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.fw-iv-persona-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        for (var j = 0; j < cards.length; j++) cards[j].classList.remove('is-active');
        this.classList.add('is-active');
        state.persona = this.getAttribute('data-persona') === 'pressure' ? 'pressure' : 'coach';
      });
    }
  }

  function fillSetupDefaults() {
    var t = prefillCareer();
    state.prefilledCareerName = t.name || '';
    state.soc = t.soc || '';
    var input = overlay.querySelector('#fw-iv-career');
    if (input && !input.value) input.value = t.name || '';
  }

  function startInterview() {
    if (state.busy) return;
    var careerInput = overlay.querySelector('#fw-iv-career');
    var companyInput = overlay.querySelector('#fw-iv-company');
    var careerName = (careerInput && careerInput.value || '').trim();
    if (!careerName) { careerInput && careerInput.focus(); return; }

    state.career = careerName;
    state.soc = careerName === state.prefilledCareerName ? state.soc : '';
    state.company = (companyInput && companyInput.value || '').trim().slice(0, MAX_COMPANY_CHARS);
    state.transcript = [];
    state.questionIndex = 0;
    state.done = false;
    state.companySources = null;
    state.companyAsOf = null;
    state.sessionToken = '';
    state.sessionStartTs = 0;

    hideSetupError();
    setSetupBusy(true, 'Getting your resume ready…');

    fetchResumeText().then(function (text) {
      state.resumeText = text;
      setSetupBusy(true, 'Starting your interview…');
      logEvent('mockiv_start', { career: state.career, persona: state.persona, company: !!state.company });
      doTurn(true);
    });
  }

  // ── Interview turns ────────────────────────────────────────────────────

  function turnPayload() {
    return {
      action: 'turn',
      career: state.career,
      soc: state.soc,
      persona: state.persona,
      company: state.company,
      resumeText: state.resumeText,
      transcript: state.transcript,
      sessionToken: state.sessionToken,
      sessionStartTs: state.sessionStartTs,
    };
  }

  function doTurn(isFirst) {
    post(turnPayload(), TURN_TIMEOUT_MS)
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) return handleTurnFailure(res, isFirst);
        handleTurnSuccess(res.d, isFirst);
      })
      .catch(function () { handleTurnFailure({ status: 0, d: {} }, isFirst); });
  }

  function handleTurnSuccess(d, isFirst) {
    if (isFirst) { setSetupBusy(false); showScreen('interview'); startTimer(); }
    setTurnBusy(false);
    hideTurnError();

    if (d.sessionToken) {
      state.sessionToken = d.sessionToken;
      state.sessionStartTs = Number(d.sessionStartTs) || 0;
    }
    var entry = { role: 'interviewer', text: d.question };
    if (d.difficultyTag) entry.tag = d.difficultyTag;
    state.transcript.push(entry);
    state.questionIndex = Number(d.questionIndex) || 0;
    state.totalQuestions = Number(d.totalQuestions) || 8;
    state.phase = d.phase || state.phase;
    state.personaName = d.persona || state.personaName;
    state.done = !!d.done;

    appendMessage('interviewer', d.question, state.personaName);
    updateProgressUi();

    if (isFirst && d.companySources && d.companySources.length) {
      state.companySources = d.companySources;
      state.companyAsOf = d.companyAsOf || null;
      renderCompanyNote();
    }

    if (state.done) {
      stopTimer();
      disableAnswerInput(true);
      requestDebrief();
    } else {
      disableAnswerInput(false);
      var ta = overlay.querySelector('#fw-iv-answer');
      if (ta) ta.focus();
    }
  }

  function handleTurnFailure(res, isFirst) {
    setTurnBusy(false);
    if (res.status === 402) { showUpgradeGate(); return; }
    if (res.status === 429 && res.d && res.d.upgrade) {
      stopTimer();
      if (isFirst) setSetupBusy(false);
      var body = overlay.querySelector('.fw-iv-body');
      if (body && global.FWPlanSurface && typeof FWPlanSurface.capCard === 'function') {
        FWPlanSurface.capCard(body, 'mock-interview', res.d.error);
        return;
      }
    }
    if (isFirst) {
      setSetupBusy(false);
      if (res.status === 429) {
        // No hand-written cap in the fallback: §4 gives free ONE session ever and
        // premium three a day, so a literal number here is wrong for somebody.
        showSetupError((res.d && res.d.error) || 'You’ve used your mock interviews for now — check your plan for what’s left.');
      } else {
        showSetupError((res.d && res.d.error) || 'Could not start the interview — try again.');
      }
      return;
    }
    showTurnError((res.d && res.d.error) || 'Something went wrong — try again.');
  }

  function sendAnswer(e) {
    if (e) e.preventDefault();
    if (state.busy || state.done) return;
    var ta = overlay.querySelector('#fw-iv-answer');
    var text = (ta && ta.value || '').trim();
    if (!text) {
      if (ta) {
        ta.focus();
        shakeAnswerInput(ta);
      }
      showAnswerHint();
      return;
    }
    state.transcript.push({ role: 'student', text: text });
    appendMessage('student', text, null);
    ta.value = '';
    disableAnswerInput(true);
    setTurnBusy(true);
    hideTurnError();
    doTurn(false);
  }

  function shakeAnswerInput(ta) {
    ta.classList.remove('fw-iv-shake');
    void ta.offsetWidth; // restart the animation on a double-submit
    ta.classList.add('fw-iv-shake');
    ta.addEventListener('animationend', function onEnd() {
      ta.classList.remove('fw-iv-shake');
      ta.removeEventListener('animationend', onEnd);
    });
  }

  function showAnswerHint() {
    var hint = overlay.querySelector('#fw-iv-answer-hint');
    if (!hint) return;
    hint.hidden = false;
    if (answerHintTimer) clearTimeout(answerHintTimer);
    answerHintTimer = setTimeout(function () { hint.hidden = true; }, 2000);
  }

  function setTurnBusy(b) {
    state.busy = b;
    var thinking = overlay.querySelector('#fw-iv-thinking');
    if (thinking) thinking.hidden = !b;
  }

  function disableAnswerInput(disabled) {
    var ta = overlay.querySelector('#fw-iv-answer');
    var btn = overlay.querySelector('#fw-iv-send');
    if (ta) ta.disabled = disabled;
    if (btn) btn.disabled = disabled;
  }

  function showTurnError(msg) {
    var box = overlay.querySelector('#fw-iv-turn-error');
    var text = overlay.querySelector('#fw-iv-turn-error-text');
    if (text) text.textContent = msg;
    if (box) box.hidden = false;
  }

  function hideTurnError() {
    var box = overlay.querySelector('#fw-iv-turn-error');
    if (box) box.hidden = true;
  }

  function retryTurn() {
    hideTurnError();
    setTurnBusy(true);
    doTurn(false);
  }

  // ── Transcript rendering ───────────────────────────────────────────────

  function appendMessage(role, text, personaName) {
    var pane = overlay.querySelector('#fw-iv-transcript');
    if (!pane) return;
    var isInterviewer = role === 'interviewer';
    var label = isInterviewer ? (personaName || state.personaName || 'Interviewer') : 'You';
    var row = document.createElement('div');
    row.className = 'fw-iv-msg fw-iv-msg--' + (isInterviewer ? 'interviewer' : 'student');
    row.innerHTML = '<div class="fw-iv-msg-label">' + esc(label) + '</div>'
      + '<div class="fw-iv-msg-bubble">' + esc(text) + '</div>';
    pane.appendChild(row);
    pane.scrollTop = pane.scrollHeight;
  }

  function updateProgressUi() {
    var label = overlay.querySelector('#fw-iv-progress-label');
    var phaseLabel = overlay.querySelector('#fw-iv-phase-label');
    if (label) {
      var n = Math.max(1, Math.min(state.totalQuestions, state.questionIndex + 1));
      label.textContent = 'Question ' + n + ' of ' + state.totalQuestions;
    }
    if (phaseLabel) phaseLabel.textContent = PHASE_LABELS[state.phase] || state.phase;
  }

  function renderCompanyNote() {
    var el = overlay.querySelector('#fw-iv-company-note');
    if (!el) return;
    if (!state.companySources || !state.companySources.length) { el.hidden = true; return; }
    var dateStr = '';
    if (state.companyAsOf) {
      var d = new Date(state.companyAsOf);
      if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
    }
    var links = state.companySources.map(function (s) {
      var title = esc((s && s.title) || (s && s.url) || 'source');
      var url = s && s.url;
      if (url && /^https?:\/\//i.test(url)) {
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>';
      }
      return '<span>' + title + '</span>';
    }).join(', ');
    el.innerHTML = 'Firm research as of ' + esc(dateStr || 'today') + ' — ' + links;
    el.hidden = false;
  }

  // ── Timer ──────────────────────────────────────────────────────────────

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function startTimer() {
    state.startedAt = Date.now();
    updateTimerUi();
    stopTimer();
    timerHandle = setInterval(updateTimerUi, 1000);
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function updateTimerUi() {
    var el = overlay && overlay.querySelector('#fw-iv-timer');
    if (!el || !state.startedAt) return;
    var secs = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    el.textContent = Math.floor(secs / 60) + ':' + pad2(secs % 60);
  }

  // ── Debrief ────────────────────────────────────────────────────────────

  function requestDebrief() {
    showScreen('debrief-loading');
    hideDebriefError();
    var payload = {
      action: 'debrief',
      career: state.career, soc: state.soc, persona: state.persona, company: state.company,
      resumeText: state.resumeText, transcript: state.transcript,
      sessionToken: state.sessionToken, sessionStartTs: state.sessionStartTs,
    };
    post(payload, DEBRIEF_TIMEOUT_MS)
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) return handleDebriefFailure(res);
        logEvent('mockiv_debrief', { career: state.career, persona: state.persona });
        renderDebrief(res.d.debrief);
        loadMetricLog();
      })
      .catch(function () { handleDebriefFailure({ status: 0, d: {} }); });
  }

  function handleDebriefFailure(res) {
    if (res.status === 402) { showUpgradeGate(); return; }
    showDebriefError((res.d && res.d.error) || 'Could not build your debrief — try again.');
  }

  function showDebriefError(msg) {
    var box = overlay.querySelector('#fw-iv-debrief-error');
    var text = overlay.querySelector('#fw-iv-debrief-error-text');
    if (text) text.textContent = msg;
    if (box) box.hidden = false;
  }

  function hideDebriefError() {
    var box = overlay.querySelector('#fw-iv-debrief-error');
    if (box) box.hidden = true;
  }

  function axisMeterHtml(label, value) {
    if (value === 'N/A') {
      return '<div class="fw-iv-axis fw-iv-axis--na"><div class="fw-iv-axis-top"><span>' + esc(label)
        + '</span><span class="fw-iv-axis-score">N/A</span></div>'
        + '<div class="fw-iv-axis-track"><div class="fw-iv-axis-fill" style="width:0%"></div></div>'
        + '<p class="fw-iv-axis-note">N/A — no technical questions this session</p></div>';
    }
    var v = Math.max(1, Math.min(5, Number(value) || 1));
    return '<div class="fw-iv-axis"><div class="fw-iv-axis-top"><span>' + esc(label)
      + '</span><span class="fw-iv-axis-score">' + v + '/5</span></div>'
      + '<div class="fw-iv-axis-track"><div class="fw-iv-axis-fill" style="width:' + (v / 5 * 100) + '%"></div></div></div>';
  }

  function overallMeterHtml(overall) {
    if (overall == null || !Number.isFinite(Number(overall))) return '';
    var v = Math.max(1, Math.min(5, Number(overall)));
    return '<div class="fw-iv-axis fw-iv-axis--overall"><div class="fw-iv-axis-top"><span>Overall</span>'
      + '<span class="fw-iv-axis-score">' + overall + '/5</span></div>'
      + '<div class="fw-iv-axis-track"><div class="fw-iv-axis-fill" style="width:' + (v / 5 * 100) + '%"></div></div></div>';
  }

  function renderDebrief(debrief) {
    var scores = (debrief && debrief.scores) || {};
    var axesHtml = AXIS_ORDER.map(function (k) { return axisMeterHtml(AXIS_LABELS[k], scores[k]); }).join('');
    var overallHtml = overallMeterHtml(scores.overall);
    var verdictHtml = debrief && debrief.verdict
      ? '<p class="fw-iv-verdict">' + esc(debrief.verdict) + '</p>' : '';

    var highlights = Array.isArray(debrief && debrief.highlights) ? debrief.highlights : [];
    var hlHtml = highlights.length
      ? '<div class="fw-iv-debrief-section"><h4>Highlights</h4><ul class="fw-iv-debrief-list">'
        + highlights.map(function (h) {
          return '<li><strong>' + esc(h.q || 'Question') + ':</strong> ' + esc(h.note) + '</li>';
        }).join('') + '</ul></div>'
      : '';

    var actions = Array.isArray(debrief && debrief.actions) ? debrief.actions : [];
    var actHtml = actions.length
      ? '<div class="fw-iv-debrief-section"><h4>Next time</h4><ul class="fw-iv-debrief-list fw-iv-debrief-actions">'
        + actions.map(function (a) {
          return '<li class="fw-iv-debrief-action-item"><label><input type="checkbox"> <span>' + esc(a) + '</span></label></li>';
        }).join('') + '</ul></div>'
      : '';

    var body = overlay.querySelector('#fw-iv-debrief-body');
    if (body) {
      body.innerHTML = overallHtml + axesHtml + verdictHtml + hlHtml + actHtml
        + '<div class="fw-iv-debrief-section fw-iv-metric-log" id="fw-iv-metric-log">'
        + '<h4>Metric log</h4><p class="fw-iv-metric-empty">Loading your history…</p></div>';
    }
    showScreen('debrief');
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function buildChartSvg(sessions) {
    var W = 320, H = 90, PAD = 10;
    var n = sessions.length;
    var pts = sessions.map(function (s, i) {
      var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
      var v = Math.max(1, Math.min(5, Number(s.scores.overall)));
      var y = H - PAD - ((v - 1) / 4) * (H - PAD * 2);
      return { x: x, y: y };
    });
    var poly = pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var dots = pts.map(function (p) {
      return '<circle class="fw-iv-metric-dot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"></circle>';
    }).join('');
    var firstDate = esc(fmtShortDate(sessions[0] && sessions[0].created_at));
    var lastDate = esc(fmtShortDate(sessions[n - 1] && sessions[n - 1].created_at));
    return '<svg class="fw-iv-metric-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Overall score over recent sessions">'
      + '<polyline class="fw-iv-metric-line" points="' + poly + '"></polyline>' + dots + '</svg>'
      + '<div class="fw-iv-metric-axis"><span>' + firstDate + '</span><span>' + lastDate + '</span></div>';
  }

  function buildDeltasHtml(sessionsNewestFirst) {
    if (!sessionsNewestFirst || sessionsNewestFirst.length < 2) return '';
    var latest = sessionsNewestFirst[0].scores || {};
    var prev = sessionsNewestFirst[1].scores || {};
    var rows = AXIS_ORDER.concat(['overall']).map(function (k) {
      var lv = latest[k], pv = prev[k];
      if (lv === 'N/A' || pv === 'N/A' || lv == null || pv == null
        || !Number.isFinite(Number(lv)) || !Number.isFinite(Number(pv))) return '';
      var delta = Math.round((Number(lv) - Number(pv)) * 10) / 10;
      var cls = delta > 0 ? 'is-up' : (delta < 0 ? 'is-down' : '');
      var sign = delta > 0 ? '+' : '';
      var label = k === 'overall' ? 'Overall' : (AXIS_LABELS[k] || k);
      return '<div class="fw-iv-metric-delta-item"><span>' + esc(label) + '</span> '
        + '<span class="fw-rc-delta ' + cls + '">' + sign + delta + '</span></div>';
    }).filter(Boolean).join('');
    if (!rows) return '';
    return '<div class="fw-iv-metric-deltas"><div class="fw-iv-metric-deltas-title">Since last session</div>' + rows + '</div>';
  }

  function loadMetricLog() {
    getJson('/mock-interview').then(function (d) {
      var sessions = (d && Array.isArray(d.sessions)) ? d.sessions : [];
      renderMetricLog(sessions);
    }).catch(function () { renderMetricLog([]); });
  }

  function renderMetricLog(sessionsNewestFirst) {
    var wrap = overlay.querySelector('#fw-iv-metric-log');
    if (!wrap) return;
    var recent = sessionsNewestFirst.slice(0, 10);
    var chronological = recent.slice().reverse().filter(function (s) {
      return s.scores && Number.isFinite(Number(s.scores.overall));
    });
    var chartHtml = chronological.length
      ? buildChartSvg(chronological)
      : '<p class="fw-iv-metric-empty">Not enough sessions yet for a trend chart.</p>';
    var deltaHtml = buildDeltasHtml(recent);
    wrap.innerHTML = '<h4>Metric log</h4>' + chartHtml + deltaHtml;
  }

  // ── Upgrade gate ───────────────────────────────────────────────────────

  function showUpgradeGate() {
    stopTimer();
    var body = overlay.querySelector('.fw-iv-body');
    if (!body) return;
    var gated = global.FWEnt && typeof FWEnt.gate === 'function' && FWEnt.gate(body, 'mock-interview');
    if (!gated) {
      body.innerHTML = '<div class="fw-ent-gate"><p class="fw-ent-gate-title">A Flight Plan feature</p>'
        + '<p class="fw-ent-gate-sub">Mock interviews are part of Flight Plan.</p>'
        + '<a class="fw-ent-gate-cta" href="pricing.html">See Flight Plan &rarr;</a></div>';
    }
  }

  // ── Build / lifecycle ─────────────────────────────────────────────────

  function newInterview() {
    stopTimer();
    state = freshState();
    var transcriptPane = overlay.querySelector('#fw-iv-transcript');
    if (transcriptPane) transcriptPane.innerHTML = '';
    var companyNote = overlay.querySelector('#fw-iv-company-note');
    if (companyNote) companyNote.hidden = true;
    hideTurnError();
    hideSetupError();
    hideDebriefError();
    if (answerHintTimer) { clearTimeout(answerHintTimer); answerHintTimer = null; }
    var hint = overlay.querySelector('#fw-iv-answer-hint');
    if (hint) hint.hidden = true;
    var timerEl = overlay.querySelector('#fw-iv-timer');
    if (timerEl) timerEl.textContent = '0:00';
    disableAnswerInput(false);
    fillSetupDefaults();
    showScreen('setup');
    var input = overlay.querySelector('#fw-iv-career');
    if (input) input.focus();
  }

  function buildPanel() {
    state = freshState();
    overlay = document.createElement('div');
    overlay.className = 'fw-iv-overlay';
    overlay.id = 'fw-iv-overlay';
    overlay.hidden = true;
    overlay.innerHTML = ''
      + '<div class="fw-iv-modal fw-iv-modal--mock" role="dialog" aria-modal="true" aria-labelledby="fw-iv-title">'
      + '<button type="button" class="fw-iv-close" id="fw-iv-close" aria-label="Close">&times;</button>'
      + '<h3 id="fw-iv-title">Mock interview</h3>'
      + '<div class="fw-iv-body">'

      + '<div id="fw-iv-screen-setup" class="fw-iv-screen">'
      + '<p class="fw-iv-sub">8 questions, about 20 minutes, one interviewer throughout. Feedback comes at the end.</p>'
      + '<div class="fw-iv-row"><input type="text" id="fw-iv-career" class="fw-iv-input" placeholder="Target career, e.g. Financial Analyst" autocomplete="off"></div>'
      + '<div class="fw-iv-persona-grid" id="fw-iv-persona-grid">'
      + PERSONA_CARDS.map(function (p, i) {
        return '<button type="button" class="fw-iv-persona-card' + (i === 0 ? ' is-active' : '') + '" data-persona="' + esc(p.id) + '">'
          + '<div class="fw-iv-persona-name">' + esc(p.name) + '</div>'
          + '<div class="fw-iv-persona-tag">' + esc(p.tag) + '</div></button>';
      }).join('')
      + '</div>'
      + '<details class="fw-iv-company-details">'
      + '<summary>Preparing for a specific company?</summary>'
      + '<input type="text" id="fw-iv-company" class="fw-iv-input" maxlength="' + MAX_COMPANY_CHARS + '" placeholder="Company name (optional)" autocomplete="off">'
      + '</details>'
      + '<button type="button" id="fw-iv-start" class="fw-iv-btn fw-iv-btn--primary fw-iv-btn--block">Start interview</button>'
      + '<p id="fw-iv-setup-status" class="fw-iv-statusline" aria-live="polite"></p>'
      + '<p id="fw-iv-setup-error" class="fw-iv-error" hidden></p>'
      + '</div>'

      + '<div id="fw-iv-screen-interview" class="fw-iv-screen" hidden>'
      + '<div class="fw-iv-progress-row">'
      + '<span id="fw-iv-progress-label" class="fw-iv-progress-label">Question 1 of 8</span>'
      + '<span id="fw-iv-phase-label" class="fw-iv-phase-label">Intro</span>'
      + '<span id="fw-iv-timer" class="fw-iv-timer">0:00</span>'
      + '</div>'
      + '<p id="fw-iv-company-note" class="fw-iv-company-note" hidden></p>'
      + '<div id="fw-iv-transcript" class="fw-iv-transcript" aria-live="polite"></div>'
      + '<div id="fw-iv-thinking" class="fw-iv-thinking" hidden aria-hidden="true"><span></span><span></span><span></span></div>'
      + '<div id="fw-iv-turn-error" class="fw-iv-error fw-iv-turn-error" hidden>'
      + '<span id="fw-iv-turn-error-text"></span> '
      + '<button type="button" id="fw-iv-retry" class="fw-iv-btn fw-iv-btn--small">Retry</button>'
      + '</div>'
      + '<form id="fw-iv-answer-form" class="fw-iv-answer-row">'
      + '<textarea id="fw-iv-answer" class="fw-iv-answer" rows="3" maxlength="2000" placeholder="Type your answer…"></textarea>'
      + '<button type="submit" id="fw-iv-send" class="fw-iv-btn fw-iv-btn--primary">Send</button>'
      + '</form>'
      + '<p id="fw-iv-answer-hint" class="fw-iv-answer-hint" hidden>Type your answer first</p>'
      + '</div>'

      + '<div id="fw-iv-screen-debrief-loading" class="fw-iv-screen" hidden>'
      + '<p class="fw-iv-statusline">Preparing your debrief…</p>'
      + '<p id="fw-iv-debrief-error" class="fw-iv-error" hidden><span id="fw-iv-debrief-error-text"></span> '
      + '<button type="button" id="fw-iv-debrief-retry" class="fw-iv-btn fw-iv-btn--small">Retry</button></p>'
      + '</div>'

      + '<div id="fw-iv-screen-debrief" class="fw-iv-screen" hidden>'
      + '<div id="fw-iv-debrief-body"></div>'
      + '<button type="button" id="fw-iv-new" class="fw-iv-btn fw-iv-btn--primary fw-iv-btn--block">New interview</button>'
      + '</div>'

      + '</div></div>';
    (document.getElementById('page-coach') || document.body).appendChild(overlay);

    overlay.querySelector('#fw-iv-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#fw-iv-start').addEventListener('click', startInterview);
    overlay.querySelector('#fw-iv-answer-form').addEventListener('submit', sendAnswer);
    overlay.querySelector('#fw-iv-retry').addEventListener('click', retryTurn);
    overlay.querySelector('#fw-iv-debrief-retry').addEventListener('click', requestDebrief);
    overlay.querySelector('#fw-iv-new').addEventListener('click', newInterview);
    wirePersonaCards();
    fillSetupDefaults();
  }

  // First entry gets the interstitial instead of the panel — and on the free
  // plan that interstitial IS the upgrade surface, so its CTA navigates away
  // and the panel never opens. Both outcomes mark the feature seen, so this
  // branch runs at most once per student.
  function open() {
    if (global.FWFeatureIntro && typeof FWFeatureIntro.isSeen === 'function'
        && !FWFeatureIntro.isSeen('mock-interview')) {
      FWFeatureIntro.show('mock-interview').then(function (how) {
        if (how === 'go') openPanel();
      });
      return;
    }
    openPanel();
  }

  // S12 — role context handed over by an application card in the tracker
  // (`coach.html?ivRole=…&ivCompany=…#practice`). Held here rather than applied
  // at read time because open() may route through the first-run interstitial
  // first, and the panel does not exist until the student comes back from it.
  var pendingPrefill = null;

  function applyPendingPrefill() {
    if (!pendingPrefill || !overlay) return;
    var p = pendingPrefill;
    pendingPrefill = null;
    var career = overlay.querySelector('#fw-iv-career');
    if (career && p.role) {
      career.value = p.role;
      // Not the student's O*NET target career, so the soc must not ride along:
      // a specific posting is a job title, and `startInterview` keys the soc off
      // exactly this comparison.
      state.prefilledCareerName = '';
      state.soc = '';
    }
    var company = overlay.querySelector('#fw-iv-company');
    if (company && p.company) {
      company.value = p.company;
      var details = company.closest ? company.closest('details') : null;
      if (details) details.open = true;
    }
    // S18 — the Interview Season's week carries its own persona (week 4 is the
    // pressure week, and composure is the axis that comfortable practice never
    // touches). Selecting the card here rather than telling the student which
    // toggle to find is the whole reason the program links in with context.
    if (p.persona) {
      var grid = overlay.querySelector('#fw-iv-persona-grid');
      var card = grid && grid.querySelector('.fw-iv-persona-card[data-persona="' + p.persona + '"]');
      if (card) {
        var cards = grid.querySelectorAll('.fw-iv-persona-card');
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-active');
        card.classList.add('is-active');
        state.persona = p.persona === 'pressure' ? 'pressure' : 'coach';
      }
    }
  }

  function openPanel() {
    if (!overlay) buildPanel();
    overlay.hidden = false;
    applyPendingPrefill();
    logEvent('mockiv_open');
    setTimeout(function () {
      var input = overlay.querySelector('#fw-iv-career');
      if (input && !input.value) input.focus();
    }, 60);
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

  // S7: the Flight Plan's Mock Interview door links to coach.html#practice, so
  // the door opens the thing it names instead of dropping the student on the
  // chat page to hunt for a button. Goes through open() so the first-time
  // interstitial (and, on the free plan, its upsell) still fires.
  function openFromHash() {
    if ((location.hash || '') !== '#practice') return;
    // S12: read the role context BEFORE the URL is cleaned, then drop the whole
    // query with the hash — leaving `?ivRole=` behind would re-prefill on every
    // later open in the same tab.
    try {
      var q = new URLSearchParams(location.search || '');
      var role = (q.get('ivRole') || '').trim().slice(0, 120);
      var company = (q.get('ivCompany') || '').trim().slice(0, MAX_COMPANY_CHARS);
      // S18. A QUERY param, not part of the fragment: `openFromHash` matches the
      // hash EXACTLY, so a `#practice&persona=pressure` would silently fail to
      // open the panel at all — the deep link would look broken with nothing in
      // the console to say why.
      var persona = (q.get('ivPersona') || '').trim() === 'pressure' ? 'pressure' : '';
      if (role || company || persona) pendingPrefill = { role: role, company: company, persona: persona };
      q.delete('ivRole');
      q.delete('ivCompany');
      q.delete('ivPersona');
      var rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    } catch (_) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (__) {}
    }
    open();
  }

  function init() {
    buildPanel();
    mountLauncher();
    openFromHash();
    global.addEventListener('hashchange', openFromHash);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.FWInterviewMode = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
