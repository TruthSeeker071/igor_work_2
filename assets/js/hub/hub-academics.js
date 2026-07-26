/**
 * Academic Profile — embeddable assessment step (sibling of hub-refine.js).
 *
 * Lives in the POST-SIGNUP quiz flow (quiz.html mounts it via
 * FWHubAcademics.mount right after the Sharpen Matches step, plus a
 * standalone quiz.html#academics entry). Covers the user's academic profile:
 * GPA, classes they liked / disliked (and why), their major(s)/minor(s) and
 * how locked-in that is, intended grad-school plans, and an optional
 * unofficial transcript.
 *
 * The class year is NOT re-asked — the initial quiz already captured it. We read
 * it (plus GPA / school) from the quiz profile (written by qzBuildHubPayload)
 * and surface it in the panel header ("We've got you as a Junior at UCLA …").
 *
 * Scored signals (liked classes +, disliked classes −, grad-school plans) reshape
 * the live career map via FWHubCareers.applyQuizScores, exactly like the refine
 * panel. GPA / major / major-lock / transcript are stored as profile data only.
 *
 * LocalStorage: fw_hub_academics_v1 (answers), and a compact subset mirrored into
 * the quiz blob's academics so it syncs to D1 via the existing /profile/quiz PUT.
 *
 * Self-contained on purpose: it does NOT load the full quiz app. Class-text scoring
 * uses a compact keyword→industry map adapted from the quiz's resume keyword parser.
 */
