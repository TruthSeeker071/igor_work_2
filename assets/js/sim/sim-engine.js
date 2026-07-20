/**
 * FlightWay Career Tester v3 — realistic career simulations, site-native.
 *
 * Three-altitude friction ladder (progressive disclosure):
 *   TAXI   (~2 min)  brief + one document + one spot-question + payoff. No writing.
 *   FLIGHT (~10 min) docs + colleague DM (capped) + warm-up questions + 2 core
 *                    deliverables + debrief with senior-review feedback.
 *   DEEP   (~25 min) everything: all deliverables, longer chat, Mirror credit.
 *
 * Design: standard FlightWay tokens/light-dark (no bespoke theme). Content:
 * authored flights (flights.json) + on-demand generated sims (/sim-generate,
 * cached globally server-side). Personas stay server-side. Autosave + resume.
 * Telemetry events in localStorage for Leo's user-testing week.
 *
 * Exposes window.FWFlights.
 */
(function (global) {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────── */

  var FLIGHTS_URL = 'assets/data/simulations/flights.json';
  var HISTORY_KEY = 'fw_sim_history_v2';
  var DRAFT_PREFIX = 'fw_sim_draft_v2:';
  var EVENTS_KEY = 'fw_sim_events_v1';
  var HISTORY_MAX = 24;
  var EVENTS_MAX = 300;

  var TIERS = {
    taxi: { label: 'Quick look', minutes: 2, chatCap: 0 },
    flight: { label: 'Test flight', minutes: 10, chatCap: 6, coreOnly: true },
    deep: { label: 'Deep dive', minutes: 25, chatCap: 12, coreOnly: false }
  };
  var SUBMIT_MIN_WORDS = { flight: 30, deep: 40 };

  // Authored flight id → slugs that should open it (site slugs + common
  // O*NET-style titles). Fuzzy title match below catches the long tail.
  var ALIASES = {
    'pm-northstar': ['product-manager', 'product-managers', 'project-management-specialists'],
    'uxr-forkful': ['ux-researcher', 'ux-designer', 'user-experience-researcher', 'user-experience-designers'],
    'supply-cobalt': ['supply-chain-manager', 'supply-chain-analyst', 'logisticians', 'supply-chain-managers'],
    'planner-aldercreek': ['urban-planner', 'urban-and-regional-planners', 'city-planner'],
    'smm-tidewater': ['social-media-manager', 'public-relations', 'public-relations-specialists', 'content-strategist'],
    'forensic-halverson': ['forensic-accountant', 'accountant', 'accountants-and-auditors', 'fraud-examiners-investigators-and-analysts'],
    'slp-maplegrove': ['speech-language-pathologist', 'speech-language-pathologists']
  };
  var TITLE_HINTS = {
    'pm-northstar': ['product manager'],
    'uxr-forkful': ['ux researcher', 'user experience'],
    'supply-cobalt': ['supply chain', 'logistician'],
    'planner-aldercreek': ['urban', 'regional planner'],
    'smm-tidewater': ['social media', 'public relations'],
    'forensic-halverson': ['forensic', 'auditor', 'fraud'],
    'slp-maplegrove': ['speech-language', 'speech language']
  };
  var FLIGHT_TO_SLUG = {
    'pm-northstar': 'product-manager',
    'uxr-forkful': 'ux-designer',
    'supply-cobalt': 'supply-chain-manager',
    'planner-aldercreek': 'urban-planner',
    'smm-tidewater': 'public-relations',
    'forensic-halverson': 'accountant'
  };

  /* ── State ─────────────────────────────────────────────────── */

  var S = {
    sims: [],
    genIndex: [],        // AI-generated sims cached server-side (board discovery)
    view: 'loading',
    sim: null,
    tier: null,          // 'taxi' | 'flight' | 'deep'
    filter: 'ALL',
    trials: [],
    resetArm: false,
    predicted: null,
    // taxi
    taxiStep: 0,
    taxiFeel: null,
    // flight/deep
    tab: 'brief',
    answers: {},
    hintsOpen: {},
    hintCount: 0,
    warmups: {},         // interaction index -> chosen option index
    scenarioPath: [],    // deep-tier crossroads: [{nodeId, optIdx}]
    chat: [],
    chatBusy: false,
    startAt: null,
    elapsedBase: 0,
    // debrief
    experienced: null,
    marks: {},
    surprise: '',
    feedback: null,
    fbBusy: false,
    fbError: null,
    logged: false,
    lastTrial: null,
    // mirror
    mirror: null,
    mirrorBusy: false,
    mirrorError: null
  };

  var root = null;
  var tickHandle = null;
  var draftTimer = null;

  /* ── Helpers ───────────────────────────────────────────────── */

  function h(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function md(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    return m + ':' + String(sec % 60).padStart(2, '0');
  }

  function words(str) {
    return String(str || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function qs(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; } catch (_) { return ''; }
  }

  function scrollTop() {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  }

  function firstName(full) { return String(full || '').split(' ')[0]; }

  function elapsedSec() {
    var live = S.startAt ? Math.floor((Date.now() - S.startAt) / 1000) : 0;
    return S.elapsedBase + live;
  }

  function fwApi(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var data;
        try { data = t ? JSON.parse(t) : {}; } catch (_) { data = { error: 'Bad response' }; }
        if (!r.ok) throw Object.assign(new Error(data.error || ('HTTP ' + r.status)), { status: r.status });
        return data;
      });
    });
  }

  /* ── Telemetry (for Leo's user-testing week) ───────────────── */

  function logEvent(type, data) {
    try {
      var raw = localStorage.getItem(EVENTS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      arr.unshift({ t: type, at: new Date().toISOString(), sim: S.sim ? S.sim.id : null, tier: S.tier, d: data || null });
      localStorage.setItem(EVENTS_KEY, JSON.stringify(arr.slice(0, EVENTS_MAX)));
    } catch (_) {}
  }

  /* ── Storage ───────────────────────────────────────────────── */

  function loadTrials() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function saveTrials() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.trials.slice(0, HISTORY_MAX))); } catch (_) {}
  }

  function draftKey(simId) { return DRAFT_PREFIX + simId; }

  function saveDraft() {
    if (!S.sim || S.tier === 'taxi') return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try {
        localStorage.setItem(draftKey(S.sim.id), JSON.stringify({
          tier: S.tier,
          predicted: S.predicted,
          answers: S.answers,
          hintsOpen: S.hintsOpen,
          hintCount: S.hintCount,
          warmups: S.warmups,
          scenarioPath: S.scenarioPath,
          chat: S.chat,
          elapsed: elapsedSec(),
          at: Date.now()
        }));
      } catch (_) {}
    }, 400);
  }

  function loadDraft(simId) {
    try {
      var raw = localStorage.getItem(draftKey(simId));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearDraft(simId) {
    try { localStorage.removeItem(draftKey(simId)); } catch (_) {}
  }

  // Free/paid merge §1 — the deep tier is Flight Plan. FWEnt.has() is true for
  // everyone while the paywall ships dark, and true if entitlements never
  // loaded, so this can only ever lock someone the server would also lock.
  function deepTierEntitled() {
    if (!window.FWEnt || typeof FWEnt.has !== 'function') return true;
    return FWEnt.has('premium');
  }

  function completedTier(simId, tier) {
    return S.trials.some(function (t) {
      return t.simId === simId && (tier ? t.tier === tier || (tier === 'flight' && t.tier === 'deep') : true);
    });
  }

  /* ── Quiz-fit chips ────────────────────────────────────────── */

  function hubFitBySlug() {
    try {
      if (!global.FWAuth || typeof FWAuth.readLocalQuiz !== 'function') return null;
      var q = FWAuth.readLocalQuiz();
      if (!q || !q.scores || !global.FWHubCareers
        || typeof FWHubCareers.rankCareersFromQuizScores !== 'function') return null;
      var out = {};
      FWHubCareers.rankCareersFromQuizScores(q.scores).forEach(function (m) {
        var slug = (typeof FWHubCareers.careerSlug === 'function') ? FWHubCareers.careerSlug(m.career.id) : '';
        if (slug) out[slug] = Math.round(m.score);
      });
      return out;
    } catch (_) { return null; }
  }

  /* ── Jargon decoder ────────────────────────────────────────── */

  function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function decodeHtml(text, sim) {
    var base = md(text);
    if (!sim || !sim.glossary || !sim.glossary.length) return base;
    var pattern = sim.glossary.slice()
      .sort(function (a, b) { return b.term.length - a.term.length; })
      .map(function (g) { return escapeRx(g.term); })
      .join('|');
    var rx = new RegExp('\\b(' + pattern + ')\\b', 'gi');
    return base.replace(rx, function (match) {
      return '<button type="button" class="fw-term" data-term="' + esc(match.toLowerCase()) + '">' + match + '</button>';
    });
  }

  function bindDecoder(container, sim) {
    container.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.fw-term') : null;
      if (!t) return;
      e.stopPropagation();
      var key = t.getAttribute('data-term');
      var entry = (sim.glossary || []).find(function (g) { return g.term.toLowerCase() === key; });
      if (entry) showDecoder(entry);
    });
  }

  function showDecoder(entry) {
    hideDecoder();
    logEvent('decode', { term: entry.term });
    var bar = h('div', 'fw-decoder fw-up');
    bar.id = 'fw-decoder';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Plain-English decoder');
    var inner = h('div', 'fw-decoder-inner');
    inner.appendChild(h('div', null,
      '<div class="fw-eyebrow">Plain English</div>'
      + '<div class="fw-decoder-term">' + esc(entry.term) + '</div>'
      + '<p class="fw-decoder-plain">' + esc(entry.plain) + '</p>'));
    var close = h('button', 'fw-decoder-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close decoder');
    close.onclick = hideDecoder;
    inner.appendChild(close);
    bar.appendChild(inner);
    document.body.appendChild(bar);
  }

  function hideDecoder() {
    var el = document.getElementById('fw-decoder');
    if (el) el.remove();
  }

  /* ── Shared UI pieces ──────────────────────────────────────── */

  function eyebrow(text, accent) {
    return h('div', 'fw-eyebrow' + (accent ? ' fw-eyebrow--accent' : ''), text);
  }

  function bigButton(label, onclick, opts) {
    opts = opts || {};
    var b = h('button', 'fw-bigbtn' + (opts.outline ? ' fw-bigbtn--outline' : ''), label);
    b.type = 'button';
    b.disabled = !!opts.disabled;
    b.onclick = onclick;
    return b;
  }

  function backRow(label, onclick) {
    var b = h('button', 'fw-back', '← ' + (label || 'Back'));
    b.type = 'button';
    b.onclick = onclick;
    var row = h('div', 'fw-back-row');
    row.appendChild(b);
    return row;
  }

  function scalePicker(value, onChange) {
    var wrap = h('div', 'fw-scale');
    wrap.setAttribute('role', 'radiogroup');
    for (var n = 1; n <= 10; n++) {
      (function (num) {
        var b = h('button', 'fw-scale-btn' + (value === num ? ' is-on' : ''), String(num));
        b.type = 'button';
        b.onclick = function () { onChange(num); };
        wrap.appendChild(b);
      })(n);
    }
    return wrap;
  }

  function gapGauge(predicted, experienced) {
    var pct = function (v) { return ((v - 1) / 9) * 100; };
    var gap = experienced - predicted;
    var el = h('div', 'fw-gauge-wrap');
    el.appendChild(h('div', 'fw-gauge-head',
      '<span class="fw-eyebrow">Your forecast vs. how it actually felt</span>'
      + '<span class="fw-gauge-num ' + (gap === 0 ? '' : gap > 0 ? 'is-up' : 'is-down') + '">'
      + (gap > 0 ? '+' + gap : gap) + '</span>'));
    var track = h('div', 'fw-gauge');
    for (var i = 1; i <= 9; i++) {
      var tick = h('div', 'fw-gauge-tick');
      tick.style.left = (i / 10) * 100 + '%';
      track.appendChild(tick);
    }
    var fcst = h('div', 'fw-gauge-fcst');
    fcst.style.left = 'calc(' + pct(predicted) + '% - 1px)';
    var fcstLbl = h('div', 'fw-gauge-fcst-lbl', 'GUESS');
    fcstLbl.style.left = 'calc(' + pct(predicted) + '% - 16px)';
    var marker = h('div', 'fw-gauge-marker');
    marker.style.left = 'calc(' + pct(experienced) + '% - 5px)';
    track.appendChild(fcst);
    track.appendChild(fcstLbl);
    track.appendChild(marker);
    el.appendChild(track);
    el.appendChild(h('div', 'fw-gauge-foot', '<span>1 — dreaded it</span><span>loved it — 10</span>'));
    return el;
  }

  function clearRoot() {
    hideDecoder();
    stopTick();
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function stopTick() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  /* ── Board (no slug in URL) ────────────────────────────────── */

  function showBoard() {
    clearRoot();
    S.view = 'board';
    var page = h('div', 'fw-page fw-up');

    var hero = h('div', 'fw-board-hero');
    hero.appendChild(h('div', 'section-tag', 'Career Tester'));
    hero.appendChild(h('h1', 'fw-h1', 'Try a career before you commit to it.'));
    hero.appendChild(h('p', 'fw-intro', 'A real slice of the job — real documents, real decisions, a colleague to ask. Start with a <strong>2-minute look</strong>; go deeper when one hooks you.'));
    page.appendChild(hero);

    // Mirror card
    var flown = S.trials.filter(function (t) { return t.tier !== 'taxi'; });
    var canMirror = flown.length >= 2;
    var mirrorCard = h('button', 'fw-mirror-card' + (canMirror ? ' is-ready' : ''));
    mirrorCard.type = 'button';
    mirrorCard.innerHTML =
      '<div><div class="fw-eyebrow' + (canMirror ? ' fw-eyebrow--accent' : '') + '">The Mirror</div>'
      + '<div class="fw-mirror-title">' + (canMirror ? 'Patterns detected — open your readout' : 'Unlocks after 2 test flights') + '</div>'
      + '<div class="fw-mirror-sub">' + (canMirror
        ? flown.length + ' flights logged. See what repeats about you when the job changes.'
        : flown.length + '/2 logged. The Mirror finds what energizes you across careers.') + '</div></div>'
      + '<div class="fw-mirror-arrow">' + (canMirror ? '→' : '···') + '</div>';
    if (canMirror) mirrorCard.onclick = showMirror;
    page.appendChild(mirrorCard);

    // Filters + cards
    var filters = [['ALL', 'All'], ['FAMILIAR', "You've heard of it"], ['HIDDEN', 'Never considered it'], ['NOTFLOWN', 'Not tried yet']];
    var chipRow = h('div', 'fw-chips');
    filters.forEach(function (f) {
      var c = h('button', 'fw-chip' + (S.filter === f[0] ? ' is-on' : ''), f[1]);
      c.type = 'button';
      c.onclick = function () { S.filter = f[0]; showBoard(); };
      chipRow.appendChild(c);
    });
    page.appendChild(chipRow);

    var bySim = {};
    S.trials.forEach(function (t) { if (!bySim[t.simId]) bySim[t.simId] = t; });
    var fits = hubFitBySlug();

    var list = h('div', 'fw-cards');
    S.sims.filter(function (s) {
      if (S.filter === 'FAMILIAR') return s.tag === 'FAMILIAR';
      if (S.filter === 'HIDDEN') return s.tag === 'HIDDEN';
      if (S.filter === 'NOTFLOWN') return !bySim[s.id];
      return true;
    }).forEach(function (s) {
      var t = bySim[s.id];
      var draft = loadDraft(s.id);
      var hubSlug = FLIGHT_TO_SLUG[s.id];
      var fit = fits && hubSlug ? fits[hubSlug] : null;
      var card = h('button', 'fw-flight');
      card.type = 'button';
      card.innerHTML =
        '<div class="fw-flight-top"><span class="fw-eyebrow">' + esc(s.domain)
        + ' · <span class="' + (s.tag === 'HIDDEN' ? 'fw-pos' : '') + '">'
        + (s.tag === 'HIDDEN' ? 'never considered it' : "you've heard of it") + '</span></span>'
        + (t ? '<span class="fw-flown">✓ tried · ' + (t.experienced || '–') + '/10</span>'
          : (draft ? '<span class="fw-inprogress">● in progress</span>' : '')) + '</div>'
        + '<div class="fw-flight-title">' + esc(s.title) + '</div>'
        + '<div class="fw-flight-org">' + esc(s.org) + ' — ' + esc(s.orgPlain) + '</div>'
        + '<div class="fw-flight-hook">' + esc(s.hook) + '</div>'
        + (fit != null ? '<div class="fw-flight-fit">Your Hub match: <strong>' + fit + '%</strong></div>' : '');
      card.onclick = function () { openEntry(s); };
      list.appendChild(card);
    });
    page.appendChild(list);

    // AI-generated sims already built for other users — instant to open.
    var authoredIds = {};
    S.sims.forEach(function (s2) {
      authoredIds[s2.id] = 1;
      (ALIASES[s2.id] || []).forEach(function (a) { authoredIds[a] = 1; });
    });
    var gen = (S.genIndex || []).filter(function (g) { return g && g.id && !authoredIds[g.id]; });
    if (gen.length && S.filter === 'ALL') {
      page.appendChild(h('h2', 'fw-h2', 'Built by request'));
      page.appendChild(h('p', 'fw-foot-note', 'Simulations other explorers generated — ready instantly. Any career\'s deep-dive page can build its own.'));
      var genList = h('div', 'fw-cards');
      gen.slice(0, 12).forEach(function (g) {
        var card = h('button', 'fw-flight');
        card.type = 'button';
        card.innerHTML =
          '<div class="fw-flight-top"><span class="fw-eyebrow">' + esc(g.domain || 'GENERATED') + ' · AI-built</span></div>'
          + '<div class="fw-flight-title">' + esc(g.title) + '</div>'
          + (g.org ? '<div class="fw-flight-org">' + esc(g.org) + (g.orgPlain ? ' — ' + esc(g.orgPlain) : '') + '</div>' : '')
          + (g.hook ? '<div class="fw-flight-hook">' + esc(g.hook) + '</div>' : '');
        card.onclick = function () { openGenerated(g.id, g.title); };
        genList.appendChild(card);
      });
      page.appendChild(genList);
    }

    var foot = h('div', 'fw-board-foot');
    foot.appendChild(h('span', 'fw-foot-note', 'Simulations include the boring parts on purpose — that\'s how you know it\'s honest.'));
    if (S.trials.length > 0) {
      var reset = h('button', 'fw-reset' + (S.resetArm ? ' is-armed' : ''), S.resetArm ? 'Tap again to erase' : 'Reset my data');
      reset.type = 'button';
      reset.onclick = function () {
        if (!S.resetArm) {
          S.resetArm = true;
          setTimeout(function () { S.resetArm = false; if (S.view === 'board') showBoard(); }, 3000);
          showBoard();
          return;
        }
        S.trials = []; saveTrials(); S.mirror = null; S.resetArm = false;
        S.sims.forEach(function (s) { clearDraft(s.id); });
        showBoard();
      };
      foot.appendChild(reset);
    }
    page.appendChild(foot);

    root.appendChild(page);
    scrollTop();
  }

  /* ── Entry: forecast + tier pick ───────────────────────────── */

  function openEntry(sim) {
    S.sim = sim;
    S.predicted = null;
    S.view = 'entry';
    logEvent('entry_view');
    renderEntry();
  }

  function renderEntry() {
    clearRoot();
    var sim = S.sim;
    var page = h('div', 'fw-page fw-up');
    page.appendChild(backRow('All careers', showBoard));
    page.appendChild(h('div', 'section-tag', esc(sim.domain || 'Career Tester')));
    page.appendChild(h('h1', 'fw-h1', esc(sim.title)));
    page.appendChild(h('p', 'fw-org-line', 'You\'ll be a new hire at <strong>' + esc(sim.org) + '</strong> — ' + esc(sim.orgPlain || '') + '.'));
    page.appendChild(h('p', 'fw-intro', esc(sim.youWill || sim.hook || '')));

    // Resume banner
    var draft = loadDraft(sim.id);
    if (draft && (words(Object.values(draft.answers || {}).join(' ')) > 0 || (draft.chat || []).length > 0)) {
      var resume = h('div', 'fw-panel fw-panel--accent');
      resume.appendChild(eyebrow('In progress', true));
      resume.appendChild(h('p', 'fw-p', 'Your writing and chat from last time are saved.'));
      var res = bigButton('Resume where you left off →', function () { resumeDraft(draft); });
      resume.appendChild(res);
      var fresh = h('button', 'fw-textbtn', 'start over instead (erases the draft)');
      fresh.type = 'button';
      fresh.onclick = function () { clearDraft(sim.id); renderEntry(); };
      resume.appendChild(fresh);
      page.appendChild(resume);
    }

    // One-tap forecast
    var fc = h('div', 'fw-panel');
    fc.appendChild(eyebrow('One tap before you start', true));
    fc.appendChild(h('p', 'fw-p', 'Gut feeling — how much would you enjoy this work? Afterward we show you the gap between your guess and reality. <em>The gap is the interesting part.</em>'));
    var scaleHost = h('div');
    var renderScale = function () {
      scaleHost.innerHTML = '';
      scaleHost.appendChild(scalePicker(S.predicted, function (n) {
        S.predicted = n;
        logEvent('forecast_set', { v: n });
        renderScale();
        syncTiers();
      }));
    };
    renderScale();
    fc.appendChild(scaleHost);
    page.appendChild(fc);

    // Tier cards
    var tiersWrap = h('div', 'fw-tiers');
    // Free/paid merge §1: taxi + flight stay free (the funnel has to feel
    // complete); the deep dive and its Crossroads branching are Flight Plan.
    // Reuses the tier card's existing locked language, not a new lock style.
    var deepEarned = completedTier(sim.id, 'flight');
    var deepPaid = deepTierEntitled();
    var deepUnlocked = deepEarned && deepPaid;
    var deepDesc = !deepPaid
      ? 'A Flight Plan feature — the full deliverable, every document, extended colleague access.'
      : (deepEarned
        ? 'The full deliverable, every document, extended colleague access.'
        : 'Unlocks after a test flight — see the job before you do the whole job.');
    var defs = [
      { id: 'taxi', title: '2-minute look', desc: 'One real document, one call to make, one honest payoff. No writing.', cta: 'Take a look →' },
      { id: 'flight', title: '10-minute test flight', desc: 'Read the file, DM a colleague, make the call, get reviewed like a real new hire.', cta: 'Start the flight →' },
      { id: 'deep', title: '25-minute deep dive', desc: deepDesc, cta: 'Go deep →', locked: !deepUnlocked, upgrade: !deepPaid }
    ];
    var tierBtns = [];
    defs.forEach(function (d) {
      var card = h('button', 'fw-tier' + (d.locked ? ' is-locked' : ''));
      card.type = 'button';
      var lockedCta = d.upgrade ? 'See Flight Plan →' : 'Finish a test flight first';
      card.innerHTML = '<div class="fw-tier-head"><span class="fw-tier-title">' + d.title + '</span>'
        + (d.locked ? '<span class="fw-tier-lock">🔒</span>' : '') + '</div>'
        + '<p class="fw-tier-desc">' + d.desc + '</p>'
        + '<span class="fw-tier-cta">' + (d.locked ? lockedCta : d.cta) + '</span>';
      card.disabled = true;
      if (!d.locked) {
        card.onclick = function () { startTier(d.id); };
        tierBtns.push(card);
      } else if (d.upgrade) {
        card.disabled = false;
        card.onclick = function () { location.href = 'pricing.html'; };
      }
      tiersWrap.appendChild(card);
    });
    var tierNote = h('p', 'fw-foot-note', 'Set your gut feeling above to unlock the buttons — it takes one tap.');
    function syncTiers() {
      var ok = S.predicted != null;
      tierBtns.forEach(function (b) { b.disabled = !ok; });
      tierNote.hidden = ok;
    }
    syncTiers();
    page.appendChild(tiersWrap);
    page.appendChild(tierNote);

    root.appendChild(page);
    scrollTop();
  }

  function startTier(tier) {
    S.tier = tier;
    logEvent('tier_start');
    if (tier === 'taxi') {
      S.taxiStep = 0;
      S.taxiFeel = null;
      showTaxi();
      return;
    }
    S.tab = 'brief';
    S.answers = {};
    S.hintsOpen = {};
    S.hintCount = 0;
    S.warmups = {};
    S.scenarioPath = [];
    S.chat = [];
    S.chatBusy = false;
    S.elapsedBase = 0;
    S.startAt = Date.now();
    showSim();
  }

  function resumeDraft(draft) {
    S.tier = draft.tier === 'deep' ? 'deep' : 'flight';
    S.predicted = draft.predicted != null ? draft.predicted : 5;
    S.answers = draft.answers || {};
    S.hintsOpen = draft.hintsOpen || {};
    S.hintCount = draft.hintCount || 0;
    S.warmups = draft.warmups || {};
    S.scenarioPath = draft.scenarioPath || [];
    S.chat = draft.chat || [];
    S.elapsedBase = draft.elapsed || 0;
    S.startAt = Date.now();
    S.tab = 'work';
    logEvent('resume');
    showSim();
  }

  /* ── TAXI: 2-minute look ───────────────────────────────────── */

  function taxiData(sim) {
    var t = sim.taxi || {};
    var doc = null;
    if (t.docLabel) {
      doc = (sim.docs || []).find(function (d) { return d.label === t.docLabel; });
    }
    if (!doc) {
      doc = (sim.docs || []).find(function (d) { return d.kind === 'data'; }) || (sim.docs || [])[0];
    }
    var inter = (sim.interactions || [])[0];
    return {
      brief: t.brief || sim.brief,
      doc: doc,
      interaction: inter,
      payoff: t.payoff || ''
    };
  }

  function showTaxi() {
    clearRoot();
    S.view = 'taxi';
    var sim = S.sim;
    var td = taxiData(sim);
    if (!td.interaction) { S.tier = 'flight'; startTier('flight'); return; }

    var page = h('div', 'fw-page fw-up');
    bindDecoder(page, sim);
    page.appendChild(backRow(sim.title, function () { renderEntry(); }));

    if (S.taxiStep === 0) {
      page.appendChild(eyebrow('2-minute look · step 1 of 2', true));
      page.appendChild(h('h2', 'fw-h2', 'The situation'));
      page.appendChild(h('div', 'fw-panel fw-panel--reading', decodeHtml(td.brief, sim)));
      page.appendChild(paperDoc(td.doc, sim));
      page.appendChild(h('p', 'fw-foot-note', 'Tap any <span class="fw-underline-demo">underlined word</span> for plain English. The answer to what comes next is in this document.'));
      page.appendChild(bigButton('I\'ve read it — what\'s the call? →', function () { S.taxiStep = 1; showTaxi(); }));
    } else if (S.taxiStep === 1) {
      page.appendChild(eyebrow('2-minute look · step 2 of 2', true));
      page.appendChild(h('h2', 'fw-h2', esc(td.interaction.question)));
      var opts = h('div', 'fw-options');
      td.interaction.options.forEach(function (o, i) {
        var b = h('button', 'fw-option', md(o.label));
        b.type = 'button';
        b.onclick = function () { taxiAnswer(o, i, opts, page, td); };
        opts.appendChild(b);
      });
      page.appendChild(opts);
      page.appendChild(h('div', 'fw-reaction'));
    } else {
      // payoff
      page.appendChild(eyebrow('That\'s the job', true));
      page.appendChild(h('h2', 'fw-h2', 'You just did 2 real minutes of ' + esc(sim.title) + ' work.'));
      if (td.payoff) page.appendChild(h('div', 'fw-panel fw-panel--reading', decodeHtml(td.payoff, sim)));

      var feel = h('div', 'fw-panel');
      feel.appendChild(eyebrow('Honestly — how did that feel?'));
      var feelHost = h('div');
      var upgradeBtn = bigButton('Do the real thing — 10-minute test flight →', function () {
        logEvent('tier_upgrade_click', { from: 'taxi' });
        startTier('flight');
      }, { disabled: true });
      var renderFeel = function () {
        feelHost.innerHTML = '';
        feelHost.appendChild(scalePicker(S.taxiFeel, function (n) {
          S.taxiFeel = n; renderFeel();
          upgradeBtn.disabled = false;
          var g = document.getElementById('fw-taxi-gap');
          if (g) {
            var gap = n - S.predicted;
            g.hidden = false;
            g.innerHTML = gap === 0
              ? 'Exactly what you guessed. Rare — most people are off by 2+.'
              : 'You guessed <strong>' + S.predicted + '</strong>, felt <strong>' + n + '</strong>. '
                + (gap > 0 ? 'This might be more your thing than you thought.' : 'Useful data — better to learn it in 2 minutes than 2 years.');
          }
        }));
      };
      renderFeel();
      feel.appendChild(feelHost);
      var gapLine = h('p', 'fw-p');
      gapLine.id = 'fw-taxi-gap';
      gapLine.hidden = true;
      feel.appendChild(gapLine);
      page.appendChild(feel);

      page.appendChild(upgradeBtn);
      var later = h('button', 'fw-textbtn', 'maybe later — back to all careers');
      later.type = 'button';
      later.onclick = function () {
        logEvent('taxi_exit');
        showBoard();
      };
      page.appendChild(later);
    }

    root.appendChild(page);
    scrollTop();
  }

  function taxiAnswer(opt, idx, optsBox, page, td) {
    var kids = optsBox.querySelectorAll('.fw-option');
    for (var i = 0; i < kids.length; i++) { kids[i].disabled = true; kids[i].classList.add('is-locked'); }
    kids[idx].classList.remove('is-locked');
    kids[idx].classList.add(opt.correct ? 'is-correct' : 'is-picked');
    logEvent('taxi_answer', { correct: !!opt.correct });
    var box = page.querySelector('.fw-reaction');
    if (box) {
      box.innerHTML = '<div class="fw-reaction-main">' + md(opt.reaction || '') + '</div>';
      box.classList.add('show');
      var go = bigButton('And here\'s the point →', function () {
        S.taxiStep = 2;
        logEvent('taxi_complete');
        showTaxi();
      });
      box.appendChild(go);
      try { go.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }
  }

  /* ── FLIGHT / DEEP: the sim ────────────────────────────────── */

  function coreSections(sim) {
    var core = sim.workSections.filter(function (s) { return s.core; });
    return core.length >= 2 ? core : sim.workSections.slice(0, 2);
  }

  function activeSections(sim) {
    return (S.tier === 'flight') ? coreSections(sim) : sim.workSections;
  }

  function paperDoc(doc, sim) {
    var paper = h('div', 'fw-paper');
    paper.appendChild(h('div', 'fw-paper-head', '<span class="fw-paper-label">' + esc(doc.label) + '</span><span class="fw-paper-title">' + esc(doc.title) + '</span>'));
    if (doc.kind === 'data') {
      var pre = h('pre', 'fw-paper-data');
      pre.innerHTML = doc.body.map(function (line) { return decodeHtml(line, sim); }).join('\n');
      paper.appendChild(pre);
    } else {
      var d = h('div', 'fw-paper-doc');
      doc.body.forEach(function (p) { d.appendChild(h('p', null, decodeHtml(p, sim))); });
      paper.appendChild(d);
    }
    return paper;
  }

  function showSim() {
    clearRoot();
    S.view = 'sim';
    var sim = S.sim;
    var page = h('div', 'fw-page fw-up');
    bindDecoder(page, sim);

    var head = h('div', 'fw-sim-head');
    var back = h('button', 'fw-back', '← Save & exit');
    back.type = 'button';
    back.onclick = function () { saveDraft(); logEvent('save_exit'); showBoard(); };
    head.appendChild(back);
    head.appendChild(h('div', 'fw-sim-title', '<strong>' + esc(sim.title) + '</strong> · ' + esc(sim.org)
      + ' <span class="fw-tier-badge">' + TIERS[S.tier].label + '</span>'));
    var timer = h('div', 'fw-timer', '<span class="fw-timer-dot"></span><span id="fw-timer-val">' + fmtTime(elapsedSec()) + '</span>');
    head.appendChild(timer);
    page.appendChild(head);
    stopTick();
    tickHandle = setInterval(function () {
      var el = document.getElementById('fw-timer-val');
      if (el) el.textContent = fmtTime(elapsedSec());
    }, 1000);

    var tabs = [['brief', 'Brief'], ['docs', 'Documents'], ['colleague', firstName(sim.colleague.name)]];
    if (S.tier === 'deep' && simScenario(sim)) tabs.push(['scenario', 'Crossroads']);
    tabs.push(['work', 'Your work']);
    var tabRow = h('div', 'fw-tabs');
    tabs.forEach(function (t) {
      var b = h('button', 'fw-tab' + (S.tab === t[0] ? ' is-on' : ''), esc(t[1]));
      b.type = 'button';
      b.onclick = function () { S.tab = t[0]; hideDecoder(); showSim(); };
      tabRow.appendChild(b);
    });
    page.appendChild(tabRow);

    var body = h('div');
    if (S.tab === 'brief') body.appendChild(tabBrief(sim));
    if (S.tab === 'docs') body.appendChild(tabDocs(sim));
    if (S.tab === 'colleague') body.appendChild(tabColleague(sim));
    if (S.tab === 'scenario') body.appendChild(tabScenario(sim));
    if (S.tab === 'work') body.appendChild(tabWork(sim));
    page.appendChild(body);

    root.appendChild(page);
    if (S.tab !== 'colleague') scrollTop();
  }

  function tabBrief(sim) {
    var el = h('div');

    // Orientation folded in as progressive disclosure
    var det = h('details', 'fw-orient');
    det.innerHTML = '<summary>New here? 60-second orientation</summary>';
    var od = h('div', 'fw-orient-body');
    od.appendChild(h('p', 'fw-p', '<strong>Where you are:</strong> ' + esc(sim.orientation.company)));
    od.appendChild(h('p', 'fw-p', '<strong>What a ' + esc(sim.title.toLowerCase()) + ' actually does:</strong> ' + esc(sim.orientation.role)));
    od.appendChild(h('p', 'fw-p', '<strong>Who you\'ll meet:</strong> ' + (sim.orientation.people || []).map(esc).join(' · ')));
    det.appendChild(od);
    el.appendChild(det);

    el.appendChild(h('div', 'fw-panel fw-panel--reading', decodeHtml(sim.brief, sim)));
    var produce = h('div', 'fw-panel fw-panel--accent');
    produce.appendChild(eyebrow('What you\'ll produce', true));
    produce.appendChild(h('p', 'fw-p', decodeHtml(sim.task, sim)));
    activeSections(sim).forEach(function (s, i) {
      produce.appendChild(h('p', 'fw-worklist', (i + 1) + '. ' + esc(s.label)));
    });
    if (S.tier === 'flight' && sim.workSections.length > coreSections(sim).length) {
      produce.appendChild(h('p', 'fw-foot-note', 'The deep dive adds ' + (sim.workSections.length - coreSections(sim).length) + ' more deliverable(s) — this flight keeps it to the core two.'));
    }
    el.appendChild(produce);
    el.appendChild(h('p', 'fw-foot-note',
      'Read the documents (tap any <span class="fw-underline-demo">underlined word</span> for plain English). Message '
      + esc(firstName(sim.colleague.name)) + ' anytime — asking questions is what good new hires do. Then build your answer in <strong>Your work</strong>.'));
    return el;
  }

  /* ── Deep-tier Crossroads: branching decision scenario ─────── */
  // A pressured stretch of the job as sequential calls: each beat shows the
  // situation, the user picks a move, the outcome plays, and the choice
  // decides which beat comes next. Generated sims carry sim.scenario;
  // authored sims without one simply don't get the tab.

  function simScenario(sim) {
    var sc = sim && sim.scenario;
    return sc && Array.isArray(sc.nodes) && sc.nodes.length >= 3 ? sc : null;
  }

  function scenarioNode(sc, id) {
    for (var i = 0; i < sc.nodes.length; i++) if (sc.nodes[i].id === id) return sc.nodes[i];
    return null;
  }

  function tabScenario(sim) {
    var sc = simScenario(sim);
    var el = h('div');
    if (!sc) return el;
    el.appendChild(h('p', 'fw-p fw-intro', esc(sc.intro || 'A stretch of this job where the calls compound. Make each one.')));

    // Replay the beats already decided.
    var curId = sc.nodes[0].id;
    var ended = false;
    S.scenarioPath.forEach(function (step) {
      var node = scenarioNode(sc, step.nodeId);
      if (!node || ended) return;
      var opt = node.options[step.optIdx];
      if (!opt) return;
      var beat = h('div', 'fw-panel');
      beat.appendChild(h('p', 'fw-p', esc(node.setup)));
      beat.appendChild(h('p', 'fw-p', '<strong>' + esc(node.decision) + '</strong>'));
      beat.appendChild(h('p', 'fw-p', '<em>Your call:</em> ' + esc(opt.label)));
      beat.appendChild(h('p', 'fw-p' + (opt.tone === 'costly' ? ' fw-neg' : opt.tone === 'strong' ? ' fw-pos' : ''), esc(opt.outcome)));
      el.appendChild(beat);
      if (opt.next) curId = opt.next; else ended = true;
    });

    if (ended) {
      var doneP = h('div', 'fw-panel fw-panel--accent');
      doneP.appendChild(eyebrow('Crossroads complete', true));
      doneP.appendChild(h('p', 'fw-p', 'You navigated ' + S.scenarioPath.length + ' calls the way this job actually serves them — under time pressure, with partial information. Bring what you learned into <strong>Your work</strong>.'));
      var redo = h('button', 'fw-chip', 'Run it again differently');
      redo.type = 'button';
      redo.onclick = function () { S.scenarioPath = []; saveDraft(); showSim(); };
      doneP.appendChild(redo);
      el.appendChild(doneP);
      return el;
    }

    var node = scenarioNode(sc, curId);
    if (!node) return el;
    var live = h('div', 'fw-panel fw-panel--reading');
    live.appendChild(h('p', 'fw-p', esc(node.setup)));
    live.appendChild(h('p', 'fw-p', '<strong>' + esc(node.decision) + '</strong>'));
    node.options.forEach(function (opt, i) {
      var b = h('button', 'fw-option', esc(opt.label));
      b.type = 'button';
      b.onclick = function () {
        S.scenarioPath.push({ nodeId: node.id, optIdx: i });
        logEvent('scenario_choice', { node: node.id, opt: i });
        saveDraft();
        showSim();
      };
      live.appendChild(b);
    });
    el.appendChild(live);
    return el;
  }

  function tabDocs(sim) {
    var el = h('div', 'fw-cards');
    sim.docs.forEach(function (doc) { el.appendChild(paperDoc(doc, sim)); });
    return el;
  }

  function tabColleague(sim) {
    var cap = TIERS[S.tier].chatCap;
    var el = h('div');
    var box = h('div', 'fw-chatbox');
    box.appendChild(eyebrow('DM — ' + esc(sim.colleague.name) + ' · ' + esc(sim.colleague.role)));
    var thread = h('div', 'fw-thread');
    thread.setAttribute('aria-live', 'polite');
    if (S.chat.length === 0) {
      thread.appendChild(h('p', 'fw-chat-empty', esc(firstName(sim.colleague.name)) + ' is online. No dumb questions on day one — that\'s literally the rule here.'));
    }
    S.chat.forEach(function (m) {
      thread.appendChild(h('div', 'fw-msg' + (m.role === 'user' ? ' fw-msg--me' : ''), esc(m.content)));
    });
    if (S.chatBusy) thread.appendChild(h('div', 'fw-typing', esc(firstName(sim.colleague.name)) + ' is typing…'));
    box.appendChild(thread);
    el.appendChild(box);

    var userMsgs = S.chat.filter(function (m) { return m.role === 'user'; }).length;

    if (S.chat.length === 0) {
      var starters = h('div', 'fw-starters');
      (sim.starters || []).forEach(function (q) {
        var b = h('button', 'fw-starter', '💬 ' + esc(q));
        b.type = 'button';
        b.onclick = function () { sendChat(q); };
        starters.appendChild(b);
      });
      el.appendChild(starters);
    }

    var row = h('div', 'fw-chatrow');
    var input = h('input', 'fw-input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = userMsgs >= cap
      ? firstName(sim.colleague.name) + ' got pulled into a meeting — you have what you need.'
      : 'Message ' + firstName(sim.colleague.name) + '…';
    input.disabled = S.chatBusy || userMsgs >= cap;
    input.onkeydown = function (e) { if (e.key === 'Enter') sendChat(input.value); };
    var send = h('button', 'fw-send', 'Send');
    send.type = 'button';
    send.disabled = S.chatBusy || userMsgs >= cap;
    send.onclick = function () { sendChat(input.value); };
    row.appendChild(input);
    row.appendChild(send);
    el.appendChild(row);
    if (cap - userMsgs > 0 && cap - userMsgs <= 2) {
      el.appendChild(h('p', 'fw-foot-note', (cap - userMsgs) + ' message' + (cap - userMsgs === 1 ? '' : 's') + ' left before ' + esc(firstName(sim.colleague.name)) + '\'s next meeting.'));
    }

    setTimeout(function () {
      var t = el.querySelector('.fw-thread');
      if (t) t.scrollTop = t.scrollHeight;
      if (!input.disabled && S.chat.length > 0) input.focus();
    }, 30);
    return el;
  }

  function sendChat(text) {
    var msg = String(text || '').trim();
    if (!msg || S.chatBusy) return;
    var cap = TIERS[S.tier].chatCap;
    if (S.chat.filter(function (m) { return m.role === 'user'; }).length >= cap) return;
    S.chat.push({ role: 'user', content: msg });
    S.chatBusy = true;
    saveDraft();
    logEvent('chat_send');
    showSim();
    fwApi('/sim-colleague', { simId: S.sim.id, messages: S.chat })
      .then(function (data) {
        S.chat.push({ role: 'assistant', content: String(data.reply || '').trim() || '…' });
      })
      .catch(function () {
        S.chat.push({ role: 'assistant', content: '(connection dropped — try sending that again)' });
      })
      .then(function () {
        S.chatBusy = false;
        saveDraft();
        if (S.view === 'sim' && S.tab === 'colleague') showSim();
      });
  }

  function tabWork(sim) {
    var el = h('div', 'fw-cards');

    // Warm-up spot questions (Jacob's fixed-format MCQs), instant feedback
    var inters = sim.interactions || [];
    if (inters.length) {
      var warm = h('div', 'fw-panel');
      warm.appendChild(eyebrow('Warm-up — check your read of the documents', true));
      inters.forEach(function (inter, wi) {
        var q = h('div', 'fw-warmup');
        q.appendChild(h('p', 'fw-work-prompt', decodeHtml(inter.question, sim)));
        var opts = h('div', 'fw-options fw-options--compact');
        var chosen = S.warmups[wi];
        inter.options.forEach(function (o, oi) {
          var b = h('button', 'fw-option', md(o.label));
          b.type = 'button';
          if (chosen != null) {
            b.disabled = true;
            if (oi === chosen) b.classList.add(o.correct ? 'is-correct' : 'is-picked');
            else b.classList.add('is-locked');
          } else {
            b.onclick = function () {
              S.warmups[wi] = oi;
              saveDraft();
              logEvent('warmup_answer', { i: wi, correct: !!o.correct });
              showSim();
            };
          }
          opts.appendChild(b);
        });
        q.appendChild(opts);
        if (chosen != null) {
          q.appendChild(h('p', 'fw-reaction-irl fw-up', '<span>What happens</span> ' + md(inter.options[chosen].reaction || '')));
        }
        warm.appendChild(q);
      });
      el.appendChild(warm);
    }

    activeSections(sim).forEach(function (s, i) {
      var panel = h('div', 'fw-panel');
      var headRow = h('div', 'fw-work-head');
      headRow.appendChild(eyebrow((i + 1) + ' / ' + activeSections(sim).length + ' — ' + esc(s.label), true));
      var nudge = h('button', 'fw-nudge' + (S.hintsOpen[s.id] ? ' is-on' : ''), S.hintsOpen[s.id] ? 'Hide nudge' : 'Need a nudge?');
      nudge.type = 'button';
      nudge.onclick = function () {
        if (!S.hintsOpen[s.id]) { S.hintCount += 1; logEvent('nudge'); }
        S.hintsOpen[s.id] = !S.hintsOpen[s.id];
        saveDraft();
        showSim();
      };
      headRow.appendChild(nudge);
      panel.appendChild(headRow);
      panel.appendChild(h('p', 'fw-work-prompt', decodeHtml(s.prompt, sim)));
      if (S.hintsOpen[s.id]) panel.appendChild(h('p', 'fw-hint fw-up', decodeHtml(s.hint, sim)));
      var ta = h('textarea', 'fw-area');
      ta.placeholder = 'Write like you\'d talk. Rough is fine — real work starts rough.';
      ta.value = S.answers[s.id] || '';
      ta.oninput = function () {
        S.answers[s.id] = ta.value;
        saveDraft();
        var wc = document.getElementById('fw-wordcount');
        if (wc) wc.textContent = totalWords(sim) + ' words';
        syncSubmit();
      };
      panel.appendChild(ta);
      el.appendChild(panel);
    });

    var row = h('div', 'fw-submit-row');
    var count = h('span', 'fw-foot-note', totalWords(sim) + ' words');
    count.id = 'fw-wordcount';
    var submit = h('button', 'fw-submit', 'Submit & land →');
    submit.type = 'button';
    submit.onclick = toDebrief;
    row.appendChild(count);
    row.appendChild(submit);
    el.appendChild(row);

    function syncSubmit() {
      var ok = canSubmit(sim);
      submit.disabled = !ok;
      submit.textContent = ok ? 'Submit & land →' : 'Write a bit more';
    }
    syncSubmit();
    return el;
  }

  function totalWords(sim) {
    return activeSections(sim).reduce(function (n, s) { return n + words(S.answers[s.id]); }, 0);
  }

  function canSubmit(sim) {
    var minWords = SUBMIT_MIN_WORDS[S.tier] || 30;
    var filled = activeSections(sim).filter(function (s) { return words(S.answers[s.id]) >= 5; }).length;
    return totalWords(sim) >= minWords && filled >= Math.min(2, activeSections(sim).length);
  }

  function buildArtifact() {
    return activeSections(S.sim)
      .map(function (s) { return s.label + ':\n' + (S.answers[s.id] || '(left blank)').trim(); })
      .join('\n\n');
  }

  /* ── Debrief ───────────────────────────────────────────────── */

  function toDebrief() {
    S.elapsedBase = elapsedSec();
    S.startAt = null;
    S.experienced = null;
    S.marks = {};
    S.surprise = '';
    S.feedback = null;
    S.fbError = null;
    S.fbBusy = false;
    S.logged = false;
    logEvent('submit');
    showDebrief();
  }

  function showDebrief() {
    clearRoot();
    S.view = 'debrief';
    var sim = S.sim;
    var page = h('div', 'fw-page fw-up');
    page.appendChild(h('div', 'fw-eyebrow fw-pos', 'Flight complete'));
    page.appendChild(h('h1', 'fw-h1', esc(sim.title) + ' · ' + fmtTime(S.elapsedBase)));

    if (!S.logged) {
      var p1 = h('div', 'fw-panel');
      p1.appendChild(eyebrow('Honestly — how was it?', true));
      var scaleHost = h('div');
      var gaugeHost = h('div');
      var renderScale = function () {
        scaleHost.innerHTML = '';
        scaleHost.appendChild(scalePicker(S.experienced, function (n) { S.experienced = n; renderScale(); renderGauge(); syncLog(); }));
      };
      var renderGauge = function () {
        gaugeHost.innerHTML = '';
        if (S.experienced != null) gaugeHost.appendChild(gapGauge(S.predicted, S.experienced));
      };
      renderScale();
      renderGauge();
      p1.appendChild(scaleHost);
      p1.appendChild(gaugeHost);
      page.appendChild(p1);

      var p2 = h('div', 'fw-panel');
      p2.appendChild(eyebrow('Tap what energized ⚡ or drained ◌ you'));
      sim.moments.forEach(function (m, i) {
        var mrow = h('div', 'fw-moment');
        var eBtn = h('button', 'fw-mk fw-mk--e' + (S.marks[i] === 'energy' ? ' is-on' : ''), '⚡');
        eBtn.type = 'button';
        eBtn.setAttribute('aria-label', 'energized: ' + m);
        eBtn.onclick = function () { S.marks[i] = S.marks[i] === 'energy' ? undefined : 'energy'; showDebrief(); };
        var dBtn = h('button', 'fw-mk fw-mk--d' + (S.marks[i] === 'drain' ? ' is-on' : ''), '◌');
        dBtn.type = 'button';
        dBtn.setAttribute('aria-label', 'drained: ' + m);
        dBtn.onclick = function () { S.marks[i] = S.marks[i] === 'drain' ? undefined : 'drain'; showDebrief(); };
        mrow.appendChild(eBtn);
        mrow.appendChild(dBtn);
        mrow.appendChild(h('span', 'fw-moment-txt' + (S.marks[i] ? ' is-marked' : ''), esc(m)));
        p2.appendChild(mrow);
      });
      page.appendChild(p2);

      var p3 = h('div', 'fw-panel');
      p3.appendChild(eyebrow('One line — what surprised you? (optional)'));
      var sIn = h('input', 'fw-input');
      sIn.type = 'text';
      sIn.maxLength = 240;
      sIn.placeholder = 'e.g. the math part was weirdly satisfying';
      sIn.value = S.surprise;
      sIn.oninput = function () { S.surprise = sIn.value; };
      p3.appendChild(sIn);
      page.appendChild(p3);

      var logBtn = bigButton('Log it & get your review →', logFlight, { disabled: S.experienced == null });
      var syncLog = function () { logBtn.disabled = S.experienced == null; };
      page.appendChild(logBtn);
    } else {
      var stats = h('div', 'fw-panel');
      stats.appendChild(gapGauge(S.predicted, S.experienced));
      stats.appendChild(h('div', 'fw-statline',
        '<span>Time ' + fmtTime(S.elapsedBase) + '</span>'
        + '<span>Questions asked ' + S.chat.filter(function (m) { return m.role === 'user'; }).length + '</span>'
        + '<span>Nudges ' + S.hintCount + '</span>'
        + '<span class="fw-pos">✓ Logged</span>'));
      page.appendChild(stats);

      var fb = h('div', 'fw-panel fw-panel--accent');
      fb.appendChild(eyebrow('A senior ' + esc(sim.title.toLowerCase()) + ' reads your work', true));
      if (S.fbBusy) fb.appendChild(h('p', 'fw-typing', 'Reviewing your deliverable…'));
      if (S.fbError) {
        fb.appendChild(h('p', 'fw-error', esc(S.fbError)));
        var retry = h('button', 'fw-retry', 'Retry review');
        retry.type = 'button';
        retry.onclick = fetchFeedback;
        fb.appendChild(retry);
      }
      if (S.feedback) {
        var f = S.feedback;
        var out = h('div', 'fw-up');
        out.appendChild(h('div', 'fw-fb-label fw-pos', 'What worked'));
        (f.strengths || []).forEach(function (s) { out.appendChild(h('p', 'fw-p fw-p--tight', '· ' + esc(s))); });
        out.appendChild(h('div', 'fw-fb-label fw-neg', 'What to sharpen'));
        (f.growth || []).forEach(function (s) { out.appendChild(h('p', 'fw-p fw-p--tight', '· ' + esc(s))); });
        out.appendChild(h('div', 'fw-verdict', '“' + esc(f.verdict || '') + '”'));
        fb.appendChild(out);
      }
      page.appendChild(fb);

      // FW2.0 C2 — shareable "signal" card from the logged trial (no PII, no backend).
      if (window.FWSimShare && S.lastTrial) {
        try { FWSimShare.injectButton(page, S.lastTrial); } catch (_) {}
      }

      if (S.tier === 'flight') {
        var deepOk = deepTierEntitled();
        page.appendChild(bigButton(
          deepOk ? 'Go deeper — the 25-minute version →' : 'Go deeper — the 25-minute version (Flight Plan) →',
          function () {
            logEvent('tier_upgrade_click', { from: 'flight', gated: !deepOk });
            if (!deepOk) { location.href = 'pricing.html'; return; }
            clearDraft(sim.id);
            startTier('deep');
          },
        ));
      }
      var flown = S.trials.filter(function (t) { return t.tier !== 'taxi'; });
      if (flown.length >= 2) page.appendChild(bigButton('The Mirror updated — open your readout →', showMirror, { outline: S.tier === 'flight' }));

      var ctas = h('div', 'fw-ctas');
      var hubSlug = FLIGHT_TO_SLUG[sim.id] || (sim.generated ? sim.id : null);
      if (hubSlug) {
        var dd = h('a', 'fw-cta', 'Career deep-dive page →');
        dd.href = 'career.html?slug=' + encodeURIComponent(hubSlug);
        ctas.appendChild(dd);
        var rm = h('a', 'fw-cta', 'Build my roadmap →');
        rm.href = 'roadmap.html?career=' + encodeURIComponent(hubSlug);
        ctas.appendChild(rm);
      }
      var marco = h('a', 'fw-cta', 'Talk it out with Marco');
      marco.href = 'coach.html';
      ctas.appendChild(marco);
      var again = h('a', 'fw-cta', 'Try another career');
      again.href = 'simulation.html';
      ctas.appendChild(again);
      page.appendChild(ctas);
    }

    root.appendChild(page);
    scrollTop();
  }

  function logFlight() {
    if (S.experienced == null || S.logged) return;
    var sim = S.sim;
    var energizers = sim.moments.filter(function (_, i) { return S.marks[i] === 'energy'; });
    var drainers = sim.moments.filter(function (_, i) { return S.marks[i] === 'drain'; });
    S.lastTrial = {
      simId: sim.id,
      simTitle: sim.title,
      domain: sim.domain,
      tag: sim.tag,
      tier: S.tier,
      predicted: S.predicted,
      experienced: S.experienced,
      gap: S.experienced - S.predicted,
      seconds: S.elapsedBase,
      depthMsgs: S.chat.filter(function (m) { return m.role === 'user'; }).length,
      hintsUsed: S.hintCount,
      energizers: energizers,
      drainers: drainers,
      surprise: S.surprise.trim(),
      artifactExcerpt: buildArtifact().slice(0, 280),
      verdict: '',
      at: new Date().toISOString()
    };
    // Save-first: the trial logs even if the review call fails.
    S.trials = S.trials.filter(function (t) { return !(t.simId === sim.id && t.tier === S.tier); });
    S.trials.unshift(S.lastTrial);
    saveTrials();
    clearDraft(sim.id);
    S.logged = true;
    logEvent('debrief_logged', { exp: S.experienced, gap: S.lastTrial.gap });
    showDebrief();
    fetchFeedback();
  }

  function fetchFeedback() {
    S.fbBusy = true;
    S.fbError = null;
    showDebrief();
    fwApi('/sim-feedback', { simId: S.sim.id, artifact: buildArtifact().slice(0, 6000) })
      .then(function (data) {
        var f = data.feedback || data;
        if (!f || !Array.isArray(f.strengths)) throw new Error('bad feedback');
        S.feedback = f;
        logEvent('feedback_ok');
        if (S.lastTrial) { S.lastTrial.verdict = f.verdict || ''; saveTrials(); }
      })
      .catch(function () {
        S.fbError = 'Your work is safely logged — the reviewer couldn\'t be reached. Tap retry for your feedback.';
        logEvent('feedback_fail');
      })
      .then(function () {
        S.fbBusy = false;
        if (S.view === 'debrief') showDebrief();
      });
  }

  /* ── Mirror ────────────────────────────────────────────────── */

  function showMirror() {
    clearRoot();
    S.view = 'mirror';
    var flown = S.trials.filter(function (t) { return t.tier !== 'taxi'; });
    var page = h('div', 'fw-page fw-up');
    page.appendChild(backRow('All careers', showBoard));
    page.appendChild(h('div', 'section-tag', 'The Mirror'));
    page.appendChild(h('h1', 'fw-h1', 'What repeats when the job changes'));
    page.appendChild(h('p', 'fw-intro', flown.length + ' flights logged. The Mirror reads your signals — energy marks, forecast gaps, questions asked — and names the patterns you can\'t see from inside.'));

    if (!S.mirror) {
      page.appendChild(bigButton(S.mirrorBusy ? 'Reading ' + flown.length + ' flights…' : 'Run the Mirror →', runMirror, { disabled: S.mirrorBusy }));
    }
    if (S.mirrorError) page.appendChild(h('p', 'fw-error', esc(S.mirrorError)));

    if (S.mirror) {
      var m = S.mirror;
      var wrap = h('div', 'fw-cards fw-up');
      wrap.appendChild(h('div', 'fw-strongest', '<div class="fw-eyebrow">Strongest signal</div><div class="fw-strongest-txt">' + esc(m.headline || '') + '</div>'));
      (m.patterns || []).forEach(function (p) {
        var c = h('div', 'fw-panel');
        c.appendChild(h('div', 'fw-pattern-title', esc(p.title || '')));
        c.appendChild(h('p', 'fw-p fw-p--dim', esc(p.evidence || '')));
        wrap.appendChild(c);
      });
      if (m.predictionInsight) {
        var pi = h('div', 'fw-panel');
        pi.appendChild(eyebrow('How well you predict yourself'));
        pi.appendChild(h('p', 'fw-p', esc(m.predictionInsight)));
        wrap.appendChild(pi);
      }
      if ((m.nextFlights || []).length) {
        var nf = h('div', 'fw-panel fw-panel--pos');
        nf.appendChild(h('div', 'fw-eyebrow fw-pos', 'Suggested next careers to try'));
        m.nextFlights.forEach(function (n) {
          nf.appendChild(h('div', 'fw-nextflight', '<div class="fw-nextflight-name">' + esc(n.career || '') + '</div><p class="fw-p fw-p--dim fw-p--tight">' + esc(n.why || '') + '</p>'));
        });
        wrap.appendChild(nf);
      }
      var rerun = h('button', 'fw-retry fw-retry--wide', S.mirrorBusy ? 'Re-reading…' : 'Re-run the Mirror');
      rerun.type = 'button';
      rerun.disabled = S.mirrorBusy;
      rerun.onclick = runMirror;
      wrap.appendChild(rerun);
      page.appendChild(wrap);
      // FW2.0 C2 — share the most recent flight from the Mirror too.
      if (window.FWSimShare && flown.length) {
        try { FWSimShare.injectButton(page, flown[0]); } catch (_) {}
      }
    }

    root.appendChild(page);
    scrollTop();
  }

  function runMirror() {
    S.mirrorBusy = true;
    S.mirrorError = null;
    S.mirror = null;
    logEvent('mirror_run');
    showMirror();
    var summary = S.trials.filter(function (t) { return t.tier !== 'taxi'; }).slice(0, 12).map(function (t) {
      return {
        role: t.simTitle, domain: t.domain, familiarity: t.tag,
        predictedEnjoyment: t.predicted, experiencedEnjoyment: t.experienced, gap: t.gap,
        minutesSpent: Math.round((t.seconds || 0) / 60),
        colleagueMessagesSent: t.depthMsgs, hintsUsed: t.hintsUsed,
        energizedBy: t.energizers, drainedBy: t.drainers,
        surpriseNote: t.surprise, workExcerpt: t.artifactExcerpt
      };
    });
    fwApi('/sim-mirror', { trials: summary })
      .then(function (data) {
        var m = data.mirror || data;
        if (!m || !m.headline) throw new Error('bad mirror');
        S.mirror = m;
      })
      .catch(function () {
        S.mirrorError = 'The Mirror couldn\'t run. Try again in a moment.';
      })
      .then(function () {
        S.mirrorBusy = false;
        if (S.view === 'mirror') showMirror();
      });
  }

  /* ── Slug resolution + generated sims ──────────────────────── */

  function normSlug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  function catalogTitle(slug) {
    try {
      if (global.FWOnetCatalog && typeof FWOnetCatalog.getBySlug === 'function') {
        var row = FWOnetCatalog.getBySlug(slug);
        if (row && (row.title || row.name)) return row.title || row.name;
      }
    } catch (_) {}
    return '';
  }

  function authoredForSlug(slug, name) {
    var direct = S.sims.find(function (s) { return s.id === slug; });
    if (direct) return direct;
    for (var id in ALIASES) {
      if (ALIASES[id].indexOf(slug) !== -1) {
        var m = S.sims.find(function (s) { return s.id === id; });
        if (m) return m;
      }
    }
    var title = (name || catalogTitle(slug) || slug.replace(/-/g, ' ')).toLowerCase();
    for (var id2 in TITLE_HINTS) {
      var hit = TITLE_HINTS[id2].some(function (hint) { return title.indexOf(hint) !== -1; });
      if (hit) {
        var m2 = S.sims.find(function (s) { return s.id === id2; });
        if (m2) return m2;
      }
    }
    return null;
  }

  function showGenerating(name) {
    clearRoot();
    var page = h('div', 'fw-page fw-up');
    page.appendChild(backRow('All careers', showBoard));
    // Hybrid loader: the copy carries the ~20s expectation, the skeleton shows
    // the workspace being built (doc list + main panel).
    page.appendChild(h('div', 'fw-loading',
      '<span>Building a realistic ' + esc(name) + ' simulation… the first person to try a career waits ~20 seconds; everyone after gets it instantly.</span>'
      + '<div class="fw-loading-skeleton" aria-hidden="true">'
      + '<div class="fw-skel-docs">'
      + '<span class="fw-skeleton fw-skel-doc"></span>'
      + '<span class="fw-skeleton fw-skel-doc"></span>'
      + '<span class="fw-skeleton fw-skel-doc"></span>'
      + '</div>'
      + '<span class="fw-skeleton fw-skel-panel"></span>'
      + '</div>'));
    root.appendChild(page);
  }

  function openGenerated(slug, name) {
    logEvent('generate_wait', { slug: slug });
    showGenerating(name);
    fwApi('/sim-generate', { slug: slug, name: name })
      .then(function (data) {
        var sim = data.sim;
        if (!sim || !sim.docs || !sim.workSections) throw new Error('bad sim');
        sim.generated = true;
        S.sims.push(sim);
        openEntry(sim);
      })
      .catch(function () {
        logEvent('generate_fail', { slug: slug });
        clearRoot();
        var page = h('div', 'fw-page fw-up');
        page.appendChild(backRow('All careers', showBoard));
        page.appendChild(h('h1', 'fw-h1', 'That one isn\'t ready yet.'));
        page.appendChild(h('p', 'fw-intro', 'Our simulation builder is busy. There are ' + S.sims.length + ' fully-built careers to try below — several overlap with what drew you to ' + esc(name) + '.'));
        page.appendChild(bigButton('See all careers →', showBoard));
        root.appendChild(page);
      });
  }

  /* ── Boot ──────────────────────────────────────────────────── */

  function boot() {
    root = document.getElementById('fw-root');
    if (!root) return;
    S.trials = loadTrials();

    // Board discovery of AI-generated sims — best-effort, never blocks boot.
    fetch('/sim-generate', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        S.genIndex = (d && d.sims) || [];
        if (S.view === 'board' && S.genIndex.length) showBoard();
      })
      .catch(function () {});

    fetch(FLIGHTS_URL)
      .then(function (r) { if (!r.ok) throw new Error('flights ' + r.status); return r.json(); })
      .then(function (data) {
        S.sims = (data && data.sims) || [];
        if (!S.sims.length) throw new Error('no sims');

        var flightId = normSlug(qs('flight'));
        var slug = normSlug(qs('slug') || qs('career'));
        var name = qs('name');

        if (flightId) {
          var byId = S.sims.find(function (s) { return s.id === flightId; });
          if (byId) return openEntry(byId);
        }
        if (slug) {
          var authored = authoredForSlug(slug, name);
          if (authored) return openEntry(authored);
          return openGenerated(slug, name || catalogTitle(slug) || slug.replace(/-/g, ' '));
        }
        showBoard();
      })
      .catch(function (err) {
        console.warn('career tester boot failed', err);
        clearRoot();
        var page = h('div', 'fw-page');
        page.appendChild(h('p', 'fw-error', 'The Career Tester couldn\'t load. Refresh to try again.'));
        root.appendChild(page);
      });
  }

  global.FWFlights = { boot: boot, _state: S };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
