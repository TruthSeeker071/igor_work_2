/**
 * Career Hub — "Sharpen your matches" refine panel.
 *
 * The initial quiz is intentionally short (7 questions → fast email capture).
 * The remaining personality questions live HERE, in a collapsible panel on the
 * right of the Career Hub. Answering them and pressing "Update my matches"
 * recomputes industry scores and re-applies them to the map (FWHubCareers
 * mutates each career.fitScore; the dashboard's RAF loop redraws automatically).
 *
 * LocalStorage: fw_hub_refine_v1 (refine answers), fw_hub_base_scores_v1 ({ raw } pre-refine scores).
 *
 * Self-contained on purpose: it does NOT load the full quiz app. The refine
 * questions carry their own (compact) industry-scoring maps, adapted from the
 * quiz's QZ_Qs scoring.
 */
(function () {
  'use strict';

  if (!window.FWHubCareers) return;
  var FWH = window.FWHubCareers;

  var BASE_KEY  = 'fw_hub_base_scores_v1';
  var QUIZ_KEY  = (FWH.HUB_QUIZ_KEY) || 'fw_hub_quiz_v1';
  var ANS_KEY   = 'fw_hub_refine_v1';
  var UPDATED_KEY = 'fw_hub_refine_updated_v1';

  // Industry universe — prefer the canonical QZ_IND if quiz-data.js is loaded,
  // else fall back to the keys referenced by the career→industry map.
  var IND_KEYS = (typeof QZ_IND !== 'undefined' && QZ_IND)
    ? Object.keys(QZ_IND)
    : (function () {
        var set = {};
        var map = FWH.careerToQuizKeys || {};
        Object.keys(map).forEach(function (id) { (map[id] || []).forEach(function (k) { set[k] = 1; }); });
        return Object.keys(set);
      })();

  // ── Refine questions (compact, with scoring maps from the quiz) ──────────
  var Qs = [
    { id: 'subjects', type: 'tags', q: 'What subjects light you up?', sub: 'Tap everything that excites you.',
      tags: [
        { t: '🧮 Math',            s: { tech: 2, science: 2, finance: 3, engineering: 2 } },
        { t: '✍️ Writing',         s: { creative: 3, marketing: 2, education: 2, media: 2 } },
        { t: '🔬 Science',         s: { science: 4, healthcare: 2, pharmaceutical: 2 } },
        { t: '🎨 Art & Design',    s: { creative: 4, marketing: 2 } },
        { t: '💼 Business',        s: { business: 3, finance: 2, startups: 1, operations: 1 } },
        { t: '💻 Tech / Coding',   s: { tech: 4, engineering: 2, cybersecurity: 2 } },
        { t: '🧠 Psychology',      s: { healthcare: 2, social: 2, education: 2, hr: 2 } },
        { t: '⚖️ Politics',        s: { law: 3, social: 2, government: 2 } },
        { t: '🩺 Medicine',        s: { healthcare: 4, science: 1, pharmaceutical: 2 } },
        { t: '🏗️ Engineering',     s: { engineering: 4, tech: 1, aerospace: 2 } },
        { t: '📈 Economics',       s: { finance: 3, business: 3, realestate: 1 } },
        { t: '🎬 Film & Media',    s: { creative: 3, marketing: 2, media: 3 } },
        { t: '🌍 Global Issues',   s: { social: 3, law: 2, government: 1 } },
        { t: '🔧 Hands-on Building',s: { trades: 4, engineering: 2, operations: 1 } },
        { t: '🛡️ Cybersecurity',   s: { cybersecurity: 4, tech: 2 } },
        { t: '🏨 Hospitality',     s: { hospitality: 4, business: 1 } }
      ] },
    { id: 'workday', type: 'mc', q: 'Which sounds most like your ideal workday?',
      opts: [
        { t: 'Heads-down building, coding, or engineering something new', s: { tech: 4, engineering: 3, science: 1 } },
        { t: 'Meetings, presentations, negotiations, strategy', s: { business: 4, law: 3, finance: 2, marketing: 2 } },
        { t: 'Designing, creating, or producing original work', s: { creative: 4, marketing: 2, startups: 1 } },
        { t: 'Working directly with patients, clients, or students', s: { healthcare: 4, social: 3, education: 3 } },
        { t: 'Research, analysis, writing, deep thought', s: { science: 4, education: 2, law: 1, tech: 1 } }
      ] },
    { id: 'problem', type: 'mc', q: 'When you tackle a hard problem, your instinct is to:',
      opts: [
        { t: 'Crunch the data and find the pattern', s: { tech: 3, finance: 3, science: 3 } },
        { t: 'Sketch wild ideas and prototype', s: { creative: 3, startups: 3, marketing: 2 } },
        { t: 'Talk to people and build consensus', s: { business: 3, law: 2, education: 2, social: 2 } },
        { t: 'Apply proven frameworks methodically', s: { engineering: 3, healthcare: 2, law: 2, finance: 1 } }
      ] },
    { id: 'path', type: 'mc', q: 'Which career trajectory sounds most YOU?',
      opts: [
        { t: 'Stable corporate ladder', s: { finance: 3, business: 2, law: 2, healthcare: 1 } },
        { t: 'Professional craft / expertise', s: { healthcare: 2, education: 2, law: 1, engineering: 2 } },
        { t: 'Balanced growth path', s: { business: 1, tech: 1, marketing: 1, education: 1 } },
        { t: 'Fast-moving company', s: { tech: 2, marketing: 2, startups: 2 } },
        { t: 'Bold founder / builder', s: { startups: 4, creative: 1, tech: 1 } }
      ] },
    { id: 'hours', type: 'slider', q: 'How many hours are you willing to work?', ll: 'Light', ml: '9–5', rl: '80+',
      score: function (v) { var x = v / 100; return { finance: x * 3, law: x * 3, startups: x * 3, business: x * 2, healthcare: x * 1, education: (1 - x) * 3, government: (1 - x) * 2, trades: (1 - x) * 1, social: (1 - x) * 2 }; } },
    { id: 'intensity', type: 'slider', q: 'What work intensity energizes you?', ll: 'Calm & steady', rl: 'Pressure-cooker',
      score: function (v) { var x = v / 100; return { startups: x * 4, finance: x * 2, business: x * 2, law: x * 2, education: (1 - x) * 3, social: (1 - x) * 2, science: (1 - x) * 2 }; } },
    { id: 'creative', type: 'slider', q: 'Where do you sit: structured vs. creative?', ll: 'Highly structured', rl: 'Highly creative',
      score: function (v) { var c = v / 100; return { creative: c * 3, startups: c * 2, marketing: c * 2, law: (1 - c) * 3, finance: (1 - c) * 2, engineering: (1 - c) * 2 }; } },
    { id: 'social', type: 'slider', q: 'Where do you sit: solo vs. team?', ll: 'Solo worker', rl: 'Team player',
      score: function (v) { var x = v / 100; return { business: x * 3, healthcare: x * 2, social: x * 2, education: x * 1, marketing: x * 1, tech: (1 - x) * 2, science: (1 - x) * 3 }; } }
    ];

  var TOTAL = Qs.length;

  // ── State ────────────────────────────────────────────────────────────────
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function writeJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }

  var answers = readJson(ANS_KEY) || {}; // { subjects:[i], workday:i, ..., risk:0-100 }
  var open = false;

  function isAnswered(q) {
    var a = answers[q.id];
    if (q.type === 'tags') return Array.isArray(a) && a.length > 0;
    if (q.type === 'mc') return typeof a === 'number';
    if (q.type === 'slider') return typeof a === 'number';
    return false;
  }
  function answeredCount() { var n = 0; Qs.forEach(function (q) { if (isAnswered(q)) n++; }); return n; }

  // ── Scoring ────────────────────────────────────────────────────────────────
  function refineDelta() {
    var d = {};
    function add(s, m) { if (!s) return; m = m || 1; Object.keys(s).forEach(function (k) { d[k] = (d[k] || 0) + s[k] * m; }); }
    Qs.forEach(function (q) {
      if (!isAnswered(q)) return;
      var a = answers[q.id];
      if (q.type === 'tags') a.forEach(function (i) { add(q.tags[i] && q.tags[i].s); });
      else if (q.type === 'mc') {
        add(q.opts[a] && q.opts[a].s, 2);
        q.opts.forEach(function (o, i) {
          if (i !== a) add(o.s, -1);
        });
      }
      else if (q.type === 'slider') add(q.score(a));
    });
    return d;
  }

  function normalize(sc) {
    var max = 1;
    IND_KEYS.forEach(function (k) { if ((sc[k] || 0) > max) max = sc[k]; });
    var out = {};
    IND_KEYS.forEach(function (k) { out[k] = Math.max(0, Math.round(((sc[k] || 0) / max) * 100)); });
    return out;
  }

  // Raw initial-quiz scores, captured once so refine is idempotent.
  function baseScores() {
    var cached = readJson(BASE_KEY);
    if (cached && cached.raw && typeof cached.raw === 'object') return cached.raw;
    var quiz = readJson(QUIZ_KEY);
    var raw = (quiz && quiz.scoresRaw) ? quiz.scoresRaw : null;
    var fromNormalizedFallback = false;
    if (!raw && quiz && quiz.scores) {
      raw = quiz.scores;
      fromNormalizedFallback = true;
    }
    writeJson(BASE_KEY, { raw: raw || {}, capturedAt: Date.now(), fromNormalizedFallback: fromNormalizedFallback });
    return raw || {};
  }

  function migrateLegacyBase() {
    var cached = readJson(BASE_KEY);
    if (cached && typeof cached === 'object' && !cached.raw) {
      try { localStorage.removeItem(BASE_KEY); } catch (_) {}
    }
    var quiz = readJson(QUIZ_KEY);
    if (quiz && quiz.scoresRaw) {
      var again = readJson(BASE_KEY);
      if (!again || !again.raw || again.fromNormalizedFallback) {
        try { localStorage.removeItem(BASE_KEY); } catch (_) {}
      }
    }
  }

  // Refine deltas are raw quiz points; weight up so they reshape the map.
  var REFINE_WEIGHT = 4;

  function compactRefineAnswers() {
    var subjQ = Qs.find(function (q) { return q.id === 'subjects'; });
    var out = {
      hours: typeof answers.hours === 'number' ? answers.hours : null,
      intensity: typeof answers.intensity === 'number' ? answers.intensity : null,
      creative: typeof answers.creative === 'number' ? answers.creative : null,
      social: typeof answers.social === 'number' ? answers.social : null,
      workday: typeof answers.workday === 'number' ? answers.workday : null,
      problem: typeof answers.problem === 'number' ? answers.problem : null,
      path: typeof answers.path === 'number' ? answers.path : null,
      subjects: [],
    };
    if (subjQ && Array.isArray(answers.subjects)) {
      answers.subjects.forEach(function (i) {
        var tag = subjQ.tags[i];
        if (tag && tag.t) out.subjects.push(String(tag.t).replace(/[^\w\s&/]/g, '').trim());
      });
    }
    return out;
  }

  function applyAndPersist() {
    var base = baseScores();
    var delta = refineDelta();
    var combined = {};
    IND_KEYS.forEach(function (k) {
      combined[k] = Math.max(0, (base[k] || 0) + (delta[k] || 0) * REFINE_WEIGHT);
    });
    var norm = (window.FWSectorFitSheet && typeof FWSectorFitSheet.sharpenSectorScores === 'function')
      ? FWSectorFitSheet.sharpenSectorScores(combined)
      : normalize(combined);

    if (typeof FWH.resetFitScores === 'function') FWH.resetFitScores();
    var onetActive = window.FWOnetHub && FWOnetHub.isReady && FWOnetHub.isReady();
    if (!onetActive && typeof FWH.applyQuizScores === 'function') FWH.applyQuizScores(norm);

    var quiz = readJson(QUIZ_KEY) || {};
    var oldScores = (window.FWSectorFitSheet && typeof FWSectorFitSheet.getCanonicalScores === 'function')
      ? FWSectorFitSheet.getCanonicalScores(quiz)
      : Object.assign({}, quiz.scores || {});
    quiz.scores = norm;
    if (window.FWSectorFitSheet && typeof FWSectorFitSheet.recordLocalPatches === 'function') {
      var patches = IND_KEYS.filter(function (k) {
        return Math.abs((norm[k] || 0) - (oldScores[k] || 0)) >= 1;
      }).map(function (k) {
        return { key: k, score: norm[k], reason: 'Sharpen your matches' };
      });
      if (patches.length) FWSectorFitSheet.recordLocalPatches(quiz, patches, 'refine');
    }
    quiz.refine = compactRefineAnswers();
    if (window.FWOnetVectors && typeof FWOnetVectors.persistQuizVectors === 'function') {
      quiz = FWOnetVectors.persistQuizVectors(quiz, { sync: true });
    } else {
      writeJson(QUIZ_KEY, quiz);
    }
    writeJson(ANS_KEY, answers);
    if (window.FWOnetHub && typeof FWOnetHub.refreshPersonalityFromQuiz === 'function') {
      FWOnetHub.refreshPersonalityFromQuiz();
      if (typeof FWOnetHub.invalidateViewport === 'function') FWOnetHub.invalidateViewport();
    }
    try { window.dispatchEvent(new CustomEvent('marco-refresh')); } catch (_) {}
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function questionHtml(q, qi) {
    var head = '<div class="hr-q-title">' + esc(q.q) + '</div>' + (q.sub ? '<div class="hr-q-sub">' + esc(q.sub) + '</div>' : '');
    var body = '';
    if (q.type === 'tags') {
      var picked = answers[q.id] || [];
      body = '<div class="hr-tags">' + q.tags.map(function (t, i) {
        var sel = picked.indexOf(i) !== -1 ? ' sel' : '';
        return '<button class="hr-tag' + sel + '" data-qi="' + qi + '" data-i="' + i + '" data-act="tag">' + esc(t.t) + '</button>';
      }).join('') + '</div>';
    } else if (q.type === 'mc') {
      var sel2 = answers[q.id];
      body = '<div class="hr-opts">' + q.opts.map(function (o, i) {
        var s = sel2 === i ? ' sel' : '';
        return '<button class="hr-opt' + s + '" data-qi="' + qi + '" data-i="' + i + '" data-act="mc">' + esc(o.t) + '</button>';
      }).join('') + '</div>';
    } else if (q.type === 'slider') {
      var v = typeof answers[q.id] === 'number' ? answers[q.id] : 50;
      var on = isAnswered(q) ? ' hr-slider-on' : '';
      body = '<div class="hr-slider-labels"><span>' + esc(q.ll) + '</span>'
        + (q.ml ? '<span>' + esc(q.ml) + '</span>' : '')
        + '<span>' + esc(q.rl) + '</span></div>'
        + '<input type="range" min="0" max="100" value="' + v + '" class="hr-slider' + on + '" data-qi="' + qi + '" data-act="slider">';
    }
    return '<div class="hr-q' + (isAnswered(q) ? ' answered' : '') + '">' + head + body + '</div>';
  }

  function panelHtml() {
    var done = answeredCount();
    return ''
      + '<div class="hr-head">'
      +   '<div class="hr-head-title">Sharpen your matches</div>'
      +   '<button class="hr-close" data-act="close" aria-label="Close">✕</button>'
      + '</div>'
      + '<div class="hr-sub">Answer a few more — your career map updates instantly.</div>'
      + '<div class="hr-prog"><div class="hr-prog-fill" style="width:' + Math.round(done / TOTAL * 100) + '%"></div></div>'
      + '<div class="hr-prog-lbl">' + done + ' of ' + TOTAL + ' answered</div>'
      + '<div class="hr-body">' + Qs.map(questionHtml).join('') + '</div>'
      + '<div class="hr-foot">'
      +   '<button class="hr-update" data-act="update"' + (done ? '' : ' disabled') + '>Update my matches</button>'
      // Revealed only after the first "Update my matches" — keeps the initial view
      // focused on the 8 questions instead of overwhelming with a second CTA.
      +   '<button class="hr-next-academics' + (readJson(UPDATED_KEY) ? '' : ' hr-hidden') + '" data-act="academics">Next: Academic profile <span aria-hidden="true">→</span></button>'
      + '</div>';
  }

  var toggleBtn, panel, toast;

  function refreshProgress() {
    if (!panel) return;
    var done = answeredCount();
    var fill = panel.querySelector('.hr-prog-fill');
    var lbl = panel.querySelector('.hr-prog-lbl');
    var upd = panel.querySelector('.hr-update');
    if (fill) fill.style.width = Math.round(done / TOTAL * 100) + '%';
    if (lbl) lbl.textContent = done + ' of ' + TOTAL + ' answered';
    if (upd) upd.disabled = !done;
    if (toggleBtn) {
      var updated = !!readJson(UPDATED_KEY);
      var pending = !updated && done < TOTAL;
      toggleBtn.classList.toggle('hr-toggle-hint', pending);
    }
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function rerenderBody() { if (panel) { panel.querySelector('.hr-body').innerHTML = Qs.map(questionHtml).join(''); refreshProgress(); } }

  function onPanelClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'close') { setOpen(false); return; }
    if (act === 'academics') { if (window.FWHubAcademics) FWHubAcademics.open(); else setOpen(false); return; }
    if (act === 'update') {
      writeJson(UPDATED_KEY, true); applyAndPersist(); showToast('Matches updated');
      var nextBtn = panel.querySelector('.hr-next-academics');
      if (nextBtn) nextBtn.classList.remove('hr-hidden');   // reveal the Academics CTA
      return;
    }
    if (act === 'tag') {
      var qi = +el.getAttribute('data-qi'), i = +el.getAttribute('data-i'), q = Qs[qi];
      var arr = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
      var pos = arr.indexOf(i);
      if (pos !== -1) arr.splice(pos, 1); else arr.push(i);
      answers[q.id] = arr;
      el.classList.toggle('sel');
      el.closest('.hr-q').classList.toggle('answered', arr.length > 0);
      writeJson(ANS_KEY, answers); refreshProgress();
      return;
    }
    if (act === 'mc') {
      var qi2 = +el.getAttribute('data-qi'), i2 = +el.getAttribute('data-i'), q2 = Qs[qi2];
      answers[q2.id] = i2;
      var opts = el.parentNode.querySelectorAll('.hr-opt');
      for (var k = 0; k < opts.length; k++) opts[k].classList.toggle('sel', opts[k] === el);
      el.closest('.hr-q').classList.add('answered');
      writeJson(ANS_KEY, answers); refreshProgress();
      return;
    }
  }

  function onPanelInput(e) {
    var el = e.target.closest('[data-act="slider"]');
    if (!el) return;
    var qi = +el.getAttribute('data-qi'), q = Qs[qi];
    answers[q.id] = +el.value;
    el.classList.add('hr-slider-on');
    el.closest('.hr-q').classList.add('answered');
    writeJson(ANS_KEY, answers); refreshProgress();
  }

  function setOpen(v) {
    open = v;
    if (open && window.FWHubDashboard && typeof FWHubDashboard.closePanel === 'function') {
      FWHubDashboard.closePanel();
    }
    if (open && window.FWHubAcademics && typeof FWHubAcademics.close === 'function') FWHubAcademics.close();
    panel.classList.toggle('open', open);
    toggleBtn.classList.toggle('open', open);
    toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function build() {
    migrateLegacyBase();

    toggleBtn = document.createElement('button');
    toggleBtn.className = 'hr-toggle';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = '<span class="hr-toggle-label">Sharpen matches</span>';
    toggleBtn.addEventListener('click', function () { setOpen(!open); });

    panel = document.createElement('aside');
    panel.className = 'hr-panel';
    panel.innerHTML = panelHtml();
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);

    toast = document.createElement('div');
    toast.className = 'hr-toast';

    var slot = document.getElementById('hub-refine-slot');
    (slot || document.body).appendChild(toggleBtn);
    document.body.appendChild(panel);
    document.body.appendChild(toast);

    refreshProgress();

    window.FWHubRefine = {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      // Exposed so the academics panel can fold this delta in and the two panels'
      // contributions union (instead of clobbering the shared fw_hub_quiz_v1.scores).
      delta: function () { return refineDelta(); }
    };

    var params = new URLSearchParams(window.location.search);
    if (params.get('refine') === 'open' || window.location.hash === '#refine') {
      setOpen(true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