(function () {
  'use strict';

  if (!window.FWHubCareers) return;
  var FWH = window.FWHubCareers;

  var BASE_KEY    = 'fw_hub_base_scores_v1';        // shared with hub-refine.js
  var ANS_KEY     = 'fw_hub_academics_v1';
  var UPDATED_KEY = 'fw_hub_academics_updated_v1'; // portal checklist reads this

  // Industry universe — same derivation as hub-refine.js.
  var IND_KEYS = (typeof QZ_IND !== 'undefined' && QZ_IND)
    ? Object.keys(QZ_IND)
    : (function () {
        var set = {}; var map = FWH.careerToQuizKeys || {};
        Object.keys(map).forEach(function (id) { (map[id] || []).forEach(function (k) { set[k] = 1; }); });
        return Object.keys(set);
      })();

  // ── Keyword → industry scoring for the free-text class questions ────────────
  // Each entry: a substring to look for in the (lowercased) answer, and the
  // industry points it implies. Liked classes add these; disliked subtract them.
  var KEYWORD_IND = {
    'calc': { tech: 2, finance: 2, engineering: 2, science: 1 },
    'math': { tech: 2, finance: 3, engineering: 2, science: 1 },
    'statisti': { finance: 3, tech: 2, science: 2 },
    'econ': { finance: 3, business: 3, realestate: 1 },
    'account': { finance: 3, business: 2 },
    'finance': { finance: 4, business: 2 },
    'business': { business: 3, finance: 2, startups: 1 },
    'market': { marketing: 3, business: 2, media: 1 },
    'comput': { tech: 4, engineering: 2, cybersecurity: 2 },
    'program': { tech: 4, engineering: 1, startups: 1 },
    'coding': { tech: 4, engineering: 1 },
    'softw': { tech: 4, engineering: 1 },
    'data': { tech: 3, finance: 2, science: 1 },
    'cyber': { cybersecurity: 4, tech: 2 },
    'engineer': { engineering: 4, tech: 1, aerospace: 1 },
    'physics': { science: 3, engineering: 2, aerospace: 1 },
    'chem': { science: 3, healthcare: 1, pharmaceutical: 2 },
    'bio': { science: 3, healthcare: 3, pharmaceutical: 1 },
    'anatom': { healthcare: 4, science: 1 },
    'medic': { healthcare: 4, science: 1, pharmaceutical: 1 },
    'health': { healthcare: 4, social: 1 },
    'nurs': { healthcare: 4 },
    'psych': { healthcare: 2, social: 2, education: 2, hr: 1 },
    'sociolog': { social: 3, education: 1, government: 1 },
    'history': { education: 2, law: 2, government: 1 },
    'politic': { law: 3, government: 2, social: 2 },
    'gov': { government: 3, law: 2, social: 1 },
    'law': { law: 4, government: 1 },
    'debate': { law: 3, business: 1, social: 1 },
    'philosoph': { law: 2, education: 2, creative: 1 },
    'english': { creative: 2, education: 2, media: 1, law: 1 },
    'writ': { creative: 3, media: 2, marketing: 1, education: 1 },
    'literat': { creative: 2, education: 2, media: 1 },
    'art': { creative: 4, marketing: 1 },
    'design': { creative: 4, marketing: 2, tech: 1 },
    'music': { creative: 3, media: 1, education: 1 },
    'film': { creative: 3, media: 3, marketing: 1 },
    'media': { media: 3, marketing: 2, creative: 1 },
    'theat': { creative: 3, media: 1, education: 1 },
    'communicat': { marketing: 2, media: 2, social: 1, business: 1 },
    'language': { social: 2, education: 2, creative: 1 },
    'spanish': { social: 2, education: 1 },
    'environ': { science: 3, social: 1, agriculture: 2 },
    'agricultur': { agriculture: 4, science: 1 },
    'architect': { creative: 3, engineering: 2, trades: 1 },
    'aviat': { aerospace: 4, engineering: 2 },
    'aerospace': { aerospace: 4, engineering: 2 },
    'hospitalit': { hospitality: 4, business: 1 },
    'culinar': { hospitality: 3, creative: 1 },
    'shop': { trades: 3, engineering: 1 },
    'woodwork': { trades: 4 },
    'welding': { trades: 4 },
    'education': { education: 3, social: 1 },
    'teach': { education: 3, social: 1 }
  };

  // ── Grad/professional-school plans (scored mc) ──────────────────────────────
  var GRAD_OPTS = [
    { t: 'Med school / health professions', s: { healthcare: 4, science: 2, pharmaceutical: 2 } },
    { t: 'Law school',                       s: { law: 4, government: 1 } },
    { t: 'PhD / research / academia',        s: { science: 4, education: 3 } },
    { t: 'MBA / business grad school',       s: { business: 3, finance: 2, startups: 1 } },
    { t: 'Straight to work — no grad school',s: { startups: 1, business: 1, tech: 1 } },
    { t: 'Undecided',                        s: {} }
  ];

  // ── Year-tailored copy for the "how set in stone is your major" slider ──────
  var YEAR_COPY = {
    freshman:  { q: 'How locked-in is your major — or are you still exploring?', ll: 'Totally exploring',  rl: 'Pretty decided',            sub: "Most freshmen change paths at least once. No wrong answer." },
    sophomore: { q: 'How settled is your major direction?',                       ll: 'Still open',          rl: 'Leaning in hard',           sub: "You've got room to pivot, but the clock's started." },
    junior:    { q: 'How committed are you to your current major?',               ll: 'Open to a switch',    rl: 'Fully committed',           sub: "Switching now usually means extra semesters — be honest." },
    senior:    { q: 'How aligned is your major with where you are headed?',        ll: 'Pivoting after grad', rl: 'Right where I want to be',  sub: 'Mostly about your next move, not changing course.' },
    _default:  { q: 'How set in stone is your major?',                            ll: 'Open to change',      rl: 'Set in stone',              sub: '' }
  };

  // ── State ───────────────────────────────────────────────────────────────────
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function writeJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }

  function quizBlob() {
    return ((window.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null) || {};
  }
  // Identity via FWUser: same keys as the old quiz.profile read, plus school
  // coalesced with the blob-root copy (the dossier-synced one).
  function profile() {
    var u = window.FWUser && typeof FWUser.get === 'function' ? FWUser.get() : null;
    return (u && u.identity) || {};
  }

  var answers = readJson(ANS_KEY) || {}; // { gpa, liked, disliked, major, majorLock, grad, transcript }

  // Seed from a previously-synced subset, then prefill GPA from the quiz profile.
  (function seed() {
    var q = quizBlob();
    if ((!answers || !Object.keys(answers).length) && q.academics && typeof q.academics === 'object') {
      answers = Object.assign({}, q.academics);
    }
    if (answers.gpa === undefined || answers.gpa === null) {
      var pg = profile().gpa;
      if (typeof pg === 'number') answers.gpa = pg;
    }
  })();

  // ── "About you": year + school ─────────────────────────────────────────────
  // V2 S6 (D8) moved year/school OUT of the pre-signup quiz; this step is their
  // post-signup home. Persisted (in applyAndPersist) through the SAME v1
  // profile.{year,school} paths qzBuildHubPayload writes, so KEY_MAP normalizes
  // them to identity.{year,school} — the school single source — with no new
  // write path. Seeded from any value already on the profile (e.g. a pre-V2
  // account, or a re-visit).
  var YEAR_OPTS = [
    { k: 'freshman', l: 'Freshman' }, { k: 'sophomore', l: 'Sophomore' },
    { k: 'junior', l: 'Junior' }, { k: 'senior', l: 'Senior' }
  ];
  var aboutYear = profile().year || '';
  var aboutSchool = profile().school || '';
  function hasAboutYou() { return !!(aboutYear || (aboutSchool && aboutSchool.trim())); }

  // ── GPA helpers (ported verbatim from quiz-app.js) ──────────────────────────
  function gpaLetter(v) {
    if (v >= 4.0) return 'A+'; if (v >= 3.7) return 'A'; if (v >= 3.3) return 'A-';
    if (v >= 3.0) return 'B+'; if (v >= 2.7) return 'B'; if (v >= 2.3) return 'B-';
    if (v >= 2.0) return 'C+'; if (v >= 1.7) return 'C'; if (v >= 1.3) return 'C-';
    if (v >= 1.0) return 'D+'; if (v >= 0.7) return 'D'; if (v >= 0.3) return 'D-';
    return 'F';
  }
  function gpaFeedback(v) {
    // Only celebrate the top tiers; stay silent below 3.7.
    if (v >= 3.9) return { cls: 'elite', txt: '🏆 Elite — every door is wide open for you.' };
    if (v >= 3.7) return { cls: 'great', txt: '⭐ Outstanding — top programs will compete for you.' };
    return { cls: '', txt: '' };
  }

  // ── Question definitions ────────────────────────────────────────────────────
  function majorLockCopy() {
    var y = profile().year;
    return YEAR_COPY[y] || YEAR_COPY._default;
  }

  var Qs = [
    { id: 'gpa', type: 'gpa', q: "What's your current GPA?", sub: 'On a 4.0 scale. Helps us calibrate recommendations.' },
    { id: 'liked', type: 'longtext', q: 'Which classes did you enjoy — and what about them?',
      sub: 'High-school or college classes. A sentence or two on what clicked.',
      placeholder: 'e.g. AP Bio — loved the labs and dissections; Econ — the way incentives explain everything…' },
    { id: 'disliked', type: 'longtext', q: 'Any classes you disliked — and why?',
      sub: 'Just as useful. What drained you?',
      placeholder: 'e.g. Organic chem — too much rote memorization; Lit essays — open-ended grading frustrated me…' },
    { id: 'major', type: 'text', q: 'What major(s) / minor(s) do you have (or are considering)?',
      sub: 'Declared or leaning — list what you have.',
      placeholder: 'e.g. Economics major, CS minor' },
    { id: 'majorLock', type: 'slider' /* q/ll/rl computed from year */ },
    { id: 'grad', type: 'mc', q: 'Any grad or professional school in your plans?',
      sub: 'Even a rough lean helps point your path.', opts: GRAD_OPTS },
    { id: 'transcript', type: 'upload', q: 'Have an unofficial transcript handy? (optional)',
      sub: 'Attach it, or paste the text. We just keep it on file for now.' }
  ];

  var TOTAL = Qs.length;

  function isAnswered(q) {
    var a = answers[q.id];
    if (q.type === 'gpa') return typeof a === 'number';
    if (q.type === 'longtext' || q.type === 'text') return typeof a === 'string' && a.trim().length > 0;
    if (q.type === 'slider') return typeof a === 'number';
    if (q.type === 'mc') return typeof a === 'number';
    if (q.type === 'upload') return false; // optional — never required, never blocks Save
    return false;
  }
  // Count only the questions that can actually be "completed" (exclude optional upload).
  var REQUIRED = Qs.filter(function (q) { return q.type !== 'upload'; });
  function answeredCount() { var n = 0; REQUIRED.forEach(function (q) { if (isAnswered(q)) n++; }); return n; }

  // ── Scoring ─────────────────────────────────────────────────────────────────
  function classDelta(text, sign) {
    if (window.FWAcademicsMap && typeof FWAcademicsMap.classDeltaFromText === 'function') {
      return FWAcademicsMap.classDeltaFromText(text, sign);
    }
    var t = (text || '').toLowerCase(), d = {};
    if (!t) return d;
    Object.keys(KEYWORD_IND).forEach(function (kw) {
      if (t.indexOf(kw) !== -1) {
        var s = KEYWORD_IND[kw];
        Object.keys(s).forEach(function (k) { d[k] = (d[k] || 0) + s[k] * sign; });
      }
    });
    return d;
  }

  function academicsDelta() {
    var d = {};
    function add(s, m) { if (!s) return; m = (m === undefined ? 1 : m); Object.keys(s).forEach(function (k) { d[k] = (d[k] || 0) + s[k] * m; }); }
    add(classDelta(answers.liked, 1));
    add(classDelta(answers.disliked, -0.6));               // dislikes penalize, but gentler
    if (typeof answers.grad === 'number' && GRAD_OPTS[answers.grad]) add(GRAD_OPTS[answers.grad].s, 2);
    return d;
  }

  function normalize(sc) {
    var max = 1;
    IND_KEYS.forEach(function (k) { if ((sc[k] || 0) > max) max = sc[k]; });
    var out = {};
    IND_KEYS.forEach(function (k) { out[k] = Math.max(0, Math.round(((sc[k] || 0) / max) * 100)); });
    return out;
  }

  function baseScores() {
    var cached = readJson(BASE_KEY);
    if (cached && cached.raw && typeof cached.raw === 'object') return cached.raw;
    var quiz = quizBlob();
    var raw = (quiz && quiz.scoresRaw) ? quiz.scoresRaw : null;
    var fromNormalizedFallback = false;
    if (!raw && quiz && quiz.scores) {
      raw = quiz.scores;
      fromNormalizedFallback = true;
    }
    writeJson(BASE_KEY, { raw: raw || {}, capturedAt: Date.now(), fromNormalizedFallback: fromNormalizedFallback });
    return raw || {};
  }

  var REFINE_WEIGHT = 3;     // mirrors hub-refine.js
  var ACADEMICS_WEIGHT = 2;  // softer — class enjoyment is a lighter signal

  function applyAndPersist() {
    var base = baseScores();
    var refineD = (window.FWHubRefine && typeof FWHubRefine.delta === 'function') ? FWHubRefine.delta() : {};
    var acadD = academicsDelta();
    var combined = {};
    IND_KEYS.forEach(function (k) {
      combined[k] = Math.max(0, (base[k] || 0) + (refineD[k] || 0) * REFINE_WEIGHT + (acadD[k] || 0) * ACADEMICS_WEIGHT);
    });
    var norm = (window.FWSectorFitSheet && typeof FWSectorFitSheet.sharpenSectorScores === 'function')
      ? FWSectorFitSheet.sharpenSectorScores(combined)
      : normalize(combined);

    if (typeof FWH.resetFitScores === 'function') FWH.resetFitScores();
    var onetActive = window.FWOnetHub && FWOnetHub.isReady && FWOnetHub.isReady();
    if (!onetActive && typeof FWH.applyQuizScores === 'function') FWH.applyQuizScores(norm);

    var quiz = quizBlob();
    var oldScores = (window.FWSectorFitSheet && typeof FWSectorFitSheet.getCanonicalScores === 'function')
      ? FWSectorFitSheet.getCanonicalScores(quiz)
      : Object.assign({}, quiz.scores || {});
    quiz.scores = norm;
    if (window.FWSectorFitSheet && typeof FWSectorFitSheet.recordLocalPatches === 'function') {
      var patches = IND_KEYS.filter(function (k) {
        return Math.abs((norm[k] || 0) - (oldScores[k] || 0)) >= 1;
      }).map(function (k) {
        return { key: k, score: norm[k], reason: 'Academics panel' };
      });
      if (patches.length) FWSectorFitSheet.recordLocalPatches(quiz, patches, 'academics');
    }
    quiz.academics = compactAnswers();
    // About-you (V2 S6): write year + school through the v1 profile paths so the
    // KEY_MAP normalizer routes them to identity.{year,school} — no bespoke
    // identity write, no second school home. Only set what the student provided.
    if (hasAboutYou()) {
      quiz.profile = quiz.profile || {};
      if (aboutYear) quiz.profile.year = aboutYear;
      if (aboutSchool && aboutSchool.trim()) quiz.profile.school = aboutSchool.trim();
    }
    if (answers.transcriptText && String(answers.transcriptText).trim()) {
      quiz.academicsTranscript = String(answers.transcriptText).trim();
    }
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

  function compactAnswers() {
    return {
      gpa: (typeof answers.gpa === 'number') ? answers.gpa : null,
      major: answers.major || '',
      majorLock: (typeof answers.majorLock === 'number') ? answers.majorLock : null,
      liked: answers.liked || '',
      disliked: answers.disliked || '',
      grad: (typeof answers.grad === 'number') ? answers.grad : null,
      transcript: answers.transcript ? { name: answers.transcript.name } : null
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function headerSub() {
    var p = profile();
    if (p.year) {
      var school = p.school ? (' at <strong>' + esc(p.school) + '</strong>') : '';
      return "We've got you as a <strong>" + esc(cap(p.year)) + '</strong>' + school +
             " — let's sharpen your matches with your academics.";
    }
    return 'A few academic questions — your career map updates instantly.';
  }

  function gpaBody() {
    // Start at 2.0 so the student adjusts upward — the quiz is designed to make
    // people feel good as they go (everything slides "up").
    var v = (typeof answers.gpa === 'number') ? answers.gpa : 2.0;
    var pct = (v / 4 * 100);
    var fb = gpaFeedback(v);
    var fill = 'linear-gradient(90deg, rgb(var(--primary)) ' + pct + '%, var(--hub-border) ' + pct + '%)';
    return ''
      + '<div class="hr-gpa-display"><span class="hr-gpa-num" data-gpa-num>' + v.toFixed(2) + '</span>'
      +   '<span class="hr-gpa-letter" data-gpa-letter>' + gpaLetter(v) + '</span></div>'
      + '<div class="hr-gpa-feedback ' + fb.cls + '" data-gpa-fb>' + fb.txt + '</div>'
      + '<input type="range" min="0" max="40" step="1" value="' + Math.round(v * 10) + '" class="hr-slider hr-slider-on" '
      +   'data-act="gpa" style="background:' + fill + '">'
      + '<div class="hr-slider-labels"><span>0.0</span><span>2.0</span><span>4.0</span></div>';
  }

  function questionHtml(q, qi) {
    var qq = q, head;
    if (q.type === 'slider' && q.id === 'majorLock') {
      var c = majorLockCopy();
      qq = { q: c.q, sub: c.sub, ll: c.ll, rl: c.rl };
    }
    head = '<div class="hr-q-title">' + esc(qq.q) + '</div>' + (qq.sub ? '<div class="hr-q-sub">' + esc(qq.sub) + '</div>' : '');
    var body = '';

    if (q.type === 'gpa') {
      body = gpaBody();
    } else if (q.type === 'longtext') {
      body = '<textarea class="hr-textarea" data-act="text" data-qi="' + qi + '" rows="3" placeholder="'
        + escAttr(q.placeholder || '') + '">' + esc(answers[q.id] || '') + '</textarea>';
    } else if (q.type === 'text') {
      body = '<input type="text" class="hr-text" data-act="text" data-qi="' + qi + '" placeholder="'
        + escAttr(q.placeholder || '') + '" value="' + escAttr(answers[q.id] || '') + '">';
    } else if (q.type === 'slider') {
      var v = typeof answers[q.id] === 'number' ? answers[q.id] : 50;
      var on = isAnswered(q) ? ' hr-slider-on' : '';
      body = '<div class="hr-slider-labels"><span>' + esc(qq.ll) + '</span><span>' + esc(qq.rl) + '</span></div>'
        + '<input type="range" min="0" max="100" value="' + v + '" class="hr-slider' + on + '" data-qi="' + qi + '" data-act="slider">';
    } else if (q.type === 'mc') {
      var sel = answers[q.id];
      body = '<div class="hr-opts">' + q.opts.map(function (o, i) {
        var s = sel === i ? ' sel' : '';
        return '<button class="hr-opt' + s + '" data-qi="' + qi + '" data-i="' + i + '" data-act="mc">' + esc(o.t) + '</button>';
      }).join('') + '</div>';
    } else if (q.type === 'upload') {
      var t = answers.transcript;
      var status = t && t.name
        ? '<div class="hr-upload-status ok">✓ ' + esc(t.name) + ' added</div>'
        : '<div class="hr-upload-status"></div>';
      body = ''
        + '<label class="hr-upload"><input type="file" accept=".txt,.pdf,.doc,.docx" data-act="upload">'
        +   '<span class="hr-upload-label">📎 Attach transcript</span>'
        +   '<span class="hr-upload-hint">.pdf · .txt — optional</span></label>'
        + status
        + '<textarea class="hr-textarea hr-paste" data-act="paste" rows="2" placeholder="…or paste transcript text here">'
        +   esc(answers.transcriptText || '') + '</textarea>';
    }
    return '<div class="hr-q' + (isAnswered(q) ? ' answered' : '') + '">' + head + body + '</div>';
  }

  function aboutYouHtml() {
    var yearBtns = YEAR_OPTS.map(function (o) {
      return '<button type="button" class="hr-opt hr-year-opt' + (aboutYear === o.k ? ' sel' : '') + '" data-act="year" data-k="' + o.k + '">' + o.l + '</button>';
    }).join('');
    return ''
      + '<div class="hr-q hr-aboutyou' + (hasAboutYou() ? ' answered' : '') + '">'
      +   '<div class="hr-q-title">About you</div>'
      +   '<div class="hr-q-sub">Your year and school tune your major, class, and roadmap recommendations.</div>'
      +   '<div class="hr-opts hr-year-opts">' + yearBtns + '</div>'
      +   '<input type="text" class="hr-text hr-school" data-act="school" placeholder="Your college or university" value="' + escAttr(aboutSchool || '') + '">'
      + '</div>';
  }

  // ── Embeddable mount (quiz flow) ────────────────────────────────────────────
  // The Academics panel used to be a Career Hub slide-in; it now lives in the
  // post-signup quiz flow right after Sharpen Matches (and standalone via
  // quiz.html#academics). Same answers, scoring, and persistence — only the
  // hosting changed, mirroring hub-refine.js's embed pattern.

  // Supplemental styles for the widgets refine's shared .hr-embed CSS lacks
  // (free-text fields, GPA readout, transcript upload). Scoped under .hr-embed.
  var ACADEMICS_EMBED_CSS = ''
    + '.hr-embed .hr-sub{font-size:.92rem;opacity:.8;margin:0 0 4px}'
    + '.hr-embed .hr-textarea,.hr-embed .hr-text{width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid rgb(var(--border,127 127 127)/0.6);background:rgb(var(--surface,255 255 255)/0.6);color:inherit;font:inherit;font-size:.92rem;resize:vertical}'
    + '.hr-embed .hr-textarea:focus,.hr-embed .hr-text:focus{outline:none;border-color:rgb(var(--primary,237 106 44)/0.6)}'
    + '.hr-embed .hr-gpa-display{display:flex;align-items:baseline;gap:10px;margin-top:8px}'
    + '.hr-embed .hr-gpa-num{font-size:1.6rem;font-weight:700}'
    + '.hr-embed .hr-gpa-letter{font-size:.95rem;font-weight:600;opacity:.7}'
    + '.hr-embed .hr-gpa-feedback{min-height:20px;font-size:.85rem;margin:2px 0 4px}'
    + '.hr-embed .hr-gpa-feedback.elite{color:#eab308}'
    + '.hr-embed .hr-gpa-feedback.great{color:rgb(var(--primary,237 106 44))}'
    + '.hr-embed .hr-upload{display:flex;flex-direction:column;gap:2px;margin-top:10px;padding:14px;border:1px dashed rgb(var(--border,127 127 127)/0.7);border-radius:10px;cursor:pointer}'
    + '.hr-embed .hr-upload input[type=file]{display:none}'
    + '.hr-embed .hr-upload-label{font-size:.92rem;font-weight:600}'
    + '.hr-embed .hr-upload-hint{font-size:.78rem;opacity:.6}'
    + '.hr-embed .hr-upload-status{min-height:18px;font-size:.85rem;margin-top:6px}'
    + '.hr-embed .hr-upload-status.ok{color:rgb(var(--primary,237 106 44))}'
    + '.hr-embed .hr-paste{margin-top:8px}';

  function ensureAcademicsEmbedCss() {
    if (window.FWHubRefine && typeof FWHubRefine.ensureEmbedCss === 'function') {
      FWHubRefine.ensureEmbedCss();
    }
    if (document.getElementById('hra-embed-css')) return;
    var st = document.createElement('style');
    st.id = 'hra-embed-css';
    st.textContent = ACADEMICS_EMBED_CSS;
    document.head.appendChild(st);
  }

  var mountEl = null;
  var mountOpts = {};

  function refreshProgress() {
    if (!mountEl) return;
    var done = answeredCount();
    var fill = mountEl.querySelector('.hr-prog-fill');
    var lbl = mountEl.querySelector('.hr-prog-lbl');
    if (fill) fill.style.width = Math.round(done / REQUIRED.length * 100) + '%';
    if (lbl) lbl.textContent = done + ' of ' + REQUIRED.length + ' answered';
    if (typeof mountOpts.onProgress === 'function') mountOpts.onProgress(done, REQUIRED.length);
  }

  function markAnswered(el, on) {
    var qd = el.closest('.hr-q'); if (qd) qd.classList.toggle('answered', on);
  }

  function onPanelClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'year') {
      aboutYear = el.getAttribute('data-k');
      var ybtns = el.parentNode.querySelectorAll('.hr-year-opt');
      for (var y = 0; y < ybtns.length; y++) ybtns[y].classList.toggle('sel', ybtns[y] === el);
      var ay = el.closest('.hr-aboutyou'); if (ay) ay.classList.toggle('answered', hasAboutYou());
      return;
    }
    if (act === 'mc') {
      var qi = +el.getAttribute('data-qi'), i = +el.getAttribute('data-i'), q = Qs[qi];
      answers[q.id] = i;
      var opts = el.parentNode.querySelectorAll('.hr-opt');
      for (var k = 0; k < opts.length; k++) opts[k].classList.toggle('sel', opts[k] === el);
      markAnswered(el, true);
      writeJson(ANS_KEY, answers); refreshProgress();
    }
  }

  function onPanelInput(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');

    if (act === 'gpa') {
      var v = (+el.value) / 10; answers.gpa = v;
      var num = mountEl.querySelector('[data-gpa-num]'), let_ = mountEl.querySelector('[data-gpa-letter]'), fbEl = mountEl.querySelector('[data-gpa-fb]');
      if (num) num.textContent = v.toFixed(2);
      if (let_) let_.textContent = gpaLetter(v);
      var fb = gpaFeedback(v);
      if (fbEl) { fbEl.textContent = fb.txt; fbEl.className = 'hr-gpa-feedback ' + fb.cls; }
      var pct = v / 4 * 100;
      el.style.background = 'linear-gradient(90deg, rgb(var(--primary)) ' + pct + '%, var(--hub-border) ' + pct + '%)';
      markAnswered(el, true);
      writeJson(ANS_KEY, answers); refreshProgress();
      return;
    }
    if (act === 'slider') {
      var qi = +el.getAttribute('data-qi'), q = Qs[qi];
      answers[q.id] = +el.value;
      el.classList.add('hr-slider-on');
      markAnswered(el, true);
      writeJson(ANS_KEY, answers); refreshProgress();
      return;
    }
    if (act === 'school') {
      aboutSchool = el.value;                     // state only — persisted at commit
      var as = el.closest('.hr-aboutyou'); if (as) as.classList.toggle('answered', hasAboutYou());
      return;
    }
    if (act === 'text') {
      var qi2 = +el.getAttribute('data-qi'), q2 = Qs[qi2];
      answers[q2.id] = el.value;                 // state only — no re-render (no cursor jump)
      markAnswered(el, el.value.trim().length > 0);
      writeJson(ANS_KEY, answers); refreshProgress();
      return;
    }
    if (act === 'paste') {
      answers.transcriptText = el.value;
      writeJson(ANS_KEY, answers);
      return;
    }
  }

  function onPanelChange(e) {
    var el = e.target.closest('[data-act="upload"]');
    if (!el || !el.files || !el.files[0]) return;
    var f = el.files[0];
    answers.transcript = { name: f.name, size: f.size, type: f.type, addedAt: new Date().toISOString() };
    writeJson(ANS_KEY, answers);
    var status = el.closest('.hr-q').querySelector('.hr-upload-status');
    if (status) { status.className = 'hr-upload-status ok'; status.textContent = '✓ ' + f.name + ' added'; }
  }

  function mount(container, opts) {
    if (!container) return;
    ensureAcademicsEmbedCss();
    mountEl = container;
    mountOpts = opts || {};
    container.classList.add('hr-embed');
    var done = answeredCount();
    container.innerHTML = ''
      + '<div class="hr-sub">' + headerSub() + '</div>'
      + '<div class="hr-prog"><div class="hr-prog-fill" style="width:' + Math.round(done / REQUIRED.length * 100) + '%"></div></div>'
      + '<div class="hr-prog-lbl">' + done + ' of ' + REQUIRED.length + ' answered</div>'
      + '<div class="hr-body">' + aboutYouHtml() + Qs.map(questionHtml).join('') + '</div>';
    if (!container._fwAcadBound) {
      container._fwAcadBound = true;
      container.addEventListener('click', onPanelClick);
      container.addEventListener('input', onPanelInput);
      container.addEventListener('change', onPanelChange);
    }
    refreshProgress();
  }

  window.FWHubAcademics = {
    mount: mount,
    // Persists academics through the canonical writers
    // (sector-fit-sheet patches + persistQuizVectors sync).
    commit: function () { applyAndPersist(); },
    answeredCount: answeredCount,
    hasAboutYou: hasAboutYou,
    total: REQUIRED.length,
    isComplete: function () { return answeredCount() >= REQUIRED.length; },
    // Legacy hub panel API — the slide-in is gone; harmless no-ops so old
    // callers (hub-dashboard openPanel chain) never throw.
    open: function () {},
    close: function () {}
  };
})();
