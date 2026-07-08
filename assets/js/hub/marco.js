/**
 * Marco — the Career Hub's friendly AI-advisor mascot.
 *
 * A small fixed bubble in the bottom-left of the Career Hub (akin to Duolingo's
 * Duo). It shows a rotating, personalized one-liner and, when clicked, opens the
 * AI Career Advisor chat (coach.html).
 *
 * Marco only exists inside the Career Hub AND only once the initial quiz is done
 * (i.e. fw_hub_quiz_v1.scores is present). With no quiz data there is nothing for
 * him to say, so he stays hidden.
 *
 * His message re-rolls (a) on hub entry and (b) whenever matches are updated —
 * the refine/academics panels fire a 'marco-refresh' event after applying scores.
 */
(function () {
  'use strict';
  // FWHubCareers is the legacy 40-career bridge — Marco only needs it as a
  // last-resort rank fallback, so its absence must not hide him entirely.
  var FWH = window.FWHubCareers || null;

  var QUIZ_KEY = (FWH && FWH.HUB_QUIZ_KEY) || 'fw_hub_quiz_v1';

  function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }

  function quiz() { return readJson(QUIZ_KEY) || {}; }
  function hasQuiz() { var q = quiz(); return !!(q && q.scores && Object.keys(q.scores).length); }

  function firstName() {
    var q = quiz();
    var n = (q && q.name ? String(q.name) : '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
  }

  // {top, second, isGold} from vector-ranked careers when ONET hub is active.
  function topCareers() {
    var q = quiz();

    if (window.FWOnetHub && FWOnetHub.isReady && FWOnetHub.isReady()) {
      var careers = FWOnetHub.getRenderCareers ? FWOnetHub.getRenderCareers() : [];
      if (!careers.length && FWOnetHub.getActiveZone) {
        var zone = FWOnetHub.getActiveZone();
        var byZone = FWOnetHub.getCareersByZone ? FWOnetHub.getCareersByZone() : {};
        careers = (zone && byZone[zone]) ? byZone[zone] : [];
      }
      if (careers.length) {
        var ranked = careers.slice().sort(function (a, b) {
          var bf = b.fitScore != null ? b.fitScore : (b.personalityFit || 0);
          var af = a.fitScore != null ? a.fitScore : (a.personalityFit || 0);
          return bf - af;
        });
        var topC = ranked[0];
        var secondC = ranked[1];
        var topScore = topC ? (topC.fitScore != null ? topC.fitScore : (topC.personalityFit || 0)) : 0;
        return {
          top: topC ? topC.name : null,
          second: secondC ? secondC.name : null,
          isGold: topScore >= 76,
          topScore: topScore,
        };
      }
    }

    if (window.FWOnetVectors && FWOnetVectors.getCachedFeaturedRank) {
      var cached = FWOnetVectors.getCachedFeaturedRank(2);
      if (cached && cached.length) {
        return {
          top: cached[0].name || null,
          second: cached[1] ? cached[1].name : null,
          isGold: (cached[0].score || 0) >= 76,
          topScore: cached[0].score || 0,
        };
      }
    }

    if (window.FWOnetVectors && FWOnetVectors.getCachedOnetRank) {
      var onetCached = FWOnetVectors.getCachedOnetRank(2);
      if (onetCached && onetCached.length) {
        return {
          top: onetCached[0].name || null,
          second: onetCached[1] ? onetCached[1].name : null,
          isGold: (onetCached[0].score || 0) >= 76,
          topScore: onetCached[0].score || 0,
        };
      }
    }

    if (!window.FWOnetVectors && FWH && FWH.rankCareersFromQuizScores) {
      var ranked = FWH.rankCareersFromQuizScores(q.scores || {});
      var top = ranked[0] && ranked[0].career ? ranked[0].career.name : null;
      var second = ranked[1] && ranked[1].career ? ranked[1].career.name : null;
      var isGold = ranked[0] ? (ranked[0].score >= 76) : false;
      return { top: top, second: second, isGold: isGold, topScore: ranked[0] ? ranked[0].score : 0 };
    }
    return { top: null, second: null, isGold: false, topScore: 0 };
  }

  // Build the candidate message pool from current state. Only includes lines whose
  // required data is present, so we never render "{name}" or "undefined".
  function messagePool() {
    var name = firstName();
    var t = topCareers();
    var who = name || 'there';
    var msgs = [
      'Where are you headed' + (name ? ', ' + name : '') + '?',
      'Hey ' + who + '! 👋',
      "I'm Marco — caught up on your quiz. Ask me anything."
    ];
    if (t.top) {
      msgs.push((name ? name + ', want' : 'Want') + ' to plan your path to ' + t.top + '?');
      msgs.push('Curious why ' + t.top + ' is your top match?');
    }
    if (t.top && t.second) {
      msgs.push('Your top overall fits: ' + t.top + ' and ' + t.second + '.');
    }
    if (t.isGold && t.top) {
      msgs.push(t.top + ' is lighting up gold for you ✨ — let’s talk.');
    }
    return msgs;
  }

  var lastMsg = null;
  function pickMessage() {
    var pool = messagePool();
    if (!pool.length) return 'Hey! 👋';
    // avoid immediately repeating the same line
    var choices = pool.length > 1 ? pool.filter(function (m) { return m !== lastMsg; }) : pool;
    var m = choices[Math.floor(Math.random() * choices.length)];
    lastMsg = m;
    return m;
  }

  var root, bubbleText;
  var currentMsg = '';   // the line currently shown in the bubble

  var PLANE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path></svg>';

  function render() {
    if (!root) return;
    currentMsg = pickMessage();
    if (bubbleText) bubbleText.textContent = currentMsg;
  }

  function open() {
    // Carry the exact line Marco is showing into the chat as his opening message.
    try { if (currentMsg) sessionStorage.setItem('fw_marco_starter', currentMsg); } catch (_) {}
    // Navigate to the AI Career Advisor chat (lives on the main app page).
    window.location.href = 'coach.html';
  }

  function build() {
    if (!hasQuiz()) return;   // Marco only appears once the quiz is done.
    if (document.getElementById('marco-root')) return;

    root = document.createElement('div');
    root.id = 'marco-root';
    root.className = 'marco-root';
    root.setAttribute('role', 'button');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', 'Open Marco, your AI career advisor');
    root.innerHTML =
        '<div class="marco-bubble"><span class="marco-bubble-text" id="marco-bubble-text"></span></div>'
      + '<div class="marco-avatar">' + PLANE + '</div>';

    root.addEventListener('click', open);
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

    document.body.appendChild(root);
    bubbleText = document.getElementById('marco-bubble-text');
    render();

    // Re-roll when matches change (refine/academics fire this after applying).
    window.addEventListener('marco-refresh', render);

    window.FWMarco = { refresh: render, open: open };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
