/**
 * "Sharpen your matches" — deeper personality questions.
 *
 * Historically a collapsible drawer on the Career Hub; now an embeddable
 * question set that lives in the POST-SIGNUP quiz flow (quiz.html mounts it
 * between the signup confetti and the academics + resume steps, and at
 * quiz.html#sharpen for returning users). No longer loaded on dashboard.html:
 * hub-academics.js — the only consumer of `FWHubRefine.delta()` in its score
 * recompute (accumulating-math invariant) — moved into the quiz flow too, so
 * both now live on quiz.html only.
 *
 * LocalStorage: fw_hub_refine_v1 (answers), fw_hub_base_scores_v1 ({ raw }
 * pre-refine scores), fw_hub_refine_updated_v1 — unchanged, so existing
 * users' answers survive the move.
 */
(function () {
  'use strict';

  if (!window.FWHubCareers) return;
  var FWH = window.FWHubCareers;

  var BASE_KEY  = 'fw_hub_base_scores_v1';
    var ANS_KEY   = 'fw_hub_refine_v1';
  var UPDATED_KEY = 'fw_hub_refine_updated_v1';

  var IND_KEYS = (typeof QZ_IND !== 'undefined' && QZ_IND)
    ? Object.keys(QZ_IND)
    : (function () {
        var set = {};
        var map = FWH.careerToQuizKeys || {};
        Object.keys(map).forEach(function (id) { (map[id] || []).forEach(function (k) { set[k] = 1; }); });
        return Object.keys(set);
      })();

  // ── Questions (compact, with scoring maps from the quiz) ──────────────────
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
    { id: 'lead', type: 'mc', q: 'In a group project, you naturally end up:',
      opts: [
        { t: 'Leading — setting direction and making the calls', s: { business: 3, law: 2, government: 1, hr: 1 } },
        { t: 'Organizing — plans, timelines, keeping it on track', s: { operations: 3, business: 2, finance: 1 } },
        { t: 'Going deep — owning the hardest technical piece', s: { tech: 3, science: 3, engineering: 2 } },
        { t: 'Connecting — keeping the team talking and together', s: { social: 3, education: 2, healthcare: 2, hr: 2 } },
        { t: 'Presenting — telling the story and selling the work', s: { marketing: 3, media: 2, creative: 2 } }
      ] },
    { id: 'hours', type: 'slider', q: 'How many hours are you willing to work?', ll: 'Light', ml: '9–5', rl: '80+',
      score: function (v) { var x = v / 100; return { finance: x * 3, law: x * 3, startups: x * 3, business: x * 2, healthcare: x * 1, education: (1 - x) * 3, government: (1 - x) * 2, trades: (1 - x) * 1, social: (1 - x) * 2 }; } },
    { id: 'intensity', type: 'slider', q: 'What work intensity energizes you?', ll: 'Calm & steady', rl: 'Pressure-cooker',
      score: function (v) { var x = v / 100; return { startups: x * 4, finance: x * 2, business: x * 2, law: x * 2, education: (1 - x) * 3, social: (1 - x) * 2, science: (1 - x) * 2 }; } },
    { id: 'creative', type: 'slider', q: 'Where do you sit: structured vs. creative?', ll: 'Highly structured', rl: 'Highly creative',
      score: function (v) { var c = v / 100; return { creative: c * 3, startups: c * 2, marketing: c * 2, law: (1 - c) * 3, finance: (1 - c) * 2, engineering: (1 - c) * 2 }; } },
    { id: 'social', type: 'slider', q: 'Where do you sit: solo vs. team?', ll: 'Solo worker', rl: 'Team player',
      score: function (v) { var x = v / 100; return { business: x * 3, healthcare: x * 2, social: x * 2, education: x * 1, marketing: x * 1, tech: (1 - x) * 2, science: (1 - x) * 3 }; } },
    { id: 'risk', type: 'slider', q: 'How much career risk feels right?', ll: 'Security first', rl: 'Big swings',
      score: function (v) { var x = v / 100; return { startups: x * 4, finance: x * 2, creative: x * 1.5, media: x * 1, government: (1 - x) * 3, education: (1 - x) * 2, healthcare: (1 - x) * 1.5, operations: (1 - x) * 1 }; } },
    { id: 'detail', type: 'slider', q: 'Big picture or fine detail?', ll: 'Fine detail', rl: 'Big picture',
      score: function (v) { var x = v / 100; return { business: x * 2, marketing: x * 2, startups: x * 2, media: x * 1, engineering: (1 - x) * 3, science: (1 - x) * 2, finance: (1 - x) * 2, law: (1 - x) * 1 }; } }
    ];

  var TOTAL = Qs.length;

  // ── State ────────────────────────────────────────────────────────────────
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function writeJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }

  var answers = readJson(ANS_KEY) || {};

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
    var quiz = ((window.FWUser && FWUser.getBlob) ? FWUser.getBlob() : null);
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
    var quiz = ((window.FWUser && FWUser.getBlob) ? FWUser.getBlob() : null);
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
      risk: typeof answers.risk === 'number' ? answers.risk : null,
      detail: typeof answers.detail === 'number' ? answers.detail : null,
      workday: typeof answers.workday === 'number' ? answers.workday : null,
      problem: typeof answers.problem === 'number' ? answers.problem : null,
      path: typeof answers.path === 'number' ? answers.path : null,
      lead: typeof answers.lead === 'number' ? answers.lead : null,
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

    var quiz = ((window.FWUser && FWUser.getBlob) ? FWUser.getBlob() : null) || {};
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
      if (window.FWUser) FWUser.putBlob(quiz);
    }
    writeJson(ANS_KEY, answers);
    writeJson(UPDATED_KEY, true);
    if (window.FWOnetHub && typeof FWOnetHub.refreshPersonalityFromQuiz === 'function') {
      FWOnetHub.refreshPersonalityFromQuiz();
      if (typeof FWOnetHub.invalidateViewport === 'function') FWOnetHub.invalidateViewport();
    }
    try { window.dispatchEvent(new CustomEvent('marco-refresh')); } catch (_) {}
  }

  // ── Embedded rendering ─────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function questionHtml(q, qi) {
    var head = '<div class="hr-q-title">' + esc(q.q) + '</div>' + (q.sub ? '<div class="hr-q-sub">' + esc(q.sub) + '</div>' : '');
    var body = '';
    if (q.type === 'tags') {
      var picked = answers[q.id] || [];
      body = '<div class="hr-tags">' + q.tags.map(function (t, i) {
        var sel = picked.indexOf(i) !== -1 ? ' sel' : '';
        return '<button type="button" class="hr-tag' + sel + '" data-qi="' + qi + '" data-i="' + i + '" data-act="tag">' + esc(t.t) + '</button>';
      }).join('') + '</div>';
    } else if (q.type === 'mc') {
      var sel2 = answers[q.id];
      body = '<div class="hr-opts">' + q.opts.map(function (o, i) {
        var s = sel2 === i ? ' sel' : '';
        return '<button type="button" class="hr-opt' + s + '" data-qi="' + qi + '" data-i="' + i + '" data-act="mc">' + esc(o.t) + '</button>';
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

  // Minimal self-injected styles so the embed works on pages that don't load
  // hub-dashboard.css (the quiz). Scoped under .hr-embed.
  var EMBED_CSS = ''
    + '.hr-embed{text-align:left;max-width:680px;margin:0 auto}'
    + '.hr-embed .hr-prog{height:6px;border-radius:3px;background:rgb(var(--border,127 127 127)/0.35);overflow:hidden;margin:14px 0 4px}'
    + '.hr-embed .hr-prog-fill{height:100%;border-radius:3px;background:rgb(var(--primary,237 106 44));transition:width .35s cubic-bezier(.22,1,.36,1)}'
    + '.hr-embed .hr-prog-lbl{font-size:12px;opacity:.65;margin-bottom:18px}'
    + '.hr-embed .hr-q{margin:0 0 26px;padding:18px 20px;border:1px solid rgb(var(--border,127 127 127)/0.5);border-radius:14px;background:rgb(var(--surface,255 255 255)/0.6);transition:border-color .25s,box-shadow .25s}'
    + '.hr-embed .hr-q.answered{border-color:rgb(var(--primary,237 106 44)/0.45);box-shadow:0 2px 14px rgb(var(--primary,237 106 44)/0.08)}'
    + '.hr-embed .hr-q-title{font-weight:600;font-size:1.02rem;margin-bottom:4px}'
    + '.hr-embed .hr-q-sub{font-size:.85rem;opacity:.65;margin-bottom:8px}'
    + '.hr-embed .hr-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}'
    + '.hr-embed .hr-tag{padding:7px 12px;border-radius:999px;border:1px solid rgb(var(--border,127 127 127)/0.6);background:transparent;color:inherit;font-size:.85rem;cursor:pointer;transition:transform .15s,border-color .2s,background .2s}'
    + '.hr-embed .hr-tag:hover{transform:translateY(-1px)}'
    + '.hr-embed .hr-tag.sel{border-color:rgb(var(--primary,237 106 44));background:rgb(var(--primary,237 106 44)/0.14)}'
    + '.hr-embed .hr-opts{display:flex;flex-direction:column;gap:8px;margin-top:10px}'
    + '.hr-embed .hr-opt{padding:11px 14px;border-radius:10px;border:1px solid rgb(var(--border,127 127 127)/0.6);background:transparent;color:inherit;text-align:left;font-size:.92rem;cursor:pointer;transition:transform .15s,border-color .2s,background .2s}'
    + '.hr-embed .hr-opt:hover{transform:translateY(-1px)}'
    + '.hr-embed .hr-opt.sel{border-color:rgb(var(--primary,237 106 44));background:rgb(var(--primary,237 106 44)/0.14)}'
    + '.hr-embed .hr-slider{width:100%;margin-top:10px;accent-color:rgb(var(--primary,237 106 44))}'
    + '.hr-embed .hr-slider-labels{display:flex;justify-content:space-between;font-size:.78rem;opacity:.65;margin-top:10px}';

  function ensureEmbedCss() {
    if (document.getElementById('hr-embed-css')) return;
    var st = document.createElement('style');
    st.id = 'hr-embed-css';
    st.textContent = EMBED_CSS;
    document.head.appendChild(st);
  }

  function mount(container, opts) {
    opts = opts || {};
    migrateLegacyBase();
    ensureEmbedCss();
    container.classList.add('hr-embed');
    function progHtml() {
      var done = answeredCount();
      return '<div class="hr-prog"><div class="hr-prog-fill" style="width:' + Math.round(done / TOTAL * 100) + '%"></div></div>'
        + '<div class="hr-prog-lbl">' + done + ' of ' + TOTAL + ' answered</div>';
    }
    container.innerHTML = '<div class="hr-prog-wrap">' + progHtml() + '</div>'
      + '<div class="hr-body">' + Qs.map(questionHtml).join('') + '</div>';

    function refresh() {
      var wrap = container.querySelector('.hr-prog-wrap');
      if (wrap) wrap.innerHTML = progHtml();
      if (typeof opts.onProgress === 'function') opts.onProgress(answeredCount(), TOTAL);
    }

    container.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'tag') {
        var qi = +el.getAttribute('data-qi'), i = +el.getAttribute('data-i'), q = Qs[qi];
        var arr = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
        var pos = arr.indexOf(i);
        if (pos !== -1) arr.splice(pos, 1); else arr.push(i);
        answers[q.id] = arr;
        el.classList.toggle('sel');
        el.closest('.hr-q').classList.toggle('answered', arr.length > 0);
        writeJson(ANS_KEY, answers); refresh();
      } else if (act === 'mc') {
        var qi2 = +el.getAttribute('data-qi'), i2 = +el.getAttribute('data-i'), q2 = Qs[qi2];
        answers[q2.id] = i2;
        var mcOpts = el.parentNode.querySelectorAll('.hr-opt');
        for (var k = 0; k < mcOpts.length; k++) mcOpts[k].classList.toggle('sel', mcOpts[k] === el);
        el.closest('.hr-q').classList.add('answered');
        writeJson(ANS_KEY, answers); refresh();
      }
    });
    container.addEventListener('input', function (e) {
      var el = e.target.closest('[data-act="slider"]');
      if (!el) return;
      var qi = +el.getAttribute('data-qi'), q = Qs[qi];
      answers[q.id] = +el.value;
      el.classList.add('hr-slider-on');
      el.closest('.hr-q').classList.add('answered');
      writeJson(ANS_KEY, answers); refresh();
    });
    refresh();
  }

  window.FWHubRefine = {
    mount: mount,
    // Persists the sharpened scores through the canonical writers
    // (sector-fit-sheet patches + persistQuizVectors sync).
    commit: function () { applyAndPersist(); },
    answeredCount: answeredCount,
    total: TOTAL,
    isComplete: function () { return answeredCount() >= TOTAL; },
    // hub-academics.js folds this delta into its own recompute — keep exported.
    delta: function () { return refineDelta(); },
    // hub-academics.js's embed shares the .hr-embed base styles — keep exported.
    ensureEmbedCss: ensureEmbedCss,
    // Legacy drawer API — the drawer is gone; keep harmless no-ops so old
    // callers (hub-dashboard closePanel chain, academics setOpen) never throw.
    open: function () {},
    close: function () {}
  };
})();
