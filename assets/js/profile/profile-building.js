/**
 * Profile Building (H) — "Help us know YOU better"
 * Short free-text prompts that feed the AI dossier for coach + deep dives.
 */
(function (global) {
  'use strict';

  var PROFILE_VERSION = 2;

  var QUESTIONS = [
    {
      id: 'unfinished',
      prompt: "What's something you're working on — or want to start — that you haven't had time to finish?",
      placeholder: 'A project, class, side hustle, application…',
    },
    {
      id: 'friends',
      prompt: "What do people who know you well say you're naturally good at?",
      placeholder: 'Math, listening, organizing, making people laugh…',
    },
    {
      id: 'curious',
      prompt: "Any jobs or fields you've been quietly curious about — even if they feel like a long shot?",
      placeholder: 'No wrong answers — even a vague hunch counts.',
    },
    {
      id: 'talk',
      prompt: 'What could you talk about for 20 minutes without needing to prepare?',
      placeholder: 'Could be a sport, show, hobby, debate topic…',
    },
    {
      id: 'downtime',
      prompt: 'When you have real free time — not scrolling — what do you actually choose to do?',
      placeholder: 'Be honest — this helps us personalize your coach.',
    },
  ];

  var cur = 0;
  var draft = {};
  var saving = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function readBuilding() {
    if (global.FWAuth && typeof FWAuth.readProfileBuilding === 'function') {
      return FWAuth.readProfileBuilding();
    }
    try {
      var quiz = global.FWAuth && FWAuth.readLocalQuiz ? FWAuth.readLocalQuiz() : null;
      return (quiz && quiz.profileBuilding) ? quiz.profileBuilding : null;
    } catch (_) { return null; }
  }

  function writeBuilding(patch) {
    if (global.FWAuth && typeof FWAuth.writeProfileBuilding === 'function') {
      return FWAuth.writeProfileBuilding(patch);
    }
    return null;
  }

  function quizContext() {
    if (global.FWProfileBuildingFallback && typeof FWProfileBuildingFallback.quizContextFromLocal === 'function') {
      return FWProfileBuildingFallback.quizContextFromLocal();
    }
    return {};
  }

  function answersFromBuilding(pb) {
    if (!pb || !Array.isArray(pb.answers)) return {};
    var map = {};
    pb.answers.forEach(function (a) {
      if (!a || !a.id || !a.answer) return;
      map[a.id] = String(a.answer).trim();
    });
    return map;
  }

  function flushCurrentInput() {
    var input = document.getElementById('pb-input');
    if (!input || cur < 0 || cur >= QUESTIONS.length) return;
    draft[QUESTIONS[cur].id] = input.value;
  }

  function collectAnswers() {
    flushCurrentInput();
    return QUESTIONS.map(function (q) {
      var text = String(draft[q.id] || '').trim();
      if (!text) return null;
      return { id: q.id, prompt: q.prompt, answer: text.slice(0, 400) };
    }).filter(Boolean);
  }

  function answeredCount() {
    return collectAnswers().length;
  }

  function isComplete(pb) {
    return !!(pb && pb.completedAt);
  }

  function needsHint(pb) {
    if (!pb) return true;
    if (pb.completedAt) return false;
    if (pb.promptDismissedAt && !(pb.answers && pb.answers.length)) return false;
    return !pb.completedAt;
  }

  function render() {
    var root = document.getElementById('pb-root');
    if (!root) return;

    var q = QUESTIONS[cur];
    var total = QUESTIONS.length;
    var pct = Math.round(((cur + 1) / total) * 100);
    var val = draft[q.id] || '';
    var hasText = !!String(val).trim();
    var isLast = cur === total - 1;
    var anyAnswered = answeredCount() > 0;

    root.innerHTML = ''
      + '<div class="pb-wrap">'
      +   '<div class="pb-hero">'
      +     '<p class="pb-eyebrow">Help us know YOU better</p>'
      +     '<h1 class="pb-title">A few short prompts</h1>'
      +     '<p class="pb-sub">A few open questions the quiz could not ask. Your answers become a short read about you '
      +     'that Marco and every deep dive work from.</p>'
      +     '<p class="pb-hint">Write like you would text a friend — two honest sentences beat a paragraph you polished. '
      +     'Skip anything that does not speak to you.</p>'
      +   '</div>'
      +   '<div class="pb-prog" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">'
      +     '<div class="pb-prog-fill" style="width:' + pct + '%"></div>'
      +   '</div>'
      +   '<p class="pb-prog-lbl">Question ' + (cur + 1) + ' of ' + total + '</p>'
      +   '<div class="pb-card">'
      +     '<label class="pb-q" for="pb-input">' + esc(q.prompt) + '</label>'
      +     '<textarea id="pb-input" class="pb-input" rows="5" maxlength="400" placeholder="' + esc(q.placeholder || '') + '">' + esc(val) + '</textarea>'
      +     '<p class="pb-meta"><span id="pb-char-count">' + val.length + '</span>/400</p>'
      +   '</div>'
      +   '<div class="pb-actions">'
      +     (cur > 0 ? '<button type="button" class="pb-btn pb-btn-ghost" id="pb-back">Back</button>' : '<span></span>')
      +     '<div class="pb-actions-right">'
      +       '<button type="button" class="pb-btn pb-btn-ghost" id="pb-skip">Skip question</button>'
      +       (isLast
          ? '<button type="button" class="pb-btn pb-btn-primary" id="pb-save"' + (anyAnswered ? '' : ' disabled') + '>Save to my profile</button>'
          : '<button type="button" class="pb-btn pb-btn-primary" id="pb-next"' + (hasText ? '' : ' disabled') + '>Continue</button>')
      +     '</div>'
      +   '</div>'
      +   (isLast ? '<button type="button" class="pb-later" id="pb-later">Maybe later</button>' : '')
      +   '<p class="pb-status" id="pb-status" aria-live="polite"></p>'
      + '</div>';

    var input = root.querySelector('#pb-input');
    var nextBtn = root.querySelector('#pb-next');
    var saveBtn = root.querySelector('#pb-save');
    var skipBtn = root.querySelector('#pb-skip');
    var backBtn = root.querySelector('#pb-back');
    var laterBtn = root.querySelector('#pb-later');
    var statusEl = root.querySelector('#pb-status');
    var charCount = root.querySelector('#pb-char-count');

    if (input) {
      input.addEventListener('input', function () {
        draft[q.id] = input.value;
        if (charCount) charCount.textContent = String(input.value.length);
        if (nextBtn) nextBtn.disabled = !String(input.value).trim();
        flushCurrentInput();
        if (saveBtn) saveBtn.disabled = !answeredCount();
      });
      setTimeout(function () { input.focus(); }, 80);
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        if (isLast) {
          flushCurrentInput();
          if (answeredCount()) saveProfile(statusEl, saveBtn);
          else exitFlow();
        } else {
          cur += 1;
          render();
        }
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        flushCurrentInput();
        if (cur > 0) { cur -= 1; render(); }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        flushCurrentInput();
        if (!String(draft[q.id] || '').trim()) return;
        cur += 1;
        render();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveProfile(statusEl, saveBtn);
      });
    }

    if (laterBtn) {
      laterBtn.addEventListener('click', function () {
        writeBuilding({ promptDismissedAt: new Date().toISOString() });
        exitFlow();
      });
    }
  }

  function ensureLoadingOverlay() {
    var page = document.getElementById('page-profile-build');
    if (!page) return null;
    var el = document.getElementById('pb-loading-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pb-loading-overlay';
    el.className = 'pb-loading-overlay';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = ''
      + '<div class="pb-loading-card" aria-busy="true">'
      + '<h2>Generating your analysis…</h2>'
      + '<p>Taking you to your home page.</p>'
      // Step-card silhouette: heading bar, body lines, button-shaped bar.
      + '<div class="pb-loading-skeleton" aria-hidden="true">'
      + '<span class="fw-skeleton pb-skel-head"></span>'
      + '<span class="fw-skeleton pb-skel-line"></span>'
      + '<span class="fw-skeleton pb-skel-line pb-skel-line--short"></span>'
      + '<span class="fw-skeleton pb-skel-btn"></span>'
      + '</div>'
      + '<span class="fw-vh">Loading…</span>'
      + '</div>';
    page.appendChild(el);
    return el;
  }

  function showLoadingOverlay() {
    var el = ensureLoadingOverlay();
    if (!el) return;
    el.hidden = false;
    document.body.classList.add('pb-page-loading');
  }

  function hideLoadingOverlay() {
    var el = document.getElementById('pb-loading-overlay');
    if (el) el.hidden = true;
    document.body.classList.remove('pb-page-loading');
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function exitFlow() {
    var signedIn = global.FWAuth && FWAuth.authEmail && FWAuth.authEmail();
    if (signedIn) {
      location.href = (global.FWPageBoot && FWPageBoot.URLS.portal) || 'portal.html';
    } else {
      location.href = (global.FWPageBoot && FWPageBoot.authSignInUrl)
        ? FWPageBoot.authSignInUrl('profile-build.html')
        : 'auth.html#signin?next=' + encodeURIComponent('profile-build.html');
    }
  }

  async function saveProfile(statusEl, saveBtn) {
    if (saving) return;
    flushCurrentInput();
    var answers = collectAnswers();
    if (!answers.length) return;

    saving = true;
    var overlayStarted = Date.now();
    showLoadingOverlay();
    if (saveBtn) {
      if (global.FWButtonBusy) FWButtonBusy.start(saveBtn, { label: 'Saving…' });
      else { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    }
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'pb-status';
    }

    var now = new Date().toISOString();
    var ctx = quizContext();

    writeBuilding({
      version: PROFILE_VERSION,
      answers: answers,
      completedAt: now,
    });

    try {
      var fetchFn = (global.FWAuth && typeof FWAuth.authFetch === 'function')
        ? FWAuth.authFetch
        : fetch;
      var reqOpts = {
        method: 'POST',
        body: { answers: answers, quizContext: ctx },
      };
      if (fetchFn === fetch) {
        reqOpts.credentials = 'include';
        reqOpts.headers = { 'Content-Type': 'application/json' };
        reqOpts.body = JSON.stringify(reqOpts.body);
      }
      var resp = await fetchFn('/profile-building', reqOpts);
      var data = {};
      try { data = await resp.json(); } catch (_) { /* ignore */ }
      if (resp.ok && data.characterSummary && global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') {
        var quiz = FWAuth.readLocalQuiz() || {};
        quiz.characterSummary = data.characterSummary;
        if (typeof FWAuth.writeLocalQuiz === 'function') FWAuth.writeLocalQuiz(quiz);
      }
      if (resp.ok && global.FWAuth && typeof FWAuth.applySectorFitFromResponse === 'function') {
        FWAuth.applySectorFitFromResponse(data);
      }
      if (resp.ok && data.personalityVector && global.FWAuth
        && typeof FWAuth.applyVectorsFromResponse === 'function') {
        FWAuth.applyVectorsFromResponse(data);
      } else if (resp.ok && data.personalityVector && global.FWOnetVectors
        && typeof FWOnetVectors.writeQuizPersonalityVector === 'function') {
        FWOnetVectors.writeQuizPersonalityVector(data.personalityVector);
      }
      if (resp.ok && data.personalityPatch && data.personalityPatch.dimensions) {
        console.info('[profile-building] personality patch applied', data.personalityPatch);
      }
      if (resp.ok && global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') {
        var quizPatch = FWAuth.readLocalQuiz() || {};
        if (data.personalityPatchFailed) {
          quizPatch.personalityPatchFailed = true;
        } else if (data.personalityPatch || data.personalityVector) {
          delete quizPatch.personalityPatchFailed;
        }
        if (typeof FWAuth.writeLocalQuiz === 'function') FWAuth.writeLocalQuiz(quizPatch);
      }
      if (!resp.ok) {
        console.warn('profile-building API error', data.error || resp.status);
      }
      if (resp.ok && data.roadmap && global.FWAuth && FWAuth.ROADMAP_KEY) {
        try {
          localStorage.setItem(FWAuth.ROADMAP_KEY, JSON.stringify(data.roadmap));
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.warn('profile-building API failed', err);
    }

    if (global.FWAuth && FWAuth.authEmail && FWAuth.authEmail()) {
      try {
        if (typeof FWAuth.uploadLocalQuizIfPresent === 'function') {
          await FWAuth.uploadLocalQuizIfPresent();
        }
        if (typeof FWAuth.refreshPortalSnapshot === 'function') {
          await FWAuth.refreshPortalSnapshot({ force: true });
        }
      } catch (err) {
        console.warn('profile sync failed', err);
      }
    }

    var elapsed = Date.now() - overlayStarted;
    if (elapsed < 400) await waitMs(400 - elapsed);

    saving = false;
    hideLoadingOverlay();
    exitFlow();
  }

  // FW2.0 A2 — firm-up flow: profile-build.html?dims=<id,id> front-loads the
  // questions that best raise those estimated coordinates (see DIM_QUESTION_MAP
  // in onet-quiz-seed.js). The Dimension Viewer's "firm up" CTA sets ?dims=.
  function dimsFromQuery() {
    try {
      var raw = new URLSearchParams(location.search).get('dims');
      if (!raw) return [];
      return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
    } catch (_) { return []; }
  }
  var firmedUp = false;
  function frontLoadFirmUpQuestions() {
    if (firmedUp) return;
    var dims = dimsFromQuery();
    if (!dims.length || !global.FWOnetQuizSeed || typeof FWOnetQuizSeed.questionsForDims !== 'function') return;
    var prompts = FWOnetQuizSeed.questionsForDims(dims);
    if (!prompts.length) return;
    var added = prompts.slice(0, 3).map(function (p, i) {
      return { id: 'firm_' + i, prompt: p, placeholder: 'A sentence or two is plenty — this sharpens an estimated dimension.' };
    });
    QUESTIONS = added.concat(QUESTIONS);
    firmedUp = true;
    try { if (global.FWEvents) FWEvents.log('firmup_start', { dims: dims.length }); } catch (_) {}
  }

  function open(opts) {
    opts = opts || {};
    frontLoadFirmUpQuestions();
    var pb = readBuilding() || {};
    draft = answersFromBuilding(pb);
    cur = typeof opts.startAt === 'number' ? opts.startAt : 0;
    if (cur < 0 || cur >= QUESTIONS.length) cur = 0;
    saving = false;
    render();
    if (typeof showPage === 'function') {
      showPage('profile-build');
    } else if (!document.getElementById('pb-root')) {
      location.href = (global.FWPageBoot && FWPageBoot.URLS.profile) || 'profile-build.html';
    }
  }

  global.FWProfileBuilding = {
    QUESTIONS: QUESTIONS,
    open: open,
    render: render,
    readBuilding: readBuilding,
    isComplete: isComplete,
    needsHint: needsHint,
    dismissPrompt: function () {
      writeBuilding({ promptDismissedAt: new Date().toISOString() });
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
