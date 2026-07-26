/**
 * Marco — the Career Hub's friendly AI-advisor mascot.
 *
 * A small fixed bubble in the bottom-left of the Career Hub (akin to Duolingo's
 * Duo). It shows a rotating, personalized one-liner and, when clicked, opens the
 * AI Career Advisor chat (coach.html).
 *
 * Marco only exists inside the Career Hub AND only once the initial quiz is done
 * (i.e. the local quiz blob's scores are present). With no quiz data there is nothing for
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

  function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }

  function quiz() {
    return ((window.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null) || {};
  }
  function hasQuiz() { var q = quiz(); return !!(q && q.scores && Object.keys(q.scores).length); }

  function firstName() {
    var q = quiz();
    var n = (q && q.name ? String(q.name) : '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
  }

  // "Gold" is the legendary tier, not the number 56. Read at call time from the
  // canonical ladder so a recalibration reaches Marco too — he shipped four
  // copies of the literal and would otherwise keep congratulating people at the
  // old threshold. marco.js only loads on dashboard.html, after onet-math.js.
  function isGoldScore(score) {
    return (Number(score) || 0) >= FWOnetMath.FIT_TIERS.legendary;
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
          isGold: isGoldScore(topScore),
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
          isGold: isGoldScore(cached[0].score),
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
          isGold: isGoldScore(onetCached[0].score),
          topScore: onetCached[0].score || 0,
        };
      }
    }

    if (!window.FWOnetVectors && FWH && FWH.rankCareersFromQuizScores) {
      var ranked = FWH.rankCareersFromQuizScores(q.scores || {});
      var top = ranked[0] && ranked[0].career ? ranked[0].career.name : null;
      var second = ranked[1] && ranked[1].career ? ranked[1].career.name : null;
      var isGold = ranked[0] ? isGoldScore(ranked[0].score) : false;
      return { top: top, second: second, isGold: isGold, topScore: ranked[0] ? ranked[0].score : 0 };
    }
    return { top: null, second: null, isGold: false, topScore: 0 };
  }

  // Build the candidate message pool from current state. Only includes lines whose
  // required data is present, so we never render "{name}" or "undefined".
  //
  // WS-D D5: one Marco across the product. The coach page's Marco leads with the
  // answer and skips motivational filler, so the chip does too — every line here
  // either names something specific about this user or asks a real question.
  // A waving-hand greeting is a different character.
  function messagePool() {
    var name = firstName();
    var t = topCareers();
    var msgs = [
      (name ? name + ', where' : 'Where') + ' are you headed?',
      "I've read your quiz. Ask me the hard question.",
    ];
    if (t.top) {
      msgs.push('Want the real path to ' + t.top + '?');
      msgs.push('Ask me why ' + t.top + ' came out on top.');
    }
    if (t.top && t.second) {
      msgs.push('Your two best fits: ' + t.top + ' and ' + t.second + '.');
    }
    if (t.isGold && t.top) {
      msgs.push(t.top + ' scores unusually high for you. Worth a conversation.');
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

  // Marco wears the FlightWay bird here and on the coach page — one face, one
  // asset (FWBrand owns the geometry). The paper plane stays as a fallback for
  // the case where brand.js has not executed yet.
  var PLANE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path></svg>';

  function faceHtml() {
    return (window.FWBrand && typeof FWBrand.icon === 'function') ? FWBrand.icon() : PLANE;
  }

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
      + '<div class="marco-avatar">' + faceHtml() + '</div>';

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
